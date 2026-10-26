// The clean screen's picture (#253): the native half, with no Tauri
// in it, so a standalone probe can include this very file and prove the frames arrive. clean.rs (the Tauri commands)
// is the only other user.
//
// What it does: one plain AppKit window (no webview) the size of the main display, at the normal level and sent behind
// every other window, whose content view hosts one CALayer. A ScreenCaptureKit stream on the main display, filtered to
// leave out the applications on the private list and Sol itself, hands a frame (an IOSurface) to that layer up to FPS
// times a second, at most MAX_SIDE pixels on its longer side, scaled to fit. Excluding the application, not its windows, means a window the app opens later is cut
// out too, from its first frame; the wallpaper shows where its windows were. Sol is always excluded, so the clean
// window never films itself (no mirror tunnel) and no Sol window ever reaches the picture.
//
// Order matters: the window is made first and the capture content fetched after, because ScreenCaptureKit lists a
// process as an application only once it has a window. Fetched before, Sol's own entry can be missing and the clean
// window films itself, a tunnel of itself (seen in the probe, 2026-10-25). `filter` finds Sol through the clean
// window's own owning application, and by process id as well.
//
// Threads: the window, the layer and the frames live on the main thread (the stream delivers to the main queue, so the
// layer is only ever touched there). Only `content()`, which asks ScreenCaptureKit what can be captured, runs off it:
// it waits for a callback that may land on any queue, so it must never block the main thread.
//
// The window is never content-protected (it is what Marco shares) and has no minimize button: a minimized window is
// not drawn, so a share of it would freeze.
#![allow(non_snake_case)]   // the delegate methods carry their Objective-C selectors' names
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSScreen, NSUserInterfaceItemIdentification, NSView, NSWindow, NSWindowDelegate,
    NSWindowSharingType, NSWindowStyleMask,
};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{CMSampleBuffer, CMTime};
use objc2_core_video::CVPixelBufferGetIOSurface;
use objc2_foundation::{NSArray, NSError, NSNotification, NSObject, NSObjectProtocol, NSString};
use objc2_quartz_core::{kCAGravityResizeAspect, CALayer, CATransaction};
use objc2_screen_capture_kit::{
    SCContentFilter, SCDisplay, SCRunningApplication, SCShareableContent, SCStream, SCStreamConfiguration, SCStreamOutput,
    SCStreamOutputType,
};

/// frames a second the stream is asked for: a share is sent on at 15 to 30 by the call app, and every frame here is
/// filmed once more by it, so more than 24 only costs
pub const FPS: i32 = 24;
/// the picture's longer side in pixels at most: a Retina display is 2560 x 1664 pixels, and the call app sends a share
/// on at 1080p at best, so filming every pixel (4.3 million, 30 times a second) was work for nothing and the lag Marco
/// saw while sharing (2026-10-26); at 1920 the text is still sharp on the far side
pub const MAX_SIDE: f64 = 1920.0;

/// An Objective-C object carried across a thread once, by hand: ScreenCaptureKit's objects are safe to hand over, the
/// crate just cannot know it. Used only to move what `content()` fetched onto the main thread.
pub struct Sendable<T>(pub T);
unsafe impl<T> Send for Sendable<T> {}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGMainDisplayID() -> u32;
}

fn said(e: *mut NSError) -> String {
    unsafe { e.as_ref() }.map(|e| e.localizedDescription().to_string()).unwrap_or_else(|| "no reason given".into())
}

/// What can be captured right now (displays, running apps). Off the main thread only: it waits up to 5 s for
/// ScreenCaptureKit's answer. Without Screen Recording permission this is where it fails.
pub fn content() -> Result<Sendable<Retained<SCShareableContent>>, String> {
    let (tx, rx) = mpsc::channel::<Result<Sendable<Retained<SCShareableContent>>, String>>();
    let block = RcBlock::new(move |c: *mut SCShareableContent, e: *mut NSError| {
        let r = match unsafe { Retained::retain(c) } {
            Some(c) => Ok(Sendable(c)),
            None => Err(format!("the screen could not be read: {}", said(e))),
        };
        let _ = tx.send(r);
    });
    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&block) };
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "the screen did not answer in 5 s".to_string())?
}

