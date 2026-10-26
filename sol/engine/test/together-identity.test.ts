// The relay spool and GitHub identity (#102, docs/how-we-work/PRD.md sections 9 and 10): the key's gate unchanged
// while there is no org; with an org, a member let in under GitHub's login, a non-member and a bad token refused; talk
// and pings kept for whoever is away and handed over on their hello; the team's members read from the org or the
// relay. GitHub is a function that writes down its arguments; the sockets are local; the state is a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
process.env.SOL_TEAM = join(tmp("sol-team-"), "team.json");
process.env.SOL_TEAM_OFFLINE = "1";
process.env.SOL_STATE = join(tmp("sol-state-"), "work.json");
process.env.SOL_HOME = tmp("sol-home-");

const { RelayHub, RelayClient, relayGate, knock, relayServer, relayAuth } = await import("../src/team/relay.ts");
const { orgGate, bearerOf, ghVerify } = await import("../src/team/identity.ts");
const { Spool, trimSpool, SPOOL_MAX } = await import("../src/hub/index.ts");
const { membersOf, loginsOf } = await import("../src/team/members.ts");
type RelayMsg = import("../src/team/relay.ts").RelayMsg;

const fake = () => { const got: any[] = []; return { got, send: (l: string) => got.push(JSON.parse(l)) }; };
const hello = (login: string) => JSON.stringify({ kind: "hello", from: { login, agent: false }, at: 1, machine: "m", state: "here" });
const talk = (text: string) => JSON.stringify({ kind: "talk", from: { login: "x", agent: false }, at: 1, thread: "general", text, id: text.replace(/\W/g, "") });
const ping = (to: string, line: string) => JSON.stringify({ kind: "ping", from: { login: "x", agent: false }, at: 1, to, line });

// GitHub, faked: frank is a member, eve is not, "bad" is no token at all
const MEMBERS = new Set(["frank", "marco"]);
const TOKENS: Record<string, string> = { "tok-frank": "frank", "tok-eve": "eve", "tok-marco": "marco" };
const verify = async (token: string, org: string) => (org === "acme" && TOKENS[token] && MEMBERS.has(TOKENS[token]) ? TOKENS[token] : null);

// ---- the gate ----
test("key mode is unchanged while there is no org: the key, and no browser page but Sol's own", async () => {
  assert.deepEqual(await knock("/relay?key=k1", {}, "k1", "", 7777, verify), { login: "" });
  assert.equal(await knock("/relay?key=k2", {}, "k1", "", 7777, verify), null);
  assert.equal(await knock("/relay", { authorization: "Bearer tok-frank" }, "k1", "", 7777, verify), null, "a token is no key");
  assert.equal(await knock("/relay?key=k1", { origin: "https://evil.example" }, "k1", "", 7777, verify), null);
  assert.equal(relayGate("/relay?key=k1", { origin: "tauri://localhost" }, "k1", 7777), true);
  assert.equal(relayGate("/relay?key=", {}, "", 7777), false);
});

test("org mode: a member is let in under GitHub's login, a non-member and a bad token are refused, the key alone is not enough", async () => {
  const h = (t: string, o: Record<string, string> = {}) => ({ authorization: `Bearer ${t}`, ...o });
  assert.deepEqual(await knock("/relay", h("tok-frank"), "k1", "acme", 7777, verify), { login: "frank" });
  assert.equal(await knock("/relay", h("tok-eve"), "k1", "acme", 7777, verify), null, "not in the org");
  assert.equal(await knock("/relay", h("bad"), "k1", "acme", 7777, verify), null, "GitHub does not know the token");
  assert.equal(await knock("/relay?key=k1", {}, "k1", "acme", 7777, verify), null, "the key no longer opens it");
  assert.equal(await knock("/relay", h("tok-frank"), "", "acme", 7777, verify), null, "not the host: closed");
  assert.equal(await knock("/relay", h("tok-frank", { origin: "https://evil.example" }), "k1", "acme", 7777, verify), null);
  assert.equal(await orgGate(h("tok-frank"), "acme", 7777, async () => { throw new Error("GitHub is down"); }), null);
  assert.equal(bearerOf({ authorization: "bearer abc" }), "abc");
  assert.equal(bearerOf({ authorization: "Basic abc" }), "");
});

