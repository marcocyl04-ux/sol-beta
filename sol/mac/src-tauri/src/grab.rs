// The grab sheet (Grab and Shelf, #200; sol/README.md "Grab and Shelf"). One full-screen transparent
// window over the main screen (the one with the menu bar), labelled "grab" and titled "Sol grab" (the engine's list of
// Sol windows leaves that title out, so the sheet never offers to photograph itself). It carries the rooms of grab.html:
// the dark room that picks a part of Sol (`sol`), the room that picks any app's window for a whole page (`page`), and the
// whole shelf (`shelf`).
//
// Made on first use, then only shown and hidden. `?mode` in its URL is read once, when the page first loads; every later
// entry comes as the "grab-open" event, { mode }, so a second open re-enters with the new room. Closing it only hides
// it (the app's general CloseRequested handler covers every window).
//
// Above the notch: the notch and island sit at the status window level (lib.rs raise()); the sheet sits one level
// higher, so while it is open it covers them too. Hidden, it is off the screen entirely and the notch is on top again.
// Mutable mode: the sheet is one of hot.rs's LABELS, so it follows the flip like the other windows, and when it is made
// while the face is hot it starts on Vite's page.
//
// Page's one native helper is `page_scroll` (at the end): it moves the pointer onto the window being stitched and turns
// the wheel there by a number of points, because a web page cannot send a scroll to another app. The sheet lets the
// pointer through itself while it does (setIgnoreCursorEvents), so the wheel reaches the window under it.
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

pub(crate) const LABEL: &str = "grab";

/// The main screen's rectangle in logical points: (x, y, w, h). Tauri's primary monitor is the one with the menu bar.
fn main_screen(app: &AppHandle) -> Option<(f64, f64, f64, f64)> {
    let m = app.primary_monitor().ok().flatten()?;
    let k = m.scale_factor();
    let p = m.position().to_logical::<f64>(k);
    let s = m.size().to_logical::<f64>(k);
    Some((p.x, p.y, s.width, s.height))
}

/// One level above the notch's (NSStatusWindowLevel), on every space, over full-screen apps. Main thread only.
#[cfg(target_os = "macos")]
pub(crate) fn raise(w: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    if let Ok(p) = w.ns_window() {
        let ns: &NSWindow = unsafe { &*(p as *const NSWindow) };
        ns.setLevel(objc2_app_kit::NSStatusWindowLevel + 1);
        ns.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
    }
}
#[cfg(not(target_os = "macos"))]
pub(crate) fn raise(_w: &tauri::WebviewWindow) {}

/// The sheet's first page: the bundled grab.html, or Vite's while the face is hot.
fn first_url(app: &AppHandle, mode: &str) -> WebviewUrl {
    let page = format!("grab.html?mode={mode}");
    if crate::hot::is_on(app) {
        if let Ok(u) = tauri::Url::parse(&format!("{}/{page}", crate::hot::DEV)) { return WebviewUrl::External(u); }
    }
    WebviewUrl::App(page.into())
}

/// Main thread: the sheet's window, hidden, built once (first_url: the hot face or the bundled page).
fn make(app: &AppHandle, mode: &str) -> Result<tauri::WebviewWindow, String> {
    let w = WebviewWindowBuilder::new(app, LABEL, first_url(app, mode))
        .title("Sol grab")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .resizable(false)
        .accept_first_mouse(true)
        .focusable(true)
        .disable_drag_drop_handler()   // the page's own drags (shelf thumbs out) reach it as HTML drags
        .visible(false)
        .build()
        .map_err(|e| format!("could not make the grab sheet: {e}"))?;
    raise(&w);
    Ok(w)
}

/// At app start: build the sheet hidden, so the first grab does not pay for the webview and the page (it felt laggy,
/// 2026-10-25). Later opens only show it.
pub fn warm(app: &AppHandle) {
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        if h.get_webview_window(LABEL).is_none() { if let Err(e) = make(&h, "sol") { eprintln!("grab: {e}"); } }
    });
}

