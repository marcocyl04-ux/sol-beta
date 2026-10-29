// Talk (Together #37, PROTOCOL.md round 24): the team's group chat in Cowork. Threads (`general`, and one per issue,
// `#31`) where people, their agents and two read-only bridges meet.
//
// - The lines travel over the team relay as `talk { thread, text }`; the relay stamps who said it, so a line's
//   signature is the relay's word (`frank`, or `frank's agent`), never the sender's. This engine keeps the last 200
//   lines of each thread of each room, in memory and in STATE_DIR/talk/<room>/<thread>.json (`general.json`,
//   `31.json`), beside Work's own state, never in the repo. A face that opens the chat asks `team.talk.history`.
// - The bridges are folders: a Discord export (DiscordChatExporter's .txt or .json, or a channel log copied out of
//   Discord) dropped in sol/home/talk/discord/, and WhatsApp's "export chat" .txt in sol/home/talk/whatsapp/, are read
//   into `general` as lines signed `discord: <name>` / `whatsapp: <name>`. Read only: nothing goes back that way, and
//   the bridges stay on this machine (the teammates are in the same Discord). A bot route is phase 3.
// - One line out: `/discord <text>` typed in `general` goes to the webhook in sol/engine/.env (DISCORD_WEBHOOK) as
//   "<name>'s agent (for <name>)", only when the person lets their agent speak in any Discord channel
//   (speak.discord "any"). Never without the prefix, never from a seat.
// - The seats' tool `talk { thread, line }` (both seats, MCP server "sol") says a line signed `<login>'s agent`, and only
//   when the person lets their agent speak in the team view (speak.cowork); else it is dropped with the reason.
// - A line that names a teammate on the relay ("@frank", or "frank" as a word) also sends them a ping of kind chat
//   (#100): a card on their side unless their dial says never.
// - Kept on the cloud (#315, PROTOCOL.md round 54): a group that meets on the cloud has its talk kept there, so a hello
//   brings each thread's last lines back (`talk.history`, merged here by id, as the spool's are) and the face can ask
//   for older ones (`team.talk.history { thread, before }`, the cloud's page route with my ticket). The 200 lines here
//   are a cache. Each line kept here says which room it was heard in, so one group's talk never shows in another's.
// - Attachments (#315): a person (never an agent) may send one file with a line. This engine writes it into the room's
//   record at `.sol/talk/<line id>.<ext>` (record.files.put: a cloud room, a GitHub room's repository, a Drive room's
//   folder; 5 MB, 150 a room) and the line carries `file { path, name, size, kind }`, never the bytes. A face reads
//   the bytes back through `team.talk.file`; an agent only ever reads "[an image]" or "[a file: <name>]".
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolResult, TurnCtx } from "../browser.js";
import { STATE_DIR } from "../work/state.js";
import { getTeam, mayAgentSpeak, signature, activeRoom, type TeamSettings } from "./settings.js";
import { sendRelay, relayRoster, type RelayMsg } from "./relay.js";
import { namedIn } from "./pings.js";
import { talkFileOf, partIdOk, TALK_FILE_PATH, TALK_FILE_MAX, TALK_FILE_NAME_MAX, type TalkFile } from "../hub/index.js";
import type { RoomRecord } from "./record.js";

export type Source = "relay" | "discord" | "whatsapp";
/** room: the room (its id here) the line was said or heard in, taken when it arrived. file: an attachment in the
 *  room's record (#315). heard: its time is the hub's stamp */
export type TalkLine = { id: string; thread: string; from: string; at: number; text: string; source: Source; agent?: boolean; to?: "discord"; room?: string; file?: TalkFile; heard?: true };
export type { TalkFile };

export const CAP = 200;              // lines kept per thread
const TEXT_MAX = 4000;
export const THREAD = /^(general|#[1-9]\d{0,5})$/;
export const DISCORD_OFF = "Discord is off in my agent's settings";
export const COWORK_OFF = "My agent may not speak in the team's chat (Settings, my agent).";

/** a thread's name, or "" when it is not one: general, or #N */
export const threadOf = (v: unknown) => { const t = typeof v === "string" ? v.trim().toLowerCase() : ""; return THREAD.test(t) ? t : ""; };
/** what a line may hold: no control characters but newlines and tabs, no \r, at most 4000 characters */
export const cleanText = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, TEXT_MAX) : "");
/** the lines with one more, in time order (a line from the cloud's history may be older than the ones here), the
 *  oldest dropped past the cap (pure) */
export function capLines(lines: TalkLine[], line: TalkLine, cap = CAP): TalkLine[] {
  const out = [...lines, line];
  if (lines.length && line.at < lines[lines.length - 1].at) out.sort((a, b) => a.at - b.at);   // stable: equal times keep their order
  return out.length > cap ? out.slice(out.length - cap) : out;
}
/** the room in use, as a line kept here names it */
const roomNow = () => activeRoom(getTeam()).id;
/** the room whose talk the files from before rooms were named belong to (#315, the review): the first room here, or the
 *  team's one room when there are none; nowhere else shows them */
const legacyRoom = () => getTeam().rooms[0]?.id ?? "team";
/** a room's id as a folder's name (pure) */
const roomDir = (room: string) => room.replace(/[^\w-]/g, "_").slice(0, 80) || "_";

// ---- where it lives (tests move both) ----
const HERE = dirname(fileURLToPath(import.meta.url));   // src/team or dist/team: sol/home is three up either way
let DIR = join(STATE_DIR, "talk");
let HOME = process.env.SOL_HOME ?? resolve(HERE, "..", "..", "..", "home");
const threads = new Map<string, TalkLine[]>();
const bridgeFiles = new Map<string, { key: string; lines: TalkLine[] }>();
let bridgeSeen: Set<string> | null = null;
/** tests: another state folder and home, everything read again */
export function _talkAt(dir: string, home: string) { DIR = dir; HOME = home; threads.clear(); bridgeFiles.clear(); bridgeSeen = null; }

