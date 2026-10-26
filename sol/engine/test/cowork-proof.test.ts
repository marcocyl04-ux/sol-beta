// Proof (the review of the rooms stack, finding 3): a hub learns who I am on GitHub from a secret gist of mine that
// holds its nonce, and gives me its own signed ticket; it never holds my GitHub token. GitHub is a fake: the gists my
// Sol "makes" are kept in a map the hub's fake read looks in. The hub runs on a local http server.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
Object.assign(process.env, { SOL_TEAM: join(tmp("sol-team-"), "team.json"), SOL_TEAM_OFFLINE: "1", SOL_STATE: join(tmp("sol-state-"), "work.json"), SOL_HOME: tmp("sol-home-") });

const P = await import("../src/hub/index.ts");
const { relayRoutes, knock } = await import("../src/team/relay.ts");
const { withTickets } = await import("../src/team/identity.ts");
const { Registry } = await import("../src/hub/index.ts");
beforeEach(() => P.resetTickets());

/** GitHub, faked: gists by id, each its owner and text */
function github() {
  const gists = new Map<string, { owner: string; text: string }>();
  let n = 0;
  const as = (owner: string) => ({
    prove: async (text: string) => { const id = (++n).toString(16).padStart(32, "a"); gists.set(id, { owner, text }); return id; },
    unprove: async (id: string) => { gists.delete(id); return ""; },
  });
  const reads = (members: string[] = []) => ({
    proofOf: async (id: string) => { const g = gists.get(id); if (!g) throw new Error("gh: Not Found (HTTP 404)"); return JSON.stringify(g); },
    inOrg: async (_org: string, login: string) => { if (!members.includes(login)) throw new Error("gh: Not Found (HTTP 404)"); return ""; },
  });
  return { gists, as, reads };
}

test("the hub: a gist of that login holding this hub's nonce and host is a ticket; the ticket says the login, for that org, for a day", async () => {
  let t = 1_000;
  const hub = new P.Proofs(join(tmp("sol-proof-"), "proof.key"), () => t);
  const gh = github(), frank = gh.as("frank");
  const nonce = hub.nonce("frank", "10.0.0.1")!;
  assert.match(nonce, P.NONCE);
  const gist = await frank.prove(P.proofText(nonce, "Hub.Example.net"));
  const got = await hub.redeem({ login: "Frank", nonce, gist }, ["other.example.net", "hub.example.net"], "", gh.reads());
  assert.ok("ticket" in got, JSON.stringify(got));
  assert.equal(got.until, 1_000 + P.TICKET_FOR);
  assert.equal(hub.check(got.ticket, ""), "frank", "GitHub's spelling of the login");
  assert.equal(hub.check(got.ticket, "acme"), null, "a ticket for no org is none for an org");
  t += P.TICKET_FOR;
  assert.equal(hub.check(got.ticket, ""), null, "a day on: gone");
});

