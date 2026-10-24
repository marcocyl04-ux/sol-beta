// node --test src/*.test.ts: the seat switch in a folder (#182, work/seats.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { seatPick, folderIn } from "./work/seats.ts";

test("a new talk: the switch picks who, the folder stays where", () => {
  assert.deepEqual(seatPick("codex", { on: "claude", cwd: "/Users/m/kaat" }), { kind: "new", seat: "codex", cwd: "/Users/m/kaat" });
  assert.deepEqual(seatPick("claude", { on: "codex", cwd: "/Users/m/kaat" }), { kind: "new", seat: "claude", cwd: "/Users/m/kaat" });
});

test("no folder (none, or the home folder's ~) is a chat in Sol's home, as before (#141)", () => {
  assert.deepEqual(seatPick("codex", { on: "claude", cwd: "~" }), { kind: "new", seat: "codex", cwd: undefined });
  assert.deepEqual(seatPick("codex", { on: "claude" }), { kind: "new", seat: "codex", cwd: undefined });
  assert.equal(folderIn(""), undefined);
  assert.equal(folderIn("/Users/m/kaat"), "/Users/m/kaat");
});

test("a talk under way is carried on by the other seat, never changed; the same seat is nothing", () => {
  assert.deepEqual(seatPick("codex", { on: "claude", id: "s-1", cwd: "/Users/m/kaat" }), { kind: "carry", from: "claude", id: "s-1" });
  assert.deepEqual(seatPick("claude", { on: "codex", id: "t-1", cwd: "/Users/m/kaat" }), { kind: "carry", from: "codex", id: "t-1" });
  assert.deepEqual(seatPick("claude", { on: "claude", id: "s-1" }), { kind: "same" });
  assert.deepEqual(seatPick("codex", { on: "codex", cwd: "/Users/m/kaat" }), { kind: "same" });
});
