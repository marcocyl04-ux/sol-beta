// Try and review (#35, design/together/5-try/PRD.md, PROTOCOL.md round 22). Real git in a temp repo whose origin is a
// bare temp repo (as test/together-ship.test.ts); GitHub is a fake `gh` on PATH that records its arguments and answers
// canned JSON; the second Sol is never spawned whole: its command is built and checked, and `sleep` stands in for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const top = mkdtempSync(join(tmpdir(), "sol-try-test-"));
// the fake gh: every call is a line in gh.log; `pr view` answers the PR, `api` answers a comment, the rest says ok
const bin = join(top, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "gh"), `#!/bin/sh
printf '%s\\n' "$*" >> "${join(top, "gh.log")}"
case "$1 $2" in
  "pr view") printf '{"number":29,"title":"Sleep and wake","headRefName":"frank/sleep-wake","headRefOid":"abc123","isCrossRepository":false,"author":{"login":"frank"},"state":"OPEN"}\\n' ;;
  "api user") printf '{"login":"marco","name":"Marco"}\\n' ;;
  "api -X")
    case "$*" in *"line=999"*) echo "HTTP 422: line must be part of the diff" >&2; exit 1 ;; esac
    printf '{"html_url":"https://github.com/o/r/pull/29#discussion_r1"}\\n' ;;
  "pr comment") echo "https://github.com/o/r/pull/29#issuecomment-2" ;;
  *) echo ok ;;
esac
`);
chmodSync(join(bin, "gh"), 0o755);
const ghLog = () => (existsSync(join(top, "gh.log")) ? readFileSync(join(top, "gh.log"), "utf8").trim().split("\n") : []);

Object.assign(process.env, {
  PATH: `${bin}:${process.env.PATH}`,
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  SOL_NO_SHIP_CHECK: "1", SOL_TEAM_OFFLINE: "1",
  SOL_TEAM_FILE: join(top, "team.json"), SOL_STATE: join(top, "state", "work.json"),
});
writeFileSync(join(top, "team.json"), JSON.stringify({ me: { login: "marco", name: "Marco" } }));
const T = await import("../src/team/try.ts");
const { copies } = await import("../src/work/state.ts");
const { patchTeam } = await import("../src/team/settings.ts");

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
function fixture() {
  const dir = mkdtempSync(join(top, "repo-"));
  const origin = join(dir, "origin.git");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  const marco = join(dir, "marco");
  mkdirSync(join(marco, "sol", "home"), { recursive: true });
  git(marco, "init", "-q", "-b", "main");
  writeFileSync(join(marco, "sol", "home", "CLAUDE.md"), "# home\n");
  writeFileSync(join(marco, "sol", "home", "AGENTS.md"), "# agents\n");
  writeFileSync(join(marco, "sol", "home", "secret-memory.md"), "never copied\n");
  writeFileSync(join(marco, ".gitignore"), ".claude/\n");
  git(marco, "add", "-A"); git(marco, "commit", "-qm", "start");
  git(marco, "remote", "add", "origin", origin);
  git(marco, "push", "-q", "-u", "origin", "main");
  // frank's branch, pushed from his own clone
  const frank = join(dir, "frank");
  git(dir, "clone", "-q", origin, frank);
  git(frank, "checkout", "-q", "-b", "frank/sleep-wake");
  writeFileSync(join(frank, "wake.txt"), "one\n");
  git(frank, "add", "-A"); git(frank, "commit", "-qm", "wake: one");
  git(frank, "push", "-q", "-u", "origin", "frank/sleep-wake");
  return { dir, origin, marco, frank };
}

test("the names: the branch, the copy's folder, the review id, a signature line", () => {
  assert.equal(T.tryBranch("marco", 29), "try/marco/29");
  assert.equal(T.tryBranch("", 29), "try/me/29");
  assert.equal(T.tryCopyPath("/r/ecosystem", "", 29), "/r/ecosystem/.claude/worktrees/try-29");
  assert.equal(T.tryCopyPath("/r/ecosystem", "/copies", 29), "/copies/ecosystem/try-29");
  assert.equal(T.reviewId("marcocyl04-ux/sol-dev", 29), "review-marcocyl04-ux-sol-dev-29");
  assert.match(T.reviewId("marcocyl04-ux/sol-dev", 29), /^[A-Za-z0-9_-]{8,80}$/);   // Work's session-id shape
  assert.equal(T.signed("looks good\n", "marco's agent"), "looks good\n\n— marco's agent");
  assert.equal(T.lastLine("a\n\x1b[32mbuilt in 2s\x1b[0m\n\n"), "built in 2s");
  assert.ok(T.okRepo("marcocyl04-ux/sol-dev") && !T.okRepo("../x") && !T.okRepo("a/b/c"));
  assert.ok(T.okPr(29) && !T.okPr(0) && !T.okPr("x") && !T.okPr(1.5));
});

