// "Tell us…" in the menu bar menu (#294): a beta tester says what broke without a GitHub account. It opens the beta
// testers' Discord in the browser (or the Discord app, if it owns the link) and puts one line on the clipboard, Sol's
// version and this Mac's model and macOS, so the tester can paste it under what they write. Nothing is sent by Sol
// itself; Discord gets only what the person types there.
use std::io::Write;
use std::process::{Command, Stdio};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// The invite to the beta testers' Discord (Frank made it on 2026-10-29).
const DISCORD: &str = "https://discord.gg/R2uAcBqxT";

fn out(cmd: &str, args: &[&str]) -> String {
    Command::new(cmd)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// A tester runs an export, whose one commit says "Sol stable-YYYYMMDD-HHMM" (ship.ts); anyone else's checkout is named
/// by its short commit.
fn version(app: &AppHandle) -> String {
    let Some(root) = crate::root::root(app) else { return "not installed yet".into() };
    let dir = root.to_string_lossy().to_string();
    let subject = out("git", &["-C", &dir, "log", "-1", "--format=%s"]);
    if let Some(tag) = subject.strip_prefix("Sol ").filter(|t| t.starts_with("stable-")) {
        return tag.to_string();
    }
    match out("git", &["-C", &dir, "rev-parse", "--short", "HEAD"]) {
        sha if sha.is_empty() => "unknown".into(),
        sha => format!("dev {sha}"),
    }
}

/// "Mac15,12, macOS 26.6.2": the model identifier and the system, nothing that names the person
fn mac() -> String {
    let model = out("sysctl", &["-n", "hw.model"]);
    let os = out("sw_vers", &["-productVersion"]);
    match (model.is_empty(), os.is_empty()) {
        (false, false) => format!("{model}, macOS {os}"),
        (false, true) => model,
        (true, false) => format!("macOS {os}"),
        (true, true) => String::new(),
    }
}

/// The one line for the clipboard: "Sol stable-20261027-1446 · Mac15,12, macOS 26.6.2"
pub fn line(version: &str, mac: &str) -> String {
    if mac.is_empty() {
        format!("Sol {version}")
    } else {
        format!("Sol {version} · {mac}")
    }
}

/// The clipboard, through pbcopy: no plugin, and it is macOS only like the rest of this file.
fn copy(text: &str) {
    if let Ok(mut child) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes());
        }
        let _ = child.wait();
    }
}

/// Off the main thread: git and sysctl take a moment, and the menu must close at once.
pub fn open(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        copy(&line(&version(&app), &mac()));
        let _ = app.opener().open_url(DISCORD, None::<&str>);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_clipboard_line_has_both_details() {
        assert_eq!(line("stable-20261027-1446", "Mac15,12, macOS 26.6.2"), "Sol stable-20261027-1446 · Mac15,12, macOS 26.6.2");
        assert_eq!(line("dev 1a2b3c4", ""), "Sol dev 1a2b3c4");
    }
}
