// changing.ts takeBack (#16 blocker 4): an uncommitted edit goes back to the copy taken before the seat's first edit
// (Marco's own uncommitted work in the file survives), a new file is removed, ../undo runs only when the newest commit
// is a mutate that touched the file. A real git repo in a temp folder, the real undo script.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Changing } from "../src/changing.ts";

const git = (dir: string, ...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

function repo() {
  const root = mkdtempSync(join(tmpdir(), "sol-take-"));
  const sol = join(root, "sol");
  mkdirSync(join(sol, "mac", "src"), { recursive: true }); mkdirSync(join(sol, "home"), { recursive: true }); mkdirSync(join(sol, "design"));
  copyFileSync(join(import.meta.dirname, "..", "..", "undo"), join(sol, "undo")); chmodSync(join(sol, "undo"), 0o755);
  writeFileSync(join(sol, "mac", "src", "A.tsx"), "a0\n"); writeFileSync(join(sol, "mac", "src", "B.tsx"), "b0\n"); writeFileSync(join(sol, "home", "CLAUDE.md"), ""); writeFileSync(join(sol, "design", "x.md"), "");
  git(root, "init", "-q"); git(root, "add", "."); git(root, "commit", "-q", "-m", "start");
  const c = new Changing(join(sol, "home"), () => {});
  return { root, sol, c, A: join(sol, "mac", "src", "A.tsx"), B: join(sol, "mac", "src", "B.tsx") };
}

test("an uncommitted edit goes back to the copy from before the seat's edit, Marco's own work in it kept", async () => {
  const r = repo();
  writeFileSync(r.A, "a0\nmarco's line, not committed\n");
  r.c.tool("work", "s", "t1", "Edit", { file_path: r.A }, r.sol);   // the copy is taken here
  writeFileSync(r.A, "the seat's broken edit\n");
  assert.deepEqual(await r.c.takeBack(["mac/src/A.tsx"]), ["mac/src/A.tsx"]);
  assert.equal(readFileSync(r.A, "utf8"), "a0\nmarco's line, not committed\n");
  rmSync(r.root, { recursive: true, force: true });
});

test("a file the seat made is removed; a mutate commit that did not touch the file is not undone", async () => {
  const r = repo();
  const N = join(r.sol, "mac", "src", "New.tsx");
  r.c.tool("work", "s", "t1", "Write", { file_path: N }, r.sol);
  writeFileSync(N, "new\n");
  assert.deepEqual(await r.c.takeBack(["mac/src/New.tsx"]), ["mac/src/New.tsx"]);
  assert.equal(existsSync(N), false);
  // the newest commit is a mutate of B only: A is left alone, nothing is undone
  writeFileSync(r.B, "b1\n"); git(r.root, "commit", "-q", "-am", "mutate: b");
  assert.deepEqual(await r.c.takeBack(["mac/src/A.tsx"]), []);
  assert.equal(git(r.root, "log", "-1", "--format=%s"), "mutate: b");
  // a mutate that touched A is undone, once, for both files it touched
  writeFileSync(r.A, "a1\n"); writeFileSync(r.B, "b2\n"); git(r.root, "commit", "-q", "-am", "mutate: a and b");
  assert.deepEqual(await r.c.takeBack(["mac/src/A.tsx", "mac/src/B.tsx"]), ["mac/src/A.tsx", "mac/src/B.tsx"]);
  assert.match(git(r.root, "log", "-1", "--format=%s"), /^undo: a and b/);
  assert.equal(readFileSync(r.A, "utf8"), "a0\n");
  rmSync(r.root, { recursive: true, force: true });
});
