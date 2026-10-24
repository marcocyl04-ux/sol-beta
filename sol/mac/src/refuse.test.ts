// node --test src/*.test.ts (npm test here): a malformed own button never reaches the shelf or a press (#133, buttons/refuse.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { refuse } from "./buttons/refuse.ts";

const good = { id: "my-date", name: "date", says: "today's date, one press away", glyph: "date", meant: ["home"], kind: "press", press: () => {} };

test("a whole own button passes", () => {
  assert.equal(refuse(good, "my-date"), null);
  assert.equal(refuse({ ...good, kind: "pane", press: undefined, Pane: () => null }, "my-date"), null);
});

test("a kind that is not pane or press is refused, whatever else it carries", () => {
  assert.match(refuse({ ...good, kind: "drawer" }, "my-date")!, /^fields: its kind is pane or press/);
  assert.match(refuse({ ...good, kind: undefined }, "my-date")!, /^fields: its kind/);
});

test("meant holds only Sol's modes", () => {
  assert.match(refuse({ ...good, meant: "home" }, "my-date")!, /^fields: meant/);
  assert.match(refuse({ ...good, meant: ["home", "life"] }, "my-date")!, /^fields: meant/);
  assert.match(refuse({ ...good, meant: [1] }, "my-date")!, /^fields: meant/);
  assert.equal(refuse({ ...good, meant: [] }, "my-date"), null);
});

test("the rest of the contract still holds", () => {
  assert.match(refuse(undefined, "my-date")!, /^fields/);
  assert.match(refuse({ ...good, id: "my-other" }, "my-date")!, /^id/);
  assert.match(refuse({ ...good, id: "date" }, "date")!, /^id/);
  assert.match(refuse({ ...good, press: undefined }, "my-date")!, /a press needs press/);
});
