// Show to team (#101, docs/how-we-work/PRD.md section 9): a Work session on a team issue can be shown, read-only, to
// the team while it runs. Its new lines (the person's prompts, the agent's replies, the names of the tools it uses;
// never a tool's input or output, a file, a diff, or anything from home) go out on the relay as kind `show`, at most
// five a second, coalesced. Nothing is kept on disk: this engine holds the last 200 lines of each shown session in
// memory, so a face that opens late sees the tail, and forgets them when the show ends. When it ends (the switch off,
// or the session closed) one signed line goes on the issue with the session's commits.
import { homedir } from "node:os";
import { basename } from "node:path";
import { sign, runGh, runGit } from "./note.js";
import { sendRelay } from "./relay.js";
import { getTeam, myLogin, mayAgentSpeak } from "./settings.js";

export type Role = "person" | "agent" | "tool";
export type ShownLine = { role: Role; text: string; at: number };
export type ShowEvent = "start" | "line" | "end";
export type ShowSession = { id: string; title: string };
export type ShowMsg = { issue: number; repo: string; session: ShowSession; event: ShowEvent; line?: ShownLine };
export type Shown = { login: string; issue: number; repo: string; session: ShowSession; since: number; lines: ShownLine[] };
type Item = { id: string; kind: string; [k: string]: unknown };

export const TEXT_MAX = 400;
export const TAIL = 200;
export const PER_SECOND = 5;
const QUEUE_MAX = 100;   // a backlog past this drops its oldest lines: the show is live words, not a record
const LABELS = "life|work|cowork|social|base|product";

/** the issue a branch names (`<first>/<label>-<slug>-<n>`, as sol/take makes it), or null */
export function issueOfBranch(branch: string): number | null {
  const m = new RegExp(`^[A-Za-z0-9-]+/(?:${LABELS})-[^/\\s]+-(\\d+)$`).exec(String(branch ?? "").trim());
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : null;
}

/** text that may leave: the home folder said as ~, trimmed, at most TEXT_MAX characters */
export function scrub(s: string, home = homedir()): string {
  let t = String(s ?? "");
  if (home && home !== "/") t = t.split(home).join("~");
  t = t.trim();
  return t.length > TEXT_MAX ? t.slice(0, TEXT_MAX - 1) + "…" : t;
}

const toolName = (n: string) => (n.startsWith("mcp__") ? n.split("__").slice(2).join("__") || n : n);

/** what one item of a Work session says to the team, or null: it never leaves */
export function lineOf(it: Item, home = homedir()): { role: Role; text: string } | null {
  if (it.parent) return null;                                      // a helper agent's own steps stay here
  const said = (role: Role, v: unknown) => { const text = scrub(String(v ?? ""), home); return text ? { role, text } : null; };
  if (it.kind === "me") return said("person", it.text);
  if (it.kind === "you") return it.live === false ? said("agent", it.text) : null;   // once, when the reply is whole
  if (it.kind === "tool") return it.quiet || typeof it.name !== "string" ? null : { role: "tool", text: scrub(toolName(it.name), home) };
  return null;                                                     // thinking, questions, plans, notes, errors: never
}

/** the queue between a session and the relay: a tick sends one line, the head and what follows it of the same role */
export class Throttle {
  q: ShownLine[] = [];
  constructor(private out: (l: ShownLine) => void) {}
  push(l: ShownLine) { this.q.push(l); if (this.q.length > QUEUE_MAX) this.q.splice(0, this.q.length - QUEUE_MAX); }
  tick() {
    const head = this.q.shift();
    if (!head) return;
    const glue = head.role === "tool" ? " · " : "\n";
    let text = head.text;
    while (this.q.length && this.q[0].role === head.role && text.length + glue.length + this.q[0].text.length <= TEXT_MAX) text += glue + this.q.shift()!.text;
    this.out({ ...head, text });
  }
}

