// Ship (#33, design/together/3-ship/PRD.md, PROTOCOL.md round 19): stamp stable from Sol, one stable back, and every
// Sol offered the update.
//
// stamp: refused, with the reason, on a dirty tree, off main, with main not pushed, or when the build is not green (the
// engine by the keeper's record when it has one for this commit, else a type-check; the face always by a type-check).
// Then an annotated tag stable-<yyyymmdd-hhmm>, the branch stable moved to HEAD, both pushed in one atomic push (put
// back locally if GitHub refuses), a signed line on the record (a comment on the issue wearing `now`, else a commit
// status), and `stable { sha, tag, by }` on the relay. A human's hand stamps: the button is the human, so `by` is the
// login, never "<login>'s agent". From a checkout off main (MY SOL, #140) it stamps from the checkout of main beside it
// in the same repo, brought up to GitHub's main first (fast-forward only); with none beside it, the off-main refusal.
// one stable back: the branch alone moves to an older stable-* tag (forced, the tag stays), the same line and relay word.
// every Sol learns: a `stable` heard on the relay whose sha is not this checkout's stable becomes `team.stable` to every
// face; the faces offer it while `behind` (HEAD does not hold it). The live Sol (branch `live`) is never offered one:
// sol/promote moves it. At start the engine also asks GitHub once (ls-remote), for a stable stamped while it was off.
// update: fast-forward only, on main or stable, on a clean tree; the build watcher and renew do the rest. On a */mine
// branch (MY SOL, where Marco's Sol lives since sol/mine/live, #116) it runs sol/mine/rebase instead: his own commits
// go onto the new stable, and a conflict leaves the checkout as it was, its places named.
// the beta repo (#79): a checkout with a remote named `beta` (the testers' repo, marcocyl04-ux/sol-beta) gets an export of
// every stamp and every step back as that repo's main: a fresh commit holding only what runs (BETA_KEEP) and a README
// for testers, chained on the previous export so a tester's `git pull` moves, with no parent in this repo's history.
// Nothing else crosses: no docs, no memos, no design, no team pages, no commit history. Anything on beta's main that
// is not an export (the full mirror of the first day) is replaced. A refusal there is one more word on the line,
// never an undo: stable stood. No `beta` remote: nothing happens.
// A stamp and an update each join the busy counter (busy.ts): a renew never lands mid-push.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { join as joinBusy } from "../busy.js";
import { onRelay, sendRelay } from "./relay.js";
import { myLogin } from "./settings.js";

const run = promisify(execFile);
const ENV = () => ({ ...process.env, GIT_TERMINAL_PROMPT: "0" });   // never a password prompt nobody can answer

export type Ship = {
  root: string;                                                       // sol/: git runs here, the pathspecs are relative to it
  gh: (args: string[]) => Promise<string>;                            // the GitHub CLI (never a token in code)
  typecheck: (root: string, part: "engine" | "face") => Promise<string | null>;   // null: it builds; else why not
  send: (kind: "stable", payload: { sha: string; tag: string; by: string }) => void;
  me: () => Promise<string>;                                          // my login: the signature of a human's hand
  now: () => Date;
};
export type Offer = { type: "team.stable"; sha: string; tag: string; by: string; mine: string; behind: boolean };
export type Stamped = { ok: true; sha: string; tag: string; how?: string; recorded?: string; note?: string; beta?: string } | { ok?: false; error: string };

const firstLine = (e: unknown) => {
  const x = e as { stderr?: unknown; message?: unknown };
  const s = String(x?.stderr || x?.message || e).trim().split("\n").map((l) => l.replace(/^(fatal|error|hint): /, "").trim()).filter(Boolean);
  return s[0] ?? "it failed";
};
const git = (cwd: string, args: string[], timeout = 60_000) =>
  run("git", args, { cwd, env: ENV(), timeout, maxBuffer: 16 << 20 }).then((r) => r.stdout.trim());
const tryGit = (d: Ship, args: string[], timeout?: number) => git(d.root, args, timeout).catch(() => null);
const short = (s: string) => s.slice(0, 7);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ENGINE_SRC = ["engine/src", "engine/package.json", "engine/package-lock.json", "engine/tsconfig.json"];

