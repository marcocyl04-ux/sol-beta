// Let in (#162): a friend who typed a room's code asks its room to be let into the repository; the maker's Sol, its
// admin, adds them and answers that person only; the friend's Sol accepts GitHub's invitation and clones the room into
// the rooms folder; a room's own folder is the one Work starts in. GitHub is a fake record, git a fake or a real temp
// repository, the hub in memory or on a local socket; HOME and the rooms folder are temp folders.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const ROOMS = tmp("sol-rooms-");
Object.assign(process.env, {
  SOL_TEAM: join(tmp("sol-team-"), "team.json"), SOL_TEAM_OFFLINE: "1",
  SOL_STATE: join(tmp("sol-state-"), "work.json"), SOL_HOME: tmp("sol-home-"),
  SOL_HUB: "wss://shared.example.net/relay", SOL_ROOMS: ROOMS,
  HOME: tmp("sol-home-dir-"),   // Work's folders (~/.claude/projects) and git's global config: none of the real ones
  GIT_CONFIG_NOSYSTEM: "1",
});

const T = await import("../src/team/settings.ts");
const L = await import("../src/team/letin.ts");
const { RelayHub, RelayClient, relayServer, relayRoutes } = await import("../src/team/relay.ts");
const { Registry } = await import("../src/hub/index.ts");
const { Spool } = await import("../src/hub/index.ts");
const { teamFolders } = await import("../src/team/wire.ts");
type RelayMsg = import("../src/team/relay.ts").RelayMsg;
type LetInDeps = import("../src/team/letin.ts").LetInDeps;
const R = await import("../src/team/rooms.ts");
// every test starts with no throttle and no room registered again, as an engine's start does
beforeEach(() => { L.resetLetIn(); R.resetShareAgain(); });

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
/** a real folder with a git repository whose origin is github.com/<repo> */
function cloneOf(dir: string, repo: string) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", `https://github.com/${repo}.git`);
  return dir;
}

const HUB = "wss://shared.example.net/relay";
/** a room I joined by a code (its repos are the hub's word) */
const room = (id: string, repos: string[], more: Record<string, unknown> = {}) =>
  ({ id, name: id.replace(/(^|-)(\w)/g, (_m, s, c) => `${s ? " " : ""}${c.toUpperCase()}`), repos, hub: HUB, gate: "github", code: "BKQ2CL", mine: false, joined: true, ...more });
/** a room whose repos are my own words (made or shared from here) */
const made = (id: string, repos: string[], more: Record<string, unknown> = {}) => room(id, repos, { mine: true, joined: false, ...more });
/** me, my rooms, the one in use; every room's folder as given (a face never sets one, the engine's patch does) */
const as = (login: string, rooms: Record<string, unknown>[], inUse = rooms[0].id) =>
  T.patchTeam({ me: { login, name: login }, rooms, room: inUse, speak: { github: true } });

type Fake = { canWrite?: (repo: string) => boolean; admin?: (repo: string) => string | Promise<string>; people?: (repo: string) => string;
  invite?: (repo: string, login: string) => Promise<"invited" | "already">; invitations?: { id: number; repo: string }[];
  git?: (args: string[], cwd: string) => Promise<string>; up?: boolean; now?: () => number; have?: (repo: string) => Promise<string>; accept?: (id: number) => void };
function deps(f: Fake = {}) {
  const c = { sent: [] as [string, Record<string, any>, boolean | undefined][], said: [] as string[][], git: [] as [string[], string][],
    read: [] as string[], invited: [] as [string, string][], accepted: [] as number[], reread: 0 };
  const d: LetInDeps = {
    team: T.getTeam, patch: T.patchTeam, exists: existsSync, now: f.now ?? (() => 1_000_000),
    send: (kind, payload, agent) => { if (f.up === false) return false; c.sent.push([kind, payload, agent]); return true; },
    git: async (args, cwd) => { c.git.push([args, cwd]); return f.git ? f.git(args, cwd) : ""; },
    say: (lines) => { c.said.push(lines); },
    reread: () => { c.reread++; },
    ...(f.have ? { have: f.have } : {}),
    record: () => ({ members: {
      canWrite: async (repo: string) => { c.read.push(repo); return f.canWrite?.(repo) ?? false; },
      admin: async (repo: string) => (await f.admin?.(repo)) ?? "true",
      people: async (repo: string) => f.people?.(repo) ?? "frank",
      invite: async (repo: string, login: string) => { c.invited.push([repo, login]); return f.invite ? f.invite(repo, login) : "invited"; },
      invitations: async () => f.invitations ?? [],
      accept: async (id: number) => { c.accepted.push(id); f.accept?.(id); return ""; },
    } }) as any,
  };
  return { d, c };
}
const ask = (from: string, repo: string, more: object = {}): RelayMsg => ({ kind: "room", from: { login: from, agent: true }, at: 1, want: "in", repo, ...more });
const answer = (to: string, repo: string, said: string, more: object = {}): RelayMsg => ({ kind: "room", from: { login: "frank", agent: true }, at: 1, to, repo, in: said, ...more });
const cloneArgs = (repo: string, dir: string) => ["clone", ...L.cloneAuth(), "--quiet", `https://github.com/${repo}.git`, dir];

// ---- the record's calls ----
test("the record: may I push, my invitations, accept one, add a person (201 invited, 204 already)", async () => {
  const { makeGithubRecord } = await import("../src/team/record.ts");
  const calls: string[][] = [];
  let put = "{\"id\":5}";
  const gh = async (args: string[]) => {
    calls.push(args);
    if (args[1] === "repos/frank/secret") throw new Error("gh: Not Found (HTTP 404)");
    if (args[1] === "repos/frank/open") return "true\n";
    if (args[1] === "user/repository_invitations") return '{"id":9,"repo":"frank/book-club"}\nnot json\n{"id":"x","repo":"a/b"}\n';
    if (args.includes("PUT")) return put;
    return "";
  };
  const m = makeGithubRecord(gh).members;
  assert.equal(await m.canWrite("frank/secret"), false);
  assert.equal(await m.canWrite("frank/open"), true);
  assert.deepEqual(calls[1], ["api", "repos/frank/open", "--jq", ".permissions.push"], "push, not pull: a public repository is readable by anyone");
  assert.deepEqual(await m.invitations(), [{ id: 9, repo: "frank/book-club" }]);
  await m.accept(9);
  assert.deepEqual(calls.at(-1), ["api", "-X", "PATCH", "user/repository_invitations/9"]);
  assert.equal(await m.invite("frank/book-club", "marco"), "invited");
  assert.deepEqual(calls.at(-1), ["api", "-X", "PUT", "repos/frank/book-club/collaborators/marco", "-f", "permission=push"]);
  put = "";
  assert.equal(await m.invite("frank/book-club", "marco"), "already", "204: a collaborator already");
});

