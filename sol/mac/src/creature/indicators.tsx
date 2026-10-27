// The small indicators of Sol, since 2026-10-27 drawn in goo (creature/goo.tsx, mine/look/DIRECTION-4.html):
// the engine's eyes on a pill, the daily mark, the liquid slider and the Bypass pill's sheen. Nothing is one flat
// colour; motion is springs (motion.ts) and SMIL. The pixel versions went with the pixel creature.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { enginePhase, live } from "./state";
import { Bands, Droplet, Goo, JOBS, Light, bandsCss, reduced } from "./goo";
import { useSpring, type Cfg } from "../motion";
import { SOL_EYES } from "../solShape";

// ---- a rounded rectangle's outline as a path you can walk by distance ----
// `at` writes into one shared point (read it before the next call): walking a path allocates nothing.
const PT: [number, number] = [0, 0];
export function outline(x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const sw = w - 2 * r, sh = h - 2 * r, q = (Math.PI / 2) * r;
  const len = 2 * sw + 2 * sh + 4 * q;
  const arc = (cx: number, cy: number, a0: number, k: number): [number, number] => {
    const a = a0 + (k / (q || 1)) * (Math.PI / 2);
    PT[0] = cx + Math.cos(a) * r; PT[1] = cy + Math.sin(a) * r; return PT;
  };
  const pt = (px: number, py: number) => { PT[0] = px; PT[1] = py; return PT; };
  const at = (d: number): [number, number] => {
    d = ((d % len) + len) % len;
    if (d < sw) return pt(x + r + d, y); d -= sw;
    if (d < q) return arc(x + w - r, y + r, -Math.PI / 2, d); d -= q;
    if (d < sh) return pt(x + w, y + r + d); d -= sh;
    if (d < q) return arc(x + w - r, y + h - r, 0, d); d -= q;
    if (d < sw) return pt(x + w - r - d, y + h); d -= sw;
    if (d < q) return arc(x + r, y + h - r, Math.PI / 2, d); d -= q;
    if (d < sh) return pt(x, y + h - r - d); d -= sh;
    return arc(x + r, y + r, Math.PI, d);
  };
  return { len, at };
}

// ---- status: the engine's eyes (mine/look/DIRECTION-4.html, 2026-10-27). Not a body: Sol's two black-and-white
// squares alone on a soft pill of the brand's pink to orange. Up: eyes open, a blink now and then. Starting: the pill
// breathes and the eyes are half shut. Down: a stone pill, eyes nearly closed. The creature's `ok` washes the pill
// spring green while it lasts. A click squashes it (the poke).
const EYE_X0 = SOL_EYES[0].x, EYE_X1 = SOL_EYES[3].x + SOL_EYES[3].w, EYE_Y = SOL_EYES[0].y + SOL_EYES[0].h / 2;
export function Status({ up, title, phase: force }: { up: boolean; title?: string; phase?: ReturnType<typeof enginePhase> }) {
  const id = useId().replace(/:/g, "");
  const [look, setLook] = useState(live.look);
  const [phase, setPhase] = useState(enginePhase());
  const [blink, setBlink] = useState(false);
  const [squash, setSquash] = useState(false);
  // the look and the phase, polled a few times a second (the canvases read `live` each frame; this needs it rarely)
  useEffect(() => {
    const t = window.setInterval(() => { setLook((l) => (l === live.look ? l : live.look)); setPhase((p) => { const q = enginePhase(); return p === q ? p : q; }); }, 200);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (reduced || !up) return;
    let t = 0;
    const next = () => { t = window.setTimeout(() => { setBlink(true); t = window.setTimeout(() => { setBlink(false); next(); }, 120); }, 2600 + Math.random() * 4200); };
    next();
    return () => window.clearTimeout(t);
  }, [up]);
  const starting = !up && (force ?? phase) === "starting";
  const kind = up ? (look === "ok" ? "ok" : "up") : starting ? "starting" : "down";
  const cols = kind === "ok" ? [JOBS.spring[1], JOBS.spring[2]] : kind === "down" ? [JOBS.stone[1], JOBS.stone[2]] : [JOBS.brand[5], JOBS.brand[2]];
  const open = blink ? 0.12 : up ? 1 : starting ? 0.4 : 0.14;
  const k = 60 / (EYE_X1 - EYE_X0);   // the eyes span 60 of the pill's 104
  return (
    <span className={`status st-${kind}${squash ? " squash" : ""}`} title={title ?? (up ? "engine up" : starting ? "engine starting" : "engine not reachable")}
      onClick={() => { if (!reduced) { setSquash(true); window.setTimeout(() => setSquash(false), 320); } }}>
      <svg width="26" height="16" viewBox="0 0 104 64" aria-hidden="true">
        <defs>
          <Bands id={`${id}p`} cols={cols} angle={0} spread={1.3} soft={0.12} />
          <Light id={id} cx={30} cy={8} r={40} />
        </defs>
        <g className="spill">
          <rect x="2" y="2" width="100" height="60" rx="30" fill={`url(#${id}p)`} />
          <rect x="2" y="2" width="100" height="60" rx="30" fill={`url(#${id}hi)`} />
          <rect x="2" y="2" width="100" height="60" rx="30" fill={`url(#${id}lo)`} />
        </g>
        <g transform={`translate(52 32) scale(${k.toFixed(3)}) translate(${-(EYE_X0 + EYE_X1) / 2} ${-EYE_Y})`}>
          <g className="eyes" style={{ transform: `scaleY(${open})`, transformBox: "fill-box", transformOrigin: "center" }}>
            {SOL_EYES.map((e, i) => <rect key={i} x={e.x} y={e.y} width={e.w} height={e.h} fill={e.fill} />)}
          </g>
        </g>
      </svg>
    </span>
  );
}

