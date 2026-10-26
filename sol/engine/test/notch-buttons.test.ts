// Notch buttons (#6) step 0: creature.ask (the oldest open ask, counted) and creature.turn (the busy conversation with
// the latest activity), sent to every face on change and on connect.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addCreatureFace, removeCreatureFace, setRole, sent, pickAsk, askTitle, currentTurn, lifeTurn, update } from "../src/creature.js";
import { addPingFace, pingFaceIs, ping, _reset as resetPings } from "../src/ping.js";
import { join, _reset as resetBusy } from "../src/busy.js";

type Msg = { type: string; [k: string]: any };
const face = () => { const got: Msg[] = []; return { got, send: (m: object) => got.push(m as Msg) }; };
const run = (id: string, asks: { id: string; tool: string; input?: object; title?: string; path?: string }[]) => {
  const items = new Map(asks.map((a) => [a.id, { kind: "perm", state: "ask", ...a }]));
  return { id, perms: new Map(asks.map((a) => [a.id, () => {}])), items: { get: (k: string) => items.get(k) } };
};
const tick = () => new Promise((r) => setTimeout(r, 2));

test("creature.ask: the oldest open ask across runs, n of `of`, null when none", () => {
  assert.equal(pickAsk([]), null);
  const a = run("sA", [{ id: "perm:1", tool: "Bash", input: { command: "rm -rf x", description: "clean the build" } }]);
  assert.deepEqual(pickAsk([a]), { id: "perm:1", sessionId: "sA", seat: "claude", tool: "Bash", title: "Claude wants to run: clean the build", n: 1, of: 1 });
  // a later session's ask, listed first, is still younger: the first one seen stays the oldest
  const b = run("sB", [{ id: "perm:2", tool: "Edit", input: { file_path: "/x/src/App.tsx", old_string: "a", new_string: "b" } }]);
  const c = run("sC", [{ id: "perm:3", tool: "AskUserQuestion", input: { questions: [] } }]);
  const three = pickAsk([b, c, a])!;
  assert.equal(three.id, "perm:1"); assert.equal(three.of, 3); assert.equal(three.n, 1);
  // the oldest answered: the next one, counted down
  const two = pickAsk([b, c])!;
  assert.equal(two.id, "perm:2"); assert.equal(two.of, 2);
  assert.equal(two.title, "Claude wants to edit App.tsx"); assert.equal(two.path, "/x/src/App.tsx");
  assert.equal(pickAsk([c])!.tool, "AskUserQuestion");
  assert.equal(pickAsk([])!, null);
  // no command, no diff, no reason: the title alone (the engine's own title wins)
  assert.ok(!JSON.stringify(pickAsk([a])).includes("rm -rf"));
  assert.equal(askTitle({ tool: "Bash", title: "Claude wants to run ls", input: {} }), "Claude wants to run ls");
  assert.equal(askTitle({ tool: "mcp__claude_ai_Higgsfield__generate_image", input: {} }), "Claude wants to use generate_image");
  assert.equal(askTitle({ tool: "ExitPlanMode", input: { plan: "x" } }), "Claude has a plan for you");
});

