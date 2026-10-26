// A Drive room (#152): its record in a Google Drive folder, behind the same interface as GitHub's and the cloud's. Every
// test here runs against a fake of the Drive API in memory (the calls record/drive.ts makes, answered the way Drive does:
// v3 for listing and reading, v2's etag and its If-Match PUT for compare-and-swap), so nothing reaches Google.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeDriveRecord, driveFolderWritable, driveFolderId, folderOfRecord, partsOf, quoted, oldest, membersOf, isMember, canEdit, driveMembers, DRIVE_API } from "../src/team/record/drive.js";
import { routed, isGithubRecord, type RoomRecord } from "../src/team/record.js";
import { recordOf, cleanRoom } from "../src/team/settings.js";
import { changeThings, readThings, forgetBranches, forgetThings, agentAdd } from "../src/team/things.js";
import { setGoal, addGoalFile, readGoal } from "../src/team/goal.js";
import { makeRoom } from "../src/team/rooms.js";
import { connectDrive, driveToken, disconnectDrive, driveAccount, driveForFace, driveConsentUrl, resetDrive, REVOKE_URL } from "../src/team/drive.js";
import { planStart } from "../src/team/start.js";

const FOLDER = "application/vnd.google-apps.folder";
const ROOT = "1RoomFolderAbCdEfGhIjKlMnOp";

// ---- the fake Drive ----
type F = { id: string; name: string; mimeType: string; parents: string[]; createdTime: string; trashed: boolean; content: Buffer; etag: string; version: number };
function fakeDrive(o: { token?: string } = {}) {
  const files = new Map<string, F>();
  let n = 0, clock = 1_000;
  const time = () => new Date(Date.UTC(2026, 9, 26, 0, 0, 0, clock++)).toISOString();
  const add = (x: Partial<F> & { name: string; parents: string[] }): F => {
    const f: F = { id: `id${String(++n).padStart(12, "0")}x`, mimeType: "text/plain", createdTime: time(), trashed: false, content: Buffer.alloc(0), version: 1, etag: "", ...x };
    f.etag = `"e${f.id}-${f.version}"`;
    files.set(f.id, f);
    return f;
  };
  add({ id: ROOT, name: "class notes", mimeType: FOLDER, parents: ["rootOfMyDrive0"] });
  const hooks: { beforePut?: (f: F) => void; afterCreate?: (f: F) => void } = {};
  const calls: string[] = [];
  const perms: { list: unknown[]; status: number } = { list: [], status: 200 };
  const readOnly = new Set<string>();
  const bump = (f: F, content: Buffer) => { f.content = content; f.version++; f.etag = `"e${f.id}-${f.version}"`; };
  const send = (status: number, v?: unknown) => new Response(v === undefined ? null : typeof v === "string" || Buffer.isBuffer(v) ? v as BodyInit : JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const notFound = () => send(404, { error: { code: 404, message: "File not found", errors: [{ reason: "notFound" }] } });
  const fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const h = new Headers(init.headers);
    calls.push(`${method} ${url.pathname}`);
    if (!url.href.startsWith(DRIVE_API)) return send(500);
    if (h.get("authorization") !== `Bearer ${o.token ?? "tok"}`) return send(401, { error: { code: 401, message: "Invalid Credentials" } });
    const p = url.pathname;
    let m: RegExpExecArray | null;
    if (method === "GET" && p === "/drive/v3/files") {
      const q = url.searchParams.get("q") ?? "";
      const qm = /^'([^']+)' in parents and trashed = false(?: and name = '((?:[^'\\]|\\.)*)')?$/.exec(q);
      if (!qm) return send(400, { error: { message: `bad q ${q}` } });
      const name = qm[2]?.replace(/\\(.)/g, "$1");
      const out = [...files.values()].filter((f) => !f.trashed && f.parents.includes(qm[1]) && (name === undefined || f.name === name));
      return send(200, { files: out.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime, size: String(f.content.length) })) });
    }
    if ((m = /^\/drive\/v3\/files\/([\w-]+)\/permissions$/.exec(p)) && method === "GET") {
      if (!files.has(m[1])) return notFound();
      return perms.status === 200 ? send(200, { permissions: perms.list }) : send(perms.status, { error: { code: perms.status, errors: [{ reason: "insufficientFilePermissions" }] } });
    }
    if ((m = /^\/drive\/v3\/files\/([\w-]+)$/.exec(p))) {
      const f = files.get(m[1]);
      if (!f) return notFound();
      if (method === "GET" && url.searchParams.get("alt") === "media") return new Response(f.content, { status: 200 });
      if (method === "GET") return send(200, { id: f.id, mimeType: f.mimeType, trashed: f.trashed, capabilities: { canAddChildren: !readOnly.has(f.id) } });
      if (method === "PATCH") { const b = JSON.parse(String(init.body)); if (b.trashed === true) f.trashed = true; return send(200, { id: f.id }); }
    }
    if ((m = /^\/drive\/v2\/files\/([\w-]+)$/.exec(p)) && method === "GET") {
      const f = files.get(m[1]);
      return f ? send(200, { etag: f.etag }) : notFound();
    }
    if (method === "POST" && p === "/drive/v3/files") {
      const b = JSON.parse(String(init.body));
      const f = add({ name: b.name, parents: b.parents, mimeType: b.mimeType });
      hooks.afterCreate?.(f);
      return send(200, { id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime });
    }
    if (method === "POST" && p === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "multipart") {
      const body = Buffer.from(init.body as Buffer);
      const boundary = /boundary=(\S+)/.exec(h.get("content-type") ?? "")?.[1] ?? "";
      const parts = body.toString("latin1").split(`--${boundary}`);
      const meta = JSON.parse(parts[1].split("\r\n\r\n")[1].trim());
      const raw = parts[2].slice(parts[2].indexOf("\r\n\r\n") + 4, -2);
      const f = add({ name: meta.name, parents: meta.parents, mimeType: meta.mimeType, content: Buffer.from(raw, "latin1") });
      hooks.afterCreate?.(f);
      return send(200, { id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime });
    }
    if ((m = /^\/upload\/drive\/v2\/files\/([\w-]+)$/.exec(p)) && method === "PUT") {
      const f = files.get(m[1]);
      if (!f) return notFound();
      hooks.beforePut?.(f);
      if (h.get("if-match") && h.get("if-match") !== f.etag) return send(412, { error: { code: 412, message: "Precondition Failed", errors: [{ reason: "conditionNotMet" }] } });
      bump(f, Buffer.from(init.body as Buffer));
      return send(200, { etag: f.etag });
    }
    return send(400, { error: { message: `the fake has no ${method} ${p}` } });
  };
  /** a file at a path under the room's folder, or undefined */
  const at = (path: string): F | undefined => {
    let parent = ROOT;
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const x = oldest([...files.values()].filter((f) => !f.trashed && f.parents.includes(parent) && f.name === parts[i]) as any) as F | undefined;
      if (!x) return undefined;
      if (i === parts.length - 1) return x;
      parent = x.id;
    }
  };
  return { files, fetch: fetch as typeof globalThis.fetch, hooks, calls, perms, readOnly, at, add, bump };
}

