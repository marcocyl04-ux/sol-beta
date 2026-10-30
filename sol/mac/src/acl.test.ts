// node --test src/*.test.ts (npm test here): the app's own commands and the ACL that lets the pages call them
// (src-tauri/build.rs, capabilities/). A command left out of build.rs's list is refused in the bundled app with
// "Command … not allowed by ACL", while `tauri dev` may still look fine: on 29 Oct the first run's install, its
// Claude sign-in and "open Sol" were all refused that way on a tester's Mac.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const tauri = join(here, "../src-tauri");
const read = (p: string) => readFileSync(p, "utf8");

const registered = (() => {
  const body = read(join(tauri, "src/lib.rs")).match(/generate_handler!\[([\s\S]*?)\]/)?.[1] ?? "";
  return body.split(",").map((s) => s.trim().split("::").pop()!).filter((s) => /^[a-z_]+$/.test(s));
})();
const manifest = (() => {
  const body = read(join(tauri, "build.rs")).match(/const COMMANDS[^=]*=\s*&\[([\s\S]*?)\];/)?.[1] ?? "";
  return [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
})();
const bundledAllows = new Set(readdirSync(join(tauri, "capabilities")).filter((f) => f.endsWith(".json") && !f.endsWith("-hot.json"))
  .flatMap((f) => (JSON.parse(read(join(tauri, "capabilities", f))).permissions as unknown[]).filter((p): p is string => typeof p === "string")));
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
});
const invoked = new Set(files(here).flatMap((p) => [...read(p).matchAll(/invoke(?:<[^>]*>)?\(\s*"([a-z_]+)"/g)].map((m) => m[1])));

test("the lists are read at all", () => {
  assert.ok(registered.length > 20 && manifest.length > 20 && invoked.size > 10);
});

test("every command the app registers is in build.rs's manifest", () => {
  assert.deepEqual(registered.filter((c) => !manifest.includes(c)), []);
});

test("every command a page calls is allowed by a bundled capability", () => {
  const mine = new Set(registered);
  assert.deepEqual([...invoked].filter((c) => mine.has(c) && !bundledAllows.has(`allow-${c.replace(/_/g, "-")}`)), []);
});
