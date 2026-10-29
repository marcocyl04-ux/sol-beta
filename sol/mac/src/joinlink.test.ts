// node --test src/*.test.ts (npm test here): the join link in the app (#327). Only `sol://join?code=<six symbols>` is
// read from a sol:// link, and the card's whole course (joinlink.ts joinFlow) with the engine's socket as an input: a
// code held until the socket is open, peeked exactly once it is, "join <name>?" with a join that waits 600 ms, and a
// join that names the hub that was peeked; a Sol not signed in on that hub (#342) asked to sign in, never to join.
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinCodeOf, joinFlow, HOLD_MS, READY_MS, NOT_CONNECTED, SIGN_IN_DRAWER, type JoinCard, type JoinEvent, type JoinStep } from "./cowork/joinlink.ts";

const HUB = "wss://cloud.matterfold.tech/relay";
/** the course over a list of events: every step, so what was sent at each is seen */
const run = (evs: JoinEvent[], from: JoinCard = { k: "none" }): JoinStep[] => {
  const out: JoinStep[] = [];
  let c = from;
  for (const ev of evs) { const r = joinFlow(c, ev); out.push(r); c = r.card; }
  return out;
};
const last = (s: JoinStep[]) => s[s.length - 1].card;
const sent = (s: JoinStep[]) => s.flatMap((r) => [...(r.peek ? [`peek ${r.peek}`] : []), ...(r.join ? [`join ${r.join.code} ${r.join.hub ?? "-"} ${r.join.name}`] : [])]);

test("only sol://join?code=<six letters and digits> is read; anything else a link says is ignored", () => {
  assert.equal(joinCodeOf("sol://join?code=2QKTYA"), "2QKTYA");
  assert.equal(joinCodeOf("sol://join/?code=2qktya"), "2QKTYA", "case aside");
  assert.equal(joinCodeOf("sol://join?code=2QKTYA&from=page"), "2QKTYA", "another word beside it is not read");
  for (const bad of ["sol://join?code=2QK", "sol://join?code=2QKTYA7", "sol://join?code=2QK%20TYA", "sol://join?code=2QK-TYA", "sol://join",
    "sol://join?code=2QKTYA&code=ZZZZZZ", "sol://open?code=2QKTYA", "sol://join/../x?code=2QKTYA", "sol://evil@join?code=2QKTYA", "sol://join:99?code=2QKTYA",
    "https://cloud.matterfold.tech/relay/j/2QKTYA", "javascript:alert(1)", "sol:join?code=2QKTYA", "", "not a url", 42, null, `sol://join?code=2QKTYA${"x".repeat(300)}`])
    assert.equal(joinCodeOf(bad), "", String(bad));
});

test("a cold launch: the code is held while the socket is down, peeked once when it opens, and the card asks", () => {
  const s = run([
    { e: "open", code: "2QKTYA", up: false, at: 0 },
    { e: "link", up: false, at: 1000 },
    { e: "link", up: false, at: 2000 },
    { e: "link", up: true, at: 3000 },
    { e: "link", up: true, at: 4000 },
    { e: "peeked", code: "2QKTYA", name: "帥", hub: HUB, at: 4500 },
  ]);
  assert.deepEqual(s.map((r) => r.card.k), ["holding", "holding", "holding", "asking", "asking", "ask"]);
  assert.deepEqual(sent(s), ["peek 2QKTYA"], "one peek, sent only once the socket is open");
  assert.deepEqual(last(s), { k: "ask", code: "2QKTYA", name: "帥", hub: HUB, at: 4500 });
});

test("a socket that closed before the peek went out holds the code again; 30 s with no socket says so", () => {
  const again = run([
    { e: "open", code: "2QKTYA", up: true, at: 0 },
    { e: "peeked", code: "2QKTYA", error: NOT_CONNECTED, at: 10 },
    { e: "link", up: true, at: 1000 },
  ]);
  assert.deepEqual(again.map((r) => r.card.k), ["asking", "holding", "asking"]);
  assert.deepEqual(sent(again), ["peek 2QKTYA", "peek 2QKTYA"]);
  const never = run([{ e: "open", code: "2QKTYA", up: false, at: 0 }, { e: "link", up: false, at: HOLD_MS - 1 }, { e: "link", up: false, at: HOLD_MS }]);
  assert.deepEqual(never.map((r) => r.card.k), ["holding", "holding", "said"]);
  assert.deepEqual(sent(never), []);
});

