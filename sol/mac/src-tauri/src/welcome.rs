// The welcome page's three commands (#169, the download's door). A Sol.app with no root (root.rs) shows welcome.html
// in the main window: a name, an optional Gemini key, Set up. Set up runs the bundled sol/install (the same file the
// one line runs, with SOL_SKIP_APP=1: the app is already here) and streams its lines to the page; Sign in to Claude
// opens Terminal on `claude auth login` (Claude's sign-in wants a terminal to paste the code in; the page cannot host
// it); Open Sol reads the root again, starts the engine and loads the face.
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
        if *r { return Err("the install is already running".into()); }
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

/// Terminal.app on `claude auth login`: the person pastes the code there and comes back.
#[tauri::command]
pub fn claude_login() -> Result<(), String> {
    let s = Command::new("/usr/bin/osascript")
        .args(["-e", "tell application \"Terminal\" to activate", "-e", "tell application \"Terminal\" to do script \"claude auth login\""])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .status().map_err(|e| format!("could not open Terminal: {e}"))?;
    if s.success() { Ok(()) } else { Err("Terminal did not open".into()) }
}

/// Open Sol: the root is read again (the install wrote the file), the engine starts, the face loads.
#[tauri::command]
pub fn welcome_done(app: AppHandle) -> Result<(), String> {
    if root::root(&app).is_none() { return Err("no Sol here yet: Set up first".into()); }
    crate::start_engine_if_needed(&app);
    show_page(&app, "/");
    Ok(())
}

/// The main window on one of the bundled pages ("/" the face, "/welcome.html" the welcome), the same host it is on.
pub fn show_page(app: &AppHandle, path: &str) {
    if let Some(w) = app.get_webview("main") {   // the face's web view; the window may hold a thing too (thing.rs)
        if let Ok(mut u) = w.url() {
            u.set_path(path);
            u.set_query(None);
            let _ = w.navigate(u);
        }
        crate::eye::apply(&w.window());   // the main window keeps the eye across its pages (eye.rs)
    }
}
