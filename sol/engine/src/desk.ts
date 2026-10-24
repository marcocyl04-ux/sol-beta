// The desk: a study space beside the chat (sol/PROTOCOL.md, round 8). State per conversation, like the
// browser's tabs: a list of cards the seat writes as data and the face draws. Marco's moves on a card
// (an answer, a flashcard marked, a timer started) come back here as acts, change the card, and are
// remembered as one short paragraph that rides on his next say. Both seats get the desk tools on the
// MCP server "sol": Claude in-process, Codex through src/mcp-stdio.ts (POST /tool on the engine).

import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, stat, realpath } from "node:fs/promises";
import { join, extname, basename, dirname, sep } from "node:path";
import type { ToolResult, TurnCtx, Face } from "./browser.js";

const run = promisify(execFile);
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

export type Q = { prompt: string; choices?: string[]; answer?: string; explain?: string };
export type Card = { id: string; kind: Kind; title?: string; at: number; [k: string]: any };
const KINDS = ["note", "flashcards", "question", "exam", "page", "board", "timer"] as const;
type Kind = (typeof KINDS)[number];

let home = "";
export function setDeskHome(dir: string) {
  home = dir;
}

const desks = new Map<string, Card[]>(); // sessionId ("" = none) -> cards
const pins = new Map<string, string>(); // sessionId -> pinned card id
let pinnedSession: string | undefined; // the conversation whose pin the notch shows
const faces = new Set<Face>();
const key = (s?: string) => s ?? "";

export function getDesk(sessionId?: string): Card[] {
  return desks.get(key(sessionId)) ?? [];
}
export function deskMsg(sessionId?: string) {
  return { type: "desk", sessionId: sessionId ?? "", cards: getDesk(sessionId) };
}
export function pinMsg() {
  const id = pinnedSession === undefined ? undefined : pins.get(pinnedSession);
  const card = id ? getDesk(pinnedSession).find((c) => c.id === id) : undefined;
  return { type: "pin", card: card ?? null };
}
export function addFace(f: Face) {
  faces.add(f);
  for (const k of desks.keys()) f.send(deskMsg(k));
  f.send(pinMsg());
}
export function removeFace(f: Face) {
  faces.delete(f);
}
function changed(sessionId?: string) {
  const m = deskMsg(sessionId);
  for (const f of faces) f.send(m);
  const p = pinMsg();
  for (const f of faces) f.send(p);
}

// A new conversation opens its desk under the face's draft id; once the seat names it, it is the session's.
export function adoptDesk(from: string | undefined, to: string) {
  if (!from || from === to || !desks.has(from)) return;
  desks.set(to, [...(desks.get(to) ?? []), ...desks.get(from)!]);
  desks.delete(from);
  const pin = pins.get(from);
  if (pin) { pins.set(to, pin); pins.delete(from); if (pinnedSession === from) pinnedSession = to; }
  const lines = notes.get(from);
  if (lines) { notes.set(to, lines); notes.delete(from); }
  const m = { type: "desk", sessionId: from, cards: [] };
  for (const f of faces) f.send(m);
  changed(to);
}

// ---- what Marco did, for the next say ----

