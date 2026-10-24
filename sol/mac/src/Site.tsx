// A part of the window that Sol may be changing while Marco uses it (issue #15). <Site name> goes round each region
// in Life and in Work (the sidebar, the box, the talk, the panes...): it takes no room of its own (display: contents),
// it tells the tape where the region is, and it is a boundary, so a part that throws mid-change shows a dark field of
// cells under its tape ("this part broke mid-change, Sol is fixing it") while the rest of the window works on. The
// next update that lands tries it again. A boundary catches what its part draws and its effects; a click handler's or
// a promise's error is not its to catch, those go to one line in the engine drawer (renovation.ts).
//
// <Tape /> is the one canvas over the page that draws all of it, there only while a part is taped, on the creature's frame loop: the tape (a one-cell
// border of diagonal stripes in the colour of the seat at work, marching a cell at a time, its line in the corner), the
// landing (cells through the ring over the part, in Bayer order, like the Show's map when an edit lands), the peel
// (the tape comes off cell by cell, Bayer order) and the whole face's tape round the window's edge. Cells and steps,
// never a fade. Part of the fence with renovation.ts, sites.ts and hot.ts: the seat never edits these four.
import { Component, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { register, unregister } from "./creature/loop";
import { FAMILY, bayer, rgba, PAPER, type RGB } from "./creature/ring";
import { FUNCTIONAL } from "./creature/palette";
import { current, subscribe, broke, mended, useRenovation, pingLine, pingColour, LAND_MS, PEEL_MS, type Entry } from "./renovation";
import type { SiteName } from "./sites";

// ---- where each part is on this page ----
type Spot = { el: HTMLElement; measure?: string };
const spots = new Map<SiteName, Set<Spot>>();
type Box = { x: number; y: number; w: number; h: number };
function boxOf(name: SiteName): Box | null {
  if (name === "face" && spots.has("face")) return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  const set = spots.get(name);
  if (!set?.size) return null;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const s of set) {
    const els = s.measure ? [s.el.querySelector(s.measure)].filter(Boolean) as Element[] : Array.from(s.el.children);
    for (const c of els) {
      const q = c.getBoundingClientRect();
      if (q.width < 1 || q.height < 1) continue;
      l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    }
  }
  if (!isFinite(l)) return null;
  // a part slid off the window (the floating side, closed) keeps its tape as a strip on the edge it went out of
  const W = window.innerWidth, H = window.innerHeight;
  if (r <= 0) return { x: 0, y: Math.max(0, t), w: 6, h: Math.min(H, b) - Math.max(0, t) };
  if (l >= W) return { x: W - 6, y: Math.max(0, t), w: 6, h: Math.min(H, b) - Math.max(0, t) };
  const x = Math.max(0, l), y = Math.max(0, t);
  return { x, y, w: Math.min(W, r) - x, h: Math.min(H, b) - y };
}

const useGen = () => useSyncExternalStore(subscribe, () => current().gen, () => 0);

