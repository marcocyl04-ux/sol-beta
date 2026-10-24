// Share (#36, design/together/6-share/PRD.md, PROTOCOL.md round 23): shared with me. The team's things, read from the
// team's repositories and never from anyone's home:
//   product memory  docs/**, GLOSSARY.md, now.md, README.md
//   designs         sol/design/** (folders are the groups; images, markdown, html; scripts and videos stay out)
//   desk cards      sol/design/shared/*.json, on the default branch and on every person's branch `<login>/shared`
// Each entry carries who shared it (the last commit that touched the file, signed: a person, or that person's agent) and
// when. GitHub is read with `gh` (gh's own sign-in, never a token in Sol): the tree once per repo per refresh, a file's
// text by its blob sha (kept, so a file read once is never read again until it changes), the last commits in batches
// over GraphQL, all cached 60 s like board.ts. My own checkout of a repo (the folder teamFolders() knows) is read from
// disk instead, so what I just saved shows at once.
// A card the seat makes with `shared: true` (desk_show) is written as sol/design/shared/<id>.json with only the card's
// own fields (what the person did on it stays home) and committed on `<login>/shared` with the message
// "desk: share <title>" and the agent's signature, then pushed. The commit is made beside the working tree (git's
// plumbing, a temporary index), so the checkout's branch, index and files are never touched.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, stat, lstat, realpath, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join, extname, basename, sep } from "node:path";
import { tmpdir } from "node:os";
import { getTeam, signature, myLogin, mayAgentSpeak } from "./settings.js";
import { agentMark, type Sign } from "./board.js";
import { onRelay, sendRelay } from "./relay.js";
import { join as joinBusy } from "../busy.js";
import type { Card } from "../desk.js";

const run = promisify(execFile);
const ENV = () => ({ ...process.env, GIT_TERMINAL_PROMPT: "0" });

/** a file of my checkout as it may be read: a plain file whose real place is inside the checkout, never a symlink (a
 * tracked `docs/x.md -> ../sol/home/...` would read the home), else null (Codex review) */
export async function within(root: string, rel: string): Promise<string | null> {
  try {
    const parts = rel.split(/[\\/]+/).filter(Boolean);
    if (!parts.length || parts.includes("..")) return null;
    // every folder on the way too: `docs/alias -> sol/home` stays inside the checkout and would still read the home
    let abs = root;
    for (const part of parts) { abs = join(abs, part); if ((await lstat(abs)).isSymbolicLink()) return null; }
    const [r, f] = await Promise.all([realpath(root), realpath(abs)]);
    if (f !== r && !f.startsWith(r + sep)) return null;
    return (await stat(f)).isFile() ? abs : null;
  } catch { return null; }
}

export type Kind = "md" | "image" | "html" | "json" | "other";
export type Place = "memory" | "designs" | "cards";
export type Entry = { path: string; title: string; kind: Kind; by?: Sign; at?: string; group?: string; local?: string; ref?: string; sha?: string };
export type RepoShare = { repo: string; from: "checkout" | "github"; folder?: string; memory: Entry[]; designs: Entry[]; cards: Entry[]; error?: string };
export type Shared = { repos: RepoShare[]; at: number };
export type Opened = { text?: string; image?: string; url?: string; card?: Card; local?: string; error?: string };

// ---- the pure part: which paths count, their kind, group and title, and the card's file (tested) ----

const IMAGES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]);
const CODE = new Set([".mjs", ".cjs", ".js", ".jsx", ".ts", ".tsx", ".css", ".map", ".lock", ".sh", ".py", ".mp4", ".webm", ".mov", ".m4a", ".wav"]);
const ROOT_MEMORY = ["README.md", "now.md", "GLOSSARY.md"];
export const SHARED_DIR = "sol/design/shared";

export function kindOf(path: string): Kind {
  const x = extname(path).toLowerCase();
  if (x === ".md" || x === ".markdown") return "md";
  if (IMAGES.has(x)) return "image";
  if (x === ".html" || x === ".htm") return "html";
  if (x === ".json") return "json";
  return "other";
}

