// The brief and team_note (#83, docs/how-we-work/PRD.md sections 3 and 10): the two doors between a Work session and
// the team's memory. The brief is read-only: `sol/brief <issue>` run in the session's repo, printed, thrown away.
// team_note is the one way an agent writes to that memory: the issue, a kind and a few lines; the engine posts it
// signed "<login>'s agent", and the kind routes it. `change` goes to the issue and to the open PR of the session's
// branch; `decision` to the issue as a **Decision** line (the line where its subject lives is the author's own edit in
// the PR); `plan` to the person's plan.md on their <login>/plan branch, dated; `heads-up` to another issue, named.
// Nothing from the team's memory is ever written into a person's own memory or home.
// Pings (#100): a decision pings the issue's other assignees (kind decision); a heads-up pings the other issue's
// assignees, of the kind the note names in `ping` (default chat). The ping is a card or absorbed by their dials.
import { execFile } from "node:child_process";
import { kindOf, type PingKind } from "./pings.js";

export type Kind = "change" | "decision" | "plan" | "heads-up";
export const KINDS: Kind[] = ["change", "decision", "plan", "heads-up"];
export type Note = { issue: number; kind: Kind; lines: string; to?: number; ping?: PingKind };
export type NoteDeps = {
  cwd: string;                                              // the session's folder: the repo and its current branch
  gh: (args: string[], cwd?: string) => Promise<string>;     // the GitHub CLI (gh's own sign-in, never a token here)
  git: (args: string[], cwd: string) => Promise<string>;
  login: () => Promise<string>;                             // the person's GitHub login
  mayGitHub: () => boolean;                                 // Settings, my agent: may it speak on GitHub
  now?: () => Date;
  /** a relay ping to a teammate (relay.ts sendRelay "ping"); false when the team is not in sight */
  ping?: (p: { to: string; kind: PingKind; line: string; issue: number; repo: string }) => boolean;
};

export const sign = (login: string) => `— ${login || "<login>"}'s agent`;
const clean = (s: string) => String(s ?? "").trim().split("\n").map((l) => l.trimEnd()).join("\n").slice(0, 4000);

