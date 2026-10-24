// sol/setup --dev (#124): the dev's second door. Your Sol goes onto <login>/mine with sol/mine/setup, the workshop (a
// clone of sol-dev on main) is made beside it, the stage starts once, and the one rule is said; run again, nothing
// moves. Real git in a temp folder whose origin is a bare repo named sol-dev.git; gh and the stage are stand-ins, and
// SOL_SETUP_DEV_ONLY runs the step alone, so nothing here builds, installs or reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const real = join(import.meta.dirname, "../..");   // this checkout's sol/
const top = realpathSync(mkdtempSync(join(tmpdir(), "sol-setup-dev-")));
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", SOL_NO_KEEP: "1", SOL_SETUP_DEV_ONLY: "1", STAGE_LOG: join(top, "stage.log"),
  PATH: `${join(top, "bin")}:${process.env.PATH}` };
delete (env as Record<string, unknown>).SOL_WORKSHOP;
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();
const setup = (sol: string, extra: Record<string, string> = {}, ...args: string[]) => {
  const r = spawnSync("bash", [join(sol, "sol", "setup"), "--dev", ...args], { env: { ...env, ...extra }, encoding: "utf8", input: "" });
  return { code: r.status, out: r.stdout + r.stderr };
};
const write = (f: string, body: string, mode = 0o644) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); chmodSync(f, mode); };

// gh says who I am and clones nothing (the workshop comes from the Sol's own origin)
write(join(top, "bin", "gh"), `#!/usr/bin/env bash\n[ "$1 $2" = "api user" ] && { echo tester; exit 0; }\necho "gh $*" >> "${join(top, "gh.log")}"; exit 1\n`, 0o755);
// the house: sol-dev with the real setup and MY SOL tools, a stand-in stage, main and stable
const origin = join(top, "sol-dev.git"), house = join(top, "house");
git(top, "init", "-q", "--bare", "-b", "main", origin);
git(top, "init", "-q", "-b", "main", house);
for (const f of ["setup", "mine/setup", "mine/rebase", "mine/hooks/commit-msg"]) {
  mkdirSync(dirname(join(house, "sol", f)), { recursive: true });
  copyFileSync(join(real, f), join(house, "sol", f)); chmodSync(join(house, "sol", f), 0o755);
}
write(join(house, "sol", "mine", "stage"), `#!/usr/bin/env bash\necho "$1" >> "$STAGE_LOG"\ncase $1 in up) echo "mine/stage: up. Open http://127.0.0.1:1422/?ws=127.0.0.1:7779" ;; status) echo "mine/stage: engine down on 7779" ;; esac\n`, 0o755);
write(join(house, "sol", "HELP.md"), "help\n");
git(house, "add", "-A"); git(house, "commit", "-qm", "start");
git(house, "remote", "add", "origin", origin);
git(house, "push", "-q", "origin", "main", "main:stable");
write(join(house, "now.md"), "main is ahead of stable\n");
git(house, "add", "-A"); git(house, "commit", "-qm", "next"); git(house, "push", "-q", "origin", "main");
// a person's Sol, as the kit makes it: a clone on stable
const sol = (name: string, branch = "stable") => { const d = join(top, name, "ecosystem"); mkdirSync(dirname(d), { recursive: true }); git(top, "clone", "-q", "-b", branch, origin, d); return d; };
const stageRuns = () => existsSync(env.STAGE_LOG) ? readFileSync(env.STAGE_LOG, "utf8").split("\n").filter(Boolean) : [];

