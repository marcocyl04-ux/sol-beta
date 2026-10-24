// The widget base, ported from the prototype's `W`: a canvas with pointer life. It wakes on hover (the eye opens
// wider, it looks at the cursor), squashes on press, hops and sheds dust when poked (a short click), and blinks on
// its own. Every indicator is one of these with its own draw function. All of them share one loop.
//
// Motion is physics, drawn as cells. The body has a ballistic hop (velocity, gravity, a landing that turns its impact
// into squash), springs for squash, press, shake, settle, look and the band's flow; all of it is integrated in
// continuous units and only quantised to the cell grid at draw time, so it moves like a thing and still reads as cells.
//
// Transitions: when the creature's state changes (state.ts keeps `live.prev` and `live.since`), every Life plays a
// named move from A to B over DUR ms (see `transitionName`): it fires the move's impulses once, runs its timed beats,
// and sweeps the colour from the old slice to the new one through the Bayer dither (`sliceAt`). Widgets read `l.tr`
// and `l.tk` (0..1) for anything of their own, or take a `transition(l, from, to, k)` hook on <Creature>.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { pointer, register, unregister } from "./loop";
import { live } from "./state";
import { drawScenes, onRuns, running } from "./scenes";
import type { Look } from "./ring";
import { bayer, tintAt, rgba, type RGB, type Tint } from "./ring";

type Spring = { v: number; vel: number };
export type Dust = { x: number; y: number; vx: number; vy: number; life: number; age: number; u: number };

export const DUR = 450;           // ms a state transition plays for
const G = 70;                     // the body's gravity, cells / s²

export const ease = (dt: number, h: number) => 1 - Math.pow(0.001, dt / h);
export const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// A damped spring, semi-implicit Euler in fixed sub-steps so a long frame cannot blow it up.
// k: stiffness (1/s²); z: damping ratio (1 = critical, below 1 overshoots).
export function spring(s: Spring, target: number, dt: number, k = 220, z = 0.3) {
  const c = 2 * z * Math.sqrt(k);
  let left = dt;
  while (left > 1e-6) {
    const h = left > 1 / 120 ? 1 / 120 : left;
    s.vel += (-(s.v - target) * k - c * s.vel) * h;
    s.v += s.vel * h;
    left -= h;
  }
}

// A body that can jump: y in cells (negative is up), gravity pulls it down, the ground is 0. Landing hands its
// impact to the squash spring (positive squash = wider and shorter), which rings out on its own.
export class Body {
  y = 0; vy = 0; sq: Spring = { v: 0, vel: 0 }; landed = 0; air = false;
  sqK = 600; sqZ = 0.28;  // the squash spring's stiffness and damping ratio; each move tunes them (Life.enter)
  jump(cells: number) { this.vy = -Math.sqrt(2 * G * cells); this.air = true; this.sq.vel -= 3; } // a small stretch at take-off
  drop(cells: number) { this.y = -cells; this.vy = 0; this.air = true; }
  step(dt: number, squashTarget = 0) {
    if (this.air) {
      this.vy += G * dt; this.y += this.vy * dt;
      if (this.y >= 0) { this.sq.vel += this.vy * 0.55; this.y = 0; this.vy = 0; this.air = false; this.landed++; }
    }
    spring(this.sq, squashTarget, dt, this.sqK, this.sqZ);
  }
  get cy() { return Math.round(this.y); } // the hop, quantised to whole cells
}

export const cellFill = (x: CanvasRenderingContext2D, c: RGB, i: number, j: number, cell: number, a = 1) => {
  x.fillStyle = rgba(c, a);
  x.fillRect(Math.round(i * cell), Math.round(j * cell), cell, cell);
};

// The dither between two slices: which one a cell shows while the colour changes. The new slice comes in along `d`
// (0..1, the diagonal or a path), its front a band of Bayer thresholds, so cells flip one by one. Never a crossfade.
export function ditherPick(from: Tint, to: Tint, k: number, i: number, j: number, d: number): Tint {
  if (k >= 1 || from === to) return to;
  if (k <= 0) return from;
  const W = 0.35, v = (k * (1 + W) - d) / W;
  return bayer(i, j) < v ? to : from;
}