test("try makes the copy on try/<login>/<pr> from the PR's head, then updates it fast-forward", async () => {
  const f = fixture();
  const c = await T.makeTryCopy({ repoDir: f.marco, wtDir: "", pr: 29, login: "marco", head: "frank/sleep-wake" });
  assert.equal(c.made, true);
  assert.equal(c.path, join(f.marco, ".claude", "worktrees", "try-29"));
  assert.equal(c.branch, "try/marco/29");
  assert.equal(git(c.path, "branch", "--show-current"), "try/marco/29");
  assert.equal(c.sha, git(f.frank, "rev-parse", "HEAD"));
  assert.equal(readFileSync(join(c.path, "wake.txt"), "utf8"), "one\n");
  assert.equal(copies()[c.path], f.marco, "noted as a copy Sol made, so the side-copies drawer lists it");
  assert.equal(git(f.marco, "branch", "--show-current"), "main", "my own checkout did not move");

  // frank pushes again: the same copy, updated
  writeFileSync(join(f.frank, "wake.txt"), "two\n");
  git(f.frank, "commit", "-qam", "wake: two"); git(f.frank, "push", "-q");
  const again = await T.makeTryCopy({ repoDir: f.marco, wtDir: "", pr: 29, login: "marco", head: "frank/sleep-wake" });
  assert.equal(again.made, false);
  assert.equal(again.path, c.path);
  assert.equal(again.sha, git(f.frank, "rev-parse", "HEAD"));
  assert.equal(readFileSync(join(c.path, "wake.txt"), "utf8"), "two\n");

  // under the work drawer's folder when one is set
  const wt = join(f.dir, "copies");
  const there = await T.makeTryCopy({ repoDir: f.marco, wtDir: wt, pr: 30, login: "marco", head: "frank/sleep-wake" });
  assert.equal(there.path, join(wt, "marco", "try-30"));
  assert.equal(git(there.path, "branch", "--show-current"), "try/marco/30");

  await assert.rejects(T.makeTryCopy({ repoDir: f.marco, wtDir: "", pr: 31, login: "marco", head: "--upload-pack=x" }), /not one git takes/);
  await assert.rejects(T.makeTryCopy({ repoDir: f.marco, wtDir: "", pr: 32, login: "marco", head: "frank/nothing" }), /could not fetch/);
});