// ---- running: the daily mark turning (creature/goo.tsx, 2026-10-27; the diagonal arm of cells went with it) ----
export function Runner() { return <Droplet kind="running" className="runner" seed="runner" />; }

// ---- slider: liquid in a dry channel (mine/look/DIRECTION-4.html, 2026-10-27) ----
// The channel is a row of dry dots; the value is liquid in the shore bands that has wet it up to the knob, and the knob
// is the liquid's head (one goo body, so the liquid pours into it). Three springs: the knob overshoots its target and
// rings back, the liquid follows slower and thins into a neck while it trails, and the value buds up out of the knob in
// a capsule bridged by goo while the pointer (or an arrow key) is down, sinking back in on release. The drawing works
// in units where the track is 0..100 wide (1u = 1.8px on the 180px track), so <Bands> spans the whole track and the
// hue tells the value. A native range stays over it, invisible, for pointer and keyboard.
const SU = 1.8, SY = 30, KR = 4, LH = 2;   // px per unit, the channel's centre, the knob's radius, the liquid's half height
const SX = (f: number) => KR + Math.max(0, Math.min(1, f)) * (100 - 2 * KR);
const KNOB: Cfg = { k: 380, z: 0.42, eps: 0.02 }, LIQ: Cfg = { k: 150, z: 0.55, eps: 0.02 }, BUDX: Cfg = { k: 260, z: 0.6, eps: 0.02 };
const BUD_UP: Cfg = { k: 300, z: 0.55, eps: 0.004 }, BUD_DOWN: Cfg = { k: 360, z: 0.85, eps: 0.004 };
const KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

