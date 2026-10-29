// Connectors as one answer (#320; the Cowork PRD §9.4, first half): a cloud group's connected repositories (Room.repos on
// a cloud room, connectedRepos), `.sol/connectors.json` through the kit's store, team.connect.repo's checks with a fake
// gh (an admin, a private repository, refused in a GitHub or a Drive group), the one `team.connectors` message, the
// board of a cloud group with and without GitHub here, and the roster's GitHub flag through the hub's sanitizer.
// Nothing here touches GitHub, the cloud or a real team.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HUB = "wss://cloud.example.net/relay";
const FILE = join(mkdtempSync(join(tmpdir(), "sol-team-")), "team.json");
writeFileSync(FILE, JSON.stringify({ me: { login: "frank", name: "Frank" }, rooms: [
  { id: "study", name: "Study", provider: "cloud", hub: HUB, code: "BKQ2CL", mine: true },
  { id: "sol", name: "Sol", repos: ["marcocyl04-ux/sol-dev"] },
], room: "study" }));
process.env.SOL_TEAM = FILE;
process.env.SOL_TEAM_OFFLINE = "1";
process.env.SOL_HUB = HUB;
process.env.SOL_STATE = join(mkdtempSync(join(tmpdir(), "sol-state-")), "work.json");
// the board's gh, faked before board.ts makes its record from it: every call is kept, every answer an empty list
const ghCalls: string[][] = [];
const { runners } = await import("../src/team/record/github.ts");
runners.board = (async (args: string[]) => { ghCalls.push(args); return "[]"; }) as typeof runners.board;
const S = await import("../src/team/settings.ts");
const C = await import("../src/team/connectors.ts");
const B = await import("../src/team/board.ts");
const Ctl = await import("../src/team/control.ts");
const { RelayHub } = await import("../src/team/relay.ts");
const { githubOf } = await import("../src/hub/index.ts");
const { shareRoom, joinRoom } = await import("../src/team/rooms.ts");

const at = "2026-10-28T15:00:00.000Z";
const ghError = (full: string) => Object.assign(new Error(full.split("\n")[0]), { full });
/** a record of many files, as cowork-tools.test.ts has it: a put fails with the next gh word in `fail` */
function fakeRecord(files: Record<string, string> = {}) {
  const on = new Map(Object.entries(files).map(([p, t]) => [p, { text: t, sha: "s0" }]));
  const puts: { path: string; message: string; content: string; sha?: string }[] = [];
  const fail: string[] = [];
  const rec = { files: {
    branch: async () => "main",
    readSha: async (_r: string, path: string) => { const f = on.get(path); if (!f) throw ghError("gh: Not Found (HTTP 404)"); return JSON.stringify({ sha: f.sha, content: Buffer.from(f.text).toString("base64") }); },
    putBody: async (_r: string, path: string, w: { message: string; content: string; sha?: string }) => {
      puts.push({ path, ...w });
      const f = fail.shift() ?? "";
      if (f) throw ghError(f);
      on.set(path, { text: Buffer.from(w.content, "base64").toString("utf8"), sha: `s${puts.length}` });
      return "";
    },
  } } as any;
  return { rec, puts, fail, text: (p: string) => on.get(p)?.text };
}
/** a gh that answers the admin and the visibility of each repository as given; one it does not know is a 404 */
function fakeGh(repos: Record<string, { admin: boolean; vis: string; push?: boolean; name?: string }>) {
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    const name = args[1].replace(/^repos\//, "");
    const r = repos[name];
    if (!r) throw ghError("gh: Not Found (HTTP 404)");
    return JSON.stringify([r.name ?? name, r.vis === "PRIVATE", r.admin, r.push ?? r.admin]) + "\n";
  };
  return { gh, calls };
}
const cloudRoom = (repos: string[] = []) => S.cleanRoom({ id: "study", name: "Study", provider: "cloud", hub: HUB, code: "BKQ2CL", repos, mine: true })!;

