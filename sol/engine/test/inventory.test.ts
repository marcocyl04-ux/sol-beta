// The Life seat's reach (#11): it never writes its own rules, never reads a .claude under home, and the secrets stay
// refused through quotes, globs and the run button's line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homeCanUseTool, forbidden, selfRule, badBash } from "../src/inventory.ts";

const home = realpathSync(mkdtempSync(join(tmpdir(), "sol-home-")));
mkdirSync(join(home, "..", "engine"), { recursive: true });
const can = homeCanUseTool(home);
const write = async (p: string) => (await can("Write", { file_path: p, content: "x" }, { signal: new AbortController().signal } as any)).behavior;
const read = async (p: string) => (await can("Read", { file_path: p }, { signal: new AbortController().signal } as any)).behavior;

test("a seat never writes its own rules: home/.claude/*, home/CLAUDE.md, home/AGENTS.md", async () => {
  assert.equal(selfRule(home, join(home, ".claude", "settings.json")), true);
  assert.equal(selfRule(home, join(home, ".claude")), true);
  assert.equal(selfRule(home, "CLAUDE.md"), true);
  assert.equal(selfRule(home, join(home, "notes", "CLAUDE.md")), false);
  assert.equal(await write(join(home, ".claude", "settings.json")), "deny");
  assert.equal(await write(join(home, "CLAUDE.md")), "deny");
  assert.equal(await write(join(home, "school", "notes.md")), "allow");
  assert.equal(await read(join(home, ".claude", "settings.json")), "deny");
  assert.equal(await read(join(home, "CLAUDE.md")), "allow");   // read, yes: it is the seat's own brief
});

test("Home's one skill is sol, linked into home/.claude/skills by sol/setup: it loads, its pages read through the link", async () => {
  const skill = async (name: string) => (await can("Skill", { skill: name }, { signal: new AbortController().signal } as any)).behavior;
  assert.equal(await skill("sol"), "allow");
  assert.equal(await skill("update-config"), "deny");
  const solSkill = realpathSync(mkdtempSync(join(tmpdir(), "sol-skill-")));
  writeFileSync(join(solSkill, "buttons.md"), "x");
  mkdirSync(join(home, ".claude", "skills"), { recursive: true });
  symlinkSync(solSkill, join(home, ".claude", "skills", "sol"));
  assert.equal(await read(join(home, ".claude", "skills", "sol", "buttons.md")), "allow");
  assert.equal(await write(join(home, ".claude", "skills", "sol", "buttons.md")), "deny");
});

test("the secrets are refused with quotes, through ~, and from Home's bash", () => {
  assert.equal(forbidden(home, "~/.ssh/id_ed25519"), true);
  assert.equal(forbidden(home, join(home, "x", ".env")), true);
  assert.equal(forbidden(home, join(home, ".claude", "x")), true);
  assert.equal(forbidden(home, join(home, "school", "a.md")), false);
  assert.match(badBash('cat ~/.he"r"mes/.env', home) ?? "", /secrets/);
  assert.match(badBash("rg key ~", home) ?? "", /stays inside/);
  assert.equal(badBash("ls school", home), null);
});
