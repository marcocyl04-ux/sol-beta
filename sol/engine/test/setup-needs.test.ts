// sol/setup step 1 outside a dev checkout (#169): a tester's Sol comes with its app built and no team, so gh, Codex,
// Rust, Tailscale and ffmpeg are "optional" ok lines, never MISS; in a checkout of sol-dev they are needed as before.
// Real bash, a temp folder with a git origin of each kind, a PATH with only what a bare Mac has (no gh, no codex);
// SOL_SETUP_NEEDS_ONLY runs the step alone, so nothing here installs or builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const real = join(import.meta.dirname, "../..");   // this checkout's sol/
const top = realpathSync(mkdtempSync(join(tmpdir(), "sol-setup-needs-")));
// a thin PATH: the system's own folders and node, nothing of Homebrew's or the team's
mkdirSync(join(top, "bin"));
symlinkSync(process.execPath, join(top, "bin", "node"));
const env = { PATH: `${join(top, "bin")}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(top, "home"), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", SOL_SETUP_NEEDS_ONLY: "1", SOL_NO_KEEP: "1" };
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
  for (const t of ["the GitHub CLI", "Codex", "Tailscale", "ffmpeg"]) assert.match(out, new RegExp(`ok    ${t}.*optional|ok    ${t}, `), `${t}: ok\n${out}`);
  assert.ok(!/MISS.*(GitHub CLI|Codex|Tailscale|ffmpeg)/.test(out), `no MISS for the team's tools\n${out}`);
  assert.ok(!/MISS.*Rust/.test(out), `Rust is optional too (the app comes built)\n${out}`);
});

test("a dev checkout: the same tools are needed", () => {
  const out = run(checkout("dev", "https://github.com/marcocyl04-ux/sol-dev.git"));
  assert.match(out, /MISS  the GitHub CLI/, out);
  assert.match(out, /MISS  Codex/, out);
});
