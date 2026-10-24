// Past conversations, read straight from where the two CLIs keep them. READ ONLY: nothing here
// ever writes under ~/.codex or ~/.claude. Claude's are a local read each time; Codex's go through one index (below),
// read once per file, because Work's sidebar lists Codex talks in every folder too (#182).
//
// Codex:  ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl      (first line is session_meta with the cwd)
// Claude: ~/.claude/projects/<home path, every non-alphanumeric -> "-">/<session>.jsonl

import { createReadStream, realpathSync } from "node:fs";
import { readdir, stat, realpath } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { getTitles } from "./titles.js";
import { twinIn } from "./home.js";
import { moved } from "./work/state.js";

export type Seat = "codex" | "claude";
export type Thread = { seat: Seat; sessionId: string; title: string; updatedAt: string };
export type Msg = { who: "me" | "you"; text: string; files?: { name: string; url: string }[] };

const CODEX_DIR = join(homedir(), ".codex", "sessions");
const CLAUDE_DIR = join(homedir(), ".claude", "projects");
const ID_OK = /^[A-Za-z0-9_-]+$/;

// Stream a file line by line (parsed as JSON; bad lines skipped). Stop early by returning true.
async function eachLine(file: string, fn: (obj: any, index: number) => boolean | void): Promise<void> {
  const stream = createReadStream(file, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let i = 0;
  try {
    for await (const line of rl) {
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        i++;
        continue;
      }
      if (fn(obj, i++) === true) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

// Text that the CLIs inject on Marco's behalf (instructions, environment blocks), not what he typed.
function injected(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("<") || /AGENTS\.md instructions|CLAUDE\.md instructions|<INSTRUCTIONS>/.test(t);
}

function titleOf(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 60 ? one.slice(0, 59).trimEnd() + "…" : one;
}

async function walk(dir: string): Promise<string[]> {
  let out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(await walk(p));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

// ---- Codex ----

// The user's text from one Codex line, in either shape: event_msg/user_message or a role "user" message.
function codexUserText(o: any): string | null {
  const p = o?.payload;
  if (!p) return null;
  if (o.type === "event_msg" && p.type === "user_message" && typeof p.message === "string") return p.message;
  if (o.type === "response_item" && p.type === "message" && p.role === "user" && Array.isArray(p.content)) {
    return p.content.filter((b: any) => b.type === "input_text").map((b: any) => b.text).join("\n");
  }
  return null;
}

// The index: every rollout's first line says where it ran (cwd) and what started it (originator: codex_sdk_ts is Sol,
// codex_cli_rs a Terminal, codex_exec a one-shot `codex exec`, codex_work_desktop the ChatGPT app). A file's first line
// and first message never change, so each file is read once and kept; a file that grew only gets its time again. The
// folder list is walked again at most every CODEX_TTL, or at once after a Sol turn (invalidateCodex).
export type CodexTalk = {
  id: string; file: string; cwd: string;   // cwd: as recorded (the other machine's home, for a talk made there)
  real: string;                            // the same folder in this home, links resolved: what is compared
  originator: string; title: string; updatedAt: number; size: number;
};
const CODEX_TTL = 8_000;
const TITLE_SCAN = 2_000;   // lines read looking for the first thing Marco said (it comes in the first few)
const entries = new Map<string, CodexTalk & { mtimeMs: number }>();
const reals = new Map<string, string>();
let index: { at: number; list: Promise<CodexTalk[]> } | null = null;
export const invalidateCodex = () => { index = null; };

async function realOf(cwd: string): Promise<string> {
  // a talk started on the other machine records that machine's home (#65)
  const t = twinIn(cwd, homedir());
  const had = reals.get(t);
  if (had) return had;
  try { const r = await realpath(t); reals.set(t, r); return r; } catch { return t; }   // a folder not here (yet) is asked again
}

async function codexEntry(file: string): Promise<(CodexTalk & { mtimeMs: number }) | null> {
  let st;
  try { st = await stat(file); } catch { return null; }
  const had = entries.get(file);
  if (had && had.mtimeMs === st.mtimeMs) return had;
  if (had && had.title) { const e = { ...had, mtimeMs: st.mtimeMs, updatedAt: st.mtimeMs, size: st.size }; entries.set(file, e); return e; }
  let meta: any = null, title = "";
  await eachLine(file, (o, i) => {
    if (i === 0) { meta = o?.payload ?? {}; return; }
    const t = codexUserText(o);
    if (t && !injected(t) && t.trim()) { title = titleOf(t); return true; }
    if (i > TITLE_SCAN) return true;
  }).catch(() => {});
  if (typeof meta?.cwd !== "string" || !meta.cwd) return null;
  const e = {
    id: typeof meta.id === "string" ? meta.id : basename(file, ".jsonl").slice(-36), file, cwd: meta.cwd, real: await realOf(meta.cwd),
    originator: String(meta.originator ?? ""), title, updatedAt: st.mtimeMs, size: st.size, mtimeMs: st.mtimeMs,
  };
  entries.set(file, e);
  return e;
}

/** every Codex rollout on this machine (and the other's, through Syncthing), read once per file */
export function codexIndex(): Promise<CodexTalk[]> {
  if (index && Date.now() - index.at < CODEX_TTL) return index.list;
  const list = (async () => {
    const files = await walk(CODEX_DIR);
    const out: CodexTalk[] = [];
    // a few at a time so we do not open thousands of files at once
    for (let i = 0; i < files.length; i += 32) for (const e of await Promise.all(files.slice(i, i + 32).map(codexEntry))) if (e) out.push(e);
    const live = new Set(files);
    for (const f of [...entries.keys()]) if (!live.has(f)) entries.delete(f);
    return out;
  })();
  index = { at: Date.now(), list };
  list.catch(() => { if (index?.list === list) index = null; });
  return list;
}

// where a talk's folder is now: a folder that moved (work.json moved, #129, #181) takes its talks along. Asked at each
// list, not kept: the map changes while the engine runs
function placer(): (t: CodexTalk) => string {
  const map = Object.entries(moved());
  if (!map.length) return (t) => t.real;
  return (t) => {
    for (const [from, to] of map) if (t.real === from || t.real.startsWith(from + "/")) {
      const p = to + t.real.slice(from.length);
      try { return realpathSync(p); } catch { return p; }
    }
    return t.real;
  };
}

async function codexThreads(home: string): Promise<Thread[]> {
  const at = placer();
  return (await codexIndex()).filter((t) => at(t) === home)
    .map((t) => ({ seat: "codex" as const, sessionId: t.id, title: t.title || "(new conversation)", updatedAt: new Date(t.updatedAt).toISOString() }));
}

// Codex talks in a project folder (#182): every talk whose folder is not Sol's home (those are Life's chats), except the
// ones that are not talks: one-shot `codex exec` runs (an agent's reviewer), Sol's own review seat (`skip`: its thread
// ids, work/review.ts), and the ChatGPT app's own project folders under ~/.codex.
export async function codexTalks(home: string, skip: Set<string> = new Set()): Promise<CodexTalk[]> {
  const real = await realpath(home).catch(() => home);
  const codexHome = join(homedir(), ".codex"), at = placer();
  return (await codexIndex()).filter((t) => at(t) !== real && t.originator !== "codex_exec" && !skip.has(t.id)
    && !(t.real === codexHome || t.real.startsWith(codexHome + "/") || t.cwd.startsWith(codexHome + "/")));
}

/** the folder a Codex thread was started in, as recorded (null when Codex has no such thread) */
export async function codexCwd(sessionId: string): Promise<string | null> {
  if (!ID_OK.test(sessionId)) return null;
  const t = (await codexIndex()).find((x) => x.id === sessionId);
  if (t) return t.cwd;
  const f = await findCodexFile(sessionId);
  return f ? (await codexEntry(f))?.cwd ?? null : null;
}

async function findCodexFile(sessionId: string): Promise<string | null> {
  if (!ID_OK.test(sessionId)) return null;
  const known = (await codexIndex()).find((t) => t.id === sessionId);
  if (known) return known.file;
  // a thread newer than the index: walk once more, fresh
  invalidateCodex();
  const files = await walk(CODEX_DIR);
  return files.find((f) => f.endsWith(`${sessionId}.jsonl`)) ?? null;
}

async function codexMsgs(file: string): Promise<Msg[]> {
  type Raw = { who: "me" | "you"; text: string; src: "event" | "role" };
  const raw: Raw[] = [];
  await eachLine(file, (o) => {
    const p = o?.payload;
    if (!p) return;
    if (o.type === "event_msg" && p.type === "user_message" && typeof p.message === "string") raw.push({ who: "me", text: p.message, src: "event" });
    else if (o.type === "event_msg" && p.type === "agent_message" && typeof p.message === "string") raw.push({ who: "you", text: p.message, src: "event" });
    else if (o.type === "response_item" && p.type === "message" && (p.role === "user" || p.role === "assistant") && Array.isArray(p.content)) {
      const text = p.content
        .filter((b: any) => b.type === "input_text" || b.type === "output_text")
        .map((b: any) => b.text)
        .join("\n");
      raw.push({ who: p.role === "user" ? "me" : "you", text, src: "role" });
    }
  });
  // Both shapes can describe the same turn. If the file has event_msg lines, trust those only.
  const useEvents = raw.some((r) => r.src === "event");
  const picked = raw.filter((r) => r.src === (useEvents ? "event" : "role"));
  return tidy(picked.filter((r) => r.text.trim() && !(r.who === "me" && injected(r.text))));
}

// ---- Claude ----

function claudeFolder(home: string): string {
  return join(CLAUDE_DIR, home.replace(/[^A-Za-z0-9]/g, "-"));
}

// Plain text of a Claude message: strings as they are, blocks keep only "text" (no tools, no thinking).
function claudeText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("\n");
}

function claudeLine(o: any): { who: "me" | "you"; text: string } | null {
  if ((o?.type !== "user" && o?.type !== "assistant") || o.isSidechain || o.isMeta) return null;
  const text = claudeText(o.message?.content);
  if (!text.trim()) return null; // tool results, tool calls, thinking only
  if (o.type === "user" && injected(text)) return null;
  return { who: o.type === "user" ? "me" : "you", text };
}

async function claudeThreads(home: string): Promise<Thread[]> {
  const dir = claudeFolder(home);
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
  } catch {
    return []; // folder does not exist yet
  }
  const out: Thread[] = [];
  for (const n of names) {
    const file = join(dir, n);
    let title = "";
    await eachLine(file, (o) => {
      const l = claudeLine(o);
      if (l && l.who === "me") {
        title = titleOf(l.text);
        return true;
      }
    });
    if (!title) continue; // no real user line: nothing worth showing
    out.push({ seat: "claude", sessionId: basename(n, ".jsonl"), title, updatedAt: (await stat(file)).mtime.toISOString() });
  }
  return out;
}

async function claudeMsgs(file: string): Promise<Msg[]> {
  const raw: { who: "me" | "you"; text: string }[] = [];
  await eachLine(file, (o) => {
    const l = claudeLine(o);
    if (l) raw.push(l);
  });
  return tidy(raw);
}

// ---- shared ----

// Merge back-to-back assistant messages (as the face shows them live) and pull "Attached: <path>"
// lines out of Marco's messages into files the face can show.
function tidy(raw: { who: "me" | "you"; text: string }[]): Msg[] {
  const out: Msg[] = [];
  for (const r of raw) {
    const prev = out[out.length - 1];
    if (r.who === "you" && prev?.who === "you") {
      prev.text += "\n\n" + r.text.trim();
      continue;
    }
    if (r.who === "me") {
      const files: { name: string; url: string }[] = [];
      const text = r.text
        .split("\n")
        .filter((line) => {
          const m = /^Attached: (\/.+)$/.exec(line.trim());
          if (!m) return true;
          files.push({ name: basename(m[1]), url: `/file?path=${encodeURIComponent(m[1])}` });
          return false;
        })
        .join("\n")
        .trim();
      out.push(files.length ? { who: "me", text, files } : { who: "me", text });
    } else out.push({ who: "you", text: r.text.trim() });
  }
  return out;
}

// All conversations for Sol's home folder, both seats, newest first.
export async function listThreads(home: string): Promise<Thread[]> {
  const real = await realpath(home).catch(() => home);
  const [a, b] = await Promise.all([codexThreads(real), claudeThreads(real)]);
  const names = getTitles(); // Sol's own names win over the cut first message
  return [...a, ...b].map((t) => (names[t.sessionId] ? { ...t, title: names[t.sessionId] } : t)).sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : -1));
}

