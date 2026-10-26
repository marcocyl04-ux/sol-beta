// Proof (the review of the rooms stack, finding 3): how a hub learns who I am on GitHub without ever holding my GitHub
// token. Before, a Sol knocked with `gh auth token` as a Bearer, to every hub any room of mine met on, and that token
// carries repo and workflow scopes: every hub held something that could write as me. Now:
//   1. my Sol asks the hub for a nonce: `POST /relay/proof { login }` → `{ nonce }`, good for five minutes, once
//   2. it writes `sol proof <nonce> for <the hub's host>` into a secret gist of mine, from my own gh
//   3. it hands the hub the gist's id: `POST /relay/proof { login, nonce, gist }` → `{ ticket, until }`. The hub reads
//      the gist with its own gh: its owner is that login, its text names this hub's nonce and one of this hub's hosts as
//      its own setting says them (SOL_HUB_HOST), never as a request's Host header says, which the sender writes: so a
//      hub that passed another hub's nonce on to me gets a gist naming itself, which the other hub refuses; with an org,
//      the member check is the hub's own gh's question too
//   4. my Sol deletes the gist, and knocks with `Bearer sol1.<…>`: the hub's own signed word for my login, for a day
// A ticket is worth something only to the hub that signed it, and writes nothing anywhere. To this machine's own hub
// (http://127.0.0.1) the token still goes as it did: it never leaves the machine.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ipBucket } from "./relay-hub.js";

export const TICKET_FOR = 24 * 60 * 60_000;
const NONCE_FOR = 5 * 60_000;
const READS_MAX = 600;             // gists the hub reads in ten minutes, across everyone: its own gh's budget
const LOGIN_READS = 5;             // of them for one login
const IP_READS = 20;               // of them from one address, when the host reads addresses (#208): a login is self-said
const WINDOW = 10 * 60_000;
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
// a nonce is the hub's own signed word (nothing kept until it is used): its body and its HMAC
export const NONCE = /^[A-Za-z0-9_-]{10,200}\.[A-Za-z0-9_-]{43}$/;
const GIST = /^[0-9a-f]{1,64}$/i;

/** the one file of a proof gist (my Sol writes it, the hub reads it: engine record/github.ts, and github.ts here) */
export const PROOF_FILE = "sol-proof.txt";

/** the words a proof gist holds: the nonce, and the host of the hub it is for */
export const proofText = (nonce: string, host: string) => `sol proof ${nonce} for ${host.toLowerCase()}`;

/** what the hub reads with its own gh (record/github.ts): a gist's owner and text as JSON, and an org's member check
 *  (a throw when not a member) */
export type ProofReads = { proofOf: (id: string) => Promise<string>; inOrg: (org: string, login: string) => Promise<string> };

// ---- the hub ----

export class Proofs {
  private used = new Map<string, number>();     // nonces redeemed, until they would have run out anyway
  private reads: number[] = [];                  // when the hub read a gist, for its budget
  private readsOf = new Map<string, number[]>(); // the same, a login
  private secret: Buffer | null = null;

  /** file: the hub's signing key, made once (32 random bytes, 0600); now: the clock (the tests') */
  constructor(private file: string, private now: () => number = Date.now) {}

