// The creature's state, as the engine says it (Companion #5 step 1, design/companion/PRD.md). The engine derives the
// eight states and sends { type: "creature.state", state, asks } to every face; this page only draws what it is told.
// The one thing a page adds: Unplugged, when its socket to the engine is down or the app says the engine is starting
// or failed (engine_phase in lib.rs). Done and wrong arrive as creature.flash and draw over the state for 0.9 s / 2.5 s.
//
// The page's socket (renovation.ts) feeds this file: feedCreature(m) for every creature/engine message, setLink(up).
// The main window also reports presence up (startPresence): focus, and system idle from Tauri every 5 s.
// The shared frame loop ticks it (audio levels need no re-renders). Canvases read `live`; React reads useCreature().
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { micLevel, outLevel } from "../voice";
import { tintOf, lookOf, seatName, type Look, type SeatName, type Tint } from "./ring";
import { CREATURE_STATES, FLASH_MS, type CreatureState, type Flash } from "./states";
import { onTick } from "./loop";
import { vibe } from "../vibe";
import { onWire } from "../renovation";

export type { CreatureState, SeatName };
type Phase = "starting" | "up" | "down" | "failed";
// Notch buttons (#6): what the open card can answer, as the engine says it (PROTOCOL.md round 14). The oldest open ask
// across Work runs, counted; and the busy conversation the notch follows. Kept here beside the state, read with useCreature().
export type CardAsk = { id: string; sessionId: string; seat: string; tool: string; title: string; path?: string; n: number; of: number };
export type CardTurn = { seat: string; sessionId: string; title: string; kind: "life" | "work" | "call" };

// Dev only: ?creature=<state> forces a state, ?seat=home|work forces the seat, so every look can be seen on demand.
const query = typeof location !== "undefined" && import.meta.env.DEV ? new URLSearchParams(location.search) : null;
const isState = (v: unknown): v is CreatureState => (CREATURE_STATES as readonly string[]).includes(String(v));
let forced = (() => { const v = query?.get("creature"); return isState(v) ? v : null; })();
export const forcedState = forced; // dev: lets the picker show the voice arms without a microphone
// Dev only: window.__creature("working") changes the forced state live, so every transition can be watched.
if (query && typeof window !== "undefined") {
  (window as unknown as { __creature: (s: CreatureState | null) => void }).__creature = (v) => { forced = isState(v) ? v : null; };
}
// Dev only: ?flash=done|wrong holds a transient over the (forced) state, for shots.
const forcedFlash = (() => { const v = query?.get("flash"); return v === "done" || v === "wrong" ? (v as Flash) : null; })();
const forcedSeat = (() => { const v = query?.get("seat"); return v === "home" || v === "work" ? (v as SeatName) : null; })();

const inputs = {
  link: false,                  // this page's socket to the engine
  phase: "starting" as Phase,   // the engine's own word when linked; the app's (lib.rs) when not
  state: "here" as CreatureState,
  asks: 0,
  seat: "home" as SeatName,
  ask: null as CardAsk | null,
  turn: null as CardTurn | null,
};
let flash: { kind: Flash; until: number } | null = null;

const start = forced ?? "unplugged";
// What every canvas reads each frame. `state` is the wire's; `look` is how the renderer draws it (ring.ts).
export const live = {
  state: start as CreatureState,
  asks: 0,
  look: lookOf(start, null) as Look,
  seat: (forcedSeat ?? "home") as SeatName,
  env: 0,
  slice: tintOf(start, null, 1e9, forcedSeat ?? "home") as Tint,   // the colour it wears (ring.ts tintOf, from design/palette.json)
  tempo: 1,                     // how fast creature time runs: slow at rest, quicker the louder it speaks
  // the transition record (Widget.tsx plays the move from A to B instead of snapping)
  prevLook: lookOf(start, null) as Look,
  since: -1e9,
  prevSlice: tintOf(start, null, 1e9, forcedSeat ?? "home") as Tint,
  sliceSince: -1e9,
  now: 0,
};

