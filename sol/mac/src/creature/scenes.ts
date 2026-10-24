// The scenes (Companion #5 step 4, design/companion/PRD.md "The hands and scenes"). One Sol, many hands: small kin in
// the creature's pixel grammar (a body of cells, two eyes, a tool in hand; ported from design/studio's hands.tsx) come in,
// do one thing beside the box, leave a result behind and go. The hands and the creature are the only pixel things; what
// they work on (a quiet boundary, text, a notepad) is drawn smooth, like the rest of the interface.
//
// API: play(scene, box?, data?) starts a scene or feeds it new data; end(scene, data?) lets it finish its beat and leave
// clean (never a half-scene). The window draws every running scene on one full-window canvas (Widget.tsx <SceneLayer>,
// up only while a scene runs), ticked by the shared loop. If there is no box or no room beside it, the scene does not draw and the state draws alone.
// The notch gets only a 24 px gesture (Sol directing while EDIT runs, notch/Crew.tsx), told over a BroadcastChannel.
//
// Tempo is design data, sol/design/tempo.json: every move lasts moveMs (never under minMoveMs) on a slow sine ease, a
// beat is a move plus beatPauseMs, and two to four hands move at once. Every time below is a multiple of those.
//
// The four scenes:
//   EDIT       a Work turn edits files: three hands rewrite the changed files' rows inside a quiet boundary; the rows
//              settle, a tick is drawn; Sol directs from the notch.
//   DICTATE    dictation: a hand holds a notepad beside the box, a second writes the words as they arrive; on send the
//              notepad is handed into the box.
//   UNPLUGGED  the engine is down: two hands bring a loose cable and set the plug down near the creature; Marco drags the
//              plug onto the creature, the hands push it in and the engine starts (Tauri engine_start); failed, it falls out.
//              It watches the wire itself and reels in whenever the engine is up; only where the window's own creature
//              shows (an empty conversation), never over the words.
//   RECEIPT    a turn did something: a hand gives a small receipt (creature.receipt lines), a second stamps it; after 6 s,
//              unless hovered, the first comes back and takes it away.
// Dev: ?scene=edit|dictate|unplugged|receipt plays the scene on a loop so it can be shot.
import { invoke } from "@tauri-apps/api/core";
import tempo from "../../../design/tempo.json";
import { onWire } from "../renovation";
import { pointer } from "./loop";
import { rgba, bayer } from "./ring";
import { CREATURE, FUNCTIONAL } from "./palette";
import { enginePhase } from "./state";

export type SceneName = "edit" | "dictate" | "unplugged" | "receipt";
export type Box = () => DOMRect | null;
type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

// ---- tempo -------------------------------------------------------------------------------------------------------
export const TEMPO = {
  hands: tempo.handsAtOnce as [number, number],
  M: Math.max(tempo.minMoveMs, tempo.moveMs),   // one move
  P: tempo.beatPauseMs,                          // the pause between beats
};
const M = () => TEMPO.M;
const B = () => TEMPO.M + TEMPO.P;               // one beat: a move and a pause
const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : (1 - Math.cos(Math.PI * k)) / 2);
const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const prog = (t: number, at: number, dur = M()) => ease((t - at) / dur);

// A hand's path: keys [ms, point, scale]. Between two keys it eases across the whole gap with a small arc; equal points
// hold. Scale 0 is folded away at its source (the bud pops in, and shrinks back on leaving).
type Key = [number, Pt, number];
function path(t: number, keys: Key[]): { p: Pt; s: number; moving: boolean } {
  if (t <= keys[0][0]) return { p: keys[0][1], s: keys[0][2], moving: false };
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1, s1] = keys[i], [t0, p0, s0] = keys[i - 1];
    if (t > t1) continue;
    const k = ease((t - t0) / Math.max(1, t1 - t0));
    const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const arc = -Math.sin(Math.PI * k) * Math.min(22, d * 0.12);
    return { p: { x: lerp(p0.x, p1.x, k), y: lerp(p0.y, p1.y, k) + arc }, s: lerp(s0, s1, k), moving: d > 1 && k < 1 };
  }
  const l = keys[keys.length - 1];
  return { p: l[1], s: l[2], moving: false };
}

