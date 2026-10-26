// How each state is coloured (Companion step 3, design/companion/PRD.md "Colour"). The values live in one file,
// design/palette.json, generated into ./palette.ts; this file only says which colour a state wears and how it moves.
// Colour catches attention and nothing else: Working wears the sol gradient moving (the only moving colour), Your call
// yellow (strong on arrival, soft after), done green, wrong red, Unplugged red soft and steady. Every other state wears
// its seat's gradient (home candy to heart, work sun to orange), as before step 3 (repair, Marco 2026-10-18: "some things
// by design should have colour"). The chat box's fringe went with the look, sitting 2 (2026-10-25).
import type { CreatureState, Flash } from "./states";
import { CREATURE, FUNCTIONAL, GRADIENTS, INK, type RGB } from "./palette";
export type { RGB };

// The renderer's looks: how a state moves (Widget.tsx's choreography). Not states, and not colours.
export type Look = "rest" | "plain" | "listening" | "thinking" | "speaking" | "ok" | "warn" | "attention";
const LOOK: Record<CreatureState, Look> = {
  here: "plain", elsewhere: "plain", away: "rest", working: "thinking", yourcall: "attention",
  listening: "listening", speaking: "speaking", unplugged: "warn",
};
export const lookOf = (s: CreatureState, flash: Flash | null): Look => (flash === "done" ? "ok" : flash === "wrong" ? "warn" : LOOK[s]);
export type SeatName = "home" | "work";

// A tint: the stops a thing is drawn in, the palette name it came from (for the shots), how fast it moves.
// One stop is a flat colour; speed 0 never moves.
export type Tint = { name: string; stops: readonly RGB[]; speed: number };
const ink: Tint = { name: "ink", stops: [INK], speed: 0.07 };
export const TINTS = {
  ink,
  home: { name: "home", stops: GRADIENTS.home, speed: 0.05 },
  work: { name: "work", stops: GRADIENTS.work, speed: 0.05 },
  /** the engine up, a step's check: the creature's green to lime */
  ok: { name: "green-lime", stops: [CREATURE.green, CREATURE.lime], speed: 0.15 },
  working: { name: "sol", stops: GRADIENTS.sol, speed: 0.6 },
  yourcall: { name: "yellow.soft", stops: [FUNCTIONAL.yellow.soft], speed: 0 },
  arrive: { name: "yellow.strong", stops: [FUNCTIONAL.yellow.strong], speed: 0 },
  done: { name: "green.strong", stops: [FUNCTIONAL.green.strong], speed: 0 },
  wrong: { name: "red.strong", stops: [FUNCTIONAL.red.strong], speed: 0 },
  unplugged: { name: "red.soft", stops: [FUNCTIONAL.red.soft], speed: 0 },
} satisfies Record<string, Tint>;
/** how long Your call wears yellow strong when it arrives, before it settles to soft */
export const ARRIVE_MS = 700;

// listening and speaking wear the seat's gradient too, moving at their old speeds
const SEAT_SPEED: Partial<Record<CreatureState, number>> = { listening: 0.4, speaking: 1.1 };
const seatTints = { home: new Map<number, Tint>(), work: new Map<number, Tint>() };
function seatTint(seat: SeatName, s: CreatureState): Tint {
  const sp = SEAT_SPEED[s];
  if (sp === undefined) return TINTS[seat];
  let t = seatTints[seat].get(sp);
  if (!t) seatTints[seat].set(sp, (t = { ...TINTS[seat], speed: sp }));
  return t;
}

/** the tint for a state, a flash over it, how long the state has been on (ms), and the seat (what rest wears) */
export function tintOf(s: CreatureState, flash: Flash | null, age: number, seat: SeatName = "home"): Tint {
  if (flash === "done") return TINTS.done;
  if (flash === "wrong") return TINTS.wrong;
  if (s === "working") return TINTS.working;
  if (s === "yourcall") return age < ARRIVE_MS ? TINTS.arrive : TINTS.yourcall;
  if (s === "unplugged") return TINTS.unplugged;
  return seatTint(seat, s);
}

