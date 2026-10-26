// The room's things (#194, docs/cowork-ui-design-2026-10-24/PRD.md section 9.1): one file in the record repo,
// `.sol/things.json`. The pure parts (the URL policy, the kind and name read from a link, the stable id, parse and
// serialize, one op on a file) and the compare-and-swap write against a fake record: a conflict read again, three
// conflicts said, a refusal said, nothing lost. Then the cache, who touched a thing last, the face's message, the
// agent's lines, and which repo is a room's record. Nothing here touches GitHub or a real team.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILE = join(mkdtempSync(join(tmpdir(), "sol-team-")), "team.json");
writeFileSync(FILE, JSON.stringify({ me: { login: "frank", name: "Frank" }, repos: ["franktsai2008-eng/room"] }));
process.env.SOL_TEAM = FILE;
process.env.SOL_TEAM_OFFLINE = "1";
const T = await import("../src/team/things.ts");
const S = await import("../src/team/settings.ts");

const DOC = "https://docs.google.com/document/d/1AbC/edit";
const REPO = "https://github.com/franktsai2008-eng/room";

test("the URL policy: https only, host lowercased, fragment dropped; a sign-in, http, file, javascript, this machine, an IP, a bare host refused", () => {
  assert.deepEqual(T.canonicalUrl(" https://Docs.Google.com/document/d/1AbC/edit#heading=h.1 "), { url: DOC });
  assert.deepEqual(T.canonicalUrl("https://example.com:443/a?b=1"), { url: "https://example.com/a?b=1" });
  assert.deepEqual(T.canonicalUrl("https://example.com"), { url: "https://example.com/" });
  for (const [bad, why] of [
    ["", "paste a link"],
    ["not a link", "that is not a link Sol can open"],
    ["http://example.com/x", "only https links; this one is http"],
    ["file:///etc/passwd", "only https links"],
    ["javascript:alert(1)", "only https links"],
    ["data:text/html,hi", "only https links"],
    ["https://user:pw@example.com/", "a link with a sign-in in it is not taken"],
    ["https://user@example.com/", "a link with a sign-in in it is not taken"],
    ["https://localhost:7777/", "a link to this machine or a private network is not taken"],
    ["https://sol.localhost/", "a link to this machine or a private network is not taken"],
    ["https://nucbox.local/", "a link to this machine or a private network is not taken"],
    ["https://127.0.0.1/", "a link to this machine or a private network is not taken"],
    ["https://10.0.0.5/", "a link to this machine or a private network is not taken"],
    ["https://[::1]/", "a link to this machine or a private network is not taken"],
    ["https://intranet/", "a link to this machine or a private network is not taken"],
    ["https://localhost../", "a link to this machine or a private network is not taken"],
    ["https://a..b.com/", "a link to this machine or a private network is not taken"],
    ["https://example.com/?token=abc", "a link with a sign-in in it is not taken"],
    ["https://example.com/?x=1&access_token=abc", "a link with a sign-in in it is not taken"],
    ["https://bucket.s3.amazonaws.com/f.pdf?X-Amz-Signature=abc&X-Amz-Credential=x", "a link with a sign-in in it is not taken"],
    ["https://storage.example.com/f?sig=abc", "a link with a sign-in in it is not taken"],
    ["https://example.com/?api_key=1", "a link with a sign-in in it is not taken"],
    ["https://example.com/" + "a".repeat(2100), "that link is too long"],
    ["https://docs.google.com/document/u/0/", "that is the Google Docs home; paste the link of the file itself"],
    ["https://docs.google.com/document/", "that is the Google Docs home; paste the link of the file itself"],
    ["https://docs.google.com/presentation/u/1/?tgif=d", "that is the Google Slides home; paste the link of the file itself"],
    ["https://docs.google.com/presentation/create", "that is the Google Slides home; paste the link of the file itself"],
    ["https://Docs.Google.com/spreadsheets", "that is the Google Sheets home; paste the link of the file itself"],
    ["https://docs.google.com/spreadsheets/u/0/?ftv=1", "that is the Google Sheets home; paste the link of the file itself"],
  ] as const) assert.deepEqual(T.canonicalUrl(bad), { error: why }, bad);
  // one Google file is taken, also behind an account (/u/1/) and published (/d/e/…)
  for (const ok of [DOC, "https://docs.google.com/document/u/1/d/1AbC/edit", "https://docs.google.com/presentation/d/x/edit",
    "https://docs.google.com/spreadsheets/d/e/2PACX-1v/pubhtml", "https://docs.google.com/forms/d/x"]) assert.ok("url" in T.canonicalUrl(ok), ok);
  // the same answer the second time: a canonical link is its own canonical form (trailing dots, case, fragment)
  for (const u of ["https://Example.com../a#x", DOC, "https://example.com:443/?b=1&a=2", REPO + "/"]) {
    const once = T.canonicalUrl(u); assert.ok("url" in once, u);
    assert.deepEqual(T.canonicalUrl(once.url), once, u);
  }
  assert.deepEqual(T.canonicalUrl("https://Example.com../a#x"), { url: "https://example.com/a" });
  assert.deepEqual(T.canonicalUrl("https://example.com/?node=1&id=2"), { url: "https://example.com/?node=1&id=2" });   // an id is not a secret
});

