// Let in (#162, PROTOCOL.md round 37): a friend who typed a room's code meets in its relay room, but its repository
// still says 404 to them. So the friend's Sol asks the room (`room { want: "in", repo }`), the maker's Sol, the
// repository's admin, puts "X wants into <room>" on a card, and once its person pressed yes adds them as a collaborator
// from the maker's own gh and answers that person only (`room { to, repo, in }`); the friend's Sol accepts GitHub's
// invitation and clones the repository into Sol's rooms folder. A code is a password pasted in a chat, so it lets a
// person ask, never in: the press is the maker's (the review of #162's stack).
// A room made from a name (#160) is cloned there too, so a session can start in it at once. Each room keeps its
// folder (settings.ts rooms[].folder). The maker's Sol answers only for a room whose repos are its own words
// (rooms[].mine): a joined room's repos are whoever registered its code's word, and could name any repository of mine.
// A room's folder is a project folder like any other (its project settings load when a session starts there), so a
// joined room is cloned only on an answer heard in it, never because I happen to be able to read its repository: a code
// is trust in the room's maker, not in whatever repository the code's word names.
// Nothing here writes a line anywhere: a collaborator added is GitHub's own record.
// Everything it touches is handed in, so the tests run with no network and no gh.
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { activeRoom, mayAgentSpeak, LOGIN, REPO, ROOMS_DIR, type Room, type TeamSettings } from "./settings.js";
import type { RoomRecord } from "./record.js";
import type { Kind, RelayMsg } from "./relay.js";

export type LetInDeps = {
  team: () => TeamSettings;
  patch: (p: Record<string, unknown>) => TeamSettings;
  record: () => Pick<RoomRecord, "members">;
  send: (kind: Kind, payload: Record<string, unknown>, agent?: boolean) => boolean;   // relay.ts sendRelay; false when down
  git: (args: string[], cwd: string) => Promise<string>;   // its output, or a throw whose message is git's own words
  exists: (path: string) => boolean;
  now: () => number;
  say: (lines: string[]) => void;      // a creature.receipt to every face
  reread: () => void;                  // the board and the shared things, read again
  remote?: (dir: string) => Promise<string>;   // the "owner/name" a folder's origin is; remoteOf by default
  have?: (repo: string) => Promise<string>;     // a folder of mine that holds repo already (Work's, this engine's own), "" when none
  wait?: (asks: Waiting[]) => void;   // who waits for my press now, to every face (team.letin)
};

export type Answer = "invited" | "already" | "no";
/** a friend waiting for the maker's one press (the review of #162): a code is a password anyone can paste on, so
 *  nobody is added to a repository until its maker said yes to that person. room: its id; name: as the card says it */
export type Waiting = { room: string; name: string; login: string; repos: string[]; at: number };
/** git's flags for a clone: no credential helper but gh's (the first, empty, clears any the person set) */
export const CLONE_AUTH = ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"];
const MINUTE = 60_000;
const ASK_WAIT = 10 * MINUTE;      // the friend's cadence: one ask a repo every ten minutes
const ANSWER_WAIT = 8 * MINUTE;    // the maker's throttle, shorter than the friend's cadence, so the next ask is answered
const NO_WAIT = 60 * MINUTE;       // after a no for a repo, the friend asks for it again only an hour on
const CLONE_WAIT = 10 * MINUTE;    // one clone a repo every ten minutes
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const key = (repo: string) => repo.toLowerCase();
// the first line that says something: git's "Command failed" and "Cloning into" lines say nothing
const lineOf = (e: unknown) => String((e as Error)?.message ?? e).split("\n").map((l) => l.trim())
  .filter((l) => l && !/^Command failed:/.test(l) && !/^Cloning into/.test(l))[0]?.slice(0, 200) || "it failed";

/** the "owner/name" of a GitHub remote url, "" for anything else */
export const repoOfUrl = (out: string) => /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(out)?.[1] ?? "";

/** git, never waiting on a password prompt (a clone with no credentials fails at once), its error in git's own words */
export const gitQuiet = (args: string[], cwd: string, timeout = 120_000) => new Promise<string>((ok, no) =>
  execFile("git", args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    (err, out, errOut) => (err ? no(new Error(String(errOut || err.message).trim())) : ok(String(out).trim()))));

/** the GitHub repository a folder's origin points at, "" when none (wire.ts teamFolders, and a clone reused) */
export const remoteOf = (dir: string) => new Promise<string>((ok) =>
  execFile("git", ["-C", dir, "remote", "get-url", "origin"], { timeout: 5000 }, (err, out) => ok(err ? "" : repoOfUrl(String(out)))));

