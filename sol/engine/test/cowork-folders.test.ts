// Folders for a room's things, like Google Drive (#248, docs/cowork-ui-design-2026-10-24/ADDITIONS.md §2, §5): things.json
// v2 carries `folders` and each thing an optional `parent`. The file stays v1 until it has a folder, so an older Sol keeps
// writing; a v2 file is read by an older Sol and never written (the test of that is in cowork-things). Pure parts first
// (parse, serialize, one op), then the compare-and-swap write and the agent's tools against a fake record, no network.
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

const at = "2026-10-26T12:00:00.000Z";
const DOC = "https://docs.google.com/document/d/1AbC/edit";
const SHEET = "https://docs.google.com/spreadsheets/d/S1/edit";
const PAGE = "https://example.com/brief";
const thing = (url: string, name: string, parent?: string) => ({ id: T.idOf(url), name, url, kind: T.kindOf(url), addedBy: "frank", at, ...(parent ? { parent } : {}) });
const folder = (id: string, name: string, parent: string | null = null) => ({ id, name, parent, by: "frank", at });

const ghError = (full: string) => Object.assign(new Error(full.split("\n")[0]), { full });
function fakeRecord(start: { text: string; sha: string } | null) {
  let on = start;
  const puts: { message: string; content: string; sha?: string }[] = [];
  const fail: string[] = [];
  const rec = { files: {
    branch: async () => "main",
    readSha: async () => { if (!on) throw ghError("gh: Not Found (HTTP 404)"); return JSON.stringify({ sha: on.sha, content: Buffer.from(on.text).toString("base64") }); },
    putBody: async (_r: string, _p: string, w: { message: string; content: string; sha?: string }) => {
      puts.push(w);
      const f = fail.shift() ?? "";
      if (f) throw ghError(f);
      on = { text: Buffer.from(w.content, "base64").toString("utf8"), sha: `sha${puts.length}` };
      return "";
    },
  } } as any;
  return { rec, puts, fail, file: () => T.parse(on?.text ?? ""), text: () => on?.text ?? "" };
}

test("a file with no folder is v1, byte for byte as before; with a folder it is v2, folders first, a thing's parent kept", () => {
  const v1 = T.serialize({ v: 1, things: [thing(DOC, "plan")] });
  assert.equal(JSON.parse(v1).v, 1);
  assert.equal("folders" in JSON.parse(v1), false);
  const f = { v: 2 as const, folders: [folder("ab12cd34", "marketing")], things: [thing(DOC, "plan", "ab12cd34"), thing(PAGE, "brief")] };
  const text = T.serialize(f);
  const j = JSON.parse(text);
  assert.equal(j.v, 2);
  assert.deepEqual(Object.keys(j), ["v", "folders", "things"]);
  assert.equal(j.things[0].parent, "ab12cd34");
  assert.equal("parent" in j.things[1], false);
  assert.equal(T.serialize(T.parse(text)), text, "byte-stable");
  assert.deepEqual(T.parse(text), f);
});

test("parse takes junk: a folder with no name, a bad id, a twin id dropped; a parent not a folder is the top; a loop is cut", () => {
  const f = T.parse(JSON.stringify({ v: 2, folders: [
    folder("aaaa1111", "a"), folder("aaaa1111", "twin"), { id: "BAD!", name: "x" }, { id: "bbbb2222", name: "  " },
    folder("cccc3333", "c", "dddd4444"), folder("dddd4444", "d", "cccc3333"), folder("eeee5555", "e", "nope0000"),
  ], things: [thing(DOC, "plan", "aaaa1111"), thing(PAGE, "brief", "gone0000"), { ...thing(SHEET, "s"), parent: 7 }] }));
  assert.deepEqual(f.folders!.map((x) => x.id), ["aaaa1111", "cccc3333", "dddd4444", "eeee5555"]);
  assert.equal(f.folders!.find((x) => x.id === "eeee5555")!.parent, null);
  // the loop c → d → c: one of them is at the top, and walking up from either ends
  const byId = new Map(f.folders!.map((x) => [x.id, x]));
  for (const start of ["cccc3333", "dddd4444"]) { let p = byId.get(start)!.parent, n = 0; while (p && n < 5) { p = byId.get(p)!.parent; n++; } assert.ok(n < 5); }
  assert.deepEqual(f.things.map((t) => t.parent), ["aaaa1111", undefined, undefined]);
  // a v2 file with no folder left reads as v1, its parents gone
  const g = T.parse(JSON.stringify({ v: 2, folders: [], things: [thing(DOC, "plan", "aaaa1111")] }));
  assert.deepEqual(g, { v: 1, things: [thing(DOC, "plan")] });
});

