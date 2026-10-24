// The board (Together, See #31): every card is an issue in one of the team's repos, and its column is where it stands
// on the one line every card moves along: waiting, branch, pr, main, stable, closed. Read from GitHub with `gh`
// (gh's own sign-in, never a token in Sol), cached 60 s. columns() is pure and tested (test/together-see.test.ts).
//
// What ties a branch or PR to issue N: "#N" in the branch name, the PR's title or body ("Fixes #N", "Part of #N"), or a
// branch whose last segment starts with "N-" (marco/31-see). An issue's column is the furthest any of its ties reached:
// stable > main > pr > branch > waiting. Closed with nothing merged is "closed".
import { execFile } from "node:child_process";
import { getTeam } from "./settings.js";
import { testNote, type Mark, type PrComment } from "./mark.js";
import { areasOf, owners, type Owners } from "./claims.js";
import { leadsOf, isOwner } from "./press.js";

export type Column = "waiting" | "branch" | "pr" | "main" | "stable" | "closed";
export const COLUMNS: Column[] = ["waiting", "branch", "pr", "main", "stable", "closed"];

export type Issue = {
  repo: string; number: number; title: string; state: "open" | "closed"; labels: string[]; assignees: string[];
  author: string; created: string; closed?: string; milestone?: string; url: string;
};
export type PR = {
  repo: string; number: number; title: string; body: string; draft: boolean; state: "open" | "closed" | "merged";
  head: string; base: string; author: string; agent: boolean; mergedAt?: string; mergeCommit?: string;
  inStable?: boolean; review?: string; updated?: string; url: string;
  note?: string; mark?: Mark; flippedBy?: string;   // the test note (#100): what to try, felt or silent, who flipped it
  areas?: string[];   // the labels its files belong to, by the repo's .github/CODEOWNERS (#98): where this PR holds
};
export type Branch = { repo: string; name: string; sha: string };
export type Sign = { login: string; agent: boolean };
export type Card = Issue & { column: Column; domain?: string; pr?: number; branch?: string; sign?: Sign };

const RANK: Record<Column, number> = { closed: -1, waiting: 0, branch: 1, pr: 2, main: 3, stable: 4 };
const DOMAINS = ["life", "work", "cowork", "social", "base", "product"]; // the six labels (.github/CODEOWNERS)
const PLAIN = new Set(["now", "task", "bug", "decision", "sitting", "enhancement"]);

