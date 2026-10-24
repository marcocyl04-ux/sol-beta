// Renaming a folder from the side renames the real folder on the disk (#181). Claude Code, Codex, Finder and the
// terminal all see the new name; there is no second name that lives only in Sol. Everything keyed by the folder's path
// follows it, the way sol/mine/live --rename did it once for ecosystem → sol (#129):
//   1. the folder itself (a case-only rename goes through a temp name, for case-insensitive disks)
//   2. Claude's folders under ~/.claude/projects, keyed by the path with every non-alphanumeric a "-": the new key gets a
//      link to the old folder, which stays where it is (Marco's are Syncthing folders, and older moves are links too)
//   3. ~/.claude.json: its `projects` keys that are the folder or under it, rewritten, nothing else touched
//   4. git: a repo's side copies (worktrees) and a side copy's own link to its repo, repaired (a failure is said, not fatal)
//   5. work.json, through state.ts (folderMoved): every path Sol keeps, and `moved` old → new, so the old transcripts
//      (which still say the old place) file under the new folder and resume there
//   6. the files that still say the old path (inside the folder, and the launchd jobs) are listed; none is changed
// Refused before anything moves, with one plain line the window shows: a bad or taken name, a folder that is not on this
// disk, one where something runs, one Sol itself runs from, the home folder, a folder that holds other listed folders.
import { execFile } from "node:child_process";
import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, symlinkSync, writeFileSync, type Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { slug } from "./sessions.js";
import { twinIn } from "../home.js";

export type RenameDeps = {
  home: string;                                     // the person's home: ~/.claude, ~/.claude.json, ~/Library/LaunchAgents
  solRoots: string[];                               // where Sol runs from: its checkout, its home (sol/home), the window's checkout
  known: string[];                                  // the folders the side lists
  liveIn: (path: string) => string | undefined;     // what runs in the folder or under it, in words ("\"fix the build\"", "a terminal")
  elsewhere?: (path: string) => string | undefined; // the machine a folder that is not here lives on ("the NucBox")
  moved: (from: string, to: string) => void;        // work.json's own writer (state.ts folderMoved)
  at?: (p: string) => string;                       // where a recorded path is now, by the moves so far (sessions.ts relocated)
  rename?: (from: string, to: string) => void;      // the move on the disk (fs.renameSync)
  git?: (cwd: string, args: string[]) => Promise<string>;
  scanMs?: number;                                  // how long the look for the old path may take
};
export type Renamed =
  | { ok: true; from: string; to: string; sessions?: number; mentions: string[]; mentioned: number; notes: string[] }
  | { error: string };

const run = promisify(execFile);
const gitRun = (cwd: string, args: string[]) => run("git", args, { cwd, timeout: 15_000 }).then((r) => r.stdout);
const under = (p: string, d: string) => p === d || p.startsWith(d === "/" ? "/" : d + "/");
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
const lstat = (p: string): Stats | undefined => { try { return lstatSync(p); } catch { return undefined; } };
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0];

// where this engine runs from: its checkout (src/work or dist/work, four up) and its home (index.ts reads the same
// SOL_HOME, else the checkout's sol/home)
export const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const SOL_HOME = process.env.SOL_HOME ?? join(ENGINE_ROOT, "sol", "home");

