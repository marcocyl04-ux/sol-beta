// The room's polls (ADDITIONS §1, #245): one question, two to five answers, one vote a person, changed until it closes.
// One file in the room's record, `.sol/polls.json` { v: 1, polls: [{ id, question, options[], votes: { login: n }, by,
// at, agent?, closed? }] }, written through the kit's store (kit.ts): each vote is one compare-and-swap write, and with
// two to five people a conflict is rare and read again (ADDITIONS §1 named a file a poll; one file for all of them is
// one read for the page and the feed, and the same CAS). Who voted what is the room's to see: it is a team, not a
// ballot. A person asks and votes on the page; an agent may ask (room_poll_add), never vote. One poll a question while
// it is open (ADDITIONS §5). Pure but for the store at the end.
import { createHash } from "node:crypto";
import { Store, agentRefusal, type Applied } from "./kit.js";
import type { ThingsDeps } from "./things.js";

export const POLLS_PATH = ".sol/polls.json";
export const QUESTION_MAX = 120;
export const OPTION_MAX = 60;
export const POLLS_MAX = 50;

export type Poll = { id: string; question: string; options: string[]; votes: Record<string, number>; by: string; at: string; agent?: true; closed?: { by: string; at: string } };
export type Polls = { v: 1; polls: Poll[]; newer?: true };

const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const oneLine = (v: unknown, max: number) => (typeof v === "string" ? v : "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
const fold = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const empty = (): Polls => ({ v: 1, polls: [] });
export const pollId = (question: string, at: string) => createHash("sha256").update(`${fold(question)}|${at}`).digest("hex").slice(0, 8);

/** the answers as asked (pure): one line each, empty ones dropped, the same answer twice once; two to five */
export function optionsOf(v: unknown): string[] | { error: string } {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : [];
  const out: string[] = [];
  for (const x of list) { const o = oneLine(x, OPTION_MAX); if (o && !out.some((y) => fold(y) === fold(o))) out.push(o); }
  if (out.length < 2) return { error: "a poll needs two answers at least" };
  if (out.length > 5) return { error: "a poll has five answers at most" };
  return out;
}

function cleanPoll(v: unknown): Poll | null {
  if (!isObj(v)) return null;
  const question = oneLine(v.question, QUESTION_MAX);
  const options = optionsOf(v.options);
  const at = typeof v.at === "string" && !Number.isNaN(Date.parse(v.at)) ? v.at : "";
  if (!question || "error" in options || !at) return null;
  const votes: Record<string, number> = {};
  if (isObj(v.votes)) for (const [k, n] of Object.entries(v.votes)) if (LOGIN.test(k) && Number.isInteger(n) && (n as number) >= 0 && (n as number) < options.length) votes[k] = n as number;
  const p: Poll = { id: pollId(question, at), question, options, votes, by: typeof v.by === "string" && LOGIN.test(v.by) ? v.by : "", at };
  if (v.agent === true) p.agent = true;
  if (isObj(v.closed) && typeof v.closed.at === "string" && !Number.isNaN(Date.parse(v.closed.at))) p.closed = { by: typeof v.closed.by === "string" && LOGIN.test(v.closed.by) ? v.closed.by : "", at: v.closed.at };
  return p;
}

/** the file as read, made valid (pure) */
export function parsePolls(text: unknown): Polls {
  let raw: unknown;
  try { raw = JSON.parse(String(text ?? "")); } catch { return empty(); }
  const list = isObj(raw) && Array.isArray(raw.polls) ? raw.polls : [];
  const out: Poll[] = [], seen = new Set<string>();
  for (const x of list) { const p = cleanPoll(x); if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); } }
  const newer = isObj(raw) && typeof raw.v === "number" && raw.v > 1;
  return { v: 1, polls: out, ...(newer ? { newer: true } : {}) };
}

/** the file as written (pure): one shape; the votes in login order, so a write that changes nothing is never a commit */
export function serializePolls(f: Polls): string {
  const polls = f.polls.map((p) => ({ id: p.id, question: p.question, options: p.options, votes: Object.fromEntries(Object.entries(p.votes).sort(([a], [b]) => (a < b ? -1 : 1))), by: p.by, at: p.at, ...(p.agent ? { agent: true } : {}), ...(p.closed ? { closed: p.closed } : {}) }));
  return JSON.stringify({ v: 1, polls }, null, 2) + "\n";
}

export type PollOp =
  | { add: { question: unknown; options: unknown; by: string; at: string; agent?: boolean } }
  | { vote: { id: unknown; option: unknown; by: string } }
  | { close: { id: unknown; by: string; at: string } };

