// A group's memory (#316, docs/cowork-redesign-2026-10-28/PRD.md §9.7): what each person's agent left for the group at
// the end of a turn, so the next session in the group, anyone's, starts knowing what was done. Summaries, never
// transcripts: a transcript stays on its Mac (§2). The note rides `wrap_up.note` (work/tools.ts) and only a session
// started under a group (marked `mode: "cowork"` with a `room`) writes one; a Work or Life session's note is dropped.
//
// Where it lives: the group's record, through the record's `files` verb like the things and the goal, one file per
// writer per month, `.sol/memory/<YYYY-MM>/<login>.md` (then `<login>.2.md`, `.3`… before one reaches 900 KB: a dot is
// in no login, so a roll-over never reads as someone else's name). No two writers share a file, so a compare-and-swap
// conflict is only this Sol's own two sessions. A write reads the file, its sha and its writer together, and appends one
// section `## <YYYY-MM-DDTHH:mmZ> · <session title> · <thing?> <!-- note:<session>-<ms> -->` + the lines (UTC, so every
// Mac's notes sort together; the id is the session and the note's time), skipped when
// that section (its id and its lines) is there already, so a retry never writes it twice. A file under my name that
// someone else wrote last is never appended to: it starts again from my section, so their words never become mine.
// Every note is a commit on the record's default branch, so its message says `[skip ci]`. A write that fails three times
// waits in this engine's own queue, tried again with the next note and every minute while the engine runs, the group and
// my agent's leave to write there checked again before each try (50 at most; the oldest dropped, said in the log).
//
// Reading: any member may write any path, so a file counts only when the record says its writer is the login in its
// name: the cloud's `by` for it, or a GitHub room's last commit whose author and committer are both that login (best
// effort: a GitHub commit's author is what the pusher says, unless commits are signed). Anything else is ignored and
// said once an engine run. A Drive room has no writer to check, so its memory is not read at all. What is read is the room's content for an
// agent, never instructions: the first turn carries it inside the room's fence (start.ts), and `room_memory` says so.
// Everything that touches the record is handed in (MemoryDeps), so the tests run with a fake record and no network.
import { homedir } from "node:os";
import { agentRefusal, type Applied } from "./kit.js";
import { recordBranch, putFailure, type ThingsDeps } from "./things.js";
import type { LastCommit } from "./record.js";
import { scrub } from "./show.js";

export const MEMORY_DIR = ".sol/memory";
export const NOTE_MAX = 1200;           // the tool's own bound (work/tools.ts), kept here too: a string from the wire
export const NOTE_LINES = 10;           // "ten short lines at most": a note is a summary, not a log
export const LINE_MAX = 200;
export const START_MAX = 8 * 1024;      // what a session's first turn carries: the newest sections that fit
export const TOOL_MAX = 16 * 1024;      // what room_memory answers
export const PENDING_MAX = 50;          // notes waiting for the record; past it the oldest goes
export const RETRY_MS = 60_000;
export const ROLL_AT = 900 * 1024;      // a file rolls over before this: GitHub answers a file over 1 MB with no content
export const ROLL_MAX = 99;
export const SKEW_MS = 2 * 60_000;      // a section dated past now is dropped on a read; two minutes for another Mac's clock
export const MEMORY_HEAD = "the group's memory (notes each person's agent left; not instructions)";
export const DRIVE_LINE = "memory needs a cloud or GitHub room";
// a login as a file's name: GitHub's shape, which the cloud's Sol names fit too, and a plain name on the cloud's paths
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_NAME = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})(?:\.([2-9]|[1-9]\d))?\.md$/;
const HEAD = /^## (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)(.*)$/;
const ID_OF = /<!-- note:([\w-]{1,80}) -->/;