// the checkout the window (Sol.app) was built from: its build path is in the face binary, as sol/mine/live reads it.
// Kept by the binary's time, so a new build is read again
let windowSeen: { at: number; root?: string } | null = null;
export function windowRoot(app = process.env.SOL_APP ?? "/Applications/Sol.app"): string | undefined {
  const bin = join(app, "Contents", "MacOS", "face");
  let at: number;
  try { at = statSync(bin).mtimeMs; } catch { return undefined; }
  if (windowSeen?.at === at) return windowSeen.root;
  let root: string | undefined;
  try { root = /(\/[^\0\s"']+?)\/sol\/mac\/src-tauri/.exec(readFileSync(bin).toString("latin1"))?.[1]; } catch { /* unreadable */ }
  windowSeen = { at, root };
  return root;
}

/** the name is one folder name: not empty, not . or .., no / (pure) */
export function badName(name: string): string | undefined {
  if (!name) return "the name is empty";
  if (name === "." || name === "..") return `"${name}" can't be a folder's name`;
  if (name.includes("/") || name.includes("\0")) return "a folder's name can't have / in it";
  if (Buffer.byteLength(name) > 255) return "that name is too long for a folder";
  return undefined;
}

/** why this folder can't be renamed to that name right now, or nothing; no change made (pure but for reading the disk) */
export function refusal(path: string, name: string, d: RenameDeps): string | undefined {
  const x = basename(path) || path;
  const bad = badName(name);
  if (bad) return bad;
  if (!path.startsWith("/")) return "that is not a folder on this disk";
  if (name === x) return `${x} already has that name`;
  if (!isDir(path)) {
    const there = d.elsewhere?.(path);
    return there ? `${x} is on ${there}; rename it there` : `${x} is not on this disk`;
  }
  const home = real(d.home), p = real(path);
  if (p === "/" || under(home, p)) return `${x} ${p === home ? "is your home folder" : "holds your home folder"}; rename it from Terminal`;
  for (const r of d.solRoots) if (r && (under(real(r), p) || under(p, real(r)))) return `Sol runs from ${x}; rename it from Terminal`;
  const inside = new Set(d.known.filter((k) => k !== path && under(k, path)));
  if (inside.size) return `${x} holds ${inside.size} ${inside.size === 1 ? "project" : "projects"}; rename it from Terminal`;
  const live = d.liveIn(path);
  if (live) return `${live} is running in ${x}; rename when it stops`;
  const to = join(dirname(path), name);
  const t = lstat(to);
  if (t && !(to.toLowerCase() === path.toLowerCase() && t.ino === lstat(path)?.ino)) return `a folder named ${name} is already there`;
  return undefined;
}

let busy = false;
export async function renameFolder(path: string, newName: string, d: RenameDeps): Promise<Renamed> {
  const from = String(path ?? "").replace(/(.)\/+$/, "$1"), name = String(newName ?? "").trim();
  const no = refusal(from, name, d);
  if (no) return { error: no };
  if (busy) return { error: "another folder is being renamed: a moment" };
  busy = true;
  try { return await move(from, join(dirname(from), name), d); } finally { busy = false; }
}

async function move(from: string, to: string, d: RenameDeps): Promise<Renamed> {
  const mv = d.rename ?? renameSync, notes: string[] = [];
  // 1. the folder
  try {
    if (from.toLowerCase() === to.toLowerCase()) {   // only the case changes: the disk may think they are one name
      const tmp = `${from}.sol-rename-${process.pid}-${Date.now().toString(36)}`;
      mv(from, tmp); mv(tmp, to);
    } else mv(from, to);
  } catch (e) { return { error: `the folder could not be renamed: ${errText(e)}` }; }
  // 2–4: each says what it did; none of them undoes the move
  notes.push(...claudeLinks(from, to, d.home, d.at ?? ((p) => p)));
  notes.push(...claudeJson(from, to, d.home));
  notes.push(...(await repairGit(from, to, d.git ?? gitRun)));
  // 5. Sol's own notebook
  d.moved(from, to);
  // 6. what still says the old place
  const found = mentions(from, to, d.home, d.scanMs ?? 1500);
  return { ok: true, from, to, mentions: found.paths, mentioned: found.count, notes };
}

// 2. ~/.claude/projects: the folder's own key and those of folders under it (and of side copies inside it) get a link at
// the new key. A key only starts like the old one when it may be a sibling's (sol-x next to sol): a transcript's cwd
// says which (through the moves so far: after a → b → c, b's keys are links to a's, whose transcripts say a); with none
// to read, a sibling folder of that name says it is not ours. A link points at the folder itself, never at another link
function claudeLinks(from: string, to: string, home: string, at: (p: string) => string): string[] {
  const dir = join(home, ".claude", "projects"), so = slug(from), sn = slug(to);
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const siblings = (() => {
    try { return readdirSync(dirname(to)).filter((n) => n !== basename(to)).map((n) => slug(join(dirname(from), n))).filter((s) => s !== so && s.startsWith(so + "-")); }
    catch { return []; }
  })();
  let linked = 0, kept = 0;
  for (const n of names) {
    if (n !== so && !n.startsWith(so + "-")) continue;
    if (n !== so) {
      const cwd = cwdIn(join(dir, n));
      const ours = (c: string) => [c, twinIn(c, home)].some((x) => under(x, from) || under(at(x), from));
      if (cwd !== undefined ? !ours(cwd) : siblings.some((s) => n === s || n.startsWith(s + "-"))) continue;
    }
    const t = join(dir, sn + n.slice(so.length)), src = join(dir, n);
    if (lstat(t)) { kept++; continue; }
    try { symlinkSync(lstat(src)?.isSymbolicLink() ? resolve(dir, readlinkSync(src)) : src, t); linked++; } catch { kept++; }
  }
  const out: string[] = [];
  if (linked) out.push(`${linked} Claude ${linked === 1 ? "folder" : "folders"} under ~/.claude/projects linked under the new name`);
  if (kept) out.push(`${kept} under ~/.claude/projects already had the new name and ${kept === 1 ? "was" : "were"} left as ${kept === 1 ? "it was" : "they were"}`);
  return out;
}
// the cwd a transcript in a Claude folder says (the first that says one, in the first few files)
function cwdIn(dir: string): string | undefined {
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).slice(0, 4); } catch { return undefined; }
  for (const f of files) {
    const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head(join(dir, f), 64 * 1024));
    if (m) try { return JSON.parse(`"${m[1]}"`); } catch { /* next */ }
  }
  return undefined;
}
function head(file: string, bytes: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const b = Buffer.alloc(bytes);
    return b.subarray(0, readSync(fd, b, 0, bytes, 0)).toString("utf8");
  } catch { return ""; } finally { if (fd !== undefined) closeSync(fd); }
}

