import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { devOnly } from "./dev-copy.ts";

// sol/mine/live and unlive (#116), run for real in a scratch home: a SOL checkout and its MY SOL worktree, two launchd
// links, a Sol.app, and stand-ins for launchctl, npm (the window's build), osascript, open, lsof, pgrep and curl (no
// engine answers), so nothing here touches the Mac's own jobs, its window or the network.
const SOL = resolve(import.meta.dirname, "../..");
// the two scripts are the dev's door: a tester's copy has neither, and every test here skips there (#300)
const DEV_FILES = devOnly("sol/mine/live", "sol/mine/unlive");
const top = realpathSync(mkdtempSync(join(tmpdir(), "sol-live-")));
const home = join(top, "home"), bin = join(top, "bin"), eco = join(top, "ecosystem"), mine = join(top, "my-sol");
const app = join(top, "Applications", "Sol.app"), la = join(home, "Library", "LaunchAgents"), calls = join(top, "launchctl.log");
const env = { ...process.env, HOME: home, SOL_APP: app, SOL_PORT: "1", SOL_LIVE_WAIT: "1", PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env, stdio: "pipe" }).toString().trim();
const put = (f: string, text: string, mode?: number) => { mkdirSync(resolve(f, ".."), { recursive: true }); writeFileSync(f, text); if (mode) chmodSync(f, mode); };
const JOBS = ["com.marco.sol-engine-build", "com.marco.sol-engine"];
const face = (root: string) => `#!/bin/sh\n# built from ${root}/sol/mac/src-tauri/../../engine/dist/index.js\n`;

// the stand-ins: launchctl keeps what is loaded in a file; npm's "tauri build" leaves a Sol.app built from its folder
put(join(bin, "launchctl"), `#!/bin/sh\necho "$*" >> ${calls}\nst=${top}/loaded\ntouch $st\ncase $1 in\n  print) grep -qx "\${2##*/}" $st ;;\n  bootstrap) basename "$3" .plist >> $st ;;\n  bootout) grep -vx "\${2##*/}" $st > $st.n; mv $st.n $st ;;\nesac\n`, 0o755);
put(join(bin, "npm"), `#!/bin/sh\ncase "$*" in *"tauri build"*) d=src-tauri/target/release/bundle/macos/Sol.app/Contents/MacOS; mkdir -p $d; printf '#!/bin/sh\\n# built from %s/src-tauri/..\\n' "$(cd .. && cd .. && pwd)/sol/mac" > $d/face; chmod +x $d/face ;; esac\n`, 0o755);
for (const t of ["osascript", "open", "cargo"]) put(join(bin, t), "#!/bin/sh\nexit 0\n", 0o755);
for (const t of ["lsof", "pgrep", "curl"]) put(join(bin, t), "#!/bin/sh\nexit 1\n", 0o755);
// off a Mac (CI's Linux, #147): the script's Mac guard is told it is one, and ditto (the Mac's copy and zip) is cp, zip, unzip
if (process.platform !== "darwin") {
  put(join(bin, "uname"), "#!/bin/sh\necho Darwin\n", 0o755);
  put(join(bin, "ditto"), `#!/bin/sh
case "$1" in
  -c) shift 3; mkdir -p "$(dirname "$2")"; z=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); cd "$(dirname "$1")" && zip -qry "$z" "$(basename "$1")" ;;
  -x) unzip -qo "$3" -d "$4" ;;
  *) cp -R "$1" "$2" ;;
esac
`, 0o755);
}

// SOL: the tracked plists with this folder's path, the two scripts, a stand-in tsc; the engine's own files beside it
for (const j of JOBS) put(join(eco, "sol/engine/launchd", `${j}.plist`),
  readFileSync(join(SOL, "engine/launchd", `${j}.plist`), "utf8").replace(/<string>[^<]*\/sol\/engine<\/string>/, `<string>${eco}/sol/engine</string>`));
for (const f of ["live", "unlive"]) { put(join(eco, "sol/mine", f), ""); if (!DEV_FILES) { copyFileSync(join(SOL, "mine", f), join(eco, "sol/mine", f)); chmodSync(join(eco, "sol/mine", f), 0o755); } }
put(join(eco, "sol/home/CLAUDE.md"), "home\n");
git(top, "init", "-q", "-b", "main", eco); git(eco, "add", "-A"); git(eco, "commit", "-qm", "start"); git(eco, "branch", "stable");
git(eco, "worktree", "add", "-q", "-b", "marco/mine", mine, "stable");
for (const root of [eco, mine]) {
  put(join(root, "sol/engine/node_modules/typescript/bin/tsc"), "");
  put(join(root, "sol/mac/node_modules/.keep"), "");
}
put(join(eco, "sol/engine/.env"), "KEY=his\n");
put(join(eco, "sol/engine/team.json"), '{"relay":"his"}\n');
put(join(mine, "sol/engine/team.json"), '{"relay":"a stage copy"}\n');
put(join(eco, "sol/engine/settings.json"), "{}\n");
// as on his Mac: the links point at SOL's tracked plists, both loaded, the window built from SOL
mkdirSync(la, { recursive: true });
for (const j of JOBS) symlinkSync(join(eco, "sol/engine/launchd", `${j}.plist`), join(la, `${j}.plist`));
put(join(top, "loaded"), JOBS.join("\n") + "\n");
put(join(app, "Contents/MacOS/face"), face(eco), 0o755);