test("names are one line of plain text: control and format characters gone, so a name never breaks the gh command or turns around on a face", () => {
  const f = T.apply({ v: 1, things: [] }, { add: { url: DOC, name: "Our\u0000 plan\u001b[31m \u202ereversed", by: "frank", at: "2026-10-24T17:00:00.000Z" } });
  assert.equal(f.thing?.name, "Our plan[31m reversed");
  assert.equal(T.nameOf("https://example.com/%E2%80%AEfdp.exe", "file"), "fdp.exe");
});

test("the kind is read from the link, one of seven", () => {
  assert.equal(T.kindOf(DOC), "doc");
  assert.equal(T.kindOf("https://docs.google.com/presentation/d/x/edit"), "slides");
  assert.equal(T.kindOf("https://docs.google.com/spreadsheets/d/x/edit"), "sheet");
  assert.equal(T.kindOf("https://drive.google.com/file/d/x/view"), "file");
  assert.equal(T.kindOf(REPO), "github");
  assert.equal(T.kindOf("https://www.figma.com/design/abc/Cowork-studio?node-id=1"), "figma");
  assert.equal(T.kindOf("https://fordham-my.sharepoint.com/:w:/g/personal/x/EaBc"), "doc");
  assert.equal(T.kindOf("https://fordham-my.sharepoint.com/:x:/g/personal/x/EaBc"), "sheet");
  assert.equal(T.kindOf("https://example.com/paper.pdf"), "file");
  assert.equal(T.kindOf("https://rightfirst-site.vercel.app/"), "web");
  assert.equal(T.kindOf("https://docs.google.com/forms/d/x"), "web");
});

test("one thing, one link (ADDITIONS §5): a Google file by any account, view, query or heading is its /d/<id>/edit; a Drive file its /view; GitHub without www, .git or a trailing slash; share-tracking keys dropped", () => {
  const one = (u: string) => (T.canonicalUrl(u) as { url: string }).url;
  for (const u of [DOC, "https://docs.google.com/document/d/1AbC/edit?usp=sharing", "https://docs.google.com/document/u/1/d/1AbC/view#heading=h.x",
    "https://DOCS.google.com/document/d/1AbC", "https://docs.google.com/document/d/1AbC/preview?tab=t.0", "https://docs.google.com/document/u/0/d/1AbC/copy"]) assert.equal(one(u), DOC, u);
  assert.equal(one("https://docs.google.com/spreadsheets/d/S-1_x/edit?gid=0#gid=0"), "https://docs.google.com/spreadsheets/d/S-1_x/edit");
  assert.equal(one("https://docs.google.com/presentation/u/2/d/P9/present"), "https://docs.google.com/presentation/d/P9/edit");
  assert.equal(one("https://drive.google.com/file/d/F1/view?usp=drive_link"), "https://drive.google.com/file/d/F1/view");
  assert.equal(one("https://drive.google.com/file/u/0/d/F1/edit"), "https://drive.google.com/file/d/F1/view");
  for (const u of [REPO, REPO + "/", REPO + ".git", "https://www.github.com/franktsai2008-eng/room", REPO + "?utm_source=x"]) assert.equal(one(u), REPO, u);
  assert.equal(one(REPO + "/issues/5/"), REPO + "/issues/5");
  assert.equal(one("https://example.com/a?b=1&utm_source=mail&utm_medium=x&fbclid=z"), "https://example.com/a?b=1");
  assert.equal(one("https://example.com/a/"), "https://example.com/a/");   // a page's own slash is kept: some sites tell them apart
  // two pastes of one file are one id; another file is another
  assert.equal(T.idOf(one("https://docs.google.com/document/u/1/d/1AbC/view")), T.idOf(DOC));
  assert.notEqual(T.idOf(one("https://docs.google.com/document/d/2XyZ/edit")), T.idOf(DOC));
  // the app's home is still refused (ADDITIONS §3), and only a /d/<id> is a Google file's kind
  assert.deepEqual(T.canonicalUrl("https://docs.google.com/document/u/0/"), { error: "that is the Google Docs home; paste the link of the file itself" });
  assert.equal(T.kindOf("https://docs.google.com/document/u/0/"), "web");
  assert.equal(T.kindOf("https://docs.google.com/spreadsheets/u/0/d/x/edit"), "sheet");
  assert.equal(T.kindOf("https://drive.google.com/file/"), "web");
});

