// Sol's own gh, and GitHub signed in from a card (#174, PROTOCOL.md round 42).
//
// Where gh lives: whatever PATH finds first, else Sol's own copy in ~/.sol/gh (sol/setup fetches it, checksum checked,
// when the machine has none), else Homebrew's. Every part of the engine spawns gh by the bare name, so when PATH finds
// no gh, ownGhOnPath puts ~/.sol/gh/bin on this process's PATH: at start (src/index.ts), and again at a sign-in, an
// accounts read and fillMe, so a gh that sol/setup fetched after the engine started is found without a restart. Every
// child inherits it: execFile("gh"), the seats' shells.
//
// git's credential helper is never set for the person (no `gh auth setup-git`: it rewrites ~/.gitconfig, clears the
// person's own helper for github.com and writes gh's path there). Where Sol runs git against github.com itself, gh is
// the helper for that run only (ghHelper: `-c`), or kept in the config of a room's clone, Sol's own folder (`--config`).
//
// The sign-in is gh's device flow, run by the engine with no terminal: `gh auth login --web` prints a one-time code
// and https://github.com/login/device on stderr, then polls GitHub itself until the person has typed the code there
// (no "Press Enter"), and exits 0. The face shows the code and a button that opens the page; gh keeps the token in its
// own store, so no token ever passes through Sol. A GH_TOKEN or GITHUB_TOKEN in the engine's environment would win over
// any sign-in (accounts, fillMe and every gh call use it), so then the card refuses and says so.
//
// Does gh open a browser by itself here? No. Checked 2026-10-24 with gh 2.97.0 (Homebrew) and 2.103.2 (Sol's own),
// GH_CONFIG_DIR in /tmp, stdin from /dev/null and stdout and stderr to files (as below), GH_BROWSER and BROWSER set to a
// script that writes down any call: the two lines came, the script was never called (gh opens a browser only when it
// can prompt, on a terminal). So nothing is set to stop it; the face's "open github.com" is the only way the page opens.
// gh 2.103 does copy the code to the clipboard itself ("One-time code (…) copied to clipboard"); the card's copy
// button copies the same code again.
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { getTeam, fillMe } from "./settings.js";

export const OWN_GH = join(homedir(), ".sol", "gh");
export const OWN_GH_BIN = join(OWN_GH, "bin");
const binOf = (env: NodeJS.ProcessEnv) => (env.HOME ? join(env.HOME, ".sol", "gh", "bin") : OWN_GH_BIN);
// a gh is a file that can run: not a folder named gh, not a file without its x bit
const isGh = (p: string) => { try { return statSync(p).isFile() && (accessSync(p, constants.X_OK), true); } catch { return false; } };

/** ~/.sol/gh/bin first on PATH when Sol's own gh is there and PATH finds no gh (PATH's gh comes first, as in setup);
 * true when it was added. Cheap, and safe to call again: once it is there PATH finds a gh */
export function ownGhOnPath(env: NodeJS.ProcessEnv = process.env): boolean {
  const bin = binOf(env);
  if (!isGh(join(bin, "gh"))) return false;
  const path = env.PATH ?? "";
  if (path.split(delimiter).some((dir) => dir && isGh(join(dir, "gh")))) return false;
  env.PATH = path ? `${bin}${delimiter}${path}` : bin;
  return true;
}

/** where gh may be: PATH's, Sol's own, Homebrew's (launchd's PATH is short) */
export const ghPlaces = (env: NodeJS.ProcessEnv = process.env): string[] => ["gh", ...[join(binOf(env), "gh"), "/opt/homebrew/bin/gh", "/usr/local/bin/gh"].filter(isGh)];

// the first place that holds a gh: a bare name is looked up on PATH, a path must be one
function findGh(places: string[], env: NodeJS.ProcessEnv): string | null {
  for (const p of places) {
    if (p.includes("/")) { if (isGh(p)) return p; continue; }
    for (const dir of (env.PATH ?? "").split(delimiter)) if (dir && isGh(join(dir, p))) return join(dir, p);
  }
  return null;
}