// ---- the checks ----

/** the build is green: the engine by the keeper's record (dist.good/.commit, written by engine/keep when the good
 * build's source was a commit) if engine/ has not changed since that commit, else a type-check; the face by a type-check */
async function buildGreen(d: Ship, sha: string): Promise<{ how: string } | { error: string }> {
  let engine = "";
  try {
    const rec = readFileSync(join(d.root, "engine", "dist.good", ".commit"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(rec) && (await tryGit(d, ["diff", "--quiet", rec, sha, "--", ...ENGINE_SRC])) !== null)
      engine = `Sol's code by its last good build (${short(rec)}, the same code)`;
  } catch { /* no record */ }
  if (!engine) {
    const e = await d.typecheck(d.root, "engine");
    if (e) return { error: `Sol's code does not build: ${e}` };
    engine = "Sol's code by a fresh type-check (no good build on record for this commit)";
  }
  const f = await d.typecheck(d.root, "face");
  if (f) return { error: `the window's code does not build: ${f}` };
  return { how: `${engine}; the window's code by a fresh type-check` };
}

/** a type-check that writes nothing (so no renew, no hot reload): tsc --noEmit for the engine, tsc for the face
 * (its tsconfig has noEmit; it is the first half of the face's `npm run build`) */
export async function typecheck(root: string, part: "engine" | "face"): Promise<string | null> {
  const name = part === "engine" ? "engine" : "mac";
  const dir = join(root, name), tsc = join(dir, "node_modules", ".bin", "tsc");
  if (!existsSync(tsc)) return `cannot check it: no TypeScript in ${name}/node_modules (npm ci there first)`;
  try {
    await run(tsc, part === "engine" ? ["--noEmit", "-p", dir] : ["-p", dir], { cwd: dir, timeout: 240_000, maxBuffer: 32 << 20 });
    return null;
  } catch (e: any) {
    const out = String(e?.stdout ?? "") + String(e?.stderr ?? "");
    const errs = out.split("\n").filter((l) => /error TS\d+/.test(l));
    return errs.length ? `${plural(errs.length, "type error")}, the first: ${errs[0].trim().slice(0, 240)}` : firstLine(e);
  }
}

export type Checked = { ok: true; sha: string; how: string } | { ok: false; error: string };
export async function stampChecks(d: Ship): Promise<Checked> {
  if ((await tryGit(d, ["rev-parse", "--show-toplevel"])) === null) return { ok: false, error: "this folder is not a git repository" };
  const dirty = (await git(d.root, ["status", "--porcelain", "--untracked-files=no"])).split("\n").filter(Boolean);
  if (dirty.length) return { ok: false, error: `the tree has ${plural(dirty.length, "uncommitted change")}; commit first` };
  // a source file nobody committed is part of the build too (the keeper's record would say green for code GitHub has not)
  const loose = (await git(d.root, ["status", "--porcelain", "--untracked-files=all", "--", "engine/src", "mac/src", "mac/*.html"])).split("\n").filter(Boolean);
  if (loose.length) return { ok: false, error: `${plural(loose.length, "source file")} not committed (${loose[0].slice(3).trim()}); commit or remove first` };
  const branch = (await tryGit(d, ["branch", "--show-current"])) ?? "";
  if (branch !== "main") return { ok: false, error: `this checkout is on ${branch || "a detached head"}, not main; stable is stamped from main` };
  // what GitHub's main is now (a checkout that moved by `update` has a stale origin/main); offline, the last one known
  await tryGit(d, ["fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"], 20_000);
  const up =(await tryGit(d, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]))
    || ((await tryGit(d, ["rev-parse", "--verify", "-q", "refs/remotes/origin/main"])) ? "origin/main" : null);
  if (!up) return { ok: false, error: "main is not on GitHub yet; push it first" };
  const ahead = Number(await git(d.root, ["rev-list", "--count", `${up}..HEAD`]));
  if (ahead) return { ok: false, error: `main has ${plural(ahead, "commit")} not pushed; push first` };
  const sha = await git(d.root, ["rev-parse", "HEAD"]);
  const b = await buildGreen(d, sha);
  if ("error" in b) return { ok: false, error: b.error };
  return { ok: true, sha, how: b.how };
}