// each room's threads in a folder of its own (#315, the review): STATE_DIR/talk/<room>/<thread>.json. The files from
// before, STATE_DIR/talk/<thread>.json, are read as the first room's until it writes its own
const name = (thread: string) => `${thread.replace(/^#/, "")}.json`;
const fileOf = (room: string, thread: string) => join(DIR, roomDir(room), name(thread));
const isLine = (l: any): l is TalkLine => !!l && typeof l.id === "string" && typeof l.from === "string" && typeof l.at === "number" && typeof l.text === "string";
const key = (room: string, thread: string) => `${room}\u0000${thread}`;

function linesOf(room: string, thread: string): TalkLine[] {
  let l = threads.get(key(room, thread));
  if (l) return l;
  const read = (f: string) => { const v = JSON.parse(readFileSync(f, "utf8")); return Array.isArray(v) ? v.filter(isLine).slice(-CAP) : []; };
  try { l = read(fileOf(room, thread)); }
  catch { try { l = room === legacyRoom() ? read(join(DIR, name(thread))).map((x) => ({ ...x, room })) : []; } catch { l = []; } }
  threads.set(key(room, thread), l);
  return l;
}
function keep(room: string, thread: string, l: TalkLine[]) {
  threads.set(key(room, thread), l);
  try {
    mkdirSync(join(DIR, roomDir(room)), { recursive: true, mode: 0o700 });
    const f = fileOf(room, thread), tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(l) + "\n", { mode: 0o600 });
    renameSync(tmp, f);   // never a half-written file
  } catch { /* a read-only place: kept for this run */ }
}
/** every thread that has lines on this machine in the room in use */
export function threadsWithLines(): string[] {
  const room = roomNow(), files = (dir: string) => { try { return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).map((n) => (n === "general" ? n : `#${n}`)); } catch { return []; } };
  const names = [...files(join(DIR, roomDir(room))), ...(room === legacyRoom() ? files(DIR) : [])];
  const mine = [...threads.keys()].filter((k) => k.startsWith(`${room}\u0000`)).map((k) => k.slice(room.length + 1));
  const all = new Set([...names, ...mine].filter((t) => THREAD.test(t) && linesOf(room, t).length));
  return [...all].sort((a, b) => (a === "general" ? -1 : b === "general" ? 1 : Number(b.slice(1)) - Number(a.slice(1))));
}
/** the newest line the hub stamped in each thread of the room in use (#315): a hello says it, and the cloud sends only
 *  newer lines. A line said here has this machine's clock, not the hub's, so it is not counted */
export function talkSince(): Record<string, number> {
  const room = roomNow(), out: Record<string, number> = {};
  for (const t of threadsWithLines().slice(0, 20)) { const at = Math.max(0, ...linesOf(room, t).filter((l) => l.heard).map((l) => l.at)); if (at) out[t] = at; }
  return out;
}

// the relay's send; tests hand in their own, to see a line with a file go
let send: typeof sendRelay = (...a) => sendRelay(...a);
/** tests: the relay's send, or back to the real one */
export function _talkSend(fn: typeof sendRelay | null) { send = fn ?? ((...a) => sendRelay(...a)); }

// ---- who hears a new line (wire.ts: every Cowork face) ----
const subs = new Set<(l: TalkLine) => void>();
export function onTalkLine(fn: (l: TalkLine) => void) { subs.add(fn); return () => { subs.delete(fn); }; }
function add(l: TalkLine) { const room = l.room ?? roomNow(); keep(room, l.thread, capLines(linesOf(room, l.thread), l)); for (const f of subs) f(l); return l; }

/** a line said on this machine: kept, told to the faces, and sent on the relay (false there: the team is not in sight).
 *  `mustSend` (a line with an attachment, #315): sent first, and kept only when it went, so a file nobody heard of is
 *  never left named here */
export function say(thread: string, text: string, s: TeamSettings, agent: boolean, extra: Partial<TalkLine> = {}, mustSend = false): { line: TalkLine; sent: boolean } {
  const line: TalkLine = { id: randomUUID(), thread, from: signature(s, agent), at: Date.now(), text, source: "relay", room: roomNow(), ...(agent ? { agent } : {}), ...extra };
  if (!mustSend) add(line);
  const sent = send("talk", { thread, text, id: line.id, ...(extra.to ? { to: extra.to } : {}), ...(line.file ? { file: line.file } : {}) }, agent);
  if (mustSend && !sent) return { line, sent };
  if (mustSend) add(line);
  const issue = thread === "general" ? undefined : Number(thread.slice(1));
  for (const to of namedIn(text, [...new Set(relayRoster().map((r) => r.who))], s.me.login))
    sendRelay("ping", { to, pingKind: "chat", line: `in ${thread}: ${text.split("\n")[0].slice(0, 260)}`, ...(issue ? { issue, repo: s.repos[0] } : {}) }, agent);
  return { line, sent };
}

