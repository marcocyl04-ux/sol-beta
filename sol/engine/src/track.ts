// Tracking (#356, from the research in #351): how Sol is used, as counts, never as words.
// Every message a face sends the engine and every message the engine sends back passes here once (index.ts: the
// socket's "message" handler and send()). A table says which become an event and which fields are kept; a field
// not in the table is never written, so text, audio, files, paths and addresses cannot leak by mistake. A value the
// table does keep must still be small and plain (a number, a boolean, a word, a hash): one that is not drops the whole
// event and counts a `track.dropped`, so a wrong line in the table shows up as a number, not as a leak.
//
// One event is one JSON line in home/track/<day>.jsonl (the Mac's local day), with seven fixed fields and props; what the
// other tools' files say (src/track-files.ts) goes to home/track/<day>-files.jsonl, its own file with its own cap, so a
// first scan's backlog never starves the day's real events:
//   { at, tester, sol, face, mode, seat, name, props? }
//   tester  a random code made once on this Mac (home/track/id), the key of every line; who it is rides beside it:
//           the first line of each day's file is a tester.who (the Sol name on the team's cloud, the Mac's user name),
//           and the same two go as headers with each post. Not anonymous (Frank 2026-10-29): the team analyses by person
//   sol     the engine's commit, set by index.ts at start
//   face    window | notch | phone, from the socket's hello; "" before one
//   mode    home | work | cowork, from the message's family (work.*, team.*, the rest)
//   seat    claude | codex | ""
// Event names are fixed and only ever added to, never renamed, so week one can be compared with week four.
// Raw events, never daily sums: a sum answers only the question it was designed for.
//
// The Mac keeps 90 days. Once an hour, the days before today that were not sent yet go to one address as one POST
// each (newline-delimited JSON, the tester code, the day and the file's SHA-256 in headers, so the box can refuse a
// repeat); a file that went is renamed .sent. With no address set, nothing is sent and the files only age out.
// settings.track.usage off (by hand in engine/settings.json, when a tester asks in Discord): nothing is written or sent.
// The face has no switch: one card on the first window says what is counted, one button (#356, Frank 2026-10-29).
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { DEFAULTS as ARRANGE, SHELF } from "./arrange.js";

export type Mode = "home" | "work" | "cowork";
export type Props = Record<string, number | boolean | string>;
export type Event = { at: string; tester: string; sol: string; face: string; mode: Mode; seat: string; name: string; props?: Props };
export type Consent = { usage: boolean };
export type Who = { name: string; user: string };   // the Sol name on the team's cloud ("" when not signed in), the Mac's user name

export const KEEP_DAYS = 90;
export const SEND_EVERY_MS = 60 * 60_000;
export const MAX_WORD = 64;
export const MAX_LINES_A_DAY = 20_000;
// a word, an id, a dotted name, a hash: letters, digits and . _ : - at most 64 long; never a space, a slash, a tilde,
// a quote or a brace, so a path, an address, a sentence or JSON cannot pass as a word
const WORD = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
// the shape of a message type: lower-case words joined by dots, at most 32 long; anything else is counted as msg.other
const TYPE = /^[a-z]+(\.[a-z]+)*$/;
// the buttons the face ships (arrange.ts DEFAULTS and the shelf, rail or not): pressed by id; a person's own button
// is pressed as own:<hash>
const SHIPPED = new Set([...Object.values(ARRANGE.presets).flatMap((p) => p.buttons).filter((b) => b !== "|"), ...SHELF]);

let HOME = "";
let VERSION = "";
let consent: () => Consent = () => ({ usage: true });
let who: () => Who = () => ({ name: "", user: "" });
let clock: () => Date = () => new Date();
let tester = "";
let warned = false;
const faces = new WeakMap<object, string>();          // socket -> window | notch | phone
const started = new Map<string, number>();            // sessionId or draft -> when its turn started (for turn.done secs)
const seen = new WeakSet<object>();                   // a message object sent to every face is counted once
const counts = new Map<string, { day: string; n: number }>();   // lines written today a file ("" the day's, "files" the other tools'), against MAX_LINES_A_DAY
export const EVERY = {};                              // the "socket" a message to every face is counted on: no face

/** Where the files go, how the engine's version is named, who says whether tracking is on, and who the person is. */
export function setTrackHome(home: string, o: { version?: string; consent?: () => Consent; who?: () => Who; now?: () => Date } = {}) {
  HOME = home;
  if (o.version !== undefined) VERSION = o.version;
  if (o.consent) consent = o.consent;
  if (o.who) who = o.who;
  if (o.now) clock = o.now;
  tester = ""; SALT = "";
  started.clear();
  counts.clear();
}
export function setTrackVersion(v: string) { VERSION = v; }
export const trackDir = () => join(HOME, "track");

