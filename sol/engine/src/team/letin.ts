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
// A cloud group (#325, PROTOCOL round 57; the Cowork PRD §9.4): its names are Sol names, never GitHub logins, so nothing
// above runs there. Instead a member presses "ask to be let in" on a connected repository's row: their Sol sends the
// maker alone `room { to, want: "in", repo, github, proof }`, the asker's GitHub login said once and proved by a secret
// gist of theirs (the hub's own proof, proof.ts, with words of its own); the maker's Sol reads the gist, puts the ask on
// the same card, never answers it by itself, and on "let in" (the card as the face showed it, the asker still a member)
// invites that login from the maker's gh, writes it into connectors.json's `in`, and answers as above. The asker's Sol,
// on the answer from the person it asked, checks the repository is private, accepts the invitation, takes the
// repository as a target with 4a's push check, and clones it into ROOMS_DIR/<group id>/<name>. Its asks out are kept
// on disk (the state folder), so an answer that comes after a restart still counts.
// Everything it touches is handed in, so the tests run with no network and no gh.
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { activeRoom, mayAgentSpeak, recordOf, LOGIN, REPO, ROOMS_DIR, type Room, type TeamSettings } from "./settings.js";
import { GITHUB_LOGIN } from "../hub/hub-types.js";
import type { ConnectorsFile, ConnectorsOp } from "./connectors.js";
import type { RoomRecord } from "./record.js";
import { ghHelper } from "./gh.js";
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
  cloud?: CloudIn;                     // a cloud group's part (#325); without it nothing is asked or held there
};
/** what a cloud group's let-in needs beyond the above (#325) */
export type CloudIn = {
  me: () => string;                                       // my name in the group (relay.ts hubLogin)
  file: (room: Room) => Promise<ConnectorsFile>;          // the group's connectors.json, read fresh
  change: (room: Room, op: ConnectorsOp) => Promise<object | { error: string }>;   // one compare-and-swap change of it
  github: () => Promise<{ in: boolean; who?: string }>;   // GitHub here and who (control.ts githubAccount)
  members: (room: Room) => Promise<{ logins: string[]; maker: string } | null>;   // the cloud's members route; null when unsaid
  take: (room: Room, repo: string) => Promise<string>;    // the repository made one of my targets (4a's push check): "" or why not
  facts: (repo: string) => Promise<{ private: boolean } | null>;   // what my gh says of a repository (connectors.ts repoFacts)
  prove: (text: string) => Promise<string>;               // a secret gist of mine holding text, its id (record.who.prove)
  unprove: (id: string) => Promise<unknown>;              // that gist, deleted
  proofOf: (id: string) => Promise<string>;               // a gist's owner and text, as JSON { owner, text } (record.who.proofOf)
  store?: { load: () => string; save: (text: string) => void };   // my asks out, kept on disk; none: in memory only
  changed: () => void;                                    // the connectors tab told again (an ask out, or answered)
  log?: (line: string) => void;                           // one line in the engine's log
};

export type Answer = "invited" | "already" | "no";
/** a friend waiting for the maker's one press (the review of #162): a code is a password anyone can paste on, so
 *  nobody is added to a repository until its maker said yes to that person. room: its id; name: as the card says it */
export type Waiting = { room: string; name: string; login: string; repos: string[]; at: number;
  /** a cloud group's ask (#325): the GitHub login the asker gave; `login` is then their Sol name */
  github?: string };
/** git's flags for a clone, after `clone`: no credential helper for github.com but gh's (the first, empty, clears any
 *  the person set), kept in the clone's own config, so the room's later fetches and pushes ask gh too and the person's
 *  ~/.gitconfig is never written */
