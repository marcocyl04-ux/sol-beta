// The team relay (Together, See #31; PROTOCOL.md round 17). One small hub any engine can run at the path /relay on
// its own port, and one client in every engine that joins a hub (its own, or a teammate's at settings.relay.url).
// It carries presence and pings between engines; it holds nothing (no history, no files, no prompts). Every message
// is signed: { kind, from: { login, agent }, at, ...payload }, and the hub stamps from.login with the login the
// connection said hello with, so nobody speaks as somebody else.
//
// The gate: the key in ?key= (settings.relay.key, given to a teammate by hand), compared in constant time, and no
// browser page but Sol's own. There is no owner check here: a teammate's login is not the owner's, by design.
// Once team.json names a GitHub org (#102, round 26), the gate is GitHub instead (identity.ts): the knock carries the
// person's own token, the hub asks GitHub who it is and whether they are in the org, and stamps GitHub's login.
// Kinds: hello, roster, presence, changed {repo}, hand, stable, ping {to, line, pingKind?, issue?, repo?}, talk. Unknown
// kinds are dropped.
// The hub's one memory (#102): `talk` and `ping` for a person none of whose Sols was on the relay are kept in the
// spool (spool.ts) and handed over as `spooled { messages }` on their next hello; the client gives each one to its
// usual handlers with `spooled: true`, then the whole list to the `spooled` handlers.
// show (#101, round 27): a shown session's live lines, dropped to a connection that is falling behind.
// Rooms on one hub (#157, round 35): a hello may name the room's share code; the hub keeps every room apart, so a
// roster, a line or a ping reaches only the connections in the same room. No code is the hub's common space, where
// every room from before codes meets as it did. The spool keeps a message's room and hands it back only on a hello in
// that room. The open gate (relay.open on the beta's hub): any GitHub user, by their token, when there is no org.
// The hub's registry (registry.ts) answers two http routes beside the socket, /relay/rooms, behind the same gate; and
// the join page (join.ts, #327), /relay/j/<code>, with no gate, on a host that serves it.
// Let in (#162, round 37): `room` is a friend's Sol asking to be let into a room's repository ({ want: "in", repo }),
// and the maker's Sol answering ({ to, repo, in, why? }). An answer has a `to`, so it reaches that person only, as a
// ping does, and is kept in the spool for a friend who left. An ask to the whole room is never kept: the friend's Sol
// asks again on every connect and every ten minutes while it is up, so a kept one would only pile up for every person
// of the room. A cloud group's ask (#325, round 57) is a person's press, said once, to the maker only (`to`) with the
// asker's GitHub login (`github`): it is kept for the maker like a ping. Each is rebuilt by roomOf (hub-types.ts).
// The hub on its own (#206, S1 of #168): this file is the hub and its gate, and loads nothing of the engine (no team
// settings, pings, record, identity or members) and starts nothing at load, so it can run on a box with no engine.
// What it needs of GitHub is handed in: `verify` (who a token is) and `reads` (the proof gist and the org check); with
// none, every token is refused. The engine's wiring (relay.ts) hands in its own, the client is relay-client.ts.
// Talk kept (#315, round 54): a hub run with a talk store (the cloud's rooms.db; the engine's own hub has none and keeps
// only the spool, as before) hands each talk line said in a coded room to the store, and on a hello in that room sends
// `talk.history { thread, lines }` for each thread, its last lines, so a Sol that restarts or comes late has the talk.
// A talk line is rebuilt field by field here (talkOf): its thread, text, part, to and `file` (an attachment the sender's
// Sol wrote into the room's record, at a path named after the line), so a line carries a path, a name, a size and a
// kind, never bytes. A hello may say `talkSince { [thread]: at }`, and then gets only newer lines.
// Build updates (#328, round 60): `event` is what happened in a cloud group's connected repository. The cloud's route
// hears it from the repository's workflow and hands it to `event()`; a connector's Sol that reads the board says it
// itself (source `poll`), and only the room's poller for that repository may (`pollers`: the first Sol seated there with
// GitHub signed in that said in its hello or presence it may read that repository, `polls`, for each repository with no
// workflow key). Each is rebuilt by eventOf, kept by the host's hook (`events`, the cloud's table), and goes to the
// room; a hello in the room gets the last 50 (`events.recent`) after the spool. Never spooled.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { timingSafeEqual, createHash } from "node:crypto";
import { isIP } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { CODE, LOGIN, KINDS, SPOOLED, GONE, SLOWED, FULL, TOO_OLD, TOO_FAST, KICKED, PROTOCOL, HUB, TALK_HISTORY, isObj, presenceOf, thingOf, sessionsOf, showOf, talkOf, talkSinceOf, githubOf, solVersionOf, roomOf, eventOf, pollsOf, type Kind, type RelayMsg, type RosterEntry, type EventWire } from "./hub-types.js";
import { Bucket, rank, type Light, type Queue } from "./load.js";
import type { Spool } from "./spool.js";
import type { RoomRegistry, Guesses } from "./registry.js";
import type { Proofs, ProofReads } from "./proof.js";

const cut = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
const SOMEONE = /^[A-Za-z0-9-]{1,39}$/;   // a GitHub login GitHub gave back (hub-types' LOGIN also takes "")

// ---- who a knock is, by GitHub (moved from identity.ts, which re-exports them; all pure) ----
/** GitHub's login for this token when it is a member of the org (org "": any GitHub user), else null */
export type Verify = (token: string, org: string) => Promise<string | null>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** the token in `Authorization: Bearer <token>`, or "" */
export function bearerOf(headers: IncomingMessage["headers"]): string {
  const m = /^Bearer\s+(\S{1,400})\s*$/i.exec(one(headers.authorization) ?? "");
  return m ? m[1] : "";
}

/** no browser page but Sol's own (the same rule as the key's gate) */
export function originOk(headers: IncomingMessage["headers"], port: number): boolean {
  const o = one(headers.origin);
  if (o === undefined) return true;   // a program: another engine
  return new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", `http://127.0.0.1:${port}`, `http://localhost:${port}`]).has(o);
}

/** the org gate: GitHub's login for this knock, or null (refused). verify is injected: the tests never reach GitHub */
export async function orgGate(headers: IncomingMessage["headers"], org: string, port: number, verify: Verify): Promise<string | null> {
  if (!org || !originOk(headers, port)) return null;
  const token = bearerOf(headers);
  if (!token) return null;
  const login = await verify(token, org).catch(() => null);
  return login && SOMEONE.test(login) ? login : null;
}

/** the open gate (#157): GitHub's login for this knock's token, no org asked, or null (refused). A knock with no token
 *  never comes here: it goes to the key's gate */
export async function openGate(headers: IncomingMessage["headers"], port: number, verify: Verify): Promise<string | null> {
  if (!originOk(headers, port)) return null;
  const token = bearerOf(headers);
  if (!token) return null;
  const login = await verify(token, "").catch(() => null);
  return login && SOMEONE.test(login) ? login : null;
}

/** the hub's verify, which also knows its own tickets (proof.ts): a `sol1.` Bearer is this hub's signed word, asked of
 *  nobody; anything else is a GitHub token, asked of GitHub as before (an older Sol, or a Sol on this machine) */
export function withTickets(verify: Verify, proofs?: { check: (ticket: string, org: string) => string | null }): Verify {
  return async (token, org) => (token.startsWith("sol1.") ? proofs?.check(token, org) ?? null : verify(token, org));
}

// what the hub has when nobody handed it a way to ask GitHub: no token is anyone, no gist is read
const refuseAll: Verify = async () => null;
const readNothing: ProofReads = { proofOf: async () => { throw new Error("this hub reads no gists"); }, inOrg: async () => { throw new Error("this hub asks no org"); } };

// ---- the hub ----
export type Conn = { send: (line: string) => void; behind?: () => boolean; close?: (code?: number, why?: string) => void;   // behind: its socket is backed up
  ip?: string };   // where it came from, when the host reads addresses (ServerOpts.ip): its code guesses count there too (#208)

export type HubOpts = {
  spool?: Spool;                // absent: the hub keeps nothing (tests, and an engine that is not the host)
  people?: () => string[];      // who a talk line is kept for, besides the logins the spool has seen say hello
  registry?: RoomRegistry;      // the rooms shared by a code (#157): a hello in one is written down as one of its people
  guesses?: Guesses;            // codes tried that no room has, per caller, shared with the http routes (#157)
  open?: () => boolean;         // the hub lets strangers in by GitHub (relay.open): a coded room is GitHub's logins' only
  roomOnlineMax?: number;       // people (logins) on in one room at once (#208, A9); default ROOM_ONLINE_MAX, the beta's
  // under load (#223, S6a); every default is the cloud's, and the engine's own hub passes its old ways (relay.ts ENGINE_HUB)
  watchOnly?: boolean;          // A6: a show's lines only to its watchers (default); false: to the whole room, as before
  streamsMax?: number;          // B1: shows one person watches at once (STREAMS_MAX)
  linesPerSec?: number;         // B1: a show's lines a second at the hub (LINES_PER_SEC); Infinity none
  rate?: Rates | null;          // B2: a person's messages (RATES); null none
  minVersion?: number;          // C1: the oldest wire a hello may say (PROTOCOL - 1: this one and the one before); 0 any
  load?: () => Light;           // B3: the light now (load.ts Load); none: always green
  budget?: Budget;              // B5: each person's month of traffic; none: no budget
  talk?: TalkKeeper;            // #315: each coded room's talk kept (the cloud's); none: the spool only, as before
  events?: EventHook;           // #328: a room's build updates kept by the host (the cloud); none: none kept, none polled
  joinPage?: boolean;           // #327: this hub's host serves the join page (join.ts), so a hello's answer says `join: true`
};