test("join only after the press, never within 600 ms of a code being shown; it names the hub and the name peeked", () => {
  const shown: JoinCard = { k: "ask", code: "2QKTYA", name: "帥", hub: HUB, at: 5000 };
  const early = joinFlow(shown, { e: "join", at: 5000 + READY_MS - 1 });
  assert.equal(early.card, shown, "too soon: nothing");
  assert.equal(early.join, undefined);
  const s = run([{ e: "join", at: 5000 + READY_MS }, { e: "joined" }], shown);
  assert.deepEqual(sent(s), [`join 2QKTYA ${HUB} 帥`]);
  assert.deepEqual(last(s), { k: "none" });
  // a new code shown replaces the old question, and its own 600 ms start again
  const next = run([{ e: "open", code: "K7QX2M", up: true, at: 6000 }, { e: "peeked", code: "K7QX2M", name: "notes", hub: HUB, at: 6100 }, { e: "join", at: 6200 }], shown);
  assert.equal(last(next).k, "ask");
  assert.deepEqual(sent(next), ["peek K7QX2M"], "no join of the new code from a press 100 ms after it showed");
});

test("the card's other ways: not now, a late answer, an error from the join, a code no group has, a group I am in", () => {
  const asking = joinFlow({ k: "none" }, { e: "open", code: "2QKTYA", up: true, at: 0 }).card;
  assert.equal(joinFlow(asking, { e: "open", code: "2QKTYA", up: true, at: 1 }).card, asking, "the same link again: one question");
  assert.equal(joinFlow(asking, { e: "open", code: "2QKTYA", up: true, at: 1 }).peek, undefined);
  assert.equal(joinFlow(asking, { e: "peeked", code: "ZZZZZZ", name: "other", at: 2 }).card, asking, "an answer for another code is late");
  assert.equal(joinFlow(asking, { e: "join", at: 5000 }).join, undefined, "nothing to join before the name");
  assert.deepEqual(joinFlow(asking, { e: "dismiss" }).card, { k: "none" });
  assert.deepEqual(joinFlow(asking, { e: "peeked", code: "2QKTYA", error: "no group has this code", at: 3 }).card, { k: "said", code: "2QKTYA", why: "no group has this code" });
  const joining: JoinCard = { k: "joining", code: "2QKTYA", name: "帥", hub: HUB };
  assert.deepEqual(joinFlow(joining, { e: "joined", error: "sign in to Sol first" }).card, { k: "said", code: "2QKTYA", why: "sign in to Sol first" });
  const mine = joinFlow(asking, { e: "peeked", code: "2QKTYA", name: "帥", already: true, at: 4 });
  assert.deepEqual(mine.card, { k: "ask", code: "2QKTYA", name: "帥", already: true, at: 4 });
  assert.deepEqual(joinFlow(mine.card, { e: "join", at: 4 + READY_MS }).join, { code: "2QKTYA", name: "帥" }, "a group I am in: no hub, the engine only goes there");
});

test("not signed in on the hub (#342): the card asks for the sign-in, offers no join, and its button opens Settings › me", () => {
  const s = run([
    { e: "open", code: "2QKTYA", up: true, at: 0 },
    { e: "peeked", code: "2QKTYA", name: "smoke group", hub: HUB, signedIn: false, at: 100 },
    { e: "join", at: 100 + READY_MS },
    { e: "join", at: 100 + 10 * READY_MS },
  ]);
  assert.deepEqual(s[1].card, { k: "ask", code: "2QKTYA", name: "smoke group", hub: HUB, out: true, at: 100 });
  assert.deepEqual(sent(s), ["peek 2QKTYA"], "a press is no join while signed out");
  assert.deepEqual(last(s), s[1].card, "the card stays as it was");
  const signin = joinFlow(last(s), { e: "signin" });
  assert.deepEqual(signin, { card: { k: "none" }, settings: SIGN_IN_DRAWER }, "the card goes, and Settings opens on me");
  assert.equal(SIGN_IN_DRAWER, "me");
  // signed in, or an older engine that does not say: the join as before; "sign in" means nothing on that card
  for (const signedIn of [true, undefined]) {
    const ok = run([{ e: "open", code: "2QKTYA", up: true, at: 0 }, { e: "peeked", code: "2QKTYA", name: "smoke group", hub: HUB, signedIn, at: 100 }, { e: "join", at: 100 + READY_MS }]);
    assert.deepEqual(sent(ok), ["peek 2QKTYA", `join 2QKTYA ${HUB} smoke group`], String(signedIn));
    assert.deepEqual(joinFlow(ok[1].card, { e: "signin" }), { card: ok[1].card });
  }
  // a group I am in opens whatever the sign-in: opening it asks no hub
  const mine = joinFlow(joinFlow({ k: "none" }, { e: "open", code: "K7QX2M", up: true, at: 0 }).card, { e: "peeked", code: "K7QX2M", name: "notes", already: true, signedIn: false, at: 5 });
  assert.deepEqual(mine.card, { k: "ask", code: "K7QX2M", name: "notes", already: true, at: 5 });
});
