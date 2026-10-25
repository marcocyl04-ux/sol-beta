// The creature in the sheet: Sol's own pixel creature (the notch's mark, the same 14 x 14 cells from Mark.tsx), drawn by
// the creature loop (creature/Widget.tsx <Creature>). It has a job in every room: it enters from the top centre where
// the notch is, hops ahead to the window under the pointer, holds the picture's corner and watches the pen, sits on the
// card's corner, rides the card up at the send, and in the tray looks at the lit thing. The class keeps the old bead's
// name and API (place / hop / look / lookAt / nod / stop, BEAD, BeadView), so the rooms did not change.
//
// Travel is the old bead's: one progress spring along an arc (src/motion.ts Spring), a squash spring kicked on landing.
// The container div only translates, in whole pixels; the stretch along the way and the landing squash are handed to the
// canvas and drawn there in whole device pixels, so the cells stay crisp (a CSS scale would resample them). Everything
// else is the creature's own life: it watches the pointer anywhere on the sheet, blinks, breathes, twitches an ear.
// look() / lookAt() hold its gaze on a point for a moment, then the pointer has it again; nod() is a small hop and a blink.
//
// The sheet never starts renovation (no hello to the engine), so the shared state stays Unplugged; the draw ignores the
// state's look (no sag, no heavy lid) and the dust wears the home seat's colours.
import { useEffect, useRef } from "react";
import { CFG, Spring } from "../motion";
import { Creature, clamp, type Life } from "../creature/Widget";
import { TINTS, rgba } from "../creature/ring";
import { CELLS, EYES, LET } from "../Mark";

export const BEAD = 28;
const PAD = BEAD;                // the canvas reaches this far round the box: room for a hop, a squash and dust
const SIDE = BEAD + PAD * 2;

/** what the travel springs hand the canvas each frame */
type Pose = { along: number; ang: number; sq: number; gx: number; gy: number; gw: number };

export class Bead {
  x = 0; y = 0;
  private from = { x: 0, y: 0 }; private dest = { x: 0, y: 0 }; private lift = 0; private stretch = 0; private ang = 0;
  private p: Spring; private sq: Spring; private ex: Spring; private ey: Spring; private gw: Spring;
  private landed: (() => void) | null = null;
  private hold = 0;
  constructor(private el: HTMLElement, private pose: Pose, private life: { current: Life | null }) {
    this.p = new Spring(1, { k: 150, z: 1, eps: 0.002 }, (v) => this.fly(v), () => { const f = this.landed; this.landed = null; if (this.stretch) this.sq.kick(-3.2 * this.stretch); f?.(); });
    this.sq = new Spring(0, { k: 520, z: 0.42, eps: 0.002 }, () => this.draw());
    this.ex = new Spring(0, CFG.snap, (v) => { this.pose.gx = v; });
    this.ey = new Spring(0, CFG.snap, (v) => { this.pose.gy = v; });
    this.gw = new Spring(0, CFG.snap, (v) => { this.pose.gw = v; });
  }
  /** jump there, no travel */
  place(x: number, y: number) { this.p.stop(); this.x = x; this.y = y; this.from = this.dest = { x, y }; this.stretch = 0; this.draw(); }
  /** travel on an arc to (x, y): stretched on the way, squashed on landing. `ms` is a rough length (the spring's stiffness). */
  hop(x: number, y: number, o: { lift?: number; ms?: number } = {}): Promise<void> {
    const dx = x - this.x, dy = y - this.y, dist = Math.hypot(dx, dy);
    if (dist < 1) { this.place(x, y); return Promise.resolve(); }
    const ms = o.ms ?? Math.min(720, 380 + dist * 0.4);
    this.from = { x: this.x, y: this.y }; this.dest = { x, y };
    this.lift = o.lift ?? Math.min(48, 14 + dist * 0.06);
    this.stretch = Math.min(1, 0.35 + dist / 500);
    this.ang = Math.atan2(dy, dx);
    const k = (4.6 / (ms / 1000)) ** 2;      // a critically damped spring settles in about 4.6 / sqrt(k) seconds
    this.landed?.();
    return new Promise((ok) => { this.landed = ok; this.p.set(0); this.p.to(1, { cfg: { k, z: 1, eps: 0.002 } }); });
  }
  /** hold the gaze toward (dx, dy) (each up to about 3) for a moment; then the creature watches the pointer again */
  look(dx: number, dy: number) {
    const m = Math.hypot(dx, dy) || 1, s = Math.min(1, m / 3);
    this.ex.to((dx / m) * s); this.ey.to((dy / m) * s); this.gw.to(1);
    window.clearTimeout(this.hold);
    this.hold = window.setTimeout(() => this.gw.to(0), 1600);
  }
  /** hold the gaze on a point on the page */
  lookAt(px: number, py: number) { const cx = this.x + BEAD / 2, cy = this.y + BEAD / 2, d = Math.hypot(px - cx, py - cy) || 1; this.look(((px - cx) / d) * 3, ((py - cy) / d) * 3); }
  /** a small hop and a blink (the creature's own body), with the old squash kick under it */
  nod() { const l = this.life.current; if (l) { l.body.jump(0.6); l.blink = 0.12; } this.sq.kick(-2.2); }
  stop() { this.p.stop(); this.sq.stop(); this.ex.stop(); this.ey.stop(); this.gw.stop(); window.clearTimeout(this.hold); }
  private fly(v: number) {
    this.x = this.from.x + (this.dest.x - this.from.x) * v;
    this.y = this.from.y + (this.dest.y - this.from.y) * v - this.lift * Math.sin(Math.PI * Math.min(1, Math.max(0, v)));
    this.draw();
  }
  private draw() {
    // the box moves in whole pixels; the stretch and squash go to the canvas
    this.pose.along = this.p.resting ? 0 : this.stretch * Math.sin(Math.PI * Math.min(1, Math.max(0, this.p.v)));
    this.pose.ang = this.ang;
    this.pose.sq = this.sq.v;
    this.el.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
  }
}