test("creature.turn: the busy session with the latest activity; null when idle", async () => {
  resetBusy(); resetPings();
  const w = face(), n = face();
  addCreatureFace(w, w); setRole(w, "window");
  addCreatureFace(n, n); setRole(n, "notch");
  assert.ok(n.got.some((m) => m.type === "creature.ask" && m.ask === null), "on connect: the ask (none)");
  assert.ok(n.got.some((m) => m.type === "creature.turn" && m.turn === null), "on connect: the turn (none)");
  assert.equal(currentTurn(), null);

  // a turn starting is activity
  const leaveLife = join("life", "life-1", "codex");
  lifeTurn(w, "life-1", "codex");
  assert.deepEqual(currentTurn(), { seat: "codex", sessionId: "life-1", title: "", kind: "life" });
  await tick();
  const leaveWork = join("work", "work-1", "default");
  assert.equal(currentTurn()?.sessionId, "work-1"); assert.equal(currentTurn()?.kind, "work");
  // a delta on the Life turn's socket makes it the newest again
  await tick();
  sent(w, { type: "delta", text: "hi" });
  assert.equal(currentTurn()?.sessionId, "life-1");
  // a Work step (a work.item from its run) takes it back
  await tick();
  sent(w, { type: "work.item", sessionId: "work-1", item: { id: "t1", kind: "tool" } });
  assert.equal(currentTurn()?.sessionId, "work-1");
  // a tool step on the Life socket
  await tick();
  sent(w, { type: "tool", seat: "codex", id: "s1", kind: "read", text: "reading", done: false });
  assert.equal(currentTurn()?.sessionId, "life-1");
  // a ping in the Work session
  await tick();
  addPingFace(n); pingFaceIs(n, "notch");
  ping("the sidebar is in", "work", "work-1");
  assert.equal(currentTurn()?.sessionId, "work-1");
  // a call: busy while live, its own kind
  await tick();
  sent(n, { type: "call", state: "live", sessionId: "call-conv" });
  assert.deepEqual(currentTurn(), { seat: "codex", sessionId: "call-conv", title: "", kind: "call" });
  sent(n, { type: "call", state: "ended", sessionId: "call-conv" });
  assert.equal(currentTurn()?.sessionId, "work-1", "the call ended: back to the newest busy one");
  // the notch hears each change
  update();
  assert.ok(n.got.some((m) => m.type === "creature.turn" && m.turn?.kind === "call"));
  // a session that is no longer busy is not followed, however recent
  leaveWork();
  assert.equal(currentTurn()?.sessionId, "life-1");
  sent(w, { type: "done", seat: "codex", ok: true });
  leaveLife();
  assert.equal(currentTurn(), null);
  update();
  const last = [...n.got].reverse().find((m) => m.type === "creature.turn");
  assert.equal(last?.turn, null, "idle: null goes out");
  removeCreatureFace(w); removeCreatureFace(n);
});

// the notch page's own rules (mac/src/notch/answer.ts, pure): the button set, the keys, the id check
import { cardOf, keyAction, stillShown, askLine, middle, armed, cardKey, ARM_MS, LINE_MAX, ICONED, LABEL, TINT, shelfMeta, clock, sessionCards, decisionCards, runningRows, sessionKey, foldKey } from "../../mac/src/notch/answer.ts";