type Seen = {
  title: string;
  flash: Map<string, "got" | "again">;
  answers: { q: string; given: string; result?: string }[];
  misc: string[];
};
const notes = new Map<string, Map<string, Seen>>(); // sessionId -> card id -> what happened
function seen(sid: string, c: Card): Seen {
  let m = notes.get(sid);
  if (!m) notes.set(sid, (m = new Map()));
  let s = m.get(c.id);
  if (!s) m.set(c.id, (s = { title: c.title || c.kind, flash: new Map(), answers: [], misc: [] }));
  return s;
}
const short = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.round(sec % 60))).padStart(2, "0")}`;

// One paragraph, one clause per card, and the log is emptied. "" when nothing happened.
export function takeDeskLines(sessionId?: string): string {
  const m = notes.get(key(sessionId));
  notes.delete(key(sessionId));
  if (!m || !m.size) return "";
  const out: string[] = [];
  for (const s of m.values()) {
    const parts: string[] = [];
    if (s.flash.size) {
      const got = [...s.flash].filter(([, v]) => v === "got").length;
      const again = [...s.flash].filter(([, v]) => v === "again").map(([k]) => short(k, 30));
      parts.push(`${got} got, ${again.length} again` + (again.length ? ` (again: ${again.join(", ")})` : ""));
    }
    for (const a of s.answers) parts.push(`${a.q} answered '${short(a.given, 60)}'` + (a.result ? ` (${a.result})` : ""));
    parts.push(...s.misc);
    if (!parts.length) continue;
    // answers to a single question read as the bare clause; flashcards and the rest carry the card's title
    out.push(s.flash.size ? `${s.title}: ${parts.join("; ")}` : parts.join("; "));
  }
  return out.length ? "On the desk: " + out.join("; ") + "." : "";
}

// ---- pages: a PDF page or an image, rendered by the engine ----

const PDFTOPPM = ["/opt/homebrew/bin/pdftoppm", "pdftoppm"];
const PYTHON = "/opt/anaconda3/bin/python3";
const fileUrl = (rel: string) => `/file?path=${encodeURIComponent(rel)}`;

async function inHome(path: string): Promise<{ real: string; rel: string }> {
  const root = await realpath(home);
  const real = await realpath(path.startsWith("/") ? path : join(root, path)).catch(() => {
    throw new Error(`No such file: ${path}`);
  });
  if (!real.startsWith(root + sep)) throw new Error("The desk only shows files inside home/.");
  return { real, rel: real.slice(root.length + 1) };
}

async function firstWorking<T>(tries: (() => Promise<T>)[]): Promise<T> {
  let last: unknown;
  for (const t of tries) {
    try { return await t(); } catch (e) { last = e; }
  }
  throw last;
}

async function pdfPages(pdf: string): Promise<number | undefined> {
  try {
    const info = await firstWorking(["/opt/homebrew/bin/pdfinfo", "pdfinfo"].map((b) => () => run(b, [pdf])));
    const n = /^Pages:\s+(\d+)/m.exec(info.stdout);
    if (n) return Number(n[1]);
  } catch { /* try PyMuPDF */ }
  try {
    const r = await run(PYTHON, ["-c", "import sys,fitz;print(len(fitz.open(sys.argv[1])))", pdf]);
    const n = Number(r.stdout.trim());
    if (n > 0) return n;
  } catch { /* unknown */ }
  return undefined;
}

// Returns the card fields for one page; the PNG is cached in home/desk/pages/.
export async function renderPage(path: string, page = 1): Promise<{ path: string; page: number; pages: number; image: string }> {
  const { real, rel } = await inHome(path);
  const ext = extname(real).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return { path: rel, page: 1, pages: 1, image: fileUrl(rel) };
  if (ext !== ".pdf") throw new Error(`This is a ${ext || "file with no extension"}; the desk does not render it yet.`);
  const pages = (await pdfPages(real)) ?? page;
  const n = Math.max(1, Math.min(Math.round(page) || 1, pages));
  const dir = join(await realpath(home), "desk", "pages");
  await mkdir(dir, { recursive: true });
  const base = basename(real, extname(real)).replace(/[^\w.\-]+/g, "_");
  const out = join(dir, `${base}-${n}.png`);
  const fresh = await Promise.all([stat(out), stat(real)]).then(([a, b]) => a.mtimeMs >= b.mtimeMs, () => false);
  if (!fresh) {
    await firstWorking([
      ...PDFTOPPM.map((b) => () => run(b, ["-f", String(n), "-l", String(n), "-png", "-r", "110", "-singlefile", real, out.slice(0, -4)])),
      () => run(PYTHON, ["-c", "import sys,fitz;d=fitz.open(sys.argv[1]);d[int(sys.argv[2])-1].get_pixmap(dpi=110).save(sys.argv[3])", real, String(n), out]),
    ]).catch(() => { throw new Error("Could not render the page: pdftoppm (Homebrew poppler) or PyMuPDF is needed."); });
  }
  return { path: rel, page: n, pages, image: fileUrl(`desk/pages/${base}-${n}.png`) };
}

// ---- saved cards: home/desk/<name>.json ----

function shelfName(name: string): string {
  const n = String(name).toLowerCase().replace(/[^a-z0-9/_-]+/g, "-").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  if (!n || n.split("/").some((p) => p === "" || p === "." || p === "..")) throw new Error(`Bad shelf name: ${name}`);
  return n;
}
const shelfFile = (name: string) => join(home, "desk", shelfName(name) + ".json");

async function shelf(): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name === "pages" && !prefix) continue;
      if (e.isDirectory()) await walk(join(dir, e.name), prefix + e.name + "/");
      else if (e.name.endsWith(".json")) out.push(prefix + e.name.slice(0, -5));
    }
  };
  await walk(join(home, "desk"), "");
  return out.sort();
}

// ---- cards ----

const shortId = () => randomUUID().slice(0, 8);

function put(sessionId: string | undefined, card: Card) {
  const list = desks.get(key(sessionId)) ?? [];
  const i = list.findIndex((c) => c.id === card.id);
  if (i >= 0) list[i] = card; // a replaced card keeps its place
  else list.push(card);
  desks.set(key(sessionId), list);
  changed(sessionId);
}
function drop(sessionId: string | undefined, ids?: string[]) {
  const list = getDesk(sessionId);
  const keep = ids ? list.filter((c) => !ids.includes(c.id)) : [];
  desks.set(key(sessionId), keep);
  if (pins.has(key(sessionId)) && !keep.some((c) => c.id === pins.get(key(sessionId)))) pins.delete(key(sessionId));
  changed(sessionId);
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? undefined : String(v));
const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);
const qOf = (q: any): Q => ({
  prompt: String(q?.prompt ?? ""),
  ...(strs(q?.choices)?.length ? { choices: strs(q.choices) } : {}),
  ...(q?.answer != null ? { answer: String(q.answer) } : {}),
  ...(q?.explain != null ? { explain: String(q.explain) } : {}),
});

// Build a card from what the seat gave; throws a plain sentence when something the kind needs is missing.
function build(a: any, id: string): Card {
  const kind = a.kind as Kind;
  const base = { id, kind, ...(a.title ? { title: String(a.title) } : {}), at: Date.now() };
  switch (kind) {
    case "note":
      if (!a.text) throw new Error("A note needs text.");
      return { ...base, text: String(a.text) };
    case "flashcards": {
      const cards = (a.cards ?? []).filter((c: any) => c && c.front != null).map((c: any) => ({ front: String(c.front), back: String(c.back ?? "") }));
      if (!cards.length) throw new Error("Flashcards need cards: [{front, back}].");
      // PROTOCOL: on flashcards `at` is the card shown, so it starts at 0 (the others keep it as the time made)
      return { ...base, cards, at: 0 };
    }
    case "question": {
      if (!a.prompt) throw new Error("A question needs a prompt.");
      return { ...base, ...qOf(a) };
    }
    case "exam": {
      const questions = (a.questions ?? []).map(qOf).filter((q: Q) => q.prompt);
      if (!questions.length) throw new Error("An exam needs questions: [{prompt, choices?, answer?, explain?}].");
      return { ...base, ...(a.minutes ? { minutes: Number(a.minutes) } : {}), questions, given: [], results: [], ...(a.running ? { startedAt: Date.now() } : {}) };
    }
    case "timer": {
      const seconds = a.seconds != null ? Number(a.seconds) : a.minutes != null ? Number(a.minutes) * 60 : NaN;
      if (!(seconds > 0)) throw new Error("A timer needs seconds (or minutes).");
      const secs = Math.round(seconds);
      return { ...base, seconds: secs, ...(a.running ? { startedAt: Date.now(), left: secs } : {}) };
    }
    case "board":
      return { ...base };
    default:
      throw new Error(`Unknown kind: ${a.kind}. Use one of ${KINDS.join(", ")}.`);
  }
}

// ---- the tools ----

export type DeskTool = {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  line: (a: any) => string; // the dim line for the face
  run: (a: any, turn: TurnCtx) => Promise<ToolResult>;
};

const qShape = z.object({
  prompt: z.string().describe("The question."),
  choices: z.array(z.string()).optional().describe("Multiple choice options. Leave out for a free-text question."),
  answer: z.string().optional().describe("The right answer. For multiple choice, exactly one of the choices (the desk marks it right or wrong). Shown when Marco reveals."),
  explain: z.string().optional().describe("Why that is the answer. Shown with the answer."),
});

export const DESK_TOOLS: DeskTool[] = [
  {
    name: "desk_show",
    description:
      "Put a card on the desk, Marco's study space beside the chat, or replace the card with the same id. " +
      "Make the cards yourself from what he is studying. Set `kind` and what it needs: " +
      "note needs `text` (markdown) and a `title`; " +
      "flashcards needs `cards` [{front, back}] and a `title`; " +
      "question needs `prompt`, optionally `choices`, `answer`, `explain`; " +
      "exam needs `questions` [{prompt, choices?, answer?, explain?}] and optionally `minutes` for a clock; " +
      "page needs `path` (a file under home/, e.g. school/la245/material/packet.pdf) and optionally `page`; " +
      "board needs nothing (a canvas Marco draws on); " +
      "timer needs `seconds` or `minutes`; `running: true` starts it (or an exam's clock) at once, otherwise Marco presses start. " +
      "Give an `id` of your choosing (e.g. \"contracts-set\") to replace that card later; without one a fresh id is made. " +
      "`keep: \"la245/contracts\"` also saves the card for later; `load: \"la245/contracts\"` shows a saved one instead (kind not needed). " +
      "Example: {\"kind\":\"flashcards\",\"id\":\"contracts-set\",\"title\":\"Contracts\",\"cards\":[{\"front\":\"What is consideration?\",\"back\":\"Something of value bargained for.\"}],\"keep\":\"la245/contracts\"}",
    shape: {
      kind: z.enum(KINDS).optional().describe("What sort of card: note, flashcards, question, exam, page, board or timer. Needed unless you use `load`."),
      id: z.string().optional().describe("Your name for the card, e.g. \"contracts-set\". The same id again replaces that card in place. Left out, one is made."),
      title: z.string().optional().describe("A short heading shown on the card, e.g. \"Contracts\"."),
      text: z.string().optional().describe("note: the body, in markdown."),
      cards: z.array(z.object({ front: z.string().describe("The prompt side."), back: z.string().describe("The answer side.") })).optional()
        .describe("flashcards: the set, [{front, back}]."),
      prompt: z.string().optional().describe("question: the question itself."),
      choices: z.array(z.string()).optional().describe("question: options for multiple choice. Leave out for free text."),
      answer: z.string().optional().describe("question: the right answer; for multiple choice, exactly one of the choices."),
      explain: z.string().optional().describe("question: why that is the answer."),
      questions: z.array(qShape).optional().describe("exam: the questions, each {prompt, choices?, answer?, explain?}."),
      minutes: z.number().optional().describe("exam: the length of the clock in minutes. timer: the length, if you do not give seconds."),
      seconds: z.number().optional().describe("timer: the length in seconds."),
      running: z.boolean().optional().describe("timer or exam: start the clock now instead of waiting for Marco to press start."),
      path: z.string().optional().describe("page: the file, relative to home/ (a PDF or an image). Not .pptx."),
      page: z.number().optional().describe("page: which page of a PDF, from 1. Default 1."),
      keep: z.string().optional().describe("Also save this card under that name for later, e.g. \"la245/contracts\"."),
      load: z.string().optional().describe("Show the card saved under that name instead of building one."),
      // --- Share (#36)
      shared: z.boolean().optional().describe("Also share the card with the team: it is committed to the team's repository on your person's branch `<login>/shared` (sol/design/shared/<id>.json, only the card, never what Marco did on it) and pushed, signed as their agent. Only when Marco asks to share it. Not for a page card."),
      // --- end Share
    },
    line: (a) => {
      if (a.load) return `bringing back ${short(String(a.load), 40)}`;
      const t = a.title ? `: ${short(String(a.title), 40)}` : "";
      switch (a.kind) {
        case "note": return "putting a note on the desk" + t;
        case "flashcards": return `showing ${Array.isArray(a.cards) ? a.cards.length + " " : ""}flashcards${t}`;
        case "question": return "putting a question on the desk" + t;
        case "exam": return `setting an exam${Array.isArray(a.questions) ? " of " + a.questions.length : ""}${t}`;
        case "page": return `showing ${a.path ? short(basename(String(a.path)), 40) : "a page"}${a.page ? ", page " + a.page : ""}`;
        case "board": return "putting the board on the desk";
        case "timer": return a.running ? "starting a timer" : "setting a timer";
        default: return "putting a card on the desk";
      }
    },
    run: async (a, turn) => {
      let card: Card;
      let note = "";
      if (a.load) {
        const saved = JSON.parse(await readFile(shelfFile(a.load), "utf8").catch(() => { throw new Error(`Nothing saved as "${a.load}". desk_shelf lists what there is.`); }));
        card = { ...saved, id: a.id ? String(a.id) : saved.id ?? shortId(), at: Date.now() };
        delete card.startedAt; delete card.left; delete card.doneAt;
        if (card.kind === "flashcards") card.at = 0; // a saved card comes back fresh
        if (card.kind === "exam") { card.given = []; card.results = []; delete card.startedAt; delete card.doneAt; }
        if (card.kind === "question") { delete card.given; delete card.result; delete card.open; }
        if (card.kind === "flashcards") card.cards = (card.cards ?? []).map((c: any) => ({ front: c.front, back: c.back }));
      } else {
        if (!a.kind) throw new Error(`Say which kind of card: ${KINDS.join(", ")}.`);
        const id = a.id ? String(a.id) : shortId();
        if (a.kind === "page") {
          if (!a.path) throw new Error("A page card needs `path`.");
          if (/\.pptx?$/i.test(String(a.path))) return text("This is a .pptx; the desk does not render slides yet. Read it and make note cards instead.");
          card = { id, kind: "page", ...(a.title ? { title: String(a.title) } : { title: basename(String(a.path)) }), at: Date.now(), ...(await renderPage(String(a.path), Number(a.page) || 1)) };
        } else card = build(a, id);
      }
      put(turn.sessionId, card);
      if (a.keep) {
        const f = shelfFile(a.keep);
        await mkdir(dirname(f), { recursive: true });
        await writeFile(f, JSON.stringify(card, null, 2));
        note += ` Saved as "${shelfName(a.keep)}".`;
      }
      // --- Share (#36)
      if (a.shared) {
        const { shareCard } = await import("./team/share.js");
        const r = await shareCard(card);
        note += "error" in r ? ` Not shared: ${r.error}` : ` Shared with the team on ${r.branch} (${r.path})${r.pushed ? "" : `; ${r.note ?? "not pushed"}`}.`;
      }
      // --- end Share
      return text(`Shown ${card.kind} "${card.title ?? ""}" as ${card.id}.${note}`);
    },
  },
  {
    name: "desk_read",
    description: "Read the desk as it stands: every card, and what Marco did on them (answers given, flashcards got or missed, the timer, the exam clock). What he did also arrives with his next message, so you rarely need this.",
    shape: {},
    line: () => "reading the desk",
    run: async (_a, turn) => {
      const list = getDesk(turn.sessionId);
      if (!list.length) return text("The desk is empty.");
      const lines = list.map((c) => {
        const bits: string[] = [`${c.id} (${c.kind}${c.title ? ` "${c.title}"` : ""})`];
        if (c.kind === "note") bits.push(short(c.text, 200));
        if (c.kind === "flashcards") {
          const got = c.cards.filter((x: any) => x.state === "got").length;
          const again = c.cards.filter((x: any) => x.state === "again").map((x: any) => short(x.front, 30));
          bits.push(`${c.cards.length} cards, ${got} got, ${again.length} again${again.length ? ` (${again.join(", ")})` : ""}`);
        }
        if (c.kind === "question") bits.push(`${short(c.prompt, 100)}` + (c.given != null ? ` | given: ${c.given}${c.result ? ` (${c.result})` : ""}` : " | not answered") + (c.open ? " | answer shown" : ""));
        if (c.kind === "exam") {
          bits.push(`${c.questions.length} questions, answered ${c.given.filter((g: any) => g != null).length}` +
            (c.minutes ? `, ${c.minutes} min` : "") + (c.doneAt ? ", submitted" : c.startedAt ? ", running" : ", not started"));
          c.questions.forEach((q: Q, i: number) => c.given[i] != null && bits.push(`  Q${i + 1} given: ${c.given[i]}${c.results[i] ? ` (${c.results[i]})` : ""}`));
        }
        if (c.kind === "page") bits.push(`${c.path}, page ${c.page} of ${c.pages}`);
        if (c.kind === "timer") bits.push(`${mmss(c.seconds)} timer, ` + (c.startedAt ? `running, ${mmss(remaining(c))} left` : `paused, ${mmss(c.left ?? c.seconds)} left`));
        return bits[0] + ": " + bits.slice(1).join(" | ");
      });
      const pin = pins.get(key(turn.sessionId));
      return text(lines.join("\n") + (pin ? `\nPinned to the notch: ${pin}` : ""));
    },
  },
  {
    name: "desk_clear",
    description: "Take cards off the desk: the ones named in `ids`, or all of them when `ids` is left out.",
    shape: { ids: z.array(z.string()).optional().describe("Card ids to remove. Leave out to clear the whole desk.") },
    line: (a) => (Array.isArray(a.ids) && a.ids.length ? `taking ${a.ids.length} card${a.ids.length > 1 ? "s" : ""} off the desk` : "clearing the desk"),
    run: async (a, turn) => {
      const n = getDesk(turn.sessionId).length;
      drop(turn.sessionId, Array.isArray(a.ids) && a.ids.length ? a.ids.map(String) : undefined);
      return text(`Cleared. ${n - getDesk(turn.sessionId).length} card(s) removed, ${getDesk(turn.sessionId).length} left.`);
    },
  },
  {
    name: "desk_shelf",
    description: "List the cards saved with `keep`, by name (for desk_show's `load`).",
    shape: {},
    line: () => "looking at the shelf",
    run: async () => {
      const l = await shelf();
      return text(l.length ? l.join("\n") : "The shelf is empty.");
    },
  },
  {
    name: "desk_pin",
    description: "Pin a card (a timer, a flashcard set, a score) to the notch so Marco sees it while he works elsewhere. Pass `id: null` (or leave it out) to unpin.",
    shape: { id: z.string().nullable().optional().describe("The card's id, or null to unpin.") },
    line: (a) => {
      if (!a.id) return "unpinning the notch";
      const c = [...desks.values()].flat().find((x) => x.id === a.id);
      return `pinning the ${c?.kind ?? "card"}`;
    },
    run: async (a, turn) => {
      const id = a.id ? String(a.id) : null;
      if (id && !getDesk(turn.sessionId).some((c) => c.id === id)) throw new Error(`No card "${id}" on the desk.`);
      pinCard(turn.sessionId, id);
      return text(id ? `Pinned ${id} to the notch.` : "Unpinned.");
    },
  },
];

