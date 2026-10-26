// Sign-in to a cloud (#214, S4 of #168), this engine's side: Google in the system browser, back to a one-off listener
// on 127.0.0.1 that checks its state, a name page for a new person posted from that listener's own page only, the
// account kept private, an hour's ticket renewed from it, and my name on that hub the account's. The cloud is a fake
// on a local http server; the browser is this test's own fetches.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const ACCOUNTS = join(tmp("sol-cloud-acc-"), "cloud", "accounts.json");
Object.assign(process.env, { SOL_TEAM: join(tmp("sol-team-"), "team.json"), SOL_TEAM_OFFLINE: "1", SOL_STATE: join(tmp("sol-state-"), "work.json"), SOL_HOME: tmp("sol-home-"), SOL_CLOUD_ACCOUNTS: ACCOUNTS });

const C = await import("../src/team/cloud.ts");
const { hubTicket, hubLogin, onCloud, hubHttp, CLOUD_FILE } = await import("../src/team/relay.ts");
const { patchTeam, getTeam } = await import("../src/team/settings.ts");
beforeEach(() => C.resetCloud());

const R = "r".repeat(43);
type Said = { path: string; body: Record<string, unknown> };

/** a cloud, faked: GET /relay/login gives a client; a code is a person; signup checks a name and a year */
async function cloud(o: { known?: boolean; taken?: string[] } = {}) {
  const said: Said[] = [];
  let renews = 0, refuse = false;
  const server = createServer(async (req: IncomingMessage, res) => {
    let s = ""; for await (const c of req) s += c;
    const body = s ? JSON.parse(s) : {};
    const path = (req.url ?? "").split("?")[0];
    said.push({ path, body });
    const out = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (path === "/relay/login" && req.method === "GET") return out(200, { client: "1-a.apps.googleusercontent.com", scopes: "openid email profile" });
    if (path === "/relay/login") return o.known ? out(200, { login: "frank", ticket: "sol1.known.x", until: Date.now() + 3_600_000, refresh: R }) : out(200, { signup: "pending-1", suggest: "frank", email: "frank@example.com" });
    if (path === "/relay/signup") {
      if (body.born?.year > 2014) return out(403, { error: "Sol is for people 13 and over" });
      if (o.taken?.includes(body.name)) return out(409, { error: "that name is taken, or looks too much like one that is", suggest: `${body.name}-2` });
      return out(200, { login: body.name, ticket: "sol1.new.x", until: Date.now() + 3_600_000, refresh: R });
    }
    if (path === "/relay/renew") { renews++; return refuse ? out(401, { error: "sign in with Google again" }) : out(200, { login: "frank", ticket: `sol1.renewed.${renews}`, until: Date.now() + 3_600_000 }); }
    if (path === "/relay/logout") return out(200, { ok: true });
    out(404, {});
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const hub = `http://127.0.0.1:${(server.address() as AddressInfo).port}/relay`;
  return { hub, said, renews: () => renews, refuse: () => { refuse = true; }, close: () => server.close() };
}

/** the browser: opens Google's url, Google sends it back with this state (the url's, unless told) and a code */
const back = (url: string, state?: string) => {
  const u = new URL(url), r = new URL(u.searchParams.get("redirect_uri")!);
  return { u, r, done: (code = "c0de") => fetch(`${r.href}?state=${encodeURIComponent(state ?? u.searchParams.get("state")!)}&code=${code}`) };
};
const formOf = (html: string) => /name="form" value="([^"]+)"/.exec(html)?.[1] ?? "";
const post = (r: URL, v: Record<string, string>, origin = r.origin) => fetch(`${r.origin}/name`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams(v) });

test("Google's page is asked for this client, the three scopes, a loopback redirect, a state and an S256 challenge", () => {
  const u = new URL(C.consentUrl("1-a.apps.googleusercontent.com", "openid email profile", "http://127.0.0.1:5555/done", "st", "ch"));
  assert.equal(u.origin + u.pathname, C.AUTH_URL);
  assert.deepEqual(Object.fromEntries(u.searchParams), { client_id: "1-a.apps.googleusercontent.com", redirect_uri: "http://127.0.0.1:5555/done", response_type: "code", scope: "openid email profile", state: "st", code_challenge: "ch", code_challenge_method: "S256", prompt: "select_account" });
});

