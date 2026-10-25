// A room shared by a code (#157): the hub's registry (register, look up, who was seen), the open gate for the beta's
// hub, when the client sends its token, rooms kept apart on one hub (and in its spool), share and join with the hubs
// faked, and once over real sockets: an open hub registers a room, answers its code, and keeps two rooms' rosters
// apart. GitHub is a function; the network is a fake fetch or local sockets; the state is a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
process.env.SOL_TEAM = join(tmp("sol-team-"), "team.json");
process.env.SOL_TEAM_OFFLINE = "1";
process.env.SOL_STATE = join(tmp("sol-state-"), "work.json");
process.env.SOL_HOME = tmp("sol-home-");
process.env.SOL_HUB = "wss://shared.example.net/relay";

const { Registry, makeCode, CODE, REGISTRY_MAX, PEOPLE_MAX, PER_MAKER, LONELY } = await import("../src/team/registry.ts");
const { RelayHub, RelayClient, knock, relayServer, relayRoutes, relayAuth, relayUrl } = await import("../src/team/relay.ts");
const { ghVerify } = await import("../src/team/identity.ts");
const { Spool } = await import("../src/team/spool.ts");
const { shareRoom, joinRoom, hubHttp } = await import("../src/team/rooms.ts");
const T = await import("../src/team/settings.ts");
type RelayMsg = import("../src/team/relay.ts").RelayMsg;

const file = () => join(tmp("sol-relay-"), "relay", "rooms.json");
const sol = { name: "Sol", provider: "github", org: "", repos: ["marcocyl04-ux/sol-dev"] };

// ---- the registry ----
test("registry: the same room and maker get the same code; another maker or other repos another", () => {
  let n = 0;
  const codes = ["AAAAAA", "BBBBBB", "CCCCCC"];
  const reg = new Registry(file(), () => 1000, () => codes[n++]);
  const a = reg.register({ ...sol, repos: ["b/two", "a/one"] }, "frank");
  assert.equal(a.code, "AAAAAA");
  assert.deepEqual(a.repos, ["a/one", "b/two"], "sorted");
  assert.deepEqual(a.people, ["frank"]);
  assert.equal(reg.register({ ...sol, name: "Sol again", repos: ["a/one", "b/two"] }, "frank").code, "AAAAAA", "idempotent");
  assert.equal(reg.lookup("AAAAAA")?.name, "Sol again", "the name follows the last register");
  assert.equal(reg.register({ ...sol, name: "Sol for marco", repos: ["a/one", "b/two"] }, "marco").code, "BBBBBB", "another maker");
  assert.equal(reg.register({ ...sol, name: "Sol, one", repos: ["a/one"] }, "frank").code, "CCCCCC", "other repos");
  assert.equal(n, 3);
});

test("registry: a lookup is upper-cased and trimmed, changes nothing, and an unknown code is null", () => {
  const f = file();
  const reg = new Registry(f, () => 5, () => "K7QX2M");
  reg.register(sol, "frank");
  const before = readFileSync(f, "utf8");
  const e = reg.lookup("  k7qx2m ");
  assert.equal(e?.code, "K7QX2M");
  assert.deepEqual(e?.repos, ["marcocyl04-ux/sol-dev"]);
  assert.equal(reg.lookup("ZZZZZZ"), null);
  assert.equal(reg.lookup("nope"), null);
  e!.people.push("eve");
  assert.deepEqual(reg.lookup("K7QX2M")?.people, ["frank"], "a lookup hands a copy");
  assert.equal(readFileSync(f, "utf8"), before);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.equal(new Registry(f).lookup("K7QX2M")?.by, "frank", "kept in the file");
});

test("registry: a bad room throws in plain words", () => {
  const reg = new Registry(file());
  assert.throws(() => reg.register({ ...sol, repos: ["not a repo"] }, "frank"), /a room's repository is owner\/name/);
  assert.throws(() => reg.register({ ...sol, repos: [] }, "frank"), /an org or at least one repository/);
  assert.throws(() => reg.register({ ...sol, org: "bad org!" }, "frank"), /org is a GitHub login/);
  assert.throws(() => reg.register({ ...sol, repos: Array.from({ length: 21 }, (_, i) => `a/r${i}`) }, "frank"), /at most twenty/);
  assert.throws(() => reg.register({ ...sol, provider: "drive", repos: [""] }, "frank"), /folder/);
  assert.throws(() => reg.register(sol, "../evil"), /GitHub login/);
  assert.equal(reg.register({ provider: "drive", repos: ["1AbCdEfG"] }, "").provider, "drive");
  assert.equal(reg.register({ org: "kao-ai", name: "x".repeat(99) }, "frank").name.length, 60);
  assert.equal(reg.all().length, 2);
});

test("registry: five rooms a maker; a full hub drops only a room quiet for 30 days, else it is full (409)", async () => {
  const DAY = 86_400_000;
  let t = 0, n = 0;
  const reg = new Registry(file(), () => t, () => makeCode(() => Uint8Array.from([n >> 25, n >> 20, n >> 15, n >> 10, n >> 5, n++])));
  for (let i = 0; i < PER_MAKER; i++) reg.register({ ...sol, name: `m${i}`, repos: [`a/m${i}`] }, "frank");
  assert.throws(() => reg.register({ ...sol, name: "m-more", repos: ["a/m-more"] }, "Frank"), /at most 5 rooms/);
  assert.equal(reg.register({ ...sol, name: "m0", repos: ["a/m0"] }, "frank").repos[0], "a/m0", "the same room again is no new one");
  for (let i = PER_MAKER; i < REGISTRY_MAX; i++) reg.register({ ...sol, name: `r${i}`, repos: [`a/r${i}`] }, `p${i}`);
  for (const e of reg.all()) reg.saw(e.code, "guest", 0);   // every room has had someone come in: none is lonely
  assert.equal(reg.all().length, REGISTRY_MAX);
  const lately = reg.all().find((e) => e.repos[0] === "a/m0")!.code;
  t = 29 * DAY;
  reg.saw(lately, "marco", t);
  assert.throws(() => reg.register({ ...sol, name: "new", repos: ["a/new"] }, "late"), (e: Error & { status?: number }) => e.message === "the hub is full" && e.status === 409);
  const http = createServer();
  const routes = relayRoutes(0, () => "k", reg, {});
  http.on("request", (req, res) => void routes(req, res));
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  try {
    const r = await fetch(`http://127.0.0.1:${(http.address() as AddressInfo).port}/relay/rooms?key=k`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sol, name: "new", repos: ["a/new"] }) });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: "the hub is full" });
  } finally { await new Promise((ok) => http.close(ok)); }
  t = 31 * DAY;   // every room but one is quiet for 30 days now
  reg.register({ ...sol, name: "new", repos: ["a/new"] }, "late");
  assert.equal(reg.all().length, REGISTRY_MAX);
  assert.ok(reg.lookup(lately), "a room seen lately stays");
  assert.equal(reg.all().some((e) => e.repos[0] === "a/m1"), false, "the quietest, the first of them, went");
});

