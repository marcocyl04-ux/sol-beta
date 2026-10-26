// Conversations (#253): the talks in home/voice/talks, read
// for the app's Conversations page. The talk file is the record and the only one: no database, no index file. A list
// reads each file once and keeps what it parsed by the file's mtime and size, so a second list reads nothing new.
// A talk with no review (sitting 1's, or one whose stop never got there) is reviewed by Gemini flash on the engine's
// key, the same model titles.ts names conversations with, never a cold Claude call; the review is written into the file.
// Keep appends the recap and the review to home/memory/talks.md once (a `kept` line marks it). Every write is told to
// the faces as `talks.changed { file, waiting }` (`waiting`: talks with no `seen` line, for the menu's dot).
// The pure parts (parseTalk, indexLine, parseReview, talkMarkdown, keepBlock) are tested in test/talks.test.ts.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Face } from "./browser.js";
import { keepTalk, reviewText, tellState, type TalkSay } from "./anticipate.js";
import { addToShelf } from "./shelf.js";

// ---- the shape ----

export type Item = { text: string; at: number };   // `at`: seconds into the talk
export type Review = { promised: Item[]; asked: Item[]; decisions: Item[]; names: Item[] };
export type TalkTurn = { who: "you" | "them"; text: string; at: number; seconds: number };
export type TalkCard = { button: string; head: string; bullets: string[]; source: string; at: number; ms: number };
export type TalkAsk = { q: string; a: string; at: number; ms: number; spoken: boolean };
export type Talk = {
  file: string; started: number; ended: number | null; seconds: number;
  turns: TalkTurn[]; cards: TalkCard[]; asks: TalkAsk[]; names: { you: string; them: string };
  recap: string[]; review: Review | null; questions: string[]; answers: (string | null | undefined)[]; kept: boolean; seen: boolean;
};
export type IndexLine = { file: string; started: number; ended: number | null; seconds: number; who: string[]; recap: string; seen: boolean; questions: number; answered: number; kept: boolean };

export const BOXES = ["promised", "asked", "decisions", "names"] as const;
export const emptyReview = (): Review => ({ promised: [], asked: [], decisions: [], names: [] });
const FILE = /^\d{8}-\d{6}\.jsonl$/;

/** a time on a line as epoch ms: epoch seconds, epoch ms or an ISO string (pure) */
export function msOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}
/** "m:ss" or "h:mm:ss" (pure) */
export const clock = (s: number) => {
  const v = Math.max(0, Math.round(s)), h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), ss = String(v % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
/** "12:34", "1:02:45", 754 or "754" as seconds (pure); null when it is none of them */
export function secondsOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.round(v));
  if (typeof v !== "string") return null;
  const m = /^\s*(?:(\d+):)?(\d{1,3}):(\d{2})\s*$/.exec(v);
  if (m) return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
  return /^\s*\d+\s*$/.test(v) ? Number(v) : null;
}
const items = (v: unknown): Item[] => (Array.isArray(v) ? v : []).map((x: any) => (typeof x === "string" ? { text: x, at: 0 } : { text: String(x?.text ?? "").trim(), at: secondsOf(x?.at) ?? 0 })).filter((x) => x.text);
const reviewOf = (o: any): Review => ({ promised: items(o?.promised), asked: items(o?.asked), decisions: items(o?.decisions), names: items(o?.names) });