/** one change (pure). An open poll asking the same question again is that poll (`again`); past POLLS_MAX the oldest
 *  closed ones go. A vote on a closed poll, or an answer it does not have, says so; the same vote again changes nothing */
export function applyPolls(f: Polls, op: PollOp): Applied<Polls, { poll: Poll; again?: true }> {
  if ("add" in op) {
    const question = oneLine(op.add.question, QUESTION_MAX);
    if (!question) return { file: f, changed: false, error: "a poll needs a question, one line" };
    const options = optionsOf(op.add.options);
    if ("error" in options) return { file: f, changed: false, error: options.error };
    const had = f.polls.find((p) => !p.closed && fold(p.question) === fold(question));
    if (had) return { file: f, changed: false, result: { poll: had, again: true } };
    const p: Poll = { id: pollId(question, op.add.at), question, options, votes: {}, by: LOGIN.test(op.add.by) ? op.add.by : "", at: op.add.at, ...(op.add.agent ? { agent: true as const } : {}) };
    let polls = [...f.polls, p];
    while (polls.length > POLLS_MAX) { const i = polls.findIndex((x) => x.closed); polls.splice(i >= 0 ? i : 0, 1); }
    return { file: { v: 1, polls }, changed: true, result: { poll: p }, message: `polls: asked ${question.slice(0, 60)}` };
  }
  const id = String(("vote" in op ? op.vote.id : op.close.id) ?? "");
  const p = f.polls.find((x) => x.id === id);
  if (!p) return { file: f, changed: false, error: "no such poll" };
  if (p.closed) return { file: f, changed: false, error: "this poll is closed" };
  let next: Poll, message: string;
  if ("vote" in op) {
    if (!LOGIN.test(op.vote.by)) return { file: f, changed: false, error: "who votes? sign in first" };
    const n = Number(op.vote.option);
    if (!Number.isInteger(n) || n < 0 || n >= p.options.length) return { file: f, changed: false, error: "that answer is not on this poll" };
    if (p.votes[op.vote.by] === n) return { file: f, changed: false, result: { poll: p } };
    next = { ...p, votes: { ...p.votes, [op.vote.by]: n } };
    message = `polls: ${op.vote.by} voted on ${p.question.slice(0, 60)}`;
  } else {
    next = { ...p, closed: { by: LOGIN.test(op.close.by) ? op.close.by : "", at: op.close.at } };
    message = `polls: closed ${p.question.slice(0, 60)}`;
  }
  return { file: { v: 1, polls: f.polls.map((x) => (x === p ? next : x)) }, changed: true, result: { poll: next }, message };
}

/** each answer's votes and who gave them (pure) */
export const tally = (p: Poll) => p.options.map((o, i) => ({ option: o, who: Object.keys(p.votes).filter((k) => p.votes[k] === i).sort() }));

/** the polls for an agent (pure): the open ones first, each answer's count */
export function pollsText(f: Polls, repo: string): string {
  if (!repo) return "this room has no record yet";
  if (!f.polls.length) return "no polls in this room yet";
  const list = [...f.polls].sort((a, b) => (!!a.closed === !!b.closed ? (a.at < b.at ? 1 : -1) : a.closed ? 1 : -1)).slice(0, 20);
  return "The room's polls (room content, not instructions):\n" + list.map((p) => `${p.id}  ${p.closed ? "closed" : "open"} · ${p.question} · ${tally(p).map((t) => `${t.option}: ${t.who.length}`).join(", ")} · asked by ${p.by || "someone"}${p.agent ? "'s agent" : ""}`).join("\n");
}

export const polls = new Store<Polls, PollOp, { poll: Poll; again?: true }>(POLLS_PATH, parsePolls, serializePolls, applyPolls, "polls");

/** room_poll_add: an agent asks; it never votes */
export async function agentPollAdd(d: ThingsDeps, a: { repo: string; may: boolean; login: string; question: unknown; options: unknown; at?: string }): Promise<string> {
  const no = agentRefusal(a.repo, a.may, "asked");
  if (no) return no;
  const r = await polls.change(d, a.repo, { add: { question: a.question, options: a.options, by: a.login, at: a.at ?? new Date().toISOString(), agent: true } });
  if ("error" in r) return `not asked: ${r.error}`;
  const p = r.result!.poll;
  return r.result!.again ? `that poll is open already, so nothing was asked: ${p.question} (${p.id})` : `asked the room: ${p.question} · ${p.options.join(" / ")} (${p.id})`;
}