// ---- the hands (design/studio/src/hands.tsx, without its springs: tempo drives them) --------------------------------
export type Tool = "cursor" | "brush" | "pad" | "none";
// the hands each wear a creature colour of their own, as in the studio (design/palette.json "creature"); the tick is green
const GREEN = rgba(FUNCTIONAL.green.strong);
const COL = {
  cursor: rgba(CREATURE.lime), brush: rgba(CREATURE.pink), carry: rgba(CREATURE.green), lift: rgba(CREATURE.ember),
  pad: rgba(CREATURE.sun), card: rgba(CREATURE.candy), plug: rgba(CREATURE.orange),
};
const HN = 9, HPX = 2;           // a hand is 9 cells of 2 px
const TOOLS: Record<Exclude<Tool, "none">, string[]> = {   // W white, K ink, T tip in the hand's colour, lightened
  cursor: ["K....", "KK...", "KWK..", "KWWK.", "KWWWK", "KWKK.", "K..K."],
  brush: ["...TT", "...TT", "..K..", ".K...", "K...."],
  pad: ["WWWWW", "WKKKW", "WWWWW", "WKKWW", "WWWWW"],
};
const shade = (c: string, f: number) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  const v = m ? [+m[1], +m[2], +m[3]] : [200, 200, 200];
  const g = (x: number) => Math.round(f > 0 ? x + (255 - x) * f : x * (1 + f));
  return `rgb(${g(v[0])},${g(v[1])},${g(v[2])})`;
};
function drawHand(x: CanvasRenderingContext2D, at: Pt, sc: number, color: string, tool: Tool, now: number, id: number, o: { tap?: number; look?: number } = {}) {
  if (sc < 0.05) return;
  const c = Math.max(1, Math.round(HPX * sc));
  const n = HN, cx = n / 2 - 0.5, cy = n / 2 - 0.5, r = (n / 2) * (1 + Math.sin(now / 500 + id) * 0.02);
  const ox = Math.round(at.x - (n * c) / 2), oy = Math.round(at.y - (n * c) / 2 + (o.tap ?? 0) * c * 2 + Math.round(Math.sin(now / 260 + id) * 0.6));
  const hi = shade(color, 0.45), lo = shade(color, -0.25);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const d = Math.hypot(i - cx, (j - cy) * 1.08);
    if (d > r - 0.2) continue;
    x.fillStyle = i + j < n * 0.55 && d > r * 0.45 ? hi : i + j > n * 1.35 ? lo : color;
    x.fillRect(ox + i * c, oy + j * c, c, c);
  }
  const ey = Math.round(n * 0.42), ex = Math.round(cx - 1 + (o.look ?? 0));
  if ((now / 1000 + id * 1.7) % 3.7 < 0.12) { x.fillStyle = "#0a0a0a"; x.fillRect(ox + (ex - 1) * c, oy + ey * c, c * 2, c); x.fillRect(ox + (ex + 2) * c, oy + ey * c, c * 2, c); }
  else for (const e of [ex - 1, ex + 2]) { x.fillStyle = "#ffffff"; x.fillRect(ox + e * c, oy + ey * c, c, c); x.fillStyle = "#0a0a0a"; x.fillRect(ox + (e + 1) * c, oy + ey * c, c, c); }
  if (tool === "none") return;
  const g = TOOLS[tool], tx = ox + (n - 1) * c, ty = oy + Math.round(n * 0.4) * c;
  g.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === ".") return;
    x.fillStyle = ch === "W" ? "#f4f1ec" : ch === "K" ? "#0a0a0a" : hi;
    x.fillRect(tx + i * c, ty + j * c, c, c);
  }));
}
/** a few cells shed where a hand lands its work, falling a little; whole cells, gone in 0.6 s */
function sparks(x: CanvasRenderingContext2D, at: Pt, t: number, color: string, seed: number) {
  if (t < 0 || t > 600) return;
  const k = t / 600;
  x.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = (seed * 7 + i * 1.3) % (Math.PI * 2), v = 14 + ((seed + i * 5) % 9);
    const px = at.x + Math.cos(a) * v * k, py = at.y - Math.abs(Math.sin(a)) * v * k + 30 * k * k;
    if (bayer(i, Math.floor(k * 8)) < k) continue;
    x.fillRect(Math.round(px / 2) * 2, Math.round(py / 2) * 2, 2, 2);
  }
}

// ---- smooth things: the interface's own look ------------------------------------------------------------------------
let css = { ink: "#ebebe8", dim: "#9a9a97", line: "#303030", surface: "#222222", at: -1e9 };
function vars(now: number) {
  if (now - css.at < 1000) return css;
  const s = getComputedStyle(document.documentElement), g = (n: string, d: string) => s.getPropertyValue(n).trim() || d;
  css = { ink: g("--ink", css.ink), dim: g("--dim", css.dim), line: g("--line", css.line), surface: g("--surface", css.surface), at: now };
  return css;
}
const SANS = "-apple-system, BlinkMacSystemFont, system-ui, sans-serif", MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
function rrect(x: CanvasRenderingContext2D, r: Rect, rad: number) {
  x.beginPath(); x.roundRect(r.x, r.y, r.w, r.h, rad);
}
function tick(x: CanvasRenderingContext2D, at: Pt, k: number, color: string) {
  if (k <= 0) return;
  x.save(); x.strokeStyle = color; x.lineWidth = 2; x.lineCap = "round"; x.lineJoin = "round";
  const a = { x: at.x - 6, y: at.y }, b = { x: at.x - 2, y: at.y + 4 }, c = { x: at.x + 7, y: at.y - 6 };
  x.beginPath(); x.moveTo(a.x, a.y);
  const k1 = clamp01(k / 0.4), k2 = clamp01((k - 0.4) / 0.6);
  x.lineTo(lerp(a.x, b.x, k1), lerp(a.y, b.y, k1));
  if (k2 > 0) x.lineTo(lerp(b.x, c.x, k2), lerp(b.y, c.y, k2));
  x.stroke(); x.restore();
}
function fitText(x: CanvasRenderingContext2D, s: string, w: number) {
  if (x.measureText(s).width <= w) return s;
  let t = s;
  while (t.length > 1 && x.measureText(t + "…").width > w) t = t.slice(0, -1);
  return t + "…";
}

// ---- running scenes -------------------------------------------------------------------------------------------------
type Run = {
  name: SceneName; t0: number; data: any; loop: boolean; endAt: number | null; endData?: any; box?: Box;
  s: Record<string, any>;      // the scene's own working state
};
const runs = new Map<SceneName, Run>();
let defaultBox: Box | null = null;
const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const chan = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("sol-scenes") : null;
// who wants to know whether a scene runs here (the window's <SceneLayer> mounts its canvas only then)
const runSubs = new Set<() => void>();
export const onRuns = (f: () => void) => { runSubs.add(f); return () => { runSubs.delete(f); }; };
export const running = () => runs.size > 0;
const announce = () => {
  chan?.postMessage({ names: [...runs.keys()] });
  if (!runs.size) cursor(false);
  for (const f of runSubs) f();
};

