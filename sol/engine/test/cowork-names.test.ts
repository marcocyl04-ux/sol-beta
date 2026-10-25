// A room from a name alone (#160): the hub keeps names apart (one a hub, case and spaces aside), answers whether a name
// is free, and the engine makes the room: the name checked on its hub, the repository made under my account, the room
// added as the one in use and registered at once. GitHub is a fake gh; the hubs are a fake fetch or a local socket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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

const { Registry } = await import("../src/team/registry.ts");
const { relayRoutes } = await import("../src/team/relay.ts");
const { makeRoom } = await import("../src/team/rooms.ts");
const { makeGithubRecord } = await import("../src/team/record.ts");
const { tag } = await import("../src/team/record/github.ts");
const T = await import("../src/team/settings.ts");

const file = () => join(tmp("sol-relay-"), "relay", "rooms.json");
const room = (name: string, repo: string) => ({ name, provider: "github", org: "", repos: [repo] });

// ---- the registry ----
test("names are one a hub: case and spaces aside; the same room again keeps its code; another room is refused, 409", () => {
  let n = 0;
  const reg = new Registry(file(), () => 1, () => ["NAMEQ2", "NAMEQ3", "NAMEQ4"][n++]);
  const a = reg.register(room("Study  Group", "frank/study-group"), "frank");
  assert.equal(a.name, "Study Group", "spaces collapsed");
  assert.equal(reg.taken(" study group "), true);
  assert.equal(reg.taken("STUDY\tGROUP"), true);
  assert.equal(reg.taken("study groups"), false);
  assert.equal(reg.taken(""), false);
  assert.equal(reg.register(room("study group", "frank/study-group"), "frank").code, a.code, "the same room: the same code");
  assert.throws(() => reg.register(room("Study Group", "marco/study-group"), "marco"), (e: Error & { status?: number }) => e.message === "that name is taken" && e.status === 409);
  assert.throws(() => reg.register(room("STUDY GROUP", "frank/other"), "frank"), /that name is taken/, "my own other room, too");
  const b = reg.register(room("Reading", "frank/reading"), "frank");
  assert.throws(() => reg.register(room("Study Group", "frank/reading"), "frank"), /that name is taken/, "a room renamed onto another's name");
  assert.equal(reg.lookup(b.code)?.name, "Reading");
  assert.equal(reg.all().length, 2);
});