export function CellRange(props: React.InputHTMLAttributes<HTMLInputElement> & { min: number; max: number; value: number }) {
  const id = useId().replace(/:/g, "");
  const frac = (props.value - props.min) / (props.max - props.min || 1);
  const x = SX(frac);
  const [held, setHeld] = useState(false);
  const [ring, setRing] = useState(false);
  const label = String(props.value), bw = Math.max(9, (label.length * 6.4 + 10) / SU);
  const r = useRef<{ liq?: SVGRectElement | null; neck?: SVGRectElement | null; knob?: SVGEllipseElement | null; hi?: SVGEllipseElement | null; ring?: SVGCircleElement | null; bud?: SVGRectElement | null; num?: SVGGElement | null }>({});
  const draw = () => {
    const e = r.current, lx = liq.v, b = Math.max(0, bud.v);
    // the knob runs a few units past its target (the side away from the trailing liquid), never off the track: at the
    // ends its middle stops where it rests at min and max
    let kx = knob.v, ov = kx - knob.target;
    if (ov * (knob.target - lx) > 0) kx = knob.target + 4 * Math.tanh(ov / 4);
    kx = Math.max(KR, Math.min(100 - KR, kx));
    const bx = Math.max(KR, Math.min(100 - KR, budX.v));
    const gap = Math.abs(kx - lx), thin = Math.min(0.6, gap * 0.03);
    // the liquid to where it has caught up, then a neck stretched to the knob, thinner the further it trails
    const lh = LH - thin, lend = Math.min(lx, kx);
    e.liq?.setAttribute("width", Math.max(2 * lh, lend).toFixed(2));
    e.liq?.setAttribute("y", (SY - lh).toFixed(2)); e.liq?.setAttribute("height", (2 * lh).toFixed(2)); e.liq?.setAttribute("rx", lh.toFixed(2));
    const nh = Math.max(0.8, LH - gap * 0.06), n0 = Math.min(lx, kx), n1 = Math.max(lx, kx);
    e.neck?.setAttribute("x", n0.toFixed(2)); e.neck?.setAttribute("width", (n1 - n0).toFixed(2));
    e.neck?.setAttribute("y", (SY - nh).toFixed(2)); e.neck?.setAttribute("height", (2 * nh).toFixed(2));
    // the knob: a little bigger while held, stretched along its travel by speed
    const st = Math.min(1.4, Math.abs(knob.vel) * 0.004), kr = KR + 0.6 * Math.min(1, b);
    for (const el of [e.knob, e.hi]) { el?.setAttribute("cx", kx.toFixed(2)); }
    e.knob?.setAttribute("rx", (kr + st).toFixed(2)); e.knob?.setAttribute("ry", (kr - st * 0.45).toFixed(2));
    e.hi?.setAttribute("rx", (kr * 0.95 + st).toFixed(2)); e.hi?.setAttribute("ry", (kr * 0.95 - st * 0.45).toFixed(2));
    e.ring?.setAttribute("cx", kx.toFixed(2)); e.ring?.setAttribute("r", (kr + 1.6).toFixed(2));
    // the bud: rises out of the knob's top and swings a little behind it
    const by = SY - 10 * b, s = Math.min(1.08, b);
    // drawn in the track's own units (no transform), so the bands under it are the bands at its place on the track
    const w = bw * s, hh = 9 * s;
    if (e.bud) { e.bud.setAttribute("x", (bx - w / 2).toFixed(2)); e.bud.setAttribute("y", (by - hh / 2).toFixed(2)); e.bud.setAttribute("width", w.toFixed(2)); e.bud.setAttribute("height", hh.toFixed(2)); e.bud.setAttribute("rx", (hh / 2).toFixed(2)); }
    e.num?.setAttribute("transform", `translate(${bx.toFixed(2)} ${by.toFixed(2)}) scale(${Math.max(0.001, s).toFixed(3)})`);
    e.num?.setAttribute("opacity", Math.max(0, Math.min(1, (b - 0.45) / 0.4)).toFixed(2));
  };
  const knob = useSpring(x, KNOB, draw), liq = useSpring(x, LIQ, draw), budX = useSpring(x, BUDX, draw), bud = useSpring(0, BUD_UP, draw);
  useLayoutEffect(() => { knob.to(x); liq.to(x); budX.to(x); draw(); }, [x]);
  useEffect(() => { bud.to(held ? 1 : 0, { cfg: held ? BUD_UP : BUD_DOWN }); }, [held]);
  useEffect(() => {
    if (!held) return;
    const up = () => setHeld(false);
    addEventListener("pointerup", up); addEventListener("pointercancel", up); addEventListener("blur", up);
    return () => { removeEventListener("pointerup", up); removeEventListener("pointercancel", up); removeEventListener("blur", up); };
  }, [held]);
  const dots: number[] = [];
  for (let i = 2.5; i < 100; i += 5) dots.push(i);
  return (
    <span className="crange">
      <svg className="cgoo" viewBox={`-7 10 114 30`} style={{ left: -7 * SU, top: `calc(50% - ${20 * SU}px)`, width: 114 * SU, height: 30 * SU }} aria-hidden>
        <defs>
          <Goo id={`${id}f`} blur={1.15} />
          <Bands id={`${id}g`} cols={JOBS.shore.slice(0, 4)} angle={0} spread={1} soft={0.08} />
          <radialGradient id={`${id}h`} cx=".34" cy=".3" r=".75"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".45" stopColor="#fff" stopOpacity="0" /><stop offset=".8" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".2" /></radialGradient>
        </defs>
        {dots.map((d) => <circle key={d} className="dry" cx={d} cy={SY} r={0.8} />)}
        <g filter={`url(#${id}f)`} fill={`url(#${id}g)`}>
          <rect ref={(el) => { r.current.liq = el; }} x={0} y={SY - LH} width={x} height={2 * LH} rx={LH} />
          <rect ref={(el) => { r.current.neck = el; }} x={x} y={SY - LH} width={0} height={2 * LH} />
          <ellipse ref={(el) => { r.current.knob = el; }} cx={x} cy={SY} rx={KR} ry={KR} />
          <rect ref={(el) => { r.current.bud = el; }} x={x} y={SY} width={0} height={0} />
        </g>
        <ellipse ref={(el) => { r.current.hi = el; }} cx={x} cy={SY} rx={KR * 0.95} ry={KR * 0.95} fill={`url(#${id}h)`} />
        {ring && <circle ref={(el) => { r.current.ring = el; draw(); }} className="cring" cx={x} cy={SY} r={KR + 1.6} />}
        <g ref={(el) => { r.current.num = el; }} opacity={0} transform={`translate(${x} ${SY}) scale(0.001)`}>
          <text className="cnum" textAnchor="middle" dominantBaseline="central" fontSize={10 / SU}>{label}</text>
        </g>
      </svg>
      <input type="range" {...props}
        onPointerDown={(e) => { if (!props.disabled) setHeld(true); props.onPointerDown?.(e); }}   // a disabled range still hears the press in Chromium: no bud
        onKeyDown={(e) => { if (KEYS.has(e.key) && !props.disabled) setHeld(true); props.onKeyDown?.(e); }}
        onKeyUp={(e) => { if (KEYS.has(e.key)) setHeld(false); props.onKeyUp?.(e); }}
        onFocus={(e) => { setRing(e.currentTarget.matches(":focus-visible")); props.onFocus?.(e); }}
        onBlur={(e) => { setRing(false); setHeld(false); props.onBlur?.(e); }} />
    </span>
  );
}

