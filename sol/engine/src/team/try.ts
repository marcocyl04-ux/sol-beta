// Try and review (#35, design/together/5-try/PRD.md, PROTOCOL.md round 22): a teammate's pull request run as a second
// Sol beside mine, and the Codex review seat on its diff.
//
// A try: the PR's head fetched into a side copy the way Work makes one (makeTryCopy), npm ci and the build in its
// sol/engine and sol/mac, then its engine on 7778 and its face (Vite) on 1421, each with nothing of mine: a temp state
// folder, a temp home holding only the committed CLAUDE.md and AGENTS.md, no Sol secret in its environment
// (secondSol). The engine's door lets in only Sol's own pages, so the face reaches 7778 through a Vite proxy laid over
// the copy's own config (faceConfig) rather than dialling it from 1421. Stop ends both process groups and keeps the copy.
// One try at a time. The review runs work/review.ts on the copy's folder, scope "all", under a review id of its own.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { join as joinBusy } from "../busy.js";
import { noteCopy, prefs } from "../work/state.js";
import { review, markReview, withReviews } from "../work/review.js";
import { getTeam, myLogin, signature, mayAgentSpeak } from "./settings.js";

export const TRY_ENGINE = 7778;
export const TRY_FACE = 1421;
export const PROXY = "/sol-engine";   // the face's path to its engine, on its own origin

const run = promisify(execFile);
const ENV = () => ({ ...process.env, GIT_TERMINAL_PROMPT: "0" });
const git = (cwd: string, args: string[], timeout = 120_000) =>
  run("git", args, { cwd, env: ENV(), timeout, maxBuffer: 16 << 20 }).then((r) => r.stdout.trim());
const gh = (args: string[], timeout = 60_000) =>
  run("gh", args, { env: ENV(), timeout, maxBuffer: 16 << 20 }).then((r) => r.stdout.trim());
const firstLine = (e: unknown) => {
  const x = e as { stderr?: unknown; message?: unknown };
  const s = String(x?.stderr || x?.message || e).trim().split("\n").map((l) => l.replace(/^(fatal|error|hint): /, "").trim()).filter(Boolean);
  return s[0] ?? "it failed";
};

// ---- the pure parts (tested) ----

const HEAD = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;
const REPO = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/;
export const okRepo = (r: unknown): r is string => typeof r === "string" && REPO.test(r);
export const okPr = (n: unknown) => Number.isInteger(Number(n)) && Number(n) > 0 && Number(n) < 1e7;

/** the try's own branch: try/<login>/<pr> */
export const tryBranch = (login: string, pr: number) => `try/${/^[A-Za-z0-9-]{1,39}$/.test(login) ? login : "me"}/${pr}`;
/** where the copy goes: beside Work's copies (prefs wtDir), else inside the repo, as Work's are */
export const tryCopyPath = (repoDir: string, wtDir: string, pr: number) =>
  wtDir ? join(wtDir, basename(repoDir), `try-${pr}`) : join(repoDir, ".claude", "worktrees", `try-${pr}`);
/** the review seat keeps its items by this id (Work's session-id shape: letters, digits, - and _) */
export const reviewId = (repo: string, pr: number) => `review-${repo.replace(/[^A-Za-z0-9_-]/g, "-")}-${pr}`.slice(0, 80);
/** the last line of what a program said, short */
export const lastLine = (s: string) => (s.split(/\r?\n/).map((l) => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim()).filter(Boolean).pop() ?? "").slice(0, 160);
/** a body as the team signs it: the words, then a last line with who wrote them */
export const signed = (body: string, sig: string) => `${body.trim()}\n\n— ${sig}`;

// a teammate's branch is its code running on this machine: what it runs (npm ci with its install scripts, its builds,
// its engine and face) gets only these from mine, plus the values set for it here; never a key, token or webhook
export const PASS = ["PATH", "HOME", "TMPDIR", "LANG", "SHELL", "USER", "TERM"] as const;
/** the environment of a program from the branch: the allowlist from `base`, then `set` (pure) */
export function childEnv(base: NodeJS.ProcessEnv, set: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of PASS) { const v = base[k]; if (v !== undefined) env[k] = v; }
  return { ...env, ...set };
}
/** a build step's environment (npm ci, npm run build): no prompt, no fund or audit call (pure) */
export const stepEnv = (base: NodeJS.ProcessEnv = process.env) =>
  childEnv(base, { CI: "1", npm_config_fund: "false", npm_config_audit: "false", GIT_TERMINAL_PROMPT: "0" });