/** The tester code: made once on this Mac, kept in home/track/id; the key of every line (who it is: whoNow()). */
export function testerCode(): string {
  if (tester) return tester;
  const file = join(trackDir(), "id");
  try { tester = readFileSync(file, "utf8").trim(); } catch { tester = ""; }
  if (!/^t_[a-z0-9]{10}$/.test(tester)) {
    tester = "t_" + randomBytes(8).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(10, "0").slice(0, 10);
    try { mkdirSync(trackDir(), { recursive: true }); writeFileSync(file, tester + "\n", { mode: 0o600 }); }
    catch { /* kept in memory for this run: a folder that cannot be written is told once by write() */ }
  }
  return tester;
}

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** how many lines a day's file holds already (0 when there is none) */
function linesIn(file: string): number {
  try { const t = readFileSync(file, "utf8"); let n = 0; for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) n++; return n; } catch { return 0; }
}
/** the day's file, or the day's file of one kind ("files": what the other tools' files say) */
export const dayFile = (d: Date = clock(), kind = "") => join(trackDir(), `${day(d)}${kind ? `-${kind}` : ""}.jsonl`);

// ---- what a prop may be ----
const isWord = (s: unknown): s is string => typeof s === "string" && WORD.test(s);
const num = (v: unknown, places = 0): number | undefined => (typeof v === "number" && isFinite(v) ? Math.round(v * 10 ** places) / 10 ** places : undefined);
const word = (v: unknown): string | undefined => (isWord(v) ? v : undefined);
const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
/** the length of a text in bands, never the length itself: 0, 1-20, 21-100, 101-500, 501-2000, 2001- */
export const band = (n: number): string => (n <= 0 ? "0" : n <= 20 ? "1-20" : n <= 100 ? "21-100" : n <= 500 ? "101-500" : n <= 2000 ? "501-2000" : "2001-");
/** a folder as a hash: "same project again" against "a new one", never the path */
export const hashOf = (s: string): string => createHash("sha256").update(salt()).update(s).digest("hex").slice(0, 12);
let SALT = "";
/** a secret made once on this Mac (home/track/salt), so a hash of a path cannot be guessed from a common path and the user's name */
function salt(): string {
  if (SALT || !HOME) return SALT;
  const file = join(trackDir(), "salt");
  try { SALT = readFileSync(file, "utf8").trim(); } catch { SALT = ""; }
  if (!/^[a-f0-9]{32}$/.test(SALT)) {
    SALT = randomBytes(16).toString("hex");
    try { mkdirSync(trackDir(), { recursive: true }); writeFileSync(file, SALT + "\n", { mode: 0o600 }); } catch { /* kept for this run */ }
  }
  return SALT;
}
/** a name as a word: anything that is not a letter, a digit or . _ : - becomes -, at most 64 long, "" when nothing is left */
export const asWord = (v: unknown): string => String(v ?? "").replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, MAX_WORD);
/** who this tester is, as two words: the Sol name on the team's cloud ("" when not signed in) and the Mac's user name */
export function whoNow(): Who {
  let w: Who = { name: "", user: "" };
  try { w = who(); } catch { /* unknown */ }
  return { name: asWord(w.name), user: asWord(w.user) };
}

/** Every value small and plain, or the name of the first key that is not. */
export function badProp(props: Props): string | null {
  for (const [k, v] of Object.entries(props)) {
    if (!WORD.test(k)) return k.slice(0, MAX_WORD);
    if (typeof v === "number") { if (!isFinite(v)) return k; continue; }
    if (typeof v === "boolean") continue;
    if (isWord(v)) continue;
    return k;
  }
  return null;
}

// ---- the tables ----
type Pick = (m: any) => Props | null;   // null: this one is not an event after all
type Row = { name: string; pick?: Pick };
const dropUndefined = (p: Record<string, number | boolean | string | undefined>): Props => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Props;

