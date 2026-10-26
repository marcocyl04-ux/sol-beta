// A thing opened inside Sol (#236; the studio PRD §4.5, §9.8; POLICY.md §2; SPIKE-WEBVIEW.md): the room's Doc, Sheet,
// Figma file or page as the real page, in a pane of the main window, under the person's own logins on this Mac.
//
// Each open tab is one child web view of the main window ("thing-<tab>", Tauri's `unstable` add_child), placed over the
// pane the face draws; one is shown, the others hidden. The boundary, in the shell where the face cannot undo it:
// - the remote page can call nothing: Tauri puts its IPC script in every web view (`__TAURI_INTERNALS__` is there), but
//   the ACL refuses every command and event to it, since the capabilities name the face's own web views only
//   (`webviews`, never the window "main", which would match a child too; a test below keeps it so);
// - navigation, in any frame, stays on the thing's site (`site_of`: the hosts its kind needs to sign in and draw, and
//   the page's own host); anything else is refused and the face told, at most once a second, so it can offer the
//   system browser (the shell cannot tell a click from a frame loading, so it never opens one on its own);
// - a new window (target=_blank, window.open) never opens: on the site it becomes a tab in the pane (at most five
//   tabs a thing, one every 1.5 s a thing); off the site it is named in the bar, and only a press there opens it in the
//   system browser; downloads refused;
// - Sol scripts nothing in the page and reads nothing of it: no eval, no cookie leaves this file;
// - one browser store for every thing (STORE), apart from the face's own storage, one per macOS user account as any
//   app's is; settings' "sign out of sites" removes its cookies, "clear" all its data (WebKit's removeDataOfTypes).
// - macOS 14 or later only: before it WebKit has no store of its own for the things and would use the face's;
// - while "sign out" or "clear" runs, nothing opens, and the other waits its turn.
// The face is told only: which tab, which address it is at, what was refused, as origin and path. A full address
// (a query may hold a sign-in code) stays here; the face names it by a number to have it opened in the browser.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

/// Google refuses WKWebView's own user agent ("browser no longer supported") and Safari 17.4; this Mac's Safari works.
const SAFARI_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
/// The things' own browser store (WKWebsiteDataStore forIdentifier:, macOS 14+): every thing shares it, the face's page
/// never does. A fixed identifier, so a login made today is there tomorrow.
const STORE: [u8; 16] = [0x50, 0x6f, 0x6c, 0x2d, 0x74, 0x68, 0x69, 0x6e, 0x67, 0x73, 0x2d, 0x76, 0x31, 0x00, 0x00, 0x01];
const PREFIX: &str = "thing-";
/// the tab of GitHub's sign-up (#252): its pane is its own, apart from the things'
const JOIN: &str = "ghjoin";
/// the face that owns the panes: the only page told anything
const FACE: &str = "main";

// The hosts a kind of thing needs: its app, its sign-in, its static files. "*.d" is d and every host under it, "!h" a
// host under one of those that is someone else's page (Google Sites), a bare name that host alone. Hosts that serve
// what anyone uploads (googleusercontent, storage.googleapis, githubusercontent, github.io) are not in any family.
// A thing on a family's host gets the family (Figma and Notion add Google's sign-in); every thing gets its own host.
const GOOGLE: &[&str] = &["*.google.com", "!sites.google.com", "!script.google.com", "*.gstatic.com", "accounts.youtube.com",
    "content.googleapis.com", "docs.googleusercontent.com"];
const GOOGLE_SIGN_IN: &[&str] = &["accounts.google.com", "apis.google.com", "*.gstatic.com", "content.googleapis.com"];
const MICROSOFT: &[&str] = &["*.office.com", "*.office.net", "*.microsoftonline.com", "login.live.com", "onedrive.live.com",
    "login.microsoft.com", "www.microsoft.com", "*.msauth.net", "*.msftauth.net", "onedrive.com", "www.onedrive.com",
    "*.officeapps.live.com", "login.windows.net", "account.live.com", "1drv.ms"];
