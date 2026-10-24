// Side copies (git worktrees) for Work sessions: a session that should not touch Marco's real folder gets its own copy
// of the repo, on a branch <prefix><name> cut from where the folder stands. By default the copy sits inside the repo at
// <repo>/.claude/worktrees/<name>; the work drawer can put them all under one folder instead (<dir>/<repo name>/<name>).
// Sol notes every copy it makes (state.ts copies), so the side files it under its repo wherever it lives. Merging back
// is the session's own work (git in the copy), as in the Claude app. The side-copies drawer lists them and removes the
// stale ones: nothing uncommitted, nothing the base lacks, no session working in it.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { homedir } from "node:os";
import { prefs, copies, noteCopy } from "./state.js";

const run = promisify(execFile);
const git = (cwd: string, args: string[]) => run("git", args, { cwd, timeout: 30_000 }).then((r) => r.stdout.trim());
const WT = /^(.*?)\/\.claude\/worktrees\/[^/]+/;
const inside = (p: string, dir: string) => p === dir || p.startsWith(dir + "/");

// a short name from the first words of what the session is for, made unique
export function copyName(hint: string) {
  const words = hint.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((x) => x.length > 1).slice(0, 3);
  return `${words.join("-").slice(0, 28).replace(/-+$/, "") || "session"}-${randomBytes(3).toString("hex")}`;
}

// the main checkout a folder belongs to (a copy of a copy is cut beside it, from its branch)
async function repoOf(root: string) {
  const common = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).catch(() => "");
  return common.endsWith("/.git") ? dirname(common) : WT.exec(root)?.[1] ?? root;
}

// the repo a session's folder is a side copy of, if it is one (sessions.ts files it under that repo)
export function copyOf(cwd: string): { repo: string; name: string } | null {
  for (const [at, repo] of Object.entries(copies())) if (inside(cwd, at)) return { repo, name: basename(at) };
  const w = /^(.*?)\/\.claude\/worktrees\/([^/]+)/.exec(cwd);
  return w ? { repo: w[1], name: w[2] } : null;
}

// the copy's folder for a session that would start in `cwd` (a subfolder of the repo stays the same subfolder)
export async function makeCopy(cwd: string, hint: string): Promise<{ cwd: string; branch: string }> {
  let root: string;
  try { root = await git(cwd, ["rev-parse", "--show-toplevel"]); } catch { throw new Error("a side copy needs a git folder; this one is not"); }
  const repo = await repoOf(root);
  const p = prefs();
  const name = copyName(hint);
  const at = p.wtDir ? join(p.wtDir, basename(repo), name) : join(repo, ".claude", "worktrees", name);
  const branch = `${p.prefix}${name}`;
  if (p.wtDir) mkdirSync(dirname(at), { recursive: true });
  await git(root, ["worktree", "add", "-b", branch, at, "HEAD"]).catch((err) => {
    throw new Error("git could not make the side copy: " + String(err?.stderr || err?.message || err).trim().split("\n")[0]);
  });
  noteCopy(at, repo);
  const sub = relative(root, cwd);
  return { cwd: sub && !sub.startsWith("..") ? join(at, sub) : at, branch };
}

export type Copy = {
  path: string; repo: string; branch?: string; kb?: number; dirty: number; ahead?: number; base?: string;
  sessions: number; usedAt?: number; live: boolean; gone?: boolean;
  stale?: boolean;     // as below, worked out here so the face does not guess
  foreign?: boolean;   // not made by Sol (the Claude app's, a terminal's): listed, removed only one by one, asked twice
};

const du = (p: string) => run("du", ["-sk", p], { timeout: 30_000 }).then((r) => Number(r.stdout.split(/\s/)[0]) || 0).catch(() => undefined);