// ---- stamp, and one stable back ----

/** where a stamp runs (#140): this checkout when it is on main; else the checkout of the same repo that holds main (MY
 * SOL is a worktree of SOL, whose own folder stays on main), with `follow` first brought up to GitHub's main
 * (fast-forward only), so what is stamped is main as GitHub has it, never a copy left behind */
async function onMain(d: Ship, follow: boolean): Promise<{ d: Ship; beside: boolean } | { error: string }> {
  const branch = (await tryGit(d, ["branch", "--show-current"])) ?? "";
  if (branch === "main") return { d, beside: false };
  const prefix = (await tryGit(d, ["rev-parse", "--show-prefix"])) ?? "";
  const list = (await tryGit(d, ["worktree", "list", "--porcelain"])) ?? "";
  const path = list.split("\n\n").map((b) => b.split("\n")).find((b) => b.includes("branch refs/heads/main"))?.[0]?.replace(/^worktree /, "");
  if (!path) return { error: `this checkout is on ${branch || "a detached head"}, not main, and no checkout of main is beside it; stable is stamped from main` };
  const m: Ship = { ...d, root: join(path, prefix) };
  if (follow) {
    await tryGit(m, ["fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"], 20_000);
    try { await git(m.root, ["merge", "-q", "--ff-only", "refs/remotes/origin/main"]); }
    catch (e) { return { error: `the checkout of main (${path}) cannot follow GitHub's main: ${firstLine(e)}` }; }
  }
  return { d: m, beside: true };
}

/** stable-<yyyymmdd-hhmm> in this machine's time; a second stamp in the same minute gets -2, -3 */
export function tagName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `stable-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}
async function freeTag(d: Ship): Promise<string> {
  const base = tagName(d.now());
  let t = base;
  for (let n = 2; (await tryGit(d, ["rev-parse", "--verify", "-q", `refs/tags/${t}`])) !== null; n++) t = `${base}-${n}`;
  return t;
}

/** the signed line on the record: a comment on the issue wearing `now`, else a commit status on the sha */
async function record(d: Ship, sha: string, line: string): Promise<{ recorded?: string; note?: string }> {
  const url = (await tryGit(d, ["config", "--get", "remote.origin.url"])) ?? "";   // as written (an insteadOf is not GitHub's name)
  const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) return { note: "the line on the record was not written: origin is not on GitHub" };
  const repo = m[1];
  try {
    const n = (await d.gh(["issue", "list", "-R", repo, "--label", "now", "--state", "open", "--limit", "1", "--json", "number", "--jq", ".[0].number // empty"])).trim();
    if (/^\d+$/.test(n)) {
      await d.gh(["issue", "comment", n, "-R", repo, "--body", line]);
      return { recorded: `a comment on #${n}` };
    }
    await d.gh(["api", "-X", "POST", `repos/${repo}/statuses/${sha}`, "-f", "state=success", "-f", "context=sol/stable", "-f", `description=${line.slice(0, 140)}`]);
    return { recorded: `a status on ${short(sha)}` };
  } catch (e) {
    return { note: `the line on the record was not written: ${firstLine(e)}` };
  }
}

// ---- the beta repo: an export, never the house ----

/** what a tester's Sol needs and nothing more: the engine, the face, setup and help, the three scripts the engine runs
 * on itself, the home templates, the two design files the face builds from. And the user's door (#124): what makes
 * it theirs, sol/mine/setup, rebase and the commit-msg hook, with the harness that keeps a session off their window
 * (the guard and the settings that wire it). The dev's door stays here: the workshop's take and brief, the stage,
 * the night job's script (Try's and the night's code ride inside the engine, unused by a tester). Everything else stays. */
