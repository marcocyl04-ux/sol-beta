// The engine's side of the cloud under load (#223, S6a of #168): a chat line past the hub's 4 KB goes in parts cut by
// bytes (A5, CJK and emoji), a line the hub asked to wait is sent again by itself (B2), a line sent again after a
// reconnect is carried once (C2), waits are random within their step (B4), a busy hub's queue number is kept and
// brought back (B3), a hub that says "too old" is not knocked on again (C1), and a face's watch is asked once per show
// (A6). Real hubs on real sockets, on 127.0.0.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const { RelayClient, splitBytes, backoff } = await import("../src/team/relay-client.ts");
const { RelayHub, relayServer, Queue, PROTOCOL } = await import("../src/hub/index.ts");
const { Shows } = await import("../src/team/show.ts");
type HubOpts = import("../src/hub/index.ts").HubOpts;
type ServerOpts = import("../src/hub/index.ts").ServerOpts;

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
async function until(f: () => boolean, ms = 5000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timed out"); await wait(20); } }

/** a cloud-like hub (the package's defaults) on a real socket, met by the key "k" */
async function hubAt(o: HubOpts = {}, s: ServerOpts = {}) {
  const hub = new RelayHub(o);
  const srv = relayServer(0, () => "k", hub, { heartbeat: 0, ...s });
  const http = createServer();
  http.on("upgrade", srv.upgrade);
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/relay?key=k`;
  return { hub, srv, url, close: () => new Promise<void>((ok) => { for (const ws of srv.wss.clients) ws.terminate(); http.close(() => ok()); }) };
}
const client = (url: string, login: string) => { const c = new RelayClient(() => url, () => ({ login, state: "here" as const }), login); c.rand = () => 0; return c; };
const talks = (c: InstanceType<typeof RelayClient>) => { const got: any[] = []; c.on("talk", (m) => got.push(m)); return got; };

test("A5: a line is cut by bytes at characters a person sees: Chinese, emoji with joiners, quotes and newlines", () => {
  const zh = "雲端模組不爆的設計，".repeat(400);   // 4000 characters, 12 KB
  const parts = splitBytes(zh, 3000);
  assert.ok(parts.length >= 4);
  assert.equal(parts.join(""), zh);
  for (const p of parts) assert.ok(Buffer.byteLength(JSON.stringify(p)) - 2 <= 3000);
  const family = "👨‍👩‍👧‍👦", thumbs = "👍🏽";
  const em = `${family}${thumbs}`.repeat(200);
  const ep = splitBytes(em, 100);
  assert.equal(ep.join(""), em);
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const p of ep) for (const { segment } of seg.segment(p)) assert.ok(segment === family || segment === thumbs, "no emoji was cut in two");
  const q = `"\n\\`.repeat(100);   // each is two bytes once JSON-encoded
  for (const p of splitBytes(q, 50)) assert.ok(Buffer.byteLength(JSON.stringify(p)) - 2 <= 50);
  assert.deepEqual(splitBytes("short", 100), ["short"]);
});

test("A5: a 12 KB Chinese line on a 4 KB hub arrives whole, in parts, and the socket stays open", async () => {
  const h = await hubAt({ rate: null });
  const a = client(h.url, "frank").start(), b = client(h.url, "marco").start();
  const got = talks(b);
  try {
    await until(() => a.up && b.up && a.info !== null && b.roster.length === 2);
    const text = "我們在雲端上聊天，一則訊息很長很長。😀".repeat(220);
    assert.ok(Buffer.byteLength(text) > 12_000);
    assert.equal(a.send("talk", { thread: "general", text, id: "long-line" }), true);
    await until(() => got.length >= 4 && got.map((m) => m.text).join("") === text);
    assert.ok(got.every((m) => /^long-line-p\d+$/.test(m.id) && m.part[1] === got.length));
    await wait(100);
    assert.equal(a.up, true, "the hub did not close the socket (1009)");
  } finally { a.stop(); b.stop(); await h.close(); }
});

test("B2: lines past the hub's rate come back as retry and are sent again by themselves; each arrives once", async () => {
  const h = await hubAt({ rate: { conn: { per: 5, burst: 5 }, account: { per: 100, burst: 100 }, show: { per: 10, burst: 10 }, strikes: 100 } });
  const a = client(h.url, "frank").start(), b = client(h.url, "marco").start();
  const got = talks(b), heard: any[] = [];
  a.on("hub", (m) => heard.push(m));
  try {
    await until(() => a.info !== null && b.roster.length === 2);
    for (let i = 0; i < 9; i++) a.send("talk", { thread: "general", text: `line ${i}`, id: `l${i}` });
    await until(() => got.length === 9, 8000);
    assert.deepEqual(got.map((m) => m.text).sort(), Array.from({ length: 9 }, (_, i) => `line ${i}`).sort());
    assert.ok(heard.some((m) => m.say === "retry" && m.what === "talk"), "the engine heard the hub say wait");
  } finally { a.stop(); b.stop(); await h.close(); }
});

