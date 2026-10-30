// Build updates for a cloud group's connected repository (#328, the Cowork PRD §9.6, PROTOCOL round 60): what happened in
// it, as feed lines, for members with no gh too. Two ways a line comes, both the relay's `event` (hub-types.ts eventOf):
// - the repository's workflow, `.github/workflows/sol-group.yml`, posting to the cloud's `/relay/events/<eid>` with the
//   secret only the cloud's hash and GitHub's secret store know. `team.connect.events` (the maker or the repository's
//   admin, a private repository only) asks the cloud for the key, puts the secret in GitHub with `gh secret set` on
//   stdin (never on a command line), and commits the file into the group's clone (letin.ts's; cloned now when there is
//   none) without touching its working tree, then pushes it to the default branch with gh as git's helper. GitHub
//   refuses a workflow file from a sign-in without the `workflow` scope: then the answer is `needs: "workflow-scope"`,
//   the card's button runs `gh auth refresh -s workflow` (gh.ts, the same device flow as the sign-in), and the person
//   presses again.
// - a connector's Sol reading the board, for a repository with no workflow: the hub names one poller a repository (the
//   first Sol seated with GitHub that said `polls`), and only that Sol sends the board's new lines, as `event` with
//   source `poll`. The cloud keeps those the same way, once each.
// The workflow file is built only through `env:` and `jq -n --arg`: no `${{` ever inside `run:`, so nothing a title, a
// branch or a commit message says can run as shell (the PRD's review 2). Every word of an event is untrusted room
// content, one line of 140 at most; the feed de-dups an event against the board's own line for the same url.
// Everything that reads GitHub, git or the cloud is handed in (EventsDeps), so the tests run with fakes.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { eventOf, type EventWire } from "../hub/hub-types.js";
import { repoFacts, roomRefusal, SAY, type ConnectorsFile } from "./connectors.js";
import { ghHelper } from "./gh.js";
import { isRepo, type Room } from "./settings.js";
import type { Gh } from "./record.js";
import type { Board } from "./board.js";
import type { FeedKind, FeedLine } from "./feed.js";

export const WORKFLOW_PATH = ".github/workflows/sol-group.yml";
/** the repository secret the workflow posts with */
export const SECRET_NAME = "SOL_EVENT_SECRET";
/** the lines one poll sends at most (the hub's rate is ten a second a person) */
export const POLL_MAX = 20;
/** how far back a poller's first read reaches: a Sol that starts polling never floods the room with old lines */
export const POLL_BACK = 10 * 60_000;
/** what the card says when GitHub wants one more permission (the face's words) */
export const NEEDS_SCOPE = "GitHub needs one more permission for workflows";
const EVENT_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._-]+)*\/events\/[A-Za-z0-9_-]{16}$/;

const one = (s: string, max = 140) => s.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// ---- the workflow file ----
/** the workflow file for one repository (pure, byte-stable): on push, pull_request (opened, ready_for_review, closed),
 *  issues (opened, closed) and release (published), never issue_comment; no token of GitHub's (`permissions: {}`);
 *  every value from GitHub through `env:`, read by jq as strings, and a push's commits read by jq from the event's own
 *  file (`$GITHUB_EVENT_PATH`, review P2-7): the last 20 of 140, their total, and the head commit's first line; the
 *  url written literally, the secret GitHub's. Throws on a url that is not the cloud's events route */
