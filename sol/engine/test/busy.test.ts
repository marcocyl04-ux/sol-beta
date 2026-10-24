import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { join, busyCount, idle, whenIdle, lockSession, Held, relockSession, sessionHolder, busyLine, _reset } from "../src/busy.ts";

beforeEach(_reset);

test("the counter: every job joins, renew waits until the last leaves", async () => {
  assert.equal(idle(), true);
  const a = join("life", "s1"), b = join("term", "t1", "zsh");
  assert.equal(busyCount(), 2);
  assert.match(busyLine(), /life s1 .*term t1 \(zsh\)/);
  let woke = false;
  const p = whenIdle().then(() => { woke = true; });
  a(); a();   // leaving twice is one leave
  await Promise.resolve();
  assert.equal(woke, false);
  b();
  await p;
  assert.equal(woke, true);
  assert.equal(idle(), true);
});

test("the writer lock: one writer per session, re-entrant for the same holder", () => {
  const r1 = lockSession("s1", "work");
  assert.throws(() => lockSession("s1", "life"), Held);
  const r2 = lockSession("s1", "work");
  r1();
  assert.equal(sessionHolder("s1"), "work");
  r2();
  assert.equal(sessionHolder("s1"), null);
  lockSession("s1", "life");
});

test("a fresh Life turn moves its hold onto the session id it learns", () => {
  lockSession("draft-1", "life:a");
  const r = relockSession("draft-1", "sess-9", "life:a");
  assert.equal(sessionHolder("draft-1"), null);
  assert.equal(sessionHolder("sess-9"), "life:a");
  assert.throws(() => lockSession("sess-9", "work"), Held);
  r();
  assert.equal(sessionHolder("sess-9"), null);
});