test("ghVerify: who the token is, then the org's member check, as that token; a yes kept 10 minutes, a no never", async () => {
  const calls: string[] = [];
  let t = 0;
  const gh = async (args: string[], token: string) => {
    calls.push(`${token} ${args.join(" ")}`);
    const who = TOKENS[token];
    if (!who) throw new Error("401");
    if (args[1] === "user") return `${who}\n`;
    if (args[1] === `orgs/acme/members/${who}` && MEMBERS.has(who)) return "";
    throw new Error("404");
  };
  const v = ghVerify(gh, () => t);
  assert.equal(await v("tok-frank", "acme"), "frank");
  assert.deepEqual(calls, ["tok-frank api user --jq .login", "tok-frank api orgs/acme/members/frank --silent"]);
  assert.equal(await v("tok-frank", "acme"), "frank");
  assert.equal(calls.length, 2, "a reconnect within 10 minutes does not ask GitHub");
  t = 11 * 60_000;
  assert.equal(await v("tok-frank", "acme"), "frank");
  assert.equal(calls.length, 4, "after 10 minutes GitHub is asked again");
  assert.equal(await v("tok-eve", "acme"), null);
  assert.equal(await v("tok-eve", "acme"), null);
  assert.equal(calls.filter((c) => c.startsWith("tok-eve")).length, 4, "a no is not remembered");
  assert.equal(await v("nope", "acme"), null);
  assert.ok(calls.every((c) => !/GH_TOKEN|tok-\w+ .*tok-/.test(c)), "the token is never on gh's command line");
});

test("the hub stamps GitHub's login, never the one hello claims", () => {
  const hub = new RelayHub();
  const a = fake(), b = fake();
  hub.join(a, "frank"); hub.join(b);
  hub.message(a, hello("marco"));   // frank's Sol says it is marco
  hub.message(b, hello("isaac"));
  assert.deepEqual(hub.roster().map((e) => e.who), ["frank", "isaac"]);
  hub.message(a, JSON.stringify({ kind: "changed", from: { login: "marco", agent: false }, at: 1, repo: "o/r" }));
  const m = b.got.find((x) => x.kind === "changed");
  assert.equal(m.from.login, "frank");
});

test("relayAuth: no headers without an org; the token fresh from gh with one; nothing to connect with when gh has none", async () => {
  assert.deepEqual(await relayAuth("", async () => "tok"), {});
  assert.deepEqual(await relayAuth("acme", async () => "tok-frank"), { authorization: "Bearer tok-frank" });
  assert.equal(await relayAuth("acme", async () => ""), null);
});

// ---- the spool ----
test("the spool: talk kept for everyone away, a ping for its person only, handed over on hello and then gone", () => {
  const dir = join(tmp("sol-relay-"), "spool");
  const sp = new Spool(dir);
  const hub = new RelayHub({ spool: sp });
  const m = fake(), f = fake(), i = fake();
  hub.join(m); hub.join(f); hub.join(i);
  hub.message(m, hello("marco")); hub.message(f, hello("frank")); hub.message(i, hello("isaac"));
  hub.leave(f); hub.leave(i);   // frank and isaac close Sol
  hub.message(m, talk("the build is up"));
  hub.message(m, ping("frank", "a look at #41?"));
  assert.equal(sp.peek("frank").length, 2);
  assert.deepEqual(sp.peek("isaac").map((x) => x.kind), ["talk"], "a ping to frank is not kept for isaac");
  assert.equal(sp.peek("marco").length, 0, "nothing kept for the one who said it");
  assert.ok(existsSync(join(dir, "spool.db")), "kept in the spool's one file (SQLite since #208)");
  // frank opens Sol: what he missed, stamped as it passed, then it is gone
  const f2 = fake();
  hub.join(f2); hub.message(f2, hello("frank"));
  const sp1 = f2.got.find((x) => x.kind === "spooled");
  assert.deepEqual(sp1.messages.map((x: RelayMsg) => [x.kind, x.from.login]), [["talk", "marco"], ["ping", "marco"]]);
  assert.equal(sp1.messages[0].text, "the build is up");
  assert.equal(sp.peek("frank").length, 0, "handed over, then gone");
  // while he is on, nothing more is kept for him
  hub.message(m, talk("second"));
  assert.equal(sp.peek("frank").length, 0);
  assert.equal(sp.peek("isaac").length, 2);
  assert.deepEqual(sp.seen(), ["frank", "isaac", "marco"]);
  // a second hello from frank's other machine gets nothing twice
  const f3 = fake();
  hub.join(f3); hub.message(f3, hello("frank"));
  assert.equal(f3.got.filter((x) => x.kind === "spooled").length, 0);
});