test("the card's buttons: the PRD table, Return safe or nothing, Escape only closes, a stale ask is dropped", () => {
  const none = { crew: false, ping: null, unplugged: false, starting: false, ask: null, call: false, turn: null };
  const ask = { id: "perm:1", sessionId: "s1", seat: "claude", tool: "Edit", title: "Claude wants to edit App.tsx", path: "/x/App.tsx", n: 1, of: 3 };
  const turn = { seat: "claude", sessionId: "w1", title: "ecosystem", kind: "work" as const };
  const ping = { id: "p1", seat: "work", sessionId: "w1", line: "done" };
  const set = (c: object) => { const k = cardOf({ ...none, ...c }); return [k.kind, k.buttons.join("+"), k.meta]; };
  assert.deepEqual(set({ ask }), ["ask", "allow+deny", "1 of 3"]);
  assert.deepEqual(set({ ask: { ...ask, of: 1 } }), ["ask", "allow+deny", ""], "one ask: no count");
  assert.deepEqual(set({ ask: { ...ask, tool: "AskUserQuestion" } }), ["question", "open", "1 of 3"]);
  assert.deepEqual(set({ ask: { ...ask, tool: "ExitPlanMode", of: 1 } }), ["question", "open", ""]);
  assert.deepEqual(set({ turn }), ["turn", "stop", "session · ecosystem"]);
  assert.deepEqual(set({ turn: { ...turn, kind: "life", title: "" } }), ["turn", "stop", "chat"]);
  assert.deepEqual(set({ turn: { ...turn, kind: "call" } }), ["plain", "shelf+grab+anticipate", ""], "another face's call is not the notch's to end: nothing to answer, Shelf · Grab");
  assert.deepEqual(set({ call: true, turn }), ["call", "hangup", ""]);
  assert.deepEqual(set({ ping }), ["ping", "open", ""]);
  assert.deepEqual(set({ unplugged: true }), ["unplugged", "start", ""]);
  assert.deepEqual(set({ unplugged: true, starting: true }), ["unplugged", "", ""]);
  assert.deepEqual(set({}), ["plain", "shelf+grab+anticipate", ""], "Grab and Shelf: nothing to answer, the card offers the shelf and a grab");
  assert.deepEqual(set({ crew: true, ask }), ["plain", "", ""]);
  // keys
  const k = (c: object, key: string) => keyAction(cardOf({ ...none, ...c }), key);
  assert.equal(k({ ask }, "Return"), "allow");
  assert.equal(k({ ask: { ...ask, tool: "AskUserQuestion" } }, "Return"), "open");
  assert.equal(k({ ping }, "Return"), "open");
  assert.equal(k({ unplugged: true }, "Return"), "start");
  assert.equal(k({ turn }, "Return"), null, "never Stop");
  assert.equal(k({ call: true }, "Return"), null);
  assert.equal(k({}, "Return"), null, "grabbing is never a key's answer");
  assert.equal(k({}, "Escape"), "close");
  const hand = { id: "o/r#34", from: "frank", issue: 34, title: "" };
  for (const c of [{ ask }, { turn }, { call: true }, { ping }, { unplugged: true }, { hand }, { hand: { ...hand, review: true } }]) assert.equal(k(c, "Escape"), "close", "Escape only closes, the hand card too");
  // the id check: a press answers the ask it drew, only while it is still the open one
  const drawn = cardOf({ ...none, ask });
  assert.equal(stillShown(drawn, ask), true);
  assert.equal(stillShown(drawn, { ...ask, id: "perm:2" }), false, "the ask changed under the press");
  assert.equal(stillShown(drawn, null), false, "answered elsewhere");
  assert.equal(stillShown(cardOf({ ...none, turn }), null), true, "not an ask: nothing to check");
});

test("the ask's line: the file first, a long line keeps its start and its end", () => {
  const ask = { id: "perm:1", sessionId: "s1", seat: "claude", tool: "Edit", title: "Claude wants to edit Notch.tsx", path: "/x/notch/Notch.tsx", n: 1, of: 1 };
  assert.equal(askLine(ask), "Notch.tsx · edit");
  assert.equal(askLine({ ...ask, tool: "Write", title: "Claude wants to write RUBRIC.md", path: "/x/RUBRIC.md" }), "RUBRIC.md · write");
  assert.equal(askLine({ ...ask, tool: "Bash", title: "Claude wants to run: build the notch page", path: undefined }), "run: build the notch page");
  // a title that does not name the file: the file still leads
  assert.equal(askLine({ ...ask, title: "Claude wants to change it", path: "/x/y.ts" }), "y.ts · change it");
  assert.equal(askLine({ ...ask, title: "Claude has a question for you", tool: "AskUserQuestion", path: undefined }), "Claude has a question for you");
  // long: the middle gives way, the start and the end stay
  const long = askLine({ ...ask, tool: "Bash", path: undefined, title: "Claude wants to run: build the notch page and then run every test in the engine" });
  assert.ok(long.length <= LINE_MAX, long);
  assert.ok(long.startsWith("run: build the"), long);
  assert.ok(long.endsWith("in the engine"), long);
  assert.ok(long.includes("…"));
  const file = askLine({ ...ask, title: "Claude wants to edit a-very-long-component-name-for-the-notch.tsx", path: "/x/a-very-long-component-name-for-the-notch.tsx" });
  assert.ok(file.startsWith("a-very-long") && file.endsWith(".tsx · edit"), file);
  assert.equal(middle("short"), "short");
  assert.equal(middle("abcdefghij", 5), "ab…ij");
});

