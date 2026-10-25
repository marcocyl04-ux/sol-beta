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
// The hub's registry (registry.ts) answers two http routes beside the socket, /relay/rooms, behind the same gate.
// Let in (#162, round 37): `room` is a friend's Sol asking to be let into a room's repository ({ want: "in", repo }),
// and the maker's Sol answering ({ to, repo, in, why? }). An answer has a `to`, so it reaches that person only, as a
// ping does, and is kept in the spool for a friend who left. An ask is never kept: the friend's Sol asks again on every
// connect and every ten minutes while it is up, so a kept one would only pile up for every person of the room.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { timingSafeEqual, createHash } from "node:crypto";
import { hostname } from "node:os";
import { basename } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { getTeam, roomKey, activeRoom, CODE, type Room } from "./settings.js";
import type { Spool } from "./spool.js";
import type { Registry, Guesses } from "./registry.js";
import { orgGate, openGate, originOk, bearerOf, ghVerify, ghToken, withTickets, type Verify } from "./identity.js";
import { record } from "./record.js";
import { ticketFor, refusedBy, type Proofs, type ProofReads } from "./proof.js";
import { setSeen } from "./members.js";

export const KINDS = ["hello", "roster", "presence", "changed", "hand", "stable", "ping", "talk", "show", "room"] as const;
export type Kind = (typeof KINDS)[number];
export type From = { login: string; agent: boolean };
export type RelayMsg = { kind: Kind; from: From; at: number; spooled?: boolean; [k: string]: unknown };
/** what the spool keeps and hands back: only what the relay already carried, and only these */
export const SPOOLED: readonly Kind[] = ["talk", "ping", "room"];
export type PresenceState = "here" | "elsewhere" | "away" | "working" | "yourcall";
export type RosterEntry = { who: string; agent: boolean; machine: string; state: PresenceState; session?: { title: string; repo?: string }; since: number };

const STATES = new Set<PresenceState>(["here", "elsewhere", "away", "working", "yourcall"]);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const cut = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

/** the creature's eight states said as the five a teammate sees (listening and speaking are "here") */
export function presenceOf(state: string): PresenceState {
  return STATES.has(state as PresenceState) ? (state as PresenceState) : state === "unplugged" ? "elsewhere" : "here";
}

/** what a session says to the team: a Work turn its title and repo's name, a Life turn or a call nothing */
export function sessionOf(turn: { kind: string; title: string } | null | undefined, cwd?: string): RosterEntry["session"] {
  if (!turn || turn.kind !== "work") return undefined;
  return { title: turn.title.slice(0, 120), ...(cwd ? { repo: basename(cwd) } : {}) };
}

// ---- the hub ----
export type Conn = { send: (line: string) => void; behind?: () => boolean; close?: (code?: number, why?: string) => void };   // behind: its socket is backed up

export type HubOpts = {
  spool?: Spool;                // absent: the hub keeps nothing (tests, and an engine that is not the host)
  people?: () => string[];      // who a talk line is kept for, besides the logins the spool has seen say hello
  registry?: Registry;          // the rooms shared by a code (#157): a hello in one is written down as one of its people
  guesses?: Guesses;            // codes tried that no room has, per caller, shared with the http routes (#157)
  open?: () => boolean;         // the hub lets strangers in by GitHub (relay.open): a coded room is GitHub's logins' only
};

/** who a guess at a code is counted against (the stack's review): GitHub's login when a gate asked GitHub. A key
 *  holder's hello says any login it likes, so it counts against that login and against every key holder together,
 *  `key` (registry.ts KEY_GUESS_MAX, ten times one caller's): a new login on every knock still meets the shared count.
 *  Never an address: the engine listens on 127.0.0.1 behind tailscale serve, so every caller comes from there */
export const guessers = (login: string | undefined, said = ""): string[] => (login ? [login] : said ? [`key ${said}`, "key"] : ["key"]);
// the close codes a hello can get: an unknown code (the room is gone, or was never), and over its guesses
export const GONE = 4404, SLOWED = 4429;

// a connection's place on the hub: what the roster says of it, and the room it said hello in ("" the common space)
type Seat = RosterEntry & { room: string };
const entryOf = ({ room: _r, ...e }: Seat): RosterEntry => e;   // the room is the hub's to know, never sent