export type Spec = { name: "engine" | "face"; cmd: string; args: string[]; cwd: string; env: Record<string, string> };

/** the two programs of a second Sol from the copy `copy`, with `tmp` as everything it may write (pure) */
export function secondSol(copy: string, tmp: string, base: NodeJS.ProcessEnv = process.env, node = process.execPath): { engine: Spec; face: Spec } {
  const engine: Spec = {
    name: "engine", cmd: node, args: ["dist/index.js"], cwd: join(copy, "sol", "engine"),
    env: childEnv(base, {
      PORT: String(TRY_ENGINE), SOL_PORT: String(TRY_ENGINE),
      SOL_STATE: join(tmp, "state", "work.json"),
      SOL_HOME: join(tmp, "home"),
      SOL_TEAM: join(tmp, "team.json"),
      SOL_PROFILE: join(tmp, "profile"),
      SOL_DIST: join(copy, "sol", "mac", "dist"),
      SOL_NO_RENEW: "1", SOL_NO_SHIP_CHECK: "1",
      GIT_TERMINAL_PROMPT: "0",
    }),
  };
  const face: Spec = {
    name: "face", cmd: node,
    args: ["node_modules/vite/bin/vite.js", "--config", "node_modules/.sol-try/vite.config.mjs", "--port", String(TRY_FACE), "--strictPort", "--host", "127.0.0.1"],
    cwd: join(copy, "sol", "mac"),
    env: childEnv(base, { VITE_ENGINE: `ws://127.0.0.1:${TRY_FACE}${PROXY}`, SOL_TRY_ENGINE: String(TRY_ENGINE) }),
  };
  return { engine, face };
}

/** the Vite config laid over the copy's own: its port, and the proxy to its engine with the engine's own Origin */
export const faceConfig = () => `// written by Sol's try (engine/src/team/try.ts); rewritten on every try
import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config.ts";
const engine = "http://127.0.0.1:" + (process.env.SOL_TRY_ENGINE || "${TRY_ENGINE}");
const own = (req) => req.setHeader("origin", engine);
export default defineConfig(async (env) => mergeConfig(typeof base === "function" ? await base(env) : base, {
  server: {
    port: ${TRY_FACE}, strictPort: true, host: "127.0.0.1", hmr: { overlay: false },
    proxy: { "${PROXY}": { target: engine, ws: true, rewrite: (p) => p.replace(/^\\${PROXY}/, "") || "/",
      configure: (proxy) => { proxy.on("proxyReq", own); proxy.on("proxyReqWs", own); } } },
  },
}));
`;

/** the second Sol's home: only the committed CLAUDE.md and AGENTS.md of the copy, and the two empty folders */
export function makeHome(copy: string, tmp: string): string {
  const home = join(tmp, "home");
  mkdirSync(join(home, "life"), { recursive: true });
  mkdirSync(join(home, "memory"), { recursive: true });
  for (const f of ["CLAUDE.md", "AGENTS.md"]) {
    const from = join(copy, "sol", "home", f);
    if (existsSync(from)) copyFileSync(from, join(home, f));
  }
  return home;
}

// ---- the copy ----

export type Head = { head: string; fork?: boolean };
/** the PR's head fetched and checked out in its own side copy (made, or updated fast-forward only) */
export async function makeTryCopy(a: { repoDir: string; wtDir: string; pr: number; login: string } & Head): Promise<{ path: string; branch: string; made: boolean; sha: string }> {
  if (!HEAD.test(a.head)) throw new Error(`the PR's branch name is not one git takes: ${a.head}`);
  const src = a.fork ? `refs/pull/${a.pr}/head` : `refs/heads/${a.head}`;
  const tracking = `origin/${a.fork ? `pr/${a.pr}` : a.head}`;
  const path = tryCopyPath(a.repoDir, a.wtDir, a.pr);
  const branch = tryBranch(a.login, a.pr);
  await git(a.repoDir, ["fetch", "-q", "origin", `+${src}:refs/remotes/${tracking}`]).catch((e) => { throw new Error("git could not fetch the PR: " + firstLine(e)); });
  let made = false;
  if (existsSync(join(path, ".git"))) {
    await git(path, ["pull", "-q", "--ff-only", "origin", src]).catch((e) => { throw new Error("the copy could not be updated: " + firstLine(e)); });
  } else {
    if (a.wtDir) mkdirSync(join(a.wtDir, basename(a.repoDir)), { recursive: true });
    await git(a.repoDir, ["worktree", "prune"]).catch(() => {});
    const has = await git(a.repoDir, ["rev-parse", "-q", "--verify", `refs/heads/${branch}`]).then(() => true, () => false);
    const args = has ? ["worktree", "add", path, branch] : ["worktree", "add", "--track", "-b", branch, path, tracking];
    await git(a.repoDir, args).catch((e) => { throw new Error("git could not make the copy: " + firstLine(e)); });
    if (has) await git(path, ["merge", "-q", "--ff-only", tracking]).catch((e) => { throw new Error("the copy could not be updated: " + firstLine(e)); });
    noteCopy(path, a.repoDir);
    made = true;
  }
  return { path, branch, made, sha: await git(path, ["rev-parse", "HEAD"]) };
}