const sh = (script: string, ...a: string[]) => execFileSync("bash", [join(eco, "sol/mine", script), ...a], { cwd: eco, env, encoding: "utf8", timeout: 60_000 });
const log = () => existsSync(calls) ? readFileSync(calls, "utf8") : "";

test("live: the jobs, the engine's own files and the window move to MY SOL; the home stays; each step says so", { skip: DEV_FILES }, () => {
  const out = sh("live");
  for (const j of JOBS) {
    assert.equal(readlinkSync(join(la, `${j}.plist`)), join(mine, "sol/engine/.live", `${j}.plist`));
    const p = readFileSync(join(la, `${j}.plist`), "utf8");
    assert.match(p, new RegExp(`<key>WorkingDirectory</key><string>${mine}/sol/engine</string>`));
    assert.match(p, new RegExp(`<key>SOL_HOME</key><string>${eco}/sol/home</string>`));
  }
  // a plist launchd can read (python's reader: plutil is the Mac's alone)
  assert.equal(execFileSync("python3", ["-c", "import plistlib,sys; print(plistlib.load(open(sys.argv[1],'rb'))['Label'])", join(la, "com.marco.sol-engine.plist")]).toString().trim(), "com.marco.sol-engine");
  assert.match(log(), /bootout gui\/\d+\/com\.marco\.sol-engine\n/);
  assert.match(log(), /bootstrap gui\/\d+ .*com\.marco\.sol-engine\.plist/);
  assert.equal(readFileSync(join(mine, "sol/engine/.env"), "utf8"), "KEY=his\n");
  assert.equal(readFileSync(join(mine, "sol/engine/team.json"), "utf8"), '{"relay":"his"}\n', "the live one wins");
  assert.equal(readFileSync(join(mine, "sol/engine/team.json.before-live"), "utf8"), '{"relay":"a stage copy"}\n', "MY SOL's own is kept aside");
  assert.ok(!existsSync(join(eco, "sol/engine/.env")) && !existsSync(join(eco, "sol/engine/settings.json")));
  assert.match(readFileSync(join(app, "Contents/MacOS/face"), "utf8"), new RegExp(`${mine}/sol/mac/src-tauri`));
  assert.ok(existsSync(join(home, "Library/Application Support/com.marcol04.sol/Sol.before-live.zip")));
  assert.match(out, /done: Sol lives in .*my-sol/);
});

test("live again: nothing moves, each part says it already is", { skip: DEV_FILES }, () => {
  const before = log();
  const out = sh("live");
  assert.equal(log().slice(before.length).match(/bootout|bootstrap/g), null, "no job stopped or started");
  assert.match(out, /already run from .*my-sol/);
  assert.match(out, /the window is already built from .*my-sol/);
});

test("unlive: the links point at SOL's tracked plists again, the files go back, the window from before comes back", { skip: DEV_FILES }, () => {
  const out = sh("unlive");
  for (const j of JOBS) assert.equal(readlinkSync(join(la, `${j}.plist`)), join(eco, "sol/engine/launchd", `${j}.plist`));
  assert.equal(readFileSync(join(eco, "sol/engine/.env"), "utf8"), "KEY=his\n");
  assert.equal(readFileSync(join(eco, "sol/engine/team.json"), "utf8"), '{"relay":"his"}\n');
  assert.ok(!existsSync(join(mine, "sol/engine/.env")));
  assert.match(readFileSync(join(app, "Contents/MacOS/face"), "utf8"), new RegExp(`${eco}/sol/mac/src-tauri`));
  assert.match(out, /out of .*Sol\.before-live\.zip/);
  assert.match(sh("unlive"), /already run from .*ecosystem/);
});

test("--plan says what would move and changes nothing", { skip: DEV_FILES }, () => {
  const before = log();
  const out = sh("live", "--plan");
  assert.match(out, /plan: com\.marco\.sol-engine moves from .*ecosystem to .*my-sol/);
  assert.match(out, /plan: \.env moves to .*my-sol/);
  assert.equal(log(), before);
  assert.equal(readlinkSync(join(la, "com.marco.sol-engine.plist")), join(eco, "sol/engine/launchd/com.marco.sol-engine.plist"));
});

