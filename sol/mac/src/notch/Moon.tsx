// The half moon (#254).
// The wings shape's open form on the MacBook's screen: the slab swells down out of the cutout into a half moon
// (radius 112) with the creature at its centre and five tools on an arc round it (the eye, Shelf, Anticipate at the
// bottom centre, Grab, Sessions). Everything Sol has for you is a card that buds out of the moon's rim, lets go, floats
// where you put it, and is absorbed back into the Sessions disc (or the rim it came from) when it is closed.
//
// This file draws; Notch.tsx keeps the state and the wiring. Three layers, one window:
//   the scene (scene.ts, one canvas, one shader; #254) holds black shapes only: the moon (Notch.tsx put), a
//     name's bud and its neck, a card's body and neck while it buds or is absorbed. Shapes that touch melt into one
//     (a smooth-min); that is the "separating out into its own floating pill".
//   the top layer holds what must stay sharp: the creature (Notch.tsx), the discs, a name's words, the cards' content.
//   the cards (Float): a real black card once out; while budding or absorbed its black is the goo body, its content
//     fades in after t .55 (out in the first 120 ms of an absorb).
// Reduced motion: no melt, no necks, the springs jump, cards fade (notch.css).
//
// Coordinates: x from the moon's centre (the window's middle, the cutout's middle), y from the window's top. The
// moon's centre is at (0, off): off is the cutout's height (32 on a MacBook), the circle's radius MOON_R.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CFG, Spring, reducedMotion } from "../motion";
import { scene } from "./scene";
import { ICON, EYE_OPEN, EYE_SHUT, HOLD_MS, Button } from "./Card";
import { choiceLabel, keyAction, type Btn, type Card } from "./answer";

// Dev only (stills): ?ry= draws the moon this tall (its half-ellipse's vertical radius), to pick a height by eye
const DEV_RY = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get("ry") ?? NaN) : NaN;
export const MOON_R = 112, MOON_W = 2 * MOON_R;   // the moon: 224 wide (its horizontal radius), centred on the cutout
export const MOON_RY = DEV_RY > 40 ? DEV_RY : 102; // and off + MOON_RY tall: a half ellipse (Marco picked 102 of 112/92/76/64, 2026-10-26)
const DISC = 28;                                    // a disc: 28 across
// the discs' ring round the moon's centre: 72 on the round moon; a flatter moon spreads it wider (so the five never
// crowd the creature) and keeps the bottom disc 28 above the rim
const RING = 72 + (MOON_R - MOON_RY) * 0.6, RING_Y = Math.max(24, Math.min(72, MOON_RY - 28));
/** the moon's rim along the direction (cos a, sin a): a half ellipse's radius there */
export const moonR = (ux: number, uy: number) => (MOON_R * MOON_RY) / (Math.hypot(MOON_RY * ux, MOON_R * uy) || 1);
const ringR = (ux: number, uy: number) => (RING * RING_Y) / (Math.hypot(RING_Y * ux, RING * uy) || 1);
const BUD_H = 26, BUD_OUT = 10;                     // a name's bud: 26 tall, its far end 10 px outside the rim
const BUD_GRACE = 140;   // ms the Sessions bud with pressable rows waits for the pointer to cross onto it (or back)
const BLOB = 14;                                    // a card's body at the rim (budding) or at the disc (absorbed)
const RISE_GAP = 40;                                // the discs rise in ring order, this far apart
export type Tool = "eye" | "shelf" | "anticipate" | "grab" | "sessions";
/** the arc: clockwise from +x, y down (90° is straight down) */
export const TOOLS: readonly { id: Tool; a: number }[] = [
  { id: "eye", a: 162 }, { id: "shelf", a: 126 }, { id: "anticipate", a: 90 }, { id: "grab", a: 54 }, { id: "sessions", a: 18 },
];
export type P = { x: number; y: number };
const rad = (a: number) => (a * Math.PI) / 180;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** a disc's centre */
export const discAt = (t: Tool, off: number): P => { const a = rad(TOOLS.find((d) => d.id === t)!.a); return { x: RING * Math.cos(a), y: off + RING_Y * Math.sin(a) }; };
/** the point of the moon's rim nearest p (on its lower half: a card is never above the menu bar's line) */
export function rimPoint(p: P, off: number): P {
  const dx = p.x, dy = Math.max(0.001, p.y - off), d = Math.hypot(dx, dy) || 1, r = moonR(dx / d, dy / d);
  return { x: (r * dx) / d, y: off + (r * dy) / d };
}
// Dev only (stills): ?t=0.4 freezes every card's bud at that t, so the neck can be seen in a still (rubric M4)
const DEV_T = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get("t") ?? NaN) : NaN;
// and ?ta=0.5 freezes an absorb there (a headless page draws too few frames to catch one in flight)
const DEV_TA = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get("ta") ?? NaN) : NaN;

