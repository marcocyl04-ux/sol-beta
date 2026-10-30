mod clean;
mod dictate;
mod eye;
mod feedback;
mod grab;
mod hot;
mod link;
mod mute;
mod permit;
mod root;
mod thing;
mod vibe;
mod welcome;

use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const ENGINE_PORT: u16 = 7777;

fn engine_is_up() -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{ENGINE_PORT}").parse().unwrap(),
        Duration::from_millis(300),
    )
    .is_ok()
}

/// Start the engine (a Node process) if nothing answers on its port: the root's sol/engine/dist/index.js (root.rs),
/// with the node the root resolution found and a PATH that holds it. No root: nothing to start (the welcome page).
/// On a Mac with the install's launchd job the engine is there before the face, and this does nothing.
pub fn start_engine_if_needed(app: &AppHandle) {
    if engine_is_up() {
        return;
    }
    let Some(root) = root::root(app) else { return };
    *SPAWNED.lock().unwrap() = Some(std::time::Instant::now());
    let eng = root.join("sol").join("engine");
    let _ = Command::new(root::node())
        .arg(eng.join("dist").join("index.js"))
        .current_dir(&eng)
        .env("PATH", root::path_env())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

/// When this app last started the engine itself (None: it never had to).
static SPAWNED: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
const START_GRACE: Duration = Duration::from_secs(20);

/// The engine's lifecycle as the app sees it, for a page whose socket is down (creature/state.ts): up when the port
/// answers; starting for 20 s after this app spawned it; failed after that; down when nobody is starting it.
#[tauri::command]
fn engine_phase() -> &'static str {
    if engine_is_up() { return "up"; }
    match *SPAWNED.lock().unwrap() {
        Some(t) if t.elapsed() < START_GRACE => "starting",
        Some(_) => "failed",
        None => "down",
    }
}

/// The notch's click on an unplugged creature: start the engine unless it is up or already starting. Returns the phase.
#[tauri::command]
fn engine_start(app: AppHandle) -> &'static str {
    if engine_phase() != "starting" {
        start_engine_if_needed(&app);
    }
    engine_phase()
}

/// Seconds since the last key or mouse event anywhere on the Mac (Quartz). Keeps growing while the screen is locked
/// or the Mac sleeps, so those count as Away. None when the source is not there: the engine then never says Away.
#[tauri::command]
fn idle_seconds() -> Option<f64> {
    system_idle()
}
#[cfg(target_os = "macos")]
fn system_idle() -> Option<f64> {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    }
    // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = !0
    let s = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
    if s.is_finite() && s >= 0.0 { Some(s) } else { None }
}
#[cfg(not(target_os = "macos"))]
fn system_idle() -> Option<f64> { None }