const deps = (drive: ReturnType<typeof fakeDrive>, token = "tok") => makeDriveRecord({ token: async () => token, fetch: drive.fetch, settle: 0 });
const REC = `drive:${ROOT}`;
const thingsDeps = (rec: RoomRecord) => ({ record: () => rec });
const fresh = () => { forgetBranches(); forgetThings(); };

// ---- links and names ----

test("a Drive folder's link is read to its id; a file's link, another host and http are refused (pure)", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  for (const ok of [id, `https://drive.google.com/drive/folders/${id}`, `https://drive.google.com/drive/folders/${id}?usp=sharing`, `https://drive.google.com/drive/u/1/folders/${id}`,
    `https://drive.google.com/drive/mobile/folders/${id}/`, `https://drive.google.com/open?id=${id}`, `  https://drive.google.com/drive/folders/${id}  `])
    assert.deepEqual(driveFolderId(ok), { id }, ok);
  for (const [bad, why] of [["", /paste/], [`http://drive.google.com/drive/folders/${id}`, /https/], [`https://drive.google.com/file/d/${id}/view`, /file's link/],
    [`https://docs.google.com/document/d/${id}/edit`, /file's link/], [`https://evil.example/drive/folders/${id}`, /not a Drive/], ["short", /not a Drive/],
    [`https://drive.google.com/drive/folders/${id}/../x`, /not a Drive/], ["https://drive.google.com/drive/my-drive", /not a Drive/]] as const) {
    const r = driveFolderId(bad);
    assert.ok("error" in r && why.test(r.error), `${bad}: ${JSON.stringify(r)}`);
  }
});

test("a Drive room's record is drive:<its first folder>; record() sends drive: file verbs to Drive and nothing else (pure)", async () => {
  const room = cleanRoom({ id: "notes", name: "class notes", provider: "drive", repos: [ROOT] })!;
  assert.equal(recordOf(room), REC);
  assert.equal(folderOfRecord(REC), ROOT);
  assert.equal(folderOfRecord("drive:../x"), "");
  assert.equal(recordOf({ provider: "drive", repos: ["not a folder id"] }), "");
  assert.equal(isGithubRecord(REC), false);
  assert.equal(isGithubRecord("cloud:ABCDEF"), false);
  assert.equal(isGithubRecord("owner/name"), true);
  const said: string[] = [];
  const verbs = (who: string, verb: string, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (...a: unknown[]) => { said.push(`${who} ${verb}.${k} ${a[0]}`); return Promise.resolve(""); }]));
  const fake = (who: string) => ({ files: verbs(who, "files", ["read", "bytes", "readSha", "put", "putBody", "branch", "tree", "list", "lastCommits"]), cards: verbs(who, "cards", ["list"]) }) as unknown as RoomRecord;
  const r = routed(fake("gh"), () => fake("cloud"), () => fake("drive"));
  await r.files.readSha(REC, ".sol/things.json", "main");
  await r.files.readSha("cloud:ABCDEF", ".sol/things.json", "main");
  await r.files.readSha("owner/name", ".sol/things.json", "main");
  await r.cards.list(REC);
  assert.deepEqual(said, [`drive files.readSha ${REC}`, "cloud files.readSha cloud:ABCDEF", "gh files.readSha owner/name", `gh cards.list ${REC}`]);
  await assert.rejects(routed(fake("gh"), () => null).files.read(REC, "x"), /a Drive folder, and this Sol has no Drive \(HTTP 403\)/);
});