const FIGMA: &[&str] = &["*.figma.com"];
const GITHUB: &[&str] = &["*.github.com", "*.githubassets.com"];
const NOTION: &[&str] = &["*.notion.so", "notion.com", "www.notion.com"];
/// GitHub's sign-up (ADDITIONS §4c, #252): "Continue with Google" (its sign-in frames accounts.youtube.com's check) and
/// GitHub's puzzles (octocaptcha.com, which frames Arkose Labs; DataDome's captcha-delivery.com on a busy day). Only a
/// tab opened on github.com/signup gets them; a GitHub thing never does.
const GITHUB_JOIN: &[&str] = &["accounts.youtube.com", "octocaptcha.com", "*.arkoselabs.com", "*.captcha-delivery.com"];

fn under(host: &str, d: &str) -> bool { host == d || host.ends_with(&format!(".{d}")) }
fn hits(host: &str, rule: &str) -> bool { match rule.strip_prefix("*.") { Some(d) => under(host, d), None => host == rule } }
fn host_of(u: &Url) -> String { u.host_str().unwrap_or("").trim_end_matches('.').to_ascii_lowercase() }

/// The rules (see GOOGLE) a thing at `url` may move between: its kind's hosts and its own host. Pure.
pub fn site_of(url: &Url) -> Vec<String> {
    let host = host_of(url);
    if host.is_empty() || !host.contains('.') { return vec![]; }
    let of = |f: &[&str]| f.iter().any(|r| !r.starts_with('!') && hits(&host, r));
    let mut out: Vec<&str> = vec![];
    if of(GOOGLE) && !GOOGLE.iter().any(|r| r.strip_prefix('!') == Some(host.as_str())) { out.extend(GOOGLE); }
    else if of(MICROSOFT) || under(&host, "sharepoint.com") { out.extend(MICROSOFT); }
    else if of(FIGMA) { out.extend(FIGMA); out.extend(GOOGLE_SIGN_IN); }
    else if of(GITHUB) {
        out.extend(GITHUB);
        if host == "github.com" && (url.path() == "/signup" || url.path().starts_with("/signup/")) { out.extend(GOOGLE_SIGN_IN); out.extend(GITHUB_JOIN); }
    }
    else if of(NOTION) || under(&host, "notion.site") { out.extend(NOTION); out.extend(GOOGLE_SIGN_IN); }
    let mut out: Vec<String> = out.into_iter().map(String::from).collect();
    // its own host, with or without www: a SharePoint tenant, a Notion page, a page of its own; never its neighbours
    let bare = host.strip_prefix("www.").unwrap_or(&host).to_string();
    out.push(bare.clone());
    out.push(format!("www.{bare}"));
    out
}

/// May a frame of a thing on `site` go to `u`? https on the default port to a host the rules take, or an empty frame. Pure.
pub fn allowed(site: &[String], u: &Url) -> bool {
    if u.scheme() == "about" { return matches!(u.path(), "blank" | "srcdoc"); }
    if u.scheme() != "https" || u.port().is_some() || !u.username().is_empty() || u.password().is_some() { return false; }
    let host = host_of(u);
    if host.is_empty() || site.iter().any(|r| r.strip_prefix('!') == Some(host.as_str())) { return false; }
    site.iter().any(|r| !r.starts_with('!') && hits(&host, r))
}

/// At most one of `key` every `every`: the brake on a page that opens windows or loads refused frames in a loop.
fn gate(key: &str, every: Duration) -> bool {
    static LAST: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);
    let mut g = LAST.lock().unwrap();
    let m = g.get_or_insert_with(HashMap::new);
    let now = Instant::now();
    if m.get(key).is_some_and(|t| now.duration_since(*t) < every) { return false; }
    m.retain(|_, t| now.duration_since(*t) < Duration::from_secs(60));
    m.insert(key.to_string(), now);
    true
}
/// extra tabs one thing may have beside its own page
const EXTRA_TABS: usize = 4;