fn show_main(app: &AppHandle) {
    // the window, not the "webview window": with a thing open inside (thing.rs) it holds more than one web view, and
    // get_webview_window then answers None
    if let Some(w) = app.get_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// Sol outside the window, in two forms of the same page (notch.html), one window each.
//   "notch"  on the MacBook's own screen: the tab sits over the camera cutout and continues it as a chin, Dynamic
//            Island style; on hover it grows out of the cutout, over the menu bar.
//   "island" on a monitor, which has no cutout: a capsule floats in the empty middle of the menu bar and drops out of
//            it on hover.
// Screens are read from AppKit (NSScreen: the cutout's exact rectangle, the menu bar's height) and re-read every two
// seconds, so plugging a monitor in or out moves the forms to the right screens.
// Each window always has its open size (a resize mid-motion jerked the slab sideways for a frame and clipped the first
// frames of the opening); the page draws the closed shape inside it. Closed, the window ignores the mouse so the menu
// bar under its transparent part stays clickable, and the app's own poll (poll_hover) decides when the mouse is over
// the closed shape; opening, the page asks for the mouse back (notch_expand).
// One exception grows it (#253): while something hangs under the open card (Anticipate's card, the
// questions' taller card, the eye's private row) the page asks for room (notch_expand `room`) and the window grows
// downward by that much, from its top edge, so nothing moves sideways; it is given back when the thing goes.
// A second one widens it (Anticipate sitting 2): while a talk is on, the drawer under the card is wider than the card,
// so the page asks for `wide` once at the talk's start and the window grows by that much, half to each side, centred
// on the cutout as before. It is asked once, not when the drawer opens, so the frame never changes under a moving slab.
#[derive(Clone, Copy, PartialEq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum Form { Notch, Island }

/// The notch's closed shape on the MacBook (Notch.tsx draws it; frame() sizes the window). Picked by the first word
/// of a "notch-shape" file next to the notch-off flag, wings when there is none (Marco's pick, 2026-10-14).
#[derive(Clone, Copy, PartialEq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum Shape { Tab, Bar, Lens, Wings }
impl Shape {
    fn parse(s: &str) -> Shape {
        match s.trim() { "bar" => Shape::Bar, "lens" => Shape::Lens, "tab" => Shape::Tab, _ => Shape::Wings }
    }
    /// (extra width beyond the cutout, chin under the cutout) while closed; the same numbers as Notch.tsx
    fn closed(self) -> (f64, f64) {
        match self { Shape::Tab => (0.0, CHIN), Shape::Bar => (140.0, 26.0), Shape::Lens => (84.0, CHIN), Shape::Wings => (88.0, 0.0) }
    }
    /// the open card (width, height under the cutout); the same numbers as Notch.tsx
    fn open(self) -> (f64, f64) {
        match self { Shape::Wings => (440.0, 120.0), _ => (OPEN_W, OPEN_H) }
    }
}

#[derive(Clone, Copy, PartialEq, Debug, serde::Serialize)]
struct Spot {
    form: Form,
    shape: Shape,
    cx: f64,      // centre x (logical, tauri coordinates: from the left of the primary screen)
    top: f64,     // the screen's top edge (logical, from the top of the primary screen)
    bar: f64,     // menu bar height on that screen
    notch_w: f64, // the cutout's width (0 on a monitor)
    notch_h: f64, // the cutout's height (0 on a monitor)
    sh: f64,      // the screen's height: the room under the card is capped by it (max_room)
}

#[derive(Default)]
struct Outside {
    spots: std::collections::HashMap<String, Option<Spot>>,
    ph: f64,                                    // the primary screen's height: AppKit's y runs up from its bottom
    open: std::collections::HashSet<String>,    // windows at their open size
    hover: std::collections::HashSet<String>,   // windows the mouse is over
    keys: std::collections::HashSet<String>,    // windows whose open card has buttons (notch_expand keys)
    keys_on: bool,                              // Return and Escape are registered as Sol's (poll_hover keeps it true to the moment)
    opened_at: std::collections::HashMap<String, std::time::Instant>,   // when each form last opened (notch_expand)
    room: std::collections::HashMap<String, f64>,   // extra height under the open card (notch_expand room): a card dropped under it
    wide: std::collections::HashMap<String, f64>,   // extra width of the open window (notch_expand wide): a talk's drawer
    last_mouse: (f64, f64),                     // where the mouse was on the last tick
    regions: std::collections::HashMap<String, Vec<Rect>>,   // the half moon: the parts of an open window that are Sol's (notch_regions)
    ignoring: std::collections::HashMap<String, bool>,       // what set_ignore_cursor_events was last told, per window
    moved_over: Option<std::time::Instant>,     // the mouse last moved over a form's rectangle
}
// the keys come to Sol only for a pointer that is moving over the card: a movement over it in the last KEYS_MOVED, and
// the card open for KEYS_DWELL. A card that opens under a resting pointer (a peek, the mouse parked at the top while
// Marco types in a terminal) never takes Return. Once on, they stay while the pointer stays on a card with buttons.
const KEYS_MOVED: std::time::Duration = std::time::Duration::from_millis(2000);
const KEYS_DWELL: std::time::Duration = std::time::Duration::from_millis(300);
#[derive(Default)]
struct Spots(std::sync::Mutex<Outside>);
/// A rectangle of the page that is Sol's, in window coordinates (CSS px from the window's top left): the slab or the
/// moon, a floating card, a name bud (notch_regions).
#[derive(Clone, Copy, PartialEq, Debug, serde::Deserialize)]
struct Rect { x: f64, y: f64, w: f64, h: f64 }

const CHIN: f64 = 30.0;     // the tab under the cutout, closed: the creature lives there
const ISLAND_W: f64 = 150.0; // the capsule in the menu bar, closed
// the open tab is 360 x 84 below its offset (notch/Notch.tsx); the window adds 36 x 16 so the spring can overshoot
const OPEN_W: f64 = 360.0;
const OPEN_H: f64 = 84.0;

#[cfg(target_os = "macos")]
fn screens(shape: Shape) -> (f64, Vec<Spot>) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    let Some(mtm) = MainThreadMarker::new() else { return (0.0, vec![]) };
    let all = NSScreen::screens(mtm);
    let Some(primary) = all.iter().next() else { return (0.0, vec![]) };
    let ph = primary.frame().size.height;
    let mut out = vec![];
    for s in all.iter() {
        let f = s.frame();
        let v = s.visibleFrame();
        let top = ph - (f.origin.y + f.size.height); // AppKit measures from the bottom of the primary screen; tauri from the top
        let bar = ((f.origin.y + f.size.height) - (v.origin.y + v.size.height)).max(0.0);
        let inset = s.safeAreaInsets().top;
        if inset > 0.0 {
            let l = s.auxiliaryTopLeftArea();
            let r = s.auxiliaryTopRightArea();
            let x0 = l.origin.x + l.size.width;
            let x1 = r.origin.x;
            out.push(Spot { form: Form::Notch, shape, cx: (x0 + x1) / 2.0, top, bar, notch_w: x1 - x0, notch_h: inset, sh: f.size.height });
        } else {
            out.push(Spot { form: Form::Island, shape, cx: f.origin.x + f.size.width / 2.0, top, bar, notch_w: 0.0, notch_h: 0.0, sh: f.size.height });
        }
    }
    (ph, out)
}
#[cfg(not(target_os = "macos"))]
fn screens(_shape: Shape) -> (f64, Vec<Spot>) { (0.0, vec![]) }

