// Talk (Together #37, PROTOCOL.md round 24): the team's group chat in Cowork. Threads (`general`, and one per issue,
// `#31`) where people, their agents and two read-only bridges meet.
//
// - The lines travel over the team relay as `talk { thread, text }`; the relay stamps who said it, so a line's
//   signature is the relay's word (`frank`, or `frank's agent`), never the sender's. The relay keeps nothing: this
//   engine keeps the last 200 lines of each thread, in memory and in STATE_DIR/talk/<thread>.json (`general.json`,
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
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolResult, TurnCtx } from "../browser.js";
import { STATE_DIR } from "../work/state.js";
import { getTeam, mayAgentSpeak, signature, type TeamSettings } from "./settings.js";
import { sendRelay, relayRoster, type RelayMsg } from "./relay.js";
import { namedIn } from "./pings.js";

export type Source = "relay" | "discord" | "whatsapp";
export type TalkLine = { id: string; thread: string; from: string; at: number; text: string; source: Source; agent?: boolean; to?: "discord" };

export const CAP = 200;              // lines kept per thread
const TEXT_MAX = 4000;
export const THREAD = /^(general|#[1-9]\d{0,5})$/;
export const DISCORD_OFF = "Discord is off in my agent's settings";
export const COWORK_OFF = "My agent may not speak in the team's chat (Settings, my agent).";

/** a thread's name, or "" when it is not one: general, or #N */
export const threadOf = (v: unknown) => { const t = typeof v === "string" ? v.trim().toLowerCase() : ""; return THREAD.test(t) ? t : ""; };
/** what a line may hold: no control characters but newlines and tabs, no \r, at most 4000 characters */
export const cleanText = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, TEXT_MAX) : "");
/** the lines with one more at the end, the oldest dropped past the cap (pure) */
export function capLines(lines: TalkLine[], line: TalkLine, cap = CAP): TalkLine[] {
  const out = [...lines, line];
  return out.length > cap ? out.slice(out.length - cap) : out;
}

// ---- where it lives (tests move both) ----
const HERE = dirname(fileURLToPath(import.meta.url));   // src/team or dist/team: sol/home is three up either way
let DIR = join(STATE_DIR, "talk");
let HOME = process.env.SOL_HOME ?? resolve(HERE, "..", "..", "..", "home");
const threads = new Map<string, TalkLine[]>();
const bridgeFiles = new Map<string, { key: string; lines: TalkLine[] }>();
let bridgeSeen: Set<string> | null = null;
/** tests: another state folder and home, everything read again */
export function _talkAt(dir: string, home: string) { DIR = dir; HOME = home; threads.clear(); bridgeFiles.clear(); bridgeSeen = null; }

const fileOf = (thread: string) => join(DIR, `${thread.replace(/^#/, "")}.json`);
const isLine = (l: any): l is TalkLine => !!l && typeof l.id === "string" && typeof l.from === "string" && typeof l.at === "number" && typeof l.text === "string";

function linesOf(thread: string): TalkLine[] {
  let l = threads.get(thread);
  if (l) return l;
  try { const v = JSON.parse(readFileSync(fileOf(thread), "utf8")); l = Array.isArray(v) ? v.filter(isLine).slice(-CAP) : []; } catch { l = []; }
  threads.set(thread, l);
  return l;
}
function keep(thread: string, l: TalkLine[]) {
  threads.set(thread, l);
  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    const f = fileOf(thread), tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(l) + "\n", { mode: 0o600 });
    renameSync(tmp, f);   // never a half-written file
  } catch { /* a read-only place: kept for this run */ }
}
/** every thread that has lines on this machine */
export function threadsWithLines(): string[] {
  let names: string[] = [];
  try { names = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).map((n) => (n === "general" ? n : `#${n}`)); } catch { /* none yet */ }
  const all = new Set([...names, ...threads.keys()].filter((t) => THREAD.test(t) && linesOf(t).length));
  return [...all].sort((a, b) => (a === "general" ? -1 : b === "general" ? 1 : Number(b.slice(1)) - Number(a.slice(1))));
}

// ---- who hears a new line (wire.ts: every Cowork face) ----
const subs = new Set<(l: TalkLine) => void>();
export function onTalkLine(fn: (l: TalkLine) => void) { subs.add(fn); return () => { subs.delete(fn); }; }
function add(l: TalkLine) { keep(l.thread, capLines(linesOf(l.thread), l)); for (const f of subs) f(l); return l; }