test("a record path is .sol's own parts; a name in a query has its quotes escaped (pure)", () => {
  assert.deepEqual(partsOf(".sol/goal/notes v2.md"), [".sol", "goal", "notes v2.md"]);
  for (const bad of ["../x", ".sol/../x", ".sol//x", "/abs", ".sol/a/b/c/d", ".sol/x "]) assert.equal(partsOf(bad), null, bad);
  assert.equal(quoted("it's a\\b"), "'it\\'s a\\\\b'");
});

// ---- the record: things and the goal ----

test("the room's things on Drive: an empty folder is an empty list; an add makes .sol/things.json; a second add updates it in place", async () => {
  fresh();
  const drive = fakeDrive(), rec = deps(drive);
  assert.deepEqual((await readThings(thingsDeps(rec), REC)).file.things, []);
  const a = await changeThings(thingsDeps(rec), REC, { add: { url: "https://docs.google.com/document/d/abc123/edit", name: "essay", by: "franktsai", at: "2026-10-26T10:00:00Z" } });
  assert.ok(!("error" in a) && a.changed);
  const f = drive.at(".sol/things.json")!;
  assert.ok(f, "the file is in .sol under the room's folder");
  assert.equal(drive.at(".sol")!.mimeType, FOLDER);
  const b = await changeThings(thingsDeps(rec), REC, { add: { url: "https://www.figma.com/file/x/board", by: "marco", at: "2026-10-26T10:01:00Z" } });
  assert.ok(!("error" in b) && b.changed);
  assert.equal(drive.at(".sol/things.json")!.id, f.id, "updated, not made again");
  assert.equal([...drive.files.values()].filter((x) => x.name === "things.json").length, 1);
  const read = await readThings(thingsDeps(rec), REC);
  assert.deepEqual(read.file.things.map((t) => [t.name, t.kind, t.addedBy]), [["essay", "doc", "franktsai"], ["board", "figma", "marco"]]);
  assert.equal(read.sha, drive.at(".sol/things.json")!.etag, "the sha is the v2 etag");
});

test("compare-and-swap: a write between my read and my PUT is refused (412), read again, and both changes are kept", async () => {
  fresh();
  const drive = fakeDrive(), rec = deps(drive);
  await changeThings(thingsDeps(rec), REC, { add: { url: "https://example.com/one", by: "franktsai", at: "2026-10-26T10:00:00Z" } });
  // Marco's Sol writes just before mine lands, once
  let once = true;
  drive.hooks.beforePut = (f) => {
    if (!once) return;
    once = false;
    const j = JSON.parse(f.content.toString("utf8"));
    j.things.push({ id: "", name: "marco's", url: "https://example.com/two", kind: "web", addedBy: "marco", at: "2026-10-26T10:00:30Z" });
    drive.bump(f, Buffer.from(JSON.stringify(j)));
  };
  const r = await changeThings(thingsDeps(rec), REC, { add: { url: "https://example.com/three", by: "franktsai", at: "2026-10-26T10:01:00Z" } });
  assert.ok(!("error" in r) && r.changed, JSON.stringify(r));
  const urls = (await readThings(thingsDeps(rec), REC)).file.things.map((t) => t.url);
  assert.deepEqual(urls, ["https://example.com/one", "https://example.com/two", "https://example.com/three"]);
  assert.equal(drive.calls.filter((c) => c.startsWith("PUT /upload/drive/v2/")).length, 2, "the refused one, then the retry (the first add made the file)");
});

