// Talk kept on the cloud and its attachments (#315, the Cowork PRD §9.3; PROTOCOL.md round 53): a file the face sends is
// checked (name, 5 MB, an image only by its first bytes), written into the room's record at .sol/talk/<id>.<ext> (a fake
// record here: nothing reaches GitHub, Drive or the cloud), and the line names it, never its bytes; the same line twice
// is one; the cloud's history merges by id; the face reads only a path under .sol/talk/; an agent reads words only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync, mkdirSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
process.env.SOL_TEAM = join(tmp("sol-team-"), "team.json");
process.env.SOL_TEAM_OFFLINE = "1";
process.env.SOL_STATE = join(tmp("sol-state-"), "work.json");
process.env.SOL_HOME = tmp("sol-home-");
delete process.env.DISCORD_WEBHOOK;
const talk = await import("../src/team/talk.ts");
const { patchTeam } = await import("../src/team/settings.ts");
const { _talkSend, attachmentOf, magicOf, extOf, attach, typed, history, hearRelay, hearHistory, lineFromRelay, saidOf, readTalkFile, olderLines, runTalkTool, capLines, _talkAt, ATTACHMENTS_MAX, OPENABLE, sweepCache, talkSince, threadsWithLines } = talk;
type AttachDeps = import("../src/team/talk.ts").AttachDeps;
type TalkLine = import("../src/team/talk.ts").TalkLine;

patchTeam({ me: { login: "marco", name: "Marco" } });
const fresh = () => _talkAt(tmp("sol-talk-"), tmp("sol-home-"));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64");

/** a record that keeps files in a map; `list` and `put` can be told to fail as a provider does */
function fakeRecord(repo: string, o: { listed?: number; putFails?: Error; up?: boolean; sizes?: Record<string, number> } = {}) {
  const files = new Map<string, Buffer>(), calls: string[] = [], marked: string[] = [];
  const nf = () => Object.assign(new Error("Not Found (HTTP 404)"), { status: 404 });
  const d: AttachDeps = {
    repo: () => repo,
    branch: async () => "main",
    ...(o.up !== undefined ? { up: () => o.up! } : {}),
    quarantine: async (p: string) => { marked.push(p); },
    record: () => ({ files: {
      list: async (_r: string, dir: string) => {
        calls.push(`list ${dir}`);
        if (o.listed !== undefined) return JSON.stringify(Array.from({ length: o.listed }, (_, i) => ({ name: `${i}.png` })));
        if (!files.size) throw nf();
        return JSON.stringify([...files].map(([path, b]) => ({ name: path.split("/").pop(), path, size: o.sizes?.[path] ?? b.length })));
      },
      putBody: async (_r: string, path: string, body: { content: string; message: string }) => { calls.push(`put ${path}`); if (o.putFails) throw o.putFails; files.set(path, Buffer.from(body.content, "base64")); return JSON.stringify({ content: { sha: `sha-of-${path}` } }); },
      remove: async (_r: string, path: string, w: { sha: string }) => { calls.push(`remove ${path} ${w.sha}`); files.delete(path); return ""; },
      bytes: async (_r: string, path: string) => { calls.push(`bytes ${path}`); const b = files.get(path); if (!b) throw nf(); return b; },
    } as never }),
  };
  return { d, files, calls, marked };
}

