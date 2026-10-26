// On-call, this engine's side (#225, S7 of #168; MASTER §7): for Frank and Marco, the two admins of Sol's cloud, the
// cloud's alerts arrive as pings of kind `alert`, the existing ping path (pings.ts: kept for the agent, the `pings`
// tool, a card on the face). They do not come over the hub's relay: the cloud's watch (sol/cloud/src/ops.ts) runs apart
// from the hub it watches, and this engine pulls its feed every minute over the tailnet, with this Sol's cloud ticket
// (the watch lets in only an admin's ticket on that admin's tailnet login). So an alert about the hub still arrives
// when the hub is the trouble, and in whatever room this Sol is in.
// On only where SOL_CLOUD_WATCH says where the watch is (`tailscale serve` on the box, e.g.
// https://sol-cloud-1.<tailnet>.ts.net:8443); everyone else's Sol never asks. When the watch does not answer for five
// minutes, that itself is said once, as an alert from this Sol; and again when it answers.
// The agent's tools (work/tools.ts): cloud_alerts reads, cloud_propose proposes an action for a person to confirm in the
// admin, cloud_slow is the one action an AI may take alone (the streams slowed for at most 30 minutes; it undoes itself).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Ping } from "./pings.js";

export const POLL_MS = 60_000;
export const SILENT_AFTER = 5;           // polls in a row with no answer before it is said
export const FRESH_FOR = 2 * 3600_000;   // the first time, alerts older than this are not brought up again

export type OnCallDeps = {
  watch: string;                          // the watch's base address
  ticket: () => Promise<string>;          // this Sol's ticket on the cloud ("" none)
  fetch: typeof fetch;
  now: () => number;
  deliver: (p: Ping) => void;             // into the ping path
  file: string;                           // where the last alert seen is kept
};

type Feed = { alerts: { id: number; at: number; key: string; kind: string; text: string }[] };

/** an alert of the feed as a ping (pure) */
export function alertPing(a: Feed["alerts"][number]): Ping {
  const mark = a.kind === "recovered" ? "recovered" : a.kind === "action" ? "done" : a.kind === "reminder" ? "still" : "alert";
  const line = `cloud ${mark}: ${a.text.replace(/^(still|recovered|worse): /, "")}`.replace(/\s+/g, " ").slice(0, 300);
  // the time in the id too: a feed restored from a backup reuses ids, and a kept ping with a known id is dropped
  return { id: `alert-${a.at}-${a.id}`, kind: "alert", from: { login: "sol-cloud", agent: false }, line, at: a.at };
}

