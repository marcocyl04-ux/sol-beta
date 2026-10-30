// The relay's client (#206, S1 of #168; the wire is the hub's, src/hub/relay-hub.ts, and PROTOCOL.md round 17): one engine on one hub. It
// knows nothing of the engine: where to go, who I am and the headers of a connect are handed in (relay.ts makes this
// engine's one client), so it loads with no team settings and starts nothing until start().
// Under load (#223, S6a; PROTOCOL.md round 41): the hello says the wire's version (C1), every message carries an id
// (C2), and a hub that answers (v2: kind `hub`) is met on its terms: a talk, ping or room message is kept until the
// hub says ok, sent again when it says retry and after a reconnect (the hub drops an id it already has); a talk line
// past the hub's largest message is sent in parts cut by bytes (A5); a full hub's number in the queue is kept and
// brought back (B3); waits between connects are random within their step (B4). An old hub says nothing of this, and
// is met as before: nothing kept, nothing cut.
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { SPOOLED, GONE, SLOWED, FULL, TOO_OLD, TOO_FAST, KICKED, PROTOCOL, HUB, isObj, type Kind, type RelayMsg, type PresenceState, type RosterEntry, type SolVersion } from "../hub/index.js";

export type Fn = (m: RelayMsg) => void;
export type Me = () => { login: string; state: PresenceState; session?: RosterEntry["session"]; room?: string; thing?: RosterEntry["thing"]; sessions?: RosterEntry["sessions"]; quiet?: true; talkSince?: Record<string, number>; github?: boolean;
  polls?: string[]; version?: SolVersion };   // version (#417): the release this Sol sits on and its own layer; an old hub drops it   // polls (#328): the room's repositories my gh checked, whose board I may read for everyone   // github (#320): GitHub signed in on this Mac, a boolean only   // talkSince (#315): the newest talk line a thread has here   // quiet (#238): my room sessions are not shown here. room: the active room's code (#157); thing, sessions: what I am in there (#230)
/** what a hub said of itself in its answer to my hello (v2); null: an old hub, or none yet */
export type HubInfo = { v: number; msgMax: number; light: string; watch: boolean; rooms?: boolean; join?: boolean };   // rooms (#238): it keeps a room show's lines to its watchers; join (#327): it serves the join page

const KEPT: readonly Kind[] = SPOOLED;     // talk, ping, room: kept until the hub says ok (C2)
const KEEP_FOR = 9 * 60_000;               // the hub remembers an id ten minutes: never sent again after that
const KEEP_MAX = 200;
const RECENT_MAX = 50;
const WAIT_MAX = 30_000;

/** text cut into parts that each fit `bytes` once JSON-encoded, never inside a character a person sees (a CJK
 *  character, an emoji with its joiners and skin tone stay whole). Pure */
export function splitBytes(text: string, bytes: number): string[] {
  const size = (s: string) => Buffer.byteLength(JSON.stringify(s)) - 2;
  if (size(text) <= bytes) return [text];
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const out: string[] = [];
  let cur = "", n = 0;
  for (const { segment } of seg.segment(text)) {
    let g = segment, k = size(g);
    if (k > bytes) { g = [...g].reduce((a, ch) => (size(a + ch) <= bytes ? a + ch : a), ""); k = size(g); }   // one cluster past a whole part: its code points that fit
    if (n + k > bytes && cur) { out.push(cur); cur = ""; n = 0; }
    cur += g; n += k;
  }
  if (cur) out.push(cur);
  return out;
}

/** B4: the wait before a connect, random in the upper half of its step (pure: rand in [0, 1)) */
export const backoff = (wait: number, rand: number) => wait / 2 + rand * (wait / 2);

/** how long a room its hub said it has no room for waits before it knocks again (S6b) */
export const GONE_AGAIN = 60 * 60_000;

export class RelayClient {
  roster: RosterEntry[] = [];
  /** who reads the board of which repository for my room (#328), as the hub's last roster said, by repository in lower case */
  pollers: Record<string, string> = {};
  up = false;
  /** the hub's answer to my hello (v2), or null */
  info: HubInfo | null = null;
  /** the hub said this Sol is too old for it (C1): not knocked on again until restart() */
  old = false;
  /** my place in a busy hub's queue (B3), while I wait: how many are before me, and when I go again */
  queued: { ahead: number; wait: number } | null = null;
  private ws: WebSocket | null = null;
  private wait = 1000;
  private next = 0;   // a wait set by the hub (its queue, a restart): the next connect waits this instead
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;   // until start()
  private subs = new Map<string, Set<Fn>>();
  private status = new Set<() => void>();
  private kept = new Map<string, { m: Record<string, unknown>; at: number; timer?: ReturnType<typeof setTimeout> }>();   // sent, not yet ok'd (C2)
  private recent = new Map<string, { m: Record<string, unknown>; at: number; timer?: ReturnType<typeof setTimeout> }>();   // sent lately, not kept (a retry finds it here)
  private ticket = "";   // the queue's number (B3)

