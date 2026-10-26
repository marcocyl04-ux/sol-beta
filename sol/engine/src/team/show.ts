// Show to team (#101, docs/how-we-work/PRD.md section 9): a Work session on a team issue can be shown, read-only, to
// the team while it runs. Its new lines (the person's prompts, the agent's replies, the names of the tools it uses;
// never a tool's input or output, a file, a diff, or anything from home) go out on the relay as kind `show`, at most
// five a second, coalesced. Nothing is kept on disk: this engine holds the last 200 lines of each shown session in
// memory, so a face that opens late sees the tail, and forgets them when the show ends. When it ends (the switch off,
// or the session closed) one signed line goes on the issue with the session's commits.
// A room session (#238, the studio PRD §9.6, #189 option 2) is shown the same way with `scope: "room"`: no issue and no
// branch, started and stopped by the engine (team/wire.ts) while it runs under the room and the person lets the room
// see it; its lines go only to the people watching it, and nothing is posted when it ends.
import { homedir } from "node:os";
import { basename } from "node:path";
import { sign, runGit } from "./note.js";
import { makeGithubRecord, runGh } from "./record.js";
import { sendRelay } from "./relay.js";
import { getTeam, myLogin, mayAgentSpeak } from "./settings.js";

export type Role = "person" | "agent" | "tool";
export type ShownLine = { role: Role; text: string; at: number };
export type ShowEvent = "start" | "line" | "end";
export type ShowSession = { id: string; title: string };
export type ShowMsg = { issue: number; repo: string; session: ShowSession; event: ShowEvent; line?: ShownLine; scope?: "room"; thing?: string };
export type Shown = { login: string; issue: number; repo: string; session: ShowSession; since: number; lines: ShownLine[]; scope?: "room"; thing?: string };
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

/** a person's words without the room's fenced content the box put before them (start.ts fence): the room already has it */
export const unfence = (s: string) => String(s ?? "").replace(/<room-content [0-9a-f]+>[\s\S]*?<\/room-content [0-9a-f]+>\s*/g, "");

/** what one item of a Work session says to the team, or null: it never leaves */
export function lineOf(it: Item, home = homedir()): { role: Role; text: string } | null {
  if (it.parent) return null;                                      // a helper agent's own steps stay here
  const said = (role: Role, v: unknown) => { const text = scrub(String(v ?? ""), home); return text ? { role, text } : null; };
  if (it.kind === "me") return said("person", unfence(String(it.text ?? "")));
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
  watch?: (login: string, session: string, on: boolean) => boolean;   // the relay, kind watch (#223): the hub sends a show's lines to its watchers only
  tell: (m: object) => void;                     // every Cowork face here
  gh: Gh;
  git: Git;
  login: () => Promise<string>;
  mayGitHub: () => boolean;                      // Settings, my agent: may it speak on GitHub
  now: () => number;
  every: (ms: number, fn: () => void) => () => void;   // a repeating timer, stopped by what it returns
  home?: string;
};
type Mine = { cwd: string; login: string; issue: number; repo: string; session: ShowSession; since: number; seen: Set<string>; throttle: Throttle; stop: () => void; scope?: "room"; thing?: string };
/** which of my running sessions stream to the room in use now (#238, pure): the ones started under it, by its mark
 *  (here.ts roomMark), and none while "show my room sessions" is off there. Work and Life sessions carry no room mark */
export function roomShowsWanted(runs: { id: string; room?: string }[], mark: string, quiet: boolean): string[] {
  return quiet || !mark ? [] : runs.filter((r) => r.room === mark).map((r) => r.id);
}

/** the lines a room show starts with: the session's last words before it was shown, so a watcher is not met by nothing */
export const BACKFILL = 20;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ROLES = new Set<Role>(["person", "agent", "tool"]);