/** start a scene (or feed it new data, and take back an end not yet played) */
export function play(name: SceneName, box?: Box, data?: any) {
  if (reduced) return;
  if (name === "unplugged" && enginePhase() === "up") return;   // a late call from a state already gone
  const r = runs.get(name);
  if (r) {
    if (data !== undefined) r.data = { ...r.data, ...data }; if (box) r.box = box;
    // the cable already reeling in finishes its reel; if the engine is still down then, it comes back from the start
    if (r.name === "unplugged" && r.s.phase === "reel") r.s.again = true;
    else if (!r.loop) r.endAt = null;
    return;
  }
  runs.set(name, { name, t0: performance.now(), data: data ?? {}, loop: false, endAt: null, box, s: {} });
  announce();
}
/** let a scene finish its beat and leave clean */
export function end(name: SceneName, data?: any) {
  const r = runs.get(name);
  if (!r || r.loop || r.endAt !== null) return;
  r.endAt = performance.now(); r.endData = data;
}
/** take a scene away at once, no beat (the window that draws it is going) */
export function stop(name: SceneName) {
  if (drag?.r.name === name) { drag = null; cursor(false); }
  if (runs.delete(name)) announce();
}
export const playing = (name: SceneName) => runs.has(name);
/** the window's default box (the composer); App.tsx sets it */
export function setSceneBox(b: Box | null) {
  defaultBox = b;
  if (b && forced && !runs.has(forced)) { play(forced, undefined, sample(forced)); const r = runs.get(forced); if (r) r.loop = true; }
}

// where a scene of size w x h stands: right of the box if the window has room there, else above the box's right end,
// over the bottom of the talk; null when neither fits (the state then draws without the scene)
function stand(box: DOMRect, W: number, w: number, h: number): Rect | null {
  const main = document.querySelector(".main")?.getBoundingClientRect();
  const right = (main ? main.right : W) - box.right;
  if (right >= w + 40) return { x: box.right + 24, y: box.bottom - h, w, h };
  const above = box.top - (main ? main.top : 0) - 56;
  if (above >= h + 16 && box.width >= w) return { x: box.right - w, y: box.top - h - 16, w, h };
  return null;
}
const SIZE: Record<SceneName, [number, number]> = { edit: [250, 104], dictate: [190, 96], unplugged: [300, 96], receipt: [210, 76] };

/** draws every running scene; the window's <SceneLayer> calls it each frame (canvas = the window, client px) */
export function drawScenes(x: CanvasRenderingContext2D, W: number, _H: number, now: number) {
  if (!runs.size) { cursor(false); return; }
  x.imageSmoothingEnabled = false;
  let grab = false;
  for (const r of [...runs.values()]) {
    const box = (r.box ?? defaultBox)?.() ?? null;
    const [w, h] = SIZE[r.name];
    // UNPLUGGED stands only where the window's own creature shows: no second creature over the conversation
    const at = box && box.width > 0 && (r.name !== "unplugged" || creatureSpot()) ? stand(box, W, w, h) : null;
    // the engine is up (whether or not its word reached anyone): the cable reels in
    if (r.name === "unplugged" && !r.loop && enginePhase() === "up") end("unplugged");
    let alive = true;
    if (!at || !box) alive = !(r.endAt !== null);   // nowhere to stand: nothing drawn; ending simply ends
    else {
      const t = now - r.t0;
      alive = r.name === "edit" ? edit(x, r, t, now, at)
        : r.name === "dictate" ? dictate(x, r, t, now, at, box)
        : r.name === "unplugged" ? unplugged(x, r, t, now, at)
        : receipt(x, r, t, now, at);
      if (r.name === "unplugged" && r.s.hover) grab = true;
    }
    if (!alive) {
      if (r.loop) { r.t0 = now + TEMPO.P * 2; r.endAt = null; r.s = {}; r.data = sample(r.name); }
      else { runs.delete(r.name); announce(); }
    }
  }
  cursor(grab);
}
let cursorOn = false;
function cursor(on: boolean) { if (on === cursorOn) return; cursorOn = on; document.documentElement.style.cursor = on ? (drag ? "grabbing" : "grab") : ""; }