/// The filter: the main display (the one with the menu bar), minus every running app whose bundle id is in `bundles`,
/// minus this very process (Sol, and so the clean window `own`, by its owning application and by process id).
pub fn filter(content: &SCShareableContent, bundles: &[String], own: u32) -> Result<Retained<SCContentFilter>, String> {
    let main = unsafe { CGMainDisplayID() };
    let displays = unsafe { content.displays() };
    let display: Retained<SCDisplay> = displays.iter().find(|d| unsafe { d.displayID() } == main)
        .or_else(|| displays.firstObject())
        .ok_or("no display to capture")?;
    let me = unsafe { content.windows() }.iter().find(|w| unsafe { w.windowID() } == own)
        .and_then(|w| unsafe { w.owningApplication() })
        .map(|a| unsafe { a.processID() })
        .unwrap_or(std::process::id() as i32);
    let out: Vec<Retained<SCRunningApplication>> = unsafe { content.applications() }.iter()
        .filter(|a| {
            let pid = unsafe { a.processID() };
            pid == me || pid == std::process::id() as i32 || bundles.iter().any(|b| *b == unsafe { a.bundleIdentifier() }.to_string())
        })
        .collect();
    if !out.iter().any(|a| unsafe { a.processID() } == me) {
        return Err("the clean screen could not find Sol's own windows to leave out".into());   // never film itself
    }
    let apps = NSArray::from_retained_slice(&out);
    let none = NSArray::new();
    let f = unsafe {
        SCContentFilter::initWithDisplay_excludingApplications_exceptingWindows(SCContentFilter::alloc(), &display, &apps, &none)
    };
    // the menu bar names the front app and its menus ("WhatsApp File Edit ..."): left out, so a ticked app in front
    // does not leak even its name
    unsafe { f.setIncludeMenuBar(false) };
    Ok(f)
}

/// The stream's settings: the display scaled so its longer side is at most MAX_SIDE pixels (its own pixel size when
/// that is smaller), BGRA, FPS a second, the pointer drawn, three frames queued (fewer in flight, less behind).
fn config(filter: &SCContentFilter) -> Retained<SCStreamConfiguration> {
    unsafe {
        let c = SCStreamConfiguration::new();
        let r = filter.contentRect();
        let scale = (filter.pointPixelScale() as f64).max(1.0);
        let k = scale.min((MAX_SIDE / r.size.width.max(r.size.height).max(1.0)).max(1.0));
        c.setWidth((r.size.width * k).round() as usize);
        c.setHeight((r.size.height * k).round() as usize);
        c.setMinimumFrameInterval(CMTime::new(1, FPS));
        c.setPixelFormat(u32::from_be_bytes(*b"BGRA"));
        c.setShowsCursor(true);
        c.setQueueDepth(3);
        c
    }
}

pub struct FramesIvars {
    layer: Retained<CALayer>,
}

define_class!(
    // The stream's output: each screen frame's IOSurface becomes the layer's contents. Delivered on the main queue.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "SolCleanFrames"]
    #[ivars = FramesIvars]
    pub struct Frames;

    unsafe impl NSObjectProtocol for Frames {}

    unsafe impl SCStreamOutput for Frames {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        unsafe fn stream_didOutputSampleBuffer_ofType(&self, _stream: &SCStream, buf: &CMSampleBuffer, kind: SCStreamOutputType) {
            if kind != SCStreamOutputType::Screen { return; }
            // an idle frame (nothing moved) carries no picture: the last one stays up
            let Some(img) = (unsafe { buf.image_buffer() }) else { return };
            let Some(surface) = CVPixelBufferGetIOSurface(Some(&img)) else { return };
            let obj: &AnyObject = unsafe { &*(CFRetained::as_ptr(&surface).as_ptr() as *const AnyObject) };
            CATransaction::begin();
            CATransaction::setDisableActions(true);   // no cross-fade between frames
            unsafe { self.ivars().layer.setContents(Some(obj)) };
            CATransaction::commit();
        }
    }
);

pub struct CloserIvars {
    on_close: Box<dyn Fn()>,
}

define_class!(
    // The window's delegate: its close button (or ⌘W) ends the capture through `on_close`.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "SolCleanCloser"]
    #[ivars = CloserIvars]
    pub struct Closer;

    unsafe impl NSObjectProtocol for Closer {}

    unsafe impl NSWindowDelegate for Closer {
        #[unsafe(method(windowWillClose:))]
        fn windowWillClose(&self, _n: &NSNotification) { (self.ivars().on_close)(); }
    }
);

/// One open clean screen: its window, the layer it shows, and the stream feeding it. Main thread only.
pub struct Capture {
    pub window: Retained<NSWindow>,
    _layer: Retained<CALayer>,
    frames: Retained<Frames>,
    _closer: Retained<Closer>,
    stream: Option<Retained<SCStream>>,
}

