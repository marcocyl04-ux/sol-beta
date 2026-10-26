// engine/anticipate (#253): the pure parts of a talk. The card's shape is enforced (a
// long answer is cut, never shown long; "nothing" is no card), Sol speaks up only on a question put to Marco or a
// name it knows and at most once a minute, the questions after a talk must name something said, the talk file is
// named by its start, and the window of turns is the last minute (or two). Nothing here spawns the helper or the SDK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCard, cutWords, speakUp, isQuestion, nameIn, guardQuestions, talkName, windowOf, turnsText, parseTurn, permissionLine, parseWrapUp, stats, knownNames, seatFor, VOLUNTEER_GAP_MS, parseTalk, parseReview, reviewPrompt, routeHeld, findButton, wholeTalk, viaGemini, namedSource, touchesNever, waitingTalks, tidy, geminiRest, withTimeout, EMPTY_PRESS, pressAsk, type Turn } from "../src/anticipate.ts";
import { DEFAULT_BUTTONS } from "../src/skill.ts";

const turn = (who: "you" | "them", text: string, at = 1000, seconds = 2): Turn => ({ who, text, final: true, at, seconds });

test("a card in the right shape is read as it is", () => {
  const c = parseCard("Send the key Friday\n- I'll send Frank the key on Friday.\n- The relay key, not the old one.\nsource: the talk");
  assert.deepEqual(c, { head: "Send the key Friday", bullets: ["I'll send Frank the key on Friday.", "The relay key, not the old one."], source: "the talk" });
});

test("a long card is cut: six words, two bullets of fifteen words", () => {
  const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen";
  const c = parseCard(`## **This headline is much too long to show**\n- ${long}\n* second\n- third is dropped\nSource: issue #110`)!;
  assert.equal(c.head, "This headline is much too long");
  assert.equal(c.bullets.length, 2);
  assert.equal(c.bullets[0].split(" ").length, 15);
  assert.equal(c.bullets[1], "second");
  assert.equal(c.source, "issue #110");
  assert.equal(cutWords("a b c,", 3), "a b c,");
  assert.equal(cutWords("a b, c d", 2), "a b");
  assert.equal(cutWords("Unnamed contact wants relay key and their invoice", 6), "Unnamed contact wants relay key");
  assert.equal(cutWords("Invoice date: confirming it, then I'll send it", 6), "Invoice date: confirming it");
  assert.equal(cutWords("I don't have the October invoice date yet, so I'll confirm it and send it today", 15), "I don't have the October invoice date yet");
});

test("nothing is no card; a card without a source says the talk", () => {
  assert.equal(parseCard("nothing"), null);
  assert.equal(parseCard("Nothing."), null);
  assert.equal(parseCard("   \n "), null);
  assert.deepEqual(parseCard("Say yes"), { head: "Say yes", bullets: [], source: "the talk" });
  // bullets only: the first one is the headline
  assert.equal(parseCard("- yes we can ship it\n- Thursday")!.head, "yes we can ship it");
});

test("questions: a question mark or a question form at the start of the last sentence", () => {
  assert.equal(isQuestion("So when is it done?"), true);
  assert.equal(isQuestion("Right. Can you send me the file"), true);
  assert.equal(isQuestion("ok, what do you think"), true);
  assert.equal(isQuestion("is there a build for it"), true);
  assert.equal(isQuestion("I think the build is fine."), false);
  assert.equal(isQuestion("We talked about how it works."), false);
});

test("names: a person from team.json or an issue number", () => {
  assert.equal(nameIn("Frank said it was fine", ["Frank"]), "Frank");
  assert.equal(nameIn("frankly it was fine", ["Frank"]), null);
  assert.equal(nameIn("that is in #110 already", []), "#110");
  assert.equal(nameIn("the weather", ["Isaac", "Al"]), null);
});

