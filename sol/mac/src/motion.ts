// Motion for everything that is not a canvas: one tiny spring solver, one frame loop, and the helpers every
// surface uses (enter, press, slide pills). No dependency: a spring is ten lines and a retargetable spring is
// what makes motion feel physical (hover in, hover out mid-flight, and the velocity carries on, never a restart).
//
// Rules this file enforces for the rest of the app:
//  - motion slides, never fades: the helpers move `translate` / `scale` / `height`, never opacity (one exception the
//    PRD names: the scroll orb, Orb.tsx, fades on `arrive` as it rises);
//  - one retargetable spring per moving thing (Spring.to keeps position and velocity), so an interrupted move bends;
//  - every spring has mass, stiffness and a damping ratio, tuned per move (CFG below);
//  - reduced motion: every spring jumps to its target.
//
// Springs write with `apply(value, spring)` each frame and once more at rest. They are stepped in 1/240 s
// sub-steps (semi-implicit Euler) so a slow frame cannot blow a stiff one up.
import { useEffect, useLayoutEffect, useRef } from "react";

export type Cfg = { k: number; z: number; m?: number; eps?: number };
// stiffness k (1/s² at unit mass), damping ratio z (1 critical, below 1 overshoots), mass m (heavier = slower, lazier)
export const CFG = {
  glide: { k: 190, z: 0.92 },              // panels: the sidebar, the sheet; lands with the faintest settle
  away: { k: 330, z: 0.95 },               // a panel leaving: brisk, no settle
  panel: { k: 260, z: 0.72, eps: 0.0015 },    // a page changing: a little overshoot
  fold: { k: 230, z: 0.76, eps: 0.0015 },     // heights unfolding
  tuck: { k: 300, z: 0.95, eps: 0.0015 },     // heights folding away
  slide: { k: 240, z: 0.7 },               // things arriving: rows, lines, bubbles
  arrive: { k: 170, z: 0.78, m: 1.1 },     // heavier arrivals: an answer opening
  snap: { k: 420, z: 0.6 },                // knobs and pills: quick, one small overshoot
  pop: { k: 520, z: 0.38 },                // tactile: a press released
  press: { k: 700, z: 0.8 },               // a press going in
  grow: { k: 340, z: 0.8 },                // the composer
  settle: { k: 90, z: 1 },                 // slow, no overshoot
} satisfies Record<string, Cfg>;

const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
export const reducedMotion = () => !!mq?.matches;

export class Spring {
  v: number; vel = 0; target: number; cfg: Cfg;
  at = 0;                 // frame time before which it waits (a stagger)
  on = false;
  constructor(v: number, cfg: Cfg, private apply: (v: number, s: Spring) => void, public rest?: () => void) {
    this.v = v; this.target = v; this.cfg = cfg;
  }
  /** Move toward `t`, keeping position and velocity. `vel` adds a kick; `delay` (ms) waits before it starts. */
  to(t: number, o: { vel?: number; delay?: number; cfg?: Cfg } = {}) {
    if (o.cfg) this.cfg = o.cfg;
    this.target = t;
    if (o.vel) this.vel += o.vel;
    if (reducedMotion()) { this.v = t; this.vel = 0; this.apply(this.v, this); this.rest?.(); this.stop(); return this; }
    this.at = o.delay ? performance.now() + o.delay : 0;
    this.go();
    return this;
  }
  /** Jump there, now, with no velocity (a drag follows the finger). */
  set(v: number, vel = 0) { this.v = v; this.target = v; this.vel = vel; this.apply(v, this); return this; }
  kick(dv: number) { this.vel += dv; this.go(); return this; }
  get resting() { return !this.on; }
  stop() { this.on = false; active.delete(this); }
  private go() { if (!this.on) { this.on = true; active.add(this); } wake(); }
  step(dt: number): boolean {
    const { k, z, m = 1, eps = 0.01 } = this.cfg;
    const c = 2 * z * Math.sqrt(k * m);
    let left = dt;
    while (left > 1e-6) {
      const h = left > 1 / 240 ? 1 / 240 : left;
      this.vel += ((-(this.v - this.target) * k - c * this.vel) / m) * h;
      this.v += this.vel * h;
      left -= h;
    }
    if (Math.abs(this.v - this.target) < eps && Math.abs(this.vel) < eps * 8) {
      this.v = this.target; this.vel = 0; this.on = false; this.apply(this.v, this); this.rest?.();
      return false;
    }
    this.apply(this.v, this);
    return true;
  }
}