/** which room folders hold which of the wanted repos: a room's folder that is on disk and whose origin is one of that
 *  room's repos wins for that repo (wire.ts teamFolders puts these before Work's folders) */
export async function roomFolders(rooms: Room[], wanted: string[], d: { exists: (p: string) => boolean; remote: (dir: string) => Promise<string> }): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const r of rooms) {
    if (!r.folder || !d.exists(r.folder)) continue;
    const at = await d.remote(r.folder).catch(() => "");
    const want = at ? wanted.find((x) => same(x, at)) : undefined;
    if (want && r.repos.some((x) => same(x, at)) && !(want in out)) out[want] = r.folder;
  }
  return out;
}

// a room a friend may be let into: a GitHub room with a code and no org (never a key room from before codes, never an
// org room, where the org's own invitations rule). The friend's side wants the room met as GitHub too, the way a code
// joins it. The maker's side does not mind its own gate (a maker who runs the hub meets their own room by its key, and
// the code they shared is the word that let the friend in), but it wants the room's repos to be its own words (`mine`);
// such a room is also the one cloned without anyone's answer
const coded = (r: Room) => r.provider === "github" && !r.org && !!r.code;
const lettable = (r: Room) => coded(r) && r.gate === "github";
const answerable = (r: Room) => coded(r) && r.mine;

// when each repo was last asked for, when each (repo, login) was last answered, when each repo was last cloned or said
// no to, when each room's no was last said on the faces: a loop of asks, or of answers (any of the room's people can
// send one), never hammers GitHub, git, the relay, or the faces with receipts
const asked = new Map<string, number>();
const answered = new Map<string, number>();
const cloned = new Map<string, number>();
const turnedDown = new Map<string, number>();
const refused = new Map<string, number>();
const cloning = new Set<string>();   // the rooms a clone is running for now: two never race into one folder
// who waits for my press, and who I said yes to, by room id and login: a yes holds for every repo of that room until the
// engine stops (by then they are collaborators, so GitHub says already). An ask not heard again for half an hour (the
// friend asks every ten minutes while its Sol is on) is gone from the card
const waiting = new Map<string, Waiting>();
const letInto = new Set<string>();
const WAITING_FOR = 30 * MINUTE;
const WAITING_MAX = 50;            // cards at once: past it the oldest goes (it asks again in ten minutes)
const seat = (room: string, login: string) => `${room} ${login.toLowerCase()}`;
// a yes is for that room as it was pressed in: its id, its code and its repos. A room forgotten and made again under the
// same id, or one whose repos changed, is another room, and asks for another press
const yesTo = (r: Room, login: string) => `${r.id} ${r.code} ${r.repos.map((x) => x.toLowerCase()).sort().join(",")} ${login.toLowerCase()}`;
const due = (m: Map<string, number>, k: string, now: number, wait: number) => !(now - (m.get(k) ?? -Infinity) < wait);

/** for the tests: every throttle forgotten, as at an engine's start */
export function resetLetIn() {
  for (const m of [asked, answered, cloned, turnedDown, refused]) m.clear();
  cloning.clear(); waiting.clear(); letInto.clear();
}

/** the friend's side, for the room in use. A room met as GitHub by its code asks once per repo I cannot write to (at
 *  most once a repo every ten minutes, and an hour after a no for it); one that is not mine and has no folder on disk
 *  yet asks for every repo, even one I can write to, since it is cloned only on an answer heard in it. A room of mine
 *  (made here, or mine by share's register again) with a code and no folder is cloned without asking, as make does, so
 *  a make whose clone failed is tried again, at most once every ten minutes. Called after a join, on every relay
 *  connect and every ten minutes while it is up. The repos asked for */