test("speaking up: only their final turns, at most one a minute, never over a pressed card", () => {
  const now = 10_000_000;
  const quiet = { lastVolunteer: 0, pressedInFlight: 0 };
  assert.deepEqual(speakUp(turn("them", "Can you send it today?"), quiet, [], now), { why: "question" });
  assert.deepEqual(speakUp(turn("them", "Isaac fixed that one"), quiet, ["Isaac"], now), { why: "name", name: "Isaac" });
  assert.equal(speakUp(turn("you", "Can you hear me?"), quiet, [], now), null);   // Marco's own question
  assert.equal(speakUp({ ...turn("them", "what?"), final: false }, quiet, [], now), null);
  assert.equal(speakUp(turn("them", "Can you?"), { lastVolunteer: now - VOLUNTEER_GAP_MS + 1, pressedInFlight: 0 }, [], now), null);
  assert.ok(speakUp(turn("them", "Can you?"), { lastVolunteer: now - VOLUNTEER_GAP_MS, pressedInFlight: 0 }, [], now));
  assert.equal(speakUp(turn("them", "Can you?"), { lastVolunteer: 0, pressedInFlight: 1 }, [], now), null);
  // a talk with no questions and no names: nothing volunteered
  const plain = ["We moved the office last week.", "The new desk is nicer.", "It has more light in the morning."];
  assert.equal(plain.map((t) => speakUp(turn("them", t), quiet, ["Frank"], now)).filter(Boolean).length, 0);
});

test("the questions after: each names something said, three at most, none generic", () => {
  const turns = [turn("you", "I will send Frank the relay key on Friday"), turn("them", "And the invoice for October is 400 euros")];
  const qs = guardQuestions([
    "1. You said you would send Frank the relay key; when exactly?",
    "Anything else to add?",
    "- Is the October invoice really 400 euros?",
    "How did it go?",
    "Who pays the invoice?",
    "Did Frank confirm Friday?",
  ], turns);
  assert.deepEqual(qs, ["You said you would send Frank the relay key; when exactly?", "Is the October invoice really 400 euros?", "Who pays the invoice?"]);
  assert.deepEqual(guardQuestions(["What else?"], turns), []);
});

test("the wrap-up: recap lines and questions read apart", () => {
  const w = parseWrapUp("recap:\n- Marco sends the key Friday\n- Invoice is 400 euros\nquestions:\n1. When on Friday?\n2. Which key?");
  assert.deepEqual(w, { recap: ["Marco sends the key Friday", "Invoice is 400 euros"], questions: ["When on Friday?", "Which key?"] });
  assert.deepEqual(parseWrapUp("Recap:\nnothing\nQuestions:\nnothing"), { recap: [], questions: [] });
});

test("the talk file is named by its local start", () => {
  assert.equal(talkName(new Date(2026, 9, 25, 14, 3, 7)), "20261025-140307.jsonl");
});

test("the window of turns: what ended in the last minute, or two", () => {
  const now = 2_000_000;   // ms; turns carry unix seconds
  const turns = [turn("you", "old", 1800, 5), turn("them", "edge", 1938, 2), turn("you", "new", 1990, 3)];
  assert.deepEqual(windowOf(turns, 60_000, now).map((t) => t.text), ["edge", "new"]);
  assert.deepEqual(windowOf(turns, 120_000, now).map((t) => t.text), ["edge", "new"]);
  assert.deepEqual(windowOf(turns, 200_000, now).map((t) => t.text), ["old", "edge", "new"]);
  assert.equal(turnsText(turns.slice(1)), "them: edge\nMarco: new");
});

test("the helper's lines: turns, errors, and anything else ignored", () => {
  assert.deepEqual(parseTurn('{"who":"them","text":" hi  there ","final":true,"at":12.5,"seconds":1.2}'), { who: "them", text: "hi there", final: true, at: 12.5, seconds: 1.2 });
  assert.deepEqual(parseTurn('{"error":"needs macOS 26"}'), { error: "needs macOS 26" });
  assert.equal(parseTurn("not json"), null);
  assert.equal(parseTurn('{"who":"me","text":"x"}'), null);
  assert.equal(parseTurn('{"who":"you","text":"  "}'), null);
});

// the listener's own words (sol/mac/listen/Sources.swift), copied as it prints them on stderr
const MIC = "permission: the microphone is not allowed for the app that started listen (Sol, or your Terminal). Allow it in System Settings > Privacy & Security > Microphone (x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone), then start again. Listening to the other side only.";
const TAP = "permission: to hear the other side, allow the app that started listen (Sol, or your Terminal) in System Settings > Privacy & Security > Screen & System Audio Recording, under \"System Audio Recording Only\" (x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture). Screen Recording itself is not needed. Without it the other side is heard as silence.";
test("the listener's permission sentences: said as they are, the silence one says so first; other lines are not", () => {
  assert.equal(permissionLine(MIC), MIC);
  assert.equal(permissionLine(TAP), TAP);
  const quiet = permissionLine(`them: only silence so far; if something is playing, this permission is missing. ${TAP}`)!;
  assert.match(quiet, /^permission: only silence from the other side so far\. to hear the other side/);
  assert.match(quiet, /Privacy_AudioCapture/);
  for (const l of ["ready", "you: MacBook Pro Microphone, 48000 Hz, 1 ch", "asking for the microphone (a prompt from macOS)", "them: the sound output changed, moving the tap", "permission: "]) assert.equal(permissionLine(l), null, l);
});

