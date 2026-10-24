// The night job (#99, docs/how-we-work/PRD.md sections 7, 10 and 12): one run a night on the always-on machine (the
// NucBox's live checkout, by sol-night.timer), nowhere else. It fetches origin and reads origin/<branch> refs only,
// never checking anything out, then does three things and writes each to GitHub the moment it happens:
//   clashes  every pair of open PR branches (and each against main) merged in memory by git's own merge-tree; a
//            predicted conflict is one comment on each of the two issues the PRs name, never the same one twice
//   claims   an issue wearing `now` whose branch has no commit and whose issue has no word for staleDays loses `now`
//   digest   one comment a night on the open issue "Night digest" (label cowork): what landed, what is open, who
//            holds what
// and the two rules of the leads (#118, leads.ts), read off origin/main's .github/CODEOWNERS:
//   routing  an open issue wearing one of the six labels gets its missing leads assigned and pinged
//   flags    a PR merged since the last digest without its labels' leads' word gets one signed line and a ping
// Run by hand: bash sol/night --dry-run (prints what it would post, posts nothing). The hour and the days are team
// values, `night` in sol/engine/team.json. GitHub and git are the deps below, so the tests fake them.
import { readFileSync, realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTeam, type TeamSettings } from "./settings.js";
import { runGh, sign } from "./note.js";
import { owners, type Owners } from "./claims.js";
import { leads, routeIssues, mergeFlag, flagText, FLAG, type Leads, type MergedPr, type OpenIssue } from "./leads.js";
import type { PingKind } from "./pings.js";

export type Run = { code: number; out: string };
export type NightDeps = {
  gh: (args: string[]) => Promise<string>;   // the GitHub CLI, in the checkout (gh's own sign-in)
  git: (args: string[]) => Promise<Run>;     // never throws: the exit code is part of the answer (merge-tree: 1 = a clash)
  login: string;                             // whose agent signs
  now: () => Date;
  dryRun: boolean;
  say: (line: string) => void;               // what the run prints
  /** a relay ping to a teammate (the hub keeps it while none of their Sols is on); false when it could not go */
  ping?: (p: { to: string; kind: PingKind; line: string; issue: number }) => boolean | Promise<boolean>;
};
export type Pr = { number: number; branch: string; login: string; title: string; body: string; isDraft: boolean };
export type Clash = { a: Pr; b: Pr | null; files: string[] };   // b null: a against main
export type Claim = { issue: number; title: string; login: string };
type Comment = { body: string; at: string; login: string };

const DAY = 86_400_000;
const TITLE = "Night digest";
export const nightSign = (login: string) => `${sign(login)} (night job)`;

/** the issue a PR names ("Part of #n", "Fixes #n", ...), else the PR itself */
export function issueOf(pr: Pr): number {
  const m = /\b(?:part of|fixes|fixed|fix|closes|closed|close|resolves|resolved|resolve)\s+#(\d+)/i.exec(pr.body ?? "");
  return m ? Number(m[1]) : pr.number;
}

/** every pair once, the lower number first */
export function pairs<T extends { number: number }>(xs: T[]): [T, T][] {
  const s = [...xs].sort((x, y) => x.number - y.number);
  const out: [T, T][] = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) out.push([s[i], s[j]]);
  return out;
}

/** `git merge-tree --write-tree --name-only --no-messages`: 0 is clean, 1 lists the conflicted files after the tree */
export function parseMergeTree(r: Run): string[] {
  if (r.code === 0) return [];
  if (r.code !== 1) throw new Error(`git merge-tree failed: ${r.out.trim().split("\n")[0] || `exit ${r.code}`}`);
  const lines = r.out.split("\n").slice(1);
  const end = lines.findIndex((l) => !l.trim());
  return [...new Set((end < 0 ? lines : lines.slice(0, end)).map((l) => l.trim()).filter(Boolean))].sort();
}

/** git 2.38 is the first with merge-tree --write-tree */
export function gitOk(version: string): boolean {
  const m = /(\d+)\.(\d+)/.exec(version);
  return !!m && (Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 38));
}

