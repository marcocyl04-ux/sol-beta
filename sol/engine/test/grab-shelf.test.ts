// Grab and Shelf (#200): the shelf's pure parts (the name, the index read, the sweep's choice, a png's
// size), the shelf in a throwaway home (add, keep, delete, sweep, and the telling after each), the Sol-window filter
// given a made-up window list, and holdShot's slot. Nothing here takes a screenshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const shelf = await import("../src/shelf.ts");
const { solWindows, pageWindows, handleGrab } = await import("../src/grab.ts");
const { holdShot, heldShot, drop } = await import("../src/team/file.ts");
type Row = import("../src/shelf.ts").Row;

const NOW = new Date("2026-10-24T15:30:12.345Z");
const DAY = 24 * 60 * 60_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const row = (id: string, at: string, kept = false): Row => ({ id, kind: "shot", name: `${id}.png`, mime: "image/png", at, kept, file: `${id}.png` });
// a 3 x 2 png header (enough for pngSize)
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from("IHDR"), Buffer.from([0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0])]);

test("a shelf file's name: the stamp, the safe name, a clash numbered", () => {
  assert.equal(shelf.stampOf(NOW), "20261024-153012");
  assert.equal(shelf.shelfName("my shot.png", NOW), "20261024-153012-my shot.png");
  assert.equal(shelf.shelfName("../../etc/passwd", NOW), "20261024-153012-passwd");
  assert.equal(shelf.shelfName("a/b:c?.png", NOW), "20261024-153012-b_c_.png");
  assert.equal(shelf.shelfName("", NOW), "20261024-153012-file");
  const taken = new Set(["20261024-153012-x.png", "20261024-153012-x-2.png"]);
  assert.equal(shelf.shelfName("x.png", NOW, (n) => taken.has(n)), "20261024-153012-x-3.png");
});

test("the index reads its valid rows newest first; anything broken is an empty shelf", () => {
  assert.deepEqual(shelf.parseIndex("not json"), []);
  assert.deepEqual(shelf.parseIndex('{"id":"a"}'), []);
  const rows = shelf.parseIndex(JSON.stringify([
    row("old", ago(3)), row("new", ago(0), true),
    { id: "nofile", at: ago(1) }, { id: "bad-at", file: "x", at: "yesterday" },
    { ...row("escape", ago(1)), file: "../index.json" }, { ...row("hidden", ago(1)), file: ".x" },
    { id: "odd", file: "odd.bin", at: ago(2), kind: "weird", kept: "yes" },
  ]));
  assert.deepEqual(rows.map((r) => r.id), ["new", "odd", "old"]);
  assert.equal(rows[0].kept, true);
  assert.equal(rows[1].kind, "file");
  assert.equal(rows[1].kept, false);
  assert.equal(rows[1].mime, "application/octet-stream");
});

test("the sweep: older than seven days and not kept goes; kept stays however old", () => {
  const rows = [row("fresh", ago(1)), row("edge", ago(7)), row("old", ago(8)), row("kept", ago(30), true)];
  const { stay, go } = shelf.sweepChoice(rows, NOW);
  assert.deepEqual(go.map((r) => r.id), ["old"]);
  assert.deepEqual(stay.map((r) => r.id), ["fresh", "edge", "kept"]);
  assert.deepEqual(shelf.sweepChoice(rows, NOW, 2).go.map((r) => r.id), ["edge", "old"]);
});

test("a png's size from its header", () => {
  assert.deepEqual(shelf.pngSize(PNG), { w: 3, h: 2 });
  assert.equal(shelf.pngSize(Buffer.from("plain text, not a picture")), null);
});