// ---- the processes: what a try started, and stopping it ----

export type Step = { step: string; done: boolean; ok?: boolean; line: string };
export type Trying = { repo: string; pr: number; path: string; branch: string; head: string; title: string; author: string; since: number; up: boolean; engine: number; face: number };
type Bus = (m: object) => void;

let trying: Trying | null = null;
let steps: Step[] = [];
let tmp = "";
let stopping = false;
const procs = new Map<string, ChildProcess>();   // name -> the process (its own group); the step running, or the two
let bus: Bus = () => {};
export const setTryBus = (b: Bus) => { bus = b; };
export const tryNow = () => trying;
export const tryState = () => ({ type: "team.try.state", ...(trying ? { trying } : {}), steps });
const sayState = () => bus(tryState());
function say(s: Step) {
  const i = steps.findIndex((x) => x.step === s.step);
  if (i >= 0) steps[i] = s; else steps.push(s);
  bus({ type: "team.try.step", ...s });
}

const killGroup = (p: ChildProcess, sig: NodeJS.Signals) => { try { if (p.pid) process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch { /* gone */ } } };
const gone = (p: ChildProcess) => p.exitCode !== null || p.signalCode !== null;
process.on("exit", () => { for (const p of procs.values()) if (!gone(p)) killGroup(p, "SIGKILL"); });

/** start one program in its own process group; its output's last line is kept */
export function launch(s: Spec, onExit?: (code: number | null, last: string) => void): ChildProcess {
  const p = spawn(s.cmd, s.args, { cwd: s.cwd, env: s.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let last = "";
  const hear = (b: Buffer) => { const l = lastLine(String(b)); if (l) last = l; };
  p.stdout?.on("data", hear); p.stderr?.on("data", hear);
  // a program that never started says so on "error" only: either way the end is told once
  let told = false;
  const end = (code: number | null) => { if (!told) { told = true; onExit?.(code, last); } };
  p.on("error", (e) => { last = e.message; end(null); });
  p.on("exit", (code) => end(code));
  procs.set(s.name, p);
  return p;
}
/** a step's program to its end: ok, or the error with its last line */
function stepRun(name: string, cmd: string, args: string[], cwd: string, ms = 15 * 60_000): Promise<string> {
  return new Promise((ok, no) => {
    let out = "";
    const p = spawn(cmd, args, { cwd, env: stepEnv(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    procs.set(name, p);
    const t = setTimeout(() => killGroup(p, "SIGTERM"), ms);
    const hear = (b: Buffer) => { out = (out + String(b)).slice(-8000); };
    p.stdout?.on("data", hear); p.stderr?.on("data", hear);
    p.on("error", (e) => { clearTimeout(t); procs.delete(name); no(new Error(e.message)); });
    p.on("exit", (code, sig) => {
      clearTimeout(t); procs.delete(name);
      if (code === 0) ok(lastLine(out)); else no(new Error(stopping ? "stopped" : lastLine(out) || `it ended with ${sig ?? code}`));
    });
  });
}

/** stop what the try started (the step running, or both programs) and keep the copy; the temp folder goes */
export async function stopTry(): Promise<{ ok: true; stopped: string[] }> {
  stopping = true;
  const list = [...procs.entries()];
  for (const [, p] of list) if (!gone(p)) killGroup(p, "SIGTERM");
  await Promise.all(list.map(([, p]) => new Promise<void>((done) => {
    if (gone(p)) return done();
    const t = setTimeout(() => { killGroup(p, "SIGKILL"); }, 3000);
    p.once("exit", () => { clearTimeout(t); done(); });
  })));
  procs.clear();
  if (tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* left for the OS */ } tmp = ""; }
  const was = !!trying;
  trying = null;
  stopping = false;
  if (was) sayState();
  return { ok: true, stopped: list.map(([n]) => n) };
}

/** both programs started from specs (the real ones from secondSol; the tests start `sleep`) */
export function launchAll(specs: Spec[], onEnd?: (name: string, last: string) => void) {
  for (const s of specs) launch(s, (code, last) => { if (!stopping) onEnd?.(s.name, last || `it ended with ${code}`); });
}

const portFree = (port: number) => new Promise<boolean>((ok) => {
  const s = createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true)));
  s.listen(port, "127.0.0.1");
});
async function answers(url: string, ms: number, alive: () => boolean): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end && alive()) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.status < 500) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
// npm ci only when the lock is newer than what node_modules holds
const fresh = (dir: string) => {
  try { return statSync(join(dir, "node_modules", ".package-lock.json")).mtimeMs >= statSync(join(dir, "package-lock.json")).mtimeMs; } catch { return false; }
};