test("a folder: made at the top with a name; no name, a taken name (any case) and a folder inside a folder are refused", () => {
  const base = { v: 1 as const, things: [thing(DOC, "plan")] };
  // the first folder only when a person says everyone in the room runs a Sol with folders (an older Sol then only reads)
  assert.equal(T.apply(base, { folder: { id: "f0f0f0f0", name: "Marketing", by: "frank", at } }).error, T.FIRST_FOLDER);
  const r = T.apply(base, { folder: { id: "f0f0f0f0", name: "  Marketing ", by: "frank", at, everyone: true } });
  assert.equal(r.changed, true);
  assert.equal(r.file.v, 2);
  assert.deepEqual(r.folder, folder("f0f0f0f0", "Marketing"));
  assert.equal(r.say, "made the folder Marketing");
  assert.equal(T.apply(r.file, { folder: { id: "f1f1f1f1", name: "marketing", by: "frank", at } }).error, "there is a folder called Marketing here already");
  assert.equal(T.apply(r.file, { folder: { id: "f1f1f1f1", name: " ", by: "frank", at } }).error, "give the folder a name");
  assert.equal(T.apply(r.file, { folder: { id: "f1f1f1f1", name: "Oct", parent: "f0f0f0f0", by: "frank", at } }).error, "one level of folders for now: a folder inside a folder is not made yet");
  assert.equal(T.apply(r.file, { folder: { id: "f0f0f0f0", name: "Other", by: "frank", at } }).error, "that folder id is taken; try again");
});

test("names in one folder are unique: an add or a move into a folder where the name is taken gets (2), (3); case does not count", () => {
  assert.equal(T.freeName("plan", ["Plan"]), "plan (2)");
  assert.equal(T.freeName("plan", ["plan", "plan (2)"]), "plan (3)");
  assert.equal(T.freeName("plan (2)", ["plan", "plan (2)"]), "plan (3)", "never plan (2) (2)");
  assert.equal(T.freeName("(2)", ["(2)"]), "(2) (2)");
  assert.equal(T.freeName("plan", ["other"]), "plan");
  const long = "x".repeat(60);
  assert.equal(T.freeName(long, [long]).length, 60);
  assert.match(T.freeName(long, [long]), / \(2\)$/);
  const f = { v: 2 as const, folders: [folder("f0f0f0f0", "mk")], things: [thing(DOC, "plan"), thing(SHEET, "plan", "f0f0f0f0")] };
  // the same name in another folder is fine
  const a = T.apply(f, { add: { url: PAGE, name: "plan", by: "frank", at } });
  assert.equal(a.thing!.name, "plan (2)");
  const b = T.apply(f, { add: { url: PAGE, name: "Plan", by: "frank", at, parent: "f0f0f0f0" } });
  assert.equal(b.thing!.name, "Plan (2)");
  assert.equal(b.thing!.parent, "f0f0f0f0");
  assert.equal(T.apply(f, { add: { url: PAGE, by: "frank", at, parent: "nope0000" } }).error, "no such folder");
  // a move: the top's plan into mk, where a plan is
  const m = T.apply(f, { move: { id: T.idOf(DOC), to: "f0f0f0f0" } });
  assert.equal(m.changed, true);
  assert.deepEqual(m.thing, { ...thing(DOC, "plan (2)"), parent: "f0f0f0f0" });
  assert.equal(m.say, "moved plan (2) to mk");
});

test("move: to a folder, back to the top, already there is no change; an unknown thing, folder, or a folder itself is refused", () => {
  const f = { v: 2 as const, folders: [folder("f0f0f0f0", "mk")], things: [thing(DOC, "plan")] };
  const into = T.apply(f, { move: { id: T.idOf(DOC), to: "f0f0f0f0" } });
  assert.equal(into.file.things[0].parent, "f0f0f0f0");
  const again = T.apply(into.file, { move: { id: T.idOf(DOC), to: "f0f0f0f0" } });
  assert.equal(again.changed, false);
  const out = T.apply(into.file, { move: { id: T.idOf(DOC), to: "" } });
  assert.equal(out.changed, true);
  assert.equal("parent" in out.file.things[0], false);
  assert.equal(out.say, "moved plan to the top");
  assert.equal(T.apply(f, { move: { id: T.idOf(DOC), to: null } }).changed, false);
  assert.equal(T.apply(f, { move: { id: "zzzz", to: "f0f0f0f0" } }).error, "no such thing");
  assert.equal(T.apply(f, { move: { id: T.idOf(DOC), to: "nope0000" } }).error, "no such folder");
  assert.equal(T.apply(f, { move: { id: "f0f0f0f0", to: "" } }).error, "a folder stays at the top for now; move the things in it instead");
});

