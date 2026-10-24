// Every indicator in Sol is a small creature-thing, ported from the prototype's INDICATORS tiles.
// Each one is a Creature (Widget.tsx) with its own draw; they share one loop and one state.
// Motion: everything that moves is a spring or a body (Widget.tsx), quantised to the cell grid only when drawn;
// colour changes are dither sweeps (`l.sliceAt`), never fades.
import { useEffect, useRef, useState } from "react";
import { Body, Creature, ditherPick, spring, type Life } from "./Widget";
import { live } from "./state";
import { PAPER, TINTS, bandColour, bayer, tintAt, rgba, type RGB, type Tint } from "./ring";

// the paper's ink (#rrggbb, it flips with the mode) as a one-stop tint, made again only when the mode changes
const plainOf = (() => {
  let key = "", t: Tint = TINTS.ink;
  return (hex: string): Tint => {
    if (hex !== key) { key = hex; const n = parseInt(hex.slice(1), 16); t = { name: "ink", stops: [[(n >> 16) & 255, (n >> 8) & 255, n & 255] as RGB], speed: 0 }; }
    return t;
  };
})();

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
// one outline per size, kept on the widget so a frame does not rebuild it
type Path = ReturnType<typeof outline>;
const paths = new WeakMap<Life, { key: number; o: Path }>();
function pathFor(l: Life, x: number, y: number, w: number, h: number, r: number): Path {
  const key = Math.round(w) * 100003 + Math.round(h);
  const p = paths.get(l);
  if (p && p.key === key) return p.o;
  const o = outline(x, y, w, h, r);
  paths.set(l, { key, o });
  return o;
}

// ---- status: a fragment of the creature with an eye. Green slice when the engine is up, ember when down ----
// Transitions of its own: the engine going down shakes it a cell each way, then the ember sweeps in through the
// dither; the creature's `ok` stamps a cell check (it drops in from two cells above and lands with a squash), and
// when ok ends the body rises back into place from below.
const BODY = [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 1], [4, 2], [0, 2], [1, 2], [2, 2], [3, 2], [1, 3], [2, 3], [3, 0]];
const CHECK = [[0, 2], [1, 3], [2, 2], [3, 1], [4, 0]];
export function Status({ up, title }: { up: boolean; title?: string }) {
  return (
    <span className="status" title={title ?? (up ? "engine up" : "engine not reachable")}>
      <Creature dustCell={2} setup={(l) => { l.maxDust = 16; l.data.up = up ? 1 : 0; l.data.upAt = -1e9; }}
        transition={(l, from, to) => {
          if (!l.fresh) return;
          if (to === "ok") l.body.drop(2);                  // the check falls in
          else if (from === "ok") { const r = l.sp(0); r.v = 2; r.vel = 0; } // the body comes back up from below
        }}
        draw={(l, x, w, h, t, dt) => {
          const cell = 3, now = l.now;
          // the engine's own edge, independent of the creature's state
          if ((up ? 1 : 0) !== l.data.up) {
            l.data.up = up ? 1 : 0; l.data.upAt = now;
            if (!up) l.shake.vel = 46;
          }
          const k = Math.max(0, Math.min(1, (now - l.data.upAt - (up ? 0 : 170)) / 380));
          const stamp = live.look === "ok" && up;
          // up wears green to lime (as before step 3), its done stamp green, down red soft (the Unplugged colour)
          const from = up ? TINTS.unplugged : TINTS.ok, to = up ? (stamp ? TINTS.done : TINTS.ok) : TINTS.unplugged;
          l.slice = to;
          const shape = stamp ? CHECK : BODY;
          // squash: wider and shorter, standing on its bottom edge, whole pixels
          const sq = Math.max(-0.4, Math.min(0.6, l.body.sq.v + l.press.v * 0.25));
          const cw = Math.max(2, Math.round(cell * (1 + sq * 0.3))), ch = Math.max(1, Math.round(cell * (1 - sq * 0.5)));
          const rows = 4;
          const ox = Math.round((w - 5 * cw) / 2) + Math.round(l.shake.v) * cell;
          const rise = l.sp(0); spring(rise, 0, dt, 300, 0.5);
          const base = Math.round((h + rows * cell) / 2) + (l.body.cy + Math.round(rise.v)) * cell; // bottom edge
          for (const [i, j] of shape) {
            const s = ditherPick(from, to, k, i, j, (i + (3 - j)) / 8);
            x.fillStyle = rgba(tintAt(s, (i + j) * 0.12 + t * s.speed));
            x.fillRect(ox + i * cw, base - (rows - j) * ch, cw, ch);
          }
          if (!stamp) l.eye(x, ox + cw, base - 2.5 * ch, cell, up ? l.eyeOpen() : 0.15, l.look.x, l.look.y);
        }} onPoke={(l) => { l.poke(); l.shed(6, l.w / 2, l.h / 2, 0.4); return true; }} />
    </span>
  );
}