// ---- a cloud room's connected repositories ----
test("a cloud room keeps the repositories connected to it: GitHub's shape only, each once, at most ten; its record stays the cloud", () => {
  const many = Array.from({ length: 14 }, (_, i) => `o/r${i}`);
  const r = S.cleanRoom({ id: "study", provider: "cloud", hub: HUB, code: "BKQ2CL", repos: ["o/r", " o/r ", "not a repo", 7, "../x", ...many] })!;
  assert.deepEqual(r.repos, ["o/r", ...many.slice(0, 9)]);
  assert.equal(r.repos.length, S.CONNECTED_MAX);
  assert.equal(S.recordOf(r), "cloud:BKQ2CL", "the record is the cloud's, whatever it connects");
  assert.deepEqual(cloudRoom().repos, [], "none by default");
});

test("connectedRepos: a GitHub room's own repos, a cloud group's connected ones, a Drive room's none", () => {
  assert.deepEqual(S.connectedRepos({ provider: "github", repos: ["o/a", "o/b"] }), ["o/a", "o/b"]);
  assert.deepEqual(S.connectedRepos(cloudRoom(["o/c"])), ["o/c"]);
  assert.deepEqual(S.connectedRepos({ provider: "drive", repos: ["1AbCdEfGhIjKlMnOp"] }), []);
  assert.deepEqual(["o/r", "../x", "o/..", "./r", "o.k/r.s"].filter(S.isRepo), ["o/r", "o.k/r.s"], "no part that is only dots");
});

test("connecting a repository keeps a cloud group mine, a face's edit never writes its repos, and its hub registers none", async () => {
  S.patchTeam({ rooms: S.getTeam().rooms.map((r) => (r.id === "study" ? { ...r, repos: ["o/r"] } : r)) });
  const study = S.getTeam().rooms.find((r) => r.id === "study")!;
  assert.deepEqual([study.repos, study.mine], [["o/r"], true], "a cloud room's repos are not what its hub registered");
  assert.deepEqual(S.getTeam().repos, ["o/r"], "the room in use's repos are the top level's, as for any room");
  // a face sends the rooms back with a cloud room's repos left out (wire.ts drops them): the stored ones stay
  const { repos: _r, ...bare } = study;
  S.patchTeam({ rooms: S.getTeam().rooms.map((r) => (r.id === "study" ? bare : r)) });
  assert.deepEqual(S.getTeam().rooms.find((r) => r.id === "study")!.repos, ["o/r"]);
  // registered again (not mine, not joined): the body names no repository, as the cloud's registry takes a cloud room
  S.patchTeam({ rooms: S.getTeam().rooms.map((r) => (r.id === "study" ? { ...r, mine: false } : r)) });
  const bodies: unknown[] = [];
  const f = (async (_url: string, init: RequestInit = {}) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ code: "BKQ2CL" }), { status: 200 }); }) as typeof fetch;
  await shareRoom({ team: S.getTeam, patch: S.patchTeam, local: null, fetch: f, token: async () => "", ticket: async () => "sol1.t", record: () => ({}) as any, cloudAt: () => true }, "study");
  assert.deepEqual(bodies, [{ name: "Study", provider: "cloud", org: "", repos: [] }]);
  assert.equal(S.getTeam().rooms.find((r) => r.id === "study")!.mine, true, "the same code back: mine again, its repos untouched");
  assert.deepEqual(S.getTeam().rooms.find((r) => r.id === "study")!.repos, ["o/r"]);
  S.patchTeam({ rooms: S.getTeam().rooms.map((r) => (r.id === "study" ? { ...r, repos: [] } : r)) });
});

test("a patch in the words from before rooms never writes a cloud group's repos or org (review P1-1)", () => {
  S.patchTeam({ room: "study" });
  const before = S.getTeam().rooms.find((r) => r.id === "study")!;
  S.patchTeam({ repos: ["evil/x"], org: "evil" });
  const after = S.getTeam().rooms.find((r) => r.id === "study")!;
  assert.deepEqual([after.repos, after.org], [before.repos, ""]);
  assert.deepEqual(S.getTeam().repos, before.repos);
  // a GitHub room in use still takes them, as Control's org field always did
  S.patchTeam({ room: "sol" });
  S.patchTeam({ repos: ["marcocyl04-ux/sol-dev", "o/two"] });
  assert.deepEqual(S.getTeam().rooms.find((r) => r.id === "sol")!.repos, ["marcocyl04-ux/sol-dev", "o/two"]);
  S.patchTeam({ repos: ["marcocyl04-ux/sol-dev"], room: "study" });
});

