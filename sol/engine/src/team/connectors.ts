// What a group is connected to, as one answer (#320; the Cowork PRD §9.4): the connectors tab asks once, `team.connectors`,
// and hears the repositories connected to the group, its things, its three tools, and whether Google and GitHub are
// connected on this Mac. A cloud group (its record on the cloud) may connect a GitHub repository: the record keeps one
// small file, `.sol/connectors.json` { v: 1, repos: [{ repo, by, at, in: [github logins] }] }, through the kit's store
// (kit.ts: a read cached 60 s, a change compare-and-swap on the file's sha, three tries), and the room's own `repos` in
// team.json say which repositories its board reads (settings.ts connectedRepos). `in` is who was let into the
// repository: the maker's press (letin.ts, #325) adds a GitHub login to it once GitHub took them in.
//
// Who may connect one: a member whose own GitHub is an admin of the repository, and only a private repository, since
// build updates are only ever offered for one (the PRD §9.6) and a public one must never get in; one `gh api
// repos/<x>` says its name, private, admin and push. A member who may push to one the group already lists takes it as
// their own too. My room's `repos` (team.json) are only the ones my own gh checked: they are where file it, try and
// hands go, while the board reads every repository the file lists (board.ts). A GitHub group's record is its
// repository, and a Drive group's is its folder: neither connects one. Everything that
// reads GitHub or the cloud is handed in (ConnectDeps), so the tests run with a fake gh and a fake record.
import { Store, type Applied } from "./kit.js";
import { makeGithubRecord, type Gh } from "./record.js";
import { isRepo, CONNECTED_MAX, recordOf, connectedRepos, type Room } from "./settings.js";
import type { ThingsDeps } from "./things.js";
import type { Calendar, CalEvent } from "./calendar.js";
import type { Log, Decision } from "./decisions.js";
import type { Polls, Poll } from "./polls.js";

export const CONNECTORS_PATH = ".sol/connectors.json";
/** who was let into one repository, at most this many logins (a group is a few people) */
export const IN_MAX = 50;

export type Connected = { repo: string; by: string; at: string; in: string[] };
export type ConnectorsFile = { v: 1; repos: Connected[]; newer?: true };
export type ConnectorsOp = { add: { repo: string; by: string; at: string } } | { remove: { repo: string } } | { in: { repo: string; login: string } };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
// one line of plain text, as everything read from a room is: no control or format characters, at most max
const oneLine = (v: unknown, max: number) => (typeof v === "string" ? v : "").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const empty = (): ConnectorsFile => ({ v: 1, repos: [] });

/** the words said when a group cannot connect a repository, one plain line each */
export const SAY = {
  github: "this group's record is its repository",
  drive: "a Drive group's record is its folder; a repository connects to a group on Sol's cloud",
  none: "this group has no record yet",
  which: "which repository? its owner/name",
  signin: "connect GitHub first: the repository is checked with your own GitHub",
  admin: "only an admin of the repository connects it to the group",
  public: "build updates need a private repository",
  full: `a group connects ${CONNECTED_MAX} repositories at most`,
  notHere: "that repository is not connected to this group",
  push: "you can't push to that repository yet; ask its admin to let you in",
  login: "that isn't a GitHub name",
  many: `a repository lists ${IN_MAX} people let in at most`,
} as const;
export const seeNot = (repo: string) => `your GitHub can't see ${repo}; check its name, or ask its owner`;

// ---- the file ----
/** the file as read, made valid (pure): bad JSON is the empty file; a repo not in GitHub's shape, or there twice, is
 *  dropped; `in` keeps GitHub logins only, each once; a v above 1 (a newer Sol wrote it) is read and never written */
export function parseConnectors(text: unknown): ConnectorsFile {
  let raw: unknown;
  try { raw = JSON.parse(String(text ?? "")); } catch { return empty(); }
  const list = isObj(raw) && Array.isArray(raw.repos) ? raw.repos : [];
  const out: Connected[] = [];
  for (const x of list) {
    if (!isObj(x) || typeof x.repo !== "string" || !isRepo(x.repo.trim()) || out.some((o) => same(o.repo, String(x.repo).trim()))) continue;
    const ins: string[] = [];
    for (const l of Array.isArray(x.in) ? x.in : []) if (typeof l === "string" && LOGIN.test(l) && !ins.some((i) => same(i, l)) && ins.length < IN_MAX) ins.push(l);
    out.push({ repo: x.repo.trim(), by: oneLine(x.by, 39), at: typeof x.at === "string" && !Number.isNaN(Date.parse(x.at)) ? x.at : "", in: ins });
    if (out.length === CONNECTED_MAX) break;
  }
  const newer = isObj(raw) && typeof raw.v === "number" && raw.v > 1;
  return { v: 1, repos: out, ...(newer ? { newer: true as const } : {}) };
}