/** a hub's store of each coded room's talk (#315): `keep` a line as the hub carried it (its id, thread, from, at, text,
 *  file), `last` each thread's last lines for a hello in the room, oldest first, only those newer than `since[thread]`
 *  when the hello said it. The store checks and bounds what it keeps itself (the cloud's: members only, 2 MB a room) */
export type TalkKeeper = { keep: (room: string, line: RelayMsg) => void; last: (room: string, since?: Record<string, number>) => { thread: string; lines: RelayMsg[] }[] };

/** what the host keeps of a room's build updates (#328; the cloud's rooms.db, table `event`): `keep` is false when it
 *  had that one already (a poller's line said again), so it goes out once; `recent` the last 50, oldest first; `keyed`
 *  the repositories whose workflow key is live (it has had one post with its secret), which nobody polls; `connected` the repositories the room's record lists
 *  (the cloud's `.sol/connectors.json`, read at most once a minute): a `polls` entry for any other is dropped. With no
 *  `connected`, the registry's repos for the room */
export type EventHook = { keep: (room: string, ev: EventWire) => boolean; recent: (room: string) => EventWire[]; keyed: (room: string) => string[]; connected?: (room: string) => string[] };

/** B5: the bytes sent to each person, and how far past their month they are: 0 within, 1 past (streams slow), 2 far
 *  past (no streams). Chat never minds it */
export type Budget = { add: (login: string, bytes: number) => void; level: (login: string) => 0 | 1 | 2 };
/** B2: a token bucket's rate and burst for each of a connection's messages, a person's (all their connections), and
 *  a connection's show lines; `strikes` times told to wait in a minute closes the connection (TOO_FAST) */
export type Rates = { conn: { per: number; burst: number }; account: { per: number; burst: number }; show: { per: number; burst: number }; strikes: number };
/** the cloud's (CAPACITY: a busy person says a line every ten seconds; a presence is one in thirty): five a second and
 *  twenty at once a connection, ten and forty a person, fifteen show lines (three shows) a connection */
export const RATES: Rates = { conn: { per: 5, burst: 20 }, account: { per: 10, burst: 40 }, show: { per: 15, burst: 30 }, strikes: 60 };
/** B1: shows one person watches at once */
export const STREAMS_MAX = 2;
/** B1: a show's lines a second at the hub (show.ts sends at most five) */
export const LINES_PER_SEC = 5;
/** the lines of each show the hub keeps for a watcher who comes later */
export const TAIL = 30;
/** a presence's roster to a room at most once in this many ms (#230's review); hellos and leaves are not held */
export const ROSTER_EVERY = 1000;

/** the beta's cap on people on in one room at once (#208, MASTER A9): one more is closed with FULL; a person already in
 *  the room may bring another machine. The engine's own hub passes Infinity (relay.ts), as it had none */
export const ROOM_ONLINE_MAX = 20;
/** the machines one person may have on in one room (the review of #208): each is a roster line every hello sends to
 *  the whole room, so a person's own many sockets must not make the room's rosters big */
export const MACHINES_MAX = 5;
/** the close code of a seat a machine's new connection took over (MACHINES_MAX) */
export const REPLACED = 4000;
/** how often the hub asks each socket if it is still there (#208): one that did not answer the last ask is closed, so a
 *  sleeping laptop's old socket does not hold a seat for long. 0: never (the tests) */
export const HEARTBEAT_MS = 30_000;

/** who a guess at a code is counted against (the stack's review): GitHub's login when a gate asked GitHub. A key
 *  holder's hello says any login it likes, so it counts against that login and against every key holder together,
 *  `key` (registry.ts KEY_GUESS_MAX, ten times one caller's): a new login on every knock still meets the shared count.
 *  And against the caller's address, `ip <address>` (IP_GUESS_MAX), when the host reads addresses (#208, A12: the cloud,
 *  behind Caddy): new accounts from one machine still meet one count. The engine reads none: it listens on 127.0.0.1
 *  behind tailscale serve, so every caller comes from there */
export const guessers = (login: string | undefined, said = "", ip = ""): string[] =>
  [...(login ? [login] : said ? [`key ${said}`, "key"] : ["key"]), ...(ipBucket(ip) ? [`ip ${ipBucket(ip)}`] : [])];

/** the address a guess counts against: an IPv4 address as it is; an IPv6 address by its /64, the block one line or one
 *  machine is given, so a new address from the same block is the same count (the review of #208). "" stays "" (pure) */
