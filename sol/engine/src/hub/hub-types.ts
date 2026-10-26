// The hub's own words (#206, S1 of #168): the format rules and the wire shapes the hub, its registry and spool, and
// every client agree on. Hub-owned and importing nothing, so the hub loads without the engine (relay-hub.ts); the
// engine's team settings re-export the rules from here (settings.ts), so there is one copy of each.

export const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const LOGIN = /^[A-Za-z0-9-]{0,39}$/;
/** a share code (#157): six symbols of 32, no 0, O, 1 or I, so a code read aloud or typed by hand has one reading.
 *  registry.ts exports it as the code's own */
export const CODE = /^[A-HJ-NP-Z2-9]{6}$/;

export const KINDS = ["hello", "roster", "presence", "changed", "hand", "stable", "ping", "talk", "show", "room", "watch"] as const;
export type Kind = (typeof KINDS)[number];
export type From = { login: string; agent: boolean };
export type RelayMsg = { kind: Kind; from: From; at: number; spooled?: boolean; [k: string]: unknown };
/** what the spool keeps and hands back: only what the relay already carried, and only these */
export const SPOOLED: readonly Kind[] = ["talk", "ping", "room"];
export type PresenceState = "here" | "elsewhere" | "away" | "working" | "yourcall";
/** the thing a person is in now (#230, the studio PRD §9.2): its id in the room's things, its name, whether their face
 *  has it open in front or their agent said so, and when that was last said (the sender's clock, ms) */
export type RosterThing = { id: string; name: string; source: "face" | "agent"; at: number };
/** a session started under the room (#230, §9.6): its id, its title, the thing beside it. Only a room's own sessions
 *  are ever said; a private Work or Life session never is */
export type RosterSession = { id: string; title: string; thing?: string };
export type RosterEntry = { who: string; agent: boolean; machine: string; state: PresenceState; session?: { title: string; repo?: string }; since: number;
  thing?: RosterThing; sessions?: RosterSession[]; quiet?: true };   // quiet (#238): they turned "show my room sessions" off here
/** the room sessions one roster entry may carry */
export const SESSIONS_MAX = 5;

// the close codes a hello can get: an unknown code (the room is gone, or was never), over its guesses, and a room with
// as many people on as it takes (#208, A9)
export const GONE = 4404, SLOWED = 4429, FULL = 4409;
/** a hello from a Sol older than the hub takes (#223, C1): "please update Sol" */
export const TOO_OLD = 4426;
/** a connection that kept sending after the hub said wait (#223, B2): a minute, then again */
export const TOO_FAST = 4430;
/** a connection the cloud's admin closed (#225, S7): its account was disabled, or its room closed */
export const KICKED = 4403;

/** the wire's version (#223, C1): what a hello says as `v`. A hello with none is 1, every Sol before S6a. 2 (S6a): `watch`,
 *  ids on every message, the hub's answers (kind `hub`): its hello, an ok for a kept kind, retry, the light, update */
export const PROTOCOL = 2;
/** the hub's own word to one connection (#223), never a kind a client may send: { say: "hello" | "ok" | "retry" |
 *  "watch" | "light" | "update", ... } */
export const HUB = "hub";

const STATES = new Set<PresenceState>(["here", "elsewhere", "away", "working", "yourcall"]);
export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** the creature's eight states said as the five a teammate sees (listening and speaking are "here") */
export function presenceOf(state: string): PresenceState {
  return STATES.has(state as PresenceState) ? (state as PresenceState) : state === "unplugged" ? "elsewhere" : "here";
}

const THING_ID = /^[\w-]{1,40}$/, SESSION_ID = /^[\w-]{1,80}$/;
// one line of plain text: no control or format characters, whitespace folded, cut to max
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** a presence's thing as the hub passes it (#230): exactly id, name, source and at, each checked; anything else, none */
export function thingOf(v: unknown): RosterThing | undefined {
  if (!isObj(v) || typeof v.id !== "string" || !THING_ID.test(v.id)) return undefined;
  if (v.source !== "face" && v.source !== "agent") return undefined;
  if (typeof v.at !== "number" || !Number.isFinite(v.at) || v.at <= 0) return undefined;
  return { id: v.id, name: line(v.name, 60), source: v.source, at: Math.floor(v.at) };
}

/** a presence's room sessions as the hub passes them (#230): at most SESSIONS_MAX, each id, title and a thing id */
export function sessionsOf(v: unknown): RosterSession[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: RosterSession[] = [];
  for (const x of v) {
    if (out.length >= SESSIONS_MAX) break;
    if (!isObj(x) || typeof x.id !== "string" || !SESSION_ID.test(x.id) || out.some((o) => o.id === x.id)) continue;
    out.push({ id: x.id, title: line(x.title, 120), ...(typeof x.thing === "string" && THING_ID.test(x.thing) ? { thing: x.thing } : {}) });
  }
  return out.length ? out : undefined;
}

/** a show's line roles (#101) */
export const SHOW_ROLES = ["person", "agent", "tool"] as const;
/** a show's line, at most this long (show.ts TEXT_MAX) */
export const SHOW_TEXT_MAX = 400;
export type ShowWire = { issue: number; repo: string; session: { id: string; title: string }; event: "start" | "line" | "end";
  scope?: "room"; thing?: string; line?: { role: (typeof SHOW_ROLES)[number]; text: string; at: number } };
// a line's text: no control or format characters but the newlines a show's lines are glued with, cut to the max
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\p{Cf}]|[^\P{Cc}\n]/gu, "").trim().slice(0, max) : "");

/** a show as the hub passes it (#238): rebuilt field by field, each checked, so nothing a sender adds rides along (a
 *  file, a path, a tool's output). An issue show (#101) names its issue; a room session's show (`scope: "room"`, the
 *  studio PRD §9.6) names none. Anything else, null: not carried */
export function showOf(v: Record<string, unknown>): ShowWire | null {
  const ev = v.event;
  if (ev !== "start" && ev !== "line" && ev !== "end") return null;
  const s = isObj(v.session) ? v.session : null;
  if (!s || typeof s.id !== "string" || !SESSION_ID.test(s.id)) return null;
  const room = v.scope === "room";
  const issue = room ? 0 : Number(v.issue);
  if (!room && (!Number.isInteger(issue) || issue <= 0 || issue > 1e9)) return null;
  const repo = room ? "" : typeof v.repo === "string" && /^[\w.\/-]{0,100}$/.test(v.repo) ? v.repo : "";
  const out: ShowWire = { issue, repo, session: { id: s.id, title: line(s.title, 120) }, event: ev };
  if (room) { out.scope = "room"; if (typeof v.thing === "string" && THING_ID.test(v.thing)) out.thing = v.thing; }
  if (ev === "line") {
    const l = isObj(v.line) ? v.line : null;
    if (!l || !SHOW_ROLES.includes(l.role as never)) return null;
    const t = text(l.text, SHOW_TEXT_MAX);
    if (!t) return null;
    out.line = { role: l.role as (typeof SHOW_ROLES)[number], text: t, at: typeof l.at === "number" && Number.isFinite(l.at) && l.at > 0 ? Math.floor(l.at) : Date.now() };
  }
  return out;
}