/// Where the mouse is, in tauri's logical coordinates (from the top left of the primary screen). Main thread only.
#[cfg(target_os = "macos")]
fn mouse(ph: f64) -> (f64, f64) {
    let p = objc2_app_kit::NSEvent::mouseLocation();
    (p.x, ph - p.y)
}
#[cfg(not(target_os = "macos"))]
fn mouse(_ph: f64) -> (f64, f64) { (-1.0, -1.0) }

/// Above the menu bar (NSStatusWindowLevel), on every space, over full-screen apps too. Main thread only.
#[cfg(target_os = "macos")]
pub(crate) fn raise(w: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    if let Ok(p) = w.ns_window() {
        let ns: &NSWindow = unsafe { &*(p as *const NSWindow) };
        ns.setLevel(objc2_app_kit::NSStatusWindowLevel);
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

/// WebKit tracks the mouse for the page (hover, pointerenter: a disc lifting, a name budding) only while its window is
/// key (its tracking area is NSTrackingActiveInKeyWindow), and the notch window never is: on the real notch no name ever
/// budded from a disc, while a press worked (2026-10-26). The same tracking areas, owner and rect kept, are re-added as
/// ActiveAlways, and the window told to accept mouse-moved events. WebKit rebuilds its areas now and then (a resize), so
/// poll_hover runs this again each time the mouse comes onto a window. Main thread only.
#[cfg(target_os = "macos")]
fn wake_hover(w: &tauri::WebviewWindow) {
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSTrackingArea, NSTrackingAreaOptions, NSView, NSWindow};
    fn fix(v: &NSView) {
        for a in v.trackingAreas().iter() {
            let o = a.options();
            if !o.contains(NSTrackingAreaOptions::ActiveInKeyWindow) || !o.contains(NSTrackingAreaOptions::MouseMoved) { continue; }
            let o2 = (o - NSTrackingAreaOptions::ActiveInKeyWindow) | NSTrackingAreaOptions::ActiveAlways;
            let owner = a.owner();
            let info = a.userInfo();
            let n = unsafe { NSTrackingArea::initWithRect_options_owner_userInfo(NSTrackingArea::alloc(), a.rect(), o2, owner.as_deref(), info.as_deref()) };
            v.removeTrackingArea(&a);
            v.addTrackingArea(&n);
        }
        for s in v.subviews().iter() { fix(&s); }
    }
    let Ok(p) = w.ns_window() else { return };
    let ns: &NSWindow = unsafe { &*(p as *const NSWindow) };
    ns.setAcceptsMouseMovedEvents(true);
    if let Some(cv) = ns.contentView() { fix(&cv); }
}
#[cfg(not(target_os = "macos"))]
fn wake_hover(_w: &tauri::WebviewWindow) {}

/// The window's rectangle (x, y, w, h) for a spot, closed or open. `room`: extra height under the open card, asked for
/// by the page while something hangs below it (Anticipate's card, the questions' taller card, the eye's private row);
/// the window grows downward only, so the slab never moves sideways. `wide`: extra width while a talk's drawer may
/// show, half on each side, so the centre stays on the cutout. Closed, both are ignored.
fn frame(s: &Spot, expanded: bool, room: f64, wide: f64) -> (f64, f64, f64, f64) {
    let room = if expanded { room } else { 0.0 };
    let wide = if expanded { wide } else { 0.0 };
    let (ww, wh) = match (s.form, expanded) {
        (Form::Notch, false) => { let (extra, chin) = s.shape.closed(); (s.notch_w + extra, s.notch_h + chin) }
        (Form::Notch, true) => { let (w, h) = s.shape.open(); (w + 36.0, s.notch_h + h + 16.0) }
        (Form::Island, false) => (ISLAND_W, s.bar),
        (Form::Island, true) => (OPEN_W + 36.0, s.bar + OPEN_H + 16.0),
    };
    let ww = ww + wide;
    (s.cx - ww / 2.0, s.top, ww, wh + room)
}

fn place(w: &tauri::WebviewWindow, s: &Spot, room: f64, wide: f64) {
    let (x, y, ww, wh) = frame(s, true, room, wide);
    let _ = w.set_size(LogicalSize::new(ww, wh));
    let _ = w.set_position(LogicalPosition::new(x, y));
}

/// The webview's own hover tracking sleeps while the window is not key (and the closed window ignores the mouse), so
/// the app watches the mouse itself: entering the closed shape's rectangle, or leaving the open card's, sends the page
/// "notch-hover" true/false. Main thread, every 16 ms (a display frame).
///
/// Notch buttons (#6): the same tick decides whether Return and Escape are Sol's. They are, as global shortcuts, only
/// while a form is hovered AND open AND its card has buttons (hover && open && keys, per form), and they come on only
/// for fresh movement (KEYS_MOVED, KEYS_DWELL); every tick recomputes it and registers or unregisters the two to match,
/// so a key can never stay Sol's past one tick, whatever the page does. The notch window never takes focus, so this is
/// the only way the keys reach it. Each change is told to the forms as "notch-keys" (the page's ⏎ mark).
fn poll_hover(app: &AppHandle) {
    let st = app.state::<Spots>();
    let mut o = st.0.lock().unwrap();
    if o.ph > 0.0 {
        let (mx, my) = mouse(o.ph);
        let moved = (mx, my) != o.last_mouse;
        o.last_mouse = (mx, my);
        for label in ["notch", "island"] {
            let Some(Some(s)) = o.spots.get(label).copied() else { continue };
            let open = o.open.contains(label);
            let (x, y, w, h) = frame(&s, open, o.room.get(label).copied().unwrap_or(0.0), o.wide.get(label).copied().unwrap_or(0.0));
            // the half moon: a window that sent its regions is Sol's only over them, open or closed; the rest of its frame
            // lets the mouse through to the menu bar and the desktop (each tick, so a card dragged away frees its old
            // place). The regions are in window coordinates, and the window's frame is always the placed one.
            let regions = o.regions.get(label).filter(|r| !r.is_empty());
            let (fx, fy, _, _) = frame(&s, true, o.room.get(label).copied().unwrap_or(0.0), o.wide.get(label).copied().unwrap_or(0.0));
            let inside = match regions {
                Some(rs) => rs.iter().any(|r| mx >= fx + r.x && mx <= fx + r.x + r.w && my >= fy + r.y && my <= fy + r.y + r.h),
                None => mx >= x && mx <= x + w && my >= y && my <= y + h,
            };
            if regions.is_some() && o.ignoring.get(label).copied() != Some(!inside) {
                if let Some(win) = app.get_webview_window(label) { let _ = win.set_ignore_cursor_events(!inside); }
                o.ignoring.insert(label.to_string(), !inside);
            }
            if inside && moved { o.moved_over = Some(std::time::Instant::now()); }
            if inside == o.hover.contains(label) { continue; }
            if inside { o.hover.insert(label.to_string()); } else { o.hover.remove(label); }
            if inside { if let Some(win) = app.get_webview_window(label) { wake_hover(&win); } }   // the page's own hover, see wake_hover
            let _ = app.emit_to(label, "notch-hover", inside);   // this window only (emit would reach both forms)
        }
    }
    let can = |o: &Outside, l: &str| o.hover.contains(l) && o.open.contains(l) && o.keys.contains(l);
    let fresh = |o: &Outside, l: &str| o.moved_over.is_some_and(|t| t.elapsed() < KEYS_MOVED)
        && o.opened_at.get(l).is_some_and(|t| t.elapsed() >= KEYS_DWELL);
    let want = o.ph > 0.0 && ["notch", "island"].iter().any(|l| can(&o, l) && (o.keys_on || fresh(&o, l)));
    if want == o.keys_on { return; }
    o.keys_on = want;
    let who = ["notch", "island"].iter().find(|l| o.hover.contains(**l)).copied().unwrap_or("-");
    drop(o);
    for label in ["notch", "island"] { let _ = app.emit_to(label, "notch-keys", want && label == who); }
    let gs = app.global_shortcut();
    let mut errs = Vec::new();
    for k in [Code::Enter, Code::Escape] {
        let sc = Shortcut::new(None, k);
        let r = if want { gs.register(sc) } else { gs.unregister(sc) };
        if let Err(e) = r { errs.push(format!("{k:?}: {e}")); }
    }
    log_line(app, &format!("[app] keys {} (Return, Escape) hover={who}{}", if want { "registered" } else { "unregistered" },
        if errs.is_empty() { String::new() } else { format!(" errors: {}", errs.join("; ")) }));
}

/// Read the screens; give each form its window (or hide it when there is no screen of that kind, or the notch is off).
/// Also: a "notch-peek" file next to the notch-off flag opens both forms once (and is removed), a way to look without the mouse.
fn place_all(app: &AppHandle) {
    if let Some(f) = notch_flag(app).map(|f| f.with_file_name("notch-peek")) {
        if f.exists() {
            let _ = std::fs::remove_file(&f);
            for label in ["notch", "island"] { let _ = app.emit_to(label, "notch-peek", ()); }
        }
    }
    let shape = notch_flag(app).map(|f| f.with_file_name("notch-shape")).and_then(|f| std::fs::read_to_string(f).ok()).map(|t| Shape::parse(&t)).unwrap_or(Shape::Wings);
    let (ph, found) = screens(shape);
    let on = !notch_flag(app).map(|f| f.exists()).unwrap_or(false);
    let st = app.state::<Spots>();
    let mut o = st.0.lock().unwrap();
    o.ph = ph;
    for (label, form) in [("notch", Form::Notch), ("island", Form::Island)] {
        let Some(w) = app.get_webview_window(label) else { continue };
        let spot = found.iter().find(|s| s.form == form).copied();
        let want = on && spot.is_some();
        let shown = w.is_visible().unwrap_or(false);
        if o.spots.get(label).copied().flatten() == spot && shown == want {
            continue;
        }
        o.spots.insert(label.to_string(), spot);
        o.open.remove(label);
        o.room.remove(label);
        o.wide.remove(label);
        o.regions.remove(label);
        o.ignoring.remove(label);
        match spot {
            Some(s) if on => {
                place(&w, &s, 0.0, 0.0);
                let _ = w.set_ignore_cursor_events(true);
                let _ = app.emit_to(label, "notch-geometry", s);
                let _ = w.show();
            }
            _ => { let _ = w.hide(); }
        }
    }
}

/// The page opened or closed its card; `keys`: the open card has buttons (Notch buttons #6), so while the mouse is on it
/// Return and Escape may be Sol's (poll_hover decides, every tick). A page from before #6 sends no `keys`: never.
/// `room` (#253): the height the page needs under the open card, in px (0 gives it back); the
/// window grows downward by it and the hover rectangle with it, so the mouse on a card below still counts as on the
/// notch. No `room` leaves it as it is; closing always gives it back. Capped by max_room.
/// `wide` (Anticipate sitting 2): extra width in px for a talk's drawer, the same way: the window widens by it, centred,
/// and the hover rectangle with it; no `wide` keeps it, 0 or closing gives it back. Capped at MAX_WIDE.
#[tauri::command]
fn notch_expand(app: AppHandle, window: tauri::Window, expanded: bool, keys: Option<bool>, room: Option<f64>, wide: Option<f64>) {
    let label = window.label().to_string();
    let st = app.state::<Spots>();
    let mut o = st.0.lock().unwrap();
    if expanded && o.open.insert(label.clone()) { o.opened_at.insert(label.clone(), std::time::Instant::now()); }
    if !expanded { o.open.remove(&label); }   // the regions stay: a moon page keeps the window big while closed and sends the slab's
    o.ignoring.insert(label.clone(), !expanded);   // set below; poll_hover narrows it to the regions on its next tick
    if expanded && keys.unwrap_or(false) { o.keys.insert(label.clone()); } else { o.keys.remove(&label); }
    // the room under the card: a change resizes the window from its top edge down (x, y and width stay)
    let spot = o.spots.get(&label).copied().flatten();
    let cap = spot.map(|s| max_room(&s)).unwrap_or(MIN_ROOM_CAP);
    let was = o.room.get(&label).copied().unwrap_or(0.0);
    // (a moon page sends room and wide while closed too, so the window never resizes at the first frame of an open or a
    // close; a page from before sends 0 when closed, as ever)
    let now = room.map(|r| if r.is_finite() { r.round().clamp(0.0, cap) } else { 0.0 }).unwrap_or(if expanded { was } else { 0.0 });
    if now > 0.0 { o.room.insert(label.clone(), now); } else { o.room.remove(&label); }
    // the width beside it: a change widens the window on both sides, so the card stays centred on the cutout
    let was_w = o.wide.get(&label).copied().unwrap_or(0.0);
    let now_w = wide.map(|v| if v.is_finite() { v.round().clamp(0.0, MAX_WIDE) } else { 0.0 }).unwrap_or(if expanded { was_w } else { 0.0 });
    if now_w > 0.0 { o.wide.insert(label.clone(), now_w); } else { o.wide.remove(&label); }
    drop(o);
    if let Some(w) = app.get_webview_window(&label) {
        if now != was || now_w != was_w { if let Some(s) = spot { place(&w, &s, now, now_w); } }
        let _ = w.set_ignore_cursor_events(!expanded);
    }
}
/// The most a page may ask for under its card (a card, the private row, a talk's drawer): the whole window no taller
/// than 45% of the screen it is on, so the drawer never covers more than the top of the screen. Never less than the
/// fixed 360 of sitting 1, so a short screen (on a MacBook 45% minus the card is below it) keeps what it had.
fn max_room(s: &Spot) -> f64 {
    let (_, _, _, card) = frame(s, true, 0.0, 0.0);
    (0.45 * s.sh - card).max(MIN_ROOM_CAP)
}
const MIN_ROOM_CAP: f64 = 360.0;
/// the most a page may widen the open window by (the drawer is 520 px; the open card is 360 to 440): short of any screen
const MAX_WIDE: f64 = 800.0;

/// The half moon (#254): the open window is 760 x 460 while the moon or its cards
/// are out, far bigger than what is Sol's in it. The page sends the rectangles that are (the slab or the moon, every
/// card, every name bud; window coordinates) on every layout change and on drag frames; poll_hover then tests the mouse
/// against them instead of the whole frame and lets the mouse through everywhere else (set_ignore_cursor_events). An
/// empty list, or a closed window, is today's behaviour: the whole frame. A page from before the moon never sends any.
#[tauri::command]
fn notch_regions(app: AppHandle, window: tauri::Window, rects: Vec<Rect>) {
    let label = window.label().to_string();
    let st = app.state::<Spots>();
    let mut o = st.0.lock().unwrap();
    let rects: Vec<Rect> = rects.into_iter().filter(|r| [r.x, r.y, r.w, r.h].iter().all(|v| v.is_finite()) && r.w > 0.0 && r.h > 0.0).take(64).collect();
    if rects.is_empty() {
        o.regions.remove(&label);
        // back to the whole frame taking the mouse, as notch_expand left it
        if o.ignoring.get(&label).copied() != Some(false) {
            o.ignoring.insert(label.clone(), false);
            drop(o);
            if let Some(w) = app.get_webview_window(&label) { let _ = w.set_ignore_cursor_events(false); }
        }
        return;
    }
    o.regions.insert(label, rects);
}

#[tauri::command]
fn notch_geometry(app: AppHandle, window: tauri::Window) -> Option<Spot> {
    app.state::<Spots>().0.lock().unwrap().spots.get(window.label()).copied().flatten()
}

fn notch_flag(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("notch-off"))
}