export const cloneAuth = () => ghHelper("--config");
const MINUTE = 60_000;
const ASK_WAIT = 10 * MINUTE;      // the friend's cadence: one ask a repo every ten minutes
const ANSWER_WAIT = 8 * MINUTE;    // the maker's throttle, shorter than the friend's cadence, so the next ask is answered
const NO_WAIT = 60 * MINUTE;       // after a no for a repo, the friend asks for it again only an hour on
const CLONE_WAIT = 10 * MINUTE;    // one clone a repo every ten minutes
const DAY = 24 * 60 * MINUTE;      // a cloud group's ask, a press said once, waits a day for the maker's
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
    // a cloud group's (#325): each of its repos in its group's folder, the first of name, name-2, ... whose origin it is
    if (r.provider === "cloud") {
      const base = groupDir(r.id, d.exists);
      for (const want of wanted.filter((x) => !(x in out) && r.repos.some((y) => same(y, x)))) {
        for (let i = 1; i <= 20; i++) {
          const at = join(base, i === 1 ? nameOf(want) : `${nameOf(want)}-${i}`);
          if (!d.exists(at)) break;
          if (same(await d.remote(at).catch(() => ""), want)) { out[want] = at; break; }
        }
      }
      continue;
    }
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
// a cloud group's asks of mine still out (#325), by group id and repo: whom I asked, and when. Only an answer from that
// person, within the day, makes me accept and clone anything
type Out = { room: string; repo: string; to: string; at: number; proof?: string; no?: true };
const asksOut = new Map<string, Out>();
let asksRead = false;   // asksOut read from disk once an engine run (loadAsks)
const proofRead = new Map<string, number>();   // when an ask's gist was last read, by its asker and repo
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
  cloning.clear(); waiting.clear(); letInto.clear(); asksOut.clear(); asksRead = false; proofRead.clear();
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

/** L's ask for R put on (or kept on) the card for my press, and every face told. A cloud group's (#325) carries the
 *  GitHub login it gave: the same login asking again is the same card, another login from that person a new one */
function hold(d: LetInDeps, room: Room, login: string, repo: string, github?: string, at = d.now()) {
  const k = seat(room.id, login), had = waiting.get(k);
  const w = had && same(had.github ?? "", github ?? "") ? had : undefined;
  const repos = w ? (w.repos.some((x) => same(x, repo)) ? w.repos : [...w.repos, repo]) : [repo];
  waiting.delete(k);
  waiting.set(k, { room: room.id, name: room.name, login, repos, at: Math.max(at, w?.at ?? 0), ...(github ? { github } : {}) });
  while (waiting.size > WAITING_MAX) waiting.delete(waiting.keys().next().value!);   // the oldest card goes
  d.wait?.(waitingNow(d.now()));
}

/** who waits for my press now, the oldest ask first. A cloud group's ask waits a day: it is a press, said once */
export function waitingNow(now = Date.now()): Waiting[] {
  for (const [k, w] of waiting) if (now - w.at > (w.github ? DAY : WAITING_FOR)) waiting.delete(k);
  return [...waiting.values()].sort((a, b) => a.at - b.at).map((w) => ({ ...w, repos: [...w.repos] }));
}

/** the card as the face showed it when I pressed (#325): the GitHub login and the repositories it said */
export type Card = { github: string; repos: string[] };
const CHANGED = "the ask changed; look again";
/** is the card I pressed the ask that waits now (pure)? A cloud group's must be said in full, the same login and the
 *  same repositories; a GitHub room's, from a face of before, may say nothing */
function sameCard(w: Waiting, card: Card | undefined): boolean {
  if (!card) return !w.github;
  const set = (l: string[]) => [...new Set(l.map((x) => x.toLowerCase()))].sort().join(",");
  return same(w.github ?? "", card.github) && set(w.repos) === set(card.repos);
}

/** my press on a card (team.letin.answer): yes adds L to every repo they asked for in that room and lets their next
 *  asks there in, no tells them not now (their Sol asks again only an hour on). Only for the room in use, which is the
 *  only room the relay can answer in, and only while it is still a room of mine */
export async function letIn(d: LetInDeps, roomId: string, login: string, yes: boolean, card?: Card): Promise<{ said: Answer[] } | { error: string }> {
  const k = seat(roomId, login), w = waiting.get(k);
  if (!w) return { error: "nobody waits for that room now" };
  const s = d.team(), room = activeRoom(s);
  if (room.id !== w.room) return { error: `switch to ${w.name} first: an answer is said in the room it was asked in` };
  if (!sameCard(w, card)) return { error: CHANGED };
  if (w.github) return letInCloud(d, room, k, card!, yes);
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
  const r = await cloneInto(d, ROOMS_DIR, room.id, repo);
  if ("error" in r) return r;
  // the rooms as they are now, from the settings, so every key and code is kept as it is
  d.patch({ rooms: d.team().rooms.map((x) => (x.id === room.id ? { ...x, folder: r.folder } : x)) });
  d.reread();
  d.say([`in ${room.name}`, repo]);
  return r;
}

