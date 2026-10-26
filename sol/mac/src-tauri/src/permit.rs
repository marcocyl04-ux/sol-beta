// The grab sheet's permissions guide (Permit.tsx): what the sheet asks so its creature can walk Marco, and anyone else,
// through a macOS permission instead of printing a sentence. Three commands:
//
//   permit_state → { accessibility }: is Sol trusted for Accessibility right now (AXIsProcessTrusted, below). The
//   sheet asks every 800 ms while the card shows and goes on by itself the moment it turns true.
//   permit_open { which }: "accessibility" first asks macOS for its own prompt (AXIsProcessTrustedWithOptions), which
//   also puts this very binary in the list; then, for either, opens System Settings at the right pane.
//   permit_back: the card is done (granted, Not now, Esc): the sheet goes back above everything and, if permit_open
//   opened System Settings, Settings is hidden again.
//
// Why the prompt first: Sol.app is signed ad hoc, so every rebuild is a new app to macOS. The old row in the list stays
// switched on but no longer counts; the prompt adds the current binary so switching it off and on again takes.
// Why the sheet's level changes: the sheet sits above every window (grab.rs raise), so System Settings would open
// underneath it where nobody can click it. permit_open puts the sheet at the normal level first, so Settings comes in
// front; permit_back raises it again. Settings is hidden at the end because Page's scroll turns the wheel at the
// window's centre, and Settings must not be the window under it then.
// Screen Recording for grabs is the engine's (node takes the pictures), so there is no state for it here: the sheet sees
// a blank picture and the card says "find node in the list". The clean screen (clean.rs) is the one thing Sol itself
// films; it asks with screen_trusted / ask_screen / open_pane at the end of this file.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

/// System Settings was opened by the guide (so permit_back may hide it)
static OPENED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
pub struct PermitState {
    pub accessibility: bool,
}

#[tauri::command]
pub fn permit_state() -> PermitState {
    PermitState { accessibility: trusted() }
}

/// Main thread: the sheet at the normal window level (low) or back above everything (high).
fn level(app: &AppHandle, high: bool) -> Result<(), String> {
    let Some(w) = app.get_webview_window(crate::grab::LABEL) else { return Ok(()) };
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        if high { crate::grab::raise(&w); } else { lower(&w); }
        if high { let _ = w.set_focus(); }
        let _ = tx.send(());
    }).map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn lower(w: &tauri::WebviewWindow) {
    use objc2_app_kit::NSWindow;
    if let Ok(p) = w.ns_window() {
        let ns: &NSWindow = unsafe { &*(p as *const NSWindow) };
        ns.setLevel(objc2_app_kit::NSNormalWindowLevel);
    }
}
#[cfg(not(target_os = "macos"))]
fn lower(_w: &tauri::WebviewWindow) {}

#[tauri::command]
pub async fn permit_open(app: AppHandle, which: String) -> Result<(), String> {
    let pane = match which.as_str() {
        "accessibility" => "Privacy_Accessibility",
        "screen" => "Privacy_ScreenCapture",
        other => return Err(format!("Sol does not know the permission \"{other}\"")),
    };
    #[cfg(target_os = "macos")]
    {
        level(&app, false)?;
        if which == "accessibility" && !trusted() {
            ask_trust();
        }
        let url = format!("x-apple.systempreferences:com.apple.preference.security?{pane}");
        let ok = std::process::Command::new("/usr/bin/open").arg(&url).status()
            .map_err(|e| format!("System Settings did not open: {e}"))?;
        if !ok.success() { return Err("System Settings did not open".into()); }
        OPENED.store(true, Ordering::SeqCst);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, pane);
        Err("this needs the Mac".into())
    }
}

#[tauri::command]
pub async fn permit_back(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if OPENED.swap(false, Ordering::SeqCst) {
        use objc2_app_kit::NSRunningApplication;
        use objc2_foundation::NSString;
        let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str("com.apple.systempreferences"));
        for a in apps.iter() { a.hide(); }
    }
    level(&app, true)
}

// ---- Accessibility: the check and macOS's own prompt (raw FFI, no crate for these few calls) ----
/// Accessibility granted: Sol may post events into the system (Page's wheel, grab.rs page_scroll).
#[cfg(target_os = "macos")]
pub fn trusted() -> bool { ax::trusted() }
#[cfg(not(target_os = "macos"))]
pub fn trusted() -> bool { false }

/// Ask macOS to show its own Accessibility prompt; it also puts this very binary in the list, so a rebuilt Sol gets a
/// fresh row.
#[cfg(target_os = "macos")]
pub fn ask_trust() { ax::ask_trust() }
#[cfg(not(target_os = "macos"))]
pub fn ask_trust() {}

#[cfg(target_os = "macos")]
mod ax {
    use std::ffi::c_void;
    type Ref = *const c_void;

    // the few C functions this needs, against the system frameworks (no crate for them)
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: Ref) -> u8;
        static kAXTrustedCheckOptionPrompt: Ref;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(r: Ref);
        fn CFDictionaryCreate(alloc: Ref, keys: *const Ref, values: *const Ref, n: isize, kcb: Ref, vcb: Ref) -> Ref;
        static kCFBooleanTrue: Ref;
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
    }

    pub fn trusted() -> bool { unsafe { AXIsProcessTrusted() != 0 } }

    /// Ask macOS to show its Accessibility prompt (it offers to open System Settings at Sol's row).
    pub fn ask_trust() {
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt];
            let vals = [kCFBooleanTrue];
            let d = CFDictionaryCreate(
                std::ptr::null(), keys.as_ptr(), vals.as_ptr(), 1,
                &kCFTypeDictionaryKeyCallBacks as *const c_void, &kCFTypeDictionaryValueCallBacks as *const c_void,
            );
            if !d.is_null() {
                AXIsProcessTrustedWithOptions(d);
                CFRelease(d);
            }
        }
    }
}

// ---- Screen Recording for Sol itself: the clean screen (clean.rs) ----
/// Sol may film the screen (CGPreflightScreenCaptureAccess; no prompt).
#[cfg(target_os = "macos")]
pub fn screen_trusted() -> bool { unsafe { screen::CGPreflightScreenCaptureAccess() } }
#[cfg(not(target_os = "macos"))]
pub fn screen_trusted() -> bool { false }

/// macOS's own Screen Recording prompt (once per app; it also puts this very binary in the list, like ask_trust).
#[cfg(target_os = "macos")]
pub fn ask_screen() { unsafe { screen::CGRequestScreenCaptureAccess(); } }
#[cfg(not(target_os = "macos"))]
pub fn ask_screen() {}

/// System Settings at one Privacy pane ("Privacy_ScreenCapture", "Privacy_Accessibility"), with no change to any window.
pub fn open_pane(pane: &str) -> Result<(), String> {
    let url = format!("x-apple.systempreferences:com.apple.preference.security?{pane}");
    let ok = std::process::Command::new("/usr/bin/open").arg(&url).status()
        .map_err(|e| format!("System Settings did not open: {e}"))?;
    if ok.success() { Ok(()) } else { Err("System Settings did not open".into()) }
}

#[cfg(target_os = "macos")]
mod screen {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        pub fn CGPreflightScreenCaptureAccess() -> bool;
        pub fn CGRequestScreenCaptureAccess() -> bool;
    }
}
