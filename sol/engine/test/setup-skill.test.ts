// sol/setup links the sol skill for Claude and Codex (#133, PRD section 12, check 11). Runs sol/setup.d/skill-test,
// which gives setup a scratch HOME and SOL_HOME, so the real ~/.claude, ~/.codex and sol/home are never read or touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

test("sol/setup.d/skill-test: ~/.claude/skills/sol, ~/.codex/skills/sol and sol/home/.claude/skills/sol linked, a person's own left alone", () => {
  const r = spawnSync("bash", [join(import.meta.dirname, "..", "..", "setup.d", "skill-test")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok {4}all three links point at sol\/skills\/sol/);
});