test("first run: your Sol on tester/mine with its hook, the workshop beside it on main, the stage once, the rule", () => {
  const me = sol("a");
  const r = setup(me);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /your Sol is on tester\/mine now, made from stable/);
  assert.equal(git(me, "symbolic-ref", "--short", "HEAD"), "tester/mine");
  assert.equal(git(me, "rev-parse", "HEAD"), git(origin, "rev-parse", "stable"), "made from stable, not main");
  assert.equal(git(me, "config", "--worktree", "--get", "core.hooksPath"), "sol/mine/hooks", "sol/mine/setup ran");
  write(join(me, "look.txt"), "mine\n"); git(me, "add", "look.txt"); git(me, "commit", "-qm", "my look");
  assert.equal(git(me, "log", "-1", "--format=%s"), "mine: my look", "a commit in your Sol gets mine: in front");
  const ws = join(top, "a", "sol-dev");
  assert.match(r.out, new RegExp(`the workshop is ${ws}, a clone of sol-dev on main`));
  assert.equal(git(ws, "symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(git(ws, "rev-parse", "HEAD"), git(origin, "rev-parse", "main"));
  assert.match(r.out, /the stage: up\. Open http:\/\/127\.0\.0\.1:1422/);
  assert.deepEqual(stageRuns(), ["up"]);
  assert.match(r.out, /rule {2}your own Sol is never the dev checkout/);
  assert.match(r.out, new RegExp(`your Sol {7}${me}\n.*bash sol/mine/rebase\n.*the workshop {3}${ws}\n.*bash sol/take <issue>`));
  assert.ok(!existsSync(join(top, "gh.log")), "gh cloned nothing");

  // again: everything is there, it says so, nothing moves
  const before = git(ws, "rev-parse", "HEAD"), mineAt = git(me, "rev-parse", "HEAD");
  const again = setup(me);
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /your Sol is on tester\/mine: stable plus your own changes/);
  assert.match(again.out, /done before/);
  assert.match(again.out, new RegExp(`the workshop is ${ws}, on main`));
  assert.doesNotMatch(again.out, /cloning/);
  assert.equal(git(ws, "rev-parse", "HEAD"), before);
  assert.equal(git(me, "rev-parse", "HEAD"), mineAt);

  // --check only reports
  const check = setup(me, {}, "--check");
  assert.equal(check.code, 0, check.out);
  assert.match(check.out, /note {2}the stage: engine down on 7779/);
  assert.deepEqual(stageRuns(), ["up", "up", "status"]);
});

test("a work branch is a workshop already: the step stops, nothing is made", () => {
  const ws = sol("b", "main");
  git(ws, "switch", "-q", "-c", "tester/cowork-thing-1");
  const r = setup(ws);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /on tester\/cowork-thing-1, a work branch: it is a workshop, not a Sol to live in/);
  assert.ok(!existsSync(join(top, "b", "sol-dev")));
  assert.equal(git(ws, "symbolic-ref", "--short", "HEAD"), "tester/cowork-thing-1");
});

test("never over what is there: a dirty Sol stays on stable; a folder that is not sol-dev is not touched", () => {
  const me = sol("c");
  write(join(me, "sol", "HELP.md"), "my edit\n");
  let r = setup(me);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /changes not committed on stable/);
  assert.equal(git(me, "symbolic-ref", "--short", "HEAD"), "stable");
  git(me, "checkout", "-q", "--", "sol/HELP.md");
  write(join(top, "c", "sol-dev", "notes.txt"), "someone's\n");
  r = setup(me);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /sol-dev is there but is not a checkout of sol-dev; not touching it/);
  assert.equal(readFileSync(join(top, "c", "sol-dev", "notes.txt"), "utf8"), "someone's\n");
});

test("a Sol that is a worktree of a sol-dev checkout (Marco's MY SOL): that checkout is the workshop, nothing is cloned", () => {
  const ws = sol("d", "main");
  const me = join(top, "d", "my-sol");
  git(ws, "worktree", "add", "-q", "-b", "marco/mine", me, "origin/stable");
  const r = setup(me);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /your Sol is on marco\/mine: stable plus your own changes/);
  assert.match(r.out, new RegExp(`the workshop is ${ws}, on main`));
  assert.ok(!existsSync(join(top, "d", "sol-dev")));
  assert.equal(spawnSync("git", ["config", "--worktree", "--get", "core.hooksPath"], { cwd: ws, env, encoding: "utf8" }).stdout.trim(), "",
    "the workshop keeps its own hooks");
});
