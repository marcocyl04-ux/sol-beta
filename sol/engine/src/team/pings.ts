// Pings and dials (#100, docs/how-we-work/PRD.md section 6): five things can arrive while a person works, and all
// five land on their agent first. A predicted clash on their branch, a change to a contract they use, a claim
// overlapping theirs: the agent absorbs these and tells them at its next pause. A decision closing on their issue and a
// chat line naming them: these reach the person, one card each. A ping is a card, never a gate.
//
// Each person has a dial per kind (team.json `dials`): "always" (every one is a card), "matters" (the default: the
// rule above), "never" (nothing reaches the person; the agent still sees it). Every "matters" call that hides a ping is
// written as one line where the thing lives, a comment on its issue, so a wrong call is visible and the dial can be
// flipped; a flip is written once on the person's plan as what the agent learned.
//
// The agent's side: every ping to me is kept in STATE_DIR/pings.json (the last 100); a Work seat reads the ones it has
// not seen with the tool `pings` (tools.ts), which marks them seen. Pure but for that file (tests move it).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { STATE_DIR } from "../work/state.js";

export type PingKind = "clash" | "contract" | "claim" | "decision" | "chat" | "alert";
// alert (#225): the cloud's watch, to its two admins only (oncall.ts); it never travels the relay as a teammate's ping
export const PING_KINDS: PingKind[] = ["clash", "contract", "claim", "decision", "chat", "alert"];
export type Dial = "always" | "matters" | "never";
export const DIALS: Dial[] = ["always", "matters", "never"];
export type Dials = Record<PingKind, Dial>;
export const DIAL_DEFAULTS: Dials = { clash: "matters", contract: "matters", claim: "matters", decision: "matters", chat: "matters", alert: "matters" };

/** the kinds the agent absorbs when the dial says "when it matters"; the other two reach the person */
const ABSORBED = new Set<PingKind>(["clash", "contract", "claim"]);

/** a kind, or "chat" for anything else (an old sender says no kind) */
export const kindOf = (v: unknown): PingKind => (PING_KINDS.includes(v as PingKind) ? (v as PingKind) : "chat");

/** the dials made valid: a kind with no or a wrong value is "matters" (pure; settings.ts cleanTeam) */
export function cleanDials(v: unknown): Dials {
  const r = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out = { ...DIAL_DEFAULTS };
  for (const k of PING_KINDS) if (DIALS.includes(r[k] as Dial)) out[k] = r[k] as Dial;
  return out;
}

export type Route = { card: boolean; absorbed: boolean; written: boolean };
/** where a ping goes, by its kind and my dial: a card for me, or absorbed by my agent; `written` says the call is put
 * in one line on its issue (only "matters" hides it by a call; "never" is the person's own word) (pure) */
export function route(kind: PingKind, dial: Dial): Route {
  if (dial === "always") return { card: true, absorbed: false, written: false };
  if (dial === "never") return { card: false, absorbed: true, written: false };
  const absorbed = ABSORBED.has(kind);
  return { card: !absorbed, absorbed, written: absorbed };
}

export type Ping = { id: string; kind: PingKind; from: { login: string; agent: boolean }; line: string; at: number; issue?: number; repo?: string; seen?: boolean };

/** a relay `ping` made into a Ping, or null when it is not one. Its kind travels as `pingKind` (the envelope's own
 * `kind` is "ping"); none, from an old sender, is chat (pure) */
export function pingOf(m: Record<string, any>): Ping | null {
  const login = typeof m?.from?.login === "string" ? m.from.login : "";
  const line = typeof m?.line === "string" ? m.line.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 300) : "";
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login) || !line) return null;
  const issue = Number(m.issue);
  const repo = typeof m.repo === "string" && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(m.repo) ? m.repo : undefined;
  return {
    // an alert is the cloud watch's alone (oncall.ts, never the relay): a teammate's ping that says alert is chat
    id: typeof m.id === "string" && /^[\w-]{1,64}$/.test(m.id) ? m.id : randomUUID(), kind: m.pingKind === "alert" ? "chat" : kindOf(m.pingKind),
    from: { login, agent: m.from.agent === true }, line, at: typeof m.at === "number" ? m.at : Date.now(),
    ...(Number.isInteger(issue) && issue > 0 ? { issue } : {}), ...(repo ? { repo } : {}),
  };
}

/** the line a "when it matters" call leaves on the issue the ping is about (pure) */
export const absorbedLine = (login: string, p: Pick<Ping, "kind" | "line">) => `**absorbed** by ${login}'s agent: ${p.kind} ping, ${p.line}`;

const SAY: Record<Dial, string> = { always: "always bring to me", matters: "when it matters", never: "never" };
/** the line the agent writes once on the plan when the person flips a dial: what it learned (pure) */
export function learnedLine(kind: PingKind, was: Dial, now: Dial): string {
  const what = now === "always" ? `you want every ${kind} ping as a card, even the ones I would have kept`
    : now === "never" ? `you want no ${kind} ping to reach you; I keep them and tell you nothing`
    : ABSORBED.has(kind) ? `you want me to keep ${kind} pings and say them at my next pause` : `you want ${kind} pings as cards`;
  return `dial ${kind} → ${SAY[now]} (was ${SAY[was]}): learned that ${what}.`;
}

