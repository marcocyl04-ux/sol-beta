// node --test src/*.test.ts (npm test here): everyone's version in Cowork's people strip (#417). The line, the strip's
// short word, "unknown" for a Sol that says none, and "the same release as you" by commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { versionLine, versionShort, sameRelease } from "./cowork/version.ts";

test("the line: a release plus my own layer, a branch and its commit, behind", () => {
  assert.equal(versionLine({ release: "stable-20261030-0900", commit: "0c02970c", mine: 12 }), "release stable-20261030-0900 + 12 of mine");
  assert.equal(versionLine({ release: "main", commit: "0c02970c", behind: 3 }), "main 0c02970c, 3 behind");
  assert.equal(versionLine({ release: "stable", commit: "0c02970c", mine: 2, behind: 1 }), "stable 0c02970c + 2 of mine, 1 behind");
  assert.equal(versionLine(undefined), "unknown");
  assert.equal(versionLine(null), "unknown");
});

test("the strip's short word: the release's day and hour, +mine, −behind", () => {
  assert.equal(versionShort({ release: "stable-20261030-0900", commit: "0c02970c", mine: 12 }), "stable 1030-0900 +12");
  assert.equal(versionShort({ release: "main", commit: "0c02970c", behind: 3 }), "main 0c02970c −3");
  assert.equal(versionShort({ release: "dev-nightly", commit: "0c02970c" }), "dev-nightly");
  assert.equal(versionShort(undefined), "unknown");
});

test("the same release: by the commit it sits on, own layers aside; unknown is never the same", () => {
  assert.equal(sameRelease({ release: "stable-20261030-0900", commit: "0c02970c", mine: 3 }, { release: "stable-20261030-0900", commit: "0c02970c", mine: 12 }), true);
  assert.equal(sameRelease({ release: "main", commit: "0c02970c" }, { release: "main", commit: "1a2b3c4d" }), false);
  assert.equal(sameRelease(undefined, { release: "main", commit: "0c02970c" }), false);
});