// ---- the route, over a real http server ----
test("GET /relay/names/<name>: free or taken, behind the relay's gate; register says 409 for a taken name", async () => {
  const reg = new Registry(file(), () => 1, () => "NAMEQ5");
  reg.register(room("Book Club", "frank/book-club"), "frank");
  const verify = async (token: string) => (token === "tok-frank" ? "frank" : token === "tok-marco" ? "marco" : null);
  const http = createServer();
  const routes = relayRoutes(0, () => "k", reg, { open: () => true, verify });
  http.on("request", async (req, res) => { if (!(await routes(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/relay`;
  const as = { headers: { authorization: "Bearer tok-marco" } };
  try {
    const taken = await fetch(`${base}/names/${encodeURIComponent("book  CLUB")}`, as);
    assert.equal(taken.status, 200);
    assert.deepEqual(await taken.json(), { name: "book CLUB", free: false });
    assert.deepEqual(await (await fetch(`${base}/names/${encodeURIComponent("Chess Club")}`, as)).json(), { name: "Chess Club", free: true });
    assert.equal((await fetch(`${base}/names/${encodeURIComponent("x".repeat(61))}`, as)).status, 400);
    const refused = await fetch(`${base}/names/Chess`);
    assert.equal(refused.status, 403, "no token and no key");
    assert.match((await refused.json() as { error: string }).error, /the hub asks GitHub/);
    assert.equal((await fetch(`${base}/names/Chess?key=k`)).status, 200, "the key opens it");
    const post = await fetch(`${base}/rooms`, { method: "POST", headers: { ...as.headers, "content-type": "application/json" }, body: JSON.stringify(room("BOOK club", "marco/book-club")) });
    assert.equal(post.status, 409);
    assert.deepEqual(await post.json(), { error: "that name is taken" });
  } finally { await new Promise((ok) => http.close(ok)); }
});

// ---- the record: the repository ----
test("the record makes a private repository under my login, named after the room; -2 on when one is there; signed out in one line", async () => {
  const calls: string[][] = [];
  const there = new Set(["frank/book-club", "frank/book-club-2"]);
  const gh = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "api") return "frank\n";
    const repo = args[2];
    if (there.has(repo)) throw new Error(`GraphQL: Name already exists on this account (createRepository)`);
    return `https://github.com/${repo}\n`;
  };
  assert.equal(await makeGithubRecord(gh).room.make("Book Club!"), "frank/book-club-3");
  const made = calls.filter((c) => c[0] === "repo");
  assert.deepEqual(made.map((c) => c[2]), ["frank/book-club", "frank/book-club-2", "frank/book-club-3"]);
  assert.deepEqual(made[2], ["repo", "create", "frank/book-club-3", "--private", "--add-readme", "--description", "a Sol room: Book Club!"]);
  // no letters or digits GitHub can take (a Chinese name): room- and four symbols of its own, never a bare "room"
  const named: string[] = [];
  const noLetters = await makeGithubRecord(async (a) => { if (a[0] === "api") return "frank"; named.push(a[2]); return `https://github.com/${a[2]}\n`; }).room.make("帥");
  assert.match(noLetters, /^frank\/room-[a-z0-9]{4}$/, "no letters: room-xxxx");
  assert.equal(named[0], noLetters);
  assert.match(tag(() => new Uint8Array([0, 30, 31, 61])), /^[a-z0-9]{4}$/);
  assert.equal(tag(() => new Uint8Array([0, 0, 0, 0])), "aaaa");
  const out = makeGithubRecord(async () => { throw new Error("To get started with GitHub CLI, please run:  gh auth login"); });
  await assert.rejects(out.room.make("x"), /^Error: sign in to GitHub first$/);
  const full = makeGithubRecord(async (a) => { if (a[0] === "api") return "frank"; throw new Error("name already exists"); });
  await assert.rejects(full.room.make("x"), /five repositories of that name/);
});

// ---- the engine: makeRoom ----
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function hubs(answer: (c: Call) => [number, unknown]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c: Call = { url, method: init.method ?? "GET", headers: { ...(init.headers as Record<string, string>) }, body: init.body as string | undefined };
    calls.push(c);
    const [status, body] = answer(c);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, f };
}
function maker(fail?: string) {
  const made: string[] = [];
  return { made, record: () => ({ room: { make: async (name: string) => { if (fail) throw new Error(fail); made.push(name); return `frank/${T.slug(name)}`; } } }) };
}
const deps = (f: typeof fetch, record: ReturnType<typeof maker>["record"], local: InstanceType<typeof Registry> | null = null) =>
  ({ team: T.getTeam, patch: T.patchTeam, local, fetch: f, token: async () => "tok-frank", ticket: async (hub: string) => `sol1.for ${hub}`, record });
const start = () => T.patchTeam({ me: { login: "frank" }, relay: { key: "engine-key" }, rooms: [{ id: "sol", name: "Sol", repos: ["marcocyl04-ux/sol-dev"], hub: "" }], room: "sol" });

test("make: a free name on the shared hub, the repository made, the room in use, met as GitHub, registered with its code", async () => {
  start();
  const m = maker();
  const { calls, f } = hubs((c) => (c.method === "GET" ? [200, { name: "Book Club", free: true }] : [200, { code: "BKQ2CL" }]));
  const r = await makeRoom(deps(f, m.record), { name: "  Book   Club " });
  assert.ok("room" in r && !r.warn);
  assert.deepEqual(m.made, ["Book Club"]);
  assert.equal(calls[0].url, "https://shared.example.net/relay/names/Book%20Club", "asked first, with no key at all");
  assert.equal(calls[0].headers.authorization, "Bearer sol1.for https://shared.example.net/relay", "the hub's ticket for me, never my token");
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(JSON.parse(calls[1].body!).repos, ["frank/book-club"]);
  const s = T.getTeam();
  assert.equal(s.room, "book-club");
  assert.deepEqual(T.activeRoom(s), { id: "book-club", name: "Book Club", provider: "github", org: "", repos: ["frank/book-club"], hub: "wss://shared.example.net/relay", key: "", code: "BKQ2CL", gate: "github", folder: "", mine: true, joined: false });
  assert.equal("room" in r ? r.room.code : "", "BKQ2CL", "the code is on the answer");
});

test("make: a taken name makes no repository; a refusal says the hub's line; signed out says sign in", async () => {
  start();
  const m = maker();
  assert.deepEqual(await makeRoom(deps(hubs(() => [200, { free: false }]).f, m.record), { name: "Book Club" }), { error: "that name is taken" });
  assert.deepEqual(await makeRoom(deps(hubs(() => [403, { error: "the hub asks GitHub: sign in (gh auth login)" }]).f, m.record), { name: "Chess" }),
    { error: "the hub refused: the hub asks GitHub: sign in (gh auth login)" });
  assert.deepEqual(m.made, [], "no repository made");
  assert.deepEqual(await makeRoom(deps(hubs(() => [200, { free: true }]).f, maker("sign in to GitHub first").record), { name: "Chess" }), { error: "sign in to GitHub first" });
  assert.deepEqual(await makeRoom(deps(hubs(() => [200, { free: true }]).f, m.record), { name: "   " }), { error: "a room needs a name" });
  assert.deepEqual(await makeRoom(deps(hubs(() => [200, { free: true }]).f, m.record), { name: "x".repeat(61) }), { error: "a room needs a name" });
  assert.equal(T.getTeam().rooms.length, 1, "nothing added");
});

test("make: a register that fails keeps the room, without a code, and says why", async () => {
  start();
  const m = maker();
  const r = await makeRoom(deps(hubs((c) => (c.method === "GET" ? [200, { free: true }] : [409, { error: "that name is taken" }])).f, m.record), { name: "Chess" });
  assert.ok("room" in r);
  assert.equal("room" in r ? r.room.code : "x", "");
  assert.equal("room" in r ? r.warn : "", "the hub said: that name is taken");
  assert.equal(T.getTeam().room, "chess");
});

test("make: on this Mac (hub \"\") the name is checked and registered here, met by this engine's key; a key given is met by it", async () => {
  start();
  let n = 0;
  const reg = new Registry(file(), () => 1, () => ["THERE2", "HEREQ2"][n++]);
  reg.register(room("Taken Here", "frank/taken-here"), "frank");
  const m = maker();
  const none = hubs(() => [500, {}]);
  assert.deepEqual(await makeRoom(deps(none.f, m.record, reg), { name: "taken here", hub: "" }), { error: "that name is taken" });
  const r = await makeRoom(deps(none.f, m.record, reg), { name: "Mine", hub: "" });
  assert.ok("room" in r);
  assert.equal(none.calls.length, 0, "no network");
  assert.deepEqual("room" in r ? [r.room.hub, r.room.gate, r.room.code] : [], ["", "key", "HEREQ2"]);
  const k = hubs((c) => (c.method === "GET" ? [200, { free: true }] : [200, { code: "KEYQ22" }]));
  const r2 = await makeRoom(deps(k.f, m.record), { name: "Kao", hub: "wss://kao.example.net/relay", key: "kao-key" });
  assert.equal("room" in r2 ? r2.room.gate : "", "key");
  assert.equal(k.calls[0].url, "https://kao.example.net/relay/names/Kao?key=kao-key");
  assert.equal(k.calls[0].headers.authorization, undefined);
});