// ---- the friend asks ----
test("askIn: a room with its folder asks once per repo I cannot write to, none for one I can; a key room, an org room, a room not in use: nothing", async () => {
  const there = cloneOf(join(tmp("sol-folders-"), "two"), "frank/ask-a");
  as("marco", [room("two", ["frank/ask-a", "frank/ask-b"], { folder: there }), room("keyed", ["frank/ask-k"], { gate: "key", code: "" }), room("org", ["acme/ask-o"], { org: "acme" })]);
  const { d, c } = deps({ canWrite: (r) => r === "frank/ask-b" });
  assert.deepEqual(await L.askIn(d), ["frank/ask-a"]);
  assert.deepEqual(c.sent, [["room", { want: "in", repo: "frank/ask-a" }, true]], "signed as my agent");
  assert.deepEqual(c.git, [], "a joined room is never cloned by askIn");
  const keyed = T.getTeam().rooms.find((r) => r.id === "keyed")!;
  as("marco", T.getTeam().rooms, "keyed");
  assert.deepEqual(await L.askIn(d, keyed), []);
  as("marco", T.getTeam().rooms, "org");
  assert.deepEqual(await L.askIn(d), []);
  as("marco", T.getTeam().rooms, "keyed");
  assert.deepEqual(await L.askIn(d, T.getTeam().rooms.find((r) => r.id === "two")), [], "the relay is in the room in use only");
  assert.deepEqual(c.read, ["frank/ask-a", "frank/ask-b"], "GitHub was asked for the coded room in use only");
});

test("askIn: at most once a repo every ten minutes; a relay that is down is asked again on the next connect", async () => {
  as("marco", [room("slow", ["frank/ask-slow"])]);
  let now = 5_000_000;
  const down = deps({ up: false, now: () => now });
  assert.deepEqual(await L.askIn(down.d), [], "not sent");
  const { d, c } = deps({ now: () => now });
  assert.deepEqual(await L.askIn(d), ["frank/ask-slow"], "a send that failed is not counted");
  now += 9 * 60_000;
  assert.deepEqual(await L.askIn(d), []);
  now += 60_001;
  assert.deepEqual(await L.askIn(d), ["frank/ask-slow"]);
  assert.equal(c.sent.length, 2);
});

test("askIn: a room of mine I can write to and have no folder for is cloned without asking, once in ten minutes", async () => {
  as("frank", [made("mine", ["frank/ask-mine"])]);
  const { d, c } = deps({ canWrite: () => true });
  assert.deepEqual(await L.askIn(d), []);
  assert.deepEqual(c.sent, [], "never an ask for a repo I can read");
  assert.deepEqual(c.git, [[cloneArgs("frank/ask-mine", join(ROOMS, "mine")), ROOMS]], "git asks gh for the credentials, whatever protocol gh uses");
  await L.askIn(d);
  assert.equal(c.git.length, 1, "the same room again within ten minutes: not cloned again");
});

test("askIn: a room of mine whose repo a Work folder of mine holds already is not cloned", async () => {
  as("frank", [made("worked", ["frank/ask-worked"])]);
  const asked: string[] = [];
  const { d, c } = deps({ canWrite: () => true, have: async (repo) => { asked.push(repo); return "/Users/frank/code/ask-worked"; } });
  await L.askIn(d);
  assert.deepEqual([asked, c.git], [["frank/ask-worked"], []]);
});

test("askIn: a join and the relay coming up at the same moment ask once for each repo", async () => {
  as("marco", [room("twice", ["frank/ask-twice", "frank/ask-twice-2"])]);
  let now = 40_000_000;
  const { d, c } = deps({ now: () => now++ });   // a clock that moves on every look
  const [a, b] = await Promise.all([L.askIn(d), L.askIn(d)]);
  assert.deepEqual([...a, ...b].sort(), ["frank/ask-twice", "frank/ask-twice-2"]);
  assert.equal(c.sent.length, 2);
  now = 40_000_000 + 10 * 60_000;
  assert.deepEqual(await L.askIn(d), ["frank/ask-twice", "frank/ask-twice-2"], "one time for the batch: both are due again together");
});

test("askIn: a joined room with no folder asks for every repo, even one I can write to; it is never cloned on that alone", async () => {
  as("marco", [room("open", ["frank/ask-open", "frank/ask-shut"])]);
  const { d, c } = deps({ canWrite: (r) => r === "frank/ask-open" });
  assert.deepEqual(await L.askIn(d), ["frank/ask-open", "frank/ask-shut"]);
  assert.deepEqual(c.git, [], "a code is trust in its maker: the clone waits for an answer heard in the room");
  // a room neither mine nor joined (coded before rooms[].mine, not registered again yet) is asked for the same way
  as("marco", [room("older", ["frank/ask-older"], { joined: false })]);
  const o = deps({ canWrite: () => true });
  assert.deepEqual(await L.askIn(o.d), ["frank/ask-older"]);
  assert.deepEqual(o.c.git, []);
});

test("askIn: a room of mine its maker meets by the hub's key: a make whose clone failed is tried again, ten minutes on", async () => {
  as("frank", [made("hosted", ["frank/ask-hosted"], { gate: "key", hub: "", code: "7HQ3ZM" })]);
  let now = 20_000_000, fails = true;
  const { d, c } = deps({ canWrite: () => true, now: () => now, git: async () => { if (fails) throw new Error("fatal: unable to access"); return ""; } });
  assert.deepEqual(await L.askIn(d), [], "nothing asked: its repos are mine");
  assert.equal(c.git.length, 1);
  assert.deepEqual(c.said.at(-1), ["could not clone frank/ask-hosted: fatal: unable to access"]);
  now += 9 * 60_000;
  await L.askIn(d);
  assert.equal(c.git.length, 1, "a clone that failed while I can write to it waits its ten minutes");
  now += 60_001; fails = false;
  await L.askIn(d);
  assert.equal(c.git.length, 2);
  assert.deepEqual(c.sent, []);
});