// ---- the named transitions ----
// Each is a small piece of choreography with the same shape: an anticipation (the body loads: a crouch, a lean, a
// breath in), the move itself (impulses into springs, tuned per move: stiffness and damping of the squash spring),
// and a colour sweep whose direction belongs to the move. `ant` is how long it loads before it goes; the colour
// waits `delay` ms and then sweeps for `dur` ms. Never a fade.
export type Move = "stamp" | "done" | "flinch" | "doze" | "wake" | "ponder" | "turn" | "prick" | "call" | "settle" | "shift";
type Sweep = "diag" | "up" | "down" | "out" | "in" | "snap";
type Spec = { ant: number; delay: number; dur: number; sweep: Sweep; k: number; z: number };
export const MOVES: Record<Move, Spec> = {
  stamp:  { ant: 120, delay: 120, dur: 520, sweep: "up",   k: 520, z: 0.22 }, // engine up: crouch, spring, land bouncing
  done:   { ant: 70,  delay: 70,  dur: 460, sweep: "down", k: 560, z: 0.3 },  // a reply finished: dip, then a satisfied pop
  flinch: { ant: 0,   delay: 50,  dur: 180, sweep: "snap", k: 760, z: 0.18 }, // an error: no anticipation, a reflex
  doze:   { ant: 0,   delay: 0,   dur: 800, sweep: "down", k: 260, z: 0.7 },  // sleep: sinks, the colour drains downward
  wake:   { ant: 140, delay: 140, dur: 520, sweep: "up",   k: 380, z: 0.3 },  // a stretch and a shake
  ponder: { ant: 130, delay: 130, dur: 600, sweep: "in",   k: 360, z: 0.45 }, // thinking: lean back, then the eye darts away
  turn:   { ant: 100, delay: 100, dur: 440, sweep: "out",  k: 460, z: 0.32 }, // speaking: a breath in, then out from the middle
  prick:  { ant: 70,  delay: 70,  dur: 340, sweep: "in",   k: 620, z: 0.26 }, // listening: shrinks a hair, then stands tall
  call:   { ant: 90,  delay: 90,  dur: 360, sweep: "out",  k: 600, z: 0.24 }, // attention: crouch, two hops
  settle: { ant: 0,   delay: 0,   dur: 480, sweep: "diag", k: 420, z: 0.5 },  // back to rest: softer, more damped
  shift:  { ant: 0,   delay: 0,   dur: 380, sweep: "diag", k: 600, z: 0.28 },
};
export function transitionName(from: Look, to: Look): Move {
  if (from === to) return "shift";
  if (to === "ok") return from === "speaking" || from === "thinking" ? "done" : "stamp";
  if (to === "warn") return "flinch";
  if (to === "rest") return "doze";
  if (from === "rest") return "wake";
  if (to === "attention") return "call";
  if (to === "thinking") return "ponder";
  if (to === "speaking") return "turn";
  if (to === "listening") return "prick";
  if (from === "ok" || from === "warn" || from === "attention" || from === "speaking" || from === "listening") return "settle";
  return "shift";
}
// where the new colour starts, given a widget's own 0..1 position `d`: up/down ride the diagonal one way or the other,
// out starts at the middle, in starts at the edges, snap hits every cell together (the Bayer scatter does the rest)
function sweepD(sweep: Sweep, d: number): number {
  switch (sweep) {
    case "up": return d;
    case "down": return 1 - d;
    case "out": return Math.abs(d * 2 - 1);
    case "in": return 1 - Math.abs(d * 2 - 1);
    case "snap": return 0.5;
    default: return d;
  }
}
// the band's flow direction per state: speaking pushes out, everything else draws in
const flowDir = (s: Look) => (s === "speaking" ? -1 : 1);

