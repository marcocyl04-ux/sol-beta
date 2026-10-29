// engine/track (#356): how Sol is used, as counts, never as words. Each test in a fresh back room of its own.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { setTrackHome, track, trackIn, trackOut, testerCode, sendPending, badProp, band, hashOf, asWord, whoNow, trackUrlOf, dayFile, IN, OUT, KEEP_DAYS, EVERY, MAX_LINES_A_DAY } from "../src/track.ts";

let home = "";
let now = new Date(2026, 9, 28, 21, 14, 3);
let consent = { usage: true };
let who = { name: "frank", user: "franktsai" };
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sol-track-"));
  now = new Date(2026, 9, 28, 21, 14, 3);
  consent = { usage: true };
  who = { name: "frank", user: "franktsai" };
  setTrackHome(home, { version: "abc1234", consent: () => consent, who: () => who, now: () => now });
});
// the day's lines, without the tester.who that opens each file (its own test below)
const all = (d = now) => (existsSync(dayFile(d)) ? readFileSync(dayFile(d), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const lines = (d = now) => all(d).filter((l) => l.name !== "tester.who");
const sock = () => ({});

test("a say with words becomes a turn.say that holds none of them: a length band, counts, and a word or two", () => {
  const ws = sock();
  trackIn(ws, { type: "hello", face: "window" });
  trackIn(ws, { type: "say", text: "please read ~/secret/plan.md and tell me what it says about the Q4 price", seat: "claude", files: [{ name: "a.png" }], model: "claude-opus-5-5", effort: "high" });
  const raw = readFileSync(dayFile(), "utf8");
  assert.doesNotMatch(raw, /secret|plan\.md|price|a\.png/, "no word of the say and no file name is written");
  const [hello, say] = lines();
  assert.deepEqual(hello, { at: now.toISOString(), tester: testerCode(), sol: "abc1234", face: "window", mode: "home", seat: "", name: "face.hello", props: { face: "window" } });
  assert.equal(say.name, "turn.say");
  assert.equal(say.face, "window", "the face the socket said hello as");
  assert.equal(say.mode, "home");
  assert.equal(say.seat, "claude");
  assert.deepEqual(say.props, { len: "21-100", files: 1, door: "none", fresh: false, carried: false, model: "claude-opus-5-5", effort: "high" });
});

test("the tester code is made once, kept in home/track/id, and is the only identity in a line", () => {
  const a = testerCode();
  assert.match(a, /^t_[a-z0-9]{10}$/);
  assert.equal(readFileSync(join(home, "track", "id"), "utf8").trim(), a);
  setTrackHome(home, { version: "x", consent: () => consent, now: () => now });   // a restart reads the same code
  assert.equal(testerCode(), a);
  track("engine.up");
  assert.deepEqual(Object.keys(lines()[0]), ["at", "tester", "sol", "face", "mode", "seat", "name"]);
});

test("a prop that is not small and plain drops the whole event and counts a track.dropped naming the event and the prop", () => {
  assert.equal(badProp({ n: 3, ok: true, kind: "read", hash: hashOf("/Users/x/p") }), null);
  assert.equal(badProp({ path: "/Users/marco/secret" }), "path");
  assert.equal(badProp({ url: "https://example.com" }), "url");
  assert.equal(badProp({ text: "a".repeat(65) }), "text");
  assert.equal(badProp({ say: "remind sarah about rent" }), "say", "a space makes a sentence, not a word");
  assert.equal(badProp({ nan: NaN }), "nan");
  assert.equal(badProp({ nested: { a: 1 } as any }), "nested");
  const e = track("turn.say", { text: "hello there, this is what I typed and it should never be written" });
  assert.equal(e?.name, "track.dropped");
  assert.deepEqual(e?.props, { event: "turn.say", prop: "text" });
  assert.doesNotMatch(readFileSync(dayFile(), "utf8"), /hello there/);
});

test("a message kind the table does not know is counted by its kind alone; the noisy ones are not", () => {
  const ws = sock();
  trackIn(ws, { type: "sticky.make", text: "buy milk", colour: "yellow" });
  trackIn(ws, { type: "presence", focused: true, idleSeconds: 0 });
  trackIn(ws, { type: "ping", at: 1 });
  trackIn(ws, { type: "team.board.get", rid: 4 });
  trackIn(ws, { type: "eye.tick", bundle: "com.apple.Notes", on: true });
  trackIn(ws, { type: "hear", audio: "UklGR...", done: false });
  trackIn(ws, { type: "hear", audio: "UklGR...", done: true });
  trackIn(ws, { type: "team.room.join", code: "bright-fox-42" });
  const got = lines();
  assert.deepEqual(got.map((l) => l.name), ["msg.sticky.make", "dictation.heard", "room.join"]);
  assert.equal(got[0].props, undefined, "by its kind alone: nothing of the sticky");
  assert.deepEqual(got[2], { ...got[2], mode: "cowork", props: { how: "code" } });
  assert.doesNotMatch(readFileSync(dayFile(), "utf8"), /milk|bright-fox|UklGR|Notes/);
});

test("the rails' presses, batched by the face, become one button.press per button; a person's own button goes as a hash", () => {
  trackIn(sock(), { type: "arrange.used", counts: { call: 3, "file-it": 1, "remind-sarah-rent": 2, page: 0 } });
  const got = lines();
  assert.deepEqual(got.map((l) => [l.name, l.props]), [["button.press", { id: "call", n: 3 }], ["button.press", { id: "file-it", n: 1 }], ["button.press", { id: `own:${hashOf("remind-sarah-rent")}`, n: 2 }]]);
  assert.doesNotMatch(readFileSync(dayFile(), "utf8"), /sarah/);
});

test("out: start and done make a turn with its seconds; the stream itself (delta, tool steps, output) is not counted", () => {
  const ws = sock();
  trackIn(ws, { type: "hello", face: "notch" });
  trackOut(ws, { type: "start", seat: "codex", sessionId: "s1" });
  trackOut(ws, { type: "delta", text: "Here is the secret plan" });
  trackOut(ws, { type: "tool", seat: "codex", id: "t1", kind: "read", text: "reading ~/secret.md", done: false });
  trackOut(ws, { type: "tool", seat: "codex", id: "t1", kind: "read", text: "reading ~/secret.md", done: true, ok: true });
  trackOut(ws, { type: "ran", rid: "r1", out: "password=hunter2" });
  now = new Date(now.getTime() + 41_000);
  trackOut(ws, { type: "done", seat: "codex", sessionId: "s1", ok: true, turns: 3 });
  const got = lines();
  assert.deepEqual(got.map((l) => l.name), ["face.hello", "turn.start", "turn.tool", "turn.done"]);
  assert.deepEqual(got[2].props, { kind: "read", ok: true });
  assert.deepEqual(got[3].props, { ok: true, stopped: false, turns: 3, secs: 41 });
  assert.equal(got[3].face, "notch");
  assert.doesNotMatch(readFileSync(dayFile(), "utf8"), /secret|hunter2/);
});

test("a message sent to every face is counted once", () => {
  const m = { type: "notify", id: "p1", dest: "window", line: "the build is green" };
  const a = sock(), b = sock(), c = sock();
  trackOut(a, m); trackOut(b, m); trackOut(c, m);
  assert.equal(lines().length, 1);
  assert.deepEqual(lines()[0].props, { dest: "window" });
});

test("usage off (by hand in settings): nothing is written, not even the breakage events", () => {
  consent = { usage: false };
  trackIn(sock(), { type: "say", text: "hi" });
  trackIn(sock(), { type: "face.broken", site: "Sidebar", error: "x is not a function at /Users/m/face.tsx:12" });
  track("engine.up");
  assert.ok(!existsSync(dayFile()), "no file at all");
});

test("who: a day's file opens with a tester.who line, the Sol name on the cloud and the Mac's user, both as words; the rest of the day has none", () => {
  track("engine.up");
  trackIn(sock(), { type: "say", text: "hi" });
  const [first, ...rest] = all();
  assert.equal(first.name, "tester.who");
  assert.deepEqual(first.props, { name: "frank", user: "franktsai" });
  assert.equal(first.tester, testerCode());
  assert.deepEqual(rest.map((l) => l.name), ["engine.up", "turn.say"]);
  // not signed in: the name is "" (written as "none", a word the box takes); a user name with a space or an accent is still a word
  who = { name: "", user: "Frank Tsai" };
  assert.deepEqual(whoNow(), { name: "", user: "Frank-Tsai" });
  assert.equal(asWord("  mårco/x"), "m-rco-x");
  assert.equal(asWord("a".repeat(100)).length, 64);
  // the next day's file opens with the who of that day
  now = new Date(2026, 9, 29, 9, 0, 0);
  track("engine.up");
  assert.deepEqual(all()[0].props, { name: "none", user: "Frank-Tsai" });
});

test("the address: the team's hub, wss or ws, becomes the box's /relay/track; no hub, no address", () => {
  assert.equal(trackUrlOf("wss://cloud.matterfold.tech/relay"), "https://cloud.matterfold.tech/relay/track");
  assert.equal(trackUrlOf("ws://127.0.0.1:8787/relay?x=1"), "http://127.0.0.1:8787/relay/track");
  assert.equal(trackUrlOf(""), null);
  assert.equal(trackUrlOf("https://x.y"), null, "not a hub");
});

test("sending: the days before today go once each with the tester, the day and the hash; a file that went is .sent; today stays", async () => {
  mkdirSync(join(home, "track"), { recursive: true });
  const line = JSON.stringify({ at: "2026-10-26T10:00:00.000Z", name: "engine.up" }) + "\n";
  writeFileSync(join(home, "track", "2026-10-26.jsonl"), line);
  writeFileSync(join(home, "track", "2026-10-27.jsonl"), line + line);
  track("engine.up");   // today's
  const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
  const f = (async (url: any, init: any) => { posts.push({ url: String(url), headers: init.headers, body: String(init.body) }); return { ok: true, status: 200 }; }) as unknown as typeof fetch;
  const r = await sendPending("https://box.example/track", f);
  assert.deepEqual(r, { sent: ["2026-10-26.jsonl", "2026-10-27.jsonl"], failed: [], pruned: [] });
  assert.equal(posts.length, 2);
  assert.equal(posts[0].headers["x-sol-tester"], testerCode());
  assert.equal(posts[0].headers["x-sol-day"], "2026-10-26");
  assert.match(posts[0].headers["x-sol-sha256"], /^[0-9a-f]{64}$/);
  assert.equal(posts[1].body, line + line);
  const names = readdirSync(join(home, "track")).sort();
  assert.deepEqual(names, ["2026-10-26.sent", "2026-10-27.sent", "2026-10-28.jsonl", "id"]);
  assert.equal(lines().at(-1).name, "track.sent");
  // a second pass sends nothing more
  assert.deepEqual((await sendPending("https://box.example/track", f)).sent, []);
  assert.equal(posts.length, 2);
});

test("sending: a refusal leaves the file for next time; no address sends nothing; files older than 90 days go", async () => {
  mkdirSync(join(home, "track"), { recursive: true });
  const old = new Date(now.getTime() - (KEEP_DAYS + 1) * 86_400_000);
  const oldName = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, "0")}-${String(old.getDate()).padStart(2, "0")}`;
  writeFileSync(join(home, "track", `${oldName}.sent`), "x\n");
  writeFileSync(join(home, "track", "2026-10-27.jsonl"), "{\"name\":\"engine.up\"}\n");
  const no = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await sendPending("https://box.example/track", no), { sent: [], failed: ["2026-10-27.jsonl"], pruned: [`${oldName}.sent`] });
  assert.ok(existsSync(join(home, "track", "2026-10-27.jsonl")));
  let called = 0;
  const count = (async () => { called++; return { ok: true, status: 200 }; }) as unknown as typeof fetch;
  assert.deepEqual((await sendPending(null, count)).sent, []);
  assert.equal(called, 0);
  // the box already has it: counted as sent
  const dup = (async () => ({ ok: false, status: 409 })) as unknown as typeof fetch;
  assert.deepEqual((await sendPending("https://box.example/track", dup)).sent, ["2026-10-27.jsonl"]);
});

test("the tables name only words, and every name is fixed: no slash, nothing over 64", () => {
  for (const [t, row] of [...Object.entries(IN), ...Object.entries(OUT)]) {
    assert.match(row.name, /^[a-z][a-z0-9.]*$/, `${t} -> ${row.name}`);
    assert.ok(row.name.length <= 64);
  }
  assert.equal(band(0), "0"); assert.equal(band(20), "1-20"); assert.equal(band(21), "21-100"); assert.equal(band(5000), "2001-");
  assert.equal(hashOf("/a").length, 12);
  assert.notEqual(hashOf("/a"), hashOf("/b"));
  const salted = hashOf("/Users/franktsai/projects/sol");
  assert.notEqual(salted, createHash("sha256").update("/Users/franktsai/projects/sol").digest("hex").slice(0, 12), "salted with a secret made on this Mac, so a common path cannot be guessed");
  assert.match(readFileSync(join(home, "track", "salt"), "utf8").trim(), /^[a-f0-9]{32}$/);
});

test("a message type that is not shaped like one is msg.other, whatever it says", () => {
  const ws = sock();
  trackIn(ws, { type: "tell marco the rent is late" });
  trackIn(ws, { type: "a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r" });
  trackIn(ws, { type: "Sticky.Make" });
  trackIn(ws, { type: "sticky.make" });
  assert.deepEqual(lines().map((l) => l.name), ["msg.other", "msg.other", "msg.other", "msg.sticky.make"]);
  assert.doesNotMatch(readFileSync(dayFile(), "utf8"), /rent/);
});

test("a message to every face is counted on no face, before the sockets see it", () => {
  const ws = sock();
  trackIn(ws, { type: "hello", face: "notch" });
  const m = { type: "notify", id: "p1", dest: "notch", line: "x" };
  trackOut(EVERY, m); trackOut(ws, m);
  assert.deepEqual(lines().slice(1).map((l) => [l.name, l.face]), [["ping.sent", ""]]);
});

test("a home that cannot be written never throws into the engine: the count is lost, the message still goes", () => {
  writeFileSync(join(home, "track"), "a file where the folder should be");
  const ws = sock();
  assert.doesNotThrow(() => trackIn(ws, { type: "say", text: "hi" }));
  assert.doesNotThrow(() => trackOut(ws, { type: "done", ok: true }));
  assert.doesNotThrow(() => track("engine.up"));
  assert.match(testerCode(), /^t_[a-z0-9]{10}$/, "a code kept in memory for this run");
});

test("usage off: a day already on the Mac stays and goes nowhere; the headers of a post carry who", async () => {
  mkdirSync(join(home, "track"), { recursive: true });
  const use = "{\"name\":\"turn.say\",\"props\":{\"len\":\"1-20\"}}\n";
  writeFileSync(join(home, "track", "2026-10-27.jsonl"), use);
  consent = { usage: false };
  const posts: Record<string, string>[] = [];
  const f = (async (_u: any, init: any) => { posts.push(init.headers); return { ok: true, status: 200 }; }) as unknown as typeof fetch;
  assert.deepEqual((await sendPending("https://box.example/track", f)).sent, []);
  assert.equal(posts.length, 0);
  assert.ok(existsSync(join(home, "track", "2026-10-27.jsonl")));
  consent = { usage: true };
  assert.deepEqual((await sendPending("https://box.example/track", f)).sent, ["2026-10-27.jsonl"]);
  assert.equal(posts[0]!["x-sol-who"], "frank");
  assert.equal(posts[0]!["x-sol-user"], "franktsai");
});

test("a day the box refuses for good (413, 400) is kept as .refused and not asked again; 429 and a failure wait", async () => {
  mkdirSync(join(home, "track"), { recursive: true });
  for (const d of ["2026-10-24", "2026-10-25", "2026-10-26"]) writeFileSync(join(home, "track", `${d}.jsonl`), "{\"name\":\"engine.up\"}\n");
  const answers: Record<string, number> = { "2026-10-24": 413, "2026-10-25": 429, "2026-10-26": 400 };
  const f = (async (_u: any, init: any) => ({ ok: false, status: answers[init.headers["x-sol-day"]] })) as unknown as typeof fetch;
  const r = await sendPending("https://box.example/track", f);
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.failed.sort(), ["2026-10-24.jsonl", "2026-10-25.jsonl", "2026-10-26.jsonl"]);
  assert.deepEqual(readdirSync(join(home, "track")).filter((n) => n !== "id").sort(), ["2026-10-24.refused", "2026-10-25.jsonl", "2026-10-26.refused"]);
  const again = await sendPending("https://box.example/track", f);
  assert.deepEqual(again.failed, ["2026-10-25.jsonl"], "only the one told to slow down is asked again");
});

test("after a restart mid-day the cap counts the lines already in the file", () => {
  mkdirSync(join(home, "track"), { recursive: true });
  writeFileSync(dayFile(), "{\"name\":\"engine.up\"}\n".repeat(MAX_LINES_A_DAY - 1));
  setTrackHome(home, { version: "x", consent: () => consent, now: () => now });   // the restart
  track("engine.up");
  track("engine.up");
  track("engine.up");
  const got = lines();
  assert.equal(got.length, MAX_LINES_A_DAY + 1);
  assert.equal(got.at(-1).name, "track.capped");
});

test("a flood stops at the day's cap with one track.capped line", () => {
  for (let i = 0; i < MAX_LINES_A_DAY + 50; i++) track("engine.up");
  const got = lines();
  assert.equal(got.length, MAX_LINES_A_DAY + 1);
  assert.deepEqual(got.at(-1).name, "track.capped");
  assert.equal(all().length, MAX_LINES_A_DAY + 2, "with the who line: what the box takes at most (cloud/src/track.ts LINES_MAX)");
  assert.equal(track("engine.up"), null, "past the cap, nothing was written");
  // the other tools' lines have their own file and their own cap: a full day does not stop them
  assert.ok(track("files.plan", { claude: "claude_max" }, { kind: "files" }));
  assert.deepEqual(all(now).length, MAX_LINES_A_DAY + 2);
  assert.equal(readFileSync(dayFile(now, "files"), "utf8").trim().split("\n").length, 2, "its who line and the one line");
  now = new Date(now.getTime() + 86_400_000);   // a new day counts again
  track("engine.up");
  assert.equal(lines().length, 1);
});

test("no home set: nothing is written and nothing throws", () => {
  setTrackHome("");
  assert.equal(track("engine.up"), null);
  trackIn(sock(), { type: "say", text: "x" });
  trackOut(sock(), { type: "done" });
});