export async function askIn(d: LetInDeps, room: Room = activeRoom(d.team())): Promise<string[]> {
  const s = d.team();
  // the relay meets the room in use only: an ask for another room would be said in the wrong room
  if (room.id !== activeRoom(s).id || !s.me.login) return [];
  const asks = lettable(room), own = answerable(room);
  if (!asks && !own) return [];
  const repos = room.repos.filter((r) => REPO.test(r));
  const housed = !!room.folder && d.exists(room.folder);
  const t = d.now();
  // every repo due is marked now, with one time, before anything is awaited, so a second askIn at the same moment (a
  // join and the relay coming up) finds them all asked; the clone the same way
  const due_ = asks ? repos.filter((r) => due(asked, key(r), t, ASK_WAIT) && due(turnedDown, key(r), t, NO_WAIT)) : [];
  for (const r of due_) asked.set(key(r), t);
  const first = repos[0] ?? "";
  const clone = own && !!first && !housed && due(cloned, key(first), t, CLONE_WAIT) && !cloning.has(room.id);
  if (clone) cloned.set(key(first), t);
  const sent: string[] = [];
  let writable = true;
  for (const repo of repos) {
    const asking = due_.includes(repo);
    if (!asking && !clone) continue;
    const can = await d.record().members.canWrite(repo).catch(() => false);
    if (!can) writable = false;
    if (!asking) continue;
    if (can && (room.mine || housed)) { asked.delete(key(repo)); continue; }   // nothing to ask for
    if (d.send("room", { want: "in", repo }, true)) sent.push(repo);
    else asked.delete(key(repo));   // the relay is down: asked on the next connect
  }
  if (clone) {
    // unless a folder of mine holds its repo already (Work's, this engine's own checkout)
    if (writable && !(await d.have?.(first).catch(() => ""))) await cloneRoom(d, room.id);
    else cloned.delete(key(first));
  }
  return sent;
}

/** the maker's side: an ask from login L for repo R, in the room in use. Only when R is that room's (a room of mine
 *  with a code) and I am R's admin; then L is answered `already` (a collaborator), or waits on a card for my one press
 *  (`waiting`, letIn says yes or no), or, once I said yes to L in this room, `invited` (added now); `no` with why when
 *  gh fails. At most one try per (R, L) every eight minutes, less than the friend's ten, so an ask in the friend's
 *  cadence is never the one skipped. What was answered, "waiting", or null when nothing was said */
export async function answerAsk(d: LetInDeps, m: RelayMsg): Promise<Answer | "waiting" | null> {
  const s = d.team();
  const me = s.me.login, login = typeof m.from?.login === "string" ? m.from.login : "", repo = typeof m.repo === "string" ? m.repo : "";
  if (m.want !== "in" || !me || !login || !LOGIN.test(login) || same(login, me) || !REPO.test(repo)) return null;
  // the ask came in the relay room of the room in use, so only that room's repos: a code to one room is never a way
  // into another room's repository
  // and only a room whose repos are my own words: a joined room's are the word of whoever registered its code, who could
  // name any repository I own and then ask to be let into it
  const room = activeRoom(s);
  if (!answerable(room) || !room.repos.some((x) => same(x, repo))) return null;
  const k = `${repo.toLowerCase()} ${login.toLowerCase()}`;
  if (!due(answered, k, d.now(), ANSWER_WAIT)) return null;
  for (const [x, at] of answered) if (d.now() - at >= ANSWER_WAIT) answered.delete(x);   // only the throttles still running
  answered.set(k, d.now());
  const members = d.record().members;
  let admin = "";
  try { admin = (await members.admin(repo)).trim(); }
  catch { answered.delete(k); return null; }   // gh failed for now: the next ask is tried again
  if (admin !== "true") return null;   // not mine: its maker answers
  if (!mayAgentSpeak(s, "github")) return answerTo(d, login, repo, "no", "my agent may not speak on GitHub");
  // a code pasted in a chat reaches anyone: a person not in yet waits for my yes, one press for them in this room
  if (!letInto.has(yesTo(room, login))) {
    try { if (await inAlready(d, repo, login)) return answerTo(d, login, repo, "already"); }
    catch (e) { return answerTo(d, login, repo, "no", lineOf(e)); }
    hold(d, room, login, repo);
    return "waiting";
  }
  return addTo(d, login, repo);
}

const answerTo = (d: LetInDeps, login: string, repo: string, a: Answer, why?: string): Answer => {
  d.send("room", { to: login, repo, in: a, ...(why ? { why } : {}) }, true);
  return a;
};
const inAlready = async (d: LetInDeps, repo: string, login: string) =>
  (await d.record().members.people(repo)).split("\n").map((x) => x.trim()).some((p) => same(p, login));

/** L added to R from my own gh, and told: already, invited, or no and why */
async function addTo(d: LetInDeps, login: string, repo: string): Promise<Answer> {
  try {
    if (await inAlready(d, repo, login)) return answerTo(d, login, repo, "already");
    return answerTo(d, login, repo, await d.record().members.invite(repo, login));
  } catch (e) { return answerTo(d, login, repo, "no", lineOf(e)); }
}