export class RelayHub {
  private conns = new Map<Conn, Seat | null>();          // null until it said hello
  private fixed = new Map<Conn, string>();               // GitHub's login for a connection the org gate let in
  private opened = new Set<Conn>();                      // let in by the open gate: a stranger with a GitHub account
  private greeted = new Set<Conn>();                     // said hello once: a connection says it once (the client does)

  constructor(private opts: HubOpts = {}) {}

  /** a connection came in; `login` is GitHub's word for it when a gate asked GitHub; `open` when that gate was the open
   *  one (#157), which lets such a connection into a room with a code only */
  join(c: Conn, login?: string, open = false) { this.conns.set(c, null); if (login) this.fixed.set(c, login); if (open) this.opened.add(c); }

  leave(c: Conn) {
    const had = this.conns.get(c);
    this.conns.delete(c);
    this.fixed.delete(c);
    this.opened.delete(c);
    this.greeted.delete(c);
    if (had) this.rosterToAll();
  }

  /** who is on in one room ("" the common space) */
  roster(room = ""): RosterEntry[] {
    return [...this.conns.values()].filter((e): e is Seat => !!e && e.room === room).map(entryOf)
      .sort((a, b) => a.who.localeCompare(b.who) || a.machine.localeCompare(b.machine));
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
      const who = this.fixed.get(c) ?? cut(from.login, 39);   // the org gate's login wins over what hello says
      if (!/^[A-Za-z0-9-]{1,39}$/.test(who)) return;
      const r = typeof m.room === "string" ? m.room.trim().toUpperCase() : "", room = CODE.test(r) ? r : "";
      // the open gate lets anyone with a GitHub account knock, so it opens only rooms shared by a code this hub knows:
      // the common space ("") is the key's and the org's people, never a stranger's (the security review of #157)
      // and a code must be one this hub's registry knows, for everyone: a hello with an unknown code closes, a key
      // holder's too, so each guess costs a knock. It is counted as one (Guesses), against GitHub's login when a gate
      // asked GitHub, else against where it came from (guesser): a key holder's login is its own word
      const open = this.opened.has(c), guess = guessers(this.fixed.get(c), who);
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
      this.conns.set(c, { who, agent: from.agent === true, machine: cut(m.machine, 60) || "?", state: presenceOf(String(m.state ?? "here")), session: this.session(m.session), since: Date.now(), room });
      if (room) this.opts.registry?.saw(room, who, Date.now());   // a code the registry does not know: nothing written
      const sp = this.opts.spool;
      if (sp) {
        if (!open) sp.saw(who);   // the spool's seen is the common space's people; a stranger is never one of them
        const kept = sp.take(who, room);   // this room's only; the rest wait for a hello in theirs
        if (kept.length) c.send(JSON.stringify({ kind: "spooled", from: { login: "", agent: false }, at: Date.now(), messages: kept }));
      }
      this.rosterToAll();
      return;
    }
    if (!me) return;   // nothing before hello
    if (m.kind === "presence") {
      const state = presenceOf(String(m.state ?? me.state));
      const session = this.session(m.session);
      if (state !== me.state) me.since = Date.now();
      me.state = state; me.session = session;
      this.rosterToAll();
      return;
    }
    const { room: _r, ...rest } = m;   // what a sender says of the room is not the hub's word: its hello's room is
    const out: RelayMsg = { ...rest, kind: m.kind as Kind, from: { login: me.who, agent: from.agent === true }, at: Date.now() };
    const line = JSON.stringify(out);
    for (const [o, e] of this.conns) {
      if (o === c || !e || e.room !== me.room) continue;   // one room's word stays in that room
      if ((m.kind === "ping" || m.kind === "room") && typeof m.to === "string" && m.to && e.who !== m.to) continue;   // a ping, or a room answer (#162), goes to its person only
      if (m.kind === "show" && o.behind?.()) continue;   // live words only: a slow reader misses them, nothing waits
      o.send(line);
    }
    if (SPOOLED.includes(out.kind)) this.keep({ ...out, room: me.room });
  }

  /** a talk line, a ping or a room answer (#162), kept with its room for each person it is for who has no Sol in that
   *  room right now. A talk in a room with a code is for the people the registry has seen in it; in the common space, as
   *  before. A ping or a room answer (a `room` with a `to`) is for that person. A room ask (no `to`) is never kept: its
   *  Sol asks again on every connect and every ten minutes, and a kept one would fill every away person's spool */
  private keep(m: RelayMsg & { room: string }) {
    const sp = this.opts.spool;
    if (!sp) return;
    if (m.kind === "room" && !(typeof m.to === "string" && m.to)) return;
    const on = new Set([...this.conns.values()].filter((e): e is Seat => !!e && e.room === m.room).map((e) => e.who.toLowerCase()));
    const sender = m.from.login.toLowerCase();
    const people = m.room ? this.opts.registry?.lookup(m.room)?.people ?? [] : [];
    // a ping in a coded room is kept only for one of that room's people: the spool is never a way to reach anyone else
    const to = (m.kind === "ping" || m.kind === "room") && typeof m.to === "string" && m.to
      ? (!m.room || people.some((p) => p.toLowerCase() === String(m.to).toLowerCase()) ? [m.to] : [])
      : m.room ? people
      : [...new Set([...sp.seen(), ...(this.opts.people?.() ?? [])])];
    for (const who of to) if (who.toLowerCase() !== sender && !on.has(who.toLowerCase())) sp.add(who, m);
  }

  /** every login the hub has heard say hello (its spool's), for the team when there is no org */
  seen(): string[] { return this.opts.spool?.seen() ?? []; }

  private session(v: unknown): RosterEntry["session"] {
    if (!isObj(v) || typeof v.title !== "string") return undefined;
    return { title: v.title.slice(0, 120), ...(typeof v.repo === "string" && v.repo ? { repo: v.repo.slice(0, 100) } : {}) };
  }

  /** each connection its own room's roster */
  private rosterToAll() {
    const lines = new Map<string, string>();
    for (const [o, e] of this.conns) {
      if (!e) continue;
      if (!lines.has(e.room)) lines.set(e.room, JSON.stringify({ kind: "roster", from: { login: "", agent: false }, at: Date.now(), roster: this.roster(e.room) }));
      o.send(lines.get(e.room)!);
    }
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

export type ServerOpts = { org?: () => string; verify?: Verify; open?: () => boolean; guesses?: Guesses;
  proofs?: Proofs; reads?: ProofReads; hosts?: () => string[] };   // proof.ts: the hub's tickets, what it reads with its own gh, the hosts it is

// which gate refused, for the one log line (never the token)
const gateWord = (org: string, open: boolean, headers: IncomingMessage["headers"]) => (org ? "GitHub" : open && bearerOf(headers) ? "GitHub, open" : "key");

/** the hub on an http server's upgrade: index.ts calls this for the path /relay. key() and org() are read on every
 *  knock; key() is "" on an engine that is not the host, which closes the gate in both modes */
export function relayServer(port: number, key: () => string, hub = new RelayHub(), opts: ServerOpts = {}) {
  const verify = withTickets(opts.verify ?? ghVerify(), opts.proofs);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  wss.on("connection", (ws, req: IncomingMessage & { solLogin?: string; solOpen?: boolean }) => {
    const c: Conn = { send: (l) => { if (ws.readyState === WebSocket.OPEN) ws.send(l); }, behind: () => ws.bufferedAmount > 256 * 1024,
      close: (code = 1008, why = "this hub opens a room by its code") => ws.close(code, why) };
    hub.join(c, req?.solLogin || undefined, req?.solOpen === true);
    ws.on("message", (d) => hub.message(c, String(d)));
    ws.on("close", () => hub.leave(c));
    ws.on("error", () => { /* closes next */ });
  });
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const org = opts.org?.() ?? "", open = opts.open?.() ?? false;
    void knock(req.url ?? "", req.headers, key(), org, port, verify, open).then((let_in) => {
      if (!let_in) {
        console.log(`relay: refused a knock (${gateWord(org, open, req.headers)}), origin=${req.headers.origin ?? "none"}`);   // never the token
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      Object.assign(req, { solLogin: let_in.login, solOpen: let_in.open === true });
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
export function relayRoutes(port: number, key: () => string, registry: Registry, opts: ServerOpts = {}) {
  const verify = withTickets(opts.verify ?? ghVerify(), opts.proofs);
  const reads: ProofReads = opts.reads ?? { proofOf: (id) => record().who.proofOf(id), inOrg: (o, l) => record().members.inOrg(o, l) };
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = req.url ?? "", path = url.split("?")[0];
    if (path === "/relay/proof") { await proofRoute(req, res, port, opts, reads); return true; }
    if (path !== "/relay/rooms" && !path.startsWith("/relay/rooms/") && !path.startsWith("/relay/names/")) return false;
    const org = opts.org?.() ?? "", open = opts.open?.() ?? false;
    const let_in = await knock(url, req.headers, key(), org, port, verify, open);
    if (!let_in) {
      console.log(`relay: refused a rooms call (${gateWord(org, open, req.headers)}), origin=${req.headers.origin ?? "none"}`);   // never the token
      // which gate said no, so the caller's Sol can say what to do (never the token, never the key)
      json(res, 403, { error: org ? "the hub asks GitHub: sign in (gh auth login), and be in the org" : open ? "the hub asks GitHub: sign in (gh auth login)" : "the hub meets by a key: put its key on the room" });
      return true;
    }
    if (path === "/relay/rooms" && req.method === "POST") {
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
      const who = guessers(let_in.login);
      if (who.some((g) => opts.guesses?.over(g))) { json(res, 429, { error: "too many codes tried; wait ten minutes" }); return true; }
      const e = registry.lookup(code);
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
async function proofRoute(req: IncomingMessage, res: ServerResponse, port: number, opts: ServerOpts, reads: ProofReads) {
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
  const got = await opts.proofs.redeem(v, hosts, org, reads);
  json(res, "error" in got ? 403 : 200, got);
}

// ---- the client: this engine on a hub ----
type Fn = (m: RelayMsg) => void;
export type Me = () => { login: string; state: PresenceState; session?: RosterEntry["session"]; room?: string };   // room: the active room's code (#157)

export class RelayClient {
  roster: RosterEntry[] = [];
  up = false;
  private ws: WebSocket | null = null;
  private wait = 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;   // until start()
  private subs = new Map<string, Set<Fn>>();
  private status = new Set<() => void>();

  private seenSet = new Set<string>();   // every login this client has seen on the relay (the team when there is no org)
  private hub: string | null = null;     // the address last met on, without its key, and the room's code: another forgets who was seen

  private misses = 0;   // connects that closed before the hub took my hello, since the last one it took
  gone = "";            // the place whose hub said no room has its code: not knocked on again until the room changes

  /** auth: the headers of one connect (a hub's ticket, or my own hub's token), or null to wait; misses: the connects
   *  since the hub last took my hello, so a ticket it keeps refusing is proved again (relay.ts below) */
  constructor(private url: () => string, private me: Me, private machine = hostname().split(".")[0],
    private auth: (misses: number) => Promise<Record<string, string> | null> = async () => ({})) {}

  seen() { return [...this.seenSet].sort(); }

  start() { this.stopped = false; this.hub = this.place(); this.connect(); return this; }

  // where this client meets: the hub's address and the room on it (#157); another room on the same hub is other people
  private place() { return `${this.url().split("?")[0]} ${this.me().room ?? ""}`; }

  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.ws?.close(); this.ws = null; this.setUp(false); }

  /** reconnect now (the url or key changed) */
  restart() {
    // another hub (a room switch, #154), or another room on it (#157): who was seen there is not this room's team
    const hub = this.place();
    if (this.hub !== null && hub !== this.hub) this.seenSet.clear();
    if (hub !== this.gone) this.gone = "";
    this.hub = hub;
    this.ws?.removeAllListeners(); this.ws?.terminate(); this.ws = null; this.setUp(false); this.wait = 1000; if (!this.stopped) this.connect(); }

  on(kind: string, fn: Fn) {
    const s = this.subs.get(kind) ?? new Set<Fn>();
    s.add(fn); this.subs.set(kind, s);
    return () => { s.delete(fn); };
  }

  onStatus(fn: () => void) { this.status.add(fn); return () => { this.status.delete(fn); }; }

  send(kind: Kind, payload: Record<string, unknown> = {}, agent = false) {
    if (!this.up || !this.ws) return false;
    const m = { ...payload, kind, from: { login: this.me().login, agent }, at: Date.now() };
    this.ws.send(JSON.stringify(m));
    return true;
  }

  /** this engine's presence changed: the hub re-sends the roster */
  presence() { const me = this.me(); this.send("presence", { state: me.state, session: me.session }); }

  private setUp(v: boolean) { if (this.up !== v) { this.up = v; if (!v) this.roster = []; for (const f of this.status) f(); } }

  private connect() {
    if (this.stopped || this.connecting) return;
    if (this.gone && this.gone === this.place()) return;   // that room is gone on its hub: knocking again changes nothing
    const me = this.me();
    if (!me.login) { this.later(); return; }   // who I am comes from gh; until then there is nobody to say hello as
    this.connecting = true;
    // the headers are for the hub and room in use now: a switch while they are being made (a proof takes seconds) must
    // never send them to the next hub, so the place is read again before they go, and a moved one starts over
    const url = this.url(), at = this.place();
    void this.auth(this.misses).catch(() => null).then((headers) => {
      this.connecting = false;
      if (this.stopped || this.ws) return;
      if (this.place() !== at || this.url() !== url) { this.connect(); return; }
      if (!headers) { this.later(); return; }   // org mode and gh gave no token: try again later
      this.open(headers, url);
    });
  }

  private connecting = false;

  private open(headers: Record<string, string>, url: string) {
    let ws: WebSocket;
    try { ws = new WebSocket(url, Object.keys(headers).length ? { headers } : undefined); } catch { this.later(); return; }
    this.ws = ws;
    ws.on("open", () => {
      const m = this.me();
      ws.send(JSON.stringify({ kind: "hello", from: { login: m.login, agent: false }, at: Date.now(), machine: this.machine, state: m.state, session: m.session, room: m.room ?? "" }));
      this.setUp(true);
    });
    ws.on("message", (d) => {
      let m: unknown;
      try { m = JSON.parse(String(d)); } catch { return; }
      if (!isObj(m) || typeof m.kind !== "string") return;
      if (m.kind === "roster" && Array.isArray(m.roster)) {
        this.wait = 1000; this.misses = 0;   // the hub took my hello; a hello it closes (a code it does not know) backs off instead
        this.roster = m.roster as RosterEntry[];
        for (const e of this.roster) if (typeof e?.who === "string") this.seenSet.add(e.who);
        for (const f of this.status) f();
      }
      if (m.kind === "spooled") { this.unspool(m.messages); return; }
      for (const f of this.subs.get(m.kind) ?? []) f(m as RelayMsg);
    });
    let took = false;
    ws.on("message", () => { took = true; });
    ws.on("close", (code) => {
      if (this.ws !== ws) return;
      if (!took) this.misses++;
      this.ws = null; this.setUp(false);
      if (code === GONE) { this.gone = this.place(); console.log("relay: the hub says no room has this room's code; not knocking with it again"); for (const f of this.status) f(); return; }
      if (code === SLOWED) this.wait = 10 * 60_000;
      this.later();
    });
    ws.on("error", () => { /* close follows */ });
  }

  /** what the hub kept while no Sol of mine was on: each to its kind's handlers marked spooled, then the list */
  private unspool(v: unknown) {
    if (!Array.isArray(v)) return;
    const msgs = v.filter((x): x is RelayMsg => isObj(x) && SPOOLED.includes(x.kind as Kind) && isObj(x.from) && typeof x.at === "number")
      .map((x) => ({ ...x, spooled: true }));
    for (const m of msgs) for (const f of this.subs.get(m.kind) ?? []) f(m);
    const all = { kind: "spooled", from: { login: "", agent: false }, at: Date.now(), messages: msgs } as unknown as RelayMsg;
    if (msgs.length) for (const f of this.subs.get("spooled") ?? []) f(all);
  }

  private later() {
    if (this.stopped || this.timer || this.connecting) return;
    this.timer = setTimeout(() => { this.timer = null; this.connect(); }, this.wait);
    this.timer.unref?.();
    this.wait = Math.min(this.wait * 2, 30_000);
  }
}

// ---- this engine's one client, and the exports the other slices use ----
// Made at load, started by index.ts once the port listens, so onRelay works from any module at any time.
const PORT = Number(process.env.SOL_PORT ?? process.env.PORT ?? 7777);
let mine: { state: PresenceState; session?: RosterEntry["session"] } = { state: "here" };

/** where this engine's client goes: the teammate's hub, or its own. With an org the key stays home: GitHub says who */
export function relayUrl(port = PORT) {
  const s = getTeam();
  const base = s.relay.url || `ws://127.0.0.1:${port}/relay`;
  if (s.org || activeRoom(s).gate === "github") return base;   // #157: a room met as GitHub never carries a key, least of all relay.key
  return `${base}${base.includes("?") ? "&" : "?"}key=${encodeURIComponent(roomKey(s))}`;   // the room's own key, when it has one (#154)
}

/** does this room meet as who I am on GitHub? (#157) With an org, yes (the org's gate); else when the room says so,
 *  its gate "github" (a room joined by a code, the maker's own on the shared hub). A room with gate "key" meets by a
 *  key, as every room from before codes does */
export const asGitHub = (org: string, room: Pick<Room, "gate">) => !!org || room.gate === "github";

/** a hub's socket address as its http one: wss to https, ws to http, the path kept, /relay when it has none */
export function hubHttp(hub: string): string {
  let u: URL;
  try { u = new URL(hub); } catch { return ""; }
  const proto = u.protocol === "wss:" ? "https:" : u.protocol === "ws:" ? "http:" : "";
  if (!proto) return "";
  const path = u.pathname.replace(/\/+$/, "") || "/relay";
  return `${proto}//${u.host}${path}`;
}

/** is this http address one a GitHub token may go to: https, or plain http to this machine only */
export const safeForToken = (url: string) => /^https:\/\//.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);

/** is this http address this machine's: a GitHub token may go there, since it never leaves the machine */
export const thisMachine = (url: string) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);

/** my ticket for a hub (proof.ts), proved with my own gh: what every hub but this machine's own gets instead of my token */
export const hubTicket = (hub: string) => ticketFor(hub, { fetch: globalThis.fetch, login: () => getTeam().me.login,
  prove: (text) => record().who.prove(text), unprove: (id) => record().who.unprove(id) });

/** the headers of one connect, when the room meets as GitHub (asGitHub): to a wss hub, its ticket for me (proof.ts:
 *  never my token, which could write as me); to this machine's own hub ("" is), my token, fresh from gh, as before.
 *  None otherwise, never anything in the clear. With an org and nothing to send, null: wait. With no org, {} */
export async function relayAuth(org = getTeam().org, token = ghToken, room: Pick<Room, "hub" | "gate"> & { code?: string } = activeRoom(getTeam()), ticket: (hub: string) => Promise<string> = hubTicket): Promise<Record<string, string> | null> {
  const hub = hubHttp(room.hub || "ws://127.0.0.1/relay");
  // a coded room met by a key knocks as GitHub too, beside its key: a hub that lets strangers in meets a coded room
  // under GitHub's word only (a hub that does not ignores it, and gives no ticket)
  if ((!asGitHub(org, room) && !room.code) || !safeForToken(hub)) return {};
  const t = await (thisMachine(hub) ? token() : ticket(hub)).catch(() => "");
  return t ? { authorization: `Bearer ${t}` } : org ? null : {};
}

// three connects in a row the hub did not take: my ticket may be the reason (its key or its org changed), so it is
// proved again, at most once an hour (refusedBy)
const client = new RelayClient(() => relayUrl(), () => ({ login: getTeam().me.login, room: activeRoom(getTeam()).code, ...mine }), undefined,
  (misses) => { if (misses >= 3) refusedBy(hubHttp(activeRoom(getTeam()).hub || "ws://127.0.0.1/relay")); return relayAuth(); });
setSeen(() => client.seen());
let started = false;
export function startRelayClient() { if (!started) { started = true; client.start(); } return client; }

/** the creature moved: say it on the relay (state, and a Work turn's title and repo) */
export function setPresence(state: string, turn: { kind: string; title: string } | null, cwd?: string) {
  const next = { state: presenceOf(state), session: sessionOf(turn, cwd) };
  if (JSON.stringify(next) === JSON.stringify(mine)) return;
  mine = next;
  client.presence();
}

/** a relay message of this kind arrived (from another engine; never this one's own). "spooled": the hub's kept list,
 *  after each of its messages went to its own kind's handlers with `spooled: true` */
export const onRelay = (kind: Kind | "spooled", fn: Fn) => client.on(kind, fn);
/** send a signed message to everyone on the relay (ping goes to payload.to only). false when the relay is down */
export const sendRelay = (kind: Kind, payload: Record<string, unknown> = {}, agent = false) => client.send(kind, payload, agent);
export const relayRoster = () => client.roster;
export const relayUp = () => client.up;
export const onRelayStatus = (fn: () => void) => client.onStatus(fn);
export const restartRelay = () => client.restart();
