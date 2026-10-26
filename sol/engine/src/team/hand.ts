// Hand (#34, design/together/4-hand/PRD.md, PROTOCOL.md round 21): give an issue, a session or a PR to a teammate.
//
// The record is the issue (or the PR, which GitHub keeps as an issue too): the hand is written there first, the
// assignee and a signed comment, and only then is the word sent on the relay, so a relay that is down still leaves the
// record. The comments are the hands record, nothing else is: their first words are **hand**, **taken** or **passed**.
//   hand    "**hand** from marco to frank · 2026-10-20\n\n<brief>\n\nbranch: `<branch>` · session: <title> (...)"
//   taken   "**taken** by frank · 2026-10-20"
//   passed  "**passed** by frank · 2026-10-20: <line>"
// A review asked is a hand whose brief is "review asked", with the reviewer added on the PR.
//
// The brief travels, the transcript never: for a session Sol writes it from the session's items (its title, its last
// plan, its last wrap-up recap; nothing anyone said in it), at most 60 lines. The relay word carries only
// { issue, repo, to, brief, branch, by } (and review: true for a review), never a path, a session id or a transcript.
//
// On the receiving side, a hand to me is a card: Take writes **taken**, fetches the branch in the repo's folder and
// starts a Work session there with the brief, marked cowork; Pass writes **passed** with the line, gives the issue back
// to the sender and tells them; Later writes nothing and the hand stays "handed to you" under its repo. What is
// "handed to you" is read from the record (the issue's last hand line names me), plus what the relay said since.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Item } from "../work/items.js";
import { makeGithubRecord } from "./record.js";

const run = promisify(execFile);
const ENV = () => ({ ...process.env, GIT_TERMINAL_PROMPT: "0" });
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH = /^(?![-/.])(?!.*\.\.)[\w./-]{1,200}$/;
const PROTECTED = new Set(["main", "stable", "live", "master"]);
export const BRIEF_LINES = 60;
const LINE = 200;

// ---- pure: the brief, the comments, the record ----

