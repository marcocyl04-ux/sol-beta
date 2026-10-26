// A person's room sessions, live to the room (#238; the studio PRD §9.6, #189 option 2): a session started under the
// room streams as a `show` with `scope: "room"` while "show my room sessions" is on; the hub rebuilds every show by its
// fields; a room stream's lines go only to its watchers on every hub (the engine's own too), at most two watched a
// person and five lines a second; nothing is posted or kept. The hubs here are in memory; nothing reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";

const { RelayHub, ENGINE_HUB } = await import("../src/team/relay.ts");
const { showOf } = await import("../src/hub/index.ts");
const { Shows, roomShowsWanted, unfence, BACKFILL } = await import("../src/team/show.ts");
const { rosterLines } = await import("../src/team/feed.ts");
const { cleanRoom } = await import("../src/team/settings.ts");
type Deps = import("../src/team/show.ts").ShowDeps;

const fake = () => { const got: any[] = []; return { got, send: (l: string) => got.push(JSON.parse(l)) }; };
const say = (login: string, kind: string, rest: object = {}) => JSON.stringify({ kind, from: { login, agent: false }, at: 1, ...rest });
const shows = (c: { got: any[] }) => c.got.filter((m) => m.kind === "show");
const hubSays = (c: { got: any[] }, what: string) => c.got.filter((m) => m.kind === "hub" && m.say === what);
const roomShow = (event: string, rest: object = {}) => ({ scope: "room", issue: 0, repo: "", session: { id: "s-room-1", title: "the deck" }, event, ...rest });
const line = (text: string, at = 5) => ({ line: { role: "agent", text, at } });

function seat(hub: InstanceType<typeof RelayHub>, who: string, v = 2) {
  const c = fake();
  hub.join(c);
  hub.message(c, say(who, "hello", { machine: `${who}-mac`, room: "", v }));
  return c;
}

test("the hub's sanitizer: a show is rebuilt by its own fields, junk dropped, a room show names no issue", () => {
  const raw = { kind: "show", from: { login: "x", agent: false }, at: 1, ...roomShow("line", line("did it\nnext")), cwd: "/Users/frank/secret", input: { file: "~/.ssh" }, repo: "acme/x", issue: 7, thing: "a1b2c3d4" };
  const s = showOf(raw)!;
  assert.deepEqual(s, { issue: 0, repo: "", session: { id: "s-room-1", title: "the deck" }, event: "line", scope: "room", thing: "a1b2c3d4", line: { role: "agent", text: "did it\nnext", at: 5 } });
  assert.ok(!JSON.stringify(s).includes("secret") && !JSON.stringify(s).includes("ssh"));
  // an issue show (#101) still passes, its issue and repo kept
  assert.equal(showOf({ event: "start", issue: 101, repo: "acme/sol", session: { id: "s1", title: "#101" } })!.issue, 101);
  // nothing that is not a show of either kind
  assert.equal(showOf({ event: "start", issue: 0, session: { id: "s1", title: "t" } }), null, "no issue and not a room's");
  assert.equal(showOf({ ...roomShow("line"), line: { role: "system", text: "x", at: 1 } }), null);
  assert.equal(showOf({ ...roomShow("line"), line: { role: "agent", text: "", at: 1 } }), null);
  assert.equal(showOf({ ...roomShow("start"), session: { id: "../etc", title: "t" } }), null);
  assert.equal(showOf({ ...roomShow("boom") }), null);
  // control and format characters out, the newline kept, the text cut to 400
  assert.equal(showOf({ ...roomShow("line"), line: { role: "agent", text: "a\u0007b‮c\nd", at: 1 } })!.line!.text, "abc\nd");
  assert.equal(showOf({ ...roomShow("line"), line: { role: "agent", text: "x".repeat(900), at: 1 } })!.line!.text.length, 400);
});

