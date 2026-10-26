// engine/skill (#253): home/skills/notch.md is written once
// when missing, read at a talk's start, and a broken file is the defaults with one plain line, never a throw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSkill, parseSkill, defaultSkillText, skillPath, SEAT_RULES, DEFAULT_BUTTONS, DEFAULT_MUTE, DEFAULT_SKILL } from "../src/skill.ts";

const home = () => mkdtempSync(join(tmpdir(), "sol-skill-"));
const said = () => { const lines: string[] = []; return { lines, say: (l: string) => { lines.push(l); } }; };

test("K1: written once when missing, with sitting 1's rules, and never overwritten", () => {
  const h = home();
  const s = readSkill(h);
  const text = readFileSync(skillPath(h), "utf8");
  assert.match(text, /^# The notch/);
  for (const head of ["## Anticipate", "## Buttons", "## Mute", "## After a talk"]) assert.ok(text.includes(head), head);
  assert.ok(text.includes(SEAT_RULES));
  assert.equal(s.rules, SEAT_RULES);
  assert.deepEqual(s.never, []);
  assert.deepEqual(s.buttons.map((b) => b.name), ["Answer", "Say next", "Recap", "Who"]);
  assert.deepEqual(s.mute, DEFAULT_MUTE);
  writeFileSync(skillPath(h), text.replace("## Buttons\n", "## Buttons\nTranslate: say it in Chinese, short\n"));
  readSkill(h);
  assert.match(readFileSync(skillPath(h), "utf8"), /Translate:/);
});

test("the default text parses back to the defaults, quietly", () => {
  const { lines, say } = said();
  assert.deepEqual(parseSkill(defaultSkillText(), say), DEFAULT_SKILL);
  assert.deepEqual(lines, []);
});

const SAMPLE = (buttons: string, extra = "") => `# The notch

## Anticipate
Be short. Cards in English.
Never on: therapy, family; money.

## Buttons
${buttons}

## Mute
- Discord: Cmd+Shift+M
zoom.us: ⌘ shift a
${extra}
## After a talk
Two questions at most.
`;

test("K2, K3: a fifth button, the Never on lines, the Mute lines", () => {
  const { lines, say } = said();
  const s = parseSkill(SAMPLE(DEFAULT_BUTTONS.map((b) => `${b.name}: ${b.prompt}`).join("\n") + "\nTranslate: say it in Chinese, short"), say);
  assert.equal(s.buttons.length, 5);
  assert.deepEqual(s.buttons[4], { name: "Translate", prompt: "say it in Chinese, short" });
  assert.equal(s.rules, "Be short. Cards in English.");
  assert.deepEqual(s.never, ["therapy", "family", "money"]);
  assert.deepEqual(s.mute, [{ app: "Discord", keys: "cmd shift m" }, { app: "zoom.us", keys: "cmd shift a" }]);
  assert.equal(s.after, "Two questions at most.");
  assert.deepEqual(lines, []);
});

test("K2: six buttons, the sixth is ignored and said in the log", () => {
  const { lines, say } = said();
  const s = parseSkill(SAMPLE(["A: a", "B: b", "C: c", "D: d", "E: e", "F: f"].join("\n")), say);
  assert.deepEqual(s.buttons.map((b) => b.name), ["A", "B", "C", "D", "E"]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /five buttons at most; "F" is ignored/);
});

test("K5: a missing Mute heading means the four defaults", () => {
  const s = parseSkill("## Buttons\nAnswer: say it\n");
  assert.deepEqual(s.mute, DEFAULT_MUTE);
  assert.deepEqual(s.buttons, [{ name: "Answer", prompt: "say it" }]);
  assert.equal(s.rules, SEAT_RULES);
});

test("K4: a broken file is the defaults with one plain line, never a throw", () => {
  const { lines, say } = said();
  assert.deepEqual(parseSkill("# The notch\n\n### Buttonz\nAnswer: x\nsome words", say), DEFAULT_SKILL);
  assert.equal(lines.length, 1);
  const h = home();
  mkdirSync(join(h, "skills", "notch.md"), { recursive: true });   // a folder where the file should be: unreadable
  assert.deepEqual(readSkill(h), DEFAULT_SKILL);
  // an unknown heading beside good ones: said once, the rest kept
  const two = said();
  const s = parseSkill("## Buttonz\nX: y\n## Buttons\nAnswer: z\n", two.say);
  assert.deepEqual(s.buttons, [{ name: "Answer", prompt: "z" }]);
  assert.equal(two.lines.length, 1);
});

test("the Languages heading: codes, three at most, doubles and odd entries dropped; none means the Mac's", () => {
  assert.deepEqual(parseSkill("# The notch\n\n## Languages\n\nen-US, zh-CN\nit_IT\nen-us\nFrench\nja-JP\n").languages, ["en-US", "zh-CN", "it-IT"]);
  assert.deepEqual(parseSkill("# The notch\n\n## Buttons\n\nAnswer: a\n").languages, []);
  assert.match(defaultSkillText(), /## Languages/);
});
