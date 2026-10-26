// sol/setup's GitHub CLI step (#174, PROTOCOL.md round 42): no gh on PATH, so Sol's own is fetched into ~/.sol/gh, its
// checksum compared before anything is unpacked. Real bash and curl, a fake HOME, a thin PATH (no gh), and the release
// served from a folder (SOL_GH_URL=file://…) holding an archive made here with a script for gh in it. Never the network.
// SOL_SETUP_GH_ONLY runs the step alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const real = join(import.meta.dirname, "../..");   // this checkout's sol/
const top = realpathSync(mkdtempSync(join(tmpdir(), "sol-setup-gh-")));
// the thin PATH: one folder of links to the system's own tools and node, gh left out by name (GitHub's Linux runners
// ship it in /usr/bin), so "no gh anywhere" holds on a Mac and in CI alike
mkdirSync(join(top, "bin"));
symlinkSync(process.execPath, join(top, "bin", "node"));
const linked = new Set(["node", "gh"]);   // by name: a system folder may hold dangling links, and /bin may be /usr/bin
for (const dir of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(existsSync))
  for (const f of readdirSync(dir)) if (!linked.has(f)) { linked.add(f); symlinkSync(join(dir, f), join(top, "bin", f)); }
const V = "2.103.2";
const mac = process.platform === "darwin";
const arch = process.arch === "arm64" ? "arm64" : "amd64";
const folder = `gh_${V}_${mac ? "macOS" : "linux"}_${arch}`;
const asset = `${folder}.${mac ? "zip" : "tar.gz"}`;

// the release: <folder>/bin/gh (a script: signed in to nobody), LICENSE, packed the way cli/cli packs it
const rel = join(top, "release");
mkdirSync(join(rel, "src", folder, "bin"), { recursive: true });
writeFileSync(join(rel, "src", folder, "bin", "gh"), `#!/bin/sh\ncase "$1 $2" in "auth status") echo "not logged in" >&2; exit 1 ;; *) echo "gh version ${V} (fake)" ;; esac\n`);
chmodSync(join(rel, "src", folder, "bin", "gh"), 0o755);
writeFileSync(join(rel, "src", folder, "LICENSE"), "MIT\n");
if (mac) execFileSync("ditto", ["-c", "-k", "--keepParent", join(rel, "src", folder), join(rel, asset)]);
else execFileSync("tar", ["-czf", join(rel, asset), "-C", join(rel, "src"), folder]);
const sum = createHash("sha256").update(readFileSync(join(rel, asset))).digest("hex");

const run = (home: string, sha: string, ...args: string[]) => runAt(join(real, "setup"), `file://${rel}`, home, sha, ...args).out;
// setup at a path: this checkout's, or a copy outside any checkout (a tester's, unless --dev)
const runAt = (setup: string, url: string, home: string, sha: string, ...args: string[]) => {
  mkdirSync(home, { recursive: true });
  const env = { PATH: join(top, "bin"), HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    SOL_SETUP_GH_ONLY: "1", SOL_NO_KEEP: "1", SOL_GH_URL: url, SOL_GH_SHA256: sha };
  const r = spawnSync("bash", [setup, ...args], { env, encoding: "utf8", input: "" });
  return { out: r.stdout + r.stderr, code: r.status };
};

test("no gh anywhere: Sol's own lands in ~/.sol/gh, checksum verified, and the sign-in line follows", () => {
  const home = join(top, "home-ok");
  const out = run(home, sum);
  assert.match(out, /ok {4}the GitHub CLI: Sol's own, gh 2\.103\.2 in ~\/\.sol\/gh, checksum verified/, out);
  const gh = join(home, ".sol", "gh", "bin", "gh");
  assert.ok(existsSync(gh), out);
  assert.match(execFileSync(gh, ["--version"], { encoding: "utf8" }), /fake/);
  assert.ok(existsSync(join(home, ".sol", "gh", "LICENSE")), "the one top folder is stripped");
  assert.deepEqual(readdirSync(join(home, ".sol")).sort(), ["gh"], "nothing left beside it (.new, .old)");
  assert.match(out, /the GitHub CLI.*(not signed in|Cowork signs in from Control)/, out);
  // a second run finds it there and fetches nothing
  const again = run(home, "0".repeat(64));
  assert.ok(!/fetching/.test(again), again);
  assert.ok(!/MISS.*checksum/.test(again), again);
});

test("Sol's own at another version: fetched again, so a new GH_V upgrades it", () => {
  const home = join(top, "home-old");
  const bin = join(home, ".sol", "gh", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "gh version 2.90.0 (old)"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const out = run(home, sum);
  assert.match(out, /fetching the GitHub CLI 2\.103\.2/, out);
  assert.match(out, /checksum verified/, out);
  assert.match(execFileSync(join(bin, "gh"), ["--version"], { encoding: "utf8" }), /2\.103\.2 \(fake\)/, "the old one replaced");
  assert.deepEqual(readdirSync(join(home, ".sol")).sort(), ["gh"], "the old one is not kept beside it");
});

test("a wrong checksum: nothing unpacked, nothing installed", () => {
  const home = join(top, "home-bad");
  const out = run(home, "0".repeat(64));
  assert.match(out, /MISS  .*checksum differs\); nothing unpacked/, out);
  assert.ok(!existsSync(join(home, ".sol", "gh")), out);
  assert.ok(!existsSync(join(home, ".sol", "gh.new")), out);
});

test("--check fetches nothing and says where it would go", () => {
  const home = join(top, "home-check");
  const out = run(home, sum, "--check");
  assert.match(out, /ok {4}the GitHub CLI: Sol's own would go to ~\/\.sol\/gh \(gh 2\.103\.2 from github\.com\/cli\/cli, checksum checked\)/, out);
  assert.ok(!existsSync(join(home, ".sol")), out);
});

test("Sol's own whose version only starts with 2.103.2 (2.103.20): another version, fetched again", () => {
  const home = join(top, "home-near");
  const bin = join(home, ".sol", "gh", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "gh version 2.103.20 (near)"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const out = run(home, sum);
  assert.match(out, /fetching the GitHub CLI 2\.103\.2/, out);
  assert.match(execFileSync(join(bin, "gh"), ["--version"], { encoding: "utf8" }), /2\.103\.2 \(fake\)/);
});

test("no network: a MISS in a dev checkout, optional for a tester (as gh was before Sol fetched its own)", () => {
  const gone = `file://${join(top, "no-release")}`;
  mkdirSync(join(top, "plain", "sol"), { recursive: true });   // a copy outside any checkout: no sol-dev origin
  const setup = join(top, "plain", "sol", "setup");
  copyFileSync(join(real, "setup"), setup);
  const dev = runAt(setup, gone, join(top, "home-net-dev"), sum, "--dev");   // --dev: a dev checkout's rules
  assert.match(dev.out, /MISS  could not fetch .*is the network up/, dev.out);
  assert.notEqual(dev.code, 0);
  const tester = runAt(setup, gone, join(top, "home-net"), sum);
  assert.match(tester.out, /ok {4}the GitHub CLI: optional, no GitHub account is needed \(Sol could not fetch its own/, tester.out);
  assert.ok(!/MISS/.test(tester.out), tester.out);
  assert.equal(tester.code, 0, tester.out);
});
