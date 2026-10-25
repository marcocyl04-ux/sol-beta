// Together, See (#31): the team settings, the board's columns, the signature, the relay's roster, fan-out and gate,
// and two real engines' clients meeting on one relay. Nothing here touches GitHub or a real team.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

process.env.SOL_TEAM = join(mkdtempSync(join(tmpdir(), "sol-team-")), "team.json");
process.env.SOL_TEAM_OFFLINE = "1";
process.env.SOL_STATE = join(mkdtempSync(join(tmpdir(), "sol-state-")), "work.json");   // Work's marks, never the real ones
const { cleanTeam, mergeTeam, signature, forFace, TEAM_DEFAULTS, THIS_MACHINE, defaultMachines } = await import("../src/team/settings.ts");
const { columns, refs, branchRefs, agentMark, domainOf, memberLog } = await import("../src/team/board.ts");
const { RelayHub, relayGate, relayServer, RelayClient, presenceOf, sessionOf } = await import("../src/team/relay.ts");
type Issue = import("../src/team/board.ts").Issue;
type PR = import("../src/team/board.ts").PR;

// ---- settings ----
test("team settings: defaults, cleaning and merging", () => {
  const d = cleanTeam(undefined);
  // no rows on disk and no relay: this Mac alone (Control, #169); no rooms: one, "team", of the default repo (#154)
  const team = { id: "team", name: "sol-dev", provider: "github", org: "", repos: TEAM_DEFAULTS.repos, hub: "", key: "", code: "", gate: "key", folder: "", mine: false, joined: false };
  assert.deepEqual(d, { ...TEAM_DEFAULTS, machines: [THIS_MACHINE], rooms: [team], room: "team" });
  const s = cleanTeam({ me: { login: "frank", name: " Frank " }, repos: ["a/b", "nope", "a/b"], relay: { url: "http://x" }, speak: { discord: "loud" }, seats: { life: "claude" }, extra: 1 });
  assert.equal(s.me.name, "Frank");
  assert.deepEqual(s.repos, ["a/b"]);
  assert.equal(s.relay.url, "");                  // not a ws url
  assert.equal(s.speak.discord, "builds");
  assert.equal(s.seats.life, "claude");
  assert.equal("extra" in s, false);
  // a bare merge does not translate the old words into the active room (patchTeam does, #154): repos go by the room
  const m = cleanTeam(mergeTeam(s, { speak: { whatsapp: true }, rooms: [{ id: "cd", repos: ["c/d"] }] }));
  assert.equal(m.speak.whatsapp, true);
  assert.equal(m.speak.github, true);             // merged, not replaced
  assert.deepEqual(m.repos, ["c/d"]);             // arrays replace
});

// #169: the far machine comes from the relay's address, never from the code. A team.json on disk today holds the relay
// URL, so Marco's, Frank's and Isaac's Sols dial what they dial today; a Sol with no relay has this machine alone.
test("my machines, absent in the file: this Mac, and the relay's machine when there is a relay", () => {
  assert.deepEqual(defaultMachines(""), [THIS_MACHINE]);
  assert.deepEqual(defaultMachines("wss://nucbox.example.ts.net/relay"), [THIS_MACHINE, { name: "nucbox", url: "wss://nucbox.example.ts.net/" }]);
  assert.deepEqual(defaultMachines("ws://127.0.0.1:7777/relay"), [THIS_MACHINE], "a relay on this machine is no far machine");
  assert.deepEqual(defaultMachines("ws://[::1]:7777/relay"), [THIS_MACHINE], "nor one on this machine's IPv6 address");
  assert.deepEqual(defaultMachines("wss://[fd00::2]:7777/relay"), [THIS_MACHINE, { name: "[fd00::2]", url: "wss://[fd00::2]:7777/" }], "an IPv6 relay keeps its address whole");
  const s = cleanTeam({ relay: { url: "wss://nucbox.example.ts.net/relay" } });
  assert.deepEqual(s.machines.map((m) => m.name), ["this Mac", "nucbox"]);
  assert.equal(s.machines[1].url, "wss://nucbox.example.ts.net/", "the face's LIVE: the relay's host, no path");
  assert.deepEqual(cleanTeam({ relay: { url: "wss://nucbox.example.ts.net/relay" }, machines: [] }).machines, [], "present and empty stays empty");
});

test("the signature: a person, or that person's agent", () => {
  const s = cleanTeam({ me: { login: "marco" } });
  assert.equal(signature(s, false), "marco");
  assert.equal(signature(s, true), "marco's agent");
  // no GitHub (#169): the name stands in
  const n = cleanTeam({ me: { name: "Ada" } });
  assert.equal(signature(n, false), "Ada");
  assert.equal(signature(n, true), "Ada's agent");
});

