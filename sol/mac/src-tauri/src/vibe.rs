// Vibe mode: the face moves a little with the music (vibe.ts in the face). What the Mac plays comes through a Core
// Audio process tap in a small Swift helper, vibe/tap.swift: build.rs compiles it and this file carries the binary,
// writes it beside the app's state the first time (or when a build changed it) and runs it when the face asks.
// The helper prints two loudness numbers thirty times a second; each line goes to every window as a `vibe` event.
// Its stdin is a pipe from this process: when Sol dies the pipe closes and the helper ends with it. Nothing is
// recorded or kept. macOS asks once for "system audio recording" (Info.plist NSAudioCaptureUsageDescription).
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

static TAP: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/vibe-tap"));
static RUN: Mutex<Option<Child>> = Mutex::new(None);
static RUN_GEN: AtomicU32 = AtomicU32::new(0);   // which start the helper belongs to: an old one's end says nothing

/// The helper's slot; a panic while it was held does not keep every later call from it.
fn run() -> std::sync::MutexGuard<'static, Option<Child>> {
    RUN.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, serde::Serialize)]
pub struct Level {
    full: f32, // the loudness of everything, an rms over the last 33 ms
    low: f32,  // the loudness of the low end (under ~120 Hz), where the beat is
}

/// The helper on disk, beside the app's state, written when it is not there or differs from this build's.
fn helper(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    if TAP.is_empty() {
        return Err("no vibe tap in this build".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join("vibe-tap");
    if !std::fs::read(&p).map(|b| b == TAP).unwrap_or(false) {
        std::fs::write(&p, TAP).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
    }
    Ok(p)
}

/// Start hearing the Mac's sound; already hearing: nothing. Levels arrive as `vibe` events; `vibe-off` when the
/// helper ends (quit, killed, or it could not start: then `vibe-error` said why first).
#[tauri::command]
pub fn vibe_start(app: AppHandle) -> Result<(), String> {
    let mut run = run();
    if let Some(c) = run.as_mut() {
        if matches!(c.try_wait(), Ok(None)) {
            return Ok(());
        }
    }
    let p = helper(&app)?;
    let mut child = Command::new(&p)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("vibe tap: {e}"))?;
    let out = child.stdout.take().ok_or("vibe tap: no stdout")?;
    let err = child.stderr.take().ok_or("vibe tap: no stderr")?;
    let turn = RUN_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let a = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if RUN_GEN.load(Ordering::SeqCst) != turn { break; }   // a newer start has the floor
            let mut it = line.split_whitespace().filter_map(|s| s.parse::<f32>().ok());
            if let (Some(full), Some(low)) = (it.next(), it.next()) {
                let _ = a.emit("vibe", Level { full, low });
            }
        }
        if RUN_GEN.load(Ordering::SeqCst) == turn { let _ = a.emit("vibe-off", ()); }
    });
    let a = app.clone();
    std::thread::spawn(move || {
        // the helper speaks on stderr only when it cannot start (which call failed, and the OSStatus)
        for line in BufReader::new(err).lines().map_while(Result::ok) {
            eprintln!("vibe tap: {line}");
            if RUN_GEN.load(Ordering::SeqCst) == turn { let _ = a.emit("vibe-error", line); }
        }
    });
    *run = Some(child);
    Ok(())
}