export function pinCard(sessionId: string | undefined, id: string | null) {
  if (id) { pins.set(key(sessionId), id); pinnedSession = key(sessionId); }
  else { pins.delete(key(sessionId)); if (pinnedSession === key(sessionId)) pinnedSession = undefined; }
  const m = pinMsg();
  for (const f of faces) f.send(m);
}

// Run one desk tool by name for one conversation. Tells the face what is happening, never throws.
export async function runDeskTool(name: string, args: unknown, turn: TurnCtx = {}): Promise<ToolResult> {
  const tool = DESK_TOOLS.find((t) => t.name === name);
  if (!tool) return { ...text(`Unknown desk tool: ${name}`), isError: true };
  const a = (args ?? {}) as any;
  const id = randomUUID();
  const line = tool.line(a);
  turn.sink?.({ id, kind: "desk", text: line, done: false });
  let r: ToolResult;
  try {
    r = await tool.run(a, turn);
  } catch (err) {
    r = { ...text(`Desk error: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`), isError: true };
  }
  const first = r.content.find((c) => c.type === "text") as { text: string } | undefined;
  turn.sink?.({ id, kind: "desk", text: line, done: true, ok: !r.isError, detail: r.isError ? first?.text : undefined });
  return r;
}

// ---- acts: what Marco does on a card ----

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
function grade(q: Q, given: string): "right" | "wrong" | undefined {
  if (q.answer == null || !q.choices?.length) return undefined;
  return norm(given) === norm(q.answer) ? "right" : "wrong";
}
const remaining = (c: Card) => (c.startedAt ? Math.max(0, (c.left ?? c.seconds) - (Date.now() - c.startedAt) / 1000) : c.left ?? c.seconds);

