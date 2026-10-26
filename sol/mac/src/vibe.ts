// Vibe mode: Sol wears the music. Three parts, each the person's own (Settings → music: shown, follows the music, size,
// brightness, colours; vibe/glow.ts, face.css): a band of Sol's colours round the screen's edges (a transparent
// click-through window the size of the screen, made by vibe.rs), a frame inside the window when it is full screen,
// and a ring round the chat box. By default only the ring takes the beat; the glow just shines. Nothing in the text or
// the panels moves. Everything starts from the mark at the top of the sidebar (Mark.tsx VibeMark) and spreads out.
// The creature's own moves with the music (Widget.tsx, Space.tsx, state.ts read vibe.move) are behind BODY, off.
//
// The sound comes from the shell: vibe_start (src-tauri/src/vibe.rs) runs a Swift helper that taps what the Mac
// plays and sends a `vibe` event thirty times a second with two loudnesses; vibe/beat.ts turns those into env, beat,
// beats and bar, which the canvases read each frame as `vibe`. Off by default; off under reduced motion.
import { useSyncExternalStore } from "react";
import { onTick } from "./creature/loop";
import { reducedMotion } from "./motion";
import { Beat } from "./vibe/beat";

const KEY = "sol.vibe";
const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const beat = new Beat();

/** what the canvases read each frame */
export const vibe = {
  live: false,  // the mode is on and music is playing
  move: false,  // live, and the body may move with it (BODY below): the creature, the corner, the band
  env: 0,       // 0..1 how loud, smoothed over ~120 ms
  beat: 0,      // 1 on a beat of the low end, gone in ~250 ms
  beats: 0,     // beats counted since start
  bar: 0,       // a quarter turn a beat, eased: sin(bar * 2π) breathes once about every four beats
};

// The creature, the corner tint and the band can take the beat too (Widget.tsx, Space.tsx, state.ts read vibe.move),
// off: the text's surroundings stay calm and the beat lives in one place, the ring. The creature is Marco's to decide.
const BODY = false;

// The colours: the glow round the screen and the ring round the chat box wear the same set, in order round the turn.
// Presets from design/palette.json (sol: candy to sun to green, then sky and lavender; dawn; meadow), and Siri's.
export const PRESETS: Record<string, string[]> = {
  sol: ["#fd69b9", "#ff2e4e", "#fb7129", "#f4c82a", "#70df45", "#5ac8fa", "#bf5af2"],
  siri: ["#ff9f0a", "#ff375f", "#bf5af2", "#0a84ff", "#5ac8fa"],
  dawn: ["#fb9ed5", "#ffbe96", "#f6ec8c", "#ffbe96"],
  meadow: ["#ceecb2", "#8dc965", "#70df45", "#e8ef54"],
};
export type Part = { on: boolean; music: boolean; size: number; bright: number; colours: string[] };   // size 0.5..2, bright 0.05..1
export type Prefs = { screen: Part; frame: Part; ring: Part };
export const PART_NAMES: Record<keyof Prefs, string> = { screen: "glow round the screen", frame: "frame when full screen", ring: "ring round the box" };
const isHex = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const PREFS_KEY = "sol.vibe.parts";
const DEFAULTS: Prefs = {
  screen: { on: true, music: false, size: 1, bright: 0.2, colours: PRESETS.sol },
  frame: { on: true, music: false, size: 1, bright: 0.2, colours: PRESETS.sol },
  ring: { on: true, music: true, size: 1, bright: 0.4, colours: PRESETS.sol },
};
// what was kept, each field checked for its kind (a stale or odd value falls back to the default, never a crash)
function part(v: unknown, d: Part): Part {
  if (!v || typeof v !== "object") return d;
  const p = v as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number, dflt: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt);
  return {
    on: typeof p.on === "boolean" ? p.on : d.on,
    music: typeof p.music === "boolean" ? p.music : d.music,
    size: num(p.size, 0.5, 2, d.size),
    bright: num(p.bright, 0.05, 1, d.bright),
    colours: Array.isArray(p.colours) && p.colours.length >= 2 && p.colours.length <= 8 && p.colours.every(isHex) ? p.colours : d.colours,
  };
}
function readPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (v && typeof v === "object") {
      const r = v as Record<string, unknown>;
      return { screen: part(r.screen, DEFAULTS.screen), frame: part(r.frame, DEFAULTS.frame), ring: part(r.ring, DEFAULTS.ring) };
    }
  } catch { /* none kept */ }
  return DEFAULTS;
}