  private key(): Buffer {
    if (this.secret) return this.secret;
    const read = () => { try { const k = readFileSync(this.file); return k.length >= 32 ? k.subarray(0, 32) : null; } catch { return null; } };
    let k = read();
    if (!k) {
      // none, or one too short to be a key: a new one, written whole (a temp file, then renamed), private
      const made = randomBytes(32), tmp = `${this.file}.${process.pid}.tmp`;
      try { mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 }); writeFileSync(tmp, made, { mode: 0o600 }); renameSync(tmp, this.file); }
      catch { /* a read-only place: its tickets live for this run */ }
      k = read() ?? made;
    }
    try { chmodSync(this.file, 0o600); } catch { /* not there */ }
    return (this.secret = k);
  }

  private mac(body: string) { return createHmac("sha256", this.key()).update(body).digest("base64url"); }
  private same(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

  /** a nonce for login, or null when login is not one: the hub's signed word for that login and five minutes. Nothing
   *  is kept, so asking costs the hub nothing to remember and has no limit to fill */
  nonce(login: unknown): string | null {
    if (typeof login !== "string" || !LOGIN.test(login)) return null;
    const body = Buffer.from(JSON.stringify({ l: login.toLowerCase(), u: this.now() + NONCE_FOR, r: randomBytes(8).toString("hex") })).toString("base64url");
    return `${body}.${this.mac(`nonce ${body}`)}`;
  }

  /** a gist that proves login: its ticket, or what is wrong. hosts: this hub's own, from its setting (settings.ts
   *  hubHosts), never from the request. A nonce is used once; the gist reads are budgeted, a login's and the hub's */
  async redeem(v: { login?: unknown; nonce?: unknown; gist?: unknown }, hosts: string[], org: string, r: ProofReads, ip = ""): Promise<{ ticket: string; until: number } | { error: string }> {
    const login = typeof v.login === "string" ? v.login : "", nonce = typeof v.nonce === "string" ? v.nonce : "", gist = typeof v.gist === "string" ? v.gist.trim() : "";
    const t = this.now();
    const bad = { error: "that is not a nonce this hub gave you; ask again" };
    if (!NONCE.test(nonce)) return bad;
    const [body, sig] = nonce.split(".");
    if (!this.same(sig, this.mac(`nonce ${body}`))) return bad;
    let n: { l?: unknown; u?: unknown };
    try { n = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return bad; }
    if (typeof n?.l !== "string" || n.l !== login.toLowerCase() || typeof n.u !== "number" || n.u <= t) return bad;
    for (const [k, until] of this.used) if (until <= t) this.used.delete(k);
    if (this.used.has(nonce)) return bad;
    this.used.set(nonce, n.u);   // once
    if (!GIST.test(gist)) return { error: "a gist is its id" };
    // the hub's own gh reads every gist: a budget, so nobody spends it all (a login its five, everyone the hub's 600)
    this.reads = this.reads.filter((x) => t - x < WINDOW);
    const mine = (this.readsOf.get(n.l) ?? []).filter((x) => t - x < WINDOW);
    if (mine.length >= LOGIN_READS) return { error: "too many proofs for you; wait ten minutes" };
    const at = ipBucket(ip);   // an IPv6 address by its /64 (relay-hub.ts)
    const here = at ? (this.readsOf.get(`ip ${at}`) ?? []).filter((x) => t - x < WINDOW) : [];
    if (at && here.length >= IP_READS) return { error: "too many proofs from here; wait ten minutes" };
    if (this.reads.length >= READS_MAX) return { error: "the hub is busy reading proofs; try again in a few minutes" };
    this.reads.push(t);
    for (const [k, list] of this.readsOf) if (!list.some((x) => t - x < WINDOW)) this.readsOf.delete(k);
    this.readsOf.set(n.l, [...mine, t]);
    if (at) this.readsOf.set(`ip ${at}`, [...here, t]);
    let g: { owner?: unknown; text?: unknown } | null = null;
    try { g = JSON.parse(await r.proofOf(gist)); } catch { return { error: "the hub could not read that gist" }; }
    if (typeof g?.owner !== "string" || !LOGIN.test(g.owner) || g.owner.toLowerCase() !== n.l) return { error: "that gist is not yours" };
    const text = typeof g.text === "string" ? g.text.trim() : "";
    if (!hosts.some((h) => text === proofText(nonce, h))) return { error: "that gist does not hold this hub's nonce" };
    if (org) try { await r.inOrg(org, g.owner); } catch { return { error: `GitHub says you are not in ${org}` }; }
    const until = t + TICKET_FOR;
    return { ticket: this.sign(g.owner, org, until), until };
  }

  /** this hub's word for login, in this org ("" none), until then */
  sign(login: string, org: string, until: number) {
    const body = Buffer.from(JSON.stringify({ l: login, o: org, u: until })).toString("base64url");
    return `sol1.${body}.${this.mac(body)}`;
  }

  /** the login a ticket this hub signed says, for this org, even past its hour by up to `grace` ms (#225: the cloud's
   *  watch reads an admin's alert feed with it, so the feed still arrives when the hub, which renews tickets, is down);
   *  else null. Never a way in to the hub: the hub's gate asks check() */
  checkStale(ticket: string, org: string, grace: number): string | null {
    const m = /^sol1\.([A-Za-z0-9_-]{1,400})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
    if (!m || !this.same(m[2], this.mac(m[1]))) return null;
    let t: { l?: unknown; o?: unknown; u?: unknown };
    try { t = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")); } catch { return null; }
    if (typeof t?.l !== "string" || !LOGIN.test(t.l) || t.o !== org || typeof t.u !== "number" || t.u + grace <= this.now()) return null;
    return t.l;
  }

  /** the login a ticket this hub signed says, for this org, while it lasts; else null */
  check(ticket: string, org: string): string | null {
    const m = /^sol1\.([A-Za-z0-9_-]{1,400})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
    if (!m || !this.same(m[2], this.mac(m[1]))) return null;
    let t: { l?: unknown; o?: unknown; u?: unknown };
    try { t = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")); } catch { return null; }
    if (typeof t?.l !== "string" || !LOGIN.test(t.l) || t.o !== org || typeof t.u !== "number" || t.u <= this.now()) return null;
    return t.l;
  }
}

// ---- my Sol ----

export type ProveDeps = {
  fetch: typeof fetch;
  login: () => string;                          // who I am on GitHub (team.json me.login)
  prove: (text: string) => Promise<string>;     // a secret gist of mine holding text, its id (record who.prove)
  unprove: (id: string) => Promise<unknown>;    // that gist, deleted
  now?: () => number;
};

const WAIT = 8000;
const HOUR = 60 * 60_000;
const FAILED_WAIT = 30 * 60_000;   // after a proof a hub did not take, or a hub with none: half an hour before the next
const held = new Map<string, { ticket: string; until: number }>();
const running = new Map<string, Promise<string>>();
const dropped = new Map<string, number>();
const failed = new Map<string, number>();

/** for the tests: no ticket held, none dropped, none failed */
export const resetTickets = () => { held.clear(); running.clear(); dropped.clear(); failed.clear(); };

/** my ticket for a hub (its http address, relay.ts hubHttp): the one I hold while it lasts another minute, else a
 *  proof now (one at a time a hub). "" when it cannot be had (no login, an older hub with no /proof, gh or the hub
 *  said no): the caller then knocks with nothing, and the hub's refusal says what to do */
export function ticketFor(hub: string, d: ProveDeps): Promise<string> {
  const now = (d.now ?? Date.now)(), h = held.get(hub);
  if (h && h.until - 60_000 > now) return Promise.resolve(h.ticket);
  const r = running.get(hub);
  if (r) return r;
  // a hub that refused a proof, or has no /proof, is not asked again for half an hour: every proof is a gist made and
  // deleted, and a hub that keeps refusing must not make my Sol write one on every reconnect
  if (now - (failed.get(hub) ?? -Infinity) < FAILED_WAIT) return Promise.resolve("");
  const p = prove(hub, d).then((t) => { if (t === NO) { failed.set(hub, (d.now ?? Date.now)()); return ""; } return t; }).finally(() => running.delete(hub));
  running.set(hub, p);
  return p;
}

/** a hub refused my ticket: forget it, so the next knock proves again; at most once an hour a hub, since a refusal
 *  may be for something else (a code it does not know) and every proof is a gist made and deleted */
export function refusedBy(hub: string, now = Date.now()): boolean {
  if (!held.has(hub) || now - (dropped.get(hub) ?? -Infinity) < HOUR) return false;
  dropped.set(hub, now);
  held.delete(hub);
  return true;
}

// a proof the hub answered and did not take, or a hub with no /proof: remembered (ticketFor); one that never reached the
// hub (no answer, no login yet) is tried again on the next knock
const NO = "\u0000no";

async function prove(hub: string, d: ProveDeps): Promise<string> {
  const login = d.login();
  let host = "";
  try { host = new URL(hub).host; } catch { return ""; }
  if (!LOGIN.test(login) || !host) return "";
  const post = (body: object) => d.fetch(`${hub}/proof`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(WAIT) }).catch(() => null);
  const asked = await post({ login });
  if (!asked) return "";
  if (!asked.ok) return NO;
  const nonce = (await asked.json().catch(() => null) as { nonce?: unknown } | null)?.nonce;
  if (typeof nonce !== "string" || !NONCE.test(nonce)) return NO;
  let gist = "";
  try { gist = String(await d.prove(proofText(nonce, host))).trim(); } catch { return ""; }
  if (!GIST.test(gist)) return "";
  try {
    const got = await post({ login, nonce, gist });
    if (!got) return "";
    if (!got.ok) return NO;
    const v = await got.json().catch(() => null) as { ticket?: unknown; until?: unknown } | null;
    if (typeof v?.ticket !== "string" || !v.ticket.startsWith("sol1.")) return NO;
    const until = typeof v.until === "number" ? v.until : (d.now ?? Date.now)() + TICKET_FOR;
    held.set(hub, { ticket: v.ticket, until });
    return v.ticket;
  } finally { void Promise.resolve().then(() => d.unprove(gist)).catch(() => {}); }   // the gist goes either way
}