/** a line said on this machine: kept, told to the faces, and sent on the relay (false there: the team is not in sight) */
export function say(thread: string, text: string, s: TeamSettings, agent: boolean, extra: Partial<TalkLine> = {}): { line: TalkLine; sent: boolean } {
  const line = add({ id: randomUUID(), thread, from: signature(s, agent), at: Date.now(), text, source: "relay", ...(agent ? { agent } : {}), ...extra });
  const sent = sendRelay("talk", { thread, text, id: line.id, ...(extra.to ? { to: extra.to } : {}) }, agent);
  const issue = thread === "general" ? undefined : Number(thread.slice(1));
  for (const to of namedIn(text, [...new Set(relayRoster().map((r) => r.who))], s.me.login))
    sendRelay("ping", { to, pingKind: "chat", line: `in ${thread}: ${text.split("\n")[0].slice(0, 260)}`, ...(issue ? { issue, repo: s.repos[0] } : {}) }, agent);
  return { line, sent };
}

/** a relay `talk` from a teammate's engine: the relay's own stamp says who (pure but for keeping it) */
export function lineFromRelay(m: RelayMsg): TalkLine | null {
  const thread = threadOf(m.thread), text = cleanText(m.text);
  const login = typeof m.from?.login === "string" ? m.from.login : "";
  if (!thread || !text || !/^[A-Za-z0-9-]{1,39}$/.test(login)) return null;
  const agent = m.from.agent === true;
  const id = typeof m.id === "string" && /^[\w-]{1,64}$/.test(m.id) ? m.id : randomUUID();
  return { id, thread, from: agent ? `${login}'s agent` : login, at: typeof m.at === "number" ? m.at : Date.now(), text, source: "relay", ...(agent ? { agent } : {}), ...(m.to === "discord" ? { to: "discord" as const } : {}) };
}
// a long line sent in parts (#223, A5: the cloud takes 4 KB a message), `<id>-p<i>` with part [i, n]: put back together
// before it is kept, so both sides keep one line. Parts that never all come are kept as far as they go after a minute
const parts = new Map<string, { n: number; got: Map<number, RelayMsg>; timer: ReturnType<typeof setTimeout> }>();
const PARTS_MAX = 64;

/** a line from the relay, live or kept by the hub's spool while this Sol was away (#102): the same line twice, by its id
 *  or by its time, signature and words, is kept once; a part of a long one waits for the rest */
export function hearRelay(m: RelayMsg) {
  const p = Array.isArray(m.part) ? m.part : null, base = typeof m.id === "string" ? /^([\w-]{1,80})-p(\d{1,3})$/.exec(m.id) : null;
  if (!p || !base) return hearOne(m);
  const [i, n] = p.map(Number);
  if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > PARTS_MAX || i < 1 || i > n || Number(base[2]) !== i) return;
  const login = typeof m.from?.login === "string" ? m.from.login : "";
  const key = `${login} ${m.from?.agent === true} ${base[1]}`;
  let w = parts.get(key);
  if (!w) {
    if (parts.size > 200) return;   // a flood of halves is not kept waiting
    w = { n, got: new Map(), timer: setTimeout(() => whole(key), 60_000) };
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
  hearOne({ ...first, id, text: got.map((x) => (typeof x.text === "string" ? x.text : "")).join("") } as RelayMsg);
}

function hearOne(m: RelayMsg) {
  const l = lineFromRelay(m);
  if (l && !linesOf(l.thread).some((x) => x.id === l.id || (x.at === l.at && x.from === l.from && x.text === l.text))) add(l);
}

/** a thread as a face sees it: its kept lines, and in general the bridges' lines, by time, the last 200 */
export function history(thread: string): TalkLine[] {
  const own = linesOf(thread);
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
/** a line typed in the chat (team.talk): `/discord ` goes out first, then the line is said as the person */
export async function typed(threadRaw: unknown, textRaw: unknown, s: TeamSettings = getTeam()): Promise<Said> {
  const thread = threadOf(threadRaw);
  if (!thread) return { ok: false, error: "no such thread" };
  let text = cleanText(textRaw);
  if (!text) return { ok: false, error: "nothing to say" };
  if (!s.me.login) return { ok: false, error: "who you are comes from GitHub: sign in first (Settings, my accounts)" };
  const out = /^\/discord(?:\s+|$)/i.test(text);
  if (out) {
    if (thread !== "general") return { ok: false, error: "a line goes to Discord from general only" };
    text = text.replace(/^\/discord\s*/i, "").trim();
    if (!text) return { ok: false, error: "nothing to send to Discord" };
    const p = await postDiscord(text, s);
    if (!p.ok) return p;
  }
  const { line, sent } = say(thread, text, s, false, out ? { to: "discord" } : {});
  return { ok: true, line, sent };
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
