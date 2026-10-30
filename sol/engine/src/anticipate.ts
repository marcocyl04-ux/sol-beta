// Anticipate (#253): Sol hears a
// conversation Marco is in and helps fast. A press on the notch starts a talk and Stop in the drawer ends it, never
// ambient. While it is on, a small helper (sol/mac/listen, Swift) hears both sides on the Mac and prints one JSON line a
// turn; this file keeps those turns and writes them to home/voice/talks/<stamp>.jsonl (words only, the audio never
// leaves the helper). **The talk file is the one record**: turns, names, every shown card's text, every ask with its
// answer, the recap, the review and the questions are lines in it, and `anticipate.talk` answers a face from it.
//
// Cards come from the card seats: two Claude queries on Haiku kept warm for the whole talk, each fed by a prompt stream
// that stays open, no tools, no MCP, no settings, the skill file's rules as the system prompt (skill.ts,
// home/skills/notch.md). One takes Marco's presses, the other the cards Sol volunteers, so a press never waits behind
// a volunteered card. A card has 3 s; when the seat misses that once, the next cards race it against Gemini flash on the
// engine's existing key (titles.ts). A seat is restarted after every 20 cards (its context would grow past the bar);
// Recap and Who, which need the whole talk, go to Gemini flash with the whole transcript. The buttons are the skill's.
// Names learn themselves (names.ts): "them" becomes "Frank" once the talk gives it away, or by a click.
//
// Ask is a thread: one session on the Claude seat for the whole talk (door "notch"), each answer returned, broadcast as
// `anticipate.asked` and written as an `ask` line. Holding the globe key (`anticipate.hold`) makes Marco's own words
// the question instead of the transcript. Stop answers at once; the recap, the review and the questions are written
// in the background; the talk waits in Conversations (talks.ts), which keeps it (`keepTalk`) once its questions are done.
//
// A talk holds the engine's busy counter (busy.ts) from start to the end of its wrap-up, so a renew waits for it. The
// pure parts are exported and tested in test/anticipate.test.ts; nothing there spawns the helper or the SDK.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { query, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { GoogleGenAI } from "@google/genai";
import { join as joinBusy } from "./busy.js";
import { namingModel } from "./titles.js";
import { readSkill, DEFAULT_SKILL, SEAT_RULES, type Skill, type SkillButton } from "./skill.js";
import { freshNames, nameFrom, nameByClick, nameByTalk, type NameState } from "./names.js";

export { SEAT_RULES };

// ---- the shapes ----

export type Who = "you" | "them";
/** one turn as the helper prints it; `at` is unix seconds when it started */
export type Turn = { who: Who; text: string; final: boolean; at: number; seconds: number; lang?: string };
export type Card = { head: string; bullets: string[]; source: string };
/** sitting 1's button ids, still accepted: they map to the four default buttons' names */
export type Button = "answer" | "next" | "recap" | "who";
export const OLD_BUTTONS: Record<Button, string> = { answer: "Answer", next: "Say next", recap: "Recap", who: "Who" };
export type Why = "pressed" | "question" | "name";
/** which warm seat answers a card: Marco's presses have their own (pure) */
export const seatFor = (why: Why): "pressed" | "volunteered" => (why === "pressed" ? "pressed" : "volunteered");
type Face = { send: (m: object) => void };
/** a typed ask into the talk's session: the engine's say path (index.ts talkSay); answers the seat's words and the id */
export type TalkSay = (text: string, sessionId?: string, title?: string) => Promise<{ text: string; sessionId?: string }>;

export const HEAD_WORDS = 6, BULLET_WORDS = 15, BULLETS = 2, QUESTIONS = 3;
/** the helper's first second: an error or a permission sentence in it answers anticipate.start instead of a talk */
export const EARLY_MS = 1000;
export const CARD_MS = 3000, VOLUNTEER_GAP_MS = 60_000, STATE_EVERY_MS = 10_000;
export const LAST_MINUTE_MS = 60_000, LAST_TWO_MS = 120_000;
/** a warm seat answers this many cards, then a fresh one takes over (RUBRIC-2 S1) */
export const SEAT_CARDS = 20;
/** after the globe key is let go, how long the engine waits for the question's last words */
export const HOLD_SETTLE_MS = 1500;

// ---- pure parts ----

const words = (s: string) => s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
const DANGLING = /^(?:and|or|but|then|so|the|a|an|to|of|for|with|in|on|at|by|from|that|which|your|my|our|their|i|i'll|i'm|we|we'll|you|you'll|it|it's|is|are|was|will|can|would|should)$/i;
/** at most n words; a cut line ends at its last comma or stop in the second half if it has one, else without a
 *  dangling "and", "the" or "I'll", and without its trailing comma or colon (pure) */
export function cutWords(s: string, n: number): string {
  const w = words(s);
  if (w.length <= n) return w.join(" ");
  let cut = w.slice(0, n);
  let stopped = false;
  for (let i = cut.length - 1; i >= Math.ceil(n / 2) - 1; i--) if (/[,.;:!?]$/.test(cut[i])) { cut = cut.slice(0, i + 1); stopped = true; break; }
  while (!stopped && cut.length > 1 && DANGLING.test(cut[cut.length - 1].replace(/\W+$/, ""))) cut.pop();
  return cut.join(" ").replace(/[,;:\-–—]+$/, "");
}
const bare = (l: string) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, "").replace(/\*\*|__|`/g, "").replace(/^#+\s*/, "").replace(/^["“](.*)["”]$/, "$1").trim();

/** the seat's answer as a card, the shape enforced: "nothing" (or nothing) is no card (pure) */
export function parseCard(text: string): Card | null {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length || /^nothing\.?$/i.test(bare(lines[0]))) return null;
  let source = "";
  const rest: { line: string; bullet: boolean }[] = [];
  for (const l of lines) {
    const s = /^\W*source\W*:\s*(.*)$/i.exec(l);
    if (s) { source ||= bare(s[1]); continue; }
    rest.push({ line: bare(l), bullet: /^\s*(?:[-*•·]|\d+[.)])\s+/.test(l) });
  }
  const headAt = rest.findIndex((r) => !r.bullet && r.line);
  const head = cutWords(headAt >= 0 ? rest[headAt].line : rest[0]?.line ?? "", HEAD_WORDS);
  if (!head) return null;
  const bullets = rest.filter((r, i) => i !== (headAt >= 0 ? headAt : 0) && r.line).slice(0, BULLETS).map((r) => cutWords(r.line, BULLET_WORDS));
  return { head, bullets, source: cutWords(source || "the talk", 8) };
}
/** a card whose source is just "the talk" names the side and the moment once the other side has a name:
 *  "Frank, 12:31" (pure) */
export function namedSource(card: Card, them: string, at: string): Card {
  if (!them || them === "them" || !/^the talk\.?$/i.test(card.source)) return card;
  return { ...card, source: `${them}, ${at}` };
}

/** the turns that ended in the last `ms` before `now` (ms since the epoch); turns carry unix seconds (pure) */
export function windowOf(turns: Turn[], ms: number, now: number): Turn[] {
  return turns.filter((t) => (t.at + (t.seconds || 0)) * 1000 >= now - ms);
}
/** turns as lines a model reads: "Marco: ...", and "them: ..." or the other side's learned name (pure) */
export const turnsText = (turns: Pick<Turn, "who" | "text">[], them = "them") => turns.map((t) => `${t.who === "you" ? "Marco" : them}: ${t.text}`).join("\n");

// Clean speech (2026-10-26): the fillers of talk are taken out of every turn as it arrives, so the transcript, the
// cards and the review read like what was meant, not what the mouth did: "um", "uh", "er", "hmm", "mm-hmm" and their
// kin on their own; a word said twice or three times running ("the, the, the thing"; "yeah, yeah, yeah"; "I I I") kept
// once; stray commas joined. Only whole words go, never a part of one; Chinese fillers (嗯, 呃, 啊 alone) the same.
const FILLER = /(?<![\p{L}\p{N}'’])(?:u+m+|u+h+|u+h-?huh|e+r+m?|a+h+|o+h+ (?=(?:u+m+|u+h+)\b)|h+m+|m+-?h+m+|m+h+m+|m+m+|嗯+|呃+|诶+)(?![\p{L}\p{N}'’])[,.!?…]*/giu;
const REPEAT = /\b([\p{L}\p{N}'’]+)(?:[,.]?\s+\1\b){1,4}(?![\p{L}\p{N}'’])/giu;
/** a turn's words with the fillers and the stutters gone; "" when nothing but fillers was said (pure) */
export function tidy(text: string): string {
  const GONE = "\u0001";   // where a filler stood, until the sentence after it is given its capital
  let t = String(text ?? "").replace(FILLER, GONE);
  t = t.replace(REPEAT, (_m, w: string) => w);
  t = t.replace(/(^|[.!?…]\s*)(?:\u0001\s*)+(\p{Ll})/gu, (_m, before: string, l: string) => before + l.toLocaleUpperCase());
  t = t.replace(/\u0001/g, " ");
  return t.replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?…])/g, "$1")          // "word ," -> "word,"
    .replace(/([,.;:!?…])(?:\s*[,.;:])+/g, "$1") // ",," ", ." -> ","
    .replace(/^[\s,.;:…]+/, "")                 // a turn never starts with a stop
    .trim();
}

/** the talk file's name: the local start time, 20261025-143012.jsonl (pure) */
export function talkName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jsonl`;
}