/** git's flags that make gh the only credential helper for github.com (the first, empty, clears the person's own):
 *  `-c` for one run, `--config` after `clone` to keep them in the new clone's own config. gh by its full path (launchd's
 *  PATH is short), quoted for the shell git runs a `!` helper with; a bare "gh" when none is found */
export function ghHelper(flag: "-c" | "--config" = "-c", gh = findGh(ghPlaces(), process.env) ?? "gh"): string[] {
  const key = "credential.https://github.com.helper";
  return [flag, `${key}=`, flag, `${key}=!'${gh.replace(/'/g, `'\\''`)}' auth git-credential`];
}

// ---- the device flow, one in flight per engine ----

export type Connect = { code: string; url: string; at: number };
type Result = Connect | { error: string };
type Heard = { login: string } | { error: string };
/** for tests only: how to spawn, where gh may be, the clock, how long to wait for the code, how long for the person,
 *  what fills `me` */
export type Deps = {
  spawn?: typeof nodeSpawn; gh?: string[]; now?: () => number;
  wait?: number; cap?: number; fill?: () => Promise<unknown>;
};

const DEVICE_MS = 15 * 60_000;   // a device code lives 15 minutes
const CAP_MS = 16 * 60_000;      // a gh still waiting a minute after its code died is stopped
// gh 2.97 says "First copy your one-time code: 8C7F-CB36"; gh 2.103 "One-time code (94E3-62FD) copied to clipboard"
const CODE_RE = /one-time code\W*([A-Z0-9]{4}-[A-Z0-9]{4})/i;
// only gh's device page: with GH_DEBUG=api the first https on stderr is …/login/device/code
const URL_RE = /(https:\/\/github\.com\/login\/device)(?![\w/])/;
export const NO_GH = "Sol has no GitHub CLI here: bash sol/setup fetches its own";
const TOKEN_SET = (name: string) => `${name} is set in Sol's environment; gh uses it instead of a sign-in`;
const KILL_AFTER_MS = 3_000;

// finishing: gh is done and the login is being read; still the one sign-in, so a second press starts no second gh
type Live = { child: ChildProcess; at: number; code?: string; url?: string; quiet: boolean; finishing: boolean; ready: Promise<Result>; settle: (r: Result) => void };
let live: Live | null = null;
const heard = new Set<(r: Heard) => void>();
const tell = (r: Heard) => { for (const f of heard) { try { f(r); } catch { /* one listener's throw is its own */ } } };

/** told once per sign-in that ended: the login, or what went wrong; a cancel too ({ error: "cancelled" }), so every
 * window's card closes or says so */
export function onConnect(fn: (r: Heard) => void): () => void { heard.add(fn); return () => { heard.delete(fn); }; }

/** the code and the page to type it in; a sign-in already waiting (younger than 15 minutes) gives its own code again */
export function startConnect(d: Deps = {}): Promise<Result> {
  const now = d.now ?? Date.now;
  if (live && (live.finishing || now() - live.at < DEVICE_MS)) return live.ready;
  if (live) cancelConnect();   // its code has expired: a fresh one
  for (const t of ["GH_TOKEN", "GITHUB_TOKEN"]) if (process.env[t]) return Promise.resolve({ error: TOKEN_SET(t) });
  ownGhOnPath();   // a gh sol/setup fetched since the engine started
  const env: NodeJS.ProcessEnv = { ...process.env, GH_NO_UPDATE_NOTIFIER: "1", GH_PROMPT_DISABLED: "1" };
  delete env.GH_DEBUG;   // its lines would only be in the way of the two we read
  const bin = findGh(d.gh ?? ghPlaces(), env);
  if (!bin) return Promise.resolve({ error: NO_GH });
  const spawn = d.spawn ?? nodeSpawn;
  const child = spawn(bin, ["auth", "login", "--hostname", "github.com", "--web", "--git-protocol", "https", "--skip-ssh-key"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let answer: (r: Result) => void = () => {};
  const me: Live = { child, at: now(), quiet: false, finishing: false, ready: new Promise<Result>((ok) => { answer = ok; }), settle: (r) => settle(r) };
  live = me;
  let answered = false, last = "", rest = "";
  const settle = (r: Result) => { if (!answered) { answered = true; clearTimeout(timer); answer(r); } };
  const timer = setTimeout(() => {
    me.quiet = true; stop(child);
    if (live === me) live = null;
    settle({ error: `gh gave no code: ${last || "it said nothing"}` });
  }, d.wait ?? 20_000);
  // the hard stop: a code nobody typed has died, and a gh still polling past it is stopped, every face told
  const cap = setTimeout(() => {
    if (me.quiet) return;
    me.quiet = true; stop(child);
    if (live === me) live = null;
    const error = "the code was not entered in time: press sign in again";
    settle({ error });
    tell({ error });
  }, d.cap ?? CAP_MS);
  cap.unref();
  child.stdout?.resume();   // drained; gh says nothing there in this flow
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (s: string) => {
    const lines = (rest + s).split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) continue;
      last = l;
      me.code ??= CODE_RE.exec(l)?.[1]?.toUpperCase();
      me.url ??= URL_RE.exec(l)?.[1];
    }
    if (me.code && me.url) settle({ code: me.code, url: me.url, at: me.at });
  });
  child.on("error", (err) => {   // could not start it at all
    clearTimeout(cap);
    if (live === me) live = null;
    const error = `could not start gh: ${err.message}`;
    settle({ error });
    if (!me.quiet) tell({ error });
    me.quiet = true;   // Node sends close after error: told once
  });
  child.on("close", (code) => {
    if (rest.trim()) last = rest.trim();
    clearTimeout(timer); clearTimeout(cap);
    if ((me.quiet || code !== 0) && live === me) live = null;   // exit 0 keeps it, finishing
    if (me.quiet) return;   // cancelled, or given up for want of a code
    if (code !== 0) {
      const error = last || `gh stopped (exit ${code ?? "by a signal"})`;
      settle({ error });
      return tell({ error });
    }
    settle({ error: `gh gave no code: ${last || "it said nothing"}` });   // in at once, with no code shown: rare
    // signed in; who it is, and only then is the sign-in over (live until the last tell)
    me.finishing = true;
    void whoAmI(spawn, bin, env).then(async (login) => {
      if (login) await (d.fill ?? fillIfEmpty)().catch(() => {});
      if (live === me) live = null;
      tell(login ? { login } : { error: "signed in, but gh did not say who: gh api user gave nothing" });
    });
  });
  return me.ready;
}

/** stops the sign-in waiting, if any; every face is told it was cancelled */
export function cancelConnect(): boolean {
  const c = live;
  if (!c || c.finishing) return false;   // gh is done: the login is on its way
  c.quiet = true;
  live = null;
  stop(c.child);
  c.settle({ error: "cancelled" });   // a start still waiting for its code is answered
  tell({ error: "cancelled" });
  return true;
}

// SIGTERM, and SIGKILL three seconds later if it is still there
function stop(child: ChildProcess) {
  child.kill("SIGTERM");
  setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, KILL_AFTER_MS).unref();
}
// an engine going away takes its waiting gh with it
process.once("exit", () => { live?.child.kill("SIGTERM"); });

// the team settings learn the login (fillMe asks gh for it and the name) when they have none yet
const fillIfEmpty = () => (getTeam().me.login ? Promise.resolve() : fillMe(true));

// `gh api user --jq .login` with the same gh and the same environment
function whoAmI(spawn: typeof nodeSpawn, bin: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((done) => {
    let out = "";
    const c = spawn(bin, ["api", "user", "--jq", ".login"], { env, stdio: ["ignore", "pipe", "pipe"] });
    const t = setTimeout(() => c.kill("SIGTERM"), 15_000);
    c.stdout?.setEncoding("utf8");
    c.stdout?.on("data", (s: string) => { out += s; });
    c.stderr?.resume();
    c.on("error", () => { clearTimeout(t); done(""); });
    c.on("close", (code) => { clearTimeout(t); done(code === 0 ? out.trim().split("\n")[0]?.trim() ?? "" : ""); });
  });
}