/// An address as the face may see it: origin and path, never the query or the fragment. Pure.
pub fn shown(u: &Url) -> String {
    match u.scheme() { "https" | "http" => format!("{}{}", u.origin().ascii_serialization(), u.path()), s => format!("{s}:") }
}
/// The full addresses the face may ask to have opened in the browser, by number: the last 20 refused or asked for.
static KEPT: Mutex<Vec<(u32, String)>> = Mutex::new(Vec::new());
fn keep(u: &Url) -> Option<u32> {
    if !matches!(u.scheme(), "https" | "http") { return None; }
    let mut k = KEPT.lock().unwrap();
    let n = k.last().map(|(n, _)| n + 1).unwrap_or(1);
    k.push((n, u.to_string()));
    if k.len() > 20 { k.remove(0); }
    Some(n)
}
/// the face's thing pages need a store of their own (WKWebsiteDataStore forIdentifier:), macOS 14 or later
fn own_store() -> bool {
    #[cfg(target_os = "macos")]
    { objc2_foundation::NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(objc2_foundation::NSOperatingSystemVersion { majorVersion: 14, minorVersion: 0, patchVersion: 0 }) }
    #[cfg(not(target_os = "macos"))]
    { false }
}
/// "sign out" or "clear" is running: nothing opens until it is done, and a second press is refused
static CLEARING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Google sends a Doc's links through www.google.com/url?q=<link> in a new window: the link itself, when it is one. Pure.
pub fn unwrap_redirect(u: &Url) -> Url {
    let host = u.host_str().unwrap_or("");
    if u.scheme() == "https" && (host == "www.google.com" || host == "google.com") && u.path() == "/url" {
        if let Some((_, q)) = u.query_pairs().find(|(k, _)| k == "q" || k == "url") {
            if let Ok(to) = Url::parse(&q) { if matches!(to.scheme(), "https" | "http") { return to; } }
        }
    }
    u.clone()
}