export function ipBucket(ip: string): string {
  if (isIP(ip) !== 6) return isIP(ip) === 4 ? ip : "";
  // an IPv4 address mapped into IPv6, in any case, dotted or in hex, is that IPv4 address
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(ip.split("%")[0]);
  if (mapped && (mapped[1] ? isIP(mapped[1]) === 4 : true)) {
    if (mapped[1]) return mapped[1];
    const hi = parseInt(mapped[2], 16), lo = parseInt(mapped[3], 16);
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  const [head, tail = ""] = ip.toLowerCase().split("%")[0].split("::");
  const a = head ? head.split(":") : [], b = tail ? tail.split(":") : [];
  if (b.length && b[b.length - 1].includes(".")) b.splice(b.length - 1, 1, "0", "0");   // an IPv4 tail is the low 32 bits
  if (a.length && a[a.length - 1].includes(".")) a.splice(a.length - 1, 1, "0", "0");
  const full = ip.includes("::") ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return `${full.slice(0, 4).map((h) => (parseInt(h, 16) || 0).toString(16)).join(":")}::/64`;
}
export { GONE, SLOWED, FULL, TOO_OLD, TOO_FAST, KICKED };   // the close codes a hello can get (hub-types.ts)

// a connection's place on the hub: what the roster says of it, and the room it said hello in ("" the common space)
type Seat = RosterEntry & { room: string; v: number; polls?: string[] };   // v: the wire its hello said (C1); polls: what it may read the board of (#328)
const entryOf = ({ room: _r, v: _v, polls: _p, ...e }: Seat): RosterEntry => e;   // the room, version and polls are the hub's to know, never sent

// Connections are kept by room as well (#208, A7): a line, a roster or a spool check touches the connections of one room,
// never every socket on the hub, so a busy room costs only its own people.
// Under load (#223, S6a): a stream's lines go only to the people watching it (A6), a person watches at most two (B1),
// a stream is at most five lines a second (B1), a person's messages are a rate (B2) and a message said twice is
// carried once (C2); the lights (load.ts) slow streams, then stop them. Every send is counted for the lights and
// for each person's month (B5). The engine's own hub passes its old ways (relay.ts ENGINE_HUB): nothing changes there.
// a room session's stream (`room`, #238) goes to its watchers only on every hub, the engine's own too, under the cloud's
// numbers: two watched a person, five lines a second
type Stream = { start: string; tail: string[]; watchers: Set<Conn>; lines: Bucket | null; owner: string; room?: boolean };   // room unset: a watcher's place-holder, not heard start yet
const ID = /^[\w-]{1,80}$/;
const DUP_TTL = 10 * 60_000, DUP_MAX = 2000, STREAMS_A_ROOM = 100, STREAMS_A_PERSON = 5, STRIKE_WINDOW = 60_000;

export class RelayHub {
  private conns = new Map<Conn, Seat | null>();          // null until it said hello
  private rooms = new Map<string, Set<Conn>>();          // the connections that said hello in each room ("" the common space)
  private fixed = new Map<Conn, string>();               // GitHub's login for a connection the org gate let in
  private opened = new Set<Conn>();                      // let in by the open gate: a stranger with a GitHub account
  private greeted = new Set<Conn>();                     // said hello once: a connection says it once (the client does)
  private people = new Map<string, Set<Conn>>();         // a person's seated connections, every room (by login, lower case)
  private streams = new Map<string, Map<string, Stream>>();   // each room's shown sessions, by `<login>/<session id>`
  private watching = new Map<Conn, Set<string>>();       // what each connection watches: `<room> <stream>`
  private seenIds = new Map<string, Map<string, number>>();   // each room's ids said lately (C2), `<login> <id>` → when
  private buckets = new Map<Conn, { msgs: Bucket; shows: Bucket; strikes: number[] }>();
  private slow = new Map<Conn, Map<string, Bucket>>();     // a person past their month: one line a second of each show (B5)
  private accounts = new Map<string, Bucket>();          // each person's messages, all their connections together (B2)
  /** what was sent, for the lights (load.ts): messages and bytes since the hub began */
  sent = { msgs: 0, bytes: 0 };
  /** build updates sent (#328), counted apart: never in a person's month (the budget) nor the lights' traffic */
  eventsSent = { msgs: 0, bytes: 0 };
  /** what the light held back (show lines on yellow, orange and red), so the lights read what is wanted (load.ts) */
  held = { msgs: 0, bytes: 0 };
  /** the largest message a connection may send; relayServer sets it from its own (MSG_MAX), the hello says it */
  msgMax = MSG_MAX;
  /** what the cloud's watch reads (#225, S7), by name, never on the public health: who was told to wait in the last
   *  minute and how often, who was refused as too old in the last day, and the errors (a message that threw) so far */
  private limited = new Map<string, number[]>();
  private tooOld = new Map<string, number>();
  errors = 0;

  constructor(private opts: HubOpts = {}) {}

  private get watchOnly() { return this.opts.watchOnly ?? true; }
  private get rate() { return this.opts.rate === undefined ? RATES : this.opts.rate; }
  private light(): Light { return this.opts.load?.() ?? "green"; }

  /** a connection came in; `login` is GitHub's word for it when a gate asked GitHub; `open` when that gate was the open
   *  one (#157), which lets such a connection into a room with a code only */
  join(c: Conn, login?: string, open = false) { this.conns.set(c, null); if (login) this.fixed.set(c, login); if (open) this.opened.add(c); }

  leave(c: Conn) {
    const had = this.conns.get(c);
    this.conns.delete(c);
    this.fixed.delete(c);
    this.opened.delete(c);
    this.greeted.delete(c);
    this.buckets.delete(c);
    this.slow.delete(c);
    for (const k of this.watching.get(c) ?? []) this.unwatch(c, k);
    this.watching.delete(c);
    if (!had) return;
    const set = this.rooms.get(had.room);
    set?.delete(c);
    if (set && !set.size) this.rooms.delete(had.room);
    const low = had.who.toLowerCase(), mine = this.people.get(low);
    mine?.delete(c);
    if (mine && !mine.size) this.people.delete(low);
    // a person's bucket outlives their connections until it is full again: a reconnect is no fresh burst (the review)
    if (mine && !mine.size) this.forgetBucket(low);
    // the person has no connection left in the room: their shows there are over (their engine's prune says so too)
    if (!this.seats(had.room).some((e) => e.who.toLowerCase() === low)) {
      const ss = this.streams.get(had.room);
      for (const [k, s] of ss ?? []) if (s.owner === low && !s.watchers.size) ss!.delete(k); else if (s.owner === low) { s.start = ""; s.tail = []; }
      if (ss && !ss.size) this.streams.delete(had.room);
    }
    // an empty room's ids are forgotten once they could no longer match (the review: else every room ever used kept some)
    if (!set?.size) this.sweepIds(had.room);
    this.rosterTo(had.room);
  }

  /** close every connection of one person (#225, S7: their account was disabled), of one room (it was closed), of one
   *  address (it was blocked), or of one person in one room (they left it); how many closed. Their Sols are told why (KICKED), and do not come back: the gate refuses them now */
  kick(who: { login?: string; room?: string; ip?: string }, why = "closed by Sol"): number {
    const login = who.login?.toLowerCase() ?? "", room = who.room ?? "", ip = who.ip ? ipBucket(who.ip) : "";
    if (!login && !room && !ip) return 0;
    const out: Conn[] = [];
    for (const [o, e] of this.conns) {
      const name = (e?.who ?? this.fixed.get(o) ?? "").toLowerCase();
      // all that is given must match: that person, in that room, from that address
      if ((!login || name === login) && (!room || (!!e && e.room === room)) && (!ip || ipBucket(o.ip ?? "") === ip)) out.push(o);
    }
    for (const o of out) { this.leave(o); o.close?.(KICKED, why.slice(0, 120)); }
    if (out.length) console.log(`relay: ${out.length} connection(s) closed by the admin`);   // never who
    return out.length;
  }

  /** every connection asked again (#225: the cloud's sweep every few seconds, so an admin's action holds even when its
   *  poke did not reach this process): `why` says a reason to close it, or null to keep it. How many closed */
  sweep(why: (c: { login: string; room: string; ip: string }) => string | null): number {
    const out: [Conn, string][] = [];
    for (const [o, e] of this.conns) {
      const r = why({ login: (e?.who ?? this.fixed.get(o) ?? "").toLowerCase(), room: e?.room ?? "", ip: o.ip ?? "" });
      if (r) out.push([o, r]);
    }
    for (const [o, r] of out) { this.leave(o); o.close?.(KICKED, r.slice(0, 120)); }
    if (out.length) console.log(`relay: ${out.length} connection(s) swept out`);   // never who
    return out.length;
  }

  private noteLimited(who: string) {
    const t = Date.now(), low = who.toLowerCase();
    const l = (this.limited.get(low) ?? []).filter((x) => t - x < 60_000);
    l.push(t);
    this.limited.set(low, l.slice(-1000));
  }
  private noteOld(who: string) {
    if (!/^[A-Za-z0-9-]{1,39}$/.test(who)) return;
    this.tooOld.set(who.toLowerCase(), Date.now());
  }
  /** for the cloud's watch only (#225), with names: who was told to wait how often in the last minute, how many
   *  different people were refused as too old in the last day, the errors so far */
  watchCounts(): { limited: Record<string, number>; tooOld: number; errors: number } {
    const t = Date.now(), limited: Record<string, number> = {};
    for (const [k, l] of this.limited) { const n = l.filter((x) => t - x < 60_000).length; if (n) limited[k] = n; else this.limited.delete(k); }
    for (const [k, at] of this.tooOld) if (t - at > 86_400_000) this.tooOld.delete(k);
    return { limited, tooOld: this.tooOld.size, errors: this.errors };
  }

  /** the seats said hello in one room */
  private seats(room: string): Seat[] {
    return [...(this.rooms.get(room) ?? [])].map((o) => this.conns.get(o)).filter((e): e is Seat => !!e);
  }

  /** who is on in one room ("" the common space) */
  roster(room = ""): RosterEntry[] {
    return this.seats(room).map(entryOf).sort((a, b) => a.who.localeCompare(b.who) || a.machine.localeCompare(b.machine));
  }

  /** how many people (logins, not machines) are on in one room */
  online(room = ""): number { return new Set(this.seats(room).map((e) => e.who.toLowerCase())).size; }

  /** the numbers for the lights and the health route (no names): sockets, seats, rooms, streams and their watchers */
  counts() {
    let streams = 0, watchers = 0;
    for (const ss of this.streams.values()) for (const s of ss.values()) { streams++; watchers += s.watchers.size; }
    return { conns: this.conns.size, seated: [...this.conns.values()].filter(Boolean).length, rooms: this.rooms.size, people: this.people.size, streams, watchers, ...this.sent, held: { ...this.held } };
  }

  /** one line to one connection, counted (the lights, the person's month) */
  private put(o: Conn, line: string, bytes = Buffer.byteLength(line)) {
    o.send(line);
    this.sent.msgs++; this.sent.bytes += bytes;
    const e = this.conns.get(o);
    if (e) this.opts.budget?.add(e.who, bytes);
  }

  /** a build update to one connection (#328): its own counter, never charged to the person's month (an update is the
   *  group's, not anything they asked for) */
  private putEvent(o: Conn, line: string, bytes = Buffer.byteLength(line)) {
    o.send(line);
    this.eventsSent.msgs++; this.eventsSent.bytes += bytes;
  }

  /** the hub's own word to one connection (kind `hub`), to a Sol that reads it (v2) */
  private say(o: Conn, say: string, rest: Record<string, unknown> = {}) {
    this.put(o, JSON.stringify({ from: { login: "", agent: false }, at: Date.now(), say, ...rest, kind: HUB }));
  }

  /** the light changed (the host's Load): every seated Sol is told, so a watcher reads "busy" instead of silence */
  lightChanged(light: Light) {
    for (const [o, e] of this.conns) if (e && e.v >= 2) this.say(o, "light", { light });
  }

  /** may this connection send one more (B2)? 0 yes, else the ms to wait. A show line has its own, wider, rate */
  private allowed(c: Conn, who: string, show: boolean): number {
    const r = this.rate;
    if (!r) return 0;
    let b = this.buckets.get(c);
    if (!b) { b = { msgs: new Bucket(r.conn.per, r.conn.burst), shows: new Bucket(r.show.per, r.show.burst), strikes: [] }; this.buckets.set(c, b); }
    if (show) return b.shows.take();
    const low = who.toLowerCase();
    let a = this.accounts.get(low);
    if (!a) { a = new Bucket(r.account.per, r.account.burst); this.accounts.set(low, a); }
    return Math.max(b.msgs.take(), a.take());
  }

  /** told to wait once more: past `strikes` in a minute the connection is closed (TOO_FAST), true */
  private strike(c: Conn): boolean {
    const b = this.buckets.get(c), r = this.rate;
    if (!b || !r) return false;
    const t = Date.now();
    b.strikes = b.strikes.filter((x) => t - x < STRIKE_WINDOW);
    b.strikes.push(t);
    if (b.strikes.length < r.strikes) return false;
    console.log("relay: a connection kept sending after it was told to wait; closed");   // never who
    this.leave(c); c.close?.(TOO_FAST, "too many messages; wait a minute");
    return true;
  }

  /** has this room heard this person's id lately (C2)? Remembered now when not */
  private said(room: string, who: string, id: string): boolean {
    let m = this.seenIds.get(room);
    if (!m) { m = new Map(); this.seenIds.set(room, m); }
    const k = `${who.toLowerCase()} ${id}`, t = Date.now(), at = m.get(k);
    if (at !== undefined && t - at < DUP_TTL) return true;
    m.delete(k); m.set(k, t);
    while (m.size > DUP_MAX) m.delete(m.keys().next().value!);
    for (const [x, when] of m) { if (t - when < DUP_TTL) break; m.delete(x); }   // the oldest first
    return false;
  }

  message(c: Conn, raw: string) {
    let m: unknown;
    try { m = JSON.parse(raw); } catch { return; }
    if (!isObj(m) || !KINDS.includes(m.kind as Kind) || m.kind === "roster") return;
    if (!isObj(m.from) || typeof m.at !== "number") return;   // the signed shape, or nothing: an unsigned line never fans out
    const from = m.from;
    const me = this.conns.get(c);
    if (m.kind === "hello") {
      // one hello a connection, as the client says it: a second is a way to try codes, or logins, without a new knock
      if (this.greeted.has(c)) { this.leave(c); c.close?.(); return; }
      this.greeted.add(c);
      // C1: a Sol older than this hub takes is told so, in words its face can say, and not let in
      const v = typeof m.v === "number" && Number.isInteger(m.v) && m.v > 0 ? Math.min(m.v, PROTOCOL) : 1;   // a newer Sol is met as this wire
      if (v < (this.opts.minVersion ?? PROTOCOL - 1)) {
        this.noteOld(this.fixed.get(c) ?? cut(from.login, 39));
        this.say(c, "update", { v: PROTOCOL, why: "this Sol is older than the cloud takes: please update Sol" });
        this.leave(c); c.close?.(TOO_OLD, "please update Sol"); return;
      }
      const who = this.fixed.get(c) ?? cut(from.login, 39);   // the org gate's login wins over what hello says
      if (!/^[A-Za-z0-9-]{1,39}$/.test(who)) return;
      const r = typeof m.room === "string" ? m.room.trim().toUpperCase() : "", room = CODE.test(r) ? r : "";
      // the open gate lets anyone with a GitHub account knock, so it opens only rooms shared by a code this hub knows:
      // the common space ("") is the key's and the org's people, never a stranger's (the security review of #157)
      // and a code must be one this hub's registry knows, for everyone: a hello with an unknown code closes, a key
      // holder's too, so each guess costs a knock. It is counted as one (Guesses), against GitHub's login when a gate
      // asked GitHub, else against where it came from (guesser): a key holder's login is its own word
      const open = this.opened.has(c), guess = guessers(this.fixed.get(c), who, c.ip);
      // a caller over its guesses (20 codes no room has in ten minutes) is not looked up at all
      if (room && guess.some((g) => this.opts.guesses?.over(g))) { this.leave(c); c.close?.(SLOWED, "too many codes tried; wait ten minutes"); return; }
      const known = !room || !!this.opts.registry?.lookup(room);
      if (!known) for (const g of guess) this.opts.guesses?.miss(g);
      // a code no room has says so, so the client stops knocking with it instead of looping (the room is gone)
      if (!known) { this.leave(c); c.close?.(GONE, "no room has that code"); return; }
      if (open && !room) { this.leave(c); c.close?.(); return; }
      // on a hub that lets strangers in, a coded room is met under a login GitHub vouched for, never a key holder's word
      // for who they are: else a key holder could take a stranger's name there, their pings and their kept lines
      if (room && this.opts.open?.() && !this.fixed.has(c)) { this.leave(c); c.close?.(); return; }
      // a full room (A9): one more person waits; a person already on in it may bring another machine
      const max = this.opts.roomOnlineMax ?? ROOM_ONLINE_MAX;
      const machine = cut(m.machine, 60) || "?";
      let mine = this.seats(room).filter((e) => e.who.toLowerCase() === who.toLowerCase()).length;
      // at the person's cap, a hello from a machine of theirs already seated is that machine back (a laptop that woke
      // or changed networks before its old socket closed): the old seat goes, so nobody locks themselves out
      if (max !== Infinity && mine >= MACHINES_MAX) {
        const old = [...(this.rooms.get(room) ?? [])].find((o) => { const e = this.conns.get(o); return !!e && o !== c && e.who.toLowerCase() === who.toLowerCase() && e.machine === machine; });
        if (old) { this.leave(old); old.close?.(REPLACED, "this machine came back on a new connection"); mine--; }
      }
      if (!mine && this.online(room) >= max) { this.leave(c); c.close?.(FULL, `this room has ${max} people on; try again in a minute`); return; }
      if (max !== Infinity && mine >= MACHINES_MAX) { this.leave(c); c.close?.(FULL, `you have ${MACHINES_MAX} machines on in this room`); return; }
      // what I am in (#230): a thing and my room sessions, exactly their fields; a reconnect's hello says them again
      const polls = room ? pollsOf(m.polls) : undefined;   // #328: as said (bounded); pollers() reads them against the room's list now
      const version = solVersionOf(m.version);   // #417: the release and own layer it said; an older Sol says none ("unknown")
      this.conns.set(c, { who, agent: from.agent === true, machine, state: presenceOf(String(m.state ?? "here")), session: this.session(m.session), since: Date.now(), room, v, ...this.inside(m), ...(polls ? { polls } : {}), ...(version ? { version } : {}) });
      if (!this.rooms.has(room)) this.rooms.set(room, new Set());
      this.rooms.get(room)!.add(c);
      const low = who.toLowerCase();
      if (!this.people.has(low)) this.people.set(low, new Set());
      this.people.get(low)!.add(c);
      if (room) this.opts.registry?.saw(room, who, Date.now());   // a code the registry does not know: nothing written
      // C1, A5: what this hub is, to a Sol that reads it: its version, the largest message, the light
      // rooms (#238): a room show's lines go to its watchers only here; join (#327): a group's link opens a page here
      if (v >= 2) this.say(c, "hello", { v: PROTOCOL, msgMax: this.msgMax, light: this.light(), watch: this.watchOnly, rooms: true, ...(this.opts.joinPage ? { join: true } : {}) });
      // A6: the room's shows going on now, so a Sol that came late can watch them (their lines come only to watchers)
      // a room session's (#238) on every hub, so a Sol that came late knows it is going on
      for (const s of this.streams.get(room)?.values() ?? []) if (s.start && (this.watchOnly || s.room)) this.put(c, s.start);
      const sp = this.opts.spool;
      if (sp) {
        if (!open) sp.saw(who);   // the spool's seen is the common space's people; a stranger is never one of them
        const kept = sp.take(who, room);   // this room's only; the rest wait for a hello in theirs
        if (kept.length) this.put(c, JSON.stringify({ kind: "spooled", from: { login: "", agent: false }, at: Date.now(), messages: kept }));
      }
      // #315: the room's talk as the store keeps it, a thread a message; the Sol merges each line by its id
      if (room && this.opts.talk) {
        let threads: { thread: string; lines: RelayMsg[] }[] = [];
        try { threads = this.opts.talk.last(room, talkSinceOf(m.talkSince)); } catch (e) { this.errors++; console.log(`relay: the talk store could not be read (${String((e as Error)?.message ?? e).slice(0, 120)})`); }
        for (const t of threads) if (t.lines.length) this.put(c, JSON.stringify({ kind: TALK_HISTORY, from: { login: "", agent: false }, at: Date.now(), thread: t.thread, lines: t.lines }));
      }
      // #328: the room's last build updates, after what was kept; a store that cannot be read sends none, and the hello stands
      if (room && this.opts.events) {
        let recent: EventWire[] = [];
        try { recent = this.opts.events.recent(room); } catch (e) { console.log(`relay: a room's build updates could not be read (${String((e as Error)?.message ?? e).slice(0, 120)})`); }
        if (recent.length) this.putEvent(c, JSON.stringify({ kind: "events.recent", from: { login: "", agent: false }, at: Date.now(), events: recent }));
      }
      this.rosterTo(room);
      return;
    }
    if (!me) return;   // nothing before hello
    const id = typeof m.id === "string" && ID.test(m.id) ? m.id : "";
    // B2: a person's messages are a rate; over it, a Sol that reads the hub is told when to send it again, and a
    // connection that keeps on is closed. A show's line has a wider rate of its own and is only dropped
    const isLine = m.kind === "show" && m.event === "line";
    const wait = this.allowed(c, me.who, isLine);
    if (wait > 0) {
      if (isLine) return;
      this.noteLimited(me.who);
      if (this.strike(c)) return;
      if (me.v >= 2 && id) this.say(c, "retry", { id, what: m.kind, after: Math.max(1, Math.ceil(wait / 1000)) });
      return;
    }
    // C2: the same id from the same person in this room lately is carried once; a kept kind is answered ok again, so a
    // Sol that sent it twice (a retry after a reconnect) stops sending it
    if (!id && me.v >= 2 && SPOOLED.includes(m.kind as Kind)) return;   // a v2 Sol ids every message: one without is not one of its
    if (id && !isLine && this.said(me.room, me.who, id)) {
      if (me.v >= 2 && SPOOLED.includes(m.kind as Kind)) this.say(c, "ok", { id });
      return;
    }
    if (m.kind === "watch") { this.watch(c, me, m); return; }
    if (m.kind === "event") { this.polled(c, me, m); return; }
    if (m.kind === "presence") {
      const state = presenceOf(String(m.state ?? me.state));
      const session = this.session(m.session);
      if (state !== me.state) me.since = Date.now();
      me.state = state; me.session = session;
      // a presence says the whole of what I am in (#230): a thing or sessions it leaves out are over
      const inside = this.inside(m);
      me.thing = inside.thing; me.sessions = inside.sessions; me.quiet = inside.quiet; me.github = inside.github;
      if (!me.thing) delete me.thing;
      if (!me.sessions) delete me.sessions;
      if (!me.quiet) delete me.quiet;
      if (me.github === undefined) delete me.github;
      const version = solVersionOf(m.version);   // #417: a newer one replaces it (after an update); a presence without one keeps the hello's
      if (version) me.version = version;
      me.polls = me.room ? pollsOf(m.polls) : undefined;   // #328: a presence says them whole too
      if (!me.polls) delete me.polls;
      this.rosterSoon(me.room);
      return;
    }
    const { room: _r, ...rest } = m;   // what a sender says of the room is not the hub's word: its hello's room is
    // a show is rebuilt by its own fields only (#238): a session's words go out as the sanitizer says them, nothing beside
    let shown = m.kind === "show" ? showOf(m) : null;
    if (m.kind === "show" && !shown) return;
    // a room word too (#325): an ask or an answer, rebuilt by its own fields; a cloud group's ask carries a GitHub login
    const word = m.kind === "room" ? roomOf(m) : null;
    if (m.kind === "room" && !word) return;
    // a stream that started as a room's (#238) stays one, whatever a later message of it says: its lines go to its
    // watchers only and are said as the room's, never as an issue show's
    const room = !!shown && (shown.scope === "room" || this.streams.get(me.room)?.get(`${me.who.toLowerCase()}/${shown.session.id}`)?.room === true);
    if (shown && room && shown.scope !== "room") { const { thing: _t, ...rest } = shown; shown = { ...rest, issue: 0, repo: "", scope: "room" }; }
    // a talk line (#315, the review) is rebuilt by its own fields only, as a show is: never bytes, never a path out of
    // .sol/talk/, never another line's file; one whose file does not check is not carried
    const talk = m.kind === "talk" ? talkOf(m, id) : null;
    if (m.kind === "talk" && !talk) return;
    const out: RelayMsg = shown ? { ...shown, ...(id ? { id } : {}), kind: "show", from: { login: me.who, agent: from.agent === true }, at: Date.now() }
      : talk ? { ...talk, ...(id ? { id } : {}), kind: "talk", from: { login: me.who, agent: from.agent === true }, at: Date.now() }
      : word ? { ...word, ...(id ? { id } : {}), kind: "room", from: { login: me.who, agent: from.agent === true }, at: Date.now() }
      : { ...rest, kind: m.kind as Kind, from: { login: me.who, agent: from.agent === true }, at: Date.now() };
    const line = JSON.stringify(out), bytes = Buffer.byteLength(line);
    // a room session's show goes the watch-only way on every hub (#238): its lines to its watchers only
    if (shown && (this.watchOnly || room)) { this.show(c, me, out, line, bytes, room); return; }
    // an issue show on a hub that sends its lines to the whole room: only its start and end are known, so a watch of it
    // is answered ok as before and never counts against a person's two (the review of #238)
    if (shown && (shown.event === "start" || shown.event === "end")) this.known(me, shown.session.id, shown.event === "start");
    for (const o of this.rooms.get(me.room) ?? []) {
      const e = this.conns.get(o);
      if (o === c || !e) continue;   // one room's word stays in that room: only its own connections are looked at
      // a ping, or a room word with a `to` (#162, #325), goes to its person only, the login in any case as keep() reads it
      if ((m.kind === "ping" || m.kind === "room") && typeof m.to === "string" && m.to && e.who.toLowerCase() !== m.to.toLowerCase()) continue;
      if (m.kind === "show" && o.behind?.()) continue;   // live words only: a slow reader misses them, nothing waits
      this.put(o, line, bytes);
    }
    if (SPOOLED.includes(out.kind)) { this.keep({ ...out, room: me.room }); if (me.v >= 2 && id) this.say(c, "ok", { id }); }
    // #315: a coded room's talk to the hub's store; a store that fails never stops the line, which was carried already
    if (out.kind === "talk" && me.room && this.opts.talk) {
      try { this.opts.talk.keep(me.room, out); } catch (e) { this.errors++; console.log(`relay: a talk line was not kept (${String((e as Error)?.message ?? e).slice(0, 120)})`); }
    }
  }

  /** a show (A6): its start and end to the whole room, as before, so everyone knows who is showing; its lines only to
   *  the people watching it, at most `linesPerSec` a second (one on yellow, none on red), the last TAIL kept for a
   *  watcher who comes later */
  private show(c: Conn, me: Seat, out: RelayMsg, line: string, bytes: number, room = false) {
    const sid = isObj(out.session) && typeof out.session.id === "string" && ID.test(out.session.id) ? out.session.id : "";
    if (!sid) return;
    const key = `${me.who.toLowerCase()}/${sid}`, at = me.room;
    let ss = this.streams.get(at);
    if (out.event === "start" || out.event === "end") {
      const s = ss?.get(key);
      // a start said again (its Sol came back) goes to v2 Sols only: a v1 one reads it as a new show and drops its lines
      const again = out.event === "start" && !!s?.start;
      for (const o of this.rooms.get(at) ?? []) { const e = this.conns.get(o); if (o !== c && e && !(again && e.v < 2)) this.put(o, line, bytes); }
      if (out.event === "end") { if (s && !s.watchers.size) ss!.delete(key); else if (s) { s.start = ""; s.tail = []; } }
      else {
        if (!ss) { ss = new Map(); this.streams.set(at, ss); }
        if (s) { s.start = line; s.tail = []; s.room = room; }
        else if (ss.size < STREAMS_A_ROOM && this.owned(ss, me.who) < STREAMS_A_PERSON) ss.set(key, { start: line, tail: [], watchers: new Set(), lines: null, owner: me.who.toLowerCase(), room });
      }
      if (ss && !ss.size) this.streams.delete(at);
      return;
    }
    if (out.event !== "line") return;
    const light = this.light();
    const s = ss?.get(key);
    // a line of no show this hub heard start (it restarted: the show's engine says start again on its reconnect), or of
    // one that ended (#238): carried to nobody
    if (!s || !s.start) return;
    // what the light holds back is counted as wanted (held), so the light reads what people ask for, not what it let
    // through: else slowing the streams would turn the light green, and green would bring them back, round and round
    const hold = () => { this.held.msgs += s.watchers.size; this.held.bytes += s.watchers.size * bytes; };
    if (light === "red") { hold(); return; }   // chat only
    // a room stream never runs faster than the cloud's five, on the engine's own hub too (#238)
    const full = Math.min(this.opts.linesPerSec ?? LINES_PER_SEC, room ? LINES_PER_SEC : Infinity), per = light === "yellow" || light === "orange" ? 1 : full;
    if (Number.isFinite(per)) {
      if (!s.lines) s.lines = new Bucket(per, per); else s.lines.set(per, per);
      if (s.lines.take() > 0) { if (per < full) hold(); return; }
    }
    s.tail.push(line);
    if (s.tail.length > TAIL) s.tail.splice(0, s.tail.length - TAIL);
    for (const o of s.watchers) {
      const e = this.conns.get(o);
      if (o === c || !e || o.behind?.()) continue;
      const level = this.opts.budget?.level(e.who) ?? 0;   // B5: past the month's traffic, a person's streams slow, then stop
      if (level >= 2) continue;
      if (level === 1) {
        let b = this.slow.get(o);
        if (!b) { b = new Map(); this.slow.set(o, b); }
        let w = b.get(key);
        if (!w) { w = new Bucket(1, 1); b.set(key, w); }
        if (w.take() > 0) continue;
      }
      this.put(o, line, bytes);
    }
    // a Sol from before watch (v1) cannot ask: it gets every line of its room, as it did, under the same lights and rates.
    // Never a room session's (#238): a Sol from before reads no room show, and a session's words go only to who watches
    if (room) return;
    for (const o of this.rooms.get(at) ?? []) {
      const e = this.conns.get(o);
      if (o === c || !e || e.v >= 2 || s.watchers.has(o) || o.behind?.()) continue;
      if ((this.opts.budget?.level(e.who) ?? 0) >= 1) continue;
      this.put(o, line, bytes);
    }
  }

  /** an issue show this hub sends to the whole room (it is not watch-only): its start and end, known so a watch of it is ok */
  private known(me: Seat, sid: string, on: boolean) {
    const key = `${me.who.toLowerCase()}/${sid}`;
    let ss = this.streams.get(me.room);
    const s = ss?.get(key);
    if (!on) { if (s && !s.watchers.size) ss!.delete(key); else if (s) s.start = ""; if (ss && !ss.size) this.streams.delete(me.room); return; }
    if (!ss) { ss = new Map(); this.streams.set(me.room, ss); }
    if (s) { s.room = false; s.start = "issue"; return; }
    if (ss.size < STREAMS_A_ROOM) ss.set(key, { start: "issue", tail: [], watchers: new Set(), lines: null, owner: me.who.toLowerCase(), room: false });
  }

  /** watch { login, session, on } (A6, B1): this connection wants a show's lines, or no longer. Answered with
   *  hub { say: "watch", login, session, on, ok, why?, after? }. Two at once a person (every machine together) */
  private watch(c: Conn, me: Seat, m: Record<string, unknown>) {
    const login = cut(m.login, 39), sid = typeof m.session === "string" && ID.test(m.session) ? m.session : "", on = m.on !== false;
    const answer = (ok: boolean, why?: string, after?: number) => this.say(c, "watch", { login, session: sid, on, ok, ...(why ? { why } : {}), ...(after ? { after } : {}) });
    if (!/^[A-Za-z0-9-]{1,39}$/.test(login) || !sid) return answer(false, "which show? a login and a session id");
    const key = `${login.toLowerCase()}/${sid}`, mine = `${me.room} ${key}`;
    // this hub sends an issue show's every line to the whole room, as it always did; a room session's (#238), or one
    // it has not heard start yet (it may be one), only to who watches, as the cloud does
    const known = this.streams.get(me.room)?.get(key);
    if (!this.watchOnly && known?.room === false) return answer(true);
    const had = this.watching.get(c) ?? new Set<string>();
    if (!on) { if (had.has(mine)) this.unwatch(c, mine); return answer(true); }
    if (had.has(mine)) return answer(true);
    if (rank(this.light()) >= rank("yellow")) return answer(false, "the cloud is busy: the AI view waits a little", 30);
    if ((this.opts.budget?.level(me.who) ?? 0) >= 2) return answer(false, "your account used this month's traffic: AI views come back next month; chat goes on");
    const k = this.watchOnly ? this.opts.streamsMax ?? STREAMS_MAX : Math.min(this.opts.streamsMax ?? STREAMS_MAX, STREAMS_MAX);
    const all = new Set<string>();
    for (const o of this.people.get(me.who.toLowerCase()) ?? []) for (const x of this.watching.get(o) ?? []) all.add(x);
    if (all.size >= k && !all.has(mine)) return answer(false, `you are watching ${k} AI sessions already: close one to watch this`);
    let ss = this.streams.get(me.room);
    if (!ss) { ss = new Map(); this.streams.set(me.room, ss); }
    let s = ss.get(key);
    if (!s) {
      if (ss.size >= STREAMS_A_ROOM || this.owned(ss, login) >= STREAMS_A_PERSON) return answer(false, "this room has as many shows as the cloud keeps");
      s = { start: "", tail: [], watchers: new Set(), lines: null, owner: login.toLowerCase() };   // its engine says start on its reconnect
      ss.set(key, s);
    }
    s.watchers.add(c);
    had.add(mine); this.watching.set(c, had);
    answer(true);
    for (const l of s.tail) this.put(c, l);   // the last lines, so a pane opened late is not empty
  }

  private sweeping = new Set<string>();
  /** an empty room's ids, forgotten as each could no longer match: one timer a room, never a fresh id (the re-check) */
  private sweepIds(room: string) {
    if (this.sweeping.has(room) || !this.seenIds.has(room)) return;
    this.sweeping.add(room);
    const t = setTimeout(() => {
      this.sweeping.delete(room);
      const ids = this.seenIds.get(room), now = Date.now();
      for (const [x, when] of ids ?? []) { if (now - when < DUP_TTL) break; ids!.delete(x); }
      if (ids && !ids.size) this.seenIds.delete(room);
      else if (!this.rooms.get(room)?.size) this.sweepIds(room);
    }, 60_000);
    t.unref?.();
  }

  private forgetBucket(low: string) {
    const b = this.accounts.get(low);
    if (!b || this.people.has(low)) return;
    if (b.idle()) { this.accounts.delete(low); return; }
    setTimeout(() => this.forgetBucket(low), 5000).unref?.();
  }

  /** the shows one person has in a room's map: a person fills at most STREAMS_A_PERSON of its places (the review: one
   *  person's many starts must not crowd out everyone else's) */
  private owned(ss: Map<string, Stream>, who: string) { const low = who.toLowerCase(); let n = 0; for (const s of ss.values()) if (s.owner === low && s.start) n++; return n; }   // a watcher's place-holder is nobody's show (the re-check)

  private unwatch(c: Conn, mine: string) {
    const sp = mine.indexOf(" "), room = mine.slice(0, sp), key = mine.slice(sp + 1);
    this.watching.get(c)?.delete(mine);
    this.slow.get(c)?.delete(key);
    const ss = this.streams.get(room), s = ss?.get(key);
    if (!s) return;
    s.watchers.delete(c);
    if (!s.watchers.size && !s.start) ss!.delete(key);
    if (ss && !ss.size) this.streams.delete(room);
  }

  /** a talk line, a ping or a room answer (#162), kept with its room for each person it is for who has no Sol in that
   *  room right now. A talk in a room with a code is for the people the registry has seen in it; in the common space, as
   *  before. A ping or a room word with a `to` (an answer, or a cloud group's ask to its maker, #325) is for that person.
   *  A room ask with no `to` is never kept: its Sol asks again on every connect and every ten minutes, and a kept one
   *  would fill every away person's spool */
  private keep(m: RelayMsg & { room: string }) {
    const sp = this.opts.spool;
    if (!sp) return;
    if (m.kind === "room" && !(typeof m.to === "string" && m.to)) return;
    const on = new Set(this.seats(m.room).map((e) => e.who.toLowerCase()));
    const sender = m.from.login.toLowerCase();
    const people = m.room ? this.opts.registry?.lookup(m.room)?.people ?? [] : [];
    // a ping in a coded room is kept only for one of that room's people: the spool is never a way to reach anyone else
    const to = (m.kind === "ping" || m.kind === "room") && typeof m.to === "string" && m.to
      ? (!m.room || people.some((p) => p.toLowerCase() === String(m.to).toLowerCase()) ? [m.to] : [])
      : m.room ? people
      : [...new Set([...sp.seen(), ...(this.opts.people?.() ?? [])])];
    for (const who of to) if (who.toLowerCase() !== sender && !on.has(who.toLowerCase())) sp.add(who, m);
  }

  /** a build update to a room (#328): kept by the host's hook (false: it had that one, and nothing goes out), then to
   *  every connection in the room but the one it came from. `from` is the poller's login for a polled one, "" for the
   *  workflow's. true when it went out */
  event(room: string, ev: EventWire, from = "", except?: Conn): boolean {
    if (!room) return false;
    if (this.opts.events && !this.opts.events.keep(room, ev)) return false;
    const line = JSON.stringify({ ...ev, kind: "event", from: { login: from, agent: false }, at: ev.at }), bytes = Buffer.byteLength(line);
    for (const o of this.rooms.get(room) ?? []) if (o !== except && this.conns.get(o)) this.putEvent(o, line, bytes);
    return true;
  }

  /** a build update from a client socket (#328): always a poll (a workflow's comes through the cloud's http route,
   *  never a socket), said only by the connection the hub chose as that repository's poller (pollers) and only for that
   *  repository, rebuilt by eventOf, then as any other (event). Every other `event` from a client is dropped */
  private polled(c: Conn, me: Seat, m: Record<string, unknown>) {
    if (!me.room || !this.opts.events) return;
    const ev = eventOf({ ...m, source: "poll" });
    if (!ev || (this.pollers(me.room)[ev.repo.toLowerCase()] ?? "").toLowerCase() !== me.who.toLowerCase()) return;
    this.event(me.room, ev, me.who, c);
  }

  /** the repositories the room's record lists (#328): the host's `connected` (the cloud's connectors.json), else the
   *  registry's repos for the room; none when it cannot be read */
  private connected(room: string): Set<string> {
    let list: string[] = [];
    try { list = this.opts.events?.connected ? this.opts.events.connected(room) : this.opts.registry?.lookup(room)?.repos ?? []; } catch { /* none */ }
    return new Set(list.map((x) => x.toLowerCase()));
  }

  /** who reads the board of each repository of a room for everyone (#328), by repository in lower case: the first Sol
   *  seated there, in the order they said hello, with GitHub signed in, that said it may (`polls`, kept as said, 20 at
   *  most), for each repository the room's record lists now (a `polls` entry for any other is dropped here, and one
   *  connected after the hello counts at once) and with no live workflow key (the host's `keyed`). One Sol a repository, so the members
   *  without gh hear each line once. `github: true` is the Sol's own word, as everything in a hello is: a poller's lines
   *  are the group's own member's word, as a talk line is, and a member who lies only hurts their own group's feed,
   *  never another group's (the lines go to their room only) */
  pollers(room: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!room || !this.opts.events) return out;
    let keyed: string[] = [];
    try { keyed = this.opts.events.keyed(room).map((x) => x.toLowerCase()); } catch { /* none known: everyone's is polled */ }
    const listed = this.connected(room);
    for (const e of this.seats(room)) {
      if (e.github !== true) continue;
      for (const r of e.polls ?? []) { const k = r.toLowerCase(); if (listed.has(k) && !keyed.includes(k) && !(k in out)) out[k] = e.who; }
    }
    return out;
  }

  /** a workflow key went live (its first post) or was taken off for a room (#328): its roster again, with who polls what now */
  keysChanged(room: string) { this.rosterTo(room); }

  /** every login the hub has heard say hello (its spool's), for the team when there is no org */
  seen(): string[] { return this.opts.spool?.seen() ?? []; }

  private session(v: unknown): RosterEntry["session"] {
    if (!isObj(v) || typeof v.title !== "string") return undefined;
    return { title: v.title.slice(0, 120), ...(typeof v.repo === "string" && v.repo ? { repo: v.repo.slice(0, 100) } : {}) };
  }

  /** a hello's or a presence's thing and room sessions (#230), sanitized; the keys only when there is something. The
   *  GitHub flag (#320) as a boolean only (githubOf) */
  private inside(m: Record<string, unknown>): Pick<RosterEntry, "thing" | "sessions" | "quiet" | "github"> {
    const thing = thingOf(m.thing), sessions = sessionsOf(m.sessions), github = githubOf(m.github);
    // quiet (#238): the room sees that I turned showing off, and no room session of mine by name
    return { ...(thing ? { thing } : {}), ...(sessions && m.quiet !== true ? { sessions } : {}), ...(m.quiet === true ? { quiet: true as const } : {}), ...(github !== undefined ? { github } : {}) };
  }

  // a presence's roster goes at once, then at most one a second a room (#230's review): every presence sends the whole
  // roster to everyone in the room, so a person sending presence fast would multiply the room's traffic by its size.
  // The last change in the second is never lost: it goes when the second ends. A hello's and a leave's go at once
  private rosterAt = new Map<string, { at: number; timer?: ReturnType<typeof setTimeout> }>();
  private rosterSoon(room: string) {
    const r = this.rosterAt.get(room), now = Date.now();
    if (r?.timer) return;   // one is already due at the end of this second
    if (!r || now - r.at >= ROSTER_EVERY) { this.rosterAt.set(room, { at: now }); this.rosterTo(room); return; }
    const timer = setTimeout(() => { this.rosterAt.set(room, { at: Date.now() }); this.rosterTo(room); }, ROSTER_EVERY - (now - r.at));
    timer.unref?.();
    this.rosterAt.set(room, { at: r.at, timer });
  }

  /** one room's roster to that room's connections; the other rooms' rosters did not change */
  private rosterTo(room: string) {
    const set = this.rooms.get(room);
    if (!set?.size) { const r = this.rosterAt.get(room); if (r?.timer) clearTimeout(r.timer); this.rosterAt.delete(room); return; }
    const pollers = this.pollers(room);   // #328: who reads which repository's board for the room, when anyone does
    const line = JSON.stringify({ kind: "roster", from: { login: "", agent: false }, at: Date.now(), roster: this.roster(room), ...(Object.keys(pollers).length ? { pollers } : {}) });
    const bytes = Buffer.byteLength(line);
    for (const o of set) this.put(o, line, bytes);
  }
}