test("compare-and-swap: three refusals in a row say so and write nothing over the other's", async () => {
  fresh();
  const drive = fakeDrive(), rec = deps(drive);
  await changeThings(thingsDeps(rec), REC, { add: { url: "https://example.com/one", by: "franktsai", at: "2026-10-26T10:00:00Z" } });
  drive.hooks.beforePut = (f) => drive.bump(f, f.content);   // someone writes every time
  const r = await changeThings(thingsDeps(rec), REC, { add: { url: "https://example.com/two", by: "franktsai", at: "2026-10-26T10:01:00Z" } });
  assert.deepEqual(r, { error: "someone else changed it, try again" });
  drive.hooks.beforePut = undefined;
  assert.deepEqual((await readThings(thingsDeps(rec), REC)).file.things.map((t) => t.url), ["https://example.com/one"]);
});

test("two Sols make .sol/things.json at once: the younger file goes to the trash, its maker reads the older and adds again", async () => {
  fresh();
  const drive = fakeDrive(), rec = deps(drive);
  // the .sol folder is there; Marco's things.json lands just before mine, older by a millisecond
  const sol = drive.add({ name: ".sol", parents: [ROOT], mimeType: FOLDER });
  drive.hooks.afterCreate = (mine) => {
    if (mine.name !== "things.json" || drive.hooks.afterCreate === undefined) return;
    drive.hooks.afterCreate = undefined;
    const theirs = drive.add({ name: "things.json", parents: [sol.id], content: Buffer.from(JSON.stringify({ v: 1, things: [{ name: "marco's", url: "https://example.com/m", kind: "web", addedBy: "marco", at: "2026-10-26T10:00:00Z" }] })) });
    theirs.createdTime = "2026-01-01T00:00:00.000Z";
  };
  const r = await changeThings(thingsDeps(rec), REC, { add: { url: "https://example.com/f", by: "franktsai", at: "2026-10-26T10:00:01Z" } });
  assert.ok(!("error" in r) && r.changed, JSON.stringify(r));
  const live = [...drive.files.values()].filter((x) => x.name === "things.json" && !x.trashed);
  assert.equal(live.length, 1, "one file stays");
  assert.equal([...drive.files.values()].filter((x) => x.name === "things.json" && x.trashed).length, 1, "mine is in the trash, not deleted");
  assert.deepEqual((await readThings(thingsDeps(rec), REC)).file.things.map((t) => t.url), ["https://example.com/m", "https://example.com/f"]);
});

test("the goal and its files on Drive: set, a file beside it, listed with sizes, read back", async () => {
  fresh();
  const drive = fakeDrive(), rec = deps(drive);
  const g = await setGoal(thingsDeps(rec), REC, { title: "Ship the essay by Friday", lines: "draft Wed\nreview Thu", by: "franktsai", at: "2026-10-26T10:00:00Z" });
  assert.ok(!("error" in g), JSON.stringify(g));
  const f = await addGoalFile(thingsDeps(rec), REC, { name: "outline.md", text: "# outline\n- one" });
  assert.ok(!("error" in f), JSON.stringify(f));
  const read = await readGoal(thingsDeps(rec), REC);
  assert.equal(read.title, "Ship the essay by Friday");
  assert.equal(read.lines, "draft Wed\nreview Thu");
  assert.deepEqual(read.files.map((x) => [x.name, x.size]), [["outline.md", 15]]);
  assert.ok(drive.at(".sol/goal/outline.md"));
  assert.ok(drive.at(".sol/goal.md"));
  // the same file again with the same text is no write
  const puts = drive.calls.length;
  await addGoalFile(thingsDeps(rec), REC, { name: "outline.md", text: "# outline\n- one" });
  assert.equal(drive.calls.filter((c, i) => i >= puts && /^(PUT|POST)/.test(c)).length, 0);
  // a goal with no folder yet lists no files
  fresh();
  const empty = fakeDrive();
  assert.deepEqual((await readGoal(thingsDeps(deps(empty)), REC)).files, []);
});