test("joined by a code: a cloud group takes no repository from the hub's answer (review P1-2)", async () => {
  const f = (async () => new Response(JSON.stringify({ room: { name: "Other", provider: "cloud", org: "", repos: ["evil/x"] } }), { status: 200 })) as typeof fetch;
  const r = await joinRoom({ team: S.getTeam, patch: S.patchTeam, local: null, fetch: f, token: async () => "", ticket: async () => "sol1.t", record: () => ({}) as any, cloudAt: () => true }, "JQWN22");
  assert.ok("room" in r);
  assert.deepEqual([r.room.provider, r.room.repos, r.room.joined], ["cloud", [], true]);
  S.patchTeam({ rooms: S.getTeam().rooms.filter((x) => x.id !== r.room.id), room: "study" });
});

// ---- .sol/connectors.json ----
test("connectors.json: parse keeps what is valid and drops junk, serialize is stable, a newer file is read and not written", () => {
  const f = C.parseConnectors(JSON.stringify({ v: 1, repos: [
    { repo: "o/r", by: "frank‮", at, in: ["marco", "bad login!", "Marco", "isaac"] },
    { repo: "O/R", by: "eve", at },                      // the same repository again
    { repo: "not a repo", by: "eve", at },
    { repo: "../etc", by: "eve", at },
    { repo: "o/two", by: 7, at: "never", in: "marco" },
  ] }));
  assert.deepEqual(f, { v: 1, repos: [{ repo: "o/r", by: "frank", at, in: ["marco", "isaac"] }, { repo: "o/two", by: "", at: "", in: [] }] });
  assert.equal(C.serializeConnectors(C.parseConnectors(C.serializeConnectors(f))), C.serializeConnectors(f), "a round trip is the same text");
  assert.deepEqual(C.parseConnectors("{ not json"), { v: 1, repos: [] });
  assert.equal(C.parseConnectors(JSON.stringify({ v: 2, repos: [] })).newer, true);
});

test("connectors.json: an add is one entry with no one let in yet; the same repository again changes nothing; a remove of one not there says so; ten at most", () => {
  let f = C.parseConnectors("");
  let r = C.applyConnectors(f, { add: { repo: "o/r", by: "frank", at } });
  assert.ok(r.changed && r.message === "connectors: connected o/r");
  assert.deepEqual(r.result!.connected, { repo: "o/r", by: "frank", at, in: [] });
  f = r.file;
  r = C.applyConnectors(f, { add: { repo: "O/R", by: "marco", at } });
  assert.deepEqual([r.changed, r.result!.connected.by], [false, "frank"]);
  assert.equal(C.applyConnectors(f, { remove: { repo: "o/else" } }).error, C.SAY.notHere);
  r = C.applyConnectors(f, { remove: { repo: "O/r" } });
  assert.deepEqual([r.changed, r.file.repos, r.message], [true, [], "connectors: took off o/r"]);
  for (let i = 0; i < 10; i++) f = C.applyConnectors(f, { add: { repo: `o/n${i}`, by: "frank", at } }).file;
  assert.equal(C.applyConnectors(f, { add: { repo: "o/eleven", by: "frank", at } }).error, C.SAY.full);
});

test("connectors.json through the store: compare-and-swap, a conflict read again, `in` written by another kept as read", async () => {
  const m = fakeRecord({ ".sol/connectors.json": C.serializeConnectors({ v: 1, repos: [{ repo: "o/old", by: "marco", at, in: ["isaac"] }] }) });
  C.connectors.forget();
  m.fail.push("gh: sha does not match (HTTP 409)");
  const r = await C.connectors.change({ record: () => m.rec }, "cloud:BKQ2CL", { add: { repo: "o/r", by: "frank", at } });
  assert.ok(!("error" in r) && r.changed);
  assert.equal(m.puts.length, 2, "the conflict was read again and written once more");
  assert.deepEqual(m.puts[1].sha, "s0");
  assert.deepEqual(C.parseConnectors(m.text(".sol/connectors.json")).repos.map((x) => [x.repo, x.in]), [["o/old", ["isaac"]], ["o/r", []]]);
});

