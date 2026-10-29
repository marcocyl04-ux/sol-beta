// How full a group on Sol's cloud is, as the group page says it (#326, the groups PRD §4.5, wF's S5). The engine answers
// team.room.usage with the room's `used / max`, whether it is moving now, its maker and whether that is me, and my own
// line when my files across groups pass 80% of 50 MB. From that, one banner under the tabs, or none:
// - from 80% of the room, to its maker: the amber bar, "18 of 20 MB", "the group's files move to a private repository
//   of yours, no limit", and the gradient "connect GitHub to keep going";
// - when it is full, to everyone else too: "ask <maker> to connect GitHub", and no button;
// - while it moves (frozen), to everyone: "moving to GitHub", no button.
// A moved group's card ("the group moved to <repo> · join it · not now") remembers a "not now" on this Mac, by group.
// Pure, but for the one localStorage pair at the end, so `node --test` reads it.

export type UsageNow = { room: string; used: number; max: number; files: number; frozen: boolean; maker: string; mine: boolean; warn?: string };
export type Banner = { share: number; words: string; line: string; button: boolean; moving?: true };

/** the room's share past which its maker sees the banner (the PRD: from 80%) */
export const NEAR = 0.8;
/** full, for the banner: within the last 2% the cloud refuses most attachments, so a group there is full in practice
 *  (a write past 20 MB is refused, so `used` itself almost never reaches `max`) */
export const FULL = 0.98;
const MB = 1024 * 1024;

/** megabytes as the banner says them: whole ones from ten, one decimal under (pure) */
const mb = (b: number) => { const x = b / MB; return x >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10); };
/** "18 of 20 MB" (pure) */
export const mbOf = (used: number, max: number) => `${mb(used)} of ${mb(max)} MB`;

/** the banner a group's usage asks for, or null (pure) */
export function bannerOf(u: UsageNow | null | undefined): Banner | null {
  if (!u || !(u.max > 0)) return null;
  const share = Math.min(1, Math.max(0, u.used / u.max)), words = mbOf(u.used, u.max), full = share >= FULL;
  if (u.frozen) return { share, words, line: "the group's files are moving to GitHub; changes wait a minute", button: false, moving: true };
  if (share < NEAR) return null;
  if (u.mine) return { share, words, line: full ? "the group is full: its files move to a private repository of yours, no limit" : "the group's files move to a private repository of yours, no limit", button: true };
  return full ? { share, words, line: `the group is full; ask ${u.maker || "its maker"} to connect GitHub`, button: false } : null;
}

// ---- "not now" on a moved group's card, by group, on this Mac ----

const NOT_NOW = "sol.cowork.movednotnow";
/** was "not now" pressed on this group's move to this repository */
export const notNow = (room: string, repo: string): boolean => { try { return JSON.parse(localStorage.getItem(NOT_NOW) ?? "{}")[room] === repo; } catch { return false; } };
/** "not now" on this group's move: the card stays away until it moves somewhere else */
export const keepNotNow = (room: string, repo: string) => { try { const m = JSON.parse(localStorage.getItem(NOT_NOW) ?? "{}"); m[room] = repo; localStorage.setItem(NOT_NOW, JSON.stringify(m)); } catch { /* private */ } };