// The engine calls the seats codex / claude; the creature calls them home / work.
export const seatName = (s: string): SeatName => (s === "claude" || s === "work" ? "work" : "home");

const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const pingPong = (x: number) => 1 - Math.abs((((x % 2) + 2) % 2) - 1);
/** the colour at x along a tint: 0..1 runs the stops, 1..2 runs them back (so x can grow forever) */
export function tintAt(t: Tint, x: number): RGB {
  const n = t.stops.length;
  if (n === 1) return t.stops[0];
  const f = pingPong(x) * (n - 1), i = Math.min(n - 2, Math.floor(f));
  return mix(t.stops[i], t.stops[i + 1], f - i);
}

export const rgba = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
export const bayer = (i: number, j: number) => (BAYER[j & 3][i & 3] + 0.5) / 16;

// A dithered band colour: quantise the tint to its stops, dither between neighbours by cell position.
export function bandColour(t: Tint, x: number, i: number, j: number): RGB {
  const n = t.stops.length;
  const f = pingPong(x) * (n - 1);
  let k = Math.floor(f);
  if (f - k > bayer(i, j)) k = Math.min(k + 1, n - 1);
  return t.stops[Math.max(0, Math.min(n - 1, k))];
}

/** the creature's ten colours in its own order (palette.json "creature"), for shimmers that run through all of them */
export const FAMILY: readonly RGB[] = Object.values(CREATURE);
/** the Show's helper lanes: the creature's colours, the ones that read on pearl paper first (the old order) */
export const LANES: readonly RGB[] = (["amber", "pink", "green", "orange", "blush", "sun", "heart", "candy", "ember", "lime"] as const).map((n) => CREATURE[n]);
/** a seat's two ends, for things drawn in a pair (the Show's first stripe) */
export const seatEnds = (seat: SeatName): [RGB, RGB] => { const g = GRADIENTS[seat]; return [g[0], g[g.length - 1]]; };

// the paper the creature's things sit on, as numbers for the canvases (face.css has the same as tokens). Work shares
// Life's paper since 2026-10-15 (face.css); its entry stayed the old inverse, so Work's canvases drew dark ink on dark
// until the polish pass. The creature's colours never change. setPaper swaps it in place, so readers keep their reference.
const PAPERS = {
  home: { raised: [42, 42, 42] as RGB, line: [48, 48, 48] as RGB, ink: "#ebebe8", dim: "#9a9a97", mute: "#5c5c5a", grain: "rgba(235,235,232,0.035)" },
  work: { raised: [42, 42, 42] as RGB, line: [48, 48, 48] as RGB, ink: "#ebebe8", dim: "#9a9a97", mute: "#5c5c5a", grain: "rgba(235,235,232,0.035)" },
};
export const PAPER = { ...PAPERS.home };
export function setPaper(mode: "home" | "work") { Object.assign(PAPER, PAPERS[mode], LOOK_PAPER); }
// the look (look.ts): the canvases draw with the base's own steps, flattened, since a canvas cell is opaque.
// `on` is white on a dark base, black on a light one; the base is the window's colour.
const LOOK_PAPER: Partial<typeof PAPERS.home> = {};
export function setPaperLook(base: RGB, on: RGB) {
  const mix = (t: number): RGB => [base[0] + (on[0] - base[0]) * t, base[1] + (on[1] - base[1]) * t, base[2] + (on[2] - base[2]) * t];
  const hex = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  Object.assign(LOOK_PAPER, { raised: mix(0.10), line: mix(0.12), ink: hex(mix(0.92)), dim: hex(mix(0.55)), mute: hex(mix(0.32)), grain: `rgba(${on[0]},${on[1]},${on[2]},0.035)` });
  Object.assign(PAPER, LOOK_PAPER);
}
