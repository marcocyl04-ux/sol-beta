// A group past its quota on Sol's cloud moves to a private repository of its maker's own (#326, the groups PRD §9.5):
// "connect GitHub to keep going". Two messages:
// - team.room.usage: how full the group's record is (`used / max` of the room, the banner's bar), how many files, whether
//   it is moving now, who its maker is, and the person's own line when their files across groups pass 80% of 50 MB.
// - team.room.take: the move, the reverse of sol/cloud/move, made safe and resumable. The maker only, GitHub signed in.
//   (1) the cloud freezes the group, so no write lands after the copy and is lost; (2) a private repository under my
//   account, named as #160's make names one (`<login>/<slug of the name>`, -2 to -5 when taken, `room-<4 symbols>` for a
//   name GitHub cannot take): the name is written to the manifest before GitHub is asked, so a run that stopped right
//   after the make finds it on the next press (`gh repo view`) instead of making a second; (3) the repository is cloned
//   into ROOMS_DIR/<room id> (letin's clone), every `.sol/` file of the cloud is written there (each checked against the
//   cloud's SHA-256 as it is read, and none whose name a Mac's disk cannot tell from another's), ONE commit, one push
//   (never a commit a file: GitHub's secondary limit; a second run amends the take's own commit and pushes with a lease);
//   (4) the push is read back: GitHub's tree of that commit, each blob's git sha against the local file's, computed here
//   as `git hash-object` does (the blob API, never the contents API, which says nothing above 1 MB); (5) the cloud gets
//   `.sol/moved.json` { to: "github", repo, at } in the maker's name, which the cloud saves as the group's move, and
//   thaws; (6) my room becomes a GitHub room, `provider: "github"`, `repos: [repo]`, its code and hub kept.
// Each step is written to a manifest, `<state>/cloud/takes/<room id>.json` (0600), as it is done, with each file's
// SHA-256, and each is safe to run twice, so a second press resumes at the first step not done. A run that stops before
// (5) thaws the group again and goes back to the copy, since a teammate may write meanwhile; a resume that finds the
// cloud's files differ from the manifest's copies again too (a freeze that thawed itself while this Sol was off). The
// repository is kept. Nothing is deleted on the cloud. git runs with the person's autocrlf, attributes and hooks off, so
// the blob GitHub keeps is the cloud's bytes. The cloud's own `.sol/moved.json` is never copied: on GitHub that file is a
// move's word in the owner's commit (#246).
// Everything it touches is handed in, so the tests run with a fake cloud, a fake gh and a temp git repository.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { RoomRecord } from "./record.js";
import type { CloudUsage } from "./record/cloud.js";
import { recordOf, slug, type Room, type TeamSettings } from "./settings.js";
import { tag } from "./record/github.js";
import { MOVED_PATH, GH_LOGIN, ownedRepo } from "./moved.js";

export const TAKE_COMMIT = "the group's record, moved from the cloud (#326)";
/** the share of a room's quota, or of a person's 50 MB, past which the face says so */
export const NEAR = 0.8;
const MB = 1024 * 1024;
// a path the cloud gives is still checked before it is written on this Mac: under .sol/, plain names, no `..`
const PATH = /^\.sol\/(?:[A-Za-z0-9_][A-Za-z0-9._ -]*\/)*[A-Za-z0-9_][A-Za-z0-9._ -]*$/;

/** the cloud room's calls (record/cloud.ts cloudRoomCalls) */
export type CloudCalls = {
  usage: (repo: string) => Promise<CloudUsage>;
  freeze: (repo: string, on: boolean) => Promise<boolean>;
  maker: (repo: string) => Promise<string>;
};

export type UsageDeps = {
  team: () => TeamSettings;
  cloud: CloudCalls;
  me: (room: Room) => string;              // my name on the room's hub (relay.ts hubLogin)
};

export type TakeDeps = UsageDeps & {
  patch: (p: Record<string, unknown>) => TeamSettings;
  files: () => Pick<RoomRecord, "files">;  // the record that picks by the repo (record.ts record()): the cloud's for `cloud:`
  github: {
    login: () => Promise<string>;                     // my GitHub login; a throw or "" when gh is not signed in
    view: (repo: string) => Promise<{ private: boolean } | null>;   // gh repo view: null when there is none, a throw when GitHub did not say
    create: (repo: string, name: string) => Promise<void>;          // gh repo create <repo> --private --add-readme
    tree: (repo: string, sha: string) => Promise<string>;   // gh api repos/<r>/git/trees/<sha>?recursive=1
  };
  git: (args: string[], cwd: string) => Promise<string>;     // letin.ts gitQuiet
  cloneArgs?: () => string[];                // git's flags for the clone (letin.ts cloneAuth)
  url?: (repo: string) => string;            // where the clone comes from (the tests: a bare repository on disk)
  dir: string;                               // where the manifests are kept (<state>/cloud/takes)
  roomsDir: string;                          // where rooms are cloned (settings.ts ROOMS_DIR)
  now?: () => Date;
};