for (const [name, opts] of [["the engine's own hub", { ...ENGINE_HUB }], ["the cloud's hub", { rate: null }]] as const) {
  test(`${name}: a room session's start goes to the room, its lines only to who watches it`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    const hub = new RelayHub(opts);
    const frank = seat(hub, "frank"), marco = seat(hub, "marco"), isaac = seat(hub, "isaac");
    hub.message(frank, say("frank", "show", { ...roomShow("start"), cwd: "/Users/frank" }));
    assert.equal(shows(marco).length, 1);
    assert.equal(shows(isaac).length, 1);
    assert.equal(shows(marco)[0].cwd, undefined, "the start rebuilt too");
    hub.message(marco, say("marco", "watch", { login: "frank", session: "s-room-1", on: true }));
    assert.equal(hubSays(marco, "watch").at(-1).ok, true);
    hub.message(frank, say("frank", "show", roomShow("line", line("first"))));
    assert.deepEqual(shows(marco).map((m) => m.line?.text ?? m.event), ["start", "first"]);
    assert.deepEqual(shows(isaac).map((m) => m.event), ["start"], "not watching: no lines");
    // a late watcher gets the tail the hub holds in memory, then the live lines
    hub.message(isaac, say("isaac", "watch", { login: "frank", session: "s-room-1", on: true }));
    assert.deepEqual(shows(isaac).map((m) => m.line?.text ?? m.event), ["start", "first"]);
    // the end to everyone, the watchers let go
    hub.message(frank, say("frank", "show", roomShow("end")));
    assert.equal(shows(marco).at(-1).event, "end");
    assert.equal(shows(isaac).at(-1).event, "end");
  });

  test(`${name}: a person watches two room sessions at once, a room stream runs at five lines a second`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    const hub = new RelayHub(opts);
    const frank = seat(hub, "frank"), marco = seat(hub, "marco");
    for (const id of ["s-a", "s-b", "s-c"]) hub.message(frank, say("frank", "show", { ...roomShow("start"), session: { id, title: id } }));
    for (const id of ["s-a", "s-b", "s-c"]) hub.message(marco, say("marco", "watch", { login: "frank", session: id, on: true }));
    const answers = hubSays(marco, "watch").map((a) => a.ok);
    assert.deepEqual(answers, [true, true, false]);
    assert.match(hubSays(marco, "watch").at(-1).why, /2 AI sessions already/);
    for (let i = 0; i < 12; i++) hub.message(frank, say("frank", "show", { ...roomShow("line", line(`l${i}`)), session: { id: "s-a", title: "s-a" } }));
    assert.equal(shows(marco).filter((m) => m.event === "line").length, 5, "five a second");
    t.mock.timers.tick(1000);
    hub.message(frank, say("frank", "show", { ...roomShow("line", line("later")), session: { id: "s-a", title: "s-a" } }));
    assert.equal(shows(marco).filter((m) => m.event === "line").at(-1).line.text, "later");
  });

  test(`${name}: a watch asked before the start (a hub that restarted) gets the lines; a late hello hears the start`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    const hub = new RelayHub(opts);
    const frank = seat(hub, "frank"), marco = seat(hub, "marco");
    hub.message(marco, say("marco", "watch", { login: "frank", session: "s-room-1", on: true }));
    hub.message(frank, say("frank", "show", roomShow("start")));   // its engine says start again on its reconnect
    hub.message(frank, say("frank", "show", roomShow("line", line("back"))));
    assert.equal(shows(marco).at(-1).line.text, "back");
    const late = seat(hub, "isaac");
    assert.deepEqual(shows(late).map((m) => m.event), ["start"], "a running room session is known to who comes late");
    assert.equal(shows(late)[0].scope, "room");
  });
}

test("the engine's own hub keeps an issue show's old ways: every line to the whole room, a watch is just ok", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const hub = new RelayHub({ ...ENGINE_HUB });
  const frank = seat(hub, "frank"), marco = seat(hub, "marco");
  const issue = { issue: 101, repo: "acme/sol", session: { id: "s1", title: "#101" } };
  hub.message(frank, say("frank", "show", { ...issue, event: "start" }));
  hub.message(marco, say("marco", "watch", { login: "frank", session: "s1", on: true }));
  assert.equal(hubSays(marco, "watch").at(-1).ok, true);
  hub.message(frank, say("frank", "show", { ...issue, event: "line", line: { role: "agent", text: "x", at: 1 }, extra: "dropped" }));
  assert.equal(shows(marco).at(-1).line.text, "x");
  assert.equal(shows(marco).at(-1).extra, undefined);
});

test("a Sol from before watch (v1) never gets a room session's lines", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const hub = new RelayHub({ rate: null, minVersion: 0 });
  const frank = seat(hub, "frank"), old = seat(hub, "oldsol", 1);
  hub.message(frank, say("frank", "show", roomShow("start")));
  hub.message(frank, say("frank", "show", roomShow("line", line("private-ish"))));
  assert.ok(!shows(old).some((m) => m.event === "line"));
});