// ---- running: the arm reaching along the diagonal, shedding cells. Sits in the step's glyph slot ----
// The head is a spring chasing the far end of the diagonal: it accelerates out, decelerates in with a small
// overshoot, rests a beat, and pulls back. The arm stretches with speed (up to four cells) and gathers into one
// cell at rest; dust leaves the head with the head's own velocity.
export function Runner() {
  return (
    <Creature className="runner" dustCell={2} setup={(l) => { l.gravity = 10; l.maxDust = 14; l.data.p = 0; l.data.v = 0; l.data.goal = 1; l.sp(0); l.data.rest = 0; }}
      draw={(l, x, w, h, _t, dt) => {
        const cell = 3, len = Math.min(Math.floor(w / cell), Math.floor(h / cell));
        const ox = Math.round((w - len * cell) / 2), oy = Math.round((h - len * cell) / 2);
        const d = l.data, goal = d.goal * (len - 1);
        const sp = l.sp(0);
        const k = (l.hover ? 150 : 90) * (0.7 + live.slice.speed * 0.5) * Math.max(0.3, live.tempo);
        spring(sp, goal, dt, k, 0.62);
        d.p = sp.v; d.v = sp.vel;
        if (Math.abs(d.p - goal) < 0.2 && Math.abs(d.v) < 1) { d.rest += dt; if (d.rest > 0.14) { d.goal = 1 - d.goal; d.rest = 0; } }
        const head = Math.max(0, Math.min(len - 1, Math.round(d.p)));
        const dir = d.v >= 0 ? 1 : -1;
        const arm = 1 + Math.min(3, Math.floor(Math.abs(d.v) / 5));
        for (let a = arm - 1; a >= 0; a--) {
          const c = head - a * dir;
          if (c < 0 || c >= len) continue;
          const s = l.sliceAt(c, len - 1 - c, c / len);
          x.fillStyle = rgba(tintAt(s, a * 0.25 + l.flow), a === 0 ? 1 : a === 1 ? 0.7 : a === 2 ? 0.45 : 0.3);
          x.fillRect(ox + c * cell, oy + (len - 1 - c) * cell, cell, cell);
        }
        // dust leaves the head moving the way the head moves (up-right along the diagonal is +x, -y)
        if (Math.abs(d.v) > 6 && Math.random() < 0.25) l.shed(1, ox + head * cell + 1, oy + (len - 1 - head) * cell + 1, 0.15, d.v * cell * 0.5, -d.v * cell * 0.5);
      }} />
  );
}

// ---- card edge: marching cells around the card of a running step, and an eye at the running row's right end ----
// Runs of four: a bright head cell leading, the tail thinning behind it. The march rides the shared flow, so it
// accelerates and decelerates with the slice and turns round (head and all) when the creature starts speaking;
// an inchworm surge in the stride keeps it from reading as a linear loop.
export function CardEdge() {
  return (
    <Creature className="edge" host="parent" dustCell={2} setup={(l) => { l.data.shift = 0; }} draw={(l, x, w, h, t, dt) => {
      const cell = 2, pad = 2;
      const o = pathFor(l, pad, pad, w - pad * 2 - 1, h - pad * 2 - 1, 10);
      const n = Math.floor(o.len / cell);
      const surge = 0.55 + 0.9 * Math.pow(Math.max(0, Math.sin(t * 3.2)), 2);
      l.data.shift += l.flowV.v * dt * live.tempo * 115 * surge;
      const shift = l.data.shift, fwd = l.flowV.v >= 0;
      const P = 7, RUN = 4, gap = l.hover ? 0.4 : 0.12;
      for (let k = 0; k < n; k++) {
        const m = k % P;
        // which cell of the run it is, counted from the leading end
        const r = m < RUN ? (fwd ? RUN - 1 - m : m) : -1;
        const a = r === 0 ? 1 : r === 1 ? 0.7 : r === 2 ? 0.45 : r === 3 ? 0.28 : gap;
        const p = o.at(k * cell + shift);
        const px = p[0], py = p[1];
        const s = l.sliceAt(k, 0, (px / w + 1 - py / h) / 2);
        x.fillStyle = rgba(tintAt(s, (k / n) * 2), a);
        x.fillRect(Math.round(px - cell / 2), Math.round(py - cell / 2), cell, cell);
        if (r === 0) { x.fillStyle = "rgba(255,255,255,0.35)"; x.fillRect(Math.round(px - cell / 2), Math.round(py - cell / 2), cell, cell); }
      }
      // the eye watches from the running row's right end
      const c = x.canvas, row = c.parentElement?.querySelector(".step.running .step-state");
      if (row) {
        const cr = c.getBoundingClientRect(), rr = row.getBoundingClientRect();
        l.eye(x, rr.left - cr.left + Math.round(l.shake.v) * 4, rr.top - cr.top + rr.height / 2 + l.body.cy * 4, 4, l.eyeOpen(), l.look.x, l.look.y);
      }
    }} />
  );
}