/// A tab's name from the face: a thing's id and a number, nothing else.
fn tab_ok(tab: &str) -> bool { !tab.is_empty() && tab.len() <= 40 && tab.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') }

#[derive(Default)]
pub struct Tabs(Mutex<HashMap<String, (Vec<String>, String)>>);   // label → its site, the address it last loaded
// (kept from the page loads: wry's url() unwraps WebKit's URL and aborts the app while a view has none yet)

fn tell(app: &AppHandle, v: serde_json::Value) { let _ = app.emit_to(FACE, "thing", v); }

/// the title bar: WebKit insets the face's page by the bar on its own, a child is not inset; add the difference back
fn inset(app: &AppHandle, inner_h: f64) -> f64 {
    let scale = app.get_window(FACE).and_then(|w| w.scale_factor().ok()).unwrap_or(1.0);
    let face_h = app.get_webview(FACE).and_then(|w| w.size().ok()).map(|s| s.height as f64 / scale).unwrap_or(inner_h);
    (face_h - inner_h).clamp(0.0, 80.0)
}

fn things(app: &AppHandle) -> Vec<tauri::Webview> {
    app.webviews().into_values().filter(|w| w.label().starts_with(PREFIX)).collect()
}

/// Open a tab (or show it again, as it was): `url` on `site` (the thing's own link, which names its site), in the pane at
/// x, y, w, h of the face's page. Every other tab is hidden.
#[tauri::command]
pub fn thing_open(app: AppHandle, tab: String, url: String, site: String, x: f64, y: f64, w: f64, h: f64, inner_h: f64, show: Option<bool>, kept: Option<u32>) -> Result<(), String> {
    // a tab a page asked for comes by its kept number: its full address never went to the face
    let url = match kept { Some(n) => KEPT.lock().unwrap().iter().find(|(k, _)| *k == n).map(|(_, u)| u.clone()).ok_or("that link is gone")?, None => url };
    let show = show.unwrap_or(true);   // false: something of the face covers the pane; the page waits hidden
    if !tab_ok(&tab) { return Err("not a tab".into()); }
    if !own_store() { return Err("a page opens inside Sol on macOS 14 or later; open it in your browser".into()); }
    if CLEARING.load(std::sync::atomic::Ordering::SeqCst) { return Err("Sol's browser is being emptied; a moment".into()); }
    let site = site_of(&Url::parse(&site).map_err(|e| e.to_string())?);
    let to = Url::parse(&url).map_err(|e| e.to_string())?;
    if to.scheme() != "https" || !allowed(&site, &to) { return Err("that link is not on the thing's site".into()); }
    let label = format!("{PREFIX}{tab}");
    if let Some((base, _)) = tab.split_once('.') {
        let extra = things(&app).iter().filter(|w| w.label().starts_with(&format!("{PREFIX}{base}."))).count();
        if app.get_webview(&label).is_none() && extra >= EXTRA_TABS { return Err("five tabs is the most one thing opens; close one first".into()); }
    }
    let join = format!("{PREFIX}{JOIN}");
    for wv in things(&app) { if wv.label() != label && (wv.label() != join || tab == JOIN) { let _ = wv.hide(); } }
    let y = y + inset(&app, inner_h);
    if let Some(wv) = app.get_webview(&label) {
        wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        wv.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
        return if show { wv.show() } else { wv.hide() }.map_err(|e| e.to_string());
    }
    let window = app.get_window(FACE).ok_or("no main window")?;
    app.state::<Tabs>().0.lock().unwrap().insert(label.clone(), (site.clone(), to.to_string()));
    let (a1, a2, a3, a4) = (app.clone(), app.clone(), app.clone(), app.clone());
    let (s1, s2) = (site.clone(), site.clone());
    let (t1, t2, t3, t4) = (tab.clone(), tab.clone(), tab.clone(), tab.clone());
    let b = WebviewBuilder::new(&label, WebviewUrl::External(to))
        .user_agent(SAFARI_UA)
        .data_store_identifier(STORE)
        .disable_drag_drop_handler()
        .on_navigation(move |u| {
            let ok = allowed(&s1, u);
            if !ok && gate(&format!("refused {t1}"), Duration::from_secs(1)) { tell(&a1, serde_json::json!({ "tab": t1, "refused": shown(u), "id": keep(u) })); }
            ok
        })
        .on_new_window(move |u, _features| {
            // one a thing every 1.5 s, whichever of its tabs asks; nothing opens outside Sol without a press in the bar
            let thing = t2.split('.').next().unwrap_or("").to_string();
            if !gate(&format!("new {thing}"), Duration::from_millis(1500)) { return NewWindowResponse::Deny; }
            let u = unwrap_redirect(&u);
            if allowed(&s2, &u) && u.scheme() == "https" { tell(&a2, serde_json::json!({ "tab": t2, "open": shown(&u), "id": keep(&u) })); }
            else if matches!(u.scheme(), "https" | "http") { tell(&a2, serde_json::json!({ "tab": t2, "outside": shown(&u), "id": keep(&u) })); }
            NewWindowResponse::Deny
        })
        .on_download(move |_wv, e| {
            if let DownloadEvent::Requested { url, .. } = e { tell(&a3, serde_json::json!({ "tab": t3, "download": shown(&url), "id": keep(&url) })); }
            false
        })
        .on_page_load(move |wv, p| {
            if let Some(t) = wv.app_handle().state::<Tabs>().0.lock().unwrap().get_mut(wv.label()) { t.1 = p.url().to_string(); }
            let at = if matches!(p.event(), PageLoadEvent::Started) { "started" } else { "finished" };
            tell(&a4, serde_json::json!({ "tab": t4, "url": shown(p.url()), "load": at }));
        });
    let wv = window.add_child(b, LogicalPosition::new(x, y), LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
    if !show { let _ = wv.hide(); }
    Ok(())
}

/// Show one tab, or none (`tab` empty): every other is hidden, kept as it was. GitHub's sign-up is the things' only
/// when named: a thing's pane showing or stepping aside leaves it as it is. `only`: "show" or "hide" that one tab alone.
#[tauri::command]
pub fn thing_show(app: AppHandle, tab: String, only: Option<String>) -> Result<(), String> {
    let label = format!("{PREFIX}{tab}");
    // one tab shown or hidden, the rest as they are: the sign-up's pane stepping aside for a menu over it
    if let Some(o) = only {
        let wv = app.get_webview(&label).ok_or("no such tab")?;
        return if o == "show" { wv.show() } else { wv.hide() }.map_err(|e| e.to_string());
    }
    let join = format!("{PREFIX}{JOIN}");
    for wv in things(&app) {
        if !tab.is_empty() && wv.label() == label { wv.show().map_err(|e| e.to_string())?; }
        else if wv.label() != join || tab == JOIN { let _ = wv.hide(); }
    }
    Ok(())
}

/// The pane moved or changed size: every tab follows it. GitHub's sign-up (`JOIN`, #252) has a pane of its own: it
/// moves only when named, and a thing's pane never moves it.
#[tauri::command]
pub fn thing_bounds(app: AppHandle, x: f64, y: f64, w: f64, h: f64, inner_h: f64, tab: Option<String>) -> Result<(), String> {
    let y = y + inset(&app, inner_h);
    let join = format!("{PREFIX}{JOIN}");
    for wv in things(&app) {
        let mine = match &tab { Some(t) => wv.label() == format!("{PREFIX}{t}"), None => wv.label() != join };
        if !mine { continue; }
        wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        wv.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Close a tab, or every tab (`tab` empty).
#[tauri::command]
pub fn thing_close(app: AppHandle, tab: String) -> Result<(), String> {
    let label = format!("{PREFIX}{tab}");
    for wv in things(&app) {
        if tab.is_empty() || wv.label() == label {
            app.state::<Tabs>().0.lock().unwrap().remove(wv.label());
            wv.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// The browser, on a press in the pane's bar: a kept address (a refused link, a window asked for off the site, a
/// download), or the page a tab is at now ("open in browser ↗"). http and https only.
#[tauri::command]
pub fn thing_outside(app: AppHandle, id: Option<u32>, tab: Option<String>) -> Result<(), String> {
    let url = match (id, tab) {
        (Some(n), _) => KEPT.lock().unwrap().iter().find(|(k, _)| *k == n).map(|(_, u)| u.clone()).ok_or("that link is gone")?,
        (None, Some(t)) => app.state::<Tabs>().0.lock().unwrap().get(&format!("{PREFIX}{t}")).map(|t| t.1.clone()).ok_or("no such tab")?,
        _ => return Err("nothing to open".into()),
    };
    let u = Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(u.scheme(), "https" | "http") { return Err("only web links open in the browser".into()); }
    app.opener().open_url(u.as_str(), None::<&str>).map_err(|e| e.to_string())
}

/// Reload a tab, or take it back to a link on its site (the thing's own link): the only moves Sol makes in a page.
#[tauri::command]
pub fn thing_nav(app: AppHandle, tab: String, reload: bool, url: Option<String>) -> Result<(), String> {
    let label = format!("{PREFIX}{tab}");
    let wv = app.get_webview(&label).ok_or("no such tab")?;
    if reload { return wv.reload().map_err(|e| e.to_string()); }
    let to = Url::parse(url.as_deref().unwrap_or("")).map_err(|e| e.to_string())?;
    let site = app.state::<Tabs>().0.lock().unwrap().get(&label).map(|t| t.0.clone()).unwrap_or_default();
    if to.scheme() != "https" || !allowed(&site, &to) { return Err("that link is not on the thing's site".into()); }
    wv.navigate(to).map_err(|e| e.to_string())
}

/// A web view of the things' store: an open tab, else a hidden blank one made for this (true: close it after).
fn store_view(app: &AppHandle) -> Result<(tauri::Webview, bool), String> {
    if let Some(w) = things(app).into_iter().next() { return Ok((w, false)); }
    let window = app.get_window(FACE).ok_or("no main window")?;
    let b = WebviewBuilder::new(format!("{PREFIX}store"), WebviewUrl::External(Url::parse("about:blank").unwrap()))
        .data_store_identifier(STORE).on_navigation(|u| u.scheme() == "about");
    let w = window.add_child(b, LogicalPosition::new(0.0, 0.0), LogicalSize::new(1.0, 1.0)).map_err(|e| e.to_string())?;
    let _ = w.hide();
    Ok((w, true))
}

/// WebKit removes the store's data of these types (cookies only, or everything), then counts what is left of them.
#[cfg(target_os = "macos")]
async fn wipe(wv: &tauri::Webview, cookies_only: bool) -> Result<usize, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<usize>();
    let tx = std::sync::Mutex::new(Some(tx));
    wv.with_webview(move |pw| unsafe {
        use block2::RcBlock;
        use objc2_foundation::{NSArray, NSDate, NSSet, NSString};
        use objc2_web_kit::{WKWebView, WKWebsiteDataRecord, WKWebsiteDataStore, WKWebsiteDataTypeCookies};
        let Some(mtm) = objc2::MainThreadMarker::new() else { return };
        let view: &WKWebView = &*(pw.inner() as *const WKWebView);
        let store = view.configuration().websiteDataStore();
        let types: objc2::rc::Retained<NSSet<NSString>> =
            if cookies_only { NSSet::from_slice(&[WKWebsiteDataTypeCookies]) } else { WKWebsiteDataStore::allWebsiteDataTypes(mtm) };
        let (store2, types2) = (store.clone(), types.clone());
        let tx = std::rc::Rc::new(tx);
        let after = RcBlock::new(move || {
            let tx = tx.clone();
            let counted = RcBlock::new(move |recs: std::ptr::NonNull<NSArray<WKWebsiteDataRecord>>| {
                if let Some(t) = tx.lock().unwrap().take() { let _ = t.send(recs.as_ref().count()); }
            });
            store2.fetchDataRecordsOfTypes_completionHandler(&types2, &counted);
        });
        store.removeDataOfTypes_modifiedSince_completionHandler(&types, &NSDate::distantPast(), &after);
    }).map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(15), rx).await.map_err(|_| "WebKit did not answer".to_string())?.map_err(|e| e.to_string())
}
#[cfg(not(target_os = "macos"))]
async fn wipe(_wv: &tauri::Webview, _cookies_only: bool) -> Result<usize, String> { Err("only on a Mac".into()) }

/// Settings › what leaves this machine › sign out of sites: every page closes (none may set a cookie while they are
/// counted), the store's cookies go, the face opens what it shows again, signed out. Nothing of a cookie comes back.
#[tauri::command]
pub async fn sites_sign_out(app: AppHandle) -> Result<(), String> {
    if !own_store() { return Err("Sol's own browser needs macOS 14 or later".into()); }
    emptied(&app, true).await
}

/// Settings › what leaves this machine › clear: every tab closes and the store's data goes (logins, storage, cache);
/// the face opens what it shows again, fresh.
#[tauri::command]
pub async fn sites_clear(app: AppHandle) -> Result<(), String> {
    emptied(&app, false).await
}

/// One at a time: every page closes, WebKit removes the cookies (or everything), the face opens its page again.
async fn emptied(app: &AppHandle, cookies_only: bool) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if CLEARING.swap(true, Ordering::SeqCst) { return Err("Sol's browser is already being emptied".into()); }
    let r = empty_now(app, cookies_only).await;
    CLEARING.store(false, Ordering::SeqCst);
    tell(app, serde_json::json!({ "tab": "", "cleared": true }));   // closed either way: the face opens its page again
    r
}
async fn empty_now(app: &AppHandle, cookies_only: bool) -> Result<(), String> {
    let app = app.clone();
    for wv in things(&app) { let _ = wv.close(); }
    app.state::<Tabs>().0.lock().unwrap().clear();
    let (wv, _) = store_view(&app)?;
    let left = wipe(&wv, cookies_only).await;
    let _ = wv.close();
    match left? { 0 => Ok(()), n => Err(format!("{n} sites still hold data")) }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn u(s: &str) -> Url { Url::parse(s).unwrap() }
    #[test]
    fn a_doc_moves_on_google_only() {
        let s = site_of(&u("https://docs.google.com/document/d/x/edit"));
        assert!(allowed(&s, &u("https://accounts.google.com/signin")));
        assert!(allowed(&s, &u("https://ssl.gstatic.com/x.js")));
        assert!(allowed(&s, &u("about:blank")));
        for bad in ["https://evil.com/", "https://google.com.evil.com/", "https://notgoogle.com/", "http://docs.google.com/",
            "http://localhost:1420/", "tauri://localhost/", "https://user:pw@docs.google.com/", "javascript:alert(1)",
            "data:text/html,x", "about:config", "https://docs.google.com:8443/", "https://sites.google.com/view/evil",
            "https://storage.googleapis.com/evil/x.html", "https://x-abc.script.googleusercontent.com/", "https://script.google.com/macros/s/x"] {
            assert!(!allowed(&s, &u(bad)), "{bad}");
        }
    }
    #[test]
    fn figma_and_notion_add_google_sign_in_only() {
        assert!(allowed(&site_of(&u("https://www.figma.com/file/x")), &u("https://accounts.google.com/o/oauth2")));
        assert!(!allowed(&site_of(&u("https://www.figma.com/file/x")), &u("https://docs.google.com/")));
        assert!(allowed(&site_of(&u("https://www.notion.so/x")), &u("https://accounts.google.com/")));
        assert!(!allowed(&site_of(&u("https://github.com/a/b")), &u("https://accounts.google.com/")));
        let sp = site_of(&u("https://contoso.sharepoint.com/x"));
        assert!(allowed(&sp, &u("https://login.microsoftonline.com/")));
        assert!(allowed(&sp, &u("https://contoso.sharepoint.com/y")));
        assert!(!allowed(&sp, &u("https://evil.sharepoint.com/")), "another tenant");
        let ns = site_of(&u("https://alice.notion.site/p"));
        assert!(!allowed(&ns, &u("https://mallory.notion.site/")), "another person's Notion page");
    }
    #[test]
    fn github_signup_alone_adds_google_and_the_puzzle() {
        let join = site_of(&u("https://github.com/signup"));
        for ok in ["https://accounts.google.com/o/oauth2/v2/auth", "https://octocaptcha.com/", "https://github-api.arkoselabs.com/fc/gc/",
            "https://client-api.arkoselabs.com/v2/x", "https://accounts.youtube.com/accounts/CheckConnection",
            "https://geo.captcha-delivery.com/captcha/", "https://github.com/login/device", "https://github.githubassets.com/x.js"] {
            assert!(allowed(&join, &u(ok)), "{ok}");
        }
        for bad in ["https://docs.google.com/", "https://evil.com/", "https://arkoselabs.com.evil.com/", "https://octocaptcha.com.evil.com/",
            "https://alice.github.io/"] {
            assert!(!allowed(&join, &u(bad)), "{bad}");
        }
        for not_join in ["https://github.com/a/b", "https://github.com/signupx", "https://gist.github.com/signup", "https://github.com/a/signup"] {
            let s = site_of(&u(not_join));
            assert!(!allowed(&s, &u("https://accounts.google.com/")) && !allowed(&s, &u("https://octocaptcha.com/")), "{not_join}");
        }
        assert!(allowed(&site_of(&u("https://github.com/signup?source=login")), &u("https://octocaptcha.com/")));
    }
    #[test]
    fn a_page_of_its_own_keeps_its_host() {
        let s = site_of(&u("https://sol.matterfold.tech/beta"));
        assert!(allowed(&s, &u("https://sol.matterfold.tech/x")) && allowed(&s, &u("https://www.sol.matterfold.tech/")));
        assert!(!allowed(&s, &u("https://matterfold.tech/")) && !allowed(&s, &u("https://accounts.google.com/")));
        let gh = site_of(&u("https://alice.github.io/x"));
        assert!(!allowed(&gh, &u("https://mallory.github.io/")), "a neighbour on a shared host");
        let ip = site_of(&u("https://192.168.0.1/"));
        assert!(!allowed(&ip, &u("https://10.0.0.1/")) && !allowed(&ip, &u("https://10.20.0.1/")));
        assert!(site_of(&u("https://localhost/")).is_empty(), "one label: no site at all");
    }
    #[test]
    fn the_face_sees_origin_and_path_only() {
        assert_eq!(shown(&u("https://accounts.google.com/o/oauth2/x?code=SECRET#token=T")), "https://accounts.google.com/o/oauth2/x");
        assert_eq!(shown(&u("blob:https://example.com/abc")), "blob:");
        assert_eq!(shown(&u("https://docs.google.com:8443/a")), "https://docs.google.com:8443/a");
    }
    #[test]
    fn the_brake_lets_one_through_a_while() {
        assert!(gate("test brake", Duration::from_secs(5)));
        assert!(!gate("test brake", Duration::from_secs(5)));
        assert!(gate("test brake other", Duration::from_secs(5)));
    }
    #[test]
    fn no_capability_names_the_main_window() {
        // a capability on window "main" would reach every thing's child web view too (Tauri matches window or web view)
        for (name, text) in [("default", include_str!("../capabilities/default.json")), ("default-hot", include_str!("../capabilities/default-hot.json"))] {
            let v: serde_json::Value = serde_json::from_str(text).unwrap();
            assert!(v.get("windows").is_none(), "{name} names windows; name web views");
            assert!(v["webviews"].as_array().unwrap().iter().all(|w| !w.as_str().unwrap().starts_with("thing")), "{name}");
        }
    }
    #[test]
    fn a_google_redirect_is_its_link() {
        assert_eq!(unwrap_redirect(&u("https://www.google.com/url?q=https://example.com/a%3Fb&sa=D")).as_str(), "https://example.com/a?b");
        assert_eq!(unwrap_redirect(&u("https://www.google.com/url?q=javascript:alert(1)")).as_str(), "https://www.google.com/url?q=javascript:alert(1)");
        assert_eq!(unwrap_redirect(&u("https://evil.com/url?q=https://x.com/")).as_str(), "https://evil.com/url?q=https://x.com/");
    }
    #[test]
    fn tabs_are_names_not_paths() {
        assert!(tab_ok("a1b2c3d4") && tab_ok("a1b2c3d4.2"));
        assert!(!tab_ok("") && !tab_ok("../main") && !tab_ok("a b") && !tab_ok(&"x".repeat(41)));
    }
}