/** the file as written (pure): one shape, the fields in one order, so a write that changes nothing is never a commit */
export function serializeConnectors(f: ConnectorsFile): string {
  return JSON.stringify({ v: 1, repos: f.repos.map((r) => ({ repo: r.repo, by: r.by, at: r.at, in: r.in })) }, null, 2) + "\n";
}

/** one change (pure): an add of a repository already there changes nothing and answers it; a remove of one not there
 *  says so; past CONNECTED_MAX an add is refused. An `in` (#325) puts a GitHub login on one row's `in`, once, at most
 *  IN_MAX, the other rows as they are */
export function applyConnectors(f: ConnectorsFile, op: ConnectorsOp): Applied<ConnectorsFile, { connected: Connected }> {
  if ("in" in op) {
    const had = f.repos.find((r) => same(r.repo, op.in.repo.trim())), login = op.in.login;
    if (!had) return { file: f, changed: false, error: SAY.notHere };
    if (!LOGIN.test(login)) return { file: f, changed: false, error: SAY.login };
    if (had.in.some((l) => same(l, login))) return { file: f, changed: false, result: { connected: had } };
    if (had.in.length >= IN_MAX) return { file: f, changed: false, error: SAY.many };
    const c: Connected = { ...had, in: [...had.in, login] };
    return { file: { v: 1, repos: f.repos.map((r) => (r === had ? c : r)) }, changed: true, result: { connected: c }, message: `connectors: let ${login} into ${had.repo}` };
  }
  if ("add" in op) {
    const repo = op.add.repo.trim();
    if (!isRepo(repo)) return { file: f, changed: false, error: SAY.which };
    const had = f.repos.find((r) => same(r.repo, repo));
    if (had) return { file: f, changed: false, result: { connected: had } };
    if (f.repos.length >= CONNECTED_MAX) return { file: f, changed: false, error: SAY.full };
    const c: Connected = { repo, by: oneLine(op.add.by, 39), at: op.add.at, in: [] };
    return { file: { v: 1, repos: [...f.repos, c] }, changed: true, result: { connected: c }, message: `connectors: connected ${repo}` };
  }
  const had = f.repos.find((r) => same(r.repo, op.remove.repo.trim()));
  if (!had) return { file: f, changed: false, error: SAY.notHere };
  return { file: { v: 1, repos: f.repos.filter((r) => r !== had) }, changed: true, result: { connected: had }, message: `connectors: took off ${had.repo}` };
}

export const connectors = new Store<ConnectorsFile, ConnectorsOp, { connected: Connected }>(CONNECTORS_PATH, parseConnectors, serializeConnectors, applyConnectors, "connectors");

// ---- connecting one ----
export type ConnectDeps = ThingsDeps & {
  gh: Gh;                           // my own gh (the record's runner): one `gh api repos/<x>` says all the checks need
  github: () => Promise<boolean>;   // is GitHub signed in on this Mac (control.ts githubIn)
  who: () => string;                // who connects: my name in the group (relay.ts hubLogin)
  mine?: () => string[];            // my room's repos as they are now (team.json), read after the write: two quick connects both stay
  now?: () => string;
};

/** why this room connects no repository, or "" (pure): only a cloud group with a record does */
export function roomRefusal(room: Pick<Room, "provider" | "repos" | "code">): string {
  if (room.provider === "github") return SAY.github;
  if (room.provider === "drive") return SAY.drive;
  return recordOf(room) ? "" : SAY.none;
}

/** what my gh says of a repository, in one call: GitHub's own name for it (its case, after a rename), whether it is
 *  private, and whether I am its admin and may push to it. null when my gh cannot see it */