export const runGh = (args: string[], cwd?: string) => new Promise<string>((ok, no) =>
  execFile("gh", args, { cwd, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    (err, out, errOut) => (err ? no(new Error(String(errOut || err.message).trim().split("\n")[0])) : ok(String(out)))));
export const runGit = (args: string[], cwd: string) => new Promise<string>((ok, no) =>
  execFile("git", args, { cwd, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => (err ? no(err) : ok(String(out).trim()))));

/** the brief: sol/brief <issue> in the session's repo, as text */
export async function brief(cwd: string, issue: number): Promise<string> {
  const top = await runGit(["rev-parse", "--show-toplevel"], cwd).catch(() => null);
  if (!top) throw new Error("this session's folder is not a git repository");
  return new Promise<string>((ok, no) =>
    execFile("bash", ["sol/brief", String(issue)], { cwd: top, timeout: 90_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, out, errOut) => (err ? no(new Error(String(errOut || err.message).trim().split("\n")[0] || "the brief failed")) : ok(String(out)))));
}

/** team_note: post a few signed lines where the kind says; returns one line saying where it went */
export async function teamNote(d: NoteDeps, n: Note): Promise<string> {
  if (!Number.isInteger(n.issue) || n.issue <= 0) throw new Error("which issue? team_note needs its number");
  if (!KINDS.includes(n.kind)) throw new Error(`kind is one of ${KINDS.join(", ")}`);
  const lines = clean(n.lines);
  if (!lines) throw new Error("nothing to note: give a few lines");
  if (!d.mayGitHub()) throw new Error("my agent may not speak on GitHub (Settings, my agent); the note was not posted");
  const login = await d.login();
  const sig = sign(login);
  const comment = async (number: number, body: string) => {
    await d.gh(["issue", "comment", String(number), "--body", body], d.cwd);
    return `#${number}`;
  };

  if (n.kind === "change") {
    const went = [await comment(n.issue, `${lines}\n\n${sig}`)];
    const branch = await d.git(["symbolic-ref", "--short", "-q", "HEAD"], d.cwd).catch(() => "");
    if (branch && branch !== "main") {
      const prs = await d.gh(["pr", "list", "--state", "open", "--head", branch, "--json", "number", "--jq", ".[].number"], d.cwd).catch(() => "");
      for (const p of prs.split("\n").map((x) => x.trim()).filter(Boolean)) {
        await d.gh(["pr", "comment", p, "--body", `${lines}\n\n${sig}`], d.cwd).catch(() => undefined);
        went.push(`PR #${p}`);
      }
    }
    return `posted on ${went.join(" and ")}`;
  }
  if (n.kind === "decision") {
    await comment(n.issue, `**Decision.** ${lines}\n\n${sig}`);
    const pinged = await pingHolders(d, login, n.issue, "decision", `a decision on #${n.issue}: ${lines}`);
    return `posted on #${n.issue} as a decision; the line where its subject lives is yours to write in the PR${pinged}`;
  }
  if (n.kind === "heads-up") {
    if (!Number.isInteger(n.to) || !n.to || n.to === n.issue) throw new Error("a heads-up needs `to`: the other issue's number");
    await comment(n.to, `**Heads-up** from #${n.issue}: ${lines}\n\n${sig}`);
    const pinged = await pingHolders(d, login, n.to, kindOf(n.ping), `heads-up from #${n.issue}: ${lines}`);
    return `posted on #${n.to} as a heads-up from #${n.issue}${pinged}`;
  }
  // plan: a dated entry at the end of the person's plan.md on their <login>/plan branch, made if it is not there
  const repo = (await d.gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], d.cwd)).trim();
  if (!repo) throw new Error("no GitHub repository here");
  const ref = `${login}/plan`;
  const day = (d.now?.() ?? new Date()).toISOString().slice(0, 10);
  const entry = `\n## ${day}, #${n.issue}\n\n${lines}\n`;
  const have = await d.gh(["api", `repos/${repo}/contents/plan.md?ref=${encodeURIComponent(ref)}`, "--jq", "{sha: .sha, content: .content}"], d.cwd).catch(() => "");
  let sha = "", body = "";
  if (have.trim()) { const j = JSON.parse(have); sha = String(j.sha ?? ""); body = Buffer.from(String(j.content ?? ""), "base64").toString("utf8"); }
  else {
    const exists = await d.gh(["api", `repos/${repo}/branches/${encodeURIComponent(ref)}`, "--jq", ".name"], d.cwd).catch(() => "");
    if (!exists.trim()) {
      const main = (await d.gh(["api", `repos/${repo}/git/ref/heads/main`, "--jq", ".object.sha"], d.cwd)).trim();
      await d.gh(["api", "-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/heads/${ref}`, "-f", `sha=${main}`], d.cwd);
    }
    body = `# ${login}'s plan\n\nKept by ${login} and their agent; the board draws it.\n`;
  }
  const next = Buffer.from(body.replace(/\s*$/, "\n") + entry).toString("base64");
  const args = ["api", "-X", "PUT", `repos/${repo}/contents/plan.md`, "-f", `message=plan: #${n.issue}, ${day} (${sig})`, "-f", `branch=${ref}`, "-f", `content=${next}`];
  if (sha) args.push("-f", `sha=${sha}`);
  await d.gh(args, d.cwd);
  return `written to ${login}'s plan (plan.md on ${ref}); the board shows it`;
}

/** a ping to every assignee of the issue but me; says whom, in a tail for the note's answer */
async function pingHolders(d: NoteDeps, me: string, issue: number, kind: PingKind, line: string): Promise<string> {
  if (!d.ping) return "";
  const got = await d.gh(["issue", "view", String(issue), "--json", "assignees", "--jq", ".assignees[].login"], d.cwd).catch(() => "");
  const who = got.split("\n").map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== me.toLowerCase());
  if (!who.length) return "";
  const repo = (await d.gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], d.cwd).catch(() => "")).trim();
  const sent = who.filter((to) => d.ping!({ to, kind, line: line.split("\n")[0].slice(0, 300), issue, repo }));
  return sent.length ? `; pinged ${sent.join(", ")} (${kind})` : `; ${who.join(", ")} not in sight, no ping`;
}