export function Site({ name, measure, children }: { name: SiteName; measure?: string; children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const gen = useGen();
  useLayoutEffect(() => {
    if (!el.current) return;
    const s: Spot = { el: el.current, measure };
    const set = spots.get(name) ?? new Set();
    set.add(s); spots.set(name, set);
    return () => { set.delete(s); };
  }, [name, measure]);
  return (
    <div ref={el} data-site={name} style={{ display: "contents" }}>
      <Boundary name={name} gen={gen} last={() => boxOf(name)}>{children}</Boundary>
    </div>
  );
}

type BProps = { name: SiteName; gen: number; last: () => Box | null; children: ReactNode };
type BState = { error: Error | null; at: number; box: Box | null };
class Boundary extends Component<BProps, BState> {
  state: BState = { error: null, at: 0, box: null };
  private box: Box | null = null;
  static getDerivedStateFromError(error: Error) { return { error }; }
  // an update landed since it broke: try the part again (its key is the HMR generation, in effect, but only once broken:
  // a healthy part is never remounted by an update)
  static getDerivedStateFromProps(p: BProps, s: BState): Partial<BState> | null {
    if (s.error && p.gen !== s.at) return { error: null, at: p.gen };
    if (!s.error && p.gen !== s.at) return { at: p.gen };
    return null;
  }
  // React Refresh remounts a boundary that failed (it does not update it): a fresh mount of a part the store still
  // has as broken is that part mended
  componentDidMount() { this.box = this.props.last(); if (current().sites.get(this.props.name)?.state === "broken") mended(this.props.name); }
  componentDidUpdate(_p: BProps, prev: BState) {
    if (!this.state.error) this.box = this.props.last() ?? this.box;
    if (prev.error && !this.state.error) mended(this.props.name);
  }
  componentDidCatch(error: Error) {
    this.setState({ box: this.box });
    broke(this.props.name, error?.message ?? String(error));
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <Field box={this.state.box ?? this.box} />;
  }
}

// the broken part: a dark field of cells where it was, drifting a cell at a time along the diagonal
const EYE_BLACK: RGB = [10, 10, 10];
function Field({ box }: { box: Box | null }) {
  const c = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = c.current;
    if (!cv) return;
    register(cv, (x, w, h, _dt, now) => {
      const C = 6, step = Math.floor(now / 400);
      x.fillStyle = rgba(EYE_BLACK); x.fillRect(0, 0, w, h);
      x.fillStyle = rgba(PAPER.raised);
      for (let j = 0; j * C < h; j++) for (let i = 0; i * C < w; i++) if (bayer(i + step, j + step) < 0.22) x.fillRect(i * C, j * C, C - 1, C - 1);
    });
    return () => unregister(cv);
  }, []);
  const b = box ?? { x: 0, y: 0, w: 240, h: 160 };
  return <div className="site-broken" style={{ position: "fixed", left: b.x, top: b.y, width: b.w, height: b.h, zIndex: 40 }}><canvas ref={c} style={{ width: "100%", height: "100%", display: "block" }} /></div>;
}

// a ping Marco has not seen, beside its conversation's title in the side (Life and Work): one lit cell in the seat's
// colour, two when there are two, until the conversation is opened
export function Unseen({ sessionId }: { sessionId?: string | null }) {
  const r = useRenovation();
  const mine = sessionId ? r.pings.filter((p) => p.sessionId === sessionId) : [];
  if (!mine.length) return null;
  return (
    <span className="unseen" title={pingLine(mine[mine.length - 1])} style={{ display: "inline-flex", gap: 2, marginLeft: 6, flex: "none", alignItems: "center" }}>
      {mine.slice(-2).reverse().map((p) => <i key={p.id} style={{ width: 6, height: 6, display: "block", background: rgba(pingColour(p)) }} />)}
    </span>
  );
}

// ---- the overlay ----
const PX = 2, BAND = 3;   // a stripe's cell, and the tape's width in those cells (one 6 px cell of the face)
const WORDS = { taped: "being changed · come back in a sec", face: "whole face · may blink", broken: "this part broke mid-change, Sol is fixing it" };
function lineOf(e: Entry): string {
  if (e.state === "broken") return WORDS.broken;
  if (e.error) return `won't build yet: ${e.error}`;
  if (e.line) return e.line;
  return e.site === "face" ? WORDS.face : e.transient ? "" : WORDS.taped;
}

function drawTape(x: CanvasRenderingContext2D, b: Box, e: Entry, now: number) {
  const shift = Math.floor(now / 90);   // marching: one stripe cell every 90 ms
  const peel = e.state === "peeling" && e.peelAt ? Math.max(0, (now - e.peelAt) / PEEL_MS) : 0;
  const cols = Math.ceil(b.w / PX), rows = Math.ceil(b.h / PX);
  const put = (i: number, j: number) => {
    if (peel > 0 && bayer(i, j) < peel) return;
    const d = i + j + shift, k = ((d % 8) + 8) % 8;
    x.fillStyle = k < 4 ? rgba(Math.floor(d / 8) % 2 ? e.colours[1] : e.colours[0]) : rgba(EYE_BLACK);
    x.fillRect(b.x + i * PX, b.y + j * PX, PX, PX);
  };
  const band = Math.min(BAND, Math.floor(cols / 2), Math.floor(rows / 2));
  for (let i = 0; i < cols; i++) for (let k = 0; k < band; k++) { put(i, k); put(i, rows - 1 - k); }
  for (let j = band; j < rows - band; j++) for (let k = 0; k < band; k++) { put(k, j); put(cols - 1 - k, j); }
}

