// GitHub signed in from a card (#174, PROTOCOL.md round 42): team/gh.ts runs gh's device flow with no terminal. A fake
// gh (a bash script in a temp folder) stands in for the real one: for `auth login` it prints the two lines gh prints on
// stderr and waits for a file to appear (the person typing the code on github.com), for `api user` it says `ada`, and
// every call is written down. Never the network, never anyone's own gh login.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startConnect, cancelConnect, onConnect, NO_GH } from "../src/team/gh.ts";

delete process.env.GH_TOKEN; delete process.env.GITHUB_TOKEN;   // a token in the shell running the tests is not theirs
const top = realpathSync(mkdtempSync(join(tmpdir(), "sol-gh-connect-")));
let n = 0;
// a fake gh whose `auth login` runs `login(gone)` (bash; gone: the file that stands for the code typed on github.com);
// every start writes its pid and its environment down, every call its arguments
const fake = (login: (gone: string) => string) => {
  const dir = join(top, `gh${++n}`);
  const bin = join(top, `gh${n}.sh`);
  const gone = join(top, `gh${n}.in`);
  writeFileSync(bin, `#!/bin/bash
echo "$*" >> "${dir}.calls"
case "$1 $2" in
  "auth login")
    echo $$ >> "${dir}.pids"
    env > "${dir}.env"
    ${login(gone)} ;;
  "api user") echo ada ;;
  *) echo "unknown command $*" >&2; exit 1 ;;
esac
`);
  chmodSync(bin, 0o755);
  return { bin, gone, calls: () => readFileSync(`${dir}.calls`, "utf8").trim().split("\n"), pids: () => readFileSync(`${dir}.pids`, "utf8").trim().split("\n"), env: () => readFileSync(`${dir}.env`, "utf8") };
};
const CODE = `echo >&2
echo "! First copy your one-time code: 8C7F-CB36" >&2
echo "Open this URL to continue in your web browser: https://github.com/login/device" >&2`;
const waiting = (f: string) => `${CODE}
while [ ! -e "${f}" ]; do sleep 0.1; done
echo "✓ Authentication complete." >&2
exit 0`;
const next = () => new Promise<{ login: string } | { error: string }>((ok) => { const off = onConnect((r) => { off(); ok(r); }); });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("start: the code and the page; a second start while it waits gives the same code from the one gh; the code typed → the login", async () => {
  const g = fake(waiting);
  let filled = 0;
  const deps = { gh: [g.bin], fill: async () => { filled++; } };
  const first = await startConnect(deps);
  assert.ok("code" in first, JSON.stringify(first));
  assert.equal(first.code, "8C7F-CB36");
  assert.equal(first.url, "https://github.com/login/device");
  const again = await startConnect(deps);
  assert.ok("code" in again);
  assert.equal(again.code, first.code);
  assert.equal(g.pids().length, 1, "one gh, not two");
  const heard = next();
  writeFileSync(g.gone, "");   // the person typed the code on github.com
  assert.deepEqual(await heard, { login: "ada" });
  assert.equal(filled, 1, "the team settings were asked to learn the login");
  // the login, then who it is; never `gh auth setup-git`, which would rewrite the person's ~/.gitconfig
  assert.deepEqual(g.calls(), [
    "auth login --hostname github.com --web --git-protocol https --skip-ssh-key",
    "api user --jq .login",
  ]);
});

test("gh 2.103's line (the code copied to the clipboard) is read the same", async () => {
  const g = fake((gone) => `echo "! One-time code (94E3-62FD) copied to clipboard" >&2
echo "Open this URL to continue in your web browser: https://github.com/login/device" >&2
while [ ! -e "${gone}" ]; do sleep 0.1; done`);
  const r = await startConnect({ gh: [g.bin], fill: async () => {} });
  assert.deepEqual("code" in r ? [r.code, r.url] : r, ["94E3-62FD", "https://github.com/login/device"]);
  assert.equal(cancelConnect(), true);
});

test("cancel: the gh waiting is gone and every face is told it was cancelled", async () => {
  const g = fake(waiting);
  const told: unknown[] = [];
  const off = onConnect((r) => told.push(r));
  const r = await startConnect({ gh: [g.bin], fill: async () => {} });
  assert.ok("code" in r);
  const pid = Number(g.pids()[0]);
  assert.ok(alive(pid));
  assert.equal(cancelConnect(), true);
  for (let i = 0; i < 30 && alive(pid); i++) await sleep(50);
  assert.ok(!alive(pid), "the gh is gone");
  await sleep(200);
  assert.deepEqual(told, [{ error: "cancelled" }], "told once, so a second window's card does not wait");
  assert.equal(cancelConnect(), false, "nothing left to cancel");
  off();
});

test("a gh that fails at once: its last line is the error, told and answered", async () => {
  const g = fake(() => `echo "oops" >&2; exit 1`);
  const heard = next();
  const r = await startConnect({ gh: [g.bin], fill: async () => {} });
  assert.deepEqual(r, { error: "oops" });
  assert.deepEqual(await heard, { error: "oops" });
});

test("a gh that shows no code: given up after the wait, with what it said last", async () => {
  const g = fake(() => `echo "thinking" >&2; exec sleep 30`);
  const told: unknown[] = [];
  const off = onConnect((r) => told.push(r));
  const t0 = Date.now();
  const r = await startConnect({ gh: [g.bin], wait: 300, fill: async () => {} });
  assert.deepEqual(r, { error: "gh gave no code: thinking" });
  assert.ok(Date.now() - t0 < 5000);
  const pid = Number(g.pids()[0]);
  for (let i = 0; i < 30 && alive(pid); i++) await sleep(50);
  assert.ok(!alive(pid), "the silent gh is killed");
  assert.deepEqual(told, [], "a give-up is answered, not told");
  off();
});

