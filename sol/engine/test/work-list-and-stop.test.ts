import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lastSaid, lastSaidIn, _resetSaid } from "../src/work/said.ts";
import { sinceAfter, startsTurn, tasksAfter, type BgTask } from "../src/work/turns.ts";

beforeEach(_resetSaid);

const line = (o: object) => JSON.stringify(o) + "\n";
const T1 = "2026-10-16T02:40:01.521Z", T2 = "2026-10-16T02:41:30.000Z";

// ---- the list order: a session's time is its last message, not its file ----

test("the last message's time, and bookkeeping lines after it do not count", () => {
  const text =
    line({ type: "user", timestamp: T1, message: { role: "user", content: "hi" } }) +
    line({ type: "assistant", timestamp: T2, message: { role: "assistant", content: [] } }) +
    line({ type: "custom-title", customTitle: "Sol, the tree", sessionId: "x" }) +
    line({ type: "cost-state", sessionId: "x", totalCostUSD: 1 }) +
    line({ type: "artifact-comment-monitor", v: 1, sessionId: "x", artifacts: {} });
  assert.equal(lastSaidIn(text), Date.parse(T2));
  assert.equal(lastSaidIn(line({ type: "custom-title", customTitle: "x" })), 0);
  assert.equal(lastSaidIn(""), 0);
});

test("a file: the file time is the fallback, the tail is read past a huge last line, and the answer is cached by size and time", () => {
  const dir = mkdtempSync(join(tmpdir(), "sol-said-"));
  const f = join(dir, "s.jsonl");
  writeFileSync(f, line({ type: "custom-title", customTitle: "nothing said yet" }));
  assert.equal(lastSaid(f, 123), 123, "no message: the file time");
  assert.equal(lastSaid(join(dir, "missing.jsonl"), 7), 7, "no file: the file time");

  appendFileSync(f, line({ type: "user", timestamp: T1, message: { role: "user", content: "hi" } }));
  assert.equal(lastSaid(f, 123), Date.parse(T1));
  // a tool result far longer than the first look at the tail, then bookkeeping: the message before it is still found
  appendFileSync(f, line({ type: "assistant", timestamp: T2, message: { role: "assistant", content: [] } }));
  appendFileSync(f, line({ type: "user", timestamp: T2, message: { role: "user", content: [{ type: "tool_result", content: "x".repeat(200 * 1024) }] } }).replace(`"timestamp":"${T2}"`, `"timestamp":"${T2}"`));
  appendFileSync(f, line({ type: "last-prompt", lastPrompt: "lets close out", sessionId: "s" }));
  assert.equal(lastSaid(f, 123), Date.parse(T2));
  // the Claude app touching the file with one more bookkeeping line: still the last message's time
  appendFileSync(f, line({ type: "cost-state", sessionId: "s", totalCostUSD: 2 }));
  assert.equal(lastSaid(f, 999), Date.parse(T2));
});

// ---- the run: what starts a turn, which background tasks live ----

test("a turn starts on the main thread's frames only; a background agent's own frames start none", () => {
  assert.equal(startsTurn({ type: "assistant", parent_tool_use_id: null }), true);
  assert.equal(startsTurn({ type: "stream_event", parent_tool_use_id: null, event: {} }), true);
  assert.equal(startsTurn({ type: "assistant", parent_tool_use_id: "toolu_01" }), false);
  assert.equal(startsTurn({ type: "stream_event", parent_tool_use_id: "toolu_01" }), false);
  assert.equal(startsTurn({ type: "system", subtype: "task_progress" }), false);
  assert.equal(startsTurn({ type: "user" }), false);
});

test("the background tasks: the level replaces the set, ambient ones drop, an edge adds or ends one", () => {
  let tasks: BgTask[] = [];
  const level = { type: "system", subtype: "background_tasks_changed", tasks: [
    { task_id: "a1", task_type: "local_agent", subagent_type: "general-purpose", description: "Build Hand (#34) in a worktree" },
    { task_id: "a2", task_type: "local_agent", subagent_type: "general-purpose", description: "Build Try and review (#35) in a worktree" },
    { task_id: "w1", task_type: "monitor", description: "watch", ambient: true },
  ] };
  tasks = tasksAfter(level, tasks)!;
  assert.deepEqual(tasks.map((t) => t.id), ["a1", "a2"]);
  assert.equal(tasks[0].agent, "general-purpose");
  assert.equal(tasksAfter({ type: "assistant", parent_tool_use_id: "toolu_01" }, tasks), null, "a frame says nothing about them");
  assert.equal(tasksAfter({ type: "system", subtype: "task_progress", task_id: "a1" }, tasks), null);
  // one hands back
  tasks = tasksAfter({ type: "system", subtype: "task_notification", task_id: "a1", status: "completed" }, tasks)!;
  assert.deepEqual(tasks.map((t) => t.id), ["a2"]);
  assert.equal(tasksAfter({ type: "system", subtype: "task_notification", task_id: "a1", status: "completed" }, tasks), null, "already gone");
  // a CLI with no level: the start edge adds, once
  tasks = tasksAfter({ type: "system", subtype: "task_started", task_id: "a3", description: "Build Share (#36)" }, tasks)!;
  assert.deepEqual(tasks.map((t) => t.id), ["a2", "a3"]);
  assert.equal(tasksAfter({ type: "system", subtype: "task_started", task_id: "a3", description: "Build Share (#36)" }, tasks), null);
  assert.equal(tasksAfter({ type: "system", subtype: "task_started", task_id: "w2", description: "watch", ambient: true }, tasks), null);
  // all stopped: the empty level
  tasks = tasksAfter({ type: "system", subtype: "background_tasks_changed", tasks: [] }, tasks)!;
  assert.deepEqual(tasks, []);
});

// ---- the clock: how long a run has worked (#47) ----

test("the clock starts with the work, keeps its start while agents outlive the turn, and stops when all is quiet", () => {
  assert.equal(sinceAfter(false, 0, 100), 0, "idle: no clock");
  assert.equal(sinceAfter(true, 0, 100), 100, "a turn starts: now");
  assert.equal(sinceAfter(true, 100, 250), 100, "still working (agents after the turn): the same start");
  assert.equal(sinceAfter(false, 100, 300), 0, "all handed back: the clock is off");
  assert.equal(sinceAfter(true, 0, 400), 400, "the next turn: a fresh start");
});