const subs = new Set<() => void>();
let snap = { state: live.state, asks: 0, seat: live.seat, env: 0, ask: null as CardAsk | null, turn: null as CardTurn | null };
const notify = () => {
  snap = { state: live.state, asks: live.asks, seat: live.seat, env: live.env, ask: inputs.ask, turn: inputs.turn };
  const html = document.documentElement;
  html.dataset.creature = live.state;
  html.dataset.seat = live.seat;
  subs.forEach((f) => f());
};

// The notch's open card holds the creature awake: Away draws as Elsewhere while it is open (Marco is at the Mac).
let held = false;
export function setHeld(on: boolean) { held = on; tick(0, performance.now()); }

function derive(): CreatureState {
  const s: CreatureState = forced ?? (!inputs.link || inputs.phase !== "up" ? "unplugged" : inputs.state);
  return held && s === "away" ? "elsewhere" : s;
}

/** the engine's phase as this page knows it: up while linked, else the app's word (starting / failed / down) */
export const enginePhase = (): Phase => (inputs.link && inputs.phase === "up" ? "up" : inputs.phase);

/** a message from the engine on this page's socket */
export function feedCreature(m: any) {
  if (m?.type === "creature.state" && isState(m.state)) { inputs.state = m.state; inputs.asks = Number(m.asks) || 0; }
  else if (m?.type === "creature.flash" && (m.kind === "done" || m.kind === "wrong")) flashNow(m.kind);
  else if (m?.type === "engine" && typeof m.phase === "string") inputs.phase = m.phase as Phase;
  else if (m?.type === "creature.ask") { inputs.ask = m.ask && typeof m.ask.id === "string" ? (m.ask as CardAsk) : null; notify(); return; }
  else if (m?.type === "creature.turn") { inputs.turn = m.turn && typeof m.turn.sessionId === "string" ? (m.turn as CardTurn) : null; notify(); return; }
  else return;
  tick(0, performance.now());
}
/** the ask and turn as they are now (a press checks the ask it drew is still the open one) */
export const cardNow = () => ({ ask: inputs.ask, turn: inputs.turn });
/** this page's socket opened or closed */
export function setLink(up: boolean) {
  inputs.link = up;
  if (!up) { inputs.phase = "down"; inputs.ask = null; inputs.turn = null; }
  tick(0, performance.now());
}
/** a transient over the held state; never changes it */
export function flashNow(kind: Flash) { flash = { kind, until: performance.now() + FLASH_MS[kind] }; }

// A voice-like wobble for when the sound is not ours to measure (text streaming, a forced state).
const synthetic = (t: number) => Math.max(0, Math.sin(t * 6.8) * 0.5 + Math.sin(t * 11.3) * 0.3 + Math.sin(t * 2.3) * 0.25);
const level = (rms: number) => Math.min(1, Math.sqrt(rms) * 1.8);
const ease = (dt: number, h: number) => 1 - Math.pow(0.001, dt / h);

let lastSeat = live.seat;
const seatSubs = new Set<(to: SeatName, from: SeatName) => void>();
export const onSeatChange = (f: (to: SeatName, from: SeatName) => void) => { seatSubs.add(f); return () => { seatSubs.delete(f); }; };