// ---- the gate ----
const sha = (s: string) => createHash("sha256").update(s).digest();

/** may this upgrade join the hub? the key, and no browser page but Sol's own (pure: npm test knocks) */
export function relayGate(url: string, headers: IncomingMessage["headers"], key: string, port: number): boolean {
  if (!key) return false;
  let given = "";
  try { given = new URL(url, "http://x").searchParams.get("key") ?? ""; } catch { return false; }
  if (!timingSafeEqual(sha(given), sha(key))) return false;
  return originOk(headers, port);
}

/** the whole gate, any mode: { login } let in (login "" in key mode: hello says who), or null (refused).
 *  An org = GitHub's gate and the org's members, the login GitHub's (identity.ts); the key no longer opens it.
 *  No org and open (#157) with a token = GitHub's gate for anyone signed in; a bad token is refused, never a fall-through
 *  to the key. Otherwise the key's gate, unchanged. key "" (not the host) is closed in every mode */
export async function knock(url: string, headers: IncomingMessage["headers"], key: string, org: string, port: number, verify: Verify, open = false): Promise<{ login: string; open?: true } | null> {
  if (!key) return null;
  if (org) { const login = await orgGate(headers, org, port, verify); return login ? { login } : null; }
  if (open && bearerOf(headers)) {
    const login = await openGate(headers, port, verify);
    if (!login) return null;
    // the key as well: a teammate, under GitHub's login; the token alone: a stranger, who meets only in a coded room
    return relayGate(url, headers, key, port) ? { login } : { login, open: true };
  }
  return relayGate(url, headers, key, port) ? { login: "" } : null;
}

