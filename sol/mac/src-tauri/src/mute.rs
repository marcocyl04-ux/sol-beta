// The call's mute while Marco speaks to Sol (#253).
//
// Why the call app's own shortcut: Sol hears the microphone through its own listener, so muting the microphone itself
// (the Mac's input volume, a hardware mute) would silence Sol too. What has to go quiet is only what the call sends to
// the other side, and only the call app can do that. So Sol presses the app's own mute key for it (Zoom ⌘⇧A, Teams and
// FaceTime ⌘⇧M, Meet in Chrome ⌘D; the list is the Mute heading of the skill file, the engine hands it over), aimed at
// the app's process, and presses it again on release.
//
// Why it is confirmed by reading the menu: that key is a toggle, and a key sent is not a key obeyed (the app may be
// busy, the call may have been muted by hand so the key unmutes it, the shortcut may have been changed). The other side
// must not hear him, so Sol does not take the key on faith: the call apps show their state in their own menu bar
// ("Mute Audio" while the sound goes out, "Unmute Audio" while it does not), and macOS lets a trusted app read another
// app's menus through Accessibility. Sol reads the menu after the key and answers what it reads: "muted" / "unmuted".
// When there is no such item to read (Meet in a browser) the answer is "sent", so the line can say "sent, not
// confirmed"; when the front app is not a call app nothing is pressed and the answer is "none". The caller decides
// what to do with a wrong answer (send once more), because only it knows whether it wanted muted or unmuted.
//
// One command: call_mute { on, apps: [{ app, keys }] } → { app, state }. `on` is only for the log.
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Deserialize, Clone)]
pub struct MuteApp {
    pub app: String,  // the app's name as macOS shows it ("zoom.us", "Microsoft Teams"), or its bundle id
    pub keys: String, // its mute shortcut, "cmd shift a"
}

#[derive(Serialize)]
pub struct Muted {
    pub app: String,   // the frontmost app's name ("" when there is none)
    pub state: String, // "muted" | "unmuted" | "sent" | "none"
}

#[tauri::command]
pub async fn call_mute(app: AppHandle, on: bool, apps: Vec<MuteApp>) -> Muted {
    let h = app.clone();
    tauri::async_runtime::spawn_blocking(move || run(&h, on, &apps))
        .await
        .unwrap_or_else(|_| Muted { app: String::new(), state: "none".into() })
}

#[cfg(target_os = "macos")]
fn run(h: &AppHandle, on: bool, apps: &[MuteApp]) -> Muted {
    let (name, id, pid) = mac::frontmost();
    let found = apps.iter().find(|a| {
        let want = a.app.trim();
        !want.is_empty() && (want.eq_ignore_ascii_case(&name) || want.eq_ignore_ascii_case(&id))
    });
    let Some(entry) = found else {
        crate::log_line(h, &format!("[app] call_mute on={on} front={name} ({id}): not a call app, nothing sent"));
        return Muted { app: name, state: "none".into() };
    };
    let Some((flags, key)) = parse_keys(&entry.keys) else {
        crate::log_line(h, &format!("[app] call_mute on={on} front={name}: shortcut \"{}\" not understood, nothing sent", entry.keys));
        return Muted { app: name, state: "none".into() };
    };
    let trusted = crate::permit::trusted();
    let before = if trusted { mac::menu_state(pid) } else { None };
    mac::press(pid, flags, key);
    if !trusted {
        crate::log_line(h, &format!("[app] call_mute on={on} front={name}: key sent, but Sol has no Accessibility, so neither the key nor the menu can be trusted"));
        return Muted { app: name, state: "sent".into() };
    }
    // the app needs a moment to act on the key and retitle its menu item; once more if nothing changed yet
    std::thread::sleep(std::time::Duration::from_millis(120));
    let mut after = mac::menu_state(pid);
    if after == before {
        std::thread::sleep(std::time::Duration::from_millis(150));
        after = mac::menu_state(pid);
    }
    let state = match after { Some(true) => "muted", Some(false) => "unmuted", None => "sent" };
    crate::log_line(h, &format!("[app] call_mute on={on} front={name} keys=\"{}\" before={before:?} -> {state}", entry.keys));
    Muted { app: name, state: state.into() }
}
#[cfg(not(target_os = "macos"))]
fn run(_h: &AppHandle, _on: bool, _apps: &[MuteApp]) -> Muted {
    Muted { app: String::new(), state: "none".into() }
}