// ---- input, focused: a sparkling fringe around the box, the small eye listening at its right end ----
// It grows: on focus the fringe spreads out from the eye end cell by cell, both ways round the box, and every colour
// change (idle to listening and back) starts at the eye too and travels outward through the dither.
export function Fringe({ eye }: { eye: boolean }) {
  return (
    <Creature className="fringe" host="parent" setup={(l) => { l.data.born = -1; l.data.ke = -1; l.data.key = 0; }} draw={(l, x, w, h, t) => {
      // the one plain highlight (repair 2026-10-18, Marco: "the only colourful thing that should have been removed is the
      // highlight around the chat box"): the fringe draws in the paper's ink, whatever the state or seat wears
      const cell = 3, inset = 6, plain = plainOf(PAPER.ink);
      const o = pathFor(l, inset - 2, inset - 2, w - 2 * inset + 4, h - 2 * inset + 4, 16);
      const n = Math.floor(o.len / cell);
      const ex = w - inset - 11, ey = h - inset - 24;
      // the path cell nearest the eye, found once per size
      const key = Math.round(w) * 100003 + Math.round(h);
      if (l.data.key !== key) {
        l.data.key = key;
        let best = 0, bd = Infinity;
        for (let k = 0; k < n; k++) { const p = o.at(k * cell); const dd = (p[0] - ex) ** 2 + (p[1] - ey) ** 2; if (dd < bd) { bd = dd; best = k; } }
        l.data.ke = best;
      }
      if (l.data.born < 0) l.data.born = l.now;
      const half = n / 2;
      const grow = Math.min(1, (l.now - l.data.born) / 420);
      const reach = Math.floor((1 - (1 - grow) * (1 - grow)) * half) + 1; // decelerating, a whole cell at a time
      const tw = l.hover ? Math.floor(t * 8) : 0; // hover: the fringe sparkles
      for (let k = 0; k < n; k++) {
        let dk = Math.abs(k - l.data.ke); if (dk > half) dk = n - dk;
        if (dk > reach) continue;
        const p = o.at(k * cell);
        const s = plain, u = 0;
        const kk = k + tw * 5;
        const spark = bayer(kk & 3, (kk >> 2) & 3);
        const a = dk === reach && grow < 1 ? 1 : l.hover ? (spark > 0.3 ? 1 : 0.4) : spark > 0.7 ? 0.9 : 0.25;
        x.fillStyle = rgba(tintAt(s, u * 2), a);
        x.fillRect(Math.round((p[0] - cell / 2) / cell) * cell, Math.round((p[1] - cell / 2) / cell) * cell, cell, cell);
      }
      if (eye) l.eye(x, ex + Math.round(l.shake.v) * 4, ey + l.body.cy * 4, 4, l.eyeOpen(), l.look.x, l.look.y);
    }} />
  );
}

