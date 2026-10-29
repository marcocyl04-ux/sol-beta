// node --test src/*.test.ts: where a call goes (#24, round two, callAt.ts): any Home talk, either seat
import { test } from "node:test";
import assert from "node:assert/strict";
import { callAt, pressCall } from "./callAt.ts";

test("a chat is called on its own, Codex or Claude; a session by its id; a session not begun cannot be", () => {
  assert.deepEqual(callAt({ session: "t-1" }), { work: false });
  assert.deepEqual(callAt({}), { work: false }, "a new chat: the engine names it");
  assert.deepEqual(callAt({ shell: {}, session: "s-12345678" }), { work: true, session: "s-12345678" });
  assert.equal(callAt({ shell: {}, session: undefined }), null);
});

function caller(callState: "off" | "ringing" | "live" = "off", voice = "aoede") {
  const out = { calls: 0, sent: [] as object[], flashed: [] as string[] };
  const e = { up: true, callState, settings: { voice }, call: () => { out.calls++; }, send: (m: object) => { out.sent.push(m); }, flash: (s: string) => { out.flashed.push(s); } };
  return { e, out };
}

test("the press: a chat's call is the engine's own; a session's sends its id; one on is hung up from anywhere", () => {
  let c = caller();
  pressCall(c.e, { work: false });
  assert.equal(c.out.calls, 1); assert.deepEqual(c.out.sent, []);
  c = caller();
  pressCall(c.e, { work: true, session: "s-12345678" });
  assert.deepEqual(c.out.sent, [{ type: "call", work: true, sessionId: "s-12345678" }]);
  c = caller("live");
  pressCall(c.e, { work: true, session: "s-12345678" });
  assert.equal(c.out.calls, 1, "hang up"); assert.deepEqual(c.out.sent, []);
  c = caller("live");
  pressCall(c.e, null);
  assert.equal(c.out.calls, 1, "hang up even where nothing could start one");
});

test("not yet, and voice off, say so", () => {
  let c = caller();
  pressCall(c.e, null);
  assert.match(c.out.flashed[0], /say one thing/); assert.equal(c.out.calls, 0);
  c = caller("off", "off");
  pressCall(c.e, { work: true, session: "s-12345678" });
  assert.match(c.out.flashed[0], /voice is off/); assert.deepEqual(c.out.sent, []);
});