// ---- team.connect.repo ----
test("connect: refused in a GitHub group and a Drive group, before GitHub is asked anything", async () => {
  const { gh, calls } = fakeGh({});
  const d = { record: () => fakeRecord().rec, gh, github: async () => true, who: () => "frank" };
  const github = S.cleanRoom({ id: "sol", repos: ["marcocyl04-ux/sol-dev"] })!;
  const drive = S.cleanRoom({ id: "d", provider: "drive", repos: ["1AbCdEfGhIjKlMnOp"] })!;
  assert.deepEqual(await C.connectRepo(d, github, "o/r", true), { error: "this group's record is its repository" });
  assert.deepEqual(await C.connectRepo(d, drive, "o/r", true), { error: C.SAY.drive });
  assert.deepEqual(await C.connectRepo(d, github, "o/r", false), { error: "this group's record is its repository" });
  assert.deepEqual(calls, []);
});

test("connect: GitHub signed in, one gh call says it all, I am its admin and it is private; else one plain line, nothing written (review P2-6)", async () => {
  const { gh, calls } = fakeGh({ "o/mine": { admin: true, vis: "PRIVATE", name: "O/Mine" }, "o/open": { admin: true, vis: "PUBLIC" }, "o/theirs": { admin: false, vis: "PRIVATE" } });
  const m = fakeRecord();
  C.connectors.forget();
  const d = (github = true) => ({ record: () => m.rec, gh, github: async () => github, who: () => "frank", now: () => at });
  const room = cloudRoom();
  assert.deepEqual(await C.connectRepo(d(false), room, "o/mine", true), { error: C.SAY.signin });
  assert.deepEqual(await C.connectRepo(d(), room, "not a repo", true), { error: C.SAY.which });
  assert.deepEqual(await C.connectRepo(d(), room, "o/gone", true), { error: "your GitHub can't see o/gone; check its name, or ask its owner" });
  assert.deepEqual(await C.connectRepo(d(), room, "o/theirs", true), { error: "only an admin of the repository connects it to the group" });
  assert.deepEqual(await C.connectRepo(d(), room, "o/open", true), { error: "build updates need a private repository" });
  assert.equal(m.puts.length, 0, "nothing written on a refusal");
  assert.ok(calls.every((a) => a.join(" ") === `api ${a[1]} --jq [.full_name,.private,.permissions.admin,.permissions.push]`), "one call a check, nothing else");
  // a link pasted for the repository is its owner/name, and GitHub's own spelling is what is kept
  const r = await C.connectRepo(d(), room, "https://github.com/o/mine.git", true);
  assert.ok(!("error" in r));
  assert.deepEqual([r.repos, r.connected, r.changed], [["O/Mine"], { repo: "O/Mine", by: "frank", at, in: [] }, true]);
  assert.equal(m.puts[0].message, "connectors: connected O/Mine");
  assert.equal(C.connectRefusal({ name: "o/x", private: "true" as any, admin: true, push: true }, "o/x", false), C.SAY.public, "private must be true itself");
});

test("connect: a repository the group lists already is mine too with push alone; never a public one (review P1-3)", async () => {
  const { gh } = fakeGh({ "o/shared": { admin: false, push: true, vis: "PRIVATE" }, "o/read": { admin: false, vis: "PRIVATE" } });
  const m = fakeRecord({ ".sol/connectors.json": C.serializeConnectors({ v: 1, repos: [{ repo: "o/shared", by: "marco", at, in: [] }, { repo: "o/read", by: "marco", at, in: [] }] }) });
  C.connectors.forget();
  const d = { record: () => m.rec, gh, github: async () => true, who: () => "frank", now: () => at };
  const r = await C.connectRepo(d, cloudRoom(), "o/shared", true);
  assert.ok(!("error" in r));
  assert.deepEqual([r.repos, r.changed, m.puts.length], [["o/shared"], true, 0], "mine now; the file unchanged");
  assert.deepEqual(await C.connectRepo(d, cloudRoom(), "o/read", true), { error: C.SAY.push });
  assert.equal(C.connectRefusal({ name: "o/p", private: false, admin: true, push: true }, "o/p", true), C.SAY.public);
});