// ---- slider: a dithered band for a track, a 3x3 ink knob with an eye, dust while dragging ----
// The knob is a spring (it overshoots a column and comes back); quantised to the columns when drawn.
function drawSlider(l: Life, x: CanvasRenderingContext2D, w: number, h: number, frac: number, t: number, dt: number, focus = false) {
  const cell = 4;
  const cols = Math.floor(w / cell);
  const d = l.data;
  const sp = l.sp(0);
  if (d.k === undefined) { d.k = sp.v = frac; d.kv = 0; }
  // the knob is a heavier spring while it travels (it lags the pointer and overshoots a column), and every detent
  // it reaches lands: a squash on the body, a puff of dust, the eye blinks
  spring(sp, frac, dt, 300, 0.42);
  d.k = sp.v; d.kv = sp.vel;
  if (d.last !== undefined && Math.abs(frac - d.last) > 1e-6) { l.body.sq.vel += 6 * Math.sign(frac - d.last) * -1 + 3; l.blink = 0.08; }
  d.last = frac;
  const kc = Math.max(0, Math.min(cols - 3, Math.round(d.k * (cols - 3)))); // the knob's first column
  const y = Math.round(h / 2 - cell / 2);
  for (let i = 0; i < cols; i++) {
    const c = i <= kc + 1 ? bandColour(l.sliceAt(i, 0, i / cols), (i / cols) * 2 + l.flow, i, 0) : PAPER.raised;
    x.fillStyle = rgba(c);
    x.fillRect(i * cell, y, cell, cell);
  }
  const kx = kc * cell + Math.round(l.shake.v) * cell, ky = Math.round(h / 2 - cell * 1.5) + l.body.cy * cell + Math.round(l.press.v);
  if (focus) { x.fillStyle = PAPER.mute; x.fillRect(kx - 1, ky - 1, cell * 3 + 2, cell * 3 + 2); }
  // stretched along its travel by speed, squashed by the landing
  const str = Math.min(cell, Math.round(Math.abs(d.kv) * 0.08)), sqz = Math.round(Math.max(-1, Math.min(1, l.body.sq.v)) * 1.5);
  x.fillStyle = PAPER.ink;
  x.fillRect(kx - (d.kv < 0 ? str : 0), ky + Math.max(0, sqz), cell * 3 + str, cell * 3 - Math.max(0, sqz));
  l.eye(x, kx + 3, ky + cell * 1.5, 3, l.eyeOpen(), l.look.x * 0.5 + Math.max(-1, Math.min(1, d.kv * 0.3)), 0);
  if ((l.down || Math.abs(d.kv) > 1.5) && Math.random() < 0.5) l.shed(1, kx + cell * 1.5, h / 2, 0.5, d.kv * w * 0.4, 0);
  void t;
}

// over a track that owns the pointer (Picker): the canvas only draws
export function CellTrack({ frac }: { frac: number }) {
  return <Creature className="cells" host="parent" dustCell={2} draw={(l, x, w, h, t, dt) => drawSlider(l, x, w, h, frac, t, dt)} />;
}

// a native range kept for keyboard and pointer, invisible, over the cells (Settings)
export function CellRange(props: React.InputHTMLAttributes<HTMLInputElement> & { min: number; max: number; value: number }) {
  const focus = useRef(false);
  const frac = (props.value - props.min) / (props.max - props.min || 1);
  return (
    <span className="crange">
      <Creature host="parent" dustCell={2} draw={(l, x, w, h, t, dt) => drawSlider(l, x, w, h, frac, t, dt, focus.current)} />
      <input type="range" {...props}
        onFocus={(e) => { focus.current = e.currentTarget.matches(":focus-visible"); props.onFocus?.(e); }}
        onBlur={(e) => { focus.current = false; props.onBlur?.(e); }} />
    </span>
  );
}

// ---- voice: the arms stretch with the sound (env is the real mic / speaker level when there is one) ----
// Each arm is a spring chasing its height, so a loud syllable throws it past and it rings back.
export function VoiceArms() {
  return (
    <Creature className="arms" host="parent" draw={(l, x, w, h, t, dt) => {
      const cell = 2, n = 5;
      const active = live.look === "listening" || live.look === "speaking";
      const e = active ? live.env : l.hover ? 0.5 + 0.5 * Math.sin(t * 5) : 0.15;
      const mid = Math.floor(h / cell / 2), ox = Math.round((w - (n * 2 - 1) * cell) / 2);
      for (let k = 0; k < n; k++) {
        const target = (0.5 + 0.5 * Math.sin(t * 9 + k * 1.3)) * (0.6 + e * 3.6) * (1 - Math.abs(k - 2) / 4) + 0.6;
        const sp = l.sp(k);
        spring(sp, target, dt, 320, 0.32);
        const amp = Math.max(1, Math.min(4, Math.round(sp.v)));
        const c = rgba(tintAt(l.sliceAt(k, 0, k / n), k * 0.12 + l.flow));
        const cx = ox + k * cell * 2;
        for (let j = 0; j < amp; j++) {
          x.globalAlpha = j === amp - 1 ? 0.5 : 1;
          x.fillStyle = c;
          x.fillRect(cx, (mid - j) * cell, cell, cell);
          if (j) x.fillRect(cx, (mid + j) * cell, cell, cell);
        }
      }
      x.globalAlpha = 1;
    }} />
  );
}

