// Leads (#118, docs/how-we-work/PRD.md sections 4 and 12): a label's leads are the owners `.github/CODEOWNERS` names in
// its section (its path lines, or a `# leads:` line for a label with no code yet), at most two, humans. Two rules
// follow from them.
//   routing  an open issue wearing one of the six labels gets the label's leads assigned and pinged (kind claim), once:
//            a lead who took themselves off is never put back, and a label with no lead does nothing. The night job
//            routes every open issue; my board's read routes the issues I opened, at once (team/wire.ts)
//   the flag GitHub cannot refuse a merge here (a private repo on the free plan), so the night job reads the PRs merged
//            since its last run, and one whose labels' leads gave no word (an approving review, or a lead's own press
//            on someone else's PR) gets one signed line and a ping (kind decision) to the leads and the author.
//            The author who is a label's only lead is that label's word: nobody else could approve, GitHub refuses a
//            self-approval
// Pure but for routeIssues, whose GitHub and relay are deps (the tests fake them).
import { LABELS, areasOf, type Owners } from "./claims.js";
import type { PingKind } from "./pings.js";
import { makeGithubRecord } from "./record.js";

export type Leads = Record<string, string[]>;
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const low = (s: string) => s.toLowerCase();

/** each of the six labels' leads, read off CODEOWNERS: the @owners in its section, a team (@org/x) never, two at most */
export function leads(codeowners: string): Leads {
  const out: Leads = Object.fromEntries(LABELS.map((l) => [l, [] as string[]]));
  let label = "";
  const add = (tok: string) => {
    const who = tok.replace(/^@/, "");
    if (!label || !LOGIN.test(who) || out[label].length >= 2 || out[label].some((x) => low(x) === low(who))) return;
    out[label].push(who);
  };
  for (const raw of String(codeowners ?? "").split("\n")) {
    const line = raw.trim();
    const head = /^#\s*label\s+([a-z]+)\s*:/i.exec(line);
    if (head) { label = LABELS.includes(low(head[1])) ? low(head[1]) : ""; continue; }
    const named = /^#\s*leads\s*:(.*)$/i.exec(line);
    if (named) { for (const t of named[1].split(/\s+/)) if (t.startsWith("@")) add(t); continue; }
    if (!line || line.startsWith("#")) continue;
    for (const t of line.split(/\s+/)) if (t.startsWith("@")) add(t);
  }
  return out;
}

export type OpenIssue = { number: number; title: string; labels: string[]; assignees: string[] };

/** the leads an issue is missing: each lead of each of its six labels not assigned, never one who let it go */
export function missingLeads(i: OpenIssue, l: Leads, letGo: string[] = []): { login: string; label: string }[] {
  const have = new Set([...i.assignees, ...letGo].map(low));
  const out: { login: string; label: string }[] = [];
  for (const label of LABELS) {
    if (!i.labels.includes(label)) continue;
    for (const who of l[label] ?? []) if (!have.has(low(who))) { have.add(low(who)); out.push({ login: who, label }); }
  }
  return out;
}

export type RouteDeps = {
  gh: (args: string[]) => Promise<string>;
  repo: string;                               // "owner/name", or gh's own "{owner}/{repo}" in a checkout
  dryRun: boolean;
  say: (line: string) => void;
  /** a relay ping (kind claim); false when it could not go */
  ping?: (p: { to: string; kind: PingKind; line: string; issue: number }) => boolean | Promise<boolean>;
  seen?: Set<number>;                         // issues already settled in this engine's life: not asked again
};