test("a folder off: what was in it moves up one level, names made free there, the order kept; the last folder off is v1 again", () => {
  const f = { v: 2 as const, folders: [folder("f0f0f0f0", "mk"), folder("f1f1f1f1", "ops")],
    things: [thing(DOC, "plan", "f0f0f0f0"), thing(SHEET, "plan"), thing(PAGE, "brief", "f0f0f0f0")] };
  const r = T.apply(f, { unfolder: { id: "f0f0f0f0" } });
  assert.equal(r.changed, true);
  assert.equal(r.say, "removed the folder mk");
  assert.deepEqual(r.file.folders, [folder("f1f1f1f1", "ops")]);
  assert.deepEqual(r.file.things.map((t) => [t.name, t.parent]), [["plan (2)", undefined], ["plan", undefined], ["brief", undefined]]);
  const last = T.apply(r.file, { unfolder: { id: "f1f1f1f1" } });
  assert.equal(last.file.v, 1);
  assert.equal(JSON.parse(T.serialize(last.file)).v, 1);
  assert.equal(T.apply(f, { unfolder: { id: "nope0000" } }).error, "no such folder");
  // a newer Sol's folder inside a folder moves up with it
  const n = T.parse(JSON.stringify({ v: 2, folders: [folder("f0f0f0f0", "mk"), folder("f2f2f2f2", "oct", "f0f0f0f0")], things: [thing(DOC, "plan", "f2f2f2f2")] }));
  const up = T.apply(n, { unfolder: { id: "f0f0f0f0" } });
  assert.deepEqual(up.file.folders, [folder("f2f2f2f2", "oct", null)]);
  assert.equal(up.file.things[0].parent, "f2f2f2f2");
});

test("changeThings: a folder made, a move and a folder off are three commits that say what was done, compare-and-swap like an add", async () => {
  const r = fakeRecord({ text: T.serialize({ v: 1, things: [thing(DOC, "plan")] }), sha: "aaa" });
  const d = { record: () => r.rec };
  const a = await T.changeThings(d, "o/r", { folder: { id: "f0f0f0f0", name: "mk", by: "frank", at, everyone: true } });
  assert.ok(!("error" in a) && a.changed && a.folder?.id === "f0f0f0f0");
  r.fail.push("gh: is at abc but expected def (HTTP 409)");   // someone wrote between: read again, apply again
  const b = await T.changeThings(d, "o/r", { move: { id: T.idOf(DOC), to: "f0f0f0f0" } });
  assert.ok(!("error" in b) && b.changed);
  const c = await T.changeThings(d, "o/r", { unfolder: { id: "f0f0f0f0" } });
  assert.ok(!("error" in c) && c.changed);
  assert.deepEqual(r.puts.map((p) => p.message), ["things: made the folder mk", "things: moved plan to mk", "things: moved plan to mk", "things: removed the folder mk"]);
  assert.equal(JSON.parse(r.text()).v, 1);
  assert.deepEqual(r.file().things, [thing(DOC, "plan")]);
});

test("the face's message carries the folders; the agent's list is a tree, folders first, their things under them", () => {
  const f = { v: 2 as const, folders: [folder("f0f0f0f0", "mk")], things: [thing(DOC, "plan", "f0f0f0f0"), thing(PAGE, "brief")] };
  const m = T.thingsMsg(f, null, "o/r", "q");
  assert.deepEqual(m.folders, f.folders);
  assert.equal(m.things[0].parent, "f0f0f0f0");
  assert.equal(T.thingsText(f, "o/r"), [
    "mk/  (folder f0f0f0f0 · 1 thing · made by frank)",
    `  ${T.idOf(DOC)}  doc · plan · ${DOC} · added by frank · 2026-10-26`,
    `${T.idOf(PAGE)}  web · brief · ${PAGE} · added by frank · 2026-10-26`,
  ].join("\n"));
  assert.equal(T.thingsText({ v: 2, folders: [folder("f0f0f0f0", "mk")], things: [] }, "o/r"), "mk/  (folder f0f0f0f0 · 0 things · made by frank)");
  // an older Sol reading a newer file: read-only, said to the face
  assert.equal(T.thingsMsg(T.parse(JSON.stringify({ v: 3, things: [] })), null, "o/r").readOnly, true);
});