test("a new person: the name page in the tab, posted from the listener's own page only; then the account, kept private", async () => {
  const c = await cloud();
  const file = join(tmp("sol-acc-"), "cloud", "accounts.json");
  let checks: Promise<void> = Promise.resolve();
  try {
    const done = C.signIn(c.hub, { file, open: (url) => { checks = (async () => {
      const { u, r, done } = back(url);
      assert.match(r.href, /^http:\/\/127\.0\.0\.1:\d+\/done$/);
      assert.notEqual(r.port, "7777", "never the engine's own port");
      // a page Sol did not open (another state) is refused, and the sign-in keeps waiting
      assert.equal((await back(url, "not-it").done()).status, 400);
      const page = await (await done()).text();
      assert.match(page, /Pick your name in Sol/);
      assert.match(page, /value="frank"/, "the cloud's suggestion");
      const form = formOf(page);
      assert.equal((await post(r, { form, name: "frank", month: "3", year: "2000" }, "https://evil.example")).status, 403, "another page's post");
      assert.equal((await post(r, { form: "x".repeat(43), name: "frank", month: "3", year: "2000" })).status, 403, "another form");
      // a reload of Google's redirect does not trade the code again
      assert.equal((await done()).status, 409);
      // a real browser says Origin "null" for this page's own form (its referrer policy): taken, with the form token
      const ok = await (await post(r, { form, name: "frank", month: "3", year: "2000" }, "null")).text();
      assert.match(ok, /You can go back to Sol/);
      assert.ok(u.searchParams.get("code_challenge"));
    })(); } });
    assert.deepEqual(await done, { ok: true, login: "frank" });
    await checks;
    const login = c.said.find((s) => s.path === "/relay/login" && s.body.code)!.body;
    assert.equal(login.code, "c0de");
    assert.equal(c.said.filter((s) => s.path === "/relay/login" && s.body.code).length, 1, "the code traded once");
    assert.match(String(login.verifier), /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(c.said.find((s) => s.path === "/relay/signup")!.body, { signup: "pending-1", name: "frank", born: { year: 2000, month: 3 } });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(file)).mode & 0o777, 0o700);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8"))[c.hub]).sort(), ["at", "login", "refresh"], "never the ticket");
    assert.deepEqual(C.accounts(file), [{ hub: c.hub, login: "frank" }]);
    assert.equal(await C.cloudTicket(c.hub, { file }), "sol1.new.x", "the sign-in's own ticket, held");
    assert.equal(c.renews(), 0);
  } finally { c.close(); }
});

test("a taken name shows the page again with a free one offered; under 13 ends the sign-in", async () => {
  const c = await cloud({ taken: ["frank"] });
  try {
    const file = join(tmp("sol-acc-"), "accounts.json");
    const got = await C.signIn(c.hub, { file, open: (url) => void (async () => {
      const { r, done } = back(url);
      const form = formOf(await (await done()).text());
      const again = await (await post(r, { form, name: "frank", month: "3", year: "2000" })).text();
      assert.match(again, /that name is taken/i);
      assert.match(again, /Signed in as frank@example\.com/);
      assert.match(again, /value="frank-2"/);
      await post(r, { form, name: "frank-2", month: "3", year: "2000" });
    })() });
    assert.deepEqual(got, { ok: true, login: "frank-2" });
    C.resetCloud();
    const kid = await C.signIn(c.hub, { file: join(tmp("sol-acc-"), "accounts.json"), open: (url) => void (async () => {
      const { r, done } = back(url);
      const form = formOf(await (await done()).text());
      assert.match(await (await post(r, { form, name: "kid", month: "1", year: "2016" })).text(), /13 and over/);
    })() });
    assert.deepEqual(kid, { ok: false, error: "Sol is for people 13 and over" });
  } finally { c.close(); }
});