export type Usage = { room: string; used: number; max: number; files: number; frozen: boolean; maker: string; mine: boolean; warn?: string };
/** a take's manifest: the last step done, the repository named (`want`, before GitHub is asked) and made, the clone, the
 *  commit, and each file copied with its git sha and the cloud's SHA-256 */
export type Manifest = { v: 1; room: string; code: string; name: string; step: number; want: string; repo: string; folder: string; commit: string;
  files: { path: string; sha: string; sha256: string }[]; at: string };
export type Taken = { room: Room; repo: string; folder: string; files: number; already?: true };

/** the steps, as the manifest counts them: the last one done */
export const STEP = { frozen: 1, made: 2, pushed: 3, checked: 4, marked: 5, switched: 6 } as const;

const line = (e: unknown) => String((e as Error)?.message ?? e).split("\n").map((l) => l.trim()).filter((l) => l && !/^Command failed:/.test(l))[0]?.replace(/\s*\(HTTP \d{3}\)\s*$/, "").slice(0, 200) || "it failed";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** a file's git blob sha, as `git hash-object` gives it (pure) */
export const blobSha = (b: Uint8Array) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
/** git with nothing of the person's that could change a blob or run something: no autocrlf, no attributes, no hooks */
export const SAFE_GIT = ["-c", "core.autocrlf=false", "-c", "core.attributesFile=/dev/null", "-c", "core.hooksPath=/dev/null"];

/** two paths a disk that does not tell capitals apart cannot hold side by side: the same name in other capitals, a file
 *  where the other has a folder, or a folder on the way in other capitals; the first such pair, or null (pure) */
export function clashOf(paths: string[]): [string, string] | null {
  const seen: string[] = [];
  for (const p of paths) {
    const lp = p.toLowerCase(), mine = p.split("/");
    for (const q of seen) {
      const lq = q.toLowerCase(), theirs = q.split("/");
      if (lp === lq || lq.startsWith(lp + "/") || lp.startsWith(lq + "/")) return [q, p];
      for (let i = 0; i < Math.min(mine.length, theirs.length) - 1 && mine[i].toLowerCase() === theirs[i].toLowerCase(); i++) if (mine[i] !== theirs[i]) return [q, p];
    }
    seen.push(p);
  }
  return null;
}

/** the person's own line when their files across groups pass NEAR of their limit, else "" (pure) */
export function mineLine(used: number, max: number): string {
  if (!max || used < max * NEAR) return "";
  return `your files in groups are ${Math.round(used / MB)} of ${Math.round(max / MB)} MB; remove some, or put big ones on Google Drive`;
}

const roomOf = (s: TeamSettings, id?: unknown) => s.rooms.find((r) => r.id === (typeof id === "string" && id ? id : s.room));

/** how full a cloud group is (team.room.usage): null for a group whose record is not on the cloud */
export async function usageOf(d: UsageDeps, id?: unknown): Promise<Usage | null | { error: string }> {
  const r = roomOf(d.team(), id);
  if (!r) return { error: "which group?" };
  if (r.provider !== "cloud") return null;
  const rec = recordOf(r);
  try {
    const [u, maker] = await Promise.all([d.cloud.usage(rec), d.cloud.maker(rec)]);
    const me = d.me(r), warn = mineLine(u.mine, u.mineMax);
    return { room: r.id, used: u.used, max: u.max, files: u.files.length, frozen: u.frozen, maker, mine: !!me && !!maker && same(me, maker), ...(warn ? { warn } : {}) };
  } catch (e) { return { error: `couldn't read how full the group is: ${line(e)}` }; }
}

// ---- the manifest ----

const manifestFile = (dir: string, id: string) => join(dir, `${id}.json`);

/** the manifest of a room's take, or null when there is none (or it is not one Sol wrote) */
export function readManifest(dir: string, id: string): Manifest | null {
  try {
    const v = JSON.parse(readFileSync(manifestFile(dir, id), "utf8")) as Manifest;
    if (v?.v !== 1 || v.room !== id || !Number.isInteger(v.step) || !Array.isArray(v.files)) return null;
    return { ...v, want: ownedRepo(v.want ?? "") ? v.want : "", repo: ownedRepo(v.repo ?? "") ? v.repo : "", files: v.files.map((f) => ({ path: String(f?.path ?? ""), sha: String(f?.sha ?? ""), sha256: String(f?.sha256 ?? "") })), folder: typeof v.folder === "string" ? v.folder : "", commit: /^[0-9a-f]{40}$/.test(v.commit ?? "") ? v.commit : "" };
  } catch { return null; }
}