/** the largest message a connection may send, in bytes (#208, MASTER A5): a chat line, a ping or a presence fits many
 *  times over; a bigger frame closes the socket (1009). The engine's own hub passes its old 64 KB (relay.ts) */
export const MSG_MAX = 4 * 1024;

// ---- the gate as a part (#208, A12): the key's gate is the engine's; the cloud hands in its own ----
/** one knock as a gate sees it: the request's url and headers, and the caller's address when the host reads them */
export type Knock = { url: string; headers: IncomingMessage["headers"]; ip: string };
/** a gate: { login } let in (login "": a key holder, whose hello says who), `open` a stranger who meets in a coded room
 *  only; null refused */
export type Gate = (k: Knock) => Promise<{ login: string; open?: true } | null>;

/** the gate of before, for a hub that meets by its key (knock): key() "" closes it; org() and open() as they say */
export function keyGate(port: number, key: () => string, opts: Pick<ServerOpts, "org" | "open" | "verify" | "proofs"> = {}): Gate {
  const verify = withTickets(opts.verify ?? refuseAll, opts.proofs);
  return ({ url, headers }) => knock(url, headers, key(), opts.org?.() ?? "", port, verify, opts.open?.() ?? false);
}

/** the cloud's gate (#208, MASTER A3): a ticket this hub signed (`Bearer sol1.…`), and nothing else. A bare token is
 *  refused before anyone is asked: no verify is called, no GitHub, no program run. Everyone it lets in is a stranger
 *  (open): they meet in rooms by a code, never in the common space. org: the org the tickets were given for ("" none) */
