// The sticky note: a to-do list in Home's top-right corner, kept the way a paper one is. One short line a thing; a
// click crosses it out; "next page" tears off the crossed-out lines and the rest carry over, to tomorrow too. It is
// mostly by hand; a seat may write on it too (the tool "sticky"), held to the same short lines. Kept on this machine
// only, in engine/sticky.json (gitignored), sent whole to every face on each change ({ type: "sticky", ... }).

import { z } from "zod";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { ToolResult, TurnCtx, Face } from "./browser.js";

const FILE = process.env.SOL_STICKY ?? join(dirname(fileURLToPath(import.meta.url)), "..", "sticky.json");   // SOL_STICKY: the tests' own
export const MAX_CHARS = 40;   // a line: a word, or one short sentence
export const MAX_LINES = 12;   // a note, not a backlog

export type Line = { id: string; text: string; done: boolean; at: number };
type Note = { lines: Line[]; page: number };   // page: when this page was started (the last tear)

let note: Note | null = null;
const faces = new Set<Face>();

function load(): Note {
  if (note) return note;
  try {
    const v = JSON.parse(readFileSync(FILE, "utf8"));
    note = { lines: Array.isArray(v?.lines) ? v.lines.filter((l: any) => typeof l?.text === "string") : [], page: Number(v?.page) || Date.now() };
  } catch { note = { lines: [], page: Date.now() }; }
  return note;
}
function save() {
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(load(), null, 2) + "\n");
  renameSync(tmp, FILE);
  const m = stickyMsg();
  for (const f of faces) f.send(m);
}

export function stickyMsg() {
  const n = load();
  return { type: "sticky", lines: n.lines, page: n.page };
}
export function addStickyFace(f: Face) { faces.add(f); f.send(stickyMsg()); }
export function removeStickyFace(f: Face) { faces.delete(f); }

// one line: no breaks, no markdown bullets, counted by characters (a Chinese character is one)
export function clean(raw: string): string | Error {
  const t = raw.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s+/i, "").replace(/\s+/g, " ").trim();
  if (!t) return new Error("an empty line");
  if (/\n/.test(raw.trim())) return new Error("one line only");
  if ([...t].length > MAX_CHARS) return new Error(`too long (${[...t].length}); keep a line under ${MAX_CHARS} characters, a word or a short sentence`);
  return t;
}

export function addLine(raw: string): Line | Error {
  const n = load();
  const t = clean(raw);
  if (t instanceof Error) return t;
  if (n.lines.length >= MAX_LINES) return new Error(`the note is full (${MAX_LINES} lines); finish or tear off some first`);
  const l = { id: randomUUID().slice(0, 8), text: t, done: false, at: Date.now() };
  n.lines.push(l);
  save();
  return l;
}
export function markLine(id: string, done: boolean): boolean {
  const l = load().lines.find((x) => x.id === id);
  if (!l) return false;
  l.done = done;
  save();
  return true;
}
export function removeLine(id: string): boolean {
  const n = load();
  const before = n.lines.length;
  n.lines = n.lines.filter((x) => x.id !== id);
  if (n.lines.length === before) return false;
  save();
  return true;
}
// next page: the crossed-out lines go, the rest carry over
export function turnPage(): number {
  const n = load();
  const gone = n.lines.filter((x) => x.done).length;
  n.lines = n.lines.filter((x) => !x.done);
  n.page = Date.now();
  save();
  return gone;
}

// the face's moves: sticky.get, sticky.add { text }, sticky.mark { id, done }, sticky.remove { id }, sticky.turn
export function actSticky(m: { type: string; text?: unknown; id?: unknown; done?: unknown }): string | null {
  if (m.type === "sticky.add") { const r = addLine(String(m.text ?? "")); return r instanceof Error ? r.message : null; }
  if (m.type === "sticky.mark") { markLine(String(m.id), m.done !== false); return null; }
  if (m.type === "sticky.remove") { removeLine(String(m.id)); return null; }
  if (m.type === "sticky.turn") { turnPage(); return null; }
  return null;
}

// ---- the seat's tool ----

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const listed = () => {
  const n = load();
  return n.lines.length ? n.lines.map((l) => `${l.done ? "[x]" : "[ ]"} ${l.id} ${l.text}`).join("\n") : "(the note is empty)";
};

export const STICKY_TOOLS = [
  {
    name: "sticky",
    description: `The user's sticky note in Home's top-right corner: their to-do list for the day, written mostly by hand. ` +
      `Only touch it when they ask. Every line is tiny: one word or one short sentence, at most ${MAX_CHARS} characters, ` +
      `no explanations, no sub-points. "add" one line (text); "done" or "undo" crosses one out or back (id); "remove" ` +
      `deletes one (id); "turn" is the next page (crossed-out lines go, the rest stay); "list" reads it.`,
    shape: {
      action: z.enum(["list", "add", "done", "undo", "remove", "turn"]),
      text: z.string().optional().describe(`For add: one tiny line, ${MAX_CHARS} characters at most.`),
      id: z.string().optional().describe("For done, undo, remove: the line's id from list."),
    },
  },
];

export async function runStickyTool(_name: string, args: unknown, turn: TurnCtx = {}): Promise<ToolResult> {
  const a = (args ?? {}) as { action?: string; text?: unknown; id?: unknown };
  const no = (t: string): ToolResult => ({ ...text(t), isError: true });
  const id = typeof a.id === "string" ? a.id : "";
  switch (a.action) {
    case "list": return text(listed());
    case "add": {
      const r = addLine(typeof a.text === "string" ? a.text : "");
      if (r instanceof Error) return no(`Not added: ${r.message}.`);
      turn.sink?.({ id: "sticky-" + r.id, kind: "desk", text: `on the sticky note: ${r.text}`, done: true, ok: true });
      return text(`Added (${r.id}).\n${listed()}`);
    }
    case "done": case "undo":
      return markLine(id, a.action === "done") ? text(listed()) : no(`No line ${id || "(no id)"}; call list for the ids.`);
    case "remove":
      return removeLine(id) ? text(listed()) : no(`No line ${id || "(no id)"}; call list for the ids.`);
    case "turn": { const gone = turnPage(); return text(`Next page: ${gone} crossed-out line(s) torn off.\n${listed()}`); }
    default: return no("action is one of list, add, done, undo, remove, turn.");
  }
}