test("a face never sees the relay key", () => {
  const s = cleanTeam({ relay: { key: "secret-key" } });
  assert.equal(forFace(s).relay.key, "set");
  assert.equal(JSON.stringify(forFace(s)).includes("secret-key"), false);
});

// ---- the board ----
const R = "o/r";
const issue = (number: number, extra: Partial<Issue> = {}): Issue =>
  ({ repo: R, number, title: `issue ${number}`, state: "open", labels: [], assignees: [], author: "marco", created: "2026-10-01T00:00:00Z", url: "", ...extra });
const pr = (number: number, extra: Partial<PR> = {}): PR =>
  ({ repo: R, number, title: `pr ${number}`, body: "", draft: true, state: "open", head: `marco/x${number}`, base: "main", author: "marco", agent: false, url: "", ...extra });

test("refs and branch refs tie a branch or PR to its issue", () => {
  assert.deepEqual(refs("Fixes #31 and Part of #32, #31 again"), [31, 32]);
  assert.deepEqual(branchRefs("marco/31-see"), [31]);
  assert.deepEqual(branchRefs("frank/fix-#7"), [7]);
  assert.deepEqual(branchRefs("marco/together-see"), []);
});

test("columns(): all six columns", () => {
  const issues = [
    issue(1),                                          // nothing names it
    issue(2),                                          // a branch names it
    issue(3),                                          // an open PR's body says Part of #3
    issue(4, { state: "closed" }),                     // merged on main
    issue(5, { state: "closed" }),                     // merged and in stable
    issue(6, { state: "closed" }),                     // closed with nothing merged
  ];
  const prs = [
    pr(10, { body: "Part of #3" }),
    pr(11, { title: "Fixes #4", state: "merged", mergeCommit: "m4", inStable: false }),
    pr(12, { body: "Fixes #5", state: "merged", mergeCommit: "m5", inStable: true }),
  ];
  const branches = [{ repo: R, name: "frank/2-start", sha: "b2" }];
  const by = Object.fromEntries(columns(issues, prs, branches, "s", "m").map((c) => [c.number, c]));
  assert.equal(by[1].column, "waiting");
  assert.equal(by[2].column, "branch");
  assert.equal(by[2].branch, "frank/2-start");
  assert.equal(by[3].column, "pr");
  assert.equal(by[3].pr, 10);
  assert.equal(by[4].column, "main");
  assert.equal(by[5].column, "stable");
  assert.equal(by[6].column, "closed");
});

test("columns(): the furthest tie wins, other repos do not count, the stable head itself is stable", () => {
  const issues = [issue(7), issue(8)];
  const prs = [
    pr(20, { body: "Part of #7" }),
    pr(21, { body: "Part of #7", state: "merged", mergeCommit: "head" }),   // the stable head itself
    pr(22, { repo: "x/y", body: "Fixes #8", state: "merged", mergeCommit: "zz" }),
  ];
  const by = Object.fromEntries(columns(issues, prs, [], "head", "m").map((c) => [c.number, c]));
  assert.equal(by[7].column, "stable");
  assert.equal(by[7].pr, 21);
  assert.equal(by[8].column, "waiting");
});

test("columns(): a closed PR whose branch stays is on a branch; the signature is the PR's", () => {
  const prs = [pr(30, { body: "Part of #9", state: "closed", head: "isaac/try", author: "isaac", agent: true })];
  const [c] = columns([issue(9)], prs, [{ repo: R, name: "isaac/try", sha: "1" }], "", "");
  assert.equal(c.column, "branch");
  assert.deepEqual(c.sign, { login: "isaac", agent: true });
});

test("agentMark: a bot author or a Co-Authored-By Claude commit", () => {
  assert.equal(agentMark("dependabot[bot]"), true);
  assert.equal(agentMark("marco", "fix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"), true);
  assert.equal(agentMark("marco", "fix by hand"), false);
});

test("domainOf: a known domain label, else the first plain one", () => {
  assert.equal(domainOf(["task", "product"]), "product");
  assert.equal(domainOf(["bug", "base"]), "base");
  assert.equal(domainOf(["phase-2", "now"]), "phase-2");
  assert.equal(domainOf(["task"]), undefined);
});

