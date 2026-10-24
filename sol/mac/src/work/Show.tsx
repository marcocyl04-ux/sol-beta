// The build as a show: a session at work, drawn. Three layers, top to bottom, on the creature's frame loop:
//   the stage — Mark on a track of the plan's steps (or this turn's steps), doing the move of the tool in hand: it
//     peers for a read, scribbles for an edit, hops for a shell command, leaves the frame for the web and comes back
//     holding it, turns to Marco when a permission waits, flinches on a failure, curls up for a compaction and rests
//     when the turn ends. A helper (the Agent tool) buds off in the next colour of the ring and walks its own lane, one
//     slot per step it takes; when it reports it walks back into Mark and its lane folds away. A small one waits at the
//     edge while something runs in the background, and hops when it ends.
//   the bar line — the shell command in hand, typed out; the lines changed, rolling like a counter.
//   the map — every file of the folder as a cell, in blocks by part: a read flickers it cool, an edit turns it hot in
//     the colour of whoever made it (shimmering through the ring as it lands), the turn's end cools the map; an edit
//     to the engine or the Rust shell marks that part cold (it takes effect only after a restart).
// Everything moves on springs and steps in whole cells; colours change cell by cell (Bayer order), never by fading.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { register, unregister } from "../creature/loop";
import { Body, spring, clamp } from "../creature/Widget";
import { FAMILY, LANES, bayer, rgba, type RGB } from "../creature/ring";
import { CREATURE, FUNCTIONAL } from "../creature/palette";
import { CELLS, LET, EYES } from "../Mark";
import { CFG, useSpring } from "../motion";
import type { Item, Work } from "./useWork";

type Pose = "rest" | "think" | "speak" | "look" | "write" | "run" | "fetch" | "face" | "work";
const POSE: Record<string, Pose> = {
  Read: "look", Grep: "look", Glob: "look", LS: "look", NotebookRead: "look",
  Edit: "write", Write: "write", MultiEdit: "write", NotebookEdit: "write",
  Bash: "run", BashOutput: "run", KillShell: "run", WebSearch: "fetch", WebFetch: "fetch",
};
export const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const HELPER = new Set(["Agent", "Task"]);
// a helper is at work until it ends; one sent to the background ends when its result comes back, not when it is sent
const working = (h: Item) => !h.done || (!!h.bg && !h.bgDone);
const EMBER: RGB = FUNCTIONAL.red.strong, GREEN: RGB = FUNCTIONAL.green.strong;
// helpers take the creature's colours (design/palette.json "creature"), the ones that read on pearl paper first
const LANE_COLOURS = LANES;
const COLD = /(^|\/)(engine|src-tauri)\/|\.rs$/;   // takes effect only after a restart

// ---- what the stage shows, worked out from the items each render ----
type Step = { label: string; state: "done" | "run" | "wait" | "bad" };
type Helper = { id: string; label: string; done: boolean; pose: Pose; steps: Step[] };
type Scene = { steps: Step[]; at: number; pose: Pose; cmd: string; helpers: Helper[]; bg: number; busy: boolean };

const short = (s: unknown, n = 44) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const base = (p: unknown) => String(p ?? "").split("/").filter(Boolean).pop() ?? "";
function labelOf(it: Item): string {
  const i = it.input ?? {};
  const what = it.name === "Bash" ? i.description || i.command : i.file_path ? base(i.file_path) : i.pattern ?? i.query ?? i.url ?? i.description ?? "";
  return short(`${String(it.name).toLowerCase()} ${what}`);
}
const stepOf = (it: Item): Step => ({ label: labelOf(it), state: !it.done ? "run" : it.ok === false ? "bad" : "done" });