test("the hub: a nonce once; another's gist; another hub's host; another login's nonce; no gist at all: each refused", async () => {
  const hub = new P.Proofs(join(tmp("sol-proof-"), "proof.key"));
  const gh = github(), frank = gh.as("frank"), eve = gh.as("eve");
  const n1 = hub.nonce("frank")!;
  const g1 = await frank.prove(P.proofText(n1, "hub.example.net"));
  assert.ok("ticket" in await hub.redeem({ login: "frank", nonce: n1, gist: g1 }, ["hub.example.net"], "", gh.reads()));
  assert.deepEqual(await hub.redeem({ login: "frank", nonce: n1, gist: g1 }, ["hub.example.net"], "", gh.reads()), { error: "that is not a nonce this hub gave you; ask again" }, "once");
  const n2 = hub.nonce("frank")!;
  assert.deepEqual(await hub.redeem({ login: "frank", nonce: n2, gist: await eve.prove(P.proofText(n2, "hub.example.net")) }, ["hub.example.net"], "", gh.reads()), { error: "that gist is not yours" });
  // a hub that passed this hub's nonce on to me: my gist names the hub I was talking to, and this hub refuses it
  const n3 = hub.nonce("frank")!;
  assert.deepEqual(await hub.redeem({ login: "frank", nonce: n3, gist: await frank.prove(P.proofText(n3, "evil.example.net")) }, ["hub.example.net"], "", gh.reads()), { error: "that gist does not hold this hub's nonce" });
  const n4 = hub.nonce("eve")!;
  assert.deepEqual(await hub.redeem({ login: "frank", nonce: n4, gist: await frank.prove(P.proofText(n4, "hub.example.net")) }, ["hub.example.net"], "", gh.reads()), { error: "that is not a nonce this hub gave you; ask again" }, "eve's nonce is no proof of frank");
  const n5 = hub.nonce("frank")!;
  assert.deepEqual(await hub.redeem({ login: "frank", nonce: n5, gist: "ffff" }, ["hub.example.net"], "", gh.reads()), { error: "the hub could not read that gist" });
  assert.equal(hub.nonce("not a login"), null);
});

test("the hub: with an org, GitHub's member check is the hub's own question; a ticket of another hub, or one changed, is nobody", async () => {
  const hub = new P.Proofs(join(tmp("sol-proof-"), "proof.key")), other = new P.Proofs(join(tmp("sol-proof-"), "proof.key"));
  const gh = github(), frank = gh.as("frank"), eve = gh.as("eve");
  const n1 = hub.nonce("eve")!;
  assert.deepEqual(await hub.redeem({ login: "eve", nonce: n1, gist: await eve.prove(P.proofText(n1, "h")) }, ["h"], "acme", gh.reads(["frank"])), { error: "GitHub says you are not in acme" });
  const n2 = hub.nonce("frank")!;
  const got = await hub.redeem({ login: "frank", nonce: n2, gist: await frank.prove(P.proofText(n2, "h")) }, ["h"], "acme", gh.reads(["frank"]));
  assert.ok("ticket" in got);
  assert.equal(hub.check(got.ticket, "acme"), "frank");
  assert.equal(other.check(got.ticket, "acme"), null, "another hub's key");
  const [head, body, sig] = got.ticket.split(".");
  const forged = Buffer.from(JSON.stringify({ l: "eve", o: "acme", u: Date.now() + 1e9 })).toString("base64url");
  assert.equal(hub.check(`${head}.${forged}.${sig}`, "acme"), null, "a changed body");
  assert.equal(hub.check(`${head}.${body}.${sig.slice(0, -2)}AA`, "acme"), null, "a changed signature");
  const again = new P.Proofs((hub as any).file);   // the same key file, as after a restart
  assert.equal(again.check(got.ticket, "acme"), "frank", "a restart keeps the hub's key, and its tickets");
});

test("the hub: a nonce is its own signed word, kept nowhere; a login's gists are read five times in ten minutes; a short key file is made whole", async () => {
  const { writeFileSync, readFileSync, statSync } = await import("node:fs");
  let t = 0;
  const file = join(tmp("sol-proof-"), "proof.key");
  writeFileSync(file, "short");
  const hub = new P.Proofs(file, () => t);
  for (let i = 0; i < 1000; i++) assert.ok(hub.nonce(`someone-${i}`), "asking has no limit to fill: nothing is kept");
  assert.equal(readFileSync(file).length, 32, "the short key replaced by a whole one");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const gh = github(), frank = gh.as("frank");
  const tries = [];
  for (let i = 0; i < 6; i++) { const n = hub.nonce("frank")!; tries.push(await hub.redeem({ login: "frank", nonce: n, gist: "ffff" }, ["h"], "", gh.reads())); }
  assert.deepEqual(tries.slice(0, 5).map((x) => "error" in x && x.error), Array(5).fill("the hub could not read that gist"));
  assert.deepEqual(tries[5], { error: "too many proofs for you; wait ten minutes" }, "the sixth is not read");
  const n = hub.nonce("frank")!;
  const forged = `${Buffer.from(JSON.stringify({ l: "frank", u: 1e15, r: "00" })).toString("base64url")}.${n.split(".")[1]}`;
  assert.deepEqual(await hub.redeem({ login: "frank", nonce: forged, gist: await frank.prove(P.proofText(forged, "h")) }, ["h"], "", gh.reads()), { error: "that is not a nonce this hub gave you; ask again" }, "a nonce changed is none");
  t = 10 * 60_000 + 1;
  const late = hub.nonce("frank")!;
  assert.ok("ticket" in await hub.redeem({ login: "frank", nonce: late, gist: await frank.prove(P.proofText(late, "h")) }, ["h"], "", gh.reads()), "ten minutes on");
});

