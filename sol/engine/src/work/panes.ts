// What Work's panes ask the engine for (PROTOCOL.md round 11): a folder's changes (git), a file to read or save, the
// branch's pull request (gh), and terminals (a pty each). Panes ask with a rid and the answer goes to that face only;
// a terminal's output goes to every face, so a pane opened on another face (or after a reload) picks it up.
import { execFile } from "node:child_process";
import { join as joinBusy } from "../busy.js";
import { promisify } from "node:util";
import { chmodSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";

const run = promisify(execFile);
const git = (cwd: string, args: string[]) => run("git", args, { cwd, maxBuffer: 64 << 20, timeout: 15_000 }).then((r) => r.stdout);

// ---- changes ----
// scope: "all" = the branch against where it left main (committed and not), "uncommitted" = against the last commit,
// with new files, "last" = the last commit alone
export type DiffFile = { path: string; old?: string; status: "added" | "deleted" | "modified" | "renamed"; add: number; del: number; patch: string; binary?: boolean };

async function baseOf(cwd: string) {
  for (const ref of ["origin/HEAD", "origin/main", "main", "origin/master", "master"]) {
    try { const b = (await git(cwd, ["merge-base", "HEAD", ref])).trim(); if (b) return b; } catch { /* next */ }
  }
  return "HEAD";
}

// git quotes a path with odd characters ("a/caf\303\251.txt"): back to the name
function unq(p: string | undefined) {
  if (!p || !p.startsWith('"')) return p;
  const bytes: number[] = [];
  const s = p.slice(1, -1);
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") { bytes.push(...Buffer.from(s[i])); continue; }
    const n = s[++i];
    if (/[0-7]/.test(n)) { bytes.push(parseInt(s.slice(i, i + 3), 8)); i += 2; }
    else bytes.push(({ n: 10, t: 9, r: 13, '"': 34, "\\": 92 } as Record<string, number>)[n] ?? n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString("utf8");
}
const side = (p: string | undefined) => unq(p)?.replace(/^[ab]\//, "");

function split(patch: string): DiffFile[] {
  const out: DiffFile[] = [];
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git")) continue;
    const head = /^diff --git ("?a\/.+?"?) ("?b\/.+"?)$/m.exec(chunk);
    const to = side(/^\+\+\+ ("?b\/.+"?)$/m.exec(chunk)?.[1]) ?? side(head?.[2]) ?? "?";
    const from = side(/^--- ("?a\/.+"?)$/m.exec(chunk)?.[1]) ?? side(head?.[1]);
    const status = /^new file mode/m.test(chunk) ? "added" : /^deleted file mode/m.test(chunk) ? "deleted" : /^rename from/m.test(chunk) ? "renamed" : "modified";
    const body = chunk.slice(chunk.search(/^@@/m) >= 0 ? chunk.search(/^@@/m) : chunk.length);
    let add = 0, del = 0;
    for (const l of body.split("\n")) { if (l.startsWith("+")) add++; else if (l.startsWith("-")) del++; }
    out.push({ path: status === "deleted" ? (from ?? to) : to, ...(status === "renamed" && from ? { old: from } : {}), status, add, del, patch: body.slice(0, 400_000), ...(/^Binary files/m.test(chunk) ? { binary: true } : {}) });
  }
  return out;
}

export async function changes(cwd: string, scope: string) {
  try { await git(cwd, ["rev-parse", "--is-inside-work-tree"]); } catch { return { notGit: true, files: [] as DiffFile[] }; }
  // paths come back from the repository's top (a session can sit in a subfolder), with root to resolve them
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  const flags = ["--no-color", "--no-ext-diff", "-M", "-U3"];
  let files: DiffFile[];
  let base: string | undefined;
  if (scope === "last") files = split(await git(cwd, ["-c", "core.quotePath=false", "show", ...flags, "--format=", "HEAD"]).catch(() => ""));
  else {
    base = scope === "all" ? await baseOf(cwd) : "HEAD";
    files = split(await git(cwd, ["-c", "core.quotePath=false", "diff", ...flags, base]).catch(() => ""));
    // new files git does not track yet: all lines in
    const untracked = (await git(cwd, ["ls-files", "-z", "-o", "--exclude-standard", "--full-name"]).catch(() => "")).split("\0").filter(Boolean).slice(0, 200);
    for (const p of untracked) {
      let text = "";
      try { const st = statSync(join(root, p)); if (st.size > 512_000) { files.push({ path: p, status: "added", add: 0, del: 0, patch: "", binary: true }); continue; } text = readFileSync(join(root, p), "utf8"); } catch { continue; }
      if (text.includes("\0")) { files.push({ path: p, status: "added", add: 0, del: 0, patch: "", binary: true }); continue; }
      const lines = text.replace(/\n$/, "").split("\n");
      files.push({ path: p, status: "added", add: lines.length, del: 0, patch: `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => "+" + l).join("\n") });
    }
  }
  const branch = (await git(cwd, ["branch", "--show-current"]).catch(() => "")).trim();
  return { files, root, base, branch, add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0) };
}

// ---- files ----
// a path as the face names it: relative to the session's folder, ~ for home
export const pathIn = (cwd: string, p: unknown) => resolve(cwd, String(p ?? "").replace(/^~(?=\/|$)/, homedir()));

export const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]);
export function readText(abs: string) {
  const st = statSync(abs);
  if (st.isDirectory()) return { dir: true, entries: readdirSync(abs, { withFileTypes: true }).filter((d) => !d.name.startsWith(".")).map((d) => d.name + (d.isDirectory() ? "/" : "")).sort().slice(0, 500) };
  // an image is shown as one (the face asks GET /pane-image for its bytes), not read as text; sheets of shots run
  // past the 2 MB text cap (Marco, 2026-10-18: "too big to display")
  if (IMAGE.has(extname(abs).toLowerCase()) && st.size <= 40_000_000) return { image: true, size: st.size, mtime: st.mtimeMs };
  if (st.size > 2_000_000) return { tooBig: true, size: st.size };
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return { binary: true, size: st.size };
  return { text: buf.toString("utf8"), mtime: st.mtimeMs, size: st.size, hash: hashOf(buf) };
}
const hashOf = (b: Buffer | string) => createHash("sha1").update(b).digest("hex");

// a save over a file changed (or removed) since the pane read it says so instead: the pane sends the hash it read
export function writeText(abs: string, text: string, hash?: string) {
  if (hash !== undefined && (!existsSync(abs) || hashOf(readFileSync(abs)) !== hash)) return { changed: true };
  writeFileSync(abs, text);
  return { ok: true, mtime: statSync(abs).mtimeMs, hash: hashOf(text) };
}

// ---- the pull request ----
export async function pullRequest(cwd: string) {
  const fields = "number,title,state,url,body,isDraft,headRefName,baseRefName,mergeable,additions,deletions,statusCheckRollup,comments,reviews,reviewDecision";
  try {
    const { stdout } = await run("gh", ["pr", "view", "--json", fields], { cwd, timeout: 20_000, maxBuffer: 16 << 20 });
    return { pr: JSON.parse(stdout) };
  } catch (e: any) {
    const msg = String(e?.stderr || e?.message || e);
    if (/no pull requests found/i.test(msg)) return { none: true };
    if (e?.code === "ENOENT") return { error: "gh is not installed on the engine's machine" };
    return { error: msg.split("\n")[0].slice(0, 300) };
  }
}

// ---- terminals ----
type Pty = { write(d: string): void; resize(c: number, r: number): void; kill(): void; onData(f: (d: string) => void): void; onExit(f: (e: { exitCode: number }) => void): void; pid: number };
type Term = { tid: string; cwd: string; title: string; pty: Pty; buf: string; seq: number; alive: boolean; code?: number; at: number };
const terms = new Map<string, Term>();
const KEEP = 200_000;   // the scrollback a pane gets when it opens on a running terminal

let ptyMod: { spawn: (f: string, a: string[], o: object) => Pty } | null | undefined;
function loadPty() {
  if (ptyMod !== undefined) return ptyMod;
  try {
    const req = createRequire(import.meta.url);
    const mod = req("node-pty");
    // the prebuilt helper ships without its run bit (node-pty 1.1); without it every spawn fails
    try {
      const dir = join(dirname(req.resolve("node-pty/package.json")), "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
      if (existsSync(dir) && !(statSync(dir).mode & 0o111)) chmodSync(dir, 0o755);
    } catch { /* built from source: fine */ }
    ptyMod = mod;
  } catch { ptyMod = null; }
  return ptyMod;
}

export const termInfo = (t: Term) => ({ tid: t.tid, cwd: t.cwd, title: t.title, alive: t.alive, code: t.code, at: t.at });
export const allTerms = () => [...terms.values()].map(termInfo);

export function openTerm(cwd: string, cols: number, rows: number, out: (m: object) => void) {
  const pty = loadPty();
  if (!pty) throw new Error("the terminal needs node-pty in the engine (npm install in sol/engine)");
  const shell = process.env.SHELL || (existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash");   // no zsh on Linux and WSL (#22)
  const p = pty.spawn(shell, ["-l"], { name: "xterm-256color", cwd, cols: Math.max(20, cols | 0) || 80, rows: Math.max(5, rows | 0) || 24, env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } });
  const t: Term = { tid: randomUUID().slice(0, 8), cwd, title: shell.split("/").pop()!, pty: p, buf: "", seq: 0, alive: true, at: Date.now() };
  terms.set(t.tid, t);
  const leave = joinBusy("term", t.tid, shell.split("/").pop());   // a terminal holds the engine's renew while it runs
  // each chunk numbered: a pane attaching gets the buffer up to seq, then only chunks after it
  p.onData((d) => { t.buf = (t.buf + d).slice(-KEEP); out({ type: "work.term.out", tid: t.tid, data: d, seq: ++t.seq }); });
  p.onExit(({ exitCode }) => { leave(); t.alive = false; t.code = exitCode; out({ type: "work.term.exit", tid: t.tid, code: exitCode }); });
  return t;
}
export const getTerm = (tid: unknown) => terms.get(String(tid ?? ""));
export function closeTerm(tid: unknown) {
  const t = getTerm(tid);
  if (!t) return false;
  if (t.alive) { try { t.pty.kill(); } catch { /* gone */ } }
  terms.delete(t.tid);
  return true;
}