test("a folder that is gone, trashed, not a folder or not shared is refused, never read as an empty room", async () => {
  fresh();
  const drive = fakeDrive(), rec = deps(drive);
  await assert.rejects(readThings(thingsDeps(rec), "drive:1NoSuchFolderAtAllAbCdEf"), /gone, or not shared with you \(HTTP 403\)/);
  fresh();
  drive.files.get(ROOT)!.trashed = true;
  await assert.rejects(readThings(thingsDeps(rec), REC), /in the trash \(HTTP 403\)/);
  fresh();
  const notAFolder = drive.add({ name: "a doc", parents: ["x"], mimeType: "application/vnd.google-apps.document" });
  await assert.rejects(readThings(thingsDeps(rec), `drive:${notAFolder.id}`), /not a folder/);
  // a write to it says so in the room's words
  fresh();
  const r = await changeThings(thingsDeps(rec), `drive:${notAFolder.id}`, { add: { url: "https://example.com/x", by: "franktsai", at: "2026-10-26T10:00:00Z" } });
  assert.ok("error" in r && /couldn't read the room's things: that Drive link is not a folder/.test(r.error), JSON.stringify(r));
});

test("Drive not connected, or its token refused: the read says to connect, and a refused token is dropped for a fresh one", async () => {
  fresh();
  const drive = fakeDrive();
  const none = makeDriveRecord({ token: async () => "", fetch: drive.fetch, settle: 0 });
  const r = await changeThings(thingsDeps(none), REC, { add: { url: "https://example.com/x", by: "f", at: "2026-10-26T10:00:00Z" } });
  assert.ok("error" in r && /connect Google Drive first/.test(r.error), JSON.stringify(r));
  fresh();
  let stale = 0;
  const wrong = makeDriveRecord({ token: async () => "expired", stale: () => { stale++; }, fetch: drive.fetch, settle: 0 });
  await assert.rejects(readThings(thingsDeps(wrong), REC), /connect it again \(HTTP 401\)/);
  assert.equal(stale, 1);
  // a reader whose PUT Drive refuses (403): "you can't write to this room yet"
  fresh();
  const rec = deps(drive);
  await changeThings(thingsDeps(rec), REC, { add: { url: "https://example.com/one", by: "f", at: "2026-10-26T10:00:00Z" } });
  const ro = makeDriveRecord({ token: async () => "tok", settle: 0, fetch: (async (u: string | URL | Request, init?: RequestInit) => (String(init?.method).toUpperCase() === "PUT"
    ? new Response(JSON.stringify({ error: { code: 403, errors: [{ reason: "insufficientFilePermissions" }] } }), { status: 403 }) : drive.fetch(u, init))) as typeof fetch });
  fresh();
  const w = await changeThings(thingsDeps(ro), REC, { add: { url: "https://example.com/two", by: "f", at: "2026-10-26T10:00:00Z" } });
  assert.deepEqual(w, { error: "you can't write to this room yet" });
});

test("an agent's add in a Drive room is refused when my agent may not speak in Cowork, and said in Cowork's words", async () => {
  fresh();
  const rec = deps(fakeDrive());
  assert.match(await agentAdd(thingsDeps(rec), { repo: REC, mayGitHub: false, login: "f", url: "https://example.com" }), /may not speak in Cowork/);
  assert.match(await agentAdd(thingsDeps(rec), { repo: REC, mayGitHub: true, login: "f", url: "https://example.com" }), /^added web/);
});

test("a session started in a Drive room starts in a folder of its own, as a cloud room's does (pure)", () => {
  const p = planStart({ text: "hi", room: { id: "notes", provider: "drive" }, record: REC, folders: {}, home: "/home/x", things: [], goal: "" });
  assert.ok(!("error" in p) && p.make && p.cwd === p.make && p.repo === "", JSON.stringify(p));
});

// ---- who is in ----