test("my Sol: a hub that refused a proof, or has none, is not asked again for half an hour, so no gist is made on every reconnect", async () => {
  let t = 0, proofs = 0;
  const gh = github(), frank = gh.as("frank");
  const refusing = (async (url: string, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body ?? "{}"));
    return body.nonce ? new Response(JSON.stringify({ error: "no" }), { status: 403 }) : new Response(JSON.stringify({ nonce: `${"a".repeat(20)}.${"b".repeat(43)}` }), { status: 200 });
  }) as typeof fetch;
  const d = { fetch: refusing, login: () => "frank", now: () => t, prove: async (x: string) => { proofs++; return frank.prove(x); }, unprove: frank.unprove };
  for (let i = 0; i < 10; i++) assert.equal(await P.ticketFor("https://bad.example.net/relay", d), "");
  assert.equal(proofs, 1, "one gist, not ten");
  t = 30 * 60_000 + 1;
  await P.ticketFor("https://bad.example.net/relay", d);
  assert.equal(proofs, 2, "half an hour on, one more");
  const down = (async () => { throw new Error("offline"); }) as typeof fetch;
  for (let i = 0; i < 3; i++) await P.ticketFor("https://down.example.net/relay", { ...d, fetch: down });
  assert.equal(proofs, 2, "a hub that never answered made no gist");
});