export type RepoFacts = { name: string; private: boolean; admin: boolean; push: boolean };
export async function repoFacts(gh: Gh, repo: string): Promise<RepoFacts | null> {
  let v: unknown;
  try { v = JSON.parse(await gh(["api", `repos/${repo}`, "--jq", "[.full_name,.private,.permissions.admin,.permissions.push]"])); } catch { return null; }
  if (!Array.isArray(v) || !isRepo(v[0])) return null;
  return { name: v[0], private: v[1] === true, admin: v[2] === true, push: v[3] === true };
}

/** why my GitHub may not connect this repository, or "" (pure on the facts): private always (a public one never gets
 *  in, the PRD §9.6); an admin to put it in the group; push alone to take one the group already lists as mine too */
export function connectRefusal(facts: RepoFacts | null, repo: string, listed: boolean): string {
  if (!facts) return seeNot(repo);
  if (facts.private !== true) return SAY.public;
  if (listed) return facts.admin || facts.push ? "" : SAY.push;
  return facts.admin ? "" : SAY.admin;
}

/** the repositories my room's file it, try and hands go to after a connect or a take-off (pure): the ones it had that
 *  the file still lists, and the one just connected. Never the file's others: connectors.json is room content any
 *  member can write, so only a repository my own gh checked gets in */
export function myRepos(had: string[], file: ConnectorsFile, repo: string, connecting: boolean): string[] {
  const kept = pruneMine(had, file).filter((x) => !same(x, repo));
  const it = file.repos.find((r) => same(r.repo, repo));
  return connecting && it ? [...kept, it.repo] : kept;
}
/** my room's repos that the file still lists, in the file's spelling (pure): one taken off the group by anyone leaves
 *  mine at the next read, so no repository is stuck */
export const pruneMine = (had: string[], file: ConnectorsFile): string[] =>
  had.flatMap((x) => { const r = file.repos.find((y) => same(y.repo, x)); return r ? [r.repo] : []; });

/** admin: my gh's word in the same check that made it mine (repoFacts), kept beside my repos as the room's `admins` */
export type Connect = { file: ConnectorsFile; repos: string[]; connected: Connected; changed: boolean; off?: "group" | "mine"; admin?: boolean };
/** my room's repos once this answer is written (pure; review P2-4): applied to team.json as it is at the moment of the
 *  write, never to the room as the ask saw it, so two quick connects (or a connect and a take-off) both stay */
export function mineAfter(now: string[], r: Pick<Connect, "connected" | "off">): string[] {
  const rest = now.filter((x) => !same(x, r.connected.repo));
  return r.off ? rest : [...rest, r.connected.repo];
}
/** the repositories of mine my gh checked as their admin, once this answer is written (pure, as mineAfter): the one
 *  connected stays only when the check said admin, one taken off goes, and none is kept that is not one of `repos` */
export function adminsAfter(now: string[], repos: string[], r: Pick<Connect, "connected" | "off" | "admin">): string[] {
  const rest = now.filter((x) => !same(x, r.connected.repo));
  return (r.off || !r.admin ? rest : [...rest, r.connected.repo]).filter((x) => repos.some((y) => same(x, y)));
}
/** team.connect.repo: the room's kind, GitHub signed in, my gh's word on the repository (connectRefusal), then the add
 *  to connectors.json (compare-and-swap; nothing when it is listed already) and my room's repos (myRepos, against
 *  team.json as it is once the write is done). Answers the file and my repos (the caller writes them), or the refusal */
export async function connectRepo(d: ConnectDeps, room: Room, raw: unknown, connecting: boolean): Promise<Connect | { error: string }> {
  const bar = roomRefusal(room);
  if (bar) return { error: bar };
  const repo = oneLine(raw, 201).replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!isRepo(repo)) return { error: SAY.which };
  if (!connecting) return takeOff(d, room, repo);
  if (!(await d.github().catch(() => false))) return { error: SAY.signin };
  const facts = await repoFacts(d.gh, repo);
  let file: ConnectorsFile;
  try { file = await connectors.get(d, recordOf(room), true); } catch (e) { return { error: `couldn't read the group's connectors: ${String((e as Error)?.message ?? e).split("\n")[0].slice(0, 160)}` }; }
  const why = connectRefusal(facts, repo, file.repos.some((r) => same(r.repo, facts?.name ?? repo)));
  if (why) return { error: why };
  const r = await connectors.change(d, recordOf(room), { add: { repo: facts!.name, by: d.who(), at: d.now?.() ?? new Date().toISOString() } });
  if ("error" in r) return r;
  const had = d.mine?.() ?? room.repos;
  const repos = myRepos(had, r.file, facts!.name, true);
  return { file: r.file, repos, connected: r.result!.connected, changed: r.changed || repos.join("\n") !== had.join("\n"), admin: facts!.admin };
}