test("members are the folder's sharing: users and groups by email; anyone-with-the-link and a domain let nobody in by themselves (pure)", () => {
  const m = membersOf([
    { type: "user", role: "owner", emailAddress: "Frank@Example.com", displayName: "Frank" },
    { type: "user", role: "writer", emailAddress: "marco@example.com", displayName: "Marco‮" },
    { type: "user", role: "reader", emailAddress: "isaac@example.com" },
    { type: "group", role: "commenter", emailAddress: "class@example.edu" },
    { type: "user", role: "writer", emailAddress: "gone@example.com", deleted: true },
    { type: "user", role: "writer", emailAddress: "not an email" },
    { type: "user", role: "superuser", emailAddress: "odd@example.com" },
    { type: "anyone", role: "reader" },
    { type: "domain", role: "reader", domain: "example.edu" },
    { type: "user", role: "reader", emailAddress: "frank@example.com" },
  ]);
  assert.deepEqual(m.people.map((p) => [p.email, p.role]), [["frank@example.com", "owner"], ["marco@example.com", "writer"], ["isaac@example.com", "reader"], ["class@example.edu", "commenter"]]);
  assert.equal(m.people[1].name, "Marco", "a format character is dropped");
  assert.equal(m.anyone, true);
  assert.equal(m.domain, "example.edu");
  assert.equal(isMember(m, "MARCO@example.com "), true);
  assert.equal(isMember(m, "stranger@example.edu"), false, "a domain share lets nobody in by name");
  assert.equal(isMember(m, "gone@example.com"), false);
  assert.equal(canEdit(m, "marco@example.com"), true);
  assert.equal(canEdit(m, "isaac@example.com"), false);
  const unknown = { known: false, people: m.people, anyone: false, domain: "" };
  assert.equal(isMember(unknown, "frank@example.com"), false, "unknown sharing is denied, even for a name in it");
});

test("the folder's sharing read with my token: listed people; a reader's 403 or no token is unknown, never nobody", async () => {
  const drive = fakeDrive();
  drive.perms.list = [{ type: "user", role: "owner", emailAddress: "frank@example.com" }, { type: "user", role: "writer", emailAddress: "marco@example.com" }];
  const got = await driveMembers({ token: async () => "tok", fetch: drive.fetch }, ROOT);
  assert.equal(got.known, true);
  assert.deepEqual(got.people.map((p) => p.email), ["frank@example.com", "marco@example.com"]);
  drive.perms.status = 403;
  const ro = await driveMembers({ token: async () => "tok", fetch: drive.fetch }, ROOT);
  assert.deepEqual([ro.known, ro.people, ro.error], [false, [], "only the folder's editors can see who it is shared with"]);
  const none = await driveMembers({ token: async () => "", fetch: drive.fetch }, ROOT);
  assert.equal(none.known, false);
  assert.match(none.error!, /connect Google Drive/);
  assert.equal((await driveMembers({ token: async () => "tok", fetch: drive.fetch }, "../x")).known, false);
});

// ---- making a Drive room ----

test("a Drive room is made from a name and a folder's link: the folder is checked first, then the room is added and registered", async () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  let team: any = { me: { login: "franktsai" }, rooms: [], room: "", relay: { url: "", key: "k" } };
  const registered: unknown[] = [];
  const checked: string[] = [];
  const d: any = {
    team: () => team,
    patch: (p: any) => { team = { ...team, ...p, rooms: (p.rooms ?? team.rooms).map((r: any) => cleanRoom(r)).filter(Boolean) }; return team; },
    local: { register: (room: unknown) => { registered.push(room); return { code: "K7QX2M" }; }, lookup: () => null, taken: () => false },
    fetch: async () => new Response("{}"), token: async () => "", ticket: async () => "",
    record: () => ({ room: { make: async () => { throw new Error("no repository is made for a Drive room"); } } }),
    driveCheck: async (folder: string) => { checked.push(folder); return folder === id ? null : "this Drive folder is gone, or not shared with you"; },
  };
  assert.deepEqual(await makeRoom(d, { name: "class notes", hub: "", drive: "https://drive.google.com/file/d/x1234567890/view" }), { error: "that is a file's link; a room is a Drive folder" });
  assert.deepEqual(await makeRoom(d, { name: "class notes", hub: "", drive: "1SomeoneElsesFolder0000" }), { error: "this Drive folder is gone, or not shared with you" });
  const r = await makeRoom(d, { name: "class notes", hub: "", drive: `https://drive.google.com/drive/folders/${id}?usp=sharing` });
  assert.ok("room" in r, JSON.stringify(r));
  assert.deepEqual([r.room.provider, r.room.repos, r.room.code, r.room.mine], ["drive", [id], "K7QX2M", true]);
  assert.equal(recordOf(r.room), `drive:${id}`);
  assert.deepEqual(registered, [{ name: "class notes", provider: "drive", org: "", repos: [id] }]);
  assert.deepEqual(checked, ["1SomeoneElsesFolder0000", id]);
  assert.equal(team.room, r.room.id);
  const no = await makeRoom({ ...d, driveCheck: undefined }, { name: "x", hub: "", drive: id });
  assert.deepEqual(no, { error: "this Sol has no Google Drive" });
});

// ---- connecting Drive (the engine's side of the loopback flow) ----