test("an ask outranks a ping: Allow · Deny stays, the ping waits in the meta, Return is Allow", () => {
  const none = { crew: false, ping: null, unplugged: false, starting: false, ask: null, call: false, turn: null };
  const ask = { id: "perm:1", sessionId: "s1", seat: "claude", tool: "Edit", title: "Claude wants to edit App.tsx", path: "/x/App.tsx", n: 1, of: 1 };
  const ping = { id: "p1", seat: "work", sessionId: "w1", line: "done" };
  const both = cardOf({ ...none, ask, ping });
  assert.equal(both.kind, "ask"); assert.deepEqual(both.buttons, ["allow", "deny"]); assert.equal(both.meta, "+1 ping");
  assert.equal(keyAction(both, "Return"), "allow");
  assert.equal(cardOf({ ...none, ask: { ...ask, of: 3 }, ping }).meta, "1 of 3 · +1 ping");
  assert.equal(cardOf({ ...none, ask: { ...ask, tool: "AskUserQuestion" }, ping }).kind, "question");
  // answered: the ping has the card again
  assert.equal(cardOf({ ...none, ping }).kind, "ping");
});

test("arming: a press within ARM_MS of the card changing is refused", () => {
  const none = { crew: false, ping: null, unplugged: false, starting: false, ask: null, call: false, turn: null };
  const a = { id: "perm:1", sessionId: "s1", seat: "claude", tool: "Edit", title: "Claude wants to edit App.tsx", n: 1, of: 2 };
  const b = { ...a, id: "perm:2" };
  // what the card answers is keyed by the ask's id: a newer ask is a change, the same ask redrawn is not
  assert.notEqual(cardKey(cardOf({ ...none, ask: a })), cardKey(cardOf({ ...none, ask: b })));
  assert.equal(cardKey(cardOf({ ...none, ask: a })), cardKey(cardOf({ ...none, ask: { ...a, of: 1 } })));
  assert.notEqual(cardKey(cardOf({ ...none, ask: a })), cardKey(cardOf({ ...none, ping: { id: "p1", seat: "work", line: "x" } })));
  const changed = 1000;
  assert.equal(armed(changed, changed), false, "the moment it changed");
  assert.equal(armed(changed, changed + ARM_MS - 1), false, "just before");
  assert.equal(armed(changed, changed + ARM_MS), true, "armed");
  assert.equal(ARM_MS, 400);
});

test("Grab and Shelf: plain is Shelf · Grab, Grab asks what (Shot · Sol), Shelf shows All; anything to answer outranks them", () => {
  const none = { crew: false, ping: null, unplugged: false, starting: false, ask: null, call: false, turn: null, grabbing: false, shelfOpen: false };
  const ask = { id: "perm:1", sessionId: "s1", seat: "claude", tool: "Edit", title: "Claude wants to edit App.tsx", path: "/x/App.tsx", n: 1, of: 1 };
  const turn = { seat: "claude", sessionId: "w1", title: "ecosystem", kind: "work" as const };
  const card = (c: object) => cardOf({ ...none, ...c });
  const set = (c: object) => { const k = card(c); return [k.kind, k.buttons.join("+"), k.meta]; };
  assert.deepEqual(set({}), ["plain", "shelf+grab+anticipate", ""]);
  assert.deepEqual(set({ grabbing: true }), ["grabbing", "page+shot+sol", ""], "Page · Shot · Sol");
  assert.equal(card({ grabbing: true }).line, "Grab what?");
  assert.deepEqual(set({ shelfOpen: true }), ["shelf", "all", ""]);
  assert.deepEqual(set({ grabbing: true, shelfOpen: true }), ["grabbing", "page+shot+sol", ""], "a grab asked is the newer press");
  assert.equal(card({}).line, undefined, "the plain card keeps Sol's own line");
  // anything with an answer outranks the rows
  for (const c of [{ ask }, { turn }, { call: true }, { unplugged: true }, { crew: true }, { ping: { id: "p1", seat: "work", line: "x" } }]) {
    assert.ok(!["grabbing", "shelf"].includes(card({ ...c, grabbing: true }).kind), JSON.stringify(c));
    assert.ok(!["grabbing", "shelf"].includes(card({ ...c, shelfOpen: true }).kind), JSON.stringify(c));
  }
  assert.deepEqual(set({ stable: { sha: "abc1234", tag: "", by: "" }, grabbing: true }), ["stable", "update+later", ""]);
  assert.deepEqual(set({ hand: { id: "o/r#1", from: "frank", issue: 1, title: "" }, shelfOpen: true })[0], "handed");
  // Return does nothing on these rows; Escape closes
  for (const c of [{}, { grabbing: true }, { shelfOpen: true }]) {
    assert.equal(keyAction(card(c), "Return"), null, JSON.stringify(c));
    assert.equal(keyAction(card(c), "Enter"), null);
    assert.equal(keyAction(card(c), "Escape"), "close");
  }
  // each row is its own key: changing rows re-arms the buttons, so an aim at Grab cannot land on Shot
  const keys = [card({}), card({ grabbing: true }), card({ shelfOpen: true })].map(cardKey);
  assert.equal(new Set(keys).size, 3, keys.join(" "));
  // the icons, their names, no colour
  for (const b of ["shelf", "grab", "page", "shot", "sol", "all"] as const) { assert.ok(ICONED.has(b)); assert.ok(LABEL[b]); assert.equal(TINT[b], ""); }
  for (const b of ["allow", "deny", "open", "stop", "hangup", "start", "update", "later", "take", "pass"] as const) assert.ok(!ICONED.has(b), `${b} keeps its word capsule`);
  assert.ok(!("file" in LABEL), "File it's button is gone");
  assert.equal(stillShown(card({ grabbing: true }), null), true);
});