/** "under a minute", "12 min", "1 h 5 min" */
export function duration(ms: number): string {
  const m = Math.round(Math.max(0, ms) / 60_000);
  if (m < 1) return "under a minute";
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

export type Commit = { short: string; sha: string; subject: string };

/** the one signed line on the issue when a show ends */
export function shownLine(a: { login: string; title: string; ms: number; repo: string; commits: Commit[] }): string {
  const link = /^[\w.-]+\/[\w.-]+$/.test(a.repo);
  const one = (c: Commit) => `${link ? `[\`${c.short}\`](https://github.com/${a.repo}/commit/${c.sha})` : `\`${c.short}\``} ${c.subject}`;
  const list = a.commits.slice(0, 20).map(one).join("; ") + (a.commits.length > 20 ? `; and ${a.commits.length - 20} more` : "");
  const title = a.title.replace(/\s+/g, " ").trim() || "untitled";
  return `**Shown**: ${a.login} worked on this in a session (${title}), ${duration(a.ms)}; commits: ${list || "no commits yet"} ${sign(a.login)}`;
}

type Git = (args: string[], cwd: string) => Promise<string>;
type Gh = (args: string[], cwd?: string) => Promise<string>;

/** the commits of the session's branch not on main, as git says them now in its folder */
export async function commitsIn(git: Git, cwd: string): Promise<Commit[]> {
  const out = await git(["log", "origin/main..HEAD", "--format=%h%x1f%H%x1f%s"], cwd).catch(() => "");
  return out.split("\n").map((l) => l.split("\x1f")).filter((p) => p.length === 3 && p[0]).map(([short, sha, subject]) => ({ short, sha, subject }));
}

/** "owner/name" of the folder's GitHub remote, else the folder's name */
export async function repoOf(git: Git, cwd: string): Promise<string> {
  const url = await git(["remote", "get-url", "origin"], cwd).catch(() => "");
  return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(url)?.[1] ?? basename(cwd);
}

/** the issue the folder's current branch names, or null */
export async function issueAt(git: Git, cwd: string): Promise<number | null> {
  return issueOfBranch(await git(["symbolic-ref", "--short", "-q", "HEAD"], cwd).catch(() => ""));
}

export type ShowDeps = {
  send: (m: ShowMsg) => boolean;                 // the relay, kind show (false when it is down: the line is gone)
  tell: (m: object) => void;                     // every Cowork face here
  gh: Gh;
  git: Git;
  login: () => Promise<string>;
  mayGitHub: () => boolean;                      // Settings, my agent: may it speak on GitHub
  now: () => number;
  every: (ms: number, fn: () => void) => () => void;   // a repeating timer, stopped by what it returns
  home?: string;
};
type Mine = { cwd: string; login: string; issue: number; repo: string; session: ShowSession; since: number; seen: Set<string>; throttle: Throttle; stop: () => void };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ROLES = new Set<Role>(["person", "agent", "tool"]);

export class Shows {
  private mine = new Map<string, Mine>();       // my shown sessions, by session id
  private tails = new Map<string, Shown>();     // every shown session this engine knows of, mine and theirs: `${login}/${id}`
  constructor(private d: ShowDeps) {}

  showing(id: string) { return this.mine.has(id); }

  /** the switch on: what the session already holds stays here; from now on its new lines go out */
  async start(id: string, c: { cwd: string; issue: number; repo: string; title: string; existing?: string[] }) {
    if (this.mine.has(id)) return;
    const login = await this.d.login();
    if (!login) throw new Error("who you are on GitHub is not known yet (Cowork, settings)");
    const session = { id, title: c.title.replace(/\s+/g, " ").trim().slice(0, 120) || `#${c.issue}` };
    const head = { issue: c.issue, repo: c.repo, session };
    const throttle = new Throttle((line) => this.out(login, { ...head, event: "line", line }));
    const stop = this.d.every(1000 / PER_SECOND, () => throttle.tick());
    this.mine.set(id, { cwd: c.cwd, login, issue: c.issue, repo: c.repo, session, since: this.d.now(), seen: new Set(c.existing ?? []), throttle, stop });
    this.out(login, { ...head, event: "start" });
  }

  /** one item of a session put or changed: a shown session's new line joins the queue */
  item(id: string, it: Item) {
    const s = this.mine.get(id);
    if (!s || !it?.id || s.seen.has(it.id)) return;
    const l = lineOf(it, this.d.home);
    if (!l) return;
    s.seen.add(it.id);
    s.throttle.push({ ...l, at: this.d.now() });
  }

  /** the switch off, or the session ended: what is queued goes, then the end, then the one line on the issue */
  async stop(id: string): Promise<string> {
    const s = this.mine.get(id);
    if (!s) return "it was not shown";
    this.mine.delete(id);
    s.stop();
    for (let i = 0; i < 20 && s.throttle.q.length; i++) s.throttle.tick();
    s.throttle.q = [];
    this.out(s.login, { issue: s.issue, repo: s.repo, session: s.session, event: "end" });
    if (!this.d.mayGitHub()) return "no longer shown; the line on the issue was not posted (Settings, my agent: GitHub is off)";
    const body = shownLine({ login: s.login, title: s.session.title, ms: this.d.now() - s.since, repo: s.repo, commits: await commitsIn(this.d.git, s.cwd) });
    try { await this.d.gh(["issue", "comment", String(s.issue), "--body", body], s.cwd); }
    catch (e) { return `no longer shown; the line on #${s.issue} could not be posted: ${String((e as Error)?.message ?? e).slice(0, 200)}`; }
    return `no longer shown; one line on #${s.issue} says what was done`;
  }

  /** a teammate's show heard on the relay: kept in memory while it lasts, told to every Cowork face */
  hear(m: Record<string, unknown>) {
    const from = isObj(m.from) ? String(m.from.login ?? "") : "";
    const s = isObj(m.session) ? m.session : null;
    const ev = m.event;
    const issue = Number(m.issue);
    if (!/^[A-Za-z0-9-]{1,39}$/.test(from) || !s || typeof s.id !== "string" || !/^[\w-]{1,80}$/.test(s.id)) return;
    if (ev !== "start" && ev !== "line" && ev !== "end") return;
    if (!Number.isInteger(issue) || issue <= 0) return;
    const msg: ShowMsg = { issue, repo: String(m.repo ?? "").slice(0, 100), session: { id: s.id, title: String(s.title ?? "").slice(0, 120) }, event: ev };
    if (ev === "line") {
      const l = isObj(m.line) ? m.line : null;
      if (!l || !ROLES.has(l.role as Role) || typeof l.text !== "string" || !l.text) return;
      msg.line = { role: l.role as Role, text: l.text.slice(0, TEXT_MAX), at: typeof l.at === "number" ? l.at : this.d.now() };
    }
    this.record(from, msg);
  }

  /** the people on the relay changed: a teammate who left without an end is no longer showing */
  prune(here: string[]) {
    const keep = new Set(here);
    for (const [k, t] of this.tails) {
      if (keep.has(t.login) || [...this.mine.values()].some((s) => s.login === t.login)) continue;
      this.tails.delete(k);
      this.d.tell({ type: "team.shown", login: t.login, issue: t.issue, repo: t.repo, session: t.session, event: "end" });
    }
  }

  /** who is showing now (no lines) */
  list() { return [...this.tails.values()].map(({ lines: _l, ...r }) => r); }

  /** the tail of one shown session, for a face that opens late */
  lines(login: string, id: string): ShownLine[] | null { return this.tails.get(`${login}/${id}`)?.lines.slice() ?? null; }

  private out(login: string, msg: ShowMsg) {
    this.record(login, msg);
    this.d.send(msg);
  }

  private record(login: string, msg: ShowMsg) {
    const k = `${login}/${msg.session.id}`;
    if (msg.event === "end") this.tails.delete(k);
    else {
      let t = this.tails.get(k);
      if (!t || msg.event === "start") { t = { login, issue: msg.issue, repo: msg.repo, session: msg.session, since: this.d.now(), lines: [] }; this.tails.set(k, t); }
      if (msg.line) { t.lines.push(msg.line); if (t.lines.length > TAIL) t.lines.splice(0, t.lines.length - TAIL); }
    }
    this.d.tell({ type: "team.shown", login, ...msg });
  }
}

// ---- this engine's one Shows: the relay, gh and git, the faces team/wire.ts sets ----
let bus: (m: object) => void = () => {};
export const setShowBus = (f: (m: object) => void) => { bus = f; };
export const shows = new Shows({
  send: (m) => sendRelay("show", m),
  tell: (m) => bus(m),
  gh: runGh,
  git: runGit,
  login: async () => getTeam().me.login || (await myLogin().catch(() => "")),
  mayGitHub: () => mayAgentSpeak(getTeam(), "github"),
  now: () => Date.now(),
  every: (ms, fn) => { const t = setInterval(fn, ms); t.unref?.(); return () => clearInterval(t); },
});