/** draw a spring where it is now without stopping it (Spring.set would also end its move) */
export function redraw(s: Spring) { const t = s.target; s.set(s.v, s.vel); if (t !== s.v) s.to(t); }
/** a scene id of its own (a hot reload or StrictMode's second mount never shares one) */
let sceneN = 0;
const uid = (what: string) => `${what}-${++sceneN}`;
/** a black capsule from a to b, `w` thick, in the scene (a neck); width or length 0 turns it off. Moon coordinates in,
 *  page px out (x from the window's middle) */
function neckTo(id: string, a: P, b: P, w: number) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  // a neck of no length (a bud or a body back at its rim point) is off: it has no footprint
  if (w <= 0.3 || len <= 0.3 || reducedMotion()) { scene.set(id, { kind: "capsule", on: false }); return; }
  scene.set(id, { kind: "capsule", x: window.innerWidth / 2 + a.x, y: a.y, w: dx, h: dy, r: w, melt: true, on: true });
}
/** a black rounded box centred at c, in the scene; w or h 0 turns it off */
function boxAt(id: string, c: P, w: number, h: number, r: number) {
  if (w <= 0.3 || h <= 0.3) { scene.set(id, { kind: "rrect", on: false }); return; }
  scene.set(id, { kind: "rrect", x: window.innerWidth / 2 + c.x - w / 2, y: c.y - h / 2, w, h, r: Math.min(r, h / 2, w / 2), melt: true, on: true });
}

// ---- the discs on the arc, and the name that buds out along a disc's radius ----
export type DiscApi = { k: (k: number) => void; squash: (t: Tool) => void; closeBud: () => void };
/** a running thing under the Sessions disc's name (a turn, a call, a ping): its words and the card it would have been,
 *  whose buttons (Stop, Hang up, Open) it keeps at its right */
