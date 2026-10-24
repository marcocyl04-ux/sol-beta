// Hand (#34, design/together/4-hand/PRD.md, PROTOCOL.md round 21): the face's side of a hand. One store per page, on
// the page's one socket (socket.ts link, the one Ship's stable.ts asks on too). It holds:
//   the record   team.hands { hands, pending }: the hands lines read from the issues' comments, and what is handed to
//                me now; asked once on every link up (team.hands.get), pushed by the engine after every change
//   a hand heard team.handed: the line over Cowork's stage and the notch card; a review asked is told once, not kept
//   Later        a hand put off on this Mac: localStorage `sol.hand.later` (id -> the hand's time, so a new hand on the
//                same issue shows again), shared by the notch and the window through the `storage` event
//   Passing      the notch cannot type a line: its Pass writes `sol.hand.passing`, and the window's line opens its field
// Under ?dev=hand (dev builds only) nothing is sent: the record, two hands to me and the answers are made up here.
import { useEffect, useSyncExternalStore } from "react";
import { link, type Link } from "../socket";
import { ENGINE } from "../useEngine";
import { teamAsk } from "./stable";
import type { Sign } from "./useTeam";

export type How = "hand" | "taken" | "passed" | "review";
export type HandRow = { repo: string; number: number; at: string; how: How; from: string; to: string; line?: string; brief?: string; branch?: string; url?: string; sign: Sign };
export type Handed = { id: string; from: string; repo: string; issue: number; title: string; brief: string; branch: string; review?: boolean; at?: string };
// what an answer is doing, shown in place of the hand's line: the words, and whether it went wrong
export type Doing = { said: string; taking?: boolean; failed?: boolean };
export type HandAsk = { repo: string; to: string; issue?: number; pr?: number; sessionId?: string; brief?: string; review?: boolean };

const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
export const DEV_HAND = dev?.get("dev") === "hand";
const LATER_KEY = "sol.hand.later", PASSING_KEY = "sol.hand.passing";

type State = {
  hands: HandRow[]; pending: Handed[]; reviews: Handed[];
  later: Record<string, string>; passing: string; doing: Record<string, Doing>;
  said: { text: string; failed?: boolean; at: number } | null;   // what my own last hand did
};
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { if (v === "" || v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private */ } };
let S: State = { hands: [], pending: [], reviews: [], later: read(LATER_KEY, {}), passing: read(PASSING_KEY, ""), doing: {}, said: null };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { S = { ...S, ...p }; for (const f of [...subs]) f(); };

// ---- the link ----
let L: Link | null = null;
function wire(): Link | null {
  if (DEV_HAND || typeof WebSocket === "undefined") return null;
  if (L) return L;
  const l = link(ENGINE);
  L = l;
  l.on((m) => {
    if (m?.type === "team.hands" && Array.isArray(m.hands)) set({ hands: m.hands, pending: Array.isArray(m.pending) ? m.pending : [] });
    else if (m?.type === "team.handed" && typeof m.id === "string") heard(m as Handed);
  });
  l.onLink((up) => { if (up) l.send({ type: "team.hands.get" }); });
  window.addEventListener("storage", (e) => {
    if (e.key === LATER_KEY) set({ later: read(LATER_KEY, {}) });
    if (e.key === PASSING_KEY) set({ passing: read(PASSING_KEY, "") });
  });
  return l;
}
function heard(h: Handed) {
  if (h.review) { set({ reviews: [h, ...S.reviews.filter((r) => r.id !== h.id)] }); return; }
  set({ pending: [{ at: new Date().toISOString(), ...h }, ...S.pending.filter((p) => p.id !== h.id)] });
}

// ---- dev: a made-up record and two hands to me, so every state can be looked at (and shot) without an engine ----
const R = "marcocyl04-ux/sol-dev";
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const DEV_ROWS: HandRow[] = [
  { repo: R, number: 34, at: ago(4), how: "hand", from: "frank", to: "marco", brief: "the record under the columns is in; the notch card is yours", branch: "frank/34-hand", sign: { login: "frank", agent: false } },
  { repo: R, number: 42, at: ago(70), how: "review", from: "marco", to: "frank", brief: "review asked", branch: "marco/together-see", sign: { login: "marco", agent: false } },
  { repo: R, number: 36, at: ago(190), how: "passed", from: "isaac", to: "marco", line: "the memory part is frank's, not mine", sign: { login: "isaac", agent: false } },
  { repo: R, number: 35, at: ago(1500), how: "taken", from: "marco", to: "isaac", sign: { login: "isaac", agent: false } },
];
const DEV_PENDING: Handed[] = [
  { id: `${R}#34`, from: "frank", repo: R, issue: 34, title: "Hand: give a session, issue or PR to a teammate", brief: "#34 Hand\n\nthe plan:\n- [x] the record under the columns\n- [ ] the notch card\n\nwhere it stands:\nThe record reads from the comments; the notch card is yours.", branch: "frank/34-hand", at: ago(4) },
  { id: `${R}#36`, from: "isaac", repo: R, issue: 36, title: "Share: product memory, designs and decisions", brief: "the memory part is frank's, not mine", branch: "", at: ago(190) },
];
if (DEV_HAND) S = { ...S, hands: DEV_ROWS, pending: DEV_PENDING, later: dev?.get("later") === "all" ? Object.fromEntries(DEV_PENDING.map((p) => [p.id, p.at!])) : dev?.get("later") === "1" ? { [`${R}#34`]: DEV_PENDING[0].at! } : {}, passing: dev?.get("passing") === "1" ? `${R}#34` : "" };
const pause = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