let lastTick = 0;
let stateSince = typeof performance !== "undefined" ? performance.now() : 0;   // when the state (or a new ask) arrived, for Your call's strong-then-soft yellow
// Called once per frame by the loop (registered below; and by a slow timer while nothing draws).
export function tick(dt: number, now: number) {
  lastTick = now;
  const state = derive();
  if (flash && flash.until <= now) flash = null;
  const fl = forcedFlash ?? flash?.kind ?? null;   // a forced state still shows a press's flash (dev shots of the notch buttons)
  const look = lookOf(state, fl);
  const seat = forcedSeat ?? inputs.seat;
  let target = 0;
  if (state === "listening") { const m = micLevel(); target = m === null ? synthetic(now / 1000) : level(m); }
  else if (state === "speaking") { const o = outLevel(); target = o === null ? synthetic(now / 1000) : level(o); }
  live.env += (target - live.env) * (1 - Math.pow(0.001, dt / 0.08));
  live.now = now;
  const tempo = look === "rest" ? 0.25 : state === "speaking" ? 0.6 + live.env * 2.2 : 1 + (vibe.move ? vibe.env * 0.9 : 0);   // music quickens the band a little (vibe.ts)
  // coming to rest the tempo winds down slowly; anything else catches up quickly
  live.tempo += (tempo - live.tempo) * ease(dt, tempo < live.tempo && look === "rest" ? 1.6 : 0.25);
  const asks = forced === "yourcall" ? Math.max(1, inputs.asks) : inputs.asks;
  // the colour: the state's tint, or the seat's at rest (ring.ts); a new ask counts as an arrival, so Your call pulses strong again
  if (state !== live.state || asks > live.asks) stateSince = now;
  const slice = tintOf(state, fl, now - stateSince, seat);
  if (slice !== live.slice) { live.prevSlice = live.slice; live.slice = slice; live.sliceSince = now; }
  if (state !== live.state || look !== live.look || seat !== live.seat || asks !== live.asks) {
    if (look !== live.look) { live.prevLook = live.look; live.since = now; }
    live.state = state; live.look = look; live.seat = seat; live.asks = asks;
    if (seat !== lastSeat) { const from = lastSeat; lastSeat = seat; seatSubs.forEach((f) => f(seat, from)); }
    notify();
  }
}

// Marco poked the creature: a bright nod, nothing more (no state).
export const poke = () => flashNow("done");

export function useCreature() {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap);
}

// The page says which seat it shows (the paper and the seat slice); everything else comes from the engine.
export function useCreatureDriver(f: { seat: string }) {
  useEffect(() => { inputs.seat = seatName(f.seat); tick(0, performance.now()); }, [f.seat]);
  useEffect(() => {
    notify();
    // nothing may be drawing (all canvases off-screen): keep the state honest at a slow pace anyway
    const t = window.setInterval(() => { const n = performance.now(); if (n - lastTick > 200) tick(Math.min(0.25, (n - lastTick) / 1000), n); }, 250);
    // unlinked: ask the app whether it is starting the engine or gave up (outside Sol.app there is no app: down)
    const p = window.setInterval(() => {
      if (inputs.link) return;
      invoke<Phase>("engine_phase").then((ph) => { if (!inputs.link) inputs.phase = ph; }, () => {});
    }, 1500);
    return () => { window.clearInterval(t); window.clearInterval(p); };
  }, []);
}

// The main window only: focus and system idle go up to the engine, which alone decides Here / Elsewhere / Away.
// idleSeconds is null when the idle source fails (the engine then never says Away).
export function startPresence(send: (o: object) => void): () => void {
  let idle: number | null = null;
  const report = () => send({ type: "presence", focused: document.hasFocus(), idleSeconds: idle });
  const poll = () => invoke<number | null>("idle_seconds").then((s) => { idle = typeof s === "number" ? s : null; report(); }, () => { idle = null; report(); });
  void poll();
  const t = window.setInterval(poll, 5000);
  window.addEventListener("focus", report);
  window.addEventListener("blur", report);
  // a new socket (after a sleep, a renew) starts as no face at all to the engine: say where Marco is at once, and ask
  // the idle source afresh on waking (#17)
  const offWire = onWire((e) => { if ("link" in e && e.link) void poll(); });
  const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => { window.clearInterval(t); window.removeEventListener("focus", report); window.removeEventListener("blur", report); offWire(); document.removeEventListener("visibilitychange", onVisible); };
}

onTick(tick);
onWire((e) => ("link" in e ? setLink(e.link) : feedCreature(e.msg)));
