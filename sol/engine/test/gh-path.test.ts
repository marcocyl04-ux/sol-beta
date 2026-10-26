// Sol's own gh on PATH (#174, PROTOCOL.md round 42): ownGhOnPath puts ~/.sol/gh/bin first, once, only when Sol's own gh
// is there and PATH finds no gh of its own (PATH's gh comes first). A fake HOME and made-up PATH folders; the engine's
// own PATH is never touched here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ghHelper, ownGhOnPath } from "../src/team/gh.ts";

const top = realpathSync(mkdtempSync(join(tmpdir(), "sol-gh-path-")));
const home = join(top, "home"), bin = join(home, ".sol", "gh", "bin");
const empty = join(top, "empty"), brew = join(top, "brew");   // a folder with no gh, and one with a gh
const gh = (dir: string) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "gh"), "#!/bin/sh\n"); chmodSync(join(dir, "gh"), 0o755); };
mkdirSync(empty, { recursive: true });
gh(brew);

test("prepended once, not twice, and not when the folder is missing", () => {
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: empty };
  assert.equal(ownGhOnPath(env), false);
  assert.equal(env.PATH, empty, "no own gh: PATH as it was");
  mkdirSync(bin, { recursive: true });
  assert.equal(ownGhOnPath(env), false, "an empty folder is not a gh");
  gh(bin);
  assert.equal(ownGhOnPath(env), true);
  assert.equal(env.PATH, `${bin}:${empty}`);
  assert.equal(ownGhOnPath(env), false);
  assert.equal(env.PATH, `${bin}:${empty}`, "not twice");
  const bare: NodeJS.ProcessEnv = { HOME: home };
  assert.equal(ownGhOnPath(bare), true);
  assert.equal(bare.PATH, bin, "no PATH at all: the folder alone");
});

test("PATH already finds a gh (Homebrew's, say): left untouched, Sol's own does not shadow it", () => {
  gh(bin);
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: `${empty}:${brew}` };
  assert.equal(ownGhOnPath(env), false);
  assert.equal(env.PATH, `${empty}:${brew}`);
});

test("a folder named gh, or a gh that cannot run, is not a gh", () => {
  const h = join(top, "home-odd"), b = join(h, ".sol", "gh", "bin");
  mkdirSync(join(b, "gh"), { recursive: true });   // a folder
  const env: NodeJS.ProcessEnv = { HOME: h, PATH: empty };
  assert.equal(ownGhOnPath(env), false);
  const odd = join(top, "odd");
  mkdirSync(odd, { recursive: true });
  writeFileSync(join(odd, "gh"), "not a program\n");   // no x bit
  gh(bin);
  const env2: NodeJS.ProcessEnv = { HOME: home, PATH: odd };
  assert.equal(ownGhOnPath(env2), true, "PATH's gh that cannot run does not keep Sol's own out");
  assert.equal(env2.PATH, `${bin}:${odd}`);
});

test("gh as git's helper for github.com, one run or in a clone's own config: the person's helper is not asked and ~/.gitconfig is never written", () => {
  const t = join(top, "git");
  mkdirSync(t, { recursive: true });
  const fakeGh = join(t, "my gh");   // a space in the path: quoted for git's shell
  writeFileSync(fakeGh, `#!/bin/sh\n[ "$1 $2 $3" = "auth git-credential get" ] && { echo username=x-access-token; echo password=from-gh; }\nexit 0\n`);
  chmodSync(fakeGh, 0o755);
  const person = join(t, "person.sh"), asked = join(t, "person.asked");
  writeFileSync(person, `#!/bin/sh\ntouch "${asked}"\necho username=me\necho password=from-person\n`);
  chmodSync(person, 0o755);
  const global = join(t, "gitconfig");
  writeFileSync(global, `[credential]\n\thelper = ${person}\n[user]\n\tname = t\n\temail = t@t\n`);
  const before = readFileSync(global, "utf8");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
  const ask = (host: string, cwd = t, args: string[] = []) => execFileSync("git", [...args, "credential", "fill"], { cwd, env, input: `protocol=https\nhost=${host}\n\n`, encoding: "utf8" });
  assert.match(ask("github.com", t, ghHelper("-c", fakeGh)), /password=from-gh/);
  assert.ok(!existsSync(asked), "the person's helper was not asked for github.com");
  execFileSync("git", ["init", "-q", join(t, "src")], { env });
  execFileSync("git", ["-C", join(t, "src"), "commit", "-q", "--allow-empty", "-m", "x"], { env });
  execFileSync("git", ["clone", ...ghHelper("--config", fakeGh), "-q", join(t, "src"), join(t, "room")], { env });
  assert.match(ask("github.com", join(t, "room")), /password=from-gh/, "a later push from the room asks gh");
  assert.ok(!existsSync(asked));
  assert.match(ask("gitlab.com", join(t, "room")), /password=from-person/, "another host keeps the person's own");
  assert.equal(readFileSync(global, "utf8"), before, "~/.gitconfig as it was");
});