test("askIn: after a no for a repo it is asked for again only an hour on; no answer at all keeps the ten minutes", async () => {
  as("marco", [room("nope", ["frank/ask-nope", "frank/ask-quiet"])]);
  let now = 30_000_000;
  const { d, c } = deps({ now: () => now });
  assert.deepEqual(await L.askIn(d), ["frank/ask-nope", "frank/ask-quiet"]);
  await L.hearRoom(d, answer("marco", "frank/ask-nope", "no", { why: "not you" }));
  now += 10 * 60_000 + 1;
  assert.deepEqual(await L.askIn(d), ["frank/ask-quiet"], "the quiet one in its ten minutes; the refused one not");
  now += 50 * 60_000;
  assert.deepEqual(await L.askIn(d), ["frank/ask-nope", "frank/ask-quiet"], "an hour after the no");
  assert.equal(c.sent.length, 5);
});

// ---- the maker answers ----
test("the maker: a stranger's ask for my room's repo waits for my press, then is invited; a collaborator is already in; each answered to that person only", async () => {
  as("frank", [made("book-club", ["frank/book-club"])]);
  const told: unknown[] = [];
  const { d, c } = deps({ people: () => "frank\nIsaac" });
  d.wait = (asks) => { told.push(asks); };
  assert.equal(await L.answerAsk(d, ask("marco", "Frank/Book-Club")), "waiting");
  assert.deepEqual([c.sent, c.invited], [[], []], "a code lets a person ask, never in: nobody added before my press");
  const card = [{ room: "book-club", name: "Book Club", login: "marco", repos: ["Frank/Book-Club"], at: 1_000_000 }];
  assert.deepEqual(L.waitingNow(1_000_000), card);
  assert.deepEqual(told, [card], "every face is told who waits");
  assert.deepEqual(await L.letIn(d, "book-club", "marco", true), { said: ["invited"] });
  assert.deepEqual(L.waitingNow(1_000_000), [], "the card goes");
  assert.deepEqual(c.invited, [["Frank/Book-Club", "marco"]]);
  assert.deepEqual(c.sent.at(-1), ["room", { to: "marco", repo: "Frank/Book-Club", in: "invited" }, true]);
  assert.equal(await L.answerAsk(d, ask("isaac", "frank/book-club")), "already");
  assert.equal(c.invited.length, 1, "no invite for one who is in");
  assert.deepEqual(c.sent.at(-1), ["room", { to: "isaac", repo: "frank/book-club", in: "already" }, true]);
  const was = deps({ invite: async () => "already" });
  assert.equal(await L.answerAsk(was.d, ask("joe", "frank/book-club")), "waiting");
  assert.deepEqual(await L.letIn(was.d, "book-club", "joe", true), { said: ["already"] }, "GitHub's 204: in already");
});

test("the maker: not now tells them so and lets nobody in; a yes holds for that person in that room only; a press for a room not in use says switch", async () => {
  as("frank", [made("bc", ["frank/bc-a", "frank/bc-b"]), made("other", ["frank/other"])]);
  let now = 5_000_000;
  const { d, c } = deps({ now: () => now });
  assert.equal(await L.answerAsk(d, ask("eve", "frank/bc-a")), "waiting");
  assert.equal(await L.answerAsk(d, ask("eve", "frank/bc-b")), "waiting");
  assert.deepEqual(L.waitingNow(now).map((w) => w.repos), [["frank/bc-a", "frank/bc-b"]], "one card a person, every repo they asked for");
  assert.deepEqual(await L.letIn(d, "bc", "eve", false), { said: ["no", "no"] });
  assert.deepEqual(c.sent.at(-1), ["room", { to: "eve", repo: "frank/bc-b", in: "no", why: "frank said not now" }, true]);
  assert.equal(c.invited.length, 0);
  assert.deepEqual(await L.letIn(d, "bc", "eve", true), { error: "nobody waits for that room now" }, "the no was the answer");
  now += 8 * 60_000;
  assert.equal(await L.answerAsk(d, ask("ann", "frank/bc-a")), "waiting");
  assert.deepEqual(await L.letIn(d, "bc", "ann", true), { said: ["invited"] });
  now += 8 * 60_000;
  assert.equal(await L.answerAsk(d, ask("ann", "frank/bc-b")), "invited", "a yes for ann in this room: her next repo here needs no press");
  T.patchTeam({ room: "other" });
  assert.equal(await L.answerAsk(d, ask("ann", "frank/other")), "waiting", "another room is another yes");
  T.patchTeam({ room: "bc" });
  assert.match((await L.letIn(d, "other", "ann", true) as { error: string }).error, /^switch to Other first/);
  now += 31 * 60_000;
  assert.deepEqual(L.waitingNow(now), [], "an ask not heard again for half an hour is gone from the card");
});

test("the maker: not my repo, not admin, not my room in use, a key room, my own ask, no login: nothing is said", async () => {
  as("frank", [made("book-club", ["frank/bc-2"]), made("other", ["frank/bc-other"]), made("keyed", ["frank/bc-key"], { gate: "key", code: "" })]);
  const { d, c } = deps({ admin: (r) => (r === "frank/bc-2" ? "false" : "true") });
  assert.equal(await L.answerAsk(d, ask("marco", "frank/bc-2")), null, "not admin: its maker answers");
  assert.equal(await L.answerAsk(d, ask("marco", "someone/else")), null);
  assert.equal(await L.answerAsk(d, ask("marco", "frank/bc-other")), null, "a code to one room is never a way into another");
  assert.equal(await L.answerAsk(d, ask("frank", "frank/bc-2")), null);
  assert.equal(await L.answerAsk(d, ask("", "frank/bc-2")), null);
  assert.equal(await L.answerAsk(d, { ...ask("marco", "frank/bc-2"), want: "out" }), null);
  as("frank", T.getTeam().rooms, "keyed");
  assert.equal(await L.answerAsk(d, ask("eve", "frank/bc-key")), null, "a key room with no code is never opened by an ask");
  assert.deepEqual([c.sent, c.invited], [[], []]);
});

test("the maker: a yes is for the room as it was: forgotten and made again under the same id, or with other repos, it asks for another press", async () => {
  as("frank", [made("club", ["frank/club"], { code: "CLUBQ2" })]);
  let now = 7_000_000;
  const { d } = deps({ now: () => now });
  assert.equal(await L.answerAsk(d, ask("ann", "frank/club")), "waiting");
  assert.deepEqual(await L.letIn(d, "club", "ann", true), { said: ["invited"] });
  as("frank", [made("other", ["frank/other"], { code: "THRQ22" })]);   // club forgotten
  as("frank", [made("club", ["frank/secret"], { code: "CLUBQ3" })]);   // and a new room took its id
  now += 9 * 60_000;
  assert.equal(await L.answerAsk(d, ask("ann", "frank/secret")), "waiting", "no press carried over to another repository");
});