test("parse of a file written before §5: two links of one Google file are one thing, the first kept, its link in the one form", () => {
  const f = T.parse(JSON.stringify({ v: 1, things: [
    { id: "x", name: "Our plan", url: "https://docs.google.com/document/d/1AbC/edit?usp=sharing", kind: "doc", addedBy: "frank", at },
    { id: "y", name: "plan again", url: "https://docs.google.com/document/u/0/d/1AbC/edit#heading=h.2", kind: "doc", addedBy: "marco", at },
  ] }));
  assert.deepEqual(f.things.map((t) => [t.name, t.url, t.id]), [["Our plan", DOC, T.idOf(DOC)]]);
});

test("an add of a thing already here, by a person or an agent, writes nothing and is heard once: the feed's 'already here, opened the existing one'", async () => {
  const have = T.serialize({ v: 1, things: [{ id: T.idOf(DOC), name: "Our plan", url: DOC, kind: "doc", addedBy: "frank", at }] });
  const r = fakeRecord({ text: have, sha: "aaa" });
  const heard: [string, string, string, boolean][] = [];
  const off = T.onAgain((repo, t, who) => heard.push([repo, t.id, who.by, who.agent]));
  const same = await T.changeThings({ record: () => r.rec }, "o/r", { add: { url: "https://docs.google.com/document/u/1/d/1AbC/view?usp=sharing", by: "marco", at } });
  assert.ok(!("error" in same) && !same.changed && same.thing?.name === "Our plan");
  assert.match(await T.agentAdd({ record: () => r.rec }, { repo: "o/r", mayGitHub: true, login: "isaac", url: DOC + "?usp=sharing", at }), /^already here, so nothing was added: doc · Our plan/);
  off();
  await T.changeThings({ record: () => r.rec }, "o/r", { add: { url: DOC, by: "marco", at } });
  assert.deepEqual(heard, [["o/r", T.idOf(DOC), "marco", false], ["o/r", T.idOf(DOC), "isaac", true]]);
  assert.equal(r.puts.length, 0);
});

test("a name nobody gave: owner/name for GitHub, a Figma file's own name, a file's name, a page's host, a Google thing its kind", () => {
  assert.equal(T.nameOf(REPO, "github"), "franktsai2008-eng/room");
  assert.equal(T.nameOf(REPO + "/issues/5", "github"), "franktsai2008-eng/room · issues/5");
  assert.equal(T.nameOf("https://www.figma.com/design/abc/Cowork-studio-v2?node-id=1", "figma"), "Cowork studio v2");
  assert.equal(T.nameOf("https://example.com/docs/My%20paper.pdf", "file"), "My paper.pdf");
  assert.equal(T.nameOf("https://www.rightfirst-site.vercel.app/", "web"), "rightfirst-site.vercel.app");
  assert.equal(T.nameOf("https://example.com/a/b", "web"), "example.com/a/b");
  assert.equal(T.nameOf(DOC, "doc"), "a doc");
  assert.equal(T.nameOf("https://docs.google.com/spreadsheets/d/x/edit", "sheet"), "a sheet");
});

test("the id is the first eight hex digits of the url's sha-256: stable, and one for one canonical link", () => {
  assert.match(T.idOf(DOC), /^[0-9a-f]{8}$/);
  assert.equal(T.idOf(DOC), T.idOf(DOC));
  assert.notEqual(T.idOf(DOC), T.idOf(REPO));
});

