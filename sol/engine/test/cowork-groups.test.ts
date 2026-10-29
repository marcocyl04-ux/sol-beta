// Groups in the sidebar (#314, the groups PRD §9.9): a session started under a room is marked with that room's id beside
// its room hash, and the session rows the face gets say it; a session marked before #314 (the hash alone) is filed by
// matching the hash against the rooms I have now, and one from before #230 (no hash) by the room folder it ran in, so
// nothing old is orphaned. A saved id holds only while its room's hash is still the session's. A room I left files
// nothing. Nothing here touches a real work.json or team.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SOL_STATE = join(mkdtempSync(join(tmpdir(), "sol-state-")), "work.json");
const { mark, workState } = await import("../src/work/state.ts");
const { roomMark, withRoomIds } = await import("../src/team/here.ts");

const shuai = { id: "shuai", provider: "cloud", hub: "wss://cloud.matterfold.tech/relay", code: "ABCDEF", record: "cloud:ABCDEF" };
const sol = { id: "sol", provider: "github", hub: "", code: "", record: "marcocyl04-ux/sol-dev", folder: "/Users/f/Sol/sol-dev" };
const hash = (r: typeof shuai) => roomMark(r, r.record);

test("a session started under a room keeps its id, and lists with it", async () => {
  mark("s-new", { mode: "cowork", room: hash(shuai), roomId: "shuai" });
  assert.equal(workState().marks["s-new"].roomId, "shuai");
  const [row] = withRoomIds([{ id: "s-new", ...workState().marks["s-new"] }], [shuai, sol]);
  assert.equal(row.roomId, "shuai");
  await new Promise((r) => setTimeout(r, 250));   // the file is written 150 ms after the last mark
  assert.equal(JSON.parse(readFileSync(process.env.SOL_STATE!, "utf8")).marks["s-new"].roomId, "shuai");
  mark("s-new", { roomId: null });
  assert.equal(workState().marks["s-new"].roomId, undefined);
});

test("an old session with only the room hash is filed under the room that hash is", () => {
  const rows = withRoomIds([
    { id: "old", mode: "cowork", room: hash(sol) },
    { id: "gone", mode: "cowork", room: "0123456789abcdef" },              // a room I left: no group
    { id: "work", mode: "work" as const, room: hash(shuai) },              // not a cowork session: untouched
    { id: "own", mode: "cowork", room: hash(shuai), roomId: "shuai" },     // its own mark, its room's hash: kept
    { id: "stale", mode: "cowork", room: hash(sol), roomId: "shuai" },     // a saved id whose room's hash is not its own: the hash wins
    { id: "left", mode: "cowork", roomId: "gone-room" },                   // a saved id of a room I left: none
    { id: "older", mode: "cowork", cwd: "/Users/f/Sol/sol-dev/sol/mac" },  // before #230: no hash, filed by its folder
    { id: "elsewhere", mode: "cowork", cwd: "/Users/f/Sol/sol-dev-2" },    // a folder that only starts with the name: none
  ], [shuai, sol]);
  assert.deepEqual(rows.map((r) => r.roomId), ["sol", undefined, undefined, "shuai", "sol", undefined, "sol", undefined]);
});

test("the same name in another room's code does not take its sessions, even with the id saved", () => {
  const theirs = { ...shuai, code: "GHJKLM", record: "cloud:GHJKLM" };
  const rows = withRoomIds([{ id: "x", mode: "cowork", room: hash(theirs) }, { id: "y", mode: "cowork", room: hash(theirs), roomId: "shuai" }], [shuai]);
  assert.deepEqual(rows.map((r) => r.roomId), [undefined, undefined]);
});