const who = (p: Pr) => `#${p.number} (${p.login}, ${p.branch})`;
export function clashText(c: Clash, login: string): string {
  const files = c.files.join(", ");
  if (!c.b) return `**Clash predicted** between ${who(c.a)} and main on: ${files}. Bring main into your branch and settle it there.\n\n${nightSign(login)}`;
  return `**Clash predicted** between ${who(c.a)} and ${who(c.b)} on: ${files}. One of you builds on the other's branch or waits.\n\n${nightSign(login)}`;
}
/** the same pair on the same files was already said there */
export function saidBefore(c: Clash, comments: { body: string }[]): boolean {
  const on = `on: ${c.files.join(", ")}.`;
  return comments.some((x) => x.body.includes("**Clash predicted**") && x.body.includes(`#${c.a.number} (`) &&
    x.body.includes(c.b ? `#${c.b.number} (` : " and main on:") && x.body.includes(on));
}

/** stale: nothing from the person (a commit, a word, the claim itself) for days */
export function isStale(last: (string | undefined)[], now: Date, days: number): boolean {
  const t = Math.max(0, ...last.filter(Boolean).map((x) => Date.parse(x!)).filter((n) => !Number.isNaN(n)));
  return now.getTime() - t > days * DAY;
}
/** the newest branch on origin made by Take for this issue (<first>/<label>-...-<n>) */
export function branchOf(issue: number, refs: { ref: string; at: string }[]): { ref: string; at: string } | undefined {
  const re = new RegExp(`^origin/[^/]+/.+-${issue}$`);
  return refs.filter((r) => re.test(r.ref)).sort((x, y) => Date.parse(y.at) - Date.parse(x.at))[0];
}

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
const list = (xs: string[], max = 12) => (!xs.length ? "none" : xs.slice(0, max).join("; ") + (xs.length > max ? `; and ${xs.length - max} more` : ""));
export function digestText(o: {
  login: string; now: Date; since: Date;
  merged: { number: number; title: string; login: string }[];
  opened: { number: number; title: string; login: string }[];
  waiting: Pr[]; clashes: Clash[]; dropped: Claim[]; holds: Claim[];
}): string {
  const pr = (p: { number: number; title: string; login: string }) => `#${p.number} ${p.title} (${p.login})`;
  return [
    `**Night digest**, ${o.now.toISOString().slice(0, 10)} (since ${stamp(o.since)})`,
    "",
    `Merged into main: ${list(o.merged.map(pr))}`,
    `Opened, still open: ${list(o.opened.filter((p) => !o.merged.some((m) => m.number === p.number)).map(pr))}`,
    `Waiting for review: ${list(o.waiting.map((p) => `#${p.number} (${p.login})`))}`,
    `Clashes found: ${list(o.clashes.map((c) => `#${c.a.number} and ${c.b ? `#${c.b.number}` : "main"} on ${c.files.join(", ")}`))}`,
    `Claims dropped: ${list(o.dropped.map((c) => `#${c.issue} (${c.login})`))}`,
    `Who holds what: ${o.holds.length ? "" : "nobody"}`,
    ...o.holds.map((c) => `- #${c.issue} ${c.title}: ${c.login}`),
    "",
    nightSign(o.login),
  ].join("\n");
}

// ---- the run ----

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const json = <T>(s: string): T[] => lines(s).map((l) => JSON.parse(l) as T);

async function comments(d: NightDeps, n: number): Promise<Comment[]> {
  return json<Comment>(await d.gh(["api", "--paginate", `repos/{owner}/{repo}/issues/${n}/comments?per_page=100`,
    "--jq", ".[] | {body, at: .created_at, login: .user.login} | tojson"]));
}
async function post(d: NightDeps, n: number, body: string) {
  if (d.dryRun) { d.say(`would post on #${n}:\n${body.replace(/^/gm, "    ")}`); return; }
  await d.gh(["api", "-X", "POST", `repos/{owner}/{repo}/issues/${n}/comments`, "-f", `body=${body}`]);
  d.say(`posted on #${n}`);
}

