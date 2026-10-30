// The first run's three commands (#169 the download's door, #134 the first run). A Sol.app with no root (root.rs)
// shows the face at /?firstrun=1 (sol/mac/src/firstrun): it asks a name and runs the bundled sol/install behind the
// scenes (the same file the one line runs, with SOL_SKIP_APP=1: the app is already here), streaming its lines to the
// page; the sign-ins (Claude, ChatGPT) open each one's own page in the browser, with no Terminal; welcome_done reads
// the root again, starts the engine and loads the face.
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::root;

static RUNNING: Mutex<bool> = Mutex::new(false);

/// the install script: bundled as a resource (tauri.conf.json), else the build folder's sol/install (a dev run)
fn script(app: &AppHandle) -> Option<PathBuf> {
    let bundled = app.path().resource_dir().ok().map(|d| d.join("install")).filter(|p| p.is_file());
    bundled.or_else(|| {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("install");
        p.is_file().then_some(p)
    })
}

/// Run the install with the name and the key in its environment (never on a command line). Each line it prints
/// comes to the page as "install-line"; "install-done" carries the exit code.
#[tauri::command]
pub fn install_run(app: AppHandle, name: String, gemini: String) -> Result<(), String> {
    {
        let mut r = RUNNING.lock().unwrap();
        // already running (the page mounted again, #375): nothing starts, and the page just listens on to the lines
        // and the end of the one that runs, which go to the main window whoever asked
        if *r { return Ok(()); }
        *r = true;
    }
    let Some(script) = script(&app) else { *RUNNING.lock().unwrap() = false; return Err("the install script is not in this app".into()); };
    let mut cmd = Command::new("/bin/sh");
    // one stream: stderr into stdout, in order, so the page shows what a terminal would
    cmd.arg("-c").arg("exec /bin/sh \"$1\" 2>&1").arg("sh").arg(&script)
        .env("SOL_SKIP_APP", "1")
        .env("PATH", root::path_env())
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let name = name.trim();
    if !name.is_empty() { cmd.env("SOL_OWNER", name); }
    let gemini = gemini.trim();
    if !gemini.is_empty() { cmd.env("GEMINI_API_KEY", gemini); }
    let mut child = cmd.spawn().map_err(|e| { *RUNNING.lock().unwrap() = false; format!("could not start the install: {e}") })?;
    let out = child.stdout.take();
    std::thread::spawn(move || {
        if let Some(out) = out {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let _ = app.emit_to("main", "install-line", serde_json::json!({ "line": line }));
            }
        }
        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        *RUNNING.lock().unwrap() = false;
        let _ = app.emit_to("main", "install-done", serde_json::json!({ "code": code }));
    });
    Ok(())
}

/// The first runnable `name` on a PATH-like list of folders, by its full path.
fn find_in(path: &str, name: &str) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    path.split(':').filter(|d| !d.is_empty()).map(|d| std::path::Path::new(d).join(name))
        .find(|p| p.is_file() && std::fs::metadata(p).map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false))
}

/// Claude Code as this app finds it: on the install's PATH (root::path_env, ~/.local/bin first, where Anthropic's
/// installer puts it), by its full path. Anthropic's installer does not put ~/.local/bin on the shell's PATH (#388).
fn claude_path() -> Option<PathBuf> { find_in(&root::path_env(), "claude") }

/// Codex as this app finds it: the engine's own (the install's npm puts @openai/codex under sol/engine), else one on
/// the PATH. The root is the root file's, or ~/Sol while the install has not written it yet.
fn codex_path(app: &AppHandle) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let root = root::root(app).or_else(|| home.map(|h| h.join("Sol")));
    root.map(|r| r.join("sol/engine/node_modules/.bin/codex")).filter(|p| p.is_file())
        .or_else(|| find_in(&root::path_env(), "codex"))
}

/// The install's PATH, with node looked for again while none was found: Codex under sol/engine is a node script
/// (`#!/usr/bin/env node`), and on a fresh Mac node arrives in ~/.sol/node only at the install's step 5, after
/// Set up asked for it once (root::node keeps that first answer).
fn fresh_path() -> String {
    if !root::node().is_absolute() { root::node_again(); }
    root::path_env()
}