// ---- EDIT ------------------------------------------------------------------------------------------------------------
// Beat 0 the boundary draws itself in as three hands come down from the notch (where Sol directs). Beat 1 the cursor
// selects the first row and rewrites it, the brush repaints the second, the third hand carries the new row in. Beat 2
// the rows settle, a tick is drawn, the hands go back up. Beat 3 the boundary undraws with its rows, nothing left over.
// While the turn keeps editing it runs again with the latest files; end() lets the cycle finish.
function edit(x: CanvasRenderingContext2D, r: Run, t: number, now: number, R: Rect): boolean {
  const C = 4 * B(), cyc = Math.floor(t / C), ct = t - cyc * C;
  if (r.endAt !== null && cyc > Math.floor((r.endAt - r.t0) / C)) return false;
  const v = vars(now);
  const rows: string[] = (r.data.lines ?? []).slice(-3);
  if (!rows.length) rows.push("…");
  const n = rows.length, rowY = (i: number) => R.y + 30 + i * 22, x0 = R.x + 26, x1 = R.x + R.w - 16;
  const src: Pt = { x: R.x + R.w / 2, y: -24 };
  const draw = prog(ct, 0), undraw = prog(ct, 3 * B());
  // the quiet boundary: a 1 px rounded line that draws itself round, and back
  const per = 2 * (R.w + R.h);
  x.save();
  x.strokeStyle = v.dim; x.globalAlpha = 0.35; x.lineWidth = 1;
  x.setLineDash([per * draw * (1 - undraw), per]); x.lineDashOffset = -per * undraw;
  rrect(x, { x: R.x + 0.5, y: R.y + 0.5, w: R.w - 1, h: R.h - 1 }, 10); x.stroke();
  x.restore();
  // the label, where Sol's direction lands
  const alpha = draw * (1 - undraw);
  x.save(); x.globalAlpha = alpha; x.font = `11px ${SANS}`; x.fillStyle = v.dim; x.textBaseline = "middle";
  x.fillText(r.data.title ?? "editing", R.x + 12, R.y + 12);
  // the rows
  x.font = `12px ${MONO}`;
  const sel = prog(ct, B()), paint = prog(ct, B() + TEMPO.P / 2), settled = ct > 2 * B();
  const hands: { id: number; color: string; tool: Tool; keys: Key[] }[] = [];
  const A: Pt = { x: x1, y: rowY(0) + 7 }, Aend: Pt = { x: x0, y: rowY(0) + 7 };
  hands.push({ id: 1, color: COL.cursor, tool: "cursor", keys: [[0, src, 0], [M(), A, 1], [B(), A, 1], [B() + M(), Aend, 1], [2 * B(), Aend, 1], [2 * B() + M(), src, 0]] });
  for (let i = 0; i < n; i++) {
    const y = rowY(i), s = fitText(x, rows[i], x1 - x0);
    const sw = x.measureText(s).width;
    const mark = i === n - 1 && n === 3 ? "+" : "~";
    if (i === 0) {
      // selected right to left, then rewritten
      if (ct < B() + M()) {
        const hx = lerp(x1, x0, sel);
        if (sel > 0) { x.fillStyle = v.ink; x.globalAlpha = alpha * 0.12; x.fillRect(hx, y - 2, x1 - hx, 18); x.globalAlpha = alpha; }
        x.fillStyle = sel > 0 ? v.dim : v.ink; x.fillText(s, x0, y + 7);
        if (sel > 0) { x.fillRect(Math.max(hx, x0), y + 7, Math.max(0, Math.min(x0 + sw, x1) - Math.max(hx, x0)), 1); }
      } else {
        const k = clamp01((ct - B() - M()) / (TEMPO.P + 1));
        x.fillStyle = v.ink; x.fillText(s.slice(0, Math.ceil(s.length * Math.max(k, settled ? 1 : 0))), x0, y + 7);
      }
    } else if (i === 1) {
      // repainted left to right under the brush
      const bx = lerp(x0, x0 + sw, paint);
      x.fillStyle = v.dim; x.fillText(s, x0, y + 7);
      x.save(); x.beginPath(); x.rect(x0 - 2, y - 4, bx - x0 + 2, 22); x.clip();
      x.fillStyle = v.ink; x.fillText(s, x0, y + 7);
      x.restore();
      if (paint > 0 && paint < 1) { x.fillStyle = COL.brush; x.fillRect(bx - 1, y + 14, 2, 2); }
      hands.push({ id: 2, color: COL.brush, tool: "brush", keys: [[M() * 0.3, src, 0], [M() * 1.3, { x: x0 - 4, y: y - 2 }, 1], [B() + TEMPO.P / 2, { x: x0 - 4, y: y - 2 }, 1], [B() + TEMPO.P / 2 + M(), { x: x0 + sw + 4, y: y - 2 }, 1], [2 * B() + TEMPO.P / 2, { x: x0 + sw + 4, y: y - 2 }, 1], [2 * B() + TEMPO.P / 2 + M(), src, 0]] });
    }
    if (i === 2) {
      // carried in from outside the boundary and set down
      const start: Pt = { x: R.x - 30, y: R.y + R.h + 8 }, place: Pt = { x: x0 + sw + 14, y: y + 4 };
      const keys: Key[] = [[M() * 0.6, src, 0], [M() * 1.6, start, 1], [B() + TEMPO.P, start, 1], [B() + TEMPO.P + M(), place, 1], [2 * B() + TEMPO.P, place, 1], [2 * B() + TEMPO.P + M(), src, 0]];
      hands.push({ id: 3, color: COL.carry, tool: "none", keys });
      const h = path(ct, keys);
      const down = ct >= B() + TEMPO.P + M();
      if (h.s > 0.3 || down) {
        const tx = down ? x0 : h.p.x - sw - 12, ty = down ? y + 7 : h.p.y + 3;
        x.fillStyle = v.ink; x.fillText(s, tx, ty);
        if (down) sparks(x, { x: x0 + sw + 6, y: y + 6 }, ct - (B() + TEMPO.P + M()), COL.carry, 3);
      }
    }
    // the settled mark: + a new row, ~ a changed one
    if (settled) { x.fillStyle = mark === "+" ? rgba(CREATURE.green) : v.dim; x.fillText(mark, R.x + 12, y + 7); }
  }
  x.restore();
  // the tick, drawn as the hands leave; it goes with the boundary
  tick(x, { x: R.x + R.w - 18, y: R.y + 12 }, prog(ct, 2 * B(), M() / 2) * (1 - undraw), GREEN);
  for (const h of hands) { const p = path(ct, h.keys); drawHand(x, p.p, p.s, h.color, h.tool, now, h.id); }
  return true;
}