export function workflowYaml(url: string): string {
  if (!EVENT_URL.test(url)) throw new Error("not an events address of Sol's cloud");
  return `# Sol's build updates for this repository's group, written by Sol (${WORKFLOW_PATH}).
# On a push, a pull request, an issue or a release, one short line goes to the group on Sol's cloud.
# Every value from GitHub is passed through env and read by jq as a string; none is ever part of the script.
name: sol-group
on:
  push:
  pull_request:
    types: [opened, ready_for_review, closed]
  issues:
    types: [opened, closed]
  release:
    types: [published]
permissions: {}
jobs:
  tell:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: tell the group
        env:
          SOL_EVENT_URL: ${url}
          SOL_EVENT_SECRET: \${{ secrets.${SECRET_NAME} }}
          EV_EVENT: \${{ github.event_name }}
          EV_ACTION: \${{ github.event.action }}
          EV_MERGED: \${{ github.event.pull_request.merged }}
          EV_ACTOR: \${{ github.actor }}
          EV_TITLE: \${{ github.event.pull_request.title || github.event.issue.title || github.event.release.name || github.event.release.tag_name || '' }}
          EV_NUMBER: \${{ github.event.pull_request.number || github.event.issue.number || '' }}
          EV_URL: \${{ github.event.pull_request.html_url || github.event.issue.html_url || github.event.release.html_url || github.event.compare || '' }}
          EV_BRANCH: \${{ github.ref_name }}
        run: |
          jq --arg event "$EV_EVENT" --arg action "$EV_ACTION" --arg merged "$EV_MERGED" --arg actor "$EV_ACTOR" \\
            --arg title "$EV_TITLE" --arg number "$EV_NUMBER" --arg url "$EV_URL" --arg branch "$EV_BRANCH" \\
            '((.commits // []) | if type == "array" then . else [] end) as $all
              | {event: $event, action: $action, merged: $merged, actor: $actor, title: ($title | .[:140]), number: $number, url: $url, branch: $branch,
                 total: ($all | length), head: ((.head_commit.message // "") | tostring | split("\\n")[0] | .[:140]),
                 commits: ($all | .[-20:] | map({sha: ((.id // "") | tostring), message: ((.message // "") | tostring | split("\\n")[0] | .[:140])}))}' \\
            "$GITHUB_EVENT_PATH" > body.json
          curl -sS -m 10 -o /dev/null -X POST "$SOL_EVENT_URL" -H "X-Sol-Event: $SOL_EVENT_SECRET" \\
            -H "content-type: application/json" --data-binary @body.json || true
`;
}

/** the lines of the `run:` block of a workflow file (pure; the test's check that none holds `\${{`) */
export function runLines(yaml: string): string[] {
  const out: string[] = [];
  let indent = -1;
  for (const l of yaml.split("\n")) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(l);
    if (m) { indent = m[1].length; out.push(m[2]); continue; }
    if (indent >= 0 && (l.trim() === "" || l.search(/\S/) > indent)) { out.push(l); continue; }
    indent = -1;
  }
  return out;
}

// ---- an event as a feed line ----
const FAMILY: Partial<Record<FeedKind, string>> = { opened: "opened", closed: "closed", landed: "landed", "pr-opened": "pr", "pr-ready": "pr" };
/** what an event and the board's own line for the same thing share (pure): its family and its url, or "" (a push, or
 *  a line with no url, is never the board's) */
export function sameAs(l: Pick<FeedLine, "kind" | "ref">): string {
  const f = FAMILY[l.kind], url = l.ref?.url;
  return f && url ? `${f} ${url.toLowerCase()}` : "";
}

/** a relay `event` as a feed line, or null (pure): rebuilt by eventOf first, its text one line of 140, its actor the
 *  person (a `[bot]` is an agent's) */
export function eventLine(m: unknown, now = Date.now()): FeedLine | null {
  const ev = eventOf(m, now);
  if (!ev) return null;
  const n = ev.number ? `#${ev.number}` : "", t = one(ev.title, 100), both = [n, t].filter(Boolean).join(" ");
  // a push: its total (the last 20 are carried), and the head commit's first line, else the last carried one's
  const k = ev.total ?? ev.commits?.length ?? 0, said = ev.head || ev.commits?.at(-1)?.message || "";
  const text = ev.event === "pushed" ? `pushed ${k} commit${k === 1 ? "" : "s"} to ${ev.branch ?? "a branch"}${said ? `: ${said}` : ""}`
    : ev.event === "pr-opened" ? `opened ${both}` : ev.event === "pr-ready" ? `marked ready ${both}` : ev.event === "landed" ? `${both} landed`
    : ev.event === "closed" ? `${both} closed` : ev.event === "opened" ? `opened ${both}` : `stamped ${t || "a release"}`;
  return { id: `ev:${ev.event}:${(ev.url ?? `${ev.repo}#${ev.number ?? ""}`).toLowerCase()}:${ev.at}`, at: new Date(ev.at).toISOString(), who: ev.actor.replace(/\[bot\]$/i, ""),
    agent: /\[bot\]$/i.test(ev.actor), kind: ev.event, text: one(text), ref: { repo: ev.repo, ...(ev.number ? { number: ev.number } : {}), ...(ev.url ? { url: ev.url } : {}) } };
}