test("the shelf's meta: how many, singular for one, nothing yet when empty", () => {
  assert.equal(shelfMeta(0), "nothing yet");
  assert.equal(shelfMeta(1), "1 thing · cleans itself after a week");
  assert.equal(shelfMeta(12), "12 things · cleans itself after a week");
});

test("Anticipate (#253): the quiet card's third pill; a talk's row outranks all but an ask; the questions have no buttons", () => {
  const none = { crew: false, ping: null, unplugged: false, starting: false, ask: null, call: false, turn: null, grabbing: false, shelfOpen: false };
  const ask = { id: "perm:1", sessionId: "s1", seat: "claude", tool: "Edit", title: "Claude wants to edit App.tsx", path: "/x/App.tsx", n: 1, of: 1 };
  const turn = { seat: "claude", sessionId: "w1", title: "Talk", kind: "life" as const };
  const card = (c: object) => cardOf({ ...none, ...c });
  const set = (c: object) => { const k = card(c); return [k.kind, k.buttons.join("+"), k.meta]; };
  assert.deepEqual(set({ talk: "listening" }), ["listening", "answer+next+recap+who+ear", ""], "Answer · Say next · Recap · Who, then the ear");
  assert.deepEqual(set({ talk: "questions" }), ["questions", "", ""], "the bar answers; no buttons");
  assert.equal(card({ talk: "listening", ask }).kind, "ask", "an ask still comes first");
  for (const c of [{ turn }, { call: true }, { ping: { id: "p1", seat: "work", line: "x" } }, { grabbing: true }, { shelfOpen: true }])
    assert.equal(card({ ...c, talk: "listening" }).kind, "listening", `a typed ask's running answer never hides the pills: ${JSON.stringify(c)}`);
  for (const k of ["Return", "Enter"]) { assert.equal(keyAction(card({ talk: "listening" }), k), null); assert.equal(keyAction(card({ talk: "questions" }), k), null); }
  assert.equal(keyAction(card({ talk: "listening" }), "Escape"), "close");
  for (const b of ["anticipate", "answer", "next", "recap", "who", "ear"] as const) { assert.ok(ICONED.has(b)); assert.ok(LABEL[b]); assert.equal(TINT[b], ""); }
  assert.equal(LABEL.next, "Say next");
  assert.deepEqual([0, 14, 134, 3665].map(clock), ["0:00", "0:14", "2:14", "61:05"]);
});