export class Shows {
  private mine = new Map<string, Mine>();       // my shown sessions, by session id
  private tails = new Map<string, Shown>();     // every shown session this engine knows of, mine and theirs: `${login}/${id}`
  private watched = new Map<string, Set<unknown>>();   // the shows a face here watches (#223, A6): `${login}/${id}` → the faces
  private backfilled = new Set<string>();   // room sessions whose last lines went once (#238): a start again sends none
  constructor(private d: ShowDeps) {}

  showing(id: string) { return this.mine.has(id); }
  /** my room sessions shown now (#238), by id */
  roomShows(): string[] { return [...this.mine].filter(([, s]) => s.scope === "room").map(([id]) => id); }

  /** a room session shown to the room (#238): no issue, no line on GitHub at its end; its last BACKFILL lines go first */
  async startRoom(id: string, c: { cwd: string; title: string; thing?: string; items?: Item[]; still?: () => boolean }) {
    if (this.mine.has(id)) return;
    const login = await this.d.login();
    // the room may have changed while my login was asked (a switch, the setting off): then nothing goes
    if (!login || this.mine.has(id) || (c.still && !c.still())) return;
    const session = { id, title: c.title.replace(/\s+/g, " ").trim().slice(0, 120) || "a room session" };
    const head = { issue: 0, repo: "", session, scope: "room" as const, ...(c.thing ? { thing: c.thing } : {}) };
    const throttle = new Throttle((line) => this.out(login, { ...head, event: "line", line }));
    const stop = this.d.every(1000 / PER_SECOND, () => throttle.tick());
    // what the session holds now: each item that already says a line is seen; a reply still coming is not, so it goes
    // once whole. Its last lines go first, only the first time it is shown in this run: a start again (the switch back
    // on, the room back) sends nothing said while the room could not see it (the review of #238)
    const items = c.items ?? [], said = items.map((i) => ({ i, l: lineOf(i, this.d.home) })).filter((x) => !!x.l);
    this.mine.set(id, { cwd: c.cwd, login, issue: 0, repo: "", session, since: this.d.now(), seen: new Set(said.map((x) => x.i.id)), throttle, stop, scope: "room", ...(c.thing ? { thing: c.thing } : {}) });
    this.out(login, { ...head, event: "start" });
    const now = this.d.now(), first = !this.backfilled.has(id);
    this.backfilled.add(id);
    if (first) for (const x of said.slice(-BACKFILL)) throttle.push({ ...x.l!, at: now });
  }

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