/** repo cloned into parent/<base>, or parent/<base>-2, -3 when that one is taken by another origin (one with the same
 *  origin is reused), parent made private first. A clone that fails is said in a receipt, and one that failed because I
 *  still cannot write to it is not counted against the ten minutes */
async function cloneInto(d: LetInDeps, parent: string, base: string, repo: string): Promise<{ folder: string } | { error: string }> {
  const remote = d.remote ?? remoteOf;
  try { mkdirSync(parent, { recursive: true, mode: 0o700 }); }
  catch (e) { const line = `could not clone ${repo}: ${lineOf(e)}`; d.say([line]); return { error: line }; }
  let dir = "", reuse = false;
  for (let i = 1; i <= 20 && !dir; i++) {
    const at = join(parent, i === 1 ? base : `${base}-${i}`);
    if (!d.exists(at)) dir = at;
    else if (d.exists(join(at, ".git")) && same(await remote(at).catch(() => ""), repo)) { dir = at; reuse = true; }
  }
  if (!dir) { const line = `could not clone ${repo}: no free folder in ${parent}`; d.say([line]); return { error: line }; }
  if (!reuse) {
    // gh as the only credential helper for this clone: a person who chose SSH in gh auth login has no https helper of
    // their own, and gh holds the token either way
    try { await d.git(["clone", ...cloneAuth(), "--quiet", `https://github.com/${repo}.git`, dir], parent); }
    catch (e) {
      // a clone that failed because I still cannot write to it (not let in yet) is not counted: the answer that lets me
      // in clones at once. One that failed for another reason waits its ten minutes
      if (!(await d.record().members.canWrite(repo).catch(() => false))) cloned.delete(key(repo));
      const line = `could not clone ${repo}: ${lineOf(e)}`; d.say([line]); return { error: line };
    }
  }
  return { folder: dir };
}

// ---- a cloud group (#325) ----
const outKey = (room: string, repo: string) => `${room} ${repo.toLowerCase()}`;
const word = (v: unknown) => (typeof v === "string" ? v : "");
const GIST = /^[0-9a-f]{1,64}$/i;   // a gist's id, as proof.ts takes one
/** the words a cloud group's ask is refused with, one plain line each */
export const ASK_SAY = {
  cloud: "asking to be let in is for a group on Sol's cloud",
  which: "which repository? its owner/name",
  sol: "sign in to Sol's cloud first",
  github: "connect GitHub first: you're let in as your GitHub name",
  who: "connect GitHub again: Sol can't tell your GitHub name",
  notHere: "that repository is not connected to this group",
  down: "Sol's cloud isn't reachable right now; try again in a moment",
  private: "only a private repository is taken in from a group",
  members: "couldn't check who is in the group; press again in a moment",
} as const;

/** the words an ask's proof gist holds (#325, the hub's proof of proof.ts with words of its own): the group's code (the
 *  one name both Sols share for it: a room's id is each Sol's own), my Sol name, the repository and my GitHub login, so
 *  a gist proves this one ask and no other */
export const letinProof = (code: string, name: string, repo: string, github: string) => `sol letin ${code} ${name} ${repo} ${github}`;

/** where a cloud group's connected repositories are cloned (#325): ROOMS_DIR/<group id>, one folder a repository in it.
 *  When ROOMS_DIR/<group id> is itself a clone (a GitHub room of that id that moved to the cloud), <group id>-group, so
 *  no clone ever sits inside another */
export function groupDir(id: string, exists: (p: string) => boolean): string {
  const at = join(ROOMS_DIR, id);
  return exists(join(at, ".git")) ? `${at}-group` : at;
}
/** the folder name a repository is cloned under in its group's folder: its name, never a path (REPO's parts hold no "/") */
const nameOf = (repo: string) => repo.split("/")[1] ?? "";

