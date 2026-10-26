// The eye (#253): Sol invisible to a screen share. macOS lets an app hide its
// own windows from every share, screenshot and recording with one flag on each window (NSWindowSharingNone, which
// Tauri sets as "content protection"); Zoom, Meet, Teams and FaceTime capture the screen in a way that honours it and
// show the wallpaper where the window is, no black box. No app can hide another app's windows; that is part 3's clean
// screen.
//
// One process-wide flag, `invisible`, false by default: Sol is visible until the eye is pressed. `eye_set` stores it,
// keeps it in one small file (eye.json in the app's data folder, read at start), protects or unprotects every Sol window
// and tells the pages ("eye-changed"), so the notch and the island draw the same eye. A window made later is born with
// the flag: the builders in lib.rs (the notch and the island) and grab.rs (the sheet) pass `invisible()`, and the main
// window (made from tauri.conf.json, before setup) gets it at start and on every welcome page. The clean screen's
// window (label "clean", part 3) is the one exception: it is what Marco shares, so it is always shareable.
//
// The flick never waits on the engine; the notch tells the engine afterwards (`eye { invisible }`, PROTOCOL.md round
// 39), so a Sol grab can refuse while Sol is hidden.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

static INVISIBLE: AtomicBool = AtomicBool::new(false);

/// the clean screen's window (part 3): always shareable, whatever the eye says
const CLEAN: &str = "clean";

fn file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("eye.json"))
}

/// true while Sol's windows are hidden from a share
pub fn invisible() -> bool {
    INVISIBLE.load(Ordering::SeqCst)
}

/// At app start, before any window is shown: the eye as it was left. No file, or one that does not read: visible.
pub fn load(app: &AppHandle) {
    let on = file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("invisible").and_then(|b| b.as_bool()))
        .unwrap_or(false);
    INVISIBLE.store(on, Ordering::SeqCst);
}

/// One window to the flag (the clean screen excepted). Any thread: Tauri hands it to the main thread. A window, not a
/// web view: the main window holds the face's web view and a thing's beside it (thing.rs), and the share sees the window.
pub fn apply(w: &tauri::Window) {
    if w.label() == CLEAN { return; }
    let _ = w.set_content_protected(invisible());
}

/// Every Sol window that exists now (at start: the main window, made before setup).
pub fn apply_all(app: &AppHandle) {
    for w in app.windows().values() { apply(w); }
}

/// The notch's press on the eye: store the flag, keep it for the next launch, apply it to every window, tell the
/// pages. Answers the flag as it now is; the windows change even when the file could not be written (the error says so).
#[tauri::command]
pub async fn eye_set(app: AppHandle, invisible: bool) -> Result<bool, String> {
    INVISIBLE.store(invisible, Ordering::SeqCst);
    apply_all(&app);
    let _ = app.emit("eye-changed", invisible);
    let f = file(&app).ok_or("the app has no data folder to keep the eye in")?;
    if let Some(d) = f.parent() { let _ = std::fs::create_dir_all(d); }
    std::fs::write(&f, serde_json::json!({ "invisible": invisible }).to_string())
        .map_err(|e| format!("the eye could not be kept for the next launch: {e}"))?;
    Ok(invisible)
}

/// The eye as it is now: true while Sol is invisible to a share.
#[tauri::command]
pub fn eye_get() -> bool {
    invisible()
}