/** a relay `talk` from a teammate's engine: the relay's own stamp says who (pure but for keeping it) */
export function lineFromRelay(m: RelayMsg): TalkLine | null {
  const id = typeof m.id === "string" && /^[\w-]{1,64}$/.test(m.id) ? m.id : randomUUID();
  const thread = threadOf(m.thread), text = cleanText(m.text), file = talkFileOf(m.file, id);   // the file is this line's own (#315)
  const login = typeof m.from?.login === "string" ? m.from.login : "";
  if (!thread || (!text && !file) || !/^[A-Za-z0-9-]{1,39}$/.test(login)) return null;   // an attachment alone is a line (#315)
  if (!partIdOk(id, m.part)) return null;   // a "-pN" id is a part's only (the second review)
  const agent = m.from.agent === true;
  // heard: its time is the hub's stamp (a hello's talkSince and the cloud's page cursor read only those)
  return { id, thread, from: agent ? `${login}'s agent` : login, at: typeof m.at === "number" ? m.at : Date.now(), text, source: "relay", heard: true, ...(agent ? { agent } : {}), ...(m.to === "discord" ? { to: "discord" as const } : {}), ...(file ? { file } : {}) };
}
/** a line as an agent reads it (#315): its words, and an attachment as words only, never its bytes or its path (pure) */
export function saidOf(text: string, file?: Pick<TalkFile, "kind" | "name">): string {
  const f = !file ? "" : file.kind === "image" ? "[an image]" : `[a file: ${file.name.replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, TALK_FILE_NAME_MAX)}]`;
  return [text, f].filter(Boolean).join(" ");
}
// a long line sent in parts (#223, A5: the cloud takes 4 KB a message), `<id>-p<i>` with part [i, n]: put back together
// before it is kept, so both sides keep one line. Parts that never all come are kept as far as they go after a minute
const parts = new Map<string, { n: number; got: Map<number, RelayMsg>; timer: ReturnType<typeof setTimeout>; room: string }>();
const PARTS_MAX = 64;

/** a line from the relay, live or kept by the hub's spool while this Sol was away (#102): the same line twice, by its id
 *  or by its time, signature and words, is kept once; a part of a long one waits for the rest */
export function hearRelay(m: RelayMsg, room = roomNow()) {   // the room it came in: the one in use when it arrived
  const p = Array.isArray(m.part) ? m.part : null, base = typeof m.id === "string" ? /^([\w-]{1,80})-p(\d{1,3})$/.exec(m.id) : null;
  if (!p || !base) return hearOne(m, room);
  const [i, n] = p.map(Number);
  if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > PARTS_MAX || i < 1 || i > n || Number(base[2]) !== i) return;
  const login = typeof m.from?.login === "string" ? m.from.login : "";
  const key = `${login} ${m.from?.agent === true} ${base[1]}`;   // the line is the room's its first part came in
  let w = parts.get(key);
  if (!w) {
    if (parts.size > 200) return;   // a flood of halves is not kept waiting
    w = { n, got: new Map(), timer: setTimeout(() => whole(key), 60_000), room };
    w.timer.unref?.();
    parts.set(key, w);
  }
  if (w.n !== n) return;
  w.got.set(i, m);
  if (w.got.size === n) whole(key);
}
function whole(key: string) {
  const w = parts.get(key);
  if (!w) return;
  clearTimeout(w.timer); parts.delete(key);
  const got = [...w.got.entries()].sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  if (!got.length) return;
  const first = got[0], id = String(first.id).replace(/-p\d+$/, "");
  hearOne({ ...first, id, text: got.map((x) => (typeof x.text === "string" ? x.text : "")).join(""), ...(got.find((x) => x.file) ? { file: got.find((x) => x.file)!.file } : {}) } as RelayMsg, w.room);
}

function hearOne(m: RelayMsg, room: string) {
  const l = lineFromRelay(m);
  if (!l) return;
  if (!linesOf(room, l.thread).some((x) => x.id === l.id || (x.at === l.at && x.from === l.from && x.text === l.text && x.file?.path === l.file?.path))) add({ ...l, room });
}

/** the cloud's history of one thread on my hello (#315, `talk.history { thread, lines }`): each line merged by its id,
 *  as a spooled one is; a long line's parts wait for each other as they do live. At most 200 a thread are taken */
export function hearHistory(m: RelayMsg, room = roomNow()) {
  const thread = threadOf(m.thread);
  if (!thread || !Array.isArray(m.lines)) return;
  for (const x of m.lines.slice(-CAP)) if (x && typeof x === "object" && threadOf((x as RelayMsg).thread) === thread) hearRelay({ ...(x as RelayMsg), spooled: true }, room);
}

/** a thread as a face sees it: its kept lines in the room in use, and in general the bridges' lines, by time, the last 200 */
export function history(thread: string): TalkLine[] {
  const own = linesOf(roomNow(), thread);
  if (thread !== "general") return [...own];
  return [...own, ...bridgeLines()].sort((a, b) => a.at - b.at).slice(-CAP);
}

