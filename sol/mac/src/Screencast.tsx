import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Frame } from "./useEngine";

// One browser tab as the face shows it: the engine's screencast frames (browser.frame) on a stage whose size the tab
// takes (browser.resize), and Marco's pointer and keys sent back (browser.input), so the page is live. Two panes draw
// it: the browser (Browser.tsx, with its tabs and address) and Work's page pane (an artifact on claude.ai, with pins).
// A press the owner holds back from the page (`hold`, or any press when the page is not `live`) is the owner's: a drag
// draws a box and hands over that area of the frame (onMark); a click, or a drag nobody marks with, is a pick (onPick,
// in the tab's CSS px). The wheel always reaches the page. `over` draws on top of the frame: it is given the scale
// from the tab's CSS px to the frame as shown, and the frame's size on show.
// Frames are watched only while the stage has a size: a pane kept mounted behind another tab claims nothing, and
// does not let go either (its "stop" could land after the other pane's "watch" and leave that one frozen).
export type Box = { x: number; y: number; w: number; h: number };

export function Screencast({ tab, send, subscribe, live = true, hold, marking, onPick, onMark, onInput, onFrame, over, blank }: {
  tab?: string;
  send: (o: object) => void; subscribe: (fn: (f: Frame) => void) => () => void;
  live?: boolean;                                       // false: only the wheel reaches the page, every press is held
  hold?: (ev: { altKey: boolean }) => boolean;          // which presses are held back while live (default: option)
  marking?: boolean;                                    // the crosshair, before a press
  onPick?: (p: { x: number; y: number }) => void;
  onMark?: (m: { data: string; box: Box }) => void;     // a PNG data url of the area, and the area in the tab's CSS px
  onInput?: () => void;                                 // after a press, a release, a wheel or a key reached the page
  onFrame?: (f: { w: number; h: number }) => void;
  over?: (k: number, shown: { w: number; h: number }) => ReactNode;
  blank?: ReactNode;                                    // what the stage shows before the first frame
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const pointer = useRef(false);
  const held = useRef<{ x: number; y: number } | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const cb = useRef({ onFrame, onInput, live });
  cb.current = { onFrame, onInput, live };
  const seen = size.w > 0 && size.h > 0;

  // the tab on show is watched once the stage is seen; a new tab (or none, or the pane going) lets the old one go
  useEffect(() => { setFrame(null); return () => send({ type: "browser.watch", tab: null }); }, [tab, send]);
  useEffect(() => { if (tab && seen) send({ type: "browser.watch", tab }); }, [tab, seen, send]);

  useEffect(() => subscribe((f) => {
    if (f.tab !== tabRef.current || !img.current) return;
    img.current.src = "data:image/jpeg;base64," + f.data;
    setFrame((p) => (p && p.w === f.w && p.h === f.h ? p : { w: f.w, h: f.h }));
    cb.current.onFrame?.(f);
  }), [subscribe]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the tab takes the stage's size (edge to edge, no letterbox): told once the size has held for a moment
  useEffect(() => {
    if (!tab || !seen) return;
    const t = setTimeout(() => send({ type: "browser.resize", tab, w: size.w, h: size.h }), 100);
    return () => clearTimeout(t);
  }, [tab, seen, size.w, size.h, send]);

  // keys reach a live page while the pointer is over it; a field of the face keeps its own typing, cmd stays Sol's
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const key = (ev: KeyboardEvent, type: "keyDown" | "keyUp") => {
      if (!pointer.current || !cb.current.live || typing(ev.target) || ev.metaKey || !tabRef.current) return;
      ev.preventDefault();
      const text = type === "keyDown" && ev.key.length === 1 ? ev.key : undefined;
      const modifiers = (ev.altKey ? 1 : 0) | (ev.ctrlKey ? 2 : 0) | (ev.shiftKey ? 8 : 0);
      send({ type: "browser.input", tab: tabRef.current, event: { kind: "key", type, key: ev.key, code: ev.code, text, modifiers } });
      cb.current.onInput?.();
    };
    const kd = (ev: KeyboardEvent) => key(ev, "keyDown");
    const ku = (ev: KeyboardEvent) => key(ev, "keyUp");
    window.addEventListener("keydown", kd, true);
    window.addEventListener("keyup", ku, true);
    return () => { window.removeEventListener("keydown", kd, true); window.removeEventListener("keyup", ku, true); };
  }, [send]);

  // displayed size: the frame at the stage's size once the tab has taken it, letterboxed only until then
  const k = frame && size.w ? Math.min(size.w / frame.w, size.h / frame.h) : 0;
  const shown = frame ? { w: Math.round(frame.w * k), h: Math.round(frame.h * k) } : { w: 0, h: 0 };

  const at = (ev: React.PointerEvent | React.WheelEvent) => {
    const r = ev.currentTarget.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const px = (p: { x: number; y: number }) => ({ x: Math.round((p.x / shown.w) * frame!.w), y: Math.round((p.y / shown.h) * frame!.h) });
  const mouse = (ev: React.PointerEvent | React.WheelEvent, type: string, extra: object = {}) => {
    if (!frame || !tab) return;
    send({ type: "browser.input", tab, event: { kind: "mouse", type, ...px(at(ev)), ...extra } });
    if (type !== "mouseMoved") onInput?.();
  };

  // a field drawn over the frame (a pin's comment) keeps its own pointer
  const fromOver = (ev: React.PointerEvent) => ev.target !== ev.currentTarget && !(ev.target instanceof HTMLImageElement);
  const down = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!frame || ev.button !== 0 || fromOver(ev)) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    if (!live || hold?.(ev) || (!hold && ev.altKey)) { const p = at(ev); held.current = p; setBox(onMark ? { x: p.x, y: p.y, w: 0, h: 0 } : null); return; }
    mouse(ev, "mousePressed", { button: "left", clickCount: 1 });
  };
  const move = (ev: React.PointerEvent<HTMLDivElement>) => {
    const s = held.current;
    if (!s) { if (live) mouse(ev, "mouseMoved"); return; }
    if (!onMark) return;
    const p = at(ev);
    const cl = (v: number, m: number) => Math.min(m, Math.max(0, v));
    const x2 = cl(p.x, shown.w), y2 = cl(p.y, shown.h);
    setBox({ x: Math.min(s.x, x2), y: Math.min(s.y, y2), w: Math.abs(x2 - s.x), h: Math.abs(y2 - s.y) });
  };
  const up = (ev: React.PointerEvent<HTMLDivElement>) => {
    const s = held.current;
    if (!s) { if (ev.button === 0 && !fromOver(ev)) mouse(ev, "mouseReleased", { button: "left", clickCount: 1 }); return; }
    held.current = null;
    setBox(null);
    if (!frame) return;
    if (onMark && box && box.w >= 6 && box.h >= 6 && img.current) {
      // the crop is taken in the image's own pixels: a frame is the tab's CSS px times the engine's scale (2)
      const W = img.current.naturalWidth || frame.w, H = img.current.naturalHeight || frame.h;
      const sx = (box.x / shown.w) * W, sy = (box.y / shown.h) * H, sw = (box.w / shown.w) * W, sh = (box.h / shown.h) * H;
      const c = document.createElement("canvas");
      c.width = Math.round(sw); c.height = Math.round(sh);
      c.getContext("2d")!.drawImage(img.current, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const a = px({ x: box.x, y: box.y }), b = px({ x: box.x + box.w, y: box.y + box.h });
      onMark({ data: c.toDataURL("image/png"), box: { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y } });
    } else onPick?.(px(s));
  };

  return (
    <div className="stage" ref={stage}>
      <div className={`page ${box || marking ? "marking" : ""}`} style={{ width: shown.w, height: shown.h, display: frame ? "block" : "none" }}
        onPointerEnter={() => { pointer.current = true; }}
        onPointerLeave={() => { pointer.current = false; }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up}
        onWheel={(e) => mouse(e, "mouseWheel", { deltaX: e.deltaX, deltaY: e.deltaY })}>
        <img ref={img} alt="" draggable={false} />
        {box && <div className="box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
        {frame && over?.(k, shown)}
      </div>
      {!frame && <div className="blank">{blank ?? <i className="spin" />}</div>}
    </div>
  );
}
