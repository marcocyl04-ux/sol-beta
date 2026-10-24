// Companion step 1: presence and state derived in the engine, one ping one place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addCreatureFace, removeCreatureFace, setRole, setPresence, presenceNow, placeNow, derive, sent, AWAY_S, receiptLines } from "../src/creature.js";
import { addPingFace, pingFaceIs, ping, seenPing, ackPing, _pings, _reset } from "../src/ping.js";
import { join } from "../src/busy.js";

type Msg = { type: string; [k: string]: any };
const face = () => { const got: Msg[] = []; return { got, send: (m: object) => got.push(m as Msg) }; };

test("presence: here, elsewhere, away; no idle source never away; a call pins here", () => {
  const w = face();
  addCreatureFace(w, w); setRole(w, "window");
  assert.equal(w.got[0].type, "engine");
  setPresence(w, true, 3); assert.equal(presenceNow(), "here"); assert.equal(placeNow(), "window");
  setPresence(w, false, 30); assert.equal(presenceNow(), "elsewhere"); assert.equal(placeNow(), "notch");
  setPresence(w, false, AWAY_S); assert.equal(presenceNow(), "away"); assert.equal(placeNow(), "phone");
  setPresence(w, false, null); assert.equal(presenceNow(), "elsewhere");
  setPresence(w, false, AWAY_S + 5);
  sent(w, { type: "call", state: "live" });
  assert.equal(presenceNow(), "here"); assert.equal(derive(), "listening");
  sent(w, { type: "call", state: "ended" });
  assert.equal(derive(), "away");
  const leave = join("life", "s1");
  assert.equal(derive(), "working");
  leave();
  sent(w, { type: "done", ok: false });
  assert.ok(w.got.some((m) => m.type === "creature.flash" && m.kind === "wrong"));
  assert.ok(w.got.some((m) => m.type === "creature.state"));
  removeCreatureFace(w);
});

test("pings: one destination, seen only there, dedupe, phone falls back to the notch", async (t) => {
  _reset();
  const w = face(), n = face(), ph = face();
  addCreatureFace(w, w); setRole(w, "window");
  for (const [f, r] of [[w, "window"], [n, "notch"], [ph, "phone"]] as const) { addPingFace(f); pingFaceIs(f, r); }
  setPresence(w, true, 0);
  const a = ping("one", "codex");
  assert.equal(a.dest, "window");
  assert.ok(w.got.some((m) => m.type === "notify" && m.id === a.id));
  assert.ok(!n.got.some((m) => m.type === "notify"));
  assert.equal(ping("one", "codex").id, a.id, "same (seat, line) within 30 s is one ping");
  assert.equal(seenPing(a.id, n), false, "the notch cannot clear a window ping");
  assert.equal(seenPing(a.id, w), true);

  setPresence(w, false, AWAY_S);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const b = ping("two", "claude");
  assert.equal(b.dest, "phone");
  assert.ok(n.got.some((m) => m.type === "notify.mark" && m.count === 1));
  assert.equal(seenPing(b.id, n), false, "a notch click cannot clear a phone-bound ping");
  t.mock.timers.tick(20_000);
  assert.equal(b.dest, "notch");
  assert.ok(n.got.some((m) => m.type === "notify" && m.id === b.id));
  const c = ping("three", "claude");
  ackPing(c.id, ph);
  t.mock.timers.tick(20_000);
  assert.equal(c.dest, "phone", "acked: it stays on the phone");
  t.mock.timers.reset();
  for (let i = 0; i < 15; i++) ping(`p${i}`, "codex");
  assert.equal(_pings().length, 12);
  removeCreatureFace(w);
});

test("receipt: only a turn that did something gets one, by count", () => {
  const w = face();
  addCreatureFace(w, w);
  sent(w, { type: "tool", id: "r1", kind: "read", text: "reading a.md", done: true, ok: true });
  sent(w, { type: "done", ok: true });
  assert.ok(!w.got.some((m) => m.type === "creature.receipt"), "a chat reply or a read gets no receipt");
  sent(w, { type: "tool", id: "e1", kind: "write", text: "editing src/App.tsx (+2)", done: true, ok: true });
  sent(w, { type: "tool", id: "c1", kind: "command", text: "running ls", done: true, ok: true });
  sent(w, { type: "tool", id: "c2", kind: "command", text: "running npm test", done: true, ok: false });
  sent(w, { type: "done", ok: true });
  const r = w.got.find((m) => m.type === "creature.receipt");
  assert.deepEqual(r?.lines, ["edited 3 files · ran 1 command", "App.tsx"]);
  assert.deepEqual(receiptLines([{ kind: "desk", text: "x" }]), ["made 1 card"]);
  removeCreatureFace(w);
});