/** the issue numbers a text names: "#31", "Fixes #31", "Part of #31" (pure) */
export function refs(text: string): number[] {
  return [...new Set([...String(text ?? "").matchAll(/#(\d{1,6})\b/g)].map((m) => Number(m[1])))];
}

/** the issue numbers a branch name names: "#31" in it, or a last segment "31-..." (pure) */
export function branchRefs(name: string): number[] {
  const last = name.split("/").pop() ?? "";
  const lead = /^(\d{1,6})(?:-|$)/.exec(last);
  return [...new Set([...refs(name), ...(lead ? [Number(lead[1])] : [])])];
}

/** an agent moved it: the author is a bot, or the commit carries Co-Authored-By: Claude (pure) */
export function agentMark(author: string, message = ""): boolean {
  return /\[bot\]$/i.test(author) || /^co-authored-by:\s*claude\b/im.test(message);
}

/** the domain tag of an issue: a known domain label, else its first plain label (pure) */
export function domainOf(labels: string[]): string | undefined {
  return labels.find((l) => DOMAINS.includes(l)) ?? labels.find((l) => !PLAIN.has(l));
}

const merged = (p: PR, stableSha: string, mainSha: string): Column | null => {
  if (p.state !== "merged") return null;
  if (p.inStable || (p.mergeCommit && p.mergeCommit === stableSha)) return "stable";
  if (p.base === "main" || (p.mergeCommit && p.mergeCommit === mainSha)) return "main";
  return "branch";   // merged into some other branch: still on a branch as far as the line goes
};

/** every issue's column, and what put it there (pure; the tests hold all six columns) */
export function columns(issues: Issue[], prs: PR[], branches: Branch[], stableSha: string, mainSha: string): Card[] {
  return issues.map((i) => {
    let col: Column = "waiting", pr: PR | undefined, branch: string | undefined;
    const lift = (c: Column, p?: PR, b?: string) => { if (RANK[c] > RANK[col]) { col = c; pr = p ?? pr; branch = b ?? branch; } };
    for (const p of prs) {
      if (p.repo !== i.repo || !refs(`${p.title}\n${p.body}`).concat(branchRefs(p.head)).includes(i.number)) continue;
      const m = merged(p, stableSha, mainSha);
      if (m) lift(m, p, p.head);
      else if (p.state === "open") lift("pr", p, p.head);
      else if (branches.some((b) => b.repo === p.repo && b.name === p.head)) lift("branch", p, p.head);   // closed, branch kept
    }
    for (const b of branches) if (b.repo === i.repo && branchRefs(b.name).includes(i.number)) lift("branch", undefined, b.name);
    if (i.state === "closed" && RANK[col] < RANK.main) col = "closed";
    const sign: Sign | undefined = pr ? { login: (pr as PR).author.replace(/\[bot\]$/i, ""), agent: (pr as PR).agent } : undefined;
    return { ...i, column: col, domain: domainOf(i.labels), ...(pr ? { pr: (pr as PR).number } : {}), ...(branch ? { branch } : {}), ...(sign ? { sign } : {}) };
  });
}

// ---- reading GitHub ----
const gh = (args: string[]) => new Promise<string>((ok, no) =>
  execFile("gh", args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => (err ? no(err) : ok(String(out)))));
const ghJson = async <T>(args: string[]): Promise<T> => JSON.parse(await gh(args)) as T;

const RECENT_DAYS = 14;   // closed issues older than this are history, not the board
const contains = new Map<string, boolean>();   // `${repo}:${merge}:${stable}` -> stable contains merge

async function inStable(repo: string, merge: string, stable: string) {
  if (!merge || !stable) return false;
  if (merge === stable) return true;
  const k = `${repo}:${merge}:${stable}`;
  const had = contains.get(k);
  if (had !== undefined) return had;
  const status = (await gh(["api", `repos/${repo}/compare/${merge}...${stable}`, "--jq", ".status"]).catch(() => "")).trim();
  const yes = status === "ahead" || status === "identical";
  if (status) contains.set(k, yes);
  return yes;
}

// the flips are comments: read for open PRs only, again only when the PR changed (its updatedAt)
const talked = new Map<string, PrComment[]>();   // `${repo}#${n}@${updated}` -> its comments, oldest first
async function prComments(repo: string, n: number, updated: string): Promise<PrComment[]> {
  const k = `${repo}#${n}@${updated}`;
  const had = talked.get(k);
  if (had) return had;
  const raw = await ghJson<any[]>(["api", `repos/${repo}/issues/${n}/comments?per_page=100`]).catch(() => null);
  if (!raw) return [];
  const got = raw.map((c) => ({ author: String(c.user?.login ?? "") + (c.user?.type === "Bot" && !/\[bot\]$/.test(String(c.user?.login ?? "")) ? "[bot]" : ""), body: String(c.body ?? ""), at: String(c.created_at ?? "") }));
  talked.set(k, got);
  return got;
}

// each repo's CODEOWNERS, read once every ten minutes (it changes rarely: by a PR, or the owner's press, which forgets
// it at once); none is an empty map, no areas. The same read gives who leads each label (#117), and whether I am the
// repo's owner, who may set them (GitHub's admin flag)
const OWNERS_TTL = 600_000;
type OwnersRead = { at: number; own: Owners; leads: Record<string, string[]>; owner: boolean };
const ownersOf = new Map<string, OwnersRead>();
async function repoOwners(repo: string): Promise<OwnersRead> {
  const had = ownersOf.get(repo);
  if (had && Date.now() - had.at < OWNERS_TTL) return had;
  const [text, owner] = await Promise.all([
    gh(["api", `repos/${repo}/contents/.github/CODEOWNERS`, "-H", "Accept: application/vnd.github.raw"]).catch(() => ""),
    isOwner({ gh }, repo),
  ]);
  const got = { at: Date.now(), own: owners(text), leads: leadsOf(text), owner };
  ownersOf.set(repo, got);
  return got;
}
/** CODEOWNERS changed (the owner's press, here or heard on the relay): the next read asks GitHub again */
export const forgetOwners = (repo?: string) => { if (repo) ownersOf.delete(repo); else ownersOf.clear(); };

type RepoRead = { issues: Issue[]; prs: PR[]; branches: Branch[]; stable: string; main: string; leads: Record<string, string[]>; owner: boolean };

async function readRepo(repo: string): Promise<RepoRead> {
  const since = Date.now() - RECENT_DAYS * 86_400_000;
  const [rawIssues, rawPrs, rawBranches, { own, leads, owner }] = await Promise.all([
    ghJson<any[]>(["issue", "list", "-R", repo, "--state", "all", "--limit", "100", "--json", "number,title,state,labels,assignees,author,createdAt,closedAt,milestone,url"]),
    // 40, not 50: with each PR's commits, 50 asks GitHub for more than its 500,000-node limit and the read fails.
    // files rides in the same one request (#98): no request per PR
    ghJson<any[]>(["pr", "list", "-R", repo, "--state", "all", "--limit", "40", "--json", "number,title,body,isDraft,state,headRefName,baseRefName,author,mergedAt,mergeCommit,reviewDecision,updatedAt,url,commits,files"]),
    ghJson<any[]>(["api", `repos/${repo}/branches?per_page=100`]),
    repoOwners(repo),
  ]);
  const branches: Branch[] = rawBranches.map((b) => ({ repo, name: String(b.name), sha: String(b.commit?.sha ?? "") }));
  const stable = branches.find((b) => b.name === "stable")?.sha ?? "", main = branches.find((b) => b.name === "main")?.sha ?? "";
  const issues: Issue[] = rawIssues
    .map((i) => ({
      repo, number: i.number, title: String(i.title ?? ""), state: (i.state === "CLOSED" ? "closed" : "open") as Issue["state"],
      labels: (i.labels ?? []).map((l: any) => String(l.name)), assignees: (i.assignees ?? []).map((a: any) => String(a.login)),
      author: String(i.author?.login ?? ""), created: String(i.createdAt ?? ""), ...(i.closedAt ? { closed: String(i.closedAt) } : {}),
      ...(i.milestone?.title ? { milestone: String(i.milestone.title) } : {}), url: String(i.url ?? ""),
    }))
    .filter((i) => i.state === "open" || (i.closed && Date.parse(i.closed) >= since));
  const prs: PR[] = await Promise.all(rawPrs.map(async (p) => {
    const last = Array.isArray(p.commits) && p.commits.length ? p.commits[p.commits.length - 1] : null;
    const author = String(p.author?.login ?? "") + (p.author?.is_bot ? "[bot]" : "");
    const state = (p.state === "MERGED" ? "merged" : p.state === "CLOSED" ? "closed" : "open") as PR["state"];
    const merge = String(p.mergeCommit?.oid ?? "");
    const body = String(p.body ?? "");
    const note = state === "open" ? testNote(body, await prComments(repo, p.number, String(p.updatedAt ?? ""))) : null;
    const areas = areasOf((Array.isArray(p.files) ? p.files : []).map((f: any) => String(f.path ?? "")), own);
    return {
      repo, number: p.number, title: String(p.title ?? ""), body: body.slice(0, 4000), draft: !!p.isDraft, state,
      head: String(p.headRefName ?? ""), base: String(p.baseRefName ?? ""), author,
      agent: agentMark(author, last ? `${last.messageHeadline ?? ""}\n${last.messageBody ?? ""}` : ""),
      ...(p.mergedAt ? { mergedAt: String(p.mergedAt) } : {}), ...(merge ? { mergeCommit: merge } : {}),
      ...(state === "merged" ? { inStable: await inStable(repo, merge, stable) } : {}),
      ...(p.reviewDecision ? { review: String(p.reviewDecision) } : {}), ...(p.updatedAt ? { updated: String(p.updatedAt) } : {}),
      url: String(p.url ?? ""), ...(areas.length ? { areas } : {}),
      ...(note ? { note: note.whatToTry, mark: note.mark, ...(note.flippedBy ? { flippedBy: note.flippedBy } : {}) } : {}),
    };
  }));
  return { issues, prs, branches, stable, main, leads, owner };
}

export type Board = {
  repos: string[]; cards: Card[]; prs: PR[]; branches: Branch[];
  stable: Record<string, string>; main: Record<string, string>; at: number; error?: string;
  leads: Record<string, Record<string, string[]>>;   // repo -> label -> its leads, from CODEOWNERS (#117)
  owner: Record<string, boolean>;                    // repo -> am I its owner, who may set the leads
};

const TTL = 60_000;
let cache: Board | null = null;
let reading: Promise<Board> | null = null;
const subs = new Set<(b: Board) => void>();

/** the board: the cached one at once when there is one (a stale one starts a fresh read behind it, told to onBoard, so a
 * face paints now and is corrected after); refresh waits for the read. Every fresh read is told to onBoard */
export function getBoard(refresh = false): Promise<Board> {
  if (!refresh && cache) {
    if (Date.now() - cache.at >= TTL) void read().catch(() => {});
    return Promise.resolve(cache);
  }
  return read();
}
function read(): Promise<Board> {
  if (reading) return reading;
  const repos = getTeam().repos;
  reading = (async () => {
    const got = await Promise.allSettled(repos.map(readRepo));
    const ok = got.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failed = got.flatMap((r, n) => (r.status === "rejected" ? [repos[n]] : []));
    const issues = ok.flatMap((r) => r.issues), prs = ok.flatMap((r) => r.prs), branches = ok.flatMap((r) => r.branches);
    const stable: Record<string, string> = {}, main: Record<string, string> = {};
    const leads: Board["leads"] = {}, owner: Board["owner"] = {};
    ok.forEach((r, n) => { const repo = repos.filter((x) => !failed.includes(x))[n]; stable[repo] = r.stable; main[repo] = r.main; leads[repo] = r.leads; owner[repo] = r.owner; });
    const cards = repos.flatMap((repo) => columns(issues.filter((i) => i.repo === repo), prs, branches, stable[repo] ?? "", main[repo] ?? ""));
    const b: Board = { repos, cards, prs, branches, stable, main, leads, owner, at: Date.now(), ...(failed.length ? { error: `could not read ${failed.join(", ")}` } : {}) };
    if (ok.length || !cache) cache = b;
    for (const f of subs) f(cache);
    return cache;
  })().finally(() => { reading = null; });
  return reading;
}

export function onBoard(fn: (b: Board) => void) { subs.add(fn); return () => { subs.delete(fn); }; }

// ---- a member's page: their plan, and their log from the record ----
export type LogLine = { at: string; kind: "issue" | "comment" | "pr" | "commit" | "hand"; repo: string; text: string; url?: string; number?: number; sign: Sign };

/** a person's last 30 lines from the record, newest first (pure on the board and the extra reads) */
export function memberLog(login: string, board: Pick<Board, "cards" | "prs">, commits: { repo: string; sha: string; at: string; message: string; url?: string }[], comments: { repo: string; number: number; at: string; author: string; body: string; url?: string }[]): LogLine[] {
  const me = login.toLowerCase();
  const lines: LogLine[] = [];
  for (const c of board.cards) if (c.author.toLowerCase() === me) lines.push({ at: c.created, kind: "issue", repo: c.repo, number: c.number, text: `opened #${c.number} ${c.title}`, url: c.url, sign: { login, agent: false } });
  for (const p of board.prs) {
    if (p.author.replace(/\[bot\]$/i, "").toLowerCase() !== me) continue;
    const at = p.mergedAt ?? p.updated ?? "";
    lines.push({ at, kind: "pr", repo: p.repo, number: p.number, text: `${p.state === "merged" ? "merged" : p.draft ? "drafted" : "opened"} PR #${p.number} ${p.title}`, url: p.url, sign: { login, agent: p.agent } });
  }
  for (const c of commits) {
    const head = c.message.split("\n")[0];
    lines.push({ at: c.at, kind: "commit", repo: c.repo, text: head, url: c.url, sign: { login, agent: agentMark("", c.message) } });
  }
  for (const c of comments) {
    if (c.author.toLowerCase() !== me) continue;
    const hand = /^\*\*(hand|taken|passed)\*\*/i.test(c.body.trim());
    lines.push({ at: c.at, kind: hand ? "hand" : "comment", repo: c.repo, number: c.number, text: c.body.trim().split("\n")[0].slice(0, 140), url: c.url, sign: { login, agent: agentMark(c.author, c.body) } });
  }
  return lines.filter((l) => l.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
}

export async function member(login: string): Promise<{ plan?: string; log: LogLine[] }> {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) return { log: [] };
  const board = await getBoard();
  const repos = board.repos;
  const home = getTeam().org ? repos.find((r) => r.startsWith(getTeam().org + "/")) ?? repos[0] : repos[0];
  const [plan, commits, comments] = await Promise.all([
    gh(["api", `repos/${home}/contents/plan.md?ref=${encodeURIComponent(`${login}/plan`)}`, "-H", "Accept: application/vnd.github.raw"]).catch(() => undefined),
    Promise.all(repos.map((repo) => ghJson<any[]>(["api", `repos/${repo}/commits?author=${login}&per_page=30`]).then(
      (cs) => cs.map((c) => ({ repo, sha: String(c.sha), at: String(c.commit?.author?.date ?? ""), message: String(c.commit?.message ?? ""), url: String(c.html_url ?? "") })),
      () => []))).then((x) => x.flat()),
    Promise.all(repos.map((repo) => ghJson<any[]>(["api", `repos/${repo}/issues/comments?sort=updated&direction=desc&per_page=100`]).then(
      (cs) => cs.map((c) => ({ repo, number: Number(String(c.issue_url ?? "").split("/").pop()), at: String(c.created_at ?? ""), author: String(c.user?.login ?? ""), body: String(c.body ?? ""), url: String(c.html_url ?? "") })),
      () => []))).then((x) => x.flat()),
  ]);
  return { ...(plan && plan.trim() ? { plan: plan.slice(0, 20_000) } : {}), log: memberLog(login, board, commits, comments) };
}
