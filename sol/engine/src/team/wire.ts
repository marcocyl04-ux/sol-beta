// The team wire (Together, PROTOCOL.md round 17 and on): the face's team.* messages, one switch, and what goes back to
// every Cowork face. See owns this file; every later slice adds its own cases in its own block, marked `// --- <slice>`.
//
// A face is a Cowork face once it says team.hello; only those are sent team.state, team.board and team.changed.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { getTeam, patchTeam, forFace, onTeam, fillMe, roomKey, activeRoom, sharedHub, type TeamSettings } from "./settings.js";
import { accounts, signinCommand } from "./control.js";
import { stamp, stables, update, offerNow, shipNow, answered } from "./ship.js";
import { getBoard, onBoard, member, forgetOwners, type Board } from "./board.js";
import { routeIssues } from "./leads.js";   // #118: routing on label
import { pressLeads, candidates } from "./press.js";   // the owner's press (#117)
import { onRelay, sendRelay, relayRoster, relayUp, onRelayStatus, restartRelay, setPresence, startRelayClient, hubTicket, type RelayMsg } from "./relay.js";
import { teamMembers, refreshMembers, onMembers } from "./members.js";   // #102: who is on the team
import { onCreature } from "../creature.js";
import { mark } from "../work/state.js";
import { workSessions } from "../work/sessions.js";
import { handleWork, nameWhenWritten } from "../work/wire.js";
import { typed, history, threadsWithLines, onTalkLine, hearRelay, watchBridges, threadOf } from "./talk.js";   // Talk (#37)
// --- Hand (#34)
import { startHand, heard, handNow, answerNow, handsNow, boardRead, gitCli } from "./hand.js";
import { myLogin } from "./settings.js";
import { getRun } from "../work/runs.js";
import { sessionItems, sessionInfo } from "../work/sessions.js";
// --- end Hand
import { startTry, stopTry, tryState, setTryBus, reviewTry, reviewItems, markReady, commentPr, okRepo, okPr } from "./try.js";
import { getShared, openShared, onShared, forgetShared } from "./share.js";
// --- Pings and felt or silent (#100)
import { pingOf, route, keepPing, absorbedLine, flipped, learnedLine, lastPing, kindOf, type Ping } from "./pings.js";
import { flipBody } from "./mark.js";
import { signature, mayAgentSpeak } from "./settings.js";
import { teamNote, runGit } from "./note.js";
import { record, runGh, runners, ghWithInput } from "./record.js";   // the room's record (#152)
// --- end Pings
import { shows, setShowBus } from "./show.js";   // Show to team (#101)
// --- Share code (#157)
import { shareRoom, joinRoom, makeRoom, shareOnArrival, shareAgain, forgetGone, type RoomsDeps } from "./rooms.js";
import type { Registry } from "./registry.js";
import { ghToken } from "./identity.js";
// --- end Share code
// --- Let in (#162)
import { askIn, cloneRoom, hearRoom, gitQuiet, remoteOf, roomFolders, letIn, waitingNow, type LetInDeps } from "./letin.js";
// --- end Let in
// --- File it (#119)
import { fileIt, takeShot, heldShot, drop as dropShot, healthLine } from "./file.js";
import { healthNow } from "../health.js";
// --- end File it

type Wire = { send: (m: object) => void };
const faces = new Map<Wire, { cowork: boolean }>();
/** to every Cowork face (one that said team.hello) */
export const everyoneTeam = (m: object) => { for (const [f, s] of faces) if (s.cowork) f.send(m); };

export function addTeamFace(w: Wire) { faces.set(w, { cowork: false }); }
export function removeTeamFace(w: Wire) { faces.delete(w); }

const stateMsg = () => {
  const s = getTeam();
  return { type: "team.state", me: s.me, settings: forFace(s), roster: relayRoster(), members: teamMembers(), relay: { url: s.relay.url, up: relayUp() }, hub: sharedHub() };
};
let pending: NodeJS.Timeout | undefined;
const sendState = () => { clearTimeout(pending); pending = setTimeout(() => everyoneTeam(stateMsg()), 100); };

const boardMsg = (b: Awaited<ReturnType<typeof getBoard>>, folders: Record<string, string>, rid?: unknown) =>
  ({ type: "team.board", ...(rid ? { rid } : {}), repos: b.repos, cards: b.cards, prs: b.prs, branches: b.branches, stable: b.stable, main: b.main, leads: b.leads, owner: b.owner, at: b.at, folders, ...(b.error ? { error: b.error } : {}) });