test("registry: saw() keeps people once each, at most 200, and writes only on news or after a minute", () => {
  const f = file();
  const reg = new Registry(f, () => 0, () => "SAWQQ2");
  const { code } = reg.register(sol, "frank");
  reg.saw(code, "marco", 1000);
  reg.saw(code, "Marco", 2000);
  reg.saw(code, "../x", 3000);
  reg.saw("ZZZZZZ", "marco", 4000);   // a code it does not know: nothing
  assert.deepEqual(reg.lookup(code)?.people, ["frank", "marco"]);
  const a = readFileSync(f, "utf8");
  reg.saw(code, "frank", 50_000);
  assert.equal(readFileSync(f, "utf8"), a, "no one new and seen a moment ago: no write");
  reg.saw(code, "frank", 62_000);
  assert.notEqual(readFileSync(f, "utf8"), a, "a minute on: written");
  for (let i = 0; i < PEOPLE_MAX + 10; i++) reg.saw(code, `p${i}`, 100_000 + i);
  const people = reg.lookup(code)!.people;
  assert.equal(people.length, PEOPLE_MAX);
  assert.equal(people.at(-1), `p${PEOPLE_MAX + 9}`);
  assert.equal(people.includes("frank"), false, "the first to come is dropped first");
});

test("registry: a missing or broken file reads as no rooms", () => {
  assert.deepEqual(new Registry(file()).all(), []);
  const f = file();
  new Registry(f, () => 1, () => "AAAAAA").register(sol, "frank");
  writeFileSync(f, "{ not json");
  assert.deepEqual(new Registry(f).all(), []);
  writeFileSync(f, JSON.stringify([{ code: "0O1I00" }, { code: "BBBBBB", repos: ["a/b"], provider: "github", org: "", name: "b" }, "junk"]));
  assert.deepEqual(new Registry(f).all().map((e) => e.code), ["BBBBBB"]);
});

test("the code's alphabet: 10 000 codes, every one six of 32 symbols, never 0, O, 1 or I", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 10_000; i++) {
    const c = makeCode();
    assert.match(c, CODE);
    assert.doesNotMatch(c, /[0O1I]/);
    for (const ch of c) seen.add(ch);
  }
  assert.equal(seen.size, 32, "every symbol turns up");
  assert.equal(CODE.test("ABCDE0"), false);
  assert.equal(CODE.test("abcdef"), false, "a code is upper-case; the lookup upper-cases what is typed");
});

// ---- the gate ----
const TOKENS: Record<string, string> = { "tok-frank": "frank", "tok-marco": "marco" };
const verify = async (token: string, org: string) => (TOKENS[token] && (org === "" || org === "acme") ? TOKENS[token] : null);

test("the open gate: a GitHub token lets anyone in under GitHub's login; a bad one is refused, not sent to the key", async () => {
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  assert.deepEqual(await knock("/relay", bearer("tok-frank"), "k", "", 7777, verify, true), { login: "frank", open: true }, "a stranger, marked so");
  assert.deepEqual(await knock("/relay?key=k", bearer("tok-frank"), "k", "", 7777, verify, true), { login: "frank" }, "the key too: a teammate, GitHub's login");
  assert.equal(await knock("/relay?key=k", bearer("bad"), "k", "", 7777, verify, true), null, "the key does not rescue a bad token");
  assert.deepEqual(await knock("/relay?key=k", {}, "k", "", 7777, verify, true), { login: "" }, "no token: the key's gate");
  assert.equal(await knock("/relay", {}, "k", "", 7777, verify, true), null);
  assert.equal(await knock("/relay", bearer("tok-frank"), "k", "", 7777, verify, false), null, "not open: a token is no key");
  assert.equal(await knock("/relay", bearer("tok-frank"), "", "", 7777, verify, true), null, "not the host: closed");
  assert.equal(await knock("/relay", { ...bearer("tok-frank"), origin: "https://evil.example" }, "k", "", 7777, verify, true), null);
  assert.deepEqual(await knock("/relay", bearer("tok-marco"), "k", "acme", 7777, verify, true), { login: "marco" }, "an org: its gate, as before");
});

test("ghVerify with no org asks who the token is and nothing more", async () => {
  const calls: string[] = [];
  const gh = async (args: string[], token: string) => {
    calls.push(args.join(" "));
    if (args[1].startsWith("orgs/")) throw new Error("the open gate never asks an org");
    if (!TOKENS[token]) throw new Error("401");
    return `${TOKENS[token]}\n`;
  };
  const v = ghVerify(gh, () => 0);
  assert.equal(await v("tok-frank", ""), "frank");
  assert.equal(await v("tok-frank", ""), "frank");
  assert.deepEqual(calls, ["api user --jq .login"], "cached");
  assert.equal(await v("nope", ""), null);
});

test("relayAuth: a hub's ticket when the room has an org, or meets elsewhere with no key of its own; my token to this machine only; else none", async () => {
  const tok = async () => "tok-frank";
  const tik = async (hub: string) => `sol1.for ${hub}`;
  const bearer = { authorization: "Bearer tok-frank" };
  const gh = (hub: string) => ({ hub, gate: "github" as const }), byKey = (hub: string) => ({ hub, gate: "key" as const });
  assert.deepEqual(await relayAuth("acme", tok, byKey(""), tik), bearer, "an org, on this engine's own hub (this machine)");
  assert.deepEqual(await relayAuth("", tok, gh("wss://shared.example.net/relay"), tik), { authorization: "Bearer sol1.for https://shared.example.net/relay" }, "a room met as GitHub: the hub's ticket, never my token");
  assert.deepEqual(await relayAuth("acme", tok, byKey("wss://acme.example.net/relay"), tik), { authorization: "Bearer sol1.for https://acme.example.net/relay" }, "an org's hub elsewhere: its ticket");
  assert.equal(await relayAuth("acme", tok, byKey("wss://acme.example.net/relay"), async () => ""), null, "an org and no ticket: wait");
  assert.deepEqual(await relayAuth("", tok, byKey("wss://kao.example.net/relay"), tik), {}, "a room met by a key: no token, whatever its key");
  assert.deepEqual(await relayAuth("", tok, byKey(""), tik), {}, "this engine's own hub, by its key");
  assert.deepEqual(await relayAuth("", tok, gh("ws://hub.example.net/relay"), tik), {}, "never a token in the clear");
  assert.deepEqual(await relayAuth("", tok, gh("ws://127.0.0.1:7777/relay"), tik), bearer, "this machine may have it");
  assert.equal(await relayAuth("acme", async () => "", byKey(""), async () => ""), null, "an org and no token: wait");
  assert.deepEqual(await relayAuth("", async () => "", gh("wss://shared.example.net/relay"), async () => ""), {}, "no token: connect anyway");
});

test("relayUrl: a room met by a key carries it; a room met as GitHub never carries a key, not even relay.key", () => {
  T.patchTeam({ relay: { key: "engine-key" }, rooms: [
    { id: "old", repos: ["a/old"], hub: "wss://kao.example.net/relay", key: "", gate: "key" },
    { id: "beta", repos: ["a/beta"], hub: "wss://shared.example.net/relay", gate: "github", code: "BETAQ2" },
  ], room: "old" });
  assert.equal(relayUrl(), "wss://kao.example.net/relay?key=engine-key", "every room from before #157: as it was");
  T.patchTeam({ room: "beta" });
  assert.equal(relayUrl(), "wss://shared.example.net/relay");
});