// ---- my asks out, kept on disk (review P2-4): an answer after a restart still finds the ask it answers ----
/** asksOut read from the store once an engine run, and every ask past a day dropped, its gist deleted */
function loadAsks(d: LetInDeps) {
  if (!asksRead) {
    asksRead = true;
    let v: unknown;
    try { v = JSON.parse(d.cloud?.store?.load() || "[]"); } catch { v = []; }
    for (const x of Array.isArray(v) ? v : []) {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const room = word(o.room), repo = word(o.repo), to = word(o.to), proof = word(o.proof);
      if (!room || !REPO.test(repo) || !to || !LOGIN.test(to) || typeof o.at !== "number") continue;
      asksOut.set(outKey(room, repo), { room, repo, to, at: o.at, ...(GIST.test(proof) ? { proof } : {}), ...(o.no === true ? { no: true as const } : {}) });
    }
  }
  let gone = false;
  for (const [k, o] of asksOut) if (d.now() - o.at > DAY) { asksOut.delete(k); unproveOf(d, o); gone = true; }
  if (gone) saveAsks(d);
}
/** asksOut written whole (a few asks at most); a store that cannot write keeps them in memory for this run */
function saveAsks(d: LetInDeps) {
  try { d.cloud?.store?.save(JSON.stringify([...asksOut.values()], null, 2) + "\n"); } catch { /* in memory for this run */ }
}
/** an ask's gist deleted: once its answer came, or a day on. One that fails to go stays a secret gist of mine */
function unproveOf(d: LetInDeps, o: Out) {
  if (!o.proof) return;
  const id = o.proof;
  delete o.proof;
  void d.cloud?.unprove(id).catch(() => {});
}

/** the repositories of the room in use my ask is out for (team.connectors' `asked`), a day at most; one answered no is
 *  not asked any more, though it is kept out for the day */
export function askedNow(d: LetInDeps, room: string): string[] {
  loadAsks(d);
  return [...asksOut.values()].filter((o) => o.room === room && !o.no).map((o) => o.repo.toLowerCase());
}

/** team.letin.ask { repo } (a person's press, never my agent's): in the cloud group in use, a repository its
 *  connectors.json lists. An invitation of mine to it waiting already, or a repository my gh may push to, is taken in
 *  at once (takeCloud) and nobody is asked. Else whoever connected it is asked (the row's `by` while they are a member of
 *  the group, else the group's maker), with my GitHub login and the id of a secret gist of mine that proves it. A second
 *  press within ten minutes says asked again and sends nothing */
export async function askCloud(d: LetInDeps, raw: unknown): Promise<{ asked: true; repo: string; to: string } | { in: true; repo: string } | { error: string }> {
  const c = d.cloud, room = activeRoom(d.team());
  if (!c || room.provider !== "cloud" || !recordOf(room)) return { error: ASK_SAY.cloud };
  const want = word(raw).trim();
  if (!REPO.test(want)) return { error: ASK_SAY.which };
  const me = c.me();
  if (!me) return { error: ASK_SAY.sol };
  const gh = await c.github().catch(() => ({ in: false, who: undefined }));
  if (!gh.in) return { error: ASK_SAY.github };
  const who = gh.who ?? "";
  if (!GITHUB_LOGIN.test(who)) return { error: ASK_SAY.who };
  let file: ConnectorsFile;
  try { file = await c.file(room); } catch (e) { return { error: `couldn't read the group's connectors: ${lineOf(e)}` }; }
  const row = file.repos.find((r) => same(r.repo, want));
  if (!row) return { error: ASK_SAY.notHere };
  loadAsks(d);
  // a way in that is there already (review P2-4): nothing to ask, the repository is taken in now
  const invited = (await d.record().members.invitations().catch(() => [])).some((i) => same(i.repo, row.repo));
  if (invited || (await d.record().members.canWrite(row.repo).catch(() => false))) {
    const r = await takeCloud(d, room, row.repo);
    return "error" in r ? r : { in: true, repo: row.repo };
  }
  const k = outKey(room.id, row.repo), t = d.now(), had = asksOut.get(k);
  if (had && !had.no && t - had.at < ASK_WAIT) return { asked: true, repo: row.repo, to: had.to };
  // review P2-7: a `by` who left the group (or a word any member wrote there) is not asked; the group's maker is
  const people = await c.members(room).catch(() => null);
  const member = (x: string) => !!x && LOGIN.test(x) && (!people || people.logins.some((p) => same(p, x)));
  const to = member(row.by) ? row.by : people?.maker ?? "";
  if (!to || !LOGIN.test(to)) return { error: `couldn't tell who connected ${row.repo}; try again in a moment` };
  if (same(to, me)) return { error: `you connected ${row.repo} with another GitHub; sign in with that one` };
  let proof = "";
  try { proof = (await c.prove(letinProof(room.code, me, row.repo, who))).trim(); } catch (e) { return { error: `couldn't prove your GitHub name: ${lineOf(e)}` }; }
  if (!GIST.test(proof)) return { error: "couldn't prove your GitHub name: GitHub gave no gist" };
  if (!d.send("room", { to, want: "in", repo: row.repo, github: who, proof }, false)) { void c.unprove(proof).catch(() => {}); return { error: ASK_SAY.down }; }
  if (had) unproveOf(d, had);
  asksOut.set(k, { room: room.id, repo: row.repo, to, at: t, proof });
  saveAsks(d);
  c.changed();
  return { asked: true, repo: row.repo, to };
}