export async function openPrs(d: NightDeps): Promise<Pr[]> {
  const raw = JSON.parse(await d.gh(["pr", "list", "--state", "open", "--limit", "100", "--json", "number,headRefName,author,title,body,isDraft"]) || "[]") as
    { number: number; headRefName: string; author?: { login?: string }; title: string; body?: string; isDraft?: boolean }[];
  return raw.map((p) => ({ number: p.number, branch: p.headRefName, login: p.author?.login ?? "?", title: p.title, body: p.body ?? "", isDraft: !!p.isDraft }));
}

export async function findClashes(d: NightDeps, prs: Pr[]): Promise<Clash[]> {
  const here: Pr[] = [];
  for (const p of prs) if ((await d.git(["rev-parse", "--verify", "-q", `origin/${p.branch}`])).code === 0) here.push(p);
  const mt = async (x: string, y: string) => parseMergeTree(await d.git(["merge-tree", "--write-tree", "--name-only", "--no-messages", x, y]));
  const out: Clash[] = [];
  const withMain = new Map<number, string[]>();
  for (const p of here) {
    const files = await mt("origin/main", `origin/${p.branch}`);
    withMain.set(p.number, files);
    if (files.length) out.push({ a: p, b: null, files });
  }
  // a file one side already fights main over is said once, against main, not again for every pair
  for (const [a, b] of pairs(here)) {
    const known = new Set([...(withMain.get(a.number) ?? []), ...(withMain.get(b.number) ?? [])]);
    const files = (await mt(`origin/${a.branch}`, `origin/${b.branch}`)).filter((f) => !known.has(f));
    if (files.length) out.push({ a, b, files });
  }
  return out;
}

export async function postClashes(d: NightDeps, clashes: Clash[]): Promise<number> {
  const seen = new Map<number, Comment[]>();
  let n = 0;
  for (const c of clashes) {
    for (const issue of [...new Set([issueOf(c.a), ...(c.b ? [issueOf(c.b)] : [])])]) {
      if (!seen.has(issue)) seen.set(issue, await comments(d, issue));
      if (saidBefore(c, seen.get(issue)!)) { d.say(`already said on #${issue}: ${c.a.number} and ${c.b ? c.b.number : "main"}`); continue; }
      const body = clashText(c, d.login);
      await post(d, issue, body);
      seen.get(issue)!.push({ body, at: d.now().toISOString(), login: d.login });
      n++;
    }
  }
  return n;
}

export async function staleClaims(d: NightDeps, days: number): Promise<{ dropped: Claim[]; holds: Claim[] }> {
  const issues = JSON.parse(await d.gh(["issue", "list", "--state", "open", "--label", "now", "--limit", "100", "--json", "number,title,assignees"]) || "[]") as
    { number: number; title: string; assignees?: { login: string }[] }[];
  const refs = lines((await d.git(["for-each-ref", "--format=%(refname:short) %(committerdate:iso-strict)", "refs/remotes/origin"])).out)
    .map((l) => { const [ref, at] = l.split(" "); return { ref, at }; });
  const dropped: Claim[] = [], holds: Claim[] = [];
  for (const i of issues) {
    const people = (i.assignees ?? []).map((a) => a.login).filter(Boolean);
    if (!people.length) continue;
    const claim: Claim = { issue: i.number, title: i.title, login: people.join(", ") };
    const words = (await comments(d, i.number)).filter((c) => !c.body.includes("(night job)")).map((c) => c.at);
    const taken = lines(await d.gh(["api", "--paginate", `repos/{owner}/{repo}/issues/${i.number}/events?per_page=100`,
      "--jq", `.[] | select(.event == "assigned" or (.event == "labeled" and .label.name == "now")) | .created_at`]));
    if (!isStale([branchOf(i.number, refs)?.at, ...words, ...taken], d.now(), days)) { holds.push(claim); continue; }
    if (d.dryRun) d.say(`would take \`now\` off #${i.number}`);
    else await d.gh(["issue", "edit", String(i.number), "--remove-label", "now"]);
    await post(d, i.number, `**Claim dropped**: no commit or word in ${days} days; Take it again when you pick it up.\n\n${nightSign(d.login)}`);
    dropped.push(claim);
  }
  return { dropped, holds };
}

