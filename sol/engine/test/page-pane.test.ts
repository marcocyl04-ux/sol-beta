import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetOf, assetPath } from "../src/work/page.js";

// The page pane (#54): a page's relative assets are served from beside it, and from nowhere else.
test("an asset url names the page's folder and the path under it", () => {
  const dir = "/Users/marco/computer/personal/projects/x/design";
  const at = assetOf(`/pane-asset/${encodeURIComponent(dir)}/img/a%20b.png?t=1`);
  assert.deepEqual(at, { dir, rel: "img/a b.png" });
  assert.equal(assetOf("/pane-asset/"), null);
  assert.equal(assetOf("/pane-asset/nope/a.png"), null);                   // the folder must be absolute
  assert.equal(assetOf(`/pane-asset/${encodeURIComponent(dir)}/`), null);  // no file asked
  assert.equal(assetOf("/pane-image?path=/x.png"), null);
});

test("only files below the page's folder are served, of the kinds a page uses", async () => {
  const root = mkdtempSync(join(tmpdir(), "sol-page-"));
  const page = join(root, "page"), out = join(root, "out");
  mkdirSync(join(page, "img"), { recursive: true }); mkdirSync(out);
  writeFileSync(join(page, "img", "a.png"), "png"); writeFileSync(join(page, "style.css"), "css");
  writeFileSync(join(page, "notes.secret"), "x"); writeFileSync(join(out, "key.png"), "png");
  symlinkSync(join(out, "key.png"), join(page, "link.png"));
  assert.equal((await assetPath(page, "img/a.png"))?.mime, "image/png");
  assert.equal((await assetPath(page, "style.css"))?.mime, "text/css; charset=utf-8");
  assert.equal(await assetPath(page, "notes.secret"), null);        // not a kind a page uses
  assert.equal(await assetPath(page, "../out/key.png"), null);      // outside the folder
  assert.equal(await assetPath(page, "link.png"), null);            // a link that leads outside
  assert.equal(await assetPath(page, "img"), null);                 // a folder
  assert.equal(await assetPath(page, "missing.png"), null);
});

// 2026-10-26: an asset asked for under the key the socket hands out needs no Referer; the folder is read past the key
import { PANE_KEY, keyedAsset } from "../src/work/page.js";
test("a keyed asset path is the key's and parses past it", () => {
  const p = `/pane-asset/k.${PANE_KEY}/${encodeURIComponent("/Users/x/look")}/atlas/a.png`;
  assert.equal(keyedAsset(p), true);
  assert.equal(keyedAsset(`/pane-asset/k.${"0".repeat(32)}/${encodeURIComponent("/Users/x/look")}/atlas/a.png`), PANE_KEY === "0".repeat(32));
  assert.deepEqual(assetOf(p), { dir: "/Users/x/look", rel: "atlas/a.png" });
  assert.deepEqual(assetOf(`/pane-asset/${encodeURIComponent("/Users/x/look")}/atlas/a.png`), { dir: "/Users/x/look", rel: "atlas/a.png" });
});