/** Face to engine. A type not here and not in IN_SKIP is still counted, by its type alone, with no props. */
export const IN: Record<string, Row> = {
  say: { name: "turn.say", pick: (m) => dropUndefined({ len: band(String(m.text ?? "").length), files: count(m.files), door: word(m.door) ?? "none", fresh: m.fresh === true, carried: !!m.parent, model: word(m.model), effort: word(m.effort) }) },
  stop: { name: "stop.press" },
  call: { name: "call.start", pick: (m) => dropUndefined({ door: word(m.door) ?? "none", model: word(m.model) }) },
  "call.end": { name: "call.end" },
  hear: { name: "dictation.heard", pick: (m) => (m.done === false ? null : {}) },   // the final clip only, never the partials
  dictation: { name: "dictation.switch", pick: (m) => ({ on: m.on === true }) },
  dictated: { name: "dictation.typed", pick: (m) => dropUndefined({ secs: num(m.seconds, 1), went: m.went === "clipboard" ? "clipboard" : "app" }) },
  "arrange.set": { name: "arrange.edit" },
  "arrange.undo": { name: "arrange.undo" },
  "desk.act": { name: "desk.act", pick: (m) => dropUndefined({ act: word(m.act) }) },
  "browser.open": { name: "browser.open" },
  "browser.close": { name: "browser.close" },
  "browser.navigate": { name: "browser.navigate", pick: (m) => dropUndefined({ action: word(m.action) }) },
  "face.broken": { name: "face.broken", pick: (m) => dropUndefined({ site: word(m.site) }) },
  "face.mended": { name: "face.mended", pick: (m) => dropUndefined({ site: word(m.site) }) },
  hello: { name: "face.hello", pick: (m) => dropUndefined({ face: word(m.face) }) },
  goback: { name: "goback.press" },
  run: { name: "run.press" },
  "team.room.make": { name: "room.make" },
  "team.room.join": { name: "room.join", pick: (m) => ({ how: typeof m.code === "string" ? "code" : "link" }) },
  "team.room.share": { name: "room.share" },
  "team.room.take": { name: "room.take" },
  "team.room.follow": { name: "room.follow" },
};
// too often, or a read with nothing to count: the heartbeat, focus and idle, the eye, audio frames, keystrokes in
// the browser pane, the partial dictation clips, and every get, list and peek
export const IN_SKIP = new Set(["ping", "presence", "eye", "call.audio", "browser.input", "browser.watch", "browser.select", "list", "open", "models", "arrange.get", "desk.get", "goback.plan", "run.stop", "notify.seen", "notify.ack"]);
const quietIn = (t: string) => IN_SKIP.has(t) || /\.(get|list|peek|state|poll)$/.test(t) || t.startsWith("eye.");

/** Engine to face. Only what is here is counted: the rest is the stream itself (text, frames, lists, output). */
export const OUT: Record<string, Row> = {
  start: { name: "turn.start" },
  done: { name: "turn.done", pick: (m) => dropUndefined({ ok: m.ok === true, stopped: m.stopped === true, turns: num(m.turns) }) },
  usage: { name: "turn.usage", pick: (m) => dropUndefined({ context_k: num(typeof m.context === "number" ? m.context / 1000 : undefined, 1), window_k: num(typeof m.window === "number" ? m.window / 1000 : undefined) }) },
  tool: { name: "turn.tool", pick: (m) => (m.done ? dropUndefined({ kind: word(m.kind), ok: m.ok !== false }) : null) },
  error: { name: "error", pick: () => ({ kind: "engine" }) },
  "work.error": { name: "error", pick: () => ({ kind: "work" }) },
  "team.error": { name: "error", pick: () => ({ kind: "team" }) },
  notify: { name: "ping.sent", pick: (m) => dropUndefined({ dest: word(m.dest) }) },
  engine: { name: "engine.up", pick: (m) => (m.phase === "up" ? {} : null) },
  "goback.done": { name: "goback.done", pick: (m) => ({ ok: m.ok === true }) },
  changing: { name: "face.changed", pick: (m) => (m.done ? dropUndefined({ kind: word(m.kind), ok: m.ok !== false }) : null) },
  "arrange.changed": { name: "arrange.changed", pick: (m) => dropUndefined({ refused: m.refused === true, undone: !!m.undo }) },
  "team.pinged": { name: "ping.got", pick: (m) => ({ spooled: m.spooled === true }) },
  "team.feed.line": { name: "feed.line" },
  "team.talk.line": { name: "talk.line" },
  "team.letin": { name: "letin.asked", pick: (m) => ({ asks: count(m.asks) }) },
};
const modeOf = (t: string): Mode => (t.startsWith("work.") ? "work" : t.startsWith("team.") ? "cowork" : "home");
const seatOf = (m: any): string => (m?.seat === "claude" || m?.seat === "codex" ? m.seat : "");

