// The clean screen (#253): the window Marco shares in Zoom or Meet
// instead of his whole screen. It shows the main display live with the private list's apps cut out (WeChat, WhatsApp,
// Claude, ChatGPT to start; the engine keeps the list, engine/src/private.ts) and Sol itself cut out too. No app can
// hide another app's windows from a share, so this is the only way to keep them out: share a picture that never had
// them. The picture itself (the window, the layer, the ScreenCaptureKit stream) is clean/capture.rs; this file is the
// Tauri side: four commands, the permission, and the one window's bookkeeping.
//
//   clean_open { bundles } -> window id   open the window behind everything (or, if open, take the new list and send
//                                         it behind again); bundles: the ticked apps' bundle ids
//   clean_set { bundles }                 the private list changed: the stream's filter is rebuilt, the window stays
//   clean_close                           the stream stopped, the window closed (its close button does the same)
//   clean_get -> bool                     open right now
// Every open and close is told to the pages as "clean-changed" (bool), so the notch's row draws the right state even
// when Marco closes the window by its button.
//
// The window is native (no webview), labelled "clean" (its identifier) and titled "Sol clean screen". eye.rs walks only
// Tauri's windows, so the eye never protects it: it stays shareable when Sol is invisible (rubric C4).
// Screen Recording: Sol itself films here (the grabs are the engine's). Missing, the answer is the plain sentence
// below and System Settings opens at the pane; macOS wants Sol reopened after the switch is turned on.
#[cfg(target_os = "macos")]
pub mod capture;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

/// what Marco reads when Sol may not film the screen
pub const NO_SCREEN: &str = "Sol needs Screen Recording to show the clean screen: switch Sol on in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen Sol";

/// the window's label (its identifier) and title
pub const LABEL: &str = "clean";
pub const TITLE: &str = "Sol clean screen";

static OPEN: AtomicBool = AtomicBool::new(false);

fn changed(app: &AppHandle, open: bool) {
    OPEN.store(open, Ordering::SeqCst);
    let _ = app.emit("clean-changed", open);
}

#[cfg(target_os = "macos")]
mod main_side {
    use super::capture::{self, Capture, Sendable};
    use objc2::MainThreadMarker;
    use objc2::rc::Retained;
    use objc2_screen_capture_kit::SCShareableContent;
    use std::cell::RefCell;
    use tauri::AppHandle;

    thread_local! {
        /// the one clean screen, on the main thread
        static NOW: RefCell<Option<Capture>> = const { RefCell::new(None) };
        /// a capture closed by its own button, kept until the next open or close (it cannot be freed inside its own
        /// windowWillClose)
        static GONE: RefCell<Option<Capture>> = const { RefCell::new(None) };
    }

    pub type Started = std::sync::mpsc::Receiver<Result<(), String>>;

    /// Main thread, step 1: the window, made if it is not there (black until step 2), sent behind everything. Its id.
    pub fn window(app: &AppHandle) -> Result<u32, String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        GONE.with(|g| g.borrow_mut().take());
        if let Some(id) = NOW.with(|n| n.borrow().as_ref().map(|c| { c.behind(); c.window_id() })) { return Ok(id); }
        let h = app.clone();
        let on_close = Box::new(move || {
            // closed by its button: stop the stream, keep the object until it is safe to drop, tell the pages
            let c = NOW.with(|n| n.try_borrow_mut().ok().and_then(|mut n| n.take()));
            if let Some(mut c) = c { c.stop(); GONE.with(|g| *g.borrow_mut() = Some(c)); }
            super::changed(&h, false);
        });
        let c = Capture::new(mtm, super::TITLE, super::LABEL, on_close)?;
        let id = c.window_id();
        NOW.with(|n| *n.borrow_mut() = Some(c));
        Ok(id)
    }

    /// Main thread, step 2 (and every clean_set): the filter from content fetched after the window existed. Starts
    /// the stream the first time (the start's outcome to wait for); later only changes the filter. Ok(None) as well
    /// when the window is gone meanwhile.
    pub fn frames(content: Sendable<Retained<SCShareableContent>>, bundles: &[String]) -> Result<Option<Started>, String> {
        NOW.with(|n| {
            let mut n = n.borrow_mut();
            let Some(c) = n.as_mut() else { return Ok(None) };
            let filter = capture::filter(&content.0, bundles, c.window_id())?;
            c.start(&filter)
        })
    }

    /// Main thread: stop and close; true when there was one.
    pub fn close() -> bool {
        GONE.with(|g| g.borrow_mut().take());
        let c = NOW.with(|n| n.borrow_mut().take());
        match c { Some(c) => { c.close(); true } None => false }
    }
}

/// Screen Recording granted, or the sentence (and System Settings opened at the pane).
#[cfg(target_os = "macos")]
fn may_film() -> Result<(), String> {
    if crate::permit::screen_trusted() { return Ok(()); }
    crate::permit::ask_screen();
    let _ = crate::permit::open_pane("Privacy_ScreenCapture");
    Err(NO_SCREEN.into())
}

/// What can be captured, fetched off the main thread (it waits on ScreenCaptureKit). A failure here is nearly always
/// the permission, so it answers the sentence.
#[cfg(target_os = "macos")]
async fn content() -> Result<capture::Sendable<objc2::rc::Retained<objc2_screen_capture_kit::SCShareableContent>>, String> {
    tauri::async_runtime::spawn_blocking(capture::content).await.map_err(|e| e.to_string())?
        .map_err(|e| { eprintln!("clean: {e}"); NO_SCREEN.to_string() })
}

/// Run `f` on the main thread and wait for its answer (AppKit's rule for windows).
fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || { let _ = tx.send(f()); }).map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}

/// Open the clean screen with these apps cut out (or, open already, take the new list). Answers the window's id.
#[tauri::command]
pub async fn clean_open(app: AppHandle, bundles: Vec<String>) -> Result<u32, String> {
    #[cfg(target_os = "macos")]
    {
        may_film()?;
        let h = app.clone();
        let id = on_main(&app, move || main_side::window(&h))??;
        let fail = |app: &AppHandle, e: String| { let _ = on_main(app, main_side::close); changed(app, false); Err(e) };
        let content = match content().await { Ok(c) => c, Err(e) => return fail(&app, e) };
        let started = match on_main(&app, move || main_side::frames(content, &bundles)) {
            Ok(Ok(s)) => s,
            Ok(Err(e)) | Err(e) => return fail(&app, e),
        };
        if let Some(started) = started {
            let r = tauri::async_runtime::spawn_blocking(move || started.recv_timeout(std::time::Duration::from_secs(5)))
                .await.map_err(|e| e.to_string())?;
            if let Ok(Err(e)) = r { return fail(&app, e); }
        }
        changed(&app, true);
        Ok(id)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, bundles);
        Err("the clean screen needs the Mac".into())
    }
}

/// The private list changed: the open clean screen cuts out exactly these apps now. Nothing when it is closed.
#[tauri::command]
pub async fn clean_set(app: AppHandle, bundles: Vec<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if !OPEN.load(Ordering::SeqCst) { return Ok(()); }
        let content = content().await?;
        on_main(&app, move || main_side::frames(content, &bundles))??;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, bundles);
        Ok(())
    }
}

/// Stop the capture and close the window.
#[tauri::command]
pub async fn clean_close(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    on_main(&app, main_side::close)?;
    changed(&app, false);
    Ok(())
}

/// True while the clean screen is open.
#[tauri::command]
pub fn clean_get() -> bool {
    OPEN.load(Ordering::SeqCst)
}