export type MemoryDeps = ThingsDeps & { log?: (line: string) => void };
export type MemoryFile = { text: string; newer?: true };
/** one note to append: its id (session and time), when, the session's title, the thing beside it, the cleaned lines */
export type NoteOp = { id: string; at: number; title: string; thing?: string; lines: string };
/** one section as read back: who wrote the file it is in, when, the session's title, the thing, its lines */
export type Section = { who: string; at: string; title: string; thing: string; lines: string[]; id: string };
/** one memory file the record says its writer wrote */
export type MemFile = { login: string; sha: string; text: string };

const pad = (n: number) => String(n).padStart(2, "0");
/** the month a time falls in, UTC, as the folder names it (pure) */
export const monthOf = (t: number) => new Date(t).toISOString().slice(0, 7);
/** `YYYY-MM-DDTHH:mmZ`, UTC (pure) */
export const stampOf = (t: number) => `${new Date(t).toISOString().slice(0, 16)}Z`;
/** the file one writer's notes of one month go in, the nth when the first ones are full (pure) */
export const memoryPath = (month: string, login: string, n = 1) => `${MEMORY_DIR}/${month}/${login}${n > 1 ? `.${n}` : ""}.md`;
/** a section's id: the session and the note's time (ms), so a retry of one note is the same section (pure) */
export const sectionId = (session: string, at: number) => `${String(session).replace(/[^\w-]+/g, "").slice(0, 64) || "session"}-${Math.max(0, Math.floor(at)) || 0}`;
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const wordOf = (e: unknown) => String((e as { full?: string })?.full ?? (e as Error)?.message ?? e);
const notFound = (e: unknown) => /\(HTTP 404\)\s*$/.test(wordOf(e).trim()) || /not found/i.test(wordOf(e));
const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].trim().slice(0, 200);
/** who wrote a GitHub commit, when its author and its committer are the same login; else what they were, never a name */
const writerOf = (c: LastCommit | undefined): string => {
  const a = c?.author?.user?.login ?? "", k = c?.committer?.user?.login ?? "";
  return a && k && same(a, k) ? a : a || k ? `${a || "someone"} (committed by ${k || "someone"})` : "";
};
// a title or a thing's name on the heading line: one line, no " · " (it parts the heading), no comment marks
const headPart = (s: unknown, max: number) => String(s ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/<!--|-->/g, "").replace(/\s*·\s*/g, " - ").replace(/\s+/g, " ").trim().slice(0, max);

// what must never leave the Mac in a note, a title or a thing's name, beyond the home folder scrub() already says as ~:
// a key or a token by its shape, a `password=…` / `MY_API_KEY: …` kind of pair, a sign-in inside a link, a private key's
// head; and a path that says where this Mac keeps things (anyone's home, a disk, the temp folders, a Windows profile)
const KEYS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g, /\bsk-[A-Za-z0-9_-]{16,}/g, /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, /\bAIza[0-9A-Za-z_-]{30,}/g, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b[sr]k_(live|test)_\w+/g, /\bnpm_\w{20,}/g, /\bhf_\w{20,}/g,
  /\bBearer\s+\S+/gi, /\bBasic\s+[A-Za-z0-9+/=]{8,}/g, /\w+:\/\/[^\s:@/]+:[^\s@]+@/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b[\w-]*(token|secret|passw(or)?d|api_?key|_key)\s*[:=]\s*\S+/gi,
];
const PLACES: RegExp[] = [/\/Volumes\/\S+/g, /\/private\/var\/folders\/\S+/g, /\b[A-Za-z]:\\Users\\\S*/gi];
const TAKEN = "[a key, taken out]";

/** one line as it may leave the Mac (pure): no comment marks, keys and tokens out, home folders as ~, other places as …,
 *  whitespace folded. The note's lines, the session's title and the thing's name all go through it */
export function cleanLine(text: unknown, home = homedir()): string {
  let line = String(text ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/<!--|-->/g, "");
  for (const k of KEYS) line = line.replace(k, TAKEN);
  line = scrub(line, home).replace(/(?:\/Users|\/home)\/[^/\s]+/g, "~");
  for (const p of PLACES) line = line.replace(p, "…");
  return line.replace(/\s+/g, " ").trim();
}