export class Life {
  hover = false; down = false; downAt = 0;
  cur = { x: 0.5, y: 0.5 }; look = { x: 0, y: 0 };
  private lx: Spring = { v: 0, vel: 0 }; private ly: Spring = { v: 0, vel: 0 };
  press: Spring = { v: 0, vel: 0 };
  body = new Body();
  get hop() { return { v: this.body.y }; } // older name, in cells now
  shake: Spring = { v: 0, vel: 0 };   // cells, sideways; kicked by flinch
  settle: Spring = { v: 0, vel: 0 };  // cells, downward; 1 asleep
  poked = 0; blink = 0; nextBlink = 2 + Math.random() * 4; private again = 0; blinkLen = 0.16;
  sway: Spring = { v: 0, vel: 0 };    // cells, sideways; a slow lean now and then (idle life)
  private swayAt = 8 + Math.random() * 6; private swayTill = 0; private swayTo = 0;
  rippleAt = -1e9;                    // when the last ring went out (poke, a call starting); the big mark draws it
  orb: Spring = { v: 1, vel: 0 }; orbW: Spring = { v: 0.6, vel: 0 }; orbA = 0; // the dust orbit: radius scale, angular speed, angle
  dust: Dust[] = []; private pool: Dust[] = [];
  t = 0; w = 0; h = 0; now = 0;
  watch = false;              // look toward the pointer anywhere in the window, not only when under it
  rect: DOMRect | null = null;
  slice: Tint | null = null; // dust colour; the live slice when null
  gravity = 60;               // dust gravity, px / s²
  drag = 2.2;                 // dust drag, 1 / s
  maxDust = 80;
  data: Record<string, number> = {}; // per-indicator scratch (a knob's spring, a fragment's spot)
  private springs: Spring[] = [];
  sp(i: number): Spring { return (this.springs[i] ??= { v: 0, vel: 0 }); } // persistent springs for a widget's own parts
  // the band's phase: integrates a velocity that springs toward the slice's speed and the state's direction,
  // so a change of slice accelerates instead of jumping, and speaking turns the flow round with momentum
  flow = 0; flowV: Spring = { v: 0, vel: 0 };

  // the transition being played
  tr: Move = "shift"; from: Look = live.look; to: Look = live.look;
  tk = 1;          // 0..1 over DUR
  fresh = false;   // true on the first frame of a transition
  colK = 1;        // 0..1, the dither sweep from live.prevSlice to live.slice
  private seen = live.since; private fired = 0; private calls = 0; private lastEnv = 0; private nodAt = 0;

  // idle life (the mark): a breath, a glance, an ear twitch. Off unless `idle` is set.
  idle = false;
  breath: Spring = { v: 0, vel: 0 }; private bt = Math.random() * 4; private period = 4.2; private duty = 0.4; private lastBreath = -9;
  private glanceAt = 3 + Math.random() * 4; private glanceTill = 0; private gx = 0; private gy = 0;
  twitch: Spring = { v: 0, vel: 0 }; twitchCell = 0; private twitchAt = 5 + Math.random() * 6;
  private px = -1; private py = -1; private still = 99;

  poke() { this.poked = 1; this.body.jump(1); this.blink = 0.16; this.shed(10); this.rippleAt = this.now || performance.now(); }
  // shed n cells of dust from (cx, cy); they leave with the parent's velocity (vx, vy, px/s) plus a burst
  shed(n: number, cx?: number, cy?: number, speed = 1, vx = 0, vy = 0) {
    for (let i = 0; i < n && this.dust.length < this.maxDust; i++) {
      const a = Math.random() * Math.PI * 2, v = (30 + Math.random() * 60) * speed;
      const d = this.pool.pop() ?? { x: 0, y: 0, vx: 0, vy: 0, life: 0, age: 0, u: 0 };
      d.x = cx ?? this.w / 2; d.y = cy ?? this.h / 2;
      d.vx = Math.cos(a) * v + vx; d.vy = Math.sin(a) * v - 30 * speed + vy;
      d.life = 0.6 + Math.random() * 0.5; d.age = 0; d.u = Math.random();
      this.dust.push(d);
    }
  }
  // which slice a cell shows right now (d: 0..1 along the widget's own diagonal or path)
  sliceAt(i: number, j: number, d: number): Tint { return ditherPick(live.prevSlice, live.slice, this.colK, i, j, sweepD(MOVES[this.tr].sweep, d)); }
  // once per transition: true the first frame `ms` has passed since the change
  private at(ms: number, bit: number) {
    if (this.fired & bit || this.now - live.since < ms) return false;
    this.fired |= bit; return true;
  }

