// Sol pings Marco (2026-10-16, "ping me using the notch when you're done"). One tool on the MCP server "sol", both seats:
// ping { line, sessionId? }, one line in Sol's words. One ping, one place (design/companion/PRD.md): each ping gets a
// destination when it is made, from the presence the engine holds (creature.ts): Here -> the window, Elsewhere -> the
// notch, Away -> the phone (the notch keeps a quiet mark, a count, no text). It is sent only there:
//   { type: "notify", id, seat, sessionId, line, at, dest }   to the faces of its destination (and to one that says hello)
//   { type: "notify.clear", id }                              seen there, expired, or moved
//   { type: "notify.mark", count }                            to the notch: phone-bound pings not yet seen
//   { type: "notify.dot", id, seat, sessionId, line, at }     to the window when Marco is back: the sidebar's dot only
// Seen (notify.seen { id }) counts only from the ping's destination. The phone acks a push (notify.ack { id }) within
// 20 s or the ping moves to the notch. 12 unseen at most (the oldest expires); one per (seat, line) within 30 s.
// No other sender: a page cannot make a ping, only see one.

import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { ToolResult, TurnCtx, Face } from "./browser.js";
import { placeNow, pinged, type Role } from "./creature.js";

export type Ping = { id: string; seat: string; sessionId?: string; line: string; at: number; dest: Role };
const CAP = 12, ACK_MS = 20_000, SAME_MS = 30_000;
const unseen: Ping[] = [];
const faces = new Map<Face, Role | undefined>();
const acks = new Map<string, NodeJS.Timeout>();
const notify = (p: Ping) => ({ type: "notify", ...p });
const to = (dest: Role, m: object) => { for (const [f, r] of faces) if (r === dest) f.send(m); };
const mark = () => to("notch", { type: "notify.mark", count: unseen.filter((p) => p.dest === "phone").length });

export function addPingFace(f: Face) { faces.set(f, undefined); }   // nothing until it says which face it is
export function pingFaceIs(f: Face, role: Role) {
  faces.set(f, role);
  for (const p of unseen) if (p.dest === role) f.send(notify(p));   // only its own unseen ones
  if (role === "notch") f.send({ type: "notify.mark", count: unseen.filter((p) => p.dest === "phone").length });
}
export function removePingFace(f: Face) { faces.delete(f); }

function drop(p: Ping) {
  unseen.splice(unseen.indexOf(p), 1);
  clearTimeout(acks.get(p.id)); acks.delete(p.id);
  to(p.dest, { type: "notify.clear", id: p.id });
  if (p.dest === "phone") mark();
}
/** seen: only from the face the ping was sent to */
export function seenPing(id: string, from?: Face): boolean {
  const p = unseen.find((x) => x.id === id);
  if (!p || (from && faces.get(from) !== p.dest)) return false;
  drop(p);
  return true;
}
/** the phone has it: no fallback */
export function ackPing(id: string, from?: Face) {
  const p = unseen.find((x) => x.id === id);
  if (p && p.dest === "phone" && (!from || faces.get(from) === "phone")) { clearTimeout(acks.get(id)); acks.delete(id); }
}
function deliver(p: Ping) {
  to(p.dest, notify(p));
  if (p.dest !== "phone") return;
  mark();
  acks.set(p.id, setTimeout(() => {   // no ack from the phone: it waits on the notch
    acks.delete(p.id);
    if (!unseen.includes(p)) return;
    to("phone", { type: "notify.clear", id: p.id });
    p.dest = "notch";
    deliver(p);
    mark();
  }, ACK_MS));
}

export function ping(line: string, seat: string, sessionId?: string): Ping {
  const clean = line.replace(/\s+/g, " ").trim().slice(0, 140);
  const now = Date.now();
  const same = unseen.find((p) => p.seat === seat && p.line === clean && now - p.at < SAME_MS);
  if (same) return same;
  const p: Ping = { id: randomUUID(), seat, sessionId, line: clean, at: now, dest: placeNow() };
  unseen.push(p);
  while (unseen.length > CAP) drop(unseen[0]);
  deliver(p);
  pinged(seat, sessionId);   // a ping is activity in its conversation (creature.turn)
  return p;
}

// back in the app after Elsewhere or Away: the window's sidebar shows its dot for what arrived elsewhere
export function backHere() {
  for (const x of unseen) if (x.dest !== "window") to("window", { type: "notify.dot", id: x.id, seat: x.seat, sessionId: x.sessionId, line: x.line, at: x.at });
}

/** tests */
export const _pings = () => unseen;
export const _reset = () => { for (const t of acks.values()) clearTimeout(t); acks.clear(); unseen.length = 0; faces.clear(); };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
export const PING_TOOLS = [
  {
    name: "ping",
    description: "Ping Marco through the notch: one short line in your own words (what is done, or what needs him). Use it when he asked to be told when something is finished, or when a long task ends and he is not looking. One line, no markdown.",
    shape: {
      line: z.string().describe("One short line, what Marco should know (e.g. \"the sidebar's timer row is in\")."),
      sessionId: z.string().optional().describe("The conversation a click on the ping opens; this one if left out."),
    },
  },
];

export async function runPingTool(name: string, args: unknown, turn: TurnCtx = {}): Promise<ToolResult> {
  const a = (args ?? {}) as { line?: unknown; sessionId?: unknown };
  const line = typeof a.line === "string" ? a.line.trim() : "";
  if (name !== "ping") return { ...text(`Unknown tool: ${name}`), isError: true };
  if (!line) return { ...text("A ping needs a line."), isError: true };
  const sid = typeof a.sessionId === "string" && a.sessionId ? a.sessionId : turn.sessionId;
  const p = ping(line, turn.seat ?? "codex", sid);
  turn.sink?.({ id: p.id, kind: "desk", text: `pinging Marco: ${p.line}`, done: true, ok: true });
  return text(`Pinged. It went to the ${p.dest}; Marco sees it there until he opens it.`);
}
