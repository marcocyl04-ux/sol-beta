// engine/eye (#253, the eye): while the notch says Sol is hidden, a Sol grab and File it's shot refuse with the eye's
// words and take nothing (a hidden window is blank to screencapture); open again, the refusal is gone. The state is
// faked with setSolHidden; nothing here takes a picture or lists a window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HIDDEN, setSolHidden, solHidden } from "../src/eye.ts";
import { handleGrab } from "../src/grab.ts";
import { takeShot } from "../src/team/file.ts";

const face = () => { const got: any[] = []; return { got, send: (m: object) => got.push(m) }; };

test("the engine starts thinking Sol is visible; only a true hides it", () => {
  setSolHidden(false);
  assert.equal(solHidden(), false);
  setSolHidden("yes"); assert.equal(solHidden(), false);
  setSolHidden(true); assert.equal(solHidden(), true);
  setSolHidden(false);
});

test("hidden: the Sol room's asks answer the eye's words under their type and rid", async () => {
  setSolHidden(true);
  try {
    const w = face();
    await handleGrab(w, { type: "grab.sol.windows", rid: "r1" });
    await handleGrab(w, { type: "grab.sol.take", rid: "r2", id: 42 });
    assert.deepEqual(w.got, [{ type: "grab.sol.windows", rid: "r1", error: HIDDEN }, { type: "grab.sol.take", rid: "r2", error: HIDDEN }]);
    assert.equal(HIDDEN, "Sol is hidden: open the eye to grab it");
  } finally { setSolHidden(false); }
});

test("hidden: File it's shot is refused before any picture is taken", async () => {
  setSolHidden(true);
  try { await assert.rejects(takeShot("NoSuchOwner", "nothing"), (e: Error) => e.message === HIDDEN); }
  finally { setSolHidden(false); }
});