export const BETA_KEEP = [
  "sol/engine", "sol/mac", "sol/setup", "sol/setup.d", "sol/HELP.md", "sol/home", "sol/.gitignore",
  "sol/back", "sol/undo", "sol/mutate", "sol/design/tempo.json", "sol/design/palette.json", ".gitignore",
  "sol/mine/setup", "sol/mine/rebase", "sol/mine/hooks", "sol/harness", ".claude/settings.json",
  // the install (#169): the one line's script, the page that serves it, and the two workflows that run only in the
  // public repo (by exact path: ci and apart stay home)
  "sol/install", "site", ".github/workflows/release.yml", ".github/workflows/pages.yml",
];
const kept = (path: string) => BETA_KEEP.some((k) => path === k || path.startsWith(k + "/"));
const EXPORT_MSG = /^Sol stable-/;
/** the README a tester finds at the root of the beta repo: Sol's own front door, no owner, no team */
export const betaReadme = (tag: string) => `# Sol

One window for all your AI. Sol is a face on your own machine that talks to a local engine: your chats, your
work with coding agents, your browser, a desk for notes and cards, voice, and the tools you make, in one place
that is yours. The engine runs on your computer, your data stays in your folder, and Sol changes itself from the
inside when you ask it to.

The idea: today each AI lives in its own tab and knows nothing of the others. Sol is the one surface you sit
at, and the AIs are its hands. Over time it becomes the system you need, built by being talked to.

This is the version beta testers run: ${tag}. It is made from the development repository by the stamp that
moves stable, and holds only what runs. Nothing here is edited by hand; the next version replaces it.

## Install

**Mac**, one line in Terminal. It asks what to call you, puts Sol in \`~/Sol\`, and opens Sol.app:

\`\`\`
curl -fsSL https://marcocyl04-ux.github.io/sol-beta/install | sh
\`\`\`

Or download \`Sol-mac.zip\` from the [latest release](https://github.com/marcocyl04-ux/sol-beta/releases/latest),
unzip it and open Sol. It is not signed with Apple yet: the first time, macOS says it cannot check it, and
System Settings → Privacy & Security has an **Open Anyway** button; click it once. Sol then asks the same
question and sets itself up.

**Linux**, and **Windows** inside Ubuntu under WSL (\`wsl --install\` once in PowerShell): the same line; there is
no app, the face opens in your browser at http://localhost:1420.

Both end with a sign-in to Claude (Claude Code runs the agents in Sol). There are no team features in a beta
Sol (no relay, no shared view, no Hand).

## Make it yours

Sol changes itself when you ask it to. To keep those changes yours across new versions, give them a branch once:

\`\`\`
git switch -c <you>/mine && bash sol/mine/setup
\`\`\`

Every commit there gets \`mine: \` in front. The harness comes along (\`sol/harness/guard\`, wired by
\`.claude/settings.json\`): it refuses, before it runs, what a session in your Sol should never do.

## Keep it current

A new version: \`git pull\` in that folder; Sol rebuilds itself. On your own branch, \`bash sol/mine/rebase\` instead:
it puts your changes on top of the new version, and if one does not fit it names the place and changes nothing. When something breaks, \`sol/HELP.md\`.
Something wrong, or a thought: open an issue on this repository.
`;

/** git with something on stdin (update-index --index-info, hash-object --stdin) */
function gitIn(cwd: string, args: string[], input: string, env: NodeJS.ProcessEnv = ENV()): Promise<string> {
  return new Promise((ok, no) => {
    const p = spawn("git", args, { cwd, env });
    let out = "", err = "";
    p.stdout.on("data", (b) => { out += b; });
    p.stderr.on("data", (b) => { err += b; });
    p.on("error", no);
    p.on("close", (code) => code === 0 ? ok(out.trim()) : no(new Error(err.trim() || `git ${args[0]} failed`)));
    p.stdin.end(input);
  });
}

