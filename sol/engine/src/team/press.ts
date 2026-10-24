// The owner's press (#117): the team's settings, set from Cowork and landed on main at once, with no PR. Two classes
// of change are told apart: a setting (who leads each label; later the night job's hour and who holds the stamp) is
// the owner's word and lands now; a change to how Sol works (code, the labels and their paths, the harness, the
// workflows) goes through Work: a take, a draft PR, the lead's approval.
//
// The press is the one commit main takes outside a PR. It is the person's own, made by the engine through GitHub's
// contents API (as team_note writes a plan page) and signed by their login, never by an agent; the harness refuses an
// agent the same write by hand (rule `main-by-api` in sol/harness/guard names this file as the one door). GitHub says
// who the owner is: the press goes through only when `permissions.admin` on the repo is true for the person signed
// in, so Sol keeps no list of owners. The council (#38) takes this over when it exists.
//
// The first setting is the leads: `.github/CODEOWNERS` keeps them, because GitHub reads them there to ask a lead for
// the review. Each label has one or two leads, people with access to the repo (no bots, no teams). A press rewrites
// only the owners on that label's lines, never a path; the team is pinged (kind decision) once it has landed.
import { owners, LABELS } from "./claims.js";

export type PressDeps = {
  gh: (args: string[]) => Promise<string>;                 // the GitHub CLI (gh's own sign-in, never a token in Sol)
  login: () => Promise<string>;                            // the person pressing
  team: () => string[];                                    // the team's logins (members.ts), pinged after a press
  ping: (to: string, line: string, repo: string) => boolean;   // a relay ping, kind decision; false when not in sight
};
export type LeadsDone =
  | { ok: true; repo: string; label: string; leads: string[]; was: string[]; commit?: string; unchanged?: boolean; pinged: string[] }
  | { error: string };