test("parse takes anything and answers a valid file; junk entries are dropped, two for one link are one, the id is the url's", () => {
  assert.deepEqual(T.parse(""), { v: 1, things: [] });
  assert.deepEqual(T.parse("not json"), { v: 1, things: [] });
  assert.deepEqual(T.parse("[1,2]"), { v: 1, things: [] });
  assert.deepEqual(T.parse(JSON.stringify({ v: 7, things: "no" })), { v: 1, things: [], newer: true });   // a newer Sol's file: read, never written (below)
  const f = T.parse(JSON.stringify({ v: 1, things: [
    { id: "wrong000", name: "  Our  plan ", url: "https://Docs.Google.com/document/d/1AbC/edit#x", kind: "slides", addedBy: "frank", at: "2026-10-24T17:00:00.000Z", agent: true },
    { url: DOC, name: "again", addedBy: "marco", at: "2026-10-24T18:00:00.000Z" },     // the same link: the first stays
    { url: "http://example.com/", name: "http" },                                     // refused by the policy
    { url: REPO, kind: "banana", addedBy: "not a login!", at: "yesterday" },          // kind read again; bad by and at emptied
    "junk", null, 7,
  ] }));
  assert.deepEqual(f, { v: 1, things: [
    { id: T.idOf(DOC), name: "Our plan", url: DOC, kind: "slides", addedBy: "frank", at: "2026-10-24T17:00:00.000Z", agent: true },
    { id: T.idOf(REPO), name: "franktsai2008-eng/room", url: REPO, kind: "github", addedBy: "", at: "" },
  ] });
});

test("serialize is one shape; serialize(parse(text)) of a valid file is the text, so a no-op write is never a commit", () => {
  const text = T.serialize({ v: 1, things: [
    { id: T.idOf(DOC), name: "Our plan", url: DOC, kind: "doc", addedBy: "frank", at: "2026-10-24T17:00:00.000Z" },
    { id: T.idOf(REPO), name: "franktsai2008-eng/room", url: REPO, kind: "github", addedBy: "marco", at: "2026-10-24T17:05:00.000Z", agent: true },
  ] });
  assert.equal(T.serialize(T.parse(text)), text);
  assert.ok(text.endsWith("\n"));
  assert.equal(JSON.parse(text).v, 1);
  assert.deepEqual(Object.keys(JSON.parse(text).things[1]), ["id", "name", "url", "kind", "addedBy", "at", "agent"]);
  assert.equal("agent" in JSON.parse(text).things[0], false);   // omitted when false
});

test("apply: an add is a new thing, the same link again changes nothing and answers it, a refused link says why; a remove by id, a missing id says so", () => {
  const at = "2026-10-24T17:00:00.000Z";
  const a = T.apply({ v: 1, things: [] }, { add: { url: DOC + "#h", name: "", by: "frank", at } });
  assert.equal(a.changed, true);
  assert.deepEqual(a.thing, { id: T.idOf(DOC), name: "a doc", url: DOC, kind: "doc", addedBy: "frank", at });
  const b = T.apply(a.file, { add: { url: DOC, name: "Again", by: "marco", at, agent: true } });
  assert.equal(b.changed, false);
  assert.equal(b.thing?.name, "a doc");
  assert.equal(b.file, a.file);
  const c = T.apply(a.file, { add: { url: "http://x.com/", by: "frank", at } });
  assert.deepEqual([c.changed, c.error], [false, "only https links; this one is http"]);
  const d = T.apply(a.file, { add: { url: REPO, name: "the repo", by: "frank", at, agent: true } });
  assert.equal(d.thing?.agent, true);
  assert.equal(d.file.things.length, 2);
  const e = T.apply(d.file, { remove: { id: T.idOf(DOC) } });
  assert.deepEqual([e.changed, e.thing?.id, e.file.things.map((t) => t.id)], [true, T.idOf(DOC), [T.idOf(REPO)]]);
  const f = T.apply(d.file, { remove: { id: "nothere0" } });
  assert.deepEqual([f.changed, f.error], [false, "no such thing"]);
});

// a fake record: the file's text and sha on the default branch, what putBody saw, and what the next put does (a throw
// shaped as runGh throws: gh's first line as the message, its whole word on `full`, `(HTTP nnn)` at the end)
const ghError = (word: string) => Object.assign(new Error(word.split("\n")[0]), { full: word });
function fakeRecord(start: { text: string; sha: string } | null, branch = "main") {
  let on = start;
  const puts: { message: string; branch: string; content: string; sha?: string }[] = [];
  const fail: string[] = [];   // one gh word a put, in order; "" = succeed
  let reads = 0;
  const rec = { files: {
    branch: async (_repo: string) => { if (branch === "gone") throw ghError("gh: Not Found (HTTP 404)"); return branch; },
    readSha: async (_repo: string, path: string, ref: string) => {
      reads++;
      assert.equal(path, ".sol/things.json"); assert.equal(ref, branch);
      if (!on) throw ghError("gh: Not Found (HTTP 404)");
      return JSON.stringify({ sha: on.sha, content: Buffer.from(on.text).toString("base64") });
    },
    putBody: async (_repo: string, _path: string, w: { message: string; branch: string; content: string; sha?: string }) => {
      puts.push(w);
      const f = fail.shift() ?? "";
      if (f) throw ghError(f);
      on = { text: Buffer.from(w.content, "base64").toString("utf8"), sha: `sha${puts.length}` };
      return "";
    },
  } } as any;
  return { rec, puts, fail, on: () => on, reads: () => reads, set: (v: { text: string; sha: string } | null) => { on = v; } };
}
const at = "2026-10-24T17:00:00.000Z";