const active = new Set<Spring>();
let raf = 0, last = 0, guard = 0;
/** told once per stall, with the silence in ms (the notch logs it) */
let onStall: ((ms: number) => void) | null = null;
export function setOnStall(f: ((ms: number) => void) | null) { onStall = f; }
/** called once per frame after every spring has stepped (the notch's scene draws here, on the springs' clock) */
let frameHook: (() => void) | null = null;
export function onFrame(f: (() => void) | null) { frameHook = f; }
/** one frame on the loop's clock even with no spring moving (a drawing marked dirty outside a step) */
export function requestFrame() { wake(); }
function stepAll(dt: number, now: number) {
  for (const s of [...active]) {
    if (s.at && now < s.at) continue;
    s.at = 0;
    if (!s.step(dt)) active.delete(s);
  }
}
/** one motion run (from the first spring moving to the last at rest): the frame gaps and the work in each frame, for a
 *  smoothness report (the notch logs it): frames, the longest gap, how many gaps ran past 20 ms, the work's p95 */
export type RunReport = { frames: number; ms: number; maxGap: number; longGaps: number; workP95: number; workMax: number };
let onRun: ((r: RunReport) => void) | null = null;
export function setOnRun(f: ((r: RunReport) => void) | null) { onRun = f; }
let runStart = 0, runFrames = 0, runMaxGap = 0, runLong = 0;
const runWork: number[] = [];
function frame(now: number) {
  raf = -1;   // inside the frame: a wake from a spring's apply is this frame's (it used to schedule a second callback)
  const gap = now - last;
  const dt = Math.min(gap / 1000, 1 / 20);
  last = now;
  if (!runFrames) runStart = now; else { if (gap > runMaxGap) runMaxGap = gap; if (gap > 20) runLong++; }
  runFrames++;
  const t0 = performance.now();
  stepAll(dt, now);
  frameHook?.();
  runWork.push(performance.now() - t0);
  raf = 0;
  if (active.size) raf = requestAnimationFrame(frame);
  else {
    stopGuard();
    if (onRun && runFrames > 3) {
      const w = [...runWork].sort((a, b) => a - b);
      onRun({ frames: runFrames, ms: Math.round(now - runStart), maxGap: Math.round(runMaxGap), longGaps: runLong, workP95: +w[Math.floor(w.length * 0.95)].toFixed(2), workMax: +w[w.length - 1].toFixed(2) });
    }
    runFrames = 0; runMaxGap = 0; runLong = 0; runWork.length = 0;
  }
}
// The frame clock is WebKit's and it stops whenever WebKit holds the window to be out of sight (a display plugged or
// unplugged, a full-screen Space, the lid, sleep). A spring in flight then froze where it was: the notch's moon left
// short with its discs half faded, the creature halfway from the wing (Marco's two shots, 2026-10-26). The guard is a
// plain timer: while any spring moves and no frame has come for 120 ms, it steps every spring up to the real time
// itself, so a motion always ends where it was told to go, seen or not.
// A silence is not always a stall: the page busy for a few hundred ms (a long render) silences the frames too, and
// stepping the whole silence then made every motion on screen leap to its end at once. So the guard carries on by one
// frame's worth per tick, as a slow frame does, and the motion goes on from where it was; only a window out of sight
// or a silence past a second (nobody saw it move) catches up whole.
const STALL = 1000;
function startGuard() {
  if (guard || typeof window === "undefined") return;
  guard = window.setInterval(() => {
    if (!active.size) { stopGuard(); return; }
    const now = performance.now(), silent = now - last;
    if (silent < 120) return;
    onStall?.(silent);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const unseen = silent > STALL || (typeof document !== "undefined" && document.hidden);
    let left = unseen ? silent / 1000 : 1 / 20;
    while (left > 0 && active.size) { const h = Math.min(left, 1 / 20); stepAll(h, now); left -= h; }
    frameHook?.();
    last = now;
    if (active.size) raf = requestAnimationFrame(frame); else stopGuard();
  }, 60);
}
function stopGuard() { if (guard) { window.clearInterval(guard); guard = 0; } }
function wake() {
  if (raf || typeof requestAnimationFrame === "undefined") return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
  startGuard();
}