test("measure's arithmetic: median, worst, how many under the bar", () => {
  assert.deepEqual(stats([2900, 1200, 4100, 800], 3000), { n: 4, median: 2050, worst: 4100, under: 3 });
  assert.deepEqual(stats([7000], 10000), { n: 1, median: 7000, worst: 7000, under: 1 });
  assert.deepEqual(stats([], 3000), { n: 0, median: 0, worst: 0, under: 0 });
});

test("known names come from home/team.json when there is one", () => {
  const home = mkdtempSync(join(tmpdir(), "sol-talk-"));
  assert.deepEqual(knownNames(home), []);
  writeFileSync(join(home, "team.json"), JSON.stringify({ me: { name: "Marco" }, members: [{ name: "Frank", login: "frank-x" }, "Isaac"] }));
  assert.deepEqual(knownNames(home).sort(), ["Frank", "Isaac"]);
});

test("two warm seats: presses and typed asks on one, volunteered cards on the other", () => {
  assert.equal(seatFor("pressed"), "pressed");
  assert.equal(seatFor("question"), "volunteered");
  assert.equal(seatFor("name"), "volunteered");
});

// ---- sitting 2 (#253): the talk file as the record, the review, the hold, the skill's buttons ----

const FILE = [
  { started: "2026-10-25T12:00:00.000Z" },
  { who: "them", text: "hi, it's Frank", at: Date.parse("2026-10-25T12:00:05Z") / 1000, seconds: 1.5 },
  { type: "name", who: "them", name: "Frank", by: "talk", at: "2026-10-25T12:00:07.000Z" },
  { card: "answer", ms: 2100, path: "seat", at: "2026-10-25T12:00:20.000Z", shown: true },   // sitting 1: no text, nothing to draw
  { card: "Answer", ms: 1800, path: "seat", at: "2026-10-25T12:00:30.000Z", shown: true, text: { head: "Friday works", bullets: ["Friday, end of day."], source: "Frank, 0:30" } },
  { card: "question", ms: 1500, path: "seat", at: "2026-10-25T12:00:40.000Z", shown: true, text: { head: "Say yes", bullets: [], source: "the talk" } },
  { card: "Recap", ms: 900, path: "gemini", at: "2026-10-25T12:00:41.000Z", shown: false },
  { type: "held", text: "what did he want by Friday", at: "2026-10-25T12:00:50.000Z" },
  { type: "ask", q: "what did he want by Friday", a: "The relay key.", at: "2026-10-25T12:00:52.000Z", ms: 2400, spoken: true },
  { took: "card", ms: 40, at: "2026-10-25T12:00:53.000Z" },
  { who: "you", text: "I'll send it Friday", at: Date.parse("2026-10-25T12:01:00Z") / 1000, seconds: 2 },
  { type: "name", who: "them", name: "Francesca", by: "click", at: "2026-10-25T12:01:05.000Z" },
  { ended: "2026-10-25T12:01:10.000Z", seconds: 70 },
  { type: "recap", lines: ["Marco sends the key Friday"] },
  { type: "review", promised: [{ text: "send the key Friday", at: 60 }], asked: [], decisions: [], names: [{ text: "Frank", at: 5 }] },
  { type: "questions", items: ["Which key on Friday?", "Is Friday end of day?"] },
  { type: "answer", i: 0, text: "the relay key" },
  { type: "seen", at: "2026-10-25T13:00:00.000Z" },
].map((o) => JSON.stringify(o)).join("\n") + "\nnot json\n";