/** team.connect.repo.remove: an admin of the repository takes it off the group (connectors.json) and mine; anyone takes
 *  it off their own room's repos with no GitHub check at all, so nothing is ever stuck there */
async function takeOff(d: ConnectDeps, room: Room, repo: string): Promise<Connect | { error: string }> {
  const rec = recordOf(room);
  const signed = await d.github().catch(() => false);
  const facts = signed ? await repoFacts(d.gh, repo) : null;
  if (facts?.admin) {
    const r = await connectors.change(d, rec, { remove: { repo: facts.name } });
    if (!("error" in r)) return { file: r.file, repos: myRepos(d.mine?.() ?? room.repos, r.file, facts.name, false), connected: r.result!.connected, changed: true, off: "group" };
    if (r.error !== SAY.notHere) return r;
  }
  const had = d.mine?.() ?? room.repos;
  if (!had.some((x) => same(x, repo))) return { error: facts?.admin ? SAY.notHere : !signed ? SAY.signin : !facts ? seeNot(repo) : SAY.admin };
  const file = await connectors.get(d, rec).catch(() => empty());
  return { file, repos: had.filter((x) => !same(x, repo)), connected: file.repos.find((x) => same(x.repo, repo)) ?? { repo, by: "", at: "", in: [] }, changed: true, off: "mine" };
}

// ---- the one answer ----
/** a tool's tile (review P2-9): its raw parts, so the face says them in its own words and local time as Tools.tsx does
 *  (the next event; how many decided and the newest; the open polls, newest first), and a plain line in UTC beside them
 *  for anything that only prints */
export type ToolLine =
  | { id: "calendar"; line: string; read: boolean; next: CalEvent | null }
  | { id: "decisions"; line: string; read: boolean; count: number; newest: Decision | null }
  | { id: "polls"; line: string; read: boolean; open: Poll[] };
/** the three tools' tiles (pure); a tool not read yet (`read: false`) says what it is */
export function toolLines(t: { calendar?: Calendar | null; decisions?: Log | null; polls?: Polls | null }, now = Date.now()): ToolLine[] {
  const endOf = (e: CalEvent) => (e.allDay ? Date.parse(`${e.end ?? e.start}T23:59:59Z`) : Date.parse(e.end ?? e.start));
  const next = t.calendar ? [...t.calendar.events].filter((e) => endOf(e) >= now).sort((a, b) => (a.start < b.start ? -1 : 1))[0] ?? null : null;
  const cal = !t.calendar ? "the room's calendar" : next ? `next · ${next.allDay ? next.start : next.start.slice(0, 16).replace("T", " ")} · ${oneLine(next.title, 80)}` : "nothing coming up";
  const newest = t.decisions?.decisions.at(-1) ?? null;
  const dec = !t.decisions ? "what the room decided" : newest ? `${t.decisions.decisions.length} decided · last by ${newest.by || "someone"}${newest.agent ? "'s agent" : ""}` : "nothing decided yet";
  // newest first, as team.polls sends them, so open[0] is the tile's poll as Tools.tsx reads it
  const open = [...(t.polls?.polls ?? [])].reverse().filter((p) => !p.closed);
  const pol = !t.polls ? "ask the room" : open.length ? `${open.length} open · ${oneLine(open[0].question, 80)}` : "no open poll";
  return [
    { id: "calendar", line: cal, read: !!t.calendar, next },
    { id: "decisions", line: dec, read: !!t.decisions, count: t.decisions?.decisions.length ?? 0, newest },
    { id: "polls", line: pol, read: !!t.polls, open },
  ];
}

/** checked (review P2-8): one of my own room's repos, which my gh checked (admin or push, private); a row without it is
 *  only the group's file's word, and the face marks it so. admin: that same check said I am its admin (the face then
 *  offers the workflow). events: its build-updates key is live on the cloud (its workflow has posted) */