test("SOL renamed in the same line (ecosystem to sol): --rename moves the folder and all that is keyed by its path; unlive writes SOL's own plists", { skip: DEV_FILES }, () => {
  const sol = join(top, "sol");
  // what Claude and the engine key by the folder's path: its project folders (sessions, memory, the Life talks under
  // *-sol-home, a side copy's), ~/.claude.json, the work state's sessions; and a side copy under .claude/worktrees
  const key = (p: string) => p.replace(/\//g, "-");
  const side = join(eco, ".claude/worktrees/x"); git(eco, "worktree", "add", "-q", "-b", "marco/work-x", side);
  for (const k of [key(eco), key(eco) + "-sol-home", key(side)]) put(join(home, ".claude/projects", k, "memory.md"), k + "\n");
  put(join(home, ".claude/projects", key(mine), "keep.md"), "mine\n");
  put(join(home, ".claude.json"), JSON.stringify({ projects: { [eco]: { allowed: [eco + "/sol"] }, [mine]: {} } }));
  const state = join(home, "Library/Application Support/com.marcol04.sol/work.json");
  put(state, JSON.stringify({ sessions: [{ cwd: eco }, { cwd: side + "/sol" }, { cwd: mine }], names: { [eco]: "SOL" }, moved: { "/old/eco": eco } }));
  put(join(mine, "sol/engine/.stage/work.json"), JSON.stringify({ sessions: [{ cwd: eco }] }));
  const plan = execFileSync("bash", [join(eco, "sol/mine/live"), "--plan", "--rename", "sol"], { cwd: eco, env, encoding: "utf8" });
  assert.match(plan, /plan: .*ecosystem becomes .*\/sol first/);
  assert.ok(existsSync(eco), "a plan moves nothing");
  const out = execFileSync("bash", [join(eco, "sol/mine/live"), "--rename", "sol"], { cwd: eco, env, encoding: "utf8", timeout: 60_000 });
  assert.ok(existsSync(sol) && !existsSync(eco), "the folder moved");
  assert.match(out, /ecosystem is now .*\/sol/);
  assert.match(out, /git knows: MY SOL and 1 side copies/);
  assert.equal(git(mine, "rev-parse", "--show-toplevel"), mine, "MY SOL's link to the main checkout holds");
  assert.equal(git(join(sol, ".claude/worktrees/x"), "branch", "--show-current"), "marco/work-x", "the side copy's too");
  for (const k of [key(sol), key(sol) + "-sol-home", key(join(sol, ".claude/worktrees/x"))]) assert.ok(existsSync(join(home, ".claude/projects", k, "memory.md")), k);
  assert.ok(!existsSync(join(home, ".claude/projects", key(eco))), "the old key is gone");
  assert.ok(existsSync(join(home, ".claude/projects", key(mine), "keep.md")), "MY SOL's own is untouched");
  assert.match(out, /3 Claude folders under ~\/.claude\/projects renamed/);
  const cj = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
  assert.deepEqual(Object.keys(cj.projects), [sol, mine]);
  assert.deepEqual(cj.projects[sol].allowed, [sol + "/sol"]);
  const ws = JSON.parse(readFileSync(state, "utf8"));
  assert.deepEqual(ws.sessions.map((s: { cwd: string }) => s.cwd), [sol, join(sol, ".claude/worktrees/x/sol"), mine], "the work state's folders, rewritten once the jobs stopped");
  assert.deepEqual(ws.names, { [sol]: "SOL" });
  assert.deepEqual(ws.moved, { "/old/eco": sol, [eco]: sol }, "the work state remembers the move (#129); an older move now points straight at the new folder");
  const stage = JSON.parse(readFileSync(join(mine, "sol/engine/.stage/work.json"), "utf8"));
  assert.deepEqual(stage.sessions, [{ cwd: sol }], "a stage's copy too");
  assert.deepEqual(stage.moved, { [eco]: sol });
  assert.match(out, /4 folders in com.marcol04.sol\/work.json now say/);
  assert.match(out, /work.json remembers the move: Claude's sessions recorded in .*ecosystem file under .*\/sol/);
  const run = (script: string) => execFileSync("bash", [join(sol, "sol/mine", script), "--sol", sol, "--mine", mine], { cwd: sol, env, encoding: "utf8", timeout: 60_000 });
  const p = readFileSync(join(la, "com.marco.sol-engine.plist"), "utf8");
  assert.match(p, new RegExp(`<key>WorkingDirectory</key><string>${mine}/sol/engine</string>`));
  assert.match(p, new RegExp(`<key>SOL_HOME</key><string>${sol}/sol/home</string>`));
  assert.ok(existsSync(join(mine, "sol/engine/.env")));
  assert.match(execFileSync("bash", [join(sol, "sol/mine/live"), "--plan", "--sol", sol, "--mine", mine], { cwd: sol, env, encoding: "utf8" }), /already runs from .*my-sol/, "a second run has nothing to move");
  assert.throws(() => execFileSync("bash", [join(sol, "sol/mine/unlive"), "--rename", "ecosystem"], { cwd: sol, env, encoding: "utf8", stdio: "pipe" }), /one way/);
  run("unlive");
  // the tracked plists still name the old folder: unlive writes SOL's own, with its new path and no SOL_HOME
  assert.equal(readlinkSync(join(la, "com.marco.sol-engine.plist")), join(sol, "sol/engine/.live/com.marco.sol-engine.plist"));
  const q = readFileSync(join(la, "com.marco.sol-engine.plist"), "utf8");
  assert.match(q, new RegExp(`<key>WorkingDirectory</key><string>${sol}/sol/engine</string>`));
  assert.doesNotMatch(q, /SOL_HOME/);
  assert.ok(existsSync(join(sol, "sol/engine/.env")));
});