fn set_notch_visible(app: &AppHandle, on: bool) {
    if let Some(f) = notch_flag(app) {
        if on {
            let _ = std::fs::remove_file(f);
        } else {
            if let Some(d) = f.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            let _ = std::fs::write(f, "");
        }
    }
    place_all(app);
}

/// A line from a page into ~/Library/Logs/<bundle>/face.log: the only way to see inside the notch and the island.
#[tauri::command]
fn face_log(app: AppHandle, line: String) { log_line(&app, &line); }
pub(crate) fn log_line(app: &AppHandle, line: &str) {
    use std::io::Write;
    let Ok(d) = app.path().app_log_dir() else { return };
    let _ = std::fs::create_dir_all(&d);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(d.join("face.log")) {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let _ = writeln!(f, "{t} {line}");
    }
}

/// Mutable mode: Settings' engine drawer flips the face between the bundled pages and Vite's (hot.rs).
#[tauri::command]
fn face_mode(app: AppHandle, hot: bool) -> hot::FaceState {
    hot::set(&app, hot);
    let h = app.clone();
    let _ = app.run_on_main_thread(move || hot_check(&h));
    hot::state(&app)
}

#[tauri::command]
fn face_state(app: AppHandle) -> hot::FaceState {
    hot::state(&app)
}