// CGEvent flags (kCGEventFlagMask*)
const F_SHIFT: u64 = 0x0002_0000;
const F_CONTROL: u64 = 0x0004_0000;
const F_OPTION: u64 = 0x0008_0000;
const F_COMMAND: u64 = 0x0010_0000;

/// "cmd shift a" → (flags, virtual keycode). Words split on spaces or "+"; modifiers in any of their usual names and
/// symbols; one key, on the US layout (the call apps' shortcuts are letters, which sit on the same keys in the layouts
/// Marco uses). None when no key, or a word it does not know.
fn parse_keys(s: &str) -> Option<(u64, u16)> {
    let mut flags = 0u64;
    let mut key = None;
    for w in s.split(|c: char| c.is_whitespace() || c == '+').filter(|w| !w.is_empty()) {
        let w = w.to_lowercase();
        match w.as_str() {
            "cmd" | "command" | "⌘" => flags |= F_COMMAND,
            "shift" | "⇧" => flags |= F_SHIFT,
            "ctrl" | "control" | "⌃" => flags |= F_CONTROL,
            "opt" | "alt" | "option" | "⌥" => flags |= F_OPTION,
            k => { if key.is_some() { return None; } key = Some(keycode(k)?); }
        }
    }
    Some((flags, key?))
}

/// The macOS virtual keycode (kVK_*) of a key on the US layout.
fn keycode(k: &str) -> Option<u16> {
    let named = match k {
        "space" => 49, "return" | "enter" => 36, "tab" => 48, "escape" | "esc" => 53, "delete" | "backspace" => 51,
        "left" => 123, "right" => 124, "down" => 125, "up" => 126,
        "f1" => 122, "f2" => 120, "f3" => 99, "f4" => 118, "f5" => 96, "f6" => 97,
        "f7" => 98, "f8" => 100, "f9" => 101, "f10" => 109, "f11" => 103, "f12" => 111,
        _ => u16::MAX,
    };
    if named != u16::MAX { return Some(named); }
    let mut cs = k.chars();
    let (Some(c), None) = (cs.next(), cs.next()) else { return None };
    Some(match c {
        'a' => 0, 's' => 1, 'd' => 2, 'f' => 3, 'h' => 4, 'g' => 5, 'z' => 6, 'x' => 7, 'c' => 8, 'v' => 9,
        'b' => 11, 'q' => 12, 'w' => 13, 'e' => 14, 'r' => 15, 'y' => 16, 't' => 17,
        '1' => 18, '2' => 19, '3' => 20, '4' => 21, '6' => 22, '5' => 23, '=' => 24, '9' => 25, '7' => 26,
        '-' => 27, '8' => 28, '0' => 29, ']' => 30, 'o' => 31, 'u' => 32, '[' => 33, 'i' => 34, 'p' => 35,
        'l' => 37, 'j' => 38, '\'' => 39, 'k' => 40, ';' => 41, '\\' => 42, ',' => 43, '/' => 44,
        'n' => 45, 'm' => 46, '.' => 47, '`' => 50,
        _ => return None,
    })
}

