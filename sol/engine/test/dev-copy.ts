// A tester's copy is the beta export (src/team/ship.ts BETA_KEEP): what Sol runs, and none of the dev's door. A test
// that reads one of the dev's files (sol/promote, .github/CODEOWNERS, sol/mine/live, sol/buttons/check, sol/hub) has
// nothing to read there, and a failure would tell the tester something is wrong with their Mac when nothing is (#300).
// Such a test skips there and says why. In a dev checkout every file is there and nothing is skipped.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..", "..", "..");
/** node:test's skip option: false in a dev checkout, the reason on a tester's copy */
export function devOnly(...files: string[]): string | false {
  const missing = files.filter((f) => !existsSync(join(ROOT, f)));
  return missing.length ? `reads ${missing.join(", ")}: the dev's, not in a tester's copy (#300)` : false;
}