/// Stop hearing. The helper is killed; its tap and aggregate device go with it.
#[tauri::command]
pub fn vibe_stop() {
    RUN_GEN.fetch_add(1, Ordering::SeqCst);   // whatever the helper still says is not for the face
    if let Some(mut c) = run().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

// The glow window (vibe.html, src/vibe/glow.ts): the size of the screen the main window is on, transparent, above
// everything and on every space like the notch (lib.rs raise), the mouse going through it. Made the first time the
// glow is asked for, hidden a moment after it is told to go (the page draws the ring back in first).
static GLOW_GEN: AtomicU32 = AtomicU32::new(0);

#[derive(Clone, serde::Serialize)]
struct Glow { on: bool, x: f64, y: f64, colours: Vec<String>, bright: f64, size: f64, music: bool }

/// The glow on or off, spreading from (x, y): a point in the main window's page (CSS px), the sidebar's mark.
#[tauri::command]
pub fn vibe_glow(app: AppHandle, on: bool, x: f64, y: f64, colours: Vec<String>, screen: Option<bool>, bright: Option<f64>, size: Option<f64>, music: Option<bool>) -> Result<(), String> {
    glow(&app, on, x, y, colours, screen.unwrap_or(false), bright.unwrap_or(0.2), size.unwrap_or(1.0), music.unwrap_or(false))
}
fn glow(app: &AppHandle, on: bool, x: f64, y: f64, colours: Vec<String>, screen: bool, bright: f64, size: f64, music: bool) -> Result<(), String> {
    let app = app.clone();
    let main = app.get_window("main").ok_or("no main window")?;   // a window, it may hold a thing too (thing.rs)
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let pos = main.outer_position().map_err(|e| e.to_string())?;
    let mon = main.current_monitor().map_err(|e| e.to_string())?.or_else(|| app.primary_monitor().ok().flatten()).ok_or("no screen")?;
    let ms = mon.scale_factor();
    let (mx, my) = (mon.position().x as f64 / ms, mon.position().y as f64 / ms);
    let (mw, mh) = (mon.size().width as f64 / ms, mon.size().height as f64 / ms);
    // the mark on the screen, then in the glow window's own page
    let (sx, sy) = if screen { (x - mx, y - my) } else { (pos.x as f64 / scale + x - mx, pos.y as f64 / scale + y - my) };
    let turn = GLOW_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let w = match app.get_webview_window("vibe") {
        Some(w) => w,
        None => {
            if !on { return Ok(()); }
            // The page: Vite's while the face is hot (hot.rs, as the grab sheet's first page: a hot face is the checkout's
            // code, and so is its glow; hot's flips move this window too, LABELS), else the bundled one, which must be in
            // this build: a page Vite did not emit (sol/mac/vite.config.ts build.rollupOptions.input) is answered by Tauri
            // with index.html, and this window, the size of the screen and above everything, would wear the whole face
            // (2026-10-26 to 10-29: a stale vite.config.js left vibe.html out).
            let url = if crate::hot::is_on(&app) {
                tauri::Url::parse(&format!("{}/vibe.html", crate::hot::DEV)).map(WebviewUrl::External).map_err(|e| e.to_string())?
            } else {
                let assets = app.asset_resolver();
                if assets.iter().next().is_some() && !assets.iter().any(|(p, _)| p.trim_start_matches('/') == "vibe.html") {
                    return Err("the glow's page (vibe.html) is not in this build of Sol: no glow until the face is built with it (sol/mac/vite.config.ts)".into());
                }
                WebviewUrl::App("vibe.html".into())
            };
            let w = WebviewWindowBuilder::new(&app, "vibe", url)
                .title("Sol vibe")
                .position(mx, my)
                .inner_size(mw, mh)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible_on_all_workspaces(true)
                .focused(false)
                .resizable(false)
                .accept_first_mouse(false)
                .disable_drag_drop_handler()
                .visible(false)
                .build()
                .map_err(|e| e.to_string())?;
            crate::raise(&w);
            let _ = w.set_ignore_cursor_events(true);
            w
        }
    };
    if on {
        let _ = w.set_position(tauri::LogicalPosition::new(mx, my));
        let _ = w.set_size(tauri::LogicalSize::new(mw, mh));
        let _ = w.show();
        let _ = w.set_ignore_cursor_events(true);
        // the page may still be loading the first time: say it again shortly
        let a = app.clone();
        std::thread::spawn(move || {
            for ms in [0u64, 250, 700, 1500] {
                std::thread::sleep(std::time::Duration::from_millis(ms));
                if GLOW_GEN.load(Ordering::SeqCst) != turn { return; }   // told something newer meanwhile
                let _ = a.emit_to("vibe", "vibe-glow", Glow { on: true, x: sx, y: sy, colours: colours.clone(), bright, size, music });
            }
        });
    } else {
        let _ = app.emit_to("vibe", "vibe-glow", Glow { on: false, x: sx, y: sy, colours, bright, size, music });
        let a = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1400));
            if GLOW_GEN.load(Ordering::SeqCst) != turn { return; }   // asked for again meanwhile
            let b = a.clone();
            let _ = a.run_on_main_thread(move || { if let Some(w) = b.get_webview_window("vibe") { let _ = w.hide(); } });
        });
    }
    Ok(())
}