/** L's ask for R put on (or kept on) the card for my press, and every face told */
function hold(d: LetInDeps, room: Room, login: string, repo: string) {
  const k = seat(room.id, login), w = waiting.get(k);
  const repos = w ? (w.repos.some((x) => same(x, repo)) ? w.repos : [...w.repos, repo]) : [repo];
  waiting.delete(k);
  waiting.set(k, { room: room.id, name: room.name, login, repos, at: d.now() });
  while (waiting.size > WAITING_MAX) waiting.delete(waiting.keys().next().value!);   // the oldest card goes
  d.wait?.(waitingNow(d.now()));
}

/** who waits for my press now, the oldest ask first */
export function waitingNow(now = Date.now()): Waiting[] {
  for (const [k, w] of waiting) if (now - w.at > WAITING_FOR) waiting.delete(k);
  return [...waiting.values()].sort((a, b) => a.at - b.at).map((w) => ({ ...w, repos: [...w.repos] }));
}

/** my press on a card (team.letin.answer): yes adds L to every repo they asked for in that room and lets their next
 *  asks there in, no tells them not now (their Sol asks again only an hour on). Only for the room in use, which is the
 *  only room the relay can answer in, and only while it is still a room of mine */
export async function letIn(d: LetInDeps, roomId: string, login: string, yes: boolean): Promise<{ said: Answer[] } | { error: string }> {
  const k = seat(roomId, login), w = waiting.get(k);
  if (!w) return { error: "nobody waits for that room now" };
  const s = d.team(), room = activeRoom(s);
  if (room.id !== w.room) return { error: `switch to ${w.name} first: an answer is said in the room it was asked in` };
  waiting.delete(k);
  d.wait?.(waitingNow(d.now()));
  const repos = w.repos.filter((r) => room.repos.some((x) => same(x, r)));
  if (!answerable(room) || !repos.length) return { error: "that room no longer lets anyone in from here" };
  if (!yes) return { said: repos.map((r) => answerTo(d, w.login, r, "no", `${s.me.login || "the maker"} said not now`)) };
  if (!mayAgentSpeak(s, "github")) return { said: repos.map((r) => answerTo(d, w.login, r, "no", "my agent may not speak on GitHub")) };
  letInto.add(yesTo(room, w.login));
  const said: Answer[] = [];
  for (const r of repos) said.push(await addTo(d, w.login, r));
  return { said };
}

/** the friend's side, an answer to me: `invited` takes GitHub's invitation and clones, `already` clones, `no` says why */
export async function heardAnswer(d: LetInDeps, m: RelayMsg): Promise<void> {
  const s = d.team();
  const repo = typeof m.repo === "string" ? m.repo : "";
  const from = typeof m.from?.login === "string" ? m.from.login : "";
  if (!s.me.login || typeof m.to !== "string" || !same(m.to, s.me.login) || !from || same(from, s.me.login) || !REPO.test(repo)) return;
  // only for the room in use, where the answer was heard: one for a repo of another room is dropped, and a stranger's
  // answer never makes me accept or clone anything else
  const room = activeRoom(s);
  if (!lettable(room) || !room.repos.some((x) => same(x, repo))) return;
  if (m.in === "no") {
    // whoever said it, that repo is asked for again only an hour on; the receipt once a room every ten minutes, saying
    // who said it, since any of the room's people can send one
    turnedDown.set(key(repo), d.now());
    if (!due(refused, room.id, d.now(), ASK_WAIT)) return;
    refused.set(room.id, d.now());
    const why = typeof m.why === "string" ? m.why.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    d.say([`not let into ${room.name}`, `${from.slice(0, 39)}: ${why || "could not add you"}`]);
    return;
  }
  if (m.in !== "invited" && m.in !== "already") return;
  turnedDown.delete(key(repo));
  if (m.in === "invited") await takeIn(d, repo);
  else await cloneWhenIn(d, room.id);
}

/** the invitation to repo, accepted (one taken on github.com already is simply not there), then the room cloned when
 *  it can be. Always accepted, whatever came before: an `already` (anyone's) or a clone that failed never keeps me from
 *  GitHub's invitation; only the clone is throttled */
export async function takeIn(d: LetInDeps, repo: string): Promise<{ folder: string } | { error: string }> {
  const room = activeRoom(d.team());
  if (!lettable(room) || !room.repos.some((x) => same(x, repo))) return { error: "which room?" };
  const mine = (await d.record().members.invitations().catch(() => [])).find((i) => same(i.repo, repo));
  if (mine) {
    try { await d.record().members.accept(mine.id); }
    catch (e) { const line = `could not accept ${repo}: ${lineOf(e)}`; d.say([line]); return { error: line }; }
  }
  return cloneWhenIn(d, room.id);
}

