// The room's record on GitHub (#152, docs/room-provider/FOUNDATION.md): the first provider of team/record.ts. Every gh
// call in team/ lives here (Work's own two, in work/panes.ts and work/overview.ts, are not the room's record), grouped by verb, moved from the team/ file that made it with its arguments as they were
// (the comments say which file). gh's own sign-in is used, never a token in Sol, except the hub's question of who a
// token is (identity.ts), where the token rides in GH_TOKEN of one child gh.
//
// The runners are the ones each file had, kept apart because their timeouts, buffers and envs differ (a share reads
// big trees, a try waits longer, the members read is small); folding them into one is a change of its own, not this
// move. makeGithubRecord(gh) is the provider over any one of them, or over a test's fake.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Gh, GhAs, GhBytes, GhInput, RoomRecord } from "../record.js";
import { slug } from "../settings.js";

// the one file of a proof gist: the hub's word (src/hub/proof.ts, #208), which its own GitHub reads look for too
import { PROOF_FILE } from "../../hub/index.js";
export { PROOF_FILE };

const run = promisify(execFile);
const ENV = () => ({ ...process.env, GIT_TERMINAL_PROMPT: "0" });

// ---- the runners ----

/** the default (was note.ts runGh): in a folder, no prompt, the first line of what gh said on a failure as the message;
 *  the whole of it on `full` (#194: gh's `(HTTP nnn)` is on the last line, so a classifier reads that) */
