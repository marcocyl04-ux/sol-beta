import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setArrangeHome, getArrangement, setArrangement, undoArrangement, addUsage, arrangeMsg, runArrangeTool, DEFAULTS, TOO_MANY, count } from "../src/arrange.ts";

// the arrangement (#133, PRD section 6): each test in a fresh back room of its own, never the real sol/home
let home = "";
let told: object[] = [];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sol-arrange-"));
  told = [];
  setArrangeHome(home, (m) => told.push(m));
});
const onDisk = () => JSON.parse(readFileSync(join(home, "arrangement.json"), "utf8"));
const say = async (a: object) => (await runArrangeTool("arrange", a)).content.map((c: any) => c.text).join("");

test("defaults: no file is Sol's own, Everyday, Build and Team from the presets the face ships", () => {
  const a = getArrangement();
  assert.deepEqual(a.presets.everyday.buttons, ["call", "browser", "desk", "file-it", "page"]);
  assert.equal(a.presets.build.name, "Build");
  assert.deepEqual(a.rails.home, [{ presets: ["everyday", "build"] }]);
  assert.deepEqual(a.rails.cowork, [{ presets: ["team"] }]);
  assert.equal(a.layout.home, "plain");
  assert.equal(a.manage, null);
  assert.equal(existsSync(join(home, "arrangement.json")), false, "reading writes nothing");
});

test("add, remove and reorder a button, through the tool; every face is told", async () => {
  assert.match(await say({ do: "add", button: "terminal", preset: "everyday" }), /Done/);
  assert.deepEqual(onDisk().presets.everyday.buttons, ["call", "browser", "desk", "file-it", "page", "terminal"]);
  assert.equal(onDisk().rails.home[0].at, "everyday", "the preset changed is the one showing");
  assert.equal(told.length, 1);
  assert.equal((told[0] as any).type, "arrange.changed");

  await say({ do: "move", button: "terminal", preset: "everyday", to: 0 });
  assert.deepEqual(getArrangement().presets.everyday.buttons, ["terminal", "call", "browser", "desk", "file-it", "page"]);

  await say({ do: "remove", button: "call" });   // no preset named: the one the rail shows
  assert.deepEqual(getArrangement().presets.everyday.buttons, ["terminal", "browser", "desk", "file-it", "page"]);
  assert.match(await say({ do: "remove", button: "call" }), /not on Everyday/);
});

test("an 11th button is refused with the line, and nothing is written", async () => {
  setArrangement({ presets: { everyday: { buttons: ["call", "browser", "desk", "file-it", "page", "terminal", "files", "tasks", "plan", "helpers"] } } });
  const before = readFileSync(join(home, "arrangement.json"), "utf8");
  const r = setArrangement({ presets: { everyday: { buttons: [...getArrangement().presets.everyday.buttons, "show"] } } });
  assert.deepEqual(r, { ok: false, why: TOO_MANY });
  assert.equal(TOO_MANY, "a preset holds 10. Make another preset?");
  assert.match(await say({ do: "add", button: "show", preset: "everyday" }), /a preset holds 10/);
  assert.equal(readFileSync(join(home, "arrangement.json"), "utf8"), before);
  // Sol's own Build ships with 11; it may be reordered or shortened, never grown
  assert.equal(count(DEFAULTS.presets.build), 11);
  assert.equal(setArrangement({ presets: { build: { buttons: [...DEFAULTS.presets.build.buttons].reverse() } } }).ok, true);
  assert.equal(setArrangement({ presets: { build: { buttons: [...DEFAULTS.presets.build.buttons, "plan"] } } }).ok, false);
});

test("merge: a patch changes only what it names; a null takes a preset away, and its rail lets go of it", async () => {
  setArrangement({ layout: { home: "split" } });
  setArrangement({ split: { share: 0.3 } });
  const a = getArrangement();
  assert.equal(a.layout.home, "split");
  assert.equal(a.split.share, 0.3);
  assert.deepEqual(a.presets.everyday, DEFAULTS.presets.everyday);
  assert.match(await say({ do: "new", name: "Study", buttons: ["desk", "browser", "call", "page", "file-it"] }), /Done/);
  assert.deepEqual(getArrangement().rails.home[0], { presets: ["everyday", "build", "study"], at: "study" });
  await say({ do: "rename", preset: "study", name: "Exams" });
  assert.equal(getArrangement().presets.study.name, "Exams");
  await say({ do: "delete", preset: "build" });
  assert.equal(getArrangement().presets.build, undefined);
  assert.deepEqual(getArrangement().rails.home[0].presets, ["everyday", "study"]);
  // read again from the file: a deleted default stays deleted
  setArrangeHome(home);
  assert.equal(getArrangement().presets.build, undefined);
  // the last preset of a rail is kept
  assert.match(await say({ do: "delete", preset: "team" }), /keeps one preset/);
});

test("a bad file is put aside with one line, and Sol's own shows", () => {
  writeFileSync(join(home, "arrangement.json"), "{ not json");
  const m = arrangeMsg() as any;
  assert.deepEqual(m.arrangement.presets, DEFAULTS.presets);
  const bad = /(arrangement\.bad-[\w-]+\.json)/.exec(m.note)?.[1] ?? "";
  assert.match(m.note, /could not be read/);
  assert.equal(readFileSync(join(home, bad), "utf8"), "{ not json");
  assert.equal(existsSync(join(home, "arrangement.json")), false);
  setArrangement({ layout: { home: "carousel" } });
  assert.equal((arrangeMsg() as any).note, undefined, "the line goes once a good file is written");
  assert.deepEqual(readdirSync(home).filter((f) => f.endsWith(".tmp")), [], "no temp file left");
  // a second bad file is kept beside the first, never over it
  writeFileSync(join(home, "arrangement.json"), "{ also not json");
  setArrangeHome(home);
  const bad2 = /(arrangement\.bad-[\w-]+\.json)/.exec((arrangeMsg() as any).note)?.[1] ?? "";
  assert.notEqual(bad2, bad);
  assert.equal(readFileSync(join(home, bad), "utf8"), "{ not json");
});