export type PrInfo = { number: number; title: string; headRefName: string; headRefOid: string; isCrossRepository?: boolean; author?: { login?: string }; state?: string };
export const prInfo = async (repo: string, pr: number): Promise<PrInfo> =>
  JSON.parse(await gh(["pr", "view", String(pr), "--repo", repo, "--json", "number,title,headRefName,headRefOid,isCrossRepository,author,state"]));

/** a whole try: the copy, the builds, the two programs, up. Refused while another is on. */
export async function startTry(repo: string, pr: number, repoDir: string): Promise<{ ok: true; path: string; branch: string; engine: number; face: number } | { error: string; trying?: Trying }> {
  if (trying) return { error: `already trying #${trying.pr}; stop that one first`, trying };
  // taken at once, before anything is awaited: a second try asked meanwhile is refused
  trying = { repo, pr, path: "", branch: "", head: "", title: "", author: "", since: Date.now(), up: false, engine: TRY_ENGINE, face: TRY_FACE };
  steps = [];
  const mine = trying;
  const login = await myLogin().catch(() => "");
  mine.branch = tryBranch(login, pr);
  const leave = joinBusy("try", `${repo}#${pr}`);
  const step = async <T>(name: string, line: string, f: () => Promise<T>, said?: (v: T) => string): Promise<T> => {
    if (trying !== mine) throw new Error("stopped");
    say({ step: name, done: false, line });
    try { const v = await f(); say({ step: name, done: true, ok: true, line: said?.(v) ?? (typeof v === "string" && v ? v : line) }); return v; }
    catch (e) { say({ step: name, done: true, ok: false, line: firstLine(e) }); throw e; }
  };
  sayState();
  try {
    const c = await step("copy", `reading #${pr}`, async () => {
      const info = await prInfo(repo, pr).catch((e) => { throw new Error("GitHub did not say: " + firstLine(e)); });
      if (info.state && info.state !== "OPEN") throw new Error(`#${pr} is ${info.state.toLowerCase()}, not open`);
      Object.assign(mine, { head: info.headRefName, title: info.title, author: info.author?.login ?? "" });
      sayState();
      return makeTryCopy({ repoDir, wtDir: prefs().wtDir, pr, login, head: info.headRefName, fork: !!info.isCrossRepository });
    }, (c) => `${c.made ? "made" : "updated"} ${basename(c.path)} on ${c.branch} at ${c.sha.slice(0, 7)}`);
    mine.path = c.path; mine.branch = c.branch;
    sayState();
    const eng = join(c.path, "sol", "engine"), mac = join(c.path, "sol", "mac");
    if (!existsSync(join(eng, "package.json")) || !existsSync(join(mac, "package.json"))) throw new Error("that branch has no sol/engine and sol/mac to run");
    for (const [part, dir] of [["engine", eng], ["face", mac]] as const) {
      await step(`${part} npm ci`, "npm ci", async () => (fresh(dir) ? "already installed" : stepRun(`${part} npm ci`, "npm", ["ci", "--no-audit", "--no-fund"], dir)));
      await step(`${part} build`, "npm run build", () => stepRun(`${part} build`, "npm", ["run", "build"], dir));
    }
    for (const port of [TRY_ENGINE, TRY_FACE]) if (!(await portFree(port))) throw new Error(`port ${port} is taken; something else runs there`);
    tmp = mkdtempSync(join(tmpdir(), "sol-try-"));
    mkdirSync(join(tmp, "state"), { recursive: true });
    makeHome(c.path, tmp);
    mkdirSync(join(mac, "node_modules", ".sol-try"), { recursive: true });
    writeFileSync(join(mac, "node_modules", ".sol-try", "vite.config.mjs"), faceConfig());
    const s = secondSol(c.path, tmp);
    const ended = (name: string, last: string) => {
      if (trying !== mine) return;
      say({ step: name, done: true, ok: false, line: `it stopped by itself: ${last}` });
      void stopTry();
    };
    await step("engine", `starting on ${TRY_ENGINE}`, async () => {
      launchAll([s.engine], ended);
      if (!(await answers(`http://127.0.0.1:${TRY_ENGINE}/health`, 60_000, () => procs.has("engine") && !gone(procs.get("engine")!)))) throw new Error(`it did not answer on ${TRY_ENGINE}`);
      return `up on ${TRY_ENGINE}, its own state and an empty home`;
    });
    await step("face", `starting on ${TRY_FACE}`, async () => {
      launchAll([s.face], ended);
      if (!(await answers(`http://127.0.0.1:${TRY_FACE}/`, 60_000, () => procs.has("face") && !gone(procs.get("face")!)))) throw new Error(`it did not answer on ${TRY_FACE}`);
      return `up on ${TRY_FACE}, talking to ${TRY_ENGINE}`;
    });
    if (trying !== mine) throw new Error("stopped");
    mine.up = true;
    sayState();
    return { ok: true, path: c.path, branch: c.branch, engine: TRY_ENGINE, face: TRY_FACE };
  } catch (e) {
    if (trying === mine) await stopTry();
    return { error: firstLine(e) };
  } finally { leave(); }
}

