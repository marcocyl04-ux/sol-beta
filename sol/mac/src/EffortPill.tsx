// The effort pill, again (mine/look/SITTING-4.md, item 4): the creature trying harder. At rest the pill shows a small
// knob (the lit cells for the level, no eye) before the level's word. On pointer down, or a 300 ms hover, it opens in
// place into a track of cells, one per level, and the knob becomes the creature's: a 3x3 body with one eye. As the
// level rises the body's cells wake (1 lit at the lowest, all 8 around the eye at the highest), the eye narrows a
// step per level (a 1-cell eye at low, a flat 2-cell slit at max), the knob trembles a little more each level (a 1 px
// jitter at max only), and a few cells of dust leave it while it is dragged, more at higher levels. The body wears
// --on, the eye alone --glow; no band, no gradient, no fill behind the knob. The word sits inside the pill to the right
// of the track in --dim, changing through the dither. The knob follows the pointer quantised to the nearest stop on a
// short spring; the level commits once, on release (a click on the open track commits at the clicked stop). Keyboard:
// left and right on the focused pill step the level. One canvas, on the creature's shared loop (creature/Widget.tsx).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { reducedMotion } from "./motion";
import { Swap } from "./MotionKit";
import { Creature, spring, type Life } from "./creature/Widget";
import { bayer, type Tint } from "./creature/ring";

const OPEN_MS = 180, HOVER_MS = 300, SWEEP_MS = 220;
const CELL = 3, KNOB = CELL * 3;        // the cell grid every indicator draws on; the knob is 3x3 cells
const STEP = 14;                        // px between stops (a cell and 11 px of air)
const PADL = 11, PADR = 11;             // the pill's own padding
const GAP_REST = 8, GAP_OPEN = 10;      // between the knob (the track) and the word
const DUSTIN = 8;                       // the canvas hangs this far past the pill on every side, room for dust
// the body's eight cells around the eye, in the order they wake: the feet first, then the sides, then the brow
const WAKE: [number, number][] = [[1, 2], [0, 2], [2, 2], [0, 1], [2, 1], [0, 0], [2, 0], [1, 0]];

// a computed colour as [r, g, b] (a canvas cannot read a token: it wears --ink as its colour, --glow as its caret)
const rgbOf = (s: string): [number, number, number] | null => {
  const c = s.match(/(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/);
  return c ? [+c[1], +c[2], +c[3]] : null;
};
const tint = (c: [number, number, number]): Tint => ({ name: "on", stops: [c], speed: 0 });

// the word beside the track: a canvas, so a change sweeps old to new through the Bayer dither over SWEEP_MS
function Word({ text }: { text: string }) {
  const st = useRef({ was: text, now: text, at: -1e9 });
  if (st.current.now !== text) { st.current.was = st.current.now; st.current.now = text; st.current.at = performance.now(); }
  return (
    <Creature className="eword-c" dustCell={2} setup={(l) => { l.maxDust = 0; }} draw={(l, x, w, h) => {
      const s = st.current, k = reducedMotion() ? 1 : Math.min(1, (l.now - s.at) / SWEEP_MS);
      x.font = `11.5px ui-monospace, "SF Mono", Menlo, monospace`;
      x.textAlign = "left"; x.textBaseline = "middle"; x.fillStyle = getComputedStyle(x.canvas).color;
      if (k >= 1) { x.fillText(s.now, 0, h / 2 + 0.5); return; }
      const cell = 3, cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
      const fresh = new Path2D(), old = new Path2D();
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) (bayer(i, j) < k ? fresh : old).rect(i * cell, j * cell, cell, cell);
      x.save(); x.clip(fresh); x.fillText(s.now, 0, h / 2 + 0.5); x.restore();
      x.save(); x.clip(old); x.fillText(s.was, 0, h / 2 + 0.5); x.restore();
    }} />
  );
}

// how many of the eight cells are lit at level k of n: 1 at the lowest, all 8 at the highest (low 1, medium 3, high 5, xhigh 7, max 8)
const litAt = (k: number, n: number) => (n <= 1 ? 8 : k >= n - 1 ? 8 : Math.max(1, Math.round(1 + 6 * (k / (n - 1)))));