test("changeThings: a missing file is an empty list; the first add creates it with no sha and the commit says what was added", async () => {
  const r = fakeRecord(null);
  const changed: string[] = [];
  const got = await T.changeThings({ record: () => r.rec, changed: (repo) => changed.push(repo) }, "o/r", { add: { url: DOC, name: "Our plan", by: "frank", at } });
  assert.ok(!("error" in got) && got.changed);
  assert.equal(r.puts.length, 1);
  assert.deepEqual([r.puts[0].message, r.puts[0].branch, r.puts[0].sha], ["things: added Our plan", "main", undefined]);
  assert.equal(T.parse(r.on()!.text).things[0].name, "Our plan");
  assert.deepEqual(changed, ["o/r"]);   // the relay hears it
});

test("changeThings: a put with the sha read; a conflict reads again and applies again, so the other's add is kept and mine lands", async () => {
  const mine = T.serialize({ v: 1, things: [{ id: T.idOf(DOC), name: "Our plan", url: DOC, kind: "doc", addedBy: "frank", at }] });
  const r = fakeRecord({ text: mine, sha: "aaa" });
  // the first put is told the sha moved: meanwhile Marco added the repo
  r.fail.push("gh: .sol/things.json does not match aaa (HTTP 409)");   // GitHub's word when the sha moved
  const theirs = T.serialize({ v: 1, things: [...T.parse(mine).things, { id: T.idOf(REPO), name: "the repo", url: REPO, kind: "github", addedBy: "marco", at }] });
  const origPut = r.rec.files.putBody;
  r.rec.files.putBody = async (repo: string, path: string, w: any) => { const p = origPut(repo, path, w); await p.catch(() => {}); if (r.puts.length === 1) r.set({ text: theirs, sha: "bbb" }); return p; };
  const site = "https://rightfirst-site.vercel.app/";
  const got = await T.changeThings({ record: () => r.rec }, "o/r", { add: { url: site, by: "frank", at } });
  assert.ok(!("error" in got) && got.changed);
  assert.equal(r.puts.length, 2);
  assert.deepEqual(r.puts.map((p) => p.sha), ["aaa", "bbb"]);
  assert.deepEqual(T.parse(r.on()!.text).things.map((t) => t.name), ["Our plan", "the repo", "rightfirst-site.vercel.app"]);   // nothing lost
  assert.equal(r.puts[1].message, "things: added rightfirst-site.vercel.app");
});

test("changeThings: three conflicts say so; a refusal says you can't write yet; a ruleset is a refusal though GitHub says 409; a file that appeared since a 404 is a conflict; a rate limit its own line", async () => {
  const r = fakeRecord({ text: "", sha: "aaa" });
  r.fail.push("gh: .sol/things.json does not match aaa (HTTP 409)", "gh: .sol/things.json does not match aaa (HTTP 409)", "gh: .sol/things.json does not match aaa (HTTP 409)");
  assert.deepEqual(await T.changeThings({ record: () => r.rec }, "o/r", { add: { url: DOC, by: "frank", at } }), { error: "someone else changed it, try again" });
  assert.equal(r.puts.length, 3);
  const f = fakeRecord({ text: "", sha: "aaa" });
  f.fail.push("gh: Resource not accessible by personal access token (HTTP 403)");
  assert.deepEqual(await T.changeThings({ record: () => f.rec }, "o/r", { add: { url: DOC, by: "frank", at } }), { error: "you can't write to this room yet" });
  // a ruleset or protected branch: GitHub answers 409 with the reason on later lines; the first line alone says nothing
  const p = fakeRecord({ text: "", sha: "aaa" });
  p.fail.push("gh: Repository rule violations found\n\nChanges must be made through a pull request. (HTTP 409)");
  assert.deepEqual(await T.changeThings({ record: () => p.rec }, "o/r", { add: { url: DOC, by: "frank", at } }), { error: "you can't write to this room yet" });
  assert.equal(p.puts.length, 1);   // not retried as a conflict
  // a file that appeared between a read that said 404 and the put: GitHub's 422, "sha" on a later line
  const n = fakeRecord(null);
  n.fail.push('gh: Invalid request.\n\n"sha" wasn\'t supplied. (HTTP 422)');
  const origPut = n.rec.files.putBody;
  n.rec.files.putBody = async (repo: string, path: string, w: any) => { const q = origPut(repo, path, w); await q.catch(() => {}); if (n.puts.length === 1) n.set({ text: "", sha: "ccc" }); return q; };
  const got = await T.changeThings({ record: () => n.rec }, "o/r", { add: { url: DOC, by: "frank", at } });
  assert.ok(!("error" in got) && got.changed);
  assert.deepEqual(n.puts.map((x) => x.sha), [undefined, "ccc"]);
  const l = fakeRecord({ text: "", sha: "aaa" });
  l.fail.push("gh: API rate limit exceeded for user ID 1. (HTTP 403)");
  assert.deepEqual(await T.changeThings({ record: () => l.rec }, "o/r", { add: { url: DOC, by: "frank", at } }), { error: "GitHub is rate-limiting you; try again in a minute" });
  const x = fakeRecord({ text: "", sha: "aaa" });
  x.fail.push("gh: Server Error (HTTP 502)");
  assert.deepEqual(await T.changeThings({ record: () => x.rec }, "o/r", { add: { url: DOC, by: "frank", at } }), { error: "gh: Server Error (HTTP 502)" });
});