/** every line of a talk file into the page's shape (pure); `file` is the file's own name */
export function parseTalk(file: string, text: string): Talk {
  const t: Talk = { file, started: 0, ended: null, seconds: 0, turns: [], cards: [], asks: [], names: { you: "you", them: "them" },
    recap: [], review: null, questions: [], answers: [], kept: false, seen: false };
  const off = (v: unknown) => { const ms = msOf(v); return ms === null || !t.started ? 0 : Math.max(0, Math.round((ms - t.started) / 100) / 10); };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== "object") continue;
    if (o.started !== undefined && !t.started) t.started = msOf(o.started) ?? 0;
    else if (o.ended !== undefined) { t.ended = msOf(o.ended); if (Number.isFinite(o.seconds)) t.seconds = Number(o.seconds); }
    else if ((o.who === "you" || o.who === "them") && typeof o.text === "string" && !o.type) {
      const text = o.text.replace(/\s+/g, " ").trim();
      if (text) t.turns.push({ who: o.who, text, at: off(o.at), seconds: Number(o.seconds) || 0 });
    } else if (typeof o.card === "string") {
      const c = o.text && typeof o.text === "object" ? o.text : null;
      if (c && typeof c.head === "string" && c.head) t.cards.push({ button: o.card, head: c.head, bullets: Array.isArray(c.bullets) ? c.bullets.map(String) : [], source: String(c.source ?? ""), at: off(o.at), ms: Number(o.ms) || 0 });
    } else if (o.type === "name" && (o.who === "you" || o.who === "them") && typeof o.name === "string" && o.name.trim()) t.names[o.who as "you" | "them"] = o.name.trim();
    else if (o.type === "ask" && typeof o.q === "string") t.asks.push({ q: o.q, a: String(o.a ?? ""), at: off(o.at), ms: Number(o.ms) || 0, spoken: !!o.spoken });
    else if (o.type === "recap" && Array.isArray(o.lines)) t.recap = o.lines.map(String).filter(Boolean);
    else if (o.type === "review") t.review = reviewOf(o);
    else if (o.type === "questions" && Array.isArray(o.items)) t.questions = o.items.map(String).filter(Boolean);
    else if (o.type === "answer" && Number.isInteger(o.i) && o.i >= 0) t.answers[o.i] = typeof o.text === "string" ? o.text : null;
    else if (o.type === "kept") t.kept = true;
    else if (o.type === "seen") t.seen = true;
  }
  if (!t.started) { const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(file); if (m) t.started = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(); }
  if (!t.seconds) t.seconds = t.ended && t.started ? Math.round((t.ended - t.started) / 1000) : Math.round(Math.max(0, ...t.turns.map((x) => x.at + x.seconds)));
  return t;
}

/** who was heard: you, and the other side by its name when they spoke (pure) */
export const whoOf = (t: Talk): string[] => (t.turns.some((x) => x.who === "them") ? [t.names.you, t.names.them] : [t.names.you]);
/** the list's line of a talk (pure) */
export function indexLine(t: Talk): IndexLine {
  const answered = t.answers.reduce((n, a, i) => (i < t.questions.length && a !== undefined ? n + 1 : n), 0);
  const recap = t.recap[0] ?? t.review?.decisions[0]?.text ?? t.turns[0]?.text ?? "";
  return { file: t.file, started: t.started, ended: t.ended, seconds: t.seconds, who: whoOf(t), recap: recap.length > 140 ? `${recap.slice(0, 139)}…` : recap,
    seen: t.seen, questions: t.questions.length, answered, kept: t.kept };
}

/** the transcript as a model reads it, each turn with its time into the talk (pure) */
export const transcriptText = (t: Talk) => t.turns.map((x) => `[${clock(x.at)}] ${x.who === "you" ? t.names.you === "you" ? "Marco" : t.names.you : t.names.them}: ${x.text}`).join("\n");

export const REVIEW_PROMPT = `You review a conversation Marco had (a call or a talk in a room). Each turn starts with its time into the talk in brackets.
Answer with JSON only, no prose, in this shape:
{"recap": ["one short line", "..."], "promised": [{"text": "...", "at": "m:ss"}], "asked": [...], "decisions": [...], "names": [...]}
- recap: two or three short lines, the first one the gist (it is shown alone in a list).
- promised: what Marco said he would do. asked: what the other side asked of Marco. decisions: what was settled.
  names: people, places, dates and numbers worth keeping.
- each item at most ten words, plain, in the talk's language; "at" is the time of the turn the item comes from, quoted from its brackets.
- an empty list when there is nothing; never invent.`;

