// The join link (#327; the groups PRD §9.2): Sol answers `sol://` links (tauri-plugin-deep-link; the scheme is in the
// app's Info.plist by tauri.conf.json `plugins.deep-link.desktop.schemes`, macOS only for now). The cloud's join page
// opens `sol://join?code=<code>`; this file hands every sol:// link to the main window as the event `sol-url`, shows
// the window for a join link only, and keeps the link until the face takes it (`sol_url_take`), since a link that
// launches Sol arrives before the page listens. What a link means is the face's to read (mac/src/cowork/joinlink.ts), and it reads only a
// join: here a link is only passed on, never acted on. At most a few are kept, each at most 200 characters.
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

/// the links that came before the face listened, oldest first
#[derive(Default)]
pub struct Waiting(pub Mutex<Vec<String>>);

/// a few links at most: a page that opens many only fills the list, and the face asks about one at a time anyway
const KEPT: usize = 4;
const URL_MAX: usize = 200;

/// is this a link of Sol's, short enough to pass on (pure)
fn ours(url: &str) -> bool {
    url.len() <= URL_MAX && url.starts_with("sol://")
}

/// is this a join link, `sol://join?code=<six of the code's symbols>` with one code (pure). Only a join brings the
/// window forward: any other sol:// link is passed on quietly, and the face ignores it (#327's review)
fn is_join(url: &str) -> bool {
    if !ours(url) { return false; }
    let Some(query) = url.strip_prefix("sol://join?").or_else(|| url.strip_prefix("sol://join/?")) else { return false };
    let codes: Vec<&str> = query.split('&').filter_map(|kv| kv.strip_prefix("code=")).collect();
    codes.len() == 1 && codes[0].len() == 6
        && codes[0].chars().all(|c| matches!(c.to_ascii_uppercase(), 'A'..='H' | 'J'..='N' | 'P'..='Z' | '2'..='9'))
}

/// at setup: the link that launched Sol (the plugin's `get_current`), then every link opened while it runs
pub fn init(app: &AppHandle) {
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for u in urls { heard(app, u.as_str()); }
    }
    let h = app.clone();
    app.deep_link().on_open_url(move |event| {
        for u in event.urls() { heard(&h, u.as_str()); }
    });
}

/// one link: kept for a face that is not listening yet, told to one that is, and the window shown for a join
fn heard(app: &AppHandle, url: &str) {
    if !ours(url) { return; }
    {
        let st = app.state::<Waiting>();
        let mut w = st.0.lock().unwrap();
        if !w.iter().any(|x| x == url) {
            w.push(url.to_string());
            let over = w.len().saturating_sub(KEPT);
            w.drain(..over);
        }
    }
    let _ = app.emit_to("main", "sol-url", url);
    if is_join(url) { crate::show_main(app); }
}

/// the links kept so far, handed over once: the face calls it when it starts listening, and after each link it heard
#[tauri::command]
pub fn sol_url_take(app: AppHandle) -> Vec<String> {
    std::mem::take(&mut *app.state::<Waiting>().0.lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::{is_join, ours};

    #[test]
    fn only_a_join_link_with_one_code_of_six_symbols_brings_the_window_forward() {
        assert!(is_join("sol://join?code=2QKTYA"));
        assert!(is_join("sol://join/?code=2qktya&from=page"));
        for bad in ["sol://join?code=2QKTY", "sol://join?code=2QKTYA7", "sol://join?code=2QKTY0", "sol://join?code=2QKTYA&code=ZZZZZZ",
            "sol://open?code=2QKTYA", "sol://join", "sol://joinx?code=2QKTYA", "https://x/?code=2QKTYA"] {
            assert!(!is_join(bad), "{bad}");
        }
    }

    #[test]
    fn only_sol_links_of_a_bounded_length_are_passed_on() {
        assert!(ours("sol://join?code=2QKTYA"));
        assert!(!ours("https://cloud.matterfold.tech/relay/j/2QKTYA"));
        assert!(!ours("file:///etc/passwd"));
        assert!(!ours(&format!("sol://join?code={}", "x".repeat(300))));
    }
}
