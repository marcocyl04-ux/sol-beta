// The beta export's two doors (#124): a tester gets the user's door, what makes a Sol theirs (sol/mine/setup, rebase,
// the commit-msg hook) and the harness that wires the guard, and never the dev's (take, brief, the stage, the night
// job's script, the other MY SOL tools). Real git in a temp repo; the export is built with no beta remote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
});
const { exportTree, exportOffence, BETA_KEEP, betaReadme } = await import("../src/team/ship.ts");
// a private host and a personal address, in pieces: this file goes out in the export, which reads it (the export
// once caught the host's suffix here when only the front was split, so every dot is a join)
const PRIVATE = ["nucbox", "tail1a2b3c", "ts", "net"].join("."), MAIL = "someone@gm" + "ail.com";   // (and a key's first line, below, in three)

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

test("the user's door goes to testers, the dev's door stays home", async () => {
  const repo = mkdtempSync(join(tmpdir(), "sol-beta-keep-"));
  git(repo, "init", "-q", "-b", "main");
  const userDoor = ["sol/mine/setup", "sol/mine/rebase", "sol/mine/hooks/commit-msg", "sol/harness/guard", ".claude/settings.json"];
  const devDoor = ["sol/take", "sol/brief", "sol/night", "sol/promote", "sol/kit", "sol/mine/stage", "sol/mine/live",
    "sol/mine/unlive", ".claude/launch.json", "sol/design/together/BUILD.md", "now.md", "CONTRIBUTING.md"];
  for (const f of ["sol/engine/src/index.ts", "sol/setup", ...userDoor, ...devDoor]) {
    mkdirSync(join(repo, dirname(f)), { recursive: true });
    writeFileSync(join(repo, f), `${f}\n`);
  }
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "the house");
  const { commit, prev } = await exportTree(join(repo, "sol"), git(repo, "rev-parse", "HEAD"), "stable-20261022-1200");
  assert.equal(prev, "", "no beta remote: an export with no parent");
  const files = git(repo, "ls-tree", "-r", "--name-only", commit).split("\n");
  for (const f of userDoor) assert.ok(files.includes(f), `${f} goes to testers`);
  for (const f of devDoor) assert.ok(!files.includes(f), `${f} stays home`);
  assert.deepEqual(files.sort(), [".claude/settings.json", "README.md", "sol/engine/src/index.ts", "sol/harness/guard",
    "sol/mine/hooks/commit-msg", "sol/mine/rebase", "sol/mine/setup", "sol/setup"]);
  // the list names the user's door by path, never sol/mine whole (the stage and live are the dev's)
  assert.ok(!BETA_KEEP.includes("sol/mine") && !BETA_KEEP.includes(".claude"));
  assert.match(betaReadme("stable-x"), /git switch -c <you>\/mine && bash sol\/mine\/setup/, "the README says how to make it yours");
  assert.match(betaReadme("stable-x"), /bash sol\/mine\/rebase/, "and how to keep it through a new version");
});