test("memberLog: newest first, only theirs, hand lines found, signatures kept", () => {
  const cards = columns([issue(1, { author: "frank", created: "2026-10-02T00:00:00Z" }), issue(2, { author: "marco" })], [], [], "", "");
  const log = memberLog("frank", { cards, prs: [pr(5, { author: "frank", updated: "2026-10-05T00:00:00Z", agent: true })] },
    [{ repo: R, sha: "a", at: "2026-10-04T00:00:00Z", message: "a commit\n\nCo-Authored-By: Claude" }],
    [{ repo: R, number: 1, at: "2026-10-06T00:00:00Z", author: "frank", body: "**hand** to isaac" }, { repo: R, number: 1, at: "2026-10-07T00:00:00Z", author: "marco", body: "not frank" }]);
  assert.deepEqual(log.map((l) => l.kind), ["hand", "pr", "commit", "issue"]);
  assert.equal(log[1].sign.agent, true);
  assert.equal(log[2].sign.agent, true);
});

// ---- the relay ----
const fake = () => { const got: any[] = []; return { got, send: (l: string) => got.push(JSON.parse(l)) }; };
const hello = (login: string, machine = "mac", state = "here") => JSON.stringify({ kind: "hello", from: { login, agent: false }, at: 0, machine, state });

test("presence: the creature's states said as five, a Work turn's session named, a Life turn's not", () => {
  assert.equal(presenceOf("listening"), "here");
  assert.equal(presenceOf("working"), "working");
  assert.equal(presenceOf("unplugged"), "elsewhere");
  assert.deepEqual(sessionOf({ kind: "work", title: "the board" }, "/x/ecosystem"), { title: "the board", repo: "ecosystem" });
  assert.equal(sessionOf({ kind: "life", title: "private" }), undefined);
  assert.equal(sessionOf(null), undefined);
});

test("relay hub: roster add, update and drop; a newcomer gets the roster", () => {
  const hub = new RelayHub();
  const a = fake(), b = fake();
  hub.join(a); hub.message(a, hello("marco", "nucbox"));
  assert.deepEqual(a.got.at(-1).roster.map((e: any) => e.who), ["marco"]);
  hub.join(b); hub.message(b, hello("frank"));
  assert.equal(b.got.at(-1).kind, "roster");
  assert.deepEqual(b.got.at(-1).roster.map((e: any) => e.who), ["frank", "marco"]);
  assert.deepEqual(a.got.at(-1).roster.map((e: any) => e.who), ["frank", "marco"]);
  hub.message(a, JSON.stringify({ kind: "presence", from: { login: "marco", agent: false }, at: 1, state: "working", session: { title: "the board", repo: "ecosystem" } }));
  const marco = b.got.at(-1).roster.find((e: any) => e.who === "marco");
  assert.equal(marco.state, "working");
  assert.deepEqual(marco.session, { title: "the board", repo: "ecosystem" });
  hub.leave(b);
  assert.deepEqual(a.got.at(-1).roster.map((e: any) => e.who), ["marco"]);
});

test("relay hub: a message fans to the others, not the sender, signed with the hello's login", () => {
  const hub = new RelayHub();
  const a = fake(), b = fake(), c = fake();
  for (const [x, n] of [[a, "marco"], [b, "frank"], [c, "isaac"]] as const) { hub.join(x); hub.message(x, hello(n)); }
  const before = [a.got.length, b.got.length, c.got.length];
  hub.message(a, JSON.stringify({ kind: "changed", from: { login: "isaac", agent: true }, at: 1, repo: "o/r" }));   // tries to speak as isaac
  assert.equal(a.got.length, before[0]);
  assert.equal(b.got.at(-1).kind, "changed");
  assert.deepEqual(b.got.at(-1).from, { login: "marco", agent: true });
  assert.equal(c.got.at(-1).repo, "o/r");
  hub.message(b, JSON.stringify({ kind: "ping", from: { login: "frank", agent: false }, at: 1, to: "isaac", line: "frank asks for an audit" }));
  assert.equal(c.got.at(-1).line, "frank asks for an audit");
  assert.notEqual(a.got.at(-1).kind, "ping");   // a ping goes to its person only
  hub.message(a, JSON.stringify({ kind: "nonsense" }));
  hub.message(a, "not json");
  assert.notEqual(b.got.at(-1).kind, "nonsense");
});

test("relay hub: nothing before hello", () => {
  const hub = new RelayHub();
  const a = fake(), b = fake();
  hub.join(a); hub.join(b); hub.message(b, hello("frank"));
  const n = b.got.length;
  hub.message(a, JSON.stringify({ kind: "changed", repo: "o/r" }));
  assert.equal(b.got.length, n);
});

