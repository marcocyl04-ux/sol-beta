// node --test src/*.test.ts (npm test here): the quota banner (#326, wF's S5). From 80% of the room to its maker, with
// the one button; when full to everyone, "ask <maker>", no button; while it moves to everyone, no button; nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerOf, mbOf, NEAR, FULL } from "./cowork/quota.ts";

const MB = 1024 * 1024;
const u = (used: number, o: Partial<{ mine: boolean; frozen: boolean; maker: string }> = {}) =>
  ({ room: "shuai", used: used * MB, max: 20 * MB, files: 12, frozen: false, maker: "frank", mine: true, ...o });

test("the words: 18 of 20 MB, a decimal under ten", () => {
  assert.equal(mbOf(18 * MB, 20 * MB), "18 of 20 MB");
  assert.equal(mbOf(0.42 * MB, 20 * MB), "0.4 of 20 MB");
});

test("the maker from 80%: the bar, the line of wF's S5, the button", () => {
  assert.equal(bannerOf(u(15.9)), null, "under 80%: nothing");
  assert.deepEqual(bannerOf(u(18)), { share: 0.9, words: "18 of 20 MB", line: "the group's files move to a private repository of yours, no limit", button: true });
  assert.equal(bannerOf(u(20))?.button, true);
  assert.match(bannerOf(u(20))!.line, /^the group is full/);
  assert.equal(NEAR, 0.8);
});

test("everyone else: nothing until full, then 'ask <maker>' and no button", () => {
  assert.equal(bannerOf(u(18, { mine: false })), null);
  assert.deepEqual(bannerOf(u(20, { mine: false })), { share: 1, words: "20 of 20 MB", line: "the group is full; ask frank to connect GitHub", button: false });
  assert.equal(bannerOf(u(20 * FULL + 0.01, { mine: false }))?.button, false, "full from the last 2%");
  assert.equal(bannerOf(u(20 * FULL - 0.1, { mine: false })), null);
  assert.equal(bannerOf(u(20, { mine: false, maker: "" }))!.line, "the group is full; ask its maker to connect GitHub");
});

test("while it moves: everyone sees it, nobody has a button; no usage or no max is no banner", () => {
  for (const mine of [true, false]) assert.deepEqual(bannerOf(u(3, { frozen: true, mine })), { share: 0.15, words: "3 of 20 MB", line: "the group's files are moving to GitHub; changes wait a minute", button: false, moving: true });
  assert.equal(bannerOf(null), null);
  assert.equal(bannerOf({ ...u(18), max: 0 }), null);
});