/** the blobs named, read in one git call: sha → bytes */
function blobs(top: string, shas: string[]): Promise<Map<string, Buffer>> {
  return new Promise((ok, no) => {
    const p = spawn("git", ["cat-file", "--batch"], { cwd: top, env: ENV() });
    const parts: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (b) => parts.push(b));
    p.stderr.on("data", (b) => { err += b; });
    p.on("error", no);
    p.on("close", (code) => {
      if (code !== 0) return no(new Error(err.trim() || "git cat-file failed"));
      const out = Buffer.concat(parts), m = new Map<string, Buffer>();
      let at = 0;
      while (at < out.length) {
        const nl = out.indexOf(10, at);
        const [id, , size] = out.subarray(at, nl).toString().split(" ");
        const n = Number(size);
        if (!Number.isFinite(n)) break;   // "<sha> missing"
        m.set(id, out.subarray(nl + 1, nl + 1 + n));
        at = nl + 1 + n + 1;
      }
      ok(m);
    });
    p.stdin.end(shas.join("\n") + "\n");
  });
}
/** what must never leave the house (#169), in a file about to be exported: the first offence as "file:line: what" */
const PLACEHOLDER = /(^|\.)example\.ts\.net$/;
const HOST = /[\w-]+(?:\.[\w-]+)*\.ts\.net/g;
export function exportOffence(path: string, body: Buffer): string | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base === ".env" || base.startsWith(".env.") && base !== ".env.example" || base === "team.json") return `${path}: a private file`;
  if (body.includes(0)) return null;   // an image, a font: no words in it
  const lines = body.toString("utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], host = [...l.matchAll(HOST)].map((m) => m[0]).find((h) => !PLACEHOLDER.test(h));
    if (host) return `${path}:${i + 1}: a tailnet address, ${host}`;
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(l)) return `${path}:${i + 1}: a private key`;
    if (/@gmail\.com/i.test(l)) return `${path}:${i + 1}: a personal address`;
  }
  return null;
}

/** the export of `sha` for the beta repo: a commit with only BETA_KEEP and the README, on the previous export.
 * Refused, nothing written, when a kept file names a private machine, a key, or a person's address (exportOffence). */