test("the shelf in a home: add, keep, delete, sweep; every face told after each change", async () => {
  const home = mkdtempSync(join(tmpdir(), "sol-shelf-"));
  const told: number[] = [];
  shelf.setShelfHome(home, (abs) => `http://127.0.0.1:7777/file?path=${encodeURIComponent(abs)}`, (items) => told.push(items.length));
  try {
    const out: any[] = [];
    const face = { send: (m: object) => out.push(m) };
    await handleGrab(face, { type: "shelf.list", rid: 1 });
    assert.deepEqual(out.pop(), { type: "shelf.list", rid: 1, items: [] });

    const a = shelf.addToShelf([{ buf: PNG, name: "a.png", mime: "image/png" }], "shot", new Date(NOW.getTime() - 9 * DAY));
    assert.equal(a.fresh[0].kind, "shot");
    assert.equal(a.fresh[0].w, 3);
    assert.match(a.fresh[0].url, /^http:\/\/127\.0\.0\.1:7777\/file\?path=.*shelf.*20261015-153012-a\.png$/);
    assert.equal("file" in a.fresh[0], false);

    await handleGrab(face, { type: "shelf.add", rid: "r2", files: [{ name: "note.txt", mime: "text/plain", dataBase64: Buffer.from("hello").toString("base64") }] });
    const added = out.pop();
    assert.equal(added.type, "shelf.add");
    assert.equal(added.rid, "r2");
    assert.deepEqual(added.items.map((i: any) => i.name), ["note.txt", "a.png"]);   // the new one first
    assert.equal(added.items[0].kind, "file");
    const note = added.items[0].id;

    await handleGrab(face, { type: "shelf.keep", rid: 3, id: a.fresh[0].id, kept: true });
    assert.equal(out.pop().items.find((i: any) => i.name === "a.png").kept, true);
    assert.equal(shelf.sweepShelf(NOW), 0);   // nine days old, but kept

    await handleGrab(face, { type: "shelf.keep", rid: 4, id: a.fresh[0].id, kept: false });
    out.pop();
    assert.equal(shelf.sweepShelf(NOW), 1);   // let go: it leaves, file and row
    assert.deepEqual(shelf.listShelf().map((i) => i.name), ["note.txt"]);

    await handleGrab(face, { type: "shelf.delete", rid: 5, id: note });
    assert.deepEqual(out.pop(), { type: "shelf.delete", rid: 5, items: [] });
    assert.deepEqual(readdirSync(join(home, "shelf")), ["index.json"]);
    assert.deepEqual(JSON.parse(readFileSync(join(home, "shelf", "index.json"), "utf8")), []);

    await handleGrab(face, { type: "shelf.delete", rid: 6, id: "nope" });
    assert.deepEqual(out.pop(), { type: "shelf.delete", rid: 6, error: "that is not on the shelf" });
    await handleGrab(face, { type: "shelf.add", rid: 7, files: [] });
    assert.equal(out.pop().error, "nothing to put on the shelf");

    assert.deepEqual(told, [1, 2, 2, 2, 1, 0]);   // add, add, keep, keep, sweep, delete
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("grab.hold: the picture held for File it, and the shelf item's file replaced", async () => {
  const home = mkdtempSync(join(tmpdir(), "sol-shelf-"));
  shelf.setShelfHome(home, (abs) => abs, () => {});
  try {
    const it = shelf.putOnShelf(Buffer.from("before"), "x.png", "image/png", "sol", NOW);
    const out: any[] = [];
    await handleGrab({ send: (m) => out.push(m) }, { type: "grab.hold", rid: 9, id: it.id, image: { name: "x.png", mime: "image/png", dataBase64: "data:image/png;base64," + PNG.toString("base64") } });
    const ans = out.pop();
    assert.equal(ans.rid, 9);
    assert.match(ans.shot, /^[0-9a-f]{12}$/);
    assert.deepEqual(heldShot(ans.shot), PNG);
    assert.deepEqual(readFileSync(it.url), PNG);
    assert.equal(shelf.listShelf()[0].w, 3);
    // an id that is not on the shelf (swept meanwhile) still holds
    await handleGrab({ send: (m) => out.push(m) }, { type: "grab.hold", rid: 10, id: "gone", image: { name: "y.png", mime: "image/png", dataBase64: PNG.toString("base64") } });
    assert.ok(out.pop().shot);
    await handleGrab({ send: (m) => out.push(m) }, { type: "grab.hold", rid: 11 });
    assert.deepEqual(out.pop(), { type: "grab.hold", rid: 11, error: "no picture to hold" });
  } finally { drop(); rmSync(home, { recursive: true, force: true }); }
});

test("holdShot replaces the one held shot", () => {
  const a = holdShot(Buffer.from("first"));
  const b = holdShot(Buffer.from("second"));
  assert.equal(heldShot(a), null);
  assert.deepEqual(heldShot(b), Buffer.from("second"));
  assert.throws(() => holdShot(Buffer.alloc(0)), /no picture/);
  drop();
  assert.equal(heldShot(b), null);
});

test("Sol's windows: owner Sol, on screen, any layer, not the sheet, not the notch or island (their windows are larger than the slab)", () => {
  const b = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const got = solWindows([
    { id: 1, owner: "Sol", title: "Sol", layer: 0, onScreen: true, bounds: b(100, 80, 1200, 800) },
    { id: 2, owner: "Sol", title: "Sol notch", layer: 25, onScreen: true, bounds: b(600, 0, 300, 38) },
    { id: 3, owner: "Sol", title: "Sol island", layer: 3, onScreen: true, bounds: b(10, 10, 200, 60) },
    { id: 4, owner: "Sol", title: "Sol grab", layer: 3, onScreen: true, bounds: b(0, 0, 1512, 982) },
    { id: 5, owner: "Sol", title: "Sol", layer: 0, onScreen: false, bounds: b(0, 0, 800, 600) },
    { id: 6, owner: "Safari", title: "Sol", layer: 0, onScreen: true, bounds: b(0, 0, 800, 600) },
    { id: 7, owner: "Sol", title: "", layer: 0, onScreen: true, bounds: b(0, 0, 0, 0) },
    // a second Sol window put aside in Stage Manager's strip: its bounds are one of WindowManager's cells
    { id: 8, owner: "WindowManager", title: "Gesture Blocking Overlay", layer: 0, onScreen: true, bounds: b(15, 562, 159, 156) },
    { id: 9, owner: "Sol", title: "Sol", layer: 0, onScreen: true, bounds: b(15, 562, 159, 156) },
  ]);
  assert.deepEqual(got, [
    { id: 1, title: "Sol", x: 100, y: 80, w: 1200, h: 800, kind: "window", tucked: false },
    { id: 9, title: "Sol", x: 15, y: 562, w: 159, h: 156, kind: "window", tucked: true },
  ]);
  assert.deepEqual(solWindows(null as any), []);
});

test("Page's windows: every app's normal on-screen windows, front to back, not Sol's, not the sheet, not tiny", () => {
  const b = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const got = pageWindows([
    { id: 1, owner: "Safari", title: "Apple", layer: 0, onScreen: true, bounds: b(100, 80, 1200, 800) },
    { id: 2, owner: "Sol", title: "Sol", layer: 0, onScreen: true, bounds: b(0, 0, 800, 600) },
    { id: 3, owner: "Sol", title: "Sol grab", layer: 0, onScreen: true, bounds: b(0, 0, 1512, 982) },
    { id: 4, owner: "Finder", title: "", layer: 0, onScreen: true, bounds: b(40, 60, 700, 500) },
    { id: 5, owner: "Window Server", title: "Menubar", layer: 24, onScreen: true, bounds: b(0, 0, 1512, 37) },
    { id: 6, owner: "Notes", title: "Notes", layer: 0, onScreen: false, bounds: b(0, 0, 800, 600) },
    { id: 7, owner: "Safari", title: "", layer: 0, onScreen: true, bounds: b(0, 0, 40, 300) },
    { id: 8, owner: "Dock", title: "Dock", layer: 20, onScreen: true, bounds: b(0, 900, 1512, 80) },
    // Stage Manager's strip and the desktop sit at layer 0 like real windows: macOS's own furniture is never a page
    { id: 9, owner: "WindowManager", title: "App Icon Window", layer: 0, onScreen: true, bounds: b(20, 300, 160, 120) },
    { id: 10, owner: "WindowManager", title: "Gesture Blocking Overlay", layer: 0, onScreen: true, bounds: b(0, 280, 200, 160) },
    { id: 11, owner: "Wallpaper", title: "", layer: 0, onScreen: true, bounds: b(0, 0, 1512, 982) },
    // a window put aside in the strip shares its cell's bounds: listed, and marked tucked so its frame leans
    { id: 12, owner: "WeChat", title: "WeChat (Chats)", layer: 0, onScreen: true, bounds: b(0, 280, 200, 160) },
  ]);
  assert.deepEqual(got, [
    { id: 1, owner: "Safari", title: "Apple", x: 100, y: 80, w: 1200, h: 800, tucked: false },
    { id: 4, owner: "Finder", title: "", x: 40, y: 60, w: 700, h: 500, tucked: false },
    { id: 12, owner: "WeChat", title: "WeChat (Chats)", x: 0, y: 280, w: 200, h: 160, tucked: true },
  ]);
  assert.deepEqual(pageWindows(null as any), []);
});

test("an unknown grab ask is answered with an error, not silence", async () => {
  const out: any[] = [];
  await handleGrab({ send: (m) => out.push(m) }, { type: "grab.page", rid: "p" });
  assert.deepEqual(out, [{ type: "grab.page", rid: "p", error: "unknown ask grab.page" }]);
});

// ---- Page's stitcher (mac/src/grab/stitch.ts, pure): a made-up tall page, cut into screens the way a scroll would
const stitch = await import("../../mac/src/grab/stitch.ts");
/** a page of W x total pixels: every row its own colour, with flat empty bands here and there like a real page's margins */
function makePage(W: number, total: number, seed = 7) {
  const data = new Uint8Array(W * total * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 16) & 255;
  for (let y = 0; y < total; y++) {
    const empty = y % 50 < 12;   // a margin: one colour across
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = empty ? 240 : rnd(); data[i + 1] = empty ? 238 : rnd(); data[i + 2] = empty ? 230 : rnd(); data[i + 3] = 255;
    }
  }
  return data;
}
/** one screen: a fixed header (rows 0..head of `bar`), the page from `top`, a fixed footer */
function screen(page: Uint8Array, W: number, H: number, top: number, head: number, foot: number, bar: Uint8Array) {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const fromBar = y < head ? y : y >= H - foot ? head + (y - (H - foot)) : -1;
    const src = fromBar >= 0 ? bar.subarray(fromBar * W * 4, (fromBar + 1) * W * 4) : page.subarray((top + y) * W * 4, (top + y + 1) * W * 4);
    data.set(src, y * W * 4);
  }
  return { width: W, height: H, data };
}

test("the stitcher: a fixed header and footer found once, each scroll's shift found, the bottom stops it", () => {
  const W = 64, H = 200, head = 20, foot = 10, total = 520, step = 140;
  const page = makePage(W, total), bar = makePage(W, head + foot, 99);
  // the page scrolls `step` rows a time until the bottom: tops 0, 140, 280, 320 (the last one short), then still
  const maxTop = total - H;
  const tops = [0];
  while (tops[tops.length - 1] < maxTop) tops.push(Math.min(maxTop, tops[tops.length - 1] + step));
  tops.push(maxTop);   // one more take after the bottom: nothing moved
  const rows = tops.map((t) => stitch.rowsOf(screen(page, W, H, t, head, foot, bar)));
  assert.deepEqual(stitch.fixedBands(rows[0], rows[1]), { head, foot });
  const shifts: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const d = stitch.shiftOf(rows[i - 1], rows[i], head, foot, step);
    if (d <= 0) { assert.equal(d, 0, "the bottom reads as no movement"); break; }
    shifts.push(d);
  }
  assert.deepEqual(shifts, [140, 140, 40]);
  const segs = stitch.segments(H, foot, shifts);
  // the header, every page row the screens showed, the footer: once each, as tall as the page itself
  assert.equal(stitch.stitchedHeight(segs), total);
  assert.deepEqual(segs, [{ frame: 0, sy: 0, sh: 190 }, { frame: 1, sy: 50, sh: 140 }, { frame: 2, sy: 50, sh: 140 }, { frame: 3, sy: 150, sh: 40 }, { frame: 3, sy: 190, sh: 10 }]);
});

