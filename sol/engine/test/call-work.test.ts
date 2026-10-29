// A call in a project session (#24, round two): the voice's line goes into the session, the answer's own words go
// to the voice as they stream, and the turn's end ends the ask (call/work.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { askWork, type WorkDeps } from "../src/call/work.js";

function fake() {
  let ear: ((m: any) => void) | null = null;
  const said: string[] = [], stopped: string[] = [];
  const d: WorkDeps = {
    say: async (s) => { said.push(s.text); },
    stop: (id) => { stopped.push(id); },
    listen: (f) => { ear = f; return () => { ear = null; }; },
  };
  return { d, said, stopped, hear: (m: any) => ear?.(m), listening: () => !!ear };
}
const S = "sess-12345678";

test("the voice's line goes in; only the main thread's words are spoken; the turn's end answers", async () => {
  const f = fake();
  const spoken: string[] = [];
  const p = askWork(f.d, { sessionId: S, text: "what changed?" }, new AbortController().signal, (t) => spoken.push(t));
  assert.deepEqual(f.said, ["what changed?"]);
  f.hear({ type: "work.item", sessionId: "other-12345678", item: { id: "x", kind: "me", text: "what changed?" } });   // another session
  f.hear({ type: "work.item", sessionId: S, item: { id: "m1", kind: "me", text: "what changed?" } });
  f.hear({ type: "work.item", sessionId: S, item: { id: "t1", kind: "think", text: "", live: true } });
  f.hear({ type: "work.delta", sessionId: S, id: "t1", text: "hmm" });                    // thinking: never spoken
  f.hear({ type: "work.item", sessionId: S, item: { id: "y1", kind: "you", text: "", live: true } });
  f.hear({ type: "work.delta", sessionId: S, id: "y1", text: "Two files. " });
  f.hear({ type: "work.item", sessionId: S, item: { id: "h1", kind: "you", text: "", live: true, parent: "tool-1" } });
  f.hear({ type: "work.delta", sessionId: S, id: "h1", text: "a helper's" });            // a helper's: never spoken
  f.hear({ type: "work.delta", sessionId: S, id: "y1", text: "Both tests." });
  f.hear({ type: "work.item", sessionId: S, item: { id: "y1", kind: "you", text: "Two files. Both tests." } });   // settled: not again
  f.hear({ type: "work.run", sessionId: S, busy: false, ended: true });
  assert.equal(await p, "Two files. Both tests.");
  assert.deepEqual(spoken, ["Two files. ", "Both tests."]);
  assert.equal(f.listening(), false, "it stops listening once answered");
});

test("a line said while a turn runs waits: that turn's end is not its own", async () => {
  const f = fake();
  const spoken: string[] = [];
  const p = askWork(f.d, { sessionId: S, text: "and the docs" }, new AbortController().signal, (t) => spoken.push(t));
  f.hear({ type: "work.item", sessionId: S, item: { id: "m2", kind: "me", text: "and the docs", queued: true } });
  f.hear({ type: "work.delta", sessionId: S, id: "y0", text: "the earlier answer" });
  f.hear({ type: "work.run", sessionId: S, ended: true });                                 // the earlier turn ends
  f.hear({ type: "work.item", sessionId: S, item: { id: "m2", kind: "me", text: "and the docs" } });   // let in
  f.hear({ type: "work.item", sessionId: S, item: { id: "y2", kind: "you", text: "Done, the README too." } });   // whole, no chunks
  f.hear({ type: "work.run", sessionId: S, ended: true });
  assert.equal(await p, "Done, the README too.");
  assert.deepEqual(spoken, ["Done, the README too."]);
});

test("a stop stops the run; a refused say is the ask's error", async () => {
  const f = fake();
  const ab = new AbortController();
  const p = askWork(f.d, { sessionId: S, text: "go" }, ab.signal);
  ab.abort();
  await assert.rejects(p, /stopped/);
  assert.deepEqual(f.stopped, [S]);
  const g = fake();
  g.d.say = async () => { throw new Error("it is open in Claude Code (running): fork it here to go on, or write there"); };
  await assert.rejects(askWork(g.d, { sessionId: S, text: "go" }, new AbortController().signal), /open in Claude Code/);
  assert.equal(g.listening(), false);
});