  // The anticipation: what the body does in the first `ant` ms, before the move itself (see `launch`).
  private enter() {
    const b = this.body, m = MOVES[this.tr];
    b.sqK = m.k; b.sqZ = m.z;
    switch (this.tr) {
      case "stamp": b.sq.vel += 10; this.settle.vel += 4; break;                     // crouch
      case "done": b.sq.vel += 6; this.ly.vel += 3; break;                           // a dip, the eye drops
      case "flinch": this.shake.vel = 52; b.sq.vel += 13; this.blink = 0.14; this.blinkLen = 0.14; break; // recoil
      case "ponder": b.sq.vel += 3; this.lx.vel += 5; this.ly.vel += 6; break;       // lean back, look away from the thought
      case "turn": b.sq.vel -= 6; this.breath.vel += 6; break;                       // breath in: stretch tall
      case "prick": b.sq.vel += 5; break;                                            // shrink a hair
      case "call": b.sq.vel += 9; break;                                             // crouch
      case "settle": b.sq.vel += 5; break;
      case "wake": b.sq.vel -= 5; break;                                             // a stretch
      default: break;
    }
  }
  // the move itself, fired once `ant` ms after the change; and timed beats inside it
  private launch() {
    const b = this.body;
    switch (this.tr) {
      case "stamp": b.jump(1.6); break;                                              // up and over, landing rings (z 0.22)
      case "done": b.sq.vel -= 9; b.jump(0.6); this.blink = 0.12; break;             // pop tall, a small hop, a satisfied blink
      case "ponder": this.lx.vel -= 10; this.ly.vel -= 12; b.sq.vel -= 2; break;     // the eye darts up-left
      case "turn": b.jump(0.8); b.sq.vel += 3; break;
      case "prick": b.sq.vel -= 10; break;                                           // up on its toes
      case "call": b.jump(1.3); this.calls = 1; break;
      default: break;
    }
  }
  private beats() {
    const since = this.now - live.since, m = MOVES[this.tr];
    if (this.at(m.ant, 1)) this.launch();
    if (this.tr === "wake") {
      if (this.at(280, 2)) this.blink = 0.12;
      if (this.at(420, 4)) { this.shake.vel = 30; this.body.jump(0.8); }              // shakes it off
    }
    if (this.tr === "flinch" && since > 110 && this.at(110, 8)) { this.shake.vel = -34; this.body.sq.vel += 4; } // the second, smaller shudder
    if (this.tr === "call" && this.calls === 1 && this.body.landed > 0 && !this.body.air && since < 900) {
      this.calls = 2; this.body.jump(0.8); // the second, smaller hop
    }
    if (this.tr === "stamp" && this.at(520, 16)) this.blink = 0.1;
  }