// ---- the sign-ins, in the browser (Frank, 29 Oct: no Terminal) ----
// `claude auth login` and `codex login` both open the system browser on their own page and wait on a localhost
// callback, so with no terminal at all they finish by themselves when the person signs in there. One runs per AI;
// a second press starts it over; ten minutes with no sign-in and it is stopped.
static SIGNING: Mutex<Vec<(&'static str, u32)>> = Mutex::new(Vec::new());
const SIGN_IN_FOR: std::time::Duration = std::time::Duration::from_secs(600);

fn sign_in(app: &AppHandle, which: &'static str, bin: PathBuf, args: &[&str]) -> Result<(), String> {
    {
        let mut s = SIGNING.lock().unwrap();
        if let Some(i) = s.iter().position(|(w, _)| *w == which) {
            let (_, pid) = s.remove(i);
            let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
        }
    }
    let mut child = Command::new(&bin).args(args).env("PATH", fresh_path())
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|e| format!("could not start the sign-in: {e}"))?;
    let pid = child.id();
    SIGNING.lock().unwrap().push((which, pid));
    let app = app.clone();
    std::thread::spawn(move || {
        let began = std::time::Instant::now();
        let ok = loop {
            match child.try_wait() {
                Ok(Some(st)) => break st.success(),
                Ok(None) if began.elapsed() < SIGN_IN_FOR => std::thread::sleep(std::time::Duration::from_millis(500)),
                _ => {
                    // TERM first: codex under sol/engine is node's wrapper, which hands TERM to the real codex (a KILL
                    // would leave that one holding localhost:1455); KILL only if it is still there two seconds on
                    let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
                    let grace = std::time::Instant::now();
                    while matches!(child.try_wait(), Ok(None)) && grace.elapsed() < std::time::Duration::from_secs(2) {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    let _ = child.kill(); let _ = child.wait(); break false;
                }
            }
        };
        // a sign-in started over (a second press) ended by being stopped: the new one speaks, not this one
        let live = {
            let mut s = SIGNING.lock().unwrap();
            let before = s.len();
            s.retain(|(w, p)| !(*w == which && *p == pid));
            s.len() < before
        };
        if live { let _ = app.emit_to("main", "signin-done", serde_json::json!({ "which": which, "ok": ok })); }
    });
    Ok(())
}

/// Sign in to Claude: `claude auth login` with no terminal, so Claude's own page opens in the browser and the sign-in
/// lands here by itself. "signin-done" says when it ended; claude_status says whether it took.
#[tauri::command]
pub fn claude_login(app: AppHandle) -> Result<(), String> {
    let claude = claude_path().ok_or("Claude Code is not on this Mac yet")?;
    sign_in(&app, "claude", claude, &["auth", "login"])
}

/// Sign in with ChatGPT: `codex login`, the same way (OpenAI's page in the browser, the answer on localhost:1455).
#[tauri::command]
pub fn codex_login(app: AppHandle) -> Result<(), String> {
    let codex = codex_path(&app).ok_or("Codex is not here yet: it comes with the install, a minute or two in")?;
    sign_in(&app, "codex", codex, &["login"])
}

/// Is Claude Code signed in? `claude auth status` on the install's PATH (root::path_env: ~/.local/bin, where the install
/// puts it, and Homebrew's), read for its `"loggedIn": true`, as sol/install reads it. The first run's cards ask this
/// on a beat while they show, so a sign-in done anywhere turns the card green (#307). Async: a Node start is a few
/// hundred milliseconds, never on the main thread. "missing" when Claude Code is not on this Mac.
#[tauri::command]
pub async fn claude_status() -> &'static str {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(claude) = claude_path() else { return "missing" };
        let out = Command::new(claude).args(["auth", "status"]).env("PATH", root::path_env())
            .stdin(Stdio::null()).stderr(Stdio::null()).output().ok();
        if out.map(|o| logged_in(&String::from_utf8_lossy(&o.stdout))).unwrap_or(false) { "in" } else { "out" }
    }).await.unwrap_or("out")
}

