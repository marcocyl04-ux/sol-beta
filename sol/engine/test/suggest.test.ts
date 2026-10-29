// Home offers a group once (#321, suggest.ts): the tool's shape, its one face event, and the refusal the second time in
// one conversation. A fake sender stands in for the faces; no network, no seat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { SUGGEST_TOOLS, HOME_ONLY, NAME_MAX, cleanName, runSuggestTool, setSuggestSend } from "../src/suggest.ts";
import { SOL_TOOLS } from "../src/tools.ts";

const sent: any[] = [];
setSuggestSend((m) => sent.push(m));
const said = (r: { content: { type: string; text?: string }[] }) => (r.content[0] as { text: string }).text;

test("the shape: one optional name, at most 40 characters, on the sol server and Home's only", () => {
  const t = SUGGEST_TOOLS.find((x) => x.name === "suggest_group")!;
  const shape = z.object(t.shape);
  assert.equal(shape.safeParse({}).success, true);
  assert.equal(shape.safeParse({ name: "期末專題網站" }).success, true);
  assert.equal(shape.safeParse({ name: "x".repeat(NAME_MAX) }).success, true);
  assert.equal(shape.safeParse({ name: "x".repeat(NAME_MAX + 1) }).success, false);
  assert.equal(shape.safeParse({ name: 3 }).success, false);
  assert.ok(SOL_TOOLS.some((x) => x.name === "suggest_group"));
  assert.ok(HOME_ONLY.has("suggest_group"));
});

test("a name is one clean line: control and direction characters out, spaces folded, cut at 40", () => {
  assert.equal(cleanName("  final\nproject\u0007 site\u202e "), "final project site");
  assert.equal(cleanName("a\tb\r\nc\u0000d"), "a b c d");
  assert.equal(cleanName("寫".repeat(NAME_MAX + 5)), "寫".repeat(NAME_MAX));
  assert.equal(cleanName(undefined), "");
  assert.equal(cleanName(42), "42");
});

test("shown once a conversation: the face hears it the first time, a second call is refused and sends nothing", async () => {
  sent.length = 0;
  const first = await runSuggestTool("suggest_group", { name: "期末專題網站" }, { sessionId: "s-1", seat: "claude" });
  assert.equal(said(first), "shown");
  assert.equal(first.isError, undefined);
  assert.deepEqual(sent, [{ type: "home.suggest", sessionId: "s-1", name: "期末專題網站" }]);
  const again = await runSuggestTool("suggest_group", { name: "another" }, { sessionId: "s-1", seat: "claude" });
  assert.equal(said(again), "already offered");
  assert.equal(sent.length, 1, "nothing more to the faces");
  // another conversation, the other Home seat, no name: its own card
  assert.equal(said(await runSuggestTool("suggest_group", {}, { sessionId: "s-2", seat: "codex" })), "shown");
  assert.deepEqual(sent[1], { type: "home.suggest", sessionId: "s-2", name: "" });
});

test("never on Work, never without a conversation", async () => {
  sent.length = 0;
  assert.equal((await runSuggestTool("suggest_group", {}, { sessionId: "w-1", seat: "work" })).isError, true);
  assert.equal((await runSuggestTool("suggest_group", {}, {})).isError, true);
  assert.equal(sent.length, 0);
  // a Work refusal does not use up the conversation's one offer
  assert.equal(said(await runSuggestTool("suggest_group", {}, { sessionId: "w-1", seat: "claude" })), "shown");
});