test("the maker: at most fifty cards; past it the oldest goes", async () => {
  as("frank", [made("big", ["frank/big"], { code: "BGQ222" })]);
  let now = 8_000_000;
  const { d } = deps({ now: () => now });
  for (let i = 0; i < 60; i++) { now += 1; const r = await L.answerAsk(d, ask(`p${i}`, "frank/big")); if (i === 0) assert.equal(r, "waiting"); }
  const w = L.waitingNow(now);
  assert.equal(w.length, 50);
  assert.equal(w[0].login, "p10", "the first ten made way");
});

test("the maker who runs the hub meets their own room by its key: a room they shared by code still lets a friend in", async () => {
  as("frank", [made("mine", ["frank/mine-1"], { gate: "key", hub: "", code: "7HQ3ZM" })]);
  const { d, c } = deps();
  assert.equal(await L.answerAsk(d, ask("marco", "frank/mine-1")), "waiting");
  assert.deepEqual(await L.letIn(d, "mine", "marco", true), { said: ["invited"] });
  assert.deepEqual(c.sent.at(-1), ["room", { to: "marco", repo: "frank/mine-1", in: "invited" }, true]);
});

test("the maker: a room joined by someone's code never lets anyone in, even when its repos name my own repository", async () => {
  // eve registered a code for a room whose repos say frank/secret, gave frank the code, frank joined, eve asks
  as("frank", [room("eves-room", ["frank/secret"], { code: "EVQ2CL" })]);
  const { d, c } = deps();
  assert.equal(await L.answerAsk(d, ask("eve", "frank/secret")), null);
  assert.deepEqual([c.sent, c.invited], [[], []], "nothing said, nobody added, though frank is the repository's admin");
  T.patchTeam({ rooms: T.getTeam().rooms.map((r) => ({ ...r, mine: true })) });   // the same room, made or shared from here
  assert.equal(await L.answerAsk(d, ask("eve", "frank/secret")), "waiting", "now it is mine: eve waits for my press");
});

test("the maker: a room of mine whose repos a patch changes is mine no more, and lets nobody into the new repo", async () => {
  as("frank", [made("bc", ["frank/book-club"])]);
  T.patchTeam({ repos: ["frank/book-club", "frank/secret"] });   // Control's repos field, or a face's edit of the room
  assert.deepEqual([T.getTeam().rooms[0].repos, T.getTeam().rooms[0].mine], [["frank/book-club", "frank/secret"], false]);
  const { d, c } = deps();
  assert.equal(await L.answerAsk(d, ask("eve", "frank/secret")), null);
  assert.equal(await L.answerAsk(d, ask("eve", "frank/book-club")), null, "nor the old one: the hub's word was for the repos it had");
  assert.deepEqual([c.sent, c.invited], [[], []]);
  as("frank", [made("bc2", ["frank/bc-two"])]);
  T.patchTeam({ rooms: T.getTeam().rooms.map((r) => ({ ...r, name: "Renamed" })) });
  assert.equal(T.getTeam().rooms[0].mine, true, "a patch that leaves the repos as they are keeps it");
});

test("the maker: gh failing to say who is admin is tried again at the next ask; a plain no waits ten minutes", async () => {
  as("frank", [made("flaky", ["frank/bc-flaky"])]);
  let admin: () => Promise<string> = async () => { throw new Error("gh: timeout"); };
  const { d, c } = deps({ admin: () => admin() });
  assert.equal(await L.answerAsk(d, ask("marco", "frank/bc-flaky")), null);
  admin = async () => "true";
  assert.equal(await L.answerAsk(d, ask("marco", "frank/bc-flaky")), "waiting");
  assert.deepEqual(await L.letIn(d, "flaky", "marco", true), { said: ["invited"] });
  admin = async () => "false";
  assert.equal(await L.answerAsk(d, ask("isaac", "frank/bc-flaky")), null);
  admin = async () => "true";
  assert.equal(await L.answerAsk(d, ask("isaac", "frank/bc-flaky")), null, "a false is an answer: not asked again for ten minutes");
  assert.equal(c.invited.length, 1);
});

test("the maker: gh fails says no and why; one try a person every eight minutes, less than the friend's ten; my agent may not speak on GitHub says so", async () => {
  as("frank", [made("book-club", ["frank/bc-3"])]);
  let now = 9_000_000;
  const { d, c } = deps({ now: () => now, invite: async () => { throw new Error("gh: Validation Failed (HTTP 422)\nmore"); } });
  assert.equal(await L.answerAsk(d, ask("ann", "frank/bc-3")), "waiting");
  assert.deepEqual(await L.letIn(d, "book-club", "ann", true), { said: ["no"] });
  assert.deepEqual(c.sent.at(-1), ["room", { to: "ann", repo: "frank/bc-3", in: "no", why: "gh: Validation Failed (HTTP 422)" }, true]);
  now += 7 * 60_000;
  assert.equal(await L.answerAsk(d, ask("ann", "frank/bc-3")), null, "a looping ask never hammers GitHub");
  assert.equal(c.invited.length, 1);
  now += 60_000;
  assert.equal(await L.answerAsk(d, ask("ann", "frank/bc-3")), "no", "eight minutes on: the friend's next ask, ten on, is answered");
  assert.equal(c.invited.length, 2);
  T.patchTeam({ speak: { github: false } });
  assert.equal(await L.answerAsk(d, ask("bob", "frank/bc-3")), "no");
  assert.deepEqual(c.sent.at(-1), ["room", { to: "bob", repo: "frank/bc-3", in: "no", why: "my agent may not speak on GitHub" }, true]);
  assert.equal(c.invited.length, 2, "nobody added");
  T.patchTeam({ speak: { github: true } });
});

// ---- the friend hears ----
test("the friend: invited takes the matching invitation, clones into the rooms folder, keeps the folder, says it", async () => {
  as("marco", [room("book-club", ["frank/book-club"])]);
  const { d, c } = deps({ invitations: [{ id: 7, repo: "other/x" }, { id: 9, repo: "Frank/Book-Club" }], canWrite: () => true,
    git: async (args) => { mkdirSync(join(args.at(-1)!, ".git"), { recursive: true }); return ""; } });
  await L.hearRoom(d, answer("marco", "frank/book-club", "invited"));
  assert.deepEqual(c.accepted, [9]);
  const dir = join(ROOMS, "book-club");
  assert.deepEqual(c.git, [[cloneArgs("frank/book-club", dir), ROOMS]]);
  assert.equal(T.getTeam().rooms[0].folder, dir);
  assert.equal(T.getTeam().rooms[0].code, "BKQ2CL", "the rest of the room as it was");
  assert.deepEqual(c.said, [["in Book Club", "frank/book-club"]]);
  assert.equal(c.reread, 1, "the board and the shared things read again");
  // the room has its folder on disk now: another answer clones nothing
  await L.hearRoom(d, answer("marco", "frank/book-club", "already"));
  assert.equal(c.git.length, 1);
});

