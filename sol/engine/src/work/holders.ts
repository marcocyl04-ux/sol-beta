// Who holds a session right now. Every live Claude Code process (the desktop app's, a terminal's, an SDK run like
// Sol's own) registers itself in ~/.claude/sessions/<pid>.json; the CLI writes those, Sol only reads the .json ones
// (never the sibling .key files). One writer per transcript: a session held by a live process that is not one of
// this engine's own runs is "open elsewhere", and Work shows it read-only.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type Holder = {
  pid: number;
  who: "desktop" | "sol" | "sol-other" | "terminal" | "other";   // sol = this engine's own run
  status: string;        // busy | idle | waiting
  waitingFor?: string;
  name?: string;         // the holder's own title for it
  cwd?: string;          // the folder it runs in (a folder is not renamed under it, rename.ts)
  since: number;
};

const DIR = process.env.SOL_SESSIONS_DIR ?? join(homedir(), ".claude", "sessions");

// one ps call for all the pids the files name: alive, its parent, and its start (a reused pid starts later than the file says)
// null when ps itself failed: then nobody can say who holds what, and nothing is written
function procs(pids: number[]): Map<number, { ppid: number; start: number }> | null {
  const out = new Map<number, { ppid: number; start: number }>();
  if (!pids.length) return out;
  let txt: string;
  try {
    txt = execFileSync("ps", ["-o", "pid=,ppid=,lstart=", "-p", pids.join(",")], { encoding: "utf8", env: { ...process.env, TZ: "UTC" }, timeout: 3000 });
  } catch (err: any) {
    if (err?.status !== 1 || String(err?.stdout ?? "").trim()) return null;   // ps exits 1, quietly, when none of them live
    txt = "";
  }
  for (const line of txt.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) out.set(Number(m[1]), { ppid: Number(m[2]), start: Date.parse(m[3] + " UTC") });
  }
  return out;
}

const whoOf = (entry: string | undefined, ppid: number): Holder["who"] =>
  entry === "claude-desktop" ? "desktop"
  : entry === "sdk-ts" || entry === "sdk-py" ? (ppid === process.pid ? "sol" : "sol-other")
  : entry === "cli" ? "terminal" : "other";

let cache: { at: number; map: Map<string, Holder[]>; blind: boolean } | null = null;

// sessionId -> its live holders (normally one; two is the thing this module exists to prevent)
export function holders(): Map<string, Holder[]> {
  if (cache && Date.now() - cache.at < 1500) return cache.map;
  const rows: any[] = [];
  try {
    for (const f of readdirSync(DIR)) {
      if (!/^\d+\.json$/.test(f)) continue;
      try { rows.push(JSON.parse(readFileSync(join(DIR, f), "utf8"))); } catch { /* being rewritten */ }
    }
  } catch { /* no folder */ }
  const found = procs(rows.map((r) => Number(r.pid)).filter((p) => p > 0));
  const live = found ?? new Map();
  const map = new Map<string, Holder[]>();
  for (const r of rows) {
    const p = live.get(Number(r.pid));
    if (!p || !r.sessionId) continue;
    const said = r.procStart ? Date.parse(r.procStart + " UTC") : NaN;
    if (Number.isFinite(said) && Number.isFinite(p.start) && Math.abs(said - p.start) > 5000) continue;   // the pid was reused
    const h: Holder = {
      pid: Number(r.pid), who: whoOf(r.entrypoint, p.ppid), status: String(r.status ?? "idle"),
      ...(r.waitingFor ? { waitingFor: String(r.waitingFor) } : {}), ...(r.name ? { name: String(r.name) } : {}), ...(r.cwd ? { cwd: String(r.cwd) } : {}),
      since: Number(r.statusUpdatedAt ?? r.updatedAt ?? r.startedAt ?? 0),
    };
    map.set(r.sessionId, [...(map.get(r.sessionId) ?? []), h]);
  }
  cache = { at: Date.now(), map, blind: !found };
  return map;
}

// the holder that makes a session read-only here, if any: a live process that is not this engine's own run
// sure: read afresh, and refuse when the processes could not be looked at (before anything is written)
export function heldElsewhere(id: string, sure = false): Holder | undefined {
  if (sure) cache = null;
  const all = holders();
  if (sure && cache?.blind) throw new Error("can't tell whether another app has it open (ps failed): try again");
  const hs = (all.get(id) ?? []).filter((h) => h.who !== "sol");
  return hs.find((h) => h.who === "desktop") ?? hs[0];
}

export const HOLDER_NAME: Record<Holder["who"], string> = {
  desktop: "the Claude app", sol: "Sol", "sol-other": "another Sol", terminal: "a terminal", other: "another Claude",
};

export function invalidateHolders() { cache = null; }

// sessions a move (fold in, fork out) is writing to right now: no run starts on them meanwhile
export const moving = new Set<string>();

// a file changes when a holder starts, ends or turns busy; a process that dies without tidying up changes nothing,
// so the set is also looked at every 20 s
const sig = () => [...holders()].map(([id, hs]) => id + hs.map((h) => h.pid + h.status).join()).sort().join("|");
let watcher: FSWatcher | null = null;
export function watchHolders(changed: () => void) {
  if (watcher) return;
  let t: NodeJS.Timeout | undefined;
  let last = sig();
  setInterval(() => { cache = null; const now = sig(); if (now !== last) { last = now; changed(); } }, 20_000).unref();
  try {
    watcher = watch(DIR, (_e, name) => {
      if (name && !String(name).endsWith(".json")) return;
      clearTimeout(t);
      t = setTimeout(() => { cache = null; last = sig(); changed(); }, 500);
    });
  } catch { /* no folder yet */ }
}