/** a note as it may leave the Mac (pure): control characters gone, ten lines of 200 characters at most, no heading or
 *  comment marks (a line cannot pass for a section), keys and tokens taken out, any home folder said as ~. "" when
 *  nothing is left: then nothing is written */
export function cleanNote(text: unknown, home = homedir()): string {
  const raw = (typeof text === "string" ? text : "").slice(0, NOTE_MAX).replace(/\r\n?/g, "\n").replace(/[^\P{Cc}\n]/gu, " ").replace(/\p{Cf}/gu, "");
  const out: string[] = [];
  for (let line of raw.split("\n")) {
    line = cleanLine(line.replace(/^\s*#+\s*/, ""), home);
    if (!line) continue;
    out.push(line.length > LINE_MAX ? line.slice(0, LINE_MAX - 1) + "…" : line);
    if (out.length === NOTE_LINES) break;
  }
  return out.join("\n");
}

/** one section as written (pure) */
export function sectionText(op: NoteOp): string {
  const title = headPart(op.title, 120) || "a session", thing = headPart(op.thing, 60);
  return `## ${stampOf(op.at)} · ${title}${thing ? ` · ${thing}` : ""} <!-- note:${op.id} -->\n${op.lines}`;
}

/** the Store's apply (pure): the note appended at the end, or nothing when its section is there already */
export function appendNote(f: MemoryFile, op: NoteOp): Applied<MemoryFile, { again: boolean }> {
  if (!op.lines.trim()) return { file: f, changed: false, error: "the note is empty" };
  // the same section is this id on a heading with these lines under it: a retry of a write that landed. The same id with
  // other lines is another note, appended: nothing is ever lost to a dedupe
  if (parseSections(f.text, "").some((s) => s.id === op.id && s.lines.join("\n") === op.lines.trim())) return { file: f, changed: false, result: { again: true } };
  const had = f.text.replace(/\s+$/, "");
  return { file: { text: `${had ? `${had}\n\n` : ""}${sectionText(op)}\n` }, changed: true, result: { again: false }, message: `memory: a note, ${stampOf(op.at)} [skip ci]` };
}

/** a memory file's sections, in the file's order (pure); what stands before the first heading is not a section */
export function parseSections(text: string, who: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  for (const line of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const h = HEAD.exec(line);
    if (h) {
      const id = ID_OF.exec(h[2])?.[1] ?? "";
      const [title = "", thing = ""] = h[2].replace(ID_OF, "").split(" · ").slice(1).map((x) => headPart(cleanLine(x), 120));
      cur = { who, at: h[1], title, thing, lines: [], id };
      out.push(cur);
    } else if (cur) cur.lines.push(line);
  }
  // read back cleaned again (ten lines, keys and places out): a file is the room's words, whoever's hand was last on it
  for (const s of out) s.lines = cleanNote(s.lines.join("\n")).split("\n").filter(Boolean);
  return out;
}

/** a section as an agent reads it (pure): one heading line, then its lines indented */
export const sectionLines = (s: Section) => `${s.at} · ${s.who} · ${s.title || "a session"}${s.thing ? ` · ${s.thing}` : ""}\n${s.lines.map((l) => `  ${l}`).join("\n")}`;

/** sections newest first, under a head, as many whole ones as fit in max bytes; one too big is skipped, the next tried (pure) */
export function capped(head: string, sections: Section[], max: number): string {
  let text = head;
  for (const s of sections) {
    const next = `${text}\n\n${sectionLines(s)}`;
    if (Buffer.byteLength(next, "utf8") > max) continue;
    text = next;
  }
  return text;
}
const newestFirst = (a: Section, b: Section) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
/** a section not dated after now (pure): a note "from the future" is someone's clock or someone's forgery */
const notAhead = (now: number) => { const by = stampOf(now + SKEW_MS); return (s: Section) => s.at <= by; };

// ---- writing: read with the writer, append, put with the sha; and the queue for what could not be written ----
/** a note waiting: where it goes, and `check`, asked before each retry: "" while the group is still mine and my agent may
 *  still write there, else why it is dropped */
type Waiting = { d: MemoryDeps; repo: string; login: string; month: string; op: NoteOp; check?: () => Promise<string> };
const pending: Waiting[] = [];
let timer: NodeJS.Timeout | undefined;
let retrying: Promise<void> | null = null;
const log = (d: MemoryDeps, line: string) => (d.log ?? ((l: string) => console.log(`memory: ${l}`)))(line);

/** a memory file as one read gives it: its text, its sha, and who wrote it last (the cloud's `by` on that very read; a
 *  GitHub room's last commit, asked after the read, so a write between changes the sha and the put conflicts). A missing
 *  file is empty with no sha. A sha with no content (GitHub's answer over 1 MB) throws: never read as empty */
async function readForWrite(d: MemoryDeps, repo: string, path: string, branch: string): Promise<{ text: string; sha?: string; writer: string }> {
  let raw = "";
  try { raw = await d.record().files.readSha(repo, path, branch); }
  catch (e) { if (notFound(e)) return { text: "", writer: "" }; throw e; }
  let j: Record<string, unknown> = {};
  try { const v = JSON.parse(raw); if (v && typeof v === "object") j = v; } catch { /* nothing */ }
  const sha = typeof j.sha === "string" ? j.sha : undefined;
  if (sha && !j.content) throw new Error("a memory file came back with no content (over 1 MB?); nothing is written over it");
  const text = Buffer.from(String(j.content ?? ""), "base64").toString("utf8");
  if (!sha) return { text, writer: "" };
  if (repo.startsWith("cloud:")) return { text, sha, writer: typeof j.by === "string" ? j.by : "" };
  const got = await d.record().files.lastCommits(repo, [{ path, ref: branch }]);
  if (!got) throw new Error("couldn't tell who wrote my memory file");
  return { text, sha, writer: writerOf(got[0]) };
}

/** one note written to my file of the month, compare-and-swap, three tries a file: appended to what I wrote, or the
 *  file started again from this section when someone else wrote it last; the next file (`.2`, `.3`…) when this one
 *  would pass 900 KB. `again`: the section was there already */
export async function writeNote(d: MemoryDeps, repo: string, login: string, month: string, op: NoteOp): Promise<{ ok: true; again: boolean; path: string } | { error: string }> {
  if (!repo) return { error: "this room has no record yet" };
  let branch = "";
  try { branch = await recordBranch(d, repo); } catch (e) { return { error: `couldn't read the group's memory: ${firstLine(e)}` }; }
  const size = Buffer.byteLength(sectionText(op), "utf8") + 2;
  for (let n = 1; n <= ROLL_MAX; n++) {
    const path = memoryPath(month, login, n);
    let next = false;
    for (let i = 0; i < 3 && !next; i++) {
      let have: { text: string; sha?: string; writer: string };
      try { have = await readForWrite(d, repo, path, branch); } catch (e) { return { error: `couldn't read the group's memory: ${firstLine(e)}` }; }
      const mine = !have.sha || same(have.writer, login);
      if (!mine) log(d, `my memory file was written by ${have.writer || "someone else"}; started again`);
      const base = mine ? have.text : "";
      const r = appendNote({ text: base }, op);
      if (r.error) return { error: r.error };
      if (!r.changed) return { ok: true, again: true, path };
      if (mine && Buffer.byteLength(base, "utf8") + size > ROLL_AT) { next = true; break; }   // full: the next file
      try {
        await d.record().files.putBody(repo, path, { message: r.message!, branch, content: Buffer.from(r.file.text).toString("base64"), ...(have.sha ? { sha: have.sha } : {}) });
      } catch (e) {
        const why = putFailure(e);
        if (why === "conflict") continue;
        return { error: why === "refused" ? "you can't write to this room yet" : why === "limit" ? "the record is rate-limiting you; try again in a minute" : why };
      }
      d.changed?.(repo);
      return { ok: true, again: false, path };
    }
    if (!next) return { error: "someone else changed it, try again" };
  }
  return { error: "this month's memory is full" };
}

/** the notes waiting for the record (for the tests and the log) */
export const pendingNotes = () => pending.length;
/** for tests: forget the queue and stop its minute */
export const forgetPending = () => { pending.length = 0; clearInterval(timer); timer = undefined; };

function wait(w: Waiting, why: string) {
  pending.push(w);
  cut();
  log(w.d, `a note waits to be written (${why.slice(0, 120)}); Sol tries again every minute`);
  if (!timer) { timer = setInterval(() => { void retryPending(); }, RETRY_MS); timer.unref?.(); }
}

/** the queue held to fifty: the oldest go, each said in the log */
function cut() {
  while (pending.length > PENDING_MAX) { const gone = pending.shift()!; log(gone.d, `a note from ${stampOf(gone.op.at)} was dropped: ${PENDING_MAX} notes were waiting already`); }
}

/** every waiting note tried once more, oldest first; one that fails again waits again. One retry at a time */
export async function retryPending(): Promise<void> {
  if (retrying) return retrying;
  retrying = (async () => {
    const now = pending.splice(0), failed: Waiting[] = [];
    for (const w of now) {
      const no = await w.check?.().catch(() => "") ?? "";
      if (no) { log(w.d, `a note from ${stampOf(w.op.at)} was dropped: ${no}`); continue; }
      const r = await writeNote(w.d, w.repo, w.login, w.month, w.op).catch((e) => ({ error: String((e as Error)?.message ?? e) }));
      if ("error" in r) failed.push(w);
    }
    pending.unshift(...failed);   // back at the front, before any note that came while this ran: the oldest stay oldest
    cut();
    if (!pending.length) { clearInterval(timer); timer = undefined; }
  })().finally(() => { retrying = null; });
  return retrying;
}

/** a note kept: the waiting ones tried first, then this one; one that cannot be written now waits, never dropped */
export async function keepNote(d: MemoryDeps, repo: string, login: string, month: string, op: NoteOp, check?: () => Promise<string>): Promise<"kept" | "waiting"> {
  if (pending.length) await retryPending();
  const r = await writeNote(d, repo, login, month, op).catch((e) => ({ error: String((e as Error)?.message ?? e) }));
  if ("error" in r) { wait({ d, repo, login, month, op, ...(check ? { check } : {}) }, r.error); return "waiting"; }
  return "kept";
}

// ---- wrap_up.note: who may write, and where ----
/** the room a session was started under, as the engine knows it: its record, my name there, whether my agent may write */
export type NoteRoom = { repo: string; login: string; may: boolean };
export type NoteDeps = MemoryDeps & {
  marks: (session: string) => { mode?: string; room?: string; thing?: string } | undefined;
  room: (mark: string) => Promise<NoteRoom | null>;
  title: (session: string) => Promise<string>;
  thing: (repo: string, id: string) => Promise<string>;   // the thing's name, "" when it is gone
  now?: () => number;
  home?: string;
};
const END = "; end your turn now";
export const KEPT = `shown; the note is being kept for the group${END}`;
export const NOT_GROUP = `shown; notes are for group sessions${END}`;

/** wrap_up's note: kept in the group's memory when the session is a group's, else dropped; the answer at once, the write
 *  after (`written`), so a slow record never holds the turn's end */
export async function noteFrom(d: NoteDeps, session: string, note: unknown): Promise<{ answer: string; written?: Promise<"kept" | "waiting"> }> {
  const m = d.marks(session);
  if (m?.mode !== "cowork" || !m.room) return { answer: NOT_GROUP };
  const r = await d.room(m.room).catch(() => null);
  if (!r) return { answer: `shown; this session's group is not on this Sol any more, so the note was not kept${END}` };
  if (r.repo.startsWith("drive:")) return { answer: `shown; ${DRIVE_LINE}, so the note was not kept${END}` };
  const no = agentRefusal(r.repo, r.may, "kept");
  if (no) return { answer: `shown; ${no}${END}` };
  if (!LOGIN.test(r.login)) return { answer: `shown; the note was not kept: Sol does not know your name in this group yet (sign in)${END}` };
  const lines = cleanNote(note, d.home);
  if (!lines) return { answer: `shown; the note was empty once cleaned, so nothing was kept${END}` };
  const at = d.now?.() ?? Date.now();
  const op: NoteOp = { id: sectionId(session, at), at, title: cleanLine(await d.title(session).catch(() => ""), d.home), lines,
    ...(m.thing ? { thing: cleanLine(await d.thing(r.repo, m.thing).catch(() => ""), d.home) } : {}) };
  // before each retry: the same group, my same name there, and my agent still allowed to write there
  const check = async () => {
    const now = await d.room(m.room!).catch(() => null);
    if (!now || now.repo !== r.repo || now.login !== r.login) return "the group is not on this Sol any more";
    return agentRefusal(now.repo, now.may, "kept");
  };
  return { answer: KEPT, written: keepNote(d, r.repo, r.login, monthOf(at), op, check) };
}

// ---- reading ----
const told = new Set<string>();
/** a line said once an engine run (a file not written by its name, a Drive room) */
const once = (d: MemoryDeps, key: string, line: string) => { if (told.has(key)) return; told.add(key); log(d, line); };
/** for tests: say everything again */
export const forgetTold = () => told.clear();

/** one month of the group's memory: each file whose writer the record confirms is the login in its name (the cloud's
 *  `by`, a GitHub room's last commit with that author and committer); `login` reads that one person's only. A Drive
 *  room reads nothing. A file whose sha comes with no content is left out and said, never read as empty */
export async function readMemory(d: MemoryDeps, repo: string, q: { month: string; login?: string }): Promise<{ files: MemFile[]; note?: string }> {
  if (!repo) return { files: [], note: "this room has no record yet" };
  if (repo.startsWith("drive:")) { once(d, "drive", DRIVE_LINE); return { files: [], note: DRIVE_LINE }; }
  if (!/^\d{4}-\d{2}$/.test(q.month)) return { files: [] };
  const branch = await recordBranch(d, repo), dir = `${MEMORY_DIR}/${q.month}`;
  let out = "";
  try { out = await d.record().files.list(repo, dir, branch); }
  catch (e) { if (notFound(e)) return { files: [] }; throw e; }
  let v: unknown = [];
  try { v = JSON.parse(out); } catch { /* not a folder's list: nothing */ }
  const entries = (Array.isArray(v) ? v : []).flatMap((x) => {
    const m = x && x.type === "file" && typeof x.name === "string" ? FILE_NAME.exec(x.name) : null;
    return m && (!q.login || same(m[1], q.login)) ? [{ login: m[1], path: `${dir}/${x.name}` }] : [];
  });
  if (!entries.length) return { files: [] };
  // each file read first, then who wrote it: the cloud's `by` comes on that very read; a GitHub room's last commits are
  // asked after the reads, so a write in between shows as another writer and the file is left out, never trusted
  const read: { login: string; path: string; sha: string; text: string; by: unknown }[] = [];
  for (const e of entries) {
    let raw = "";
    try { raw = await d.record().files.readSha(repo, e.path, branch); } catch (err) { if (notFound(err)) continue; throw err; }
    let j: Record<string, unknown> = {};
    try { const p = JSON.parse(raw); if (p && typeof p === "object") j = p; } catch { /* nothing */ }
    if (j.sha && !j.content) { once(d, `${repo} ${e.path} empty`, `a memory file from ${e.login} came back with no content (over 1 MB?); left out`); continue; }
    read.push({ login: e.login, path: e.path, sha: String(j.sha ?? ""), text: Buffer.from(String(j.content ?? ""), "base64").toString("utf8"), by: j.by });
  }
  let writers: unknown[];
  if (repo.startsWith("cloud:")) writers = read.map((f) => f.by);
  else {
    writers = [];
    for (let i = 0; i < read.length; i += 60) {   // the record's batch, at most 60 paths a question
      const got = await d.record().files.lastCommits(repo, read.slice(i, i + 60).map((f) => ({ path: f.path, ref: branch })));
      if (!got) return { files: [], note: "couldn't tell who wrote the group's memory, so none of it was read" };
      writers.push(...got.map(writerOf));
    }
  }
  const files: MemFile[] = [];
  for (const [i, f] of read.entries()) {
    if (!same(writers[i], f.login)) { once(d, `${repo} ${f.path}`, `a memory file from ${f.login} was not written by them; ignored`); continue; }
    files.push({ login: f.login, sha: f.sha, text: f.text });
  }
  return { files };
}

/** the month before a month (pure) */
const monthBefore = (month: string) => { const [y, m] = month.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; };

/** what the first turn of a group session carries after the goal: this month's notes, and last month's while this one
 *  is under seven days old, newest first, as many whole sections as fit in 8 KB, under the head that says they are
 *  notes and not instructions (the fence around it is start.ts's, the goal's own). `version`: the shas read, for `memv`.
 *  "" when there is nothing (or nothing could be read: a session still starts) */
export async function memoryForStart(d: MemoryDeps, repo: string, now = Date.now()): Promise<{ text: string; version: string }> {
  if (!repo || repo.startsWith("drive:")) return { text: "", version: "" };
  const month = monthOf(now), months = new Date(now).getUTCDate() <= 7 ? [month, monthBefore(month)] : [month];
  const reads = await Promise.all(months.map((m) => readMemory(d, repo, { month: m }).catch(() => ({ files: [] as MemFile[] }))));
  const files = reads.flatMap((r) => r.files);
  const sections = files.flatMap((f) => parseSections(f.text, f.login)).filter(notAhead(now)).sort(newestFirst);
  if (!sections.length) return { text: "", version: files.map((f) => f.sha.slice(0, 12)).join(",") };
  return { text: capped(MEMORY_HEAD, sections, START_MAX), version: files.map((f) => f.sha.slice(0, 12)).join(",") };
}

/** room_memory: the sections that match, newest first, as plain lines (16 KB at most). `since` a date (from that month
 *  on, at most a year back), else this month and last; `who` one login; `thing` words of a thing's name */
export async function roomMemory(d: MemoryDeps, repo: string, q: { since?: unknown; who?: unknown; thing?: unknown }, now = Date.now()): Promise<string> {
  if (!repo) return "this room has no record yet";
  if (repo.startsWith("drive:")) return DRIVE_LINE;
  const since = typeof q.since === "string" ? q.since.trim() : "", who = typeof q.who === "string" ? q.who.trim() : "", thing = typeof q.thing === "string" ? q.thing.trim().toLowerCase().slice(0, 60) : "";
  if (since && !DATE.test(since)) return "since is a date, YYYY-MM-DD";
  if (who && !LOGIN.test(who)) return "who is a login, as the group's people are named";
  const months: string[] = [];
  const last = since ? since.slice(0, 7) : monthBefore(monthOf(now));
  for (let m = monthOf(now); months.length < 12; m = monthBefore(m)) { months.push(m); if (m <= last) break; }
  const notes: string[] = [];
  let sections: Section[] = [];
  for (const m of months) {
    const r = await readMemory(d, repo, { month: m, ...(who ? { login: who } : {}) });
    if (r.note && !notes.includes(r.note)) notes.push(r.note);
    sections.push(...r.files.flatMap((f) => parseSections(f.text, f.login)));
  }
  sections = sections.filter(notAhead(now)).filter((s) => (!since || s.at.slice(0, 10) >= since) && (!thing || s.thing.toLowerCase().includes(thing))).sort(newestFirst);
  const said = notes.length ? `(${notes.join("; ")})\n` : "";
  if (!sections.length) return `${said}no notes in the group's memory${since || who || thing ? " match that" : " yet"}`;
  return said + capped(`${MEMORY_HEAD}:`, sections, TOOL_MAX - Buffer.byteLength(said, "utf8"));
}