// ---- writing ----
/** true when the line (or the capped line) was written; false when the day is full or the folder cannot be written */
function write(e: Event, kind = ""): boolean {
  if (!HOME) return false;
  try {
    const d = day(clock()), file = dayFile(clock(), kind);
    let c = counts.get(kind);
    if (!c || c.day !== d) { c = { day: d, n: linesIn(file) }; counts.set(kind, c); }   // after a restart mid-day, the file's count
    if (c.n >= MAX_LINES_A_DAY) {   // a socket that floods counts as one line, then nothing more today
      if (c.n === MAX_LINES_A_DAY) { c.n++; e = { ...e, name: "track.capped", props: { lines: MAX_LINES_A_DAY } }; }
      else return false;
    } else c.n++;
    mkdirSync(trackDir(), { recursive: true });
    if (c.n === 1 && e.name !== "tester.who") {   // a day's first line says who: the name on the cloud and the Mac's user (not against the cap)
      const w = whoNow();
      appendFileSync(file, JSON.stringify({ ...e, face: "", mode: "home", seat: "", name: "tester.who", props: { name: w.name || "none", user: w.user || "none" } }) + "\n");
    }
    appendFileSync(file, JSON.stringify(e) + "\n");
    return true;
  } catch (err) {
    if (!warned) { warned = true; console.log(`track: not written: ${err instanceof Error ? err.message : err}`); }
    return false;
  }
}

/** One event. Props that are not small and plain drop it and count a track.dropped instead. Null when nothing was written
 *  (usage off, the day full, the folder unwritable). ctx.kind: "files" writes to the day's -files file (src/track-files.ts). */
export function track(name: string, props: Props = {}, ctx: { face?: string; mode?: Mode; seat?: string; kind?: string } = {}): Event | null {
  if (!HOME) return null;
  try {
    if (!consent().usage) return null;
    const bad = isWord(name) ? badProp(props) : "name";
    const e: Event = { at: clock().toISOString(), tester: testerCode(), sol: VERSION, face: ctx.face ?? "", mode: ctx.mode ?? "home", seat: ctx.seat ?? "", name, props };
    if (bad !== null) { e.name = "track.dropped"; e.props = { event: isWord(name) ? name : "unknown", prop: isWord(bad) ? bad : "unknown" }; }
    else if (!Object.keys(props).length) delete e.props;
    return write(e, ctx.kind ?? "") ? e : null;
  } catch (err) {   // never the engine's problem: a count that cannot be made is a count lost
    if (!warned) { warned = true; console.log(`track: not counted: ${err instanceof Error ? err.message : err}`); }
    return null;
  }
}

/** A message from a face. `from` is the socket, so the face it said hello as is remembered. */
export function trackIn(from: object, m: any): void {
  if (!HOME) return;
  try {
    const t = typeof m?.type === "string" ? m.type : "";
    if (!t) return;
    if (t === "hello" && (m.face === "window" || m.face === "notch" || m.face === "phone")) faces.set(from, m.face);
    const ctx = { face: faces.get(from) ?? "", mode: modeOf(t), seat: seatOf(m) };
    if (t === "arrange.used") {   // the rails' presses, batched a minute by the face: one event per button
      const counts = m.counts && typeof m.counts === "object" ? m.counts : {};
      for (const [id, n] of Object.entries(counts)) {
        if (typeof n !== "number" || !(n > 0)) continue;
        // a shipped button by its id; a person's own button (its id is a name an agent picked from their words) as a hash
        track("button.press", { id: SHIPPED.has(id) ? id : `own:${hashOf(id)}`, n: Math.round(n) }, ctx);
      }
      return;
    }
    const row = IN[t];
    if (row) {
      const props = row.pick ? row.pick(m) : {};
      if (props) track(row.name, props, ctx);
      return;
    }
    if (quietIn(t)) return;
    // counted by its type alone, so a new message kind is never silently lost; a type that is not shaped like one
    // (any socket may connect and send anything) is msg.other
    track(TYPE.test(t) && t.length <= 32 ? `msg.${t}` : "msg.other", {}, ctx);
  } catch (err) {
    if (!warned) { warned = true; console.log(`track: not counted: ${err instanceof Error ? err.message : err}`); }
  }
}

/** A message to a face. A message to every face is counted once. */
export function trackOut(to: object, m: any): void {
  if (!HOME || !m || typeof m !== "object") return;
  try {
    const t = typeof m.type === "string" ? m.type : "";
    if (!t || seen.has(m)) return;
    seen.add(m);
    const row = OUT[t];
    if (!row) return;
    const ctx = { face: faces.get(to) ?? "", mode: modeOf(t), seat: seatOf(m) };
    let props = row.pick ? row.pick(m) : {};
    if (!props) return;
    const key = typeof m.sessionId === "string" ? m.sessionId : typeof m.draft === "string" ? m.draft : "";
    const at = clock().getTime();
    if (t === "start" && key) {
      started.set(key, at);
      for (const [k, s] of started) if (at - s > 6 * 3_600_000) started.delete(k);   // a turn whose done never came (the socket went)
    }
    if (t === "done" && key) { const s = started.get(key); started.delete(key); if (s) props = { ...props, secs: Math.round((at - s) / 1000) }; }
    track(row.name, props, ctx);
  } catch (err) {
    if (!warned) { warned = true; console.log(`track: not counted: ${err instanceof Error ? err.message : err}`); }
  }
}