function keep(dir: string, m: Manifest) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = manifestFile(dir, m.room), tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(m, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, f);   // never a half-written manifest
  try { chmodSync(f, 0o600); } catch { /* written 0600 */ }
}

// ---- the take ----

const taking = new Set<string>();   // one take a room at a time
/** for the tests: nothing taking */
export const resetTake = () => taking.clear();

/** the move to GitHub (team.room.take): the maker only, GitHub signed in. `need: "github"` when it is not, so the face
 *  shows the card first. A run that stops says where in one line and keeps the manifest for the next */
export async function takeRoom(d: TakeDeps, id?: unknown): Promise<Taken | { error: string; need?: "github"; step?: number }> {
  const s = d.team(), r = roomOf(s, id);
  if (!r) return { error: "which group?" };
  const had = readManifest(d.dir, r.id);
  // done before: the room is the repository's now, and a second press says so
  if (r.provider === "github" && had && had.step >= STEP.switched && same(r.repos[0] ?? "", had.repo))
    return { room: r, repo: had.repo, folder: had.folder, files: had.files.length, already: true };
  if (r.provider !== "cloud") return { error: "only a group on Sol's cloud moves to GitHub" };
  if (taking.has(r.id)) return { error: "the group is moving already" };
  taking.add(r.id);
  try { return await take(d, r, had); }
  finally { taking.delete(r.id); }
}

async function take(d: TakeDeps, r: Room, had: Manifest | null): Promise<Taken | { error: string; need?: "github"; step?: number }> {
  const rec = recordOf(r);
  // the maker only: the cloud's word on who made it, never this Sol's own
  const maker = await d.cloud.maker(rec).catch(() => "");
  const me = d.me(r);
  if (!maker) return { error: "couldn't ask the cloud who made the group; try again" };
  if (!me || !same(me, maker)) return { error: `only ${maker} moves the group; ask them to connect GitHub` };
  const login = (await d.github.login().catch(() => "")).trim();
  if (!GH_LOGIN.test(login)) return { error: "connect GitHub first", need: "github" };

  const m: Manifest = had && had.code === r.code ? had
    : { v: 1, room: r.id, code: r.code, name: r.name, step: 0, want: "", repo: "", folder: "", commit: "", files: [], at: (d.now?.() ?? new Date()).toISOString() };
  const done = (step: number) => { m.step = Math.max(m.step, step); keep(d.dir, m); };
  try {
    // (1) frozen, every run until the cloud says where the files went (a freeze thaws itself after an hour)
    if (m.step < STEP.marked) { await d.cloud.freeze(rec, true); done(STEP.frozen); }
    // a copy read back on a run before, and the cloud changed since (its freeze thawed while this Sol was off): copied again
    if (m.step >= STEP.checked && m.step < STEP.marked && differs((await d.cloud.usage(rec)).files, m.files)) { m.step = STEP.made; keep(d.dir, m); }
    // (2) the repository, made once: named first, then made, or found when a run before made it and stopped
    if (!m.repo) {
      if (!m.want) { m.want = await freeName(d, login, r.name); keep(d.dir, m); }
      const there = await d.github.view(m.want);
      if (there && !there.private) throw new Error(`${m.want} is not private; make it private on GitHub, or move it out of the way, and press it again`);
      if (!there) await d.github.create(m.want, r.name);
      m.repo = m.want;
      done(STEP.made);
    }
    // (3) the copy, one commit, one push; (4) read back. Both again on every run that has not marked the cloud
    if (m.step < STEP.checked) {
      await copy(d, r, m, login);
      done(STEP.pushed);
      const bad = await readBack(d, m);
      if (bad) { m.step = STEP.made; keep(d.dir, m); throw new Error(`the copy on GitHub does not match the group's files (${bad}); press it again`); }
      done(STEP.checked);
    }
    // (5) the cloud says where the files went, in the maker's name, and thaws
    if (m.step < STEP.marked) { await mark(d, rec, m, me); done(STEP.marked); }
    await d.cloud.freeze(rec, false);
  } catch (e) {
    // stopped before the cloud was marked: thawed again, since a teammate may write before the next press, which copies
    // anew (the repository is kept)
    if (m.step < STEP.marked) {
      await d.cloud.freeze(rec, false).catch(() => {});
      if (m.step > STEP.made) m.step = STEP.made;
      keep(d.dir, m);
    }
    return { error: line(e), step: m.step };
  }
  // (6) my room is the repository's now, its code and hub kept
  const room = switchRoom(d, r.id, m.repo, m.folder);
  done(STEP.switched);
  return { room, repo: m.repo, folder: m.folder, files: m.files.length };
}