test("over http: my Sol proves itself to an open hub with a gist it deletes, knocks with the ticket, and the hub never sees my token", async () => {
  const gh = github(), frank = gh.as("frank");
  const proofs = new P.Proofs(join(tmp("sol-proof-"), "proof.key"));
  let askedGitHub = 0;
  const verify = async () => { askedGitHub++; return null; };   // a GitHub token: none comes
  const reg = new Registry(join(tmp("sol-relay-"), "rooms.json"), () => 1, () => "PRUFQ2");
  let hosts: string[] = [];
  const routes = relayRoutes(0, () => "k", reg, { open: () => true, verify, proofs, reads: gh.reads(), hosts: () => hosts });
  const seen: string[] = [];
  const http = createServer(async (req, res) => { seen.push(String(req.headers.authorization ?? "")); if (!(await routes(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  hosts = [`127.0.0.1:${(http.address() as AddressInfo).port}`];   // the hub's own setting (SOL_HUB_HOST)
  // the client's address as an outside hub would be: not this machine's, so a ticket and never the token
  const hubAt = `http://127.0.0.1:${(http.address() as AddressInfo).port}/relay`;
  try {
    const d = { fetch: globalThis.fetch, login: () => "frank", ...frank };
    const [a, b] = await Promise.all([P.ticketFor(hubAt, d), P.ticketFor(hubAt, d)]);
    assert.equal(a, b, "two at once prove once");
    assert.match(a, /^sol1\./);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(gh.gists.size, 0, "the gist is deleted");
    assert.equal(await P.ticketFor(hubAt, d), a, "held while it lasts");
    const reg2 = await fetch(`${hubAt}/rooms`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: JSON.stringify({ name: "Book Club", provider: "github", org: "", repos: ["frank/book-club"] }) });
    assert.equal(reg2.status, 200, "the ticket opens the hub's routes");
    assert.equal(reg.lookup("PRUFQ2")?.by, "frank", "under the login the gist proved");
    assert.deepEqual(await knock("/relay", { authorization: `Bearer ${a}` }, "k", "", 0, withTickets(verify, proofs), true), { login: "frank", open: true }, "and the socket's gate");
    assert.equal(askedGitHub, 0, "the hub never asked GitHub about a token: it never had one");
    assert.ok(seen.every((h) => h === "" || h.startsWith("Bearer sol1.")), "nothing but tickets reached the hub");
    assert.equal(P.refusedBy(hubAt), true, "a refusal forgets the ticket");
    assert.equal(P.refusedBy(hubAt), false, "at most once an hour");
    assert.notEqual(await P.ticketFor(hubAt, d), a, "proved again");
  } finally { await new Promise((ok) => http.close(ok)); }
});

test("over http: who the hub is comes from its setting, never the Host a caller writes; with none set it gives no tickets", async () => {
  const gh = github(), frank = gh.as("frank");
  const proofs = new P.Proofs(join(tmp("sol-proof-"), "proof.key"));
  let hosts: string[] = [];
  const reg = new Registry(join(tmp("sol-relay-"), "rooms.json"));
  const routes = relayRoutes(0, () => "k", reg, { open: () => true, proofs, reads: gh.reads(), hosts: () => hosts });
  const http = createServer(async (req, res) => { if (!(await routes(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const hubAt = `http://127.0.0.1:${(http.address() as AddressInfo).port}/relay`;
  const { request } = await import("node:http");
  // fetch will not let a caller set Host; a hub's own client, passing another hub's nonce on, would
  const post = (body: object, host: string) => new Promise<{ status: number; body: any }>((ok, no) => {
    const r = request(`${hubAt}/proof`, { method: "POST", headers: { "content-type": "application/json", host } }, (res) => {
      let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => ok({ status: res.statusCode ?? 0, body: JSON.parse(t) }));
    });
    r.on("error", no); r.end(JSON.stringify(body));
  });
  try {
    assert.deepEqual(await post({ login: "frank" }, "anything"), { status: 404, body: { error: "this hub gives no tickets: its host is not set (SOL_HUB_HOST)" } });
    hosts = ["hub.example.net"];
    const { body: { nonce } } = await post({ login: "frank" }, "evil.example.net");
    // the relay attack: an evil hub handed me this hub's nonce, so my gist names the evil hub; it forwards my gist
    // here with Host set to its own name
    const gist = await frank.prove(P.proofText(nonce, "evil.example.net"));
    assert.deepEqual(await post({ login: "frank", nonce, gist }, "evil.example.net"), { status: 403, body: { error: "that gist does not hold this hub's nonce" } });
  } finally { await new Promise((ok) => http.close(ok)); }
});

test("over http: a hub that meets by a key has no /proof, and my Sol gets no ticket there", async () => {
  const proofs = new P.Proofs(join(tmp("sol-proof-"), "proof.key"));
  const reg = new Registry(join(tmp("sol-relay-"), "rooms.json"));
  const routes = relayRoutes(0, () => "k", reg, { open: () => false, proofs });
  const http = createServer(async (req, res) => { if (!(await routes(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const hubAt = `http://127.0.0.1:${(http.address() as AddressInfo).port}/relay`;
  try {
    const r = await fetch(`${hubAt}/proof`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "frank" }) });
    assert.equal(r.status, 404);
    const gh = github();
    assert.equal(await P.ticketFor(hubAt, { fetch: globalThis.fetch, login: () => "frank", ...gh.as("frank") }), "");
    assert.equal(gh.gists.size, 0, "no gist made for a hub that asked for none");
  } finally { await new Promise((ok) => http.close(ok)); }
});