test("connect Google Drive: the system browser goes to Google with offline access and PKCE; the code goes to the cloud with my ticket; the refresh token is kept 0600, the access token in memory", async () => {
  resetDrive();
  const dir = mkdtempSync(join(tmpdir(), "sol-drive-"));
  const file = join(dir, "drive", "account.json");
  const hub = "http://127.0.0.1:9/relay";
  const seen: { path: string; auth: string; body: any }[] = [];
  let now = 1_000_000;
  const fetch = (async (u: string | URL | Request, init: RequestInit = {}) => {
    const url = String(u);
    if (url === `${hub}/drive`) return new Response(JSON.stringify({ client: "123-abc.apps.googleusercontent.com", scopes: "openid email https://www.googleapis.com/auth/drive" }));
    if (url === REVOKE_URL) { seen.push({ path: "revoke", auth: "", body: String(init.body) }); return new Response("{}"); }
    if (url.startsWith("http://127.0.0.1:") && url.includes("/done")) return globalThis.fetch(url);
    const body = JSON.parse(String(init.body));
    seen.push({ path: url.slice(hub.length), auth: new Headers(init.headers).get("authorization") ?? "", body });
    if (url === `${hub}/drive/token`) return new Response(JSON.stringify({ access: "ya29.first", until: now + 3_600_000, refresh: "1//refresh", scope: "openid email https://www.googleapis.com/auth/drive", email: "frank@example.com" }));
    if (url === `${hub}/drive/refresh`) return body.refresh === "1//refresh" ? new Response(JSON.stringify({ access: "ya29.second", until: now + 3_600_000 })) : new Response("{}", { status: 401 });
    return new Response("{}", { status: 404 });
  }) as typeof globalThis.fetch;
  let opened = "";
  const d = { file, ticket: async () => "sol1.ticket", fetch, now: () => now, open: (u: string) => { opened = u; } };
  const p = connectDrive(hub, d);
  while (!opened) await new Promise((r) => setTimeout(r, 5));
  const consent = new URL(opened);
  assert.equal(consent.origin + consent.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(consent.searchParams.get("access_type"), "offline");
  assert.equal(consent.searchParams.get("code_challenge_method"), "S256");
  assert.match(consent.searchParams.get("scope")!, /auth\/drive$/);
  const redirect = consent.searchParams.get("redirect_uri")!;
  assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+\/done$/);
  // a page that is not ours is refused and the wait goes on
  assert.equal((await globalThis.fetch(`${redirect}?state=wrong&code=x`)).status, 400);
  const page = await globalThis.fetch(`${redirect}?state=${consent.searchParams.get("state")}&code=4/abc`);
  assert.match(await page.text(), /Google Drive is connected/);
  assert.deepEqual(await p, { ok: true, email: "frank@example.com", scope: "openid email https://www.googleapis.com/auth/drive" });
  const sent = seen.find((x) => x.path === "/drive/token")!;
  assert.equal(sent.auth, "Bearer sol1.ticket");
  assert.equal(sent.body.code, "4/abc");
  assert.equal(sent.body.redirect, redirect);
  assert.match(sent.body.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, "drive")).mode & 0o777, 0o700);
  const kept = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(kept).sort(), ["at", "email", "hub", "refresh", "scope"], "never the access token");
  assert.deepEqual(driveForFace(driveAccount(file)), { connected: true, email: "frank@example.com", whole: true });
  // the access token held, then refreshed through the cloud a minute before its hour ends
  assert.equal(await driveToken(d), "ya29.first");
  now += 3_600_000 - 30_000;
  assert.equal(await driveToken(d), "ya29.second");
  assert.equal(seen.filter((x) => x.path === "/drive/refresh").length, 1);
  // let go: revoked at Google, forgotten here
  assert.equal(await disconnectDrive(d), true);
  assert.match(seen.find((x) => x.path === "revoke")!.body, /token=1%2F%2Frefresh/);
  assert.equal(existsSync(file), false);
  assert.equal(await driveToken(d), "");
  resetDrive();
});

