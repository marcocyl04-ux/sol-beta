// sol/buttons/check (#133, PRD section 12, check 9): the broken fixtures fail on their rule, the bypassed one passes
// marked, and every button Sol ships passes. Runs the real script, as an agent does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

test("sol/buttons/check --test: each fixture as its first line says, and Sol's own all pass", () => {
  const r = spawnSync("bash", [join(import.meta.dirname, "..", "..", "buttons", "check"), "--test"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok {3}my-stoplight-bypassed\.tsx: wanted "passes, bypassed colour"/);
  assert.match(r.stdout, /ok {3}Sol's own \d+ buttons pass/);
});
