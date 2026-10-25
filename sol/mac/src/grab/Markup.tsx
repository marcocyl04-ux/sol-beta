// Markup: the picture Sol just took, held still in the middle of the screen, to draw on. It lifts off the desk from
// where the window was to its place (one progress spring, CFG.glide), the bead lands on its top-left corner and its
// eyes follow the pen. Tools in a black pill at the bottom: pen · box · arrow · text · undo · Done; marks are red
// #fd302d, 2.5 px, round caps; an arrow is a line and a head; text is typed in place and becomes a drawn string.
//
// The marks are a list (undo pops the last) redrawn on a canvas the size of the picture on screen, at the screen's
// pixel ratio. Done draws the original at its natural size and the same marks scaled up to it: that PNG is what goes.
//
// The picture's size on screen: a screenshot's pixels are the screen's (2 per point on a Retina screen), so its size
// in points is natural / devicePixelRatio, shrunk to fit 80 % of the screen, never enlarged. A Page grab (`tall`) can be
// many screens high: it is fitted by width only, starts under the line, and scrolls inside the sheet; the tools stay put.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CFG, Spring, enter } from "../motion";
import { BEAD, type Bead } from "./Bead";
import type { Rect } from "./Room";

export type Stroke =
  | { t: "pen"; pts: [number, number][] }
  | { t: "box" | "arrow"; a: [number, number]; b: [number, number] }
  | { t: "text"; at: [number, number]; s: string };
type Tool = "pen" | "box" | "arrow" | "text";
// the one red, --red-strong from palette.css (design/palette.json), read once
const RED = getComputedStyle(document.documentElement).getPropertyValue("--red-strong").trim() || "#fd302d", WIDTH = 2.5, FONT = 13;

/** draw marks given in on-screen picture points, `k` times larger */
export function drawStrokes(g: CanvasRenderingContext2D, strokes: Stroke[], k: number) {
  g.strokeStyle = RED; g.fillStyle = RED; g.lineWidth = WIDTH * k; g.lineCap = "round"; g.lineJoin = "round";
  for (const s of strokes) {
    g.beginPath();
    if (s.t === "pen") {
      s.pts.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
      if (s.pts.length === 1) g.lineTo(s.pts[0][0] * k + 0.01, s.pts[0][1] * k);
      g.stroke();
    } else if (s.t === "box") {
      g.roundRect(Math.min(s.a[0], s.b[0]) * k, Math.min(s.a[1], s.b[1]) * k, Math.abs(s.b[0] - s.a[0]) * k, Math.abs(s.b[1] - s.a[1]) * k, 3 * k);
      g.stroke();
    } else if (s.t === "arrow") {
      const [x1, y1] = s.a, [x2, y2] = s.b, ang = Math.atan2(y2 - y1, x2 - x1), head = Math.min(14, Math.hypot(x2 - x1, y2 - y1) * 0.4);
      g.moveTo(x1 * k, y1 * k); g.lineTo(x2 * k, y2 * k);
      g.moveTo((x2 - head * Math.cos(ang - 0.45)) * k, (y2 - head * Math.sin(ang - 0.45)) * k); g.lineTo(x2 * k, y2 * k);
      g.lineTo((x2 - head * Math.cos(ang + 0.45)) * k, (y2 - head * Math.sin(ang + 0.45)) * k);
      g.stroke();
    } else if (s.t === "text") {
      g.font = `600 ${FONT * k}px -apple-system, system-ui, sans-serif`; g.textBaseline = "top";
      g.fillText(s.s, s.at[0] * k, s.at[1] * k);
    }
  }
}

/** a tall picture's top: under the line, which sits at the top centre */
const TALL_TOP = 104;
/** where the picture sits on screen: natural / dpr, fitted into 80 % of the page, centred; a tall one (Page) fitted by
 *  width only, from TALL_TOP down, when it would not fit the screen's height anyway */
export function fitRect(nw: number, nh: number, tall = false): Rect {
  const dpr = window.devicePixelRatio || 1, pw = nw / dpr, ph = nh / dpr;
  if (tall) {
    const k = Math.min(1, (innerWidth * 0.8) / pw), w = Math.round(pw * k), h = Math.round(ph * k);
    if (h > innerHeight * 0.8) return { x: Math.round((innerWidth - w) / 2), y: TALL_TOP, w, h };
  }
  const s = Math.min(1, (innerWidth * 0.8) / pw, (innerHeight * 0.8) / ph);
  const w = Math.round(pw * s), h = Math.round(ph * s);
  return { x: Math.round((innerWidth - w) / 2), y: Math.round((innerHeight - h) / 2) - 6, w, h };
}

/** the PNG that goes: the original at natural size with the marks scaled to it */
export function exportPng(img: HTMLImageElement, strokes: Stroke[], shownW: number): string {
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
  drawStrokes(g, strokes, img.naturalWidth / shownW);
  return c.toDataURL("image/png");
}

const ICON: Record<Tool | "undo", React.ReactNode> = {
  pen: <path d="M3 13l1-3.5L11 2.5a1.4 1.4 0 0 1 2 2L6 11.5z M10 4l2 2" />,
  box: <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />,
  arrow: <path d="M3 13L13 3M7 3h6v6" />,
  text: <path d="M3 4V3h10v1M8 3v10M6 13h4" />,
  undo: <path d="M5 3L2 6l3 3M2 6h7a4 4 0 0 1 0 8H6" />,
};