test("connect: two quick connects both stay mine; each answer is applied to my repos as they are when it is written (review P2-4)", async () => {
  const { gh } = fakeGh({ "o/a": { admin: true, vis: "PRIVATE" }, "o/b": { admin: true, vis: "PRIVATE" } });
  const m = fakeRecord();
  C.connectors.forget();
  const d = { record: () => m.rec, gh, github: async () => true, who: () => "frank", now: () => at };
  const room = cloudRoom();   // the room as both asks saw it: no repos
  const a = await C.connectRepo(d, room, "o/a", true), b = await C.connectRepo(d, room, "o/b", true);
  assert.ok(!("error" in a) && !("error" in b));
  let mine: string[] = [];
  mine = C.mineAfter(mine, a);
  mine = C.mineAfter(mine, b);
  assert.deepEqual(mine, ["o/a", "o/b"], "both, whatever the room looked like when each was asked");
  assert.deepEqual(C.mineAfter(mine, { connected: a.connected, off: "mine" }), ["o/b"]);
});

test("take off: an admin takes it off the group; anyone takes it off their own repos with no GitHub at all; the file's read prunes mine (review P2-5)", async () => {
  const { gh, calls } = fakeGh({ "o/mine": { admin: true, vis: "PUBLIC" }, "o/theirs": { admin: false, vis: "PRIVATE" } });
  const m = fakeRecord({ ".sol/connectors.json": C.serializeConnectors({ v: 1, repos: [{ repo: "o/mine", by: "frank", at, in: [] }, { repo: "o/theirs", by: "marco", at, in: [] }] }) });
  C.connectors.forget();
  const d = (github = true, mine: string[] = []) => ({ record: () => m.rec, gh, github: async () => github, who: () => "frank", now: () => at, mine: () => mine });
  const off = await C.connectRepo(d(true, ["o/mine"]), cloudRoom(), "o/mine", false);
  assert.ok(!("error" in off));
  assert.deepEqual([off.repos, off.off, off.file.repos.map((x) => x.repo)], [[], "group", ["o/theirs"]], "an admin of a public one may take it off");
  calls.length = 0;
  const local = await C.connectRepo(d(false, ["o/theirs"]), cloudRoom(), "o/theirs", false);
  assert.ok(!("error" in local));
  assert.deepEqual([local.repos, local.off, local.file.repos.length, calls.length], [[], "mine", 1, 0], "mine only, no gh asked, the group keeps it");
  assert.deepEqual(await C.connectRepo(d(true), cloudRoom(), "o/theirs", false), { error: "only an admin of the repository connects it to the group" });
  assert.deepEqual(C.pruneMine(["O/THEIRS", "o/gone"], m.text(".sol/connectors.json") ? C.parseConnectors(m.text(".sol/connectors.json")) : { v: 1, repos: [] }), ["o/theirs"]);
});

test("connect: my repos are only what my own gh checked, never another entry someone wrote into connectors.json", async () => {
  const { gh } = fakeGh({ "o/mine": { admin: true, vis: "PRIVATE" } });
  const m = fakeRecord({ ".sol/connectors.json": C.serializeConnectors({ v: 1, repos: [{ repo: "evil/x", by: "eve", at, in: [] }] }) });
  C.connectors.forget();
  const d = { record: () => m.rec, gh, github: async () => true, who: () => "frank", now: () => at };
  const r = await C.connectRepo(d, cloudRoom(), "o/mine", true);
  assert.ok(!("error" in r));
  assert.deepEqual(r.file.repos.map((x) => x.repo), ["evil/x", "o/mine"], "the group's file lists both");
  assert.deepEqual(r.repos, ["o/mine"], "my room's repos: the one I checked");
  assert.deepEqual(C.myRepos(["o/mine", "o/gone"], r.file, "o/mine", true), ["o/mine"], "one no longer in the file goes");
  assert.deepEqual(C.myRepos(["o/mine"], r.file, "O/MINE", false), []);
});