export const spring = (v: number, cfg: Cfg, apply: (v: number, s: Spring) => void, rest?: () => void) => new Spring(v, cfg, apply, rest);

/** A spring owned by a component: stable across renders, stopped on unmount. `apply` may change every render. */
export function useSpring(init: number, cfg: Cfg, apply: (v: number, s: Spring) => void, rest?: () => void): Spring {
  const a = useRef(apply); a.current = apply;
  const r = useRef(rest); r.current = rest;
  const s = useRef<Spring | null>(null);
  if (!s.current) s.current = new Spring(init, cfg, (v, sp) => a.current(v, sp), () => r.current?.());
  useEffect(() => () => s.current?.stop(), []);
  return s.current;
}

// ---- enter: a thing arrives by sliding from an offset, springs home, no opacity ----
const entering = new WeakMap<HTMLElement, Spring>();
export function enter(el: HTMLElement, o: { x?: number; y?: number; delay?: number; cfg?: Cfg; scale?: number; kick?: number } = {}) {
  const { x = 0, y = 0, delay = 0, cfg = CFG.slide, scale = 0 } = o;
  entering.get(el)?.stop();
  if (reducedMotion()) { el.style.translate = ""; el.style.scale = ""; return null; }
  const put = (p: number) => {
    el.style.translate = `${x * (1 - p)}px ${y * (1 - p)}px`;
    if (scale) el.style.scale = String(1 - scale * (1 - p));
  };
  const s = new Spring(0, { ...cfg, eps: 0.002 }, (p, sp) => {
    if (sp.resting && Math.abs(p - 1) < 1e-4) { el.style.translate = ""; el.style.scale = ""; entering.delete(el); } else put(p);
  });
  entering.set(el, s);
  put(0);
  s.to(1, { delay, vel: o.kick });
  return s;
}
/** A list arriving: each child enters in turn. */
export function stagger(els: ArrayLike<Element>, o: { x?: number; y?: number; delay?: number; gap?: number; max?: number; cfg?: Cfg } = {}) {
  const n = Math.min(els.length, o.max ?? 9);
  for (let i = 0; i < n; i++) enter(els[i] as HTMLElement, { x: o.x, y: o.y, cfg: o.cfg, delay: (o.delay ?? 0) + i * (o.gap ?? 34) });
}
/** Run `fn` once when the element first mounts (before paint). */
export function useEnter(o: Parameters<typeof enter>[1] | false) {
  const ref = useRef<HTMLElement | null>(null);
  const opts = useRef(o); opts.current = o;
  useLayoutEffect(() => { if (ref.current && opts.current) enter(ref.current, opts.current); }, []);
  return ref as React.RefObject<never>;
}