test("the agent's tools: room_folder_add, room_thing_move by a folder's name or id or to the top, room_thing_add into a folder; refused as room_thing_add is", async () => {
  T.forgetThings();
  const r = fakeRecord({ text: T.serialize({ v: 1, things: [thing(DOC, "plan")] }), sha: "aaa" });
  const d = { record: () => r.rec };
  assert.equal(await T.agentFolder(d, { repo: "o/r", mayGitHub: false, login: "frank", name: "mk" }), "not made: my agent may not speak on GitHub (Settings, my agent), and the room's record is GitHub");
  assert.equal(await T.agentFolder(d, { repo: "", mayGitHub: true, login: "frank", name: "mk" }), "this room has no record yet; nothing made");
  assert.equal(await T.agentFolder(d, { repo: "cloud:ABC", mayGitHub: false, login: "frank", name: "mk" }), "not made: my agent may not speak in Cowork (Settings, my agent)");
  // the room's first folder is the human's to make, never an agent's
  assert.equal(await T.agentFolder(d, { repo: "o/r", mayGitHub: true, login: "frank", name: "Marketing", at }), "not made: the room's first folder is your human's to make, in Cowork (+ new folder), since an older Sol then only reads this room's things");
  assert.equal(r.puts.length, 0);
  await T.changeThings(d, "o/r", { folder: { id: "f9f9f9f9", name: "first", by: "frank", at, everyone: true } });
  assert.equal(await T.agentFolder(d, { repo: "o/r", mayGitHub: true, login: "frank", name: "Marketing", id: "f0f0f0f0", at }), `made the folder Marketing (f0f0f0f0); move things in with room_thing_move { id, to: "Marketing" }`);
  assert.equal(r.file().folders!.find((x) => x.id === "f0f0f0f0")!.agent, true, "an agent's folder says so, as an agent's thing does");
  assert.equal(await T.agentFolder(d, { repo: "o/r", mayGitHub: true, login: "frank", name: "marketing", id: "f1f1f1f1", at }), "not made: there is a folder called Marketing here already");
  assert.equal(await T.agentMove(d, { repo: "o/r", mayGitHub: true, id: T.idOf(DOC), to: "marketing/" }), "moved plan to Marketing");
  assert.equal(await T.agentMove(d, { repo: "o/r", mayGitHub: true, id: T.idOf(DOC), to: "f0f0f0f0" }), "plan is in Marketing already");
  assert.equal(await T.agentMove(d, { repo: "o/r", mayGitHub: true, id: T.idOf(DOC), to: "sales" }), "not moved: no folder sales; room_things lists them");
  assert.equal(await T.agentMove(d, { repo: "o/r", mayGitHub: true, id: T.idOf(DOC), to: "" }), "moved plan to the top");
  assert.equal(await T.agentMove(d, { repo: "o/r", mayGitHub: false, id: T.idOf(DOC), to: "" }), "not moved: my agent may not speak on GitHub (Settings, my agent), and the room's record is GitHub");
  assert.match(await T.agentAdd(d, { repo: "o/r", mayGitHub: true, login: "frank", url: SHEET, name: "plan", parent: "Marketing", at }), /^added sheet · plan \(\w+\) in Marketing; the room sees it$/);
  // the same link again, asked into another folder: nothing moves, and the line says where it is
  assert.match(await T.agentAdd(d, { repo: "o/r", mayGitHub: true, login: "frank", url: SHEET, parent: "first", at }), /^already here, so nothing was added: sheet · plan \(\w+\) in Marketing; use that one$/);
  assert.equal(r.file().things.find((t) => t.url === SHEET)!.parent, "f0f0f0f0");
  assert.equal(await T.agentAdd(d, { repo: "o/r", mayGitHub: true, login: "frank", url: PAGE, parent: "nope", at }), "not added: no folder nope; room_things lists them");
  T.forgetThings();
});

test("an agent's words for a place: a folder's name wins over an id and over 'top'; '', '/', 'top' are the top when no folder is called that", () => {
  const f = { v: 2 as const, folders: [folder("ffff0000", "a"), folder("aaaa1111", "ffff0000"), folder("bbbb2222", "Top")], things: [] };
  assert.equal(T.findFolder(f, "ffff0000")!.id, "aaaa1111", "the folder named so");
  assert.equal(T.findFolder(f, "a/")!.id, "ffff0000");
  assert.deepEqual(T.placeOf(f, "top"), { parent: "bbbb2222" });
  assert.deepEqual(T.placeOf({ ...f, folders: f.folders.slice(0, 2) }, "top"), {});
  assert.deepEqual(T.placeOf(f, ""), {});
  assert.deepEqual(T.placeOf(f, "/"), {});
  assert.equal(T.placeOf(f, "nope"), null);
});

test("the feed says who made a folder, and an agent's folder is the agent's line", async () => {
  const F = await import("../src/team/feed.ts");
  const lines = F.feedOf({ things: { v: 2, folders: [folder("f0f0f0f0", "mk"), { ...folder("f1f1f1f1", "ops"), agent: true }], things: [] } });
  assert.deepEqual(lines.map((l) => [l.kind, l.who, l.agent, l.text]).sort(), [["folder-made", "frank", false, "made the folder mk"], ["folder-made", "frank", true, "made the folder ops"]]);
});