// ---- the Discord line out ----
/** the webhook carries Discord's secret in its path: https only, except a loopback stand-in (tests) */
export function webhookSafe(url: string): boolean {
  try { const u = new URL(url); return u.protocol === "https:" || (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)); } catch { return false; }
}
export type Posted = { ok: true } | { ok: false; error: string };
/** `/discord <text>`: the webhook, only when allowed and set. Never logs the address */
export async function postDiscord(text: string, s: TeamSettings = getTeam(), url = process.env.DISCORD_WEBHOOK ?? ""): Promise<Posted> {
  if (s.speak.discord !== "any") return { ok: false, error: DISCORD_OFF };
  if (!/^https?:\/\/\S+$/.test(url.trim())) return { ok: false, error: "Discord is not set up on this machine yet (no webhook)" };
  if (!webhookSafe(url.trim())) return { ok: false, error: "the Discord webhook address must start with https:// (it carries a secret)" };
  const name = s.me.name || s.me.login || "someone";
  const body = { content: text.slice(0, 2000), username: `${name}'s agent (for ${name})`.slice(0, 80), allowed_mentions: { parse: [] } };
  try {
    const r = await fetch(url.trim(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    return r.ok ? { ok: true } : { ok: false, error: `Discord did not take it (${r.status})` };
  } catch {
    return { ok: false, error: "Discord could not be reached" };
  }
}

export type Said = { ok: true; line: TalkLine; sent: boolean } | { ok: false; error: string };
/** a line typed in the chat (team.talk): `/discord ` goes out first, then the line is said as the person. `fileRaw`, the
 *  face's `file { name, bytes, kind }` (#315), is checked, written into the room's record, and named on the line */
export async function typed(threadRaw: unknown, textRaw: unknown, s: TeamSettings = getTeam(), fileRaw?: unknown, d: AttachDeps | null = null): Promise<Said> {
  const thread = threadOf(threadRaw);
  if (!thread) return { ok: false, error: "no such thread" };
  let text = cleanText(textRaw);
  const att = fileRaw === undefined || fileRaw === null ? null : attachmentOf(fileRaw);
  if (att && "error" in att) return { ok: false, error: att.error };
  if (!text && !att) return { ok: false, error: "nothing to say" };
  if (!s.me.login) return { ok: false, error: "who you are comes from GitHub: sign in first (Settings, my accounts)" };
  const out = /^\/discord(?:\s+|$)/i.test(text);
  if (out) {
    if (thread !== "general") return { ok: false, error: "a line goes to Discord from general only" };
    if (att) return { ok: false, error: "a file does not go to Discord: send it without /discord" };
    text = text.replace(/^\/discord\s*/i, "").trim();
    if (!text) return { ok: false, error: "nothing to send to Discord" };
    const p = await postDiscord(text, s);
    if (!p.ok) return p;
  }
  const id = randomUUID();
  let file: TalkFile | undefined, undo = async () => {};
  if (att) {
    const w = await attach(d ?? attachDeps(), id, att);
    if ("error" in w) return { ok: false, error: w.error };
    ({ file, undo } = w);
  }
  // a line with a file goes first and is kept only when it went: else its file comes back out of the record
  const { line, sent } = say(thread, text, s, false, { id, ...(out ? { to: "discord" as const } : {}), ...(file ? { file } : {}) }, !!file);
  if (file && !sent) { await undo(); return { ok: false, error: NOT_IN_SIGHT }; }
  return { ok: true, line, sent };
}

// ---- attachments (#315) ----
/** a file the face sent, checked: its name, its bytes, image or file, the extension its path gets, its type */
export type Attachment = { name: string; data: Buffer; kind: "image" | "file"; ext: string; mime: string };
const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const FILE_MIME: Record<string, string> = { pdf: "application/pdf", txt: "text/plain", md: "text/plain", csv: "text/csv", json: "application/json" };
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** the picture a file's first bytes say it is: png, jpg, gif or webp; "" when they say none (pure) */
export function magicOf(b: Uint8Array): "png" | "jpg" | "gif" | "webp" | "" {
  const at = (i: number, s: string) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 6 && (at(0, "GIF87a") || at(0, "GIF89a"))) return "gif";
  if (b.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return "webp";
  return "";
}
/** a file's extension from its name: the last dotted part, lower case, 1 to 8 letters and digits; else "bin" (pure) */
export const extOf = (name: string) => { const m = /\.([^./]+)$/.exec(name); const e = m ? m[1].toLowerCase() : ""; return /^[a-z0-9]{1,8}$/.test(e) ? e : "bin"; };
/** the face's `file { name, bytes, kind }` checked (pure): a name of one line, 100 characters, no `/`; bytes base64 of
 *  5 MB at most; an image only when its first bytes say png, jpeg, gif or webp (else it goes as a file) */
export function attachmentOf(v: unknown): Attachment | { error: string } {
  const f = (v && typeof v === "object" ? v : {}) as { name?: unknown; bytes?: unknown; kind?: unknown };
  const name = typeof f.name === "string" ? f.name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim() : "";
  if (!name) return { error: "a file needs a name" };
  if (name.length > TALK_FILE_NAME_MAX || name.includes("/")) return { error: `a file's name is one line of ${TALK_FILE_NAME_MAX} characters at most, with no /` };
  if (typeof f.bytes !== "string" || !B64.test(f.bytes)) return { error: "that file did not come through; pick it again" };
  if (f.bytes.length > Math.ceil(TALK_FILE_MAX / 3) * 4 + 4) return { error: "a file is 5 MB at most; put a big one on Google Drive and add its link" };
  const data = Buffer.from(f.bytes, "base64");
  if (data.toString("base64") !== f.bytes) return { error: "that file did not come through; pick it again" };   // base64 as a browser writes it, nothing else
  if (data.length > TALK_FILE_MAX) return { error: "a file is 5 MB at most; put a big one on Google Drive and add its link" };
  if (!data.length) return { error: "that file is empty" };
  const pic = f.kind === "file" ? "" : magicOf(data);
  return pic ? { name, data, kind: "image", ext: pic, mime: IMAGE_MIME[pic] } : { name, data, kind: "file", ext: extOf(name), mime: FILE_MIME[extOf(name)] ?? "application/octet-stream" };
}

/** where an attachment goes: the room's record (its files verb), its name (`cloud:<code>`, `drive:<folder>`, a
 *  repository, "" none) and its branch. Handed in, so the tests write to a fake record */
export type AttachDeps = { record: () => Pick<RoomRecord, "files">; repo: () => string; branch: (repo: string) => Promise<string>;
  up?: () => boolean;   // is the group in sight (the relay up): a file is written only when its line can go at once
  quarantine?: (path: string) => Promise<void> };   // a copy made to open is marked as from elsewhere (macOS); tests fake it
/** an attachment's place in the record (pure) */
export const talkPath = (id: string, ext: string) => `.sol/talk/${id}.${ext}`;
/** attachments a room keeps (the cloud refuses past it in its own write; a GitHub or Drive room is counted here) */
export const ATTACHMENTS_MAX = 150;
const NO_ROOM = "this group has no record yet, so it cannot keep a file";
const wordOf = (e: unknown) => String((e as { full?: string })?.full ?? (e as Error)?.message ?? e).split("\n")[0].replace(/\s*\(HTTP \d{3}\)\s*$/, "").trim().slice(0, 200);
const statusOf = (e: unknown) => Number((e as { status?: number })?.status ?? /\(HTTP (\d{3})\)\s*$/.exec(String((e as { full?: string })?.full ?? (e as Error)?.message ?? ""))?.[1] ?? 0);

/** an attachment written into the room's record at `.sol/talk/<id>.<ext>`; what the line says of it, or the refusal in
 *  one sentence (the cloud's own words for its limits) */
export async function attach(d: AttachDeps, id: string, a: Attachment): Promise<{ file: TalkFile; undo: () => Promise<void> } | { error: string }> {
  const repo = d.repo();
  if (!repo) return { error: NO_ROOM };
  const path = talkPath(id, a.ext);
  if (!TALK_FILE_PATH.test(path)) return { error: "that file could not be named" };
  if (d.up && !d.up()) return { error: NOT_IN_SIGHT };
  let undo = async () => {};
  try {
    const branch = await d.branch(repo);
    // a GitHub room's repository and a Drive room's folder are counted here; the cloud counts inside its own write
    if (!repo.startsWith("cloud:")) {
      const listed = await d.record().files.list(repo, ".sol/talk", branch).then((t) => { try { const v = JSON.parse(t); return Array.isArray(v) ? v.length : 0; } catch { return 0; } },
        (e) => (statusOf(e) === 404 || /not found/i.test(wordOf(e)) ? 0 : Promise.reject(e)));
      if (listed >= ATTACHMENTS_MAX) return { error: `this group keeps ${ATTACHMENTS_MAX} attachments at most: remove an old attachment or put it on Drive` };
    }
    const out = await d.record().files.putBody(repo, path, { message: `talk: an attachment, ${a.kind === "image" ? "an image" : a.name.slice(0, 60)}`, branch, content: a.data.toString("base64") });
    // its version as the record said it, so a line that then could not go takes its file back out (the review's P2-10)
    const sha = (() => { try { const v = JSON.parse(out); return String(v?.content?.sha ?? v?.sha ?? ""); } catch { return String(out ?? "").trim(); } })();
    const rm = d.record().files.remove;
    undo = async () => { await rm?.(repo, path, { message: "talk: an attachment that did not go, taken out", branch, sha }).catch(() => {}); };
  } catch (e) {
    const st = statusOf(e);
    if (st === 401 || st === 403) return { error: "you can't write to this group's record yet, so the file was not sent" };
    return { error: wordOf(e) || "the file was not sent" };
  }
  return { file: { path, name: a.name, size: a.data.length, kind: a.kind }, undo };
}
const NOT_IN_SIGHT = "the group is not in sight right now, so the file was not sent; send it again when it is back";
// the real record, the room in use's (set by wire.ts, which knows the record and the branch; never imported here, so
// this file stays loadable without the record's gh)
let attachDeps: () => AttachDeps = () => ({ record: () => { throw new Error(NO_ROOM); }, repo: () => "", branch: async () => "main" });
/** wire.ts hands in the room's record: where an attachment is written and read */
export function setAttachDeps(fn: () => AttachDeps) { attachDeps = fn; }

/** may the system open this kind of file with its own app (pure)? Documents, pictures, sound and video: yes. Anything
 *  that could run (a script, an app, an installer, a page with its scripts) is shown in Finder instead, never opened */
// not a zip (Archive Utility unpacks whatever is inside) and not an Office or iWork file (their macros and links): those
// are shown in Finder, as anything else is (the review's P1-2)
// nor a csv (a spreadsheet app runs a cell that starts with "=": the second review)
export const OPENABLE = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "pdf", "txt", "md", "json", "rtf", "mp3", "m4a", "wav", "mp4", "mov"]);
/** where the copies made to open live: beside the talk, never inside a room's folder */
export const CACHE_DIR = () => join(STATE_DIR, "talk-files");
/** a copy marked as come from elsewhere, so macOS's Gatekeeper asks before anything in it runs (xattr; nothing elsewhere) */
let saidXattr = false;
export const quarantine = (path: string, now = Date.now()) => new Promise<void>((ok) => {
  if (process.platform !== "darwin") return ok();
  // by its full path: never a program of the same name earlier on PATH
  execFile("/usr/bin/xattr", ["-w", "com.apple.quarantine", `0081;${Math.floor(now / 1000).toString(16)};Sol;`, path], (e) => {
    if (e && !saidXattr) { saidXattr = true; console.log(`talk: a copy to open could not be marked as from elsewhere (${String(e.message).split("\n")[0].slice(0, 120)})`); }
    ok();
  });
});
/** the copies made to open, gone a day after they were made (at engine start and once a day, wire.ts) */
export function sweepCache(dir = CACHE_DIR(), now = Date.now(), maxAge = 86_400_000): number {
  let n = 0;
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return 0; }
  for (const x of names) {
    try { if (now - statSync(join(dir, x)).mtimeMs > maxAge) { rmSync(join(dir, x), { recursive: true, force: true }); n++; } } catch { /* gone */ }
  }
  return n;
}
export type TalkFileRead = { path: string; mime: string; size: number; bytes?: string; local?: string; open?: "open" | "reveal" } | { error: string };
/** one attachment for the face (`team.talk.file`, #315): only a path under `.sol/talk/` of the room in use's record,
 *  5 MB at most. Its bytes (base64) and type for a thumbnail; or, to open it, a copy in this engine's own cache folder
 *  (0600, under the line's id, named as it was sent with the path's extension) and whether the system may open it */