test("putFailure: the table, on gh's whole word", () => {
  const e = (w: string) => Object.assign(new Error(w.split("\n")[0]), { full: w });
  assert.equal(T.putFailure(e("gh: x does not match y (HTTP 409)")), "conflict");
  assert.equal(T.putFailure(e("gh: Changes must be made through a pull request. (HTTP 409)")), "refused");
  assert.equal(T.putFailure(e("gh: Repository rule violations found\n\nmore (HTTP 409)")), "refused");
  assert.equal(T.putFailure(e('gh: Invalid request.\n\n"sha" wasn\'t supplied. (HTTP 422)')), "conflict");
  assert.equal(T.putFailure(e("gh: Validation Failed (HTTP 422)")), "gh: Validation Failed (HTTP 422)");
  assert.equal(T.putFailure(e("gh: Not Found (HTTP 404)")), "refused");
  assert.equal(T.putFailure(e("gh: Bad credentials (HTTP 401)")), "refused");
  assert.equal(T.putFailure(e("gh: API rate limit exceeded (HTTP 403)")), "limit");
  assert.equal(T.putFailure(new Error("spawn gh ENOENT")), "spawn gh ENOENT");
});

test("the default branch is read once a repo and the file lives on it; a repo that cannot be seen or a branch that is not there is an error, not an empty room", async () => {
  T.forgetBranches();
  const r = fakeRecord(null, "master");
  const d = { record: () => r.rec };
  assert.deepEqual((await T.readThings(d, "o/master")).branch, "master");
  const got = await T.changeThings(d, "o/master", { add: { url: DOC, by: "frank", at } });
  assert.ok(!("error" in got) && got.changed);
  assert.equal(r.puts[0].branch, "master");
  const gone = fakeRecord(null, "gone");
  await assert.rejects(T.readThings({ record: () => gone.rec }, "o/gone"), /404/);
  assert.deepEqual(await T.changeThings({ record: () => gone.rec }, "o/gone", { add: { url: DOC, by: "frank", at } }), { error: "couldn't read the room's things: gh: Not Found (HTTP 404)" });
  const empty = fakeRecord(null);
  empty.rec.files.readSha = async () => { throw ghError("gh: No commit found for the ref main (HTTP 404)"); };
  await assert.rejects(T.readThings({ record: () => empty.rec }, "o/empty"), /No commit found/);
  T.forgetBranches();
});

test("a file a newer Sol wrote (v above 2) is read for what it is and never written", async () => {
  const f = T.parse(JSON.stringify({ v: 3, things: [{ url: DOC, name: "Our plan", addedBy: "frank", at, future: 1 }] }));
  assert.equal(f.newer, true);
  assert.equal(f.things[0].name, "Our plan");
  assert.equal("newer" in JSON.parse(T.serialize(f)), false);
  const r = fakeRecord({ text: JSON.stringify({ v: 3, things: [] }), sha: "aaa" });
  assert.deepEqual(await T.changeThings({ record: () => r.rec }, "o/r", { add: { url: REPO, by: "frank", at } }), { error: "this room's things were written by a newer Sol; update Sol first" });
  assert.equal(r.puts.length, 0);
});