/// A menu title that tells the call's mute: Some(true) "Unmute…" (it is muted now), Some(false) "Mute…" (sound goes
/// out). Items that mute something else (a browser's "Mute Site", a chat's "Mute Conversation", a host's "Mute All")
/// do not count.
fn title_state(t: &str) -> Option<bool> {
    let t = t.trim().to_lowercase();
    let (muted, rest) = if let Some(r) = t.strip_prefix("unmute") { (true, r) } else if let Some(r) = t.strip_prefix("mute") { (false, r) } else { return None };
    if rest.starts_with(|c: char| c.is_alphabetic()) { return None; }   // "muted", "mutex"…
    const OTHER: [&str; 8] = ["site", "tab", "conversation", "chat", "thread", "notification", "all", "channel"];
    if rest.split(|c: char| !c.is_alphabetic()).any(|w| OTHER.iter().any(|o| w.starts_with(o) && (w.len() == o.len() || *o != "all"))) { return None; }
    Some(muted)
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2_foundation::NSString;
    use std::ffi::c_void;
    type Ref = *const c_void;

    // the few C functions this needs, against the system frameworks (no crate for them), as dictate.rs and permit.rs
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceCreate(state: i32) -> Ref;
        fn CGEventCreateKeyboardEvent(source: Ref, key: u16, down: bool) -> Ref;
        fn CGEventSetFlags(event: Ref, flags: u64);
        fn CGEventPostToPid(pid: i32, event: Ref);
        fn AXUIElementCreateApplication(pid: i32) -> Ref;
        fn AXUIElementCopyAttributeValue(element: Ref, attribute: Ref, value: *mut Ref) -> i32;
        fn AXUIElementSetMessagingTimeout(element: Ref, seconds: f32) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(r: Ref);
        fn CFGetTypeID(r: Ref) -> usize;
        fn CFArrayGetTypeID() -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFArrayGetCount(a: Ref) -> isize;
        fn CFArrayGetValueAtIndex(a: Ref, i: isize) -> Ref;
    }
    // a private source: the event carries only the flags set on it, not Fn, which Marco is holding down right now
    const PRIVATE_STATE: i32 = -1; // kCGEventSourceStatePrivate

    /// The frontmost app: (its name, bundle id, pid). The notch never takes focus, so this is the app Marco is in.
    pub fn frontmost() -> (String, String, i32) {
        let ws = objc2_app_kit::NSWorkspace::sharedWorkspace();
        let Some(a) = ws.frontmostApplication() else { return (String::new(), String::new(), -1) };
        let id = a.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default();
        let name = a.localizedName().map(|s| s.to_string()).unwrap_or_default();
        (name, id, a.processIdentifier() as i32)
    }

    /// The shortcut, down and up, into that app's own event queue (not whatever has the keyboard).
    pub fn press(pid: i32, flags: u64, key: u16) {
        if pid <= 0 { return; }
        unsafe {
            let src = CGEventSourceCreate(PRIVATE_STATE);
            for down in [true, false] {
                let e = CGEventCreateKeyboardEvent(src, key, down);
                if e.is_null() { continue; }
                CGEventSetFlags(e, flags);
                CGEventPostToPid(pid, e);
                CFRelease(e);
            }
            if !src.is_null() { CFRelease(src); }
        }
    }

    /// One attribute of an element, owned by the caller (CFRelease), or null.
    unsafe fn attr(el: Ref, name: &str) -> Ref {
        let n = NSString::from_str(name);   // NSString and CFString are the same object (toll-free bridged)
        let mut v: Ref = std::ptr::null();
        let err = unsafe { AXUIElementCopyAttributeValue(el, objc2::rc::Retained::as_ptr(&n) as Ref, &mut v) };
        if err == 0 { v } else { std::ptr::null() }
    }

    unsafe fn title(el: Ref) -> Option<String> {
        let v = unsafe { attr(el, "AXTitle") };
        if v.is_null() { return None; }
        let s = if unsafe { CFGetTypeID(v) == CFStringGetTypeID() } {
            Some(unsafe { &*(v as *const NSString) }.to_string())
        } else { None };
        unsafe { CFRelease(v) };
        s
    }

    /// Walk an element and its children down to `depth` levels for the first title that tells the mute.
    unsafe fn walk(el: Ref, depth: u32, budget: &mut u32) -> Option<bool> {
        if *budget == 0 { return None; }
        *budget -= 1;
        if let Some(found) = unsafe { title(el) }.as_deref().and_then(super::title_state) { return Some(found); }
        if depth == 0 { return None; }
        let kids = unsafe { attr(el, "AXChildren") };
        if kids.is_null() { return None; }
        let mut out = None;
        if unsafe { CFGetTypeID(kids) == CFArrayGetTypeID() } {
            for i in 0..unsafe { CFArrayGetCount(kids) } {
                if let Some(found) = unsafe { walk(CFArrayGetValueAtIndex(kids, i), depth - 1, budget) } { out = Some(found); break; }
            }
        }
        unsafe { CFRelease(kids) };
        out
    }

    /// The app's mute as its menu bar shows it: Some(true) muted, Some(false) unmuted, None when nothing says.
    /// The bar's items (Zoom's "Meeting"…) hold a menu, which holds the items: two levels under each bar item, and one
    /// more under a "Meeting" item, where Zoom may keep its audio in a submenu. A budget of elements keeps a huge menu
    /// (a browser's History) from costing more than a few milliseconds; a short timeout keeps a hung app from hanging Sol.
    pub fn menu_state(pid: i32) -> Option<bool> {
        if pid <= 0 { return None; }
        unsafe {
            let app = AXUIElementCreateApplication(pid);
            if app.is_null() { return None; }
            AXUIElementSetMessagingTimeout(app, 0.25);
            let bar = attr(app, "AXMenuBar");
            let mut out = None;
            if !bar.is_null() {
                let items = attr(bar, "AXChildren");
                if !items.is_null() {
                    if CFGetTypeID(items) == CFArrayGetTypeID() {
                        let mut budget = 1500u32;
                        let n = CFArrayGetCount(items);
                        // "Meeting" first (Zoom), then the rest in the bar's order
                        let order: Vec<isize> = {
                            let mut v: Vec<isize> = (0..n).collect();
                            v.sort_by_key(|i| !title(CFArrayGetValueAtIndex(items, *i)).is_some_and(|t| t.eq_ignore_ascii_case("meeting")));
                            v
                        };
                        for i in order {
                            let item = CFArrayGetValueAtIndex(items, i);
                            let deep = if title(item).is_some_and(|t| t.eq_ignore_ascii_case("meeting")) { 3 } else { 2 };
                            if let Some(found) = walk(item, deep, &mut budget) { out = Some(found); break; }
                        }
                    }
                    CFRelease(items);
                }
                CFRelease(bar);
            }
            CFRelease(app);
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys() {
        assert_eq!(parse_keys("cmd shift a"), Some((F_COMMAND | F_SHIFT, 0)));
        assert_eq!(parse_keys("Command+Shift+M"), Some((F_COMMAND | F_SHIFT, 46)));
        assert_eq!(parse_keys("cmd d"), Some((F_COMMAND, 2)));
        assert_eq!(parse_keys("ctrl opt space"), Some((F_CONTROL | F_OPTION, 49)));
        assert_eq!(parse_keys("cmd shift"), None);
        assert_eq!(parse_keys("cmd a b"), None);
        assert_eq!(parse_keys("hyper a"), None);
    }
    #[test]
    fn titles() {
        assert_eq!(title_state("Mute Audio"), Some(false));
        assert_eq!(title_state("Unmute Audio"), Some(true));
        assert_eq!(title_state("Unmute…"), Some(true));
        assert_eq!(title_state("Mute"), Some(false));
        assert_eq!(title_state("Mute Site"), None);
        assert_eq!(title_state("Mute All"), None);
        assert_eq!(title_state("Muted"), None);
        assert_eq!(title_state("Mute Call"), Some(false));
        assert_eq!(title_state("Meeting"), None);
    }
}