test("the friend: already clones only; no says why and nothing else; an answer to someone else, or for no room of mine: nothing", async () => {
  as("marco", [room("chess", ["frank/chess"]), room("go", ["frank/go"], { code: "GXQ2CL" })]);
  const { d, c } = deps({ canWrite: () => true });
  await L.hearRoom(d, answer("Marco", "frank/chess", "already"));
  assert.deepEqual(c.accepted, []);
  assert.deepEqual(c.git.map(([a]) => a.at(-2)), ["https://github.com/frank/chess.git"]);
  c.said.length = 0;
  as("marco", T.getTeam().rooms, "go");
  await L.hearRoom(d, answer("marco", "frank/go", "no", { why: "gh: Must have admin rights\n to Repository." }));
  assert.deepEqual(c.said, [["not let into Go", "frank: gh: Must have admin rights to Repository."]], "who said it, since anyone in the room can");
  await L.hearRoom(d, answer("marco", "frank/go", "no", { why: "again" }));
  assert.equal(c.said.length, 1, "one no a room every ten minutes");
  assert.equal(c.git.length, 1);
  await L.hearRoom(d, answer("isaac", "frank/go", "invited"));
  await L.hearRoom(d, answer("marco", "evil/elsewhere", "invited"));
  await L.hearRoom(d, { ...answer("marco", "frank/go", "invited"), from: { login: "marco", agent: true } });
  assert.deepEqual([c.git.length, c.accepted, c.said.length], [1, [], 1], "an answer to someone else, for no room of mine, or from myself");
});

test("the friend: an answer for a repo of a room not in use is dropped (it was not heard in that room)", async () => {
  as("marco", [room("here", ["frank/here"]), room("there", ["frank/there"], { code: "THQ2CL" })]);
  const { d, c } = deps({ canWrite: () => true, invitations: [{ id: 4, repo: "frank/there" }] });
  for (const said of ["invited", "already", "no"]) await L.hearRoom(d, answer("marco", "frank/there", said, { why: "x" }));
  assert.deepEqual([c.accepted, c.git, c.said], [[], [], []]);
  as("marco", T.getTeam().rooms, "there");
  await L.hearRoom(d, answer("marco", "frank/there", "invited"));
  assert.deepEqual(c.accepted, [4], "in use now: taken");
});

test("the friend: invited is always accepted, whatever came first; a clone that failed because I am not in yet waits for nothing", async () => {
  // the reviewer's case: a fake `already` first, a clone that fails 404, then the maker's real `invited`
  as("marco", [room("first", ["frank/first"])]);
  let writable = false, cloneTries = 0;
  const { d, c } = deps({ invitations: [{ id: 21, repo: "frank/first" }], canWrite: () => writable, accept: () => { writable = true; },
    git: async (args) => { cloneTries++; if (cloneTries === 1) { writable = false; throw new Error("remote: Repository not found.\nfatal: repository 'https://github.com/frank/first.git/' not found"); } mkdirSync(join(args.at(-1)!, ".git"), { recursive: true }); return ""; } });
  await L.hearRoom(d, { ...answer("marco", "frank/first", "already"), from: { login: "eve", agent: true } });
  assert.deepEqual(c.git, [], "I cannot write to it: no clone, and nothing throttled");
  writable = true;   // say GitHub said I could, for a moment, and the clone then said 404
  await L.hearRoom(d, { ...answer("marco", "frank/first", "already"), from: { login: "eve", agent: true } });
  assert.equal(c.git.length, 1);
  assert.equal(T.getTeam().rooms[0].folder, "");
  await L.hearRoom(d, answer("marco", "frank/first", "invited"));
  assert.deepEqual(c.accepted, [21], "the invitation taken");
  assert.equal(c.git.length, 2, "and the clone at once: the failed one set no wait, since I could not write to it then");
  assert.equal(T.getTeam().rooms[0].folder, join(ROOMS, "first"));
});

test("the friend: a room of two repos, invited for the second before the first: each accepted, the clone once both are mine to write", async () => {
  as("marco", [room("pair", ["frank/pair-a", "frank/pair-b"])]);
  const ids: Record<number, string> = { 31: "frank/pair-a", 32: "frank/pair-b" };
  const inn = new Set<string>();
  const { d, c } = deps({ invitations: [{ id: 31, repo: "frank/pair-a" }, { id: 32, repo: "frank/pair-b" }], canWrite: (r) => inn.has(r),
    accept: (id) => { inn.add(ids[id]); }, git: async (args) => { mkdirSync(join(args.at(-1)!, ".git"), { recursive: true }); return ""; } });
  await L.hearRoom(d, answer("marco", "frank/pair-b", "invited"));
  assert.deepEqual([c.accepted, c.git], [[32], []], "pair-a is not mine to write yet: nothing cloned");
  await L.hearRoom(d, answer("marco", "frank/pair-a", "invited"));
  assert.deepEqual(c.accepted, [32, 31]);
  assert.deepEqual(c.git, [[cloneArgs("frank/pair-a", join(ROOMS, "pair")), ROOMS]], "the room's first repo, once");
});

test("the friend: answers sent over and over start one clone a room; a second clone while one runs says nothing", async () => {
  as("marco", [room("spam", ["frank/spam"]), room("race", ["frank/race"], { code: "RCQ2CL" })]);
  const { d, c } = deps({ canWrite: () => true });
  for (let i = 0; i < 5; i++) await L.hearRoom(d, answer("marco", "frank/spam", "already"));
  assert.equal(c.git.length, 1, "one clone in ten minutes, however many answers");
  let done = () => {};
  const slow = deps({ git: () => new Promise<string>((ok) => { done = () => ok(""); }) });
  const first = L.cloneRoom(slow.d, "race");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(await L.cloneRoom(slow.d, "race"), { error: "cloning already" });
  assert.deepEqual(slow.c.said, [], "no receipt for it");
  done();
  assert.deepEqual(await first, { folder: join(ROOMS, "race") });
  assert.equal(slow.c.git.length, 1);
});

