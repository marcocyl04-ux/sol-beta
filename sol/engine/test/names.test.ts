// engine/names (#253): "them" becomes a name the moment the
// talk gives it away; a bare word needs saying twice; `you` is never renamed by the talk; a click sticks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFrom, freshNames, nameByClick, nameByTalk, bareNames } from "../src/names.ts";

const once = (who: "you" | "them", text: string) => nameFrom({ who, text }, freshNames());

test("N1: a clear address or introduction names them at once", () => {
  assert.equal(once("you", "thanks Frank")?.name, "Frank");
  assert.equal(once("you", "Frank, can you send it")?.name, "Frank");
  assert.equal(once("them", "hi, it's Frank")?.name, "Frank");
  assert.equal(once("them", "Isaac here")?.name, "Isaac");
  assert.equal(once("them", "Hello. This is Frank, from the shop")?.name, "Frank");
  assert.equal(once("you", "Okay Frank, let's go")?.name, "Frank");
  for (const r of [once("you", "thanks Frank"), once("them", "Isaac here")]) assert.equal(r?.who, "them");
});

test("N1: these name nobody", () => {
  for (const who of ["you", "them"] as const) {
    assert.equal(once(who, "Thanks, see you Friday"), null);
    assert.equal(once(who, "Can you send the May numbers"), null);
    assert.equal(once(who, "I'm sure"), null);
    assert.equal(once(who, "Frank"), null);
    assert.equal(once(who, "It's Monday, right?"), null);
    assert.equal(once(who, "Nothing here"), null);
  }
});

test("N2: a bare capitalised word names them only when Marco says it twice", () => {
  const s = freshNames();
  assert.equal(nameFrom({ who: "you", text: "yes I think Frank is right" }, s), null);
  assert.equal(nameFrom({ who: "them", text: "well Isaac said so" }, s), null);   // their side never counts
  assert.deepEqual(nameFrom({ who: "you", text: "and so Frank wanted it" }, s), { who: "them", name: "Frank", clear: false });
  assert.deepEqual(bareNames("Friday works. So Frank and Isaac in May"), ["Frank", "Isaac"]);
});

test("a clear name beats a guess, the first clear name stays, a click beats them all", () => {
  const s = freshNames();
  nameByTalk(s, "Isaac", false);
  assert.equal(nameFrom({ who: "you", text: "thanks Frank" }, s)?.name, "Frank");
  nameByTalk(s, "Frank", true);
  assert.equal(nameFrom({ who: "them", text: "this is Isaac" }, s), null);
  nameByClick(s, "them", "Francesca");
  assert.equal(nameFrom({ who: "them", text: "hi, it's Frank" }, s), null);
  assert.equal(s.them, "Francesca");
});

test("N4: you is never renamed by the talk, only by a click; Marco's own name is no one's", () => {
  const s = freshNames();
  for (const text of ["hi, it's Marco", "I'm Marco", "thanks Marco"]) assert.equal(nameFrom({ who: "them", text }, s), null);
  assert.equal(nameFrom({ who: "you", text: "this is Frank" }, s), null);   // an introduction from Marco's side names no one
  assert.equal(s.you, "you");
  nameByClick(s, "you", "Marco");
  assert.equal(s.you, "Marco");
});
