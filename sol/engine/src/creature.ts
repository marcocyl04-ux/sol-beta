// The creature's state (Companion #5, step 1). The engine alone derives it and sends it to every face; faces draw what
// they are told. The eight names are the wire's (sol/PROTOCOL.md "creature"); mac/src/creature/states.ts has the same.
//
// Precedence, highest first (design/companion/PRD.md):
//   unplugged  (never sent by an engine that is up: the face draws it when the socket is down or the app says starting/failed)
//   listening / speaking   a live call (pins presence to Here) or dictation; speaking while voice or text goes out
//   yourcall   perm items in state ask across Work sessions (AskUserQuestion is one of them); counted as `asks`
//   working    any running turn, run, review or run cell (busy.ts)
//   here / elsewhere / away   from the main window's presence { focused, idleSeconds }
// Transients done / wrong go out as creature.flash and never change the state. At a turn's end that did something,
// creature.receipt { lines } goes to the face that ran it (step 4, the RECEIPT scene).
//
// Notch buttons (#6, step 0): two more messages beside creature.state, to every face on change and on connect.
//   creature.ask  { id, sessionId, seat, tool, title, path?, n, of } | null   the oldest open perm ask across Work runs
//   creature.turn { seat, sessionId, title, kind: life | work | call } | null the busy conversation with the latest
//                 activity (a turn starting, a delta, a tool step, a call, a ping): the one the notch follows and stops

import { basename } from "node:path";
import { busyList, onBusy, type Job } from "./busy.js";
import { allRuns } from "./work/runs.js";
import { backHere } from "./ping.js";
import { getTitles } from "./titles.js";

export const CREATURE_STATES = ["here", "elsewhere", "away", "working", "yourcall", "listening", "speaking", "unplugged"] as const;
export type CreatureState = (typeof CREATURE_STATES)[number];
export type Role = "window" | "notch" | "phone";
export type Presence = "here" | "elsewhere" | "away";

export const AWAY_S = 600;      // N: no key or mouse for this long is Away (design data, PRD)
const SPEAK_MS = 700;           // voice or text out keeps Speaking this long after the last piece
const WORK_KINDS = new Set(["life", "work", "review", "run"]);

type Key = object;              // one connected socket
type Out = { send: (m: object) => void };
const faces = new Map<Key, { out: Out; role?: Role }>();
let presence: { key: Key; focused: boolean; idleSeconds: number | null } | null = null;
const calls = new Set<Key>();
const dictating = new Set<Key>();
let spokeAt = 0;
let state: CreatureState = "here";
let asks = 0;
let lastPresence: Presence = "elsewhere";

const everyone = (m: object) => { for (const f of faces.values()) f.out.send(m); };
const stateMsg = () => ({ type: "creature.state", state, asks });

export function addCreatureFace(key: Key, out: Out) {
  faces.set(key, { out });
  out.send({ type: "engine", phase: "up" });
  out.send(stateMsg());
  out.send({ type: "creature.ask", ask: lastAsk });
  out.send({ type: "creature.turn", turn: lastTurn });
}
export function removeCreatureFace(key: Key) {
  faces.delete(key); calls.delete(key); tally.delete(key); dictating.delete(key); lifeOn.delete(key);
  if (presence?.key === key) presence = null;
  update();
}
export function setRole(key: Key, role: Role) { const f = faces.get(key); if (f) f.role = role; }
export const roleOf = (key: Key) => faces.get(key)?.role;

export function setPresence(key: Key, focused: boolean, idleSeconds: number | null) {
  presence = { key, focused, idleSeconds: typeof idleSeconds === "number" && isFinite(idleSeconds) ? idleSeconds : null };
  update();
}
export function setDictation(key: Key, on: boolean) { on ? dictating.add(key) : dictating.delete(key); update(); }

