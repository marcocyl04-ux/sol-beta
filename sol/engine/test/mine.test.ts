import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mineOf, withMine, forgetMine } from "../src/work/mine.ts";

// a scratch repo: main, stable, and a MY SOL worktree on marco/mine beside it (never the real repos)
const top = realpathSync(mkdtempSync(join(tmpdir(), "sol-mine-")));
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env, stdio: "pipe" }).toString().trim();
const repo = join(top, "repo"), mine = join(top, "my-sol");
git(top, "init", "-q", "-b", "main", repo);
const commit = (cwd: string, file: string, msg: string) => { writeFileSync(join(cwd, file), msg); git(cwd, "add", file); git(cwd, "commit", "-qm", msg); };
commit(repo, "a.txt", "base");
git(repo, "branch", "stable");
git(repo, "worktree", "add", "-q", "-b", "marco/mine", mine, "stable");

test("a */mine checkout with nothing over stable: count 0", async () => {
  assert.deepEqual(await mineOf(mine), { base: "stable", count: 0, subjects: [] });
});

test("his commits over stable are counted, their subjects newest first, kept 60 s", async () => {
  forgetMine();
  for (let i = 1; i <= 10; i++) commit(mine, `m${i}.txt`, `mine: look ${i}`);
  const now = Date.now();
  const m = await mineOf(mine, now);
  assert.equal(m?.count, 10);
  assert.equal(m?.subjects.length, 8, "at most 8 subjects");
  assert.equal(m?.subjects[0], "mine: look 10");
  commit(mine, "m11.txt", "mine: look 11");
  assert.equal((await mineOf(mine, now + 30_000))?.count, 10, "still the kept answer within 60 s");
  assert.equal((await mineOf(mine, now + 61_000))?.count, 11, "asked again after 60 s");
});

test("a stamp moves stable: only what is still his counts", async () => {
  forgetMine();
  git(repo, "branch", "-f", "stable", "marco/mine~1");   // stable stamped at everything but his last commit
  assert.equal((await mineOf(mine))?.count, 1);
});

test("any other folder has no card: main, a folder that is not a repo, one that is not there", async () => {
  forgetMine();
  assert.equal(await mineOf(repo), undefined);
  assert.equal(await mineOf(top), undefined);
  assert.equal(await mineOf(join(top, "gone")), undefined);
  const out = await withMine([{ path: repo, name: "SOL" }, { path: mine, name: "MY SOL" }]);
  assert.equal("mine" in out[0], false);
  assert.equal(out[1].mine?.count, 1);
});