// ---- the hub keeps rooms apart ----
const fake = () => { const got: any[] = []; return { got, send: (l: string) => got.push(JSON.parse(l)) }; };
const hello = (login: string, room: string) => JSON.stringify({ kind: "hello", from: { login, agent: false }, at: 1, machine: "m", state: "here", room });
const closer = () => { const f = fake(); return { ...f, closed: 0, close() { this.closed++; } }; };
const said = (kind: string, more: object = {}) => JSON.stringify({ kind, from: { login: "x", agent: false }, at: 1, ...more });

// a registry that knows the codes given, in that order
const knowing = (...codes: string[]) => { let n = 0; const reg = new Registry(file(), () => 1, () => codes[n++]); codes.forEach((_, i) => reg.register({ ...sol, name: `k${i}`, repos: [`k/r${i}`] }, "")); return reg; };

test("rooms on one hub: a roster each, a line and a ping stay in their room", () => {
  const hub = new RelayHub({ registry: knowing("AAAAAA", "BBBBBB") });
  const a1 = fake(), a2 = fake(), b = fake(), c = fake();
  hub.join(a1); hub.message(a1, hello("frank", "AAAAAA"));
  hub.join(a2); hub.message(a2, hello("marco", "aaaaaa"));   // the hub upper-cases the code
  hub.join(b); hub.message(b, hello("marco", "BBBBBB"));
  hub.join(c); hub.message(c, hello("isaac", "not a code"));   // the common space
  assert.deepEqual(hub.roster("AAAAAA").map((e) => e.who), ["frank", "marco"]);
  assert.deepEqual(hub.roster("BBBBBB").map((e) => e.who), ["marco"]);
  assert.deepEqual(hub.roster().map((e) => e.who), ["isaac"]);
  assert.deepEqual(a1.got.at(-1).roster.map((e: any) => e.who), ["frank", "marco"]);
  assert.deepEqual(b.got.at(-1).roster.map((e: any) => e.who), ["marco"]);
  assert.equal("room" in a1.got.at(-1).roster[0], false, "the room is never sent");
  const n = [b.got.length, c.got.length];
  hub.message(a1, said("talk", { thread: "general", text: "in A", room: "BBBBBB" }));   // naming another room does nothing
  assert.equal(a2.got.at(-1).text, "in A");
  assert.equal("room" in a2.got.at(-1), false);
  assert.deepEqual([b.got.length, c.got.length], n, "B and the common space never hear A");
  hub.message(a1, said("ping", { to: "marco", line: "a look?" }));
  assert.equal(a2.got.at(-1).line, "a look?");
  assert.equal(b.got.length, n[0], "marco's Sol in B is not pinged from A");
  hub.message(c, said("changed", { repo: "o/r" }));
  assert.notEqual(a1.got.at(-1).kind, "changed");
  hub.leave(a2);
  assert.deepEqual(a1.got.at(-1).roster.map((e: any) => e.who), ["frank"]);
});

test("registry: on a full hub a room only its maker came into makes way after three days, before any other", () => {
  let t = 0, n = 0;
  const reg = new Registry(file(), () => t, () => makeCode(() => Uint8Array.from([n >> 25, n >> 20, n >> 15, n >> 10, n >> 5, n++])));
  for (let i = 0; i < REGISTRY_MAX; i++) reg.register({ ...sol, name: `r${i}`, repos: [`a/r${i}`] }, `p${i}`);
  const used = reg.all().filter((e) => e.repos[0] !== "a/r7");
  for (const e of used) reg.saw(e.code, "guest", 0);   // all but a/r7 had a guest; a/r7 is only its maker's
  t = LONELY - 1;
  assert.throws(() => reg.register({ ...sol, name: "new", repos: ["a/new"] }, "late"), /the hub is full/, "not three days yet");
  t = LONELY + 1;
  reg.register({ ...sol, name: "new", repos: ["a/new"] }, "late");
  assert.ok(!reg.all().some((e) => e.repos[0] === "a/r7"), "the lonely one made way");
  assert.equal(reg.all().length, REGISTRY_MAX);
});

