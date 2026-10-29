// Rooms (#154): the face's few rules about rooms, kept in one place for Cowork's side and Control's list. A new room is
// made by the engine from its name alone (#160, team/rooms.ts makeRoom), so the face no longer builds one.
import { useEffect, useRef, useState } from "react";

/** a code as typed or pasted (#157): upper-cased, anything but letters and digits dropped ("k7q x2m" is K7QX2M), six at most */
export const codeTyped = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6);

/** where a room meets, in words: the hub's host, or "this Mac" when it meets on this Sol's own */
export const meets = (hub: string) => (hub ? hub.replace(/^wss?:\/\//, "").replace(/[/?#].*$/, "") : "this Mac");


/** the room the engine makes up when team.json names none (settings.ts: id "team", TEAM_DEFAULTS' repo, no hub, no
 *  code, neither mine nor joined): nobody made it, so the face counts it as no group (#314, the first-time page) */
export const DEFAULT_REPO = "marcocyl04-ux/sol-dev";
export const madeUp = (r: { id: string; repos: string[]; hub?: string; code?: string; mine?: boolean; joined?: boolean }) =>
  r.id === "team" && !r.mine && !r.joined && !r.code && !r.hub && r.repos.length === 1 && r.repos[0] === DEFAULT_REPO;
/** my groups (pure): the rooms, less the made-up one */
export const groupsOf = <R extends Parameters<typeof madeUp>[0]>(rooms: R[]): R[] => rooms.filter((r) => !madeUp(r));

/** Sol's cloud, where a group's link points when its room names no hub */
export const CLOUD = "wss://cloud.matterfold.tech/relay";

/** a group's join link (#314, #327, the groups PRD §9.2): its hub's page for its code, `https://<host>/relay/j/<code>`
 *  (pure). "" for an address that is not a hub's */
export function joinLink(code: string, hub = CLOUD): string {
  let u: URL;
  try { u = new URL(hub || CLOUD); } catch { return ""; }
  if (u.protocol !== "wss:" && u.protocol !== "ws:") return "";
  const path = u.pathname.replace(/\/+$/, "") || "/relay";
  return `${u.protocol === "wss:" ? "https" : "http"}://${u.host}${path}/j/${encodeURIComponent(code)}`;
}

/** a hub's address in one plain form to compare (pure): lower case, no query, no trailing slash, no :443 */
const plainHub = (h: string) => h.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/^(wss:\/\/[^/]+):443(?=\/|$)/, "$1");

/** the link a group shows (pure): only a group on Sol's cloud itself (its hub the cloud's, or none named), with its
 *  code, and only once the hub said in its hello that it serves the page (team.hub's `join`, PROTOCOL round 59); else
 *  "" and the face shows the code ("copy code"). A group on another hub has no page the link could name */
export const linkFor = (r: { code?: string; provider?: string; hub?: string }, join: boolean | undefined) =>
  join === true && !!r.code && r.provider === "cloud" && (!r.hub || plainHub(r.hub) === plainHub(CLOUD)) ? joinLink(r.code) : "";

/** copy a text, and say "copied" for a moment (or how to copy by hand when the clipboard says no) */
export function useCopied(): [string, (text: string) => void] {
  const [said, setSaid] = useState("");
  const t = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const copy = (text: string) => {
    const say = (w: string) => { setSaid(w); window.clearTimeout(t.current); t.current = window.setTimeout(() => setSaid(""), 1500); };
    void navigator.clipboard?.writeText(text).then(() => say("copied"), () => say("select it and copy"));
  };
  return [said, copy];
}