/** the digest issue and when the night job last spoke there: the last run (a day ago when there is none) */
export async function lastRun(d: NightDeps): Promise<{ n: number; since: Date }> {
  const found = JSON.parse(await d.gh(["issue", "list", "--state", "open", "--search", `"${TITLE}" in:title`, "--limit", "20", "--json", "number,title"]) || "[]") as
    { number: number; title: string }[];
  const n = found.find((i) => i.title.trim() === TITLE)?.number ?? 0;
  const last = n ? (await comments(d, n)).filter((c) => c.body.includes("(night job)")).map((c) => c.at).sort().pop() : undefined;
  return { n, since: last ? new Date(last) : new Date(d.now().getTime() - DAY) };
}
const isoOf = (since: Date) => since.toISOString().replace(/\.\d+Z$/, "Z");

/** the PRs merged since a moment, with who merged, the reviews and the files (the flag's read; the digest's list) */
export async function mergedSince(d: NightDeps, since: Date): Promise<MergedPr[]> {
  type P = { number: number; title: string; author?: { login?: string }; mergedBy?: { login?: string } | null;
    reviews?: { author?: { login?: string }; state?: string; submittedAt?: string }[]; files?: { path?: string }[] };
  const raw = JSON.parse(await d.gh(["pr", "list", "--state", "merged", "--search", `merged:>=${isoOf(since)}`, "--limit", "100",
    "--json", "number,title,author,mergedBy,reviews,files"]) || "[]") as P[];
  return raw.map((p) => ({
    number: p.number, title: p.title, author: p.author?.login ?? "?", mergedBy: p.mergedBy?.login ?? "",
    files: (p.files ?? []).map((f) => String(f.path ?? "")).filter(Boolean),
    reviews: (p.reviews ?? []).map((r) => ({ login: r.author?.login ?? "", state: String(r.state ?? ""), at: r.submittedAt })),
  }));
}

export async function digest(d: NightDeps, o: { prs: Pr[]; clashes: Clash[]; dropped: Claim[]; holds: Claim[]; last?: { n: number; since: Date }; merged?: MergedPr[] }): Promise<string> {
  const last = o.last ?? await lastRun(d);
  let n = last.n;
  const since = last.since;
  const now = d.now();
  const iso = isoOf(since);
  type P = { number: number; title: string; author?: { login?: string } };
  const flat = (s: string) => (JSON.parse(s || "[]") as P[]).map((p) => ({ number: p.number, title: p.title, login: p.author?.login ?? "?" }));
  const merged = o.merged ? o.merged.map((p) => ({ number: p.number, title: p.title, login: p.author }))
    : flat(await d.gh(["pr", "list", "--state", "merged", "--search", `merged:>=${iso}`, "--limit", "100", "--json", "number,title,author"]));
  const opened = flat(await d.gh(["pr", "list", "--state", "all", "--search", `created:>=${iso}`, "--limit", "100", "--json", "number,title,author"]));
  const body = digestText({ login: d.login, now, since, merged, opened, waiting: o.prs.filter((p) => !p.isDraft), clashes: o.clashes, dropped: o.dropped, holds: o.holds });
  if (!n) {
    if (d.dryRun) { d.say(`would open the issue "${TITLE}" (label cowork) and post there:\n${body.replace(/^/gm, "    ")}`); return body; }
    const url = await d.gh(["issue", "create", "--title", TITLE, "--label", "cowork", "--body",
      `One comment a night from the night job (sol/night, docs/how-we-work/PRD.md section 7): what landed, what clashes, who holds what.\n\n${nightSign(d.login)}`]);
    n = Number(/\/issues\/(\d+)/.exec(url)?.[1] ?? 0);
    if (!n) throw new Error(`could not open the digest issue: ${url.trim()}`);
  }
  await post(d, n, body);
  return body;
}

