// The files a session's folder holds, for the box's @ mention: git's list in a repo (tracked and untracked, ignores
// honoured), else a short walk. Kept 20 s per folder, so typing after @ asks the disk once. Any real folder: a
// session can work anywhere, and only the owner's faces reach the engine.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const run = promisify(execFile);
const SKIP = new Set(["node_modules", "dist", "build", "target", "__pycache__", "Library"]);
const cache = new Map<string, { at: number; paths: string[] }>();

export const isFolder = (p: string) => { try { return existsSync(p) && statSync(p).isDirectory(); } catch { return false; } };
export function folderOf(cwd: unknown): string | null {
  const home = homedir();
  const p = resolve(String(cwd ?? "").replace(/^~(?=\/|$)/, home) || home);
  return isFolder(p) ? p : null;
}

// a breadth-first walk: hidden folders and build output skipped, at most 4000 entries, 6 deep
function walk(root: string): string[] {
  const out: string[] = [];
  let level = [""];
  for (let depth = 0; depth < 6 && level.length && out.length < 4000; depth++) {
    const next: string[] = [];
    for (const rel of level) {
      let names: import("node:fs").Dirent[];
      try { names = readdirSync(join(root, rel), { withFileTypes: true }); } catch { continue; }
      for (const d of names) {
        if (d.name.startsWith(".") || SKIP.has(d.name)) continue;
        const p = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) { out.push(p + "/"); next.push(p); } else out.push(p);
        if (out.length >= 4000) break;
      }
    }
    level = next;
  }
  return out;
}

async function paths(cwd: string): Promise<string[]> {
  const c = cache.get(cwd);
  if (c && Date.now() - c.at < 20_000) return c.paths;
  let list: string[];
  try {
    const { stdout } = await run("git", ["ls-files", "-z", "-co", "--exclude-standard"], { cwd, maxBuffer: 64 << 20, timeout: 5000 });
    const files = stdout.split("\0").filter(Boolean).slice(0, 50_000);
    const dirs = new Set<string>();
    for (const f of files) for (let i = f.indexOf("/"); i > 0; i = f.indexOf("/", i + 1)) dirs.add(f.slice(0, i + 1));
    list = [...dirs, ...files];
  } catch { list = walk(cwd); }
  cache.set(cwd, { at: Date.now(), paths: list });
  return list;
}

// every file under the folder (git's list when it is a repo), for the show's map: files only, at most 4000, asked
// fresh (the map asks again because files came or went)
export async function tree(cwd: string): Promise<string[]> {
  cache.delete(cwd);
  return (await paths(cwd)).filter((p) => !p.endsWith("/")).slice(0, 4000);
}

// the best 30 for what is typed after @: the name starting with it, then containing it, then the path containing
// it, then its letters in order; shorter paths first within each
export async function fileHits(cwd: string, q: string): Promise<string[]> {
  const all = await paths(cwd);
  const s = q.toLowerCase();
  if (!s) return all.filter((p) => !p.slice(0, -1).includes("/")).sort((a, b) => a.length - b.length).slice(0, 30);
  const loose = new RegExp(s.split("").map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
  const scored: [number, string][] = [];
  for (const p of all) {
    const l = p.toLowerCase(), name = l.replace(/\/$/, "").split("/").pop()!;
    const sc = name.startsWith(s) ? 0 : name.includes(s) ? 1 : l.includes(s) ? 2 : loose.test(l) ? 3 : -1;
    if (sc >= 0) scored.push([sc, p]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length).slice(0, 30).map((x) => x[1]);
}

// the @ mentions in a message that name a real file or folder under the session's folder, as absolute paths
export function mentioned(text: string, cwd: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)@(?:"([^"]+)"|([^\s"]+))/g)) {
    const raw = m[1] ?? m[2].replace(/[.,;:!?)]+$/, "");   // a quoted path is kept as typed
    const abs = resolve(cwd, raw.replace(/^~(?=\/|$)/, homedir()));
    if (existsSync(abs)) out.add(abs);
  }
  return [...out];
}