// ---- a finished step: the daily mark settled into its check (creature/goo.tsx). `land`: it just finished in front of
// you, so the running drop pulls in and the check draws out of it; without it, the check is just there ----
export function CellCheck({ land }: { land?: boolean }) { return <Droplet kind="done" className="cellcheck" land={land} />; }

// ---- the Bypass pill's ambient life: the shore's bands drifting through the pill (mine/look/DIRECTION-4.html) ----
// A banded gradient of the shore colours (JOBS.shore), twice the pill's width, slides left to right and back over
// ~6 s at .22 under the words (the pill's own --glow band went 2026-10-27: nothing is one flat colour). It stands still
// while the window is unfocused or under prefers-reduced-motion. pointer-events none: the pill is the button, this only draws.
const AURORA_BG = bandsCss([...JOBS.shore, ...[...JOBS.shore].reverse().slice(1)], 90, 0.04);
export function Aurora() {
  const [focus, setFocus] = useState(() => typeof document === "undefined" || document.hasFocus());
  useEffect(() => {
    const on = () => setFocus(true), off = () => setFocus(false);
    window.addEventListener("focus", on); window.addEventListener("blur", off);
    return () => { window.removeEventListener("focus", on); window.removeEventListener("blur", off); };
  }, []);
  return <span className={`aurora${focus && !reduced ? "" : " still"}`} aria-hidden="true" style={{ backgroundImage: AURORA_BG }} />;
}
