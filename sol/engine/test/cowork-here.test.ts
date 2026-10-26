// Who is in which thing (#230; the studio PRD §9.2, §9.6): the hub passes a presence's thing and room sessions, exactly
// their fields; the roster carries them; a reconnect says them again; the engine's Here picks the face's or the agent's,
// the most recent, and ends each by the clock; a private turn says no title (#189's condition).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

process.env.SOL_STATE = join(mkdtempSync(join(tmpdir(), "sol-state-")), "work.json");
const { RelayHub, relayServer, RelayClient, sessionOf } = await import("../src/team/relay.ts");
const { thingOf, sessionsOf, SESSIONS_MAX } = await import("../src/hub/index.ts");
const { Here, FocusOrder, LINGER_MS, FRONT_MS, roomSessions, belongs, roomMark, agentIn, here } = await import("../src/team/here.ts");
const { thingsMsg } = await import("../src/team/things.ts");

const fake = () => { const got: any[] = []; return { got, send: (l: string) => got.push(JSON.parse(l)) }; };
const say = (login: string, kind: string, rest: object = {}) => JSON.stringify({ kind, from: { login, agent: false }, at: 1, ...rest });
const roster = (c: { got: any[] }) => c.got.filter((m) => m.kind === "roster").at(-1)!.roster as any[];
const doc = { id: "a1b2c3d4", name: "the PRD", source: "face", at: 1000 };

test("hub: a hello's and a presence's thing and room sessions reach the room's roster, exactly their fields", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const hub = new RelayHub({ rate: null });
  const a = fake(), b = fake();
  hub.join(a); hub.message(a, say("frank", "hello", { machine: "mac", thing: { ...doc, extra: "x", url: "https://evil" }, sessions: [{ id: "s-1", title: "the box", thing: "a1b2c3d4", cwd: "/Users/f" }] }));
  hub.join(b); hub.message(b, say("marco", "hello", { machine: "nuc" }));
  const f = roster(b).find((e) => e.who === "frank");
  assert.deepEqual(f.thing, doc);
  assert.deepEqual(f.sessions, [{ id: "s-1", title: "the box", thing: "a1b2c3d4" }]);
  assert.equal(roster(b).find((e) => e.who === "marco").thing, undefined);
  // a presence says the whole of it: a thing left out is over, a new one replaces it
  hub.message(a, say("frank", "presence", { state: "working", thing: { id: "ffff0000", name: "repo", source: "agent", at: 2000 } }));
  t.mock.timers.tick(1000);
  const f2 = roster(b).find((e) => e.who === "frank");
  assert.deepEqual(f2.thing, { id: "ffff0000", name: "repo", source: "agent", at: 2000 });
  assert.equal(f2.sessions, undefined);
  hub.message(a, say("frank", "presence", { state: "here" }));
  t.mock.timers.tick(1000);
  assert.equal(roster(b).find((e) => e.who === "frank").thing, undefined);
});

test("hub: presence rosters go at most once a second a room, the last change never lost", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 5_000_000 });
  const hub = new RelayHub({ rate: null });
  const a = fake(), b = fake();
  hub.join(a); hub.message(a, say("frank", "hello", { machine: "mac" }));
  hub.join(b); hub.message(b, say("marco", "hello", { machine: "nuc" }));
  const n = () => b.got.filter((m) => m.kind === "roster").length, start = n();
  for (let i = 0; i < 20; i++) hub.message(a, say("frank", "presence", { state: "working", thing: { ...doc, at: 1000 + i } }));
  assert.equal(n(), start + 1);                                  // the first at once
  t.mock.timers.tick(999);
  assert.equal(n(), start + 1);
  t.mock.timers.tick(1);
  assert.equal(n(), start + 2);                                  // the rest as one, the last one's
  assert.equal(roster(b).find((e) => e.who === "frank").thing.at, 1019);
  hub.leave(a);
  assert.equal(roster(b).length, 1);                             // a leave goes at once
});