/** "2026-10-20": the day a line on the record was written, in this machine's time */
export function day(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const clip = (s: string, n = LINE) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const oneLine = (s: unknown, n = 300) => clip(String(s ?? "").replace(/\s+/g, " ").trim(), n);

/** the brief Sol writes for a session: its title, its last plan, its last recap, capped at 60 lines (pure). Only the
 * plan and wrap items are read: nothing said in the session (me, you, think, tool output) is ever in it */
export function briefOf(title: string, items: Item[], max = BRIEF_LINES): string {
  const plan = [...items].reverse().find((i) => i.kind === "plan");
  const wrap = [...items].reverse().find((i) => i.kind === "wrap" && String(i.recap ?? "").trim());
  const lines: string[] = [oneLine(title || "untitled session", LINE)];
  const steps = Array.isArray(plan?.steps) ? (plan!.steps as { content?: unknown; status?: unknown }[]) : [];
  if (steps.length) {
    lines.push("", "the plan:");
    for (const s of steps) {
      const mark = s.status === "completed" ? "[x]" : s.status === "in_progress" ? "[~]" : "[ ]";
      lines.push(`- ${mark} ${oneLine(s.content, LINE - 6)}`);
    }
  }
  if (wrap) {
    lines.push("", "where it stands:");
    for (const l of String(wrap.recap).split("\n")) lines.push(clip(l.trimEnd()));
  }
  if (lines.length <= max) return lines.join("\n");
  return [...lines.slice(0, max - 1), `… ${lines.length - max + 1} more lines on the session`].join("\n");
}

export type HandText = { from: string; to: string; date: string; brief: string; branch?: string; session?: string };
/** the signed comment a hand writes on the issue (pure) */
export function handBody(h: HandText): string {
  const tail = [h.branch ? `branch: \`${h.branch}\`` : "", h.session ? `session: ${oneLine(h.session, 120)} (the brief travels, the transcript never)` : ""].filter(Boolean).join(" · ");
  return `**hand** from ${h.from} to ${h.to} · ${h.date}\n\n${h.brief.trim() || "(no brief)"}${tail ? `\n\n${tail}` : ""}`;
}
export const takenBody = (by: string, date: string) => `**taken** by ${by} · ${date}`;
export const passedBody = (by: string, date: string, line: string) => `**passed** by ${by} · ${date}: ${oneLine(line, 300)}`;
export const REVIEW_ASKED = "review asked";

export type Comment = { repo: string; number: number; at: string; author: string; body: string; url?: string };
export type How = "hand" | "taken" | "passed" | "review";
export type Row = {
  repo: string; number: number; at: string; how: How; from: string; to: string;
  line?: string; brief?: string; branch?: string; url?: string; sign: { login: string; agent: boolean };
};

const HAND = /^\*\*hand\*\* from ([A-Za-z0-9-]{1,39}) to ([A-Za-z0-9-]{1,39})(?: · [^\n]*)?\n?([\s\S]*)$/;
const TAKEN = /^\*\*taken\*\* by ([A-Za-z0-9-]{1,39})/;
const PASSED = /^\*\*passed\*\* by ([A-Za-z0-9-]{1,39})(?: · [^:\n]*)?(?::\s*([^\n]*))?/;

/** the issues' comments made into the hands record: one row per **hand** / **taken** / **passed** line, newest first
 * (pure). A taken row is from whoever handed it last; a passed row goes back to them */
export function parseRecord(comments: Comment[]): Row[] {
  const ordered = [...comments].sort((a, b) => a.at.localeCompare(b.at));
  const lastHand = new Map<string, Row>();   // repo#number -> the latest hand on it
  const rows: Row[] = [];
  for (const c of ordered) {
    const body = String(c.body ?? "").replace(/\r\n/g, "\n").trim();
    const key = `${c.repo}#${c.number}`;
    const sign = { login: c.author, agent: /\[bot\]$/i.test(c.author) };
    const base = { repo: c.repo, number: c.number, at: c.at, ...(c.url ? { url: c.url } : {}), sign };
    let m: RegExpExecArray | null;
    if ((m = HAND.exec(body))) {
      const rest = m[3].trim();
      const tail = /\n\n(branch: `([^`]+)`[^\n]*|session: [^\n]*)$/.exec(rest);
      const brief = (tail ? rest.slice(0, tail.index) : rest).trim();
      const row: Row = { ...base, how: brief === REVIEW_ASKED ? "review" : "hand", from: m[1], to: m[2], brief, ...(tail?.[2] ? { branch: tail[2] } : {}) };
      rows.push(row);
      lastHand.set(key, row);
    } else if ((m = TAKEN.exec(body))) {
      rows.push({ ...base, how: "taken", from: lastHand.get(key)?.from ?? "", to: m[1] });
    } else if ((m = PASSED.exec(body))) {
      const h = lastHand.get(key);
      rows.push({ ...base, how: "passed", from: m[1], to: h?.from ?? "", ...(m[2] ? { line: m[2].trim() } : {}), ...(h?.branch ? { branch: h.branch } : {}) });
    }
  }
  return rows.reverse();
}

export type Handed = { id: string; from: string; repo: string; issue: number; title: string; brief: string; branch: string; review?: boolean; at: string };
export const handId = (repo: string, issue: number) => `${repo}#${issue}`;

/** what is handed to me now, from the record: every issue whose last hands line is a hand (or a pass back) to me (pure).
 * A review asked is the reviewer's to open on GitHub, not to take: it is told once, on the relay, and not kept here */
export function pendingFor(me: string, rows: Row[], title: (repo: string, n: number) => string = () => ""): Handed[] {
  const latest = new Map<string, Row>();
  for (const r of rows) { const k = handId(r.repo, r.number); if (!latest.has(k)) latest.set(k, r); }   // rows are newest first
  const out: Handed[] = [];
  const who = me.toLowerCase();
  for (const [id, r] of latest) {
    if (!who || r.to.toLowerCase() !== who) continue;
    if (r.how === "hand") out.push({ id, from: r.from, repo: r.repo, issue: r.number, title: title(r.repo, r.number), brief: r.brief ?? "", branch: r.branch ?? "", at: r.at });
    else if (r.how === "passed") out.push({ id, from: r.from, repo: r.repo, issue: r.number, title: title(r.repo, r.number), brief: r.line ?? "", branch: r.branch ?? "", at: r.at });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** the relay word of a hand: only these fields, ever (pure; the test holds the key set) */
export const WORD_FIELDS = ["issue", "repo", "to", "brief", "branch", "by", "review"] as const;
export type Word = { issue: number; repo: string; to: string; brief: string; branch: string; by: string; review?: true };
export function handWord(w: { issue: number; repo: string; to: string; brief: string; branch?: string; by: string; review?: boolean } & Record<string, unknown>): Word {
  return { issue: w.issue, repo: w.repo, to: w.to, brief: w.brief.slice(0, 8000), branch: w.branch ?? "", by: w.by, ...(w.review ? { review: true as const } : {}) };
}

/** a relay word heard, made safe: null unless it is a hand to me with a team repo and a number (pure) */
export function heardWord(m: Record<string, unknown>, me: string, repos: string[]): (Word & { from: string }) | null {
  const to = String(m.to ?? ""), repo = String(m.repo ?? ""), issue = Number(m.issue);
  if (!me || to.toLowerCase() !== me.toLowerCase() || !LOGIN.test(to)) return null;
  if (!REPO.test(repo) || !repos.some((r) => r.toLowerCase() === repo.toLowerCase()) || !(issue > 0)) return null;
  const from = String((m.from as { login?: unknown } | undefined)?.login ?? m.by ?? "");
  if (!LOGIN.test(from)) return null;
  const branch = String(m.branch ?? "");
  return { issue, repo, to, brief: String(m.brief ?? "").slice(0, 8000), branch: BRANCH.test(branch) ? branch : "", by: from, from, ...(m.review === true ? { review: true as const } : {}) };
}

// ---- the deeds ----

export type Hand = {
  gh: (args: string[]) => Promise<string>;                       // the GitHub CLI (gh's own sign-in, never a token here)
  git: (cwd: string, args: string[]) => Promise<string>;
  send: (word: Word) => boolean;                                  // the relay: false when it is down
  me: () => Promise<string>;                                      // my login: a person's hand signs it
  now: () => Date;
  session: (id: string) => Promise<{ title: string; items: Item[]; cwd?: string; branch?: string } | null>;
  folders: () => Promise<Record<string, string>>;                 // which folder on this machine holds each team repo
  repos: () => string[];
  cards: () => Promise<{ repo: string; number: number; title: string }[]>;   // the board's cards, for the titles
  start: (a: { repo: string; cwd: string; issue: number; title: string; text: string }) => Promise<string>;   // a cowork session; its id
};

export type HandAsk = { repo?: unknown; issue?: unknown; pr?: unknown; sessionId?: unknown; to?: unknown; brief?: unknown; branch?: unknown; review?: unknown };
export type Handing = { ok: true; issue: number; recorded: string; relayed: boolean; note?: string } | { ok?: false; error: string };

const firstLine = (e: unknown) => {
  const x = e as { stderr?: unknown; message?: unknown };
  return String(x?.stderr || x?.message || e).trim().split("\n").map((l) => l.replace(/^(fatal|error|hint|X|GraphQL): /i, "").trim()).filter(Boolean)[0] ?? "it failed";
};
const numOf = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 1e7 ? n : 0; };
const issueIn = (title: string) => numOf(/#(\d{1,6})\b/.exec(title)?.[1]);

/** team.hand: the record first (assignee, then the signed comment), then the word on the relay */
export async function hand(d: Hand, a: HandAsk): Promise<Handing> {
  const repo = String(a.repo ?? ""), to = String(a.to ?? "");
  if (!REPO.test(repo) || !d.repos().some((r) => r === repo)) return { error: "that repository is not one of the team's" };
  if (!LOGIN.test(to)) return { error: "hand to whom?" };
  const by = await d.me();
  if (!by) return { error: "who you are on GitHub is not known yet (sign in to GitHub in Settings, my accounts)" };
  if (to.toLowerCase() === by.toLowerCase()) return { error: "that is you" };
  const review = a.review === true;
  const rec = makeGithubRecord(d.gh);
  let issue = numOf(a.issue) || numOf(a.pr), brief = oneLine(a.brief, 600), branch = String(a.branch ?? ""), session: string | undefined;
  const pr = review || (numOf(a.pr) > 0 && !numOf(a.issue));

  if (typeof a.sessionId === "string" && a.sessionId) {
    // a session: Sol writes the brief from its items; its branch must be on GitHub for them to fetch it
    const s = await d.session(a.sessionId);
    if (!s) return { error: "that session is not on this machine" };
    issue = issue || issueIn(s.title);
    if (!issue) return { error: "this session names no issue (#N in its title); hand the issue from the action board instead" };
    brief = briefOf(s.title, s.items);
    session = s.title;
    branch = s.branch ?? "";
    if (branch && s.cwd && !PROTECTED.has(branch)) {
      const there = await d.git(s.cwd, ["ls-remote", "--heads", "origin", branch]).catch(() => null);
      if (there === null) return { error: "GitHub could not be reached to check the session's branch" };
      if (!there.trim()) {
        try { await d.git(s.cwd, ["push", "-q", "origin", `refs/heads/${branch}:refs/heads/${branch}`]); }
        catch (e) { return { error: `the session's branch ${branch} is not on GitHub and could not be pushed: ${firstLine(e)}` }; }
      }
    }
  } else if (pr) {
    // a PR: its title and link are the brief (a review asked says only that), its head the branch
    if (!issue) return { error: "which PR?" };
    try {
      const v = JSON.parse(await rec.cards.pr(repo, issue)) as { title?: string; url?: string; headRefName?: string };
      brief = review ? REVIEW_ASKED : `${oneLine(v.title, 200)}\n${v.url ?? ""}`.trim();
      branch = String(v.headRefName ?? "");
    } catch (e) { return { error: `GitHub did not show PR #${issue}: ${firstLine(e)}` }; }
  } else {
    if (!issue) return { error: "which issue?" };
    brief = brief || (await d.cards().catch(() => [])).find((c) => c.repo === repo && c.number === issue)?.title || `#${issue}`;
  }
  if (branch && !BRANCH.test(branch)) branch = "";

  // the record: first who has it, then the signed line. Nothing goes on the relay unless both are written.
  const date = day(d.now());
  try {
    if (review) await rec.cards.addReviewer(repo, issue, to);
    else await rec.cards.give(repo, issue, to, pr);
  } catch (e) { return { error: `GitHub did not take ${review ? "the reviewer" : "the assignee"}: ${firstLine(e)}` }; }
  try {
    await rec.notes.add(issue, handBody({ from: by, to, date, brief, ...(branch ? { branch } : {}), ...(session ? { session } : {}) }), repo);
  } catch (e) { return { error: `${to} has it on GitHub, but the hand's comment was not written: ${firstLine(e)}` }; }
  const relayed = d.send(handWord({ issue, repo, to, brief, branch, by, review }));
  return { ok: true, issue, recorded: `#${issue}`, relayed, ...(relayed ? {} : { note: `written on #${issue}; ${to} sees it the next time their board is read (the team's line is down)` }) };
}

// taken: the **taken** line is on the issue although the answer went wrong after it (the session did not start)
export type Answered = { ok: true; sessionId?: string; note?: string } | { ok?: false; error: string; taken?: true };

/** team.hand.answer: take, pass with a line, or later (nothing written) */
export async function answer(d: Hand, h: Handed, how: unknown, line?: unknown, start = true): Promise<Answered> {
  if (how === "later") return { ok: true };
  const me = await d.me();
  if (!me) return { error: "who you are on GitHub is not known yet" };
  const date = day(d.now());
  const rec = makeGithubRecord(d.gh);
  if (how === "take") {
    const cwd = (await d.folders())[h.repo];
    if (!cwd) return { error: `no folder on this machine holds ${h.repo}; add it in Work first` };
    try { await rec.notes.add(h.issue, takenBody(me, date), h.repo); }
    catch (e) { return { error: `the take was not written on #${h.issue}: ${firstLine(e)}` }; }
    let note: string | undefined;
    if (h.branch) {
      try { await d.git(cwd, ["fetch", "-q", "origin", `+refs/heads/${h.branch}:refs/remotes/origin/${h.branch}`]); }
      catch (e) { note = `taken; the branch ${h.branch} was not fetched: ${firstLine(e)}`; }
    }
    const text = [
      `#${h.issue} ${h.title || ""}`.trim() + `, handed to me by ${h.from}.`,
      "",
      h.brief || "(no brief)",
      ...(h.branch ? ["", `branch: \`${h.branch}\`${note ? " (not fetched)" : ` (fetched: origin/${h.branch})`}`] : []),
    ].join("\n");
    // just taken (#234: for you asks first): the take is written, no agent runs
    if (!start) return { ok: true, note: note ?? `taken #${h.issue}; no session started` };
    // the take is written: a session that does not start is said, never thrown, and nothing more is written
    try {
      const sessionId = await d.start({ repo: h.repo, cwd, issue: h.issue, title: h.title, text });
      return { ok: true, sessionId, ...(note ? { note } : {}) };
    } catch (e) {
      return { error: `taken on #${h.issue}, but the session did not start: ${firstLine(e)}; open #${h.issue} in Work by hand`, taken: true };
    }
  }
  if (how === "pass") {
    const why = oneLine(line, 300);
    if (!why) return { error: "say why in one line" };
    try {
      await rec.notes.add(h.issue, passedBody(me, date, why), h.repo);
      await rec.cards.passBack(h.repo, h.issue, me, h.from);
    } catch (e) { return { error: `the pass was not written on #${h.issue}: ${firstLine(e)}` }; }
    const relayed = d.send(handWord({ issue: h.issue, repo: h.repo, to: h.from, brief: why, branch: h.branch, by: me }));
    return { ok: true, ...(relayed ? {} : { note: `written on #${h.issue}; ${h.from} sees it the next time their board is read` }) };
  }
  return { error: "take, pass or later" };
}

// ---- reading the record ----

/** the hands lines of a repo: its issues' comments that start with **hand**, **taken** or **passed** */
export async function readRecord(gh: Hand["gh"], repo: string): Promise<Comment[]> {
  const raw = await makeGithubRecord(gh).notes.recent(repo, "created");
  return raw
    .map((c) => ({ repo, number: Number(String(c.issue_url ?? "").split("/").pop()), at: String(c.created_at ?? ""), author: String(c.user?.login ?? ""), body: String(c.body ?? ""), url: String(c.html_url ?? "") }))
    .filter((c) => c.number > 0 && /^\*\*(hand|taken|passed)\*\*/.test(c.body.trim()));
}

export const gitCli: Hand["git"] = (cwd, args) => run("git", args, { cwd, env: ENV(), timeout: 120_000, maxBuffer: 16 << 20 }).then((r) => r.stdout);

// ---- the engine's side: the record, read and kept a minute; the hands heard on the relay since ----

export type Hands = { hands: Row[]; pending: Handed[] };
// answering: the hands an answer is being written for (one at a time per hand); done: a hand answered here, by the
// time it was handed, so it is not offered again before the record shows the answer (a newer hand on the issue is)
type Live = { d: Hand; tell: (m: object) => void; rows: Row[]; at: number; reading: Promise<Row[]> | null; heard: Map<string, Handed>; answering: Set<string>; done: Map<string, string> };
let L: Live | null = null;
const KEEP = 60_000;

/** the hands record across the team's repos, newest first; read again after a minute, or on refresh */
export async function record(refresh = false): Promise<Row[]> {
  if (!L) return [];
  const l = L;
  if (!refresh && l.at && Date.now() - l.at < KEEP) return l.rows;
  if (l.reading) return l.reading;
  l.reading = (async () => {
    const all: Comment[] = [];
    for (const repo of l.d.repos()) all.push(...(await readRecord(l.d.gh, repo).catch(() => [])));
    l.rows = parseRecord(all);
    l.at = Date.now();
    return l.rows;
  })().finally(() => { l.reading = null; });
  return l.reading;
}

/** the record (the last 30 lines) and what is handed to me now: the record's word, and the relay's while the record
 * has not been read again. A hand answered here leaves `heard` at once */
export async function handsNow(refresh = false): Promise<Hands> {
  if (!L) return { hands: [], pending: [] };
  const rows = await record(refresh);
  const me = await L.d.me();
  const cards = await L.d.cards().catch(() => []);
  const title = (repo: string, n: number) => cards.find((c) => c.repo === repo && c.number === n)?.title ?? "";
  const pending = pendingFor(me, rows, title);
  const answered = new Map<string, string>();
  for (const r of rows) { const k = handId(r.repo, r.number); if (!answered.has(k)) answered.set(k, r.at); }
  for (const [id, h] of L.heard) {
    // the record has a newer line on it than this word (taken, passed, handed on): the record wins
    if ((answered.get(id) ?? "") > h.at) { L.heard.delete(id); continue; }
    if (!h.review && !pending.some((p) => p.id === id)) pending.unshift({ ...h, title: h.title || title(h.repo, h.issue) });
  }
  const open = pending.filter((p) => unanswered(L!, p));
  return { hands: rows.slice(0, 30), pending: open };
}

/** not answered here yet: never answered, or handed again since the answer */
const unanswered = (l: Live, h: Handed) => { const d = l.done.get(h.id); return d === undefined || (!!h.at && h.at > d); };
const push = async (refresh = true) => { if (L) L.tell({ type: "team.hands", ...(await handsNow(refresh)) }); };

/** the relay said a hand: if it is to me, the faces show the card (team.handed), and the record is read again */
export function heard(m: Record<string, unknown>) {
  if (!L) return;
  const l = L;
  void l.d.me().then(async (me) => {
    const w = heardWord(m, me, l.d.repos());
    if (!w) return;
    const cards = await l.d.cards().catch(() => []);
    const title = cards.find((c) => c.repo === w.repo && c.number === w.issue)?.title ?? "";
    const id = handId(w.repo, w.issue);
    const h: Handed = { id, from: w.from, repo: w.repo, issue: w.issue, title, brief: w.brief, branch: w.branch, at: String(m.at ?? new Date().toISOString()), ...(w.review ? { review: true } : {}) };
    if (!w.review) l.heard.set(id, h);
    const { at: _at, ...card } = h;
    l.tell({ type: "team.handed", ...card });
    await push(true);
  });
}

/** what the face asked: hand, or an answer to a hand; the record is read again after either */
export async function handNow(a: HandAsk): Promise<Handing> {
  if (!L) return { error: "the team is not set up here" };
  const r = await hand(L.d, a);
  if (r.ok) void push(true);
  return r;
}
export async function answerNow(id: unknown, how: unknown, line?: unknown, start = true): Promise<Answered> {
  if (!L) return { error: "the team is not set up here" };
  if (how === "later") return { ok: true };   // nothing is written; the face keeps it under its repo
  const l = L, key = String(id);
  // one answer at a time per hand: a second Take or Pass while the first is written is refused, not written twice
  if (l.answering.has(key)) return { error: "already being answered" };
  l.answering.add(key);
  try {
    // checked again right before the answer is written: the record read fresh, and what was answered here
    const { pending } = await handsNow(true);
    const heardOne = l.heard.get(key);
    const h = pending.find((p) => p.id === key) ?? (heardOne && unanswered(l, heardOne) ? heardOne : undefined);
    if (!h) return { error: "that hand is not yours now" };
    const r = await answer(l.d, h, how, line, start);
    if (r.ok || ("taken" in r && r.taken)) { l.done.set(h.id, h.at ?? new Date().toISOString()); l.heard.delete(h.id); void push(true); }
    return r;
  } catch (e) {
    return { error: firstLine(e) };
  } finally {
    l.answering.delete(key);
  }
}

/** started once (team/wire.ts): the deeds, and who to tell (every face, the notch's too) */
export function startHand(d: Hand, tell: (m: object) => void) {
  L = { d, tell, rows: [], at: 0, reading: null, heard: new Map(), answering: new Set(), done: new Map() };
}
/** the board was read again: the record follows, at most once a minute */
export function boardRead() { if (L && Date.now() - L.at >= KEEP) void push(false); }