test("what a teammate's branch runs gets PATH and HOME and the rest of the allowlist, never a key, token or webhook", () => {
  const mine = {
    PATH: "/bin:/usr/bin", HOME: "/Users/m", TMPDIR: "/tmp/m", LANG: "en_US.UTF-8", SHELL: "/bin/zsh", USER: "m", TERM: "xterm",
    GH_TOKEN: "ghp_x", GITHUB_TOKEN: "ghp_y", ANTHROPIC_API_KEY: "sk-ant", GEMINI_API_KEY: "g", DISCORD_WEBHOOK: "https://d/x",
    SOME_KEY: "k", SOL_OWNER: "marco@github", SOL_PORT: "7777", NODE_OPTIONS: "--require /x.js", SSH_AUTH_SOCK: "/s",
  };
  const step = T.stepEnv(mine);
  const { engine, face } = T.secondSol("/c", "/t", mine, "/usr/bin/node");
  for (const [what, env] of [["npm ci and the builds", step], ["its engine", engine.env], ["its face", face.env]] as const) {
    for (const k of ["GH_TOKEN", "GITHUB_TOKEN", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "DISCORD_WEBHOOK", "SOME_KEY", "SOL_OWNER", "NODE_OPTIONS", "SSH_AUTH_SOCK"])
      assert.equal(env[k], undefined, `${what}: ${k}`);
    assert.equal(env.PATH, "/bin:/usr/bin", what);
    assert.equal(env.HOME, "/Users/m", what);
    for (const v of Object.values(env)) assert.ok(!/ghp_|sk-ant|https:\/\/d\//.test(v), `${what}: no secret value under another name`);
  }
  assert.deepEqual(Object.keys(step).sort(), [...T.PASS, "CI", "GIT_TERMINAL_PROMPT", "npm_config_audit", "npm_config_fund"].sort());
  assert.equal(step.npm_config_fund, "false");
  assert.equal(engine.env.SOL_PORT, "7778", "the values set for the second Sol still win");
  assert.deepEqual(T.childEnv({ PATH: "/bin" }), { PATH: "/bin" }, "what is not set is left out, not empty");
});

test("the second Sol: engine on 7778 and face on 1421, its own state, an empty home, none of my secrets", () => {
  const { engine, face } = T.secondSol("/c", "/t", {
    PATH: "/bin", HOME: "/Users/m", SOL_PORT: "7777", SOL_OWNER: "marco@github", SOL_HOME: "/Users/m/sol/home",
    SOL_STATE: "/Users/m/work.json", SOL_SESSIONS_DIR: "/x", GEMINI_API_KEY: "k", ANTHROPIC_MODEL: "m",
  }, "/usr/bin/node");
  assert.deepEqual([engine.cmd, engine.args, engine.cwd], ["/usr/bin/node", ["dist/index.js"], "/c/sol/engine"]);
  assert.equal(engine.env.PORT, "7778");
  assert.equal(engine.env.SOL_PORT, "7778", "SOL_PORT wins over PORT in index.ts, so both say 7778");
  assert.equal(engine.env.SOL_STATE, "/t/state/work.json");
  assert.equal(engine.env.SOL_HOME, "/t/home");
  assert.equal(engine.env.SOL_TEAM, "/t/team.json");
  assert.equal(engine.env.SOL_PROFILE, "/t/profile");
  assert.equal(engine.env.SOL_DIST, "/c/sol/mac/dist");
  assert.equal(engine.env.SOL_NO_RENEW, "1");
  assert.equal(engine.env.SOL_NO_SHIP_CHECK, "1");
  for (const k of ["SOL_OWNER", "SOL_SESSIONS_DIR", "GEMINI_API_KEY"]) { assert.equal(engine.env[k], undefined, k); assert.equal(face.env[k], undefined, k); }
  assert.equal(engine.env.ANTHROPIC_MODEL, undefined, "only the allowlist passes, even what is not a secret");
  assert.equal(engine.env.HOME, "/Users/m", "the machine's own HOME stays (Claude's sign-in lives there)");
  for (const v of Object.values(engine.env)) assert.ok(!v.includes("/Users/m/sol/home") && !v.includes("/Users/m/work.json"), "nothing points at my Sol's home or state");

  assert.equal(face.cwd, "/c/sol/mac");
  assert.deepEqual(face.args, ["node_modules/vite/bin/vite.js", "--config", "node_modules/.sol-try/vite.config.mjs", "--port", "1421", "--strictPort", "--host", "127.0.0.1"]);
  assert.equal(face.env.VITE_ENGINE, "ws://127.0.0.1:1421/sol-engine");
  assert.equal(face.env.SOL_TRY_ENGINE, "7778");
  const cfg = T.faceConfig();
  assert.match(cfg, /import base from "\.\.\/\.\.\/vite\.config\.ts"/);
  assert.match(cfg, /"\/sol-engine": \{ target: engine, ws: true/);
  assert.match(cfg, /port: 1421, strictPort: true/);
  assert.match(cfg, /setHeader\("origin", engine\)/, "the proxy speaks with the engine's own Origin, which its door lets in");
});

test("the home holds only the committed CLAUDE.md and AGENTS.md", () => {
  const f = fixture();
  const t = mkdtempSync(join(top, "tmp-"));
  const home = T.makeHome(f.marco, t);
  assert.deepEqual(readdirSync(home).sort(), ["AGENTS.md", "CLAUDE.md", "life", "memory"]);
  assert.deepEqual(readdirSync(join(home, "memory")), []);
});

test("stop kills what the try started, both process groups, and keeps the copy", async () => {
  const f = fixture();
  const c = await T.makeTryCopy({ repoDir: f.marco, wtDir: "", pr: 29, login: "marco", head: "frank/sleep-wake" });
  const env = { PATH: process.env.PATH ?? "" };
  // a stand-in for each program that also starts a child of its own: the group goes, not only the leader
  const sh = (name: "engine" | "face") => ({ name, cmd: "/bin/sh", args: ["-c", "sleep 37 & sleep 37; wait"], cwd: c.path, env });
  const ended: string[] = [];
  T.launchAll([sh("engine"), sh("face")], (n) => ended.push(n));
  await new Promise((r) => setTimeout(r, 300));
  const pids = execFileSync("pgrep", ["-f", "sleep 37"], { encoding: "utf8" }).trim().split("\n").map(Number);
  assert.ok(pids.length >= 4, "two programs, each with its child");
  const r = await T.stopTry();
  assert.deepEqual(r.stopped.sort(), ["engine", "face"]);
  await new Promise((r) => setTimeout(r, 200));
  for (const p of pids) assert.throws(() => process.kill(p, 0), `pid ${p} is gone`);
  assert.deepEqual(ended, [], "a stop is not the programs ending by themselves");
  assert.ok(existsSync(join(c.path, "wake.txt")), "the copy stays");
  assert.equal(T.tryNow(), null);
});

test("a program that cannot start is told as ended at once, not after the wait", async () => {
  const told: string[] = [];
  T.launch({ name: "engine", cmd: "/no/such/node", args: [], cwd: tmpdir(), env: {} }, (_c, last) => told.push(last));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(told.length, 1, "told once");
  assert.match(told[0], /ENOENT/);
  await T.stopTry();
});

test("one try at a time: a second is refused with the first named", async () => {
  const f = fixture();
  const states: any[] = [];
  T.setTryBus((m) => states.push(m));
  // the real flow up to the builds: a branch with no sol/engine fails there, after the copy, and the try ends
  const r = await T.startTry("o/r", 29, f.marco);
  assert.match(String((r as any).error), /no sol\/engine and sol\/mac to run/);
  const steps = states.filter((m) => m.type === "team.try.step");
  assert.deepEqual(steps.map((s) => [s.step, s.done, s.ok ?? null]), [["copy", false, null], ["copy", true, true]]);
  assert.match(steps[1].line, /made try-29 on try\/marco\/29 at [0-9a-f]{7}/);
  assert.equal(T.tryNow(), null, "the failed try is over");
  // while one is on (a stand-in started by hand), a second answers with it
  const held = T.startTry("o/r", 30, f.marco);
  const second = await T.startTry("o/r", 31, f.marco);
  assert.match(String((second as any).error), /already trying #30; stop that one first/);
  assert.equal((second as any).trying.pr, 30);
  await held;
  T.setTryBus(() => {});
});

test("mark ready is the person's, signed with the login; a comment is signed; a remark is signed by my agent", async () => {
  const before = ghLog().length;
  const r = await T.markReady("o/r", 29);
  assert.deepEqual(r, { ok: true, by: "marco" });
  assert.equal(ghLog()[before], "pr ready 29 --repo o/r");

  const c = await T.commentPr({ repo: "o/r", pr: 29, body: "ran it on the mac, sleep works" }) as any;
  assert.equal(c.by, "marco");
  assert.equal(c.inline, false);
  assert.match(readFileSync(join(top, "gh.log"), "utf8"), /pr comment 29 --repo o\/r --body ran it on the mac, sleep works\n\n— marco\n/);

  // a remark on a line in the diff: a review comment on that line, the head's commit, signed by my agent
  const inl = await T.commentPr({ repo: "o/r", pr: 29, body: "this never resets", path: "sol/engine/src/a.ts", line: 12, remark: "review:x:0" }) as any;
  assert.equal(inl.by, "marco's agent");
  assert.equal(inl.inline, true);
  assert.match(readFileSync(join(top, "gh.log"), "utf8"), /api -X POST repos\/o\/r\/pulls\/29\/comments -f body=this never resets\n\n— marco's agent -f commit_id=abc123 -f path=sol\/engine\/src\/a\.ts -F line=12 -f side=RIGHT/);

  // a line GitHub refuses: a plain comment naming file and line
  const out = await T.commentPr({ repo: "o/r", pr: 29, body: "off the diff", path: "b.ts", line: 999, remark: "review:x:1" }) as any;
  assert.equal(out.inline, false);
  assert.match(readFileSync(join(top, "gh.log"), "utf8"), /pr comment 29 --repo o\/r --body `b\.ts:999`\n\noff the diff\n\n— marco's agent/);

  // my agent may not speak on GitHub: the remark is refused, the person's own comment is not
  patchTeam({ speak: { github: false } });
  assert.match(String(((await T.commentPr({ repo: "o/r", pr: 29, body: "x", remark: "review:x:2" })) as any).error), /may not speak on GitHub/);
  assert.equal(((await T.commentPr({ repo: "o/r", pr: 29, body: "mine" })) as any).ok, true);
  patchTeam({ speak: { github: true } });
});

test("the wire: a repo off the team is refused, team.try.get answers the state", async () => {
  const { handleTeam, addTeamFace } = await import("../src/team/wire.ts");
  const got: any[] = [];
  const face = { send: (m: object) => got.push(m) };
  addTeamFace(face);
  await handleTeam(face, { type: "team.pr.ready", rid: 1, repo: "someone/else", pr: 3 });
  assert.match(got.at(-1).error, /not one of the team's repositories/);
  await handleTeam(face, { type: "team.pr.comment", rid: 2, repo: "marcocyl04-ux/sol-dev", pr: 0, body: "x" });
  assert.equal(got.at(-1).error, "which pull request?");
  await handleTeam(face, { type: "team.try.get", rid: 3 });
  assert.equal(got.at(-1).type, "team.try.state");
  assert.equal(got.at(-1).rid, 3);
  assert.equal(got.at(-1).trying, undefined);
});
