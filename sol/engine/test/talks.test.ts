// engine/talks (#253): the talk file read into the page's shape, the list's line,
// Gemini's review read tolerantly, the markdown for the shelf and the block Keep writes. Nothing here calls Gemini.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTalk, indexLine, parseReview, talkMarkdown, keepBlock, secondsOf, msOf, clock, transcriptText } from "../src/talks.ts";

const T0 = Date.parse("2026-10-25T12:00:00Z");
const s = (o: object) => JSON.stringify(o);
const SAMPLE = [
  s({ started: new Date(T0).toISOString() }),
  s({ who: "them", text: "So the relay key, do we keep it until the org is set?", at: T0 / 1000 + 122, seconds: 4 }),
  s({ who: "you", text: "Yes,  until the org. Then we rotate it once.", at: T0 / 1000 + 129, seconds: 3 }),
  s({ type: "name", who: "them", name: "Frank", by: "talk", at: new Date(T0 + 130_000).toISOString() }),
  s({ card: "Answer", ms: 1800, path: "seat", at: new Date(T0 + 140_000).toISOString(), shown: true, text: { head: "Keep the key", bullets: ["Until the org."], source: "Frank, 12:02" } }),
  s({ card: "next", ms: 900, path: "seat", at: new Date(T0 + 141_000).toISOString(), shown: false }),
  s({ type: "ask", q: "what did we pay?", a: "Twelve a month.", at: new Date(T0 + 150_000).toISOString(), ms: 2100, spoken: true }),
  s({ took: "card", ms: 300, at: new Date(T0 + 151_000).toISOString() }),
  "not json",
  s({ ended: new Date(T0 + 754_000).toISOString(), seconds: 754 }),
  s({ type: "recap", lines: ["Relay key stays; cloud server split after month one.", "Numbers by Friday."] }),
  s({ type: "review", promised: [{ text: "Send the numbers by Friday", at: 754 }], asked: [{ text: "Who pays?", at: "12:18" }], decisions: [], names: ["Frank"] }),
  s({ type: "questions", items: ["Keep the price?", "Forget the joke?"] }),
  s({ type: "answer", i: 0, text: "yes" }),
].join("\n");

test("a talk file is read into the page's shape", () => {
  const t = parseTalk("20261025-120000.jsonl", SAMPLE);
  assert.equal(t.started, T0);
  assert.equal(t.ended, T0 + 754_000);
  assert.equal(t.seconds, 754);
  assert.deepEqual(t.turns.map((x) => [x.who, x.at]), [["them", 122], ["you", 129]]);
  assert.equal(t.turns[1].text, "Yes, until the org. Then we rotate it once.");
  assert.deepEqual(t.names, { you: "you", them: "Frank" });
  assert.equal(t.cards.length, 1);   // a card never shown has no text, so no card
  assert.deepEqual(t.cards[0], { button: "Answer", head: "Keep the key", bullets: ["Until the org."], source: "Frank, 12:02", at: 140, ms: 1800 });
  assert.deepEqual(t.asks, [{ q: "what did we pay?", a: "Twelve a month.", at: 150, ms: 2100, spoken: true }]);
  assert.equal(t.recap.length, 2);
  assert.deepEqual(t.review!.asked, [{ text: "Who pays?", at: 738 }]);
  assert.deepEqual(t.review!.names, [{ text: "Frank", at: 0 }]);
  assert.deepEqual(t.questions, ["Keep the price?", "Forget the joke?"]);
  assert.equal(t.answers[0], "yes");
  assert.equal(t.answers[1], undefined);
  assert.equal(t.kept, false);
  assert.equal(t.seen, false);
});

test("a sitting 1 talk: no review, no questions, the length from the ended line", () => {
  const t = parseTalk("20261025-182147.jsonl", [s({ started: "2026-10-25T22:21:47.959Z" }), s({ who: "you", text: "Yo, yo, yo.", at: 1792966911.039, seconds: 5 }),
    s({ ended: "2026-10-25T22:21:58.925Z", seconds: 11, questions: ["old"] })].join("\n"));
  assert.equal(t.review, null);
  assert.deepEqual(t.questions, []);
  assert.equal(t.seconds, 11);
  assert.deepEqual(indexLine(t), { file: "20261025-182147.jsonl", started: Date.parse("2026-10-25T22:21:47.959Z"), ended: Date.parse("2026-10-25T22:21:58.925Z"),
    seconds: 11, who: ["you"], recap: "Yo, yo, yo.", seen: false, questions: 0, answered: 0, kept: false });
});

