// The hub under load (#223, S6a of #168; CAPACITY.md "讓它不爆" and the four lights; MASTER §6 B1-B5). Pure parts the
// hub and its host share, loading nothing but node's own:
// - Bucket: a token bucket, the one shape of every rate here (a person's messages, a stream's lines).
// - Load: the four lights from real counters, each a share of its most (connections, CPU, the event loop's delay,
//   messages and bytes sent a second, memory). Yellow slows streams, orange queues new connections, red is chat only.
//   It steps up after a few bad seconds and down after many good ones, so it does not flicker; S7's admin may force one.
// - Queue: the numbers handed to new connections while the light is orange or red. The queue lives on the user's side:
//   the hub keeps two counters and a key, never a list, and a number is signed so nobody writes themselves a better one.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const LIGHTS = ["green", "yellow", "orange", "red"] as const;
export type Light = (typeof LIGHTS)[number];
export const rank = (l: Light) => LIGHTS.indexOf(l);

/** a token bucket: `per` a second, at most `burst` saved up. take() spends one, or says how long until one is there */
export class Bucket {
  private tokens: number;
  private at: number;
  constructor(private per: number, private burst: number, private now: () => number = Date.now) { this.tokens = burst; this.at = now(); }
  private fill() { const t = this.now(); this.tokens = Math.min(this.burst, this.tokens + ((t - this.at) / 1000) * this.per); this.at = t; }
  /** one taken: 0. None there: the ms until one is (nothing taken) */
  take(n = 1): number {
    this.fill();
    if (this.tokens >= n) { this.tokens -= n; return 0; }
    return Math.ceil(((n - this.tokens) / this.per) * 1000);
  }
  /** another rate from now on (a light changed), what is saved kept within the new burst */
  set(per: number, burst = this.burst) { this.fill(); this.per = per; this.burst = burst; this.tokens = Math.min(this.tokens, burst); }
  /** full again and idle long enough to forget (a map of buckets drops these) */
  idle(): boolean { this.fill(); return this.tokens >= this.burst; }
}

/** the counters the lights are read from, as the host samples them each second */
export type Sample = {
  conns: number;       // open sockets
  cpu: number;         // this process's CPU over the last second, 1 = one core busy (Node runs on one)
  lag: number;         // the event loop's mean delay over the last second, ms
  msgs: number;        // messages sent a second, and the stream lines the light held back (what is wanted)
  bytes: number;       // bytes the same
  mem: number;         // resident memory, bytes
};
/** the most of each, where the light is red (memory: where its red begins at 85%) */
export type Maxes = { conns: number; cpu: number; lag: number; msgs: number; bytes: number; mem: number };

/** CAPACITY.md: yellow at 70% (CPU 60%), orange 85%, red 95%; memory red at 85% */
export const AT = { yellow: 0.7, orange: 0.85, red: 0.95 };
const UP_AFTER = 3, DOWN_AFTER = 30, DOWN_MARGIN = 0.1;

/** each counter's share of its most (pure) */
export function shares(s: Sample, m: Maxes): Record<keyof Sample, number> {
  const r = (v: number, max: number) => (max > 0 && Number.isFinite(max) ? v / max : 0);
  return { conns: r(s.conns, m.conns), cpu: r(s.cpu, m.cpu), lag: r(s.lag, m.lag), msgs: r(s.msgs, m.msgs), bytes: r(s.bytes, m.bytes), mem: r(s.mem, m.mem) };
}

/** the light one sample says, and which counter said it (pure). `margin` lowers every line (stepping down asks a
 *  sample to be under each line by that much) */
export function lightOf(s: Sample, m: Maxes, margin = 0): { light: Light; by: keyof Sample | "" } {
  const sh = shares(s, m);
  let light: Light = "green", by: keyof Sample | "" = "";
  const at = (k: keyof Sample, l: Light) => { if (rank(l) > rank(light)) { light = l; by = k; } };
  for (const k of Object.keys(sh) as (keyof Sample)[]) {
    const v = sh[k] + margin;
    if (k === "mem") { if (v >= 0.85) at(k, "red"); else if (v >= AT.yellow) at(k, "yellow"); continue; }
    if (v >= AT.red) at(k, "red");
    else if (v >= AT.orange) at(k, "orange");
    else if (v >= (k === "cpu" ? 0.6 : AT.yellow)) at(k, "yellow");
  }
  return { light, by };
}