/** does the cloud's list differ from the files the manifest copied (pure): a path more or less, or other bytes */
export function differs(list: { path: string; sha: string }[], copied: Manifest["files"]): boolean {
  const now = list.filter((f) => f.path !== MOVED_PATH);
  if (now.length !== copied.length) return true;
  const had = new Map(copied.map((f) => [f.path, f.sha256]));
  return now.some((f) => had.get(f.path) !== f.sha);
}

/** the repository's name, as #160's make names one: `<login>/<slug>`, then -2 to -5 when GitHub has one of that name
 *  already; a name with no letters or digits GitHub can take is `room-` and four symbols */
async function freeName(d: TakeDeps, login: string, name: string): Promise<string> {
  const root = slug(name) || `room-${tag()}`;
  for (let i = 1; i <= 5; i++) {
    const repo = `${login}/${i === 1 ? root : `${root.slice(0, 36)}-${i}`}`;
    if (!(await d.github.view(repo))) return repo;
  }
  throw new Error("you have five repositories of that name already; rename the group and press it again");
}

/** my copy of a room, a GitHub room now: the repository, its code and hub kept (a GitHub room with a code on the cloud's
 *  hub, as #157 made). `mine` once its repos are mine: the patch that changes a room's repos unmarks it (settings.ts
 *  unmine), so the maker's own room is marked again after */
export function switchRoom(d: Pick<TakeDeps, "team" | "patch">, id: string, repo: string, folder: string, mine = true): Room {
  const to = (x: Room) => ({ ...x, provider: "github", org: "", repos: [repo], folder, ...(mine ? {} : { mine: false, joined: true }) });
  let s = d.patch({ rooms: d.team().rooms.map((x) => (x.id === id ? to(x) : x)) });
  if (mine && s.rooms.some((x) => x.id === id && !x.mine)) s = d.patch({ rooms: s.rooms.map((x) => (x.id === id ? { ...x, mine: true } : x)) });
  return s.rooms.find((x) => x.id === id)!;
}

/** the repository's folder on this Mac: the manifest's, else ROOMS_DIR/<room id> (then -2, -3) cloned now; one there
 *  already whose origin is the repository is reused */
async function place(d: TakeDeps, r: Room, m: Manifest): Promise<string> {
  const url = (d.url ?? ((repo: string) => `https://github.com/${repo}.git`))(m.repo);
  const origin = (dir: string) => d.git(["remote", "get-url", "origin"], dir).then((o) => o.trim(), () => "");
  const ours = async (dir: string) => existsSync(join(dir, ".git")) && same(await origin(dir), url);
  if (m.folder && await ours(m.folder)) return m.folder;
  mkdirSync(d.roomsDir, { recursive: true, mode: 0o700 });
  for (let i = 1; i <= 20; i++) {
    const at = join(d.roomsDir, i === 1 ? r.id : `${r.id}-${i}`);
    if (existsSync(at)) { if (await ours(at)) return at; continue; }
    await d.git([...SAFE_GIT, "clone", ...(d.cloneArgs?.() ?? []), "--quiet", url, at], d.roomsDir);
    return at;
  }
  throw new Error(`no free folder in ${d.roomsDir}`);
}

/** every file under a folder's `.sol/`, as paths from the folder */
function solFiles(folder: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let all: import("node:fs").Dirent[] = [];
    try { all = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of all) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(folder, p).split(sep).join("/"));
    }
  };
  walk(join(folder, ".sol"));
  return out;
}

/** (3) every `.sol/` file of the cloud written into the clone, the ones the cloud no longer has taken out, one commit,
 *  one push. A second run amends the take's own commit (one commit, ever) and pushes it with a lease. The manifest learns
 *  each file's git sha and SHA-256, and the commit */