/// Is Codex signed in with ChatGPT? `codex login status` ends 0 when it is. "missing" before the install brought it.
#[tauri::command]
pub async fn codex_status(app: AppHandle) -> &'static str {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(codex) = codex_path(&app) else { return "missing" };
        let ok = Command::new(codex).args(["login", "status"]).env("PATH", fresh_path())
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false);
        if ok { "in" } else { "out" }
    }).await.unwrap_or("out")
}

/// Claude Code when the install could not bring it (no network that minute, say): Anthropic's own installer, as
/// sol/install's step 7 runs it. Ok once ~/.local/bin/claude is there.
#[tauri::command]
pub async fn claude_install() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let st = Command::new("/bin/sh").args(["-c", "curl -fsSL https://claude.ai/install.sh | bash"])
            .env("PATH", root::path_env()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .status().map_err(|e| format!("could not start Anthropic's installer: {e}"))?;
        if st.success() && claude_path().is_some() { Ok(()) } else { Err("Anthropic's installer did not finish; try again in a minute".into()) }
    }).await.map_err(|e| e.to_string())?
}

/// the one word of `claude auth status` the card needs, read with its spacing as it comes (pretty JSON today)
fn logged_in(status: &str) -> bool {
    status.split_whitespace().collect::<String>().contains("\"loggedIn\":true")
}

/// Open Sol: the root is read again (the install wrote the file), node is found again (the install put one in
/// ~/.sol/node after the first look), the engine starts, the face loads. What it could not do comes back as the
/// error, for the page to say (#375): nothing here fails in silence.
#[tauri::command]
pub fn welcome_done(app: AppHandle) -> Result<(), String> {
    if root::root(&app).is_none() { return Err("no Sol here yet: the install has not finished. when it stops, try again".into()); }
    root::node_again();
    crate::start_engine_if_needed(&app);
    show_page(&app, "/")
}

/// The main window on one of the bundled pages ("/" the face, "/?firstrun=1" the first run), the same host it is on.
/// Err says which step would not go (the window gone, its address unreadable, the load refused).
pub fn show_page(app: &AppHandle, path: &str) -> Result<(), String> {
    let w = app.get_webview("main").ok_or("the main window is not here")?;   // the face's web view; the window may hold a thing too (thing.rs)
    let mut u = w.url().map_err(|e| format!("the main window's address could not be read: {e}"))?;
    // "/?firstrun=1": a query rides along (the first run, firstrun/FirstRun.tsx)
    let (p, q) = path.split_once('?').map(|(p, q)| (p, Some(q))).unwrap_or((path, None));
    u.set_path(p);
    u.set_query(q);
    w.navigate(u).map_err(|e| format!("the face would not load: {e}"))?;
    crate::eye::apply(&w.window());   // the main window keeps the eye across its pages (eye.rs)
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{find_in, logged_in};
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn the_sign_in_runs_claude_by_its_full_path() {
        let d = std::env::temp_dir().join(format!("sol-claude-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let (a, b) = (d.join("a"), d.join("b"));
        std::fs::create_dir_all(&a).unwrap(); std::fs::create_dir_all(&b).unwrap();
        // a file nobody may run is passed over; the first runnable one wins
        std::fs::write(a.join("claude"), "").unwrap();
        std::fs::write(b.join("claude"), "").unwrap();
        std::fs::set_permissions(b.join("claude"), std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = format!("{}:{}", a.display(), b.display());
        assert_eq!(find_in(&path, "claude"), Some(b.join("claude")));
        assert_eq!(find_in("", "claude"), None);
        assert_eq!(find_in(&a.display().to_string(), "claude"), None);
    }


    #[test]
    fn logged_in_reads_the_status_as_claude_prints_it() {
        assert!(logged_in("{\n  \"loggedIn\": true,\n  \"authMethod\": \"claude.ai\"\n}\n"));
        assert!(logged_in("{\"loggedIn\":true}"));
        assert!(!logged_in("{\n  \"loggedIn\": false\n}\n"));
        assert!(!logged_in(""));
        assert!(!logged_in("Not logged in"));
    }
}
