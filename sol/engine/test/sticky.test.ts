import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// the sticky note (sticky.ts), in a file of its own, never the real engine/sticky.json
const file = join(mkdtempSync(join(tmpdir(), "sticky-")), "sticky.json");
process.env.SOL_STICKY = file;
const { clean, addLine, markLine, turnPage, runStickyTool, MAX_CHARS, MAX_LINES } = await import("../src/sticky.ts");

test("a line is one short line: bullets go, long and multi-line are refused, a Chinese character counts once", () => {
  assert.equal(clean("- buy milk"), "buy milk");
  assert.equal(clean("[ ] 1. call Marco"), "1. call Marco");
  assert.ok(clean("a\nb") instanceof Error);
  assert.ok(clean("x".repeat(MAX_CHARS + 1)) instanceof Error);
  assert.equal(clean("寫".repeat(MAX_CHARS)), "寫".repeat(MAX_CHARS));
  assert.ok(clean("   ") instanceof Error);
});

test("cross out, next page: the crossed-out go, the rest carry over, on disk", () => {
  const a = addLine("one") as { id: string };
  addLine("two");
  assert.ok(markLine(a.id, true));
  assert.equal(turnPage(), 1);
  const kept = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(kept.lines.map((l: any) => l.text), ["two"]);
});

test("the seat's tool holds to the same short lines and a full note", async () => {
  const long = await runStickyTool("sticky", { action: "add", text: "a long explanation of everything that needs to happen today" });
  assert.equal(long.isError, true);
  for (let i = 0; i < MAX_LINES; i++) await runStickyTool("sticky", { action: "add", text: `t${i}` });
  const full = await runStickyTool("sticky", { action: "add", text: "one more" });
  assert.equal(full.isError, true);
  assert.match((await runStickyTool("sticky", { action: "list" })).content[0].text, /\[ \] \w+ two/);
});