/** the lights over time: up after UP_AFTER samples at or past a light, down one step after DOWN_AFTER (30) samples
 *  clearly under it. force: a light S7's admin set by hand (null: the counters again) */
export class Load {
  light: Light = "green";
  by: keyof Sample | "" = "";
  last: Sample = { conns: 0, cpu: 0, lag: 0, msgs: 0, bytes: 0, mem: 0 };
  since = Date.now();
  private forced: Light | null = null;
  private least: Light | null = null;   // a floor (#225: an AI's slow): the light is never under it, and still rises
  private counted: Light = "green";    // what the counters alone say
  private ups = 0;
  private downs = 0;
  private subs = new Set<(l: Light) => void>();
  constructor(public maxes: Maxes, private now: () => number = Date.now) { this.since = now(); }

  onChange(f: (l: Light) => void) { this.subs.add(f); return () => { this.subs.delete(f); }; }

  /** one second's counters */
  sample(s: Sample) {
    this.last = s;
    if (this.forced) return;
    const seen = lightOf(s, this.maxes);
    if (rank(seen.light) > rank(this.counted)) {
      this.downs = 0;
      if (++this.ups >= UP_AFTER) { this.ups = 0; this.count(seen.light, seen.by); }
      return;
    }
    this.ups = 0;
    const calm = lightOf(s, this.maxes, DOWN_MARGIN).light;
    if (rank(calm) < rank(this.counted)) { if (++this.downs >= DOWN_AFTER) { this.downs = 0; this.count(LIGHTS[rank(this.counted) - 1], seen.by); } }
    else this.downs = 0;
  }

  /** the counters' light, and the light shown: never under the floor */
  private count(l: Light, by: keyof Sample | "") { this.counted = l; this.set(this.floored(l), by); }
  private floored(l: Light): Light { return this.least && rank(this.least) > rank(l) ? this.least : l; }

  /** a floor, or none (#225: the cloud's `slow`): the light is at least this, and the counters may still raise it */
  floor(l: Light | null) {
    this.least = l;
    if (!this.forced) this.set(this.floored(this.counted), this.by);
  }
  get floorLight() { return this.least; }

  /** a light by hand, or null for the counters' (S7) */
  force(l: Light | null) {
    this.forced = l; this.ups = this.downs = 0;
    const was = this.light;
    if (l) this.set(l, "");
    else { this.counted = this.light; this.set(this.floored(this.counted), this.by); }   // the counters take it from here, stepping down as they always did, never under a floor
    if (this.light === was) for (const f of this.subs) f(this.light);   // forced or not changes who decides: always told (the re-check)
  }
  get isForced() { return this.forced !== null; }

  private set(l: Light, by: keyof Sample | "") {
    if (l === this.light) return;
    this.light = l; this.by = by; this.since = this.now();
    for (const f of this.subs) f(l);
  }
}

/** the counters of this process, read once a second: CPU and the event loop's delay from node itself, memory as RSS.
 *  conns, msgs and bytes come from the hub (`read`; `held`: the stream lines the light held back). Stopped by what it
 *  returns */