export function EffortPill({ options, value, onChange, label = "effort" }: { options: string[]; value?: string; onChange: (v: string) => void; label?: string }) {
  const n = Math.max(1, options.length);
  const i = Math.max(0, options.indexOf(value ?? ""));
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [hot, setHot] = useState(i);            // the level under the pointer while the track is open (the knob, the word)
  const root = useRef<HTMLDivElement>(null), ghosts = useRef<HTMLSpanElement>(null);
  const life = useRef<Life | null>(null);
  const st = useRef({ open: false, hot: i, n, drag: false, jx: 0, jy: 0, jAt: 0 });   // what the draw reads, never a stale closure
  st.current.open = open; st.current.hot = hot; st.current.n = n; st.current.drag = drag;
  const [w, setW] = useState<number | undefined>(undefined);   // the pill's width while it animates; unset = auto
  const trackW = KNOB + STEP * (n - 1);
  const armed = useRef(false);                 // a press that opened the pill picks nothing on release; a drag, or a press on the open track, does
  const prev = useRef(i);
  const dir = (k: number) => { const d = k >= prev.current ? 1 : -1; prev.current = k; return d as 1 | -1; };
  const fracOf = (k: number) => (n > 1 ? k / (n - 1) : 0.5);

  // the widest word, measured from hidden ghosts (one per level), so the open pill holds any of them without a jump
  const wordW = () => { const g = ghosts.current; if (!g) return 40; let m = 0; for (const c of Array.from(g.children)) m = Math.max(m, (c as HTMLElement).offsetWidth); return m; };
  const openW = () => PADL + trackW + GAP_OPEN + wordW() + PADR;
  const restW = () => { const g = ghosts.current?.children[i] as HTMLElement | undefined; return PADL + KNOB + GAP_REST + (g?.offsetWidth ?? 40) + PADR; };
  const show = () => {
    if (open) return;
    const r = root.current; if (!r) return;
    setW(r.offsetWidth); setOpen(true); setHot(i);
    requestAnimationFrame(() => requestAnimationFrame(() => setW(openW())));
  };
  const hide = () => { setOpen(false); setW(restW()); window.setTimeout(() => setW(undefined), OPEN_MS + 20); };
  const closeTimer = useRef(0), hoverTimer = useRef(0);
  const later = (f: () => void, ms: number) => { window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(f, ms); };
  useEffect(() => () => { window.clearTimeout(closeTimer.current); window.clearTimeout(hoverTimer.current); }, []);
  useLayoutEffect(() => { if (!open) setHot(i); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  // the stop nearest the pointer
  const stopAt = (ev: { clientX: number }) => {
    const r = root.current!.getBoundingClientRect();
    const k = Math.round((ev.clientX - r.left - PADL - KNOB / 2) / STEP);
    return Math.max(0, Math.min(n - 1, k));
  };
  const pick = (k: number) => { if (options[k] !== undefined && options[k] !== value) { dir(k); onChange(options[k]); } };
  const down = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    window.clearTimeout(hoverTimer.current); window.clearTimeout(closeTimer.current);
    setDrag(true);
    if (!open) { armed.current = false; show(); return; }   // a press on the closed pill opens the track; the knob stays on its level
    armed.current = true;
    setHot(stopAt(ev));
  };
  const move = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !open) return;
    armed.current = true;
    const k = stopAt(ev);
    if (k !== hot) setHot(k);
  };
  const up = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag(false);
    // released outside the pill (the capture ate the leave): it closes as a leave would
    const r = root.current?.getBoundingClientRect();
    const out = !r || ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
    if (!open || !armed.current) { if (out) later(hide, OPEN_MS); return; }   // the press only opened it: it stays open under the pointer
    const k = stopAt(ev);
    setHot(k); pick(k);                         // once, on release
    const l = life.current;
    if (l) l.shed(2 + Math.round(4 * fracOf(k)), DUSTIN + PADL + KNOB / 2 + fracOf(k) * STEP * (n - 1), l.h / 2, 0.35);
    later(hide, OPEN_MS);
  };
  const enter = () => { if (!open) hoverTimer.current = window.setTimeout(show, HOVER_MS); };
  const leave = () => { window.clearTimeout(hoverTimer.current); if (open && !drag) later(hide, OPEN_MS); };
  const key = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    const k = Math.max(0, Math.min(n - 1, i + (ev.key === "ArrowRight" ? 1 : -1)));
    setHot(k); pick(k);                         // the knob and the word follow the keys too, open or not
  };

  // the one canvas: the knob at rest at the pill's left; open, the track of cells and the knob riding it
  const draw = (l: Life, x: CanvasRenderingContext2D, _w: number, h: number, _t: number, dt: number) => {
    const s = st.current, nn = s.n, lvl = nn > 1 ? s.hot / (nn - 1) : 0.5;
    const cs = getComputedStyle(x.canvas);
    const on = rgbOf(cs.color), glow = rgbOf(cs.caretColor);
    if (!on) return;
    if (!l.slice) l.slice = tint(on);
    const ink = `rgba(${on[0]},${on[1]},${on[2]},0.92)`, faint = `rgba(${on[0]},${on[1]},${on[2]},0.30)`, mute = `rgba(${on[0]},${on[1]},${on[2]},0.32)`;
    const ky = Math.round(h / 2 - KNOB / 2);
    const lit = litAt(s.hot, nn);
    if (!s.open) {
      // at rest: the lit cells for the level, no eye, in the ring dot's old place
      const kx = DUSTIN + PADL;
      WAKE.forEach(([ci, cj], q) => { x.fillStyle = q < lit ? ink : faint; x.fillRect(kx + ci * CELL, ky + cj * CELL, CELL, CELL); });
      return;
    }
    // the track: one cell per level, the one under the knob in ink
    const x0 = DUSTIN + PADL + KNOB / 2;
    for (let k = 0; k < nn; k++) { x.fillStyle = k === s.hot ? mute : faint; x.fillRect(Math.round(x0 + k * STEP - CELL / 2), Math.round(h / 2 - CELL / 2), CELL, CELL); }
    // the knob: a short spring to the nearest stop; a tremble that grows with the level (1 px, at the top only)
    const sp = l.sp(0);
    if (reducedMotion()) { sp.v = lvl; sp.vel = 0; } else spring(sp, lvl, dt, 700, 0.6);
    if (l.now - s.jAt > 55) {
      s.jAt = l.now;
      const amp = lvl * lvl;
      s.jx = Math.random() < amp * 0.85 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      s.jy = Math.random() < amp * 0.5 ? (Math.random() < 0.5 ? -1 : 1) : 0;
    }
    const kx = Math.round(x0 + sp.v * STEP * (nn - 1) - KNOB / 2) + (reducedMotion() ? 0 : s.jx), kyy = ky + (reducedMotion() ? 0 : s.jy);
    WAKE.forEach(([ci, cj], q) => { x.fillStyle = q < lit ? ink : faint; x.fillRect(kx + ci * CELL, kyy + cj * CELL, CELL, CELL); });
    // the eye, in --glow: a cell at the lowest level, narrowing a step per level to a flat two-cell slit at the top
    if (glow) {
      const eh = Math.max(1, Math.round(CELL - (CELL - 1) * lvl)), ew = Math.round(CELL + CELL * lvl);
      x.fillStyle = `rgb(${glow[0]},${glow[1]},${glow[2]})`;
      x.fillRect(Math.round(kx + CELL + (CELL - ew) / 2), Math.round(kyy + CELL + (CELL - eh) / 2), ew, eh);
    }
    // dust leaves the knob while it is dragged, more at higher levels
    if (s.drag && Math.random() < 0.06 + 0.3 * lvl) l.shed(1, kx + KNOB / 2, kyy + KNOB / 2, 0.3, sp.vel * STEP * (nn - 1) * 0.3, 0);
  };

  const shown = options[hot] ?? value ?? "–";
  return (
    <div ref={root} className={`slider epill${open ? " open" : ""}${drag ? " drag" : ""}`} title={value ? `${label}: ${value}` : label}
      role="slider" tabIndex={0} aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={i} aria-valuetext={value} data-hot={hot}
      style={{ width: w, transition: reducedMotion() ? "none" : `width ${OPEN_MS}ms cubic-bezier(.2,.7,.2,1)` }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerEnter={enter} onPointerLeave={leave} onKeyDown={key}>
      <span className="name"><Swap k={value ?? "–"} className="val" dist={14} dir={prev.current >= i ? 1 : -1}><span>{value ?? "–"}</span></Swap></span>
      <span ref={ghosts} className="eghost" aria-hidden="true">{options.map((o) => <span key={o}>{o}</span>)}</span>
      <Creature className="etrack" life={life} dustCell={2} setup={(l) => { l.maxDust = 6; l.gravity = 30; }} onPoke={() => true} draw={draw} />
      {open && <span className="eword" style={{ left: PADL + trackW + GAP_OPEN }} aria-hidden="true"><Word text={shown} /></span>}
    </div>
  );
}