// ---- the one answer ----
test("team.connectors: a cloud group's repositories from connectors.json with the member count, the things as team.things says them, the tools, me", () => {
  const file = C.parseConnectors(JSON.stringify({ v: 1, repos: [{ repo: "o/r", by: "frank", at, in: ["marco"] }] }));
  const things = { type: "team.things", rid: "x", repo: "cloud:BKQ2CL", things: [], folders: [] };
  const tools = C.toolLines({
    calendar: { v: 1, events: [{ id: "e1", title: "review", start: "2026-10-30T14:00:00.000Z", allDay: false, who: [], by: "frank", at }, { id: "e0", title: "gone", start: "2026-10-01", allDay: true, who: [], by: "frank", at }] },
    decisions: { text: "", decisions: [{ id: "d1", title: "ship friday", lines: "", by: "marco", at, agent: true }] },
    polls: { v: 1, polls: [{ id: "p1", question: "lunch?", options: ["a", "b"], votes: {}, by: "isaac", at }, { id: "p0", question: "old?", options: ["a", "b"], votes: {}, by: "isaac", at, closed: { by: "isaac", at } }, { id: "p2", question: "dinner?", options: ["a", "b"], votes: {}, by: "isaac", at }] },
  }, Date.parse(at));
  const msg = C.connectorsMsg({ room: cloudRoom(["O/R"]), file, members: 3, things, tools, me: { google: { in: true, email: "f@x.com" }, github: { in: false } }, rid: "r1" });
  assert.deepEqual(msg, {
    type: "team.connectors", rid: "r1",
    repos: [{ repo: "o/r", by: "frank", at, in: ["marco"], members: 3, checked: true }],
    things: { repo: "cloud:BKQ2CL", things: [], folders: [] },
    tools,
    me: { google: { in: true, email: "f@x.com" }, github: { in: false } },
    record: "cloud",
  });
  // review P2-8: a row my own gh did not check carries no `checked`
  assert.equal("checked" in C.connectorsMsg({ room: cloudRoom(), file, members: 3, things, tools, me: msg.me }).repos[0], false);
  // review P2-9: the raw parts the face formats itself (local time; open[0] the newest open poll, as Tools.tsx reads it)
  assert.deepEqual(tools.map((t) => [t.id, t.line, t.read]), [["calendar", "next · 2026-10-30 14:00 · review", true], ["decisions", "1 decided · last by marco's agent", true], ["polls", "2 open · dinner?", true]]);
  const [cal, dec, pol] = tools as any[];
  assert.deepEqual([cal.next.id, dec.count, dec.newest.id, pol.open.map((p: any) => p.id)], ["e1", 1, "d1", ["p2", "p1"]]);
  // a GitHub group's repository is the room itself; a Drive group has none; a room with no record says ""
  assert.deepEqual(C.repoRows({ provider: "github", repos: ["o/a"], code: "" }, null, 2), [{ repo: "o/a", by: "", at: "", in: [], members: 2 }]);
  assert.deepEqual(C.repoRows({ provider: "drive", repos: ["1AbCdEfGhIjKlMnOp"], code: "" }, null, 2), []);
  assert.equal(C.recordKind({ provider: "cloud", repos: [], code: "" }), "");
  assert.deepEqual(C.toolLines({}).map((t) => t.line), ["the room's calendar", "what the room decided", "ask the room"], "not read yet: what each is");
});

test("the member count: the cloud's members for a cloud group, the repository's people for a GitHub group, 0 when unread; cached a minute", async () => {
  C.forgetCounts();
  let asked = 0;
  const cloud = async () => { asked++; return 4; };
  const gh = async (args: string[]) => (args[1] === "repos/o/a/collaborators" ? "marco\nfrank\nisaac\n" : "");
  assert.equal(await C.memberCount({ gh, cloud }, cloudRoom(), 1000), 4);
  assert.equal(await C.memberCount({ gh, cloud }, cloudRoom(), 2000), 4);
  assert.equal(asked, 1, "a minute's cache");
  assert.equal(await C.memberCount({ gh, cloud }, S.cleanRoom({ id: "gh", repos: ["o/a"] })!, 1000), 3);
  assert.equal(await C.memberCount({ gh: async () => { throw new Error("x"); }, cloud }, S.cleanRoom({ id: "gh2", repos: ["o/b"] })!, 1000), 0);
});