export type RepoRow = Connected & { members: number; checked?: true; asked?: true; admin?: true; events?: true };
export type Me = { google: { in: boolean; email?: string }; github: { in: boolean; who?: string } };
/** what kind of record a room keeps, as the tab says it */
export const recordKind = (room: Pick<Room, "provider" | "repos" | "code">): "cloud" | "github" | "drive" | "" =>
  recordOf(room) ? room.provider : "";

/** the repositories of the tab (pure): a cloud group's from its connectors.json, a GitHub group's its own (nobody
 *  connected those: the room is them), a Drive group's none; each with the group's member count. `asked` (#325): the
 *  cloud group's repositories my ask to be let into is out for (letin.ts askedNow) */
export function repoRows(room: Pick<Room, "provider" | "repos" | "code">, file: ConnectorsFile | null, members: number, asked: string[] = [], admins: string[] = [], live: string[] = []): RepoRow[] {
  if (room.provider === "cloud") return (file?.repos ?? []).map((r) => {
    const checked = room.repos.some((x) => same(x, r.repo));
    return { ...r, in: [...r.in], members, ...(checked ? { checked: true as const } : {}), ...(asked.some((x) => same(x, r.repo)) ? { asked: true as const } : {}),
      ...(checked && admins.some((x) => same(x, r.repo)) ? { admin: true as const } : {}), ...(live.some((x) => same(x, r.repo)) ? { events: true as const } : {}) };
  });
  return connectedRepos(room).map((repo) => ({ repo, by: "", at: "", in: [], members }));
}

/** the `team.connectors` message (pure): the repositories, the things as team.things says them, the three tools, me */
/** the cloud's list of a group's build-updates keys (GET /relay/rooms/<code>/events/keys, #328) read into the
 *  repositories whose key is live (pure): GitHub's shape only, at most CONNECTED_MAX; anything else, none */
export function liveOf(v: unknown): string[] {
  const keys = v && typeof v === "object" && Array.isArray((v as { keys?: unknown }).keys) ? (v as { keys: unknown[] }).keys : [];
  return keys.flatMap((k) => (k && typeof k === "object" && (k as { live?: unknown }).live === true && isRepo((k as { repo?: unknown }).repo) ? [(k as { repo: string }).repo] : [])).slice(0, CONNECTED_MAX);
}
/** admins: my repos my gh checked as admin (a row says `admin` only when it is also `checked`); live: the repositories
 *  whose build-updates key is live on the cloud (a row says `events`) */
export function connectorsMsg(a: { room: Pick<Room, "provider" | "repos" | "code">; file: ConnectorsFile | null; members: number; things: object; tools: ToolLine[]; me: Me; rid?: unknown; error?: string; asked?: string[]; admins?: string[]; live?: string[] }) {
  const { type: _t, rid: _r, ...things } = a.things as Record<string, unknown>;
  return { type: "team.connectors" as const, ...(a.rid !== undefined ? { rid: a.rid } : {}), repos: repoRows(a.room, a.file, a.members, a.asked, a.admins, a.live), things, tools: a.tools, me: a.me, record: recordKind(a.room), ...(a.error ? { error: a.error } : {}) };
}

// ---- how many are in the group, read once a minute at most ----
const counted = new Map<string, { n: number; at: number }>();
/** the group's member count: the cloud's members for a cloud group, the repository's people for a GitHub group, 0 when
 *  it cannot be read (never a throw: the tab still opens). Cached 60 s a room */
export async function memberCount(d: { gh: Gh; cloud: (code: string) => Promise<number> }, room: Pick<Room, "id" | "provider" | "repos" | "code">, now = Date.now()): Promise<number> {
  const key = `${room.id} ${recordOf(room)}`, had = counted.get(key);
  if (had && now - had.at < 60_000) return had.n;
  let n = 0;
  if (room.provider === "cloud" && room.code) n = await d.cloud(room.code).catch(() => 0);
  else if (room.provider === "github" && room.repos[0]) n = await makeGithubRecord(d.gh).members.people(room.repos[0]).then((t) => t.split("\n").filter((l) => LOGIN.test(l.trim())).length, () => 0);
  counted.set(key, { n, at: now });   // a 0 too: a group that cannot be counted is not asked again on every push
  return n;
}
/** for the tests, and after a member joins or leaves: count again */
export const forgetCounts = () => counted.clear();