// ---- sending and ageing out ----
export type Sent = { sent: string[]; failed: string[]; pruned: string[] };
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})(-files)?\.jsonl$/, OLD_FILE = /^(\d{4}-\d{2}-\d{2})(-files)?(-\d+)?\.(jsonl|sent|refused)$/;
/** <day>.jsonl becomes <day>.sent (or .refused: the box said no for good); a second file for the same day (a clock that
 *  went back) keeps its own name */
function markSent(file: string, as: "sent" | "refused" = "sent") {
  let to = file.replace(/\.jsonl$/, `.${as}`);
  if (existsSync(to)) to = file.replace(/\.jsonl$/, `-${Date.now()}.${as}`);
  renameSync(file, to);
}
let sending: Promise<Sent> | null = null;   // the send under way: a second tick while it runs joins it

/**
 * The days before today that were not sent yet go to `url`, one POST each; a file that went is renamed .sent.
 * Files older than KEEP_DAYS go. No url, or usage off: only the ageing out (a day written before usage was turned
 * off stays on the Mac and ages out unsent).
 */
export function sendPending(url: string | null, f: typeof fetch = fetch): Promise<Sent> {
  if (sending) return sending;
  const p = sendNow(url, f).finally(() => { if (sending === p) sending = null; });
  sending = p;
  return p;
}
async function sendNow(url: string | null, f: typeof fetch): Promise<Sent> {
  const r: Sent = { sent: [], failed: [], pruned: [] };
  if (!HOME || !existsSync(trackDir())) return r;
  if (!consent().usage) url = null;
  const w = whoNow();
  const now = clock(), today = day(now);
  const oldest = day(new Date(now.getTime() - KEEP_DAYS * 86_400_000));
  for (const name of readdirSync(trackDir()).sort()) {
    const old = OLD_FILE.exec(name);
    if (old && old[1] < oldest) { try { unlinkSync(join(trackDir(), name)); r.pruned.push(name); } catch {} continue; }
    const m = DAY_FILE.exec(name);
    if (!m || m[1] >= today || !url) continue;
    const file = join(trackDir(), name);
    let body: string;
    try { body = readFileSync(file, "utf8"); } catch { continue; }
    if (!body.trim()) { try { markSent(file); } catch {} continue; }
    const sha = createHash("sha256").update(body).digest("hex");
    const status = await f(url, {
      method: "POST",
      headers: { "content-type": "application/x-ndjson", "x-sol-tester": testerCode(), "x-sol-day": m[1], "x-sol-sha256": sha, "x-sol-version": VERSION, "x-sol-who": w.name, "x-sol-user": w.user },
      body,
      signal: AbortSignal.timeout(20_000),
    }).then((res) => res.status, () => 0);
    const ok = (status >= 200 && status < 300) || status === 409;   // 409: the box has this one already
    // a 4xx that is not "slow down" will not change by asking again (too big, a day too old, a code the box was told to
    // refuse after a delete): kept here as .refused
    const refused = status >= 400 && status < 500 && status !== 429 && status !== 409;
    if (!ok && !refused) { r.failed.push(name); continue; }
    try { markSent(file, refused ? "refused" : "sent"); (refused ? r.failed : r.sent).push(name); } catch { r.failed.push(name); }
  }
  if (r.sent.length) track("track.sent", { files: r.sent.length });
  return r;
}

/** where a day's file goes, from the hub a Sol meets on: wss://host/relay -> https://host/relay/track; "" when there is no hub */
export function trackUrlOf(hub: string): string | null {
  const m = /^(wss?):\/\/([^/?#]+)/.exec(hub.trim());
  if (!m) return null;
  return `${m[1] === "wss" ? "https" : "http"}://${m[2]}/relay/track`;
}

let timer: NodeJS.Timeout | null = null;
/** Once at start and then every hour: send what waits, age out what is old. The address may be null: nothing is sent. */
export function startTrackSender(url: () => string | null, f: typeof fetch = fetch) {
  if (timer) clearInterval(timer);
  const tick = () => { void sendPending(url(), f).catch(() => {}); };
  setTimeout(tick, 30_000).unref();
  timer = setInterval(tick, SEND_EVERY_MS);
  timer.unref();
}
