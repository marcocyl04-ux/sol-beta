// Health (2026-10-16): four things the window shows as dots beside the engine's mark, gathered every five seconds.
//   kept     the engine runs under its keeper (engine/keep), so a build that dies at start cannot take Sol down
//   build    the tsc watcher that turns an edit into a build is alive (launchd's com.marco.sol-engine-build on the Mac,
//            a `tsc --watch` running in this folder elsewhere), and how many errors its last pass found; null where
//            no watcher belongs (the NucBox builds once at sol/promote)
//   face     the hot face answers on localhost:1420 (cold is not wrong: the window then runs its bundled build)
//   reverted the last time something was put back by itself: the keeper's last good build, or a face edit taken back
// Wrong, and red in the window, only when it really is: not kept, the watcher dead, or errors in the last build.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openSync, readSync, fstatSync, closeSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
export type Health = {
  kept: boolean;
  build: { alive: boolean; errors: number | null } | null;
  face: boolean;
  reverted: { what: "engine" | "face"; at: string; line?: string } | null;
};

let reverted: Health["reverted"] = null;
let now: Health | null = null;   // the last gathered, for whoever asks between changes (File it, #119)
export const healthNow = () => now;
export function noteRevert(what: "engine" | "face", at = new Date().toISOString(), line?: string) { reverted = { what, at, ...(line ? { line } : {}) }; }

// the keeper is the parent: bash running .../keep (launchd's plist on the Mac, the systemd unit on the NucBox)
async function isKept(): Promise<boolean> {
  try {
    const { stdout } = await run("ps", ["-o", "command=", "-p", String(process.ppid)], { timeout: 3000 });
    return /(^|[\s/])keep(\s|$)/.test(stdout.trim());
  } catch { return false; }
}

// the last "Found N errors" in the watcher's log (only the tail is read; the log grows all day)
function lastErrors(log: string): number | null {
  let fd: number | null = null;
  try {
    fd = openSync(log, "r");
    const size = fstatSync(fd).size, n = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, size - n);
    const all = [...buf.toString("utf8").matchAll(/Found (\d+) errors?\b/g)];
    return all.length ? Number(all[all.length - 1][1]) : null;
  } catch { return null; } finally { if (fd !== null) closeSync(fd); }
}

async function build(engineDir: string): Promise<Health["build"]> {
  if (process.platform === "darwin") {
    const uid = process.getuid?.() ?? 0;
    const alive = await run("launchctl", ["print", `gui/${uid}/com.marco.sol-engine-build`], { timeout: 3000 })
      .then(({ stdout }) => /^\s*state = running\b/m.test(stdout), () => false);
    return { alive, errors: lastErrors(join(homedir(), "Library", "Logs", "sol-engine-build.log")) };
  }
  // elsewhere: a tsc --watch whose folder is this engine's, if one runs at all
  const pids = await run("pgrep", ["-f", "typescript/bin/tsc --watch"], { timeout: 3000 }).then(({ stdout }) => stdout.split(/\s+/).filter(Boolean), () => []);
  const mine = pids.some((p) => { try { return readlinkSync(`/proc/${p}/cwd`) === engineDir; } catch { return false; } });
  return mine ? { alive: true, errors: null } : null;
}

async function face(): Promise<boolean> {
  try { return (await fetch("http://localhost:1420/", { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

// gathers now and every five seconds; `changed` hears each new state (and the first)
export function watchHealth(engineDir: string, changed: (h: Health) => void): () => Health {
  let last: Health = { kept: false, build: null, face: false, reverted };
  let said = "";
  let kept: Promise<boolean> | null = null;
  const gather = async () => {
    kept ??= isKept();   // the parent never changes while this engine runs
    const [k, b, f] = await Promise.all([kept, build(engineDir), face()]);
    last = { kept: k, build: b, face: f, reverted };
    now = last;
    const s = JSON.stringify(last);
    if (s !== said) { said = s; changed(last); }
  };
  void gather();
  setInterval(() => void gather().catch(() => {}), 5000).unref();
  return () => last;
}