export async function sampleEvery(load: Load, read: () => { conns: number; msgs: number; bytes: number; held?: { msgs: number; bytes: number } }, ms = 1000, entry?: Load): Promise<() => void> {
  const { monitorEventLoopDelay } = await import("node:perf_hooks");
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  let cpu = process.cpuUsage(), at = process.hrtime.bigint(), was: ReturnType<typeof read> = read();
  const t = setInterval(() => {
    const c = process.cpuUsage(cpu), now = process.hrtime.bigint(), wall = Number(now - at) / 1000;   // µs
    cpu = process.cpuUsage(); at = now;
    const n = read(), secs = wall / 1e6 || 1;
    const base = { conns: n.conns, cpu: (c.user + c.system) / (wall || 1), lag: Number.isFinite(h.mean) ? h.mean / 1e6 : 0, mem: process.memoryUsage.rss() };
    const sent = { msgs: Math.max(0, n.msgs - was.msgs) / secs, bytes: Math.max(0, n.bytes - was.bytes) / secs };
    const held = { msgs: Math.max(0, (n.held?.msgs ?? 0) - (was.held?.msgs ?? 0)) / secs, bytes: Math.max(0, (n.held?.bytes ?? 0) - (was.held?.bytes ?? 0)) / secs };
    // the streams' light reads what is wanted (sent and held back); the door's (`entry`: the queue, new rooms) reads only
    // what is really sent, so streams held back alone never keep people waiting outside (the review)
    load.sample({ ...base, msgs: sent.msgs + held.msgs, bytes: sent.bytes + held.bytes });
    entry?.sample({ ...base, ...sent });
    was = n;
    h.reset();
  }, ms);
  t.unref();
  return () => { clearInterval(t); h.disable(); };
}

/** the queue's numbers (CAPACITY "橘燈"): while it is open, a new connection with no number, or one not yet called, is
 *  handed one and told to come back; `rate` numbers are called a second. When the light goes back under orange the
 *  queue closes and every number is called at once. A number is `q1.<n>.<mac>` */
export class Queue {
  private key = randomBytes(32);
  private holders = new Map<string, number>();   // each person's place in this queue (cleared when it closes)
  private used = new Set<number>();   // numbers already let in: each lets in one connection (the review: never a pass)
  issued = 0;
  served = 0;
  open = false;
  private t: ReturnType<typeof setInterval> | null = null;
  constructor(public rate = 20, private tickMs = 1000) {}

  /** the light said open (orange, red) or closed */
  set(open: boolean) {
    if (open === this.open) return;
    this.open = open;
    // closed: everyone is in, and every number handed out is void (a new key), so an old number never jumps a later queue
    if (!open) { this.served = this.issued = 0; this.used.clear(); this.holders.clear(); this.key = randomBytes(32); if (this.t) clearInterval(this.t); this.t = null; return; }
    this.t = setInterval(() => this.tick(), this.tickMs);
    this.t.unref?.();
  }
  /** one second: `rate` more numbers called */
  tick() { this.served = Math.min(this.issued, this.served + this.rate); }

  private mac(n: number) { return createHmac("sha256", this.key).update(String(n)).digest("base64url").slice(0, 22); }
  private numberOf(ticket: string): number | null {
    const m = /^q1\.(\d{1,12})\.([A-Za-z0-9_-]{22})$/.exec(ticket);
    if (!m) return null;
    const a = Buffer.from(m[2]), b = Buffer.from(this.mac(Number(m[1])));
    return a.length === b.length && timingSafeEqual(a, b) ? Number(m[1]) : null;
  }

  /** may a knock in? `ticket`: the number it brings ("" none). In, or its number, how many are before it, and the
   *  seconds to wait before it comes back */
  admit(ticket: string, who = ""): { in: true } | { in: false; ticket: string; ahead: number; wait: number } {
    if (!this.open) return { in: true };
    let n = this.numberOf(ticket);
    if (n !== null && this.used.has(n)) n = null;   // spent: a new place at the back
    if (n !== null && n <= this.served) { this.used.add(n); return { in: true }; }
    // one place a person: knocking again without the number gets the same one back, so nobody pushes everyone else
    // to the back by knocking many times (the review)
    const had = who ? this.holders.get(who.toLowerCase()) : undefined;
    if (n === null && had !== undefined && !this.used.has(had)) {
      n = had;
      if (n <= this.served) { this.used.add(n); return { in: true }; }
    }
    if (n === null) { n = ++this.issued; if (who) this.holders.set(who.toLowerCase(), n); }
    ticket = `q1.${n}.${this.mac(n)}`;
    const ahead = Math.max(0, n - this.served - 1);
    return { in: false, ticket, ahead, wait: Math.max(1, Math.min(60, Math.ceil((ahead + 1) / Math.max(1, this.rate)))) };
  }

  /** how many hold a number not yet called */
  waiting() { return Math.max(0, this.issued - this.served); }
  stop() { if (this.t) clearInterval(this.t); this.t = null; }
}