test("a maker forgets their own room over the route, as GitHub knows them; anyone else, or a key holder, cannot", async () => {
  const reg = new Registry(file(), () => 1, () => "FRGTQ2");
  const code = reg.register(sol, "frank").code;
  const http = createServer();
  const routes = relayRoutes(0, () => "k", reg, { open: () => true, verify });
  http.on("request", async (req, res) => { if (!(await routes(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const at = `http://127.0.0.1:${(http.address() as AddressInfo).port}/relay/rooms/${code}`;
  const del = (headers: Record<string, string>, url = at) => fetch(url, { method: "DELETE", headers });
  try {
    assert.equal((await del({}, `${at}?key=k`)).status, 403, "a key holder's word is nobody's");
    assert.equal((await del({ authorization: "Bearer tok-marco" })).status, 404, "not his");
    assert.ok(reg.lookup(code));
    const r = await del({ authorization: "Bearer tok-frank" });
    assert.deepEqual([r.status, await r.json()], [200, { forgotten: true }]);
    assert.equal(reg.lookup(code), null, "its code and its name are free again");
  } finally { await new Promise((ok) => http.close(ok)); }
});

test("a hello with a code the registry does not know closes a key holder too; a connection says hello once", () => {
  const hub = new RelayHub({ registry: knowing("AAAAAA") });
  const k = closer(), a = fake();
  hub.join(a); hub.message(a, hello("frank", "AAAAAA"));
  hub.join(k); hub.message(k, hello("marco", "ZZZZZZ"));
  assert.equal(k.closed, 1, "each guess costs a knock");
  assert.equal(k.got.length, 0);
  assert.deepEqual(hub.roster("ZZZZZZ"), []);
  assert.deepEqual(hub.roster("AAAAAA").map((e) => e.who), ["frank"]);
  const k2 = closer();
  hub.join(k2); hub.message(k2, hello("marco", "AAAAAA"));   // a key holder's word for who it is, trusted as in the common space
  assert.deepEqual(hub.roster("AAAAAA").map((e) => e.who), ["frank", "marco"]);
  hub.message(k2, hello("isaac", "AAAAAA"));   // a second hello on the same connection: another login, or another code
  assert.equal(k2.closed, 1, "a second hello closes");
  assert.deepEqual(hub.roster("AAAAAA").map((e) => e.who), ["frank"]);
  assert.deepEqual(new RelayHub().roster("AAAAAA"), [], "no registry: no coded room at all");
});

test("on a hub that lets strangers in, a coded room is met under a login GitHub vouched for; a key holder's word is closed there", () => {
  const sp = new Spool(join(tmp("sol-relay-"), "spool"));
  const reg = new Registry(file(), () => 1, () => "AAAAAA");
  reg.register(sol, "eve");
  const hub = new RelayHub({ spool: sp, registry: reg, open: () => true });
  const f = fake();
  hub.join(f, "frank", true); hub.message(f, hello("frank", "AAAAAA"));
  hub.message(f, said("ping", { to: "eve", line: "for eve" }));
  const forged = Object.assign(fake(), { closed: 0, close() { this.closed++; } });
  hub.join(forged); hub.message(forged, hello("eve", "AAAAAA"));   // a key holder says it is eve
  assert.equal(forged.closed, 1, "closed: a key holder's word is nobody's name in a coded room here");
  assert.ok(!forged.got.some((m) => m.kind === "spooled"), "nothing of eve's handed to a key holder's word");
  assert.deepEqual(hub.roster("AAAAAA").map((e) => e.who), ["frank"], "and nobody is eve in the roster");
  hub.leave(forged);
  const eve = fake();
  hub.join(eve, "eve", true); hub.message(eve, hello("eve", "AAAAAA"));
  assert.deepEqual(eve.got.find((m) => m.kind === "spooled")?.messages.map((m: any) => m.line), ["for eve"], "kept for the real eve");
});

test("rooms on one hub: the spool keeps a message's room and hands back only that room's on hello", () => {
  const sp = new Spool(join(tmp("sol-relay-"), "spool"));
  const reg = new Registry(file(), () => 1, () => "AAAAAA");
  reg.register(sol, "frank");
  reg.saw("AAAAAA", "isaac", 2);
  reg.saw("AAAAAA", "marco", 3);
  const hub = new RelayHub({ spool: sp, registry: reg, people: () => ["nobody-in-a"] });
  const f = fake(), m = fake();
  hub.join(f); hub.message(f, hello("frank", "AAAAAA"));
  hub.join(m); hub.message(m, hello("frank", ""));
  hub.message(f, said("talk", { thread: "general", text: "for A", id: "t1" }));
  hub.message(f, said("ping", { to: "marco", line: "from A" }));
  hub.message(f, said("ping", { to: "nobody-in-a", line: "the spool is no way to reach anyone" }));
  hub.message(m, said("ping", { to: "marco", line: "from the common space" }));
  assert.deepEqual(sp.peek("isaac").map((x) => [x.kind, (x as RelayMsg & { room: string }).room]), [["talk", "AAAAAA"]], "A's people");
  assert.equal(sp.peek("nobody-in-a").length, 0, "the common space's people are not A's, for a talk or a ping");
  assert.deepEqual(sp.peek("marco").map((x) => x.line ?? x.text), ["for A", "from A", "from the common space"], "marco is one of A's people");
  // marco comes on in the common space: only its ping; A's waits
  const m2 = fake();
  hub.join(m2); hub.message(m2, hello("marco", ""));
  assert.deepEqual(m2.got.find((x) => x.kind === "spooled").messages.map((x: RelayMsg) => x.line), ["from the common space"]);
  assert.deepEqual(sp.peek("marco").map((x) => x.line ?? x.text), ["for A", "from A"]);
  const m3 = fake();
  hub.join(m3); hub.message(m3, hello("marco", "AAAAAA"));
  assert.deepEqual(m3.got.find((x) => x.kind === "spooled").messages.map((x: RelayMsg) => x.line ?? x.text), ["for A", "from A"]);
  assert.equal(sp.peek("marco").length, 0);
  assert.deepEqual(reg.lookup("AAAAAA")?.people, ["frank", "isaac", "marco"], "a hello in A writes them down once");
});

// ---- the security review of #157: the open gate opens coded rooms only ----

test("an open-gate hello with no room, or a code this hub does not know, is refused and closed", () => {
  const sp = new Spool(join(tmp("sol-relay-"), "spool"));
  const reg = new Registry(file(), () => 1, () => "AAAAAA");
  reg.register(sol, "marco");
  const hub = new RelayHub({ spool: sp, registry: reg });
  const k = fake();
  hub.join(k); hub.message(k, hello("marco", ""));   // a key-gated teammate in the common space: as before
  const none = closer(), unknown = closer();
  hub.join(none, "eve", true); hub.message(none, hello("eve", ""));
  hub.join(unknown, "eve", true); hub.message(unknown, hello("eve", "ZZZZZZ"));
  assert.equal(none.closed, 1);
  assert.equal(unknown.closed, 1);
  assert.deepEqual(hub.roster().map((e) => e.who), ["marco"]);
  assert.equal(none.got.length + unknown.got.length, 0, "not even the roster");
  hub.message(k, said("talk", { thread: "general", text: "team only", id: "t9" }));
  assert.equal(sp.peek("eve").length, 0, "nothing of the common space is kept for a stranger");
  assert.deepEqual(sp.seen(), ["marco"], "a stranger is never one of the common space's people");
  // with the code: in, and only in that room
  const coded = closer();
  hub.join(coded, "eve", true); hub.message(coded, hello("eve", "AAAAAA"));
  assert.equal(coded.closed, 0);
  assert.deepEqual(hub.roster("AAAAAA").map((e) => e.who), ["eve"]);
  assert.deepEqual(hub.roster().map((e) => e.who), ["marco"]);
  assert.deepEqual(sp.seen(), ["marco"]);
  hub.message(k, said("talk", { thread: "general", text: "still team only", id: "t10" }));
  assert.equal(coded.got.some((x) => x.kind === "talk"), false);
  assert.deepEqual(reg.lookup("AAAAAA")?.people, ["marco", "eve"]);
});

test("the hub's http calls: a room's own key only, never this engine's; the token over https or to this machine only", async () => {
  T.patchTeam({ relay: { key: "engine-key" }, rooms: [
    { id: "plain", name: "Plain", repos: ["a/plain"], hub: "ws://hub.example.net/relay", gate: "github" },
    { id: "local", name: "Local", repos: ["a/local"], hub: "ws://127.0.0.1:7999/relay", gate: "github" },
  ], room: "plain" });
  const { calls, f } = hubs({
    "http://hub.example.net": () => [403, { error: "refused" }],
    "http://127.0.0.1:7999": () => [200, { code: "LQCALL" }],
  });
  assert.deepEqual(await shareRoom(deps(f), "plain"), { error: "that hub is not https; Sol does not send your GitHub sign-in in the clear" });
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[0].url, "http://hub.example.net/relay/rooms");
  assert.deepEqual(await shareRoom(deps(f), "local"), { code: "LQCALL" });
  assert.equal(calls[1].headers.authorization, "Bearer tok-frank", "this machine: the token may go");
  assert.ok(calls.every((c) => !c.url.includes("engine-key")));
  // a join that only an http hub could answer says why
  const j = hubs({ "http://hub.example.net": () => [403, {}], "https://shared.example.net": () => [404, {}], "http://127.0.0.1:7999": () => [404, {}] });
  assert.deepEqual(await joinRoom(deps(j.f), "ZZZZZZ"), { error: "that hub is not https; Sol does not send your GitHub sign-in in the clear" });
  assert.ok(j.calls.every((c) => !c.url.includes("engine-key")));
});

// ---- share and join ----
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function hubs(answers: Record<string, (c: Call) => [number, unknown]>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c: Call = { url, method: init.method ?? "GET", headers: { ...(init.headers as Record<string, string>) }, body: init.body as string | undefined };
    calls.push(c);
    const base = url.split("?")[0];
    const key = Object.keys(answers).find((k) => base.startsWith(k));
    if (!key) throw new Error("no such host");
    const [status, body] = answers[key](c);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, f };
}
// my token goes to this machine only; every other hub gets its ticket for me (proof.ts), here a fake one naming the hub
// a record that makes nothing: makeRoom's tests give their own
const noRecord = () => ({ room: { make: async (): Promise<string> => { throw new Error("no record in this test"); } } });
const deps = (f: typeof fetch, local: InstanceType<typeof Registry> | null = null, record = noRecord) => ({ team: T.getTeam, patch: T.patchTeam, local, fetch: f, token: async () => "tok-frank", ticket: async (hub: string) => `sol1.for ${hub}`, record });

test("hubHttp: the socket's address as http, the path kept, /relay when there is none", () => {
  assert.equal(hubHttp("wss://nucbox.example.net/relay"), "https://nucbox.example.net/relay");
  assert.equal(hubHttp("ws://127.0.0.1:7777/relay"), "http://127.0.0.1:7777/relay");
  assert.equal(hubHttp("wss://nucbox.example.net/"), "https://nucbox.example.net/relay");
  assert.equal(hubHttp("wss://nucbox.example.net"), "https://nucbox.example.net/relay");
  assert.equal(hubHttp("not an address"), "");
});

test("share: a room that meets here is registered on this engine's own registry and keeps its code", async () => {
  T.patchTeam({ me: { login: "frank" }, relay: { key: "engine-key" }, rooms: [{ id: "sol", name: "Sol", repos: ["marcocyl04-ux/sol-dev"], hub: "" }], room: "sol" });
  const reg = new Registry(file(), () => 1, () => "HERE22");
  const { calls, f } = hubs({});
  assert.deepEqual(await shareRoom(deps(f, reg), "sol"), { code: "HERE22" });
  assert.equal(calls.length, 0, "no network");
  assert.equal(T.getTeam().rooms[0].code, "HERE22");
  assert.equal(reg.lookup("HERE22")?.by, "frank");
  assert.deepEqual(await shareRoom(deps(f, null)), { code: "HERE22" }, "a room with a code answers it");
  assert.deepEqual(await shareRoom(deps(f, reg), "gone"), { error: "which room?" });
});

test("share: a room elsewhere is posted to its hub, a Bearer when it has no key, its key in the query when it has one", async () => {
  T.patchTeam({ relay: { key: "engine-key" }, rooms: [
    { id: "beta", name: "Beta", repos: ["a/beta"], hub: "wss://shared.example.net/relay", gate: "github" },
    { id: "kao", name: "Kao", repos: ["kao-ai/site"], hub: "wss://kao.example.net/", key: "kao-key" },
  ], room: "beta" });
  let n = 0;
  const { calls, f } = hubs({
    "https://shared.example.net/relay/rooms": () => [200, { code: "SHAR3D", room: {} }],
    "https://kao.example.net/relay/rooms": () => [200, { code: `KAQW${"AB"[n++]}A` }],
  });
  assert.deepEqual(await shareRoom(deps(f)), { code: "SHAR3D" });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.authorization, `Bearer sol1.for ${calls[0].url.replace(/\/rooms$/, "")}`, "its ticket, never my token");
  assert.equal(calls[0].headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].body!), { name: "Beta", provider: "github", org: "", repos: ["a/beta"] });
  assert.equal(calls[0].url, "https://shared.example.net/relay/rooms", "never this engine's own key to another hub");
  assert.deepEqual(await shareRoom(deps(f), "kao"), { code: "KAQWAA" });
  assert.equal(calls[1].url, "https://kao.example.net/relay/rooms?key=kao-key");
  assert.equal(calls[1].headers.authorization, undefined, "a room with its own key meets by the key");
  const s = T.getTeam();
  assert.deepEqual(s.rooms.map((r) => r.code), ["SHAR3D", "KAQWAA"]);
  assert.equal(s.rooms[1].key, "kao-key", "the stored key kept");
  // the hub's words, in plain words
  T.patchTeam({ rooms: [...s.rooms, { id: "x", repos: ["a/x"], hub: "wss://down.example.net/relay" }, { id: "y", repos: ["a/y"], hub: "wss://no.example.net/relay" }, { id: "z", repos: ["a/z"], hub: "wss://odd.example.net/relay" }] });
  const h2 = hubs({ "https://no.example.net": () => [403, { error: "the hub meets by a key: put its key on the room" }], "https://odd.example.net": () => [400, { error: "a room's repository is owner/name\nmore" }] });
  assert.deepEqual(await shareRoom(deps(h2.f), "x"), { error: "the hub did not answer" });
  assert.deepEqual(await shareRoom(deps(h2.f), "y"), { error: "the hub refused: the hub meets by a key: put its key on the room" });
  assert.deepEqual(await shareRoom(deps(h2.f), "z"), { error: "the hub said: a room's repository is owner/name" });
});