// #169: the export refuses what must never leave the house, and names the place; the install goes out twice
test("the export check: a private address, a key, a person's address or a private file, and nothing is exported", async () => {
  assert.equal(exportOffence("sol/setup", Buffer.from("RELAY=wss://nucbox.example.ts.net/relay\n")), null, "the placeholder may stay");
  assert.equal(exportOffence("sol/engine/test/a.test.ts", Buffer.from(`x\nconst u = 'wss://legion.${PRIVATE}/';\n`)), `sol/engine/test/a.test.ts:2: a tailnet address, legion.${PRIVATE}`);
  assert.equal(exportOffence("sol/home/k", Buffer.from(["-----BEGIN", "OPENSSH PRIVATE", "KEY-----\n"].join(" "))), "sol/home/k:1: a private key");
  assert.equal(exportOffence("sol/HELP.md", Buffer.from(`ask\n${MAIL}\n`)), "sol/HELP.md:2: a personal address");
  assert.equal(exportOffence("sol/engine/.env", Buffer.from("")), "sol/engine/.env: a private file");
  assert.equal(exportOffence("sol/engine/team.json", Buffer.from("{}")), "sol/engine/team.json: a private file");
  assert.equal(exportOffence("sol/engine/.env.example", Buffer.from("GEMINI_API_KEY=\n")), null);
  assert.equal(exportOffence("sol/mac/icon.png", Buffer.from([0x89, 0, 0x74, 0x73, 0x2e, 0x6e])), null, "bytes are not words");

  const repo = mkdtempSync(join(tmpdir(), "sol-beta-check-"));
  git(repo, "init", "-q", "-b", "main");
  const put = (f: string, body: string) => { mkdirSync(join(repo, dirname(f)), { recursive: true }); writeFileSync(join(repo, f), body); };
  put("sol/engine/src/index.ts", "export {};\n"); put("sol/install", "#!/bin/sh\nmain() { :; }\nmain\n"); put("sol/setup", "#!/bin/bash\n");
  put("sol/engine/test/door.test.ts", `// a host\nconst h = 'https://nucbox.${PRIVATE}/';\n`);
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "the house");
  await assert.rejects(exportTree(join(repo, "sol"), git(repo, "rev-parse", "HEAD"), "stable-x"),
    new RegExp(`not exported: sol/engine/test/door\\.test\\.ts:2: a tailnet address, nucbox\\.${PRIVATE.replace(/\./g, "\\.")}`));
  put("sol/engine/test/door.test.ts", "// a host\nconst h = 'https://nucbox.example.ts.net/';\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "out");
  const { commit } = await exportTree(join(repo, "sol"), git(repo, "rev-parse", "HEAD"), "stable-x");
  const files = git(repo, "ls-tree", "-r", "--name-only", commit).split("\n");
  assert.ok(files.includes("sol/install") && files.includes("site/install"), "the install goes out, and the site serves the same file");
  assert.equal(git(repo, "cat-file", "-p", `${commit}:site/install`), git(repo, "cat-file", "-p", `${commit}:sol/install`));
  // the site's own domain (#308)
  assert.match(betaReadme("stable-x"), /curl -fsSL https:\/\/sol\.matterfold\.tech\/install \| sh/, "the README says the line");
  assert.ok(!/gh repo clone/.test(betaReadme("stable-x")), "and no longer asks for a GitHub account");
  assert.match(betaReadme("stable-x"), /ChatGPT \(Plus or Pro, through Codex\) works too/, "ChatGPT is named as a way in (#362)");
  assert.ok(!/no team features/.test(betaReadme("stable-x")), "and it no longer denies the rooms a beta Sol shares on the cloud");
  assert.match(betaReadme("stable-x"), /\*\*Update\*\* button/, "a new version reaches a tester inside Sol, not only by git pull");
});

test("a tester's rebase: a beta repo with no stable (exports before 2026-10-29) still works, their */mine goes onto its main, the latest export", () => {
  const top = mkdtempSync(join(tmpdir(), "sol-beta-rebase-"));
  const beta = join(top, "sol-beta.git"), house = join(top, "house"), tester = join(top, "tester");
  git(top, "init", "-q", "--bare", "-b", "main", beta);
  git(top, "init", "-q", "-b", "main", house);
  const put = (cwd: string, f: string, body: string, msg: string) => { mkdirSync(join(cwd, dirname(f)), { recursive: true }); writeFileSync(join(cwd, f), body); git(cwd, "add", "-A"); git(cwd, "commit", "-qm", msg); };
  const rebase = join(import.meta.dirname, "../../mine/rebase");
  put(house, "sol/HELP.md", "v1\n", "Sol stable-20261022-1200");
  git(house, "push", "-q", beta, "main");
  git(top, "clone", "-q", beta, tester);
  git(tester, "switch", "-q", "-c", "t/mine");
  put(tester, "sol/home/mine.txt", "my own\n", "mine: my own look");
  put(house, "sol/HELP.md", "v2\n", "Sol stable-20261023-1200");
  git(house, "push", "-q", beta, "main");
  const out = execFileSync("bash", [rebase], { cwd: tester, encoding: "utf8" });
  assert.match(out, /t\/mine is on origin\/main, 1 commit of his own over it/);
  assert.equal(git(tester, "show", "HEAD:sol/HELP.md"), "v2", "the new version is under it");
  assert.equal(git(tester, "log", "-1", "--format=%s"), "mine: my own look", "their own change on top");
  // a main that is not an export (a dev's clone of sol-dev, stable not fetched) is never taken for stable
  put(house, "x.txt", "x\n", "a teammate's commit");
  git(house, "push", "-q", beta, "main");
  git(tester, "fetch", "-q", "origin");
  assert.throws(() => execFileSync("bash", [rebase], { cwd: tester, stdio: "pipe" }), /no stable branch/);
});

test("every file the export keeps, as it is in this checkout, passes the export check (S6b: a test's address once slipped in)", () => {
  const root = git(join(import.meta.dirname, ".."), "rev-parse", "--show-toplevel");
  const files = git(root, "ls-files", "-z", "--", ...BETA_KEEP).split("\0").filter(Boolean);
  assert.ok(files.length > 100, "the kept paths are there");
  const offences = files.map((f) => { try { return exportOffence(f, readFileSync(join(root, f))); } catch { return null; } }).filter(Boolean);
  assert.deepEqual(offences, []);
});