  tick(dt: number, w: number, h: number, el: HTMLElement) {
    this.w = w; this.h = h;
    const now = (this.now = live.now || performance.now());
    this.t += dt * live.tempo;
    // a new transition: remember it, and play it only if it is news (a widget mounted later does not replay it)
    this.fresh = false;
    if (live.since !== this.seen) {
      this.seen = live.since; this.from = live.prevLook; this.to = live.look;
      this.tr = transitionName(this.from, this.to); this.fired = 0; this.body.landed = 0;
      if (now - live.since < DUR) { this.fresh = true; this.enter(); } else this.fired = 0xffff; // news only: a late widget skips the choreography
    }
    this.tk = clamp01((now - live.since) / DUR);
    this.beats();
    const mv = MOVES[this.tr];
    const delay = live.sliceSince === live.since ? mv.delay : 0;
    this.colK = clamp01((now - live.sliceSince - delay) / (live.sliceSince === live.since ? mv.dur : 380));

    // where the eye looks: the pointer when it is near (or anywhere, watching), up-left thinking, a glance at rest
    let tx = 0, ty = 0;
    if (pointer.x !== this.px || pointer.y !== this.py) { this.px = pointer.x; this.py = pointer.y; this.still = 0; } else this.still += dt;
    const glancing = this.idle && now < this.glanceTill;
    if (this.hover) { tx = this.cur.x * 2 - 1; ty = this.cur.y * 2 - 1; }
    else if (this.watch && pointer.inside && !(glancing && this.still > 2)) {
      const r = (this.rect = el.getBoundingClientRect());
      tx = clamp((pointer.x - (r.left + r.width / 2)) / 260); ty = clamp((pointer.y - (r.top + r.height / 2)) / 160);
    } else if (live.look === "thinking" && now - live.since > MOVES.ponder.ant) {
      // thinking: the gaze drifts on two slow, unrelated rhythms, like someone looking for the word
      tx = -0.45 + Math.sin(this.t * 1.1) * 0.3 + Math.sin(this.t * 2.9) * 0.08; ty = -0.65 + Math.sin(this.t * 0.8 + 1) * 0.18;
    }
    else if (glancing) { tx = this.gx; ty = this.gy; }
    // the gaze is a spring: loose enough to overshoot a dart, tight enough to follow a pointer
    const glanceK = live.look === "thinking" ? 90 : 140;
    spring(this.lx, tx, dt, glanceK, 0.55); spring(this.ly, ty, dt, glanceK, 0.55);
    this.look.x = this.lx.v; this.look.y = this.ly.v;

    spring(this.press, this.down ? 1 : 0, dt, 220, 0.3);
    // what the body leans toward between moves: speaking pulses with the voice (squash follows the level, so a loud
    // syllable presses it down and the spring rings it back); listening nods on a rising edge of the mic
    let sqT = 0;
    if (live.look === "speaking") sqT = live.env * 0.55;
    else if (live.look === "listening") {
      if (live.env - this.lastEnv > 0.2 && now - this.nodAt > 350) { this.nodAt = now; this.body.sq.vel += 3.5; }
      sqT = -live.env * 0.12;
    }
    this.lastEnv = live.env;
    this.body.step(dt, sqT);
    spring(this.shake, 0, dt, 1400, 0.12);
    // asleep sinks a cell; an error sags a cell a beat after the flinch, then lifts when it passes
    const sag = live.look === "rest" || (live.look === "warn" && now - live.since > 220) ? 1 : 0;
    spring(this.settle, sag, dt, live.look === "warn" ? 120 : 45, live.look === "warn" ? 0.5 : 0.85);
    // the dust orbit: wide and slow idle, tight and quick thinking, pulsing with the voice speaking, open listening
    const orbR = { rest: 0.7, plain: 1, listening: 1.22 - live.env * 0.3, thinking: 0.72, speaking: 1 + live.env * 0.55, ok: 1.5, warn: 0.5, attention: 1.7 }[live.look];
    const orbW = { rest: 0.12, plain: 0.6, listening: 0.4, thinking: 2.6, speaking: 1.1 + live.env * 2, ok: 1.4, warn: 0.15, attention: 3 }[live.look];
    spring(this.orb, orbR, dt, 60, 0.45); spring(this.orbW, orbW, dt, 30, 0.8);
    this.orbA += this.orbW.v * dt;
    spring(this.flowV, live.slice.speed * flowDir(live.look), dt, 25, 1);
    this.flow += this.flowV.v * dt * live.tempo;

    this.poked *= Math.pow(0.05, dt);
    this.nextBlink -= dt;
    if (this.nextBlink < 0 && live.look !== "rest") {
      // blinks vary: mostly one, sometimes two close together, now and then a slow one
      if (this.again > 0) { this.again--; this.blinkLen = 0.1; this.blink = 0.1; this.nextBlink = 0.18; }
      else {
        const r = Math.random();
        this.blinkLen = r < 0.12 ? 0.32 : 0.15 + Math.random() * 0.04;
        this.blink = this.blinkLen; this.again = r > 0.7 ? 1 : 0;
        this.nextBlink = 1.8 + Math.random() * 4.5 + (live.look === "thinking" ? 1.5 : 0);
      }
    }
    this.blink = Math.max(0, this.blink - dt);

    if (this.idle) this.idleLife(dt);

    // dust: gravity, drag on both axes, gone when its life is up (dead ones go back to the pool, no garbage)
    const k = Math.exp(-this.drag * dt), g = this.gravity * dt;
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.age += dt;
      if (d.age >= d.life) { const last = this.dust.pop()!; if (last !== d) this.dust[i] = last; this.pool.push(d); continue; }
      d.vy += g; d.vx *= k; d.vy *= k; d.x += d.vx * dt; d.y += d.vy * dt;
    }
  }

  // breath every ~4 s (slower asleep), a glance every 6-10 s, an ear twitch now and then. Cosmetic and calm.
  private idleLife(dt: number) {
    this.bt += dt * (live.look === "rest" ? 0.55 : 1);
    // each breath has its own length and depth of rest: a long one now and then, a shallow quick one after a glance
    const ph = (this.bt % this.period) / this.period;
    if (ph < 0.02 && this.bt - this.lastBreath > 1) { this.lastBreath = this.bt; this.period = 3.4 + Math.random() * 2.4; this.duty = 0.3 + Math.random() * 0.25; }
    spring(this.breath, ph > 0.08 && ph < 0.08 + this.duty ? 1 : 0, dt, 18, 0.9);
    // a slow lean to one side and back, a cell, held for a moment, like shifting weight
    if (live.look !== "rest" && live.look !== "warn") {
      this.swayAt -= dt;
      if (this.swayAt < 0) { this.swayAt = 9 + Math.random() * 9; this.swayTill = this.now + 1100 + Math.random() * 900; this.swayTo = Math.random() < 0.5 ? -1 : 1; }
    }
    spring(this.sway, this.now < this.swayTill ? this.swayTo : 0, dt, 22, 1);
    if (live.look !== "rest") {
      this.glanceAt -= dt;
      if (this.glanceAt < 0) {
        this.glanceAt = 6 + Math.random() * 4;
        this.glanceTill = this.now + 700 + Math.random() * 800;
        this.gx = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.4); this.gy = (Math.random() - 0.6) * 0.8;
      }
      this.twitchAt -= dt;
      if (this.twitchAt < 0) { this.twitchAt = 7 + Math.random() * 8; this.twitchCell = Math.random() < 0.6 ? 0 : 1; this.twitch.vel = 22; }
    }
    spring(this.twitch, 0, dt, 900, 0.3);
  }

  drawDust(x: CanvasRenderingContext2D, cell = 4) {
    const s = this.slice ?? live.slice;
    for (const d of this.dust) {
      x.fillStyle = rgba(tintAt(s, d.u * 2), (1 - d.age / d.life) * 0.7);
      x.fillRect(Math.round(d.x / cell) * cell, Math.round(d.y / cell) * cell, cell, cell);
    }
  }
  // the eye: a black cell and a white cell; `open` is how tall they stand. The lid comes down from the top, so a
  // squint or a closing eye keeps its bottom edge; wider than open grows both ways.
  eye(x: CanvasRenderingContext2D, cx: number, cy: number, cell: number, open = 1, lookx = 0, looky = 0) {
    cell = Math.max(1, Math.round(cell));
    const h = Math.max(1, Math.round(Math.max(cell * 0.2, cell * open)));
    const bottom = cy + cell / 2 + (h > cell ? (h - cell) / 2 : 0);
    const ex = Math.round(cx + lookx * cell * 0.4), ey = Math.round(bottom - h + looky * cell * 0.3);
    x.fillStyle = "#0a0a0a"; x.fillRect(ex, ey, cell, h);
    if (open > 0.2) { x.fillStyle = "#fff"; x.fillRect(ex + cell, ey, cell, h); }
  }
  // closed asleep (the lid drops in three steps), calm idle, wide listening (and on hover), squinting speaking,
  // half shut while pressed; waking opens it halfway, then fully, then blinks
  eyeOpen() {
    const since = this.now - live.since;
    if (live.look === "rest") return since < 210 ? 1 - Math.min(3, Math.floor(since / 70) + 1) / 3 : 0;
    if (this.tr === "wake" && since < 160) return since < 80 ? 0.34 : 0.67;
    let o = this.blink > 0 ? (this.blinkLen > 0.25 && this.blink < this.blinkLen * 0.35 ? 0.5 : 0.1) : 1; // a slow blink opens in two steps
    if (this.down) o *= 0.45;
    if (this.hover || live.look === "listening") o *= 1.3;
    if (live.look === "speaking") o *= 0.6;
    if (live.look === "warn") o *= 0.72;      // heavy-lidded while something is wrong
    if (live.look === "thinking") o *= 0.85;
    return o;
  }
}