export async function readTalkFile(d: AttachDeps, pathRaw: unknown, o: { open?: boolean; name?: unknown; cache?: string } = {}): Promise<TalkFileRead> {
  const path = typeof pathRaw === "string" ? pathRaw : "";
  if (!TALK_FILE_PATH.test(path)) return { error: "that is not a file of this group's talk" };
  const repo = d.repo();
  if (!repo) return { error: NO_ROOM };
  let data: Buffer;
  try {
    // its size from the folder's list first: a file past 5 MB (a GitHub room's repository takes anything) is never read whole
    const branch = await d.branch(repo);
    const listed = await d.record().files.list(repo, ".sol/talk", branch).then((t) => { try { const v = JSON.parse(t); return Array.isArray(v) ? v as { name?: string; path?: string; size?: number }[] : []; } catch { return []; } });
    const at = listed.find((x) => x.path === path || x.name === basename(path));
    if (!at) return { error: "that file is not in the group any more" };
    if (Number(at.size) > TALK_FILE_MAX) return { error: "that file is over 5 MB; it was not read" };
    data = await d.record().files.bytes(repo, path, branch);
  }
  catch (e) { return { error: statusOf(e) === 404 || /not found/i.test(wordOf(e)) ? "that file is not in the group any more" : `couldn't read it: ${wordOf(e)}` }; }
  if (data.length > TALK_FILE_MAX) return { error: "that file is over 5 MB; it was not read" };
  const ext = path.slice(path.lastIndexOf(".") + 1), pic = magicOf(data);
  const mime = pic ? IMAGE_MIME[pic] : FILE_MIME[ext] ?? "application/octet-stream";
  if (!o.open) return { path, mime, size: data.length, bytes: data.toString("base64") };
  const id = basename(path).slice(0, -(ext.length + 1));
  const given = typeof o.name === "string" ? (o.name.split("/").pop() ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").trim() : "";
  // the name as sent is a label only: its dots go, and the extension is always the path's, which the record holds
  const stem = (given.replace(/\.[^.]*$/, "").replace(/\./g, "_") || "file").slice(0, 80);
  const dir = join(o.cache ?? CACHE_DIR(), id);
  const local = join(dir, `${stem}.${ext}`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(local, data, { mode: 0o600 });   // never executable: the system opens it as a document or not at all
    await (d.quarantine ?? quarantine)(local);
  } catch (e) { return { error: `couldn't keep a copy to open: ${wordOf(e)}` }; }
  return { path, mime, size: data.length, local, open: OPENABLE.has(ext) ? "open" : "reveal" };
}

// ---- older lines from the cloud (#315) ----
/** where the room in use meets: its hub's http address and code when it is a cloud I am signed in to, else null; my
 *  ticket there; fetch (the tests fake it) */
export type OlderDeps = { where: () => { hub: string; code: string } | null; ticket: (hub: string) => Promise<string>; fetch?: typeof fetch };
/** a page of a thread's older lines, said before the cursor (`before` ms and `beforeId`, the oldest line the face has
 *  that the hub stamped), from the cloud's route with my ticket, long lines whole, every line it gave (never cut to
 *  200): never merged into the 200 kept here. `next` is the cursor for the page before. A room not on a cloud has none */
export type Cursor = { at: number; id: string };
export async function olderLines(d: OlderDeps, threadRaw: unknown, before: unknown, beforeId: unknown = ""): Promise<{ lines: TalkLine[]; more: boolean; next?: Cursor } | { error: string }> {
  const thread = threadOf(threadRaw), b = Number(before), bid = typeof beforeId === "string" && /^[\w-]{0,80}$/.test(beforeId) ? beforeId : "";
  if (!thread) return { error: "no such thread" };
  if (!Number.isFinite(b) || b <= 0) return { error: "older than when?" };
  const at = d.where();
  if (!at) return { lines: [], more: false };
  const t = await d.ticket(at.hub).catch(() => "");
  if (!t) return { error: "sign in to Sol to read older lines" };
  try {
    const r = await (d.fetch ?? globalThis.fetch)(`${at.hub.replace(/\/+$/, "")}/rooms/${at.code}/talk?thread=${encodeURIComponent(thread)}&before=${Math.floor(b)}&id=${encodeURIComponent(bid)}&limit=${CAP}`,
      { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { error: r.status === 404 ? "you are not in this group on the cloud (or it is gone)" : `the cloud said ${r.status}` };
    const v = await r.json() as { lines?: unknown; more?: unknown; next?: { at?: unknown; id?: unknown } };
    const room = roomNow();
    const lines = (Array.isArray(v.lines) ? v.lines : []).map((x) => lineFromRelay(x as RelayMsg)).filter((l): l is TalkLine => !!l && l.thread === thread).map((l) => ({ ...l, room }));
    const next = v.next && typeof v.next.at === "number" && typeof v.next.id === "string" && /^[\w-]{1,80}$/.test(v.next.id) ? { at: v.next.at, id: v.next.id } : undefined;
    return { lines, more: v.more === true && !!next, ...(next ? { next } : {}) };
  } catch { return { error: "the cloud did not answer" }; }
}

// ---- the seats' tool ----
const tx = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });
export const TALK_TOOLS = [
  {
    name: "talk",
    description: "Say one line in the team's chat in Sol (Cowork's group chat), signed as the person's agent. thread is " +
      "\"general\" or an issue's thread like \"#31\". Only for something the team should read (a build is up, a question for " +
      "a teammate); never progress chatter. It goes to the team's chat only, never to Discord or WhatsApp.",
    shape: {
      thread: z.string().describe("\"general\", or \"#<issue number>\" for that issue's thread."),
      line: z.string().describe("The line, in your own words, plain text."),
    },
  },
];
/** the seat says a line: dropped with the refusal when the person's setting says no (pure but for saying it) */
export async function runTalkTool(name: string, args: unknown, turn: TurnCtx = {}, s: TeamSettings = getTeam()): Promise<ToolResult> {
  if (name !== "talk") return tx(`Unknown tool: ${name}`, true);
  const a = (args ?? {}) as { thread?: unknown; line?: unknown };
  if (!mayAgentSpeak(s, "cowork")) return tx(COWORK_OFF, true);
  const thread = threadOf(a.thread ?? "general");
  if (!thread) return tx("thread is \"general\" or \"#<issue number>\".", true);
  const text = cleanText(a.line);
  if (!text) return tx("A line needs words.", true);
  if (!s.me.login) return tx("Who you speak for is not known yet (no GitHub login in Sol); the line was not said.", true);
  const { line, sent } = say(thread, text, s, true);
  turn.sink?.({ id: line.id, kind: "desk", text: `saying in ${thread}: ${text.slice(0, 80)}`, done: true, ok: true });
  return tx(sent ? `Said in ${thread}, signed ${line.from}.` : `Said in ${thread}, signed ${line.from}; the team is not in sight right now, so only this machine has it.`);
}

// ---- the bridges: export files read into general ----
const LRM = /[‎‏‪-‮⁦-⁩﻿]/g;
const SPACE = /[   ]/g;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export type Order = "dmy" | "mdy";
const DATE = String.raw`[0-9A-Za-z]{1,4}[\/.\-][0-9A-Za-z]{1,4}[\/.\-]\d{2,4}\.?`;
const TIME = String.raw`\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[AaPp]\.?\s?[Mm]\.?)?`;

/** which comes first in a file's dates, day or month: a part over 12 says; else a 12-hour clock says month (US) */
export function orderOf(dates: string[], times: string[] = []): Order {
  for (const d of dates) {
    const p = d.split(/[\/.\-]/);
    if (p[0].length === 4 || /[A-Za-z]/.test(d)) continue;
    if (Number(p[0]) > 12) return "dmy";
    if (Number(p[1]) > 12) return "mdy";
  }
  return times.some((t) => /[AaPp]\.?\s?[Mm]/.test(t)) ? "mdy" : "dmy";
}
/** a date and a time as written in an export (two locales and more) into ms, local time; NaN when it is not one */
export function when(date: string, time: string, order: Order): number {
  const p = date.replace(/\.$/, "").split(/[\/.\-]/);
  if (p.length !== 3) return NaN;
  let y: number, m: number, d: number;
  const named = p.findIndex((x) => /^[A-Za-z]{3,}/.test(x));
  if (named >= 0) {
    m = MONTHS.indexOf(p[named].slice(0, 3).toLowerCase()) + 1;
    const rest = p.filter((_, i) => i !== named).map(Number);
    [d, y] = rest[0] > 31 ? [rest[1], rest[0]] : [rest[0], rest[1]];
  } else if (p[0].length === 4) [y, m, d] = p.map(Number);
  else [d, m, y] = order === "dmy" ? [Number(p[0]), Number(p[1]), Number(p[2])] : [Number(p[1]), Number(p[0]), Number(p[2])];
  if (y < 100) y += 2000;
  const t = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s?(?:([AaPp])\.?\s?[Mm]\.?)?$/.exec(time.trim());
  if (!t || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return NaN;
  let h = Number(t[1]);
  if (t[4]) { const pm = t[4].toLowerCase() === "p"; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  const at = new Date(y, m - 1, d, h, Number(t[2]), Number(t[3] ?? 0)).getTime();
  return h > 23 ? NaN : at;
}
const lineId = (source: Source, at: number, from: string, text: string) => createHash("sha1").update(`${source}\0${at}\0${from}\0${text}`).digest("hex").slice(0, 20);
const bridged = (source: Source, name: string, at: number, text: string): TalkLine => {
  const from = `${source}: ${name.trim().slice(0, 60)}`;
  return { id: lineId(source, at, from, text), thread: "general", from, at, text: text.slice(0, TEXT_MAX), source };
};

/** WhatsApp's own notes. An iPhone export puts the group's name in front, so they look like messages; it also puts an
 *  invisible mark right after the colon, kept here as \u0001 before the marks are stripped */
const NOTE = /^(\u0001|messages and calls are end-to-end encrypted|.{1,60} (created group|changed the subject|changed this group's|changed the group description|joined using this group's invite link)\b)/i;

/** WhatsApp's "export chat" text: `[date, time] name: text` (iPhone) or `date, time - name: text` (Android); a line
 *  without a header goes on the message before it; lines with no name (WhatsApp's own notes) are left out */
export function parseWhatsApp(raw: string): TalkLine[] {
  const head = new RegExp(String.raw`^\[?(${DATE}),?\s+(${TIME})\]?(?:\s+[-–]\s+|\s+)([\s\S]*)$`);
  const rows = raw.replace(/: ?\u200e/g, ": \u0001").replace(LRM, "").replace(SPACE, " ").replace(/\r\n?/g, "\n").split("\n");
  const found = rows.map((r) => head.exec(r));
  const order = orderOf(found.filter(Boolean).map((m) => m![1]), found.filter(Boolean).map((m) => m![2]));
  const out: { name: string; at: number; text: string[] }[] = [];
  let cur: (typeof out)[number] | null = null;
  rows.forEach((r, i) => {
    const m = found[i];
    if (m) {
      cur = null;
      const said = /^([^:\n]{1,60}?):\s?([\s\S]*)$/.exec(m[3]);
      const at = when(m[1], m[2], order);
      if (!said || Number.isNaN(at) || NOTE.test(said[2].trim())) return;   // WhatsApp's own notes, with or without the group's name
      cur = { name: said[1], at, text: [said[2]] };
      out.push(cur);
    } else if (cur) (cur as { text: string[] }).text.push(r);
  });
  return out.map((x) => ({ ...x, body: x.text.join("\n").trim() })).filter((x) => x.body && x.name.trim()).map((x) => bridged("whatsapp", x.name, x.at, x.body));
}

/** a Discord export: DiscordChatExporter's JSON or plain text (`[date time] name` then the lines), or a channel log
 *  copied out of Discord (`name — date time` / `name — Today at 14:03`, then the lines). `now` dates "Today" */
export function parseDiscord(raw: string, now = Date.now()): TalkLine[] {
  const s = raw.replace(LRM, "").replace(/^\s+/, "");
  if (s.startsWith("{") || s.startsWith("[{") || s.startsWith("[\n") || s === "[]") {
    try { return discordJson(JSON.parse(s)); } catch { /* text after all */ }
  }
  const rows = s.replace(SPACE, " ").replace(/\r\n?/g, "\n").split("\n");
  const exporter = new RegExp(String.raw`^\[(${DATE})\s+(${TIME})\]\s+(.{1,80})$`);
  const copied = new RegExp(String.raw`^(.{1,60}?)\s+[—–-]\s+(?:(Today|Yesterday) at|(${DATE}))\s+(${TIME})$`);
  const heads = rows.map((r) => exporter.exec(r) ?? copied.exec(r));
  const order = orderOf(heads.filter(Boolean).map((m) => (m!.length === 4 ? m![1] : m![3] ?? "")).filter(Boolean), heads.filter(Boolean).map((m) => (m!.length === 4 ? m![2] : m![4])));
  const day = (back: number) => { const d = new Date(now); d.setDate(d.getDate() - back); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const out: { name: string; at: number; text: string[] }[] = [];
  let cur: (typeof out)[number] | null = null;
  rows.forEach((r, i) => {
    const m = heads[i];
    if (m) {
      const [name, date, time] = m.length === 4 ? [m[3], m[1], m[2]] : [m[1], m[3] ?? day(m[2] === "Yesterday" ? 1 : 0), m[4]];
      const at = when(date, time, order);
      cur = Number.isNaN(at) ? null : { name: name.replace(/#\d{4}$/, "").replace(/\s+\(pinned\)$/, ""), at, text: [] };
      if (cur) out.push(cur);
      return;
    }
    if (!cur) return;   // the exporter's head (Guild:, Channel:, ====)
    if (/^\{(Attachments|Embed|Reactions|Stickers)\}$/.test(r.trim()) || /^Exported \d+ message\(s\)/.test(r.trim()) || /^=+$/.test(r.trim())) return;
    (cur as { text: string[] }).text.push(r);
  });
  return out.map((x) => ({ ...x, body: x.text.join("\n").trim() })).filter((x) => x.body).map((x) => bridged("discord", x.name, x.at, x.body));
}
function discordJson(v: any): TalkLine[] {
  const msgs: any[] = Array.isArray(v) ? v : Array.isArray(v?.messages) ? v.messages : [];
  const out: TalkLine[] = [];
  for (const m of msgs) {
    const at = Date.parse(String(m?.timestamp ?? ""));
    const name = String(m?.author?.nickname || m?.author?.name || m?.author?.username || "").trim();
    const att = Array.isArray(m?.attachments) && m.attachments.length ? `[${m.attachments.length} attachment${m.attachments.length > 1 ? "s" : ""}]` : "";
    const text = [cleanText(m?.content), att].filter(Boolean).join("\n");
    if (!Number.isNaN(at) && name && text) out.push(bridged("discord", name, at, text));
  }
  return out;
}

/** every line in the two bridge folders, read again only when a file changed (size and time) */
export function bridgeLines(): TalkLine[] {
  const want = new Set<string>();
  const read = (dir: string, ok: RegExp, parse: (raw: string, mtime: number) => TalkLine[]) => {
    let names: string[] = [];
    try { names = readdirSync(dir).filter((n) => ok.test(n) && !n.startsWith(".")); } catch { return; }
    for (const n of names) {
      const f = join(dir, n);
      try {
        const st = statSync(f);
        if (!st.isFile() || st.size > 20 * 1024 * 1024) continue;
        want.add(f);
        const key = `${st.size}:${st.mtimeMs}`;
        if (bridgeFiles.get(f)?.key === key) continue;
        bridgeFiles.set(f, { key, lines: parse(readFileSync(f, "utf8"), st.mtimeMs) });
      } catch { /* gone between the list and the read */ }
    }
  };
  read(join(HOME, "talk", "discord"), /\.(txt|json)$/i, (raw, t) => parseDiscord(raw, t));
  read(join(HOME, "talk", "whatsapp"), /\.txt$/i, (raw) => parseWhatsApp(raw));
  for (const f of [...bridgeFiles.keys()]) if (!want.has(f)) bridgeFiles.delete(f);
  const all = new Map<string, TalkLine>();
  for (const { lines } of bridgeFiles.values()) for (const l of lines) all.set(l.id, l);   // the same export twice is one
  return [...all.values()].sort((a, b) => a.at - b.at).slice(-CAP);
}

/** the folder watch: new bridge lines since the last look are told to the faces (the first look only seeds) */
export function lookAtBridges(): TalkLine[] {
  const now = bridgeLines();
  if (!bridgeSeen) { bridgeSeen = new Set(now.map((l) => l.id)); return []; }
  const fresh = now.filter((l) => !bridgeSeen!.has(l.id));
  for (const l of fresh) { bridgeSeen.add(l.id); for (const f of subs) f(l); }
  return fresh;
}
let watching: NodeJS.Timeout | undefined;
/** look every 15 s once a face has opened the chat */
export function watchBridges() {
  if (watching) return;
  lookAtBridges();
  watching = setInterval(() => { try { lookAtBridges(); } catch { /* a bad file is skipped next time too */ } }, 15_000);
  watching.unref();
}