// One conversation's transcript.
// What is in a Codex thread's window right now: the last token_count line of its rollout.
// last_token_usage is the last model request (cached tokens are inside input_tokens);
// model_context_window is the window Codex really uses (context_window × effective percent).
export async function codexLastUsage(sessionId: string): Promise<{ context: number; window: number } | null> {
  const f = await findCodexFile(sessionId);
  if (!f) return null;
  let out: { context: number; window: number } | null = null;
  await eachLine(f, (o) => {
    const info = o?.type === "event_msg" && o.payload?.type === "token_count" ? o.payload.info : null;
    if (info?.last_token_usage) out = { context: info.last_token_usage.input_tokens ?? 0, window: info.model_context_window ?? 0 };
  });
  return out;
}

// Does this seat own this conversation? A Codex id handed to Claude (or the reverse) is refused upstream.
export async function threadExists(home: string, seat: Seat, sessionId: string): Promise<boolean> {
  if (!ID_OK.test(sessionId)) return false;
  if (seat === "codex") return (await findCodexFile(sessionId)) !== null;
  const real = await realpath(home).catch(() => home);
  return stat(join(claudeFolder(real), `${sessionId}.jsonl`)).then(() => true, () => false);
}

// What the conversation last ran on, from the record: Codex writes a turn_context per turn
// (effort on its own scale, xhigh = our max); Claude writes the model on each assistant line.
export async function threadSettings(home: string, seat: Seat, sessionId: string): Promise<{ model?: string; effort?: string }> {
  if (!ID_OK.test(sessionId)) return {};
  const out: { model?: string; effort?: string } = {};
  if (seat === "codex") {
    const f = await findCodexFile(sessionId);
    if (!f) return out;
    await eachLine(f, (o) => {
      if (o?.type === "turn_context") {
        if (o.payload?.model) out.model = o.payload.model;
        if (o.payload?.effort) out.effort = o.payload.effort === "xhigh" ? "max" : o.payload.effort;
      }
    });
    return out;
  }
  const real = await realpath(home).catch(() => home);
  await eachLine(join(claudeFolder(real), `${sessionId}.jsonl`), (o) => {
    if (o?.type === "assistant" && o.message?.model && !o.isSidechain) out.model = o.message.model;
  }).catch(() => {});
  return out;
}

export async function openThread(home: string, seat: Seat, sessionId: string): Promise<Msg[]> {
  if (!ID_OK.test(sessionId)) return [];
  if (seat === "codex") {
    const f = await findCodexFile(sessionId);
    return f ? codexMsgs(f) : [];
  }
  const real = await realpath(home).catch(() => home);
  try {
    return await claudeMsgs(join(claudeFolder(real), `${sessionId}.jsonl`));
  } catch {
    return [];
  }
}