export type WidgetDraw = (l: Life, x: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) => void;
export type TransitionHook = (l: Life, from: Look, to: Look, k: number) => void;

// host "parent": the pointer life listens on the canvas's parent (the canvas itself lets events through),
// for indicators laid over a control that already owns its pointer handling (a slider track, the box).
// transition: called every frame while a state transition plays (k 0..1, and once more at 1), before draw.
export function Creature({ draw, className, style, host = "self", watch, onPoke, life, dustCell = 4, setup, transition }: {
  draw: WidgetDraw; className?: string; style?: React.CSSProperties; host?: "self" | "parent"; watch?: boolean;
  onPoke?: (l: Life) => boolean | void; life?: React.MutableRefObject<Life | null>; dustCell?: number; setup?: (l: Life) => void;
  transition?: TransitionHook;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const trRef = useRef(transition);
  trRef.current = transition;
  const pokeRef = useRef(onPoke);
  pokeRef.current = onPoke;
  const own = useRef<Life | null>(null);
  if (!own.current) { own.current = new Life(); setup?.(own.current); }
  if (life) life.current = own.current;
  own.current.watch = !!watch;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const l = own.current!;
    const target: HTMLElement = host === "parent" && c.parentElement ? c.parentElement : c;
    const move = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      l.cur.x = (e.clientX - r.left) / (r.width || 1); l.cur.y = (e.clientY - r.top) / (r.height || 1);
    };
    const enter = () => { l.hover = true; };
    const leave = () => { l.hover = false; if (host === "self") l.down = false; };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      l.down = true; l.downAt = performance.now();
      if (host === "self") { try { c.setPointerCapture(e.pointerId); } catch { /* gone */ } }
    };
    const up = () => {
      if (l.down && performance.now() - l.downAt < 300) { if (!pokeRef.current?.(l)) l.poke(); }
      l.down = false;
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerenter", enter);
    target.addEventListener("pointerleave", leave);
    target.addEventListener("pointerdown", down);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    let lastK = 1;
    register(c, (x, w, h, dt) => {
      l.tick(dt, w, h, c);
      const hook = trRef.current;
      if (hook && (l.tk < 1 || lastK < 1)) hook(l, l.from, l.to, l.tk);
      lastK = l.tk;
      drawRef.current(l, x, w, h, l.t, dt);
      l.drawDust(x, dustCell);
    });
    return () => {
      unregister(c);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerenter", enter);
      target.removeEventListener("pointerleave", leave);
      target.removeEventListener("pointerdown", down);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
  }, [host, dustCell]);

  return <canvas ref={ref} className={`creature ${className ?? ""}`} style={style} aria-hidden="true" />;
}

// The scenes' stage (Companion step 4, scenes.ts): one full-window canvas over the interface, letting every pointer
// event through (the plug's drag is caught by scenes.ts itself). It is up only while a scene runs here: a canvas over
// the whole window is graphics memory even when it draws nothing (#81).
export function SceneLayer() { return useSyncExternalStore(onRuns, running, () => false) ? <SceneCanvas /> : null; }
function SceneCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    register(c, (x, w, h, _dt, now) => drawScenes(x, w, h, now));
    return () => unregister(c);
  }, []);
  return <canvas ref={ref} className="scenes" aria-hidden="true" />;
}