// ---- which folder on this machine holds each team repo (Work's folders and this engine's own checkout; then a room's
// own clone, #162) ----
const HERE = dirname(fileURLToPath(import.meta.url));
const remotes = new Map<string, string>();   // folder -> "owner/name" ("" when it is not a GitHub repo)
/** the folders a person already works in that hold the wanted repos: Work's projects and this engine's own checkout */
async function workFolders(wanted: string[] = getTeam().repos): Promise<Record<string, string>> {
  const repos = new Set(wanted.map((r) => r.toLowerCase()));
  const { projects } = await workSessions().catch(() => ({ projects: [] as { path: string }[] }));
  const dirs = [resolve(HERE, "..", "..", "..", ".."), ...projects.map((p) => p.path)];   // .../sol/engine/dist/team -> the repo
  await Promise.all(dirs.filter((d) => !remotes.has(d)).map(async (d) => remotes.set(d, await remoteOf(d))));
  const out: Record<string, string> = {};
  for (const d of dirs) {
    const r = remotes.get(d) ?? "";
    const want = wanted.find((x) => x.toLowerCase() === r.toLowerCase());
    if (want && repos.has(r.toLowerCase()) && !(want in out) && !d.includes("/.claude/worktrees/")) out[want] = d;
  }
  for (const d of dirs) { const r = remotes.get(d) ?? ""; const want = wanted.find((x) => x.toLowerCase() === r.toLowerCase()); if (want && !(want in out)) out[want] = d; }
  return out;
}
export async function teamFolders(): Promise<Record<string, string>> {
  const out = await workFolders();
  // #162: a room's own folder, the clone Sol made, for a repo no folder above holds: it is on disk and its origin is the
  // room's repo (asked each time, never kept: a folder may be gone or moved since). The checkout a person works in wins
  const rooms = await roomFolders(getTeam().rooms, getTeam().repos.filter((r) => !(r in out)), { exists: existsSync, remote: remoteOf });
  return { ...out, ...rooms };
}

// --- Share (#36, PROTOCOL.md round 23): shared with me, sent again to every Cowork face whenever it is read anew
onShared((sh) => everyoneTeam({ type: "team.shared", repos: sh.repos, at: sh.at }));
// --- end Share

// ---- started once, when the engine listens (index.ts) ----
let started = false;
export function startTeam() {
  if (started) return;
  started = true;
  startRelayClient();
  shareIfNew(null, getTeam());   // #157: a room in use on the shared hub that has no code yet
  void claimRooms();   // #162: a room coded before rooms[].mine, registered again once to see whether it is mine
  onCreature((state, turn, cwd) => setPresence(state, turn, cwd));
  onRelayStatus(sendState);
  // #162: each time the relay comes up, the rooms coded before rooms[].mine that were not registered again yet are (a
  // hub that did not answer at start), then the room in use asks to be let into what I cannot write to yet
  let wasUp = false;
  onRelayStatus(() => { const up = relayUp(); if (up && !wasUp) void claimRooms().then(() => askIn(letInDeps())).catch(() => {}); wasUp = up; });
  // and every ten minutes while it stays up, so an ask that was lost is asked again (askIn skips what is not due)
  setInterval(() => { if (relayUp()) void askIn(letInDeps()).catch(() => {}); }, 10 * 60_000).unref();
  onTeam(sendState);
  onRelay("changed", (m) => { if (m.leads) forgetOwners(typeof m.repo === "string" ? m.repo : undefined); void getBoard(true).catch(() => {}); });
  // a ping to me heard live; one kept by the hub while I was away comes in `spooled` below, not here
  onRelay("ping", (m) => { if (!m.spooled && m.to === getTeam().me.login) { const c = heardPing(m); if (c) everyoneTeam(c); } });
  // --- the spool (#102): pings kept while no Sol of mine was on come back at once; more than 3 are one card. Each goes
  // to my agent and through my dial first (#100), like a live one
  onRelay("spooled", (all) => { for (const p of missedPings(all.messages, getTeam().me.login, heardPing)) everyoneTeam(p); });
  onMembers(sendState);
  // --- end spool
  onBoard((b) => { if ([...faces.values()].some((f) => f.cowork)) void teamFolders().then((f) => everyoneTeam(boardMsg(b, f))); });
  // the board re-reads every minute while someone looks at it
  setInterval(() => { if ([...faces.values()].some((f) => f.cowork)) void getBoard().catch(() => {}); }, 60_000).unref();
}