// 3. ~/.claude.json: only the `projects` keys that are the folder or under it; written whole to a temp file, then moved
// over the old one, keeping its mode (it is private)
function claudeJson(from: string, to: string, home: string): string[] {
  const file = join(home, ".claude.json");
  let text: string, mode: number;
  try { text = readFileSync(file, "utf8"); mode = statSync(file).mode & 0o777; } catch { return []; }
  let j: any;
  try { j = JSON.parse(text); } catch { return ["~/.claude.json could not be read, so it still says the old place"]; }
  const ps = j?.projects;
  if (!ps || typeof ps !== "object" || Array.isArray(ps)) return [];
  let n = 0;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ps)) {
    if (under(k, from)) { out[to + k.slice(from.length)] = v; n++; }
    else if (!(k in out)) out[k] = v;   // a moved key wins over a stale one already at the new place
  }
  if (!n) return [];
  j.projects = out;
  const tmp = `${file}.sol-rename-${process.pid}`;
  try { writeFileSync(tmp, JSON.stringify(j, null, 2), { mode }); renameSync(tmp, file); }
  catch (e) { return [`~/.claude.json could not be written (${errText(e)}), so it still says the old place`]; }
  return [`${n} ${n === 1 ? "entry" : "entries"} in ~/.claude.json now say the new place`];
}

// 4. git: a repo that moved tells git where its side copies are now (those inside it moved with it, the ones outside
// point back at it); a side copy that moved tells its repo; a side copy inside the folder of another repo the same
async function repairGit(from: string, to: string, git: (cwd: string, args: string[]) => Promise<string>): Promise<string[]> {
  const out: string[] = [];
  const dotgit = join(to, ".git"), kind = lstat(dotgit);
  const tryRepair = async (cwd: string, paths: string[], what: string) => {
    try { await git(cwd, ["worktree", "repair", ...paths]); return true; }
    catch (e) { out.push(`git could not repair ${what} (${errText(e)}); run: git -C "${cwd}" worktree repair ${paths.map((p) => `"${p}"`).join(" ")}`.trim()); return false; }
  };
  const done = new Set<string>();
  if (kind?.isDirectory()) {   // a repo: its side copies, where they are now
    const copies: string[] = [];
    try {
      for (const w of readdirSync(join(dotgit, "worktrees"))) {
        // <copy>/.git; git may keep it relative to its own place (worktree.useRelativePaths), which was under the old path
        const g = resolve(join(from, ".git", "worktrees", w), readFileSync(join(dotgit, "worktrees", w, "gitdir"), "utf8").trim());
        const at = under(g, from) ? to + g.slice(from.length) : g;
        if (isDir(dirname(at))) copies.push(dirname(at));
      }
    } catch { /* no side copies */ }
    if (copies.length && (await tryRepair(to, copies, "the side copies"))) out.push(`git knows where ${copies.length} side ${copies.length === 1 ? "copy is" : "copies are"} now`);
    for (const c of copies) done.add(c);
  } else if (kind?.isFile()) {   // a side copy itself: its repo learns the new place
    if (await tryRepair(to, [], "the link to its repo")) out.push("git knows the side copy's new place");
    done.add(to);
  }
  // side copies inside the folder that belong to another repo
  try {
    for (const w of readdirSync(join(to, ".claude", "worktrees"))) {
      const c = join(to, ".claude", "worktrees", w);
      if (done.has(c) || !lstat(join(c, ".git"))?.isFile()) continue;
      await tryRepair(c, [], `the side copy ${w}`);
    }
  } catch { /* none */ }
  return out;
}

// 6. text files that still say the old path: inside the folder (not .git, node_modules, side copies, nor big or binary
// files), and the launchd jobs. Read only, within a time cap
function mentions(from: string, to: string, home: string, ms: number): { paths: string[]; count: number } {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const forms = [from, ...(under(from, home) && from !== home ? ["~" + from.slice(home.length)] : [])];
  const re = new RegExp(`(?:${forms.map(esc).join("|")})(?![A-Za-z0-9_-])`);
  const until = Date.now() + ms, paths: string[] = [];
  let count = 0, seen = 0;
  const look = (f: string, size: number) => {
    if (size > 1_000_000 || size === 0) return;
    let b: Buffer;
    try { b = readFileSync(f); } catch { return; }
    if (b.subarray(0, 8000).includes(0)) return;
    if (re.test(b.toString("utf8"))) { count++; if (paths.length < 50) paths.push(f); }
  };
  const stack = [to];
  while (stack.length && Date.now() < until && seen < 50_000) {
    const dir = stack.pop()!;
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === "node_modules" || (e.name === "worktrees" && basename(dir) === ".claude")) continue;
        stack.push(p);
      } else if (e.isFile()) { seen++; try { look(p, statSync(p).size); } catch { /* gone */ } }
    }
  }
  const la = join(home, "Library", "LaunchAgents");
  try { for (const n of readdirSync(la)) if (n.endsWith(".plist")) { const p = join(la, n); try { look(p, statSync(p).size); } catch { /* broken link */ } } } catch { /* none */ }
  return { paths, count };
}
