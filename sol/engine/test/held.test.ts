// Messages said while the main thread works (#51): kept by the run, handed in at the turn's end in order, or early.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Held } from "../src/work/turns.ts";

const m = (uuid: string) => ({ uuid, text: `say ${uuid}` });

test("held messages come out in the order they were said, once", () => {
  const h = new Held<{ uuid: string; text: string }>();
  h.keep(m("a")); h.keep(m("b")); h.keep(m("c"));
  assert.equal(h.size, 3);
  assert.deepEqual(h.release().map((x) => x.uuid), ["a", "b", "c"]);
  assert.equal(h.size, 0);
  assert.deepEqual(h.release(), []);
});

test("read now or drop takes one out early; the rest keep their order; an unknown id takes nothing", () => {
  const h = new Held<{ uuid: string; text: string }>();
  h.keep(m("a")); h.keep(m("b")); h.keep(m("c"));
  assert.equal(h.take("b")?.uuid, "b");
  assert.equal(h.take("b"), undefined);
  assert.equal(h.take("zz"), undefined);
  assert.deepEqual(h.release().map((x) => x.uuid), ["a", "c"]);
});