// ---- the asks ----
/** hand an issue, a session or a PR (review: ask for a review); the engine writes the record, then relays the word */
export async function handTo(a: HandAsk): Promise<{ ok?: boolean; error?: string; note?: string }> {
  const what = a.review ? `review of #${a.pr} asked of ${a.to}` : `handed ${a.sessionId ? "the session" : `#${a.issue ?? a.pr}`} to ${a.to}`;
  set({ said: { text: `${a.review ? "asking" : "handing"} ${a.to}…`, at: Date.now() } });
  const r = DEV_HAND
    ? (await pause(900), { ok: true, issue: a.issue ?? a.pr ?? 34, relayed: true })
    : await teamAsk<{ ok?: boolean; issue?: number; relayed?: boolean; note?: string }>("team.hand", a, 120_000);
  if (r.error || !r.ok) { set({ said: { text: `not handed: ${r.error || "no reason given"}`, failed: true, at: Date.now() } }); return { error: r.error || "no reason given" }; }
  const where = r.issue ? `written on #${r.issue}` : "written";
  set({ said: { text: r.note ? `${what} · ${r.note}` : `${what} · ${where}`, at: Date.now() } });
  if (DEV_HAND) set({ hands: [{ repo: a.repo, number: r.issue ?? 34, at: new Date().toISOString(), how: a.review ? "review" : "hand", from: "marco", to: a.to, brief: a.brief, sign: { login: "marco", agent: false } }, ...S.hands] });
  return { ok: true, note: r.note };
}

const doing = (id: string, d: Doing | null) => { const n = { ...S.doing }; if (d) n[id] = d; else delete n[id]; set({ doing: n }); };
const gone = (id: string) => set({ pending: S.pending.filter((p) => p.id !== id), reviews: S.reviews.filter((p) => p.id !== id) });

/** Take: the engine writes **taken**, fetches the branch and starts the session; the window opens it (onTaken) */
export async function take(h: Handed): Promise<{ sessionId?: string; error?: string }> {
  if (S.doing[h.id]?.taking) return {};
  doing(h.id, { said: `taking #${h.issue}…`, taking: true });
  const r = DEV_HAND
    ? (await pause(1200), { ok: true, sessionId: "" })
    : await teamAsk<{ ok?: boolean; sessionId?: string; note?: string }>("team.hand.answer", { id: h.id, how: "take" }, 180_000);
  if (r.error || !r.ok) { doing(h.id, { said: `not taken: ${r.error || "no reason given"}`, failed: true }); return { error: r.error }; }
  doing(h.id, { said: r.note ? r.note : `taken · the session is under ${h.repo.split("/")[1] ?? h.repo}` });
  window.setTimeout(() => { doing(h.id, null); gone(h.id); }, 4000);
  if (r.sessionId) window.dispatchEvent(new CustomEvent("sol:hand-taken", { detail: { sessionId: r.sessionId, repo: h.repo } }));
  return { sessionId: r.sessionId };
}

/** Pass, with the one line why: written on the issue, the issue back to the sender, the word back to them */
export async function pass(h: Handed, line: string): Promise<void> {
  doing(h.id, { said: `passing #${h.issue} back to ${h.from}…`, taking: true });
  const r = DEV_HAND
    ? (await pause(900), { ok: true })
    : await teamAsk<{ ok?: boolean; note?: string }>("team.hand.answer", { id: h.id, how: "pass", line }, 120_000);
  if (r.error || !r.ok) { doing(h.id, { said: `not passed: ${r.error || "no reason given"}`, failed: true }); return; }
  passing("");
  doing(h.id, { said: `passed back to ${h.from}` });
  window.setTimeout(() => { doing(h.id, null); gone(h.id); }, 3000);
}

/** Later: nothing is written; it stays under its repo as "handed to you" until it is picked there */
export function later(h: Handed) {
  const l = { ...read<Record<string, string>>(LATER_KEY, {}), [h.id]: h.at ?? "" };
  write(LATER_KEY, l);
  if (S.passing === h.id) passing("");
  doing(h.id, null);
  set({ later: l, reviews: S.reviews.filter((r) => r.id !== h.id) });
}
/** picked again in the side: the line shows it again */
export function unlater(id: string) {
  const l = { ...read<Record<string, string>>(LATER_KEY, {}) };
  delete l[id];
  write(LATER_KEY, l);
  set({ later: l });
}
/** the notch's Pass: the window's line asks for the line */
export function passing(id: string) { write(PASSING_KEY, id); set({ passing: id }); }

const putOff = (s: State, h: Handed) => h.id in s.later && (s.later[h.id] === (h.at ?? "") || !h.at || s.later[h.id] >= h.at);
/** the hand to show now (the notch, the window's line): a review just asked, else the newest hand not put off */
export function current(s: State = S): (Handed & { doing?: Doing }) | null {
  const r = s.reviews[0];
  if (r) return { ...r, doing: s.doing[r.id] };
  const h = s.pending.find((p) => !putOff(s, p) || s.doing[p.id]);
  return h ? { ...h, doing: s.doing[h.id] } : null;
}

export type HandsView = { hands: HandRow[]; pending: Handed[]; current: ReturnType<typeof current>; passing: string; said: State["said"]; laterOf: (id: string) => boolean };
export function useHands(): HandsView {
  useEffect(() => { wire(); }, []);
  const s = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => S);
  return { hands: s.hands, pending: s.pending, current: current(s), passing: s.passing, said: s.said, laterOf: (id) => { const h = s.pending.find((p) => p.id === id); return !!h && putOff(s, h); } };
}