/** what the engine sent a socket: calls, voice out, text out, turn ends */
export function sent(key: Key, m: any) {
  const life = lifeOn.get(key);
  if (m.type === "call" && m.state === "live") { calls.add(key); touch(String(m.sessionId ?? `call:${callIds.get(key) ?? newCall(key)}`), String(m.seat ?? acts.get(String(m.sessionId))?.seat ?? "codex"), "call", key); update(); }
  else if (m.type === "call" && (m.state === "ended" || m.ok === false)) { calls.delete(key); callIds.delete(key); update(); }
  else if (m.type === "call.audio" || m.type === "delta") { spokeAt = Date.now(); if (life) touch(life.sessionId, life.seat, "life", key); update(); }
  else if (m.type === "done") { lifeOn.delete(key); receipt(key, m); if (!m.stopped) flash(m.ok === false ? "wrong" : "done"); }
  else if (m.type === "tool" && m.done && m.ok === false) flash("wrong");
  else if ((m.type === "work.delta" || m.type === "work.item") && typeof m.sessionId === "string") touch(m.sessionId, "claude", "work");
  if (m.type === "tool" && life) touch(life.sessionId, life.seat, "life", key);
  if (m.type === "work.run" || m.type === "work.item") update();   // an ask opened or was answered: creature.ask at once
  if (m.type === "tool" && m.done && m.ok !== false && DID.has(m.kind)) {
    const t = tally.get(key) ?? new Map<string, { kind: string; text: string }>();
    t.set(String(m.id ?? t.size), { kind: m.kind, text: String(m.text ?? "") }); tally.set(key, t);
  }
}

