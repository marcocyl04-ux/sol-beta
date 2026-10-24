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
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { timingSafeEqual, createHash } from "node:crypto";
import { hostname } from "node:os";
import { basename } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { getTeam } from "./settings.js";
import type { Spool } from "./spool.js";
import { orgGate, originOk, ghVerify, ghToken, type Verify } from "./identity.js";
import { setSeen } from "./members.js";

export const KINDS = ["hello", "roster", "presence", "changed", "hand", "stable", "ping", "talk", "show"] as const;
export type Kind = (typeof KINDS)[number];
export type From = { login: string; agent: boolean };
export type RelayMsg = { kind: Kind; from: From; at: number; spooled?: boolean; [k: string]: unknown };
/** what the spool keeps and hands back: only what the relay already carried, and only these */
export const SPOOLED: readonly Kind[] = ["talk", "ping"];
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
export type Conn = { send: (line: string) => void; behind?: () => boolean };   // behind: its socket is backed up

export type HubOpts = {
  spool?: Spool;                // absent: the hub keeps nothing (tests, and an engine that is not the host)
  people?: () => string[];      // who a talk line is kept for, besides the logins the spool has seen say hello
};

export class RelayHub {
  private conns = new Map<Conn, RosterEntry | null>();   // null until it said hello
  private fixed = new Map<Conn, string>();               // GitHub's login for a connection the org gate let in

  constructor(private opts: HubOpts = {}) {}

  /** a connection came in; `login` is GitHub's word for it when the org gate checked it */
  join(c: Conn, login?: string) { this.conns.set(c, null); if (login) this.fixed.set(c, login); }

  leave(c: Conn) {
    const had = this.conns.get(c);
    this.conns.delete(c);
    this.fixed.delete(c);
    if (had) this.rosterToAll();
  }

  roster(): RosterEntry[] {
    return [...this.conns.values()].filter((e): e is RosterEntry => !!e).sort((a, b) => a.who.localeCompare(b.who) || a.machine.localeCompare(b.machine));
  }