/// hot::check, then forget what was kept about the notch pages it moved: a fresh page starts closed.
fn hot_check(app: &AppHandle) {
    if hot::check(app) {
        let st = app.state::<Spots>();
        let mut o = st.0.lock().unwrap();
        for label in ["notch", "island"] {
            o.open.remove(label);
            o.hover.remove(label);
            o.regions.remove(label);
            o.ignoring.remove(label);
            let grown = o.room.remove(label).is_some() | o.wide.remove(label).is_some();   // a card hung under it, or a drawer widened it: back to the open card's size
            let spot = o.spots.get(label).copied().flatten();
            if let Some(w) = app.get_webview_window(label) {
                if let (true, Some(s)) = (grown, spot) { place(&w, &s, 0.0, 0.0); }
                let _ = w.set_ignore_cursor_events(true);
            }
        }
    }
}

#[tauri::command]
fn engine_port() -> u16 {
    ENGINE_PORT
}

/// The dictation fallback key (#110): Ctrl+Space, registered only while Fn cannot be watched (dictate.rs).
fn is_dictate_key(s: &Shortcut) -> bool {
    s.matches(Modifiers::CONTROL, Code::Space)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())   // sol:// links (#327, link.rs)
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // the dictation fallback key (#110), while Accessibility is not granted: down opens the notch's mic,
                    // up sends the last clip and says which app is in front
                    if is_dictate_key(shortcut) {
                        dictate::emit(app, event.state() == ShortcutState::Pressed);
                        return;
                    }
                    // Return's key-up goes to both forms: one held Return answers one ask, the next needs the key-up
                    if event.state() == ShortcutState::Released && shortcut.matches(Modifiers::empty(), Code::Enter) {
                        for label in ["notch", "island"] { let _ = app.emit_to(label, "notch-key", serde_json::json!({ "key": "Return", "up": true })); }
                        return;
                    }
                    if event.state() != ShortcutState::Pressed { return; }
                    // Return / Escape are registered only while a card with buttons is open under the mouse
                    // (poll_hover): the key goes to the hovered form alone, as "notch-key"
                    let key = if shortcut.matches(Modifiers::empty(), Code::Enter) { Some("Return") }
                        else if shortcut.matches(Modifiers::empty(), Code::Escape) { Some("Escape") } else { None };
                    if let Some(key) = key {
                        let st = app.state::<Spots>();
                        let o = st.0.lock().unwrap();
                        let to = ["notch", "island"].into_iter().find(|l| o.hover.contains(*l) && o.open.contains(*l) && o.keys.contains(*l));
                        drop(o);
                        if let Some(label) = to {
                            log_line(app, &format!("[app] key {key} -> {label}"));
                            let _ = app.emit_to(label, "notch-key", serde_json::json!({ "key": key }));
                        }
                        return;
                    }
                    let _ = app.emit_to("notch", "notch-toggle", ());
                })
                .build(),
        )
        .manage(Spots::default())
        .manage(hot::Hot::default())
        .manage(thing::Tabs::default())
        .manage(link::Waiting::default())
        .invoke_handler(tauri::generate_handler![engine_port, engine_phase, engine_start, idle_seconds, notch_expand, notch_regions, notch_geometry, face_log, face_mode, face_state,
            welcome::install_run, welcome::claude_login, welcome::claude_status, welcome::codex_login, welcome::codex_status, welcome::claude_install, welcome::welcome_done, dictate::type_text, grab::grab_sheet, grab::page_scroll, eye::eye_set, eye::eye_get,
            clean::clean_open, clean::clean_set, clean::clean_close, clean::clean_get,
            permit::permit_state, permit::permit_open, permit::permit_back, mute::call_mute,
            vibe::vibe_start, vibe::vibe_stop, vibe::vibe_glow,
            thing::thing_open, thing::thing_show, thing::thing_bounds, thing::thing_close, thing::thing_nav, thing::thing_outside, thing::sites_sign_out, thing::sites_clear, link::sol_url_take])
        .setup(|app| {
            eye::load(app.handle());        // the eye as it was left, before any window is shown (eye.rs)
            eye::apply_all(app.handle());   // the main window was made before setup
            start_engine_if_needed(app.handle());
            link::init(app.handle());   // the link that launched Sol, then every sol:// link (#327)

            let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let notch_on = !notch_flag(app.handle()).map(|f| f.exists()).unwrap_or(false);
            let notch_item = MenuItem::with_id(
                app,
                "notch",
                if notch_on { "Hide the notch" } else { "Show the notch" },
                true,
                None::<&str>,
            )?;
            hot::init(app.handle());
            grab::warm(app.handle());
            // no checkout to run (a downloaded app, before its install): the face on its first run, which installs (#169, #134)
            if root::root(app.handle()).is_none() { if let Err(e) = welcome::show_page(app.handle(), "/?firstrun=1") { eprintln!("first run: {e}"); } }
            let face_item = MenuItem::with_id(app, "face", hot::tray_text(hot::wanted(app.handle())), true, None::<&str>)?;
            app.state::<hot::Hot>().0.lock().unwrap().tray = Some(face_item.clone());
            // a beta tester says what broke, no GitHub account needed (#294, feedback.rs)
            let tell = MenuItem::with_id(app, "tell", "Tell us…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &notch_item, &face_item, &tell, &quit])?;

            let notch_item_handle = notch_item.clone();
            // one menu bar icon, built here (a trayIcon in tauri.conf.json would add a second, menu-less one)
            TrayIconBuilder::with_id("tray")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "notch" => {
                        let show = notch_flag(app).map(|f| f.exists()).unwrap_or(false); // off now → show
                        set_notch_visible(app, show);
                        let _ = notch_item_handle.set_text(if show { "Hide the notch" } else { "Show the notch" });
                    }
                    "face" => {
                        hot::set(app, !hot::wanted(app));
                        hot_check(app);
                    }
                    "tell" => feedback::open(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // the two windows: borderless, transparent, above the menu bar, on every desktop, never taking focus
            for label in ["notch", "island"] {
                let w = WebviewWindowBuilder::new(app, label, WebviewUrl::App("notch.html".into()))
                    .title(if label == "notch" { "Sol notch" } else { "Sol island" })
                    .inner_size(ISLAND_W, CHIN)
                    .decorations(false)
                    .transparent(true)
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible_on_all_workspaces(true)
                    .focused(false)
                    .focusable(true)
                    .resizable(false)
                    .accept_first_mouse(true)
                    .disable_drag_drop_handler()
                    .content_protected(eye::invisible())   // born with the eye: hidden from a share while it is closed
                    .visible(false)
                    .build()?;
                raise(&w);
                wake_hover(&w);
            }
            place_all(app.handle());
            // screens come and go: re-read them every two seconds (place_all only touches what changed)
            let h = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(2));
                let h2 = h.clone();
                let _ = h.run_on_main_thread(move || { place_all(&h2); hot_check(&h2); });
            });
            let h = app.handle().clone();
            std::thread::spawn(move || loop {
                // 16 ms, a display frame: at 30 the moon began up to two frames after the mouse arrived (Marco, 2026-10-26:
                // "high latency"); the tick is one mouse read and a few compares
                std::thread::sleep(Duration::from_millis(16));
                let h2 = h.clone();
                let _ = h.run_on_main_thread(move || poll_hover(&h2));
            });

            // Cmd+Shift+Space toggles the call from anywhere
            let combo = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
            if let Err(e) = app.global_shortcut().register(combo) {
                eprintln!("global shortcut not registered: {e}");
            }
            // the dictation hold-key (#110): Fn, watched as a modifier, once Accessibility is granted (the monitor
            // sees nothing without it); until then Ctrl+Space, which clashes with macOS's input-source switch
            if permit::trusted() && dictate::watch_fn(app.handle()) {
                log_line(app.handle(), "[app] dictate key: Fn (hold)");
            } else {
                match app.global_shortcut().register(Shortcut::new(Some(Modifiers::CONTROL), Code::Space)) {
                    Ok(()) => log_line(app.handle(), "[app] dictate key: Ctrl+Space; Fn takes over at the next launch once Accessibility is granted"),
                    Err(e) => log_line(app.handle(), &format!("[app] dictate key: Ctrl+Space refused ({e}); no dictation key until Accessibility is granted and Sol restarts")),
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it; the menu bar icon stays, the engine keeps running.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // A click on the Dock icon (or "open" again) shows the hidden window back.
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            // the Vite Sol started goes with it
            if let tauri::RunEvent::Exit = event {
                hot::stop_vite(app);
            }
        });
}