test("the list's line: who by name, the first recap line, the counts", () => {
  const t = parseTalk("20261025-120000.jsonl", SAMPLE + "\n" + s({ type: "answer", i: 1, text: null }) + "\n" + s({ type: "kept" }) + "\n" + s({ type: "seen", at: "x" }));
  const l = indexLine(t);
  assert.deepEqual(l.who, ["you", "Frank"]);
  assert.equal(l.recap, "Relay key stays; cloud server split after month one.");
  assert.deepEqual([l.questions, l.answered, l.kept, l.seen], [2, 2, true, true]);
});

test("Gemini's review is read through fences and prose, times as m:ss", () => {
  const r = parseReview('Here it is:\n```json\n{"recap": ["- Key stays", "Split later"], "promised": [{"text": "Send numbers", "at": "12:34"}], "asked": [{"text": "Who pays", "at": "1:02:03"}], "decisions": "none", "names": [{"text": "", "at": "0:10"}]}\n```');
  assert.deepEqual(r.recap, ["Key stays", "Split later"]);
  assert.deepEqual(r.review.promised, [{ text: "Send numbers", at: 754 }]);
  assert.deepEqual(r.review.asked, [{ text: "Who pays", at: 3723 }]);
  assert.deepEqual(r.review.decisions, []);
  assert.deepEqual(r.review.names, []);
  assert.deepEqual(parseReview("no json at all"), { recap: [], review: { promised: [], asked: [], decisions: [], names: [] } });
});

test("times: seconds, ms and ISO; the clock", () => {
  assert.equal(secondsOf("12:34"), 754);
  assert.equal(secondsOf(12.6), 13);
  assert.equal(secondsOf("x"), null);
  assert.equal(msOf(1792966911.039), 1792966911039);
  assert.equal(msOf("2026-10-25T12:00:00Z"), T0);
  assert.equal(clock(3723), "1:02:03");
  assert.equal(clock(65), "1:05");
});

test("the shelf's markdown: title, who, recap, review, transcript with times, cards, asks", () => {
  const md = talkMarkdown(parseTalk("20261025-120000.jsonl", SAMPLE));
  assert.match(md, /^# Talk with Frank · 25 Oct\n/);
  assert.match(md, /12:34 · you · Frank/);
  assert.match(md, /## Recap\n\n- Relay key stays/);
  assert.match(md, /## What I promised\n\n- Send the numbers by Friday \(12:34\)/);
  assert.match(md, /## What they asked me\n\n- Who pays\? \(12:18\)/);
  assert.doesNotMatch(md, /## Decisions/);
  assert.match(md, /\*\*Frank\*\* 2:02  \nSo the relay key/);
  assert.match(md, /## Cards\n\n- 2:20 \*\*Keep the key\*\*: Until the org\. \(Frank, 12:02\)/);
  assert.match(md, /## Asked during the talk\n\n- 2:30 🌐 what did we pay\?\n  Twelve a month\./);
});

test("Keep's block: recap, the boxes, the answered questions, the transcript's address", () => {
  const b = keepBlock(parseTalk("20261025-120000.jsonl", SAMPLE));
  assert.match(b, /^## Talk · .* \(12:34\) with Frank\n\n- Relay key stays/);
  assert.match(b, /- What I promised: Send the numbers by Friday/);
  assert.match(b, /- Keep the price\? yes/);
  assert.doesNotMatch(b, /Forget the joke/);
  assert.match(b, /Transcript: voice\/talks\/20261025-120000\.jsonl\n\n$/);
  assert.match(transcriptText(parseTalk("x", SAMPLE)), /^\[2:02\] Frank: So the relay key/);
});