test("quiet: the roster says it only as true; anything else is not passed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const hub = new RelayHub({ rate: null });
  const frank = fake(), marco = seat(hub, "marco");
  hub.join(frank); hub.message(frank, say("frank", "hello", { machine: "mac", quiet: true }));
  const r = () => marco.got.filter((m) => m.kind === "roster").at(-1).roster.find((e: any) => e.who === "frank");
  assert.equal(r().quiet, true);
  hub.message(frank, say("frank", "presence", { state: "here", quiet: "yes" }));
  t.mock.timers.tick(1000);
  assert.equal(r().quiet, undefined);
});

function engine(login = "frank") {
  const sent: any[] = [], told: any[] = [], calls: string[][] = [];
  let tick: (() => void) | null = null;
  const d: Deps = {
    send: (m) => { sent.push(JSON.parse(JSON.stringify(m))); return true; },
    tell: (m) => told.push(m),
    gh: async (args) => { calls.push(["gh", ...args]); return ""; },
    git: async (args) => { calls.push(["git", ...args]); return ""; },
    login: async () => login, mayGitHub: () => true, now: () => 2_000_000,
    every: (_ms, fn) => { tick = fn; return () => { tick = null; }; },
    home: "/Users/frank",
  };
  return { d, sent, told, calls, tick: () => tick?.() };
}

test("engine: a room show starts with no issue, its last words first, and ends with nothing posted", async () => {
  const f = engine(), s = new Shows(f.d);
  const items = [
    { id: "1", kind: "me", text: "<room-content ab12>\nthe goal\n</room-content ab12>\n\nmake the deck" },
    { id: "2", kind: "tool", name: "Read", input: { file_path: "/Users/frank/x" } },
    { id: "3", kind: "you", text: "Started on /Users/frank/deck.", live: false },
  ];
  await s.startRoom("s-room-1", { cwd: "/Users/frank/Sol/rooms/r", title: "the deck", thing: "a1b2c3d4", items: items as never });
  assert.deepEqual(f.sent[0], { issue: 0, repo: "", session: { id: "s-room-1", title: "the deck" }, scope: "room", thing: "a1b2c3d4", event: "start" });
  for (let i = 0; i < 5; i++) f.tick();
  const lines = f.sent.filter((m) => m.event === "line").map((m) => m.line.text);
  assert.deepEqual(lines, ["make the deck", "Read", "Started on ~/deck."], "the fence out, the home folder as ~");
  assert.deepEqual(s.roomShows(), ["s-room-1"]);
  s.item("s-room-1", { id: "1", kind: "me", text: "again" });   // a line already sent is not sent twice
  s.item("s-room-1", { id: "4", kind: "think", text: "private" });
  f.tick();
  assert.equal(f.sent.filter((m) => m.event === "line").length, 3);
  assert.equal(await s.stop("s-room-1"), "no longer shown to the room");
  assert.equal(f.sent.at(-1).event, "end");
  assert.equal(f.sent.at(-1).scope, "room");
  assert.deepEqual(f.calls, [], "no git, no GitHub");
  assert.deepEqual(s.roomShows(), []);
});

test("engine: the backfill is the last BACKFILL lines; a room change while starting sends nothing", async () => {
  const f = engine(), s = new Shows(f.d);
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, kind: "me", text: `w${i}` }));
  await s.startRoom("s1", { cwd: "/r", title: "t", items: items as never });
  for (let i = 0; i < 60; i++) f.tick();
  const text = f.sent.filter((m) => m.event === "line").map((m) => m.line.text).join("\n").split("\n");
  assert.equal(text.length, BACKFILL);
  assert.equal(text[0], `w${40 - BACKFILL}`);
  const g = engine(), t2 = new Shows(g.d);
  await t2.startRoom("s2", { cwd: "/r", title: "t", still: () => false });
  assert.deepEqual(g.sent, []);
  assert.equal(t2.showing("s2"), false);
});

test("engine: a teammate's room show is heard with no issue; a reconnect says my room show's start on any hub", async () => {
  const f = engine(), s = new Shows(f.d);
  s.hear({ from: { login: "marco" }, ...roomShow("start"), thing: "a1b2c3d4" });
  s.hear({ from: { login: "marco" }, ...roomShow("line", line("hi")) });
  assert.deepEqual(s.lines("marco", "s-room-1")!.map((l) => l.text), ["hi"]);
  assert.equal(s.list()[0].scope, "room");
  assert.equal(f.told.at(-1).scope, "room");
  await s.startRoom("mine", { cwd: "/r", title: "mine" });
  await s.start("issue-1", { cwd: "/r", issue: 7, repo: "a/b", title: "#7" });
  f.sent.length = 0;
  s.again(false);   // the engine's own hub: no issue show says start again, a room show does
  assert.deepEqual(f.sent.map((m) => `${m.session.id} ${m.event}`), ["mine start"]);
});