function sceneOf(items: Item[], busy: boolean, streaming: boolean): Scene {
  let from = 0;
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === "me") { from = i + 1; break; }
  const turn = items.slice(from);
  const tools = turn.filter((x) => x.kind === "tool" && !x.quiet);
  const top = tools.filter((x) => !x.parent);
  const plan = items.find((x) => x.kind === "plan");
  let steps: Step[], at: number;
  if (plan?.steps?.length) {
    steps = plan.steps.map((s: { content: string; status: string }) => ({ label: short(s.content), state: s.status === "completed" ? "done" : s.status === "in_progress" ? "run" : "wait" }));
    const i = steps.findIndex((s) => s.state === "run");
    at = i >= 0 ? i : Math.min(steps.length - 1, steps.filter((s) => s.state === "done").length);
  } else {
    steps = top.slice(-14).map(stepOf);
    const i = steps.findIndex((s) => s.state === "run");
    at = i >= 0 ? i : steps.length - 1;
  }
  const ask = busy && items.some((x) => x.kind === "perm" && x.state === "ask");
  const doing = [...top].reverse().find((x) => !x.done && !HELPER.has(x.name));
  const pose: Pose = ask ? "face" : doing ? POSE[doing.name] ?? "work" : !busy ? "rest" : streaming ? "speak" : "think";
  const bash = [...top].reverse().find((x) => x.name === "Bash");
  // the helpers of this turn, and any from earlier turns still at work in the background
  const turnIds = new Set(top.map((x) => x.id));
  const all = items.filter((x) => x.kind === "tool" && !x.quiet);
  const helpers = all.filter((x) => !x.parent && HELPER.has(x.name) && (turnIds.has(x.id) || working(x))).map((h) => {
    const kids = all.filter((x) => x.parent === h.id);
    const now = [...kids].reverse().find((x) => !x.done);
    return { id: h.id, label: short(h.input?.description ?? h.input?.subagent_type ?? "a helper", 36), done: !working(h), pose: (now ? POSE[now.name] ?? "work" : working(h) ? "think" : "rest") as Pose, steps: kids.slice(-16).map(stepOf) };
  });
  const bg = items.filter((x) => x.kind === "tool" && x.bg && !x.bgDone && !HELPER.has(x.name)).length;   // a helper has its own lane
  return { steps, at: Math.max(0, at), pose, cmd: bash && (busy || !bash.done) ? String(bash.input?.command ?? "") : "", helpers, bg, busy };
}

// ---- an actor: a creature on the stage, its own springs ----
type S = { v: number; vel: number };
type Actor = {
  id: string; tint: RGB | null; cell: number;
  x: S; y: S; body: Body; shake: S; settle: S; lx: S; ly: S; eye: S;
  blink: number; nextBlink: number; beat: number; flash: number; hold: number; curl: number;
  lane: number; leaving: number; gone?: boolean; away?: boolean; placed?: boolean;
};
const sp = (v = 0): S => ({ v, vel: 0 });
function actor(id: string, tint: RGB | null, cell: number): Actor {
  return { id, tint, cell, x: sp(), y: sp(), body: new Body(), shake: sp(), settle: sp(), lx: sp(), ly: sp(), eye: sp(1),
    blink: 0, nextBlink: 1 + Math.random() * 3, beat: 0, flash: 0, hold: 0, curl: 0, lane: 0, leaving: 0 };
}

// a helper's cells: the creature in one ring colour, its light cells lighter, its dark ones darker
const lum = (c: RGB) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const AVG = CELLS.reduce((n, c) => n + lum(LET[c.ch === "#" || c.ch === "w" ? "b" : c.ch]), 0) / CELLS.length;
function tinted(t: RGB, orig: RGB): RGB {
  const k = clamp((lum(orig) - AVG) * 1.4, -0.5, 0.5);
  return k > 0 ? [t[0] + (255 - t[0]) * k, t[1] + (255 - t[1]) * k, t[2] + (255 - t[2]) * k] : [t[0] * (1 + k), t[1] * (1 + k), t[2] * (1 + k)];
}

