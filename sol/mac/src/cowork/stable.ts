// Ship (#33, design/together/3-ship/PRD.md): the face's side of stable. One store per page, on the page's one socket
// (socket.ts link, shared with everything else; nothing here is fenced). It holds:
//   the offer   team.stable { sha, tag, by, mine, behind } from the engine (a stable the team stamped, this checkout
//               behind it); asked once on every link up (team.stable.get), so a window opened later still learns it
//   Later       a sha put off on this Mac: localStorage, so the notch and the window (same app, same storage) agree,
//               the `storage` event carrying a Later from one to the other; it lasts 12 hours, then the offer is back
//   the asks    team.stamp / team.stables / team.update with a rid, answered by the same type and rid
// Under ?dev=ship (dev builds only) nothing is sent: the offer, the five stables and the answers are made up here, for
// the shots and for looking at it without an engine.
import { useEffect, useSyncExternalStore } from "react";
import { link, type Link } from "../socket";
import { ENGINE } from "../useEngine";

export type Offer = { sha: string; tag: string; by: string; mine: string; behind: boolean };
export type StableTag = { tag: string; sha: string; at: string };
export type Stables = { tags: StableTag[]; stable: string | null; head: { sha: string; short: string; branch: string } | null };
export type StampDone = { ok: true; sha: string; tag: string; recorded?: string; note?: string; beta?: string } | { ok?: false; error: string };
// what Update is doing, shown in place of the offer's line: the words, and whether it went wrong (then only Later)
export type Doing = { said: string; failed?: boolean; updating?: boolean } | null;

const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
export const DEV_SHIP = dev?.get("dev") === "ship";
const LATER_KEY = "sol.stable.later", LATER_MS = 12 * 3600_000;

type State = { offer: Offer | null; doing: Doing; later: Record<string, number> };
let S: State = { offer: null, doing: null, later: readLater() };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { S = { ...S, ...p }; for (const f of [...subs]) f(); };

function readLater(): Record<string, number> {
  try {
    const o = JSON.parse(localStorage.getItem(LATER_KEY) || "{}");
    const now = Date.now(), out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === "number" && v > now) out[k] = v;
    return out;
  } catch { return {}; }
}

// ---- the link: one subscription per page, made the first time anything here is used ----
let L: Link | null = null;
const waits = new Map<string, (m: any) => void>();
function wire(): Link | null {
  if (DEV_SHIP || typeof WebSocket === "undefined") return null;
  if (L) return L;
  const l = link(ENGINE);
  L = l;
  l.on((m) => {
    if (!m || typeof m.type !== "string" || !m.type.startsWith("team.")) return;
    const w = m.rid != null ? waits.get(String(m.rid)) : undefined;
    if (w) { waits.delete(String(m.rid)); w(m); }
    if (m.type === "team.stable") take(m);
  });
  l.onLink((up) => { if (up) l.send({ type: "team.stable.get" }); });
  window.addEventListener("storage", (e) => { if (e.key === LATER_KEY) set({ later: readLater() }); });
  return l;
}

function take(m: any) {
  if (typeof m.sha !== "string" || !/^[0-9a-f]{40}$/.test(m.sha)) { if (!S.doing?.updating) set({ offer: null, doing: null }); return; }
  const offer: Offer = { sha: m.sha, tag: String(m.tag ?? ""), by: String(m.by ?? ""), mine: String(m.mine ?? ""), behind: !!m.behind };
  // a new stable clears the words of the last update; the same one (answered) keeps them for a moment
  set({ offer, doing: S.offer?.sha === offer.sha ? S.doing : null });
}

let n = 0;
type Answer<T> = T & { error?: string };
/** one ask of the engine, answered by its type and rid; a timeout or a closed socket answers { error } */
export function teamAsk<T = Record<string, unknown>>(type: string, body: object = {}, ms = 30_000): Promise<Answer<T>> {
  const l = wire();
  const no = (error: string) => ({ error }) as Answer<T>;
  if (!l) return Promise.resolve(no("Sol is not connected"));
  const rid = `ship-${Date.now().toString(36)}-${++n}`;
  return new Promise((res) => {
    const t = window.setTimeout(() => { waits.delete(rid); res(no("no answer from Sol")); }, ms);
    waits.set(rid, (m) => { window.clearTimeout(t); res(m); });
    if (!l.send({ type, rid, ...body })) { window.clearTimeout(t); waits.delete(rid); res(no("Sol is not connected")); }
  });
}

