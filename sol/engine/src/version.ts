// What this Sol runs (#417, part of #413): the release it sits on plus its own layer, for example "release
// stable-20261030-0900 + 12 of mine" or "main 0c02970c, 3 behind". Read from git with a handful of cheap calls (no
// fetch: the refs are as fresh as the last update or fetch), in the background after start, kept, and read again after
// an update run and every ten minutes. Said in /health, on the relay's hello and presence, and to the faces (team.state).
//
// The base is whichever of stable and main (origin's first, then the local branch) has the fewest of HEAD's commits
// outside it; a tie goes to stable. On main that is main itself (none of mine); on a */mine branch rebased onto stable
// it is stable, and its commits over stable are mine. The release is a release tag on the base's commit
// (stable-*, dev-*, beta-*, release-*), or, in a tester's clone of the beta repo, the "Sol stable-..." its main's
// export commit says; else the branch's own name.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SolVersion } from "./hub/index.js";

export type { SolVersion };
const run = promisify(execFile);
const BASES = ["refs/remotes/origin/stable", "refs/heads/stable", "refs/remotes/origin/main", "refs/heads/main"];
const TAG = /^(stable|dev|beta|release)-[\w.-]+$/;

type Git = (args: string[]) => Promise<string>;
const gitIn = (cwd: string): Git => (args) => run("git", args, { cwd, timeout: 5000 }).then((r) => r.stdout.trim());

/** the version of the checkout at `cwd`, or null when it is not a git checkout or has neither stable nor main */
export async function computeVersion(cwd: string, git: Git = gitIn(cwd)): Promise<SolVersion | null> {
  const head = await git(["rev-parse", "--verify", "-q", "HEAD"]).catch(() => "");
  if (!head) return null;
  let best: { ref: string; ahead: number } | null = null;
  for (const ref of BASES) {
    if (!(await git(["rev-parse", "--verify", "-q", ref]).catch(() => ""))) continue;
    const ahead = Number(await git(["rev-list", "--count", `${ref}..HEAD`]).catch(() => "NaN"));
    if (Number.isFinite(ahead) && (!best || ahead < best.ahead)) best = { ref, ahead };
  }
  if (!best) return null;
  const at = await git(["merge-base", "HEAD", best.ref]).catch(() => "");
  if (!at) return null;
  const behind = Number(await git(["rev-list", "--count", `HEAD..${best.ref}`]).catch(() => "0")) || 0;
  const tags = (await git(["tag", "--points-at", at]).catch(() => "")).split("\n").map((t) => t.trim()).filter((t) => TAG.test(t)).sort().reverse();
  let release = tags[0] ?? "";
  if (!release) {
    const subject = await git(["log", "-1", "--format=%s", at]).catch(() => "");
    const m = /^Sol ((?:stable|dev|beta)-[\w.-]+)/.exec(subject);
    release = m && TAG.test(m[1]) ? m[1] : best.ref.split("/").pop()!;
  }
  return { release: release.slice(0, 60), commit: at.slice(0, 8), ...(behind > 0 ? { behind } : {}), ...(best.ahead > 0 ? { mine: best.ahead } : {}) };
}

/** the words for a version (pure): "release stable-20261030-0900 + 12 of mine", "main 0c02970c, 3 behind"; none: "unknown" */
export function versionLine(v: SolVersion | null | undefined): string {
  if (!v) return "unknown";
  const base = TAG.test(v.release) ? `release ${v.release}` : `${v.release} ${v.commit}`;
  return `${base}${v.mine ? ` + ${v.mine} of mine` : ""}${v.behind ? `, ${v.behind} behind` : ""}`;
}

// ---- the engine's one ----
let now: SolVersion | null = null;
let dir = "";
let reading: Promise<void> | null = null;
const heard = new Set<(v: SolVersion | null) => void>();
export const versionNow = () => now;
/** told each time the version read differs from the last (the relay's presence, the faces) */
export const onVersion = (fn: (v: SolVersion | null) => void) => { heard.add(fn); return () => heard.delete(fn); };

/** read it again now (after an update run); a read already going is joined, never doubled */
export function refreshVersion(): Promise<void> {
  if (!dir) return Promise.resolve();
  reading ??= computeVersion(dir).catch(() => null).then((v) => {
    const changed = JSON.stringify(v) !== JSON.stringify(now);
    now = v;
    if (changed) for (const fn of heard) { try { fn(v); } catch { /* a listener's own trouble */ } }
  }).finally(() => { reading = null; });
  return reading;
}

/** start reading the checkout this engine runs from: never blocks the start, then every ten minutes */
export function watchVersion(engineDir: string, every = 10 * 60_000) {
  if (dir) return;
  dir = engineDir;
  setTimeout(() => void refreshVersion(), 0).unref?.();
  setInterval(() => void refreshVersion(), every).unref();
}
