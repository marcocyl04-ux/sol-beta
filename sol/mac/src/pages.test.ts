// node --test src/*.test.ts (npm test here): the pages of the face are one list, vite.config.ts build.rollupOptions.input.
// A page left out of it is not built, and Tauri answers a missing page with index.html, so a window meant for a small
// page (the vibe glow, vibe.rs) would wear the whole face instead (#191's screen glow did, 2026-10-26 to 10-29: a
// compiled vite.config.js, which Vite reads before vite.config.ts, was committed without the vibe page). So: every
// .html beside vite.config.ts is an input unless its title says "(dev)" (gallery.html, ship.html: the scratch Vite
// only), and every input exists; every page a window is built with (WebviewUrl::App in src-tauri) is an input; and no
// compiled copy of the config sits beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const mac = resolve(import.meta.dirname, "..");
const config = readFileSync(join(mac, "vite.config.ts"), "utf8");
const inputs = (() => {
  const m = /rollupOptions:\s*\{\s*input:\s*\{([^}]*)\}/.exec(config);
  assert.ok(m, "vite.config.ts has build.rollupOptions.input");
  return [...m[1].matchAll(/"([^"]+\.html)"/g)].map((x) => x[1]).sort();
})();

test("every page beside vite.config.ts is a Vite input unless its title says (dev), and every input is a page that exists", () => {
  const dev = (f: string) => /<title>[^<]*\(dev\)<\/title>/.test(readFileSync(join(mac, f), "utf8"));
  const pages = readdirSync(mac).filter((f) => f.endsWith(".html") && !dev(f)).sort();
  assert.deepEqual(inputs, pages);
  for (const p of inputs) assert.ok(existsSync(join(mac, p)), `${p} exists`);
});

test("every page the shell opens a window with (WebviewUrl::App) is a Vite input", () => {
  const rs = join(mac, "src-tauri", "src");
  const files = readdirSync(rs).filter((f) => f.endsWith(".rs"));
  const asked = new Set<string>();
  for (const f of files) for (const m of readFileSync(join(rs, f), "utf8").matchAll(/WebviewUrl::App\("([^"]+\.html)"/g)) asked.add(m[1]);
  assert.ok(asked.size >= 2, "the notch and the glow ask for their pages");
  for (const p of asked) assert.ok(inputs.includes(p), `${p} is in vite.config.ts build.rollupOptions.input`);
});

test("no compiled copy of the Vite config sits beside vite.config.ts (Vite would read it first)", () => {
  for (const f of ["vite.config.js", "vite.config.mjs", "vite.config.cjs", "vite.config.d.ts"]) assert.ok(!existsSync(join(mac, f)), `${f} is not there`);
  const ignore = readFileSync(join(mac, ".gitignore"), "utf8");
  assert.ok(/^vite\.config\.js$/m.test(ignore) && /^vite\.config\.d\.ts$/m.test(ignore), ".gitignore keeps a compiled copy out of git");
  // a referenced project may not disable emit (TS6310), so tsc -b writes the config's js under node_modules, never beside it
  const node = JSON.parse(readFileSync(join(mac, "tsconfig.node.json"), "utf8"));
  assert.ok(String(node.compilerOptions.outDir).startsWith("./node_modules/"), "tsconfig.node.json writes under node_modules");
});