// ---- DICTATE ---------------------------------------------------------------------------------------------------------
// A hand brings a notepad beside the box and holds it; a second writes each word as it arrives (a tap per word). On
// send the notepad is carried down into the box, where the words now are; if nothing was said it is carried away.
function dictate(x: CanvasRenderingContext2D, r: Run, t: number, now: number, R: Rect, box: DOMRect): boolean {
  const s = r.s;
  if (r.loop) {   // the dev loop: words arrive on their own, then the pad is handed over
    const words = (r.data.sample as string).split(" "), start = B();
    const k = Math.max(0, Math.floor((t - start) / 380));
    r.data.text = words.slice(0, Math.min(words.length, k)).join(" ");
    if (k >= words.length + 3 && s.endT === undefined) { s.endT = t; s.sent = true; }
  } else if (r.endAt !== null && s.endT === undefined) { s.endT = r.endAt - r.t0; s.sent = !!(r.endData?.sent && (r.data.text ?? "").trim()); }
  const text: string = r.data.text ?? "";
  if (text.length > (s.len ?? 0)) s.tapAt = now;
  s.len = text.length;
  const pad: Rect = { x: R.x + 18, y: R.y + 6, w: R.w - 24, h: R.h - 22 };
  const src: Pt = { x: R.x + R.w + 30, y: -24 };
  const hold: Pt = { x: pad.x - 2, y: pad.y + pad.h - 4 };
  const into: Pt = { x: box.x + 40, y: box.y + box.height / 2 };
  const e = s.endT as number | undefined;
  const keys: Key[] = [[0, src, 0], [M(), hold, 1]];
  if (e !== undefined) keys.push([Math.max(M(), e), hold, 1], [Math.max(M(), e) + M(), s.sent ? into : src, s.sent ? 1 : 0], ...(s.sent ? [[Math.max(M(), e) + M() + TEMPO.P, into, 1] as Key, [Math.max(M(), e) + 2 * M() + TEMPO.P, src, 0] as Key] : []));
  const P = path(t, keys);
  const gone = e !== undefined && t > Math.max(M(), e) + M();   // the pad is in the box (or away)
  if (e !== undefined && t > Math.max(M(), e) + 2 * M() + TEMPO.P + 50) return false;
  // the notepad rides on the holding hand; going into the box it shrinks to the box's line
  const dx = P.p.x - hold.x, dy = P.p.y - hold.y;
  const into01 = e !== undefined && s.sent ? clamp01((t - Math.max(M(), e)) / M()) : 0;
  const sc = P.s * lerp(1, 0.35, ease(into01));
  x.font = `12px ${SANS}`;
  const lines: string[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const l = lines.length ? lines[lines.length - 1] : null;
    if (l !== null && x.measureText(l + " " + w).width <= pad.w - 20) lines[lines.length - 1] = l + " " + w; else lines.push(w);
  }
  const shown = lines.slice(-3);
  let pen: Pt = { x: pad.x + 12 + dx, y: pad.y + 18 + dy };
  if (!gone && sc > 0.05) {
    x.save();
    x.translate(pad.x + dx, pad.y + pad.h + dy); x.scale(sc, sc); x.translate(-pad.x, -(pad.y + pad.h));
    x.fillStyle = "#f4f1ec"; rrect(x, pad, 6); x.fill();
    x.fillStyle = "rgba(0,0,0,.08)"; for (let i = 1; i <= 3; i++) x.fillRect(pad.x + 10, pad.y + 6 + i * 16 + 2, pad.w - 20, 1);
    x.fillStyle = "#1b1b1a"; x.textBaseline = "alphabetic";
    shown.forEach((l, i) => x.fillText(l, pad.x + 10, pad.y + 6 + (i + 1) * 16 - 1));
    if (!shown.length) { x.fillStyle = "rgba(0,0,0,.35)"; x.fillText("…", pad.x + 10, pad.y + 21); }
    x.restore();
    const last = shown[shown.length - 1] ?? "";
    pen = { x: pad.x + 10 + x.measureText(last).width + 8 + dx, y: pad.y + 6 + Math.max(1, shown.length) * 16 - 10 + dy };
  }
  // the writing hand: comes with the pad, follows the words, leaves when the pad goes
  const wKeys: Key[] = [[M() * 0.3, src, 0], [M() * 1.3, { x: pad.x + 22, y: pad.y + 12 }, 1]];
  const W = path(t, wKeys);
  let wp = W.p, ws = W.s;
  if (t > M() * 1.3) wp = pen;
  if (e !== undefined) { const k = prog(t, Math.max(M(), e)); wp = { x: lerp(pen.x, src.x, k), y: lerp(pen.y, src.y, k) }; ws = 1 - k; }
  const tap = s.tapAt ? Math.max(0, 1 - (now - s.tapAt) / 180) : 0;
  if (into01 >= 1) sparks(x, into, t - (Math.max(M(), e!) + M()), COL.pad, 5);
  drawHand(x, wp, ws, COL.brush, "brush", now, 4, { tap: -tap });
  drawHand(x, P.p, P.s, COL.pad, "none", now, 5, { look: into01 > 0 ? -1 : 0 });
  return true;
}