impl Capture {
    /// Make the window (titled `title`, identified as `ident`) and send it behind everything, black until `start`.
    /// `on_close` runs when the window is closed by hand.
    pub fn new(mtm: MainThreadMarker, title: &str, ident: &str, on_close: Box<dyn Fn()>) -> Result<Self, String> {
        let screens = NSScreen::screens(mtm);
        let screen = screens.firstObject().ok_or("no screen to cover")?;   // the first is the one with the menu bar
        let frame = screen.frame();
        let style = NSWindowStyleMask::Titled | NSWindowStyleMask::Closable | NSWindowStyleMask::Resizable;
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(NSWindow::alloc(mtm), frame, style, NSBackingStoreType::Buffered, false)
        };
        unsafe { window.setReleasedWhenClosed(false) };   // Rust holds it; AppKit must not free it on close
        window.setTitle(&NSString::from_str(title));
        window.setIdentifier(Some(&NSString::from_str(ident)));
        window.setSharingType(NSWindowSharingType::ReadOnly);   // always shareable, whatever the eye says
        window.setBackgroundColor(Some(&NSColor::blackColor()));
        window.setFrame_display(frame, true);

        let layer = CALayer::new();
        layer.setContentsGravity(unsafe { kCAGravityResizeAspect });
        let view = NSView::initWithFrame(NSView::alloc(mtm), frame);
        view.setLayer(Some(&layer));   // set first, then wantsLayer: a layer-hosting view, the layer is ours
        view.setWantsLayer(true);
        window.setContentView(Some(&view));

        let closer: Retained<Closer> = {
            let this = Closer::alloc(mtm).set_ivars(CloserIvars { on_close });
            unsafe { msg_send![super(this), init] }
        };
        window.setDelegate(Some(ProtocolObject::from_ref(&*closer)));

        let frames: Retained<Frames> = {
            let this = Frames::alloc(mtm).set_ivars(FramesIvars { layer: layer.clone() });
            unsafe { msg_send![super(this), init] }
        };
        let c = Capture { window, _layer: layer, frames, _closer: closer, stream: None };
        c.behind();
        Ok(c)
    }

    /// Frames with `filter` (made with this window's id, after the window exists): the stream is made and started the
    /// first time, and the receiver gets the start's outcome (wait for it off the main thread); later calls only change
    /// the filter and answer None.
    pub fn start(&mut self, filter: &SCContentFilter) -> Result<Option<mpsc::Receiver<Result<(), String>>>, String> {
        if let Some(s) = &self.stream {
            let done = RcBlock::new(|e: *mut NSError| {
                if !e.is_null() { eprintln!("clean: the filter did not change: {}", said(e)); }
            });
            unsafe { s.updateContentFilter_completionHandler(filter, Some(&done)) };
            return Ok(None);
        }
        let stream = unsafe { SCStream::initWithFilter_configuration_delegate(SCStream::alloc(), filter, &config(filter), None) };
        unsafe {
            stream.addStreamOutput_type_sampleHandlerQueue_error(
                ProtocolObject::from_ref(&*self.frames), SCStreamOutputType::Screen, Some(DispatchQueue::main()),
            )
        }.map_err(|e| format!("the clean screen could not take frames: {}", e.localizedDescription()))?;
        let (tx, rx) = mpsc::channel();
        let started = RcBlock::new(move |e: *mut NSError| {
            let _ = tx.send(if e.is_null() { Ok(()) } else { Err(format!("the clean screen could not start: {}", said(e))) });
        });
        unsafe { stream.startCaptureWithCompletionHandler(Some(&started)) };
        self.stream = Some(stream);
        Ok(Some(rx))
    }

    /// The window shown, behind every other window (a second "Clean screen" lands here too: it never jumps in front).
    pub fn behind(&self) {
        self.window.orderBack(None);
    }

    /// The window's number, as `screencapture -l` and the share pickers know it.
    pub fn window_id(&self) -> u32 {
        self.window.windowNumber() as u32
    }

    /// The stream stopped and let go (the window stays as it is). Safe to call twice.
    pub fn stop(&mut self) {
        if let Some(s) = self.stream.take() {
            unsafe {
                let _ = s.removeStreamOutput_type_error(ProtocolObject::from_ref(&*self.frames), SCStreamOutputType::Screen);
                s.stopCaptureWithCompletionHandler(None);
            }
        }
    }

    /// The stream stopped and the window closed, without calling `on_close` (the caller already knows).
    pub fn close(mut self) {
        self.window.setDelegate(None);
        self.stop();
        self.window.close();
    }
}
