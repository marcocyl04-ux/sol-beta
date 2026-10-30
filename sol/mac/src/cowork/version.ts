// What each Sol runs (#417): the release it sits on plus its own layer, as the roster says it (the engine's
// src/version.ts reads it from git; the hub carries it on the hello and each presence). A Sol older than #417 says
// nothing, and is "unknown". Pure, so node --test reads it (src/version.test.ts).

export type SolVersion = { release: string; commit: string; behind?: number; mine?: number };
const TAG = /^(stable|dev|beta|release)-[\w.-]+$/;

/** the whole line: "release stable-20261030-0900 + 12 of mine", "main 0c02970c, 3 behind"; none: "unknown" */
export function versionLine(v: SolVersion | null | undefined): string {
  if (!v) return "unknown";
  const base = TAG.test(v.release) ? `release ${v.release}` : `${v.release} ${v.commit}`;
  return `${base}${v.mine ? ` + ${v.mine} of mine` : ""}${v.behind ? `, ${v.behind} behind` : ""}`;
}

/** the strip's short word, small under a name: "1030-0900 +12", "main 0c02970c −3"; none: "unknown" */
export function versionShort(v: SolVersion | null | undefined): string {
  if (!v) return "unknown";
  const m = /^(?:stable|dev|beta|release)-\d{4}(\d{4})-(\d{4})$/.exec(v.release);
  const base = m ? `${v.release.split("-")[0]} ${m[1]}-${m[2]}` : TAG.test(v.release) ? v.release : `${v.release} ${v.commit}`;
  return `${base}${v.mine ? ` +${v.mine}` : ""}${v.behind ? ` −${v.behind}` : ""}`;
}

/** whether two Sols sit on the same release (their own layers aside): the strip marks the ones on mine */
export const sameRelease = (a: SolVersion | null | undefined, b: SolVersion | null | undefined) => !!a && !!b && a.commit === b.commit;