function drawCreature(x: CanvasRenderingContext2D, a: Actor, feet: number, now: number) {
  const c = a.cell, sq = clamp(a.body.sq.v, -0.4, 0.6);
  const cw = c * (1 + sq * 0.12), ch = c * (1 - sq * 0.15);
  const lift = Math.round(a.body.y + a.y.v) + Math.round(a.settle.v);
  const ox = Math.round(a.x.v - 7 * cw + Math.round(a.shake.v) * c), oy = Math.round(feet - 14 * ch + lift * c);
  const fl = now < a.flash ? 1 - (a.flash - now) / 500 : 1;   // a failure: ember, leaving cell by cell
  for (const cell of CELLS) {
    const orig = LET[cell.ch === "#" || cell.ch === "w" ? "b" : cell.ch];
    const col = fl < 1 && bayer(cell.i, cell.j) > fl ? EMBER : a.tint ? tinted(a.tint, orig) : orig;
    x.fillStyle = rgba(col);
    x.fillRect(ox + Math.round(cell.i * cw), oy + Math.round(cell.j * ch), Math.ceil(cw), Math.ceil(ch));
  }
  const open = a.blink > 0 ? 0 : clamp(a.eye.v, 0, 1);
  if (open > 0.15) {
    const eh = Math.max(1, Math.round(ch * open)), dx = Math.round(a.lx.v * cw * 0.5), dy = Math.round(a.ly.v * ch * 0.4) + Math.round(ch - eh);
    for (const [i, col] of EYES) { x.fillStyle = col; x.fillRect(ox + Math.round(i * cw) + dx, oy + Math.round(6 * ch) + dy, Math.ceil(cw), eh); }
  }
  return { ox, oy, w: 14 * cw, h: 14 * ch };
}

// the pose, every frame: where the eyes go, how open, what the body does
function live(a: Actor, pose: Pose, dt: number, t: number) {
  let eye = 1, lx = 0, ly = 0;
  switch (pose) {
    case "rest": eye = 0.35; ly = 0.4; break;
    case "think": eye = 0.45; lx = -0.6; ly = -0.7; break;
    case "speak": eye = 1; if (!a.body.air && t - a.beat > 0.55) { a.beat = t; a.body.sq.vel -= 3 + Math.random() * 3; } break;
    case "look": eye = 0.6; ly = 0.6; lx = Math.sin(t * 2.2) * 0.9; break;                   // peers along the lines
    case "write": eye = 0.8; ly = 0.8; lx = Math.sin(t * 9) * 0.3; if (t - a.beat > 0.28) { a.beat = t; a.body.sq.vel += 4; } break; // scribbles
    case "run": eye = 1; if (!a.body.air && t - a.beat > 0.36) { a.beat = t; a.body.jump(0.6); } break;            // trots
    case "face": eye = 1; break;                                                               // turns to Marco, still
    case "fetch": eye = 1; lx = 1; break;
    default: eye = 0.9; lx = Math.sin(t * 0.8) * 0.4; break;
  }
  if (t < a.curl) { eye = 0; a.settle.v += (2 - a.settle.v) * Math.min(1, dt * 8); }   // curled up: a compaction
  else spring(a.settle, pose === "rest" ? 0.5 : 0, dt, 120, 0.9);
  spring(a.eye, eye, dt, 300, 0.8); spring(a.lx, lx, dt, 160, 0.6); spring(a.ly, ly, dt, 160, 0.6);
  spring(a.shake, 0, dt, 700, 0.18);
  a.body.step(dt);
  if (pose !== "face") {
    a.nextBlink -= dt;
    if (a.nextBlink <= 0) { a.blink = 0.12; a.nextBlink = 2 + Math.random() * 4; }
  }
  if (a.blink > 0) a.blink -= dt;
}

// the track: a line of steps, done cells filled, the one in hand spinning in the work colour, failed ones ember
type Ink = { line: string; dim: string; ink: string; paper: string };
function drawTrack(x: CanvasRenderingContext2D, steps: Step[], x0: number, x1: number, y: number, s: number, col: Ink, spin: number, held: boolean) {
  const n = steps.length, gap = n > 1 ? (x1 - x0) / (n - 1) : 0, xs: number[] = [];
  x.fillStyle = col.line;
  if (n > 1) x.fillRect(x0, y, x1 - x0, 1);
  steps.forEach((st, i) => {
    const cx = Math.round(n > 1 ? x0 + i * gap : (x0 + x1) / 2), top = Math.round(y - s / 2);
    xs.push(cx);
    if (st.state === "done") { x.fillStyle = rgba(GREEN); x.fillRect(cx - s / 2, top, s, s); return; }
    if (st.state === "bad") { x.fillStyle = rgba(EMBER); x.fillRect(cx - s / 2, top, s, s); return; }
    x.strokeStyle = st.state === "run" ? rgba(CREATURE.amber) : col.dim; x.lineWidth = 1;
    x.fillStyle = col.paper; x.fillRect(cx - s / 2, top, s, s);
    x.strokeRect(cx - s / 2 + 0.5, top + 0.5, s - 1, s - 1);
    if (st.state === "run") {   // one quarter lit, going round (it holds still while a permission waits)
      const q = held ? 0 : Math.floor(spin * 6) % 4, h = Math.floor(s / 2) - 1;
      x.fillStyle = rgba(CREATURE.amber);
      x.fillRect(cx - s / 2 + 1 + (q === 1 || q === 2 ? h : 0), top + 1 + (q >= 2 ? h : 0), h, h);
    }
  });
  return xs;
}