export function ticketGate(proofs: { check: (ticket: string, org: string) => string | null }, port: number, org = ""): Gate {
  return async ({ headers }) => {
    if (!originOk(headers, port)) return null;
    const token = bearerOf(headers);
    if (!token.startsWith("sol1.")) return null;
    const login = proofs.check(token, org);
    return login && SOMEONE.test(login) ? { login, open: true } : null;
  };
}

/** where a request came from (#208, A12): the socket's own peer, or, only when that peer is one of the proxies the host
 *  trusts (Caddy on the same box), the last address in the proxy's header (x-forwarded-for unless told; the last is the
 *  one the proxy itself saw, which a caller cannot write). An IPv4 address mapped into IPv6 is said as IPv4 (pure) */
export function clientIp(req: Pick<IncomingMessage, "headers" | "socket">, trust?: { proxies: string[]; header?: string }): string {
  const plain = (a: string) => (a.startsWith("::ffff:") && isIP(a.slice(7)) === 4 ? a.slice(7) : a);
  const peer = plain(req.socket?.remoteAddress ?? "");
  if (!trust || !trust.proxies.map(plain).includes(peer)) return peer;
  const said = one(req.headers[(trust.header ?? "x-forwarded-for").toLowerCase()]) ?? "";
  const last = said.split(",").map((x) => x.trim()).filter(Boolean).pop() ?? "";
  // the proxy said nothing usable: no address at all, never the proxy's own, which every caller would share
  return isIP(plain(last)) ? plain(last) : "";
}