test("the talk file reads back as the record anticipate.talk answers from", () => {
  const r = parseTalk(FILE);
  assert.equal(r.started, "2026-10-25T12:00:00.000Z");
  assert.equal(r.ended, "2026-10-25T12:01:10.000Z");
  assert.equal(r.seconds, 70);
  assert.deepEqual(r.turns.map((t) => [t.who, t.text]), [["them", "hi, it's Frank"], ["you", "I'll send it Friday"]]);   // the held words are not turns
  assert.deepEqual(r.cards.map((c) => [c.head, c.why, c.button]), [["Friday works", "pressed", "Answer"], ["Say yes", "question", undefined]]);
  assert.equal(r.cards[0].at, Date.parse("2026-10-25T12:00:30Z") / 1000);
  assert.deepEqual(r.asks, [{ q: "what did he want by Friday", a: "The relay key.", at: Date.parse("2026-10-25T12:00:52Z") / 1000, ms: 2400, spoken: true }]);
  assert.deepEqual(r.names, { you: "you", them: "Francesca" });   // the last name line wins
  assert.deepEqual(r.recap, ["Marco sends the key Friday"]);
  assert.deepEqual(r.review?.promised, [{ text: "send the key Friday", at: 60 }]);
  assert.deepEqual(r.questions, ["Which key on Friday?", "Is Friday end of day?"]);
  assert.deepEqual(r.answers, ["the relay key", null]);
  assert.equal(r.kept, false);
  assert.equal(r.seen, true);
  const live = parseTalk(FILE.split("\n").slice(0, 2).join("\n"));   // a talk still on: its seconds from the last turn
  assert.equal(live.ended, null);
  assert.equal(live.seconds, 7);
  assert.equal(parseTalk("").turns.length, 0);
});

test("the review: Gemini's JSON, fenced or not, each item with its seconds into the talk", () => {
  const r = parseReview('```json\n{"recap":["- Key on Friday"],"promised":[{"text":"send the key","at":"1:02"}],"asked":[{"text":"the invoice","at":30}],"decisions":["ship Thursday"],"names":[{"text":"","at":3}]}\n```');
  assert.deepEqual(r, { recap: ["Key on Friday"], review: { promised: [{ text: "send the key", at: 62 }], asked: [{ text: "the invoice", at: 30 }], decisions: [{ text: "ship Thursday", at: 0 }], names: [] } });
  assert.equal(parseReview("no json here"), null);
  assert.equal(parseReview("{broken"), null);
  const p = reviewPrompt([{ who: "them", text: "hi", at: 1005 }, { who: "you", text: "yes", at: 1065 }], "Frank", 1000);
  assert.match(p, /\[0:05\] Frank: hi\n\[1:05\] Marco: yes/);
});

test("the hold: Marco's words while the globe key is down are the question, not the transcript", () => {
  const you = (text: string, final = true) => ({ ...turn("you", text), final });
  const h = { words: [] as string[], partial: "" };
  assert.equal(routeHeld(h, 0, you("what did he", false), 0), "held");
  assert.equal(h.partial, "what did he");
  assert.equal(routeHeld(h, 0, you("what did he want"), 0), "held");
  assert.deepEqual(h, { words: ["what did he want"], partial: "" });
  assert.equal(routeHeld(h, 0, turn("them", "so anyway"), 0), "talk");   // their side is heard as ever
  assert.equal(routeHeld(null, 0, you("back to the call"), 0), "talk");
  assert.equal(routeHeld(null, 5000, you("by Friday"), 4000), "late");   // the question's last words after the release
  assert.equal(routeHeld(null, 5000, you("later"), 6000), "talk");
});

test("the skill's buttons: by name or sitting 1's id; Recap and Who take the whole talk through Gemini", () => {
  const five = [...DEFAULT_BUTTONS, { name: "Translate", prompt: "say it in Chinese, short" }];
  assert.equal(findButton(five, "Translate")?.prompt, "say it in Chinese, short");
  assert.equal(findButton(five, "say next")?.name, "Say next");
  assert.equal(findButton(five, "next")?.name, "Say next");
  assert.equal(findButton(five, "who")?.name, "Who");
  assert.equal(findButton(five, undefined)?.name, "Answer");
  assert.equal(findButton(five, "Nope"), null);
  assert.deepEqual(five.map((b) => [wholeTalk(b), viaGemini(b)]), [[false, false], [false, false], [true, true], [true, true], [false, false]]);
});

test("a learned name reaches the source line and the lines a model reads", () => {
  const c = { head: "Say yes", bullets: [], source: "the talk" };
  assert.equal(namedSource(c, "Frank", "12:31").source, "Frank, 12:31");
  assert.equal(namedSource(c, "them", "12:31").source, "the talk");
  assert.equal(namedSource({ ...c, source: "issue #110" }, "Frank", "12:31").source, "issue #110");
  assert.equal(turnsText([turn("them", "hi"), turn("you", "hello")], "Frank"), "Frank: hi\nMarco: hello");
});

test("Never on: a listed subject in the talk keeps the volunteered cards back", () => {
  assert.equal(touchesNever("them: my therapist said I should rest", ["therapy", "therap"]), "therap");
  assert.equal(touchesNever("them: how is the family", ["family"]), "family");
  assert.equal(touchesNever("them: the familiar build", ["family"]), null);
  assert.equal(touchesNever("anything", []), null);
});