test("join: the hubs I know are asked in turn, the first that knows the code gives the room, which is the one in use", async () => {
  T.patchTeam({ rooms: [
    { id: "sol", name: "Sol", repos: ["marcocyl04-ux/sol-dev"], hub: "" },
    { id: "kao", name: "Kao", repos: ["kao-ai/site"], hub: "wss://kao.example.net/relay", key: "kao-key" },
  ], room: "sol" });
  const { calls, f } = hubs({
    "https://kao.example.net/relay/rooms/": () => [404, { error: "no room has that code" }],
    "https://shared.example.net/relay/rooms/": () => [200, { code: "JQ1N22".replace("1", "W"), room: { name: "Sol", provider: "github", org: "", repos: ["marco/notes"] } }],
  });
  const r = await joinRoom(deps(f, new Registry(file())), " jqwn22 ");
  assert.ok("room" in r);
  assert.deepEqual(calls.map((c) => c.url.split("?")[0]), ["https://kao.example.net/relay/rooms/JQWN22", "https://shared.example.net/relay/rooms/JQWN22"]);
  assert.equal(calls[0].url.split("?")[1], "key=kao-key", "a hub of mine, met with its room's key");
  assert.equal(calls[1].headers.authorization, "Bearer sol1.for https://shared.example.net/relay", "the shared hub, met as GitHub: its ticket");
  assert.equal(calls[1].url.includes("?"), false, "and with no key: not this engine's own");
  const s = T.getTeam();
  assert.equal(s.room, "sol-2", "a free id from the name");
  assert.deepEqual(T.activeRoom(s), { id: "sol-2", name: "Sol", provider: "github", org: "", repos: ["marco/notes"], hub: "wss://shared.example.net/relay", key: "", code: "JQWN22", gate: "github", folder: "", mine: false, joined: true });
  // the same code again: no hub asked, only a switch
  T.patchTeam({ room: "sol" });
  const again = await joinRoom(deps(f), "JQWN22");
  assert.ok("room" in again && again.already);
  assert.equal(calls.length, 2);
  assert.equal(T.getTeam().room, "sol-2");
});

test("join: this engine's own registry last; a 403 everywhere says sign in; a bad code says six symbols", async () => {
  T.patchTeam({ rooms: [{ id: "sol", name: "Sol", repos: ["marcocyl04-ux/sol-dev"], hub: "" }], room: "sol" });
  const reg = new Registry(file(), () => 1, () => "MYQWN2");
  reg.register({ name: "Mine", repos: ["frank/mine"] }, "frank");
  const miss = hubs({ "https://shared.example.net": () => [404, {}] });
  const r = await joinRoom(deps(miss.f, reg), "myqwn2");
  assert.ok("room" in r);
  assert.equal(r.room.hub, "", "found here: it meets here");
  assert.equal(T.getTeam().room, "mine");
  const shut = hubs({ "https://shared.example.net": () => [403, { error: "the hub asks GitHub: sign in (gh auth login)" }] });
  assert.deepEqual(await joinRoom(deps(shut.f, reg), "ZZZZZZ"), { error: "the hub refused: the hub asks GitHub: sign in (gh auth login)" });
  const old = hubs({ "https://shared.example.net": () => [403, ""] });
  assert.deepEqual(await joinRoom(deps(old.f, reg), "ZZZZZZ"), { error: "the hub refused (an older Sol there?)" });
  assert.deepEqual(await joinRoom(deps(miss.f, reg), "ZZZZZZ"), { error: "no room has that code" });
  assert.deepEqual(await joinRoom(deps(miss.f, reg), "ABC"), { error: "a code is six letters and digits" });
  assert.deepEqual(await joinRoom(deps(miss.f, reg), "ABCDE0"), { error: "a code is six letters and digits" });
});