/** does the gist prove this ask (review P1-2)? Its owner on GitHub is the login the ask gave, and it holds this ask's
 *  words. A gist that cannot be read proves nothing */
async function proved(c: CloudIn, id: string, text: string, github: string): Promise<boolean> {
  let g: { owner?: unknown; text?: unknown } | null = null;
  try { g = JSON.parse(await c.proofOf(id)); } catch { return false; }
  return typeof g?.owner === "string" && same(g.owner, github) && typeof g.text === "string" && same(g.text.trim(), text);
}

/** the maker's side of a cloud group's ask: one to me (`to`), in the group in use, for a repository its connectors.json
 *  lists, with a GitHub login its gist proves, from someone else, said within a day. Not its repository's admin: no,
 *  and why (review P2-7). Never answered yes here: it waits on the card for my press (letIn). "waiting", or null when it
 *  is nobody's card here */
async function holdCloud(d: LetInDeps, m: RelayMsg): Promise<"waiting" | null> {
  const c = d.cloud;
  if (!c) return null;
  const me = c.me(), from = word(m.from?.login), repo = word(m.repo), github = word(m.github), proof = word(m.proof);
  if (!me || !same(word(m.to), me) || !from || !LOGIN.test(from) || same(from, me) || !REPO.test(repo) || !GITHUB_LOGIN.test(github)) return null;
  const room = activeRoom(d.team());
  if (room.provider !== "cloud" || !recordOf(room)) return null;
  const at = typeof m.at === "number" && m.at > 0 ? Math.min(m.at, d.now()) : d.now();
  if (d.now() - at > DAY) return null;   // one the hub kept past a day is over
  const row = (await c.file(room).catch(() => null))?.repos.find((r) => same(r.repo, repo));
  if (!row) return null;
  if (!GIST.test(proof)) { c.log?.(`let in: ${from}'s ask into ${repo} dropped: it carries no proof of ${github}`); return null; }
  // the gist is read at most once a minute an asker and repository: asks sent fast never spend my gh
  const pk = `${from.toLowerCase()} ${repo.toLowerCase()}`;
  if (!due(proofRead, pk, d.now(), MINUTE)) return null;
  for (const [x, t] of proofRead) if (d.now() - t >= MINUTE) proofRead.delete(x);
  proofRead.set(pk, d.now());
  if (!(await proved(c, proof, letinProof(room.code, from, repo, github), github))) {
    c.log?.(`let in: ${from}'s ask into ${repo} dropped: its gist does not prove ${github}`);
    return null;
  }
  // only an admin lets anyone in; gh failing to say leaves the card up, and the press asks GitHub again
  const admin = await d.record().members.admin(row.repo).then((x) => x.trim(), () => "true");
  if (admin !== "true") { answerTo(d, from, row.repo, "no", `${me} isn't an admin of ${row.repo}`); return null; }
  hold(d, room, from, row.repo, github, at);
  return "waiting";
}