test("a refresh Google refuses forgets the connection; no Sol ticket, no cloud Drive: connect says why", async () => {
  resetDrive();
  const dir = mkdtempSync(join(tmpdir(), "sol-drive-"));
  const file = join(dir, "drive", "account.json");
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, "drive"), { recursive: true });
  writeFileSync(file, JSON.stringify({ hub: "https://cloud.example.com/relay", refresh: "1//old", scope: "x", email: "", at: 1 }));
  const d = { file, ticket: async () => "sol1.t", fetch: (async () => new Response(JSON.stringify({ error: "Google Drive wants you to connect it again" }), { status: 401 })) as typeof fetch };
  assert.equal(await driveToken(d), "");
  assert.equal(existsSync(file), false);
  resetDrive();
  const off = { file, ticket: async () => "sol1.t", fetch: (async () => new Response(JSON.stringify({ error: "this cloud has no Google Drive yet" }), { status: 404 })) as typeof fetch, open: () => assert.fail("no browser") };
  assert.deepEqual(await connectDrive("https://cloud.example.com/relay", off), { ok: false, error: "this cloud has no Google Drive yet" });
  const noTicket = { ...off, ticket: async () => "", fetch: (async () => new Response(JSON.stringify({ client: "c", scopes: "s" }))) as typeof fetch };
  assert.deepEqual(await connectDrive("https://cloud.example.com/relay", noTicket), { ok: false, error: "sign in to Sol first: Settings › me › Sol" });
  assert.deepEqual(await connectDrive("http://example.com/relay", off), { ok: false, error: "Drive is connected through a cloud over https only" });
  assert.match(driveConsentUrl("c", "s", "http://127.0.0.1:1/done", "st", "ch"), /prompt=consent\+select_account/);
});

test("a room is made only over a folder its maker can write in: a reader's, a file, one not shared, or no Drive, says why", async () => {
  const drive = fakeDrive();
  const d = { token: async () => "tok", fetch: drive.fetch };
  assert.equal(await driveFolderWritable(d, ROOT), null);
  drive.readOnly.add(ROOT);
  assert.match((await driveFolderWritable(d, ROOT))!, /you can only read this Drive folder/);
  const doc = drive.add({ name: "a doc", parents: [ROOT], mimeType: "application/vnd.google-apps.document" });
  assert.match((await driveFolderWritable(d, doc.id))!, /not a folder/);
  assert.match((await driveFolderWritable(d, "1NoSuchFolderAtAllAbCdEf"))!, /gone, or not shared/);
  assert.match((await driveFolderWritable({ ...d, token: async () => "" }, ROOT))!, /connect Google Drive first/);
});

test("a refresh that comes back after Drive was let go of, or connected anew, is not held", async () => {
  resetDrive();
  const dir = mkdtempSync(join(tmpdir(), "sol-drive-"));
  const file = join(dir, "drive", "account.json");
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, "drive"), { recursive: true });
  writeFileSync(file, JSON.stringify({ hub: "https://cloud.example.com/relay", refresh: "1//old", scope: "x", email: "", at: 1 }));
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const d = { file, ticket: async () => "sol1.t", fetch: (async (u: string) => {
    if (String(u) === REVOKE_URL) return new Response("{}");
    await gate;
    return new Response(JSON.stringify({ access: "ya29.late", until: Date.now() + 3_600_000 }));
  }) as typeof fetch };
  const p = driveToken(d);
  await disconnectDrive(d);
  release();
  assert.equal(await p, "", "the late answer is dropped");
  assert.equal(await driveToken(d), "");
  resetDrive();
});

test("a folder unshared or trashed after it was read is refused at once, never read as empty, and nothing is written into the trash", async () => {
  fresh();
  const drive = fakeDrive(), rec = deps(drive);
  await changeThings(thingsDeps(rec), REC, { add: { url: "https://example.com/one", by: "f", at: "2026-10-26T10:00:00Z" } });
  assert.equal((await readThings(thingsDeps(rec), REC)).file.things.length, 1);
  // trashed: its children are trashed with it, so Drive lists nothing under it
  drive.files.get(ROOT)!.trashed = true;
  for (const f of drive.files.values()) if (f.parents.includes(ROOT) || f.parents.some((p) => drive.files.get(p)?.parents.includes(ROOT))) f.trashed = true;
  fresh();
  await assert.rejects(readThings(thingsDeps(rec), REC), /in the trash \(HTTP 403\)/);
  const n = drive.files.size;
  const w = await changeThings(thingsDeps(rec), REC, { add: { url: "https://example.com/two", by: "f", at: "2026-10-26T10:00:00Z" } });
  assert.ok("error" in w, JSON.stringify(w));
  assert.equal(drive.files.size, n, "nothing made in the trash");
  // unshared: the folder itself is gone from my view
  fresh();
  const drive2 = fakeDrive(), rec2 = deps(drive2);
  await changeThings(thingsDeps(rec2), REC, { add: { url: "https://example.com/one", by: "f", at: "2026-10-26T10:00:00Z" } });
  for (const id of [...drive2.files.keys()]) drive2.files.delete(id);
  fresh();
  await assert.rejects(readThings(thingsDeps(rec2), REC), /gone, or not shared with you \(HTTP 403\)/);
});