/** routing: every lead an issue is missing is assigned and pinged; says each, returns the assignments */
export async function routeIssues(d: RouteDeps, issues: OpenIssue[], l: Leads): Promise<{ issue: number; leads: string[] }[]> {
  const done: { issue: number; leads: string[] }[] = [];
  const rec = makeGithubRecord(d.gh);
  for (const i of issues) {
    if (d.seen?.has(i.number) || !missingLeads(i, l).length) continue;
    // a lead who was ever taken off this issue let it go: the events say who, one read, only for an issue missing one
    const letGo = (await rec.cards.letGo(d.repo, i.number).catch(() => "")).split("\n").map((x) => x.trim()).filter(Boolean);
    const want = missingLeads(i, l, letGo);
    d.seen?.add(i.number);
    if (!want.length) continue;
    const who = want.map((w) => w.login);
    if (d.dryRun) d.say(`would assign ${who.join(", ")} to #${i.number} (lead of ${[...new Set(want.map((w) => w.label))].join(", ")})`);
    else {
      try { await rec.cards.assign(d.repo, i.number, who); }
      catch (e) { d.say(`could not assign ${who.join(", ")} to #${i.number}: ${e instanceof Error ? e.message : String(e)}`); continue; }
      d.say(`assigned ${who.join(", ")} to #${i.number}`);
    }
    for (const w of want) {
      const line = `#${i.number} ${i.title} wears ${w.label}, which you lead: it is assigned to you`.slice(0, 300);
      if (d.dryRun) { d.say(`would ping ${w.login} (claim): ${line}`); continue; }
      const sent = d.ping ? await d.ping({ to: w.login, kind: "claim", line, issue: i.number }) : false;
      if (!sent) d.say(`${w.login} not pinged: the relay is not in sight`);
    }
    done.push({ issue: i.number, leads: who });
  }
  return done;
}

export type Review = { login: string; state: string; at?: string };
export type MergedPr = { number: number; title: string; author: string; mergedBy: string; files: string[]; reviews: Review[] };
export type Flag = { pr: MergedPr; unmet: { label: string; leads: string[] }[]; self: boolean };

/** the logins whose last word on the PR is an approval (a comment is no word; a later change request takes it back) */
export function approvers(reviews: Review[]): Set<string> {
  const last = new Map<string, string>();
  const sorted = [...reviews].sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
  for (const r of sorted) if (r.login && /^(APPROVED|CHANGES_REQUESTED|DISMISSED)$/.test(r.state)) last.set(low(r.login), r.state);
  return new Set([...last].filter(([, s]) => s === "APPROVED").map(([who]) => who));
}

/** a merged PR's flag, or null: each label its diff touches (by CODEOWNERS paths) whose leads, the author aside, gave
 * no word. A lead's word is an approval, or their press on a PR not their own. No lead, no rule. The author who is a
 * label's only lead is not let off: their own press is flagged, someone else's press passes (strict, Marco 2026-10-22) */
export function mergeFlag(p: MergedPr, own: Owners, l: Leads): Flag | null {
  const yes = approvers(p.reviews);
  const author = low(p.author.replace(/\[bot\]$/i, "")), by = low(p.mergedBy.replace(/\[bot\]$/i, ""));
  const unmet: Flag["unmet"] = [];
  for (const label of areasOf(p.files, own)) {
    const leads = l[label] ?? [];
    if (!leads.length) continue;   // no lead, no rule
    const others = leads.filter((x) => low(x) !== author);
    // the author is its only lead (strict, Marco 2026-10-22): their own press on their own PR is still nobody else's
    // look, so it is flagged; someone else's press on it is the second pair of eyes and passes
    if (!others.length) { if (by === author) unmet.push({ label, leads }); continue; }
    if (others.some((x) => yes.has(low(x)) || low(x) === by)) continue;
    unmet.push({ label, leads: others });
  }
  return unmet.length ? { pr: p, unmet, self: !!by && by === author } : null;
}

export const FLAG = "**Merged without the lead's approval**";
/** the one line on the PR (signed by the caller) */
export function flagText(f: Flag): string {
  const where = f.unmet.map((u) => `${u.label} (lead ${u.leads.join(" and ")})`).join(", ");
  const by = f.self ? `merged by ${f.pr.mergedBy}, its own author,` : `merged by ${f.pr.mergedBy || "someone"}`;
  return `${FLAG}: it touches ${where} and was ${by} with no approval from a lead. GitHub cannot refuse it here; the lead looks now and says yes, or opens the fix.`;
}