// ---- UNPLUGGED -------------------------------------------------------------------------------------------------------
// Two hands bring a loose cable and set the plug down near the creature, then wait to the side. Marco drags the plug
// onto the creature; the hands take it and push it in, and the app starts the engine. Up: the cable reels into the
// creature and the hands leave. Failed: the plug falls out and the hands wait again.
let drag: { r: Run; off: Pt } | null = null;
const PLUG = ["K.WWWWW", "..WWWWWC", "K.WWWWW"];    // pointing left, at the creature; C where the cable joins
const PC = 3;
function plugRect(p: Pt): Rect { return { x: p.x - 4 * PC, y: p.y - 3 * PC, w: 9 * PC, h: 4 * PC }; }
function drawPlug(x: CanvasRenderingContext2D, p: Pt, ink: string) {
  const ox = Math.round(p.x - 4 * PC), oy = Math.round(p.y - 2 * PC);
  PLUG.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === ".") return;
    x.fillStyle = ch === "W" ? (bayer(i, j) < 0.25 ? "#d9d4cb" : "#f4f1ec") : ch === "K" ? "#c8c4bc" : ink;
    x.fillRect(ox + i * PC, oy + j * PC, PC, PC);
  }));
}
function cable(x: CanvasRenderingContext2D, a: Pt, b: Pt, sag: number, color: string, upTo = 1) {
  const mx = (a.x + b.x) / 2, my = Math.max(a.y, b.y) + sag;
  const len = Math.hypot(b.x - a.x, b.y - a.y) + sag, n = Math.max(2, Math.ceil(len / 2));
  x.fillStyle = color;
  for (let i = 0; i <= n * upTo; i++) {
    const k = i / n, u = 1 - k;
    const px = u * u * a.x + 2 * u * k * mx + k * k * b.x, py = u * u * a.y + 2 * u * k * my + k * k * b.y;
    x.fillRect(Math.round(px / 2) * 2, Math.round(py / 2) * 2, 2, 2);
  }
}
/** the window's own creature, when it shows (an empty conversation); null when it does not, and the scene stands down */
function creatureSpot(): Rect | null {
  const m = document.querySelector(".empty .mark-live, .empty canvas, .empty svg");
  const b = m?.getBoundingClientRect();
  return b && b.width > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
}
function unplugged(x: CanvasRenderingContext2D, r: Run, t: number, now: number, R: Rect): boolean {
  const s = r.s, v = vars(now);
  const cr = creatureSpot();
  if (!cr) return r.endAt === null;   // drawScenes checked; the page changed under it this frame
  const socket: Pt = { x: cr.x + cr.w + 2 + 4 * PC, y: cr.y + cr.h * 0.62 };
  const floor = Math.max(R.y + R.h - 6, cr.y + cr.h);
  const rest: Pt = { x: Math.min(R.x + R.w - 70, socket.x + 70), y: floor - PC };
  const tail: Pt = { x: R.x + R.w + 18, y: floor };
  const src: Pt = { x: R.x + R.w * 0.6, y: -24 };
  const waitA: Pt = { x: rest.x + 34, y: floor - 46 }, waitB: Pt = { x: rest.x + 84, y: floor - 38 };
  s.phase ??= "bring";
  s.plug ??= { x: rest.x, y: rest.y };
  const at = (p: string) => { s.phase = p; s.since = now; };
  const since = now - (s.since ?? r.t0);
  // the engine's word decides the end of a push: up ends the scene (drawScenes and the wire call end), failed drops the plug
  if (r.endAt !== null && s.phase !== "reel") { at("reel"); if (drag?.r === r) drag = null; }
  if (s.phase === "in" && (enginePhase() === "failed" || (r.loop && since > 1400))) at("fall");
  let A: Pt, Bp: Pt, sa = 1, sb = 1, plug: Pt = s.plug, mid: Pt | null = null;
  if (s.phase === "bring") {
    // beat 0: they come in carrying the cable; beat 1: they set the plug down on the floor and step back to wait
    const pA = path(t, [[0, src, 0], [M(), { x: rest.x + 4, y: rest.y - 30 }, 1], [B(), { x: rest.x + 4, y: rest.y - 30 }, 1], [B() + M(), { x: rest.x + 4, y: rest.y - 8 }, 1], [2 * B(), { x: rest.x + 4, y: rest.y - 8 }, 1], [2 * B() + M(), waitA, 1]]);
    const pB = path(t, [[M() * 0.25, src, 0], [M() * 1.25, { x: rest.x + 60, y: rest.y - 34 }, 1], [B(), { x: rest.x + 60, y: rest.y - 34 }, 1], [B() + M(), { x: rest.x + 60, y: floor - 8 }, 1], [2 * B(), { x: rest.x + 60, y: floor - 8 }, 1], [2 * B() + M() * 1.25, waitB, 1]]);
    A = pA.p; Bp = pB.p; sa = pA.s; sb = pB.s;
    plug = t < B() + M() ? { x: A.x - 4, y: A.y + 8 } : rest;
    mid = t < 2 * B() ? { x: Bp.x, y: Bp.y + 8 } : null;
    if (t > 2 * B() + M() * 1.25) { at("wait"); s.plug = { ...rest }; }
  } else if (s.phase === "wait" || s.phase === "drag") {
    A = { x: waitA.x, y: waitA.y }; Bp = waitB;
    if (s.phase === "drag" && drag?.r === r) plug = s.plug = { x: pointer.x + drag.off.x, y: pointer.y + drag.off.y };
    else plug = s.plug;
    // the plug asks, now and then: a one-cell hop
    if (s.phase === "wait" && Math.floor(now / 2400) % 2 === 0 && now % 2400 < 240) plug = { x: plug.x, y: plug.y - PC };
    if (r.loop && s.phase === "wait" && since > 1500) { at("ghost"); s.from = { ...s.plug }; }
    if (s.phase === "drag") { A = { x: lerp(waitA.x, plug.x + 30, 0.3), y: waitA.y }; }
  } else if (s.phase === "ghost") {
    // the dev loop's Marco: the plug glides onto the creature
    const k = prog(since, 0);
    plug = s.plug = { x: lerp(s.from.x, socket.x + 16, k), y: lerp(s.from.y, socket.y, k) - Math.sin(Math.PI * k) * 20 };
    A = waitA; Bp = waitB;
    if (since > M()) connect(r);
  } else if (s.phase === "push") {
    // the hands take the plug from where it was dropped and push it into the creature, together
    const k = prog(since, 0), k2 = prog(since, M() * 0.6, M());
    const from = s.from as Pt;
    A = { x: lerp(waitA.x, from.x + 2, k), y: lerp(waitA.y, from.y - 10, k) };
    Bp = { x: lerp(waitB.x, from.x + 26, k), y: lerp(waitB.y, from.y - 4, k) };
    if (k2 > 0) { plug = { x: lerp(from.x, socket.x, k2), y: lerp(from.y, socket.y, k2) }; A = { x: plug.x + 2, y: plug.y - 10 }; Bp = { x: plug.x + 26, y: plug.y - 4 }; }
    s.plug = plug;
    if (since > M() * 1.6) { at("in"); sparks(x, socket, 0, COL.plug, 2); }
  } else if (s.phase === "in") {
    plug = socket; A = { x: socket.x + 6, y: socket.y - 22 }; Bp = { x: socket.x + 40, y: socket.y - 14 };
    sparks(x, { x: socket.x - 6, y: socket.y }, since, COL.plug, 2);
  } else if (s.phase === "fall") {
    // it slips out and drops to the floor, a small bounce; the hands go back to waiting
    const k = clamp01(since / M());
    const fx = socket.x + 26 * ease(k), g = Math.min(1, k * 1.25);
    const fy = socket.y + (rest.y - socket.y) * g * g - (k > 0.8 ? Math.sin((k - 0.8) / 0.2 * Math.PI) * 6 : 0);
    plug = { x: fx, y: Math.min(rest.y, fy) };
    A = { x: lerp(socket.x + 6, waitA.x, ease(k)), y: lerp(socket.y - 22, waitA.y, ease(k)) };
    Bp = { x: lerp(socket.x + 40, waitB.x, ease(k)), y: lerp(socket.y - 14, waitB.y, ease(k)) };
    if (k >= 1) { s.plug = { x: fx, y: rest.y }; at("wait"); }
  } else {
    // reel: plugged and up; the cable winds into the creature, the hands leave with the plug's end
    const k = prog(since, 0), k2 = prog(since, B());
    plug = s.plug ?? socket;
    A = { x: lerp(plug.x + 6, src.x, k2), y: lerp(plug.y - 22, src.y, k2) }; Bp = { x: lerp(plug.x + 40, src.x, k2), y: lerp(plug.y - 14, src.y, k2) };
    sa = sb = 1 - k2;
    cable(x, plug, tail, 10, v.dim, 1 - k);
    if (k < 1) drawPlug(x, plug, v.dim);
    drawHand(x, A, sa, COL.lift, "none", now, 6, { look: -1 });
    drawHand(x, Bp, sb, COL.plug, "none", now, 7, { look: -1 });
    if (since < B() + M() + 50) return true;
    if (s.again && enginePhase() !== "up") { r.t0 = now; r.endAt = null; r.s = {}; return true; }
    return false;
  }
  // the cable: from the plug, through the second hand while it carries it, to its loose end off the side
  if (mid) { cable(x, plug, mid, 6, v.dim); cable(x, mid, tail, 4, v.dim); } else cable(x, plug, tail, s.phase === "drag" ? 18 : 3, v.dim);
  drawPlug(x, plug, v.dim);
  s.hover = (s.phase === "wait" || s.phase === "drag") && hit(plugRect(plug), pointer);
  drawHand(x, A, sa, COL.lift, "none", now, 6, { look: -1 });
  drawHand(x, Bp, sb, COL.plug, "none", now, 7, { look: -1 });
  return true;
}
const hit = (r: Rect, p: Pt) => p.x >= r.x - 6 && p.x <= r.x + r.w + 6 && p.y >= r.y - 6 && p.y <= r.y + r.h + 6;
function connect(r: Run) {
  const s = r.s; s.from = { ...s.plug }; s.phase = "push"; s.since = performance.now();
  if (!r.loop) void invoke("engine_start").catch(() => {});
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => {
    const r = runs.get("unplugged");
    if (!r || e.button !== 0 || !r.s.plug || (r.s.phase !== "wait")) return;
    const p = { x: e.clientX, y: e.clientY };
    if (!hit(plugRect(r.s.plug), p)) return;
    e.preventDefault(); e.stopPropagation();
    drag = { r, off: { x: r.s.plug.x - p.x, y: r.s.plug.y - p.y } }; r.s.phase = "drag"; r.s.since = performance.now();
    cursorOn = false;
  }, true);
  window.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const r = drag.r; drag = null; cursorOn = false;
    const box = (r.box ?? defaultBox)?.(); const [w, h] = SIZE.unplugged;
    const R = box ? stand(box, innerWidth, w, h) : null;
    const c = creatureSpot();
    if (!R || !c) { r.s.phase = "wait"; return; }
    const near = e.clientX > c.x - 30 && e.clientX < c.x + c.w + 40 && e.clientY > c.y - 30 && e.clientY < c.y + c.h + 30;
    if (near) connect(r);
    else { r.s.plug = { x: Math.max(R.x, Math.min(e.clientX, R.x + R.w - 30)), y: Math.max(R.y + R.h - 6, c.y + c.h) - PC }; r.s.phase = "wait"; r.s.since = performance.now(); }
  }, true);
}