/** CODEOWNERS as main has it (fetched, never checked out): the paths' labels and the labels' leads */
export async function codeownersOnMain(d: NightDeps): Promise<{ own: Owners; leads: Leads }> {
  const r = await d.git(["show", "origin/main:.github/CODEOWNERS"]);
  const text = r.code === 0 ? r.out : "";
  return { own: owners(text), leads: leads(text) };
}

/** routing: every open issue with one of the six labels gets its missing leads (leads.ts) */
export async function routeAll(d: NightDeps, l: Leads): Promise<number> {
  const raw = JSON.parse(await d.gh(["issue", "list", "--state", "open", "--limit", "200", "--json", "number,title,labels,assignees"]) || "[]") as
    { number: number; title: string; labels?: { name: string }[]; assignees?: { login: string }[] }[];
  const issues: OpenIssue[] = raw.map((i) => ({ number: i.number, title: i.title, labels: (i.labels ?? []).map((x) => x.name), assignees: (i.assignees ?? []).map((a) => a.login) }));
  const done = await routeIssues({ gh: d.gh, repo: "{owner}/{repo}", dryRun: d.dryRun, say: d.say, ping: d.ping }, issues, l);
  return done.length;
}

/** the flags: each PR merged since the last run without its leads' word, one signed line (never twice) and a ping to
 * the leads and the author */
export async function flagMerges(d: NightDeps, merged: MergedPr[], own: Owners, l: Leads): Promise<number> {
  let n = 0;
  for (const p of merged) {
    const f = mergeFlag(p, own, l);
    if (!f) continue;
    if ((await comments(d, p.number)).some((c) => c.body.includes(FLAG))) { d.say(`already flagged #${p.number}`); continue; }
    await post(d, p.number, `${flagText(f)}\n\n${nightSign(d.login)}`);
    const line = `#${p.number} ${p.title} was merged without the lead's approval (${f.unmet.map((u) => u.label).join(", ")})`.slice(0, 300);
    const to = [...new Set([...f.unmet.flatMap((u) => u.leads), p.author].filter((x) => x && x !== "?"))];
    for (const who of to) {
      if (d.dryRun) { d.say(`would ping ${who} (decision): ${line}`); continue; }
      if (!(d.ping && await d.ping({ to: who, kind: "decision", line, issue: p.number }))) d.say(`${who} not pinged: the relay is not in sight`);
    }
    n++;
  }
  return n;
}

/** the whole night: fetch, routing, clashes, claims, flags, digest; a line for each step */
export async function night(d: NightDeps, o: { staleDays: number }): Promise<void> {
  const v = (await d.git(["--version"])).out;
  if (!gitOk(v)) throw new Error(`this git is too old for the night job (${v.trim() || "unknown"}); it needs git 2.38 or newer for merge-tree --write-tree`);
  // the live checkout has no key of its own on GitHub: then fetch over https with gh's sign-in
  let f = await d.git(["fetch", "-q", "--prune", "origin"]);
  if (f.code !== 0) {
    const repo = (await d.gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).trim();
    f = await d.git(["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "fetch", "-q", "--prune",
      `https://github.com/${repo}.git`, "+refs/heads/*:refs/remotes/origin/*"]);
    if (f.code !== 0) throw new Error(`could not fetch origin: ${f.out.trim().split("\n")[0]}`);
  }
  const { own, leads: l } = await codeownersOnMain(d);
  const named = Object.values(l).filter((x) => x.length).length;
  if (!named) d.say("CODEOWNERS on main names no lead: nothing routed, nothing flagged");
  else d.say(`${await routeAll(d, l)} issues ${d.dryRun ? "would be routed" : "routed"} to their leads`);
  const prs = await openPrs(d);
  const clashes = await findClashes(d, prs);
  d.say(`${prs.length} open PRs, ${clashes.length} clashes predicted`);
  const posted = await postClashes(d, clashes);
  d.say(`${posted} clash comments ${d.dryRun ? "would be posted" : "posted"}`);
  const { dropped, holds } = await staleClaims(d, o.staleDays);
  d.say(`${holds.length} claims held, ${dropped.length} dropped`);
  const last = await lastRun(d);
  const merged = await mergedSince(d, last.since);
  const flagged = named ? await flagMerges(d, merged, own, l) : 0;
  d.say(`${merged.length} merged since the last run, ${flagged} ${d.dryRun ? "would be flagged" : "flagged"} for no lead's approval`);
  await digest(d, { prs, clashes, dropped, holds, last, merged });
}