test("C2: a line whose ok was lost with the socket is sent again on the next connection, and carried once", async () => {
  const h = await hubAt({ rate: null });
  let cut = true;
  // the first talk that reaches the hub: its socket is cut right after the hub took it, so the ok never arrives
  h.srv.wss.on("connection", (ws) => ws.on("message", (d) => { if (cut && String(d).includes('"kind":"talk"')) { cut = false; ws.terminate(); } }));
  const a = client(h.url, "frank").start(), b = client(h.url, "marco").start();
  const got = talks(b);
  try {
    await until(() => a.info !== null && b.roster.length === 2);
    a.send("talk", { thread: "general", text: "only once", id: "once" });
    await until(() => !cut && a.up && a.info !== null, 8000);
    await until(() => (a as any).kept.size === 0, 8000);
    await wait(200);
    assert.equal(got.filter((m) => m.text === "only once").length, 1);
  } finally { a.stop(); b.stop(); await h.close(); }
});

test("B4: the wait is random in the upper half of its step", () => {
  assert.equal(backoff(1000, 0), 500);
  assert.equal(backoff(1000, 0.999), 999.5);
  assert.equal(backoff(30_000, 0.5), 22_500);
});

test("B3: a busy hub hands a number; the Sol keeps it, comes back with it, and is in when it is called", async () => {
  const q = new Queue(1, 60_000);
  q.set(true);
  const h = await hubAt({}, { queue: q });
  const a = client(h.url, "frank"), heard: any[] = [];
  a.on("hub", (m) => heard.push(m));
  a.start();
  try {
    await until(() => a.queued !== null);
    assert.equal(heard[0].say, "queue");
    assert.equal(a.up, false);
    await wait(1300);
    assert.equal(a.up, false, "not called yet: still waiting, number kept");
    q.tick();
    await until(() => a.up && a.roster.length === 1, 4000);
    assert.equal(a.queued, null);
  } finally { a.stop(); q.stop(); await h.close(); }
});

test("C1: a hub that takes a newer Sol says so; this one stops knocking and says please update", async () => {
  const h = await hubAt({ minVersion: PROTOCOL + 1 });
  const a = client(h.url, "frank"), heard: any[] = [];
  a.on("hub", (m) => heard.push(m));
  let knocks = 0;
  h.srv.wss.on("connection", () => { knocks++; });
  a.start();
  try {
    await until(() => a.old);
    await wait(1500);
    assert.equal(knocks, 1, "not knocked on again");
    assert.ok(heard.some((m) => m.say === "update"));
  } finally { a.stop(); await h.close(); }
});

test("A6: a show watched by two faces is asked for once and let go when the last closes; asked again after a reconnect", () => {
  const asked: string[] = [], sent: any[] = [], told: any[] = [];
  const s = new Shows({ send: (m) => { sent.push(m); return true; }, watch: (l, id, on) => { asked.push(`${l}/${id} ${on}`); return true; }, tell: (m) => told.push(m),
    gh: async () => "", git: async () => "", login: async () => "marco", mayGitHub: () => false, now: () => 1, every: () => () => {} });
  const f1 = {}, f2 = {};
  s.watch("frank", "s1", true, f1); s.watch("frank", "s1", true, f2);
  assert.deepEqual(asked, ["frank/s1 true"]);
  s.watch("frank", "s1", false, f1);
  assert.deepEqual(asked, ["frank/s1 true"]);
  s.again(false);
  assert.deepEqual(asked, ["frank/s1 true", "frank/s1 true"]);
  s.ask("frank/s1"); s.ask("nobody/x");
  assert.deepEqual(asked, ["frank/s1 true", "frank/s1 true", "frank/s1 true"], "a refused watch is asked again; one not watched is not");
  s.unwatchFace(f2);
  assert.deepEqual(asked.at(-1), "frank/s1 false");
  // a line heard twice (the hub's tail after a reconnect) is kept once; a start again keeps the lines
  const line = { kind: "show", from: { login: "frank" }, issue: 1, repo: "r", session: { id: "s1", title: "t" }, event: "line", line: { role: "agent", text: "hi", at: 5 } };
  s.hear(line); s.hear(line);
  s.hear({ ...line, event: "start", line: undefined });
  assert.equal(s.lines("frank", "s1")?.length, 1);
});

test("A5: the parts of a long line are put back together before they are kept, whatever their order; one line, its own id", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const talk = await import("../src/team/talk.ts");
  const dir = mkdtempSync(join(tmpdir(), "talk-parts-"));
  talk._talkAt(join(dir, "state"), join(dir, "home"));
  const text = "我們在雲端上聊天。".repeat(500);
  const parts = splitBytes(text, 3000);
  const at = Date.now();
  const msgs = parts.map((t, i) => ({ kind: "talk", from: { login: "marco", agent: false }, at, thread: "general", text: t, id: `abc-p${i + 1}`, part: [i + 1, parts.length] }));
  for (const m of [...msgs].reverse()) talk.hearRelay(m as any);
  const kept = talk.history("general").filter((l) => l.from === "marco");
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, "abc");
  assert.equal(kept[0].text, text.slice(0, 4000).trim());
  talk.hearRelay(msgs[0] as any);   // a part again (a resend): not a new line, and nothing left waiting forever
  assert.equal(talk.history("general").filter((l) => l.from === "marco").length, 1);
});
