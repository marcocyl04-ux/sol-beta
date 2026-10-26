// sol/setup step 1 outside a dev checkout (#169): a tester's Sol comes with its app built and no team, so gh, Codex,
// Rust, Tailscale and ffmpeg are "optional" ok lines, never MISS; in a checkout of sol-dev they are needed as before.
// gh is no MISS in either when it is absent (#174): setup fetches Sol's own into ~/.sol/gh, and --check says it would.
// Real bash, a temp folder with a git origin of each kind, a PATH with only what a bare machine has (no gh, no codex);
// SOL_SETUP_NEEDS_ONLY runs the step alone, so nothing here installs or builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const real = join(import.meta.dirname, "../..");   // this checkout's sol/
const top = realpathSync(mkdtempSync(join(tmpdir(), "sol-setup-needs-")));
// a thin PATH: one folder of links to the system's own tools and node, nothing of Homebrew's or the team's. The team's
// tools are left out by name, not by folder: GitHub's Linux runners ship gh in /usr/bin, and this test needs it absent.
mkdirSync(join(top, "bin"));
symlinkSync(process.execPath, join(top, "bin", "node"));
const linked = new Set(["node", "gh", "codex", "tailscale", "ffmpeg", "claude"]);   // by name: a system folder may hold dangling links, and /bin may be /usr/bin
for (const dir of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(existsSync))
  for (const f of readdirSync(dir)) if (!linked.has(f)) { linked.add(f); symlinkSync(join(dir, f), join(top, "bin", f)); }
const env = { PATH: join(top, "bin"), HOME: join(top, "home"), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", SOL_SETUP_NEEDS_ONLY: "1", SOL_NO_KEEP: "1" };
mkdirSync(join(top, "home"));
const checkout = (name: string, origin: string) => {
  const dir = join(top, name);
  mkdirSync(join(dir, "sol"), { recursive: true });
  symlinkSync(join(real, "setup"), join(dir, "sol", "setup"));
  execFileSync("git", ["-C", dir, "init", "-q"], { env });
  execFileSync("git", ["-C", dir, "remote", "add", "origin", origin], { env });
  return dir;
};
const run = (dir: string, ...args: string[]) => {
  const r = spawnSync("bash", [join(dir, "sol", "setup"), "--check", ...args], { env, encoding: "utf8", input: "" });
  return r.stdout + r.stderr;
};

test("a Sol from the public repo: the team's tools are optional, no MISS for them", () => {
  const out = run(checkout("mine", "https://github.com/marcocyl04-ux/sol-beta.git"));
  assert.match(out, /ok {4}the GitHub CLI: Sol's own would go to ~\/\.sol\/gh/, out);
  for (const t of ["Codex", "Tailscale", "ffmpeg"]) assert.match(out, new RegExp(`ok    ${t}.*optional|ok    ${t}, `), `${t}: ok\n${out}`);
  assert.ok(!/MISS.*(GitHub CLI|Codex|Tailscale|ffmpeg)/.test(out), `no MISS for the team's tools\n${out}`);
  assert.ok(!/MISS.*Rust/.test(out), `Rust is optional too (the app comes built)\n${out}`);
});

test("a dev checkout: the same tools are needed, except gh, which setup would fetch", () => {
  const out = run(checkout("dev", "https://github.com/marcocyl04-ux/sol-dev.git"));
  assert.ok(!/MISS.*GitHub CLI/.test(out), `gh absent is no MISS: Sol's own would be fetched\n${out}`);
  assert.match(out, /ok {4}the GitHub CLI: Sol's own would go to ~\/\.sol\/gh/, out);
  assert.match(out, /MISS  Codex/, out);
});