// every side copy of the repos Sol knows: the ones it made, and any under a known repo's .claude/worktrees
export async function listCopies(projects: string[], sessions: { cwd: string; updatedAt: number }[], live: string[]) {
  const p = prefs();
  const repos = new Set([...Object.values(copies()), ...projects.filter((x) => existsSync(join(x, ".claude", "worktrees")))]);
  const out: Copy[] = [];
  await Promise.all([...repos].map(async (repo) => {
    if (!existsSync(repo)) return;
    const base = await git(repo, ["symbolic-ref", "--short", "HEAD"]).catch(() => "HEAD");
    const raw = await git(repo, ["worktree", "list", "--porcelain"]).catch(() => "");
    for (const block of raw.split("\n\n")) {
      const path = /^worktree (.+)$/m.exec(block)?.[1];
      if (!path || path === repo) continue;
      const made = copies()[path] === repo;
      if (!made && !inside(path, join(repo, ".claude", "worktrees")) && !(p.wtDir && inside(path, p.wtDir))) continue;
      const gone = /^prunable/m.test(block) || !existsSync(path);
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
      const used = sessions.filter((s) => inside(s.cwd, path));
      const c: Copy = { path, repo, branch, base, dirty: 0, sessions: used.length, live: live.some((x) => inside(x, path)), ...(gone ? { gone: true } : {}), ...(made ? {} : { foreign: true }) };
      if (used.length) c.usedAt = Math.max(...used.map((s) => s.updatedAt));
      if (!gone) {
        const [st, ahead, kb] = await Promise.all([
          git(path, ["status", "--porcelain"]).catch(() => ""),
          git(path, ["rev-list", "--count", `${base}..HEAD`]).catch(() => ""),
          du(path),
        ]);
        c.dirty = st ? st.split("\n").length : 0;
        if (ahead !== "") c.ahead = Number(ahead);
        c.kb = kb;
      }
      c.stale = stale(c);
      out.push(c);
    }
  }));
  out.sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0));
  const [transcripts] = await Promise.all([du(join(homedir(), ".claude", "projects"))]);
  return { copies: out, where: p.wtDir || "", kb: out.reduce((n, c) => n + (c.kb ?? 0), 0), transcripts };
}

// stale: Sol made it, nothing uncommitted, nothing its base lacks, no session running in it nor touched in the last
// hour (another app's session may be at work there unseen), or its folder already gone
const HOUR = 3_600_000;
export const stale = (c: Copy) => !c.live && !c.foreign && (c.gone || (c.dirty === 0 && c.ahead === 0 && Date.now() - (c.usedAt ?? 0) > HOUR));

// a copy goes: its folder (git worktree remove, never --force) and, when the base has every commit of it, its branch
// (-d, never -D). Uncommitted work is never removed, asked twice or not; `force` only lets a clean copy go that is
// recent, or whose branch has commits (the branch then stays). Whether a session works in it is asked again here,
// after the slow listing, through `liveNow`.
export async function removeCopy(c: Copy, liveNow: (path: string) => boolean, force = false): Promise<string> {
  if (c.live || liveNow(c.path)) throw new Error("a session is working in it; stop it first");
  if (!c.gone) {
    const st = await git(c.path, ["status", "--porcelain"]).catch(() => "?");
    if (st) throw new Error("it has uncommitted changes; commit or drop them in the copy first");
  }
  if (!force && !stale(c)) throw new Error("its branch has commits the base lacks, or it was used in the last hour");
  if (c.gone) await git(c.repo, ["worktree", "prune"]);
  else await git(c.repo, ["worktree", "remove", c.path]).catch((err) => {
    throw new Error("git could not remove it: " + String(err?.stderr || err?.message || err).trim().split("\n")[0]);
  });
  noteCopy(c.path, null);
  if (c.branch && c.ahead === 0 && !c.foreign) { await git(c.repo, ["branch", "-d", c.branch]).catch(() => {}); return "removed, branch too"; }
  return c.branch ? `removed; branch ${c.branch} kept` : "removed";
}