/** the dials that changed from a to b (pure) */
export const flipped = (a: Dials, b: Dials) => PING_KINDS.filter((k) => a[k] !== b[k]).map((k) => ({ kind: k, was: a[k], now: b[k] }));

/** the logins a chat line names: "@frank", or "frank" as a word; never me (pure) */
export function namedIn(text: string, logins: string[], me = ""): string[] {
  const t = String(text ?? "").toLowerCase();
  const out = new Set<string>();
  for (const l of logins) {
    if (!l || l.toLowerCase() === me.toLowerCase()) continue;
    const esc = l.toLowerCase().replace(/[-]/g, "\\-");
    if (new RegExp(`(?:^|[^a-z0-9-])@?${esc}(?![a-z0-9-])`).test(t)) out.add(l);
  }
  return [...out];
}

// ---- the spool: the last 100 pings to me, for the agent ----
export const SPOOL_CAP = 100;
let FILE = join(STATE_DIR, "pings.json");
/** tests: another file */
export function _pingsAt(file: string) { FILE = file; }

export function readPings(): Ping[] {
  try { const v = JSON.parse(readFileSync(FILE, "utf8")); return Array.isArray(v) ? v.filter((p) => p && typeof p.id === "string").slice(-SPOOL_CAP) : []; } catch { return []; }
}
function writePings(list: Ping[]) {
  try {
    mkdirSync(dirname(FILE), { recursive: true, mode: 0o700 });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(list.slice(-SPOOL_CAP)) + "\n", { mode: 0o600 });
    renameSync(tmp, FILE);   // never a half-written file
  } catch { /* a read-only place: nothing kept */ }
}
/** a ping to me, kept for the agent (the same id twice is one) */
export function keepPing(p: Ping) {
  const list = readPings();
  if (list.some((x) => x.id === p.id)) return;
  writePings([...list, { ...p, seen: false }]);
}
/** the pings my agent has not seen (on one issue, or all), marked seen now */
export function takePings(issue?: number): Ping[] {
  const list = readPings();
  const got = list.filter((p) => !p.seen && (!issue || !p.issue || p.issue === issue));
  if (got.length) writePings(list.map((p) => (got.includes(p) ? { ...p, seen: true } : p)));
  return got;
}
/** the newest kept ping of a kind (a flip's plan entry names its issue) */
export const lastPing = (kind: PingKind) => [...readPings()].reverse().find((p) => p.kind === kind);

/** the pings as the seat reads them: one line each (pure) */
export function pingsText(list: Ping[]): string {
  if (!list.length) return "no pings since you last looked";
  return list.map((p) => `${p.kind}${p.issue ? ` on #${p.issue}` : ""} from ${p.from.agent ? `${p.from.login}'s agent` : p.from.login}: ${p.line}`).join("\n") +
    "\n\nTell your human the clash, contract and claim ones at your next pause, in a line each; the decision and chat ones already reached them as cards unless their dials say otherwise.";
}

// ---- Claims, live (#202): the harness, on an edit of a file another branch changed, posts the hit to POST /claim;
// the engine makes it a `claim` ping to the holder, as if it came over the relay, so it meets the same route and dials ----
export type ClaimHit = { path: string; branch: string; login: string; pr?: number; issue?: number; repo?: string; from: { login?: string; branch?: string; issue?: number } };
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const CLEAN = /^[\x20-\x7e -￿]{1,300}$/;   // one line, no control characters
/** the relay-shaped ping message a claim hit makes (to the holder, kind claim, on the holder's issue), signed by me as my
 * agent; null when it names no holder, no file, or a login that is not one (pure) */
export function claimPing(h: ClaimHit, me: string): Record<string, unknown> | null {
  const to = String(h?.login ?? ""), path = String(h?.path ?? ""), branch = String(h?.branch ?? "").slice(0, 120);
  const from = String(h?.from?.login ?? me ?? ""), fromBranch = String(h?.from?.branch ?? "").slice(0, 120);
  if (!LOGIN.test(to) || !LOGIN.test(from) || !CLEAN.test(path) || !CLEAN.test(branch)) return null;
  const pr = Number(h.pr), issue = Number(h.issue), fromIssue = Number(h.from?.issue);
  const line = `claim: ${path} on your ${branch}${pr > 0 ? ` (#${pr})` : ""} is also being changed on ${fromBranch || "another branch"} (${from}${fromIssue > 0 ? `, #${fromIssue}` : ""}): they build on yours or say in their PR how theirs differs.`;
  return {
    to, pingKind: "claim", line: line.slice(0, 300), from: { login: from, agent: true }, at: Date.now(),
    ...(Number.isInteger(issue) && issue > 0 ? { issue } : {}), ...(typeof h.repo === "string" && h.repo ? { repo: h.repo } : {}),
  };
}