// ---- run as a program: node dist/team/night.js [--dry-run] [--hour] ----

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export function readTeam(): TeamSettings {
  try { return cleanTeam(JSON.parse(readFileSync(process.env.SOL_TEAM ?? process.env.SOL_TEAM_FILE ?? join(ENGINE, "team.json"), "utf8"))); }
  catch { return cleanTeam({}); }
}

async function main(argv: string[]) {
  const team = readTeam();
  if (argv.includes("--hour")) { process.stdout.write(`${team.night.hour}\n`); return; }
  const root = resolve(ENGINE, "..", "..");
  const dryRun = argv.includes("--dry-run") || !team.speak.github;
  if (!team.speak.github && !argv.includes("--dry-run")) console.log("my agent may not speak on GitHub (Settings, my agent): a dry run, nothing is posted");
  const gh = (args: string[]) => runGh(args, root);
  const git = (args: string[]) => new Promise<Run>((ok) =>
    execFile("git", args, { cwd: root, timeout: 120_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, out, errOut) => ok({ code: err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 128) : 0, out: String(out) || String(errOut) })));
  const login = team.me.login || (await gh(["api", "user", "--jq", ".login"])).trim();
  console.log(`night job${dryRun ? " (dry run: nothing is posted)" : ""}, ${new Date().toISOString()}, as ${login}'s agent, claims still after ${team.night.staleDays} days`);
  const relay = dryRun ? null : relayPinger(login);
  try {
    await night({ gh, git, login, now: () => new Date(), dryRun, say: (l) => console.log(l), ...(relay ? { ping: relay.ping } : {}) }, { staleDays: team.night.staleDays });
  } finally { await relay?.close(); }
}

/** the night's pings: one relay connection, opened at the first ping (the hub, this machine's engine, keeps a ping for
 * a person none of whose Sols is on), closed at the end of the run */
function relayPinger(login: string) {
  let up: Promise<{ send: (p: Record<string, unknown>) => boolean; stop: () => void } | null> | null = null;
  const open = async () => {
    const { RelayClient, relayUrl, relayAuth } = await import("./relay.js");
    const c = new RelayClient(() => relayUrl(), () => ({ login, state: "away" as const }), "night", () => relayAuth());
    c.start();
    const ok = await new Promise<boolean>((done) => {
      if (c.up) return done(true);
      const t = setTimeout(() => { off(); done(false); }, 10_000);
      const off = c.onStatus(() => { if (c.up) { clearTimeout(t); off(); done(true); } });
    });
    if (!ok) { c.stop(); console.log("the relay is not in sight: no pings tonight"); return null; }
    const repo = (await runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], resolve(ENGINE, "..", "..")).catch(() => "")).trim();
    return { send: (p: Record<string, unknown>) => c.send("ping", { ...p, ...(repo ? { repo } : {}) }, true), stop: () => c.stop() };
  };
  return {
    ping: async (p: { to: string; kind: PingKind; line: string; issue: number }) => {
      const c = await (up ??= open());
      return !!c && c.send({ to: p.to, pingKind: p.kind, line: p.line, issue: p.issue });
    },
    close: async () => {
      const c = up ? await up : null;
      if (!c) return;
      await new Promise((r) => setTimeout(r, 500));   // the last pings leave before the socket closes
      c.stop();
    },
  };
}

const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((e) => { console.error(`night job: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
}