// verify: who a token is (none: no token is anyone); the engine's wiring hands in its gh (relay.ts)
export type ServerOpts = { org?: () => string; verify?: Verify; open?: () => boolean; guesses?: Guesses;
  proofs?: Proofs; reads?: ProofReads; hosts?: () => string[];   // proof.ts: the hub's tickets, what it reads with its own gh, the hosts it is
  msgMax?: number;   // the largest message, in bytes (MSG_MAX)
  gate?: Gate;       // who may in (#208, A12): none = the key's gate (keyGate) over key, org, open, verify and proofs
  heartbeat?: number;   // ms between asks if a socket is there (HEARTBEAT_MS; 0 never)
  queue?: Queue;        // B3 (#223): on orange and red a new connection gets a number and comes back (load.ts Queue); none: never
  busy?: () => boolean; // B3: new rooms wait (orange and red); none: never
  ip?: (req: IncomingMessage) => string };   // where a request came from (clientIp), when the host counts by address   // proof.ts: the hub's tickets, what it reads with its own gh, the hosts it is

// which gate refused, for the one log line (never the token)
const gateWord = (org: string, open: boolean, headers: IncomingMessage["headers"]) => (org ? "GitHub" : open && bearerOf(headers) ? "GitHub, open" : "key");

/** the hub on an http server's upgrade: index.ts calls this for the path /relay. key() and org() are read on every
 *  knock; key() is "" on an engine that is not the host, which closes the gate in both modes */