  /** the switch off, or the session ended: what is queued goes, then the end, then the one line on the issue. A room
   *  show's queue is dropped instead (#238): it stops because the room may no longer see it (the switch off, the room
   *  left), and nothing said after that moment goes */
  async stop(id: string): Promise<string> {
    const s = this.mine.get(id);
    if (!s) return "it was not shown";
    this.mine.delete(id);
    s.stop();
    if (s.scope !== "room") for (let i = 0; i < 20 && s.throttle.q.length; i++) s.throttle.tick();
    s.throttle.q = [];
    this.out(s.login, { issue: s.issue, repo: s.repo, session: s.session, event: "end", ...(s.scope ? { scope: s.scope } : {}) });
    if (s.scope === "room") return "no longer shown to the room";
    if (!this.d.mayGitHub()) return "no longer shown; the line on the issue was not posted (Settings, my agent: GitHub is off)";
    const body = shownLine({ login: s.login, title: s.session.title, ms: this.d.now() - s.since, repo: s.repo, commits: await commitsIn(this.d.git, s.cwd) });
    try { await makeGithubRecord((args) => this.d.gh(args, s.cwd)).notes.add(s.issue, body); }
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
    const room = m.scope === "room";   // a room session's (#238): no issue
    if (!room && (!Number.isInteger(issue) || issue <= 0)) return;
    const msg: ShowMsg = { issue: room ? 0 : issue, repo: room ? "" : String(m.repo ?? "").slice(0, 100), session: { id: s.id, title: String(s.title ?? "").slice(0, 120) }, event: ev,
      ...(room ? { scope: "room" as const, ...(typeof m.thing === "string" && /^[\w-]{1,40}$/.test(m.thing) ? { thing: m.thing } : {}) } : {}) };
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
      this.d.tell({ type: "team.shown", login: t.login, issue: t.issue, repo: t.repo, session: t.session, event: "end", ...(t.scope ? { scope: t.scope } : {}) });
    }
  }

  /** a face here opened a teammate's show, or closed it (#223, A6): on a cloud the hub sends a show's lines only to
   *  the Sols watching it, so the first face to open one asks, and the last to close it lets go */
  watch(login: string, id: string, on: boolean, face: unknown) {
    if (!/^[A-Za-z0-9-]{1,39}$/.test(login) || !/^[\w-]{1,80}$/.test(id)) return;
    const k = `${login}/${id}`, set = this.watched.get(k) ?? new Set<unknown>();
    const was = set.size;
    if (on) set.add(face); else set.delete(face);
    if (set.size) this.watched.set(k, set); else this.watched.delete(k);
    if (!was && set.size) this.d.watch?.(login, id, true);
    if (was && !set.size) this.d.watch?.(login, id, false);
  }

  /** a face went away: what it watched it watches no more */
  unwatchFace(face: unknown) {
    for (const [k, set] of [...this.watched]) if (set.has(face)) { const [login, id] = k.split("/"); this.watch(login, id, false, face); }
  }

  /** the hub answered my hello (a new connection, maybe a hub that restarted): what is watched here is asked again, and,
   *  on a hub that sends lines to watchers only, my own shows say start again so it knows them (never on a hub that
   *  sends every line to the room: an old Sol there would read a start as a new show and lose its lines) */
  again(starts = true) {
    for (const k of this.watched.keys()) this.ask(k);
    // a room show (#238) says start again on every hub: every hub keeps room streams watch-only, and a Sol from before
    // reads no room show, so none loses its lines
    for (const s of this.mine.values()) if (starts || s.scope === "room") this.d.send({ issue: s.issue, repo: s.repo, session: s.session, event: "start", ...(s.scope ? { scope: s.scope, ...(s.thing ? { thing: s.thing } : {}) } : {}) });
  }

  /** a watch the hub refused (busy, two already), asked again when it may be had: `key` one, or every one */
  ask(key: string) { if (!this.watched.has(key)) return; const [login, id] = key.split("/"); this.d.watch?.(login, id, true); }

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
      // a start again (its Sol reconnected, #223) keeps the lines already here
      if (!t) { t = { login, issue: msg.issue, repo: msg.repo, session: msg.session, since: this.d.now(), lines: [], ...(msg.scope ? { scope: msg.scope } : {}), ...(msg.thing ? { thing: msg.thing } : {}) }; this.tails.set(k, t); }
      else if (msg.event === "start") Object.assign(t, { issue: msg.issue, repo: msg.repo, session: msg.session });
      if (msg.line) {
        const l = msg.line;
        // the hub's tail for a watcher who came again holds lines already here (#223): each is kept once
        if (t.lines.slice(-40).some((x) => x.at === l.at && x.role === l.role && x.text === l.text)) return;
        t.lines.push(l); if (t.lines.length > TAIL) t.lines.splice(0, t.lines.length - TAIL);
      }
    }
    this.d.tell({ type: "team.shown", login, ...msg });
  }
}

// ---- this engine's one Shows: the relay, gh and git, the faces team/wire.ts sets ----
let bus: (m: object) => void = () => {};
export const setShowBus = (f: (m: object) => void) => { bus = f; };
export const shows = new Shows({
  send: (m) => sendRelay("show", m),
  watch: (login, session, on) => sendRelay("watch", { login, session, on }),
  tell: (m) => bus(m),
  gh: runGh,
  git: runGit,
  login: async () => getTeam().me.login || (await myLogin().catch(() => "")),
  mayGitHub: () => mayAgentSpeak(getTeam(), "github"),
  now: () => Date.now(),
  every: (ms, fn) => { const t = setInterval(fn, ms); t.unref?.(); return () => clearInterval(t); },
});