/** a line of the helper's stdout as a turn, or its error, or null for anything else (pure) */
export function parseTurn(line: string): Turn | { error: string } | null {
  let o: any;
  try { o = JSON.parse(line); } catch { return null; }
  if (o && typeof o.error === "string") return { error: o.error };
  if (!o || (o.who !== "you" && o.who !== "them") || typeof o.text !== "string") return null;
  const text = tidy(o.text);
  if (!text) return null;   // nothing but fillers: not a turn
  return { who: o.who, text, final: o.final !== false, at: Number(o.at) || Date.now() / 1000, seconds: Number(o.seconds) || 0, ...(typeof o.lang === "string" && o.lang ? { lang: o.lang } : {}) };
}

// The listener's permission sentences (sol/mac/listen/Sources.swift): each says "permission: " and then, in plain
// words, which switch is off and the System Settings address in brackets. The mic's is said once at the start; the
// System Audio Recording one at the start when macOS already refused, and again after 15 s of exact silence from the
// other side (a tap without the permission hears silence instead of failing), prefixed "them: only silence so far".
const PERMISSION = "permission: ";
const SILENCE = /^them: only silence so far/;
/** a stderr line of the helper as the sentence the notch shows (it still carries the Settings address, the notch
 *  strips it from the line and opens it on a press), or null for any other line (pure) */
export function permissionLine(line: string): string | null {
  const i = line.indexOf(PERMISSION);
  if (i < 0) return null;
  const rest = line.slice(i + PERMISSION.length).trim();
  if (!rest) return null;
  return `${PERMISSION}${SILENCE.test(line) ? "only silence from the other side so far. " : ""}${rest}`;
}

// "can you", "what do you", "how about"... at the start of the turn's last sentence
const FORMS = /^(?:(?:so|and|ok|okay|well|but|right|marco)[,\s]+)*(?:can you|could you|would you|will you|do you|did you|are you|have you|what|when|where|how|who|why|is there|is it|shall we)\b/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** a name or an issue number Sol knows in these words, or null (pure) */
export function nameIn(text: string, names: string[]): string | null {
  const issue = /#\d+\b/.exec(text);
  if (issue) return issue[0];
  for (const n of names) {
    if (n.length < 3) continue;
    if (new RegExp(`(^|[^\\p{L}])${escapeRe(n)}($|[^\\p{L}])`, "iu").test(text)) return n;
  }
  return null;
}
/** whether a turn is a question put to Marco (pure) */
export function isQuestion(text: string): boolean {
  const t = text.trim();
  if (t.endsWith("?")) return true;
  const last = t.split(/(?<=[.!?])\s+/).filter(Boolean).pop() ?? t;
  return FORMS.test(last);
}
export type SpeakState = { lastVolunteer: number; pressedInFlight: number };
/** after a final turn: whether Sol speaks up by itself, and why; at most one a minute, never over a pressed card (pure) */
export function speakUp(turn: Turn, s: SpeakState, names: string[], now: number): { why: Why; name?: string } | null {
  if (turn.who !== "them" || !turn.final) return null;
  if (s.pressedInFlight > 0 || now - s.lastVolunteer < VOLUNTEER_GAP_MS) return null;
  if (isQuestion(turn.text)) return { why: "question" };
  const name = nameIn(turn.text, names);
  return name ? { why: "name", name } : null;
}
/** whether the words touch a subject of the skill's "Never on:" lines (a word starting with it, any case) (pure) */
export function touchesNever(text: string, never: string[]): string | null {
  for (const n of never) {
    const s = n.trim();
    if (s.length < 2) continue;
    if (new RegExp(`(^|[^\\p{L}])${escapeRe(s)}`, "iu").test(text)) return s;
  }
  return null;
}

/** the card a press gets when the seat had nothing to say: a press is always answered, and the honest card is the
 *  one that says so and gives Marco a way on (pure) */
export const EMPTY_PRESS = (button: string): Card => ({
  head: "Nothing to add yet",
  bullets: [/^(?:recap|who)$/i.test(button) ? "Too little said so far to sum up" : "Ask them what they need from you right now"],
  source: "the talk",
});
/** a press's ask: the button's prompt, and the rule that a press is never answered with nothing (pure) */
export const pressAsk = (name: string, prompt: string, screen: boolean) =>
  `Marco pressed ${name}: ${prompt}.${screen ? " The picture is the window in front of Marco." : ""} A press is always answered: when the talk gives you little, give Marco the one question to ask them next, in the card shape; never answer nothing.`;