export function relayServer(port: number, key: () => string, hub = new RelayHub(), opts: ServerOpts = {}) {
  const gate = opts.gate ?? keyGate(port, key, opts);
  const wss = new WebSocketServer({ noServer: true, maxPayload: opts.msgMax ?? MSG_MAX });
  hub.msgMax = opts.msgMax ?? MSG_MAX;   // a hello's answer says it (#223, A5), so a Sol splits a long line instead of being closed
  // the heartbeat: every socket that answered nothing since the last ask is gone; the rest are asked again
  const alive = new WeakMap<WebSocket, boolean>(), beat = opts.heartbeat ?? HEARTBEAT_MS;
  if (beat > 0) {
    const t = setInterval(() => { for (const ws of wss.clients) { if (!alive.get(ws)) { ws.terminate(); continue; } alive.set(ws, false); try { ws.ping(); } catch { /* closing */ } } }, beat);
    t.unref();
    wss.on("close", () => clearInterval(t));
  }
  wss.on("connection", (ws, req: IncomingMessage & { solLogin?: string; solOpen?: boolean; solIp?: string }) => {
    const c: Conn = { send: (l) => { if (ws.readyState === WebSocket.OPEN) ws.send(l); }, behind: () => ws.bufferedAmount > 256 * 1024,
      close: (code = 1008, why = "this hub opens a room by its code") => ws.close(code, why), ...(req?.solIp ? { ip: req.solIp } : {}) };
    hub.join(c, req?.solLogin || undefined, req?.solOpen === true);
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("message", (d) => {
      alive.set(ws, true);
      // one message that throws (a database that is locked or broken) closes its own socket, never the hub (the review)
      try { hub.message(c, String(d)); }
      catch (e) { hub.errors++; console.log(`relay: a message failed (${String((e as Error)?.message ?? e).slice(0, 120)}); its socket is closed`); try { hub.leave(c); } catch { /* gone */ } ws.close(1011, "the hub could not take that"); }
    });
    ws.on("close", () => { alive.delete(ws); hub.leave(c); });
    ws.on("error", () => { /* closes next */ });
  });
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const org = opts.org?.() ?? "", open = opts.open?.() ?? false, ip = opts.ip?.(req) ?? "";
    void gate({ url: req.url ?? "", headers: req.headers, ip }).catch(() => null).then((let_in) => {
      if (!let_in) {
        console.log(`relay: refused a knock (${opts.gate ? "its gate" : gateWord(org, open, req.headers)}), origin=${req.headers.origin ?? "none"}`);   // never the token
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      // B3: on orange and red a new connection waits its turn. It is handed a number and told when to come back; the
      // number is kept by the Sol, so the hub holds no list (load.ts Queue)
      const q = opts.queue?.admit(one(req.headers["x-sol-queue"]) ?? "", let_in.login || ip);
      if (q && !q.in) {
        const body = JSON.stringify({ error: "the cloud is busy: you are in the queue", ahead: q.ahead, wait: q.wait });
        socket.write(`HTTP/1.1 503 Service Unavailable\r\nRetry-After: ${q.wait}\r\nX-Sol-Queue: ${q.ticket}\r\nX-Sol-Ahead: ${q.ahead}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
        socket.end();
        return;
      }
      Object.assign(req, { solLogin: let_in.login, solOpen: let_in.open === true, solIp: ip });
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });
  };
  return { upgrade, hub, wss };
}

// ---- the hub's rooms over http (#157): register a room for its code, look a code up ----
const BODY_MAX = 8 * 1024;
const json = (res: ServerResponse, status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
const roomOut = (e: { code: string; name: string; provider: string; org: string; repos: string[] }) =>
  ({ code: e.code, room: { name: e.name, provider: e.provider, org: e.org, repos: e.repos } });

/** the body, or "big" past 8 KB (read no further) */
async function bodyOf(req: IncomingMessage): Promise<string | "big"> {
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > BODY_MAX) return "big"; }
  return body;
}

/** `POST /relay/rooms`, `GET /relay/rooms/<code>` and `GET /relay/names/<name>` (#160) on the engine's http server, behind the relay's own gate (the
 *  query key, or a Bearer in org or open mode, and no browser page but Sol's own). index.ts calls it first, before
 *  the door, as the /relay upgrade bypasses it. true when the request was this route's */
export function relayRoutes(port: number, key: () => string, registry: RoomRegistry, opts: ServerOpts = {}) {
  const gate = opts.gate ?? keyGate(port, key, opts);
  const reads: ProofReads = opts.reads ?? readNothing;
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = req.url ?? "", path = url.split("?")[0];
    const ip = opts.ip?.(req) ?? "";
    if (path === "/relay/proof") { await proofRoute(req, res, port, opts, reads, ip); return true; }
    if (path !== "/relay/rooms" && !path.startsWith("/relay/rooms/") && !path.startsWith("/relay/names/")) return false;
    const org = opts.org?.() ?? "", open = opts.open?.() ?? false;
    const let_in = await gate({ url, headers: req.headers, ip }).catch(() => null);
    if (!let_in) {
      console.log(`relay: refused a rooms call (${opts.gate ? "its gate" : gateWord(org, open, req.headers)}), origin=${req.headers.origin ?? "none"}`);   // never the token
      // which gate said no, so the caller's Sol can say what to do (never the token, never the key)
      json(res, 403, { error: opts.gate ? "this hub takes its own tickets only: sign in to it again" : org ? "the hub asks GitHub: sign in (gh auth login), and be in the org" : open ? "the hub asks GitHub: sign in (gh auth login)" : "the hub meets by a key: put its key on the room" });
      return true;
    }
    if (path === "/relay/rooms" && req.method === "POST") {
      if (opts.busy?.()) { res.setHeader("retry-after", "60"); json(res, 503, { error: "the cloud is busy: new rooms wait a minute", wait: 60 }); return true; }
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) { json(res, 415, { error: "a room is sent as JSON" }); return true; }
      const body = await bodyOf(req);
      if (body === "big") { json(res, 413, { error: "too big" }); return true; }
      let room: Record<string, unknown>;
      try { const v = JSON.parse(body); room = isObj(v) ? v : {}; } catch { json(res, 400, { error: "a room is sent as JSON" }); return true; }
      // who made it: GitHub's word when a gate asked GitHub, else nobody. Never the body's word: a key holder could name
      // anyone, and share's register again (rooms.ts) trusts the hub's same code as "I registered it" (#162)
      const by = let_in.login;
      try { json(res, 200, roomOut(registry.register(room, by))); }
      catch (e) { json(res, (e as { status?: number })?.status ?? 400, { error: String((e as Error)?.message ?? e).slice(0, 200) }); }   // 409: the hub is full
      return true;
    }
    // a maker forgets their own room (the stack's review): only GitHub's word for who asks, never a key holder's, and
    // the same 404 for a room that is not theirs as for none
    if (path.startsWith("/relay/rooms/") && req.method === "DELETE") {
      let given = "";
      try { given = decodeURIComponent(path.slice("/relay/rooms/".length)); } catch { /* not a code */ }
      if (!let_in.login) { json(res, 403, { error: "only a room's maker, as GitHub knows them, forgets it" }); return true; }
      const gone = registry.forget(given, let_in.login);
      json(res, gone ? 200 : 404, gone ? { forgotten: true } : { error: "no room of yours has that code" });
      return true;
    }
    // #160: is a name free on this hub. Not a guess at anything (a name is not a secret), so not counted
    if (path.startsWith("/relay/names/") && req.method === "GET") {
      let name = "";
      try { name = decodeURIComponent(path.slice("/relay/names/".length)).trim().replace(/\s+/g, " "); } catch { /* not a name */ }
      if (!name || name.length > 60) { json(res, 400, { error: "a room's name is 1 to 60 characters" }); return true; }
      json(res, 200, { name, free: !registry.taken(name) });
      return true;
    }
    if (path.startsWith("/relay/rooms/") && req.method === "GET") {
      let given = "";
      try { given = decodeURIComponent(path.slice("/relay/rooms/".length)); } catch { /* not a code */ }
      const code = given.trim().toUpperCase();
      if (!CODE.test(code)) { json(res, 400, { error: "a code is six letters and digits" }); return true; }
      // a code is 30 bits, typed by hand: guessing is the only way at one, so it is made slow. Past 20 misses in ten
      // minutes a caller is answered 429 without the registry being asked
      const who = guessers(let_in.login, "", ip);
      if (who.some((g) => opts.guesses?.over(g))) { json(res, 429, { error: "too many codes tried; wait ten minutes" }); return true; }
      const e = registry.lookup(code, let_in.login || undefined);   // a member-keeping registry makes a signed-in asker one (#216)
      if (!e) for (const g of who) opts.guesses?.miss(g);
      json(res, e ? 200 : 404, e ? roomOut(e) : { error: "no room has that code" });
      return true;
    }
    json(res, 404, { error: "no such call" });
    return true;
  };
}

/** `POST /relay/proof` (proof.ts): { login } → { nonce }, then { login, nonce, gist } → { ticket, until }. Before any
 *  gate, since it is how a Sol gets in; only where the hub knows people by GitHub (an org, or open), and no browser page
 *  but Sol's own. A refusal is 403 with what is wrong */
async function proofRoute(req: IncomingMessage, res: ServerResponse, port: number, opts: ServerOpts, reads: ProofReads, ip = "") {
  const org = opts.org?.() ?? "", open = opts.open?.() ?? false, hosts = opts.hosts?.() ?? [];
  if (req.method !== "POST" || !opts.proofs || (!org && !open)) { json(res, 404, { error: "this hub meets by a key" }); return; }
  // who this hub is comes from its own setting, never the request's Host, which the sender writes
  if (!hosts.length) { json(res, 404, { error: "this hub gives no tickets: its host is not set (SOL_HUB_HOST)" }); return; }
  if (!originOk(req.headers, port)) { json(res, 403, { error: "not from Sol" }); return; }
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) { json(res, 415, { error: "a proof is sent as JSON" }); return; }
  const body = await bodyOf(req);
  if (body === "big") { json(res, 413, { error: "too big" }); return; }
  let v: Record<string, unknown>;
  try { const x = JSON.parse(body); v = isObj(x) ? x : {}; } catch { json(res, 400, { error: "a proof is sent as JSON" }); return; }
  if (v.nonce === undefined) {
    const nonce = opts.proofs.nonce(v.login);
    json(res, nonce ? 200 : 400, nonce ? { nonce } : { error: "a login is a GitHub login" });
    return;
  }
  const got = await opts.proofs.redeem(v, hosts, org, reads, ip);
  json(res, "error" in got ? 403 : 200, got);
}