/** Gemini's answer as recap lines and the four boxes (pure); tolerant of code fences and prose around the JSON */
export function parseReview(text: string): { recap: string[]; review: Review } {
  const s = text.replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  let o: any = {};
  if (a >= 0 && b > a) try { o = JSON.parse(s.slice(a, b + 1)); } catch { o = {}; }
  const recap = (Array.isArray(o.recap) ? o.recap : typeof o.recap === "string" ? o.recap.split("\n") : []).map((l: unknown) => String(l).replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean).slice(0, 4);
  return { recap, review: reviewOf(o) };
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
export const BOX_WORDS: Record<keyof Review, string> = { promised: "What I promised", asked: "What they asked me", decisions: "Decisions", names: "Names and dates" };
export const titleOf = (t: Talk) => `Talk with ${t.names.them === "them" ? "someone" : t.names.them} · ${day(t.started)}`;

/** the talk as one markdown file, for sending (pure) */
export function talkMarkdown(t: Talk): string {
  const out = [`# ${titleOf(t)}`, "", `${when(t.started)} · ${clock(t.seconds)} · ${whoOf(t).join(" · ")}`, ""];
  if (t.recap.length) out.push("## Recap", "", ...t.recap.map((l) => `- ${l}`), "");
  if (t.review) for (const k of BOXES) if (t.review[k].length) out.push(`## ${BOX_WORDS[k]}`, "", ...t.review[k].map((x) => `- ${x.text} (${clock(x.at)})`), "");
  out.push("## Transcript", "", ...t.turns.map((x) => `**${x.who === "you" ? t.names.you : t.names.them}** ${clock(x.at)}  \n${x.text}\n`));
  if (t.cards.length) out.push("## Cards", "", ...t.cards.map((c) => `- ${clock(c.at)} **${c.head}**${c.bullets.length ? `: ${c.bullets.join(" ")}` : ""}${c.source ? ` (${c.source})` : ""}`), "");
  if (t.asks.length) out.push("## Asked during the talk", "", ...t.asks.map((x) => `- ${clock(x.at)} ${x.spoken ? "🌐 " : ""}${x.q}\n  ${x.a}`), "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** the block Keep appends to home/memory/talks.md, as sitting 1's keep wrote it, with the review and answers (pure) */
export function keepBlock(t: Talk): string {
  const asked = t.questions.map((q, i) => ({ q, a: t.answers[i] })).filter((x) => x.a);
  const boxes = t.review ? BOXES.filter((k) => t.review![k].length).map((k) => `- ${BOX_WORDS[k]}: ${t.review![k].map((x) => x.text).join("; ")}`) : [];
  return [
    `## Talk · ${when(t.started)} (${clock(t.seconds)})${t.names.them !== "them" ? ` with ${t.names.them}` : ""}`, "",
    ...(t.recap.length ? t.recap.map((l) => `- ${l}`) : ["- (no recap)"]),
    ...(boxes.length ? ["", ...boxes] : []),
    ...(asked.length ? ["", ...asked.map((x) => `- ${x.q} ${x.a}`)] : []),
    "", `Transcript: voice/talks/${t.file}`, "", "",
  ].join("\n");
}

// ---- the files ----

const HERE = dirname(fileURLToPath(import.meta.url));
let HOME = "";
let tellAll: ((m: object) => void) | null = null;
const faces = new Set<Face>();   // the faces that asked talks.*, told of changes when no `everyone` was given
/** where the home is and how to tell every face (index.ts may call it; without it the home is found as index.ts finds it) */
export function setTalks(home: string, everyone?: (m: object) => void) { HOME = home; if (everyone) tellAll = everyone; cache.clear(); }
const home = () => (HOME ||= realpathSync(process.env.SOL_HOME ?? resolve(HERE, "..", "..", "home")));
const dir = () => join(home(), "voice", "talks");
const pathOf = (file: unknown) => {
  if (typeof file !== "string" || !FILE.test(file)) throw new Error("no such talk");
  const p = join(dir(), file);
  if (!existsSync(p)) throw new Error("no such talk");
  return p;
};
const cache = new Map<string, { mtime: number; size: number; talk: Talk }>();
/** the talk, read from disk only when the file changed since the last read */
function load(file: string): Talk {
  const p = pathOf(file), st = statSync(p), had = cache.get(file);
  if (had && had.mtime === st.mtimeMs && had.size === st.size) return had.talk;
  const talk = parseTalk(file, readFileSync(p, "utf8"));
  cache.set(file, { mtime: st.mtimeMs, size: st.size, talk });
  return talk;
}
const write = (file: string, o: object) => appendFileSync(pathOf(file), JSON.stringify(o) + "\n");
const files = () => { try { return readdirSync(dir()).filter((f) => FILE.test(f)); } catch { return []; } };
export function listTalks(): IndexLine[] {
  const out: IndexLine[] = [];
  for (const f of files()) try { out.push(indexLine(load(f))); } catch { /* gone meanwhile */ }
  return out.sort((a, b) => b.started - a.started);
}
export const waiting = () => listTalks().filter((t) => !t.seen).length;
function changed(face: Face, file: string) {
  const m = { type: "talks.changed", file, waiting: waiting() };
  if (tellAll) return tellAll(m);
  faces.add(face);
  for (const f of faces) f.send(m);
}

// ---- the review (anticipate.ts's reviewText: Gemini flash, else a Claude card seat; a plain sentence when neither) ----

const reviewing = new Map<string, Promise<{ recap: string[]; review: Review }>>();
const STOP_GRACE_MS = 60_000;   // the stop writes its own review within a minute; a fresh talk waits for it first
async function review(file: string): Promise<{ recap: string[]; review: Review }> {
  let t = load(file);
  if (t.review) return { recap: t.recap, review: t.review };
  const has = reviewing.get(file);
  if (has) return has;
  const p = (async () => {
    while (t.ended && Date.now() - t.ended < STOP_GRACE_MS && !t.review) { await new Promise((r) => setTimeout(r, 3000)); t = load(file); }
    if (t.review) return { recap: t.recap, review: t.review };
    if (!t.turns.length) return { recap: [], review: emptyReview() };   // nothing was said: nothing to read, nothing written
    const r = parseReview(await reviewText(`${REVIEW_PROMPT}\n\n${transcriptText(t)}`));
    if (!t.recap.length && r.recap.length) write(file, { type: "recap", lines: r.recap });
    write(file, { type: "review", ...r.review });
    return { recap: t.recap.length ? t.recap : r.recap, review: r.review };
  })();
  reviewing.set(file, p);
  try { return await p; } finally { reviewing.delete(file); }
}

/** the review into home/memory/talks.md, the talk's session and a `kept` line, once: anticipate.ts's keepTalk (the
 *  one keep for the stop's path and this page's); false when kept before or nothing was said */
async function keep(file: string, say: TalkSay): Promise<boolean> {
  const kept = await keepTalk(file, say);
  if (kept) cache.delete(file);
  return kept;
}

// ---- the asks ----

/** every `talks.*` message: answered with the same type and rid, or { type, rid, error } */
export async function handleTalks(face: Face, msg: { type: string; [k: string]: any }, say: TalkSay): Promise<void> {
  const answer = (m: object) => face.send({ type: msg.type, ...(msg.rid !== undefined ? { rid: msg.rid } : {}), ...m });
  if (!tellAll) faces.add(face);
  const file = msg.file;
  try {
    switch (msg.type) {
      case "talks.list": return answer({ talks: listTalks() });
      case "talks.get": {
        const t = load(file);
        if (!t.seen) { write(file, { type: "seen", at: new Date().toISOString() }); changed(face, file); tellState(); return answer({ talk: { ...t, seen: true } }); }
        return answer({ talk: t });
      }
      case "talks.review": { const r = await review(file); changed(face, file); return answer(r); }
      case "talks.rename": {
        const name = typeof msg.name === "string" ? msg.name.replace(/\s+/g, " ").trim().slice(0, 40) : "";
        if ((msg.who !== "you" && msg.who !== "them") || !name) return answer({ error: "a side and a name" });
        write(file, { type: "name", who: msg.who, name, by: "click", at: new Date().toISOString() });
        changed(face, file);
        return answer({ ok: true });
      }
      case "talks.export": {
        const t = load(file);
        const { fresh } = addToShelf([{ buf: Buffer.from(talkMarkdown(t)), name: "talk.md", mime: "text/markdown" }], "file");
        const path = new URL(fresh[0].url, "http://x").searchParams.get("path") ?? join(home(), "shelf");
        return answer({ path, item: fresh[0] });
      }
      case "talks.delete": { unlinkSync(pathOf(file)); cache.delete(file); changed(face, file); return answer({ ok: true }); }
      case "talks.ask": {
        const t = load(file);
        const text = [
          `This is a conversation Marco had (${when(t.started)}, ${clock(t.seconds)}, ${whoOf(t).join(" and ")}), the whole transcript with each turn's time.`,
          t.recap.length ? `Recap:\n${t.recap.map((l) => `- ${l}`).join("\n")}` : "",
          `Transcript:\n${transcriptText(t)}`,
          "Marco will ask about it. For now answer in one short line that you have read it.",
        ].filter(Boolean).join("\n\n");
        const r = await say(text, undefined, titleOf(t));
        return answer({ sessionId: r.sessionId });
      }
      case "talks.answer": {
        const t = load(file);
        const i = Number(msg.i);
        if (!Number.isInteger(i) || i < 0 || i >= t.questions.length) return answer({ error: "no such question" });
        const text = typeof msg.text === "string" && msg.text.trim() ? msg.text.trim() : null;
        write(file, { type: "answer", i, text });
        if (msg.rest) for (let j = 0; j < t.questions.length; j++) if (j !== i && t.answers[j] === undefined) write(file, { type: "answer", i: j, text: null });
        const now = load(file);
        const done = now.questions.every((_, j) => now.answers[j] !== undefined);
        const kept = done && await keep(file, say);
        changed(face, file);
        return answer({ ok: true, ...(done ? { kept: kept || now.kept } : {}) });
      }
      case "talks.keep": { if (await keep(file, say)) changed(face, file); return answer({ ok: true }); }
      default: return answer({ error: `unknown ${msg.type}` });
    }
  } catch (err) {
    answer({ error: err instanceof Error ? err.message : String(err) });
  }
}
