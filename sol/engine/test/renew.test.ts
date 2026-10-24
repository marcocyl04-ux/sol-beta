// Renew (#39): a build that was still landing when the engine started is not the baseline. A file written from 3 s
// before the start on counts as changed, so the first quiet moment goes live with it; an older file counts only when
// its content changes, and a rewrite byte for byte is no change. A temp dist/ and short waits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renewOnBuild } from "../src/renew.js";

const FAST = { quietMs: 50, pollMs: 20, settleMs: 50 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function dist(old: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "sol-renew-"));
  writeFileSync(join(dir, "index.js"), "one");
  if (old) { const t = new Date(Date.now() - 60_000); utimesSync(join(dir, "index.js"), t, t); }
  return dir;
}
function watchIt(dir: string, idle = () => true) {
  const told: object[] = [];
  let exits = 0;
  const stop = renewOnBuild(dir, idle, (o) => told.push(o), () => "", () => { exits++; }, { ...FAST, startedAt: Date.now() });
  return { told, exits: () => exits, stop };
}

test("renew: a file written just before the start counts as changed; the first quiet moment goes live", async () => {
  const dir = dist(false);
  const r = watchIt(dir);
  await wait(800);
  assert.equal(r.exits(), 1);
  assert.deepEqual(r.told, [{ type: "engine.renewing" }]);
  r.stop(); rmSync(dir, { recursive: true, force: true });
});

test("renew: a file still landing waits for idle like any change", async () => {
  const dir = dist(false);
  let busy = true;
  const r = watchIt(dir, () => !busy);
  await wait(500);
  assert.equal(r.exits(), 0, "a job is live");
  busy = false;
  await wait(800);
  assert.equal(r.exits(), 1);
  r.stop(); rmSync(dir, { recursive: true, force: true });
});

test("renew: an older build is the baseline; the same bytes again are no change, new bytes are", async () => {
  const dir = dist(true);
  const r = watchIt(dir);
  await wait(400);
  assert.equal(r.exits(), 0, "nothing changed");
  writeFileSync(join(dir, "index.js"), "one");
  await wait(600);
  assert.equal(r.exits(), 0, "a rewrite byte for byte");
  writeFileSync(join(dir, "index.js"), "two");
  await wait(1000);
  assert.equal(r.exits(), 1);
  r.stop(); rmSync(dir, { recursive: true, force: true });
});
