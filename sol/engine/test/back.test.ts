// sol/back (#18): one step back for the face and the engine, with no one around. Runs the real script in a temp copy
// of sol/ inside a real git repo, with --no-restart (no launchd or systemd is touched by a test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOL = join(import.meta.dirname, "..", "..");
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const back = (root: string, ...a: string[]) => {
  try { return { code: 0, out: execFileSync("bash", [join(root, "sol", "back"), ...a], { cwd: root, encoding: "utf8", timeout: 20000 }) }; }
  catch (e: any) { return { code: e.status as number, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sol-back-"));
  git(root, "init", "-q", "-b", "main");
  mkdirSync(join(root, "sol", "mac", "src"), { recursive: true });
  mkdirSync(join(root, "sol", "design"), { recursive: true });
  mkdirSync(join(root, "sol", "engine", "dist"), { recursive: true });
  for (const f of ["back", "undo"]) { copyFileSync(join(SOL, f), join(root, "sol", f)); chmodSync(join(root, "sol", f), 0o755); }
  writeFileSync(join(root, "sol", "mac", "src", "A.tsx"), "a1\n");
  writeFileSync(join(root, "sol", "design", "x.md"), "x\n");
  writeFileSync(join(root, "sol", "engine", "dist", "index.js"), "bad\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "start");
  return root;
}

test("back --plan: names the good build and the face's newest change, changes nothing", () => {
  const root = fixture();
  let r = back(root, "--plan");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^engine none$/m);
  assert.match(r.out, /^face none$/m);
  mkdirSync(join(root, "sol", "engine", "dist.good")); writeFileSync(join(root, "sol", "engine", "dist.good", "index.js"), "good\n");
  writeFileSync(join(root, "sol", "mac", "src", "A.tsx"), "a2\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "mutate: the notch blinks twice");
  r = back(root, "--plan");
  assert.match(r.out, /^engine \d{4}-\d\d-\d\dT/m);
  assert.match(r.out, /^face mutate [0-9a-f]+ the notch blinks twice$/m);
  writeFileSync(join(root, "sol", "mac", "src", "A.tsx"), "a3 dirty\n");
  r = back(root, "--plan");
  assert.match(r.out, /^face dirty 1$/m);
  assert.equal(readFileSync(join(root, "sol", "engine", "dist", "index.js"), "utf8"), "bad\n");
  assert.equal(readFileSync(join(root, "sol", "mac", "src", "A.tsx"), "utf8"), "a3 dirty\n");
});

test("back: an uncommitted face edit is set aside, the good build comes back, the bad one waits in dist.bad", () => {
  const root = fixture();
  mkdirSync(join(root, "sol", "engine", "dist.good")); writeFileSync(join(root, "sol", "engine", "dist.good", "index.js"), "good\n");
  writeFileSync(join(root, "sol", "mac", "src", "A.tsx"), "broken\n");
  const r = back(root, "--no-restart");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /set aside in git stash/);
  assert.match(r.out, /last good build .* is back/);
  assert.equal(readFileSync(join(root, "sol", "mac", "src", "A.tsx"), "utf8"), "a1\n");
  assert.match(git(root, "stash", "list"), /back: face edits set aside/);
  assert.equal(readFileSync(join(root, "sol", "engine", "dist", "index.js"), "utf8"), "good\n");
  assert.equal(readFileSync(join(root, "sol", "engine", "dist.bad", "index.js"), "utf8"), "bad\n");
  assert.ok(existsSync(join(root, "sol", "engine", "dist", ".reverted")));
});

test("back: with a clean face, the newest mutate is undone; --keep-face leaves it; no good build is said, not a failure", () => {
  const root = fixture();
  writeFileSync(join(root, "sol", "mac", "src", "A.tsx"), "a2\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "mutate: the notch blinks twice");
  let r = back(root, "--no-restart", "--keep-face");
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /taken back/);
  assert.match(r.out, /no good build to go back to/);
  assert.equal(readFileSync(join(root, "sol", "mac", "src", "A.tsx"), "utf8"), "a2\n");
  r = back(root, "--no-restart");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /taken back: .*the notch blinks twice/);
  assert.equal(readFileSync(join(root, "sol", "mac", "src", "A.tsx"), "utf8"), "a1\n");
  assert.match(git(root, "log", "-1", "--format=%s"), /^undo: the notch blinks twice/);
  r = back(root, "--plan");
  assert.match(r.out, /^face none$/m);   // once more would go one further back; here there is none
});
