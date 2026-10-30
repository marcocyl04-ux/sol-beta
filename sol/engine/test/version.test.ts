// Everyone's version (#417, part of #413): what a Sol runs, read from git (src/version.ts) as a release plus its own
// layer; the hub carries it on the hello and each presence, checked field by field (solVersionOf); a Sol older than
// #417 says none, and its roster entry has no version (the face says "unknown").
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeVersion, versionLine } from "../src/version.ts";
import { RelayHub, solVersionOf } from "../src/hub/index.ts";

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env: ENV, encoding: "utf8" }).trim();
let n = 0;
const commit = (cwd: string, msg: string) => { writeFileSync(join(cwd, "f"), String(++n)); git(cwd, "add", "f"); git(cwd, "commit", "-q", "-m", msg); return git(cwd, "rev-parse", "HEAD"); };
function repo() {
  const d = mkdtempSync(join(tmpdir(), "sol-version-"));
  git(d, "init", "-q", "-b", "main");
  commit(d, "one");
  const st = commit(d, "two");
  git(d, "branch", "stable");
  git(d, "tag", "stable-20261030-0900", st);
  return { d, st };
}

test("on main at the stamped commit: the release tag, nothing of mine, nothing behind", async () => {
  const { d } = repo();
  const v = await computeVersion(d);
  assert.deepEqual(v, { release: "stable-20261030-0900", commit: git(d, "rev-parse", "HEAD").slice(0, 8) });
  assert.equal(versionLine(v), "release stable-20261030-0900");
});

test("on main past stable: main and its commit; behind when main moved on without this checkout", async () => {
  const { d } = repo();
  commit(d, "three");
  const head = git(d, "rev-parse", "HEAD");
  assert.deepEqual(await computeVersion(d), { release: "main", commit: head.slice(0, 8) });
  // a detached checkout two commits behind main (a fetched main this Sol has not taken yet)
  commit(d, "four"); commit(d, "five");
  git(d, "checkout", "-q", "--detach", head);
  const v = await computeVersion(d);
  assert.deepEqual(v, { release: "main", commit: head.slice(0, 8), behind: 2 });
  assert.equal(versionLine(v), `main ${head.slice(0, 8)}, 2 behind`);
});

test("a */mine branch over stable: the release plus my own commits, even when main is ahead of stable", async () => {
  const { d, st } = repo();
  commit(d, "main moves on");
  git(d, "checkout", "-q", "-b", "marco/mine", "stable");
  for (let i = 0; i < 3; i++) commit(d, `mine: ${i}`);
  const v = await computeVersion(d);
  assert.deepEqual(v, { release: "stable-20261030-0900", commit: st.slice(0, 8), mine: 3 });
  assert.equal(versionLine(v), "release stable-20261030-0900 + 3 of mine");
  // a newer stable this Sol has not updated to: one behind
  git(d, "checkout", "-q", "stable"); commit(d, "a newer stable"); git(d, "checkout", "-q", "marco/mine");
  assert.equal(versionLine(await computeVersion(d)), "release stable-20261030-0900 + 3 of mine, 1 behind");
});

test("no tag on the commit: the branch's name and the commit; a tester's beta main says its export's release", async () => {
  const d = mkdtempSync(join(tmpdir(), "sol-version-"));
  git(d, "init", "-q", "-b", "main");
  const c = commit(d, "Sol stable-20261029-2120");
  assert.deepEqual(await computeVersion(d), { release: "stable-20261029-2120", commit: c.slice(0, 8) });
  const e = commit(d, "something else");
  assert.equal(versionLine(await computeVersion(d)), `main ${e.slice(0, 8)}`);
});

test("not a checkout: none, and the line is unknown", async () => {
  assert.equal(await computeVersion(mkdtempSync(join(tmpdir(), "sol-version-"))), null);
  assert.equal(versionLine(null), "unknown");
});

test("solVersionOf: exactly its four fields, each its shape; anything else is none", () => {
  assert.deepEqual(solVersionOf({ release: "stable-20261030-0900", commit: "0c02970c", mine: 12, behind: 0, path: "/Users/x" }), { release: "stable-20261030-0900", commit: "0c02970c", mine: 12 });
  assert.equal(solVersionOf({ release: "main; rm -rf", commit: "0c02970c" }), undefined);
  assert.equal(solVersionOf({ release: "main", commit: "not-hex!" }), undefined);
  assert.equal(solVersionOf({ release: "x".repeat(61), commit: "0c02970c" }), undefined);
  assert.equal(solVersionOf("main 0c02970c"), undefined);
  assert.deepEqual(solVersionOf({ release: "main", commit: "0c02970c", behind: -3, mine: 1.5 }), { release: "main", commit: "0c02970c" });
});

const fake = () => { const got: any[] = []; return { got, send: (l: string) => got.push(JSON.parse(l)) }; };
const say = (login: string, kind: string, rest: object = {}) => JSON.stringify({ kind, from: { login, agent: false }, at: 1, ...rest });
const roster = (c: { got: any[] }) => c.got.filter((m) => m.kind === "roster").at(-1)!.roster as any[];

test("the hub: a hello's version is in the roster; an older Sol's hello has none; a presence brings a newer one and never drops it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const hub = new RelayHub({ rate: null });
  const a = fake(), b = fake();
  const v1 = { release: "stable-20261030-0900", commit: "0c02970c", mine: 12 };
  hub.join(a); hub.message(a, say("frank", "hello", { machine: "mac", version: v1 }));
  hub.join(b); hub.message(b, say("marco", "hello", { machine: "nuc" }));   // a Sol before #417
  assert.deepEqual(roster(b).find((e) => e.who === "frank").version, v1);
  assert.equal("version" in roster(b).find((e) => e.who === "marco"), false, "an older Sol: no version, shown as unknown");
  hub.message(a, say("frank", "presence", { state: "here" }));
  t.mock.timers.tick(1000);
  assert.deepEqual(roster(b).find((e) => e.who === "frank").version, v1, "a presence without one keeps the hello's");
  const v2 = { release: "stable-20261031-0900", commit: "1a2b3c4d", mine: 12 };
  hub.message(a, say("frank", "presence", { state: "here", version: v2 }));
  t.mock.timers.tick(1000);
  assert.deepEqual(roster(b).find((e) => e.who === "frank").version, v2, "after an update");
});
