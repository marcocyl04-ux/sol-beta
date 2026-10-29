// The join link in the app (#327; the groups PRD §9.2): a friend's `sol://join?code=<code>`, opened from the cloud's
// join page, reaches the face as the app's `sol-url` event (src-tauri link.rs; the launch link too, taken once the page
// listens). Only that one shape is read, its code by codeTyped's rule; anything else that says sol:// is ignored, so a
// page cannot make Sol do more than ask. The card (JoinAsk.tsx) floats over whichever mode is in front and switches
// nothing until "join" is pressed. Its whole course is `joinFlow` here, pure, with the engine's socket as an input: a
// link that launched Sol comes before the socket is open, so the code is held and asked about once it is up (every
// second, 30 s at most); the engine asks the cloud for the name (team.room.peek); the card says "join <name>?", whose
// button waits 600 ms after a code is shown, so a press meant for something else is not a join; and only "join" runs
// team.room.join, naming the hub that was peeked. A Sol with no account on that hub (#342: the peek says `signedIn:
// false`) is not offered the join: the card says "sign in to Sol first", and its one button opens Settings › me.
import { codeTyped } from "./rooms.ts";

/** the code a sol:// link carries, or "" when it is anything but `sol://join?code=<six letters and digits>` (pure) */
export function joinCodeOf(url: unknown): string {
  if (typeof url !== "string" || url.length > 200) return "";
  let u: URL;
  try { u = new URL(url.trim()); } catch { return ""; }
  if (u.protocol !== "sol:" || u.hostname !== "join" || (u.pathname !== "" && u.pathname !== "/") || u.username || u.password || u.port) return "";
  const said = u.searchParams.getAll("code");
  if (said.length !== 1) return "";
  const code = codeTyped(said[0]);
  // six symbols, and nothing dropped on the way: "2QK TYA" or "2qktya!" is not a link Sol wrote
  return code.length === 6 && code === said[0].toUpperCase() ? code : "";
}

/** how long a code waits for the engine's socket before the card says so */
export const HOLD_MS = 30_000;
/** how long "join" stays off after a code is shown */
export const READY_MS = 600;
/** what the engine's link says when the socket is not open (useTeam's ask, JoinAsk's own) */
export const NOT_CONNECTED = "not connected";

/** the card's states: nothing; holding the code for the engine; looking it up; asking "join <name>?" (shown at `at`;
 *  `out`: this Sol is not signed in on that hub, so the card asks for that instead, #342); joining; or what went wrong.
 *  `since`: when the link came, for the hold's 30 s */
export type JoinCard =
  | { k: "none" }
  | { k: "holding"; code: string; since: number }
  | { k: "asking"; code: string; since: number }
  | { k: "ask"; code: string; name: string; hub?: string; already?: boolean; out?: boolean; at: number }
  | { k: "joining"; code: string; name: string; hub?: string }
  | { k: "said"; code: string; why: string };
/** what happens to it: a link opened, the socket's state now (on a change and every second), the engine's answers, the
 *  presses ("signin" is the signed-out card's button). `up` is whether the engine's socket is open; `at` the clock */
export type JoinEvent =
  | { e: "open"; code: string; up: boolean; at: number }
  | { e: "link"; up: boolean; at: number }
  | { e: "peeked"; code: string; name?: string; hub?: string; already?: boolean; signedIn?: boolean; error?: string; at: number }
  | { e: "join"; at: number }
  | { e: "signin" }
  | { e: "joined"; error?: string }
  | { e: "dismiss" };
/** the next card, and what to do now: a peek of a code, a join, or open Settings on this drawer (`settings`) */
export type JoinStep = { card: JoinCard; peek?: string; join?: { code: string; hub?: string; name: string }; settings?: string };
/** the Settings drawer where Sol signs in (Control.tsx's "me", its Sol row) */
export const SIGN_IN_DRAWER = "me";

const NOT_YET = "Sol is still starting; open the link again in a moment";

/** the card's course (pure). An answer for another code than the card's is late and changes nothing; a code is peeked
 *  exactly when the card starts asking about it */
export function joinFlow(s: JoinCard, ev: JoinEvent): JoinStep {
  const ask = (code: string, since: number): JoinStep => ({ card: { k: "asking", code, since }, peek: code });
  switch (ev.e) {
    case "open":
      if (s.k !== "none" && s.k !== "said" && s.code === ev.code) return { card: s };   // the same link again: one question
      return ev.up ? ask(ev.code, ev.at) : { card: { k: "holding", code: ev.code, since: ev.at } };
    case "link":
      if (s.k !== "holding") return { card: s };
      if (ev.up) return ask(s.code, s.since);
      return ev.at - s.since >= HOLD_MS ? { card: { k: "said", code: s.code, why: NOT_YET } } : { card: s };
    case "peeked":
      if (s.k !== "asking" || s.code !== ev.code) return { card: s };
      // the socket closed between the look and the send: held again, within the same 30 s
      if (ev.error === NOT_CONNECTED) return { card: ev.at - s.since >= HOLD_MS ? { k: "said", code: s.code, why: NOT_YET } : { k: "holding", code: s.code, since: s.since } };
      if (!ev.name) return { card: { k: "said", code: ev.code, why: ev.error || "Sol did not find that group; try again" } };
      // only a plain false is signed out: an older engine says nothing, and a group I am in opens with no sign-in
      return { card: { k: "ask", code: ev.code, name: ev.name, ...(ev.hub ? { hub: ev.hub } : {}), ...(ev.already ? { already: true } : ev.signedIn === false ? { out: true } : {}), at: ev.at } };
    case "join":
      if (s.k !== "ask" || s.out || ev.at - s.at < READY_MS) return { card: s };
      return { card: { k: "joining", code: s.code, name: s.name, ...(s.hub ? { hub: s.hub } : {}) }, join: { code: s.code, ...(s.hub ? { hub: s.hub } : {}), name: s.name } };
    case "signin":
      return s.k === "ask" && s.out ? { card: { k: "none" }, settings: SIGN_IN_DRAWER } : { card: s };
    case "joined":
      return { card: s.k !== "joining" ? s : ev.error ? { k: "said", code: s.code, why: ev.error } : { k: "none" } };
    case "dismiss":
      return { card: { k: "none" } };
  }
}