// The receipt (Companion step 4): at a turn's end, if the turn did something for Marco (wrote or edited a file, ran a
// command, made a desk card; never a plain chat reply), the face that ran it gets creature.receipt { lines }: one or two
// lines, what was done, by count. No minutes saved: the engine cannot estimate that honestly from steps alone.
const DID = new Set(["write", "command", "desk"]);
const tally = new Map<Key, Map<string, { kind: string; text: string }>>();
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : one + "s"}`;
export function receiptLines(steps: { kind: string; text: string }[]): string[] {
  const files: string[] = []; let fileN = 0, cmds = 0, cards = 0;
  for (const s of steps) {
    if (s.kind === "write") {
      const m = /^\w+ (.+?)(?: \(\+(\d+)\))?$/.exec(s.text);
      fileN += 1 + Number(m?.[2] ?? 0);
      const name = (m?.[1] ?? "").split("/").pop();
      if (name && !files.includes(name)) files.push(name);
    } else if (s.kind === "command") cmds++;
    else cards++;
  }
  const did = [fileN && `edited ${plural(fileN, "file")}`, cmds && `ran ${plural(cmds, "command")}`, cards && `made ${plural(cards, "card")}`].filter(Boolean) as string[];
  if (!did.length) return [];
  const second = files.length ? files.slice(0, 2).join(", ") + (files.length > 2 ? ` +${files.length - 2}` : "") : "";
  return second ? [did.join(" · "), second] : [did.join(" · ")];
}
function receipt(key: Key, m: any) {
  const t = tally.get(key); tally.delete(key);
  if (!t || !t.size || m.ok === false) return;
  const lines = receiptLines([...t.values()]);
  if (lines.length) faces.get(key)?.out.send({ type: "creature.receipt", lines });
}
export function flash(kind: "done" | "wrong") { everyone({ type: "creature.flash", kind }); }

/** Here / Elsewhere / Away. A live call pins Here. No idle source: never Away. No main window: Elsewhere. */
export function presenceNow(): Presence {
  if (calls.size) return "here";
  if (!presence) return "elsewhere";
  if (presence.idleSeconds !== null && presence.idleSeconds >= AWAY_S) return "away";
  return presence.focused ? "here" : "elsewhere";
}
/** where a ping goes now: the call's surface during a call, else from presence */
export function placeNow(): Role {
  const c = [...calls][0];
  if (c) return faces.get(c)?.role ?? "window";
  const p = presenceNow();
  return p === "here" ? "window" : p === "away" ? "phone" : "notch";
}

export const countAsks = () => allRuns().reduce((n, r) => n + r.perms.size, 0);

export function derive(): CreatureState {
  const talking = Date.now() - spokeAt < SPEAK_MS;
  if (calls.size) return talking ? "speaking" : "listening";
  if (dictating.size) return "listening";
  if (talking) return "speaking";
  if (asks > 0) return "yourcall";
  if (busyList().some((j) => WORK_KINDS.has(j.kind))) return "working";
  return presenceNow();
}

export function update() {
  asks = countAsks();
  const p = presenceNow();
  if (p !== lastPresence) { const was = lastPresence; lastPresence = p; if (p === "here" && was !== "here") backHere(); }
  const s = derive();
  if (s !== state || asks !== lastAsks) { state = s; lastAsks = asks; everyone(stateMsg()); }
  const a = pickAsk(allRuns()), t = currentTurn();
  if (JSON.stringify(a) !== JSON.stringify(lastAsk)) { lastAsk = a; everyone({ type: "creature.ask", ask: a }); }
  if (JSON.stringify(t) !== JSON.stringify(lastTurn)) { lastTurn = t; everyone({ type: "creature.turn", turn: t }); }
  const told = `${state}|${JSON.stringify(lastTurn)}`;
  if (told !== lastTold) { lastTold = told; for (const fn of watchers) fn(state, lastTurn, lastTurn?.kind === "work" ? allRuns().find((r) => r.id === lastTurn!.sessionId)?.cwd : undefined); }
}
let lastAsks = 0;
// Together (See, #31): the team relay's presence follows the creature. Called on a state or turn change; a Work
// turn carries its folder (the relay says only its repo's name). The one export Together adds to this file.
type Watcher = (state: CreatureState, turn: TurnMsg | null, cwd?: string) => void;
const watchers = new Set<Watcher>();
let lastTold = "";
export function onCreature(fn: Watcher) { watchers.add(fn); fn(state, lastTurn); return () => { watchers.delete(fn); }; }

// ---- creature.ask (Notch buttons #6): the oldest open ask, counted ----
export type AskMsg = { id: string; sessionId: string; seat: string; tool: string; title: string; path?: string; n: number; of: number };
type AskRun = { id: string; perms: Map<string, unknown>; items: { get(id: string): any } };
const askedAt = new Map<string, number>();   // perm id -> the order it was first seen in (asks across runs, oldest first)
let askSeq = 0;
let lastAsk: AskMsg | null = null;
const file = (p: unknown) => (typeof p === "string" && p ? basename(p) : "");
/** the window's words for an ask (work/Cards.tsx PermCard: it.title, else "Claude wants to <toolAsk>"); no command, no diff */
export function askTitle(it: any): string {
  if (it?.title) return String(it.title);
  const tool = String(it?.tool ?? ""), i = (it?.input ?? {}) as Record<string, any>;
  switch (tool) {
    case "AskUserQuestion": return "Claude has a question for you";
    case "ExitPlanMode": return "Claude has a plan for you";
    case "Bash": return `Claude wants to ${i.description ? `run: ${String(i.description)}` : "run a command"}`;
    case "Edit": case "MultiEdit": return `Claude wants to edit ${file(i.file_path)}`;
    case "Write": return `Claude wants to write ${file(i.file_path)}`;
    case "NotebookEdit": return `Claude wants to edit ${file(i.notebook_path)}`;
    case "WebFetch": { let h = ""; try { h = new URL(String(i.url)).host; } catch { /* not a url */ } return `Claude wants to open ${h || "a page"}`; }
    case "WebSearch": return `Claude wants to search: ${String(i.query ?? "")}`;
    default: return `Claude wants to use ${tool.replace(/^mcp__.+?__/, "")}`;
  }
}
/** the oldest open ask across the runs, with its place: n of `of` (1 of 3) */
export function pickAsk(runs: AskRun[]): AskMsg | null {
  const open: { run: AskRun; id: string; at: number }[] = [];
  const live = new Set<string>();
  for (const r of runs) for (const id of r.perms.keys()) {
    live.add(id);
    if (!askedAt.has(id)) askedAt.set(id, ++askSeq);
    open.push({ run: r, id, at: askedAt.get(id)! });
  }
  for (const id of askedAt.keys()) if (!live.has(id)) askedAt.delete(id);
  if (!open.length) return null;
  open.sort((a, b) => a.at - b.at);
  const { run, id } = open[0];
  const it = run.items.get(id) ?? {};
  const path = it.path ?? it.input?.file_path ?? it.input?.notebook_path;
  return { id, sessionId: run.id, seat: "claude", tool: String(it.tool ?? ""), title: askTitle(it), ...(typeof path === "string" && path ? { path } : {}), n: 1, of: open.length };
}

// ---- creature.turn (Notch buttons #6): the conversation the notch follows ----
// A last-activity time per session: a turn starting (busy.ts join), a delta, a tool step, a call, a ping. The turn is
// the busy session with the latest activity; null when none is busy. A call is busy while its socket's call is live.
export type TurnKind = "life" | "work" | "call";
export type TurnMsg = { seat: string; sessionId: string; title: string; kind: TurnKind };
type Act = { seat: string; sessionId: string; kind: TurnKind; at: number; key?: Key };
const acts = new Map<string, Act>();
const lifeOn = new Map<Key, { sessionId: string; seat: string }>();   // the Life turn a socket runs (its deltas and steps)
const callIds = new Map<Key, number>();
let callSeq = 0, lastStamp = 0;
let lastTurn: TurnMsg | null = null;
const newCall = (key: Key) => { const n = ++callSeq; callIds.set(key, n); return n; };
const stamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));   // strictly increasing: the newest always wins a tie
/** something happened in a conversation */
export function touch(sessionId: string, seat: string, kind: TurnKind, key?: Key) {
  if (!sessionId) return;
  const a = acts.get(sessionId);
  // a call holds its kind while it is live (the seat's turns during it are the call's)
  const k = a?.kind === "call" && a.key && calls.has(a.key) ? "call" : kind;
  acts.set(sessionId, { seat: a && k === a.kind ? a.seat : seat, sessionId, kind: k, at: stamp(), key: k === "call" ? (a?.kind === "call" ? a.key : key) : key ?? a?.key });
}
/** a Life turn started on this socket: its deltas and steps count for that session */
export function lifeTurn(key: Key, sessionId: string | undefined, seat: string) {
  if (!sessionId) return;
  lifeOn.set(key, { sessionId, seat });
  touch(sessionId, seat, "life", key);
  update();
}
/** a ping (ping.ts) is activity in its conversation */
export function pinged(seat: string, sessionId?: string) {
  if (!sessionId) return;
  touch(sessionId, seat, acts.get(sessionId)?.kind ?? (seat === "work" ? "work" : "life"));
  update();
}
const busyAct = (a: Act, jobs: Job[]) => a.kind === "call" ? !!a.key && calls.has(a.key) : jobs.some((j) => j.kind === a.kind && j.id === a.sessionId);
const titleOf = (a: Act) => getTitles()[a.sessionId] ?? (a.kind === "work" ? basename(allRuns().find((r) => r.id === a.sessionId)?.cwd ?? "") : "");
export function currentTurn(): TurnMsg | null {
  const jobs = busyList();
  let best: Act | null = null;
  for (const a of acts.values()) {
    if (busyAct(a, jobs)) { if (!best || a.at > best.at) best = a; }
    else if (Date.now() - a.at > 10 * 60_000) acts.delete(a.sessionId);   // long quiet and not busy: forgotten
  }
  return best ? { seat: best.seat, sessionId: best.sessionId, title: titleOf(best), kind: best.kind } : null;
}
// every new Life or Work job is a turn starting: activity at its start
const started = new WeakSet<Job>();
function joined(jobs: Job[]) {
  for (const j of jobs) {
    if (started.has(j)) continue;
    started.add(j);
    if (j.kind === "life") touch(j.id, j.note ?? "codex", "life");
    else if (j.kind === "work") touch(j.id, "claude", "work");
  }
}

onBusy((jobs) => { joined(jobs); update(); });
setInterval(update, 250).unref();   // Speaking decays, a run's perms change between messages
