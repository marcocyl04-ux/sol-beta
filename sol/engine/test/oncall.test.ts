// On-call, the engine's side (#225, S7 of #168): an admin's Sol pulls the cloud watch's feed and hears each alert as a
// ping of kind alert; the first pull does not bring up old ones; the last one seen is kept; a watch that does not answer
// for five minutes is said once, and its coming back too; the agent's tools read, propose and slow through it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OnCall, alertPing, SILENT_AFTER } from "../src/team/oncall.ts";
import { route, kindOf, PING_KINDS, type Ping } from "../src/team/pings.ts";

const H = 3600_000;

test("the feed's alerts become pings of kind alert, each once; the first pull skips old ones", async () => {
  const now = 10 * H;
  let feed = [{ id: 1, at: now - 5 * H, key: "disk", kind: "alert", text: "old" }, { id: 2, at: now - 60_000, key: "light", kind: "alert", text: "the light is orange" }];
  const asked: string[] = [];
  let up = true;
  const fake = (async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${new URL(url).pathname}${new URL(url).search} ${(init?.headers as Record<string, string>).authorization}`);
    if (!up) throw new Error("down");
    const after = Number(new URL(url).searchParams.get("after"));
    return new Response(JSON.stringify({ alerts: feed.filter((a) => a.id > after) }), { status: 200 });
  }) as typeof fetch;
  const got: Ping[] = [];
  const file = join(mkdtempSync(join(tmpdir(), "oncall-")), "oncall.json");
  const d = { watch: "https://box.example.ts.net:8443/", ticket: async () => "sol1.t", fetch: fake, now: () => now, deliver: (p: Ping) => got.push(p), file };
  const o = new OnCall(d);
  assert.equal(await o.poll(), 1, "the five-hour-old alert is not brought up again");
  assert.deepEqual(got.map((p) => [p.id, p.kind, p.line]), [[`alert-${now - 60_000}-2`, "alert", "cloud alert: the light is orange"]]);
  assert.match(asked[0], /^GET \/agent\/feed\?after=0 Bearer sol1\.t$/);
  feed = [...feed, { id: 3, at: now, key: "light", kind: "recovered", text: "recovered: the light is orange (after 4 min)" }];
  assert.equal(await o.poll(), 1);
  assert.match(asked[1], /after=2 /);
  assert.equal(got[1].line, "cloud recovered: the light is orange (after 4 min)");
  assert.equal(await new OnCall(d).poll(), 0, "a restart remembers the last one seen");
  // the watch goes quiet: said once after five minutes, and once when it is back
  up = false;
  for (let i = 0; i < SILENT_AFTER + 3; i++) await o.poll();
  assert.equal(got.filter((p) => /has not answered/.test(p.line)).length, 1);
  up = true;
  await o.poll();
  assert.match(got[got.length - 1].line, /answers again/);
  // the ping path: an alert is its own kind, a card by default
  assert.equal(kindOf("alert"), "alert");
  assert.ok(PING_KINDS.includes("alert"));
  assert.deepEqual(route("alert", "matters"), { card: true, absorbed: false, written: false });
});

test("no ticket: nothing asked; the tools say what the watch said", async () => {
  const calls: string[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${new URL(url).pathname} ${init?.body ?? ""}`);
    if (new URL(url).pathname === "/agent/state") return new Response(JSON.stringify({ health: { ok: true, light: "yellow", forced: false, now: { people: 3 } }, flags: { signupsPaused: true }, open: [{ key: "light", since: 1, text: "the light is yellow" }], proposals: [{ id: 4, action: "disable", target: "eve", why: "spam", who: "agent:marco" }] }));
    if (new URL(url).pathname === "/agent/propose") return new Response(JSON.stringify({ id: 9 }));
    return new Response(JSON.stringify({ ok: false, result: "a person set the light to red; an AI does not change that" }), { status: 409 });
  }) as typeof fetch;
  const file = join(mkdtempSync(join(tmpdir(), "oncall-")), "oncall.json");
  let t = "";
  const o = new OnCall({ watch: "https://box", ticket: async () => t, fetch: fake, now: Date.now, deliver: () => {}, file });
  assert.equal(await o.poll(), 0);
  assert.ok(calls.every((c) => !c.includes("/agent/state")), "no ticket: only the feed is asked (it needs the tailnet login alone)");
  assert.match(await o.state(), /does not answer|no cloud ticket/);
  t = "sol1.x";
  const s = await o.state();
  assert.match(s, /light yellow, 3 people on/); assert.match(s, /sign-ups paused/); assert.match(s, /- light: the light is yellow/); assert.match(s, /#4 disable eve/);
  assert.match(await o.propose("disable", "eve", "spam"), /proposed as #9: a person confirms/);
  assert.match(await o.slow(10, "load"), /^not done: a person set the light/);
  assert.ok(calls.some((c) => c.startsWith("POST /agent/slow") && c.includes('"minutes":10')));
  assert.equal(alertPing({ id: 1, at: 1, key: "x", kind: "action", text: "franktsai did pause-rooms" }).line, "cloud done: franktsai did pause-rooms");
});

test("a long feed is read to its end at once, old ones skipped on every page; a feed that started over resets", async () => {
  const now = 100 * H;
  let feed = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, at: i < 240 ? now - 5 * H : now, key: "k", kind: "alert", text: `a${i + 1}` }));
  const fake = (async (url: string) => {
    const after = Number(new URL(url).searchParams.get("after"));
    const max = feed.length ? feed[feed.length - 1].id : 0;
    return new Response(JSON.stringify({ max, alerts: feed.filter((a) => a.id > (after > max ? 0 : after)).slice(0, 100) }));
  }) as typeof fetch;
  const got: Ping[] = [];
  const o = new OnCall({ watch: "https://box", ticket: async () => "", fetch: fake, now: () => now, deliver: (p) => got.push(p), file: join(mkdtempSync(join(tmpdir(), "oncall-")), "o.json") });
  assert.equal(await o.poll(), 10, "the ten fresh ones of 250, in one pull, with no ticket");
  assert.equal(await o.poll(), 0);
  feed = [{ id: 1, at: now, key: "k", kind: "alert", text: "after a restore" }];
  assert.equal(await o.poll(), 1, "the feed is behind the cursor: read from its start again");
  assert.equal(got[got.length - 1].line, "cloud alert: after a restore");
});