type Snap = { want: boolean; up: boolean; playing: boolean; error: string; prefs: Prefs; fullscreen: boolean };
let snap: Snap = { want: false, up: false, playing: false, error: "", prefs: readPrefs(), fullscreen: false };
const anyMusic = () => snap.prefs.screen.music || snap.prefs.frame.music || snap.prefs.ring.music;
const subs = new Set<() => void>();
const set = (patch: Partial<Snap>) => { snap = { ...snap, ...patch }; subs.forEach((f) => f()); };
export function useVibe(): Snap {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap);
}

// the ring round the chat box (face.css body.vibe .ask-inner): its angle, thickness and glow are written on the box
// itself each frame (so only the box's styles are recomputed), turning faster and swelling with the music
let rings: HTMLElement[] = [], ringsAt = -1e9, angle = 0;
onTick((dt, now) => {
  beat.tick(dt, now);
  vibe.env = beat.env; vibe.beat = beat.beat; vibe.beats = beat.beats; vibe.bar = beat.bar;
  // playing: loud enough for a while; once playing, it takes near silence to stop (a quiet passage is still music)
  const playing = snap.up && !beat.silent(now) && vibe.env > (snap.playing ? 0.015 : 0.05);
  if (playing !== snap.playing) set({ playing });
  vibe.live = snap.want && anyMusic() && playing && !reducedMotion();
  vibe.move = vibe.live && BODY;
  if (!snap.want || reducedMotion()) return;
  if (now - ringsAt > 1000) { ringsAt = now; rings = Array.from(document.querySelectorAll<HTMLElement>(".ask-inner, .vibe-frame")); }
  const env = vibe.live ? vibe.env : 0, bt = vibe.live ? vibe.beat : 0;
  angle = (angle + dt * (30 + env * 260 + bt * 120)) % 360;
  const calm = (angle * 0.4) % 360;   // a part not following the music turns slowly
  for (const el of rings) {
    const p = el.classList.contains("vibe-frame") ? snap.prefs.frame : snap.prefs.ring;
    const m = p.music && vibe.live;
    el.style.setProperty("--vibe-a", `${(p.music ? angle : calm).toFixed(1)}deg`);
    el.style.setProperty("--vibe-env", (m ? env : 0).toFixed(2));
    el.style.setProperty("--vibe-beat", (m ? bt : 0).toFixed(2));
  }
});

// the frame inside the window when it is full screen (face.css .vibe-frame): the glow round the screen cannot be
// over a full-screen Sol in the same way, so the window wears its own; it takes the glow's place while full screen
let frameEl: HTMLElement | null = null;
function frame(show: boolean) {
  if (show && !frameEl) { frameEl = document.createElement("div"); frameEl.className = "vibe-frame"; frameEl.setAttribute("aria-hidden", "true"); document.body.appendChild(frameEl); }
  if (!show && frameEl) { frameEl.remove(); frameEl = null; }
}
function dress(again = false) {
  const on = snap.want && !reducedMotion();
  const fs = on && snap.fullscreen && snap.prefs.frame.on;
  frame(fs);
  void glow(on && snap.prefs.screen.on && !fs, again);
  document.body.classList.toggle("vibe-ring", on && snap.prefs.ring.on);
}
// whether the window is full screen: asked when it resizes and every so often, only while vibe mode is on
let look: () => Promise<void> = () => Promise.resolve();
if (inApp) {
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const w = getCurrentWindow();
    look = () => snap.want ? w.isFullscreen().then((f) => { if (f !== snap.fullscreen) { set({ fullscreen: f }); dress(); } }).catch(() => {}) : Promise.resolve();
    void w.onResized(() => void look());
    window.setInterval(() => void look(), 1500);
  }).catch(() => {});
}
/** the ring's and the frame's colours, size and brightness, as CSS on the page's root (face.css) */
function wear() {
  const r = document.documentElement.style, p = snap.prefs;
  const grad = (c: string[]) => `conic-gradient(from var(--vibe-a, 0deg), ${[...c, c[0]].join(", ")})`;
  r.setProperty("--vibe-ring", grad(p.ring.colours));
  r.setProperty("--vibe-ring-size", `${(2 * p.ring.size).toFixed(1)}px`);
  r.setProperty("--vibe-ring-bright", p.ring.bright.toFixed(2));
  r.setProperty("--vibe-frame-ring", grad(p.frame.colours));
  r.setProperty("--vibe-frame-size", `${Math.round(56 * p.frame.size)}px`);
  r.setProperty("--vibe-frame-bright", p.frame.bright.toFixed(2));
}
wear();
export function setPart<K extends keyof Prefs>(k: K, patch: Partial<Part>) {
  if (patch.colours && (patch.colours.length < 2 || !patch.colours.every(isHex))) return;
  const prefs = { ...snap.prefs, [k]: { ...snap.prefs[k], ...patch } };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* this session only */ }
  set({ prefs });
  wear();
  if (!snap.want) return;
  dress(k === "screen");   // the glow window takes the screen part's new settings while it is on
  if ("music" in patch) void (anyMusic() && !reducedMotion() ? hear() : unhear());
}