function drawLanding(x: CanvasRenderingContext2D, b: Box, e: Entry, now: number) {
  if (!e.landAt) return;
  const age = now - e.landAt;
  if (age < 0 || age > LAND_MS) return;
  const C = 8, wave = (age / LAND_MS) * 1.4 - 0.2;
  const cols = Math.ceil(b.w / C), rows = Math.ceil(b.h / C);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const t = bayer(i, j) + ((i + j) / (cols + rows)) * 0.4;   // Bayer order, a lean along the diagonal
    if (Math.abs(t - wave) > 0.09) continue;
    x.fillStyle = rgba(FAMILY[(Math.floor(age / 70) + i + j) % FAMILY.length], 0.85);   // a shimmer through the creature's ten
    x.fillRect(b.x + i * C + 1, b.y + j * C + 1, C - 2, C - 2);
  }
}

function drawLine(x: CanvasRenderingContext2D, b: Box, e: Entry, now: number) {
  const text = lineOf(e);
  if (!text || b.w < 40 || b.h < 22) return;
  const peel = e.state === "peeling" && e.peelAt ? (now - e.peelAt) / PEEL_MS : 0;
  if (peel >= 0.5) return;
  x.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace"; x.textBaseline = "middle";
  const max = Math.max(40, b.w - 16);
  let t = text;
  while (t.length > 4 && x.measureText(t).width + 22 > max) t = t.slice(0, -2);
  if (t !== text) t = t.slice(0, -1) + "…";
  const w = Math.ceil(x.measureText(t).width) + 22, h = 18;
  // it slides out of the tape's bottom-left corner in whole 6 px cells as the tape goes up: the bottom, so it never sits
  // on a part's header (the side's name, the mode pill) and, for the whole face, stays in the window's corner
  const k = Math.min(1, (Date.now() - e.since) / 260);
  const cx = b.x + BAND * PX + 2 - Math.round(((1 - k) * w) / 6) * 6, cy = b.y + b.h - BAND * PX - 2 - h;
  x.fillStyle = rgba(EYE_BLACK); x.fillRect(cx, cy, w, h);
  x.fillStyle = rgba(e.state === "broken" ? FUNCTIONAL.red.strong : e.colours[0]); x.fillRect(cx + 6, cy + 6, 6, 6);
  x.fillStyle = "#fff"; x.fillText(t, cx + 17, cy + h / 2 + 0.5);
}

// up only while renovation has a site: a canvas over the whole window is graphics memory even when it draws nothing (#81)
const useTaped = () => useSyncExternalStore(subscribe, () => current().sites.size > 0, () => false);
export function Tape() { return useTaped() ? <TapeCanvas /> : null; }
function TapeCanvas() {
  const c = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = c.current;
    if (!cv) return;
    register(cv, (x, _w, _h, _dt, now) => {
      const s = current();
      if (!s.sites.size) return;
      x.imageSmoothingEnabled = false;
      for (const e of s.sites.values()) {
        const b = boxOf(e.site);
        if (!b) continue;
        if (e.state !== "broken" && (e.state === "landing" || e.landAt)) drawLanding(x, b, e, now);   // a broken part is the quiet field alone
        if (!e.transient) drawTape(x, b, e, now);
        drawLine(x, b, e, now);
      }
    });
    return () => unregister(cv);
  }, []);
  return <canvas ref={c} className="tape" aria-hidden="true" style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 2147483000 }} />;
}