// ---- dev: a made-up team, so every state can be looked at (and shot) without an engine ----
const DEV_TAGS: StableTag[] = [
  { tag: "stable-20261020-2214", sha: "7a53b17e2c4d9f1a0b6c3e8d5f2a7b9c1d4e6f80", at: "2026-10-20T22:14:00" },
  { tag: "stable-20261019-1830", sha: "9f2a197b3e5d7c1a4f6b8e0d2c9a5f7b3e1d6c42", at: "2026-10-19T18:30:00" },
  { tag: "stable-20261018-0912", sha: "7def65e1a3c5b7d9f0e2a4c6b8d1f3e5a7c9b2d4", at: "2026-10-18T09:12:00" },
  { tag: "stable-20261016-2140", sha: "3041066c2e4a6b8d0f1c3e5a7b9d2f4c6e8a1b3d", at: "2026-10-16T21:40:00" },
  { tag: "stable-20261015-1105", sha: "5b1e9d3a7c2f4e6b8d0a1c3e5f7b9d2a4c6e8f10", at: "2026-10-15T11:05:00" },
];
const DEV_HEAD = { sha: "2dc6b98a1b2c3d4e5f60718293a4b5c6d7e8f901", short: "2dc6b98", branch: "main" };
const DEV_OFFER: Offer = { sha: DEV_TAGS[0].sha, tag: DEV_TAGS[0].tag, by: "frank", mine: DEV_TAGS[1].sha, behind: true };
if (DEV_SHIP && dev?.get("offer") !== "0") S = { ...S, offer: DEV_OFFER, later: {} };
let devStable = DEV_TAGS[0].sha;
const pause = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

// ---- the asks ----
export async function stamp(to?: string): Promise<StampDone> {
  if (DEV_SHIP) {
    await pause(Number(dev?.get("wait") ?? 1400));
    const refuse = dev?.get("refuse");
    if (refuse) return { error: refuse };
    if (to) { devStable = DEV_TAGS.find((t) => t.tag === to)?.sha ?? devStable; return { ok: true, sha: devStable, tag: to }; }
    return { ok: true, sha: DEV_HEAD.sha, tag: "stable-20261020-2300", recorded: "a comment on #33" };
  }
  const r = await teamAsk<{ ok?: boolean; sha?: string; tag?: string; recorded?: string; note?: string; beta?: string }>("team.stamp", to ? { to } : {}, 300_000);
  if (r.error || !r.ok || !r.sha || !r.tag) return { error: r.error || "no reason given" };
  return { ok: true, sha: r.sha, tag: r.tag, recorded: r.recorded, note: r.note, beta: r.beta };
}

export async function stables(): Promise<Stables & { error?: string }> {
  if (DEV_SHIP) return { tags: DEV_TAGS, stable: devStable, head: DEV_HEAD };
  const r = await teamAsk<Partial<Stables>>("team.stables", {}, 30_000);
  return { tags: Array.isArray(r.tags) ? r.tags : [], stable: r.stable ?? null, head: r.head ?? null, error: r.error };
}

/** Update: fast-forward this checkout to the offered stable; the engine renews itself after when its code changed */
export async function update(): Promise<void> {
  const o = S.offer;
  if (!o || S.doing?.updating) return;
  set({ doing: { said: "updating to the new stable…", updating: true } });
  const r: Answer<{ ok?: boolean; renews?: boolean }> = DEV_SHIP
    ? (await pause(Number(dev?.get("wait") ?? 1600)), dev?.get("fail") ? { error: dev.get("fail")! } : { ok: true, renews: true })
    : await teamAsk<{ ok?: boolean; renews?: boolean }>("team.update", {}, 180_000);
  if (r.error || !r.ok) { set({ doing: { said: `could not update: ${r.error || "no reason given"}`, failed: true } }); return; }
  set({ doing: { said: r.renews ? "updated; Sol renews in a moment" : "updated to the new stable" } });
  window.setTimeout(() => { if (S.offer?.sha === o.sha && !S.doing?.updating) set({ offer: { ...o, behind: false }, doing: null }); }, 6000);
}

/** Later: this stable is put off on this Mac for 12 hours (both the notch and the window) */
export function later(sha = S.offer?.sha) {
  if (!sha) return;
  const l = { ...readLater(), [sha]: Date.now() + LATER_MS };
  try { localStorage.setItem(LATER_KEY, JSON.stringify(l)); } catch { /* private mode */ }
  set({ later: l, doing: null });
}

export type Shown = Offer & { doing: Doing };
/** the offer to show now: behind it, and not put off; with what Update is doing, if anything */
export function shown(s: State = S): Shown | null {
  const o = s.offer;
  if (!o) return null;
  if (s.doing) return { ...o, doing: s.doing };
  if (!o.behind || (s.later[o.sha] ?? 0) > Date.now()) return null;
  return { ...o, doing: null };
}

export function useStable(): Shown | null {
  useEffect(() => { wire(); }, []);
  const s = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => S);
  return shown(s);
}