export type RunRow = { id: string; text: string; card: Card };
type DiscsProps = {
  off: number; apiRef: React.RefObject<DiscApi | null>; kNow: React.RefObject<number>   // the moon's openness when they mount
  invisible: boolean; privHeld: boolean; talk: string | null   // the talk's clock while one is on ("12:34")
  drawerOn: boolean   // the talk's drawer is out: the Anticipate disc's name says a press closes it
  sessDot: boolean; sessCount: number; shelfOn: boolean; grabOn: boolean
  sessRows: RunRow[]   // what runs (a turn, a call, a ping): never a card, one row each under the Sessions disc's name
  rowKeys: string | null   // the row under the pointer while Return is Sol's: its safe button wears the ⏎
  onRowPress: (r: RunRow, b: Btn) => void; onRowHover: (id: string | null) => void
  onRows: (out: boolean) => void   // the Sessions bud with pressable rows came out or went (the keys follow it)
  onPress: (t: Tool, downAt?: number) => void; onEyeHold: () => void
  onHover: (t: Tool | null, el: HTMLElement | null) => void; onLayout: () => void
};
export function MoonDiscs(p: DiscsProps) {
  const name = (t: Tool) => t === "eye" ? (p.invisible ? "Hidden from shares" : "Seen in shares")
    : t === "shelf" ? "Shelf" : t === "grab" ? "Grab"
    // during a talk the clock is under the disc already (m-clock); the name says what a press does (Marco, 2026-10-26: the
    // time showed twice, in the name and under the disc, the two on top of each other at the bottom of the moon)
    : t === "anticipate" ? (p.talk ? (p.drawerOn ? "Close the talk's drawer" : "Open the talk") : "Anticipate")
    : p.sessCount ? `Sessions · ${p.sessCount} waiting` : "Sessions";
  const discs = useRef(new Map<Tool, DiscHandle>());
  const risen = useRef(false);
  // the bud: one at a time; `shown` is the tool whose name it carries (it stays while the bud shrinks back)
  const [hov, setHov] = useState<Tool | null>(null);
  const shown = useRef<Tool | null>(null);
  const word = useRef<HTMLDivElement>(null);
  const ids = useRef<{ bud: string; neck: string } | null>(null);
  if (!ids.current) ids.current = { bud: uid("bud"), neck: uid("bud-neck") };
  const bud = ids.current.bud, neck = ids.current.neck;
  const nb = useRef<Spring | null>(null);
  const offRef = useRef(p.off); offRef.current = p.off;
  const layout = useRef(p.onLayout); layout.current = p.onLayout;
  if (!nb.current) {
    nb.current = new Spring(0, CFG.snap, () => {
      const t = shown.current, v = nb.current!.v, w = word.current;
      if (!t || !w) return;
      const k = clamp01(v), a = rad(TOOLS.find((d) => d.id === t)!.a), u = { x: Math.cos(a), y: Math.sin(a) };
      const d0 = discAt(t, offRef.current), W = w.offsetWidth, H = w.offsetHeight || BUD_H;   // the Sessions bud is taller with its rows
      // where it rests: its far end BUD_OUT outside the rim along the radius, its near end tucked under its disc at
      // most, so a long name runs out sideways rather than over the creature or a neighbour
      const sup = Math.abs(u.x) * W / 2 + Math.abs(u.y) * H / 2;
      const dist = Math.max(moonR(u.x, u.y) + BUD_OUT - sup, ringR(u.x, u.y) + DISC / 2 - 8 + sup);
      const end = { x: dist * u.x, y: offRef.current + dist * u.y };
      const c = { x: lerp(d0.x, end.x, k), y: lerp(d0.y, end.y, k) };
      if (v <= 0.02) boxAt(bud, c, 0, 0, 0); else boxAt(bud, c, lerp(10, W, k), lerp(10, H, k), BUD_H / 2);
      neckTo(neck, d0, c, k < 0.95 ? lerp(14, 4, k) : 0);
      w.style.translate = `${(end.x - W / 2).toFixed(1)}px ${(end.y - H / 2).toFixed(1)}px`;
      w.style.opacity = String(clamp01((v - 0.55) / 0.45));
      w.style.visibility = v > 0.02 ? "visible" : "hidden";
      layout.current();
    });
  }
  useEffect(() => {
    // the scene is in page px: a window that grows sideways (the drawer) moves the middle the bud is drawn from
    const re = () => redraw(nb.current!);
    window.addEventListener("resize", re);
    return () => { window.removeEventListener("resize", re); nb.current?.stop(); scene.remove(bud); scene.remove(neck); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // a new name (the clock ticks, the count changes) re-measures where the bud rests
  const label = shown.current ? name(shown.current) : "";
  const rows = shown.current === "sessions" ? p.sessRows : [];
  useLayoutEffect(() => { redraw(nb.current!); }, [label, rows.map((r) => `${r.text}|${r.card.buttons.join("+")}`).join("\n")]);
  // The Sessions bud with rows is pressable (each row keeps its card's buttons): the pointer may cross from the disc onto
  // it, so it goes BUD_GRACE ms after the pointer left the disc or the bud, unless it came back to either
  const hovNow = useRef<Tool | null>(null), inBud = useRef(false), budT = useRef<number | undefined>(undefined);
  const pressable = rows.some((r) => r.card.buttons.length > 0);
  const pressRef = useRef(pressable); pressRef.current = pressable;
  const rowsOut = hov === "sessions" && pressable;
  const onRows = useRef(p.onRows); onRows.current = p.onRows;
  useEffect(() => { onRows.current(rowsOut); }, [rowsOut]);
  useEffect(() => () => window.clearTimeout(budT.current), []);
  const budAway = (t: Tool) => {
    if (shown.current !== t || hovNow.current !== t) return;
    hovNow.current = null; inBud.current = false; setHov(null); nb.current!.to(0, { cfg: CFG.away }); p.onRowHover(null);
  };
  const hover = (t: Tool, on: boolean, el: HTMLElement | null) => {
    window.clearTimeout(budT.current);
    if (on) {
      // back on the disc from its own bud: the bud stays as it is
      if (!(hovNow.current === t && shown.current === t)) { if (hovNow.current) budAway(hovNow.current); shown.current = t; hovNow.current = t; setHov(t); nb.current!.set(0); nb.current!.to(1, { cfg: CFG.snap }); }
    } else if (t === "sessions" && pressRef.current) budT.current = window.setTimeout(() => { if (!inBud.current) budAway(t); }, BUD_GRACE);
    else budAway(t);
    p.onHover(on ? t : null, on ? el : null);
  };
  // a press on the bud's words (not a button) is nothing: it never reaches the notch's own click
  const budStop = (e: React.SyntheticEvent) => e.stopPropagation();
  const budEnter = () => { if (hovNow.current !== "sessions" || !pressRef.current) return; inBud.current = true; window.clearTimeout(budT.current); };
  const budLeave = () => {
    inBud.current = false; p.onRowHover(null);
    window.clearTimeout(budT.current); budT.current = window.setTimeout(() => budAway("sessions"), BUD_GRACE);
  };
  p.apiRef.current = {
    // the moon's openness (Notch.tsx put): the discs rise in ring order once k > .5, and go as soon as it shrinks under .7
    k: (k) => {
      if (k > 0.5 && !risen.current) { risen.current = true; TOOLS.forEach((d, i) => discs.current.get(d.id)?.rise(true, i * RISE_GAP)); }
      else if (k < 0.7 && risen.current) {   // closing: the discs go as soon as the moon starts to shrink
        risen.current = false; TOOLS.forEach((d) => discs.current.get(d.id)?.rise(false, 0));
        if (shown.current) { hovNow.current = null; inBud.current = false; setHov(null); nb.current!.set(0); }
      }
    },
    squash: (t) => discs.current.get(t)?.squash(),
    // Escape on the bud's rows: the bud goes (it only closes, it answers nothing)
    closeBud: () => { window.clearTimeout(budT.current); if (hovNow.current) budAway(hovNow.current); },
  };
  // mounted on an open moon (a reload, a crew coming back up): they rise at once
  useEffect(() => { p.apiRef.current?.k(p.kNow.current ?? 0); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="moon-discs">
      {TOOLS.map((d) => {
        const at = discAt(d.id, p.off);
        return <MoonDisc key={d.id} t={d.id} at={at} reg={(h) => { if (h) discs.current.set(d.id, h); else discs.current.delete(d.id); }}
          on={hov === d.id} icon={d.id === "eye" ? (p.invisible ? EYE_SHUT : EYE_OPEN) : d.id === "sessions" ? SESSIONS_ICON : ICON[d.id as Btn]}
          dim={d.id === "eye" && !p.invisible && !p.privHeld} held={(d.id === "eye" && p.privHeld) || (d.id === "shelf" && p.shelfOn) || (d.id === "grab" && p.grabOn)}
          lit={d.id === "anticipate" && !!p.talk} dot={(d.id === "anticipate" && !!p.talk) || (d.id === "sessions" && p.sessDot)}
          count={d.id === "sessions" ? p.sessCount : 0} clock={d.id === "anticipate" ? p.talk : null} label={name(d.id)}
          onHover={(on, el) => hover(d.id, on, el)} onPress={(at) => p.onPress(d.id, at)} onHold={d.id === "eye" ? p.onEyeHold : undefined} />;
      })}
      <div className={`bud-word${rows.length ? " rows" : ""}${rowsOut ? " live" : ""}`} ref={word} data-region={hov ? "" : undefined} data-nopress
        aria-hidden={rowsOut ? undefined : true} onPointerEnter={budEnter} onPointerLeave={rowsOut ? budLeave : undefined}
        onClick={rowsOut ? budStop : undefined} onMouseDown={rowsOut ? budStop : undefined} onMouseUp={rowsOut ? budStop : undefined}>
        {rows.length ? <><div className="bw-head">{label}</div>{rows.map((r) => <BudRow key={r.id} r={r} ret={p.rowKeys === r.id}
          onPress={(b) => p.onRowPress(r, b)} onHover={(on) => p.onRowHover(on ? r.id : null)} />)}</> : label}
      </div>
    </div>
  );
}
/** one running row in the Sessions bud: its words, then its card's buttons small at its right (Card.tsx Button, the
 *  capsules and tints the card had); ⏎ is drawn on the one Return would press while the row is under the pointer */
function BudRow({ r, ret, onPress, onHover }: { r: RunRow; ret: boolean; onPress: (b: Btn) => void; onHover: (on: boolean) => void }) {
  const key = ret ? keyAction(r.card, "Return") : null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="bw-row" onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      <span className="bw-text">{r.text}</span>
      {r.card.buttons.length > 0 && <span className="bw-btns" onClick={stop} onMouseDown={stop} onMouseUp={stop} onPointerDown={stop} onPointerUp={stop}>
        {r.card.buttons.map((b, i) => <Button key={`${r.id}-${b}`} b={b} first={i === 0} ret={key === b} held={false} label={choiceLabel(r.card, b)} small onPress={() => onPress(b)} />)}
      </span>}
    </div>
  );
}
// a card with lines: what the Sessions disc keeps
const SESSIONS_ICON = <svg viewBox="0 0 16 16" aria-hidden><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M5 6.5h6M5 9.5h3.5" /></svg>;

type DiscHandle = { rise: (on: boolean, delay: number) => void; squash: () => void };
/** one tool on the arc: the capsule family's disc (.ib-disc) with its lift, squash and rise; the eye's hold too */
function MoonDisc({ t, at, reg, on, icon, dim, held, lit, dot, count, clock, label, onHover, onPress, onHold }: {
  t: Tool; at: P; reg: (h: DiscHandle | null) => void; on: boolean; icon: ReactNode; dim: boolean; held: boolean; lit: boolean; dot: boolean
  count: number; clock: string | null; label: string; onHover: (on: boolean, el: HTMLElement | null) => void; onPress: (downAt?: number) => void; onHold?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null), disc = useRef<HTMLSpanElement>(null);
  const sp = useRef<{ lift: Spring; squash: Spring; rise: Spring } | null>(null);
  if (!sp.current) {
    const putDisc = () => {
      const el = disc.current, s = sp.current;
      if (!el || !s) return;
      const l = s.lift.v, q = s.squash.v;
      el.style.translate = l || q ? `0 ${(-1.5 * l + 0.8 * q).toFixed(2)}px` : "";
      el.style.scale = l || q ? `${((1 + 0.04 * l) * (1 + 0.05 * q)).toFixed(4)} ${((1 + 0.04 * l) * (1 - 0.12 * q)).toFixed(4)}` : "";
    };
    const putRise = () => {
      const el = ref.current, s = sp.current;
      if (!el || !s) return;
      const r = s.rise.v;
      el.style.opacity = String(clamp01(r));
      el.style.translate = `0 ${(10 * (1 - r)).toFixed(2)}px`;
      el.style.scale = String((0.9 + 0.1 * r).toFixed(4));
      el.style.visibility = r > 0.01 ? "visible" : "hidden";
    };
    sp.current = { lift: new Spring(0, CFG.pop, putDisc), squash: new Spring(0, CFG.press, putDisc), rise: new Spring(0, CFG.slide, putRise) };
  }
  useLayoutEffect(() => {
    const s = sp.current!;
    s.rise.set(0);
    reg({
      rise: (up, delay) => { if (up) s.rise.to(1, { delay, cfg: CFG.slide }); else s.rise.to(0, { cfg: { k: 1600, z: 1 } }); },   // leaving: faster than the slab shrinks, so no ghost below it
      // a card landing in the disc: squashed once, then it pops back (the IconButton press)
      squash: () => { s.squash.set(0); s.squash.to(1, { cfg: CFG.press }); window.setTimeout(() => s.squash.to(0, { cfg: CFG.pop }), 90); },
    });
    return () => { reg(null); s.lift.stop(); s.squash.stop(); s.rise.stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const holdT = useRef<number | undefined>(undefined), wasHold = useRef(false), downAt = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(holdT.current), []);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <button ref={ref} type="button" data-nopress data-disc={t} data-region=""
      className={`mdisc${on || held ? " on" : ""}${dim ? " dim" : ""}${lit ? " lit" : ""}${dot ? " dot" : ""}`}
      style={{ left: `calc(50% + ${(at.x - DISC / 2).toFixed(1)}px)`, top: at.y - DISC / 2 }} aria-label={label}
      onPointerEnter={() => { sp.current!.lift.to(1, { cfg: CFG.pop }); onHover(true, ref.current); }}
      onPointerLeave={() => { sp.current!.lift.to(0, { cfg: CFG.pop }); sp.current!.squash.to(0, { cfg: CFG.pop }); onHover(false, null); window.clearTimeout(holdT.current); }}
      onPointerDown={(e) => {
        stop(e); sp.current!.squash.to(1, { cfg: CFG.press }); downAt.current = performance.now(); wasHold.current = false;
        window.clearTimeout(holdT.current);
        if (onHold) holdT.current = window.setTimeout(() => { wasHold.current = true; onHold(); }, HOLD_MS);
      }}
      onPointerUp={(e) => { stop(e); sp.current!.squash.to(0, { cfg: CFG.pop }); window.clearTimeout(holdT.current); }}
      onMouseDown={stop} onMouseUp={stop}
      onClick={(e) => {
        e.stopPropagation();
        if (wasHold.current) { wasHold.current = false; return; }
        window.dispatchEvent(new Event("sol-greet"));
        const at0 = downAt.current; downAt.current = undefined; onPress(at0);
      }}>
      <span className="ib-disc" ref={disc}>{icon}</span>
      {count > 0 && <span className="m-count" aria-hidden>{count}</span>}
      {clock && <span className="m-clock" aria-hidden>{clock}</span>}
    </button>
  );
}

// ---- a floating card ----
export type Phase = "bud" | "out" | "absorb";
export type FloatProps = {
  id: string; x: number; y: number          // where it rests: its top edge's middle (moon coordinates)
  from: P; to: P                            // the rim point it buds from; where it is absorbed into
  phase: Phase; z: number; bare?: boolean; className?: string
  onPlace: (id: string, x: number, y: number) => void   // a drag let go here
  onGone: (id: string) => void              // absorbed: it can go
  onLanded?: (id: string) => void           // absorbed into a disc (its squash, its count)
  onHover: (id: string, on: boolean) => void
  onSize: (id: string, w: number, h: number) => void
  onFrame: () => void                       // it moved: the regions follow
  onDrag: (on: boolean) => void             // a drag started or ended: the window takes the whole mouse meanwhile
  onClose?: () => void                      // the ×; none: no ×
  children: ReactNode
};
/** One card: its body, the drag, the bud and the absorb (#254). The content fades in after t .55; while t < 1
 *  the black is the goo body (it melts out of the moon), from t 1 the card's own. Never leaves the window (8 px). */
export function Float(p: FloatProps) {
  const root = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const ids = useRef<{ body: string; neck: string } | null>(null);
  if (!ids.current) ids.current = { body: uid(`body:${p.id}`), neck: uid(`neck:${p.id}`) };
  const body = ids.current.body, neck = ids.current.neck;
  const size = useRef({ w: 0, h: 0 });
  const live = useRef(p); live.current = p;
  const landed = useRef(false);   // the bud reached 1 once: an overshoot back under 1 does not hand the black back to the goo
  const absorbFrom = useRef<P | null>(null);
  const drag = useRef<{ id: number; x0: number; y0: number; px: number; py: number; on: boolean } | null>(null);
  const dragged = useRef(false);
  const sp = useRef<{ x: Spring; y: Spring; t: Spring; lift: Spring } | null>(null);
  if (!sp.current) {
    const put = () => {
      const el = root.current, s = sp.current, P = live.current;
      if (!el || !s) return;
      const { w, h } = size.current;
      // clamped inside the window, 8 px in
      const W = window.innerWidth, H = window.innerHeight;
      const x = Math.max(-W / 2 + 8 + w / 2, Math.min(W / 2 - 8 - w / 2, s.x.v)), y = Math.max(8, Math.min(H - 8 - h, s.y.v));
      const lift = s.lift.v;
      el.style.translate = `${(x - w / 2).toFixed(1)}px ${(y - 3 * lift).toFixed(1)}px`;
      el.style.scale = lift ? String((1 + 0.015 * lift).toFixed(4)) : "";
      const t = s.t.v, c = { x, y: y + h / 2 };
      if (P.phase === "absorb") {
        const k = clamp01(t), a0 = absorbFrom.current ?? c, to = P.to;
        if (content.current) content.current.style.opacity = String(clamp01((k - 0.62) / 0.38));
        el.classList.add("melting");
        const bc = { x: lerp(to.x, a0.x, k), y: lerp(to.y, a0.y, k) };
        boxAt(body, bc, lerp(BLOB, w, k), lerp(BLOB, h, k), 20);
        neckTo(neck, to, bc, k < 0.3 ? lerp(12, 0, k / 0.3) : 0);
        el.style.visibility = "hidden";   // the goo body is the card now
      } else {
        const k = landed.current ? 1 : clamp01(t);
        if (k >= 1) landed.current = true;
        el.style.visibility = "";
        if (content.current) content.current.style.opacity = String(clamp01((k - 0.55) / 0.45));
        if (k >= 1) {
          el.classList.remove("melting");
          boxAt(body, c, 0, 0, 0); neckTo(neck, c, c, 0);
        } else {
          el.classList.add("melting");
          const g = clamp01(k / 0.5), f = P.from;
          const bc = { x: lerp(f.x, c.x, g), y: lerp(f.y, c.y, g) };
          const bw = lerp(BLOB, w, g), bh = lerp(BLOB, h, g);
          boxAt(body, bc, bw, bh, 20);
          // the neck: from the rim to the body's near edge, 40 → 6 wide while it grows, then thinner, gone at .85
          const nw = k < 0.5 ? lerp(40, 6, g) : k < 0.85 ? lerp(6, 0, (k - 0.5) / 0.35) : 0;
          const dx = f.x - bc.x, dy = f.y - bc.y, dl = Math.hypot(dx, dy) || 1;
          // where the line to the rim leaves the body's box (a little inside it, so the two melt)
          const reach = Math.min(dl, Math.abs(dx) > 1e-3 ? (bw / 2) / Math.abs(dx / dl) : Infinity, Math.abs(dy) > 1e-3 ? (bh / 2) / Math.abs(dy / dl) : Infinity) - 4;
          neckTo(neck, f, { x: bc.x + (dx / dl) * reach, y: bc.y + (dy / dl) * reach }, nw);
        }
      }
      P.onFrame();
    };
    sp.current = { x: new Spring(p.x, CFG.snap, put), y: new Spring(p.y, CFG.snap, put),
      t: new Spring(0, CFG.arrive, put, () => {
        const P = live.current;
        if (P.phase === "absorb" && sp.current!.t.v <= 0.001) { P.onLanded?.(P.id); P.onGone(P.id); }
      }),
      lift: new Spring(0, CFG.snap, put) };
  }
  // measured: the body's size (the goo body grows to it, the clamp keeps it in)
  useLayoutEffect(() => {
    const el = root.current!;
    const measure = () => { size.current = { w: el.offsetWidth, h: el.offsetHeight }; live.current.onSize(live.current.id, size.current.w, size.current.h); redraw(sp.current!.x); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the phase: bud from wherever t is (0 for a new card, part way for one called back mid-absorb); absorb from here
  useLayoutEffect(() => {
    const s = sp.current!;
    if (p.phase === "absorb") {
      const { w, h } = size.current, W = window.innerWidth, H = window.innerHeight;
      absorbFrom.current = { x: Math.max(-W / 2 + 8 + w / 2, Math.min(W / 2 - 8 - w / 2, s.x.v)), y: Math.max(8, Math.min(H - 8 - h, s.y.v)) + h / 2 };
      if (landed.current) s.t.set(1);
      landed.current = false;
      if (!Number.isNaN(DEV_TA)) { s.t.set(DEV_TA); return; }
      s.t.to(0, { cfg: CFG.away });
      return;
    }
    absorbFrom.current = null;
    if (!Number.isNaN(DEV_T)) { s.t.set(DEV_T); return; }   // dev: a still mid-bud
    if (!landed.current) s.t.to(1, { cfg: CFG.arrive });
  }, [p.phase]);
  // a new resting place (a slot freed, the window grew): it slides there; a drag owns it meanwhile
  useEffect(() => { if (!drag.current?.on) { sp.current!.x.to(p.x, { cfg: CFG.snap }); sp.current!.y.to(p.y, { cfg: CFG.snap }); } }, [p.x, p.y]);
  useEffect(() => {
    const s = sp.current!, re = () => redraw(s.t);   // page px: the window's middle moved (see MoonDiscs)
    window.addEventListener("resize", re);
    return () => { window.removeEventListener("resize", re); s.x.stop(); s.y.stop(); s.t.stop(); s.lift.stop(); scene.remove(body); scene.remove(neck); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the drag: a press on the body (not a button, a field, a thumb or the ×) moves it 1:1 after 4 px
  const down = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (p.phase === "absorb" || (e.target as HTMLElement).closest("button, input, textarea, a, .thumb, [data-nodrag]")) return;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, px: sp.current!.x.v, py: sp.current!.y.v, on: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.on) {
      if (Math.hypot(dx, dy) < 4) return;
      d.on = true; dragged.current = true;
      root.current?.setPointerCapture(e.pointerId);
      sp.current!.lift.to(1, { cfg: CFG.snap });
      p.onDrag(true);
    }
    const s = sp.current!;
    s.x.set(d.px + dx); s.y.set(d.py + dy);
  };
  const up = (e: React.PointerEvent) => {
    e.stopPropagation();
    const d = drag.current;
    drag.current = null;
    if (!d?.on) return;
    root.current?.releasePointerCapture(e.pointerId);
    const s = sp.current!, { w, h } = size.current, W = window.innerWidth, H = window.innerHeight;
    const x = Math.max(-W / 2 + 8 + w / 2, Math.min(W / 2 - 8 - w / 2, s.x.v)), y = Math.max(8, Math.min(H - 8 - h, s.y.v));
    s.x.set(x); s.y.set(y);
    s.lift.to(0, { cfg: CFG.snap });   // it settles the 3 px it was lifted
    p.onPlace(p.id, x, y);
    p.onDrag(false);
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
      <div ref={root} className={`float${p.bare ? " bare" : ""}${p.className ? ` ${p.className}` : ""}`} data-region={p.phase === "absorb" ? undefined : ""} data-float={p.id}
        style={{ zIndex: p.z }} data-nopress
        onPointerEnter={() => p.onHover(p.id, true)} onPointerLeave={() => p.onHover(p.id, false)}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onMouseDown={stop} onMouseUp={stop}
        onClickCapture={(e) => { if (dragged.current) { dragged.current = false; e.stopPropagation(); e.preventDefault(); } }}
        onClick={stop}>
        <div className="fl-content" ref={content}>
          {p.children}
          {p.onClose && <button type="button" className="fx" data-nopress aria-label="Close" onClick={(e) => { e.stopPropagation(); p.onClose?.(); }}>×</button>}
        </div>
      </div>
  );
}

// ---- what a card holds ----
/** the small creature on a session's card, in the seat's colour: four cells down a diagonal (the mock's stairs) */
export function Stairs({ colour }: { colour: string }) {
  return <svg className="fc-mark" viewBox="0 0 16 16" aria-hidden>{[0, 1, 2, 3].map((i) => <rect key={i} x={i * 4} y={i * 4} width="4" height="4" fill={colour} />)}</svg>;
}
/** "Notch.tsx · edit": the thing first, bold; "run: build the notch page": the verb bold */
function Line({ text }: { text: string }) {
  const m = /^(.+?)( · |: )(.*)$/.exec(text);
  if (!m) return <span className="fc-line">{text}</span>;
  return <span className="fc-line"><b>{m[1]}</b>{m[2] === ": " ? ": " : " · "}{m[3]}</span>;
}
/** a session's card: its mark and line, its own buttons (the capsules, the same tints), the meta at the right. Return
 *  is drawn on the button it would press only while this card is the one under the pointer and the keys are Sol's */
export function SessionBody({ card, line, colour, keys, onPress }: { card: Card; line: string; colour: string; keys: boolean; onPress: (b: Btn) => void }) {
  const ret = keys ? keyAction(card, "Return") : null;
  return (
    <div className={`fc fc-${card.kind}`}>
      <div className="fc-head"><Stairs colour={colour} /><Line text={line} /></div>
      {(card.buttons.length > 0 || card.meta) && <div className="fc-row">
        {card.buttons.map((b, i) => <Button key={`${card.kind}:${card.ask?.id ?? ""}-${b}`} b={b} first={i === 0 && !b.startsWith("c")} ret={ret === b} held={false}
          label={choiceLabel(card, b)} onPress={() => onPress(b)} />)}
        {card.meta && <span className="fc-meta">{card.meta}</span>}
      </div>}
    </div>
  );
}
/** Sol's sentence, a pin, the dictation's words: a card with no buttons */
export function SayBody({ text, dim, red }: { text: string; dim?: boolean; red?: boolean }) {
  return <p className={`fc-say${dim ? " dim" : ""}${red ? " red" : ""}`} aria-live="polite">{text}</p>;
}
/** Grab's question and the shelf: a word, then the row's icons (Card.tsx Buttons draws them) */
export function RowBody({ title, children }: { title?: string; children: ReactNode }) {
  return <div className="fc fc-row-card">{title && <div className="fc-title">{title}</div>}{children}</div>;
}