// ---- the board of a cloud group ----
test("the board plan: a cloud group's listed repositories with GitHub here; without, none and why; a GitHub room as before", () => {
  assert.deepEqual(B.boardPlan(cloudRoom(), true, ["o/r", "../x"]), { repos: ["o/r"] });
  assert.deepEqual(B.boardPlan(cloudRoom(), false, ["o/r"]), { repos: [], reason: "connect GitHub to see the board" });
  assert.deepEqual(B.boardPlan(cloudRoom(["o/mine"]), true, []), { repos: [] }, "the file lists none: nothing to read, whatever my targets");
  assert.deepEqual(B.boardPlan(cloudRoom(), false), { repos: [] }, "nothing connected: nothing to say");
  assert.deepEqual(B.boardPlan({ provider: "github", repos: ["o/a"] }, false), { repos: ["o/a"] });
  assert.deepEqual(B.boardPlan({ provider: "drive", repos: ["1AbCdEfGhIjKlMnOp"] }, true), { repos: [] });
});

/** connectors.json for the group in use, as the store has it (its 60 s cache), written through a fake record */
async function listInStudy(repos: string[]) {
  const m = fakeRecord();
  C.connectors.forget();
  for (const repo of repos) await C.connectors.change({ record: () => m.rec }, "cloud:BKQ2CL", { add: { repo, by: "marco", at } });
}

test("the board of a cloud group: every repository connectors.json lists, read with my own gh even though I connected none; else empty with the reason and no gh (review P1-3)", async () => {
  S.patchTeam({ room: "study" });
  assert.deepEqual(S.getTeam().rooms.find((r) => r.id === "study")!.repos, [], "not one of my targets");
  await listInStudy(["o/r"]);
  Ctl.noteGithub({ in: false });
  ghCalls.length = 0;
  const off = await B.getBoard(true);
  assert.deepEqual([off.repos, off.cards, off.reason, off.error], [[], [], "connect GitHub to see the board", undefined]);
  assert.equal(await B.boardReason(), "connect GitHub to see the board");
  assert.equal(ghCalls.length, 0, "no gh without GitHub");
  Ctl.noteGithub({ in: true, who: "marco" });
  const on = await B.getBoard(true);
  assert.deepEqual([on.repos, on.reason], [["o/r"], undefined]);
  assert.ok(ghCalls.some((a) => a.some((x) => x.includes("o/r"))), "the listed repository is read with my gh");
  assert.equal(B.peekBoard(), on, "cached as this room's");
  // another room in use is another board: the cache is the room's
  S.patchTeam({ room: "sol" });
  assert.equal(B.peekBoard(), null);
  S.patchTeam({ room: "study" });
  Ctl.noteGithub({ in: false });
  assert.equal(B.peekBoard(), null, "GitHub gone: the board read with it is not this one");
  await listInStudy([]);
});

test("the board never waits forever on GitHub here: offline, nobody has asked yet, the answer is kept and the board says why (review P2-7)", { timeout: 3000 }, async () => {
  S.patchTeam({ room: "study" });
  await listInStudy(["o/r"]);
  Ctl.forgetGithub();
  assert.equal(Ctl.githubState(), null);
  const b = await B.getBoard(true);
  assert.deepEqual([b.repos, b.reason], [[], "connect GitHub to see the board"]);
  assert.deepEqual(Ctl.githubState(), { in: false });
  await listInStudy([]);
});

test("GitHub here: an answer kept a minute, told to onGithub only when it changes", () => {
  const heard: boolean[] = [];
  const off = Ctl.onGithub((a) => heard.push(a.in));
  Ctl.noteGithub({ in: true, who: "frank" }, 1);
  Ctl.noteGithub({ in: true, who: "frank" }, 2);
  Ctl.noteGithub({ in: false }, 3);
  off();
  assert.deepEqual(heard, [true, false]);
  assert.deepEqual(Ctl.githubState(), { in: false });
});

// ---- who has GitHub, on the roster ----
const fake = () => { const got: any[] = []; return { got, send: (l: string) => got.push(JSON.parse(l)) }; };
const say = (login: string, kind: string, rest: object = {}) => JSON.stringify({ kind, from: { login, agent: false }, at: 1, ...rest });
const roster = (c: { got: any[] }) => c.got.filter((m) => m.kind === "roster").at(-1)!.roster as any[];

