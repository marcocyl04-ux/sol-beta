// The fence (inventory.ts): the files a seat never writes, and (#16 blocker 5) everything those files import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fenced } from "../src/inventory.ts";

const SOL = resolve(import.meta.dirname, "..", "..");
const HOME = join(SOL, "home");
const SRC = join(SOL, "mac", "src");

test("the fence holds the boundaries, the pages that mount them, the message builders, the ring and the loop", () => {
  for (const f of ["Site.tsx", "renovation.ts", "sites.ts", "hot.ts", "main.tsx", "notch/main.tsx", "creature/ring.ts", "creature/loop.ts", "creature/states.ts", "useEngine.ts", "socket.ts"]) assert.equal(fenced(HOME, join(SRC, f)), true, f);
  assert.equal(fenced(HOME, join(SRC, "App.tsx")), false);
  assert.equal(fenced(HOME, join(SRC, "creature/Space.tsx")), false);
});

test("the fence imports nothing a seat may edit (static imports, followed through)", () => {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^import\s[^'"]*["'](\.[^'"]+)["']/gm)) {
      const base = resolve(dirname(file), m[1]);
      const cand = [base, base + ".ts", base + ".tsx", join(base, "index.ts")].find((c) => { try { return statSync(c).isFile(); } catch { return false; } });
      if (!cand || cand.endsWith(".css")) continue;
      assert.equal(fenced(HOME, cand), true, `${file.slice(SRC.length + 1)} imports ${cand.slice(SRC.length + 1)}, which a seat may edit`);
      walk(cand);
    }
  };
  for (const f of ["Site.tsx", "renovation.ts", "socket.ts", "sites.ts", "hot.ts", "main.tsx", "notch/main.tsx"]) walk(join(SRC, f));
  assert.ok(readdirSync(SRC).length > 0);
});
