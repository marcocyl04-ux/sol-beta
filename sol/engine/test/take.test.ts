// Take (#83) and its one-base-branch rule (#296): `bash sol/take` run for real against a temp repository with a bare
// origin, and a fake gh on PATH that answers from a small made-up tracker and writes down what it was asked.
// Nothing here reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TAKE = resolve(import.meta.dirname, "../../take");
const git = (args: string[], cwd: string) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

type Issue = { number: number; title: string; labels: string[]; assignees: string[]; state?: string };
// the fake gh: reads the tracker from $FAKE_GH_WORLD, appends each call to $FAKE_GH_LOG
const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const w = JSON.parse(fs.readFileSync(process.env.FAKE_GH_WORLD, "utf8"));
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(a) + "\\n");
const shape = (i) => ({ number: i.number, title: i.title, state: i.state || "OPEN", labels: i.labels.map((name) => ({ name })), assignees: i.assignees.map((login) => ({ login })) });
if (a[0] === "api" && a[1] === "user") { console.log(w.login); process.exit(0); }
if (a[0] === "issue" && a[1] === "view") { const i = w.issues.find((x) => x.number === Number(a[2])); if (!i) process.exit(1); console.log(JSON.stringify(shape(i))); process.exit(0); }
if (a[0] === "issue" && a[1] === "list") {
  const want = a.flatMap((x, k) => (a[k - 1] === "--label" ? [x] : []));
  console.log(JSON.stringify(w.issues.filter((i) => (i.state || "OPEN") === "OPEN" && want.every((l) => i.labels.includes(l))).map((i) => ({ number: i.number, assignees: shape(i).assignees }))));
  process.exit(0);
}
process.exit(0);
`;

function world(login: string, issues: Issue[]) {
  const dir = mkdtempSync(join(tmpdir(), "sol-take-"));
  const origin = join(dir, "origin.git"), work = join(dir, "work"), bin = join(dir, "bin");
  git(["init", "-q", "--bare", "-b", "main", origin], dir);
  git(["clone", "-q", origin, work], dir);
  git(["config", "user.email", "t@example.com"], work); git(["config", "user.name", "t"], work);
  writeFileSync(join(work, "README.md"), "x\n");
  git(["add", "."], work); git(["commit", "-q", "-m", "first"], work); git(["push", "-q", "origin", "HEAD:main"], work);
  mkdirSync(bin); writeFileSync(join(bin, "gh"), FAKE_GH); chmodSync(join(bin, "gh"), 0o755);
  const worldFile = join(dir, "world.json"), log = join(dir, "gh.log");
  writeFileSync(worldFile, JSON.stringify({ login, issues })); writeFileSync(log, "");
  const take = (n: number) => spawnSync("bash", [TAKE, String(n)], { cwd: work, encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_GH_WORLD: worldFile, FAKE_GH_LOG: log, GIT_CONFIG_GLOBAL: "/dev/null" } });
  const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);
  const branches = () => git(["branch", "--format=%(refname:short)"], work).split("\n");
  const remote = () => git(["ls-remote", "--heads", "origin"], work);
  return { take, calls, branches, remote };
}

test("take: my own second base branch goes through (#296), as CONTRIBUTING says", () => {
  const w = world("marcocyl04-ux", [
    { number: 271, title: "Sol runs natively on Windows", labels: ["base", "now"], assignees: ["marcocyl04-ux"] },
    { number: 296, title: "Take refuses your own second base branch", labels: ["base", "bug"], assignees: [] },
  ]);
  const r = w.take(296);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(w.branches().includes("marcocyl04-ux/base-take-refuses-your-296"));
  assert.match(w.remote(), /refs\/heads\/marcocyl04-ux\/base-take-refuses-your-296/);
  assert.ok(w.calls().some((c) => c.join(" ") === "issue edit 296 --add-assignee marcocyl04-ux --add-label now"));
});

test("take: another person's open base branch still stops a base take, and names them", () => {
  const w = world("marcocyl04-ux", [
    { number: 300, title: "Setup and tests", labels: ["base", "now"], assignees: ["frank"] },
    { number: 271, title: "the port", labels: ["base", "now"], assignees: ["marcocyl04-ux"] },
    { number: 296, title: "Take refuses", labels: ["base"], assignees: [] },
  ]);
  const r = w.take(296);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /base allows one open branch at a time, and #300 \(frank\) is open/);
  assert.doesNotMatch(r.stderr, /#271/);
  assert.ok(!w.branches().some((b) => b.endsWith("-296")));
  assert.ok(!w.calls().some((c) => c[0] === "issue" && c[1] === "edit"));
});

test("take: the issue being taken and unheld base issues never count", () => {
  const w = world("isaac", [
    { number: 296, title: "Take refuses", labels: ["base", "now"], assignees: [] },
    { number: 280, title: "nobody holds this", labels: ["base", "now"], assignees: [] },
  ]);
  const r = w.take(296);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(w.branches().includes("isaac/base-take-refuses-296"));
});

test("take: a label other than base is never held back by an open base branch", () => {
  const w = world("marcocyl04-ux", [
    { number: 300, title: "Setup and tests", labels: ["base", "now"], assignees: ["frank"] },
    { number: 310, title: "The face holds still", labels: ["life"], assignees: [] },
  ]);
  const r = w.take(310);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(w.branches().includes("marcocyl04-ux/life-the-face-holds-310"));
});