test("relay gate: the key, and no browser page but Sol's own", () => {
  assert.equal(relayGate("/relay?key=k1", {}, "k1", 7777), true);
  assert.equal(relayGate("/relay?key=k2", {}, "k1", 7777), false);
  assert.equal(relayGate("/relay", {}, "k1", 7777), false);
  assert.equal(relayGate("/relay?key=", {}, "", 7777), false);   // no key set: closed
  assert.equal(relayGate("/relay?key=k1", { origin: "tauri://localhost" }, "k1", 7777), true);
  assert.equal(relayGate("/relay?key=k1", { origin: "https://evil.example" }, "k1", 7777), false);
});

test("the relay over real sockets: a wrong key is refused, a second engine shows in the roster within 5 s", async () => {
  const http = createServer();
  const { upgrade, wss } = relayServer(0, () => "the-key");
  http.on("upgrade", upgrade);
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const port = (http.address() as AddressInfo).port;
  const url = (key: string) => () => `ws://127.0.0.1:${port}/relay?key=${key}`;
  const { WebSocket } = await import("ws");
  const refused = await new Promise<boolean>((ok) => { const w = new WebSocket(url("wrong")()); w.on("open", () => { w.close(); ok(false); }); w.on("error", () => ok(true)); });
  assert.equal(refused, true);
  const one = new RelayClient(url("the-key"), () => ({ login: "marco", state: "here" as const }), "nucbox").start();
  const two = new RelayClient(url("the-key"), () => ({ login: "frank", state: "working" as const, session: { title: "the board", repo: "ecosystem" } }), "legion").start();
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < 5000 && one.roster.length < 2) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(one.roster.map((e) => `${e.who}@${e.machine}:${e.state}`), ["frank@legion:working", "marco@nucbox:here"]);
    const heard = new Promise<any>((ok) => two.on("changed", ok));
    assert.equal(one.send("changed", { repo: "o/r" }), true);
    const m = await heard;
    assert.equal(m.repo, "o/r");
    assert.equal(m.from.login, "marco");
    two.stop();
    const t1 = Date.now();
    while (Date.now() - t1 < 5000 && one.roster.length > 1) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(one.roster.map((e) => e.who), ["marco"]);   // a dropped engine leaves the roster
  } finally {
    one.stop(); two.stop();
    for (const c of wss.clients) c.terminate();
    await new Promise((ok) => http.close(ok));
  }
});

test("presence end to end: a Work job turns my roster entry to working on a teammate's engine, its end turns it back", async () => {
  const http = createServer();
  const { upgrade, wss } = relayServer(0, () => "pk");
  http.on("upgrade", upgrade);
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const port = (http.address() as AddressInfo).port;
  const { patchTeam } = await import("../src/team/settings.ts");
  patchTeam({ me: { login: "marco", name: "Marco" }, relay: { url: `ws://127.0.0.1:${port}/relay`, key: "pk", host: true } });
  const relay = await import("../src/team/relay.ts");
  const { onCreature } = await import("../src/creature.ts");
  const busy = await import("../src/busy.ts");
  const off = onCreature((s, t, cwd) => relay.setPresence(s, t, cwd));   // what wire.ts's startTeam does
  const me = relay.startRelayClient();
  const frank = new RelayClient(() => `ws://127.0.0.1:${port}/relay?key=pk`, () => ({ login: "frank", state: "here" as const }), "legion").start();
  const marco = () => frank.roster.find((e) => e.who === "marco")?.state;
  const until = async (ok: () => boolean) => { const t0 = Date.now(); while (Date.now() - t0 < 5000 && !ok()) await new Promise((r) => setTimeout(r, 50)); };
  try {
    await until(() => !!marco());
    assert.notEqual(marco(), "working");
    const end = busy.join("work", "a-session");
    await until(() => marco() === "working");
    assert.equal(marco(), "working");
    end();
    await until(() => marco() !== "working");
    assert.notEqual(marco(), "working");
  } finally {
    off(); me.stop(); frank.stop();
    for (const c of wss.clients) c.terminate();
    await new Promise((ok) => http.close(ok));
  }
});

test("a session started from Cowork is marked cowork; open in Work clears the mark", async () => {
  const { mark, workState } = await import("../src/work/state.ts");
  mark("a-cowork-session", { mode: "cowork" });
  assert.equal(workState().marks["a-cowork-session"]?.mode, "cowork");
  mark("a-cowork-session", { mode: null });   // "open in Work": the one way across
  assert.equal(workState().marks["a-cowork-session"]?.mode, undefined);
  mark("a-life-one", { mode: "life" });
  assert.equal(workState().marks["a-life-one"]?.mode, "life");
  mark("a-strange-one", { mode: "somewhere" });
  assert.equal(workState().marks["a-strange-one"]?.mode, "work");
});