// ---- seat switch: each seat a 3x3 fragment with an eye in its own colours; the active one wiggles on hover ----
// Picking a seat: the new fragment hops a cell and lands with a squash, its eye opening; the old one's lid drops.
const FRAG = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [2, 2], [2, 0]];
const seatBodies = new WeakMap<Life, { home: Body; work: Body; was: string; at: number }>();
export function SeatCells({ seat, life }: { seat: "home" | "work"; life: React.MutableRefObject<Life | null> }) {
  return (
    <Creature className="seatcells" host="parent" life={life} dustCell={3} setup={(l) => { l.maxDust = 30; }} onPoke={() => true} draw={(l, x, _w, h, t, dt) => {
      const cell = 4;
      let sb = seatBodies.get(l);
      if (!sb) { sb = { home: new Body(), work: new Body(), was: seat, at: -1e9 }; seatBodies.set(l, sb); }
      if (sb.was !== seat) { sb.was = seat; sb.at = l.now; sb[seat].jump(1); }
      const c = x.canvas, cr = c.getBoundingClientRect();
      c.parentElement?.querySelectorAll<HTMLButtonElement>("button[data-seat]").forEach((b) => {
        const name = b.dataset.seat as "home" | "work";
        const on = name === seat;
        const body = sb![name];
        body.step(dt, 0);
        const s: Tint = TINTS[name];
        const br = b.getBoundingClientRect();
        const sq = Math.max(-0.4, Math.min(0.6, body.sq.v));
        const cw = Math.max(2, Math.round(cell * (1 + sq * 0.25))), ch = Math.max(2, Math.round(cell * (1 - sq * 0.4)));
        const ox = Math.round(br.left - cr.left + 9), base = Math.round(h / 2 + cell * 1.5) + body.cy * cell;
        const wig = on && l.hover ? Math.round(Math.sin(t * 12) * 2) : 0;
        for (const [i, j] of FRAG) {
          x.fillStyle = rgba(tintAt(s, (i + j) * 0.2 + t * s.speed), on ? 1 : 0.45);
          x.fillRect(ox + i * cw + (j === 1 ? wig : 0), base - (3 - j) * ch, cw, ch);
        }
        // the eye: the new seat's opens in two steps, the old seat's lid drops in two
        const since = l.now - sb!.at;
        const step = since < 140 ? (since < 70 ? 1 : 2) : 3;
        const open = on ? (step === 3 ? l.eyeOpen() : step / 3) : step === 3 ? 0.15 : 1 - step / 3;
        l.eye(x, ox + cw * 0.5, base - 1.5 * ch, 3, open, l.look.x * 0.4, 0);
        l.data[name] = ox + cell * 1.5;
      });
    }} />
  );
}

// ---- a finished step: a check made of cells in green to lime (ring.ts TINTS.ok) ----
// `land`: the step just finished in front of you, so the check falls in from two cells above and lands with a
// squash (a Body, drawn on the device-pixel grid), then turns into the still SVG. Without it, it is just there.
function CheckSvg() {
  return (
    <svg className="cellcheck" viewBox="0 0 5 4" width="10" height="8" shapeRendering="crispEdges" aria-hidden="true">
      {CHECK.map(([i, j]) => <rect key={i} x={i} y={j} width="1" height="1" fill={rgba(tintAt(TINTS.ok, i * 0.2))} />)}
    </svg>
  );
}
export function CellCheck({ land }: { land?: boolean }) {
  const [done, setDone] = useState(!land);
  useEffect(() => { if (done) return; const t = window.setTimeout(() => setDone(true), 750); return () => window.clearTimeout(t); }, [done]);
  if (done) return <CheckSvg />;
  return (
    <Creature className="cellcheck" style={{ width: 10, height: 14, marginTop: -6 }} setup={(l) => { l.body.drop(2); l.maxDust = 6; l.gravity = 40; }}
      draw={(l, x, w, h) => {
        const dpr = x.canvas.width / (w || 1), px = (v: number) => Math.round(v * dpr) / dpr;
        const b = l.body;
        if (b.landed === 1 && !l.data.dusted) { l.data.dusted = 1; l.shed(3, w / 2, h - 1, 0.25); }
        const sq = Math.max(-0.4, Math.min(0.6, b.sq.v));
        const cw = px(2 * (1 + sq * 0.25)), ch = Math.max(1 / dpr, px(2 * (1 - sq * 0.5)));
        const ox = px(w / 2 - 2.5 * cw), base = h + b.cy * 2;
        for (const [i, j] of CHECK) {
          x.fillStyle = rgba(tintAt(TINTS.ok, i * 0.2));
          x.fillRect(ox + i * cw, px(base - (4 - j) * ch), cw, ch);
        }
      }} />
  );
}