/// Main thread: make the window if it is not there, cover the main screen, then show + focus + "grab-open", or hide.
fn sheet(app: &AppHandle, mode: &str, open: bool) -> Result<(), String> {
    let w = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None if !open => return Ok(()),   // nothing to hide
        None => make(app, mode)?,
    };
    if !open {
        return w.hide().map_err(|e| e.to_string());
    }
    raise(&w);   // again on every open: the permissions guide (permit.rs) may have left it at the normal level
    if let Some((x, y, ww, wh)) = main_screen(app) {
        let _ = w.set_size(LogicalSize::new(ww, wh));
        let _ = w.set_position(LogicalPosition::new(x, y));
    }
    w.show().map_err(|e| e.to_string())?;
    let _ = w.set_focus();
    let _ = app.emit_to(LABEL, "grab-open", serde_json::json!({ "mode": mode }));
    Ok(())
}

/// Open the sheet in a room (`sol` | `page` | `shelf`), or hide it. Async, so the window work is handed to the main thread
/// (AppKit's rule, and window building from a blocking command can deadlock); the answer comes back from there.
#[tauri::command]
pub async fn grab_sheet(app: AppHandle, mode: String, open: bool) -> Result<(), String> {
    if open && mode != "sol" && mode != "page" && mode != "shelf" {
        return Err(format!("no such grab room: {mode}"));
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let h = app.clone();
    app.run_on_main_thread(move || { let _ = tx.send(sheet(&h, &mode, open)); }).map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

// ---- Page: the pointer and the wheel ----
// Raw CoreGraphics (no crate for these few calls). Posting events into the system needs the Accessibility
// permission (permit.rs checks and asks for it); without it the wheel would silently do nothing, so the command
// says so and the sheet tells Marco.
#[cfg(target_os = "macos")]
mod wheel {
    use std::ffi::c_void;
    type Ref = *const c_void;
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct CGPoint { pub x: f64, pub y: f64 }

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn CGWarpMouseCursorPosition(p: CGPoint) -> i32;
        // the non-variadic form of CGEventCreateScrollWheelEvent (macOS 10.13+): three wheels, unused ones 0
        fn CGEventCreateScrollWheelEvent2(source: Ref, units: u32, wheel_count: u32, wheel1: i32, wheel2: i32, wheel3: i32) -> Ref;
        fn CGEventSetLocation(event: Ref, p: CGPoint);
        fn CGEventPost(tap: u32, event: Ref);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(r: Ref);
    }
    const UNIT_PIXEL: u32 = 0; // kCGScrollEventUnitPixel
    const HID_EVENT_TAP: u32 = 0; // kCGHIDEventTap

    /// the pointer to (x, y), global points from the main screen's top-left; then, unless dy is 0, one wheel turn of
    /// dy points there (positive dy moves the page's content up, as scrolling down does)
    pub fn scroll(x: f64, y: f64, dy: f64) -> Result<(), String> {
        let at = CGPoint { x, y };
        unsafe {
            if CGWarpMouseCursorPosition(at) != 0 { return Err("the pointer could not be moved".into()); }
            if dy == 0.0 { return Ok(()); }
            let px = (-dy).round().clamp(i32::MIN as f64, i32::MAX as f64) as i32;
            let e = CGEventCreateScrollWheelEvent2(std::ptr::null(), UNIT_PIXEL, 1, px, 0, 0);
            if e.is_null() { return Err("the scroll could not be made".into()); }
            CGEventSetLocation(e, at);
            CGEventPost(HID_EVENT_TAP, e);
            CFRelease(e);
        }
        Ok(())
    }
}

/// Page: move the pointer to (x, y) and scroll there by dy points (dy 0: only move it, to put it back at the end).
/// Needs Accessibility; without it nothing is posted and the answer says so.
#[tauri::command]
pub async fn page_scroll(x: f64, y: f64, dy: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if dy != 0.0 && !crate::permit::trusted() {
            return Err("Sol needs Accessibility to scroll (System Settings → Privacy & Security → Accessibility)".into());
        }
        if !x.is_finite() || !y.is_finite() || !dy.is_finite() { return Err("a point that is not a number".into()); }
        tauri::async_runtime::spawn_blocking(move || wheel::scroll(x, y, dy)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (x, y, dy);
        Err("scrolling another window needs the Mac".into())
    }
}