// ---- the map: files as cells in blocks ----
type Region = { name: string; files: string[]; x: number; y: number; cols: number; rows: number };
type Layout = { regions: Region[]; cell: number; height: number; at: Map<string, { r: Region; i: number }> };
function regionsOf(files: string[]): { name: string; files: string[] }[] {
  // split by the first folder; while one part holds most of the files, split that part one level deeper
  let depth = 1;
  const key = (f: string, d: number) => { const p = f.split("/"); return p.length > d ? p.slice(0, d).join("/") : p.length > 1 ? p.slice(0, -1).join("/") : "·"; };
  for (; depth < 4; depth++) {
    const m = new Map<string, number>();
    for (const f of files) m.set(key(f, depth), (m.get(key(f, depth)) ?? 0) + 1);
    const most = Math.max(...m.values());
    if (m.size >= 3 && most < files.length * 0.6) break;
  }
  const m = new Map<string, string[]>();
  for (const f of files) { const k = key(f, depth); m.set(k, [...(m.get(k) ?? []), f]); }
  const all = [...m].map(([name, fs]) => ({ name, files: fs.sort() })).sort((a, b) => b.files.length - a.files.length);
  if (all.length <= 9) return all;
  const rest = all.slice(8).flatMap((r) => r.files);
  return [...all.slice(0, 8), { name: "the rest", files: rest }];
}
const nameOf = (r: { name: string }) => r.name.split("/").slice(-2).join("/");
const CHAR = 6.4;   // the label font's width per letter, near enough to keep names apart
function layout(parts: { name: string; files: string[] }[], width: number): Layout {
  const LABEL = 18, GAP = 22;
  for (let cell = 18; cell >= 3; cell--) {
    const regions: Region[] = [];
    let x = 0, y = 0, rowH = 0;
    for (const p of parts) {
      const n = p.files.length, cols = Math.max(4, Math.min(Math.floor((width + 1) / (cell + 1)), Math.ceil(Math.sqrt(n * 2.2))));
      const rows = Math.ceil(n / cols), w = Math.max(cols * (cell + 1), Math.ceil((nameOf(p).length + 7) * CHAR)), h = LABEL + rows * (cell + 1);
      if (x > 0 && x + w > width) { x = 0; y += rowH + GAP; rowH = 0; }
      regions.push({ ...p, x, y: y + LABEL, cols, rows });
      x += w + GAP; rowH = Math.max(rowH, h);
    }
    const height = y + rowH;
    if (height <= 360 || cell === 3) {
      const at = new Map<string, { r: Region; i: number }>();
      for (const r of regions) r.files.forEach((f, i) => at.set(f, { r, i }));
      return { regions, cell, height, at };
    }
  }
  return { regions: [], cell: 3, height: 0, at: new Map() };
}
type Heat = { colour: RGB; at: number; read?: number; cool?: number };

// ---- a number that rolls like a counter: each digit a column sliding on a spring ----
function Digit({ d }: { d: number }) {
  const col = useRef<HTMLSpanElement>(null);
  const s = useSpring(d, CFG.snap, (v) => { if (col.current) col.current.style.transform = `translateY(${-v * 1.2}em)`; });
  useLayoutEffect(() => { if (col.current) col.current.style.transform = `translateY(${-s.v * 1.2}em)`; }, [s]);
  useEffect(() => { if (s.target !== d) s.to(d); }, [d, s]);
  return <span className="rd"><span ref={col}>{"0123456789".split("").map((n) => <i key={n}>{n}</i>)}</span></span>;
}
export function Roll({ n }: { n: number }) {
  const ds = String(Math.max(0, Math.round(n))).split("").map(Number);
  return <span className="roll" aria-label={String(n)}>{ds.map((d, i) => <Digit key={ds.length - i} d={d} />)}</span>;
}

