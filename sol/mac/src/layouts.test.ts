// node --test src/*.test.ts (npm test here): the sidebar's three layouts show the same sessions (#133, PRD section 12,
// check 7). A fixture of what the sidebar works out: pinned, a group, two folders (one with a topic group inside), Chats.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYOUTS, asLayout, nextLayout, parts } from "./work/layouts.ts";

type Sec = { key: string; rows: string[]; nested?: Sec[] };
const sections: Sec[] = [
  { key: "pinned", rows: ["s9"] },
  { key: "g:beta", rows: ["s4", "s5"] },
  { key: "p:/sol", rows: ["s1", "s2"], nested: [{ key: "g:notch", rows: ["s3"] }] },
  { key: "p:/kaat", rows: ["s6"] },
  { key: "chats", rows: ["c1", "c2", "c3"] },
];
const ids = (secs: Sec[]): string[] => secs.flatMap((s) => [...s.rows, ...ids(s.nested ?? [])]);
const all = ids(sections);

test("plain, split and carousel each show every session and chat once, in the sidebar's order", () => {
  for (const l of LAYOUTS) {
    const shown = parts(l, sections).flatMap(ids);
    assert.deepEqual([...shown].sort(), [...all].sort(), l);
    assert.equal(new Set(shown).size, shown.length, `${l} shows one twice`);
  }
  assert.deepEqual(parts("plain", sections), [sections]);
});

test("split: the folders and groups above, Chats and pinned below; carousel: one section a page", () => {
  const [top, bottom] = parts("split", sections);
  assert.deepEqual(top.map((s) => s.key), ["g:beta", "p:/sol", "p:/kaat"]);
  assert.deepEqual(bottom.map((s) => s.key), ["pinned", "chats"]);
  assert.deepEqual(parts("carousel", sections).map((p) => p.map((s) => s.key)), sections.map((s) => [s.key]));
});

test("the button goes round the three; anything else in the file is plain", () => {
  assert.deepEqual([nextLayout("plain"), nextLayout("split"), nextLayout("carousel")], ["split", "carousel", "plain"]);
  assert.equal(asLayout("grid"), "plain");
  assert.equal(asLayout(undefined), "plain");
});
