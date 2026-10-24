// A Life turn outlives its socket (src/relay.ts, #17): the face that comes back gets what was said so far, then the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Relay, relayFor } from "../src/relay.ts";

const face = () => { const got: any[] = []; return { got, wire: { readyState: 1, send: (s: string) => got.push(JSON.parse(s)) } }; };
const out = (to: { send: (s: string) => void }, m: any) => to.send(JSON.stringify(m));

test("relay: a socket that goes mid-turn loses nothing; the face that comes back gets the turn so far, then the rest", () => {
  const a = face(), b = face();
  const r = new Relay(a.wire, "codex", "tell me a story", "draft-1", undefined, new AbortController(), out);
  r.send(JSON.stringify({ type: "start", seat: "codex", sessionId: "s-1" }));
  r.send(JSON.stringify({ type: "delta", text: "Once " }));
  r.send(JSON.stringify({ type: "tool", id: "t1", text: "reading", done: false }));
  assert.equal(a.got.length, 3);
  assert.equal(r.detach(a.wire), true);
  r.send(JSON.stringify({ type: "tool", id: "t1", text: "reading", done: true, ok: true }));
  r.send(JSON.stringify({ type: "delta", text: "upon " }));
  r.send(JSON.stringify({ type: "delta", text: "a time" }));
  assert.equal(a.got.length, 3, "nothing goes to the socket that went");
  assert.equal(relayFor("draft-1"), r);
  assert.equal(relayFor("s-1"), r, "found by the conversation the seat named, too");
  r.attach(b.wire);
  assert.deepEqual(b.got.map((m) => m.type), ["delta", "tool", "delta"]);
  assert.equal(b.got[1].done, true, "a step comes back in its latest state");
  assert.equal(b.got[2].text, "upon a time", "the text since, in one piece");
  r.send(JSON.stringify({ type: "done", seat: "codex", sessionId: "s-1", ok: true }));
  assert.equal(b.got.at(-1).type, "done");
  r.end();
  assert.equal(relayFor("s-1"), undefined, "a turn whose end was seen is forgotten");
});

test("relay: the thread for a late face ends at Marco's say, whether or not the record has it yet", () => {
  const r = new Relay(face().wire, "codex", "what is on today", undefined, "s-2", new AbortController(), out);
  const before = [{ who: "me", text: "hi" }, { who: "you", text: "hello" }];
  assert.deepEqual(r.thread(before).at(-1), { who: "me", text: "what is on today" });
  const written = [...before, { who: "me", text: "what is on today" }, { who: "you", text: "half an ans" }];
  assert.deepEqual(r.thread(written), written.slice(0, 3), "what the relay replays is not shown twice");
  r.end();
});

test("relay: a turn that finished while nobody was there is kept for the face that comes back, then forgotten", () => {
  const a = face(), b = face();
  const r = new Relay(a.wire, "codex", "x", undefined, "s-3", new AbortController(), out);
  r.detach(a.wire);
  r.send(JSON.stringify({ type: "done", seat: "codex", sessionId: "s-3", ok: true }));
  r.end();
  assert.equal(relayFor("s-3"), r);
  r.attach(b.wire);
  assert.equal(b.got.length, 0, "the record on disk has it all; nothing is replayed");
  assert.equal(relayFor("s-3"), undefined);
});