test("the stitcher: a fixed sidebar is found as columns and left out, so the shift is found again; the same picture twice reads as settled", () => {
  const W = 80, H = 200, side = 16, total = 520, step = 140;
  const page = makePage(W, total), bar = makePage(W, H, 5);   // `bar` lends its left `side` columns to every screen: the sidebar
  const withSide = (scr: { width: number; height: number; data: Uint8Array }) => {
    for (let y = 0; y < H; y++) scr.data.set(bar.subarray(y * W * 4, (y * W + side) * 4), y * W * 4);
    return scr;
  };
  const a = withSide(screen(page, W, H, 0, 0, 0, bar)), b = withSide(screen(page, W, H, step, 0, 0, bar));
  // whole rows: the sidebar is in every hash, so nothing lines up
  assert.equal(stitch.shiftOf(stitch.rowsOf(a), stitch.rowsOf(b), 0, 0, step), -1);
  const cols = stitch.fixedColumns(a, b);
  assert.deepEqual(cols, { left: side, right: 0 });
  const ra = stitch.rowsOf(a, cols.right, cols.left), rb = stitch.rowsOf(b, cols.right, cols.left);
  assert.deepEqual(stitch.fixedBands(ra, rb), { head: 0, foot: 0 });
  assert.equal(stitch.shiftOf(ra, rb, 0, 0, step), step);
  // the scroll bar's strip is counted into `right` and never looked at
  assert.deepEqual(stitch.fixedColumns(a, b, 6), { left: side, right: 6 });
  assert.equal(stitch.sameRows(ra, stitch.rowsOf(a, cols.right, cols.left)), true);
  assert.equal(stitch.sameRows(ra, rb), false);
});

test("the stitcher: a blank screen is seen, one screen alone is the whole picture, a changed page matches nothing", () => {
  const W = 32, H = 40;
  const black = { width: W, height: H, data: new Uint8Array(W * H * 4) };
  assert.equal(stitch.blank(stitch.rowsOf(black)), true);
  assert.equal(stitch.blank(stitch.rowsOf({ width: W, height: H, data: makePage(W, H) })), false);
  assert.deepEqual(stitch.segments(H, 0, []), [{ frame: 0, sy: 0, sh: H }]);
  const a = stitch.rowsOf({ width: W, height: H, data: makePage(W, H, 1) }), b = stitch.rowsOf({ width: W, height: H, data: makePage(W, H, 2) });
  assert.equal(stitch.shiftOf(a, b, 0, 0, 20), -1);
});