test("cloneRoom: a folder there with the right origin is reused; one with another gets -2; a clone that fails keeps no folder", async () => {
  as("marco", [room("reuse", ["frank/reuse"]), room("taken", ["frank/taken"]), room("fails", ["frank/fails"])]);
  cloneOf(join(ROOMS, "reuse"), "frank/reuse");
  cloneOf(join(ROOMS, "taken"), "someone/else");
  const { d, c } = deps({ git: async (args) => { if (args.at(-2)!.endsWith("fails.git")) throw new Error("Command failed: git clone\nfatal: could not read Username for 'https://github.com': terminal prompts disabled"); return ""; } });
  assert.deepEqual(await L.cloneRoom(d, "reuse"), { folder: join(ROOMS, "reuse") });
  assert.deepEqual(c.git, [], "reused, not cloned");
  assert.deepEqual(await L.cloneRoom(d, "taken"), { folder: join(ROOMS, "taken-2") });
  assert.equal(c.git[0][0].at(-1), join(ROOMS, "taken-2"));
  const bad = await L.cloneRoom(d, "fails");
  assert.deepEqual(bad, { error: "could not clone frank/fails: fatal: could not read Username for 'https://github.com': terminal prompts disabled" });
  assert.deepEqual(c.said.at(-1), ["could not clone frank/fails: fatal: could not read Username for 'https://github.com': terminal prompts disabled"]);
  assert.deepEqual(T.getTeam().rooms.map((r) => r.folder), [join(ROOMS, "reuse"), join(ROOMS, "taken-2"), ""]);
});

test("a room's folder survives a face's patch: a room sent back with none keeps it", () => {
  as("marco", [room("kept", ["frank/kept"])]);
  T.patchTeam({ rooms: T.getTeam().rooms.map((r) => ({ ...r, folder: "/tmp/somewhere" })) });   // the engine's own patch
  const { folder: _f, ...face } = T.forFace(T.getTeam()).rooms[0];
  T.patchTeam({ rooms: [{ ...face, name: "Kept, renamed" }] });
  assert.deepEqual([T.getTeam().rooms[0].name, T.getTeam().rooms[0].folder], ["Kept, renamed", "/tmp/somewhere"]);
  assert.equal(T.cleanRoom({ repos: ["a/b"], folder: "relative/path" })?.folder, "");
  assert.equal(T.cleanRoom({ repos: ["a/b"], folder: "/" + "x".repeat(500) })?.folder, "");
});

test("make: a room made from a name is mine and cloned in the background; the answer never waits on the clone", async () => {
  const { makeRoom } = await import("../src/team/rooms.ts");
  as("frank", [room("start", ["frank/start"])]);
  const reg = new Registry(join(tmp("sol-relay-"), "relay", "rooms.json"));
  const cloned: string[] = [];
  const md = (clone: (id: string) => Promise<{ folder: string } | { error: string }>) => ({ team: T.getTeam, patch: T.patchTeam, local: reg, fetch: globalThis.fetch,
    token: async () => "", ticket: async () => "", record: () => ({ room: { make: async (name: string) => `frank/${name.toLowerCase().replace(/\s+/g, "-")}` } }) as any, clone });
  const ok = await makeRoom(md(async (id) => { cloned.push(id); return { folder: join(ROOMS, id) }; }), { name: "Night Owls", hub: "" });
  assert.equal("warn" in ok, false);
  assert.equal("room" in ok && ok.room.mine, true, "its repos are my own words");
  assert.deepEqual(cloned, ["night-owls"]);
  const never = await makeRoom(md(() => new Promise(() => {})), { name: "Early Birds", hub: "" });   // a clone that never ends
  assert.equal("room" in never && never.room.repos[0], "frank/early-birds");
  assert.equal("warn" in never, false, "a clone says how it went in its own receipt");
});

// ---- Work starts in the room's folder ----
test("teamFolders: a room's own folder on disk, whose origin is the room's repo, is the repo's folder", async () => {
  const dir = cloneOf(join(tmp("sol-folders-"), "book"), "frank/folders");
  as("marco", [room("folders", ["frank/folders"], { folder: join(ROOMS, "not-there") })]);
  assert.equal((await teamFolders())["frank/folders"], undefined, "a folder that is gone is no folder");
  T.patchTeam({ rooms: T.getTeam().rooms.map((r) => ({ ...r, folder: dir })) });
  assert.equal((await teamFolders())["frank/folders"], dir);
  const wrong = cloneOf(join(tmp("sol-folders-"), "wrong"), "frank/elsewhere");
  T.patchTeam({ rooms: T.getTeam().rooms.map((r) => ({ ...r, folder: wrong })) });
  assert.equal((await teamFolders())["frank/folders"], undefined, "a folder whose origin is another repo is not the room's");
});

test("teamFolders: the checkout a person works in wins over a room's clone of the same repo", async () => {
  const checkout = join(import.meta.dirname, "..", "..", "..");   // this engine's own checkout, as teamFolders finds it
  const own = L.repoOfUrl(git(checkout, "remote", "get-url", "origin"));
  if (!own) return;   // a checkout with no GitHub origin: nothing to compare
  const clone = cloneOf(join(tmp("sol-folders-"), "clone"), own);
  as("marco", [room("own", [own], { folder: clone })]);
  assert.equal((await teamFolders())[own], checkout);
});

// ---- the hub ----
const fake = () => { const got: any[] = []; return { got, send: (l: string) => got.push(JSON.parse(l)) }; };
const hello = (login: string, code: string) => JSON.stringify({ kind: "hello", from: { login, agent: false }, at: 1, machine: "m", state: "here", room: code });
const said = (m: object) => JSON.stringify({ kind: "room", from: { login: "x", agent: true }, at: 1, ...m });

test("the hub: a room word with a `to` reaches that person only and is kept for them; one without reaches the room and is never kept", () => {
  const reg = new Registry(join(tmp("sol-relay-"), "relay", "rooms.json"), () => 1, () => "AAAAAA");
  reg.register({ name: "Book Club", provider: "github", org: "", repos: ["frank/book-club"] }, "frank");
  for (const p of ["frank", "marco", "isaac"]) reg.saw("AAAAAA", p, 2);
  const sp = new Spool(join(tmp("sol-relay-"), "spool"));
  const hub = new RelayHub({ spool: sp, registry: reg });
  const f = fake(), m = fake(), other = fake();
  hub.join(f); hub.message(f, hello("frank", "AAAAAA"));
  hub.join(m); hub.message(m, hello("marco", "AAAAAA"));
  hub.join(other); hub.message(other, hello("marco", ""));   // marco's other Sol, in the common space
  const n = other.got.length;
  hub.message(m, said({ want: "in", repo: "frank/book-club" }));
  assert.deepEqual(f.got.at(-1), { kind: "room", from: { login: "marco", agent: true }, at: f.got.at(-1).at, want: "in", repo: "frank/book-club" }, "stamped by the hub");
  assert.deepEqual(sp.peek("isaac"), [], "an ask is never kept: its Sol asks again on connect and every ten minutes");
  const before = sp.peek("isaac").length;
  hub.message(f, said({ to: "marco", repo: "frank/book-club", in: "invited" }));
  assert.equal(m.got.at(-1).in, "invited");
  assert.equal(other.got.length, n, "never into another room");
  assert.equal(sp.peek("isaac").length, before, "an answer is not kept for anyone else");
  hub.leave(m);
  hub.message(f, said({ to: "marco", repo: "frank/book-club", in: "already" }));
  assert.deepEqual(sp.peek("marco").map((x) => [x.in, (x as RelayMsg & { room: string }).room]), [["already", "AAAAAA"]], "kept for marco, with its room");
  hub.message(f, said({ to: "eve", repo: "frank/book-club", in: "invited" }));
  assert.equal(sp.peek("eve").length, 0, "the spool is no way to reach anyone not of the room");
  const m2 = fake();
  hub.join(m2); hub.message(m2, hello("marco", "AAAAAA"));
  assert.deepEqual(m2.got.find((x) => x.kind === "spooled").messages.map((x: RelayMsg) => x.in), ["already"]);
});