// ---- over real sockets ----
test("over real sockets: an open hub registers a room for frank, answers its code, lets a token in, keeps two rooms apart", async () => {
  const reg = new Registry(file());
  const http = createServer();
  const hub = new RelayHub({ registry: reg });
  const opts = { open: () => true, verify };
  const { upgrade, wss } = relayServer(0, () => "k", hub, opts);
  let port = 0;
  const routes = relayRoutes(0, () => "k", reg, opts);
  http.on("request", async (req, res) => { if (!(await routes(req, res))) { res.writeHead(404); res.end(); } });
  http.on("upgrade", upgrade);
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  port = (http.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/relay/rooms`;
  const until = async (ok: () => boolean) => { const t0 = Date.now(); while (Date.now() - t0 < 5000 && !ok()) await new Promise((r) => setTimeout(r, 30)); };
  const as = (t: string) => async () => ({ authorization: `Bearer ${t}` });
  const clients: InstanceType<typeof RelayClient>[] = [];
  try {
    const bearer = { authorization: "Bearer tok-frank", "content-type": "application/json" };
    const post = await fetch(base, { method: "POST", headers: bearer, body: JSON.stringify({ ...sol, by: "someone-else" }) });
    assert.equal(post.status, 200);
    const { code, room } = await post.json() as { code: string; room: object };
    assert.match(code, CODE);
    assert.deepEqual(room, { name: "Sol", provider: "github", org: "", repos: ["marcocyl04-ux/sol-dev"] });
    assert.equal(reg.lookup(code)?.by, "frank", "GitHub's login, not the body's");
    const got = await fetch(`${base}/${code.toLowerCase()}`, { headers: { authorization: "Bearer tok-marco" } });
    assert.deepEqual(await got.json(), { code, room });
    assert.equal((await fetch(`${base}/ZZZZZZ`, { headers: { authorization: "Bearer tok-marco" } })).status, 404);
    assert.equal((await fetch(`${base}/nope`, { headers: { authorization: "Bearer tok-marco" } })).status, 400);
    assert.equal((await fetch(`${base}/${code}`, { headers: { authorization: "Bearer bad" } })).status, 403);
    assert.equal((await fetch(`${base}/${code}`)).status, 403, "neither a token nor the key");
    assert.equal((await fetch(`${base}/${code}?key=k`)).status, 200, "the key still opens it");
    assert.equal((await fetch(base, { method: "POST", headers: { authorization: "Bearer tok-frank" }, body: "{}" })).status, 415);
    assert.equal((await fetch(base, { method: "POST", headers: bearer, body: "x".repeat(9000) })).status, 413);
    assert.equal((await fetch(base, { method: "POST", headers: bearer, body: JSON.stringify({ repos: ["no"] }) })).status, 400);
    // the sockets: a token and no key gets in; the code's room and the common space are two rosters
    const url = () => `ws://127.0.0.1:${port}/relay`;
    const frank = new RelayClient(url, () => ({ login: "frank", state: "here" as const, room: code }), "legion", as("tok-frank")).start();
    const marco = new RelayClient(url, () => ({ login: "marco", state: "here" as const, room: code }), "macbook", as("tok-marco")).start();
    const isaac = new RelayClient(() => `${url()}?key=k`, () => ({ login: "isaac", state: "here" as const }), "thinkpad").start();
    clients.push(frank, marco, isaac);
    await until(() => frank.roster.length === 2 && isaac.up);
    assert.deepEqual(frank.roster.map((e) => e.who), ["frank", "marco"]);
    await until(() => isaac.roster.length === 1);
    assert.deepEqual(isaac.roster.map((e) => e.who), ["isaac"]);
    assert.deepEqual(reg.lookup(code)?.people, ["frank", "marco"]);
    // a token and no key, saying hello with no room: the hub closes it, and the common space never sees it
    const stray = new RelayClient(url, () => ({ login: "marco", state: "here" as const, room: "" }), "stray", as("tok-marco")).start();
    clients.push(stray);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(isaac.roster.map((e) => e.who), ["isaac"]);
    assert.equal(stray.roster.length, 0);
    const heard: RelayMsg[] = [];
    isaac.on("talk", (m) => heard.push(m));
    const inA: RelayMsg[] = [];
    marco.on("talk", (m) => inA.push(m));
    frank.send("talk", { thread: "general", text: "only for the room", id: "t1" });
    await until(() => inA.length === 1);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(heard.length, 0);
  } finally {
    for (const c of clients) c.stop();
    for (const c of wss.clients) c.terminate();
    await new Promise((ok) => http.close(ok));
  }
});

test("join: a code for a room I am in by its record on the same hub, with no code yet, goes there and the room takes it", async () => {
  T.patchTeam({ rooms: [{ id: "sol", name: "Sol", repos: ["marcocyl04-ux/sol-dev"], hub: "" }, { id: "kao", name: "Kao", repos: ["b/two", "a/one"], hub: "wss://kao.example.net/relay", key: "kk" }], room: "sol" });
  const { f } = hubs({ "https://kao.example.net": () => [200, { code: "SAMEQ2", room: { name: "the same room", provider: "github", org: "", repos: ["A/one", "b/TWO"] } }] });
  const r = await joinRoom(deps(f), "sameq2");
  assert.ok("room" in r && r.already, "no new room");
  assert.equal("room" in r ? r.room.id : "", "kao");
  assert.equal(T.getTeam().room, "kao");
  assert.equal(T.getTeam().rooms.find((x) => x.id === "kao")?.code, "SAMEQ2");
  assert.equal(T.getTeam().rooms.length, 2);
});

test("join: the same record on another hub, or on the same hub with another code, is another room", async () => {
  T.patchTeam({ rooms: [{ id: "sol", name: "Sol", repos: ["marcocyl04-ux/sol-dev"], hub: "" }, { id: "kaox", name: "Kao", repos: ["a/one"], hub: "wss://kao.example.net/relay", key: "kk" }], room: "sol" });
  // my own registry knows the code: it meets here, not on kao's hub, so it is not kao
  const reg = new Registry(join(tmp("sol-reg-"), "rooms.json"), () => 1000, () => "QTHRW2");
  reg.register({ name: "Kao here", provider: "github", org: "", repos: ["a/one"] }, "frank");
  const miss = hubs({ "https://kao.example.net": () => [404, {}], "https://shared.example.net": () => [404, {}] });
  const r = await joinRoom(deps(miss.f, reg), "QTHRW2");
  assert.ok("room" in r && !r.already);
  assert.equal("room" in r ? r.room.hub : "x", "");
  assert.equal("room" in r ? r.room.gate : "", "key", "found here: met by this engine's key");
  assert.equal(T.getTeam().rooms.find((x) => x.id === "kaox")?.code, "", "kao keeps no code of another hub's");
  // kao takes a code; then another code for the same record on kao's hub is a second room
  T.patchTeam({ rooms: T.getTeam().rooms.map((x) => (x.id === "kaox" ? { ...x, code: "KAQ1ST".replace("1", "W") } : x)) });
  const again = hubs({ "https://kao.example.net": () => [200, { code: "KAQ2ND", room: { name: "Kao", provider: "github", org: "", repos: ["a/one"] } }] });
  const r2 = await joinRoom(deps(again.f), "KAQ2ND");
  assert.ok("room" in r2 && !r2.already, "a new room");
  assert.equal("room" in r2 ? r2.room.gate : "", "github");
  assert.deepEqual(T.getTeam().rooms.filter((x) => x.repos[0] === "a/one").map((x) => x.code).sort(), ["KAQ2ND", "KAQWST", "QTHRW2"]);
});