// ---- the review seat on the PR, and the PR's own moves ----

/** the review of the PR's branch against its base, in its copy; the remarks go out as team.try.review.item */
export async function reviewTry(repo: string, pr: number, repoDir: string | undefined) {
  const path = trying?.repo === repo && trying.pr === pr && trying.path ? trying.path : repoDir ? tryCopyPath(repoDir, prefs().wtDir, pr) : "";
  if (!path || !existsSync(path)) return { error: `no copy of #${pr} here yet; try it first` };
  return review({ sessionId: reviewId(repo, pr), cwd: path, scope: "all" }, (m: any) => {
    if (m?.type === "work.item") bus({ type: "team.try.review.item", repo, pr, item: m.item });
  });
}
export const reviewItems = (repo: string, pr: number) => withReviews(reviewId(repo, pr), []);

/** gh pr ready: the person's hand, signed with their login */
export async function markReady(repo: string, pr: number) {
  const login = await myLogin();
  if (!login) return { error: "who am I? sign in to GitHub (Settings, my accounts)" };
  try { await gh(["pr", "ready", String(pr), "--repo", repo]); } catch (e) { return { error: firstLine(e) }; }
  return { ok: true, by: signature(getTeam(), false) };
}

/** a comment on the PR, signed: the seat's words (a remark) as my agent, the person's as the person */
export async function commentPr(a: { repo: string; pr: number; body: string; path?: string; line?: number; remark?: string }) {
  const login = await myLogin();
  if (!login) return { error: "who am I? sign in to GitHub (Settings, my accounts)" };
  const agent = !!a.remark;
  if (agent && !mayAgentSpeak(getTeam(), "github")) return { error: "My agent may not speak on GitHub (Settings, my agent)." };
  const by = signature(getTeam(), agent);
  const text = a.body.trim().slice(0, 60_000);
  if (!text) return { error: "nothing to say" };
  let inline = false, url = "";
  if (a.path && a.line && a.line > 0) {
    try {
      const sha = (await prInfo(a.repo, a.pr)).headRefOid;
      url = JSON.parse(await gh(["api", "-X", "POST", `repos/${a.repo}/pulls/${a.pr}/comments`,
        "-f", `body=${signed(text, by)}`, "-f", `commit_id=${sha}`, "-f", `path=${a.path}`, "-F", `line=${a.line}`, "-f", "side=RIGHT"])).html_url ?? "";
      inline = true;
    } catch { /* GitHub refuses a line outside the diff: a plain comment naming it */ }
  }
  if (!inline) {
    const where = a.path ? `\`${a.path}${a.line ? `:${a.line}` : ""}\`\n\n` : "";
    try { url = lastLine(await gh(["pr", "comment", String(a.pr), "--repo", a.repo, "--body", signed(where + text, by)])); }
    catch (e) { return { error: firstLine(e) }; }
  }
  if (a.remark) markReview(reviewId(a.repo, a.pr), a.remark, "sent", (m: any) => { if (m?.type === "work.item") bus({ type: "team.try.review.item", repo: a.repo, pr: a.pr, item: m.item }); });
  return { ok: true, by, inline, ...(url ? { url } : {}) };
}
