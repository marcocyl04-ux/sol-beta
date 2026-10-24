// Small things Cowork draws everywhere: a person's presence dot, a signature, a card's lift.
import { useRef } from "react";
import { Runner } from "../creature/indicators";
import { CFG, useSpring } from "../motion";
import type { Member, Presence, Sign } from "./useTeam";
import { signOf } from "./useTeam";

export const STATE_WORD: Record<Presence, string> = { here: "here", elsewhere: "elsewhere", away: "away", working: "working", yourcall: "waiting on them" };

/** one cell: ink here, a ring elsewhere or away, the runner working, yellow waiting on a person; dark when not seen */
export function Dot({ state, dark, title }: { state?: Presence; dark?: boolean; title?: string }) {
  if (!dark && state === "working") return <span className="cdot run" title={title}><Runner /></span>;
  return <span className={`cdot ${dark || !state ? "dark" : state}`} title={title}><i /></span>;
}

/** a person's dot from the roster: a member off the team's line (or unknown) goes dark */
export function PersonDot({ login, roster, up, me }: { login: string; roster: Member[]; up: boolean; me: string }) {
  const m = roster.find((r) => r.who === login);
  const mine = login === me;
  const state = m?.state ?? (mine ? "here" : undefined);
  const dark = !mine && (!up || !m);
  return <Dot state={state} dark={dark} title={`${login}: ${dark ? "not seen" : STATE_WORD[state ?? "here"]}`} />;
}

/** the amber words of who moved something: a person, or that person's agent */
export const Sig = ({ s }: { s?: Sign }) => (s ? <span className="csig" title={s.agent ? `moved last by ${s.login}'s agent` : `moved last by ${s.login}`}>{signOf(s)}</span> : null);

/** hover lifts it on the pop spring (a card on the board) */
export function useLift() {
  const el = useRef<HTMLDivElement>(null);
  const s = useSpring(0, CFG.pop, (v) => { if (el.current) el.current.style.translate = v ? `0 ${-2 * v}px` : ""; });
  return { ref: el, onMouseEnter: () => s.to(1), onMouseLeave: () => s.to(0) };
}

/** "3h", "2d": how long since */
export const since = (t: number | string) => {
  const ms = Date.now() - (typeof t === "string" ? Date.parse(t) : t);
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 60 * 24 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

/** "read just now", "read 3m ago": when the board was read */
export const readAgo = (t: number | string) => { const s = since(t); return s === "now" ? "read just now" : `read ${s} ago`; };
