// The connectors tab's one answer (#332, the Cowork PRD §4.4 and §9.4; the wire is PROTOCOL rounds 55, 57 and 60):
// `team.connectors` says the group's repositories (who connected each, when, who was let in, how many members, whether
// my own GitHub checked it, whether I asked to be let in), its things, its three tools raw, and what is connected on
// this Mac. This file reads that answer into one shape and says, for each repository row, the one thing I can do on it.
// Pure, no React, so `node --test` runs it (connectors.test.ts). An older engine sends no `repos`: connectorsOf answers
// null and the tab keeps its three-answer path (team.things, the tools, team.accounts).
import type { CalEvent, Decision, Poll } from "./useRoom";

/** a repository of the group: `in` holds GitHub logins, `by` a Sol name (the one who connected it); `checked` my own gh
 *  checked it (one of my targets); `asked` my ask to be let in is out; `admin` and `events` only when the engine says so */
export type RepoRow = { repo: string; by: string; at: string; in: string[]; members: number; checked?: true; asked?: true; admin?: true; events?: true };
/** a tool's tile, raw, for the face to say in its own words and local time (round 55) */
export type ToolTile =
  | { id: "calendar"; line: string; read: boolean; next: CalEvent | null }
  | { id: "decisions"; line: string; read: boolean; count: number; newest: Decision | null }
  | { id: "polls"; line: string; read: boolean; open: Poll[] };
export type Me = { google: { in: boolean; email?: string }; github: { in: boolean; who?: string } };
export type RecordKind = "cloud" | "github" | "drive" | "";
export type Connectors = { repos: RepoRow[]; tools: ToolTile[]; me: Me; record: RecordKind; things?: { things?: unknown; folders?: unknown; readOnly?: unknown; repo?: unknown; note?: unknown; error?: unknown } };

// a GitHub login's shape (as the hub checks it, round 57) and an owner/name's
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const REPO = /^[A-Za-z0-9-]{1,39}\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;   // never "." or ".." as a name
/** one line of text from the wire: control characters out, bounded (a name is room content any member can write) */
const line = (x: unknown, max = 140) => (typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, max) : "");

/** the answer (or a push) read into the tab's shape; null when it is not one (an error, an older engine: no `repos`) */
export function connectorsOf(m: unknown): Connectors | null {
  const a = m as { repos?: unknown; tools?: unknown; me?: any; record?: unknown; things?: unknown } | null;
  if (!a || typeof a !== "object" || !Array.isArray(a.repos)) return null;
  const repos: RepoRow[] = [];
  for (const r of a.repos.slice(0, 20) as any[]) {
    if (!r || typeof r.repo !== "string" || !REPO.test(r.repo)) continue;
    repos.push({
      repo: r.repo, by: line(r.by, 60), at: typeof r.at === "string" ? r.at : "",
      in: Array.isArray(r.in) ? r.in.filter((x: unknown): x is string => typeof x === "string" && LOGIN.test(x)).slice(0, 50) : [],
      members: Number.isInteger(r.members) && r.members > 0 ? r.members : 0,
      ...(r.checked === true ? { checked: true as const } : {}), ...(r.asked === true ? { asked: true as const } : {}),
      ...(r.admin === true ? { admin: true as const } : {}), ...(r.events === true ? { events: true as const } : {}),
    });
  }
  const tools = Array.isArray(a.tools) ? (a.tools as ToolTile[]).filter((t) => t && (t.id === "calendar" || t.id === "decisions" || t.id === "polls")) : [];
  const g = a.me?.google, h = a.me?.github;
  const me: Me = {
    google: { in: g?.in === true, ...(typeof g?.email === "string" && g.email ? { email: line(g.email, 120) } : {}) },
    github: { in: h?.in === true, ...(typeof h?.who === "string" && LOGIN.test(h.who) ? { who: h.who } : {}) },
  };
  const record: RecordKind = a.record === "cloud" || a.record === "github" || a.record === "drive" ? a.record : "";
  return { repos, tools, me, record, ...(a.things && typeof a.things === "object" ? { things: a.things as Connectors["things"] } : {}) };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** my GitHub login is one of those let into the repository */
export const letIn = (row: Pick<RepoRow, "in">, who?: string) => !!who && row.in.some((x) => same(x, who));
/** the one who may add the build-updates workflow: its admin when the engine says so, else the one who connected it */
export const maker = (row: Pick<RepoRow, "by" | "admin">, me: string) => row.admin === true || (!!me && !!row.by && same(row.by, me));

export type Action = "connect GitHub" | "ask to be let in" | "asked" | "add the workflow" | "build updates on" | "";
/** the one action at a repository row's right (pure). Only a cloud group's rows have any: a GitHub group's repository is
 *  the group itself. No GitHub here: connect it first. The maker (or the admin): the workflow, or that it is on. Anyone
 *  else: nothing once let in (or once my gh checked it), "asked" while my ask is out, else "ask to be let in" */
export function rowAction(row: RepoRow, me: { name: string; record: RecordKind }, github: { in: boolean; who?: string }, on?: boolean): Action {
  if (me.record !== "cloud") return "";
  if (!github.in) return "connect GitHub";
  if (maker(row, me.name)) return (on ?? row.events === true) ? "build updates on" : "add the workflow";
  if (letIn(row, github.who) || row.checked) return "";
  return row.asked ? "asked" : "ask to be let in";
}

/** "2 of 3": how many of the group's members were let into the repository; nothing when the members could not be counted */
export const inOf = (row: Pick<RepoRow, "in" | "members">) => (row.members > 0 ? `${Math.min(row.in.length, row.members)} of ${row.members}` : "");

/** a pasted repository read as owner/name (a github.com link too), or "" when it is not one */
export function repoOf(raw: string): string {
  const s = raw.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return REPO.test(s) ? s : "";
}
