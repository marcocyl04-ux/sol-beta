// node --test src/*.test.ts (npm test here): two parts of the face never share a style name by accident (#145).
// Every class is global, so a class that is one part's own sized box (worn alone, with a bare rule that sets its size or
// layout) lands that size on anything else that wears it. That squashed the PR ticket (.bad, the 6px warning dot) and
// drew "show to team" as the Show pane's tall box (.wshow), #143. A box worn as a modifier outside its own file, on an
// element that is already sized by its own class, is refused here unless the pair is listed as meant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// pairs meant to share a base, one a variant sized on purpose on top of the other (names in alphabetical order)
const MEANT = new Set([
  "pane+wpane", "tabs+ttabs", "row+woask", "wdiff+wdlines", "wlink+wopen", "cstage+page-in", "desk-stage+stage",
  "cpage+cshared",
  "me+msg",   // away.css's .me is the Away page's own line; that page never draws a chat message
]);

const root = new URL(".", import.meta.url).pathname;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(root);
const LAYOUT = /\b(width|height|display|position|padding|margin|flex|inset)\s*:/;

// a bare one-class rule that sizes or lays out: ".bad { width: 6px }", not ".wticket.bad i" or "i.bad"
const sized = new Map<string, string>();
for (const f of files.filter((f) => f.endsWith(".css"))) {
  const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!LAYOUT.test(m[2])) continue;
    for (const sel of m[1].split(",")) {
      const b = sel.trim().match(/^\.([\w-]+)(?::[\w-]+(?:\([^)]*\))?)*$/);
      if (b && !sized.has(b[1])) sized.set(b[1], relative(root, f));
    }
  }
}

// the class words one element can wear: its strings, and the strings inside its ${…} that are not compared against
const words = (expr: string): string[] => {
  const out: string[] = [];
  for (const m of expr.matchAll(/([=!]==?\s*)?(?:"([^"]*)"|'([^']*)'|`((?:[^`\\]|\\.)*)`)/g)) {
    if (m[1]) continue;
    if (m[4] !== undefined) {
      out.push(...m[4].replace(/\$\{[^}]*\}/g, " ").split(/\s+/));
      for (const inner of m[4].matchAll(/\$\{([^}]*)\}/g)) out.push(...words(inner[1]));
    } else out.push(...(m[2] ?? m[3]).split(/\s+/));
  }
  return [...new Set(out.filter((t) => /^[a-z][\w-]*$/.test(t)))];
};

test("a part's own box is not worn by another part", () => {
  const alone = new Map<string, string>(), worn: { w: string[]; at: string }[] = [];
  for (const f of files.filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))) {
    const at = relative(root, f);
    for (const line of readFileSync(f, "utf8").split("\n")) {
      for (const m of line.matchAll(/className=("[^"]*"|\{`(?:[^`\\]|\\.)*`\}|\{[^}]*\})|look:\s*[^=]*=>\s*(.*)|classList\.(?:toggle|add)\(("[^"]*")/g)) {
        const w = words(m[1] ?? m[2] ?? m[3]).filter((t) => sized.has(t));
        if (w.length === 1 && m[1]?.startsWith('"') && !alone.has(w[0])) alone.set(w[0], at);
        if (w.length >= 2) worn.push({ w, at });
      }
    }
  }
  const clash = new Set<string>();
  for (const { w, at } of worn) for (const box of w) {
    const home = alone.get(box);
    if (!home || home === at) continue;
    for (const o of w) if (o !== box && !MEANT.has([box, o].sort().join("+")))
      clash.add(`.${box} (its own box in ${home}, sized in ${sized.get(box)}) is worn with .${o} in ${at}`);
  }
  assert.deepEqual([...clash], [], "give the one that is not the box its own name (or, if the pair is meant, add it to MEANT)");
});