/** the room cloned once I can write to every one of its repos (an `invited` for its second repo may come before its
 *  first's: then nothing yet, and the first's clones it), at most once a repo every ten minutes */
export async function cloneWhenIn(d: LetInDeps, id: string): Promise<{ folder: string } | { error: string }> {
  const room = d.team().rooms.find((r) => r.id === id);
  if (!room) return { error: "which room?" };
  if (room.folder && d.exists(room.folder)) return { folder: room.folder };
  const first = room.repos[0] ?? "";
  if (!REPO.test(first)) return { error: "this room has no repository to clone" };
  if (!due(cloned, key(first), d.now(), CLONE_WAIT) || cloning.has(room.id)) return { error: "cloned a moment ago" };
  cloned.set(key(first), d.now());   // marked before the waits: two answers at once clone once
  for (const repo of room.repos) {
    if (!(await d.record().members.canWrite(repo).catch(() => false))) { cloned.delete(key(first)); return { error: `not let into ${repo} yet` }; }
  }
  return cloneRoom(d, room.id);
}

/** the room's first repository, cloned into ROOMS_DIR/<room id> when it has no folder on disk yet, and kept on the
 *  room. A folder there already with the same origin is reused; one with another origin, or none, makes it -2, -3.
 *  git asks gh for the credentials (gh auth git-credential), whatever protocol gh was set up with; a clone that fails is
 *  said in a receipt and the room keeps no folder. Then the board and the shared things are read again. A second clone
 *  of a room while one runs says "cloning already" and nothing else */
export async function cloneRoom(d: LetInDeps, id: string): Promise<{ folder: string } | { error: string }> {
  const room = d.team().rooms.find((r) => r.id === id);
  if (!room) return { error: "which room?" };
  const repo = room.repos[0] ?? "";
  if (room.provider !== "github" || !REPO.test(repo)) return { error: "this room has no repository to clone" };
  if (room.folder && d.exists(room.folder)) return { folder: room.folder };
  if (cloning.has(room.id)) return { error: "cloning already" };
  cloning.add(room.id);
  try { return await cloneOnce(d, room, repo); }
  finally { cloning.delete(room.id); }
}

async function cloneOnce(d: LetInDeps, room: Room, repo: string): Promise<{ folder: string } | { error: string }> {
  cloned.set(key(repo), d.now());
  const remote = d.remote ?? remoteOf;
  try { mkdirSync(ROOMS_DIR, { recursive: true, mode: 0o700 }); }
  catch (e) { const line = `could not clone ${repo}: ${lineOf(e)}`; d.say([line]); return { error: line }; }
  let dir = "", reuse = false;
  for (let i = 1; i <= 20 && !dir; i++) {
    const at = join(ROOMS_DIR, i === 1 ? room.id : `${room.id}-${i}`);
    if (!d.exists(at)) dir = at;
    else if (d.exists(join(at, ".git")) && same(await remote(at).catch(() => ""), repo)) { dir = at; reuse = true; }
  }
  if (!dir) { const line = `could not clone ${repo}: no free folder in ${ROOMS_DIR}`; d.say([line]); return { error: line }; }
  if (!reuse) {
    // gh as the only credential helper for this clone: a person who chose SSH in gh auth login has no https helper of
    // their own, and gh holds the token either way
    try { await d.git([...CLONE_AUTH, "clone", "--quiet", `https://github.com/${repo}.git`, dir], ROOMS_DIR); }
    catch (e) {
      // a clone that failed because I still cannot write to it (not let in yet) is not counted: the answer that lets me
      // in clones at once. One that failed for another reason waits its ten minutes
      if (!(await d.record().members.canWrite(repo).catch(() => false))) cloned.delete(key(repo));
      const line = `could not clone ${repo}: ${lineOf(e)}`; d.say([line]); return { error: line };
    }
  }
  // the rooms as they are now, from the settings, so every key and code is kept as it is
  d.patch({ rooms: d.team().rooms.map((r) => (r.id === room.id ? { ...r, folder: dir } : r)) });
  d.reread();
  d.say([`in ${room.name}`, repo]);
  return { folder: dir };
}

/** one `room` word heard on the relay, live or kept by the hub: an ask goes to the maker's side, an answer to me to
 *  the friend's */
export async function hearRoom(d: LetInDeps, m: RelayMsg): Promise<void> {
  if (m.want === "in") { await answerAsk(d, m); return; }
  if (typeof m.to === "string" && typeof m.in === "string") await heardAnswer(d, m);
}