// --- Talk (#37, PROTOCOL.md round 24): every new line (said here, heard on the relay, read from a bridge) to every
// Cowork face; a teammate's line is heard from the moment this module loads, like the other relay kinds
onTalkLine((l) => everyoneTeam({ type: "team.talk.line", ...l }));
onRelay("talk", hearRelay);
// --- end Talk

// --- Let in (#162): an ask in the room in use (I may be its maker), or an answer to me; live or kept by the hub
onRelay("room", (m) => { void hearRoom(letInDeps(), m).catch(() => {}); });
// --- end Let in

// --- the spool (#102, PROTOCOL.md round 26)
const pingedMsg = (m: RelayMsg) => ({ type: "team.pinged", from: m.from, line: String(m.line ?? "").slice(0, 300), at: m.at, ...(m.spooled ? { spooled: true } : {}) });
/** the pings to me among what the hub kept: each one when 3 or fewer, else one card "while you were away: n pings".
 * `card` turns each into its card, or null when my dial keeps it from me (#100); every ping goes through it, so each
 * reaches my agent. Pure with the default */
export function missedPings(messages: unknown, me: string, card: (m: RelayMsg) => object | null = pingedMsg): object[] {
  const pings = (Array.isArray(messages) ? messages as RelayMsg[] : []).filter((m) => m?.kind === "ping" && !!me && m.to === me);
  const cards = pings.map((m) => card({ ...m, spooled: true })).filter((c): c is object => !!c);
  if (cards.length <= 3) return cards;
  const last = cards[cards.length - 1] as { from: unknown; at: unknown };
  return [{ type: "team.pinged", from: last.from, line: `while you were away: ${cards.length} pings`, at: last.at, spooled: true, count: cards.length }];
}
// --- end spool

const RID = (v: unknown) => (typeof v === "string" || typeof v === "number" ? v : undefined);

// What a change of room (or of what the room in use is) does on this engine (#154, #157): the relay meets the new
// place (another hub, key, org, or room on the hub: the hello names the room's code), a new org's members are read at
// once, and other repos are another board and other shared things, read anew
function afterRoomChange(before: TeamSettings, after: TeamSettings) {
  if (after.relay.url !== before.relay.url || after.relay.key !== before.relay.key || roomKey(after) !== roomKey(before)
    || after.org !== before.org || activeRoom(after).code !== activeRoom(before).code) restartRelay();
  if (after.org !== before.org) void refreshMembers(true);   // #102
  if (after.repos.join(",") !== before.repos.join(",")) { forgetShared(); void getShared(true).catch(() => {}); void getBoard(true).catch(() => {}); }
}

// --- Share code (#157): this engine's own registry, when it is a hub (index.ts hands it in), and the deps of share and join
let local: Registry | null = null;
export const setRegistry = (r: Registry | null) => { local = r; };
const roomsDeps = (): RoomsDeps => ({ team: getTeam, patch: patchTeam, local, fetch: globalThis.fetch, token: ghToken, ticket: hubTicket, record, clone: (id) => cloneRoom(letInDeps(), id) });
// a room as a face may see it: its key said as "set" or ""
const roomForFace = <R extends { key: string }>(r: R) => ({ ...r, key: r.key ? "set" : "" });
// A room met as who I am on GitHub (gate "github": made on the shared hub with no key) has no key there, and an open hub
// opens only rooms with a code (round 35): such a room is registered the moment it is the room in use, so its hello
// names its code and the maker is let in before anyone presses "share". A room that cannot be registered stays as it
// is; "share" says why
function shareIfNew(before: TeamSettings | null, after: TeamSettings) {
  const id = shareOnArrival(before, after);
  if (!id) return;
  void shareRoom(roomsDeps(), id).then((a) => { if ("code" in a) afterRoomChange(after, getTeam()); }).catch(() => {});
}
// #162: every room that has a code, is not mine, was not joined by a code and has no org, registered again once an engine
// run: the hub gives the same code back only to its maker, so a room I shared before rooms[].mine becomes mine
const claimRooms = () => shareAgain(roomsDeps()).catch(() => []);
// --- end Share code

