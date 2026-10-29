// The first run's three commands (#169 the download's door, #134 the first run). A Sol.app with no root (root.rs)
// shows the face at /?firstrun=1 (sol/mac/src/firstrun): it asks a name and runs the bundled sol/install behind the
// scenes (the same file the one line runs, with SOL_SKIP_APP=1: the app is already here), streaming its lines to the
// page; Sign in to Claude opens Terminal on `claude auth login` (Claude's own sign-in wants a terminal to paste the
// code in; the page cannot host it); welcome_done reads the root again, starts the engine and loads the face.
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

/// What Terminal runs for the sign-in, as AppleScript's `do script` text: the full path, quoted for the shell and then
/// for AppleScript, so a fresh Mac's Terminal (no ~/.local/bin on its PATH) runs it too; plain `claude` when none is found.
fn login_script(claude: Option<&std::path::Path>) -> String {
    let cmd = match claude {
        Some(p) => format!("'{}' auth login", p.to_string_lossy().replace('\'', "'\\''")),
        None => "claude auth login".to_string(),
    };
    format!("tell application \"Terminal\" to do script \"{}\"", cmd.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Terminal.app on `claude auth login`: the person pastes the code there and comes back.
#[tauri::command]
pub fn claude_login() -> Result<(), String> {
    let script = login_script(claude_path().as_deref());
    let s = Command::new("/usr/bin/osascript")
        .args(["-e", "tell application \"Terminal\" to activate", "-e", &script])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .status().map_err(|e| format!("could not open Terminal: {e}"))?;
    if s.success() { Ok(()) } else { Err("Terminal did not open".into()) }
}

/// Is Claude Code signed in? `claude auth status` on the install's PATH (root::path_env: ~/.local/bin, where the install
/// puts it, and Homebrew's), read for its `"loggedIn": true`, as sol/install reads it. The first run's Claude card asks
/// this on a beat while it shows, so a sign-in done in Terminal, from the card or from the line, turns it green when the
/// person comes back (#307). Async: a Node start is a few hundred milliseconds, never on the main thread.
#[tauri::command]
pub async fn claude_status() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        let claude = claude_path().unwrap_or_else(|| PathBuf::from("claude"));
        Command::new(claude).args(["auth", "status"]).env("PATH", root::path_env())
            .stdin(Stdio::null()).stderr(Stdio::null()).output().ok()
            .map(|o| logged_in(&String::from_utf8_lossy(&o.stdout))).unwrap_or(false)
    }).await.unwrap_or(false)
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
    use super::{find_in, logged_in, login_script};
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
        // the full path, quoted for the shell and AppleScript
        assert_eq!(login_script(Some(std::path::Path::new("/Users/ada/.local/bin/claude"))),
            "tell application \"Terminal\" to do script \"'/Users/ada/.local/bin/claude' auth login\"");
        assert_eq!(login_script(Some(std::path::Path::new("/Users/o'neil/a b/claude"))),
            "tell application \"Terminal\" to do script \"'/Users/o'\\\\''neil/a b/claude' auth login\"");
        assert_eq!(login_script(None), "tell application \"Terminal\" to do script \"claude auth login\"");
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
