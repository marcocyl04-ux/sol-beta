// Who is on the team (#102, docs/how-we-work/PRD.md section 9; PROTOCOL.md round 26): membership is derived, never a
// list kept by hand. When team.json names an `org`, the team is the org's members (`gh api orgs/<org>/members`, read at
// most every 10 minutes); adding a person is one click on GitHub and they appear in Cowork with no hand-off. While `org`
// is "", the team is the logins this engine has seen on the relay. Cowork reads it as `members` in team.state.
import { execFile } from "node:child_process";
import { getTeam } from "./settings.js";

const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const TTL = 10 * 60_000;

export type MembersDeps = { gh: (args: string[]) => Promise<string>; org: () => string; seen: () => string[]; now: () => number };

const ghCli = (args: string[]) => new Promise<string>((ok, no) =>
  execFile("gh", args, { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => (err ? no(err) : ok(String(out)))));

/** the logins in gh's `--jq '.[].login'` output (pure) */
export const loginsOf = (out: string) => [...new Set(out.split(/\s+/).filter((l) => LOGIN.test(l)))].sort((a, b) => a.localeCompare(b));

export function membersOf(d: MembersDeps) {
  let cache: { org: string; list: string[]; at: number } | null = null;
  let reading: Promise<string[]> | null = null;
  const subs = new Set<(list: string[]) => void>();
  /** read the org's members again when the cache is older than 10 minutes (one read at a time) */
  const refresh = (force = false): Promise<string[]> => {
    const org = d.org();
    if (!org) return Promise.resolve(now());
    if (!force && cache && cache.org === org && d.now() - cache.at < TTL) return Promise.resolve(cache.list);
    reading ??= d.gh(["api", `orgs/${org}/members`, "--paginate", "--jq", ".[].login"]).then((out) => {
      const list = loginsOf(out), was = cache?.list.join(",");
      cache = { org, list, at: d.now() };
      if (was !== list.join(",")) for (const f of subs) f(list);
      return list;
    }).catch(() => cache?.org === org ? cache.list : []).finally(() => { reading = null; });
    return reading;
  };
  /** the team as known now: the org's members (last read), else the logins seen on the relay */
  const now = (): string[] => {
    const org = d.org();
    if (org) { if (!cache || cache.org !== org || d.now() - cache.at >= TTL) void refresh(); return cache?.org === org ? cache.list : []; }
    return loginsOf(d.seen().join(" "));
  };
  return { now, refresh, onChange: (f: (list: string[]) => void) => { subs.add(f); return () => { subs.delete(f); }; } };
}

// this engine's: the org from team.json, the seen logins handed in by relay.ts (setSeen), gh's own sign-in
let seenNow: () => string[] = () => [];
export const setSeen = (f: () => string[]) => { seenNow = f; };
const mine = membersOf({ gh: ghCli, org: () => getTeam().org, seen: () => seenNow(), now: Date.now });
/** the team's logins: the org's members when an org is set, else who has been seen on the relay */
export const teamMembers = () => mine.now();
export const refreshMembers = (force = false) => mine.refresh(force);
export const onMembers = (f: (list: string[]) => void) => mine.onChange(f);