export async function actDesk(sessionId: string | undefined, id: string, act: string, extra: any = {}): Promise<void> {
  const sid = key(sessionId);
  const list = getDesk(sessionId);
  const c = list.find((x) => x.id === id);
  if (!c) return;
  const s = () => seen(sid, c);
  switch (act) {
    case "close": {
      s().misc.push(`closed ${c.title || c.kind}`);
      drop(sessionId, [id]);
      return;
    }
    case "turn":
      if (c.kind === "flashcards") c.at = Number(extra.at) || 0; // the card shown
      break;
    case "mark":
      if (c.kind === "flashcards") {
        const i = Number(extra.at);
        const card = c.cards[i];
        if (card && (extra.state === "got" || extra.state === "again")) {
          card.state = extra.state;
          s().flash.set(card.front, extra.state);
        }
      }
      break;
    case "answer": {
      const given = String(extra.given ?? "").trim();
      if (c.kind === "question") {
        c.given = given;
        const r = grade(c as unknown as Q, given);
        if (r) c.result = r; else delete c.result;
        s().answers.push({ q: c.title ?? short(c.prompt, 30), given, result: r });
      } else if (c.kind === "exam") {
        const i = Number(extra.at);
        const q: Q | undefined = c.questions[i];
        if (!q) return;
        c.given[i] = given;
        const r = grade(q, given);
        c.results[i] = r ?? null;
        const mine = s();
        mine.answers = mine.answers.filter((x) => x.q !== `Q${i + 1}`);
        mine.answers.push({ q: `Q${i + 1}`, given, result: r });
      }
      break;
    }
    case "reveal":
      if (c.kind === "question" || c.kind === "exam") c.open = true;
      break;
    case "start":
      if (c.kind === "exam") { c.startedAt = Date.now(); s().misc.push("exam started"); }
      else if (c.kind === "timer") { c.startedAt = Date.now(); c.left ??= c.seconds; s().misc.length = 0; s().misc.push(`timer running, ${mmss(c.left)} to go`); }
      break;
    case "submit":
      if (c.kind === "exam") { c.doneAt = Date.now(); s().misc.push("exam submitted"); }
      break;
    case "pause":
      if (c.kind === "timer" && c.startedAt) {
        c.left = remaining(c);
        delete c.startedAt;
        s().misc.length = 0;
        s().misc.push(`timer paused, ${mmss(c.left)} left`);
      }
      break;
    case "reset":
      if (c.kind === "timer") { delete c.startedAt; delete c.left; s().misc.length = 0; s().misc.push("timer reset"); }
      break;
    case "page":
      if (c.kind === "page") {
        const r = await renderPage(c.path, Number(extra.page) || 1);
        Object.assign(c, r);
        s().misc.length = 0;
        s().misc.push(`now on page ${r.page} of ${r.pages}`);
      }
      break;
    default:
      return;
  }
  changed(sessionId);
}
