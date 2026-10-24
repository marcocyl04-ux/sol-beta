// The gist (work/gist.ts): the switch (#182) and the old handover carry the same lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gist, saidOf } from "../src/work/gist.ts";

test("the handover reads as it always did", () => {
  const said = [{ who: "me", text: " plan the week " }, { who: "you", text: "Monday: gym." }];
  assert.equal(gist(said, { title: "week", from: "a Life conversation", to: "in Work" }),
    `Carried over from a Life conversation ("week"). Where it stood:\n\nMarco: plan the week\n\nSol: Monday: gym.\n\nCarry on from here in Work.`);
});

test("the switch: Claude's items as what was said, one speaker's lines joined, the last 14 turns, capped", () => {
  const items = [
    { kind: "me", text: "fix the build" }, { kind: "think", text: "hmm" }, { kind: "tool", name: "Bash" },
    { kind: "you", text: "Looking." }, { kind: "you", text: "Fixed: a missing import." },
    { kind: "you", text: "a subagent's words", parent: "task-1" },
  ];
  const g = gist(saidOf(items), { from: "a talk with Claude", to: "with GPT", you: "Claude" });
  assert.equal(g, `Carried over from a talk with Claude. Where it stood:\n\nMarco: fix the build\n\nClaude: Looking.\n\nFixed: a missing import.\n\nCarry on from here with GPT.`);
  const long = Array.from({ length: 40 }, (_, i) => ({ who: i % 2 ? "you" : "me", text: `turn ${i} ` + "x".repeat(2000) }));
  const capped = gist(long, { from: "a talk with GPT", to: "with Claude", you: "GPT" });
  assert.ok(!capped.includes("turn 25 "), "only the last 14 turns");
  assert.ok(capped.includes("…"), "the whole cut at 9000");
  assert.ok(capped.length < 9300);
});
