// engine/dictations (#110): one dictation is one JSON line in home/voice/dictations/<day>.jsonl; no words, no line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeDictation } from "../src/dictations.ts";

test("a dictation is appended as one line to the day's file", () => {
  const home = mkdtempSync(join(tmpdir(), "sol-dict-"));
  const now = new Date(2026, 9, 22, 14, 3, 0);
  const file = storeDictation(home, { raw: " hello there ", typed: "hello there", app: "com.apple.Notes", name: "Notes", title: "", seconds: 2.34, went: "app" }, now);
  assert.equal(file, join(home, "voice", "dictations", "2026-10-22.jsonl"));
  storeDictation(home, { raw: "second", app: "com.hnc.Discord", seconds: 1, went: "clipboard" }, now);
  const lines = readFileSync(file!, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { at: now.toISOString(), app: "com.apple.Notes", name: "Notes", title: "", seconds: 2.3, raw: "hello there", typed: "hello there", went: "app" });
  assert.equal(lines[1].typed, "second");   // typed falls back to raw
  assert.equal(lines[1].went, "clipboard");
  assert.equal(lines[1].title, "");
});

test("nothing said, nothing stored", () => {
  const home = mkdtempSync(join(tmpdir(), "sol-dict-"));
  assert.equal(storeDictation(home, { raw: "   ", app: "x", seconds: 3, went: "app" }), null);
  assert.equal(existsSync(join(home, "voice", "dictations")), false);
});