// ---- press: every button and row gives under the finger and pops back past rest ----
// Delegated, so nothing else needs to know. Wide things move a few pixels, small keys a few percent.
const PRESS = "button, [role=button], [data-press], .row, .hrow, .vcard, .tab";
const held = new Map<HTMLElement, Spring>();
export function installPress() {
  if (typeof document === "undefined") return;
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || reducedMotion()) return;
    const el = (e.target as Element | null)?.closest?.(PRESS) as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled || el.dataset.nopress !== undefined) return;
    const w = el.offsetWidth || 40;
    const amt = Math.min(0.09, Math.max(0.014, 5 / w));
    let s = held.get(el);
    if (!s) {
      s = new Spring(0, { ...CFG.press, eps: 0.003 }, (p, sp) => {
        if (sp.resting && Math.abs(p) < 0.004) { el.style.scale = ""; held.delete(el); } else el.style.scale = String(1 - amt * p);
      });
      held.set(el, s);
    }
    s.cfg = CFG.press;
    (s as Spring & { t0?: number }).t0 = performance.now();
    s.to(1);
  };
  const up = () => {
    for (const [, s] of held) {
      const wait = Math.max(0, 70 - (performance.now() - ((s as Spring & { t0?: number }).t0 ?? 0)));
      s.to(0, { cfg: CFG.pop, delay: wait });
    }
  };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);
}

// ---- a pill that slides to an element: the hover highlight, the active row, the chosen language ----
// Position and size are four springs, so the pill stretches as it travels; it grows in from nothing the first
// time and shrinks away to nothing when there is nowhere to be.
export function slidePill(container: HTMLElement, pill: HTMLElement, o: { fit?: boolean; dx?: number; dy?: number; cfg?: Cfg } = {}) {
  const fit = o.fit !== false, cfg = { ...(o.cfg ?? CFG.snap), eps: 0.05 };
  const v = { x: 0, y: 0, w: 0, h: 0, s: 0 };
  let seen = false, el: HTMLElement | null = null;
  const put = () => {
    pill.style.translate = `${v.x}px ${v.y}px`;
    if (fit) { pill.style.width = `${Math.max(0, v.w)}px`; pill.style.height = `${Math.max(0, v.h)}px`; }
    pill.style.scale = `${Math.max(0, v.s)}`;
    pill.style.visibility = v.s < 0.01 && !el ? "hidden" : "visible";
  };
  const mk = (key: "x" | "y" | "w" | "h" | "s", c: Cfg) => new Spring(0, c, (n) => { v[key] = n; put(); });
  const sx = mk("x", cfg), sy = mk("y", { ...cfg, k: cfg.k * 0.8 }), sw = mk("w", cfg), sh = mk("h", { ...cfg, k: cfg.k * 0.9 }), ss = mk("s", { k: 360, z: 0.8, eps: 0.004 });
  put();
  // layout position, not painted position: a row still sliding in does not drag its pill off to the side
  const rectOf = (t: HTMLElement) => {
    let x = 0, y = 0, n: HTMLElement | null = t;
    while (n && n !== container) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent as HTMLElement | null; }
    if (!n) { const c = container.getBoundingClientRect(), r = t.getBoundingClientRect(); x = r.left - c.left + container.scrollLeft; y = r.top - c.top + container.scrollTop; }
    return { x: x + (o.dx ?? 0), y: y + (o.dy ?? 0), w: t.offsetWidth, h: t.offsetHeight };
  };
  return {
    to(t: HTMLElement | null, instant = false) {
      el = t;
      if (!t) { ss.to(0); return; }
      const r = rectOf(t);
      if (!seen || instant || reducedMotion()) {
        sx.set(r.x); sy.set(r.y); sw.set(r.w); sh.set(r.h);
        if (!seen) { v.s = 0; ss.set(0); }
        seen = true; ss.to(1); return;
      }
      if (Math.abs(sx.target - r.x) > 0.5 || Math.abs(sy.target - r.y) > 0.5 || Math.abs(sw.target - r.w) > 0.5 || Math.abs(sh.target - r.h) > 0.5) {
        sx.to(r.x); sy.to(r.y); sw.to(r.w); sh.to(r.h);
      }
      if (ss.target !== 1) ss.to(1);
    },
    /** the target moved (scroll, a layout change): follow it without a spring */
    /** the target moved (scroll, a layout change): follow it without a spring. A target that left the page (its
     *  row was rebuilt) is let go, or the pill would read its empty rect and fly to the corner (#287) */
    follow() { if (el && !el.isConnected) { el = null; ss.to(0); return; } if (el) { const r = rectOf(el); sx.set(r.x); sy.set(r.y); sw.set(r.w); sh.set(r.h); } },
    destroy() { sx.stop(); sy.stop(); sw.stop(); sh.stop(); ss.stop(); },
  };
}

