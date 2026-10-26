// node --test src/*.test.ts: the pill's friendly model names (models.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { prettyModel, modelLine } from "./models.ts";

test("the names Marco asked for", () => {
  assert.equal(prettyModel("claude-fable-5-1", "claude"), "Fable 5.1");
  assert.equal(prettyModel("claude-opus-5-5", "claude"), "Opus 5.5");
  assert.equal(prettyModel("claude-sonnet-5-5"), "Sonnet 5.5");
  assert.equal(prettyModel("claude-haiku-5-5"), "Haiku 5.5");
  assert.equal(prettyModel("gpt-5.6-luna", "codex"), "GPT-5.6 Luna");
  assert.equal(prettyModel("gpt-5.6", "codex"), "GPT-5.6");
  assert.equal(prettyModel("gpt-6.1-sol", "codex"), "GPT-6.1 Sol");
  assert.equal(prettyModel("gpt-6-sol", "codex"), "GPT-6 Sol");
  assert.equal(prettyModel("gpt-5.6-terra", "codex"), "GPT-5.6 Terra");
});

test("an id it has not met: the seat's prefix goes, the version gets its dots, the family its capital", () => {
  assert.equal(prettyModel("x-y-5-1", "x"), "Y 5.1");
  assert.equal(prettyModel("claude-zephyr-6-0", "claude"), "Zephyr 6.0");
  assert.equal(prettyModel("claude-zephyr-6-0", "codex"), "Claude Zephyr-6.0");
  assert.equal(prettyModel("gpt-7-mini", "codex"), "GPT-7 Mini");
  assert.equal(prettyModel("o3", "codex"), "O3");
  assert.equal(prettyModel("claude-opus-5-5[1m]", "claude"), "Opus 5.5 [1m]");
  assert.equal(prettyModel("", "claude"), "–");
});

test("the list's line carries the id beside the name", () => {
  assert.equal(modelLine("claude-fable-5-1", "claude"), "Fable 5.1 · claude-fable-5-1");
  assert.equal(modelLine("o3"), "O3 · o3");
});