// ---- the poll: the board's new lines as events ----
/** what a poll says once (review P2-9): its family, its url and the board's time for it, so an issue closed, reopened
 *  and closed again is two lines, and a line said again is one (pure) */
export const pollKey = (l: Pick<FeedLine, "kind" | "ref" | "at">) => { const k = sameAs(l), t = Date.parse(l.at); return k && !Number.isNaN(t) ? `${k} ${t}` : ""; };

/** the board's lines for my repositories as events to send: an issue opened or closed, a pull request opened (from when
 *  it was created), one merged, and `pr-ready` only for a draft that turned ready since the last poll (`drafts`, each
 *  pull request's draft as last seen, written here: review P2-5); at or after `since`, none whose pollKey is in `sent`,
 *  oldest first, at most POLL_MAX. Each answer's `key` goes into `sent` once it went */
export function pollEvents(board: Pick<Board, "cards" | "prs">, repos: string[], sent: Set<string>, since: number, drafts: Map<string, boolean> = new Map(), now = Date.now()): { key: string; ev: Omit<EventWire, "source"> }[] {
  const mine = (r: string) => repos.some((x) => same(x, r));
  const out: { key: string; ev: Omit<EventWire, "source"> }[] = [];
  const add = (event: EventWire["event"], repo: string, actor: string, title: string, number: number, url: string, at: string | undefined) => {
    const t = at ? Date.parse(at) : NaN;
    if (!mine(repo) || !url || Number.isNaN(t) || t < since) return;
    const key = pollKey({ kind: event, ref: { url }, at: new Date(t).toISOString() });
    if (!key || sent.has(key)) return;
    out.push({ key, ev: { repo, event, actor: actor.slice(0, 45), title: one(title), number, url, at: t } });
  };
  for (const c of board.cards) {
    add("opened", c.repo, c.author, c.title, c.number, c.url, c.created);
    if (c.closed && c.column === "closed") add("closed", c.repo, "", c.title, c.number, c.url, c.closed);
  }
  for (const p of board.prs) {
    if (p.state === "merged") add("landed", p.repo, p.author, p.title, p.number, p.url, p.mergedAt);
    if (p.created) add("pr-opened", p.repo, p.author, p.title, p.number, p.url, p.created);
    const was = drafts.get(p.url);
    if (p.state === "open" && was === true && !p.draft) add("pr-ready", p.repo, p.author, p.title, p.number, p.url, p.updated ?? new Date(now).toISOString());
    if (p.url && mine(p.repo)) drafts.set(p.url, p.draft);
  }
  return out.sort((a, b) => a.ev.at - b.ev.at).slice(0, POLL_MAX);
}

/** the repositories of my room I poll for everyone (pure): the hub's pollers name me for them */
export function myPolls(room: Pick<Room, "provider" | "repos">, pollers: Record<string, string>, me: string): string[] {
  if (room.provider !== "cloud" || !me) return [];
  return room.repos.filter((r) => same(pollers[r.toLowerCase()] ?? "", me));
}

// ---- team.connect.events ----
export type Git = (args: string[], cwd: string, o?: { env?: Record<string, string>; input?: string }) => Promise<string>;
export type Key = { eid: string; secret: string; rotated?: boolean };
export type EventsDeps = {
  gh: Gh;                                                       // my own gh: one `gh api repos/<x>` (connectors.ts repoFacts)
  github: () => Promise<{ in: boolean; who?: string }>;         // GitHub here and who (control.ts githubAccount)
  file: (room: Room) => Promise<ConnectorsFile>;                // the group's connectors.json, read fresh
  keys: (room: Room, repo: string, remove: boolean) => Promise<Key | { removed: boolean } | { error: string }>;   // the cloud's keys route, with my ticket
  hub: (room: Room) => string;                                  // the cloud's https address, …/relay (relay.ts hubHttp)
  secret: (repo: string, value: string | null) => Promise<unknown>;   // gh secret set (value on stdin) or delete
  folder: (room: Room, repo: string) => Promise<string | { error: string }>;   // the group's clone of it, cloned now if none
  git: Git;
};
export type EventsAnswer = { repo: string; added?: true; removed?: true; same?: true; left?: string } | { needs: "workflow-scope"; repo: string; say: string } | { error: string };