test("the half moon (#254): sessionCards splits the ladder into one card each, in order, the ping out of the ask's meta", () => {
  const none = { crew: false, ping: null, unplugged: false, starting: false, ask: null, call: false, turn: null, grabbing: false, shelfOpen: false };
  const ask = { id: "perm:1", sessionId: "s1", seat: "claude", tool: "Edit", title: "Claude wants to edit App.tsx", path: "/x/App.tsx", n: 1, of: 3 };
  const turn = { seat: "claude", sessionId: "w1", title: "ecosystem", kind: "work" as const };
  const ping = { id: "p1", seat: "work", sessionId: "w1", line: "done" };
  const hand = { id: "h1", from: "frank", issue: 34, title: "Hand" };
  const stable = { sha: "7a53b17e2c4d", tag: "stable-1", by: "frank" };
  const kinds = (c: object) => sessionCards({ ...none, ...c }).map((k) => k.kind);
  assert.deepEqual(sessionCards(none), [], "nothing of Sol's: no cards (the moon is just its tools)");
  // the rubric's case (M8): an ask, a ping and a running turn are three cards
  const three = sessionCards({ ...none, ask, ping, turn });
  assert.deepEqual(three.map((k) => k.kind), ["ask", "turn", "ping"]);
  assert.equal(three[0].meta, "1 of 3", "the ask's meta keeps its count and loses \"+1 ping\": the ping has its own card");
  assert.ok(!three[0].meta.includes("ping"));
  assert.equal(cardOf({ ...none, ask, ping }).meta, "1 of 3 · +1 ping", "the one-card ladder is unchanged");
  assert.deepEqual(three.map((k) => k.buttons.join("+")), ["allow+deny", "stop", "open"]);
  // each is cardOf alone: its keys work per card
  assert.equal(keyAction(three[0], "Return"), "allow"); assert.equal(keyAction(three[1], "Return"), null); assert.equal(keyAction(three[2], "Return"), "open");
  assert.equal(three[1].meta, "session · ecosystem");
  // the whole order, every input at once
  assert.deepEqual(kinds({ ask, turn, ping, hand, stable, unplugged: true, call: true }), ["ask", "turn", "ping", "handed", "stable", "unplugged", "call"]);
  // a call's turn is the call's card, not a Stop; the crew down does not empty the moon's cards
  assert.deepEqual(kinds({ turn: { ...turn, kind: "call" }, call: true }), ["call"]);
  assert.deepEqual(kinds({ crew: true, ask }), ["ask"]);
  // a question keeps its choices; starting keeps unplugged without Start
  const q = { ...ask, id: "perm:q", tool: "AskUserQuestion", question: "Anime or dramas?", options: ["Anime", "Dramas"] };
  assert.deepEqual(sessionCards({ ...none, ask: q }).map((k) => [k.kind, k.buttons.join("+")]), [["question", "c1+c2"]]);
  assert.deepEqual(sessionCards({ ...none, unplugged: true, starting: true })[0].buttons, []);
  // the grab and shelf rows and a talk are the moon's own tools, never a session card
  assert.deepEqual(kinds({ grabbing: true, shelfOpen: true, talk: "listening" }), []);
  // keys: an ask's and a turn's are the fold keys of the free notch, so folds carry over; the rest are their own
  assert.equal(sessionKey(three[0]), foldKey(three[0])); assert.equal(sessionKey(three[1]), foldKey(three[1]));
  assert.equal(sessionKey(three[2]), "ping:p1");
  assert.deepEqual(sessionCards({ ...none, hand, stable, unplugged: true, call: true }).map(sessionKey), ["hand:h1", "stable:7a53b17e2c4d", "unplugged", "call"]);
});