test("new refuses an 11th button with the line, and names ids not on the shelf, changing nothing", async () => {
  const eleven = ["call", "browser", "desk", "file-it", "page", "terminal", "files", "tasks", "plan", "pr", "changes"];
  assert.equal(await say({ do: "new", name: "Big", buttons: eleven }), TOO_MANY);
  assert.match(await say({ do: "new", name: "Odd", buttons: ["call", "my-nothing", "Not An Id"] }), /not on the shelf: my-nothing, Not An Id/);
  assert.equal(getArrangement().presets.big, undefined);
  assert.equal(getArrangement().presets.odd, undefined);
});

test("an unknown button id is kept in its place, and a field from a later Sol is kept too", async () => {
  writeFileSync(join(home, "arrangement.json"), JSON.stringify({ presets: { everyday: { name: "Everyday", buttons: ["call", "my-gym", "desk"] } }, later: { x: 1 } }));
  assert.deepEqual(getArrangement().presets.everyday.buttons, ["call", "my-gym", "desk"]);
  setArrangement({ layout: { home: "split" } });
  assert.deepEqual(onDisk().presets.everyday.buttons, ["call", "my-gym", "desk"]);
  assert.deepEqual(onDisk().later, { x: 1 });
  assert.match(await say({ do: "get" }), /my-gym \(not on the shelf, kept\)/);
  // a preset the file names only by its own ids: the rails it does not name are Sol's own, without what it lacks
  assert.deepEqual(getArrangement().rails.home, [{ presets: ["everyday"] }]);
});

test("get names every button on the shelf with its line", async () => {
  const t = await say({ do: "get" });
  for (const id of ["call", "browser", "desk", "terminal", "action-board"]) assert.match(t, new RegExp(`\\n  ${id}: \\S`));
  assert.doesNotMatch(t, /\n {2}(Rail|Ink|index|types|own):/);
});

test("manage: the answer to the one ask is written by the tool, agent or me, and get says it", async () => {
  assert.match(await say({ do: "get" }), /who tidies the rail: not asked yet/);
  assert.match(await say({ do: "manage", manage: "agent" }), /who tidies the rail: you, when it helps/);
  assert.equal(onDisk().manage, "agent");
  assert.match(await say({ do: "manage", manage: "someone" }), /manage is agent or me/);
  await say({ do: "manage", manage: "me" });
  assert.equal(getArrangement().manage, "me");
});

test("the undo note: an agent's change tells the rail who and what, and undo puts back the arrangement before it, one step", async () => {
  setArrangement({ layout: { home: "split" } });
  const was = getArrangement();
  told = [];
  await runArrangeTool("arrange", { do: "add", button: "terminal", preset: "everyday" }, { seat: "claude" });
  assert.deepEqual((told[0] as any).undo, { who: "Claude", what: "put terminal on Everyday" });
  addUsage({ call: 3 });   // the presses since are the person's: undo keeps them
  told = [];
  assert.equal(undoArrangement(), true);
  assert.deepEqual(getArrangement().presets, was.presets);
  assert.deepEqual(getArrangement().rails, was.rails);
  assert.deepEqual(onDisk().presets.everyday.buttons, DEFAULTS.presets.everyday.buttons);
  assert.equal(getArrangement().usage.call.n, 3);
  assert.equal((told[0] as any).type, "arrange.changed");
  assert.equal((told[0] as any).undo, undefined, "the undo itself shows no note");
  assert.equal(undoArrangement(), false, "one step back only");

  // a face's change, or the person's own, lets the step go; a seat that is not named is "your agent"
  told = [];
  await runArrangeTool("arrange", { do: "layout", layout: "carousel" });
  assert.deepEqual((told[0] as any).undo, { who: "your agent", what: "made the side carousel" });
  setArrangement({ split: { share: 0.4 } });
  assert.equal((told[1] as any).undo, undefined);
  assert.equal(undoArrangement(), false);
  assert.equal(getArrangement().layout.home, "carousel");

  // a refused change keeps nothing to undo and shows no note
  told = [];
  await runArrangeTool("arrange", { do: "remove", button: "call", preset: "nothing" }, { seat: "codex" });
  assert.equal(told.length, 0);
  assert.equal(undoArrangement(), false);
});

// Mine stays mine (PRD section 12, check 10): the ignore file holds both, and nothing that moves stable names either
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
test("the arrangement and own buttons are ignored, and no stamp, promote or rebase names them", () => {
  const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n");
  assert.ok(ignore.includes("sol/home/arrangement.json"));
  assert.ok(ignore.includes("sol/home/buttons/"));
  const ignored = (p: string) => { try { execFileSync("git", ["check-ignore", "-q", p], { cwd: ROOT }); return true; } catch { return false; } };
  assert.ok(ignored("sol/home/arrangement.json"));
  assert.ok(ignored("sol/home/buttons/my-date.tsx"));
  for (const f of ["sol/promote", "sol/engine/src/team/ship.ts", "sol/mine/rebase"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.doesNotMatch(src, /arrangement\.json|home\/buttons/, `${f} names a person's own`);
  }
});