const lineOf = (e: unknown) => String((e as { full?: string })?.full ?? (e as Error)?.message ?? e).split("\n").map((l) => l.trim()).filter(Boolean)[0]?.slice(0, 200) || "it failed";
/** did GitHub refuse a push for want of the `workflow` scope (pure) */
export const wantsScope = (e: unknown) => /without `?workflow`? scope|refusing to allow an oauth app to create or update workflow/i.test(String((e as { full?: string })?.full ?? (e as Error)?.message ?? e));

/** every git call here runs no hook of the clone's (review P2-6): a clone's `.git/hooks` or a `core.hooksPath` it was
 *  given is the repository's or anyone's who wrote there, never something Sol runs */
const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"];

/** one file put in (or, content null, taken out of) the default branch of a clone and pushed, without touching its
 *  working tree, its index or its branches: a commit on origin's head made in a private index of its own (git's own
 *  path for it, removed after), no hook run, the push `--no-verify`. "same" when the branch already holds it */
export async function commitFile(run: Git, dir: string, path: string, content: string | null, message: string, author: string): Promise<"pushed" | "same"> {
  const git: Git = (args, cwd, o) => run([...NO_HOOKS, ...args], cwd, o);
  const at = (await git(["rev-parse", "--git-path", "sol-events-index"], dir)).trim();
  const index = isAbsolute(at) ? at : join(dir, at);
  try { return await commitIn(git, dir, index, path, content, message, author); }
  finally { rmSync(index, { force: true }); }
}
async function commitIn(git: Git, dir: string, index: string, path: string, content: string | null, message: string, author: string): Promise<"pushed" | "same"> {
  await git([...ghHelper("-c"), "fetch", "--quiet", "origin"], dir);
  const head = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir).catch(() => "origin/main")).trim() || "origin/main";
  const branch = head.replace(/^origin\//, "");
  if (!/^[\w./-]{1,100}$/.test(branch) || branch.includes("..")) throw new Error("the repository's default branch has a name Sol does not push to");
  const base = (await git(["rev-parse", `${head}^{commit}`], dir)).trim();
  const env = { GIT_INDEX_FILE: index };
  await git(["read-tree", base], dir, { env });
  if (content === null) await git(["update-index", "--force-remove", path], dir, { env });
  else {
    const blob = (await git(["hash-object", "-w", "--stdin"], dir, { input: content })).trim();
    await git(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], dir, { env });
  }
  const tree = (await git(["write-tree"], dir, { env })).trim();
  if (tree === (await git(["rev-parse", `${base}^{tree}`], dir)).trim()) return "same";
  const who = /^[A-Za-z0-9-]{1,39}$/.test(author) ? author : "sol";
  const commit = (await git(["-c", `user.name=${who}`, "-c", `user.email=${who}@users.noreply.github.com`, "commit-tree", tree, "-p", base, "-m", message], dir)).trim();
  await git([...ghHelper("-c"), "push", "--quiet", "--no-verify", "origin", `${commit}:refs/heads/${branch}`], dir);
  return "pushed";
}

/** team.connect.events { repo } (true) and .remove (false): a cloud group's repository, my own gh its admin. Adding:
 *  one its connectors.json lists, a private one; the cloud's key, the secret into GitHub, the workflow file committed
 *  and pushed; a push that fails takes a key it just minted off again (review P1-3: else the hub could stop polling a
 *  repository whose workflow never came), and one GitHub refuses for the `workflow` scope answers `needs`. Removing,
 *  also when the group no longer lists it (review P1-2: team.connect.repo.remove calls it first): the key off, the
 *  file out when my clone of it is here (else said in `left`), the secret deleted (one gh cannot delete is not fatal) */