/** where a path in a repo belongs on "shared with me", or null when it is not shared (pure) */
export function placeOf(path: string): Place | null {
  if (!path || path.startsWith("/") || path.split("/").some((p) => p === ".." || p === "" || p.startsWith("."))) return null;
  if (path.startsWith(SHARED_DIR + "/")) return /^sol\/design\/shared\/[\w.-]+\.json$/.test(path) ? "cards" : null;
  if (ROOT_MEMORY.includes(path)) return "memory";
  const x = extname(path).toLowerCase();
  if (path.startsWith("docs/")) return CODE.has(x) || x === ".json" ? null : "memory";
  if (path.startsWith("sol/design/")) {
    const k = kindOf(path);
    return k === "md" || k === "image" || k === "html" ? "designs" : null;
  }
  return null;
}

/** a design's group: its folder under sol/design, a shots folder (and what is under it) counted as its parent's (pure) */
export function groupOf(path: string): string {
  const dirs = path.replace(/^sol\/design\//, "").split("/").slice(0, -1);
  const at = dirs.indexOf("shots");
  const g = at > 0 ? dirs.slice(0, at) : dirs;
  return g.join("/");
}

const bare = (path: string) => basename(path).replace(/\.[^.]+$/, "");
/** a row's title: a markdown file's first heading, a card's title, else the file's name (pure) */
export function titleOf(path: string, text?: string): string {
  const k = kindOf(path);
  if (k === "md" && text) {
    const h = /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(text.slice(0, 20_000));
    if (h) return h[1].replace(/\*\*|__|`/g, "").trim().slice(0, 140) || bare(path);
  }
  if (k === "json" && text) { const c = cardOfFile(text); if (c) return c.title || c.kind; }
  if (k === "html" && text) { const t = /<title>([^<]{1,140})<\/title>/i.exec(text); if (t) return t[1].trim(); }
  return bare(path);
}

const memRank = (p: string) => { const i = ROOT_MEMORY.indexOf(p); return i < 0 ? 9 : i; };
/** the shared paths of a repo's file list, by place (pure: the tree → entries mapper; titles come later) */
export function sortPaths(paths: string[]): Record<Place, string[]> {
  const out: Record<Place, string[]> = { memory: [], designs: [], cards: [] };
  for (const p of paths) { const k = placeOf(p); if (k) out[k].push(p); }
  out.memory.sort((a, b) => memRank(a) - memRank(b) || a.localeCompare(b));
  out.designs.sort((a, b) => groupOf(a).localeCompare(groupOf(b)) || "mdhtmlimage".indexOf(kindOf(a)) - "mdhtmlimage".indexOf(kindOf(b)) || a.localeCompare(b));
  out.cards.sort();
  return out;
}

/** who moved it last, from a commit: the GitHub login when known, signed as an agent when the commit says so (pure) */
export function signOfCommit(c: { login?: string; name?: string; email?: string; message?: string }, me = "", myEmail = ""): Sign | undefined {
  const noreply = /^(?:\d+\+)?([A-Za-z0-9-]{1,39})@users\.noreply\.github\.com$/i.exec(c.email ?? "");
  const signed = /^signed-by:\s*([A-Za-z0-9-]{1,39})'s agent\s*$/im.exec(c.message ?? "");
  const login = c.login || noreply?.[1] || (me && myEmail && c.email && c.email.toLowerCase() === myEmail.toLowerCase() ? me : "") || signed?.[1] || c.name || "";
  if (!login) return undefined;
  const agent = agentMark(login, c.message ?? "") || !!signed;
  return { login: login.replace(/\[bot\]$/i, ""), agent };
}

// The kinds that may be shared: a page shows a file of the person's home, so it never leaves.
export const SHAREABLE = ["note", "flashcards", "question", "exam", "timer", "board"] as const;
const q = (x: any) => ({
  prompt: String(x?.prompt ?? ""),
  ...(Array.isArray(x?.choices) && x.choices.length ? { choices: x.choices.map(String) } : {}),
  ...(x?.answer != null ? { answer: String(x.answer) } : {}),
  ...(x?.explain != null ? { explain: String(x.explain) } : {}),
});
/** the card as the team gets it: only the card's own fields, never what the person did on it (pure) */
export function cleanCard(c: any): Card | null {
  if (!c || typeof c !== "object" || !(SHAREABLE as readonly string[]).includes(c.kind) || typeof c.id !== "string" || !/^[\w.-]{1,80}$/.test(c.id)) return null;
  const base = { id: c.id, kind: c.kind, ...(typeof c.title === "string" && c.title ? { title: c.title.slice(0, 200) } : {}) };
  switch (c.kind) {
    case "note": return typeof c.text === "string" ? { ...base, at: Number(c.at) || 0, text: c.text } : null;
    case "flashcards": {
      const cards = (Array.isArray(c.cards) ? c.cards : []).filter((x: any) => x && x.front != null).map((x: any) => ({ front: String(x.front), back: String(x.back ?? "") }));
      return cards.length ? { ...base, at: 0, cards } : null;
    }
    case "question": return c.prompt ? { ...base, at: Number(c.at) || 0, ...q(c) } : null;
    case "exam": {
      const questions = (Array.isArray(c.questions) ? c.questions : []).map(q).filter((x: any) => x.prompt);
      return questions.length ? { ...base, at: Number(c.at) || 0, ...(Number(c.minutes) > 0 ? { minutes: Number(c.minutes) } : {}), questions, given: [], results: [] } : null;
    }
    case "timer": return Number(c.seconds) > 0 ? { ...base, at: Number(c.at) || 0, seconds: Math.round(Number(c.seconds)) } : null;
    case "board": return { ...base, at: Number(c.at) || 0 };
  }
  return null;
}
/** the file written to sol/design/shared/<id>.json (pure) */
export const shareFile = (card: Card): string => { const c = cleanCard(card); if (!c) throw new Error("this card cannot be shared"); return JSON.stringify(c, null, 2) + "\n"; };
/** a shared file read back as a desk card, or null when it is not one (pure) */
export function cardOfFile(text: string): Card | null {
  try { return cleanCard(JSON.parse(text)); } catch { return null; }
}
export const sharePath = (id: string) => `${SHARED_DIR}/${id}.json`;
export const shareMessage = (title: string, sig: string) => `desk: share ${title.replace(/\s+/g, " ").slice(0, 72)}\n\nShared from the desk.\n\nSigned-by: ${sig}\n`;

// ---- reading: gh and git ----

const gh = (args: string[]) => run("gh", args, { timeout: 30_000, maxBuffer: 32 << 20 }).then((r) => String(r.stdout));
const ghBytes = (args: string[]) => run("gh", args, { timeout: 30_000, maxBuffer: 48 << 20, encoding: "buffer" }).then((r) => r.stdout as Buffer);
const git = (cwd: string, args: string[], timeout = 30_000, env: NodeJS.ProcessEnv = ENV()) =>
  run("git", args, { cwd, env, timeout, maxBuffer: 32 << 20 }).then((r) => String(r.stdout));
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const raw = (repo: string, path: string, ref?: string) => ["api", `repos/${repo}/contents/${enc(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`, "-H", "Accept: application/vnd.github.raw"];

async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
  return out;
}

const texts = new Map<string, string>();                              // blob sha -> text (markdown, html heads, cards)
const lasts = new Map<string, { by?: Sign; at?: string }>();          // repo\0ref\0path\0sha -> the last commit on it
const textOf = async (repo: string, path: string, sha: string, ref?: string) => {
  if (texts.has(sha)) return texts.get(sha)!;
  const t = await gh(raw(repo, path, ref)).catch(() => "");
  if (t) texts.set(sha, t.slice(0, 200_000));
  return t;
};

/** the last commit on each path, in GraphQL batches; kept by blob sha, so an unchanged file is never asked again */
async function lastCommits(repo: string, items: { path: string; sha: string; ref: string }[]) {
  const [owner, name] = repo.split("/");
  const want = items.filter((x) => !lasts.has(`${repo}\0${x.ref}\0${x.path}\0${x.sha}`));
  for (let s = 0; s < want.length; s += 60) {
    const chunk = want.slice(s, s + 60);
    const refs = [...new Set(chunk.map((x) => x.ref))];
    const body = refs.map((ref, r) => `r${r}: object(expression: ${JSON.stringify(ref)}) { ... on Commit { ${chunk.map((x, i) => (x.ref === ref
      ? `h${i}: history(first: 1, path: ${JSON.stringify(x.path)}) { nodes { committedDate message author { name email user { login } } } }` : "")).join(" ")} } }`).join(" ");
    const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${body} } }`;
    const got = await gh(["api", "graphql", "-f", `query=${query}`]).then((t) => JSON.parse(t)?.data?.repository ?? {}, () => null);
    if (!got) continue;   // GitHub said no: the rows go without a signature this time, and are asked again next time
    chunk.forEach((x, i) => {
      const n = got[`r${refs.indexOf(x.ref)}`]?.[`h${i}`]?.nodes?.[0];
      lasts.set(`${repo}\0${x.ref}\0${x.path}\0${x.sha}`, n
        ? { by: signOfCommit({ login: n.author?.user?.login, name: n.author?.name, email: n.author?.email, message: n.message }), at: String(n.committedDate ?? "") }
        : {});
    });
  }
  return (x: { path: string; sha: string; ref: string }) => lasts.get(`${repo}\0${x.ref}\0${x.path}\0${x.sha}`) ?? {};
}

const entry = (path: string, text: string | undefined, o: Partial<Entry>): Entry => ({
  path, title: titleOf(path, text), kind: kindOf(path), ...(placeOf(path) === "designs" ? { group: groupOf(path) } : {}), ...o,
});
const newest = (a: Entry[]) => a.sort((x, y) => String(y.at ?? "").localeCompare(String(x.at ?? "")));
/** one card per path: the newest copy wins (the default branch and a person's branch may both hold it) */
const oneEach = (cards: Entry[]) => { const m = new Map<string, Entry>(); for (const c of newest(cards)) if (!m.has(c.path)) m.set(c.path, c); return [...m.values()]; };

/** the person's branches that hold shared cards on GitHub: `<login>/shared`, with their head sha */
async function sharedBranches(repo: string): Promise<{ name: string; sha: string }[]> {
  const refs = await gh(["api", `repos/${repo}/git/matching-refs/heads/`]).then((t) => JSON.parse(t) as any[], () => []);
  return refs.map((r) => ({ name: String(r.ref ?? "").replace(/^refs\/heads\//, ""), sha: String(r.object?.sha ?? "") })).filter((b) => /^[A-Za-z0-9-]{1,39}\/shared$/.test(b.name));
}

/** the cards on the people's `<login>/shared` branches, read from GitHub (skip: a login whose branch is read elsewhere) */
async function branchCards(repo: string, skip = ""): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const b of await sharedBranches(repo)) {
    if (skip && b.name.toLowerCase() === `${skip.toLowerCase()}/shared`) continue;
    const list = await gh(["api", `repos/${repo}/contents/${SHARED_DIR}?ref=${encodeURIComponent(b.name)}`]).then((t) => JSON.parse(t) as any[], () => []);
    const files = (Array.isArray(list) ? list : []).filter((f) => f.type === "file" && placeOf(String(f.path)) === "cards").map((f) => ({ path: String(f.path), sha: String(f.sha), ref: b.name }));
    const last = await lastCommits(repo, files);
    const read = await pool(files, 6, (f) => textOf(repo, f.path, f.sha, f.ref));
    files.forEach((f, i) => { if (cardOfFile(read[i])) out.push(entry(f.path, read[i], { ref: f.ref, sha: f.sha, ...last(f) })); });
  }
  return out;
}

/** a repo from GitHub: the tree of its default branch, once, then only what changed */
export async function readRepoGh(repo: string): Promise<RepoShare> {
  const tree = JSON.parse(await gh(["api", `repos/${repo}/git/trees/HEAD?recursive=1`])) as { tree: { path: string; type: string; sha: string; size?: number }[] };
  const blobs = new Map(tree.tree.filter((t) => t.type === "blob").map((t) => [t.path, t] as const));
  const place = sortPaths([...blobs.keys()]);
  const all = [...place.memory, ...place.designs, ...place.cards].map((p) => ({ path: p, sha: blobs.get(p)!.sha, ref: "HEAD" }));
  const last = await lastCommits(repo, all);
  const needText = all.filter((x) => kindOf(x.path) === "md" || kindOf(x.path) === "json");
  await pool(needText, 6, (x) => textOf(repo, x.path, x.sha));
  const mk = (p: string) => { const x = { path: p, sha: blobs.get(p)!.sha, ref: "HEAD" }; return entry(p, texts.get(x.sha), { sha: x.sha, ...last(x) }); };
  const cards = place.cards.map(mk).filter((e) => cardOfFile(texts.get(e.sha ?? "") ?? ""));
  return { repo, from: "github", memory: place.memory.map(mk), designs: place.designs.map(mk), cards: oneEach([...cards, ...(await branchCards(repo))]) };
}

/** the newer of a branch here and its copy from origin (the sha), or "" when neither is there */
async function tipOf(dir: string, branch: string): Promise<string> {
  const has = (ref: string) => git(dir, ["rev-parse", "--verify", "-q", ref]).then((s) => s.trim(), () => "");
  const local = await has(`refs/heads/${branch}`), remote = await has(`refs/remotes/origin/${branch}`);
  if (local && remote) return (await git(dir, ["merge-base", "--is-ancestor", remote, local]).then(() => true, () => false)) ? local : remote;
  return local || remote;
}

/** my own checkout, from disk: the files as they are now (tracked, and new ones git does not ignore), signed by git */
export async function readRepoDisk(repo: string, dir: string, me: string): Promise<RepoShare> {
  const named = [...new Set((await git(dir, ["ls-files", "-co", "--exclude-standard", "-z", "--", "docs", "sol/design", ...ROOT_MEMORY])).split("\0").filter(Boolean))];
  // only plain files inside the checkout: a symlink (or a path through one) that leads out is not listed
  const ok = await pool(named, 16, (p) => within(dir, p));
  const place = sortPaths(named.filter((_, i) => ok[i]));
  const myEmail = (await git(dir, ["config", "--get", "user.email"]).catch(() => "")).trim();
  // one pass over the log: the first commit that names a path is its last one
  const last = new Map<string, { by?: Sign; at?: string }>();
  const log = await git(dir, ["log", "--no-merges", "--format=%x1e%an%x1f%ae%x1f%aI%x1f%B%x1f", "--name-only", "--", "docs", "sol/design", ...ROOT_MEMORY], 60_000).catch(() => "");
  for (const rec of log.split("\x1e")) {
    const [name, email, at, message, files] = rec.split("\x1f");
    if (files === undefined) continue;
    const by = signOfCommit({ name, email, message }, me, myEmail);
    for (const f of files.split("\n").map((s) => s.trim()).filter(Boolean)) if (!last.has(f)) last.set(f, { by, at });
  }
  const changed = new Set((await git(dir, ["status", "--porcelain", "-z", "--", "docs", "sol/design", ...ROOT_MEMORY]).catch(() => "")).split("\0").filter(Boolean).map((l) => l.slice(3)));
  const mk = async (p: string) => {
    const abs = join(dir, p);
    const k = kindOf(p);
    const text = k === "md" || k === "json" ? await readFile(abs, "utf8").then((t) => t.slice(0, 200_000), () => undefined) : undefined;
    const mine = changed.has(p) || !last.has(p);   // not committed yet: mine, as of the file's time
    const at = mine ? await stat(abs).then((s) => new Date(s.mtimeMs).toISOString(), () => undefined) : last.get(p)?.at;
    return { e: entry(p, text, { local: abs, ...(mine ? (me ? { by: { login: me, agent: false } } : {}) : last.get(p)?.by ? { by: last.get(p)!.by } : {}), ...(at ? { at } : {}) }), text };
  };
  const memory = (await pool(place.memory, 8, mk)).map((x) => x.e);
  const designs = (await pool(place.designs, 8, mk)).map((x) => x.e);
  const cards = (await pool(place.cards, 8, mk)).filter((x) => cardOfFile(x.text ?? "")).map((x) => x.e);
  // my own shared branch, as it is here (shared a second ago, maybe not pushed yet)
  const mine = me ? `${me}/shared` : "";
  const tip = mine ? await tipOf(dir, mine) : "";
  if (tip) {
    const files = (await git(dir, ["ls-tree", "-r", "--name-only", tip, "--", SHARED_DIR + "/"]).catch(() => "")).split("\n").filter((p) => placeOf(p) === "cards");
    for (const p of files) {
      const text = await git(dir, ["show", `${tip}:${p}`]).catch(() => "");
      if (!cardOfFile(text)) continue;
      const [name, email, at, message] = (await git(dir, ["log", "-1", "--format=%an%x1f%ae%x1f%aI%x1f%B", tip, "--", p]).catch(() => "")).split("\x1f");
      cards.push(entry(p, text, { ref: mine, at, ...(signOfCommit({ name, email, message }, me, myEmail) ? { by: signOfCommit({ name, email, message }, me, myEmail)! } : {}) }));
    }
  }
  // everyone else's shared cards are on GitHub
  const theirs = await branchCards(repo, me).catch(() => [] as Entry[]);
  return { repo, from: "checkout", folder: dir, memory, designs, cards: oneEach([...cards, ...theirs]) };
}

// ---- the cache, and who is told ----

export type ShareDeps = { repos: () => string[]; folders: () => Promise<Record<string, string>>; me: () => Promise<string>; local: boolean };
const defaults = (): ShareDeps => ({
  repos: () => getTeam().repos,
  folders: async () => (await import("./wire.js")).teamFolders(),
  me: () => myLogin().catch(() => ""),
  local: process.env.SOL_SHARE_LOCAL !== "0",   // 0: read every repo from GitHub, my own checkout too (a shot, a check)
});

const TTL = 60_000;
let cache: Shared | null = null;
let reading: Promise<Shared> | null = null;
const subs = new Set<(s: Shared) => void>();
export function onShared(fn: (s: Shared) => void) { subs.add(fn); return () => { subs.delete(fn); }; }
onRelay("changed", () => { cache = null; });
/** drop the cached list (the tests, which read with their own deps) */
export function forgetShared() { cache = null; }

/** shared with me, from cache when younger than 60 s; refresh reads now */
export function getShared(refresh = false, d: ShareDeps = defaults()): Promise<Shared> {
  if (!refresh && cache && Date.now() - cache.at < TTL) return Promise.resolve(cache);
  if (reading) return reading;
  reading = (async () => {
    const [folders, me] = await Promise.all([d.local ? d.folders().catch(() => ({} as Record<string, string>)) : Promise.resolve({} as Record<string, string>), d.me()]);
    const repos = await Promise.all(d.repos().map(async (repo): Promise<RepoShare> => {
      try { return folders[repo] ? await readRepoDisk(repo, folders[repo], me) : await readRepoGh(repo); }
      catch (e) { return { repo, from: folders[repo] ? "checkout" : "github", memory: [], designs: [], cards: [], error: `could not read ${repo}: ${String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200)}` }; }
    }));
    cache = { repos, at: Date.now() };
    for (const f of subs) f(cache);
    return cache;
  })().finally(() => { reading = null; });
  return reading;
}

// ---- opening one ----

const CACHE = join(tmpdir(), "sol-shared");
const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");
const paneImage = (abs: string) => `/pane-image?path=${encodeURIComponent(abs)}`;

/** one shared thing: text for markdown (and other text), an image's url, an html page's file url, or a card. Only what
 * the list shows opens: the (repo, path) must be on it, and the branch a card is read from is the list's, never the
 * message's; a page or a design is read from the default branch or my checkout only (Codex review). */
export async function openShared(repo: string, path: string, ref?: string, d: ShareDeps = defaults()): Promise<Opened> {
  if (!d.repos().includes(repo)) return { error: "that is not one of the team's repositories" };
  const place = placeOf(path);
  if (!place) return { error: "that file is not shared" };
  if (ref !== undefined && !/^[A-Za-z0-9-]{1,39}\/shared$/.test(ref)) return { error: "that branch holds no shared cards" };
  if (ref !== undefined && place !== "cards") return { error: "only a desk card is read from a person's branch" };
  const listed = (await getShared(false, d)).repos.find((r) => r.repo === repo);
  const e = listed && [...listed.memory, ...listed.designs, ...listed.cards].find((x) => x.path === path);
  if (!e) return { error: "that is not on the list of shared things" };
  const at = place === "cards" ? e.ref : undefined;
  if (ref !== undefined && ref !== at) return { error: "that card is not on the list from that branch" };
  ref = at;
  const k = kindOf(path);
  const dir = d.local ? (await d.folders().catch(() => ({} as Record<string, string>)))[repo] : undefined;
  const me = await d.me();
  // my own checkout: the file on disk, or my own shared branch as it is here
  if (dir && (!ref || ref.toLowerCase() === `${me.toLowerCase()}/shared`)) {
    if (ref) {
      const tip = await tipOf(dir, ref);
      const text = tip ? await git(dir, ["show", `${tip}:${path}`]).catch(() => "") : "";
      if (text) { const card = cardOfFile(text); return card ? { card } : { error: "that is not a desk card" }; }
    } else {
      const abs = await within(dir, path);
      if (!abs) return { error: "the file is not there any more" };
      if (k === "image") return { image: paneImage(abs), local: abs };
      if (k === "html") return { url: `file://${abs}`, local: abs };
      const text = await readFile(abs, "utf8").catch(() => null);
      if (text === null) return { error: "the file is not there any more" };
      if (k === "json") { const card = cardOfFile(text); return card ? { card, local: abs } : { error: "that is not a desk card" }; }
      return { text: text.slice(0, 2_000_000), local: abs };
    }
  }
  // GitHub: the bytes once, kept in a cache folder the image and browser panes can reach
  if (k === "image" || k === "html") {
    const bytes = await ghBytes(raw(repo, path, ref));
    const file = join(CACHE, safe(repo), safe(ref ?? "HEAD"), path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, bytes);
    return k === "image" ? { image: paneImage(file) } : { url: `file://${file}` };
  }
  const text = await gh(raw(repo, path, ref));
  if (k === "json") { const card = cardOfFile(text); return card ? { card } : { error: "that is not a desk card" }; }
  return { text: text.slice(0, 2_000_000) };
}

// ---- sharing a desk card ----

export type ShareDone = { ok: true; repo: string; branch: string; path: string; sha: string; pushed: boolean; note?: string } | { ok?: false; error: string };

/** commit the card's file on `<login>/shared` beside the working tree (a temporary index) and push it; the checkout's
 * own branch, index and files are never touched, whatever branch it is on. When the checkout sits on `<login>/shared`
 * itself, the commit goes to GitHub only and the branch here is left where it is (moving it would move HEAD under the
 * person's own work); the reader takes the newer of the two (Codex review). */
export async function commitCard(dir: string, card: Card, o: { login: string; sig: string; push?: boolean }): Promise<Omit<Extract<ShareDone, { ok: true }>, "repo">> {
  const branch = `${o.login}/shared`, path = sharePath(card.id), body = shareFile(card), msg = shareMessage(card.title || card.kind, o.sig);
  const g = (args: string[], env?: NodeJS.ProcessEnv) => git(dir, args, 60_000, env).then((s) => s.trim());
  const has = (ref: string) => g(["rev-parse", "--verify", "-q", ref]).catch(() => "");
  await g(["fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], undefined).catch(() => {});   // none yet: fine
  const checkedOut = (await g(["branch", "--show-current"]).catch(() => "")) === branch;
  const local = await has(`refs/heads/${branch}`);
  // the newer of mine-here and GitHub's; a branch made fresh starts from the default branch
  const base = (await tipOf(dir, branch)) || (await has("refs/remotes/origin/main")) || (await has("HEAD"));
  let sha: string;
  const tmp = await mkdtemp(join(tmpdir(), "sol-share-"));
  try {
    const env = { ...ENV(), GIT_INDEX_FILE: join(tmp, "index") };
    if (base) await g(["read-tree", base], env);
    const obj = await new Promise<string>((ok, no) => {
      const p = execFile("git", ["hash-object", "-w", "--stdin"], { cwd: dir, env: ENV() }, (err, out) => (err ? no(err) : ok(String(out).trim())));
      p.stdin?.end(body);
    });
    await g(["update-index", "--add", "--cacheinfo", `100644,${obj},${path}`], env);
    const tree = await g(["write-tree"], env);
    sha = await g(["commit-tree", tree, ...(base ? ["-p", base] : []), "-m", msg]);
    if (!checkedOut) await g(["update-ref", `refs/heads/${branch}`, sha, ...(local ? [local] : [])]);
  } finally { await rm(tmp, { recursive: true, force: true }); }
  const why = (e: unknown) => String((e as any)?.stderr || (e as Error)?.message || e).split("\n").map((l) => l.replace(/^(fatal|error): /, "").trim()).filter(Boolean)[0] ?? "it failed";
  if (o.push === false) {
    if (checkedOut) throw new Error(`your checkout is on ${branch}, so the card can only go to GitHub; nothing changed here`);
    return { ok: true, branch, path, sha, pushed: false };
  }
  try {
    await g(["push", "-q", "origin", `${sha}:refs/heads/${branch}`]);
    await g(["update-ref", `refs/remotes/origin/${branch}`, sha]).catch(() => {});
    return { ok: true, branch, path, sha, pushed: true };
  } catch (e) {
    if (checkedOut) throw new Error(`your checkout is on ${branch} and the push failed (${why(e)}); nothing changed here`);
    return { ok: true, branch, path, sha, pushed: false, note: `committed here, not pushed: ${why(e)}` };
  }
}

/** share a card from the desk: committed and pushed in my own checkout of the team's first repo, the team told */
export async function shareCard(card: Card, d: ShareDeps = defaults()): Promise<ShareDone> {
  if (!(SHAREABLE as readonly string[]).includes(card.kind)) return { error: card.kind === "page" ? "a page shows a file of your own home; it stays here" : `a ${card.kind} card cannot be shared` };
  if (!cleanCard(card)) return { error: "the card is missing what its kind needs" };
  const team = getTeam();
  if (!mayAgentSpeak(team, "github")) return { error: "My agent may not speak on GitHub (Settings, my agent)." };
  const login = await d.me();
  if (!login) return { error: "sign in to GitHub first (Settings, my accounts)" };
  const repo = (team.org ? d.repos().find((r) => r.toLowerCase().startsWith(team.org.toLowerCase() + "/")) : undefined) ?? d.repos()[0];
  const dir = repo ? (await d.folders().catch(() => ({} as Record<string, string>)))[repo] : undefined;
  if (!repo || !dir) return { error: `no folder on this machine holds ${repo || "the team's repository"}` };
  const leave = joinBusy("share", card.id, `sharing ${card.title || card.kind}`);
  try {
    const r = await commitCard(dir, card, { login, sig: signature({ ...team, me: { ...team.me, login } }, true) });
    cache = null;
    if (r.pushed) sendRelay("changed", { repo });
    void getShared(true, d).catch(() => {});
    return { ...r, repo };
  } catch (e) {
    return { error: `the card was not shared: ${String((e as any)?.stderr || (e as Error)?.message || e).split("\n")[0].slice(0, 200)}` };
  } finally { leave(); }
}