export function Markup({ img, from, bead, say, start, tall, onDone }: {
  img: HTMLImageElement; from: Rect | null; bead: Bead | null; say: (t: string) => void; start?: Stroke[]; tall?: boolean;
  onDone: (png: string, at: Rect) => void;
}) {
  const at = useRef(fitRect(img.naturalWidth, img.naturalHeight, tall)).current;
  const scrolls = at.y + at.h > innerHeight;   // a tall Page: the picture scrolls in the sheet
  const [tool, setTool] = useState<Tool>("pen");
  const [strokes, setStrokes] = useState<Stroke[]>(start ?? []);
  const [typing, setTyping] = useState<{ x: number; y: number; s: string } | null>(null);
  const live = useRef<Stroke | null>(null);
  const pic = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), bar = useRef<HTMLDivElement>(null), field = useRef<HTMLInputElement>(null);

  const redraw = useCallback(() => {
    const c = cv.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1, g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    drawStrokes(g, live.current ? [...strokes, live.current] : strokes, dpr);
  }, [strokes]);
  useEffect(redraw, [redraw]);

  // the picture lifts off the desk to its place; the bead lands on its corner; the tools rise one by one
  useLayoutEffect(() => {
    say(scrolls ? "Mark it; scroll for the rest. Return when done." : "Mark it. Return when done.");
    const el = pic.current!, f = from ?? { x: at.x, y: at.y + 24, w: at.w, h: at.h };
    const s = new Spring(0, CFG.glide, (p) => {
      const k = f.w / at.w + (1 - f.w / at.w) * p;
      el.style.transform = `translate(${(f.x - at.x) * (1 - p)}px, ${(f.y - at.y) * (1 - p)}px) scale(${k})`;
    });
    s.to(1);
    void bead?.hop(at.x - BEAD / 2 - 2, at.y - BEAD / 2 - 2, { lift: 30, ms: 700 }).then(() => bead?.look(3, 3));
    [...(bar.current?.children ?? [])].forEach((b, i) => enter(b as HTMLElement, { y: 12, delay: 200 + i * 50, cfg: CFG.snap }));
    enter(bar.current!, { y: 30, cfg: CFG.slide });
    return () => s.stop();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: React.PointerEvent): [number, number] => {
    const r = cv.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * at.w, ((e.clientY - r.top) / r.height) * at.h];
  };
  const commitText = () => {
    if (typing && typing.s.trim()) setStrokes((l) => [...l, { t: "text", at: [typing.x, typing.y], s: typing.s.trim() }]);
    setTyping(null);
  };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = point(e);
    if (tool === "text") { commitText(); setTyping({ x: p[0], y: p[1] - FONT / 2, s: "" }); return; }
    (e.target as Element).setPointerCapture(e.pointerId);
    live.current = tool === "pen" ? { t: "pen", pts: [p] } : { t: tool, a: p, b: p };
    redraw();
  };
  const move = (e: React.PointerEvent) => {
    bead?.lookAt(e.clientX, e.clientY);
    const s = live.current; if (!s) return;
    const p = point(e);
    if (s.t === "pen") s.pts.push(p); else if (s.t !== "text") s.b = p;
    redraw();
  };
  const up = () => {
    const s = live.current; live.current = null;
    if (!s) return;
    const tiny = s.t !== "pen" && s.t !== "text" && Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) < 3;
    if (!tiny) setStrokes((l) => [...l, s]); else redraw();
    bead?.nod();
  };
  const undo = () => setStrokes((l) => l.slice(0, -1));
  const done = useCallback(() => {
    const all = typing && typing.s.trim() ? [...strokes, { t: "text" as const, at: [typing.x, typing.y] as [number, number], s: typing.s.trim() }] : strokes;
    try { onDone(exportPng(img, all, at.w), at); }
    catch (err) { say(`Could not make the picture: ${(err as Error).message}`); }
  }, [typing, strokes, img, at, onDone, say]);

  useEffect(() => { if (typing) field.current?.focus(); }, [typing != null]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Enter") { e.preventDefault(); done(); }
      else if (e.key === "z" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [done]);

  const dpr = window.devicePixelRatio || 1;
  const picture = (
      <div className="pic" ref={pic} style={{ left: at.x, top: at.y, width: at.w, height: at.h }}>
        <img src={img.src} alt="" draggable={false} crossOrigin="anonymous" />   {/* crossOrigin: the same request the loader made; a bare one has no Origin and the engine's door refuses it (a "?" where the picture should be) */}
        <canvas ref={cv} width={Math.round(at.w * dpr)} height={Math.round(at.h * dpr)} className={`tool-${tool}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        {typing && (
          <input ref={field} className="type-in" style={{ left: typing.x, top: typing.y }} value={typing.s} placeholder="type, Return"
            size={Math.max(8, typing.s.length + 1)}
            onChange={(e) => setTyping({ ...typing, s: e.target.value })} onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commitText(); }
              else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setTyping(null); }
            }} />
        )}
      </div>
  );
  return (
    <div className="markup">
      {scrolls
        ? <div className="markup-scroll">{picture}<div style={{ height: at.y + at.h + 110 }} /></div>
        : picture}
      <div className="tools" ref={bar}>
        {(["pen", "box", "arrow", "text"] as Tool[]).map((t) => (
          <button key={t} className={`tool${tool === t ? " on" : ""}`} title={t} onClick={() => { commitText(); setTool(t); }}>
            <svg viewBox="0 0 16 16">{ICON[t]}</svg>
          </button>
        ))}
        <button className="tool" title="undo" onClick={undo} disabled={!strokes.length}><svg viewBox="0 0 16 16">{ICON.undo}</svg></button>
        <button className="tool done on" onClick={done}>Done</button>
      </div>
    </div>
  );
}