// ---- RECEIPT ---------------------------------------------------------------------------------------------------------
// A hand brings the receipt and sets it down beside the box; a second stamps a tick on it; both go. After 6 s, held
// while the pointer is over it, the first hand comes back and slides it away.
const RECEIPT_MS = 6000;
function receipt(x: CanvasRenderingContext2D, r: Run, t: number, now: number, R: Rect): boolean {
  const s = r.s;
  const lines: string[] = (r.data.lines ?? []).slice(0, 2);
  if (!lines.length) return false;
  x.font = `600 11.5px ${SANS}`;
  const tw = Math.max(...lines.map((l, i) => { x.font = `${i ? 400 : 600} 11.5px ${SANS}`; return x.measureText(l).width; }));
  const pw = Math.min(R.w - 10, Math.ceil((tw + 30) / 2) * 2), ph = 14 + lines.length * 16;
  const spot: Pt = { x: R.x + 6, y: R.y + R.h - ph - 4 };
  const src: Pt = { x: R.x + R.w + 30, y: -24 };
  const setT = B() + M();                       // set down at the end of beat 1
  s.collect ??= setT + RECEIPT_MS;
  const paperR: Rect = { x: spot.x, y: spot.y, w: pw, h: ph };
  if (t > setT && t < s.collect + 1 && hit(paperR, pointer) && pointer.inside) s.collect = Math.max(s.collect, t + 1200);
  const hold: Pt = { x: spot.x + pw + 2, y: spot.y + ph / 2 };
  const C0 = s.collect as number;
  const H = path(t, [[0, src, 0], [M(), { x: hold.x + 30, y: hold.y - 24 }, 1], [B(), { x: hold.x + 30, y: hold.y - 24 }, 1], [setT, hold, 1], [setT + TEMPO.P, hold, 1], [setT + TEMPO.P + M(), src, 0],
    [C0, src, 0], [C0 + M(), hold, 1], [C0 + M() + TEMPO.P, hold, 1], [C0 + 2 * M() + TEMPO.P, { x: hold.x + 60, y: hold.y + 40 }, 0]]);
  const stamp: Pt = { x: spot.x + pw - 12, y: spot.y + 10 };
  const S = path(t, [[M() * 0.4, src, 0], [M() * 1.4, { x: stamp.x + 18, y: stamp.y - 22 }, 1], [setT, { x: stamp.x + 18, y: stamp.y - 22 }, 1], [setT + M() * 0.5, { x: stamp.x + 6, y: stamp.y - 10 }, 1], [setT + TEMPO.P + M() * 0.5, { x: stamp.x + 6, y: stamp.y - 10 }, 1], [setT + TEMPO.P + M() * 1.5, src, 0]]);
  if (t > C0 + 2 * M() + TEMPO.P + 50) return false;
  // the paper rides with the giving hand until set, and again when it is taken away
  let p: Pt = spot, sc = 1;
  if (t < setT) { p = { x: H.p.x - pw - 2, y: H.p.y - ph / 2 }; sc = H.s; }
  else if (t > C0 + M() + TEMPO.P) { p = { x: H.p.x - pw - 2, y: H.p.y - ph / 2 }; sc = H.s; }
  if (sc > 0.05) {
    x.save();
    x.translate(p.x + pw, p.y + ph / 2); x.scale(sc, sc); x.translate(-(p.x + pw), -(p.y + ph / 2));
    // the paper in cells: pearl, a dithered shade down the right, a torn (zigzag) bottom edge
    const cw = pw / 2, chh = Math.round(ph / 2), ox = Math.round(p.x), oy = Math.round(p.y);
    for (let j = 0; j < chh; j++) for (let i = 0; i < cw; i++) {
      if (j === chh - 1 && i % 2 === 0) continue;
      const shadeIt = i >= cw - 3 && bayer(i, j) < (i - (cw - 4)) / 4;
      x.fillStyle = shadeIt ? "#ddd8cf" : "#f4f1ec";
      x.fillRect(ox + i * 2, oy + j * 2, 2, 2);
    }
    x.fillStyle = "#1b1b1a"; x.textBaseline = "alphabetic";
    lines.forEach((l, i) => { x.font = `${i ? 400 : 600} 11.5px ${SANS}`; x.fillStyle = i ? "#55534f" : "#1b1b1a"; x.fillText(l, ox + 10, oy + 18 + i * 16); });
    if (t > setT + M() * 0.4) tick(x, { x: ox + pw - 14, y: oy + 12 }, clamp01((t - setT - M() * 0.4) / (M() * 0.5)), GREEN);
    x.restore();
  }
  sparks(x, stamp, t - setT - M() * 0.5, COL.cursor, 4);
  drawHand(x, H.p, H.s, COL.card, "none", now, 8, { look: -1 });
  drawHand(x, S.p, S.s, COL.cursor, "brush", now, 9, { tap: t > setT && t < setT + M() * 0.6 ? -Math.sin(((t - setT) / (M() * 0.6)) * Math.PI) : 0 });
  return true;
}

