// The Mine card (#76): for a folder whose checkout is on a `*/mine` branch (MY SOL, `marco/mine`), how many of his own
// commits sit over stable and what they say (at most 8). The base is stable, or origin's stable when the local one is
// behind it (as sol/mine/rebase does). Asked lazily with the list, kept 60 s a folder; any other folder has none.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

export type Mine = { base: string; count: number; subjects: string[] };
const run = promisify(execFile);
const git = (cwd: string, args: string[]) => run("git", args, { cwd, timeout: 5000 }).then((r) => r.stdout.trim());
const ok = (cwd: string, args: string[]) => git(cwd, args).then(() => true, () => false);

async function compute(path: string): Promise<Mine | undefined> {
  if (!existsSync(path)) return undefined;
  const branch = await git(path, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => "");
  if (!/\/mine$/.test(branch)) return undefined;
  const local = await ok(path, ["rev-parse", "--verify", "-q", "refs/heads/stable"]);
  const remote = await ok(path, ["rev-parse", "--verify", "-q", "refs/remotes/origin/stable"]);
  const base = local && remote && (await ok(path, ["merge-base", "--is-ancestor", "stable", "origin/stable"])) ? "origin/stable"
    : local ? "stable" : remote ? "origin/stable" : null;
  if (!base) return undefined;
  const count = Number(await git(path, ["rev-list", "--count", `${base}..HEAD`]).catch(() => "NaN"));
  if (!Number.isFinite(count)) return undefined;
  const subjects = count ? (await git(path, ["log", "-8", "--format=%s", `${base}..HEAD`]).catch(() => "")).split("\n").filter(Boolean) : [];
  return { base, count, subjects };
}

const kept = new Map<string, { at: number; v: Promise<Mine | undefined> }>();
export function mineOf(path: string, now = Date.now()): Promise<Mine | undefined> {
  const k = kept.get(path);
  if (k && now - k.at < 60_000) return k.v;
  const v = compute(path).catch(() => undefined);
  kept.set(path, { at: now, v });
  return v;
}
export const forgetMine = () => kept.clear();

/** the list's folders, a MY SOL checkout's with its card on it */
export async function withMine<P extends { path: string }>(projects: P[]): Promise<(P & { mine?: Mine })[]> {
  return Promise.all(projects.map(async (p) => { const m = await mineOf(p.path); return m ? { ...p, mine: m } : p; }));
}