test("which sessions stream: the room's own, none while quiet; Work and Life carry no room mark", () => {
  const runs = [{ id: "a", room: "m1" }, { id: "b", room: "m2" }, { id: "c" }];
  assert.deepEqual(roomShowsWanted(runs, "m1", false), ["a"]);
  assert.deepEqual(roomShowsWanted(runs, "m1", true), []);
  assert.deepEqual(roomShowsWanted(runs, "", false), []);
  assert.equal(unfence("<room-content 0a>\nx\n</room-content 0a>\n\nhello"), "hello");
});

test("the feed says the switch flipped, once, and never for a first sight", () => {
  const was = [{ who: "marco" }], now = [{ who: "marco", quiet: true as const }];
  assert.deepEqual(rosterLines(was, now, "frank", "t").map((l) => l.text), ["stopped showing their sessions in this room"]);
  assert.deepEqual(rosterLines(now, was, "frank", "t").map((l) => l.text), ["shows their sessions in this room again"]);
  assert.deepEqual(rosterLines([], now, "frank", "t"), []);
});

test("a room's setting: quiet kept only as true, on both kinds of room", () => {
  assert.equal(cleanRoom({ id: "r", repos: ["a/b"], quiet: true })!.quiet, true);
  assert.equal(cleanRoom({ id: "r", repos: ["a/b"], quiet: "yes" })!.quiet, undefined);
  assert.equal(cleanRoom({ id: "c", provider: "cloud", code: "9TAWRM", hub: "wss://cloud.matterfold.tech/relay", quiet: true })!.quiet, true);
});

// ---- the review's findings (codex, #238) ----
const { RelayClient, relayServer } = await import("../src/team/relay.ts");
const { createServer } = await import("node:http");
type AddressInfo = import("node:net").AddressInfo;

test("relay end to end: quiet goes out in the hello and in a presence; the other Sol's roster says it within the second", async () => {
  const http = createServer();
  const hub = new RelayHub({ rate: null });
  const { upgrade, wss } = relayServer(0, () => "pk", hub);
  http.on("upgrade", upgrade);
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/relay?key=pk`;
  let mine: any = { login: "frank", state: "here", quiet: true };
  const a = new RelayClient(() => url, () => mine, "mac"), b = new RelayClient(() => url, () => ({ login: "marco", state: "here" }), "nuc");
  const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(f()); };
  const frank = () => b.roster.find((e) => e.who === "frank");
  try {
    a.start(); b.start();
    await until(() => frank()?.quiet === true);                    // the hello said it
    mine = { login: "frank", state: "here", sessions: [{ id: "s-1", title: "the deck" }] };
    a.presence();
    await until(() => !!frank() && !frank()!.quiet && frank()!.sessions?.[0]?.id === "s-1");
    const t0 = Date.now();
    mine = { login: "frank", state: "here", quiet: true };
    a.presence();
    await until(() => frank()?.quiet === true && !frank()!.sessions);
    assert.ok(Date.now() - t0 < 5000, "within 5 s");
  } finally { a.stop(); b.stop(); wss.close(); http.close(); }
});

test("hub: a stream that started as a room's stays one; a line after its end goes to nobody", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  for (const opts of [{ ...ENGINE_HUB }, { rate: null, minVersion: 0 }]) {
    const hub = new RelayHub(opts);
    const frank = seat(hub, "frank"), marco = seat(hub, "marco"), old = seat(hub, "oldsol", 1);
    hub.message(frank, say("frank", "show", roomShow("start")));
    hub.message(marco, say("marco", "watch", { login: "frank", session: "s-room-1", on: true }));
    // a later line that leaves the scope out is still the room's: watchers only, never a Sol from before
    hub.message(frank, say("frank", "show", { issue: 5, repo: "a/b", session: { id: "s-room-1", title: "t" }, event: "line", line: { role: "agent", text: "no scope", at: 1 } }));
    assert.ok(!shows(old).some((m) => m.event === "line"), "not to a v1 Sol");
    assert.equal(shows(marco).at(-1).scope, "room");
    hub.message(frank, say("frank", "show", roomShow("end")));
    const n = shows(marco).length;
    hub.message(frank, say("frank", "show", roomShow("line", line("after the end"))));
    assert.equal(shows(marco).length, n, "nothing after the end");
  }
});

test("engine: a room show that stops drops what was queued; an issue show still sends its last lines", async () => {
  const f = engine(), s = new Shows(f.d);
  await s.startRoom("r1", { cwd: "/r", title: "t" });
  s.item("r1", { id: "a", kind: "me", text: "said just before the switch went off" });
  await s.stop("r1");
  assert.ok(!f.sent.some((m) => m.event === "line"), "queued words of a room show never go after its stop");
  const g = engine(), t2 = new Shows(g.d);
  await t2.start("i1", { cwd: "/r", issue: 7, repo: "a/b", title: "#7" });
  t2.item("i1", { id: "a", kind: "me", text: "last words" });
  await t2.stop("i1");
  assert.ok(g.sent.some((m) => m.event === "line"), "an issue show's queue still goes, as before (#101)");
});

// ---- the fresh review's findings (Opus, #238) ----
test("the engine's own hub: three issue shows watched at once are each ok, as before; its hello says rooms", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const hub = new RelayHub({ ...ENGINE_HUB });
  const frank = seat(hub, "frank"), marco = seat(hub, "marco");
  assert.equal(hubSays(marco, "hello")[0].rooms, true);
  for (const n of [1, 2, 3]) hub.message(frank, say("frank", "show", { issue: n, repo: "a/b", session: { id: `s${n}`, title: `#${n}` }, event: "start" }));
  for (const n of [1, 2, 3]) hub.message(marco, say("marco", "watch", { login: "frank", session: `s${n}`, on: true }));
  assert.deepEqual(hubSays(marco, "watch").map((a) => a.ok), [true, true, true]);
  // and a room session watched after them still gets its lines
  hub.message(frank, say("frank", "show", roomShow("start")));
  hub.message(marco, say("marco", "watch", { login: "frank", session: "s-room-1", on: true }));
  assert.equal(hubSays(marco, "watch").at(-1).ok, true);
  hub.message(frank, say("frank", "show", roomShow("line", line("still"))));
  assert.equal(shows(marco).at(-1).line.text, "still");
});