test("a file from the face: a name of one line, 5 MB at most, base64; an image only by its first bytes", () => {
  assert.equal(magicOf(PNG), "png");
  assert.equal(magicOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assert.equal(magicOf(Buffer.from("GIF89a....")), "gif");
  assert.equal(magicOf(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  assert.equal(magicOf(Buffer.from("<svg onload=alert(1)>")), "", "an svg is no picture here: it can carry a script");
  const img = attachmentOf({ name: "board.jpeg", bytes: b64(PNG), kind: "image" });
  assert.ok(!("error" in img));
  assert.deepEqual([img.kind, img.ext, img.mime], ["image", "png", "image/png"], "the extension is the bytes', not the name's");
  const fake = attachmentOf({ name: "x.png", bytes: b64("#!/bin/sh\nrm -rf ~"), kind: "image" });
  assert.ok(!("error" in fake) && fake.kind === "file", "a name that says png with bytes that do not goes as a file");
  const asFile = attachmentOf({ name: "shot.png", bytes: b64(PNG), kind: "file" });
  assert.ok(!("error" in asFile) && asFile.kind === "file", "sent with the paperclip: a file, as the person chose");
  assert.equal(extOf("Plan.Final.PDF"), "pdf");
  assert.equal(extOf("notes"), "bin");
  assert.equal(extOf("x.tar-gz"), "bin", "an extension is letters and digits");
  assert.equal(extOf("x.abcdefghij"), "bin", "eight at most");
  const named = attachmentOf({ name: " plan\u0000‮.pdf ", bytes: b64("%PDF"), kind: "file" });
  assert.ok(!("error" in named) && named.name === "plan.pdf");
  assert.match((attachmentOf({ name: "a/b.pdf", bytes: b64("x") }) as { error: string }).error, /no \//);
  assert.match((attachmentOf({ name: "x".repeat(101), bytes: b64("x") }) as { error: string }).error, /100 characters/);
  assert.match((attachmentOf({ name: "", bytes: b64("x") }) as { error: string }).error, /needs a name/);
  assert.match((attachmentOf({ name: "a.bin", bytes: "not base64!" }) as { error: string }).error, /did not come through/);
  assert.match((attachmentOf({ name: "a.bin", bytes: "QQ" }) as { error: string }).error, /did not come through/, "base64 as a browser writes it, padded");
  assert.match((attachmentOf({ name: "a.bin", bytes: "" }) as { error: string }).error, /empty/);
  assert.match((attachmentOf({ name: "big.bin", bytes: b64(Buffer.alloc(5 * 1024 * 1024 + 1)) }) as { error: string }).error, /5 MB at most/);
  assert.ok(!("error" in attachmentOf({ name: "max.bin", bytes: b64(Buffer.alloc(5 * 1024 * 1024)) })), "5 MB exactly goes");
});

test("an attachment goes into the room's record at .sol/talk/<id>.<ext>; a GitHub or Drive room is counted first, the cloud counts itself", async () => {
  const a = attachmentOf({ name: "board.png", bytes: b64(PNG), kind: "image" }) as Exclude<ReturnType<typeof attachmentOf>, { error: string }>;
  const gh = fakeRecord("frank/room");
  const done = await attach(gh.d, "line-1", a);
  assert.ok(!("error" in done));
  assert.deepEqual(done.file, { path: ".sol/talk/line-1.png", name: "board.png", size: PNG.length, kind: "image" });
  assert.deepEqual(gh.calls, ["list .sol/talk", "put .sol/talk/line-1.png"]);
  assert.deepEqual(gh.files.get(".sol/talk/line-1.png"), PNG);
  const full = fakeRecord("drive:abc", { listed: ATTACHMENTS_MAX });
  assert.deepEqual(await attach(full.d, "l2", a), { error: "this group keeps 150 attachments at most: remove an old attachment or put it on Drive" });
  assert.deepEqual(full.calls, ["list .sol/talk"], "nothing written past the cap");
  const cloud = fakeRecord("cloud:AAAAAA", { putFails: Object.assign(new Error("this room is full (20 MB); remove something, or put big files on Google Drive and add their links (HTTP 413)"), { status: 413 }) });
  assert.deepEqual(await attach(cloud.d, "l3", a), { error: "this room is full (20 MB); remove something, or put big files on Google Drive and add their links" }, "the cloud's own words, as one sentence");
  assert.deepEqual(cloud.calls, ["put .sol/talk/l3.png"], "the cloud counts inside its own write");
  const shut = fakeRecord("frank/room", { putFails: Object.assign(new Error("HTTP 403"), { status: 403 }) });
  assert.match((await attach(shut.d, "l4", a) as { error: string }).error, /can't write to this group's record yet/);
  assert.deepEqual(await attach(fakeRecord("").d, "l5", a), { error: "this group has no record yet, so it cannot keep a file" });
});

test("a line with a file: kept and shown with it, sent with its four fields; Discord takes no file; an agent's tool sends none", async () => {
  fresh();
  const out: Record<string, unknown>[] = [];
  _talkSend((kind, payload) => { if (kind === "talk") out.push(payload ?? {}); return true; });
  const rec = fakeRecord("cloud:AAAAAA");
  const r = await typed("general", "the board", undefined, { name: "board.png", bytes: b64(PNG), kind: "image" }, rec.d);
  assert.ok(r.ok);
  assert.deepEqual(r.line.file, { path: `.sol/talk/${r.line.id}.png`, name: "board.png", size: PNG.length, kind: "image" });
  assert.equal(r.line.text, "the board");
  assert.ok(rec.files.has(`.sol/talk/${r.line.id}.png`), "the path is the line's id");
  const only = await typed("general", "", undefined, { name: "notes.txt", bytes: b64("hi"), kind: "file" }, rec.d);
  assert.ok(only.ok && only.line.text === "" && only.line.file?.kind === "file", "a file alone is a line");
  assert.deepEqual(history("general").map((l) => l.file?.name), ["board.png", "notes.txt"]);
  const no = await typed("general", "/discord look", undefined, { name: "a.png", bytes: b64(PNG) }, rec.d);
  assert.deepEqual(no, { ok: false, error: "a file does not go to Discord: send it without /discord" });
  const bad = await typed("general", "x", undefined, { name: "a/b", bytes: b64("x") }, rec.d);
  assert.ok(!bad.ok);
  assert.equal(rec.files.size, 2, "a refused file is never written");
  patchTeam({ speak: { cowork: "any" } } as never);
  await runTalkTool("talk", { thread: "general", line: "here is a file", file: { name: "a.png", bytes: b64(PNG) } });
  const agent = history("general").find((l) => l.agent);
  assert.ok(agent && agent.text === "here is a file" && !agent.file, "people only: the tool has no file, and one given is ignored");
  assert.deepEqual(out[0].file, r.line.file, "the relay carries the four fields, never bytes");
  _talkSend(null);
});

test("a line heard with a file: its four fields, the same line twice is one, a bad file dropped and the words kept", () => {
  fresh();
  const f = { path: ".sol/talk/x1.png", name: "board.png", size: 12, kind: "image" };
  const m = { kind: "talk", id: "x1", thread: "general", from: { login: "frank", agent: false }, at: 100, text: "", file: { ...f, bytes: "AAAA" } } as never;
  assert.deepEqual(lineFromRelay(m)?.file, f);
  hearRelay(m); hearRelay(m);
  hearRelay({ ...(m as object), id: "x2" } as never);   // another id (a resend), the same moment, sender, words and file: one line
  hearRelay({ ...(m as object), id: "x5", file: { ...f, path: ".sol/talk/x5.png" } } as never);   // the same moment with another file: two
  assert.deepEqual(history("general").map((l) => l.id), ["x1", "x5"], "by id, then by time, sender, words and file");
  hearRelay({ kind: "talk", id: "x3", thread: "general", from: { login: "frank", agent: false }, at: 102, text: "look", file: { ...f, path: "../../etc/passwd" } } as never);
  const l = history("general").find((x) => x.id === "x3")!;
  assert.equal(l.file, undefined);
  assert.equal(l.text, "look");
  assert.equal(lineFromRelay({ kind: "talk", id: "x4", thread: "general", from: { login: "frank", agent: false }, at: 1, text: "" } as never), null, "no words, no file: no line");
});

test("the cloud's history on a hello merges by id, in time order; a line kept here names its room", () => {
  fresh();
  hearRelay({ kind: "talk", id: "now1", thread: "general", from: { login: "frank", agent: false }, at: 5000, text: "just now" } as never);
  hearHistory({ kind: "talk.history", thread: "general", lines: [
    { kind: "talk", id: "old1", thread: "general", from: { login: "isaac", agent: false }, at: 1000, text: "yesterday" },
    { kind: "talk", id: "now1", thread: "general", from: { login: "frank", agent: false }, at: 5000, text: "just now" },
    { kind: "talk", id: "elsewhere", thread: "#31", from: { login: "isaac", agent: false }, at: 1500, text: "not this thread" },
  ] } as never);
  assert.deepEqual(history("general").map((l) => l.id), ["old1", "now1"], "the older line before, the same line once");
  assert.ok(history("general").every((l) => l.room === "team"), "heard in the room in use");
  assert.equal(history("#31").length, 0, "a history line names its own thread");
  // the cap keeps the newest by time, whatever order they came in
  const mk = (id: string, at: number): TalkLine => ({ id, thread: "general", from: "f", at, text: id, source: "relay" });
  assert.deepEqual(capLines([mk("a", 1), mk("c", 3)], mk("b", 2), 2).map((l) => l.id), ["b", "c"]);
});

test("an agent reads an attachment as words: never its bytes, never its path", () => {
  assert.equal(saidOf("look", { kind: "image", name: "a.png" }), "look [an image]");
  assert.equal(saidOf("", { kind: "file", name: "plan.pdf" }), "[a file: plan.pdf]");
  assert.equal(saidOf("just words"), "just words");
});

test("the face reads only a path under .sol/talk/ of the room in use: bytes for a thumbnail, or a copy to open, never run", async () => {
  const rec = fakeRecord("frank/room");
  rec.files.set(".sol/talk/l1.png", PNG);
  rec.files.set(".sol/talk/l2.sh", Buffer.from("#!/bin/sh\necho hi\n"));
  rec.files.set(".sol/talk/l3.pdf", Buffer.from("%PDF-1.4"));
  for (const p of ["../goal.md", ".sol/things.json", ".sol/talk/../goal.md", "/etc/passwd", ".sol/talk/a/b.png", 7])
    assert.deepEqual(await readTalkFile(rec.d, p), { error: "that is not a file of this group's talk" }, String(p));
  const img = await readTalkFile(rec.d, ".sol/talk/l1.png");
  assert.ok(!("error" in img));
  assert.deepEqual([img.mime, img.size, img.bytes], ["image/png", PNG.length, b64(PNG)]);
  assert.deepEqual(await readTalkFile(rec.d, ".sol/talk/gone.png"), { error: "that file is not in the group any more" });
  const cache = tmp("sol-talk-cache-");
  const sh = await readTalkFile(rec.d, ".sol/talk/l2.sh", { open: true, name: "../../setup.command", cache });
  assert.ok(!("error" in sh) && sh.open === "reveal", "a script is shown in Finder, never opened");
  assert.equal(sh.local, join(cache, "l2", "setup.sh"), "named as sent, the path's own extension, in the line's own folder");
  assert.equal(statSync(sh.local!).mode & 0o777, 0o600, "never executable");
  assert.equal(sh.bytes, undefined, "a copy to open carries no bytes back");
  const pdf = await readTalkFile(rec.d, ".sol/talk/l3.pdf", { open: true, name: "plan.pdf", cache });
  assert.ok(!("error" in pdf) && pdf.open === "open");
  assert.equal(readFileSync(pdf.local!, "utf8"), "%PDF-1.4");
});

test("older lines come from the cloud the room meets on, with my ticket, and are never kept here", async () => {
  fresh();
  let asked = "";
  const fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    asked = `${url} ${init.headers.authorization}`;
    return new Response(JSON.stringify({ thread: "general", more: true, next: { at: 10, id: "o1" }, lines: [{ kind: "talk", id: "o1", thread: "general", from: { login: "isaac", agent: false }, at: 10, text: "long ago", file: { path: ".sol/talk/o1.gif", name: "a.gif", size: 3, kind: "image" } }] }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const d = { where: () => ({ hub: "https://cloud.example/relay", code: "AAAAAA" }), ticket: async () => "sol1.t", fetch };
  const r = await olderLines(d, "general", 5000);
  assert.ok(!("error" in r));
  assert.equal(asked, "https://cloud.example/relay/rooms/AAAAAA/talk?thread=general&before=5000&id=&limit=200 Bearer sol1.t");
  assert.deepEqual(r.lines.map((l) => [l.id, l.file?.kind]), [["o1", "image"]]);
  assert.equal(r.more, true);
  assert.equal(history("general").length, 0, "a page is the face's, never the 200 kept here");
  assert.deepEqual(await olderLines({ ...d, where: () => null }, "general", 5000), { lines: [], more: false }, "a room not on a cloud has no older lines");
  assert.deepEqual(await olderLines({ ...d, ticket: async () => "" }, "general", 5000), { error: "sign in to Sol to read older lines" });
  assert.deepEqual(await olderLines({ ...d, fetch: (async () => new Response("{}", { status: 404 })) as never }, "general", 5000), { error: "you are not in this group on the cloud (or it is gone)" });
  assert.deepEqual(await olderLines(d, "nope", 5000), { error: "no such thread" });
});

test("a line with a file goes first: when it could not go, its file comes back out of the record (P2-10)", async () => {
  fresh();
  const down = fakeRecord("frank/room", { up: false });
  const r = await typed("general", "x", undefined, { name: "a.png", bytes: b64(PNG) }, down.d);
  assert.deepEqual(r, { ok: false, error: "the group is not in sight right now, so the file was not sent; send it again when it is back" });
  assert.deepEqual(down.calls, [], "nothing written while the group is out of sight");
  // up when asked, but the line does not go (no relay in this test): the file written is taken back out, by its sha
  const race = fakeRecord("frank/room", { up: true });
  const r2 = await typed("general", "x", undefined, { name: "a.png", bytes: b64(PNG) }, race.d);
  assert.equal(r2.ok, false);
  assert.equal(race.files.size, 0);
  assert.match(race.calls.at(-1)!, /^remove \.sol\/talk\/[\w-]+\.png sha-of-\.sol\/talk\/[\w-]+\.png$/);
  assert.equal(history("general").length, 0, "and no line names it here");
});

test("a line's file is its own: a path named after another line is dropped (P1-3)", () => {
  const f = { path: ".sol/talk/someone-else.png", name: "board.png", size: 12, kind: "image" };
  const l = lineFromRelay({ kind: "talk", id: "mine", thread: "general", from: { login: "frank", agent: false }, at: 1, text: "look", file: f } as never);
  assert.equal(l?.file, undefined);
  assert.equal(lineFromRelay({ kind: "talk", id: "someone-else", thread: "general", from: { login: "frank", agent: false }, at: 1, text: "", file: f } as never)?.file?.path, f.path);
});

test("an opened copy is quarantined, never a zip or an Office or iWork file opened, and copies go after a day (P1-2, P2-11)", async () => {
  for (const x of ["zip", "docx", "xlsx", "pptx", "doc", "key", "pages", "numbers", "html", "svg", "command", "sh", "app"]) assert.equal(OPENABLE.has(x), false, x);
  assert.ok(OPENABLE.has("pdf") && OPENABLE.has("png"));
  const rec = fakeRecord("frank/room");
  rec.files.set(".sol/talk/d1.docx", Buffer.from("PK\u0003\u0004"));
  const cache = tmp("sol-talk-cache-");
  const r = await readTalkFile(rec.d, ".sol/talk/d1.docx", { open: true, name: "minutes.v2.docx", cache });
  assert.ok(!("error" in r) && r.open === "reveal");
  assert.equal(r.local, join(cache, "d1", "minutes_v2.docx"), "the name a label, the extension the path's");
  assert.deepEqual(rec.marked, [r.local], "marked as from elsewhere before anything opens it");
  // a day later the copy is gone; a fresh one stays
  mkdirSync(join(cache, "fresh"));
  const old = (Date.now() - 2 * 86_400_000) / 1000;
  utimesSync(join(cache, "d1"), old, old);
  assert.equal(sweepCache(cache), 1);
  assert.ok(!existsSync(join(cache, "d1")) && existsSync(join(cache, "fresh")));
});

test("a file over 5 MB in the record is refused from its listed size, never read whole (P2-7)", async () => {
  const rec = fakeRecord("frank/room", { sizes: { ".sol/talk/big.png": 6 * 1024 * 1024 } });
  rec.files.set(".sol/talk/big.png", PNG);
  assert.deepEqual(await readTalkFile(rec.d, ".sol/talk/big.png"), { error: "that file is over 5 MB; it was not read" });
  assert.ok(!rec.calls.some((c) => c.startsWith("bytes")), "the bytes were never asked for");
});

test("each room keeps its own talk; the files from before rooms show in the first room only (P2-6)", async () => {
  const dir = tmp("sol-talk-rooms-");
  writeFileSync(join(dir, "general.json"), JSON.stringify([{ id: "old", thread: "general", from: "frank", at: 1, text: "from before rooms", source: "relay" }]));
  _talkAt(dir, tmp("sol-home-"));
  const room = (id: string, code: string) => ({ id, name: id, provider: "github", org: "", repos: ["marcocyl04-ux/sol-dev"], hub: "", key: "", code, gate: "github", folder: "", mine: true, joined: false });
  patchTeam({ rooms: [room("first", "ABC234"), room("second", "ABC235")], room: "first" } as never);
  assert.deepEqual(history("general").map((l) => l.id), ["old"]);
  hearRelay({ kind: "talk", id: "in-first", thread: "general", from: { login: "isaac", agent: false }, at: 50, text: "hi first" } as never);
  hearRelay({ kind: "talk", id: "half-p1", part: [1, 2], thread: "general", from: { login: "isaac", agent: false }, at: 60, text: "a long " } as never);
  patchTeam({ room: "second" } as never);
  // the second half arrives after the switch: the line is the first room's, where its first half came in
  hearRelay({ kind: "talk", id: "half-p2", part: [2, 2], thread: "general", from: { login: "isaac", agent: false }, at: 61, text: "line" } as never);
  assert.deepEqual(history("general").map((l) => l.id), [], "the second room has none of it");
  assert.deepEqual(threadsWithLines(), []);
  hearRelay({ kind: "talk", id: "in-second", thread: "#4", from: { login: "isaac", agent: false }, at: 70, text: "hi second" } as never);
  assert.deepEqual(talkSince(), { "#4": 70 }, "the newest line the hub stamped, a thread");
  patchTeam({ room: "first" } as never);
  assert.deepEqual(history("general").map((l) => [l.id, l.text]), [["old", "from before rooms"], ["in-first", "hi first"], ["half", "a long line"]]);
  assert.ok(existsSync(join(dir, "first", "general.json")) && existsSync(join(dir, "second", "4.json")), "a folder a room");
  patchTeam({ room: "first" } as never);
});

test("older pages carry the cursor and every line the cloud gave, never cut to 200 (P2-4, P2-5)", async () => {
  fresh();
  let asked = "";
  const many = Array.from({ length: 230 }, (_, i) => ({ kind: "talk", id: `o${i}`, thread: "general", from: { login: "isaac", agent: false }, at: 10 + i, text: `line ${i}` }));
  const fetch = (async (url: string) => { asked = url; return new Response(JSON.stringify({ thread: "general", more: true, next: { at: 10, id: "o0" }, lines: many }), { status: 200 }); }) as unknown as typeof globalThis.fetch;
  const r = await olderLines({ where: () => ({ hub: "https://cloud.example/relay", code: "AAAAAA" }), ticket: async () => "t", fetch }, "general", 5000, "abc-1");
  assert.ok(!("error" in r));
  assert.match(asked, /before=5000&id=abc-1&limit=200$/);
  assert.equal(r.lines.length, 230, "a long line put back together can make a page longer than its rows: all of it");
  assert.deepEqual(r.next, { at: 10, id: "o0" });
});

test("a '-pN' id heard without its part is no line (second review, 3)", () => {
  const f = { path: ".sol/talk/abc.png", name: "a.png", size: 3, kind: "image" };
  assert.equal(lineFromRelay({ kind: "talk", id: "abc-p2", thread: "general", from: { login: "frank", agent: false }, at: 1, text: "x", file: f } as never), null);
  assert.equal(lineFromRelay({ kind: "talk", id: "abc-p2", part: [1, 2], thread: "general", from: { login: "frank", agent: false }, at: 1, text: "x" } as never), null);
  assert.ok(lineFromRelay({ kind: "talk", id: "abc", thread: "general", from: { login: "frank", agent: false }, at: 1, text: "x", file: f } as never)?.file);
});

test("a csv is shown in Finder, not opened; a copy is marked from elsewhere by /usr/bin/xattr (second review, 5)", async () => {
  assert.equal(OPENABLE.has("csv"), false, "a spreadsheet app runs a cell that starts with =");
  if (process.platform !== "darwin") return;
  const { execFileSync } = await import("node:child_process");
  const f = join(tmp("sol-q-"), "x.pdf");
  writeFileSync(f, "%PDF");
  await talk.quarantine(f, 0x65000000 * 1000);
  assert.match(execFileSync("/usr/bin/xattr", ["-p", "com.apple.quarantine", f], { encoding: "utf8" }), /^0081;65000000;Sol;/);
});
