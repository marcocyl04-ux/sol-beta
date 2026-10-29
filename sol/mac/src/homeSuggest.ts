// Home offers a group once (#321, Cowork PRD §4.1, §9.1): the card's state, kept apart from React so a node test reads
// it. The engine sends { type: "home.suggest", sessionId, name } when the Home seat calls suggest_group (at most once a
// conversation); the face keeps one offer per conversation, in memory, with the turn it came in (how many of the
// person's lines were in the talk then), so the card sits under that answer and not under whatever was said later.
// "skip" is remembered per conversation in localStorage. The two other presses leave a one-shot note for Cowork
// (`pendingGroup`): the new-group form with the name filled, or the groups list with "pick a group" over it. Nothing is
// sent to the engine until the person presses make there.

export type Offer = { sessionId: string; name: string; turn: number };   // turn -1: not the open talk, drawn at its end
export type Offers = Record<string, Offer>;
export type Pending = { k: "new"; name: string } | { k: "pick" };
type Store = Pick<Storage, "getItem" | "setItem">;

const SKIPPED = "sol.home.suggest.skipped";
const KEEP = 200;   // skipped conversations remembered; the oldest go first
const NAME_MAX = 40;   // as the engine's suggest.ts: one row's worth

/** how many of the person's own lines a talk holds: the turn an answer belongs to */
export const turnOf = (whos: readonly { who: string }[]) => whos.filter((m) => m.who === "me").length;

/** a home.suggest heard: kept once per conversation (a repeat never moves or renames the first), the name made one short line */
export function heard(offers: Offers, m: { sessionId?: unknown; name?: unknown }, turn: number): Offers {
  const sessionId = typeof m.sessionId === "string" ? m.sessionId : "";
  if (!sessionId || offers[sessionId]) return offers;
  const name = [...String(m.name ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()].slice(0, NAME_MAX).join("");
  return { ...offers, [sessionId]: { sessionId, name, turn } };
}

/** where the card goes in a talk: before the person's next line after its turn, or at the end */
export function placeAt(msgs: readonly { who: string }[], turn: number): number {
  if (turn < 0) return msgs.length;
  let seen = 0;
  for (let i = 0; i < msgs.length; i++) if (msgs[i].who === "me" && seen++ === turn) return i;
  return msgs.length;
}

const readSkipped = (s: Store): string[] => { try { const v = JSON.parse(s.getItem(SKIPPED) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
/** skipped in this conversation before (this window or an earlier one) */
export const isSkipped = (s: Store, sessionId: string) => readSkipped(s).includes(sessionId);
/** "skip": the card goes in this conversation, for good */
export function skip(s: Store, sessionId: string) {
  const list = readSkipped(s).filter((x) => x !== sessionId).concat(sessionId).slice(-KEEP);
  try { s.setItem(SKIPPED, JSON.stringify(list)); } catch { /* private: it goes for this sitting only */ }
}

/** the card a talk shows: its conversation's offer, unless skipped */
export function cardFor(offers: Offers, sessionId: string | undefined, s: Store): Offer | null {
  const o = sessionId ? offers[sessionId] : undefined;
  return o && !isSkipped(s, o.sessionId) ? o : null;
}

// the one-shot note Cowork reads once, as it opens (cowork/CoworkSidebar.tsx)
let pending: Pending | null = null;
/** a press on the card: what Cowork opens to */
export function setPendingGroup(p: Pending) { pending = p.k === "new" ? { k: "new", name: [...p.name].slice(0, NAME_MAX).join("") } : p; }
/** read once: a second read, or a Cowork opened by hand later, finds nothing */
export function takePendingGroup(): Pending | null { const p = pending; pending = null; return p; }