test("changeThings: a link already there is no commit; a refused link is its reason and no commit; a read that fails is said", async () => {
  const have = T.serialize({ v: 1, things: [{ id: T.idOf(DOC), name: "Our plan", url: DOC, kind: "doc", addedBy: "frank", at }] });
  const r = fakeRecord({ text: have, sha: "aaa" });
  const same = await T.changeThings({ record: () => r.rec }, "o/r", { add: { url: DOC + "#other", by: "marco", at } });
  assert.ok(!("error" in same) && !same.changed && same.thing?.name === "Our plan");
  assert.deepEqual(await T.changeThings({ record: () => r.rec }, "o/r", { add: { url: "https://localhost/", by: "marco", at } }), { error: "a link to this machine or a private network is not taken" });
  assert.deepEqual(await T.changeThings({ record: () => r.rec }, "o/r", { remove: { id: "nothere0" } }), { error: "no such thing" });
  assert.equal(r.puts.length, 0);
  const gone = await T.changeThings({ record: () => r.rec }, "o/r", { remove: { id: T.idOf(DOC) } });
  assert.ok(!("error" in gone) && gone.changed);
  assert.equal(r.puts[0].message, "things: removed Our plan");
  const down = { files: { readSha: async () => { throw new Error("gh: could not connect\nmore"); }, put: async () => "" } } as any;
  assert.deepEqual(await T.changeThings({ record: () => down }, "o/r", { add: { url: DOC, by: "frank", at } }), { error: "couldn't read the room's things: gh: could not connect" });
});

test("getThings: cached 60 s a repo, read anew after, on refresh and for another repo; a read that fails answers the cached list", async () => {
  T.forgetThings();
  const r = fakeRecord({ text: T.serialize({ v: 1, things: [{ id: T.idOf(DOC), name: "Our plan", url: DOC, kind: "doc", addedBy: "frank", at }] }), sha: "aaa" });
  let t = 1_000_000;
  const now = () => t;
  const d = { record: () => r.rec };
  assert.equal((await T.getThings(d, "o/r", false, now)).things.length, 1);
  assert.equal((await T.getThings(d, "o/r", false, now)).things.length, 1);
  assert.equal(r.reads(), 1);
  t += 59_000; await T.getThings(d, "o/r", false, now); assert.equal(r.reads(), 1);
  t += 2_000; await T.getThings(d, "o/r", false, now); assert.equal(r.reads(), 2);
  await T.getThings(d, "o/r", true, now); assert.equal(r.reads(), 3);
  await T.getThings(d, "o/other", false, now); assert.equal(r.reads(), 4);
  // a change made here is the new cache
  const heard: string[] = [];
  const off = T.onThings((repo, f) => heard.push(`${repo}:${f.things.length}`));
  await T.changeThings(d, "o/r", { add: { url: REPO, by: "frank", at } });
  off();
  assert.deepEqual(heard, ["o/r:2"]);
  assert.equal((await T.getThings(d, "o/r", false, now)).things.length, 2);
  assert.equal(r.reads(), 5);   // the change read once; the get after it was the cache
  // a read that began before a write landed never covers the write (the review of #194)
  let release: () => void = () => {};
  const slow = { files: { ...r.rec.files, readSha: async (repo: string, path: string, ref: string) => { await new Promise<void>((ok) => { release = ok; }); return r.rec.files.readSha(repo, path, ref); } } } as any;
  t += 120_000;
  const reading = T.getThings({ record: () => slow }, "o/r", true, now);
  await new Promise((ok) => setTimeout(ok, 5));
  await T.changeThings(d, "o/r", { add: { url: "https://example.com/third", by: "frank", at } });
  release();
  assert.equal((await reading).things.length, 3);   // the write, not the stale read
  assert.equal((await T.getThings(d, "o/r", false, now)).things.length, 3);
  // the record falls over: the cached list, not a throw; for another repo, the throw
  r.rec.files.readSha = async () => { throw new Error("gh: could not connect"); };
  t += 120_000;
  assert.equal((await T.getThings(d, "o/r", false, now)).things.length, 3);
  await assert.rejects(T.getThings(d, "o/elsewhere", false, now), /could not connect/);
  T.forgetThings();
});

