// One Sol (#62): a session the other machine made goes on here, in the same folder under this machine's home. Pure on
// paths: the folders that exist are a set, so nothing on disk is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { movedTo, twinIn, workFolderIn } from "../src/work/sessions.ts";
import { _reset, join, letGo, LET_GO_MS, refusedWhileLettingGo } from "../src/busy.ts";

const NUC = "/home/mcyl04", MAC = "/Users/marcol04";
const on = (...dirs: string[]) => (p: string) => dirs.includes(p);

test("the twin: a folder under either home is the same folder under this one; anything else stays", () => {
  assert.equal(twinIn(`${MAC}/computer/personal/projects/ecosystem`, NUC), `${NUC}/computer/personal/projects/ecosystem`);
  assert.equal(twinIn(`${NUC}/computer`, MAC), `${MAC}/computer`);
  assert.equal(twinIn(MAC, NUC), NUC, "the home itself");
  assert.equal(twinIn("/tmp/x", NUC), "/tmp/x");
  assert.equal(twinIn("/Users/marcol04x/y", NUC), `${NUC}/y`, "a home is one path part, whatever its name");
});

test("the work folder: its own when it is here, else the twin, else none", () => {
  const repo = "/computer/personal/projects/ecosystem";
  // on the NucBox: a session the Mac made, its folder synced
  assert.equal(workFolderIn(`${MAC}${repo}`, NUC, on(`${NUC}${repo}`)), `${NUC}${repo}`);
  // on the NucBox: its own session
  assert.equal(workFolderIn(`${NUC}${repo}`, NUC, on(`${NUC}${repo}`)), `${NUC}${repo}`);
  // a side copy the Mac made and the NucBox never had: gone, as before
  assert.equal(workFolderIn(`${MAC}${repo}/.claude/worktrees/polish`, NUC, on(`${NUC}${repo}`)), undefined);
  // a folder outside any home that is not here
  assert.equal(workFolderIn("/opt/x", NUC, on()), undefined);
  // the Mac, with both a folder of its own and the twin: its own wins
  assert.equal(workFolderIn(`${MAC}${repo}`, MAC, on(`${MAC}${repo}`)), `${MAC}${repo}`);
});

test("a folder that moved (#129): a path recorded in the old place is the same path in the new one, the twin's too", () => {
  const old = `${MAC}/computer/personal/projects/ecosystem`, now = `${MAC}/computer/personal/projects/sol`;
  const at = movedTo({ [old]: now });
  assert.equal(at(old), now);
  assert.equal(at(`${old}/sol/engine`), `${now}/sol/engine`, "and anything under it");
  assert.equal(at(`${old}-x`), `${old}-x`, "a folder whose name only starts the same is not it");
  assert.equal(at(`${MAC}/other`), `${MAC}/other`);
  assert.equal(movedTo({})(old), old, "nothing moved: as it was");
  // on the Mac: a session the NucBox made in the folder before the move goes on in the moved folder
  assert.equal(workFolderIn(`${NUC}/computer/personal/projects/ecosystem/sol`, MAC, on(now, `${now}/sol`), at), `${now}/sol`);
  // the old folder itself is not there any more: without the map it is gone, with it found
  assert.equal(workFolderIn(old, MAC, on(now)), undefined);
  assert.equal(workFolderIn(at(old), MAC, on(now), at), now);
});

test("letting go: granted only while nothing is live; then only what starts a job is refused, and only for a moment", () => {
  _reset();
  const leave = join("life", "s1");
  assert.equal(letGo(1000), false, "a turn is live");
  assert.equal(refusedWhileLettingGo("say", 1000), false);
  leave();
  assert.equal(letGo(1000), true);
  assert.equal(refusedWhileLettingGo("say", 1001), true);
  assert.equal(refusedWhileLettingGo("work.say", 1001), true);
  assert.equal(refusedWhileLettingGo("work.list", 1001), false, "reading goes on");
  assert.equal(refusedWhileLettingGo("say", 1000 + LET_GO_MS), false, "the moment ends");
  _reset();
});
