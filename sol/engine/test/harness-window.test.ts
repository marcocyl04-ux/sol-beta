import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// the window rule (#114): a session, in either folder, never parks the face-hot flag, installs or opens or quits Sol.app,
// or restarts the engine's jobs. Run against the guard itself in a scratch repo on a work branch.
const guard = resolve(import.meta.dirname, "../../harness/guard");
const dir = mkdtempSync(join(tmpdir(), "window-guard-"));
const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
g("init", "-q", "-b", "marco/mine"); g("config", "sol.login", "marcocyl04-ux");
const run = (command: string) => execFileSync("node", [guard], { cwd: dir, encoding: "utf8",
  input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: dir }) });
const refused = (out: string) => out.includes('"deny"') ? (out.match(/harness \(([a-z-]+)\)/)?.[1] ?? "?") : "";

test("the face-hot flag: parked, restored or rewritten is refused; read is not", () => {
  const flag = "~/Library/Application\\ Support/com.marcol04.sol/face-hot";
  assert.equal(refused(run(`rm -f ${flag}`)), "window");
  assert.equal(refused(run(`mv ${flag} /tmp/face-hot.parked`)), "window");
  assert.equal(refused(run(`touch ${flag}`)), "window");
  assert.equal(refused(run(`chflags nouchg ${flag}`)), "window");
  assert.equal(refused(run(`: > ${flag}`)), "window");
  assert.equal(refused(run(`ls -lO ${flag}`)), "");
  assert.equal(refused(run(`cat ${flag} 2>/dev/null`)), "");
});

test("Sol.app: installed, opened or quit is refused; building a bundle in a worktree is not", () => {
  assert.equal(refused(run("ditto /tmp/Sol.app /Applications/Sol.app")), "window");
  assert.equal(refused(run("rm -rf /Applications/Sol.app")), "window");
  assert.equal(refused(run("open -a Sol")), "window");
  assert.equal(refused(run("open /Applications/Sol.app")), "window");
  assert.equal(refused(run("killall Sol")), "window");
  assert.equal(refused(run("pkill -x Sol")), "window");
  assert.equal(refused(run("osascript -e 'quit app \"Sol\"'")), "window");
  assert.equal(refused(run("cd sol/mac && npm run tauri build")), "");
  assert.equal(refused(run("ls /Applications")), "");
  assert.equal(refused(run("pkill -f vite")), "");
  assert.equal(refused(run("node -e 'const f=(x)=>x; console.log(\"Sol.app\")'")), "", "an arrow is not a write");
  assert.equal(refused(run("git commit -m 'guard: Sol.app is never opened by a session'")), "", "a commit message is not a write");
});

test("the engine's jobs: restart, stop or bootout is refused; reading launchctl list is not", () => {
  assert.equal(refused(run("launchctl kickstart -k gui/501/com.marco.sol-engine")), "window");
  assert.equal(refused(run("launchctl bootout gui/501/com.marco.sol-engine-build")), "window");
  assert.equal(refused(run("launchctl stop com.marco.sol-engine")), "window");
  assert.equal(refused(run("systemctl --user restart sol-engine")), "window");
  assert.equal(refused(run("launchctl list | grep sol")), "");
  assert.equal(refused(run("bash sol/back")), "");
});

test("where Sol lives (#116): running sol/mine/live or unlive is refused; reading or checking them is not", () => {
  assert.equal(refused(run("bash sol/mine/live")), "window");
  assert.equal(refused(run("bash ~/computer/personal/projects/my-sol/sol/mine/unlive --now")), "window");
  assert.equal(refused(run("sol/mine/live")), "window");
  assert.equal(refused(run("cd ~/computer/personal/projects/my-sol && bash sol/mine/rebase && bash sol/mine/live")), "window");
  assert.equal(refused(run("cat sol/mine/live")), "");
  assert.equal(refused(run("bash -n sol/mine/live")), "");
  assert.equal(refused(run("bash sol/mine/live --plan")), "");
  assert.equal(refused(run("bash sol/mine/stage status")), "");
});

test("a chain hides nothing: the refused segment is found behind && and ;", () => {
  assert.equal(refused(run("cd /tmp && rm -f ~/Library/Application\\ Support/com.marcol04.sol/face-hot; open -a Sol")), "window");
});

test("from a side copy, the live checkout's build is refused; the copy's own and the stage go through", () => {
  const side = join(dir, "side"); g("worktree", "add", "-q", "-b", "marco/work-side-1", side);
  const runIn = (cwd: string, command: string) => execFileSync("node", [guard], { cwd, encoding: "utf8",
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }) });
  const main = realpathSync(dir);
  assert.equal(refused(runIn(side, `cd ${main}/sol/mac && npx vite --port 1499`)), "window");
  assert.equal(refused(runIn(side, `node ${main}/sol/mac/node_modules/vite/bin/vite.js`)), "window");
  assert.equal(refused(runIn(side, `cd ${main}/sol/engine && npm run build`)), "window");
  assert.equal(refused(runIn(side, "cd sol/mac && npx vite --port 1499")), "");
  assert.equal(refused(runIn(side, "bash sol/mine/stage up")), "");
  const under = join(dir, ".claude", "worktrees", "x"); g("worktree", "add", "-q", "-b", "marco/work-side-2", under);
  assert.equal(refused(runIn(under, `cd ${realpathSync(under)}/sol/engine && npx tsc --noEmit -p .`)), "", "a cd into the copy itself, under the live checkout, is its own");
  assert.equal(refused(runIn(under, `cd ${main}/.claude/worktrees/x/sol/engine && ./node_modules/.bin/tsc -p .`)), "", "by the live checkout's path too");
  assert.equal(refused(runIn(under, `cd ${main}/sol/engine && npx tsc -p .`)), "window", "the live checkout's own build still is not");
  assert.equal(refused(runIn(main, `cd ${main}/sol/mac && npx vite`)), "", "the live checkout runs its own");
});
