// Mutable mode (2026-10-15): the same app and the same three windows, but their pages come from Vite's dev server
// (http://localhost:1420) instead of the bundle, so an edit to sol/mac/src slides into the running windows through hot
// module replacement: no reload, no relaunch. The face is hot, the engine and this shell stay cold.
//
// The pick is a "face-hot" file next to the notch-off flag (there: hot; gone: bundled), so it survives a relaunch.
// Hot asks for Vite: if nothing answers on 1420, Sol starts it in sol/mac itself (its own child, stopped when Sol
// quits or the face goes back to bundled). The windows only go to the dev pages while Vite answers; when it stops
// answering they go back to the bundled pages within two seconds, and the engine drawer says "dev server down".
// The menu bar icon's menu flips it too: the escape hatch for an edit that breaks the page holding the switch.
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, Url, Wry};

pub const DEV: &str = "http://localhost:1420";
pub const LABELS: [&str; 3] = ["main", "notch", "island"];
const GRACE: Duration = Duration::from_secs(15); // a fresh Vite gets this long before Sol tries again

#[derive(Default)]
pub struct HotState {
    want: bool,             // Marco's pick
    on: bool,               // the windows are on the dev pages now
    child: Option<Child>,   // the Vite Sol started (None when it found one already running)
    spawned: Option<Instant>,
    bundled: Option<Url>,   // where the bundled pages live (tauri://localhost/), read at launch
    last: &'static str,
    pub tray: Option<MenuItem<Wry>>,
}
#[derive(Default)]
pub struct Hot(pub Mutex<HotState>);

#[derive(Clone, serde::Serialize)]
pub struct FaceState { hot: bool, state: &'static str }

pub fn tray_text(hot: bool) -> &'static str { if hot { "Use the bundled face" } else { "Make the face hot" } }

fn flag(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("face-hot"))
}
pub fn wanted(app: &AppHandle) -> bool { flag(app).map(|f| f.exists()).unwrap_or(false) }

/// Vite listens on "localhost", which node may bind as ::1 only: ask both.
fn dev_up() -> bool {
    ["127.0.0.1:1420", "[::1]:1420"].iter().any(|a| {
        a.parse::<SocketAddr>().map(|s| TcpStream::connect_timeout(&s, Duration::from_millis(200)).is_ok()).unwrap_or(false)
    })
}

fn state_of(s: &HotState) -> &'static str {
    if !s.want { "bundled" }
    else if s.on { "hot" }
    else if s.spawned.map(|t| t.elapsed() < GRACE).unwrap_or(false) { "starting" }
    else { "dev server down" }
}

pub fn state(app: &AppHandle) -> FaceState {
    let st = app.state::<Hot>();
    let s = st.0.lock().unwrap();
    FaceState { hot: s.want, state: state_of(&s) }
}

/// Start Vite in the root's sol/mac (root.rs; the checkout this app runs), its output in the app's log folder.
fn spawn_vite(app: &AppHandle) -> Option<Child> {
    let dir = crate::root::root(app)?.join("sol").join("mac");
    let log = app.path().app_log_dir().ok().and_then(|d| {
        let _ = std::fs::create_dir_all(&d);
        std::fs::OpenOptions::new().create(true).append(true).open(d.join("vite.log")).ok()
    });
    let (out, err) = match log.as_ref().and_then(|f| Some((f.try_clone().ok()?, f.try_clone().ok()?))) {
        Some((a, b)) => (Stdio::from(a), Stdio::from(b)),
        None => (Stdio::null(), Stdio::null()),
    };
    // exec: the pid Sol holds is node itself, so stopping it stops Vite (npx would leave its child running)
    Command::new("/bin/sh")
        .arg("-c")
        .arg("exec \"$0\" node_modules/vite/bin/vite.js --port 1420 --strictPort")
        .arg(crate::root::node())
        .current_dir(dir)
        .env("PATH", crate::root::path_env())
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err)
        .spawn()
        .ok()
}

pub fn stop_vite(app: &AppHandle) {
    let st = app.state::<Hot>();
    let mut s = st.0.lock().unwrap();
    if let Some(mut c) = s.child.take() { let _ = c.kill(); let _ = c.wait(); }
    s.spawned = None;
}

/// Point every window at the dev pages or back at the bundled ones, keeping each page's path and query.
fn navigate(app: &AppHandle, base: &Url) {
    for label in LABELS {
        let Some(w) = app.get_webview_window(label) else { continue };
        let Ok(cur) = w.url() else { continue };
        let mut to = base.clone();
        to.set_path(cur.path());
        to.set_query(cur.query());
        if to != cur { let _ = w.navigate(to); }
    }
}

/// Launch: remember where the bundled pages are and read the pick. The first check() moves the windows.
pub fn init(app: &AppHandle) {
    let bundled = app.get_webview_window("main").and_then(|w| w.url().ok()).map(|mut u| { u.set_path("/"); u.set_query(None); u });
    let st = app.state::<Hot>();
    let mut s = st.0.lock().unwrap();
    s.bundled = bundled;
    s.want = wanted(app);
}

/// Every two seconds (and right after a flip), on the main thread. Returns the labels whose page changed, so the
/// caller can reset what it keeps about them (the notch's open/hover state).
pub fn check(app: &AppHandle) -> bool {
    let up = dev_up();
    let st = app.state::<Hot>();
    let mut s = st.0.lock().unwrap();
    if s.want && !up {
        let alive = s.child.as_mut().map(|c| matches!(c.try_wait(), Ok(None))).unwrap_or(false);
        let fresh = s.spawned.map(|t| t.elapsed() < GRACE).unwrap_or(false);
        if !alive && !fresh {
            s.child = spawn_vite(app);
            s.spawned = Some(Instant::now());
        }
    }
    let should = s.want && up;
    let moved = should != s.on;
    if moved {
        let base = if should { Url::parse(DEV).ok() } else { s.bundled.clone() };
        if let Some(b) = base { navigate(app, &b); }
        s.on = should;
    }
    let now = state_of(&s);
    if now != s.last {
        s.last = now;
        let _ = app.emit_to("main", "face-state", FaceState { hot: s.want, state: now });
    }
    moved
}

/// Flip the pick (Settings or the menu bar icon).
pub fn set(app: &AppHandle, hot: bool) {
    if let Some(f) = flag(app) {
        if hot {
            if let Some(d) = f.parent() { let _ = std::fs::create_dir_all(d); }
            let _ = std::fs::write(&f, "");
        } else {
            let _ = std::fs::remove_file(&f);
        }
    }
    {
        let st = app.state::<Hot>();
        let mut s = st.0.lock().unwrap();
        s.want = hot;
        if let Some(t) = &s.tray { let _ = t.set_text(tray_text(hot)); }
    }
    if !hot { stop_vite(app); }
}