test("the hub: a register by the key alone is by nobody, whatever the body says (share again trusts the hub's same code)", async () => {
  const reg = new Registry(join(tmp("sol-relay-"), "relay", "rooms.json"));
  const http = createServer();
  const routes = relayRoutes(0, () => "k", reg, {});
  http.on("request", (req, res) => void routes(req, res));
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  try {
    const r = await fetch(`http://127.0.0.1:${(http.address() as AddressInfo).port}/relay/rooms?key=k`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Forged", provider: "github", org: "", repos: ["frank/forged"], by: "frank" }) });
    assert.equal(r.status, 200);
    const { code } = await r.json() as { code: string };
    assert.equal(reg.lookup(code)?.by, "", "never the body's by");
    assert.throws(() => reg.register({ name: "Forged", provider: "github", org: "", repos: ["frank/forged"] }, "frank"), /that name is taken/,
      "frank's register again is not given that code: the room is not his");
  } finally { await new Promise((ok) => http.close(ok)); }
});

// ---- over real sockets ----
test("share: a room whose code this share made is mine; one with a code is mine only when its hub gives me the same code again", async () => {
  const { shareRoom, joinRoom } = await import("../src/team/rooms.ts");
  const reg = new Registry(join(tmp("sol-relay-"), "relay", "rooms.json"));
  const eves = reg.register({ name: "Secret Room", provider: "github", org: "", repos: ["frank/secret"] }, "eve").code;
  const before = reg.register({ name: "Old Room", provider: "github", org: "", repos: ["frank/old"] }, "frank").code;
  as("frank", [room("fresh", ["frank/fresh"], { hub: "", code: "", gate: "key", joined: false }), room("old-room", ["frank/old"], { name: "Old Room", hub: "", code: before, gate: "key", joined: false })]);
  const offline = (async () => { throw new Error("no network in a test"); }) as unknown as typeof fetch;   // the shared hub is not asked
  const rd = { team: T.getTeam, patch: T.patchTeam, local: reg, fetch: offline, token: async () => "", ticket: async () => "", record: () => ({}) as any };
  const mine = (id: string) => T.getTeam().rooms.find((r) => r.id === id)?.mine;
  assert.deepEqual(await shareRoom(rd, "fresh"), { code: T.getTeam().rooms[0].code });
  assert.equal(mine("fresh"), true, "registered by this share");
  assert.equal(mine("old-room"), false, "a room from before #162 on disk");
  assert.deepEqual(await shareRoom(rd, "old-room"), { code: before });
  assert.equal(mine("old-room"), true, "the hub gave me the same code: I registered it");
  const joined = await joinRoom(rd, eves);
  assert.ok("room" in joined && joined.room.mine === false && joined.room.joined === true, "a room joined by a code is never mine, and is joined");
  assert.deepEqual(await shareRoom(rd, "room" in joined ? joined.room.id : ""), { code: eves }, "sharing it on still gives its code");
  assert.equal(mine("room" in joined ? joined.room.id : ""), false, "but not as mine: the hub says that name is eve's");
  assert.equal(reg.all().length, 3, "and nothing new is registered");
});

test("share again: at start and on each connect, a coded room not mine, not joined, with no org is registered again once a run", async () => {
  const reg = new Registry(join(tmp("sol-relay-"), "relay", "rooms.json"));
  const old = reg.register({ name: "Old", provider: "github", org: "", repos: ["frank/again-old"] }, "frank").code;
  const eves = reg.register({ name: "Taken", provider: "github", org: "", repos: ["eve/taken"] }, "eve").code;
  const mineToo = reg.register({ name: "Mine Too", provider: "github", org: "", repos: ["frank/again-joined"] }, "frank").code;
  const here = { hub: "", gate: "key", joined: false };
  as("frank", [
    room("old", ["frank/again-old"], { ...here, name: "Old", code: old }),
    room("taken", ["frank/taken-here"], { ...here, name: "Taken", code: eves }),
    // a room I joined by its code, though the hub would give me the same code: never registered again, renamed or not
    room("joined", ["frank/again-joined"], { hub: "", gate: "key", name: "Mine Too, renamed", code: mineToo }),
    room("org", ["acme/again-org"], { ...here, org: "acme", code: "ORQ2CL" }),
  ]);
  let registered = 0;
  const local = { register: (r: Parameters<typeof reg.register>[0], by: string) => { registered++; return reg.register(r, by); }, lookup: (c: string) => reg.lookup(c), taken: (n: string) => reg.taken(n) };
  const rd = { team: T.getTeam, patch: T.patchTeam, local, fetch: globalThis.fetch, token: async () => "", ticket: async () => "", record: () => ({}) as any };
  assert.deepEqual(await R.shareAgain(rd), ["old"]);
  assert.equal(registered, 2, "old and taken; never the joined room, never the org room");
  const mine = (id: string) => T.getTeam().rooms.find((r) => r.id === id)?.mine;
  assert.deepEqual(["old", "taken", "joined", "org"].map(mine), [true, false, false, false]);
  assert.equal(reg.all().length, 3, "the hub's answer for taken was that name is taken: nothing new");
  assert.deepEqual(await R.shareAgain(rd), [], "once a run");
  assert.equal(registered, 2);
  // a hub that did not answer is not a try: the next connect registers it again
  let calls = 0;
  const down = (async () => { calls++; throw new Error("offline"); }) as unknown as typeof fetch;
  as("frank", [room("far", ["frank/again-far"], { joined: false, code: "FRQ2CL" })]);
  const fd = { ...rd, fetch: down };
  await R.shareAgain(fd);
  await R.shareAgain(fd);
  assert.equal(calls, 2);
});

test("joined: set by a join, kept by the settings, never by a face; a face that sends it back without one keeps it", () => {
  as("marco", [room("in", ["frank/joined-in"])]);
  assert.equal(T.getTeam().rooms[0].joined, true);
  assert.equal(T.forFace(T.getTeam()).rooms[0].joined, true, "the face sees it");
  const { joined: _j, mine: _m, ...face } = T.forFace(T.getTeam()).rooms[0];
  T.patchTeam({ rooms: [{ ...face, name: "In, renamed" }] });
  assert.deepEqual([T.getTeam().rooms[0].name, T.getTeam().rooms[0].joined], ["In, renamed", true]);
  assert.equal(T.cleanRoom({ repos: ["a/b"], joined: "yes" })?.joined, false, "only true is true");
});

test("forget: a room of mine with a code that a patch took away is forgotten on its hub; a joined one, or one met by a key elsewhere, is not asked", async () => {
  const reg = new Registry(join(tmp("sol-relay-"), "relay", "rooms.json"), () => 1, () => "HEREQ2");
  const here = reg.register({ name: "Here", provider: "github", org: "", repos: ["frank/here"] }, "frank").code;
  const calls: { url: string; method: string; auth: string }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => { calls.push({ url, method: init.method ?? "GET", auth: String((init.headers as any)?.authorization ?? "") }); return new Response("{}", { status: 200 }); }) as typeof fetch;
  const before = T.cleanTeam({ me: { login: "frank" }, rooms: [
    made("here", ["frank/here"], { hub: "", gate: "key", code: here }),
    made("shared", ["frank/shared"], { code: "SHRDQ2" }),
    room("theirs", ["eve/theirs"], { code: "THRSQ2" }),
    made("keyed", ["frank/keyed"], { hub: "wss://kao.example.net/relay", gate: "key", code: "KEYDQ2" }),
    made("stays", ["frank/stays"], { code: "STAYQ2" }),
  ], room: "stays" });
  const after = T.cleanTeam({ me: { login: "frank" }, rooms: [before.rooms.find((r) => r.id === "stays")], room: "stays" });
  const d = { team: () => after, patch: T.patchTeam, local: reg, fetch: f, token: async () => "", ticket: async (hub: string) => `sol1.for ${hub}`, record: () => ({}) as any };
  assert.deepEqual(await R.forgetGone(d, before, after), [here, "SHRDQ2"]);
  assert.equal(reg.lookup(here), null, "this engine's own registry forgot it");
  assert.deepEqual(calls, [{ url: "https://shared.example.net/relay/rooms/SHRDQ2", method: "DELETE", auth: "Bearer sol1.for https://shared.example.net/relay" }], "only my room on a hub that knows me by GitHub; never a joined room's code");
});