export async function connectEvents(d: EventsDeps, room: Room, raw: unknown, adding: boolean): Promise<EventsAnswer> {
  const bar = roomRefusal(room);
  if (bar) return { error: bar };
  const want = one(typeof raw === "string" ? raw : "", 201);
  if (!isRepo(want)) return { error: SAY.which };
  const gh = await d.github().catch(() => ({ in: false, who: undefined }));
  if (!gh.in) return { error: SAY.signin };
  const facts = await repoFacts(d.gh, want);
  if (!facts) return { error: `your GitHub can't see ${want}; check its name, or ask its owner` };
  if (!facts.private) return { error: SAY.public };
  if (!facts.admin) return { error: SAY.admin };
  const author = gh.who ?? "";
  if (!adding) {
    const repo = facts.name;
    const k = await d.keys(room, repo, true).catch((e) => ({ error: lineOf(e) }));
    if ("error" in k) return k;
    const dir = await d.folder(room, repo).catch((e) => ({ error: lineOf(e) }));
    let left = "";
    if (typeof dir !== "string") left = `the workflow file is still in ${repo}; take ${WORKFLOW_PATH} out by hand`;
    else {
      try { await commitFile(d.git, dir, WORKFLOW_PATH, null, "sol: build updates off for this group", author); }
      catch (e) { if (wantsScope(e)) return { needs: "workflow-scope", repo, say: NEEDS_SCOPE }; left = `couldn't take the workflow out: ${lineOf(e)}`; }
    }
    await d.secret(repo, null).catch(() => {});   // the key is gone: a secret left behind opens nothing
    return { repo, removed: true, ...(left ? { left } : {}) };
  }
  let file: ConnectorsFile;
  try { file = await d.file(room); } catch (e) { return { error: `couldn't read the group's connectors: ${lineOf(e)}` }; }
  const row = file.repos.find((r) => same(r.repo, facts.name));
  if (!row) return { error: SAY.notHere };
  const repo = row.repo;
  const k = await d.keys(room, repo, false).catch((e) => ({ error: lineOf(e) }));
  if ("error" in k) return k;
  if (!("eid" in k)) return { error: "Sol's cloud gave no key; try again in a moment" };
  // a key minted for this press that never got its file pushed is taken off again (a rotation keeps the one that works)
  const undo = async <T>(r: T): Promise<T> => { if (!k.rotated) await d.keys(room, repo, true).catch(() => {}); return r; };
  let yaml: string;
  try { yaml = workflowYaml(`${d.hub(room).replace(/\/+$/, "")}/events/${k.eid}`); } catch (e) { return undo({ error: lineOf(e) }); }
  try { await d.secret(repo, k.secret); } catch (e) { return undo({ error: `couldn't give GitHub the secret: ${lineOf(e)}` }); }
  const dir = await d.folder(room, repo).catch((e) => ({ error: lineOf(e) }));
  if (typeof dir !== "string") return undo(dir);
  try {
    const did = await commitFile(d.git, dir, WORKFLOW_PATH, yaml, "sol: build updates for this group", author);
    return { repo, added: true, ...(did === "same" ? { same: true as const } : {}) };
  } catch (e) { return undo(wantsScope(e) ? { needs: "workflow-scope" as const, repo, say: NEEDS_SCOPE } : { error: `couldn't push the workflow: ${lineOf(e)}` }); }
}

/** git with an environment and stdin of its own, never a password prompt (the default runner of connectEvents) */
export const gitWith: Git = (args, cwd, o = {}) => new Promise<string>((ok, no) => {
  const c = spawn("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(o.env ?? {}) }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  const t = setTimeout(() => c.kill("SIGTERM"), 120_000);
  c.stdout.setEncoding("utf8"); c.stdout.on("data", (s: string) => { out += s; });
  c.stderr.setEncoding("utf8"); c.stderr.on("data", (s: string) => { err += s; });
  c.on("error", (e) => { clearTimeout(t); no(e); });
  c.on("close", (code) => { clearTimeout(t); if (code === 0) ok(out); else no(Object.assign(new Error(err.trim().split("\n")[0] || `git ${args[0]} failed`), { full: err.trim() })); });
  c.stdin.on("error", () => {});   // a git that never reads stdin may exit first (EPIPE, #444): its exit code still says how it went
  c.stdin.end(o.input ?? "");
});