/** my press on a cloud group's card (k its seat, card as the face showed it): yes, while the asker is still a member of
 *  the group (review P2-6), invites the login they gave to each repository they asked for that the group still lists
 *  (from my own gh), writes it into connectors.json's `in`, and answers them; no answers not now. The card is taken
 *  after the reads, as it is then (review P1-1): one that changed meanwhile is pressed again */
async function letInCloud(d: LetInDeps, room: Room, k: string, card: Card, yes: boolean): Promise<{ said: Answer[] } | { error: string }> {
  const c = d.cloud, github = card.github;
  if (!c || room.provider !== "cloud" || !GITHUB_LOGIN.test(github)) return { error: "that group no longer lets anyone in from here" };
  const s = d.team(), me = c.me() || "the maker";
  let file: ConnectorsFile | null = null, people: { logins: string[] } | null = null;
  if (yes) {
    try { file = await c.file(room); } catch (e) { return { error: `couldn't read the group's connectors: ${lineOf(e)}; press again in a moment` }; }
    people = await c.members(room).catch(() => null);
    if (!people) return { error: ASK_SAY.members };
  }
  const w = waiting.get(k);
  if (!w) return { error: "nobody waits for that room now" };
  if (!sameCard(w, card)) return { error: CHANGED };
  waiting.delete(k);
  d.wait?.(waitingNow(d.now()));
  if (!yes) return { said: w.repos.map((r) => answerTo(d, w.login, r, "no", `${me} said not now`)) };
  if (!mayAgentSpeak(s, "github")) return { said: w.repos.map((r) => answerTo(d, w.login, r, "no", "my agent may not speak on GitHub")) };
  if (!people!.logins.some((p) => same(p, w.login))) return { said: w.repos.map((r) => answerTo(d, w.login, r, "no", `${w.login} is not in the group any more`)) };
  const said: Answer[] = [];
  for (const r of w.repos) {
    const row = file!.repos.find((x) => same(x.repo, r));
    if (!row) { said.push(answerTo(d, w.login, r, "no", "that repository is no longer connected to the group")); continue; }
    let a: Answer;
    try { a = (await inAlready(d, row.repo, github)) ? "already" : await d.record().members.invite(row.repo, github); }
    catch (e) { said.push(answerTo(d, w.login, row.repo, "no", lineOf(e))); continue; }
    const wrote = await c.change(room, { in: { repo: row.repo, login: github } }).catch((e) => ({ error: lineOf(e) }));
    if ("error" in wrote) d.say([`${github} is in ${row.repo}`, `couldn't write it in the group's list: ${String(wrote.error).slice(0, 160)}`]);
    said.push(answerTo(d, w.login, row.repo, a));
  }
  c.changed();
  return { said };
}

/** the asker's side: an answer to me from the person I asked, for an ask of mine still out in the group in use (read
 *  from disk after a restart). Any answer means the gist was read: it is deleted. No says why and keeps the ask out for
 *  the rest of the day, so that person's later yes still counts (review P2-5); invited or already takes me in
 *  (takeCloud), and the ask is over only once that worked. Anyone else's answer makes me accept and clone nothing */
async function heardCloud(d: LetInDeps, m: RelayMsg): Promise<void> {
  const c = d.cloud;
  if (!c) return;
  const me = c.me(), from = word(m.from?.login), repo = word(m.repo);
  if (!me || !same(word(m.to), me) || !from || same(from, me) || !REPO.test(repo)) return;
  if (m.in !== "invited" && m.in !== "already" && m.in !== "no") return;
  const room = activeRoom(d.team());
  if (room.provider !== "cloud") return;
  loadAsks(d);
  const mine = asksOut.get(outKey(room.id, repo));
  if (!mine || !same(mine.to, from) || d.now() - mine.at > DAY) return;
  unproveOf(d, mine);
  if (m.in === "no") {
    const again = mine.no === true;
    mine.no = true;
    saveAsks(d);
    c.changed();
    if (again) return;   // said once
    const why = word(m.why).replace(/\s+/g, " ").trim().slice(0, 120);
    d.say([`not let into ${repo}`, `${from.slice(0, 39)}: ${why || "not now"}`]);
    return;
  }
  saveAsks(d);
  await takeCloud(d, room, mine.repo);
}