test("no gh in any place: Sol says it has none and how to get it", async () => {
  const r = await startConnect({ gh: [join(top, "nowhere", "gh")] });
  assert.deepEqual(r, { error: NO_GH });
  assert.match(NO_GH, /^Sol has no GitHub CLI here/);
});

test("a token in Sol's environment: refused, nothing spawned (gh and every account read would use it, not a sign-in)", async () => {
  const g = fake(waiting);
  process.env.GH_TOKEN = "ghp_not_for_gh";
  try {
    assert.deepEqual(await startConnect({ gh: [g.bin], fill: async () => {} }), { error: "GH_TOKEN is set in Sol's environment; gh uses it instead of a sign-in" });
  } finally { delete process.env.GH_TOKEN; }
  process.env.GITHUB_TOKEN = "ghp_not_either";
  try {
    assert.deepEqual(await startConnect({ gh: [g.bin], fill: async () => {} }), { error: "GITHUB_TOKEN is set in Sol's environment; gh uses it instead of a sign-in" });
  } finally { delete process.env.GITHUB_TOKEN; }
  assert.ok(!existsSync(`${g.bin.replace(/\.sh$/, "")}.calls`), "no gh was run");
});

test("a gh with no x bit is not a gh; one that is there but cannot start: told once, not twice (Node sends error, then close)", async () => {
  const g = fake(waiting);
  chmodSync(g.bin, 0o644);
  assert.deepEqual(await startConnect({ gh: [g.bin], fill: async () => {} }), { error: NO_GH });
  writeFileSync(g.bin, "#!/nowhere/bash\n");   // its interpreter is missing: the spawn fails
  chmodSync(g.bin, 0o755);
  const told: unknown[] = [];
  const off = onConnect((r) => told.push(r));
  const r = await startConnect({ gh: [g.bin], fill: async () => {} });
  assert.ok("error" in r && /could not start gh/.test(r.error), JSON.stringify(r));
  await sleep(300);
  assert.equal(told.length, 1, JSON.stringify(told));
  off();
});

test("only gh's device page is the url: a debug line's …/login/device/code before it is passed over; GH_DEBUG is not handed on", async () => {
  process.env.GH_DEBUG = "api";
  const g = fake((gone) => `echo "* Request to https://github.com/login/device/code" >&2
${waiting(gone)}`);
  try {
    const r = await startConnect({ gh: [g.bin], fill: async () => {} });
    assert.deepEqual("code" in r ? [r.code, r.url] : r, ["8C7F-CB36", "https://github.com/login/device"]);
    assert.ok(!/^GH_DEBUG=/m.test(g.env()), "GH_DEBUG not in gh's environment");
    assert.match(g.env(), /^GH_PROMPT_DISABLED=1$/m);
    assert.match(g.env(), /^GH_NO_UPDATE_NOTIFIER=1$/m);
  } finally {
    delete process.env.GH_DEBUG;
    cancelConnect();
  }
});

test("the code typed: until the login is told, a second press starts no second gh and a cancel cancels nothing", async () => {
  const g = fake(waiting);
  let let_go: () => void = () => {};
  const held = new Promise<void>((ok) => { let_go = ok; });
  const deps = { gh: [g.bin], fill: () => held };   // the settings still learning the login
  assert.ok("code" in await startConnect(deps));
  const heard = next();
  writeFileSync(g.gone, "");
  const pid = Number(g.pids()[0]);
  for (let i = 0; i < 50 && alive(pid); i++) await sleep(50);
  await sleep(200);   // gh has exited and `api user` has answered: finishing
  await startConnect(deps);
  assert.equal(g.pids().length, 1, "one gh, not two");
  assert.equal(cancelConnect(), false, "nothing to cancel: the sign-in is through");
  let_go();
  assert.deepEqual(await heard, { login: "ada" });
});

test("a code nobody types: gh is stopped at the hard stop and every face is told", async () => {
  const g = fake(waiting);
  const r = await startConnect({ gh: [g.bin], cap: 400, fill: async () => {} });
  assert.ok("code" in r);
  const heard = next();
  assert.deepEqual(await heard, { error: "the code was not entered in time: press sign in again" });
  const pid = Number(g.pids()[0]);
  for (let i = 0; i < 30 && alive(pid); i++) await sleep(50);
  assert.ok(!alive(pid), "the gh is gone");
  assert.equal(cancelConnect(), false, "nothing left waiting");
});

test("Sol's own gh fetched after the engine started: the next sign-in finds it, with no restart", async () => {
  const home = join(top, "home-late"), empty = join(top, "empty-late");
  mkdirSync(empty, { recursive: true });
  const was = { HOME: process.env.HOME, PATH: process.env.PATH };
  process.env.HOME = home; process.env.PATH = empty;
  try {
    assert.deepEqual(await startConnect({ gh: [join(top, "nowhere", "gh")] }), { error: NO_GH });
    assert.equal(process.env.PATH, empty, "no own gh yet: PATH as it was");
    const bin = join(home, ".sol", "gh", "bin");
    mkdirSync(bin, { recursive: true });   // sol/setup ran: ~/.sol/gh is there now
    writeFileSync(join(bin, "gh"), `#!/bin/bash\necho "own gh: $*" >&2; exit 1\n`);
    chmodSync(join(bin, "gh"), 0o755);
    const r = await startConnect({ gh: ["gh"], fill: async () => {} });
    assert.deepEqual(r, { error: "own gh: auth login --hostname github.com --web --git-protocol https --skip-ssh-key" });
    assert.equal(process.env.PATH, `${bin}:${empty}`, "on PATH for every gh after it");
  } finally {
    process.env.HOME = was.HOME; process.env.PATH = was.PATH;
  }
});