async function copy(d: TakeDeps, r: Room, m: Manifest, login: string) {
  const rec = recordOf(r);
  m.folder = await place(d, r, m);
  keep(d.dir, m);
  const list = (await d.cloud.usage(rec)).files.filter((f) => f.path !== MOVED_PATH);
  const root = resolve(m.folder);
  for (const f of list) {
    const to = resolve(root, f.path);
    if (!PATH.test(f.path) || f.path.split("/").some((x) => x === ".." || x === ".") || !to.startsWith(root + sep)) throw new Error(`the cloud named a file Sol does not write (${f.path.slice(0, 80)})`);
  }
  // a Mac's disk does not tell capitals apart: two names it would make one are said before anything is written
  const clash = clashOf(list.map((f) => f.path));
  if (clash) throw new Error(`two of the group's files are one on this Mac's disk (${clash[0]} and ${clash[1]}); rename one in the group and press it again`);
  const files: Manifest["files"] = [];
  for (const f of list) {
    const bytes = await d.files().files.bytes(rec, f.path, "main");
    if (sha256(bytes) !== f.sha) throw new Error(`${f.path} changed while it was read; press it again`);
    const to = resolve(root, f.path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, bytes);
    files.push({ path: f.path, sha: blobSha(bytes), sha256: f.sha });
  }
  const want = new Set(files.map((f) => f.path));
  for (const p of solFiles(m.folder)) if (!want.has(p)) rmSync(join(m.folder, p), { force: true });
  m.files = files.sort((a, b) => a.path.localeCompare(b.path));
  const git = (args: string[]) => d.git([...SAFE_GIT, ...args], m.folder);
  if (existsSync(join(m.folder, ".sol"))) await git(["add", "-A", "--", ".sol"]);
  let lease = false;
  if ((await git(["status", "--porcelain", "--", ".sol"])).trim()) {
    // the person's own name when git knows one; else their GitHub login, for this commit only (never their config)
    const named = (await git(["config", "user.email"]).catch(() => "")).trim();
    const who = named ? [] : ["-c", `user.name=${login}`, "-c", `user.email=${login}@users.noreply.github.com`];
    // the take's own commit there already (a run before pushed it): amended, so the group's record is one commit
    const again = (await git(["log", "-1", "--format=%s"]).catch(() => "")).trim() === TAKE_COMMIT;
    await git([...who, "commit", "--quiet", ...(again ? ["--amend"] : []), "-m", TAKE_COMMIT]);
    lease = again;
  }
  await git(["push", "--quiet", ...(lease ? ["--force-with-lease"] : []), "origin", "HEAD"]);
  m.commit = (await git(["rev-parse", "HEAD"])).trim();
}

/** (4) GitHub's tree of the pushed commit against the files written: the first path that differs, or "" */
async function readBack(d: TakeDeps, m: Manifest): Promise<string> {
  let v: { tree?: { path?: unknown; type?: unknown; sha?: unknown }[]; truncated?: unknown };
  try { v = JSON.parse(await d.github.tree(m.repo, m.commit)); } catch (e) { throw new Error(`couldn't read the repository back: ${line(e)}`); }
  if (v.truncated === true) return "GitHub's list was cut short";
  const blobs = new Map((v.tree ?? []).filter((x) => x.type === "blob" && typeof x.path === "string" && x.path.startsWith(".sol/")).map((x) => [x.path as string, String(x.sha ?? "")]));
  for (const f of m.files) {
    let here = "";
    try { here = blobSha(readFileSync(join(m.folder, f.path))); } catch { /* gone */ }
    if (here !== f.sha || blobs.get(f.path) !== here) return f.path;
  }
  for (const p of blobs.keys()) if (!m.files.some((f) => f.path === p)) return p;
  return "";
}

/** (5) `.sol/moved.json` on the cloud, { to: "github", repo, at }, written as the version it replaces. Left as it is
 *  only when the cloud's saved move already says this repository and me; then read back from the cloud's saved move */
async function mark(d: TakeDeps, rec: string, m: Manifest, me: string) {
  const saved = (await d.cloud.usage(rec)).moved;
  if (saved && same(saved.repo, m.repo) && same(saved.by, me)) return;
  const f = d.files().files;
  let sha: string | undefined;
  try { sha = (JSON.parse(await f.readSha(rec, MOVED_PATH, "main")) as { sha?: string }).sha; }
  catch (e) { if (!/\(HTTP 404\)|Not Found/.test(String((e as { full?: string })?.full ?? (e as Error)?.message))) throw e; }
  const note = JSON.stringify({ v: 1, to: "github", repo: m.repo, at: (d.now?.() ?? new Date()).toISOString() }, null, 2) + "\n";
  await f.putBody(rec, MOVED_PATH, { message: "moved to GitHub", branch: "main", content: Buffer.from(note).toString("base64"), ...(sha ? { sha } : {}) });
  const now = (await d.cloud.usage(rec)).moved;
  if (!now || !same(now.repo, m.repo) || !same(now.by, me)) throw new Error("the cloud did not keep where the group moved; press it again");
}
