// engine/keep: a build is good only once it has stayed up; three starts that die inside the minute put the last good
// build back (#16 blocker 3). The keeper runs for real in a temp folder, with a stand-in engine (dist/index.js) that
// answers /health and dies when told, and a short good-window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, chmodSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEEP = join(import.meta.dirname, "..", "keep");
const PORT = 7900 + Math.floor(Math.random() * 90);
const FAKE = (dieMs: number) => `
const http = require("node:http");
http.createServer((q, r) => { r.end('{"ok":true}'); }).listen(${PORT}, "127.0.0.1");
${dieMs ? `setTimeout(() => process.exit(7), ${dieMs});` : ""}
`;

function setup(dieMs: number, goodBuild = true) {
  const dir = mkdtempSync(join(tmpdir(), "sol-keep-"));
  copyFileSync(KEEP, join(dir, "keep")); chmodSync(join(dir, "keep"), 0o755);
  mkdirSync(join(dir, "dist")); writeFileSync(join(dir, "dist", "index.js"), FAKE(dieMs));
  if (goodBuild) { mkdirSync(join(dir, "dist.good")); writeFileSync(join(dir, "dist.good", "index.js"), "/* the good one */" + FAKE(0)); }
  return dir;
}
const run = (dir: string) => {
  try { return { code: 0, out: execFileSync("bash", [join(dir, "keep")], { cwd: dir, env: { ...process.env, SOL_PORT: String(PORT), SOL_KEEP_GOOD_MS: "4000" }, encoding: "utf8", timeout: 30000 }) }; }
  catch (e: any) { return { code: e.status as number, out: String(e.stdout ?? "") }; }
};

test("keep: a build that dies after answering /health is not the good one; the third time, the good build comes back", () => {
  const dir = setup(1500);   // dies well inside the good window, but after the keeper has surely seen /health, even with the suite running beside it
  for (let i = 1; i <= 2; i++) {
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /died within the minute/);
    assert.equal(readFileSync(join(dir, ".keep"), "utf8").trim(), String(i));
    assert.equal(existsSync(join(dir, "dist.bad")), false);
  }
  const r = run(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /went back to the last good build/);
  assert.equal(existsSync(join(dir, "dist.bad", "index.js")), true);
  assert.match(readFileSync(join(dir, "dist", "index.js"), "utf8"), /the good one/);
  assert.equal(existsSync(join(dir, "dist", ".reverted")), true);
  assert.equal(existsSync(join(dir, ".keep")), false);
  rmSync(dir, { recursive: true, force: true });
});

test("keep: a build that stays up past the window is copied as the good one, and a clean exit after it keeps it", () => {
  const dir = setup(0, false);
  writeFileSync(join(dir, "dist", "index.js"), FAKE(0) + "setTimeout(() => process.exit(0), 2500);");
  const r = run(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /this build is the good one/);
  assert.match(r.out, /engine ended \(0\)/);
  assert.equal(existsSync(join(dir, "dist.good", "index.js")), true);
  assert.equal(existsSync(join(dir, ".keep")), false);
  rmSync(dir, { recursive: true, force: true });
});

test("keep: a dist/ still being written is waited out before the engine starts (#39)", () => {
  const dir = setup(0, false);
  // the stand-in says when it started; dist/ was written a moment ago, so the start comes 3 s after the last write
  writeFileSync(join(dir, "dist", "index.js"), FAKE(0) + `require("node:fs").writeFileSync("started", String(Date.now())); setTimeout(() => process.exit(0), 2500);`);
  const wrote = statSync(join(dir, "dist", "index.js")).mtimeMs;
  const r = run(dir);
  assert.equal(r.code, 0, r.out);
  assert.ok(Number(readFileSync(join(dir, "started"), "utf8")) - wrote >= 2500, "started only once dist/ was quiet");
  rmSync(dir, { recursive: true, force: true });
});