test("lastTouchOf: a GitHub thing that is a board repo is the newest PR or card there; anything else is who added it", () => {
  const repoThing = { id: "r", name: "the repo", url: REPO, kind: "github" as const, addedBy: "frank", at };
  const board = {
    prs: [{ repo: "franktsai2008-eng/room", author: "marco", updated: "2026-10-24T19:00:00.000Z" }, { repo: "other/x", author: "x", updated: "2026-10-25T00:00:00.000Z" }],
    cards: [{ repo: "franktsai2008-eng/room", author: "isaac", created: "2026-10-24T18:00:00.000Z" }],
  } as any;
  assert.deepEqual(T.lastTouchOf(repoThing, board), { who: "marco", at: "2026-10-24T19:00:00.000Z" });
  assert.deepEqual(T.lastTouchOf(repoThing, null), { who: "frank", at });
  assert.deepEqual(T.lastTouchOf({ ...repoThing, url: "https://github.com/nobody/here" }, board), { who: "frank", at });
  assert.deepEqual(T.lastTouchOf({ id: "d", name: "a doc", url: DOC, kind: "doc", addedBy: "marco", at }, board), { who: "marco", at });
  assert.deepEqual(T.lastTouchOf({ ...repoThing, url: "https://github.com/nobody/here", at: "" }, board), { who: "frank", at: "" });
});

test("the face's message and the agent's lines; a room with no record says so", () => {
  const file = { v: 1 as const, things: [{ id: T.idOf(DOC), name: "Our plan", url: DOC, kind: "doc" as const, addedBy: "frank", at, agent: true as const }] };
  const m = T.thingsMsg(file, null, "o/r", "q1");
  assert.deepEqual(m, { type: "team.things", rid: "q1", repo: "o/r", things: [{ ...file.things[0], lastTouch: { who: "frank", at }, inNow: [] }], folders: [] });
  assert.deepEqual(T.thingsMsg({ v: 1, things: [] }, null, ""), { type: "team.things", repo: "", things: [], folders: [], note: "this room has no record yet" });
  assert.equal(T.thingsText(file, "o/r"), `${T.idOf(DOC)}  doc · Our plan · ${DOC} · added by frank's agent · 2026-10-24`);
  assert.equal(T.thingsText({ v: 1, things: [] }, "o/r"), "no things yet; add one with room_thing_add { url, name? }");
  assert.equal(T.thingsText(file, ""), "this room has no record yet");
});

test("agentAdd: refused in one line with no record or when my agent may not speak on GitHub; else the same add, marked as the agent's", async () => {
  const r = fakeRecord(null);
  const d = { record: () => r.rec };
  assert.equal(await T.agentAdd(d, { repo: "", mayGitHub: true, login: "frank", url: DOC }), "this room has no record yet; nothing added");
  assert.equal(await T.agentAdd(d, { repo: "o/r", mayGitHub: false, login: "frank", url: DOC }), "not added: my agent may not speak on GitHub (Settings, my agent), and the room's record is GitHub");
  assert.equal(r.puts.length, 0);
  assert.equal(await T.agentAdd(d, { repo: "o/r", mayGitHub: true, login: "frank", url: DOC, name: "Our plan", at }), `added doc · Our plan (${T.idOf(DOC)}); the room sees it`);
  assert.equal(T.parse(r.on()!.text).things[0].agent, true);
  assert.equal(await T.agentAdd(d, { repo: "o/r", mayGitHub: true, login: "frank", url: DOC, at }), `already here, so nothing was added: doc · Our plan (${T.idOf(DOC)}); use that one`);
  assert.equal(await T.agentAdd(d, { repo: "o/r", mayGitHub: true, login: "frank", url: "http://x.com/", at }), "not added: only https links; this one is http");
  assert.equal(r.puts.length, 1);
});

test("recordOf: a GitHub room's first repo, nothing for a Drive room, and the room from before rooms", () => {
  const s = S.cleanTeam({ rooms: [
    { id: "a", provider: "github", repos: ["o/one", "o/two"] },
    { id: "b", provider: "drive", repos: ["1AbCdEfG"] },
    { id: "c", provider: "github", org: "kao-ai" },   // an org and no repos: the default repo
  ] });
  assert.equal(S.recordOf(s.rooms[0]), "o/one");
  assert.equal(S.recordOf(s.rooms[1]), "");
  assert.equal(S.recordOf(s.rooms[2]), "marcocyl04-ux/sol-dev");
  assert.equal(S.recordOf(S.activeRoom(S.cleanTeam({ repos: ["franktsai2008-eng/room"] }))), "franktsai2008-eng/room");
});

test("the two agent tools are on the list, beside team_note", async () => {
  const W = await import("../src/work/tools.ts");
  const names = (W as any).WORK_TOOLS?.map((t: any) => t.name) ?? (W as any).TOOLS?.map((t: any) => t.name);
  assert.ok(names.includes("room_things") && names.includes("room_thing_add") && names.includes("team_note"), String(names));
});