export async function exportTree(root: string, sha: string, tag: string): Promise<{ commit: string; prev: string }> {
  const top = await git(root, ["rev-parse", "--show-toplevel"]);
  const entries = (await git(top, ["ls-tree", "-r", "-z", sha])).split("\0").filter(Boolean)
    .filter((e) => kept(e.slice(e.indexOf("\t") + 1)));
  if (!entries.length) throw new Error("nothing to export: the stamp holds none of what a tester runs");
  const at = (e: string) => ({ id: e.split(" ")[2].split("\t")[0], path: e.slice(e.indexOf("\t") + 1) });
  const read = await blobs(top, entries.map((e) => at(e).id));
  for (const e of entries) {
    const { id, path } = at(e), why = exportOffence(path, read.get(id) ?? Buffer.alloc(0));
    if (why) throw new Error(`not exported: ${why}; the beta repo gets nothing until it is out`);
  }
  // the site serves the install line's script: the same file as sol/install, so the two doors never drift
  const install = entries.find((e) => at(e).path === "sol/install");
  if (install) entries.push(`100644 blob ${at(install).id}\tsite/install`);
  const readme = await gitIn(top, ["hash-object", "-w", "--stdin"], betaReadme(tag));
  const dir = mkdtempSync(join(tmpdir(), "sol-beta-"));
  try {
    const env = { ...ENV(), GIT_INDEX_FILE: join(dir, "index") };
    await gitIn(top, ["update-index", "-z", "--index-info"], entries.map((e) => e + "\0").join("") + `100644 blob ${readme}\tREADME.md\0`, env);
    const tree = await run("git", ["write-tree"], { cwd: top, env }).then((r) => r.stdout.trim());
    // the previous export is the parent (a tester's pull moves); anything else there (the full mirror) is replaced
    await run("git", ["fetch", "-q", "beta", "+refs/heads/main:refs/remotes/beta/main"], { cwd: top, env: ENV(), timeout: 60_000 }).catch(() => {});
    const prev = await run("git", ["rev-parse", "--verify", "-q", "refs/remotes/beta/main"], { cwd: top, env: ENV() }).then((r) => r.stdout.trim()).catch(() => "");
    const prevMsg = prev ? await run("git", ["log", "-1", "--format=%s", prev], { cwd: top, env: ENV() }).then((r) => r.stdout.trim()).catch(() => "") : "";
    const parent = prev && EXPORT_MSG.test(prevMsg) ? ["-p", prev] : [];
    const commit = await run("git", ["commit-tree", tree, ...parent, "-m", `Sol ${tag}`], { cwd: top, env: ENV() }).then((r) => r.stdout.trim());
    return { commit, prev };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** the beta repo's main follows stable as an export: the remote `beta`, when this checkout has one */
async function mirror(d: Ship, sha: string, tag: string): Promise<{ beta?: string }> {
  if ((await tryGit(d, ["remote", "get-url", "beta"])) === null) return {};
  try {
    const { commit, prev } = await exportTree(d.root, sha, tag);
    // the lease: main must still be what the export was built on (another stamp in between refuses, never overwrites)
    await git(d.root, ["push", "-q", `--force-with-lease=refs/heads/main:${prev}`, "beta", `${commit}:refs/heads/main`, `+${commit}:refs/tags/${tag}`], 120_000);
    return { beta: `the beta repo runs it too` };
  } catch (e) {
    return { beta: `the beta repo did not take it: ${firstLine(e)}` };
  }
}

async function putBack(d: Ship, before: string | null) {
  if (before) await tryGit(d, ["branch", "-f", "stable", before]);
  else await tryGit(d, ["branch", "-D", "stable"]);
}

async function forward(here: Ship): Promise<Stamped> {
  const o = await onMain(here, true);
  if ("error" in o) return { error: o.error };
  const d = o.d;
  const c = await stampChecks(d);
  if (!c.ok) return { error: c.error };
  const by = await d.me();
  const tag = await freeTag(d);
  const before = await tryGit(d, ["rev-parse", "--verify", "-q", "refs/heads/stable"]);
  await git(d.root, ["tag", "-a", tag, "-m", `stable, stamped by ${by}`, c.sha]);
  try {
    await git(d.root, ["branch", "-f", "stable", c.sha]);
    await git(d.root, ["push", "-q", "--atomic", "origin", "refs/heads/stable:refs/heads/stable", `refs/tags/${tag}:refs/tags/${tag}`], 120_000);
  } catch (e) {
    // nothing moved on GitHub (the push is atomic): the local tag and branch go back to how they were
    await tryGit(d, ["tag", "-d", tag]);
    await putBack(d, before);
    return { error: `GitHub did not take it: ${firstLine(e)}` };
  }
  const b = await mirror(d, c.sha, tag);
  const r = await record(d, c.sha, `stable stamped: ${tag} at ${short(c.sha)}, by ${by}${b.beta ? `; ${b.beta}` : ""}`);
  d.send("stable", { sha: c.sha, tag, by });
  if (here.root === D?.root) void hear({ sha: c.sha, tag, by });   // the relay never echoes to the sender: this Sol hears its own stamp (#166)
  return { ok: true, sha: c.sha, tag, how: c.how, ...r, ...b };
}

async function back(here: Ship, to: string): Promise<Stamped> {
  if (!/^stable-[\w.-]+$/.test(to)) return { error: "that is not a stable tag" };
  const o = await onMain(here, false);
  if ("error" in o) return { error: o.error };
  const d = o.d;
  const sha = await tryGit(d, ["rev-parse", "--verify", "-q", `refs/tags/${to}^{commit}`]);
  if (!sha) return { error: `there is no tag ${to} here` };
  if ((await tryGit(d, ["branch", "--show-current"])) === "stable") return { error: "this checkout is on stable; switch to main first" };
  const before = await tryGit(d, ["rev-parse", "--verify", "-q", "refs/heads/stable"]);
  try {
    await git(d.root, ["branch", "-f", "stable", sha]);
    await git(d.root, ["push", "-q", "origin", "+refs/heads/stable:refs/heads/stable"], 120_000);   // the branch alone; the tag stays
  } catch (e) {
    await putBack(d, before);
    return { error: `GitHub did not take it: ${firstLine(e)}` };
  }
  const by = await d.me();
  const b = await mirror(d, sha, to);
  const r = await record(d, sha, `stable moved back to ${to} (${short(sha)}), by ${by}${b.beta ? `; ${b.beta}` : ""}`);
  d.send("stable", { sha, tag: to, by });
  if (here.root === D?.root) void hear({ sha, tag: to, by });
  return { ok: true, sha, tag: to, ...r, ...b };
}

let stamping = false;
/** team.stamp: to HEAD, or with `to` one stable back to that tag */
export async function stamp(d: Ship, to?: string): Promise<Stamped> {
  if (stamping) return { error: "a stamp is already running" };
  stamping = true;
  const leave = joinBusy("stamp", to ?? "stable", to ? `stable back to ${to}` : "stamp stable");
  try { return to ? await back(d, to) : await forward(d); }
  catch (e) { return { error: firstLine(e) }; }
  finally { stamping = false; leave(); }
}

/** team.stables: the last five stable-* tags, newest first; where stable is on GitHub (as last fetched) and what a stamp
 * would stamp: HEAD on main, or from a checkout off main (MY SOL) GitHub's main, which the stamp brings main's checkout to */
export async function stables(d: Ship): Promise<{ tags: { tag: string; sha: string; at: string }[]; stable: string | null; head: { sha: string; short: string; branch: string } | null }> {
  await tryGit(d, ["fetch", "-q", "origin", "refs/tags/stable-*:refs/tags/stable-*"], 20_000);
  await tryGit(d, ["fetch", "-q", "origin", "+refs/heads/stable:refs/remotes/origin/stable"], 20_000);
  const out = (await tryGit(d, ["for-each-ref", "--sort=-refname", "--count=5", "--format=%(refname:short)%09%(*objectname)%09%(objectname)%09%(creatordate:iso-strict)", "refs/tags/stable-*"])) ?? "";
  const tags = out.split("\n").filter(Boolean).map((l) => { const [tag, peeled, obj, at] = l.split("\t"); return { tag, sha: peeled || obj, at }; });
  const stable = (await tryGit(d, ["rev-parse", "--verify", "-q", "refs/remotes/origin/stable"])) ?? (await tryGit(d, ["rev-parse", "--verify", "-q", "refs/heads/stable"]));
  const o = await onMain(d, false);
  if ("d" in o && o.beside) await tryGit(d, ["fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"], 20_000);
  const sha = "d" in o && o.beside ? await tryGit(d, ["rev-parse", "--verify", "-q", "refs/remotes/origin/main"]) : await tryGit(d, ["rev-parse", "HEAD"]);
  return { tags, stable, head: sha ? { sha, short: short(sha), branch: "d" in o && o.beside ? "main" : (await tryGit(d, ["branch", "--show-current"])) ?? "" } : null };
}

// ---- every Sol learns, and updates on yes ----

/** a `stable` heard on the relay: the offer for every face, or null when there is nothing to offer here */
export async function heardStable(d: Ship, m: { sha?: unknown; tag?: unknown; by?: unknown }): Promise<Offer | null> {
  const sha = String(m.sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;
  const branch = (await tryGit(d, ["branch", "--show-current"])) ?? "";
  if (branch === "live") return null;   // the live Sol moves by sol/promote only
  const mine = (await tryGit(d, ["rev-parse", "--verify", "-q", "refs/heads/stable"])) ?? (await tryGit(d, ["rev-parse", "--verify", "-q", "refs/remotes/origin/stable"])) ?? "";
  // HEAD holds it already (an older stable, or main ahead of it): nothing to update to. An unknown sha is behind.
  const behind = (await tryGit(d, ["merge-base", "--is-ancestor", sha, "HEAD"])) === null;
  // MY SOL shares its `stable` with the checkout of main beside it, and a stamp from MY SOL moves it there: on a */mine
  // branch only HEAD's history says whether it has the stamp (#166)
  if (/\/mine$/.test(branch)) return behind ? { type: "team.stable", sha, tag: String(m.tag ?? ""), by: String(m.by ?? ""), mine, behind } : null;
  if (mine === sha) return null;
  return { type: "team.stable", sha, tag: String(m.tag ?? ""), by: String(m.by ?? ""), mine, behind };
}

let updating = false;
/** team.update: fast-forward to the team's stable; then the build watcher rebuilds and renew goes live at a quiet moment */
export async function update(d: Ship): Promise<{ ok: true; sha: string; renews: boolean } | { ok?: false; error: string }> {
  if (updating) return { error: "an update is already running" };
  updating = true;
  const leave = joinBusy("update", "stable", "update to stable");
  try {
    const dirty = (await git(d.root, ["status", "--porcelain", "--untracked-files=no"])).split("\n").filter(Boolean);
    if (dirty.length) return { error: "you have changes; commit or stash first" };
    const branch = (await tryGit(d, ["branch", "--show-current"])) ?? "";
    const mine = /\/mine$/.test(branch);
    if (branch !== "main" && branch !== "stable" && !mine) return { error: `you are on ${branch || "a detached head"}; switch to main first` };
    try { await git(d.root, ["fetch", "-q", "origin", "+refs/heads/stable:refs/remotes/origin/stable"], 120_000); }
    catch (e) { return { error: `could not fetch stable: ${firstLine(e)}` }; }
    const target = await git(d.root, ["rev-parse", "refs/remotes/origin/stable"]);
    const was = await git(d.root, ["rev-parse", "HEAD"]);
    if (mine) {
      try { await run("bash", [join(d.root, "mine", "rebase")], { cwd: d.root, env: ENV(), timeout: 120_000 }); }
      catch (e: any) {
        const said = `${e?.stdout ?? ""}\n${e?.stderr ?? ""}`.split("\n").map((l) => l.replace(/^mine\/rebase: /, "").trim()).filter(Boolean).join("; ");
        return { error: said ? said.slice(0, 400) : `sol/mine/rebase did not finish: ${firstLine(e)}` };
      }
    } else {
      try { await git(d.root, ["merge", "--ff-only", "-q", "refs/remotes/origin/stable"]); }
      catch (e) { return { error: `${branch} has commits stable does not, so it cannot move forward to it: ${firstLine(e)}` }; }
    }
    if (branch !== "stable") await tryGit(d, ["branch", "-f", "stable", target]);   // my stable is the team's now
    const renews = (await tryGit(d, ["diff", "--quiet", was, "HEAD", "--", ...ENGINE_SRC])) === null;
    return { ok: true, sha: target, renews };
  } catch (e) {
    return { error: firstLine(e) };
  } finally { updating = false; leave(); }
}

// ---- the engine's one instance ----

let D: Ship | null = null;
let offer: Offer | null = null;
let tell: (m: object) => void = () => {};
let listening = false;
export const shipNow = () => D;
/** the standing offer (a face that connects asks for it with team.stable.get) */
export const offerNow = () => offer;

/** what the engine does with a `stable` heard on the relay (exported for the tests) */
export async function hear(m: { sha?: unknown; tag?: unknown; by?: unknown }) {
  if (!D) return;
  const o = await heardStable(D, m).catch(() => null);
  if (!o) return;
  offer = o;
  tell(o);
}
/** after an update: the offer stands answered, every face hears it is no longer behind */
export function answered(sha: string) {
  if (!offer) return;
  offer = { ...offer, mine: sha, behind: false };
  tell(offer);
}

/** what this engine's stable is on GitHub, asked once at start: a stable stamped while it was off is offered too */
async function askOrigin() {
  if (!D) return;
  const out = await git(D.root, ["ls-remote", "origin", "refs/heads/stable", "refs/tags/stable-*"], 20_000).catch(() => "");
  const refs = out.split("\n").filter(Boolean).map((l) => l.split("\t") as [string, string]);
  const sha = refs.find(([, r]) => r === "refs/heads/stable")?.[0];
  if (!sha) return;
  const tagged = refs.find(([s, r]) => s === sha && r.endsWith("^{}")) ?? refs.find(([s, r]) => s === sha && r.startsWith("refs/tags/"));
  await hear({ sha, tag: tagged ? tagged[1].replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "") : "", by: "" });
}

/** index.ts: start Ship once, with the repo's sol/ folder and the engine's everyone() */
export function startShip(root: string, everyone: (m: object) => void, over: Partial<Ship> = {}) {
  D = {
    root,
    gh: (args) => run("gh", args, { cwd: root, env: ENV(), timeout: 30_000, maxBuffer: 8 << 20 }).then((r) => r.stdout),
    typecheck,
    send: (kind, payload) => { sendRelay(kind, payload); },
    me: myLogin,
    now: () => new Date(),
    ...over,
  };
  tell = everyone;
  offer = null;
  if (!listening) { listening = true; onRelay("stable", (m) => void hear(m as { sha?: unknown })); }
  if (!process.env.SOL_NO_SHIP_CHECK) setTimeout(() => void askOrigin().catch(() => {}), 20_000).unref();
}
