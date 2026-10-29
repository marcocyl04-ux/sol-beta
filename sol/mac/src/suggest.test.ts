// node --test src/*.test.ts (npm test here): Home's group card (#321, homeSuggest.ts). One offer per conversation, under
// the answer it came with, skip remembered per conversation, and the one-shot note Cowork reads once. A Map stands in
// for localStorage; no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heard, placeAt, turnOf, cardFor, skip, isSkipped, setPendingGroup, takePendingGroup, type Offers } from "./homeSuggest.ts";

const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
const talk = (...w: string[]) => w.map((who) => ({ who }));

test("an offer is kept once a conversation: a repeat never moves or renames the first; junk is dropped", () => {
  let o: Offers = {};
  o = heard(o, { sessionId: "a", name: "期末專題網站" }, 1);
  assert.deepEqual(o.a, { sessionId: "a", name: "期末專題網站", turn: 1 });
  const same = heard(o, { sessionId: "a", name: "other" }, 3);
  assert.equal(same, o, "the same object: nothing changed");
  assert.equal(heard(o, { name: "x" }, 0), o);
  assert.equal(heard(o, { sessionId: 7 as unknown as string }, 0), o);
  o = heard(o, { sessionId: "b", name: " line\none\u0007 " + "x".repeat(60) }, 0);
  assert.equal(o.b.name.includes("\n"), false);
  assert.equal([...o.b.name].length, 40);
  assert.equal(heard({}, { sessionId: "c" }, 0).c.name, "", "no name: the form opens empty");
});

test("the card sits under the answer it came with, before the person's next line", () => {
  const msgs = talk("me", "tool", "you", "me", "you");
  assert.equal(turnOf(talk("me", "tool", "you")), 1);
  assert.equal(placeAt(msgs, 1), 3, "before the second line of the person");
  assert.equal(placeAt(msgs, 2), 5, "the last answer: at the end");
  assert.equal(placeAt(msgs, -1), 5, "heard while another talk was open: at the end");
  assert.equal(placeAt([], 1), 0);
});

test("skip: the card goes in that conversation only, and stays gone in a later window", () => {
  const s = store();
  const o = heard(heard({}, { sessionId: "a", name: "x" }, 1), { sessionId: "b", name: "y" }, 1);
  assert.equal(cardFor(o, "a", s)?.name, "x");
  assert.equal(cardFor(o, undefined, s), null, "a new talk with no id yet has no card");
  assert.equal(cardFor(o, "z", s), null);
  skip(s, "a");
  assert.equal(cardFor(o, "a", s), null);
  assert.equal(cardFor(o, "b", s)?.name, "y");
  assert.equal(isSkipped(s, "a"), true);
  skip(s, "a");
  assert.deepEqual(JSON.parse(s.m.get("sol.home.suggest.skipped")!), ["a"], "remembered once");
  s.m.set("sol.home.suggest.skipped", "not json");
  assert.equal(cardFor(o, "a", s)?.name, "x", "a broken list forgets, never throws");
});

test("the note to Cowork is read once", () => {
  assert.equal(takePendingGroup(), null);
  setPendingGroup({ k: "new", name: "期末專題網站" });
  assert.deepEqual(takePendingGroup(), { k: "new", name: "期末專題網站" });
  assert.equal(takePendingGroup(), null, "a Cowork opened by hand later finds nothing");
  setPendingGroup({ k: "pick" });
  assert.deepEqual(takePendingGroup(), { k: "pick" });
});