export const CODEOWNERS = ".github/CODEOWNERS";
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const HEAD = /^#\s*label\s+([a-z]+)\s*:/i;
const LEADS_LINE = /^(\s*#\s*leads\s*:\s*).*$/i;
const at = (l: string[]) => l.map((x) => `@${x}`).join(" ");

/** each label's leads as CODEOWNERS says them: the owners on its path lines and its `# leads:` line, in order, once
 * each, without the @. A label with no line is an empty list (pure) */
export function leadsOf(codeowners: string): Record<string, string[]> {
  const out: Record<string, string[]> = Object.fromEntries(LABELS.map((l) => [l, [] as string[]]));
  let label = "";
  for (const raw of String(codeowners ?? "").split("\n")) {
    const line = raw.trim();
    const head = HEAD.exec(line);
    if (head) { label = LABELS.includes(head[1].toLowerCase()) ? head[1].toLowerCase() : ""; continue; }
    if (!label || !line) continue;
    const toks = LEADS_LINE.test(line) ? line.replace(/^#\s*leads\s*:/i, "").trim().split(/\s+/) : line.startsWith("#") ? [] : line.split(/\s+/);
    for (const t of toks) if (t.startsWith("@") && !out[label].includes(t.slice(1))) out[label].push(t.slice(1));
  }
  return out;
}

/** a label's new leads made valid: one or two GitHub logins, no bot, each once. Returns the list or the reason (pure) */
export function cleanLeads(v: unknown): string[] | string {
  if (!Array.isArray(v)) return "the leads are a list of one or two people";
  const out: string[] = [];
  for (const x of v) {
    const l = String(x ?? "").trim().replace(/^@/, "");
    if (!l) continue;
    if (/\[bot\]$/i.test(l) || !LOGIN.test(l)) return `${l} is not a person's GitHub login`;
    if (!out.some((o) => o.toLowerCase() === l.toLowerCase())) out.push(l);
  }
  if (!out.length) return "a label needs one lead: somebody triages its issues";
  if (out.length > 2) return "a label has at most two leads";
  return out;
}

/** CODEOWNERS with one label's owners replaced on every line of its section, its paths and the rest untouched. Throws
 * when the label has no line to carry them (pure) */
export function setLeads(codeowners: string, label: string, leads: string[]): string {
  let cur = "", hit = false;
  const next = String(codeowners).split("\n").map((raw) => {
    const line = raw.trim();
    const head = HEAD.exec(line);
    if (head) { cur = head[1].toLowerCase(); return raw; }
    if (cur !== label || !line) return raw;
    if (LEADS_LINE.test(raw)) { hit = true; return raw.replace(LEADS_LINE, `$1${at(leads)}`); }
    if (line.startsWith("#")) return raw;
    const m = /^(.*?\S)(\s+)@\S+(?:\s+@\S+)*\s*$/.exec(raw);   // the paths, the gap, then only owners to the end
    if (!m) return raw;
    hit = true;
    return `${m[1]}${m[2]}${at(leads)}`;
  }).join("\n");
  if (!hit) throw new Error(`CODEOWNERS has no line for ${label}; adding one is a change to how Sol works, a PR`);
  // a setting moves people, never paths: what each label holds must read exactly as before
  if (JSON.stringify(owners(next)) !== JSON.stringify(owners(codeowners))) throw new Error("the paths moved; a press only changes who leads");
  return next;
}

/** the commit's words: what changed, who pressed, why it has no PR (pure) */
export function leadsMessage(label: string, leads: string[], was: string[], by: string): string {
  return [
    `settings: ${label} leads → ${at(leads)}`,
    "",
    `Set by ${by} in Cowork, the owner's press (#117): a setting lands on main at once, without a PR. Changes to how`,
    `Sol works still go through a take, a draft PR and the lead's approval.`,
    `Was: ${was.length ? at(was) : "nobody"}.`,
    "",
    "Sol-Setting: leads",
  ].join("\n");
}

/** the line the team is pinged with (pure) */
export const leadsLine = (label: string, leads: string[], was: string[], by: string) =>
  `${label} is now led by ${leads.join(" and ")} (was ${was.length ? was.join(" and ") : "nobody"}), set by ${by}`;

const why = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200);

/** is this login the repo's owner? GitHub's own word: admin on the repo, for the person gh is signed in as */
export async function isOwner(d: Pick<PressDeps, "gh">, repo: string): Promise<boolean> {
  return (await d.gh(["api", `repos/${repo}`, "--jq", ".permissions.admin"]).catch(() => "")).trim() === "true";
}

/** the people who may lead: the repo's collaborators who are users (no bots), sorted */
export async function candidates(d: Pick<PressDeps, "gh">, repo: string): Promise<string[]> {
  const out = await d.gh(["api", `repos/${repo}/collaborators`, "--paginate", "--jq", '.[] | select(.type == "User") | .login']);
  return [...new Set(out.split(/\s+/).filter((l) => LOGIN.test(l)))].sort((a, b) => a.localeCompare(b));
}

/** a file on main as it is now: its text and the blob sha a write must name */
async function readMain(d: Pick<PressDeps, "gh">, repo: string, path: string) {
  const j = JSON.parse(await d.gh(["api", `repos/${repo}/contents/${path}?ref=main`, "--jq", "{sha: .sha, content: .content}"]));
  return { sha: String(j.sha ?? ""), text: Buffer.from(String(j.content ?? ""), "base64").toString("utf8") };
}

/** one commit on main, by the person: the file's new text, written only over the version just read (GitHub refuses
 * it when main moved the file since, and the press says so) */
export async function landOnMain(d: Pick<PressDeps, "gh">, repo: string, path: string, text: string, sha: string, message: string): Promise<string> {
  try {
    return (await d.gh(["api", "-X", "PUT", `repos/${repo}/contents/${path}`, "-f", `message=${message}`, "-f", "branch=main",
      "-f", `content=${Buffer.from(text).toString("base64")}`, "-f", `sha=${sha}`, "--jq", ".commit.sha"])).trim();
  } catch (e) {
    if (/\b409\b|does not match/i.test(why(e))) throw new Error(`${path} changed on main a moment ago; read the board again and press once more`);
    throw e;
  }
}

/** the press: who leads a label, set by the owner, landed on main, the team pinged */
export async function pressLeads(d: PressDeps, req: { repo: string; label: string; leads: unknown }): Promise<LeadsDone> {
  const { repo, label } = req;
  if (!LABELS.includes(label)) return { error: `the labels are ${LABELS.join(", ")}` };
  const leads = cleanLeads(req.leads);
  if (typeof leads === "string") return { error: leads };
  try {
    const me = await d.login();
    if (!me) return { error: "who is pressing? sign in to GitHub first" };
    if (!(await isOwner(d, repo))) return { error: `only the owner of ${repo} sets who leads; GitHub says ${me} is not` };
    const people = await candidates(d, repo);
    const out = leads.filter((l) => !people.some((p) => p.toLowerCase() === l.toLowerCase()));
    if (out.length) return { error: `${out.join(" and ")} ${out.length > 1 ? "have" : "has"} no access to ${repo}; invite them on GitHub first` };
    const now = leads.map((l) => people.find((p) => p.toLowerCase() === l.toLowerCase()) ?? l);   // GitHub's spelling
    const file = await readMain(d, repo, CODEOWNERS);
    const was = leadsOf(file.text)[label];
    const next = setLeads(file.text, label, now);
    if (next === file.text) return { ok: true, repo, label, leads: now, was, unchanged: true, pinged: [] };
    const commit = await landOnMain(d, repo, CODEOWNERS, next, file.sha, leadsMessage(label, now, was, me));
    // the team hears it: every member, and everyone who leads anything before or after, but the one who pressed
    const all = Object.values(leadsOf(next)).flat().concat(Object.values(leadsOf(file.text)).flat(), d.team());
    const to = [...new Set(all.map((l) => l.toLowerCase()))].filter((l) => l !== me.toLowerCase())
      .map((l) => all.find((x) => x.toLowerCase() === l)!);
    const line = leadsLine(label, now, was, me);
    const pinged = to.filter((t) => d.ping(t, line, repo));
    return { ok: true, repo, label, leads: now, was, commit, pinged };
  } catch (e) {
    return { error: why(e) };
  }
}