/** the long words said in a talk (more than four letters), lowercased (pure) */
export const talkWords = (turns: Pick<Turn, "text">[]) => new Set(turns.flatMap((t) => t.text.toLowerCase().match(/[\p{L}\p{N}']{5,}/gu) ?? []));
/** questions kept only when they name something said (a word of five letters or more from the talk); three at most (pure) */
export function guardQuestions(qs: string[], turns: Pick<Turn, "text">[]): string[] {
  const said = talkWords(turns), seen = new Set<string>(), out: string[] = [];
  for (const raw of qs) {
    const q = bare(String(raw ?? "")).replace(/\s+/g, " ").trim();
    if (!q || seen.has(q.toLowerCase())) continue;
    const mine = q.toLowerCase().match(/[\p{L}\p{N}']{5,}/gu) ?? [];
    if (!mine.some((w) => said.has(w))) continue;
    seen.add(q.toLowerCase());
    out.push(q);
    if (out.length >= QUESTIONS) break;
  }
  return out;
}
/** the seat's answer at the stop: "recap:" lines, then "questions:" lines (pure) */
export function parseWrapUp(text: string): { recap: string[]; questions: string[] } {
  const recap: string[] = [], questions: string[] = [];
  let into: string[] | null = null;
  for (const l of String(text ?? "").split(/\r?\n/)) {
    const t = l.trim();
    if (!t) continue;
    if (/^\W*recap\W*:?\s*$/i.test(t)) { into = recap; continue; }
    if (/^\W*questions?\W*:?\s*$/i.test(t)) { into = questions; continue; }
    const line = bare(t);
    if (!line || /^nothing\.?$/i.test(line)) continue;
    (into ?? (line.endsWith("?") ? questions : recap)).push(line);
  }
  return { recap: recap.slice(0, 6), questions: questions.filter((q) => q.endsWith("?")) };
}

/** median and worst of a list of milliseconds, and how many met the bar (pure) */
export function stats(ms: number[], bar: number): { n: number; median: number; worst: number; under: number } {
  const s = ms.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!s.length) return { n: 0, median: 0, worst: 0, under: 0 };
  const mid = s.length >> 1;
  const median = s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  return { n: s.length, median, worst: s[s.length - 1], under: s.filter((x) => x < bar).length };
}

/** the people Sol knows by name: home/team.json when there is one and any other team file given (the engine's own
 *  sol/engine/team.json): any "name" in it, or a list of strings; never the machines, the relay or Marco (pure-ish) */
export function knownNames(home: string, also: string[] = []): string[] {
  const out = new Set<string>();
  const SKIP = new Set(["me", "machines", "relay", "repos", "seats", "speak", "leaves"]);
  const walk = (v: unknown, key = "") => {
    if (typeof v === "string") { if ((key === "name" || key === "") && /^[\p{L}][\p{L}' -]{1,40}$/u.test(v.trim())) out.add(v.trim()); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key === "names" || key === "people" || key === "members" ? "" : key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!SKIP.has(k)) walk(x, k);
  };
  for (const f of [join(home, "team.json"), ...also]) {
    try { walk(JSON.parse(readFileSync(f, "utf8")), "root"); } catch { /* no team file: issue numbers only */ }
  }
  return [...out].filter((n) => !/^marco/i.test(n));
}

/** the skill's button for a press: by its name (any case), or sitting 1's id; the first button when none is named (pure) */
export function findButton(buttons: SkillButton[], asked: unknown): SkillButton | null {
  const list = buttons.length ? buttons : DEFAULT_SKILL.buttons;
  if (asked === undefined || asked === null || asked === "") return list[0];
  const s = String(asked).trim();
  const name = (OLD_BUTTONS as Record<string, string>)[s] ?? s;
  return list.find((b) => b.name.toLowerCase() === name.toLowerCase()) ?? null;
}
/** Recap and Who need the whole talk, and go to Gemini flash with it, not the warm seat (pure) */
export const wholeTalk = (b: SkillButton) => /^(?:recap|who)$/i.test(b.name) || /\bwhole talk\b/i.test(b.prompt);
export const viaGemini = (b: SkillButton) => /^(?:recap|who)$/i.test(b.name);

// ---- the talk file as a record (pure) ----

export type TalkCard = Card & { why: Why; button?: string; at: number };
export type TalkAsk = { q: string; a: string; at: number; ms: number; spoken: boolean };
export type ReviewItem = { text: string; at: number };
export type Review = { promised: ReviewItem[]; asked: ReviewItem[]; decisions: ReviewItem[]; names: ReviewItem[] };
export type TalkRecord = {
  started: string | null; ended: string | null; seconds: number;
  turns: { who: Who; text: string; at: number; seconds: number }[];
  cards: TalkCard[]; asks: TalkAsk[]; names: { you: string; them: string };
  recap: string[] | null; review: Review | null; questions: string[] | null; answers: (string | null)[]; kept: boolean; seen: boolean;
};
/** `at` as unix seconds: the turns' numbers stay, the other lines' ISO strings are read (pure) */
export const unixAt = (v: unknown): number => typeof v === "number" ? v : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? Date.parse(v) / 1000 : 0;

/** every line of a talk file, read into one record; a broken line is skipped (pure) */
export function parseTalk(text: string): TalkRecord {
  const r: TalkRecord = { started: null, ended: null, seconds: 0, turns: [], cards: [], asks: [], names: { you: "you", them: "them" }, recap: null, review: null, questions: null, answers: [], kept: false, seen: false };
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== "object") continue;
    if (typeof o.started === "string" && !r.started) r.started = o.started;
    else if (o.who && typeof o.text === "string" && !o.type) r.turns.push({ who: o.who === "you" ? "you" : "them", text: o.text, at: Number(o.at) || 0, seconds: Number(o.seconds) || 0 });
    else if (typeof o.card === "string") {
      if (!o.shown || !o.text || typeof o.text.head !== "string") continue;   // sitting 1's lines carry no text: nothing to draw
      const why: Why = o.card === "question" || o.card === "name" ? o.card : "pressed";
      r.cards.push({ head: o.text.head, bullets: Array.isArray(o.text.bullets) ? o.text.bullets.map(String) : [], source: String(o.text.source ?? "the talk"), why, ...(why === "pressed" && o.card !== "ask" ? { button: o.card } : {}), at: unixAt(o.at) });
    }
    else if (typeof o.ended === "string") { r.ended = o.ended; r.seconds = Number(o.seconds) || 0; }
    else if (o.type === "name" && (o.who === "you" || o.who === "them") && typeof o.name === "string" && o.name.trim()) r.names[o.who as Who] = o.name.trim();
    else if (o.type === "ask" && typeof o.q === "string") r.asks.push({ q: o.q, a: String(o.a ?? ""), at: unixAt(o.at), ms: Number(o.ms) || 0, spoken: !!o.spoken });
    else if (o.type === "recap" && Array.isArray(o.lines)) r.recap = o.lines.map(String);
    else if (o.type === "review") r.review = reviewOf(o);
    else if (o.type === "questions" && Array.isArray(o.items)) { const qs: string[] = o.items.map(String); r.questions = qs; r.answers = qs.map(() => null); }
    else if (o.type === "answer" && Number.isInteger(o.i) && o.i >= 0) r.answers[o.i] = typeof o.text === "string" ? o.text : null;
    else if (o.type === "kept") r.kept = true;
    else if (o.type === "seen") r.seen = true;
  }
  if (!r.ended && r.started && r.turns.length) { const t = r.turns[r.turns.length - 1]; r.seconds = Math.max(0, Math.round(t.at + t.seconds - unixAt(r.started))); }
  return r;
}

/** "12:31", "1:02:03" or a number as seconds; anything else 0 (pure) */
const secondsOf = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.round(v));
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(v) > 0 ? Math.round(Number(v)) : 0;
};
const itemsOf = (v: unknown): ReviewItem[] => (Array.isArray(v) ? v : []).map((x: any) =>
  typeof x === "string" ? { text: x.trim(), at: 0 } : { text: String(x?.text ?? "").trim(), at: secondsOf(x?.at) }).filter((x) => x.text).slice(0, 12);
/** an object with the four lists as a review, each item { text, at } (pure) */
export const reviewOf = (o: any): Review => ({ promised: itemsOf(o?.promised), asked: itemsOf(o?.asked), decisions: itemsOf(o?.decisions), names: itemsOf(o?.names) });
/** Gemini's answer to the review prompt: a JSON object (in a code fence or not), with "recap" lines and the four
 *  lists; null when there is no object in it (pure) */
export function parseReview(text: string): { recap: string[]; review: Review } | null {
  const s = String(text ?? "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let o: any;
  try { o = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const recap = (Array.isArray(o.recap) ? o.recap : typeof o.recap === "string" ? o.recap.split("\n") : []).map((l: unknown) => bare(String(l))).filter(Boolean).slice(0, 6);
  return { recap, review: reviewOf(o) };
}
const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
/** the prompt for the review: the whole talk, each turn with its time into the talk (pure) */
export function reviewPrompt(turns: Pick<Turn, "who" | "text" | "at">[], them: string, startedUnix: number): string {
  const lines = turns.map((t) => `[${clockOf(Math.max(0, t.at - startedUnix))}] ${t.who === "you" ? "Marco" : them}: ${t.text}`).join("\n");
  return [
    "This is the transcript of a conversation Marco was in, each turn with its time into the talk.",
    lines,
    "",
    "Answer with one JSON object and nothing else:",
    '{"recap": [at most five short lines on what was said and decided], "promised": [what Marco promised to do], "asked": [what they asked of Marco], "decisions": [what was decided], "names": [names, dates and numbers worth keeping]}',
    'Each item of the four lists is {"text": "a short line in plain words", "at": seconds into the talk where it was said}. Only what was said; never invent; empty lists are fine.',
  ].join("\n");
}

/** how many talk files have no `seen` line; the cache keeps each file's answer until its mtime changes (pure-ish) */
const seenCache = new Map<string, { mtime: number; waits: boolean }>();
export function waitingTalks(dir: string, except?: string): number {
  let n = 0;
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { return 0; }
  for (const f of files) {
    const path = join(dir, f);
    if (path === except) continue;
    try {
      const mtime = statSync(path).mtimeMs;
      let c = seenCache.get(path);
      if (!c || c.mtime !== mtime) {
        const text = readFileSync(path, "utf8");
        c = { mtime, waits: !/"type"\s*:\s*"seen"/.test(text) && /"ended"\s*:/.test(text) };
        seenCache.set(path, c);
      }
      if (c.waits) n++;
    } catch { /* gone meanwhile */ }
  }
  return n;
}

// ---- the card seat ----

/** one Claude query kept open for the talk: each card is one user message, each answer one result, in order */
class CardSeat {
  private queue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  private waiting: { ok: (t: string) => void; no: (e: Error) => void }[] = [];
  private q: Query;
  /** the warm-up came back: from here on a slow card is the seat's fault, not its start */
  warm = false;
  /** cards answered since this seat started */
  cards = 0;
  /** a message is in the seat already: a new one would wait behind it */
  get busy() { return this.waiting.length > 0; }
  constructor(readonly system: string) {
    const self = this;
    async function* stream(): AsyncGenerator<SDKUserMessage> {
      while (!self.closed) {
        const m = self.queue.shift();
        if (m) { yield m; continue; }
        await new Promise<void>((r) => (self.wake = r));
        self.wake = null;
      }
    }
    this.q = query({
      prompt: stream(),
      options: {
        model: "haiku",
        tools: [],
        settingSources: [],
        systemPrompt: system,
        thinking: { type: "disabled" },
        persistSession: false,          // the seat's chatter is not a conversation of Marco's
        cwd: tmpdir(),                  // and it reads no project's CLAUDE.md
      },
    });
    void this.read();
  }
  private async read() {
    try {
      for await (const m of this.q as AsyncIterable<SDKMessage>) {
        if (m.type !== "result") continue;
        const w = this.waiting.shift();
        if (!w) continue;
        if (m.subtype === "success" && !m.is_error) w.ok(m.result ?? ""); else w.no(new Error(`the card seat failed (${m.subtype})`));
      }
    } catch (err) {
      if (!this.closed) console.log(`anticipate: the card seat stopped: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    }
    this.closed = true;
    for (const w of this.waiting.splice(0)) w.no(new Error("the card seat is closed"));
  }
  /** one message in, its answer's text out */
  ask(text: string, screen?: string): Promise<string> {
    if (this.closed) return Promise.reject(new Error("the card seat is closed"));
    const content: any[] = [{ type: "text", text }];
    if (screen) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: screen } });
    return new Promise((ok, no) => {
      this.waiting.push({ ok, no });
      this.queue.push({ type: "user", parent_tool_use_id: null, message: { role: "user", content } });
      this.wake?.();
    });
  }
  /** the warm-up: the process is up before the first press */
  warmUp() { void this.ask("The conversation is starting. Answer exactly: nothing").then(() => { this.warm = true; }, () => {}); return this; }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.wake?.();
    try { this.q.close(); } catch { /* gone already */ }
  }
}

// Gemini flash on the engine's key (the one titles.ts names conversations with): for when the seat is slow, for Recap
// and Who with the whole talk, and for the review after the stop.
// A card waits for Gemini at most GEMINI_CARD_MS and a review GEMINI_REVIEW_MS (2026-10-25 a Recap waited 215 s on a
// 429 and 503 and the button looked dead). After a refusal Gemini rests: the quota's "retry in" (else ten minutes) on a
// 429, a minute on a 503, half a minute when it could not be reached; while it rests every call fails at once, so the
// seat answers alone and nothing waits on it.
export const GEMINI_CARD_MS = 6000, GEMINI_REVIEW_MS = 45_000;
let gemini: GoogleGenAI | null = null;
let geminiRestUntil = 0;
/** how long Gemini rests after this failure, in ms; 0 for a failure that says nothing about the next call (pure) */
export function geminiRest(err: unknown, now = Date.now()): number {
  const m = err instanceof Error ? err.message : String(err);
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(m)) {
    const d = /retry in (?:([\d.]+)h)?(?:([\d.]+)m)?(?:([\d.]+)s)?/i.exec(m);
    const s = d ? Number(d[1] ?? 0) * 3600 + Number(d[2] ?? 0) * 60 + Number(d[3] ?? 0) : 0;
    return (s > 0 ? s : 600) * 1000;
  }
  if (/503|UNAVAILABLE|high demand|overloaded/i.test(m)) return 60_000;
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network|timed out/i.test(m)) return 30_000;
  void now;
  return 0;
}
/** a promise with a deadline: past it, one plain error (pure-ish) */
export function withTimeout<T>(p: Promise<T>, ms: number, what = "Gemini"): Promise<T> {
  return new Promise<T>((ok, no) => {
    const t = setTimeout(() => no(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); no(e); });
  });
}
async function geminiText(prompt: string, screen?: string, json = false, ms = GEMINI_CARD_MS): Promise<string> {
  if (Date.now() < geminiRestUntil) throw new Error(`Gemini rests for ${Math.ceil((geminiRestUntil - Date.now()) / 1000)} s more`);
  const model = await namingModel();
  const key = process.env.GEMINI_API_KEY;
  if (!model || !key) throw new Error("no Gemini key");
  gemini ??= new GoogleGenAI({ apiKey: key });
  const parts: any[] = [{ text: prompt }];
  if (screen) parts.push({ inlineData: { mimeType: "image/png", data: screen } });
  try {
    const r = await withTimeout(gemini.models.generateContent({ model, contents: [{ role: "user", parts }], ...(json ? { config: { responseMimeType: "application/json" } } : {}) }), ms);
    return r.text ?? "";
  } catch (err) {
    const rest = geminiRest(err);
    if (rest) { geminiRestUntil = Date.now() + rest; console.log(`anticipate: Gemini rests ${Math.round(rest / 1000)} s (${plainModelError(err)})`); }
    throw err;
  }
}
const geminiCard = (rules: string, text: string, screen?: string) => geminiText(`${rules}\n\n${text}`, screen);

/** a model's failure as one plain sentence for a face (the raw error goes to the log, never to a page) */
export function plainModelError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(m)) {
    const d = /retry in ([\d.]+h)?([\d.]+m)?([\d.]+s)?/i.exec(m);
    const when = d ? [d[1], d[2]].filter(Boolean).map((x) => x.replace(/\.\d+/, "")).join("") || "a minute" : "";
    return `Gemini's free quota for today is used up${when ? `, it tries again in ${when}` : ""}`;
  }
  if (/no Gemini key/i.test(m)) return "no Gemini key on this engine";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(m)) return "Gemini could not be reached";
  return m.split("\n")[0].slice(0, 120);
}

/** the review's text: Gemini flash first; when it fails (the free quota, no key, the network) a Claude card seat reads
 *  the talk instead. Throws one plain sentence when neither answered. */
export async function reviewText(prompt: string): Promise<string> {
  try { return await geminiText(prompt, undefined, true, GEMINI_REVIEW_MS); } catch (err) {
    const why = plainModelError(err);
    console.log(`anticipate: the review on Gemini failed (${why}), asking the Claude seat`);
    const seat = new CardSeat("You review a conversation someone had. Answer with the JSON asked for and nothing else: no prose, no code fence.");
    try { return await seat.ask(prompt); } catch (err2) {
      throw new Error(`${why}, and the Claude seat did not answer (${plainModelError(err2)})`);
    } finally { seat.close(); }
  }
}

/** the recap and the review of a whole talk from Gemini flash (Conversations uses it for a talk with none) */
export async function reviewTalk(turns: Pick<Turn, "who" | "text" | "at">[], them: string, startedUnix: number): Promise<{ recap: string[]; review: Review } | null> {
  if (!turns.length) return { recap: [], review: reviewOf({}) };
  const r = parseReview(await reviewText(reviewPrompt(turns, them, startedUnix)));
  if (!r) console.log("anticipate: the review came back without its JSON");
  return r;
}

// ---- the talk ----

type Hold = { since: number; muted: string; words: string[]; partial: string; settle?: () => void };
type Talk = {
  file: string; started: number; child: ChildProcessWithoutNullStreams | null; turns: Turn[]; seats: Record<"pressed" | "volunteered", CardSeat>;
  leave: () => void; tick: NodeJS.Timeout; known: string[]; slow: boolean; speak: SpeakState; pressSeq: number;
  skill: Skill; names: NameState; hold: Hold | null; swallowUntil: number;
  sessionId?: string; ended?: number;
};
type Ended = { file: string; started: number; ended: number; sessionId?: string };

let HOME = "", SOL = "", tell: (m: object) => void = () => {};
let talk: Talk | null = null;
let last: Ended | null = null;

/** where the home is, where sol/ is (the helper is sol/mac/listen/bin/listen), and how to tell every face */
export function setAnticipate(home: string, sol: string, everyone: (m: object) => void) {
  HOME = home; SOL = sol; tell = everyone;
  process.once("exit", () => { try { talk?.child?.kill("SIGTERM"); } catch { /* gone */ } });   // the helper never outlives the engine
}
const helperPath = () => process.env.SOL_LISTEN || join(SOL, "mac", "listen", "bin", "listen");
const talksDir = () => join(HOME, "voice", "talks");
const seconds = (t: Talk | Ended) => Math.round(((t.ended ?? Date.now()) - t.started) / 1000);
const log = (t: { file: string }, o: object) => { try { appendFileSync(t.file, JSON.stringify(o) + "\n"); } catch (err) { console.log(`anticipate: not written: ${err instanceof Error ? err.message : err}`); } };
const iso = () => new Date().toISOString();
const stateMsg = () => {
  const waiting = waitingTalks(talksDir(), talk?.file);
  return talk ? { type: "anticipate.state", on: true, seconds: seconds(talk), ...(talk.sessionId ? { sessionId: talk.sessionId } : {}), waiting }
    : { type: "anticipate.state", on: false, seconds: last ? seconds(last) : 0, ...(last?.sessionId ? { sessionId: last.sessionId } : {}), waiting };
};
/** every face hears the state again (Conversations calls it after it writes a `seen` line, so the menu's dot goes) */
export const tellState = () => tell(stateMsg());
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const when = (d: Date) => d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
const them = (t: Talk) => t.names.them;
const buttonsMsg = (s: Skill) => ({ type: "anticipate.buttons", buttons: s.buttons, mute: s.mute });
const volunteerRules = (s: Skill) => s.never.length
  ? `${s.rules}\n\nNever volunteer anything while the talk is about: ${s.never.join(", ")}. Then answer exactly: nothing`
  : s.rules;

/** a seat that has answered its twenty cards and is idle is replaced by a fresh one (RUBRIC-2 S1) */
function restartIfDue(t: Talk, which: "pressed" | "volunteered") {
  const old = t.seats[which];
  if (old.cards < SEAT_CARDS || old.busy || talk !== t) return;
  t.seats[which] = new CardSeat(old.system).warmUp();
  old.close();
  console.log(`anticipate: the ${which} seat answered ${old.cards} cards; a fresh one takes over`);
}

/** one card from its seat (or Gemini, racing it once the press seat was slow, or first for the whole talk); null when
 *  there is nothing to say */
async function makeCard(t: Talk, why: Why, text: string, screen?: string, first: "seat" | "gemini" = "seat"): Promise<{ card: Card | null; ms: number; path: string }> {
  const which = seatFor(why), mine = t.seats[which];
  const t0 = Date.now(), warm = mine.warm, queued = mine.busy;
  const rules = which === "pressed" ? t.skill.rules : volunteerRules(t.skill);
  let got: { r: string; path: string };
  if (first === "gemini") {
    // Recap and Who: Gemini reads the whole talk fastest, but the seat is asked at the same time and the first answer
    // wins, so a Gemini that is slow, resting or down costs the press nothing
    mine.cards++;
    const seat = mine.ask(text, screen).then((r) => ({ r, path: "seat" }));
    const flash = geminiCard(rules, text, screen).then((r) => ({ r, path: "gemini" }), (err) => {
      console.log(`anticipate: Gemini did not answer, the seat does: ${String(err instanceof Error ? err.message : err).split("\n")[0].slice(0, 160)}`);
      throw err;
    });
    got = await Promise.any([flash, seat]).catch(() => ({ r: "", path: "none" }));
    void seat.catch(() => {}).finally(() => restartIfDue(t, which));
  } else {
    mine.cards++;
    const seat = mine.ask(text, screen).then((r) => ({ r, path: "seat" }));
    if (t.slow || queued) {   // slow once, or another card still in the seat: Gemini races it
      const flash = geminiCard(rules, text, screen).then((r) => ({ r, path: "gemini" }), (err) => { console.log(`anticipate: Gemini did not answer: ${String(err instanceof Error ? err.message : err).split("\n")[0].slice(0, 160)}`); throw err; });
      got = await Promise.any([seat, flash]).catch(() => ({ r: "", path: "none" }));
      void seat.catch(() => {}).finally(() => restartIfDue(t, which));   // the seat finishes behind the winner, then may restart
    } else {
      got = await seat.catch(async (err) => {
        console.log(`anticipate: the seat failed, Gemini answers: ${err instanceof Error ? err.message : err}`);
        return geminiCard(rules, text, screen).then((r) => ({ r, path: "gemini" }), () => ({ r: "", path: "none" }));
      });
    }
  }
  const ms = Date.now() - t0;
  if (which === "pressed" && first === "seat" && got.path === "seat" && ms > CARD_MS && !t.slow && warm && !queued) { t.slow = true; console.log(`anticipate: the seat took ${ms} ms; Gemini races it from now on`); }
  console.log(`anticipate: a ${which} card in ${ms} ms from ${got.path}`);
  restartIfDue(t, which);
  const card = parseCard(got.r);
  return { card: card && namedSource(card, them(t), clock(seconds(t))), ms, path: got.path };
}

function cardText(t: Talk, ask: string, whole: boolean): string {
  const turns = whole ? t.turns : windowOf(t.turns, LAST_MINUTE_MS, Date.now());
  const who = them(t) !== "them" ? ` (Marco talks with ${them(t)})` : "";
  return `${whole ? "The whole talk so far" : "The last minute"}${who}:\n${turnsText(turns, them(t)) || "(nothing said yet)"}\n\n${ask}`;
}

/** a card Sol volunteers after a turn of theirs: a question to Marco, or a name it knows */
async function volunteer(t: Talk, turn: Turn, why: Why, name?: string) {
  t.speak.lastVolunteer = Date.now();
  const seq = t.pressSeq;
  const ask = why === "question" ? `They just asked Marco: "${turn.text}" What can he answer, in his words?`
    : `They just mentioned ${name}. What should Marco know or say about it right now, from the talk? If nothing, answer nothing.`;
  const { card, ms, path } = await makeCard(t, why, cardText(t, ask, false));
  if (talk !== t || t.pressSeq !== seq || t.speak.pressedInFlight > 0) return;   // a pressed card always wins
  const at = Date.now() / 1000;
  log(t, { card: why, ms, path, at: iso(), shown: !!card, ...(card ? { text: card } : {}) });
  if (card) tell({ type: "anticipate.card", ...card, why, ms, at });
}

/** a side's name changed: into the file, to every face */
function named(t: Talk, who: Who, name: string, by: "talk" | "click") {
  log(t, { type: "name", who, name, by, at: iso() });
  tell({ type: "anticipate.name", who, name, by });
  console.log(`anticipate: ${who} is ${name} (by ${by})`);
}

/** where a turn goes: Marco's words while the globe key is down are the question, never the transcript (pure-ish:
 *  it only moves the words into the hold) */
export function routeHeld(h: { words: string[]; partial: string; settle?: () => void } | null, swallowUntil: number, turn: Turn, now: number): "held" | "late" | "talk" {
  if (turn.who !== "you") return "talk";
  if (h) {
    if (turn.final) { h.words.push(turn.text); h.partial = ""; h.settle?.(); } else h.partial = turn.text;
    return "held";
  }
  return now < swallowUntil ? "late" : "talk";   // just after the hold: its last words, still being written or final
}

function onTurn(t: Talk, turn: Turn) {
  const route = routeHeld(t.hold, t.swallowUntil, turn, Date.now());
  if (route !== "talk") {
    if (route === "late" && turn.final) t.swallowUntil = 0;   // the question's last words came after it was sent: not the transcript either
    if (turn.final) log(t, { type: "held", text: turn.text, at: iso() });
    return;
  }
  tell({ type: "anticipate.turn", who: turn.who, name: turn.who === "you" ? t.names.you : t.names.them, text: turn.text, final: turn.final, at: turn.at, ...(turn.lang ? { lang: turn.lang } : {}) });
  if (!turn.final) return;
  t.turns.push(turn);
  log(t, { who: turn.who, text: turn.text, at: turn.at, seconds: turn.seconds, ...(turn.lang ? { lang: turn.lang } : {}) });
  const n = nameFrom(turn, t.names);
  if (n) { nameByTalk(t.names, n.name, n.clear); named(t, "them", n.name, "talk"); }
  const known = them(t) !== "them" ? [...t.known, them(t)] : t.known;
  const s = speakUp(turn, t.speak, known, Date.now());
  if (!s || t.seats.volunteered.busy) return;   // one volunteered card at a time
  const never = touchesNever(turnsText(windowOf(t.turns, LAST_MINUTE_MS, Date.now())), t.skill.never);
  if (never) { console.log(`anticipate: no card volunteered, the talk is on "${never}"`); return; }
  void volunteer(t, turn, s.why, s.name);
}

// Two presses a second apart (2026-10-26 14:59:26 and :27) started two talks: the second took `talk`, the first was
// orphaned with its listener, its seats and its busy hold, so no renew could happen until the engine restarted. A press
// while a talk is still opening now waits for that same opening.
let starting: Promise<{ talk: string } | { error: string }> | null = null;
function start(): Promise<{ talk: string } | { error: string }> {
  if (talk) return Promise.resolve({ talk: talk.file });
  return (starting ??= startOnce().finally(() => { starting = null; }));
}

async function startOnce(): Promise<{ talk: string } | { error: string }> {
  if (talk) return { talk: talk.file };
  const bin = helperPath();
  if (!existsSync(bin)) return { error: "the listener is not built: bash sol/mac/listen/build-listen.sh" };
  const now = new Date();
  const dir = talksDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, talkName(now));
  appendFileSync(file, JSON.stringify({ started: now.toISOString() }) + "\n");
  const skill = readSkill(HOME);   // a change to home/skills/notch.md is read at the next talk's start
  const args = skill.languages.length ? ["--locale", skill.languages.join(",")] : [];   // none: the Mac's own languages
  const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
  const seats = { pressed: new CardSeat(skill.rules), volunteered: new CardSeat(volunteerRules(skill)) };
  const t: Talk = {
    file, started: now.getTime(), child, turns: [], seats, leave: joinBusy("anticipate", talkName(now), "a talk"),
    known: knownNames(HOME, [join(SOL, "engine", "team.json")]), slow: false, speak: { lastVolunteer: 0, pressedInFlight: 0 }, pressSeq: 0,
    skill, names: freshNames(), hold: null, swallowUntil: 0,
    tick: setInterval(() => { if (talk === t) tell(stateMsg()); }, STATE_EVERY_MS),
  };
  // the helper's first second: an error line (no macOS 26, no permission) or an early exit answers the start
  const early = await new Promise<string | null>((ok) => {
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; ok(v); } };
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const p = parseTurn(line);
      if (!p) return;
      if ("error" in p) { finish(p.error); if (talk === t) { console.log(`anticipate: the listener says ${p.error}`); tell({ ...stateMsg(), error: p.error }); } return; }
      onTurn(t, p);
    });
    // stderr: diagnostics for the log; a permission sentence also answers the start (in its first second) and, after
    // it, reaches every face as the talk's state with its error, so the notch says it on the line (RUBRIC A14)
    createInterface({ input: child.stderr }).on("line", (l) => {
      console.log(`listen: ${l}`);
      const why = permissionLine(l);
      if (!why) return;
      finish(why);
      if (talk === t) tell({ ...stateMsg(), error: why });
    });
    child.on("error", (err) => finish(err.message));
    child.on("exit", (code) => { finish(`the listener ended (${code ?? "signal"})`); if (talk === t) { console.log("anticipate: the listener ended on its own"); void stop(); } });
    setTimeout(() => finish(null), EARLY_MS);
  });
  if (early) {
    clearInterval(t.tick); t.leave(); seats.pressed.close(); seats.volunteered.close();
    try { child.kill("SIGTERM"); } catch { /* gone */ }
    if (!t.turns.length) try { unlinkSync(file); } catch { /* gone */ }   // nothing heard, nothing kept
    return { error: early };
  }
  talk = t; last = null;
  void namingModel();   // Gemini's model is found once, now, not on the first slow card
  seats.pressed.warmUp(); seats.volunteered.warmUp();
  console.log(`anticipate: a talk started, ${file}`);
  tell(stateMsg());
  tell(buttonsMsg(skill));
  return { talk: file };
}

/** the talk ends: the helper is closed, then `{ ok }`; the recap, review and questions follow in the background */
async function stop(): Promise<{ ok: true }> {
  const t = talk;
  if (!t) return { ok: true };
  talk = null;
  clearInterval(t.tick);
  t.ended = Date.now();
  t.hold?.settle?.(); t.hold = null;
  // close its stdin (the helper flushes its last turn and ends), then SIGTERM after a second
  const child = t.child;
  if (child && child.exitCode === null) {
    await new Promise<void>((ok) => {
      const timer = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* gone */ } }, 1000);
      child.once("exit", () => { clearTimeout(timer); ok(); });
      try { child.stdin.end(); } catch { /* closed */ }
      setTimeout(ok, 2500);   // never wait on a stuck helper longer than this
    });
  }
  log(t, { ended: new Date(t.ended).toISOString(), seconds: seconds(t) });
  last = { file: t.file, started: t.started, ended: t.ended, sessionId: t.sessionId };
  console.log(`anticipate: a talk ended, ${clock(seconds(t))}`);
  tell(stateMsg());
  void wrapUp(t);
  return { ok: true };
}