test("waiting: the ended talks with no seen line, the live one never counted", () => {
  const dir = mkdtempSync(join(tmpdir(), "sol-talks-"));
  const a = join(dir, "20261025-120000.jsonl"), b = join(dir, "20261025-130000.jsonl"), live = join(dir, "20261025-140000.jsonl");
  writeFileSync(a, '{"started":"x"}\n{"ended":"y","seconds":3}\n');
  writeFileSync(b, '{"started":"x"}\n{"ended":"y","seconds":3}\n{"type":"seen","at":"z"}\n');
  writeFileSync(live, '{"started":"x"}\n');
  assert.equal(waitingTalks(dir, live), 1);
  appendFileSync(a, '{"type":"seen","at":"z"}\n');
  utimesSync(a, new Date(), new Date(Date.now() + 5000));   // a new mtime: read again
  assert.equal(waitingTalks(dir, live), 0);
  assert.equal(waitingTalks(join(dir, "none")), 0);
});

test("known names: the engine's team.json too, never its machines", () => {
  const home = mkdtempSync(join(tmpdir(), "sol-talk-"));
  const engine = join(home, "engine-team.json");
  writeFileSync(engine, JSON.stringify({ me: { name: "marco" }, machines: [{ name: "this Mac" }, { name: "the NucBox" }], members: [{ name: "Frank" }] }));
  assert.deepEqual(knownNames(home, [engine]), ["Frank"]);
});

// ---- 2026-10-26: clean speech, Gemini's rest, a press always answered ----

test("clean speech: fillers go, a word said three times running is kept once, nothing but fillers is no turn", () => {
  assert.equal(tidy("Yo. Uh, the, the, the thing is good. The results are good."), "Yo. The thing is good. The results are good.");
  assert.equal(tidy("Mm-hmm. Yes. What is this? Mm. Mm. Okay, okay. Also, so you can record my voice."), "Yes. What is this? Okay. Also, so you can record my voice.");
  assert.equal(tidy("Yeah, yeah, yeah, much cleaner. Oh. Yeah. Hmm."), "Yeah, much cleaner. Oh. Yeah.");
  assert.equal(tidy("I I I think, um, we should, uh, ship Friday"), "I think, we should, ship Friday");
  assert.equal(tidy("Umbrella is a word; summer too, and hummus"), "Umbrella is a word; summer too, and hummus");   // never a part of a word
  assert.equal(tidy("嗯 我们明天见"), "我们明天见");
  assert.equal(tidy("Mm-hmm."), "");
  assert.equal(tidy("um, uh"), "");
  assert.equal(parseTurn('{"who":"them","text":"Mm-hmm. Mm.","final":true,"at":1,"seconds":1}'), null);
  const t = parseTurn('{"who":"you","text":"uh so, yes","final":true,"at":1,"seconds":1,"lang":"en-US"}') as Turn;
  assert.equal(t.text, "So, yes");
  assert.equal(t.lang, "en-US");
});

test("Gemini rests after a refusal: the quota's own retry time, a minute on high demand, nothing on an odd error", () => {
  assert.equal(geminiRest(new Error('{"error":{"code":429,"message":"You exceeded your current quota. Please retry in 5h2m3s."}}')), (5 * 3600 + 2 * 60 + 3) * 1000);
  assert.equal(geminiRest(new Error("429 RESOURCE_EXHAUSTED")), 600_000);
  assert.equal(geminiRest(new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand"}}')), 60_000);
  assert.equal(geminiRest(new Error("Gemini timed out after 6000 ms")), 30_000);
  assert.equal(geminiRest(new Error("something else")), 0);
});

test("a deadline on a promise", async () => {
  assert.equal(await withTimeout(Promise.resolve(1), 50), 1);
  await assert.rejects(withTimeout(new Promise(() => {}), 10, "the seat"), /the seat timed out after 10 ms/);
});

test("a press is always answered: the empty card names the button's kind, the ask says never nothing", () => {
  assert.equal(EMPTY_PRESS("Answer").head, "Nothing to add yet");
  assert.match(EMPTY_PRESS("Answer").bullets[0], /ask them/i);
  assert.match(EMPTY_PRESS("Recap").bullets[0], /too little said/i);
  assert.match(pressAsk("Answer", "what to say", false), /^Marco pressed Answer: what to say\. A press is always answered/);
  assert.match(pressAsk("Answer", "what to say", true), /The picture is the window/);
});