// ---- growTo: an element whose content just got taller opens to its new height on a spring ----
// The way a streaming answer grows: each new line of a paragraph is revealed by the box opening under it, so the
// text below moves with a spring instead of jumping a line at a time. `from` is the start height (0: unfold from
// nothing; the height read before the content changed, so a line that lands while nothing moves still opens). A grow
// already in flight keeps its spring, position and velocity, and only takes the new height as its target: it never
// starts over from the top.
const heights = new WeakMap<HTMLElement, Spring>();
/** the element is opening on a spring right now */
export const growing = (el: HTMLElement) => { const s = heights.get(el); return !!s && !s.resting; };
export function growTo(el: HTMLElement, from?: number, cfg: Cfg = CFG.arrive) {
  const s = heights.get(el);
  const flying = !!s && !s.resting;
  const was = flying ? s!.v : from ?? el.offsetHeight;
  el.style.height = ""; el.style.overflow = "";
  const nat = el.offsetHeight;
  if (reducedMotion() || (!flying && nat <= was + 2 && from !== 0)) { if (s) { s.stop(); heights.delete(el); } return; }
  const sp = s ?? new Spring(was, { ...cfg, eps: 0.4 }, (v, sp) => {
    if (sp.resting && v === sp.target) { el.style.height = ""; el.style.overflow = ""; heights.delete(el); }
    else { el.style.height = `${Math.max(0, Math.round(v))}px`; el.style.overflow = "hidden"; }   // whole pixels: a frame that moves less lays nothing out
  });
  heights.set(el, sp);
  if (!flying) sp.set(was);
  el.style.height = `${Math.max(0, sp.v)}px`; el.style.overflow = "hidden";
  sp.to(nat);
}