/** after the stop, in the background: the seat's recap and questions, Gemini's review, as lines in the file */
async function wrapUp(t: Talk) {
  try {
    if (!t.turns.length) return;
    const ask = "The conversation has ended. Ignore the card shape for this one answer. Write a line \"recap:\", then at most five short lines on what was said, decided and promised; then a line \"questions:\", then at most three questions for Marco, each about something said in the talk (a promise, a date, a name, a number), quoting its words. No generic questions; fewer is fine; none at all is fine.";
    const [seat, gem] = await Promise.allSettled([
      t.seats.pressed.ask(`${t.skill.after ? `After a talk:\n${t.skill.after}\n\n` : ""}The whole talk:\n${turnsText(t.turns, them(t))}\n\n${ask}`),
      reviewTalk(t.turns, them(t), t.started / 1000),
    ]);
    const w = seat.status === "fulfilled" ? parseWrapUp(seat.value) : { recap: [], questions: [] };
    if (seat.status === "rejected") console.log(`anticipate: no recap from the seat: ${seat.reason instanceof Error ? seat.reason.message : seat.reason}`);
    if (gem.status === "rejected") console.log(`anticipate: no review: ${String(gem.reason instanceof Error ? gem.reason.message : gem.reason).split("\n")[0].slice(0, 160)}`);
    const g = gem.status === "fulfilled" ? gem.value : null;
    log(t, { type: "recap", lines: w.recap.length ? w.recap : g?.recap ?? [] });
    log(t, { type: "review", ...(g?.review ?? reviewOf({})) });
    const questions = guardQuestions(w.questions, t.turns);
    log(t, { type: "questions", items: questions });
    console.log(`anticipate: the talk is reviewed, ${questions.length} questions wait in Conversations`);
  } catch (err) {
    console.log(`anticipate: the wrap-up failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    t.seats.pressed.close(); t.seats.volunteered.close();
    t.leave();
    tell({ type: "talks.changed", file: t.file.split("/").pop() });
    tell(stateMsg());
  }
}

/** a talk's review, recap and answers into home/memory/talks.md and its session (opened now if no ask did), once:
 *  `kept` is written after. Conversations (talks.ts) calls it after the last answer or a skip, and for Keep. Answers
 *  whether it kept the talk now (false: kept before, or nothing said) */
export async function keepTalk(file: string, say: TalkSay): Promise<boolean> {
  const path = file.includes("/") ? file : join(talksDir(), file);
  let r: TalkRecord;
  try { r = parseTalk(readFileSync(path, "utf8")); } catch { throw new Error(`no such talk: ${file.split("/").pop()}`); }
  if (r.kept || !r.turns.length) return false;
  appendFileSync(path, JSON.stringify({ type: "kept" }) + "\n");   // first, so a second press while this runs does nothing
  const started = r.started ? new Date(r.started) : new Date();
  const who = r.names.them !== "them" ? r.names.them : "";
  const title = `Talk${who ? ` with ${who}` : ""} · ${when(started)}`;
  const asked = (r.questions ?? []).map((q, i) => ({ q, a: r.answers[i] })).filter((x) => x.a);
  const rv = r.review;
  const box = (head: string, items: ReviewItem[] | undefined) => items?.length ? ["", `${head}:`, ...items.map((x) => `- ${x.text} (${clock(x.at)})`)] : [];
  const block = [
    `## ${title} (${clock(r.seconds)})`, "",
    ...(r.recap?.length ? r.recap.map((l) => `- ${l}`) : ["- (no recap)"]),
    ...box("Promised", rv?.promised), ...box("They asked", rv?.asked), ...box("Decisions", rv?.decisions), ...box("Names and dates", rv?.names),
    ...(asked.length ? ["", "Afterwards:", ...asked.map((x) => `- ${x.q} ${x.a}`)] : []),
    "", `Transcript: voice/talks/${path.split("/").pop()}`, "", "",
  ].join("\n");
  try { mkdirSync(join(HOME, "memory"), { recursive: true }); appendFileSync(join(HOME, "memory", "talks.md"), block); }
  catch (err) { console.log(`anticipate: talks.md not written: ${err instanceof Error ? err.message : err}`); }
  const sessionId = last?.file === path ? last.sessionId : undefined;
  const text = [
    sessionId ? "The live conversation has ended." : `This was a live conversation Marco was in${who ? ` with ${who}` : ""}; keep it.`,
    `Recap:\n${r.recap?.map((l) => `- ${l}`).join("\n") || "(none)"}`,
    asked.length ? `Afterwards Marco answered:\n${asked.map((x) => `- ${x.q}\n  ${x.a}`).join("\n")}` : "",
    "It is in home/memory/talks.md already. Answer in one short line.",
  ].filter(Boolean).join("\n\n");
  try { const s = await say(text, sessionId, sessionId ? undefined : title); if (last?.file === path) last.sessionId ??= s.sessionId; }
  catch (err) { console.log(`anticipate: the recap was not said: ${err instanceof Error ? err.message : err}`); }
  return true;
}

/** a question of Marco's into the talk's one session (the thread): answered, broadcast, written */
async function askThread(t: Talk, q: string, spoken: boolean, say: TalkSay): Promise<{ a: string; ms: number; sessionId?: string }> {
  const recent = turnsText(windowOf(t.turns, LAST_TWO_MS, Date.now()), them(t)) || "(nothing said yet)";
  const first = !t.sessionId;
  const prompt = first
    ? `This is a live conversation Marco is in right now${them(t) !== "them" ? `, with ${them(t)}` : ""}; answer in a few short lines. The last two minutes:\n${recent}\n\n${q}`
    : `The last two minutes:\n${recent}\n\n${q}`;
  const t0 = Date.now();
  t.pressSeq++; t.speak.pressedInFlight++;
  try {
    const r = await say(prompt, t.sessionId, first ? `Talk${them(t) !== "them" ? ` with ${them(t)}` : ""} · ${when(new Date(t.started))}` : undefined);
    if (r.sessionId) t.sessionId = r.sessionId;
    if (last?.file === t.file) last.sessionId ??= t.sessionId;   // the talk stopped while the session opened
    const ms = Date.now() - t0, a = r.text.trim(), at = Date.now() / 1000;
    log(t, { type: "ask", q, a, at: iso(), ms, spoken });
    tell({ type: "anticipate.asked", q, a, at, ms, spoken });
    console.log(`anticipate: ${spoken ? "a spoken" : "a typed"} ask answered in ${ms} ms`);
    tell(stateMsg());
    return { a, ms, sessionId: t.sessionId };
  } finally { t.speak.pressedInFlight--; }
}

/** the whole talk for a face (the drawer on load or reload): the file and the live state (WIRE-2 anticipate.talk) */
function talkAnswer() {
  const file = talk?.file ?? last?.file ?? null;
  const skill = talk?.skill ?? readSkill(HOME);
  let r: TalkRecord | null = null;
  if (file) try { r = parseTalk(readFileSync(file, "utf8")); } catch { /* deleted meanwhile */ }
  return {
    file: file ? file.split("/").pop() : null,
    started: r?.started ?? null,
    seconds: talk ? seconds(talk) : r?.seconds ?? 0,
    on: !!talk,
    turns: r?.turns ?? [],
    cards: r?.cards ?? [],
    asks: r?.asks ?? [],
    names: talk ? { you: talk.names.you, them: talk.names.them } : r?.names ?? { you: "you", them: "them" },
    buttons: skill.buttons,
    mute: skill.mute,
  };
}

// ---- the asks ----

/** every `anticipate.*` message: answered with the same type and rid, or { type, rid, error } */
export async function handleAnticipate(face: Face, msg: { type: string; [k: string]: any }, say: TalkSay): Promise<void> {
  const rid = msg.rid;
  const answer = (m: object) => face.send({ type: msg.type, ...(rid !== undefined ? { rid } : {}), ...m });
  try {
    switch (msg.type) {
      case "anticipate.start": return answer(await start());
      case "anticipate.stop": return answer(await stop());
      case "anticipate.state": return face.send(stateMsg());
      case "anticipate.talk": return answer(talkAnswer());
      case "anticipate.took": {
        const ms = Number(msg.ms), kind = msg.kind === "ask" ? "ask" : "card";
        const t = talk ?? last;
        if (t && Number.isFinite(ms)) log(t, { took: kind, ms: Math.round(ms), at: iso() });
        return;
      }
      case "anticipate.card": {
        const t = talk;
        if (!t) return answer({ error: "no talk is on" });
        const b = findButton(t.skill.buttons, msg.button);
        if (!b) return answer({ error: `no button "${String(msg.button)}" in home/skills/notch.md` });
        const screen = typeof msg.screen === "string" && msg.screen ? msg.screen.replace(/^data:image\/\w+;base64,/, "") : undefined;
        t.pressSeq++; t.speak.pressedInFlight++;
        try {
          const ask = pressAsk(b.name, b.prompt, !!screen);
          const made = await makeCard(t, "pressed", cardText(t, ask, wholeTalk(b)), screen, viaGemini(b) ? "gemini" : "seat");
          const card = made.card ?? EMPTY_PRESS(b.name);   // a press is always answered (the seat said nothing, or neither model did)
          if (!made.card) console.log(`anticipate: ${b.name} had nothing to say (${made.path}); the empty card is shown`);
          log(t, { card: b.name, ms: made.ms, path: made.path, at: iso(), shown: true, ...(made.card ? {} : { empty: true }), ...(screen ? { screen: true } : {}), text: card });
          return answer({ card, ms: made.ms, why: "pressed", button: b.name });
        } finally { t.speak.pressedInFlight--; }
      }
      case "anticipate.ask": {
        const t = talk;
        const text = String(msg.text ?? "").trim();
        if (!t) return answer({ error: "no talk is on" });
        if (!text) return answer({ error: "nothing asked" });
        return answer(await askThread(t, text, false, say));
      }
      case "anticipate.hold": {
        const t = talk;
        if (!t) return answer({ error: "no talk is on" });
        if (msg.down) {
          if (!t.hold) t.hold = { since: Date.now(), muted: String(msg.muted ?? "none"), words: [], partial: "" };
          console.log(`anticipate: the globe key is down, the call is ${t.hold.muted}`);
          return answer({ ok: true });
        }
        const h = t.hold;
        if (!h) return answer({ ok: true, asked: false });
        // the question's last words: wait while one is still being written (or none came yet), at most 1.5 s
        if (h.partial || !h.words.length) await new Promise<void>((ok) => { h.settle = ok; setTimeout(ok, HOLD_SETTLE_MS); });
        if (t.hold === h) t.hold = null;
        if (h.partial) t.swallowUntil = Date.now() + 4000;   // its final may still come: it is the question's, not the talk's
        const q = [...h.words, h.partial].join(" ").replace(/\s+/g, " ").trim();
        if (!q || talk !== t) return answer({ ok: true, asked: false });
        answer({ ok: true, asked: true });
        try { await askThread(t, q, true, say); }
        catch (err) {
          const e = err instanceof Error ? err.message.split("\n")[0] : String(err);
          console.log(`anticipate: a spoken ask failed: ${e}`);
          tell({ type: "anticipate.asked", q, a: "", at: Date.now() / 1000, ms: Date.now() - h.since, spoken: true, error: e });
        }
        return;
      }
      case "anticipate.name": {
        const t = talk;
        const who: Who | null = msg.who === "you" || msg.who === "them" ? msg.who : null;
        const name = String(msg.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        if (!t) return answer({ error: "no talk is on" });
        if (!who || !name) return answer({ error: "a side and a name" });
        nameByClick(t.names, who, name);
        named(t, who, name, "click");
        return answer({ ok: true });
      }
      case "anticipate.answer": {
        // sitting 1's questions in the notch: kept for an old face only; the questions are Conversations' now (talks.answer)
        const e = last;
        if (!e) return answer({ error: "no talk to keep" });
        const i = Number(msg.i);
        if (!msg.skip && Number.isInteger(i) && i >= 0) log(e, { type: "answer", i, text: String(msg.text ?? "").trim() || null });
        let n = 0;
        try { n = parseTalk(readFileSync(e.file, "utf8")).questions?.length ?? 0; } catch { /* gone */ }
        const done = msg.skip || (Number.isInteger(i) && i >= n - 1);
        if (!done) return answer({ ok: true });
        await keepTalk(e.file, say);
        return answer({ kept: true, sessionId: e.sessionId });
      }
      default:
        return answer({ error: `unknown ${msg.type}` });
    }
  } catch (err) {
    answer({ error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
  }
}