test("the roster's GitHub flag: a boolean only, from the hello and each presence; a login or a token in its place is never carried", (t) => {
  assert.deepEqual([githubOf(true), githubOf(false), githubOf("frank"), githubOf("ghp_x"), githubOf(1), githubOf(undefined)], [true, false, undefined, undefined, undefined, undefined]);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const hub = new RelayHub({ rate: null });
  const a = fake(), b = fake();
  hub.join(a); hub.message(a, say("frank", "hello", { machine: "mac", github: true }));
  hub.join(b); hub.message(b, say("marco", "hello", { machine: "nuc", github: "marco-gh" }));
  assert.equal(roster(b).find((e) => e.who === "frank").github, true);
  assert.equal("github" in roster(b).find((e) => e.who === "marco"), false, "a word that is not a boolean: none");
  hub.message(a, say("frank", "presence", { state: "here", github: false }));
  t.mock.timers.tick(1000);
  assert.equal(roster(b).find((e) => e.who === "frank").github, false, "signed out: said as false");
  hub.message(a, say("frank", "presence", { state: "here", github: { login: "frank", token: "ghp_x" } }));
  t.mock.timers.tick(1000);
  const f = roster(b).find((e) => e.who === "frank");
  assert.equal("github" in f, false);
  assert.doesNotMatch(JSON.stringify(b.got), /ghp_x|marco-gh/);
});

test("a row says admin when my own gh's one check said so, kept with my repos; and events when the cloud says its key is live", async () => {
  const { gh, calls } = fakeGh({ "o/a": { admin: true, vis: "PRIVATE" }, "o/p": { admin: false, push: true, vis: "PRIVATE" } });
  const m = fakeRecord({ ".sol/connectors.json": C.serializeConnectors({ v: 1, repos: [{ repo: "o/p", by: "marco", at, in: [] }] }) });
  C.connectors.forget();
  const d = { record: () => m.rec, gh, github: async () => true, who: () => "frank", now: () => at };
  const a = await C.connectRepo(d, cloudRoom(), "o/a", true), p = await C.connectRepo(d, cloudRoom(), "o/p", true);
  assert.ok(!("error" in a) && !("error" in p));
  assert.deepEqual([a.admin, p.admin, calls.length], [true, false, 2], "the same one call a connect makes, nothing more");
  let repos = C.mineAfter(C.mineAfter([], a), p), admins = C.adminsAfter(C.adminsAfter([], C.mineAfter([], a), a), repos, p);
  assert.deepEqual([repos, admins], [["o/a", "o/p"], ["o/a"]], "push alone is mine, never admin");
  repos = C.mineAfter(repos, { connected: a.connected, off: "mine" });
  assert.deepEqual(C.adminsAfter(admins, repos, { connected: a.connected, off: "mine" }), [], "taken off: its admin word goes with it");
  // kept in team.json beside the repos: only ones that are also repos
  const kept = S.cleanRoom({ id: "study", provider: "cloud", hub: HUB, code: "BKQ2CL", repos: ["o/a", "o/p"], admins: ["O/A", "o/gone", 7], mine: true })!;
  assert.deepEqual(kept.admins, ["o/a"]);
  assert.equal("admins" in cloudRoom(["o/a"]), false, "none: no field");
  // the rows: admin only on a row my gh checked; events from the cloud's live keys
  const file = { v: 1 as const, repos: [{ repo: "o/a", by: "frank", at, in: [] }, { repo: "o/p", by: "marco", at, in: [] }, { repo: "o/x", by: "marco", at, in: [] }] };
  const rows = C.repoRows(cloudRoom(["o/a", "o/p"]), file, 2, [], ["o/a", "o/x"], C.liveOf({ keys: [{ repo: "O/P", live: true }, { repo: "o/a", live: false }, { repo: "../x", live: true }, "junk"] }));
  assert.deepEqual(rows.map((r) => [r.repo, r.checked, r.admin, r.events]), [["o/a", true, true, undefined], ["o/p", true, undefined, true], ["o/x", undefined, undefined, undefined]],
    "o/x is in admins but not checked: the file's word alone gives nothing");
  assert.deepEqual([C.liveOf(null), C.liveOf({ keys: "x" })], [[], []]);
});