test("the half moon (Marco, 2026-10-26): only decisions bud out as cards; a turn, a call and a ping are the Sessions disc's rows", () => {
  const none = { crew: false, ping: null, unplugged: false, starting: false, ask: null, call: false, turn: null, grabbing: false, shelfOpen: false };
  const ask = { id: "perm:1", sessionId: "s1", seat: "claude", tool: "Edit", title: "Claude wants to edit App.tsx", path: "/x/App.tsx", n: 1, of: 3 };
  const q = { ...ask, id: "perm:q", tool: "AskUserQuestion", question: "Anime or dramas?", options: ["Anime", "Dramas"] };
  const turn = { seat: "claude", sessionId: "w1", title: "ecosystem", kind: "work" as const };
  const ping = { id: "p1", seat: "work", sessionId: "w1", line: "done" };
  const hand = { id: "h1", from: "frank", issue: 34, title: "Hand" };
  const stable = { sha: "7a53b17e2c4d", tag: "stable-1", by: "frank" };
  const all = { ...none, ask, turn, ping, hand, stable, unplugged: true, call: true };
  assert.deepEqual(decisionCards(all).map((k) => k.kind), ["ask", "handed", "stable", "unplugged"]);
  assert.deepEqual(runningRows(all).map((k) => k.kind), ["turn", "ping", "call"]);
  assert.deepEqual(decisionCards({ ...none, ask: q }).map((k) => k.kind), ["question"]);
  // the two split the whole: nothing lost, nothing twice
  assert.equal(decisionCards(all).length + runningRows(all).length, sessionCards(all).length);
  // the ask still loses "+1 ping" (the ping is a row), and its keys still work per card
  const [a0] = decisionCards({ ...none, ask, ping });
  assert.equal(a0.meta, "1 of 3"); assert.equal(keyAction(a0, "Return"), "allow");
  // a running turn alone: no card out, one row
  assert.deepEqual(decisionCards({ ...none, turn }), []);
  assert.deepEqual(runningRows({ ...none, turn }).map(sessionKey), ["turn:w1"]);
  assert.deepEqual(runningRows({ ...none, ping, call: true }).map(sessionKey), ["ping:p1", "call"]);
  assert.deepEqual(decisionCards({ ...none, ask, hand }).map(sessionKey), ["ask:s1/perm:1", "hand:h1"]);
});

test("the half moon (#254): a running row keeps its card's buttons; Return is its safe one or nothing, Escape only closes", () => {
  const none = { crew: false, ping: null, unplugged: false, starting: false, ask: null, call: false, turn: null, grabbing: false, shelfOpen: false };
  const turn = { seat: "claude", sessionId: "w1", title: "ecosystem", kind: "work" as const };
  const chat = { seat: "claude", sessionId: "l1", title: "", kind: "life" as const };
  const ping = { id: "p1", seat: "work", sessionId: "w1", line: "done" };
  const rows = runningRows({ ...none, turn, ping, call: true });
  // the buttons the old one-card notch had for each: Stop, Open, this notch's own call's Hang up
  assert.deepEqual(rows.map((r) => [r.kind, r.buttons.join("+")]), [["turn", "stop"], ["ping", "open"], ["call", "hangup"]]);
  assert.deepEqual(rows.map((r) => LABEL[r.buttons[0]]), ["Stop", "Open", "Hang up"]);
  assert.deepEqual(runningRows({ ...none, turn: chat })[0].buttons, ["stop"], "a chat's answer is stopped the same way");
  // the row's buttons are the one-card ladder's, unchanged
  assert.deepEqual(rows[0].buttons, cardOf({ ...none, turn }).buttons);
  assert.deepEqual(rows[1].buttons, cardOf({ ...none, ping }).buttons);
  assert.deepEqual(rows[2].buttons, cardOf({ ...none, call: true }).buttons);
  // Return on a hovered row: a ping's Open; never Stop, never Hang up. Escape closes, on every row
  assert.deepEqual(rows.map((r) => keyAction(r, "Return")), [null, "open", null]);
  for (const r of rows) {
    assert.equal(keyAction(r, "Escape"), "close");
    const ret = keyAction(r, "Return");
    assert.ok(ret === null || r.buttons.includes(ret as never), `Return on the ${r.kind} row is one of its own buttons or nothing`);
  }
  // a call on another face is not this notch's to end: no row, no Hang up
  assert.deepEqual(runningRows({ ...none, turn: { ...turn, kind: "call" } }), []);
  // each row is armed by what it answers: a new ping re-arms its row, a turn keeps its key
  assert.notEqual(cardKey(runningRows({ ...none, ping })[0]), cardKey(runningRows({ ...none, ping: { ...ping, id: "p2" } })[0]));
});