  message(c: Conn, raw: string) {
    let m: unknown;
    try { m = JSON.parse(raw); } catch { return; }
    if (!isObj(m) || !KINDS.includes(m.kind as Kind) || m.kind === "roster") return;
    if (!isObj(m.from) || typeof m.at !== "number") return;   // the signed shape, or nothing: an unsigned line never fans out
    const from = m.from;
    const me = this.conns.get(c);
    if (m.kind === "hello") {
      const who = this.fixed.get(c) ?? cut(from.login, 39);   // the org gate's login wins over what hello says
      if (!/^[A-Za-z0-9-]{1,39}$/.test(who)) return;
      this.conns.set(c, { who, agent: from.agent === true, machine: cut(m.machine, 60) || "?", state: presenceOf(String(m.state ?? "here")), session: this.session(m.session), since: Date.now() });
      const sp = this.opts.spool;
      if (sp) {
        sp.saw(who);
        const kept = sp.take(who);
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
    const out: RelayMsg = { ...m, kind: m.kind as Kind, from: { login: me.who, agent: from.agent === true }, at: Date.now() };
    const line = JSON.stringify(out);
    for (const [o, e] of this.conns) {
      if (o === c || !e) continue;
      if (m.kind === "ping" && typeof m.to === "string" && m.to && e.who !== m.to) continue;   // a ping goes to its person only
      if (m.kind === "show" && o.behind?.()) continue;   // live words only: a slow reader misses them, nothing waits
      o.send(line);
    }
    if (SPOOLED.includes(out.kind)) this.keep(out);
  }

  /** a talk line or a ping, kept for each person it is for who has no Sol on the relay right now */
  private keep(m: RelayMsg) {
    const sp = this.opts.spool;
    if (!sp) return;
    const on = new Set([...this.conns.values()].filter((e): e is RosterEntry => !!e).map((e) => e.who.toLowerCase()));
    const sender = m.from.login.toLowerCase();
    const to = m.kind === "ping" && typeof m.to === "string" && m.to ? [m.to]
      : [...new Set([...sp.seen(), ...(this.opts.people?.() ?? [])])];
    for (const who of to) if (who.toLowerCase() !== sender && !on.has(who.toLowerCase())) sp.add(who, m);
  }

  /** every login the hub has heard say hello (its spool's), for the team when there is no org */
  seen(): string[] { return this.opts.spool?.seen() ?? []; }

  private session(v: unknown): RosterEntry["session"] {
    if (!isObj(v) || typeof v.title !== "string") return undefined;
    return { title: v.title.slice(0, 120), ...(typeof v.repo === "string" && v.repo ? { repo: v.repo.slice(0, 100) } : {}) };
  }

  private rosterToAll() {
    const line = JSON.stringify({ kind: "roster", from: { login: "", agent: false }, at: Date.now(), roster: this.roster() });
    for (const [o, e] of this.conns) if (e) o.send(line);
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

/** the whole gate, either mode: { login } let in (login "" in key mode: hello says who), or null (refused).
 *  org "" = the key's gate, unchanged; an org = GitHub's, and the login is GitHub's (identity.ts) */
export async function knock(url: string, headers: IncomingMessage["headers"], key: string, org: string, port: number, verify: Verify): Promise<{ login: string } | null> {
  if (!org) return relayGate(url, headers, key, port) ? { login: "" } : null;
  if (!key) return null;   // not the host: closed in both modes
  const login = await orgGate(headers, org, port, verify);
  return login ? { login } : null;
}

export type ServerOpts = { org?: () => string; verify?: Verify };

/** the hub on an http server's upgrade: index.ts calls this for the path /relay. key() and org() are read on every
 *  knock; key() is "" on an engine that is not the host, which closes the gate in both modes */
export function relayServer(port: number, key: () => string, hub = new RelayHub(), opts: ServerOpts = {}) {
  const verify = opts.verify ?? ghVerify();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  wss.on("connection", (ws, req: IncomingMessage & { solLogin?: string }) => {
    const c: Conn = { send: (l) => { if (ws.readyState === WebSocket.OPEN) ws.send(l); }, behind: () => ws.bufferedAmount > 256 * 1024 };
    hub.join(c, req?.solLogin || undefined);
    ws.on("message", (d) => hub.message(c, String(d)));
    ws.on("close", () => hub.leave(c));
    ws.on("error", () => { /* closes next */ });
  });
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const org = opts.org?.() ?? "";
    void knock(req.url ?? "", req.headers, key(), org, port, verify).then((let_in) => {
      if (!let_in) {
        console.log(`relay: refused a knock (${org ? "GitHub" : "key"}), origin=${req.headers.origin ?? "none"}`);   // never the token
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      (req as IncomingMessage & { solLogin?: string }).solLogin = let_in.login;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });
  };
  return { upgrade, hub, wss };
}

// ---- the client: this engine on a hub ----
type Fn = (m: RelayMsg) => void;
export type Me = () => { login: string; state: PresenceState; session?: RosterEntry["session"] };

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

  /** auth: the headers of one connect (org mode: the person's GitHub token, read fresh each time), or null to wait */
  constructor(private url: () => string, private me: Me, private machine = hostname().split(".")[0],
    private auth: () => Promise<Record<string, string> | null> = async () => ({})) {}

  seen() { return [...this.seenSet].sort(); }

  start() { this.stopped = false; this.connect(); return this; }

  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.ws?.close(); this.ws = null; this.setUp(false); }

  /** reconnect now (the url or key changed) */
  restart() { this.ws?.removeAllListeners(); this.ws?.terminate(); this.ws = null; this.setUp(false); this.wait = 1000; if (!this.stopped) this.connect(); }

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
    const me = this.me();
    if (!me.login) { this.later(); return; }   // who I am comes from gh; until then there is nobody to say hello as
    this.connecting = true;
    void this.auth().catch(() => null).then((headers) => {
      this.connecting = false;
      if (this.stopped || this.ws) return;
      if (!headers) { this.later(); return; }   // org mode and gh gave no token: try again later
      this.open(headers);
    });
  }

  private connecting = false;

  private open(headers: Record<string, string>) {
    let ws: WebSocket;
    try { ws = new WebSocket(this.url(), Object.keys(headers).length ? { headers } : undefined); } catch { this.later(); return; }
    this.ws = ws;
    ws.on("open", () => {
      this.wait = 1000;
      const m = this.me();
      ws.send(JSON.stringify({ kind: "hello", from: { login: m.login, agent: false }, at: Date.now(), machine: this.machine, state: m.state, session: m.session }));
      this.setUp(true);
    });
    ws.on("message", (d) => {
      let m: unknown;
      try { m = JSON.parse(String(d)); } catch { return; }
      if (!isObj(m) || typeof m.kind !== "string") return;
      if (m.kind === "roster" && Array.isArray(m.roster)) {
        this.roster = m.roster as RosterEntry[];
        for (const e of this.roster) if (typeof e?.who === "string") this.seenSet.add(e.who);
        for (const f of this.status) f();
      }
      if (m.kind === "spooled") { this.unspool(m.messages); return; }
      for (const f of this.subs.get(m.kind) ?? []) f(m as RelayMsg);
    });
    ws.on("close", () => { if (this.ws === ws) { this.ws = null; this.setUp(false); this.later(); } });
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
  if (s.org) return base;
  return `${base}${base.includes("?") ? "&" : "?"}key=${encodeURIComponent(s.relay.key)}`;
}

/** the headers of one connect: none in key mode; in org mode the person's token, fresh from gh (null: not signed in) */
export async function relayAuth(org = getTeam().org, token = ghToken): Promise<Record<string, string> | null> {
  if (!org) return {};
  const t = await token();
  return t ? { authorization: `Bearer ${t}` } : null;
}

const client = new RelayClient(() => relayUrl(), () => ({ login: getTeam().me.login, ...mine }), undefined, () => relayAuth());
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