/** GitHub's invitation to repo accepted, only once my gh (else the invitation itself, for a repository I cannot see
 *  before I accept) says it is private (review P2-9); one taken on github.com already is simply not there. Then the
 *  repository made one of my targets with 4a's push check, my ask for it over, and only then cloned into its group's
 *  folder (groupDir), at most once in ten minutes: connectors.json and its `by` are room content any member can write,
 *  so a repository my own gh did not find private and mine to push to is never cloned (its project settings would load
 *  in a session started there). The folder is found again by roomFolders, never kept on the room */
export async function takeCloud(d: LetInDeps, room: Room, repo: string): Promise<{ folder: string } | { error: string }> {
  const c = d.cloud;
  if (!c) return { error: ASK_SAY.cloud };
  const inv = (await d.record().members.invitations().catch(() => [])).find((i) => same(i.repo, repo));
  if (inv) {
    const facts = await c.facts(repo).catch(() => null);
    if ((facts ? facts.private : inv.private) !== true) { const line = `not taking ${repo} in: ${ASK_SAY.private}`; d.say([line]); return { error: line }; }
    try { await d.record().members.accept(inv.id); }
    catch (e) { const line = `could not accept ${repo}: ${lineOf(e)}`; d.say([line]); return { error: line }; }
  }
  const why = await c.take(room, repo).catch((e) => lineOf(e));
  if (why) { const line = `couldn't take ${repo} as yours: ${why}`; d.say([line]); return { error: line }; }
  loadAsks(d);
  const out = asksOut.get(outKey(room.id, repo));
  if (out) { unproveOf(d, out); asksOut.delete(outKey(room.id, repo)); saveAsks(d); c.changed(); }
  const k = outKey(room.id, repo);
  if (!due(cloned, key(repo), d.now(), CLONE_WAIT) || cloning.has(k)) return { error: "cloned a moment ago" };
  cloned.set(key(repo), d.now());
  cloning.add(k);
  try {
    const r = await cloneInto(d, groupDir(room.id, d.exists), nameOf(repo), repo);
    if ("error" in r) return r;
    d.reread();
    d.say([`in ${repo}`, room.name]);
    return r;
  } finally { cloning.delete(k); }
}

/** a cloud group's clone of one of its repositories (#328: the build updates' workflow file is committed in it): the
 *  folder roomFolders finds by its origin, else cloned now into its group's folder as takeCloud does; the folder, or
 *  why not. Only for a repository of my room's (my gh checked it), never one the file alone names */
export async function groupClone(d: LetInDeps, room: Room, repo: string): Promise<string | { error: string }> {
  if (room.provider !== "cloud" || !room.repos.some((r) => same(r, repo))) return { error: "that repository is not one of yours in this group" };
  const had = (await roomFolders([room], [repo], { exists: d.exists, remote: d.remote ?? remoteOf }))[repo];
  if (had) return had;
  const r = await cloneInto(d, groupDir(room.id, d.exists), nameOf(repo), repo);
  return "error" in r ? r : r.folder;
}

/** one `room` word heard on the relay, live or kept by the hub: an ask goes to the maker's side, an answer to me to
 *  the friend's */
export async function hearRoom(d: LetInDeps, m: RelayMsg): Promise<void> {
  if (m.want === "in") { await answerAsk(d, m); return; }
  if (typeof m.to === "string" && typeof m.in === "string") await heardAnswer(d, m);
}

/** the same on a cloud group (#325): an ask to me goes on the card, an answer to me from the person I asked takes me in */
export async function hearCloud(d: LetInDeps, m: RelayMsg): Promise<void> {
  if (m.want === "in") { await holdCloud(d, m); return; }
  if (typeof m.to === "string" && typeof m.in === "string") await heardCloud(d, m);
}