test("an account already: straight in; tickets renewed once an hour, not on every knock; a refused renewal forgets the account", async () => {
  const c = await cloud({ known: true });
  try {
    const file = join(tmp("sol-acc-"), "accounts.json");
    assert.deepEqual(await C.signIn(c.hub, { file, open: (url) => void back(url).done() }), { ok: true, login: "frank" });
    C.resetCloud();   // the engine restarted: the ticket was in memory only
    const [a, b] = await Promise.all([C.cloudTicket(c.hub, { file }), C.cloudTicket(c.hub, { file })]);
    assert.equal(a, "sol1.renewed.1");
    assert.equal(b, a, "one renewal for two knocks at once");
    assert.equal(await C.cloudTicket(c.hub, { file }), a, "held while it lasts");
    assert.equal(c.renews(), 1);
    C.resetCloud();
    c.refuse();
    assert.equal(await C.cloudTicket(c.hub, { file }), "");
    assert.equal(C.accountOn(c.hub, file), null, "signed out here: sign in again");
    // a refusal for an old token never removes an account a newer sign-in wrote meanwhile
    writeFileSync(file, JSON.stringify({ [c.hub]: { login: "frank", refresh: "o".repeat(43), at: 1 } }));
    C.resetCloud();
    const late = C.cloudTicket(c.hub, { file });
    writeFileSync(file, JSON.stringify({ [c.hub]: { login: "frank", refresh: "n".repeat(43), at: 2 } }));
    C.resetCloud();
    assert.equal(await late, "");
    assert.equal(C.accountOn(c.hub, file)?.refresh, "n".repeat(43));
  } finally { c.close(); }
});

test("only a cloud over https, or this machine's, is signed in to; a cloud with no Google says so", async () => {
  assert.deepEqual(await C.signIn("http://cloud.example/relay", { file: join(tmp("sol-acc-"), "a.json"), open: () => assert.fail("no browser") }), { ok: false, error: "a cloud is signed in to over https only" });
  const none = createServer((_q, r) => { r.writeHead(404); r.end("{}"); });
  await new Promise<void>((ok) => none.listen(0, "127.0.0.1", ok));
  try {
    const got = await C.signIn(`http://127.0.0.1:${(none.address() as AddressInfo).port}/relay`, { file: join(tmp("sol-acc-"), "a.json"), open: () => assert.fail("no browser") });
    assert.deepEqual(got, { ok: false, error: "that cloud has no Google sign-in" });
  } finally { none.close(); }
});

test("a sign-out the cloud did not take keeps the account here, to try again", async () => {
  const file = join(tmp("sol-acc-"), "accounts.json");
  const hub = "http://127.0.0.1:9/relay";   // nothing listens: the logout never reaches a cloud
  writeFileSync(file, JSON.stringify({ [hub]: { login: "frank", refresh: R, at: 1 } }));
  C.resetCloud();
  assert.equal(await C.signOut(hub, { file }), false);
  assert.equal(C.accountOn(hub, file)?.login, "frank");
});

test("the pages escape what they show", () => {
  const p = C.namePage('"><script>x</script>', "<b>", "a<img>@x.com", "<i>no</i>");
  assert.doesNotMatch(p, /<script>|<img>|<b>|<i>/);
});

test("on a cloud I signed in to, my name there is who I am and the ticket is the cloud's; elsewhere, my GitHub login", async () => {
  const c = await cloud({ known: true });
  try {
    const ws = c.hub.replace(/^http/, "ws"), hub = hubHttp(ws);
    assert.equal(hub, c.hub);
    mkdirSync(dirname(CLOUD_FILE), { recursive: true });
    writeFileSync(CLOUD_FILE, JSON.stringify({ [hub]: { login: "frank", refresh: R, at: 1 } }));
    C.resetCloud();
    patchTeam({ me: { login: "franktsai2008-eng", name: "Frank" } });
    patchTeam({ rooms: [{ id: "c", name: "On the cloud", provider: "github", org: "", repos: ["marcocyl04-ux/sol-dev"], hub: ws, key: "", code: "ABC234", gate: "github", folder: "", mine: true, joined: false }], room: "c" });
    assert.equal(hubLogin(), "frank");
    assert.equal(onCloud(), true, "GitHub-login features are off here");
    assert.equal(await hubTicket(hub), "sol1.renewed.1", "the cloud's renewal, never a gist");
    assert.ok(!c.said.some((x) => x.path === "/relay/proof"));
    patchTeam({ rooms: [{ id: "n", name: "NucBox", provider: "github", org: "", repos: ["marcocyl04-ux/sol-dev"], hub: "wss://nucbox.example/relay", key: "", code: "ABC235", gate: "github", folder: "", mine: true, joined: false }], room: "n" });
    assert.equal(getTeam().me.login, "franktsai2008-eng");
    assert.equal(hubLogin(), "franktsai2008-eng");
    assert.equal(onCloud(), false);
  } finally { c.close(); }
});
