// Talk's attachments on the face (#315): the size a person reads, a name the engine takes, a drop's kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeLine, fitName, kindOfDrop, labelOf, Lru, Cursors, NAME_MAX } from "./cowork/attach.ts";

test("a size as a person reads it", () => {
  assert.equal(sizeLine(812), "812 B");
  assert.equal(sizeLine(34 * 1024 + 100), "34 KB");
  assert.equal(sizeLine(2.14 * 1024 * 1024), "2.1 MB");
  assert.equal(sizeLine(-1), "");
});

test("a name the engine takes: one line, no /, 100 characters with the extension kept", () => {
  assert.equal(fitName("plan.pdf"), "plan.pdf");
  assert.equal(fitName("a/b‮.png"), "a-b.png");
  assert.equal(fitName("  "), "file");
  const long = fitName(`${"x".repeat(150)}.pdf`);
  assert.equal(long.length, NAME_MAX);
  assert.ok(long.endsWith(".pdf"));
});

test("a dropped file is an image only when it is one of the four", () => {
  assert.equal(kindOfDrop("image/png"), "image");
  assert.equal(kindOfDrop("image/svg+xml"), "file");
  assert.equal(kindOfDrop("application/pdf"), "file");
});

test("a sent file is called by its name as a label, and the extension that counts is the path's (P1-3)", () => {
  assert.equal(labelOf({ name: "plan.pdf", path: ".sol/talk/l1.pdf" }), "plan.pdf");
  assert.equal(labelOf({ name: "invoice.pdf", path: ".sol/talk/l1.app" }), "invoice.pdf (.app)", "a name that says pdf for something else says so");
  assert.equal(labelOf({ name: "notes", path: ".sol/talk/l2.bin" }), "notes (.bin)");
});

test("thumbnails: the last 20 used are kept, and one let go is handed back to be freed (P2-7)", () => {
  const gone: number[] = [];
  const l = new Lru<number>(20, (v) => gone.push(v));
  for (let i = 0; i < 20; i++) l.set(`p${i}`, i);
  l.get("p0");   // used again: the newest
  l.set("p20", 20);
  assert.deepEqual(gone, [1], "the least used went, not the first");
  assert.equal(l.size, 20);
  assert.equal(l.get("p0"), 0);
});

test("a paging cursor is forgotten when its thread is read anew and when the group changes (second review, 4)", () => {
  const c = new Cursors();
  c.inRoom("a");
  const lines = [{ at: 5, id: "mine" }, { at: 9, id: "h1", heard: true as const }];
  assert.deepEqual(c.of("general", lines), { at: 9, id: "h1" }, "the oldest line the hub stamped");
  c.set("general", { at: 3, id: "x" });
  assert.deepEqual(c.of("general", lines), { at: 3, id: "x" });
  c.drop("general");
  assert.deepEqual(c.of("general", lines), { at: 9, id: "h1" }, "read anew: from the lines again");
  c.set("general", { at: 3, id: "x" });
  c.inRoom("b");
  assert.deepEqual(c.of("general", [{ at: 1, id: "y" }]), { at: 1, id: "" }, "another group: none of the first's");
  assert.equal(c.of("general", []), null);
});