// --- Let in (#162, PROTOCOL.md round 37): the friend's Sol asks the room to be let into its repository, the maker's
// answers; a receipt to every face (the notch's too) says what came of it
const letInDeps = (): LetInDeps => ({
  team: getTeam, patch: patchTeam, record, send: sendRelay, git: gitQuiet, exists: existsSync, now: Date.now,
  say: (lines) => everyFace({ type: "creature.receipt", lines }),
  reread: () => { void getShared(true).catch(() => {}); void getBoard(true).catch(() => {}); },
  have: async (repo) => (await workFolders([repo]))[repo] ?? "",
  wait: (asks) => everyFace({ type: "team.letin", asks }),
});
// --- end Let in

export async function handleTeam(w: Wire, m: any) {
  const me = faces.get(w);
  if (!me) return;
  const rid = RID(m.rid);
  switch (m.type) {
    // --- See (round 17)
    case "team.hello":
      me.cowork = true;
      return w.send(stateMsg());
    case "team.settings": {
      if (m.patch && typeof m.patch === "object") {
        const before = getTeam();
        // the face never sees the key, so it never sends it back; a new relay url reconnects
        const { relay, me: mine, ...rest } = m.patch as Record<string, any>;
        // the login is GitHub's word (fillMe), never the face's: a face edit of `me` may change the name only
        if (mine && typeof mine === "object") rest.me = { ...mine, login: before.me.login };
        // #157: a code is the engine's word (share, join), never a face's: the stored one is kept (settings.ts keepKeys).
        // A room's folder, `mine` and `joined` (#162) too: only the engine clones, so a face never points a room at a
        // folder of its choosing, never makes a joined room's repos its own, which would let anyone into them, and never
        // makes a joined room look like one of mine to register again
        if (Array.isArray(rest.rooms)) rest.rooms = rest.rooms.map((r: unknown) => { if (!r || typeof r !== "object") return r; const { code: _c, folder: _f, mine: _m, joined: _j, ...x } = r as Record<string, unknown>; return x; });
        const dialsBefore = before.dials;
        const s = patchTeam({ ...rest, ...(relay && typeof relay === "object" ? { relay: { ...relay, key: typeof relay.key === "string" && relay.key !== "set" ? relay.key : before.relay.key } } : {}) });
        afterRoomChange(before, s);
        shareIfNew(before, s);   // #157: a new room on the shared hub gets its code at once
        void forgetGone(roomsDeps(), before, s).catch(() => {});   // a room of mine forgotten here is forgotten on its hub
        const learned = flipped(dialsBefore, s.dials).map((f) => learnedLine(f.kind, f.was, f.now));
        if (learned.length) { void writeLearned(learned).catch(() => {}); return w.send({ type: "team.settings", rid, settings: forFace(s), learned }); }
      }
      return w.send({ type: "team.settings", rid, settings: forFace(getTeam()) });
    }
    // --- Share code (#157, PROTOCOL.md round 35): a room's code (made on its hub when it has none), a room joined by one
    case "team.room.share": {
      const before = getTeam();
      const r = await shareRoom(roomsDeps(), typeof m.id === "string" && m.id ? m.id : undefined);
      afterRoomChange(before, getTeam());   // the room in use now has a code: its hello names it
      return w.send({ type: "team.room.share", rid, ...r });
    }
    case "team.room.join": {
      const before = getTeam();
      const r = await joinRoom(roomsDeps(), m.code);
      if ("error" in r) return w.send({ type: "team.room.join", rid, error: r.error });
      afterRoomChange(before, getTeam());   // what team.settings does on a switch
      void askIn(letInDeps(), r.room).catch(() => {});   // #162: let me into its repository (the relay may be down: then on connect)
      return w.send({ type: "team.room.join", rid, room: roomForFace(r.room), ...(r.already ? { already: true } : {}) });
    }
    // the maker's one press (the review of #162): who waits to be let into a room of mine, and yes or not now
    case "team.letin.get":
      return w.send({ type: "team.letin", rid, asks: waitingNow() });
    case "team.letin.answer":
      return w.send({ type: "team.letin.answer", rid, ...(await letIn(letInDeps(), String(m.room ?? ""), String(m.login ?? ""), m.yes === true)) });
    case "team.room.make": {   // #160: a room from a name alone
      const before = getTeam();
      const r = await makeRoom(roomsDeps(), { name: m.name, ...(typeof m.hub === "string" ? { hub: m.hub } : {}), ...(typeof m.key === "string" ? { key: m.key } : {}) });
      if ("error" in r) return w.send({ type: "team.room.make", rid, error: r.error });
      afterRoomChange(before, getTeam());   // what team.settings does on a switch
      return w.send({ type: "team.room.make", rid, room: roomForFace(r.room), ...(r.warn ? { warn: r.warn } : {}) });
    }
    // --- end Share code
    case "team.board":
    case "team.board.get":
    case "team.board.refresh": {
      const b = await getBoard(m.type === "team.board.refresh" || !!m.refresh);
      return w.send(boardMsg(b, await teamFolders(), rid));
    }
    case "team.member": {
      const login = String(m.login ?? "");
      const r = await member(login).catch(() => ({ log: [] }));
      return w.send({ type: "team.member", rid, login, ...r });
    }
    case "team.ping": {
      const to = String(m.to ?? "").slice(0, 39), line = String(m.line ?? "").slice(0, 300);
      const ok = !!to && !!line && sendRelay("ping", { to, line, pingKind: kindOf(m.kind) });
      return w.send({ type: "team.ping", rid, ok });
    }
    case "team.session.start": {
      // a Work session in the repo's folder, marked cowork: Work's side does not list it, Cowork lists it under its repo
      const repo = String(m.repo ?? "");
      const folders = await teamFolders();
      const cwd = folders[repo];
      if (!cwd) return w.send({ type: "team.session.start", rid, error: `no folder on this machine holds ${repo || "that repository"}` });
      const id = randomUUID();
      const issue = Number(m.issue) > 0 ? Number(m.issue) : undefined;
      const text = String(m.text ?? "").slice(0, 100_000);
      if (!text.trim()) return w.send({ type: "team.session.start", rid, error: "nothing to say" });
      mark(id, { mode: "cowork" });
      w.send({ type: "team.session.start", rid, sessionId: id, repo, cwd });
      await handleWork(w, { type: "work.say", sessionId: id, fresh: true, cwd, text, ...(Array.isArray(m.files) ? { files: m.files } : {}) });
      const card = issue ? (await getBoard().catch(() => null))?.cards.find((c) => c.repo === repo && c.number === issue) : undefined;
      if (issue) void nameWhenWritten(id, `#${issue} ${card?.title ?? basename(cwd)}`.slice(0, 80));   // else Work names it as usual
      return;
    }
    // --- end See
    // --- Control (round 18): my accounts, and the line that signs in
    case "team.accounts": {   // Claude Code, Codex and GitHub signed in on this machine, or not
      const a = await accounts();
      if (a.github.in && !getTeam().me.login) await fillMe();   // signed in to GitHub since: the login fills in
      return w.send({ type: "team.accounts", rid, ...a });
    }
    case "team.signin": {     // the line to type in a terminal pane; the face opens it and types, the person presses Return
      const command = signinCommand(m.seat);
      return w.send({ type: "team.signin", rid, ...(command ? { command } : { error: "sign in to what? claude, codex or github" }) });
    }
    // --- end Control

    // --- ship (#33, PROTOCOL.md round 19): stamp stable, one stable back, the offer, update on yes
    case "team.stamp": {
      const d = shipNow();
      if (!d) return w.send({ type: "team.stamp", rid, error: "stable is not set up here" });
      const to = typeof m.to === "string" && m.to ? m.to : undefined;
      return w.send({ type: "team.stamp", rid, ...(await stamp(d, to)) });
    }
    case "team.stables": {
      const d = shipNow();
      if (!d) return w.send({ type: "team.stables", rid, tags: [], stable: null, head: null });
      return w.send({ type: "team.stables", rid, ...(await stables(d)) });
    }
    case "team.update": {
      const d = shipNow();
      if (!d) return w.send({ type: "team.update", rid, error: "stable is not set up here" });
      const r = await update(d);
      if (r.ok) answered(r.sha);
      return w.send({ type: "team.update", rid, ...r });
    }
    case "team.stable.get":
      return w.send({ type: "team.stable", ...(rid !== undefined ? { rid } : {}), ...(offerNow() ?? { sha: null }) });
    // --- end ship

    // --- Talk (#37, PROTOCOL.md round 24): a line typed in the chat (a `/discord ` one goes out first), a thread's lines
    case "team.talk": {
      watchBridges();
      const r = await typed(m.thread, m.text);
      return w.send({ type: "team.talk", rid, ...(r.ok ? { ok: true, id: r.line.id, sent: r.sent } : { ok: false, error: r.error }) });
    }
    case "team.talk.history": {
      watchBridges();
      const thread = threadOf(m.thread) || "general";
      const discord = getTeam().speak.discord === "any" && !!process.env.DISCORD_WEBHOOK;
      return w.send({ type: "team.talk.history", rid, thread, lines: history(thread), threads: threadsWithLines(), discord });
    }
    // --- end Talk
    // --- Hand (#34, PROTOCOL.md round 21): hand an issue, a session or a PR to a teammate; take, pass or later
    case "team.hand":
      return w.send({ type: "team.hand", rid, ...(await handNow(m)) });
    case "team.hand.answer":
      return w.send({ type: "team.hand.answer", rid, ...(await answerNow(m.id, m.how, m.line)) });
    case "team.hands.get":
      return w.send({ type: "team.hands", rid, ...(await handsNow(!!m.refresh)) });
    // --- end Hand
    // --- Try (#35, PROTOCOL.md round 22): a teammate's PR as a second Sol beside mine, the review seat on it, ready, comment
    case "team.try": case "team.try.review": case "team.try.reviews": case "team.pr.ready": case "team.pr.comment": {
      const repo = String(m.repo ?? ""), pr = Number(m.pr);
      const reply = (o: object) => w.send({ type: m.type, rid, ...o });
      if (!okRepo(repo) || !okPr(pr)) return reply({ error: "which pull request?" });
      if (!getTeam().repos.some((r) => r.toLowerCase() === repo.toLowerCase())) return reply({ error: `${repo} is not one of the team's repositories` });
      if (m.type === "team.try.reviews") return reply({ repo, pr, items: reviewItems(repo, pr) });
      if (m.type === "team.pr.ready") return reply(await markReady(repo, pr));
      if (m.type === "team.pr.comment") {
        const line = Number(m.line);
        return reply(await commentPr({ repo, pr, body: String(m.body ?? ""), ...(typeof m.path === "string" && m.path ? { path: m.path.slice(0, 500) } : {}),
          ...(Number.isInteger(line) && line > 0 ? { line } : {}), ...(typeof m.remark === "string" && m.remark ? { remark: m.remark } : {}) }));
      }
      const dir = (await teamFolders())[repo];
      if (m.type === "team.try.review") return reply(await reviewTry(repo, pr, dir));
      if (!dir) return reply({ error: `no folder on this machine holds ${repo}` });
      return reply(await startTry(repo, pr, dir));
    }
    case "team.try.stop":
      return w.send({ type: "team.try.stop", rid, ...(await stopTry()) });
    case "team.try.get":
      return w.send({ ...tryState(), ...(rid !== undefined ? { rid } : {}) });
    // --- end Try
    // --- Share (#36, PROTOCOL.md round 23): shared with me, and one shared thing opened
    case "team.shared": {
      try { const sh = await getShared(!!m.refresh); return w.send({ type: "team.shared", rid, repos: sh.repos, at: sh.at }); }
      catch (e) { return w.send({ type: "team.shared", rid, repos: [], at: Date.now(), error: String((e as Error)?.message ?? e).slice(0, 200) }); }
    }
    case "team.shared.open": {
      const repo = typeof m.repo === "string" ? m.repo : "", path = typeof m.path === "string" ? m.path : "";
      const ref = typeof m.ref === "string" && m.ref ? m.ref : undefined;
      const r = await openShared(repo, path, ref).catch((e) => ({ error: `could not open it: ${String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200)}` }));
      return w.send({ type: "team.shared.open", rid, repo, path, ...(ref ? { ref } : {}), ...r });
    }
    // --- end Share
    // --- Felt or silent (#100, PROTOCOL.md round 28): the person flips a PR's mark; a comment, signed by them
    case "team.pr.mark": {
      const repo = String(m.repo ?? ""), pr = Number(m.number ?? m.pr), mk = m.mark;
      const reply = (o: object) => w.send({ type: "team.pr.mark", rid, repo, number: pr, ...o });
      if (!okRepo(repo) || !okPr(pr)) return reply({ error: "which pull request?" });
      if (mk !== "felt" && mk !== "silent") return reply({ error: "a mark is felt or silent" });
      if (!getTeam().repos.some((r) => r.toLowerCase() === repo.toLowerCase())) return reply({ error: `${repo} is not one of the team's repositories` });
      const by = signature(getTeam(), false);
      try { await record().notes.addOnPr(pr, flipBody(mk, by), repo); }
      catch (e) { return reply({ error: `GitHub did not take it: ${String((e as Error)?.message ?? e).slice(0, 200)}` }); }
      void getBoard(true).catch(() => {});
      return reply({ ok: true, mark: mk, by });
    }
    // --- end Felt or silent
    // --- the owner's press (#117): who may lead a label (the repo's people), and who leads it, landed on main at once
    case "team.leads.who": case "team.leads.set": {
      const repo = String(m.repo ?? "");
      const reply = (o: object) => w.send({ type: m.type, rid, repo, ...o });
      if (!okRepo(repo) || !getTeam().repos.some((r) => r.toLowerCase() === repo.toLowerCase())) return reply({ error: `${repo || "that"} is not one of the team's repositories` });
      if (m.type === "team.leads.who") return reply(await candidates({ gh: runGh }, repo).then((people) => ({ people }), (e) => ({ error: String((e as Error)?.message ?? e).slice(0, 200) })));
      const r = await pressLeads({
        gh: runGh, login: myLogin, team: teamMembers,
        ping: (to, line, at) => sendRelay("ping", { to, line, pingKind: "decision", repo: at }),
      }, { repo, label: String(m.label ?? ""), leads: m.leads });
      if ("ok" in r && !r.unchanged) {
        forgetOwners(repo);
        sendRelay("changed", { repo, leads: true });   // every other Sol reads CODEOWNERS again
        void getBoard(true).catch(() => {});
      }
      return reply(r);
    }
    // --- end the owner's press
    // --- Show (#101, PROTOCOL.md round 27): who is showing a session now, or one shown session's last lines
    case "team.shown.get": {
      const login = typeof m.login === "string" ? m.login : "", id = typeof m.id === "string" ? m.id : "";
      if (!login || !id) return w.send({ type: "team.shown.get", rid, shows: shows.list() });
      const lines = shows.lines(login, id);
      return w.send({ type: "team.shown.get", rid, login, id, ...(lines ? { lines } : { lines: [], ended: true }) });
    }
    // --- end Show

    // --- File it (#119, PROTOCOL.md round 29): the press takes the shot; the words file the issue; the number comes back
    case "team.file.shot": {
      try { return w.send({ type: "team.file.shot", rid, shot: await takeShot() }); }
      catch (e) { return w.send({ type: "team.file.shot", rid, error: `no screenshot: ${String((e as Error)?.message ?? e).slice(0, 200)}` }); }
    }
    case "team.file": {
      const s = getTeam();
      try {
        const r = await fileIt({
          gh: (args) => runGh(args),
          ghInput: (args, body) => ghWithInput((a) => runGh(a), args, body),
          login: () => myLogin(),
          mayGitHub: () => mayAgentSpeak(s, "github"),
          repo: () => s.repos[0] ?? "",
          health: () => healthLine(healthNow()),
          build: async () => { const dir = resolve(HERE, "..", "..", "..", ".."); return (await Promise.all([runGit(["rev-parse", "--abbrev-ref", "HEAD"], dir), runGit(["rev-parse", "--short", "HEAD"], dir)])).join(" "); },
          shot: heldShot,
        }, { mode: m.mode, words: m.words, page: m.page, conversation: m.conversation, shot: m.shot });
        dropShot();
        void getBoard(true).catch(() => {});
        w.send({ type: "creature.receipt", lines: [`filed #${r.number}`, String(m.words ?? "").replace(/\s+/g, " ").trim().slice(0, 60)] });
        return w.send({ type: "team.file", rid, ...r });
      } catch (e) { return w.send({ type: "team.file", rid, error: String((e as Error)?.message ?? e).split("\n")[0].slice(0, 240) }); }
    }
    // --- end File it
    default:
      return;
  }
}