test("the spool keeps talk for the org's members too, someone the hub never saw", () => {
  const sp = new Spool(join(tmp("sol-relay-"), "spool"));
  const hub = new RelayHub({ spool: sp, people: () => ["newcomer"] });
  const m = fake();
  hub.join(m); hub.message(m, hello("marco"));
  hub.message(m, talk("welcome"));
  assert.equal(sp.peek("newcomer").length, 1);
});

test("the spool: at most 500 messages and 7 days, trimmed on write", () => {
  let now = Date.UTC(2026, 9, 22);
  const sp = new Spool(join(tmp("sol-relay-"), "spool"), () => now);
  const msg = (n: number, at: number): RelayMsg => ({ kind: "talk", from: { login: "marco", agent: false }, at, thread: "general", text: `${n}` });
  sp.add("frank", msg(0, now - 8 * 86_400_000));   // already older than a week
  assert.equal(sp.peek("frank").length, 0);
  for (let n = 1; n <= SPOOL_MAX + 20; n++) sp.add("frank", msg(n, now));
  const kept = sp.peek("frank");
  assert.equal(kept.length, SPOOL_MAX);
  assert.equal(kept[0].text, "21", "the oldest dropped");
  now += 8 * 86_400_000;
  assert.equal(sp.take("frank").length, 0, "a week later it is all gone");
  assert.equal(trimSpool([msg(1, 5), msg(2, 6)], 6, 1).length, 1);
  sp.add("../evil", msg(1, now));
  assert.equal(sp.seen().length, 0);
});

test("over real sockets, org mode: frank's Sol knocks with his token, misses a line and a ping while away, gets both on hello", async () => {
  const sp = new Spool(join(tmp("sol-relay-"), "spool"));
  const http = createServer();
  const { upgrade, wss } = relayServer(0, () => "k", new RelayHub({ spool: sp }), { org: () => "acme", verify });
  http.on("upgrade", upgrade);
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const port = (http.address() as AddressInfo).port;
  const url = () => `ws://127.0.0.1:${port}/relay`;
  const as = (t: string) => async () => ({ authorization: `Bearer ${t}` });
  const until = async (ok: () => boolean) => { const t0 = Date.now(); while (Date.now() - t0 < 5000 && !ok()) await new Promise((r) => setTimeout(r, 30)); };
  const marco = new RelayClient(url, () => ({ login: "marco", state: "here" as const }), "nucbox", as("tok-marco")).start();
  const eve = new RelayClient(url, () => ({ login: "frank", state: "here" as const }), "evebox", as("tok-eve")).start();
  let frank = new RelayClient(url, () => ({ login: "someone-else", state: "here" as const }), "legion", as("tok-frank")).start();
  try {
    await until(() => marco.roster.length === 2);
    assert.deepEqual(marco.roster.map((e) => e.who), ["frank", "marco"], "GitHub's login, not hello's; eve is not let in");
    assert.equal(eve.up, false);
    frank.stop();
    await until(() => marco.roster.length === 1);
    marco.send("talk", { thread: "general", text: "the build is up", id: "t1" });
    marco.send("ping", { to: "frank", line: "a look at #41?" });
    await until(() => sp.peek("frank").length === 2);
    frank = new RelayClient(url, () => ({ login: "frank", state: "here" as const }), "legion", as("tok-frank"));
    const each: RelayMsg[] = [], lists: RelayMsg[] = [];
    frank.on("talk", (m) => each.push(m));
    frank.on("ping", (m) => each.push(m));
    frank.on("spooled", (m) => lists.push(m));
    frank.start();
    await until(() => lists.length === 1);
    assert.deepEqual(each.map((m) => [m.kind, m.from.login, m.spooled]), [["talk", "marco", true], ["ping", "marco", true]]);
    assert.equal((lists[0].messages as RelayMsg[]).length, 2);
    assert.equal(sp.peek("frank").length, 0);
  } finally {
    marco.stop(); eve.stop(); frank.stop();
    for (const c of wss.clients) c.terminate();
    await new Promise((ok) => http.close(ok));
  }
});

