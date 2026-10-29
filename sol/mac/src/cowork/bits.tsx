// Small things Cowork draws everywhere: a person's mark, a signature, a card's lift.
// A person is one mark wherever they show (mine/look/COWORK.html, 2026-10-27): their family's bud from the goo look, the
// same one their agent wears at Home; mine is Sol. Presence is the mark's own state: eyes open here, shut and
// stone-washed when away or not seen; a running droplet on its shoulder while their agent works, the needs-you halo when
// they wait on a person. The room's `me` comes down through MeCtx, so a signature knows which mark is Sol.
import { createContext, useContext, useRef } from "react";
import { Sol } from "../Sol";
import { Bud, Droplet, FAMILIES, JOBS, bandsCss, familyOf } from "../creature/goo";
import { CFG, useSpring } from "../motion";
import type { Member, Presence, Sign } from "./useTeam";
import { signOf } from "./useTeam";

export const STATE_WORD: Record<Presence, string> = { here: "here", elsewhere: "elsewhere", away: "away", working: "working", yourcall: "waiting on them" };

/** who I am in the room, for the marks under it ("" outside Cowork: everyone is a bud) */
export const MeCtx = createContext("");
const same = (a: string, b: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
/** a talk line's sender as a person: "discord: isaac" and "frank's agent" are isaac and frank */
export const personIn = (from: string) => from.replace(/^(discord|whatsapp):\s*/i, "").replace(/'s agent$/i, "").trim();

/** a person's band, as CSS: their family's colours (Sol's own, the brand, for me), for a ring or a neck */
export function useBand() {
  const me = useContext(MeCtx);
  return (login: string) => bandsCss(same(login, me) ? JOBS.brand : FAMILIES[familyOf(login)], 120);
}

/** a person's mark: Sol for me, their family's bud for anyone else */
export function Who({ login, size = 14, away, working, needs, title, className }: {
  login: string; size?: number; away?: boolean; working?: boolean; needs?: boolean; title?: string; className?: string;
}) {
  const me = useContext(MeCtx);
  const st = Math.max(9, Math.round(size * 0.62));
  return (
    <span className={`cwho ${away ? "away" : ""} ${className ?? ""}`.trim()} title={title} style={{ width: size, height: size }}>
      {same(login, me) ? <Sol size={size} eyes={!away} /> : <Bud login={login || "?"} size={size} on={!away} />}
      {(working || needs) && !away && <Droplet kind={working ? "running" : "needs"} size={st} seed={login} className="cwho-st" />}
    </span>
  );
}

/** a person's small body on the group page and in the side (#314, the groups PRD §2): the flat Sol, in their family's
 *  colour, one fill (mine wears the brand's lobes). An agent's is the same body in a thin white ring; away or not seen,
 *  its eyes shut */
export function Body({ login, size = 28, agent, away, title, className }: { login: string; size?: number; agent?: boolean; away?: boolean; title?: string; className?: string }) {
  const me = useContext(MeCtx);
  const body = <Sol alone size={agent ? Math.round(size * 0.66) : size} eyes={!away} fill={same(login, me) ? undefined : FAMILIES[familyOf(login || "?")][1]} />;
  return <span className={`cbody ${agent ? "ag" : ""} ${className ?? ""}`.trim()} title={title} style={{ width: size, height: size }}>{body}</span>;
}

/** a state as the daily mark (creature/goo.tsx Droplet): turning while it runs, the check when done, the sag when it
 *  failed, the halo when it waits on a person */
export const StateMark = ({ kind, seed, size = 12 }: { kind: "running" | "done" | "failed" | "needs"; seed?: string; size?: number }) => (
  <Droplet kind={kind} size={size} seed={seed ?? kind} className="cstate" />
);

/** a person's mark from the roster: a member off the team's line (or unknown) is not seen */
export function PersonDot({ login, roster, up, me, size = 14 }: { login: string; roster: Member[]; up: boolean; me: string; size?: number }) {
  const m = roster.find((r) => r.who === login);
  const mine = login === me;
  const state = m?.state ?? (mine ? "here" : undefined);
  const dark = !mine && (!up || !m);
  return <Who login={login} size={size} away={dark || state === "away"} working={!dark && state === "working"} needs={!dark && state === "yourcall"}
    title={`${login}: ${dark ? "not seen" : STATE_WORD[state ?? "here"]}`} />;
}

/** who moved something: their mark and their words, a person or that person's agent */
export const Sig = ({ s }: { s?: Sign }) => (s ? (
  <span className="csig" title={s.agent ? `moved last by ${s.login}'s agent` : `moved last by ${s.login}`}><Who login={s.login} size={12} />{signOf(s)}</span>
) : null);

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