// ---- the second review of #157 ----
const { Guesses, GUESS_MAX } = await import("../src/team/registry.ts");
const { shareOnArrival } = await import("../src/team/rooms.ts");
const face = await import("../../mac/src/cowork/rooms.ts");

test("a face's room with no code, or \"\", keeps the stored code, and with no gate keeps the stored gate", () => {
  T.patchTeam({ rooms: [{ id: "beta", repos: ["a/beta"], hub: "wss://shared.example.net/relay", gate: "github", code: "BETAQ2" }], room: "beta" });
  const sent = T.forFace(T.getTeam()).rooms.map(({ code: _c, gate: _g, ...r }) => r);
  T.patchTeam({ rooms: sent });
  assert.equal(T.getTeam().rooms[0].code, "BETAQ2");
  assert.equal(T.getTeam().rooms[0].gate, "github");
  T.patchTeam({ rooms: sent.map((r) => ({ ...r, code: "" })) });
  assert.equal(T.getTeam().rooms[0].code, "BETAQ2", "only the engine sets a code");
  T.patchTeam({ rooms: [...sent, { id: "fresh", repos: ["a/fresh"] }] });
  assert.equal(T.getTeam().rooms[1].code, "");
  assert.equal(T.getTeam().rooms[1].gate, "key", "a room that does not say is met by a key, as before #157");
  assert.equal(T.cleanRoom({ repos: ["a/b"], gate: "anything" })?.gate, "key");
});

test("a room met as GitHub with no code is registered when it becomes the room in use, or at start; not on every patch", () => {
  const s = (rooms: object[], room: string) => T.cleanTeam({ rooms, room });
  const beta = { id: "beta", repos: ["a/beta"], hub: "wss://shared.example.net/relay", gate: "github" };
  const old = { id: "old", repos: ["a/old"], hub: "wss://kao.example.net/relay", key: "" };
  assert.equal(shareOnArrival(null, s([beta], "beta")), "beta", "at start");
  assert.equal(shareOnArrival(s([old, beta], "old"), s([old, beta], "beta")), "beta", "a switch to it");
  assert.equal(shareOnArrival(s([beta], "beta"), s([beta], "beta")), null, "the same room, another patch");
  assert.equal(shareOnArrival(s([beta], "beta"), s([{ ...beta, hub: "wss://other.example.net/relay" }], "beta")), "beta", "its hub changed");
  assert.equal(shareOnArrival(null, s([old], "old")), null, "met by a key: never");
  assert.equal(shareOnArrival(null, s([{ ...beta, code: "BETAQ2" }], "beta")), null, "it has a code");
});

test("a pasted code comes down to its six symbols", () => {
  assert.equal(face.codeTyped("k7q x2m"), "K7QX2M");
  assert.equal(face.codeTyped(" K7Q-X2M\n"), "K7QX2M");
  assert.equal(face.codeTyped("K7QX2M9"), "K7QX2M");
});