/** the creature's element; `onReady` hands the Bead to the sheet once mounted */
export function BeadView({ onReady }: { onReady: (b: Bead) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const life = useRef<Life | null>(null);
  const pose = useRef<Pose>({ along: 0, ang: 0, sq: 0, gx: 0, gy: 0, gw: 0 });
  const ready = useRef(onReady); ready.current = onReady;
  useEffect(() => {
    const b = new Bead(el.current!, pose.current, life);
    b.place(innerWidth / 2 - BEAD / 2, -BEAD - 8);
    ready.current(b);
    return () => b.stop();
  }, []);
  return (
    <div className="bead" ref={el} aria-hidden>
      <Creature life={life} className="bead-c" watch dustCell={2} style={{ left: -PAD, top: -PAD, width: SIDE, height: SIDE }}
        setup={(l) => { l.idle = true; l.slice = TINTS.home; l.maxDust = 24; }}
        draw={(l, x, w, h) => drawCreature(l, x, w, h, pose.current)} />
    </div>
  );
}

// The mark's cells (Mark.tsx MarkLive, the small form) at 2 px a cell, standing on the box's bottom edge. Every size and
// offset is a whole number of device pixels.
function drawCreature(l: Life, x: CanvasRenderingContext2D, w: number, h: number, o: Pose) {
  const dpr = x.canvas.width / (w || 1), px = (v: number) => Math.round(v * dpr) / dpr;
  const cell = Math.max(1, Math.floor((BEAD * dpr) / 14)) / dpr;
  // the travel: longer along the way it goes; the landing: wide and low. The body's own squash and press add in.
  const c = Math.abs(Math.cos(o.ang)), s = Math.abs(Math.sin(o.ang));
  const sq = clamp(l.body.sq.v + l.press.v - o.sq * 0.6, -0.6, 0.8);
  const sx = 1 + 0.18 * o.along * c - 0.14 * o.along * s + sq * 0.12;
  const sy = 1 + 0.18 * o.along * s - 0.14 * o.along * c - sq * 0.15;
  const cw = Math.max(1 / dpr, px(cell * sx)), ch = Math.max(1 / dpr, px(cell * sy));
  const feet = h / 2 + BEAD / 2;
  const lift = l.body.cy;                                         // cells, negative is up
  const ox = px(w / 2 - 7 * cw + (Math.round(l.shake.v) + Math.round(l.sway.v)) * cell);
  const oy = px(feet - 14 * ch + lift * cell);
  const br = Math.round(l.breath.v), tw = Math.round(l.twitch.v), ear = EARS[l.twitchCell];
  for (const k of CELLS) {
    x.fillStyle = rgba(k.ch === "#" || k.ch === "w" ? LET.b : LET[k.ch]);
    let j = k.j;
    if (k.j <= 5) {
      if (br && k.j === 5) x.fillRect(ox + k.i * cw, oy + j * ch, cw, ch);
      j -= br;
    }
    if (tw && k.i === ear[0] && k.j === ear[1]) j -= tw;
    x.fillRect(ox + k.i * cw, oy + j * ch, cw, ch);
  }
  // the eyes: open unless it blinks (the sheet's state is never the engine's, so no sleepy or heavy lid); toward the
  // pointer, or toward what a room asked it to look at
  const open = l.blink > 0 ? (l.blinkLen > 0.25 && l.blink < l.blinkLen * 0.35 ? 0.5 : 0.1) : 1;
  if (open >= 0.3) {
    const gx = l.look.x + (o.gx - l.look.x) * o.gw, gy = l.look.y + (o.gy - l.look.y) * o.gw;
    const eh = Math.max(1 / dpr, px(ch * Math.min(1, open)));
    const dx = px(gx * cw * 0.5), dy = px(gy * ch * 0.4) + (ch - eh);
    for (const [i, col] of EYES) { x.fillStyle = col; x.fillRect(ox + i * cw + dx, oy + 6 * ch + dy, cw, eh); }
  }
}
const EARS = [[11, 1], [10, 1]];