  private seenSet = new Set<string>();   // every login this client has seen on the relay (the team when there is no org)
  private hub: string | null = null;     // the address last met on, without its key, and the room's code: another forgets who was seen

  private misses = 0;   // connects that closed before the hub took my hello, since the last one it took
  gone = "";            // the place whose hub said no room has its code: not knocked on again until the room changes
  /** a number in [0, 1); the tests make waits exact */
  rand: () => number = Math.random;

  /** auth: the headers of one connect (a hub's ticket, or my own hub's token), or null to wait; misses: the connects
   *  since the hub last took my hello, so a ticket it keeps refusing is proved again (relay.ts below) */
  constructor(private url: () => string, private me: Me, private machine = hostname().split(".")[0],
    private auth: (misses: number) => Promise<Record<string, string> | null> = async () => ({})) {}

  seen() { return [...this.seenSet].sort(); }

  start() { this.stopped = false; this.hub = this.place(); this.connect(); return this; }

  // where this client meets: the hub's address and the room on it (#157); another room on the same hub is other people
  private place() { return `${this.url().split("?")[0]} ${this.me().room ?? ""}`; }
  /** the room in use is one its hub said it has no room for (4404), until the room changes */
  get goneHere() { return !!this.gone && this.gone === this.place(); }

  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.ws?.close(); this.ws = null; this.setUp(false); this.forget(); }

  /** reconnect now (the url or key changed) */
  restart() {
    // another hub (a room switch, #154), or another room on it (#157): who was seen there is not this room's team
    const hub = this.place();
    if (this.hub !== null && hub !== this.hub) { this.seenSet.clear(); this.forget(); this.ticket = ""; }
    if (hub !== this.gone) this.gone = "";
    this.old = false; this.queued = null; this.info = null;   // what the hub before said of itself is not this one's (#238)
    this.hub = hub;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.ws?.removeAllListeners(); this.ws?.on("error", () => {}); this.ws?.terminate(); this.ws = null; this.setUp(false); this.wait = 1000; this.next = 0; if (!this.stopped) this.connect(); }

  on(kind: string, fn: Fn) {
    const s = this.subs.get(kind) ?? new Set<Fn>();
    s.add(fn); this.subs.set(kind, s);
    return () => { s.delete(fn); };
  }

  onStatus(fn: () => void) { this.status.add(fn); return () => { this.status.delete(fn); }; }

  /** a signed message to the hub, with an id (the payload's own, or a new one). On a hub that answers (v2) a talk
   *  longer than its largest message goes in parts, and a kept kind waits for the hub's ok. false: the relay is down,
   *  or the message cannot fit */
  send(kind: Kind, payload: Record<string, unknown> = {}, agent = false) {
    if (!this.up || !this.ws) return false;
    const id = typeof payload.id === "string" && /^[\w-]{1,80}$/.test(payload.id) ? payload.id : randomUUID();
    const m: Record<string, unknown> = { ...payload, id, kind, from: { login: this.me().login, agent }, at: Date.now() };
    const max = this.info?.msgMax ?? 0;
    if (max && Buffer.byteLength(JSON.stringify(m)) > max) {
      if (kind !== "talk" || typeof m.text !== "string") { console.log(`relay: a ${kind} message is past the hub's ${max} bytes; not sent`); return false; }
      const room = Buffer.byteLength(JSON.stringify({ ...m, id: `${id}-p999`, part: [999, 999], text: "" })) + 8;
      const parts = splitBytes(m.text, max - room);
      if (!parts.length || max - room < 64) return false;
      parts.forEach((text, i) => this.out({ ...m, id: `${id}-p${i + 1}`, part: [i + 1, parts.length], text }));
      return true;
    }
    this.out(m);
    return true;
  }

  private out(m: Record<string, unknown>) {
    if (this.info && this.info.v >= 2 && KEPT.includes(m.kind as Kind)) {
      this.kept.set(m.id as string, { m, at: Date.now() });
      while (this.kept.size > KEEP_MAX) this.drop(this.kept.keys().next().value!);
    } else if (this.info && this.info.v >= 2 && !(m.kind === "show" && m.event === "line")) {
      // the rest (a watch, a presence, a show's start) is held a minute, so a retry from the hub can send it again (the review)
      const t = Date.now();
      // a newer watch of the same show replaces an older one waiting on a retry, so on and off never arrive reversed
      if (m.kind === "watch") for (const [id, k] of this.recent) if (k.m.kind === "watch" && k.m.login === m.login && k.m.session === m.session) { if (k.timer) clearTimeout(k.timer); this.recent.delete(id); }
      this.recent.set(m.id as string, { m, at: t });
      for (const [id, k] of this.recent) { if (this.recent.size <= RECENT_MAX && t - k.at < 60_000) break; if (k.timer) clearTimeout(k.timer); this.recent.delete(id); }
    }
    this.ws?.send(JSON.stringify(m));
  }

  private drop(id: string) { const k = this.kept.get(id); if (k?.timer) clearTimeout(k.timer); this.kept.delete(id); }
  private forget() { for (const id of [...this.kept.keys()]) this.drop(id); for (const k of this.recent.values()) if (k.timer) clearTimeout(k.timer); this.recent.clear(); }

  /** what I sent that the hub has not said ok to, again (a new connection to a hub that answers): the hub drops what
   *  it already has. Older than the hub remembers: given up, never sent twice */
  private again() {
    const t = Date.now();
    for (const [id, k] of [...this.kept]) {
      if (t - k.at > KEEP_FOR) { this.drop(id); continue; }
      if (!k.timer) this.ws?.send(JSON.stringify({ ...k.m, at: t }));
    }
  }

  /** this engine's presence changed: the hub re-sends the roster */
  presence() { const me = this.me(); this.send("presence", { state: me.state, session: me.session, thing: me.thing, sessions: me.sessions, ...(me.quiet ? { quiet: true } : {}), ...(typeof me.github === "boolean" ? { github: me.github } : {}), ...(me.polls?.length ? { polls: me.polls } : {}), ...(me.version ? { version: me.version } : {}) }); }

  private setUp(v: boolean) { if (this.up !== v) { this.up = v; if (!v) this.roster = []; for (const f of this.status) f(); } }

  private connect() {
    if (this.stopped || this.connecting || this.old) return;
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
      this.open(this.ticket ? { ...headers, "x-sol-queue": this.ticket } : headers, url);
    });
  }

  private connecting = false;

  private open(headers: Record<string, string>, url: string) {
    let ws: WebSocket;
    try { ws = new WebSocket(url, Object.keys(headers).length ? { headers } : undefined); } catch { this.later(); return; }
    this.ws = ws;
    let queued = false;
    // B3: a busy hub answers 503 with my number and when to come back; anything else is a refusal, as before
    ws.on("unexpected-response", (req, res) => {
      const n = String(res.headers["x-sol-queue"] ?? "");
      if (res.statusCode === 503 && /^q1\.\d{1,12}\.[A-Za-z0-9_-]{22}$/.test(n)) {
        queued = true;
        this.ticket = n;
        const wait = Math.max(1, Math.min(120, Number(res.headers["retry-after"]) || 10));
        const ahead = Math.max(0, Number(res.headers["x-sol-ahead"]) || 0);
        this.queued = { ahead, wait };
        this.next = wait * 1000 + this.rand() * 1000;   // a little apart, so a called group does not come back as one
        this.tell({ say: "queue", ahead, wait });
      }
      req.destroy(); res.destroy();
      if (this.ws !== ws) return;
      this.ws = null; this.setUp(false);
      if (!queued) this.misses++;
      this.later();
    });
    ws.on("open", () => {
      const m = this.me();
      ws.send(JSON.stringify({ kind: "hello", from: { login: m.login, agent: false }, at: Date.now(), machine: this.machine, state: m.state, session: m.session, thing: m.thing, sessions: m.sessions, ...(m.quiet ? { quiet: true } : {}), ...(typeof m.github === "boolean" ? { github: m.github } : {}), ...(m.polls?.length ? { polls: m.polls } : {}), ...(m.version ? { version: m.version } : {}), room: m.room ?? "", ...(m.talkSince && Object.keys(m.talkSince).length ? { talkSince: m.talkSince } : {}), v: PROTOCOL }));
      this.setUp(true);
    });
    ws.on("message", (d) => {
      let m: unknown;
      try { m = JSON.parse(String(d)); } catch { return; }
      if (!isObj(m) || typeof m.kind !== "string") return;
      if (m.kind === "roster" && Array.isArray(m.roster)) {
        this.wait = 1000; this.misses = 0;   // the hub took my hello; a hello it closes (a code it does not know) backs off instead
        this.ticket = ""; this.queued = null;
        this.roster = m.roster as RosterEntry[];
        this.pollers = {};   // #328: only logins, by repositories in GitHub's shape
        if (isObj(m.pollers)) for (const [k, v] of Object.entries(m.pollers)) if (/^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(k) && typeof v === "string" && /^[A-Za-z0-9-]{1,39}$/.test(v)) this.pollers[k.toLowerCase()] = v;
        for (const e of this.roster) if (typeof e?.who === "string") this.seenSet.add(e.who);
        for (const f of this.status) f();
      }
      if (m.kind === HUB) { this.heard(m); }
      if (m.kind === "spooled") { this.unspool(m.messages); return; }
      for (const f of this.subs.get(m.kind) ?? []) f(m as RelayMsg);
    });
    let took = false;
    ws.on("message", () => { took = true; });
    ws.on("close", (code) => {
      if (this.ws !== ws) return;
      if (!took) this.misses++;
      this.ws = null; this.info = null; this.pollers = {}; this.setUp(false);
      for (const k of this.kept.values()) if (k.timer) { clearTimeout(k.timer); k.timer = undefined; }
      for (const k of this.recent.values()) if (k.timer) clearTimeout(k.timer);
      this.recent.clear();
      if (code === GONE) {
        const at = this.gone = this.place();
        console.log("relay: the hub says no room has this room's code; knocking with it again in an hour");
        for (const f of this.status) f();
        // once an hour after (S6b): a code the cloud did not have may be brought over since (sol/cloud/import-hub-rooms)
        setTimeout(() => { if (this.gone === at && !this.stopped) { this.gone = ""; this.connect(); for (const f of this.status) f(); } }, GONE_AGAIN + this.rand() * 60_000).unref?.();
        return;
      }
      if (code === TOO_OLD) { this.old = true; console.log("relay: the hub says this Sol is too old for it; not knocking again until Sol is updated"); this.tell({ say: "update" }); for (const f of this.status) f(); return; }
      if (code === SLOWED) this.wait = 10 * 60_000;
      if (code === FULL) this.wait = 60_000;   // the room has as many people on as it takes (#208): a minute, then again
      if (code === TOO_FAST) this.wait = 60_000;   // I kept sending after the hub said wait (#223, B2)
      if (code === KICKED) this.wait = 10 * 60_000;   // the cloud's admin closed it (#225): a disabled account, a closed room
      if (code === 1001 || code === 1012) this.next = this.rand() * 5000;   // the hub is restarting: everyone comes back, spread over five seconds (B4)
      this.later();
    });
    ws.on("error", () => { /* close follows */ });
  }

  /** the hub's own word to me (v2): its hello, an ok, a retry, the light, update. Every one also goes to the `hub`
   *  handlers, so the engine can say it */
  private heard(m: Record<string, unknown>) {
    const say = m.say;
    if (say === "hello") {
      this.info = { v: Number(m.v) || 0, msgMax: Number(m.msgMax) > 0 ? Number(m.msgMax) : 0, light: String(m.light ?? "green"), watch: m.watch !== false, ...(m.rooms === true ? { rooms: true } : {}), ...(m.join === true ? { join: true } : {}) };
      if (this.info.v >= 2) this.again();
    } else if (say === "ok" && typeof m.id === "string") this.drop(m.id);
    else if (say === "retry" && typeof m.id === "string") {
      const id = m.id, k = this.kept.get(id) ?? this.recent.get(id);
      const after = Math.max(1, Math.min(600, Number(m.after) || 1));
      if (k && !k.timer) k.timer = setTimeout(() => {
        k.timer = undefined;
        if (!this.up || !(this.kept.has(id) || this.recent.has(id))) return;
        this.ws?.send(JSON.stringify({ ...k.m, at: Date.now() }));
      }, after * 1000 + this.rand() * 500);
      k?.timer?.unref?.();
    } else if (say === "light" && this.info && typeof m.light === "string") this.info.light = m.light;
  }

  private tell(rest: Record<string, unknown>) {
    const m = { kind: HUB, from: { login: "", agent: false }, at: Date.now(), ...rest } as unknown as RelayMsg;
    for (const f of this.subs.get(HUB) ?? []) f(m);
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

  /** the next connect, after a wait that doubles to 30 s, each one random in its upper half (B4: a hub that comes
   *  back is not met by everyone at once); a wait the hub set (its queue, its restart) instead when there is one */
  private later() {
    if (this.stopped || this.timer || this.connecting) return;
    const ms = this.next || backoff(this.wait, this.rand());
    this.next = 0;
    this.timer = setTimeout(() => { this.timer = null; this.connect(); }, ms);
    this.timer.unref?.();
    this.wait = Math.min(this.wait * 2, WAIT_MAX);
  }
}