test("guesses: after 20 codes no room has in ten minutes, 429 without asking the registry; a hello's unknown code counts", async () => {
  let t = 0;
  const g = new Guesses(() => t);
  const reg = new Registry(file(), () => 1, () => "REALQ2");
  reg.register(sol, "frank");
  let asked = 0;
  const lookup = reg.lookup.bind(reg);
  reg.lookup = (c: string) => { asked++; return lookup(c); };
  const http = createServer();
  const routes = relayRoutes(0, () => "k", reg, { open: () => true, verify, guesses: g });
  http.on("request", async (req, res) => { if (!(await routes(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/relay/rooms`;
  const as = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
  try {
    const a = await fetch(`${base}/ZZZZZZ`, as("tok-frank")), b = await fetch(`${base}/zzzzzz`, as("tok-frank"));
    assert.equal(a.status, 404);
    assert.equal(await a.text(), await b.text(), "every miss reads the same");
    // a hello with a code no room has, from the hub, counts as a miss for that login too
    const hub = new RelayHub({ registry: reg, guesses: g });
    const c = fake();
    hub.join(c, "frank", true); hub.message(c, hello("frank", "ZZZZZZ"));
    for (let i = 3; i < GUESS_MAX; i++) assert.equal((await fetch(`${base}/ZZZZZZ`, as("tok-frank"))).status, 404);
    const before = asked;
    const slow = await fetch(`${base}/REALQ2`, as("tok-frank"));
    assert.equal(slow.status, 429, "even a real code: the caller is slowed");
    assert.deepEqual(await slow.json(), { error: "too many codes tried; wait ten minutes" });
    assert.equal(asked, before, "the registry is not asked");
    assert.equal((await fetch(`${base}/REALQ2`, as("tok-marco"))).status, 200, "another caller is not");
    assert.equal((await fetch(`${base}/REALQ2?key=k`)).status, 200, "a key holder counts by where it calls from");
    t = 10 * 60_000 + 1;
    assert.equal((await fetch(`${base}/REALQ2`, as("tok-frank"))).status, 200, "ten minutes on");
  } finally { await new Promise((ok) => http.close(ok)); }
});

test("guesses on the hello path: past 20 bad codes from one login the next hello is dropped before any lookup", () => {
  const g = new Guesses(() => 0);
  const reg = new Registry(file(), () => 1, () => "REALQ2");
  reg.register(sol, "frank");
  let asked = 0;
  const lookup = reg.lookup.bind(reg);
  reg.lookup = (c: string) => { asked++; return lookup(c); };
  const hub = new RelayHub({ registry: reg, guesses: g });
  for (let i = 0; i < GUESS_MAX; i++) { const c = closer(); hub.join(c, "eve", true); hub.message(c, hello("eve", "ZZZZZZ")); assert.equal(c.closed, 1); }
  assert.equal(asked, GUESS_MAX);
  const last = closer();
  hub.join(last, "eve", true); hub.message(last, hello("eve", "REALQ2"));   // even a real code
  assert.equal(asked, GUESS_MAX, "the 21st is not looked up");
  assert.equal(last.closed, 1, "an open-gate one is closed");
  assert.deepEqual(hub.roster("REALQ2"), []);
  const other = fake();
  hub.join(other); hub.message(other, hello("marco", "REALQ2"));
  assert.deepEqual(hub.roster("REALQ2").map((e) => e.who), ["marco"], "another login is not slowed");
});

test("guesses: GitHub's login when a gate asked; a key holder by its word and by every key holder together, never an address", async () => {
  const { guessers } = await import("../src/team/relay.ts");
  assert.deepEqual(guessers("frank", "eve"), ["frank"]);
  assert.deepEqual(guessers(undefined, "eve"), ["key eve", "key"]);
  assert.deepEqual(guessers(undefined), ["key"]);
});

test("relayAuth: a coded room on this machine's own hub, met by its key, sends my token too, so an open hub knows its maker", async () => {
  const room = { hub: "", gate: "key" as const, code: "OWNQ22" };
  assert.deepEqual(await relayAuth("", async () => "tok-frank", room, async () => "x"), { authorization: "Bearer tok-frank" });
  assert.deepEqual(await relayAuth("", async () => "tok-frank", { ...room, code: "" }, async () => "x"), {}, "the common space: the key, as before");
  assert.deepEqual(await relayAuth("", async () => "tok-frank", { ...room, hub: "wss://kao.example.net/relay" }, async () => "x"), { authorization: "Bearer x" }, "a coded key room elsewhere: its hub's ticket, never my token");
  assert.deepEqual(await relayAuth("", async () => "tok-frank", { ...room, code: "", hub: "wss://kao.example.net/relay" }, async () => "x"), {}, "an uncoded key room elsewhere: nothing of mine");
});

test("the client: a hub that says no room has this code is not knocked on again with it; another room is", async () => {
  const { WebSocketServer } = await import("ws");
  const http = createServer(), wss = new WebSocketServer({ noServer: true });
  let knocks = 0;
  http.on("upgrade", (req, socket, head) => { knocks++; wss.handleUpgrade(req, socket, head, (ws) => ws.on("message", () => ws.close(4404, "no room has that code"))); });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/relay`;
  let room = "GONEQ2";
  const c = new RelayClient(() => url, () => ({ login: "frank", state: "here" as const, room }), "m").start();
  try {
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(knocks, 1, "once, then never again with that code");
    assert.ok(c.gone);
    room = "NEWQ22"; c.restart();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(knocks, 2, "another room knocks");
  } finally { c.stop(); for (const w of wss.clients) w.terminate(); await new Promise((ok) => http.close(ok)); }
});

test("the client: a room switch while a connect's headers are being made never sends them to the next hub", async () => {
  const { WebSocketServer } = await import("ws");
  const seen: Record<string, string[]> = { a: [], b: [] };
  const servers = await Promise.all(["a", "b"].map(async (k) => {
    const http = createServer();
    const wss = new WebSocketServer({ noServer: true });
    http.on("upgrade", (req, socket, head) => { seen[k].push(String(req.headers.authorization ?? "")); wss.handleUpgrade(req, socket, head, (ws) => ws.close()); });
    await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
    return { http, wss, url: `ws://127.0.0.1:${(http.address() as AddressInfo).port}/relay` };
  }));
  let at = servers[0].url, room = "AAAAAA";
  const auth = async () => { const was = at; await new Promise((r) => setTimeout(r, 80)); return { authorization: `Bearer for ${was}` }; };
  const c = new RelayClient(() => at, () => ({ login: "frank", state: "here" as const, room }), "m", auth).start();
  try {
    await new Promise((r) => setTimeout(r, 20));
    at = servers[1].url; room = "BBBBBB";   // the switch, while A's headers are being made
    c.restart();
    const t0 = Date.now();
    while (Date.now() - t0 < 3000 && !seen.b.length) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen.a, [], "A was never knocked on: the place moved before its headers were ready");
    assert.deepEqual(seen.b, [`Bearer for ${servers[1].url}`], "B got only headers made for B");
  } finally {
    c.stop();
    for (const s of servers) { for (const w of s.wss.clients) w.terminate(); await new Promise((ok) => s.http.close(ok)); }
  }
});

test("guesses: a key holder with a new login on every hello still meets every key holder's count; one dead room locks out nobody else", async () => {
  const { KEY_GUESS_MAX } = await import("../src/team/registry.ts");
  const g = new Guesses(() => 0);
  const reg = new Registry(file(), () => 1, () => "REALQ2");
  reg.register(sol, "frank");
  const hub = new RelayHub({ registry: reg, guesses: g });
  // a teammate's Sol in a room that is gone: it knocks with that code twenty times, then is slowed itself
  for (let i = 0; i < GUESS_MAX; i++) { const c = closer(); hub.join(c); hub.message(c, hello("isaac", "ZZZZZZ")); }
  const other = fake();
  hub.join(other); hub.message(other, hello("marco", "REALQ2"));
  assert.deepEqual(hub.roster("REALQ2").map((e) => e.who), ["marco"], "another key holder is not locked out by isaac's dead room");
  // a guesser with a new login on every knock: the key holders' shared count stops it
  for (let i = GUESS_MAX; i < KEY_GUESS_MAX; i++) { const c = closer(); hub.join(c); hub.message(c, hello(`eve-${i}`, "ZZZZZZ")); }
  const last = closer();
  hub.join(last); hub.message(last, hello("someone-new", "REALQ2"));
  assert.equal(last.closed, 1, "over every key holder's count, whatever login it says");
});

test("guesses over real sockets: 21 hellos with bad codes from one login, the 21st closed before any lookup", async () => {
  const { WebSocket } = await import("ws");
  const g = new Guesses();
  const reg = new Registry(file(), () => 1, () => "REALQ2");
  reg.register(sol, "frank");
  let asked = 0;
  const lookup = reg.lookup.bind(reg);
  reg.lookup = (c: string) => { asked++; return lookup(c); };
  const http = createServer();
  const { upgrade, wss } = relayServer(0, () => "k", new RelayHub({ registry: reg, guesses: g }), { open: () => true, verify, guesses: g });
  http.on("upgrade", upgrade);
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/relay`;
  const knockWith = (code: string) => new Promise<number>((done) => {
    const ws = new WebSocket(url, { headers: { authorization: "Bearer tok-marco" } });
    ws.on("open", () => ws.send(hello("marco", code)));
    ws.on("close", (n) => done(n));
    ws.on("error", () => {});
  });
  try {
    for (let i = 0; i < GUESS_MAX; i++) assert.equal(await knockWith("ZZZZZZ"), 4404, "no room has that code: said so");
    assert.equal(asked, GUESS_MAX);
    assert.equal(await knockWith("REALQ2"), 4429, "the 21st, even with a real code, is closed: slowed");
    assert.equal(asked, GUESS_MAX, "and was never looked up");
  } finally {
    for (const c of wss.clients) c.terminate();
    await new Promise((ok) => http.close(ok));
  }
});

test("the shared hub is SOL_HUB as it is when asked, a ws(s) address or none; no address is written in the code (#157, #169)", async () => {
  const { sharedHub } = await import("../src/team/settings.ts");
  const was = process.env.SOL_HUB;
  try {
    process.env.SOL_HUB = "wss://shared.example.net/relay";
    assert.equal(sharedHub(), "wss://shared.example.net/relay");
    process.env.SOL_HUB = " wss://later.example.net/relay?key=x ";
    assert.equal(sharedHub(), "wss://later.example.net/relay", "read when asked, trimmed, never a key in the address");
    process.env.SOL_HUB = "https://not-a-socket.example.net/";
    assert.equal(sharedHub(), "", "an https address is not a hub");
    delete process.env.SOL_HUB;
    assert.equal(sharedHub(), "", "none: a new room meets on this engine's own relay");
  } finally { if (was === undefined) delete process.env.SOL_HUB; else process.env.SOL_HUB = was; }
});