// ---- follow: keep a scroller pinned to its end while its content grows on springs ----
// One follow serves every talk (Life, Work, the session beside); no page keeps scroller logic of its own.
// Stays out of the way when the reader has scrolled up; a spring (no overshoot) so it never snaps.
// The reader is anchored to the bottom edge: when the scroller itself changes height (the box growing under it as
// he types, the window), the line that sat just above the box stays just above the box, so typing never moves what
// he scrolled to and never hides it under the box (Marco, 2026-10-14).
// Free while Sol writes (notch buttons #6, review 10/11): his hand releases the follow at once, whatever the distance
// from the end. A wheel, a touch, a press on the bar, a scroll key, and one rule that needs no flag: a scroll whose
// scrollTop is above (smaller than) what the follow last wrote is his, because the spring only ever scrolls down.
// Programmatic writes are told apart by value, so a spring frame landing in the same tick cannot swallow his gesture.
// Being at the end is following: he scrolls back to the end, or he is there when the content grows, and it sticks.
export type FollowState = { stuck: boolean; away: boolean; fresh: boolean };
export type Follow = ReturnType<typeof follow>;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"]);
const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};
export function follow(scroller: HTMLElement, content: HTMLElement) {
  let stuck = true;
  let fresh = false;                       // the content grew while he was away from the end: the orb's dot
  let hands = 0;                           // when his hand last released it (a grace before growth may re-stick)
  let wrote = scroller.scrollTop;          // the last scrollTop the follow itself wrote, read back
  let lastTop = scroller.scrollTop;
  let bottom = scroller.scrollTop + scroller.clientHeight; // where the viewport's bottom edge sits in the content
  let height = scroller.scrollHeight;
  const end = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const atEnd = () => end() - scroller.scrollTop <= 1;
  const write = (v: number) => { scroller.scrollTop = v; wrote = scroller.scrollTop; lastTop = wrote; };
  const sp = new Spring(scroller.scrollTop, { k: 220, z: 1, eps: 0.5 }, (v) => { if (Math.abs(scroller.scrollTop - v) >= 1) write(v); });

  const subs = new Set<() => void>();
  let told = "";
  const state = (): FollowState => ({ stuck, away: end() - scroller.scrollTop > 4, fresh });
  const tell = () => { const s = state(), k = `${+s.stuck}${+s.away}${+s.fresh}`; if (k !== told) { told = k; subs.forEach((f) => f()); } };

  const stick = () => { stuck = true; fresh = false; };
  const release = () => { hands = performance.now(); stuck = false; sp.stop(); tell(); };   // the spring stops dead, a rail glide too
  const chase = () => { if (sp.resting) sp.set(scroller.scrollTop); sp.to(end()); };

  const onScroll = () => {
    const top = scroller.scrollTop, up = top < lastTop - 0.5;
    lastTop = top;
    bottom = top + scroller.clientHeight;
    if (stuck && top < wrote - 1 && !atEnd()) release();          // his: the spring never writes upward
    else if (!stuck && !up && atEnd()) stick();                     // he came back to the end
    tell();
  };
  // his hand, before the browser scrolls: capture phase, so nothing inside the talk can hide it
  const onHand = () => release();
  const onPress = (e: PointerEvent) => { if (e.target === scroller) release(); };   // the bar (its target is the scroller)
  const onKey = (e: KeyboardEvent) => {
    if (!SCROLL_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    const t = e.target as Node | null;
    if (t === document.body || t === document.documentElement || t === document || (t && scroller.contains(t))) release();
  };

  // words he is selecting in the talk hold it still: the follow waits (it stays stuck) until the selection is let go
  const selecting = () => {
    const s = document.getSelection?.();
    return !!s && !s.isCollapsed && !!s.anchorNode && scroller.contains(s.anchorNode);
  };
  const ro = new ResizeObserver(() => {
    const h = scroller.scrollHeight, grew = h > height + 0.5, wasEnd = bottom >= height - 2;
    height = h;
    if (!stuck && grew && wasEnd && performance.now() - hands > 300) stick();   // he sat at the end: it follows on
    if (stuck && !selecting()) chase();
    else if (grew) fresh = true;
    bottom = scroller.scrollTop + scroller.clientHeight;
    tell();
  });
  ro.observe(content);
  const anchor = new ResizeObserver(() => {
    const h = scroller.clientHeight;
    const want = Math.max(0, Math.min(end(), bottom - h));
    if (Math.abs(scroller.scrollTop - want) >= 1) {
      write(want);
      if (!stuck) sp.set(scroller.scrollTop);
    }
    bottom = scroller.scrollTop + h;
    tell();
  });
  anchor.observe(scroller);
  scroller.addEventListener("scroll", onScroll, { passive: true });
  scroller.addEventListener("wheel", onHand, { capture: true, passive: true });
  scroller.addEventListener("touchstart", onHand, { capture: true, passive: true });
  scroller.addEventListener("pointerdown", onPress, { capture: true });
  document.addEventListener("keydown", onKey, true);
  return {
    jump() { stick(); sp.stop(); write(end()); bottom = scroller.scrollTop + scroller.clientHeight; tell(); },
    glide() { stick(); chase(); tell(); },
    goTo(y: number) { stuck = false; if (sp.resting) sp.set(scroller.scrollTop); sp.to(Math.max(0, Math.min(end(), y))); tell(); }, // to a place in the talk, and stay
    /** at a place in the talk at once, no glide: a talk reopened where he left it, set before it is painted */
    place(y: number) { stuck = false; sp.stop(); write(Math.max(0, Math.min(end(), y))); bottom = scroller.scrollTop + scroller.clientHeight; tell(); },
    release,
    isStuck: () => stuck,
    state,
    /** called when stuck, away (the end out of view) or fresh changes; returns the unsubscribe */
    onChange(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; },
    destroy() {
      sp.stop(); ro.disconnect(); anchor.disconnect(); subs.clear();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", onHand, true);
      scroller.removeEventListener("touchstart", onHand, true);
      scroller.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("keydown", onKey, true);
    },
  };
}
