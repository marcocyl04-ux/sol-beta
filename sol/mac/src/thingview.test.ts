// node --test src/*.test.ts (npm test here): what the face says about a thing opened inside Sol (#236, cowork/thingView.ts).
// The page's cookies, words and title never reach the face, so the one message about a thing that leaves it carries
// which thing and whether it is in front, and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { focusMsg, originOf, tabOf, opensInside, FOCUS_AGAIN_MS } from "./cowork/thingView.ts";

test("the focus message is the thing's id and in front or not, nothing more", () => {
  assert.deepEqual(Object.keys(focusMsg("a1b2c3d4", true)).sort(), ["focused", "id"]);
  assert.deepEqual(focusMsg("a1b2c3d4", false), { id: "a1b2c3d4", focused: false });
});

test("a face in front says so again well inside the engine's ten minutes", () => {
  assert.ok(FOCUS_AGAIN_MS > 0 && FOCUS_AGAIN_MS <= 5 * 60_000);
});

test("the bar shows the origin, in full", () => {
  assert.equal(originOf("https://docs.google.com/document/d/x/edit#heading=h.1"), "docs.google.com");
  assert.equal(originOf("https://accounts.google.com.evil.com/x"), "accounts.google.com.evil.com");
  assert.equal(originOf("http://example.com/x"), "http://example.com");
  assert.equal(originOf("about:blank"), "");
  assert.equal(originOf("not a url"), "not a url");
});

test("tabs are the thing's id and a number; a repository opens its cards", () => {
  assert.equal(tabOf("a1b2c3d4", 1), "a1b2c3d4");
  assert.equal(tabOf("a1b2c3d4", 3), "a1b2c3d4.3");
  assert.equal(opensInside("doc"), true);
  assert.equal(opensInside("github"), false);
});