export class OnCall {
  private last = -1;
  private misses = 0;
  private said = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private d: OnCallDeps) {
    try { const v = JSON.parse(readFileSync(d.file, "utf8")); if (Number.isInteger(v.last)) this.last = v.last; } catch { /* first time */ }
  }

  private keep() {
    try { mkdirSync(dirname(this.d.file), { recursive: true, mode: 0o700 }); writeFileSync(`${this.d.file}.tmp`, JSON.stringify({ last: this.last }) + "\n", { mode: 0o600 }); renameSync(`${this.d.file}.tmp`, this.d.file); } catch { /* read-only: asked again */ }
  }

  /** `open`: the feed, asked with the last ticket held when no fresh one comes (a ticket is renewed by the hub, and the
   *  feed must arrive when the hub is what is down; the watch takes an admin's ticket past its hour for the feed) */
  private heldFile() { return `${this.d.file}.ticket`; }
  private held = (() => { try { return readFileSync(`${this.d.file}.ticket`, "utf8").trim(); } catch { return ""; } })();   // 0600 beside oncall.json: a Sol restarted while the hub is down still reads the feed
  private async call(path: string, body?: unknown, open = false): Promise<{ status: number; v: Record<string, unknown> } | null> {
    let t = await this.d.ticket().catch(() => "");
    if (t && t !== this.held) { this.held = t; try { mkdirSync(dirname(this.heldFile()), { recursive: true, mode: 0o700 }); writeFileSync(this.heldFile(), t + "\n", { mode: 0o600 }); } catch { /* memory only */ } }
    else if (open) t = this.held;   // the feed takes a ticket past its hour: the last one this Sol had
    if (!t && !open) return null;
    try {
      const r = await this.d.fetch(this.d.watch.replace(/\/+$/, "") + path, { method: body ? "POST" : "GET", headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
      return { status: r.status, v: await r.json().catch(() => ({})) as Record<string, unknown> };
    } catch { return null; }
  }

  /** one pull: the new alerts made pings; the count delivered */
  async poll(): Promise<number> {
    const r = await this.call(`/agent/feed?after=${Math.max(0, this.last)}`, undefined, true);
    if (!r || r.status !== 200) {
      if (++this.misses === SILENT_AFTER && !this.said) {
        this.said = true;
        this.d.deliver({ id: `alert-silent-${this.d.now()}`, kind: "alert", from: { login: "sol-cloud", agent: false }, line: `cloud alert: the cloud's watch has not answered for ${SILENT_AFTER} minutes${r ? ` (it says ${r.status})` : ""}: the box, its tailnet or sol-ops may be down. Discord #builds still hears from the box if it is up; ssh root@sol-cloud-1 'systemctl status sol-ops sol-cloud'`, at: this.d.now() });
      }
      return 0;
    }
    this.misses = 0;
    if (this.said) { this.said = false; this.d.deliver({ id: `alert-back-${this.d.now()}`, kind: "alert", from: { login: "sol-cloud", agent: false }, line: "cloud recovered: the cloud's watch answers again", at: this.d.now() }); }
    // the watch's feed started over (restored from a backup): from its start again, old ones not brought up
    const max = Number((r.v as { max?: unknown }).max);
    if (Number.isInteger(max) && max < this.last) this.last = -1;
    const first = this.last < 0;
    let n = 0, page: Feed["alerts"] = (r.v as Feed).alerts ?? [];
    // every page to the end, so a first pull (or a long absence) never hands old ones over later as new (the review)
    for (let pages = 0; ; pages++) {
      for (const a of page) {
        if (!Number.isInteger(a.id) || a.id <= this.last) continue;
        this.last = a.id;
        if (first && this.d.now() - a.at > FRESH_FOR) continue;
        this.d.deliver(alertPing(a)); n++;
      }
      if (page.length < 100 || pages >= 50) break;
      const more = await this.call(`/agent/feed?after=${Math.max(0, this.last)}`, undefined, true);
      if (!more || more.status !== 200) break;
      page = (more.v as Feed).alerts ?? [];
    }
    if (this.last < 0) this.last = 0;
    this.keep();
    return n;
  }

  start(every = POLL_MS) {
    if (this.timer) return;
    void this.poll().catch(() => {});
    this.timer = setInterval(() => { void this.poll().catch(() => {}); }, every);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** cloud_alerts: the light, what is open, what waits for a person, as lines */
  async state(): Promise<string> {
    const r = await this.call("/agent/state");
    if (!r) return "the cloud's watch does not answer (or this Sol has no cloud ticket)";
    if (r.status !== 200) return `the cloud's watch said ${r.status}: ${String(r.v.error ?? "")}`;
    const v = r.v as { health?: { ok?: boolean; light?: string; forced?: boolean; now?: { conns?: number; people?: number } } | null; flags?: { signupsPaused?: boolean; roomsPaused?: boolean; light?: string | null }; open?: { key: string; since: number; text: string }[]; proposals?: { id: number; action: string; target: string; why: string; who: string }[] };
    const h = v.health;
    const lines = [h?.ok ? `the hub is up, light ${h.light}${h.forced ? " (by hand)" : ""}, ${h.now?.people ?? "?"} people on` : "the hub is not answering",
      `sign-ups ${v.flags?.signupsPaused ? "paused" : "open"}, new rooms ${v.flags?.roomsPaused ? "paused" : "open"}`,
      ...(v.open?.length ? ["open alerts:", ...v.open.map((a) => `- ${a.key}: ${a.text}`)] : ["no open alerts"]),
      ...(v.proposals?.length ? ["proposals waiting for a person:", ...v.proposals.map((p) => `- #${p.id} ${p.action} ${p.target} (${p.who}): ${p.why}`)] : [])];
    return lines.join("\n");
  }

  /** cloud_propose: an action for a person to confirm in the admin */
  async propose(action: string, target: string, why: string): Promise<string> {
    const r = await this.call("/agent/propose", { action, target, why });
    if (!r) return "not proposed: the cloud's watch does not answer";
    return r.status === 200 ? `proposed as #${String(r.v.id)}: a person confirms or refuses it in the admin, and both admins were told` : `not proposed: ${String(r.v.error ?? r.status)}`;
  }

  /** cloud_slow: the streams slowed (yellow) for at most 30 minutes, at once */
  async slow(minutes: number, why: string): Promise<string> {
    const r = await this.call("/agent/slow", { minutes, why });
    if (!r) return "not done: the cloud's watch does not answer";
    return `${r.status === 200 ? "done" : "not done"}: ${String(r.v.result ?? r.v.error ?? r.status)}`;
  }
}

let mine: OnCall | null = null;
/** this engine's on-call, when SOL_CLOUD_WATCH is set; null otherwise */
export const onCall = () => mine;
export function startOnCall(d: OnCallDeps): OnCall { mine?.stop(); mine = new OnCall(d); mine.start(); return mine; }
const OFF = "on-call is off on this Sol (SOL_CLOUD_WATCH is not set): only the cloud's two admins have it";
export const onCallText = { off: OFF };