// the shell command in hand, typed out at a reading pace
function useTyped(text: string) {
  const [n, setN] = useState(text.length);
  const was = useRef(text);
  useEffect(() => {
    if (text === was.current) return;
    was.current = text; setN(0);
    if (!text) return;
    const t = window.setInterval(() => setN((k) => { if (k >= text.length) { window.clearInterval(t); return k; } return k + 2; }), 16);
    return () => window.clearInterval(t);
  }, [text]);
  return text.slice(0, n);
}

export function ShowPane({ items, busy, streaming, w, cwd, stat }: {
  items: Item[]; busy: boolean; streaming: boolean; w: Work; cwd?: string; stat: { add: number; del: number } | null;
}) {
  const sid = w.live;
  const scene = useMemo(() => sceneOf(items, busy, streaming), [items, busy, streaming]);
  const sc = useRef(scene);
  sc.current = scene;

  // the map's files, asked when the folder changes
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => { setFiles([]); }, [cwd]);
  const writes = items.reduce((n, i) => n + (i.kind === "tool" && i.done && (i.name === "Write" || i.name === "Bash") ? 1 : 0), 0);
  const asked = useRef(0);
  useEffect(() => {   // asked again when a file may have come or gone (a Write, a shell command) and when a turn ends
    if (!cwd || (busy && asked.current && !writes)) return;
    const n = ++asked.current;
    void w.ask<{ files?: string[] }>("work.tree", { cwd }, 15_000).then((r) => {
      if (n !== asked.current) return;
      const fs = r.files ?? [], keep = new Set(fs);
      for (const f of st.current.heat.keys()) if (!keep.has(f)) st.current.heat.delete(f);
      setFiles(fs);
    });
  }, [cwd, writes, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const parts = useMemo(() => regionsOf(files), [files]);
  const [mapW, setMapW] = useState(0);
  const lay = useMemo(() => layout(parts, mapW), [parts, mapW]);
  const layRef = useRef(lay);
  layRef.current = lay;

  // the actors and the map's heat live outside React, read by the canvases every frame
  const st = useRef({ main: actor("main", null, 4), helpers: new Map<string, Actor>(), small: actor("bg", null, 2), heat: new Map<string, Heat>(), cold: new Set<string>(), t: 0, colours: 0 });
  const seen = useRef<Map<string, string> | null>(null);
  const wasBusy = useRef(busy);
  const inside = (p: unknown) => { const s = String(p ?? ""); return !s.startsWith("/") ? !s.startsWith("..") : !!cwd && s.startsWith(cwd + "/"); };
  const rel = (p: unknown) => { const s = String(p ?? ""); return cwd && s.startsWith(cwd + "/") ? s.slice(cwd.length + 1) : s.replace(/^\.\//, ""); };

  // a new folder or session: a clean map and a fresh cast (before the events below read the new items)
  useEffect(() => { const S = st.current; S.heat.clear(); S.cold.clear(); S.helpers.clear(); S.main.away = false; seen.current = null; wasBusy.current = busy; }, [cwd, sid]); // eslint-disable-line react-hooks/exhaustive-deps

  // the events: what changed since the last render becomes a move (only news: opening a session replays nothing)
  useEffect(() => {
    const S = st.current, now = performance.now(), t = S.t;
    const first = seen.current === null;
    const was = seen.current ?? new Map<string, string>();
    const next = new Map<string, string>();
    for (const it of items) {
      if (it.kind !== "tool" && it.kind !== "compact") continue;
      const key = it.kind === "compact" ? "c" : `${it.done ? 1 : 0}${it.ok === false ? "x" : ""}${it.bgDone ? "b" : ""}`;
      next.set(it.id, key);
      if (first && it.kind === "tool" && HELPER.has(it.name) && !it.parent && working(it)) {   // already out when the pane opened
        const a = actor(it.id, LANE_COLOURS[S.colours++ % LANE_COLOURS.length], 3);
        a.x.v = S.main.x.v; a.lane = 1; S.helpers.set(it.id, a);
      }
      if (first || was.get(it.id) === key) continue;
      const before = was.get(it.id);
      if (it.kind === "compact") { S.main.curl = t + 1.3; continue; }
      const who = (it.parent && S.helpers.get(String(it.parent))) || S.main;
      const fresh = before === undefined;
      if (fresh && HELPER.has(it.name) && !it.parent) {   // a helper buds off Mark
        const a = actor(it.id, LANE_COLOURS[S.colours++ % LANE_COLOURS.length], 3);
        a.x.v = S.main.x.v; a.lane = 0; a.body.jump(1.2); S.main.body.sq.vel += 8;
        S.helpers.set(it.id, a);
      }
      if (HELPER.has(it.name) && !working(it) && !it.parent) { const h = S.helpers.get(it.id); if (h && !h.leaving) h.leaving = t; }
      const i = it.input ?? {};
      const path = i.file_path ?? i.notebook_path;
      if (fresh && POSE[it.name] === "look") {   // a read: the file (or the folder searched) flickers cool
        const r = rel(path ?? i.path ?? "");
        let n = 0;
        for (const f of layRef.current.at.keys()) {
          if (r && (f === r || (!path && f.startsWith(r.replace(/\/$/, "") + "/")))) {
            const h = S.heat.get(f); S.heat.set(f, { ...(h ?? { colour: [0, 0, 0], at: -1 }), read: now });
            if (++n > 80) break;
          }
        }
      }
      if (it.done && !before?.startsWith("1") && EDITS.has(it.name) && it.ok !== false && path && inside(path)) {   // an edit lands: hot
        const r = rel(path);
        S.heat.set(r, { colour: who.tint ?? EMBER, at: now });
        if (COLD.test(r)) { const at = layRef.current.at.get(r); if (at) S.cold.add(at.r.name); }
        who.body.sq.vel += 6;
      }
      if (it.done && it.ok === false && !before?.includes("x")) { who.shake.vel = 46; who.flash = now + 500; who.body.sq.vel += 10; }
      if (it.bgDone && !before?.includes("b") && !HELPER.has(it.name)) S.small.body.jump(1.4);
      if (fresh && it.name && (it.name === "WebSearch" || it.name === "WebFetch")) who.away = true;
      if (it.done && !before?.startsWith("1") && (it.name === "WebSearch" || it.name === "WebFetch")) { who.away = false; who.hold = t + 1.6; }
    }
    seen.current = next;
    if (wasBusy.current && !busy) {   // the turn ends: everyone gathers, the map cools
      S.main.body.jump(0.6); S.main.blink = 0.12;
      const still = new Set(items.filter((x) => x.kind === "tool" && HELPER.has(x.name) && working(x)).map((x) => x.id));   // a helper in the background works on
      for (const [id, h] of S.helpers) if (!h.leaving && !still.has(id)) h.leaving = t;
      for (const h of S.heat.values()) h.cool ??= now;
    }
    if (!wasBusy.current && busy) for (const h of S.heat.values()) h.cool = undefined;   // a new turn warms what is still hot
    wasBusy.current = busy;
  }, [items, busy]); // eslint-disable-line react-hooks/exhaustive-deps


  const stage = useRef<HTMLCanvasElement>(null);
  const map = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cs = getComputedStyle(box.current ?? document.documentElement);
    const col: Ink = { line: cs.getPropertyValue("--line").trim() || "#cfcfca", dim: cs.getPropertyValue("--mute").trim() || "#8f8f8b",
      ink: cs.getPropertyValue("--dim").trim() || "#5e5e5b", paper: cs.getPropertyValue("--page").trim() || "#ebebe8" };
    const S = st.current;
    const sc0 = stage.current, mc = map.current;
    if (!sc0 || !mc) return;
    const ro = new ResizeObserver(() => setMapW(Math.floor(mc.getBoundingClientRect().width)));
    ro.observe(mc);

    register(sc0, (x, W, _h, dt) => {
      const z = sc.current, t = (S.t += dt), held = z.pose === "face";
      x.imageSmoothingEnabled = false;
      const x0 = 48, x1 = Math.max(x0 + 1, W - 48), TRACK = 104;
      const xs = drawTrack(x, z.steps, x0, x1, TRACK, 10, col, t, held);
      // Mark: on the step in hand (off the frame while it fetches), walking in whole-cell steps
      const m = S.main;
      const target = m.away ? W + 80 : xs[z.at] ?? W / 2;
      if (!m.placed) { m.x.v = target; m.placed = true; }
      if (!held) spring(m.x, target, dt, 40, 0.85);
      if (Math.abs(m.x.vel) > 25) m.y.v = -(Math.floor(t * 9) % 2); else m.y.v = 0;
      live(m, z.pose, dt, t);
      const me = drawCreature(x, m, TRACK - 8, performance.now());
      // thinking: a ring of cells turning slowly round it; speaking: the ring breathes
      if ((z.pose === "think" || z.pose === "speak") && !m.away) {
        const n = 10, cx = me.ox + me.w / 2, cy = me.oy + me.h / 2, b = z.pose === "speak" ? 1 + Math.max(0, Math.sin(t * 6.8) * 0.5 + Math.sin(t * 11.3) * 0.3) * 0.25 : 1;
        for (let k = 0; k < n; k++) {
          const a = t * (z.pose === "think" ? 0.6 : 1.4) + (k / n) * Math.PI * 2;
          x.fillStyle = rgba(FAMILY[(k + Math.floor(t * 2)) % FAMILY.length], 0.9);
          x.fillRect(Math.round(cx + Math.cos(a) * 46 * b) - 2, Math.round(cy + Math.sin(a) * 18 * b) - 2, 4, 4);
        }
      }
      if (t < m.hold) { x.fillStyle = rgba(CREATURE.sun); x.fillRect(Math.round(me.ox + me.w + 2), Math.round(me.oy + me.h * 0.55), 8, 8); }   // back with the result
      // the step in hand, in words, under the track
      const cur = z.steps[z.at];
      if (cur) {
        x.font = "12px -apple-system, BlinkMacSystemFont, sans-serif"; x.fillStyle = col.ink; x.textBaseline = "top";
        const tw = x.measureText(cur.label).width, lx = clamp((xs[z.at] ?? W / 2) - tw / 2, 12, W - tw - 12);
        x.fillText(cur.label, lx, TRACK + 14);
      } else {
        x.font = "12px -apple-system, BlinkMacSystemFont, sans-serif"; x.fillStyle = col.dim; x.textBaseline = "top";
        const s = z.busy ? "starting…" : "nothing running; the next turn plays here"; x.fillText(s, (W - x.measureText(s).width) / 2, TRACK + 14);
      }
      // the lanes: one per helper, its steps a small track of its own
      let lane = 0;
      for (const [id, h] of S.helpers) {
        const hz = z.helpers.find((q) => q.id === id);
        const back = h.leaving > 0;
        const ly = TRACK + 62 + lane * 54;
        h.lane += ((back ? 0 : 1) - h.lane) * Math.min(1, dt * (back ? 5 : 6));
        const yy = TRACK + (ly - TRACK) * h.lane;
        const hs = hz?.steps ?? [];
        if (h.lane > 0.6) {
          const hx = drawTrack(x, hs.length ? hs : [{ label: "", state: "run" }], x0 + 140, x1, yy, 6, col, t, held);
          x.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace"; x.fillStyle = rgba(h.tint!); x.textBaseline = "middle";
          x.fillText(short(hz?.label ?? "", 20), 12, yy);
          const i = hs.findIndex((q) => q.state === "run");
          const tx = back ? m.x.v : hx[i >= 0 ? i : hx.length - 1] ?? x0 + 140;
          spring(h.x, tx, dt, 50, 0.85);
        } else if (back) spring(h.x, m.x.v, dt, 60, 0.9);
        if (Math.abs(h.x.vel) > 25) h.y.v = -(Math.floor(t * 10) % 2); else h.y.v = 0;
        live(h, back ? "rest" : hz?.pose ?? "think", dt, t);
        drawCreature(x, h, yy - 5, performance.now());
        if (back && h.lane < 0.08 && Math.abs(h.x.v - m.x.v) < 6) { h.gone = true; m.body.sq.vel -= 6; }
        lane++;
      }
      for (const [id, h] of S.helpers) if (h.gone) S.helpers.delete(id);
      // the small one at the edge: there while something runs behind, a slow pulse; it hops when one ends
      const bgA = S.small;
      if (z.bg > 0 || bgA.body.air) {
        bgA.x.v = W - 22;
        if (t - bgA.beat > 1.6) { bgA.beat = t; bgA.body.sq.vel += 5; }
        live(bgA, "work", dt, t);
        drawCreature(x, bgA, 34, performance.now());
      }
    });

    register(mc, (x) => {
      const L = layRef.current, now = performance.now(), c = L.cell;
      x.font = "10.5px ui-monospace, SFMono-Regular, Menlo, monospace"; x.textBaseline = "alphabetic";
      for (const r of L.regions) {
        const cold = S.cold.has(r.name);
        x.fillStyle = cold ? col.ink : col.dim;
        x.fillText(`${nameOf(r)}${cold ? " · cold" : ""}`, r.x, r.y - 6);
        if (cold) {   // the cold outline: a dotted frame of cells round the part
          x.fillStyle = col.ink;
          const w = r.cols * (c + 1) + 3, h = r.rows * (c + 1) + 3;
          for (let k = 0; k < w; k += 3) { x.fillRect(r.x - 3 + k, r.y - 2, 1, 1); x.fillRect(r.x - 3 + k, r.y + h - 1, 1, 1); }
          for (let k = 0; k < h; k += 3) { x.fillRect(r.x - 3, r.y - 2 + k, 1, 1); x.fillRect(r.x - 3 + w, r.y - 2 + k, 1, 1); }
        }
        r.files.forEach((f, i) => {
          const cx = r.x + (i % r.cols) * (c + 1), cy = r.y + Math.floor(i / r.cols) * (c + 1);
          const h = S.heat.get(f);
          let fill = col.line;
          if (h?.read && now - h.read >= 1300) { h.read = undefined; if (h.at < 0) S.heat.delete(f); }
          if (h) {
            if (h.at > 0) {
              const age = now - h.at;
              const coolK = h.cool ? (now - h.cool) / 2600 : 0;
              if (age < 1400) fill = rgba(FAMILY[(Math.floor(age / 70) + i) % FAMILY.length]);   // the edit lands: a shimmer through the creature's ten
              else if (!(coolK > 0 && bayer(i & 3, (i >> 2) & 3) < coolK)) fill = rgba(h.colour);
              if (coolK >= 1 && !h.read) S.heat.delete(f);
            }
            if (h.read && Math.floor((now - h.read) / 130) % 2 === 0) fill = rgba(GREEN);   // a read: three cool flickers
          }
          x.fillStyle = fill;
          x.fillRect(cx, cy, c, c);
        });
      }
      if (S.cold.size) {   // what cold means, once, under the map
        x.fillStyle = col.dim;
        x.fillText("cold: these changes take effect only after a restart", 0, L.height + 26);
      }
    });
    return () => { unregister(sc0); unregister(mc); ro.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the stage grows a lane per helper at work, on a spring
  const lanes = scene.helpers.filter((h) => !h.done).length;
  const tall = 160 + lanes * 54;
  const grow = useSpring(tall, CFG.fold, (v) => { if (stage.current) stage.current.style.height = `${Math.round(v)}px`; });
  useEffect(() => { if (grow.target !== tall) grow.to(tall); }, [tall, grow]);
  const typed = useTyped(scene.cmd);
  return (
    <div className="wshow" ref={box}>
      <canvas ref={stage} className="wshowstage" style={{ height: grow.v }} />
      <div className="wshowbar">
        <span className="cmd">{typed ? <><b>$</b> {typed}</> : <span className="dim">no command running</span>}</span>
        {stat && (stat.add > 0 || stat.del > 0) && <span className="wshowstat"><b>+<Roll n={stat.add} /></b> −<Roll n={stat.del} /></span>}
      </div>
      <canvas ref={map} className="wshowmap" style={{ height: Math.max(80, lay.height + 34) }} />
    </div>
  );
}