// ---- what this Sol does with what was kept ----
test("missed pings: three or fewer come back one by one; more are one card, no storm", async () => {
  const { missedPings } = await import("../src/team/wire.ts");
  const p = (n: number): RelayMsg => ({ kind: "ping", from: { login: "frank", agent: false }, at: n, to: "marco", line: `ping ${n}` });
  const few = missedPings([p(1), p(2), { ...p(3), to: "isaac" }], "marco") as any[];
  assert.deepEqual(few.map((m) => [m.type, m.line, m.spooled]), [["team.pinged", "ping 1", true], ["team.pinged", "ping 2", true]]);
  const many = missedPings([1, 2, 3, 4, 5].map(p), "marco") as any[];
  assert.equal(many.length, 1);
  assert.equal(many[0].line, "while you were away: 5 pings");
  assert.equal(many[0].count, 5);
  assert.deepEqual(missedPings("nonsense", "marco"), []);
});

test("a talk line heard live and again from the spool is kept once (by its time, signature and words)", async () => {
  const talkMod = await import("../src/team/talk.ts");
  talkMod._talkAt(tmp("sol-talk-"), tmp("sol-home-"));
  const m: RelayMsg = { kind: "talk", from: { login: "marco", agent: false }, at: 1000, thread: "general", text: "the build is up", id: "a1" };
  talkMod.hearRelay(m);
  talkMod.hearRelay({ ...m, id: "b2", spooled: true });   // same line, another id
  talkMod.hearRelay({ ...m, id: "c3", at: 2000, spooled: true });   // said again later: a new line
  assert.deepEqual(talkMod.history("general").map((l) => l.at), [1000, 2000]);
});

// ---- who is on the team ----
test("members: the org's members when there is an org (read at most every 10 minutes), else the logins seen on the relay", async () => {
  let org = "", t = 0, reads = 0;
  const m = membersOf({
    gh: async (args) => { reads++; assert.deepEqual(args, ["api", `orgs/${org}/members`, "--paginate", "--jq", ".[].login"]); return "marco\nfrank\nisaac\n"; },
    org: () => org, seen: () => ["marco", "frank"], now: () => t,
  });
  assert.deepEqual(m.now(), ["frank", "marco"], "no org: who was seen");
  assert.equal(reads, 0);
  org = "acme";
  const told: string[][] = [];
  m.onChange((l) => told.push(l));
  assert.deepEqual(await m.refresh(), ["frank", "isaac", "marco"]);
  assert.deepEqual(told, [["frank", "isaac", "marco"]], "a new member is told at once");
  assert.deepEqual(m.now(), ["frank", "isaac", "marco"]);
  await m.refresh();
  assert.equal(reads, 1, "cached");
  t = 11 * 60_000;
  await m.refresh();
  assert.equal(reads, 2);
  assert.deepEqual(loginsOf("a\n\nb c\n../x\n"), ["a", "b", "c"]);
});