test("hub: junk in a thing or the sessions is dropped, never passed", () => {
  assert.equal(thingOf({ id: "a b", name: "x", source: "face", at: 1 }), undefined);
  assert.equal(thingOf({ id: "ok", name: "x", source: "someone", at: 1 }), undefined);
  assert.equal(thingOf({ id: "ok", name: "x", source: "face", at: "1" }), undefined);
  assert.equal(thingOf("a1b2c3d4"), undefined);
  assert.deepEqual(thingOf({ id: "ok", name: "a‮b\n" + "y".repeat(100), source: "face", at: 5.5 }), { id: "ok", name: "ab" + "y".repeat(58), source: "face", at: 5 });
  assert.equal(sessionsOf("nope"), undefined);
  assert.equal(sessionsOf([]), undefined);
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, title: `t${i}` }));
  assert.equal(sessionsOf(many)!.length, SESSIONS_MAX);
  assert.deepEqual(sessionsOf([{ id: "s1", title: 3 }, { id: "s1", title: "dup" }, { id: "bad id" }, { id: "s2", title: "x", thing: "no good" }]), [{ id: "s1", title: "" }, { id: "s2", title: "x" }]);
});

test("relay end to end: a reconnect says the thing again; the other Sol's roster has it back", async () => {
  const http = createServer();
  const hub = new RelayHub({ rate: null });
  const { upgrade, wss } = relayServer(0, () => "pk", hub);
  http.on("upgrade", upgrade);
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/relay?key=pk`;
  let mine: any = { login: "frank", state: "here", thing: doc };
  const a = new RelayClient(() => url, () => mine, "mac"), b = new RelayClient(() => url, () => ({ login: "marco", state: "here" }), "nuc");
  const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(f()); };
  const frank = () => b.roster.find((e) => e.who === "frank");
  try {
    a.start(); b.start();
    await until(() => frank()?.thing?.id === doc.id);
    mine = { ...mine, thing: undefined };
    a.presence();
    await until(() => !!frank() && !frank()!.thing);
    mine = { ...mine, thing: { ...doc, at: 3000 }, sessions: [{ id: "s-9", title: "the box" }] };
    a.restart();   // a new connection: its hello carries what I am in
    await until(() => frank()?.thing?.at === 3000 && frank()?.sessions?.[0]?.id === "s-9");
  } finally { a.stop(); b.stop(); wss.close(); http.close(); }
});

test("Here: a face's thing while in front and a minute after; the agent's a minute after each word; the newest wins", () => {
  const h = new Here(), A = {}, B = {};
  assert.equal(h.thing(0), undefined);
  h.focus(A, "d1", "doc", true, 1000);
  assert.deepEqual(h.thing(500_000), { id: "d1", name: "doc", source: "face", at: 1000 });   // in front
  h.said("r1", "repo", "s1", 2000);
  assert.equal(h.thing(2001)!.id, "r1");                                                   // the agent spoke later
  h.focus(A, "d1", "doc", false, 3000);
  assert.equal(h.thing(3001)!.id, "r1");
  h.focus(A, "d2", "sheet", true, 4000);
  assert.equal(h.thing(4001)!.id, "d2");                                                   // the face spoke later
  h.focus(A, "d2", "sheet", false, 5000);
  assert.equal(h.next(5000), 2000 + LINGER_MS);
  assert.equal(h.thing(5000 + LINGER_MS - 1)!.id, "d2");                                   // behind, still a minute
  assert.equal(h.thing(5000 + LINGER_MS), undefined);                                      // both over
  // an agent's thing ends with its session; a blur of another thing, or by another face, changes nothing
  h.said("r1", "repo", "s1", 100_000);
  assert.equal(h.thing(100_001, (x) => x !== "s1"), undefined);
  h.focus(A, "d1", "doc", true, 100_002);
  h.focus(B, "d1", "doc", false, 100_003);
  h.focus(A, "zz", "x", false, 100_004);
  assert.equal(h.thing(100_005)!.id, "d1");
  // a face that went away takes its thing at once; one that died without a word holds it ten minutes at most
  h.drop(A);
  assert.equal(h.thing(100_006)!.id, "r1");
  h.focus(B, "d3", "deck", true, 200_000);
  assert.equal(h.thing(200_000 + FRONT_MS - 1)!.id, "d3");
  h.focus(B, "d3", "deck", true, 200_000 + FRONT_MS - 1);                                  // said again: held on
  assert.equal(h.thing(200_000 + FRONT_MS + 1)!.id, "d3");
  assert.equal(h.thing(200_000 + 2 * FRONT_MS), undefined);
  h.focus(A, "d1", "doc", true, 900_000); h.clear();
  assert.equal(h.thing(900_001), undefined);
});

test("room sessions and titles: only a session started under the room; a private turn says no title (#189)", () => {
  const open = [{ id: "a", room: "shuai", title: "draft", at: 1 }, { id: "b", title: "private" }, { id: "c", room: "other", title: "x" }, { id: "d", room: "shuai", title: "newer", at: 5, thing: "a1b2c3d4" }];
  assert.deepEqual(roomSessions(open, "shuai"), [{ id: "d", title: "newer", thing: "a1b2c3d4" }, { id: "a", title: "draft" }]);
  assert.deepEqual(roomSessions(open, ""), []);
  assert.equal(belongs({ room: "shuai" }, "shuai"), true);
  assert.equal(belongs({}, "shuai"), false);
  assert.equal(belongs(undefined, "shuai"), false);
  assert.equal(belongs({ room: "shuai" }, ""), false);
  // the mark is the room as no other room is: a stranger's room of the same name (the same id) is another mark
  const mine = roomMark({ id: "shuai", provider: "cloud", hub: "wss://cloud.matterfold.tech/relay", code: "ABCDEF" }, "cloud:ABCDEF");
  const theirs = roomMark({ id: "shuai", provider: "cloud", hub: "wss://cloud.matterfold.tech/relay", code: "GHJKLM" }, "cloud:GHJKLM");
  assert.notEqual(mine, theirs);
  assert.equal(mine, roomMark({ id: "shuai", provider: "cloud", hub: "WSS://cloud.matterfold.tech/relay", code: "ABCDEF" }, "cloud:ABCDEF"));
  assert.notEqual(roomMark({ id: "team", provider: "github", hub: "", code: "" }, "a/b"), roomMark({ id: "team", provider: "github", hub: "", code: "" }, "c/d"));
  assert.equal(belongs({ room: mine }, theirs), false);
  assert.equal(sessionOf({ kind: "work", title: "secret plan" }, "/x/y", false), undefined);
  assert.deepEqual(sessionOf({ kind: "work", title: "the board" }, "/x/ecosystem", true), { title: "the board", repo: "ecosystem" });
});

test("team.things' inNow comes from the roster; in_thing refuses an unknown id", () => {
  const file = { v: 1 as const, things: [{ id: "a1b2c3d4", name: "the PRD", url: "https://docs.google.com/document/d/x", kind: "doc" as const, addedBy: "frank", at: "2026-10-26T00:00:00Z" }] };
  const m = thingsMsg(file, null, "o/r", undefined, [{ who: "frank", thing: { id: "a1b2c3d4" } }, { who: "frank", thing: { id: "a1b2c3d4" } }, { who: "marco" }]);
  assert.deepEqual(m.things[0].inNow, ["frank"]);
  assert.match(agentIn(file.things, "nope", "s1"), /no thing nope/);
  assert.match(agentIn([], "nope", "s1"), /no things yet/);
  assert.match(agentIn(file.things, "a1b2c3d4", "s1", 100), /^in the PRD/);
  assert.equal(here.thing(101)!.source, "agent");
  here.clear();
});

// #236: the face opens a thing inside Sol, in its own browser store; the one word it sends about it is team.thing.focus
// { id, focused } (thingView.ts focusMsg, tested in the face). Whatever else a message carried, a cookie included, the
// engine keeps the room's own id and name (wire.ts reads `id` and `focused` only and names the thing from the room's
// list) and the hub passes exactly a thing's fields: no cookie reaches the engine's presence or another Sol.
test("a thing in front says its id and name only; a cookie riding along reaches neither Here nor the roster", () => {
  const h = new Here();
  h.focus("face", "a1b2c3d4", "the PRD", true, 1000);
  assert.deepEqual(Object.keys(h.thing(1000)!).sort(), ["at", "id", "name", "source"]);
  assert.deepEqual(thingOf({ ...doc, cookie: "SID=secret", url: "https://docs.google.com/x" }), doc);
  assert.equal(JSON.stringify(thingOf({ ...doc, name: "the PRD", headers: { cookie: "SID=secret" } })).includes("secret"), false);
});

test("a focus that waited on the room's things is dropped when the face said something after it (#236)", () => {
  const o = new FocusOrder(), face = {}, other = {};
  const focus = o.begin(face);            // in front: waits on the things list
  const blur = o.begin(face);             // behind at once: done first
  assert.equal(o.last(face, blur), true);
  assert.equal(o.last(face, focus), false, "the late focus must not put me back on the tile");
  const theirs = o.begin(other);
  assert.equal(o.last(other, theirs), true, "each face counts its own words");
});