// ---- the wire and dev ------------------------------------------------------------------------------------------------
onWire((e) => {
  // UNPLUGGED watches the wire itself: the engine says up (state.ts heard it first), the cable reels in
  if (enginePhase() === "up") end("unplugged");
  if ("msg" in e && e.msg?.type === "creature.receipt" && Array.isArray(e.msg.lines) && defaultBox) {
    runs.delete("receipt"); play("receipt", undefined, { lines: e.msg.lines.map(String).slice(0, 2) });
  }
});
const q = typeof location !== "undefined" && import.meta.env.DEV ? new URLSearchParams(location.search) : null;
const forced = ((v) => (v === "edit" || v === "dictate" || v === "unplugged" || v === "receipt" ? (v as SceneName) : null))(q?.get("scene"));
function sample(n: SceneName) {
  if (n === "edit") return { title: "editing 3 files", lines: ["src/creature/scenes.ts", "src/creature/Widget.tsx", "design/tempo.json"] };
  if (n === "dictate") return { sample: "remind me to call the bakery about sunday and move the dentist to friday", text: "" };
  if (n === "receipt") return { lines: ["edited 3 files · ran 2 commands", "scenes.ts, Widget.tsx +1"] };
  return {};
}

// ---- the notch: Sol directing, a 24 px gesture ------------------------------------------------------------------------
let notchNames: string[] = q?.get("scene") ? [q.get("scene")!] : [];
chan?.addEventListener("message", (e) => { if (Array.isArray(e.data?.names)) notchNames = e.data.names; });
/** what the notch may draw of the running scenes: only EDIT's direction (Sol conducting the hands from the notch) */
export const notchGesture = (): "direct" | null => (notchNames.includes("edit") ? "direct" : null);