test("over real sockets: an ask while the maker is away is not kept, the next one waits for the maker's press and is answered; only the asker hears each answer", async () => {
  const reg = new Registry(join(tmp("sol-relay-"), "relay", "rooms.json"));
  const code = reg.register({ name: "Book Club", provider: "github", org: "", repos: ["frank/book-sock"] }, "frank").code;
  const verify = async (token: string) => ({ "tok-frank": "frank", "tok-marco": "marco", "tok-isaac": "isaac" } as Record<string, string>)[token] ?? null;
  const http = createServer();
  const spool = new Spool(join(tmp("sol-relay-"), "spool"));
  const { upgrade, wss } = relayServer(0, () => "k", new RelayHub({ registry: reg, spool }), { open: () => true, verify });
  http.on("upgrade", upgrade);
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const url = () => `ws://127.0.0.1:${(http.address() as AddressInfo).port}/relay`;
  const until = async (ok: () => boolean) => { const t0 = Date.now(); while (Date.now() - t0 < 5000 && !ok()) await new Promise((r) => setTimeout(r, 30)); };
  const token = (t: string) => async () => ({ authorization: `Bearer ${t}` });
  const client = (who: string) => new RelayClient(url, () => ({ login: who, state: "here" as const, room: code }), who, token(`tok-${who}`));
  const frank = client("frank"), marco = client("marco").start(), isaac = client("isaac").start();
  try {
    await until(() => marco.roster.length === 2);
    const toMarco: RelayMsg[] = [], toIsaac: RelayMsg[] = [];
    marco.on("room", (m) => toMarco.push(m));
    isaac.on("room", (m) => toIsaac.push(m));
    marco.send("room", { want: "in", repo: "frank/book-sock" }, true);   // frank's Sol is not on: nothing is kept for him
    await until(() => toIsaac.length === 1);
    // this engine is frank's: the room in use is the one he made, and he is its repository's admin
    as("frank", [made("book-club", ["frank/book-sock"], { code })]);
    const { d } = deps();
    const answered: Promise<unknown>[] = [];
    const fd: LetInDeps = { ...d, send: (k, p, a) => frank.send(k, p, a) };
    frank.on("room", (m) => { answered.push(L.hearRoom(fd, m)); });
    frank.start();
    await until(() => frank.up && marco.roster.length === 3);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual([answered.length, toMarco.length], [0, 0], "frank's hello brought back no ask");
    marco.send("room", { want: "in", repo: "frank/book-sock" }, true);   // marco's Sol asks again, on its cadence
    await until(() => L.waitingNow(1_000_000).length === 1);
    await Promise.all(answered);
    assert.equal(toMarco.length, 0, "the ask waits on frank's card");
    await L.letIn(fd, "book-club", "marco", true);   // frank presses let in
    await until(() => toMarco.length === 1);
    assert.deepEqual([toMarco[0].in, toMarco[0].to, toMarco[0].from], ["invited", "marco", { login: "frank", agent: true }], "the next ask, answered");
    await until(() => toIsaac.length === 2);
    isaac.send("room", { want: "in", repo: "frank/book-sock" }, true);
    await until(() => L.waitingNow(1_000_000).length === 1);
    await Promise.all(answered);
    await L.letIn(fd, "book-club", "isaac", true);
    await until(() => toIsaac.length === 3);
    await Promise.all(answered);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(toIsaac.map((m) => m.in ?? m.want), ["in", "in", "invited"], "isaac heard marco's two asks and his own answer");
    assert.equal(toMarco.length, 2, "marco heard isaac's ask, never isaac's answer");
    assert.equal(toMarco[1].want, "in");
  } finally {
    for (const c of [frank, marco, isaac]) c.stop();
    for (const c of wss.clients) c.terminate();
    await new Promise((ok) => http.close(ok));
  }
});