test("quiet at the hub: no room session of theirs by name", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const hub = new RelayHub({ rate: null });
  const frank = fake(), marco = seat(hub, "marco");
  hub.join(frank); hub.message(frank, say("frank", "hello", { machine: "mac", quiet: true, sessions: [{ id: "s1", title: "private plan" }] }));
  const e = marco.got.filter((m) => m.kind === "roster").at(-1).roster.find((x: any) => x.who === "frank");
  assert.equal(e.quiet, true);
  assert.equal(e.sessions, undefined);
});

test("engine: a room show started again sends none of what was said meanwhile; a reply still coming goes once whole", async () => {
  const f = engine(), s = new Shows(f.d);
  await s.startRoom("r1", { cwd: "/r", title: "t", items: [{ id: "1", kind: "me", text: "hello" }] as never });
  for (let i = 0; i < 3; i++) f.tick();
  await s.stop("r1");   // the switch off
  f.sent.length = 0;
  const later = [{ id: "1", kind: "me", text: "hello" }, { id: "2", kind: "me", text: "something private while off" }, { id: "3", kind: "you", text: "Wor", live: true }];
  await s.startRoom("r1", { cwd: "/r", title: "t", items: later as never });   // the switch on again
  for (let i = 0; i < 5; i++) f.tick();
  assert.deepEqual(f.sent.filter((m) => m.event === "line"), [], "nothing said while off goes");
  s.item("r1", { id: "3", kind: "you", text: "Working on it.", live: false });
  f.tick();
  assert.equal(f.sent.filter((m) => m.event === "line").at(-1).line.text, "Working on it.", "the reply that was coming goes when whole");
});

test("a relay restart forgets what the hub before said of itself (rooms, watch): no room show on a hub not heard yet", async () => {
  const http = createServer();
  const { upgrade, wss } = relayServer(0, () => "pk", new RelayHub({ rate: null }));
  http.on("upgrade", upgrade);
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/relay?key=pk`;
  const a = new RelayClient(() => url, () => ({ login: "frank", state: "here" }), "mac");
  const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(f()); };
  try {
    a.start();
    await until(() => a.info?.rooms === true);
    a.restart();
    assert.equal(a.info, null, "the hub before's word is gone at once");
    await until(() => a.info?.rooms === true);
  } finally { a.stop(); wss.close(); http.close(); }
});