export const runGh: Gh = (args, cwd) => new Promise<string>((ok, no) =>
  execFile("gh", args, { cwd, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    (err, out, errOut) => { if (!err) return ok(String(out)); const full = String(errOut || err.message).trim(); no(Object.assign(new Error(full.split("\n")[0]), { full })); }));

/** gh with stdin (#328: `gh secret set`, whose value goes on stdin, never on a command line any process list shows) */
export const runGhStdin = (args: string[], input: string, cwd?: string) => new Promise<string>((ok, no) => {
  const c = execFile("gh", args, { cwd, timeout: 30_000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    (err, out, errOut) => { if (!err) return ok(String(out)); const full = String(errOut || err.message).trim(); no(Object.assign(new Error(full.split("\n")[0]), { full })); });
  c.stdin?.end(input);
});

export const runners = {
  note: runGh,
  /** board.ts: 30 s, 16 MB */
  board: ((args) => new Promise<string>((ok, no) =>
    execFile("gh", args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => (err ? no(err) : ok(String(out)))))) as Gh,
  /** members.ts: 20 s, 4 MB */
  members: ((args) => new Promise<string>((ok, no) =>
    execFile("gh", args, { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => (err ? no(err) : ok(String(out)))))) as Gh,
  /** hand.ts: no prompt, 30 s, 16 MB */
  hand: ((args) => run("gh", args, { env: ENV(), timeout: 30_000, maxBuffer: 16 << 20 }).then((r) => r.stdout)) as Gh,
  /** try.ts: no prompt, 60 s, 16 MB, trimmed */
  try: ((args) => run("gh", args, { env: ENV(), timeout: 60_000, maxBuffer: 16 << 20 }).then((r) => r.stdout.trim())) as Gh,
  /** share.ts: 30 s, 32 MB */
  share: ((args) => run("gh", args, { timeout: 30_000, maxBuffer: 32 << 20 }).then((r) => String(r.stdout))) as Gh,
  /** share.ts: bytes, 30 s, 48 MB */
  shareBytes: ((args) => run("gh", args, { timeout: 30_000, maxBuffer: 48 << 20, encoding: "buffer" }).then((r) => r.stdout as Buffer)) as GhBytes,
  /** ship.ts: in sol/, no prompt, 30 s, 8 MB */
  ship: (root: string): Gh => (args) => run("gh", args, { cwd: root, env: ENV(), timeout: 30_000, maxBuffer: 8 << 20 }).then((r) => r.stdout),
  /** settings.ts: who I am on first run, 15 s */
  settings: ((args) => new Promise<string>((ok, no) =>
    execFile("gh", args, { timeout: 15_000 }, (err, out) => (err ? no(err) : ok(String(out)))))) as Gh,
  /** identity.ts: as one token, in its env only (never on the command line), 15 s */
  as: ((args, token) => new Promise<string>((ok, no) => {
    const env: NodeJS.ProcessEnv = { ...process.env, GH_TOKEN: token };
    delete env.GITHUB_TOKEN;   // only this token, nothing else the shell had
    execFile("gh", args, { env, timeout: 15_000 }, (err, out) => (err ? no(new Error("gh refused")) : ok(String(out))));
  })) as GhAs,
};

/** this person's GitHub token, read fresh from gh for one connect (never kept); "" when gh is not signed in */
const tokenNow = () => new Promise<string>((ok) =>
  execFile("gh", ["auth", "token"], { timeout: 10_000 }, (err, out) => ok(err ? "" : String(out).trim())));

const INPUT_DIR = join(tmpdir(), "sol-file");
/** gh with a JSON body: written to a private temp file, handed on --input, deleted (was file.ts) */
export async function ghWithInput(gh: (args: string[]) => Promise<string>, args: string[], body: object): Promise<string> {
  mkdirSync(INPUT_DIR, { recursive: true, mode: 0o700 });
  const p = join(INPUT_DIR, `body-${randomBytes(6).toString("hex")}.json`);
  writeFileSync(p, JSON.stringify(body), { mode: 0o600 });
  try { return await gh([...args, "--input", p]); } finally { rmSync(p, { force: true }); }
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
/** a file's raw text through the contents API (was share.ts raw) */
const raw = (repo: string, path: string, ref?: string) => ["api", `repos/${repo}/contents/${enc(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`, "-H", "Accept: application/vnd.github.raw"];

// ---- the provider ----

export type More = { bytes?: GhBytes; as?: GhAs; input?: GhInput };

/** the record on GitHub, through one gh runner (a test's fake, or one file's own); bytes, a token's gh and gh with an
 * --input body have their own runners, the real ones unless given */
/** four lower-case symbols (no 0, o, 1, l) for a repository name made from a name GitHub cannot take */
export const tag = (random: (n: number) => Uint8Array = randomBytes) => [...random(4)].map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

export function makeGithubRecord(gh: Gh, more: More = {}): RoomRecord {
  const bytes = more.bytes ?? runners.shareBytes;
  const as = more.as ?? runners.as;
  const input = more.input ?? ((args: string[], body: object) => ghWithInput((a) => gh(a), args, body));
  const json = async (args: string[]) => JSON.parse(await gh(args));   // was board.ts ghJson
  const R = (repo?: string) => (repo !== undefined ? ["-R", repo] : []);   // "" still goes to gh, which refuses it, as before
  return {
    who: {
      login: () => gh(["api", "user", "--jq", ".login"]),                                   // night.ts
      me: () => gh(["api", "user", "--jq", "{login: .login, name: .name}"]),                // settings.ts fillMe
      loginAs: (token) => as(["api", "user", "--jq", ".login"], token),                    // identity.ts
      token: () => tokenNow(),                                                             // identity.ts ghToken
      // proof.ts: a secret gist of mine holding a hub's nonce, so a hub learns who I am without my token
      prove: (text) => gh(["api", "-X", "POST", "gists", "-F", "public=false", "-f", `files[${PROOF_FILE}][content]=${text}`, "--jq", ".id"]),
      unprove: (id) => gh(["api", "-X", "DELETE", `gists/${id}`, "--silent"]),
      proofOf: (id) => gh(["api", `gists/${id}`, "--jq", `{owner: .owner.login, text: .files["${PROOF_FILE}"].content}`]),   // the hub's read
    },

    members: {
      ofOrg: (org) => gh(["api", `orgs/${org}/members`, "--paginate", "--jq", ".[].login"]),                 // members.ts
      inOrgAs: (org, login, token) => as(["api", `orgs/${org}/members/${login}`, "--silent"], token),        // identity.ts: 204 = a member
      inOrg: (org, login) => gh(["api", `orgs/${org}/members/${login}`, "--silent"]),                         // proof.ts: the hub's own sign-in
      admin: (repo) => gh(["api", `repos/${repo}`, "--jq", ".permissions.admin"]),                           // press.ts isOwner
      people: (repo) => gh(["api", `repos/${repo}/collaborators`, "--paginate", "--jq", '.[] | select(.type == "User") | .login']),   // press.ts
      room: () => gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]),                // note.ts, night.ts
      // let in (#162). A collaborator added by the owner's gh is GitHub's own invitation, accepted from the friend's gh
      // push, not pull: anyone can read a public repository, and still needs to be added to work in it
      canWrite: (repo) => gh(["api", `repos/${repo}`, "--jq", ".permissions.push"]).then((t) => t.trim() === "true", () => false),
      // private (#325): the invitation's own word, since a private repository is not readable before it is accepted
      invitations: async () => (await gh(["api", "user/repository_invitations", "--paginate", "--jq", ".[] | {id: .id, repo: .repository.full_name, private: .repository.private} | tojson"]))
        .split("\n").flatMap((l) => { try { const v = JSON.parse(l); return Number.isInteger(v?.id) && typeof v?.repo === "string" ? [{ id: v.id as number, repo: v.repo as string, ...(typeof v.private === "boolean" ? { private: v.private as boolean } : {}) }] : []; } catch { return []; } }),
      accept: (id) => gh(["api", "-X", "PATCH", `user/repository_invitations/${id}`]),
      // GitHub answers 201 and the invitation when it made one, 204 and nothing when the person was a collaborator already
      invite: async (repo, login) => ((await gh(["api", "-X", "PUT", `repos/${repo}/collaborators/${login}`, "-f", "permission=push"])).trim() ? "invited" : "already"),
    },

    cards: {
      // board.ts
      list: (repo) => json(["issue", "list", "-R", repo, "--state", "all", "--limit", "100", "--json", "number,title,state,labels,assignees,author,createdAt,closedAt,milestone,url"]),
      // board.ts. 40, not 50: with each PR's commits, 50 asks GitHub for more than its 500,000-node limit and the read
      // fails. files rides in the same one request (#98): no request per PR
      prs: (repo) => json(["pr", "list", "-R", repo, "--state", "all", "--limit", "40", "--json", "number,title,body,isDraft,state,headRefName,baseRefName,author,createdAt,mergedAt,mergeCommit,reviewDecision,updatedAt,url,commits,files"]),
      open: (title, label, body, repo) => gh(["issue", "create", ...R(repo), "--title", title, "--label", label, "--body", body]),   // file.ts, night.ts
      openIssues: () => gh(["issue", "list", "--state", "open", "--limit", "200", "--json", "number,title,labels,assignees"]),       // night.ts routeAll
      held: () => gh(["issue", "list", "--state", "open", "--label", "now", "--limit", "100", "--json", "number,title,assignees"]),   // night.ts
      nowIn: (repo) => gh(["issue", "list", "-R", repo, "--label", "now", "--state", "open", "--limit", "1", "--json", "number", "--jq", ".[0].number // empty"]),   // ship.ts
      find: (title) => gh(["issue", "list", "--state", "open", "--search", `"${title}" in:title`, "--limit", "20", "--json", "number,title"]),   // night.ts
      pr: (repo, n) => gh(["pr", "view", String(n), "-R", repo, "--json", "title,url,headRefName"]),                           // hand.ts
      assignees: (issue) => gh(["issue", "view", String(issue), "--json", "assignees", "--jq", ".assignees[].login"]),         // note.ts
      assign: (repo, issue, who) => gh(["api", "-X", "POST", `repos/${repo}/issues/${issue}/assignees`, ...who.flatMap((x) => ["-f", `assignees[]=${x}`])]),   // leads.ts
      give: (repo, n, to, pr) => gh([pr ? "pr" : "issue", "edit", String(n), "-R", repo, "--add-assignee", to]),                // hand.ts
      passBack: (repo, n, off, on) => gh(["issue", "edit", String(n), "-R", repo, "--remove-assignee", off, "--add-assignee", on]),   // hand.ts
      addReviewer: (repo, pr, to) => gh(["pr", "edit", String(pr), "-R", repo, "--add-reviewer", to]),                         // hand.ts
      unlabel: (issue, label) => gh(["issue", "edit", String(issue), "--remove-label", label]),                                 // night.ts
      letGo: (repo, issue) => gh(["api", "--paginate", `repos/${repo}/issues/${issue}/events?per_page=100`,
        "--jq", '.[] | select(.event == "unassigned") | .assignee.login']),                                                     // leads.ts
      takenAt: (issue) => gh(["api", "--paginate", `repos/{owner}/{repo}/issues/${issue}/events?per_page=100`,
        "--jq", `.[] | select(.event == "assigned" or (.event == "labeled" and .label.name == "now")) | .created_at`]),         // night.ts
    },

    notes: {
      add: (issue, body, repo) => gh(["issue", "comment", String(issue), ...R(repo), "--body", body]),        // note, hand, ship, show, wire
      addOnPr: (pr, body, repo) => gh(["pr", "comment", String(pr), ...R(repo), "--body", body]),            // note, wire
      post: (issue, body) => gh(["api", "-X", "POST", `repos/{owner}/{repo}/issues/${issue}/comments`, "-f", `body=${body}`]),   // night.ts
      lines: (issue) => gh(["api", "--paginate", `repos/{owner}/{repo}/issues/${issue}/comments?per_page=100`,
        "--jq", ".[] | {body, at: .created_at, login: .user.login} | tojson"]),                                  // night.ts
      of: (repo, n) => json(["api", `repos/${repo}/issues/${n}/comments?per_page=100`]),                     // board.ts
      recent: (repo, sort) => json(["api", `repos/${repo}/issues/comments?sort=${sort}&direction=desc&per_page=100`]),   // board.ts (updated), hand.ts (created)
    },

    files: {
      read: (repo, path, ref) => gh(raw(repo, path, ref)),                                                   // board.ts, share.ts
      bytes: (repo, path, ref) => bytes(raw(repo, path, ref)),                                               // share.ts
      readSha: (repo, path, ref) => gh(["api", `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, "--jq", "{sha: .sha, content: .content}"]),   // note.ts, press.ts
      put: (repo, path, w, commit) => gh(["api", "-X", "PUT", `repos/${repo}/contents/${path}`, "-f", `message=${w.message}`, "-f", `branch=${w.branch}`,
        "-f", `content=${w.content}`, ...(w.sha !== undefined ? ["-f", `sha=${w.sha}`] : []), ...(commit ? ["--jq", ".commit.sha"] : [])]),   // note.ts, press.ts
      putBody: (repo, path, body) => input(["api", "-X", "PUT", `repos/${repo}/contents/${path}`], body),   // file.ts
      remove: (repo, path, w) => gh(["api", "-X", "DELETE", `repos/${repo}/contents/${path}`, "-f", `message=${w.message}`, "-f", `branch=${w.branch}`, "-f", `sha=${w.sha}`]),   // talk.ts (#315)
      branch: (repo) => gh(["api", `repos/${repo}`, "--jq", ".default_branch"]).then((t) => t.trim()),       // things.ts (#194)
      tree: (repo) => gh(["api", `repos/${repo}/git/trees/HEAD?recursive=1`]),                                // share.ts
      list: (repo, dir, ref) => gh(["api", `repos/${repo}/contents/${dir}?ref=${encodeURIComponent(ref)}`]),  // share.ts
      // share.ts: the last commit on each path, one GraphQL request for the lot (a batch of at most 60)
      lastCommits: async (repo, items) => {
        const [owner, name] = repo.split("/");
        const refs = [...new Set(items.map((x) => x.ref))];
        const body = refs.map((ref, r) => `r${r}: object(expression: ${JSON.stringify(ref)}) { ... on Commit { ${items.map((x, i) => (x.ref === ref
          ? `h${i}: history(first: 1, path: ${JSON.stringify(x.path)}) { nodes { committedDate message author { name email user { login } } committer { name email user { login } } } }` : "")).join(" ")} } }`).join(" ");
        const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${body} } }`;
        const got = await gh(["api", "graphql", "-f", `query=${query}`]).then((t) => JSON.parse(t)?.data?.repository ?? {}, () => null);
        if (!got) return null;
        return items.map((x, i) => got[`r${refs.indexOf(x.ref)}`]?.[`h${i}`]?.nodes?.[0]);
      },
    },

    // #160: a room made from a name alone. A private repository under my own account, named after the room (its slug,
    // then -2 to -5 when one of that name is there), with a README so it has a main branch. gh signed out is said in
    // one plain line; any other refusal is gh's own first line
    room: {
      make: async (name) => {
        const signedOut = (m: string) => /auth login|not logged|authenticat/i.test(m);
        let login = "";
        try { login = (await gh(["api", "user", "--jq", ".login"])).trim(); }
        catch (e) { const m = String((e as Error)?.message ?? e); throw signedOut(m) ? new Error("sign in to GitHub first") : e; }
        if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new Error("sign in to GitHub first");
        // a name with no letters or digits GitHub can take (a Chinese one) gets "room-" and four symbols of its own, so two
        // such rooms are not room and room-2
        const root = slug(name) || `room-${tag()}`;
        for (let i = 1; i <= 5; i++) {
          const repo = `${login}/${i === 1 ? root : `${root.slice(0, 36)}-${i}`}`;
          try {
            const out = await gh(["repo", "create", repo, "--private", "--add-readme", "--description", `a Sol room: ${name}`]);
            const url = /github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(out.trim().split("\n").pop() ?? "");
            return url ? url[1] : repo;
          } catch (e) {
            const m = String((e as Error)?.message ?? e);
            if (/already exists/i.test(m)) continue;
            throw signedOut(m) ? new Error("sign in to GitHub first") : e;
          }
        }
        throw new Error("you have five repositories of that name already; try another name");
      },
    },

    changes: {
      commitsBy: (repo, login) => json(["api", `repos/${repo}/commits?author=${login}&per_page=30`]),        // board.ts
    },

    code: {
      branches: (repo) => json(["api", `repos/${repo}/branches?per_page=100`]),                              // board.ts
      branch: (repo, name) => gh(["api", `repos/${repo}/branches/${encodeURIComponent(name)}`, "--jq", ".name"]),   // note.ts, file.ts
      mainSha: (repo) => gh(["api", `repos/${repo}/git/ref/heads/main`, "--jq", ".object.sha"]),            // note.ts, file.ts
      makeBranch: (repo, name, sha) => gh(["api", "-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/heads/${name}`, "-f", `sha=${sha}`]),   // note.ts, file.ts
      heads: (repo) => gh(["api", `repos/${repo}/git/matching-refs/heads/`]),                                 // share.ts
      compare: (repo, base, head) => gh(["api", `repos/${repo}/compare/${base}...${head}`, "--jq", ".status"]),   // board.ts
      status: (repo, sha, s) => gh(["api", "-X", "POST", `repos/${repo}/statuses/${sha}`, "-f", `state=${s.state}`, "-f", `context=${s.context}`, "-f", `description=${s.description}`]),   // ship.ts
      prsOfBranch: (branch) => gh(["pr", "list", "--state", "open", "--head", branch, "--json", "number", "--jq", ".[].number"]),   // note.ts
      openPrs: () => gh(["pr", "list", "--state", "open", "--limit", "100", "--json", "number,headRefName,author,title,body,isDraft"]),   // night.ts
      prSearch: (state, search, fields) => gh(["pr", "list", "--state", state, "--search", search, "--limit", "100", "--json", fields]),   // night.ts
      prHead: (repo, n) => gh(["pr", "view", String(n), "--repo", repo, "--json", "number,title,headRefName,headRefOid,isCrossRepository,author,state"]),   // try.ts
      ready: (repo, n) => gh(["pr", "ready", String(n), "--repo", repo]),                                    // try.ts
      prComment: (repo, n, body) => gh(["pr", "comment", String(n), "--repo", repo, "--body", body]),       // try.ts
      lineComment: (repo, n, c) => gh(["api", "-X", "POST", `repos/${repo}/pulls/${n}/comments`,
        "-f", `body=${c.body}`, "-f", `commit_id=${c.commit}`, "-f", `path=${c.path}`, "-F", `line=${c.line}`, "-f", "side=RIGHT"]),   // try.ts
    },
  };
}