// where it all starts from: the sidebar mark's centre in the page (CSS px), a screen point, or the middle of the window
let origin: { x: number; y: number } | null = null;
let screenOrigin: { x: number; y: number } | null = null;

// the page's own parts light up in order of their distance from the mark (face.css animation-delay var(--vd))
function stagger() {
  const o = origin ?? (screenOrigin ? { x: window.innerWidth, y: 0 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
  document.querySelectorAll<HTMLElement>(".ask-inner, .picker, .brand, .verdict .ok, .recap li.ok, .wticket, .wst.done, .mitem.on").forEach((el) => {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(r.left + r.width / 2 - o.x, r.top + r.height / 2 - o.y);
    el.style.setProperty("--vd", `${Math.min(1.1, d / 1300).toFixed(2)}s`);
  });
}

// the glow window (vibe.rs): told when its state changes, or again (while on) with the screen part's new settings
let glowOn = false;
async function glow(on: boolean, again = false) {
  if (!inApp || (on === glowOn && !(again && on))) return;
  glowOn = on;
  const o = screenOrigin ?? origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const { invoke } = await import("@tauri-apps/api/core");
  const p = snap.prefs.screen;
  await invoke("vibe_glow", { on, x: o.x, y: o.y, colours: p.colours, screen: !!screenOrigin, bright: p.bright, size: p.size, music: p.music }).catch((e) => set({ error: String(e) }));
}

// the tap: hearing the Mac's sound, only while "follow the music" is on. vibe_start answers when the helper has
// started, not when it works: an error or an end that arrives before the answer (hearing bumped) wins over it.
let hearing = 0;
async function hear() {
  if (!inApp) { set({ up: false, error: "only inside Sol.app" }); return; }
  const g = ++hearing;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("vibe_start");
    if (g === hearing) set({ up: true, error: "" });
  } catch (e) {
    if (g === hearing) set({ up: false, error: String(e) });
  }
}
async function unhear() {
  hearing++;
  set({ up: false, playing: false });
  if (!inApp) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("vibe_stop").catch(() => {});
}
async function start() {
  stagger();
  document.body.classList.add("vibe");
  await look();   // full screen already? then the frame, not the glow
  dress();
  if (anyMusic() && !reducedMotion()) await hear();
}
// reduced motion switched while running: everything goes quiet, the tap included; switched back: it returns
if (typeof matchMedia !== "undefined") {
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
    if (!snap.want) return;
    dress();
    void (e.matches ? unhear() : anyMusic() ? hear() : Promise.resolve());
  });
}
async function stop() {
  stagger();
  document.body.classList.remove("vibe", "vibe-ring");
  frame(false);
  void glow(false);
  await unhear();
}

/** the switch; kept in localStorage, so it survives a relaunch */
export function setVibe(on: boolean) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* no storage: this session only */ }
  set({ want: on, error: "" });
  void (on ? start() : stop());
}
/** the sidebar's mark (Mark.tsx VibeMark): everything spreads from it */
export function toggleVibe(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; screenOrigin = null;
  setVibe(!snap.want);
}

if (inApp) {
  import("@tauri-apps/api/event").then((ev) => {
    void ev.listen<{ full: number; low: number }>("vibe", (e) => beat.hear(e.payload.full, e.payload.low));
    void ev.listen("vibe-off", () => { hearing++; set({ up: false, playing: false }); });
    void ev.listen<string>("vibe-error", (e) => { hearing++; set({ up: false, error: e.payload }); });
  }).catch(() => {});
  // off unless the person switched it on; a relaunch keeps their choice
  let want = false;
  try { want = localStorage.getItem(KEY) === "1"; } catch { /* no storage */ }
  if (want) { snap = { ...snap, want: true }; window.setTimeout(() => void start(), 800); }
}