// --- Hand (#34): the record is the issue; the relay carries the word; every face hears a hand to me, the notch's too
const everyFace = (m: object) => { for (const f of faces.keys()) f.send(m); };
const quiet: Wire = { send() {} };
startHand({
  gh: runners.hand,
  git: gitCli,
  send: (word) => sendRelay("hand", word),
  me: async () => getTeam().me.login || (await myLogin().catch(() => "")),
  now: () => new Date(),
  session: async (id) => {
    const info = await sessionInfo(id).catch(() => undefined);
    const run = getRun(id);
    if (!info && !run) return null;
    const items = run ? run.items.list : (await sessionItems(id).catch(() => null))?.list ?? [];
    return { title: String(info?.customTitle || info?.summary || ""), items, cwd: run?.cwd ?? info?.cwd, branch: info?.gitBranch };
  },
  folders: teamFolders,
  repos: () => getTeam().repos,
  cards: async () => (await getBoard()).cards,
  start: async ({ cwd, issue, title, text }) => {
    // the same session team.session.start makes: in the repo's folder, marked cowork, named after its card
    const id = randomUUID();
    mark(id, { mode: "cowork" });
    void handleWork(quiet, { type: "work.say", sessionId: id, fresh: true, cwd, text }).catch(() => {});
    void nameWhenWritten(id, `#${issue} ${title || basename(cwd)}`.slice(0, 80));
    return id;
  },
}, everyFace);
onRelay("hand", (m) => heard(m));
onBoard(() => boardRead());
// --- end Hand
// --- Try (#35): the try's steps, its state and its review items go to every Cowork face
setTryBus(everyoneTeam);
// --- end Try
// --- Pings (#100): a ping to me lands on my agent first (the spool), then my dial says whether it is a card; a
// "when it matters" call that keeps one from me is written in one line on its issue, signed by my agent
// heardPing keeps it for my agent, writes the absorbed line, and gives back the card my dial makes, or null
function heardPing(m: Record<string, any>): object | null {
  const p = pingOf(m);
  if (!p) return null;
  keepPing(p);
  const s = getTeam();
  const r = route(p.kind, s.dials[p.kind]);
  if (r.written) void writeAbsorbed(p).catch(() => {});
  return r.card ? { type: "team.pinged", id: p.id, kind: p.kind, from: p.from, line: p.line, at: p.at, ...(p.issue ? { issue: p.issue } : {}), ...(p.repo ? { repo: p.repo } : {}), ...(m.spooled ? { spooled: true } : {}) } : null;
}
async function writeAbsorbed(p: Ping) {
  const s = getTeam();
  if (!p.issue || !p.repo || !s.me.login || !mayAgentSpeak(s, "github")) return;
  if (!s.repos.some((r) => r.toLowerCase() === p.repo!.toLowerCase())) return;
  await record().notes.add(p.issue, absorbedLine(s.me.login, p), p.repo);
}
// a flipped dial: written once on my plan (team_note's plan kind), on the issue of the last ping of that kind
async function writeLearned(lines: string[]) {
  const s = getTeam();
  const folders = await teamFolders();
  for (const line of lines) {
    const kind = /^dial (\w+)/.exec(line)?.[1] ?? "";
    const last = lastPing(kindOf(kind));
    const repo = last?.repo ?? s.repos[0];
    const cwd = folders[repo];
    if (!last?.issue || !cwd) continue;   // no issue to name: the face said it, the plan waits for the next flip
    await teamNote({ cwd, gh: runGh, git: runGit, login: myLogin, mayGitHub: () => mayAgentSpeak(getTeam(), "github") }, { issue: last.issue, kind: "plan", lines: line });
  }
}
// --- end Pings
// --- Routing (#118, leads.ts): an issue I opened that wears a label gets its leads assigned and pinged on my board's
// read, at once; only mine, so two Sols never route the same issue. The night job routes everyone's
const routed = new Map<string, Set<number>>();   // repo -> issues settled in this engine's life
onBoard((b) => void routeMine(b).catch(() => {}));
async function routeMine(b: Board) {
  const s = getTeam();
  const me = s.me.login.toLowerCase();
  if (!me || !mayAgentSpeak(s, "github")) return;
  for (const repo of b.repos) {
    const l = b.leads?.[repo];
    if (!l) continue;
    const mine = b.cards.filter((c) => c.repo === repo && c.state === "open" && c.author.toLowerCase() === me);
    if (!routed.has(repo)) routed.set(repo, new Set());
    await routeIssues({ gh: runGh, repo, dryRun: false, say: () => {}, seen: routed.get(repo),
      ping: (p) => sendRelay("ping", { to: p.to, pingKind: p.kind, line: p.line, issue: p.issue, repo }, true) }, mine, l);
  }
}
// --- end Routing
// --- Show (#101): a shown session's lines (mine, and a teammate's heard on the relay) go to every Cowork face; a
// teammate who leaves the relay without an end is no longer showing
setShowBus(everyoneTeam);
onRelay("show", (m) => shows.hear(m));
onRelayStatus(() => shows.prune(relayRoster().map((r) => r.who)));
// --- end Show
