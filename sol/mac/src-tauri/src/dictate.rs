//! Dictate anywhere (#110): what the hold-key needs from macOS. Which app is in front when the key comes up (for the
//! line the engine stores), and `type_text`: the words pasted where the cursor is, the way the dictation apps do it.
//! Remember the clipboard's text, put the words on it, send Cmd+V as a made-up keystroke, give the clipboard back.
//! The keystroke needs the Accessibility permission; without it the words stay on the clipboard and the first try
//! opens the System Settings pane (the notch says so).

use tauri::{AppHandle, Emitter};

/// The hold-key's down or up, to the notch as "dictate"; the up says which app is in front (where the words go).
pub fn emit(app: &AppHandle, down: bool) {
    let payload = if down {
        serde_json::json!({ "down": true })
    } else {
        let (id, name) = frontmost();
        serde_json::json!({ "down": false, "app": id, "name": name, "title": "" })
    };
    let _ = app.emit_to("notch", "dictate", payload);
}

/// Fn (the Globe key, bottom left) as a hold-key. The shortcut plugin refuses a bare modifier (Carbon hot keys need a
/// real key), so this watches the modifier keys themselves: a global monitor for the other apps and a local one for
/// Sol's own windows. Global monitors only get key events once Accessibility is granted, so lib.rs installs this only
/// then. Main thread. The monitors live as long as the app: their handles are leaked on purpose (std::mem::forget).
/// macOS's own use of the key must be off (System Settings → Keyboard → "Press 🌐 key to": Do Nothing), else a tap
/// also opens the emoji picker or switches the input source.
#[cfg(target_os = "macos")]
pub fn watch_fn(app: &AppHandle) -> bool {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, Ordering};
    static HELD: AtomicBool = AtomicBool::new(false);
    const FN_KEY: u16 = 63; // kVK_Function
    let on_flags = {
        let app = app.clone();
        move |e: &NSEvent| {
            if e.keyCode() != FN_KEY { return; }
            let down = e.modifierFlags().contains(NSEventModifierFlags::Function);
            if HELD.swap(down, Ordering::SeqCst) != down { emit(&app, down); }
        }
    };
    let on_local = on_flags.clone();
    let global = RcBlock::new(move |e: NonNull<NSEvent>| on_flags(unsafe { e.as_ref() }));
    let local = RcBlock::new(move |e: NonNull<NSEvent>| -> *mut NSEvent { on_local(unsafe { e.as_ref() }); e.as_ptr() });
    let Some(g) = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(NSEventMask::FlagsChanged, &global) else { return false };
    std::mem::forget(g);
    if let Some(l) = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::FlagsChanged, &local) } {
        std::mem::forget(l);
    }
    true
}
#[cfg(not(target_os = "macos"))]
pub fn watch_fn(_app: &AppHandle) -> bool { false }

/// The frontmost app: (bundle id, its name). The notch never takes focus, so this is the app Marco was talking into.
#[cfg(target_os = "macos")]
pub fn frontmost() -> (String, String) {
    let ws = objc2_app_kit::NSWorkspace::sharedWorkspace();
    let Some(a) = ws.frontmostApplication() else { return (String::new(), String::new()) };
    let id = a.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default();
    let name = a.localizedName().map(|s| s.to_string()).unwrap_or_default();
    (id, name)
}
#[cfg(not(target_os = "macos"))]
pub fn frontmost() -> (String, String) { (String::new(), String::new()) }

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::c_void;
    type Ref = *const c_void;

    // the few C functions this needs, against the system frameworks (no crate for them)
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceCreate(state: i32) -> Ref;
        fn CGEventCreateKeyboardEvent(source: Ref, key: u16, down: bool) -> Ref;
        fn CGEventSetFlags(event: Ref, flags: u64);
        fn CGEventPost(tap: u32, event: Ref);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(r: Ref);
    }
    const HID_SYSTEM_STATE: i32 = 1; // kCGEventSourceStateHIDSystemState
    const HID_EVENT_TAP: u32 = 0; // kCGHIDEventTap
    const FLAG_COMMAND: u64 = 0x0010_0000; // kCGEventFlagMaskCommand
    const KEY_V: u16 = 9; // kVK_ANSI_V

    /// Cmd+V, down and up, into the system's event stream: it lands in whatever has the keyboard.
    pub fn paste() {
        unsafe {
            let src = CGEventSourceCreate(HID_SYSTEM_STATE);
            for down in [true, false] {
                let e = CGEventCreateKeyboardEvent(src, KEY_V, down);
                if e.is_null() { continue; }
                CGEventSetFlags(e, FLAG_COMMAND);
                CGEventPost(HID_EVENT_TAP, e);
                CFRelease(e);
            }
            if !src.is_null() { CFRelease(src); }
        }
    }
}

/// The words into the focused app: "app" when Cmd+V went, "clipboard" when Sol may not type (no Accessibility yet)
/// and the words were left on the clipboard instead.
#[cfg(target_os = "macos")]
fn type_now(text: &str) -> String {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;
    let pb = NSPasteboard::generalPasteboard();
    let ty = unsafe { NSPasteboardTypeString };
    let before = pb.stringForType(ty);
    pb.clearContents();
    pb.setString_forType(&NSString::from_str(text), ty);
    // the Accessibility check and macOS's prompt are permit.rs's (one copy, shared with Grab's Page)
    if !crate::permit::trusted() {
        crate::permit::ask_trust();
        return "clipboard".into();
    }
    let ours = pb.changeCount();
    mac::paste();
    // the app reads the clipboard when it handles the keystroke; give it a beat before the old text goes back
    std::thread::sleep(std::time::Duration::from_millis(200));
    if pb.changeCount() == ours {
        // only text is kept: an image that was on the clipboard is not restored
        pb.clearContents();
        if let Some(b) = before { pb.setString_forType(&b, ty); }
    }
    "app".into()
}
#[cfg(not(target_os = "macos"))]
fn type_now(_text: &str) -> String { "clipboard".into() }

#[tauri::command]
pub async fn type_text(text: String) -> String {
    tauri::async_runtime::spawn_blocking(move || type_now(&text)).await.unwrap_or_else(|_| "clipboard".into())
}
