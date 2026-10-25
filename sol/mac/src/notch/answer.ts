// Notch buttons (#6): which buttons the open card draws, what Return and Escape do, and whether a press still answers
// what the card drew. Pure (no imports), so the engine's tests can check it (engine/test/notch-buttons.test.ts).
// The table is design/notch-buttons/PRD.md "The set, final", plus one row from Ship (#33, design/together/3-ship/PRD.md):
// a new stable is out → Update · Later; Return does nothing (an update is not the safe answer), Escape closes.
// And two from Hand (#34, design/together/4-hand/PRD.md): a teammate hands me work → Take · Pass · Later, a review
// asked → Open · Later; Return does nothing (a take starts a session).
// And Grab and Shelf (#200, sol/README.md "Grab and Shelf"; it replaces File it's button, #119): the plain card,
// nothing to answer, offers Shelf · Grab. Grab turns the row into Page · Shot · Sol (what to grab: a whole page of any
// window, scrolled and stitched in the sheet; a piece of the screen; or a part of Sol in the sheet); Shelf turns it into All, beside the shelf's last three things (Notch.tsx draws the thumbs).
// These six are icons (ICONED: Card.tsx draws them as round discs whose name unfurls on hover). Return does nothing on
// these rows: grabbing is never a key's answer.
// Escape only closes, on every card, the hand card too (polish two, 2026-10-20): a key that puts work off is an answer,
// and Escape is the key one presses to get a card out of the way. Later stays a button.
// An ask outranks a ping (polish two): Allow · Deny stays under the pointer while a ping rings; the ping waits as "+1 ping"
// in the meta. A press or a Return within ARM_MS of the card changing is refused (armed), so an aim at one ask cannot
// land on the next.

export type Ask = { id: string; sessionId: string; seat: string; tool: string; title: string; path?: string; n: number; of: number };
export type Turn = { seat: string; sessionId: string; title: string; kind: "life" | "work" | "call" };
export type PingIn = { id: string; seat: string; sessionId?: string; line: string };
// a new stable the team stamped (team.stable, PROTOCOL.md round 19); `said` replaces the line once Update was pressed
export type StableIn = { sha: string; tag: string; by: string; updating?: boolean; said?: string; failed?: boolean };
// --- Hand (#34): a hand to me (team.handed, PROTOCOL.md round 21); `said` replaces the line once Take was pressed
export type HandIn = { id: string; from: string; issue: number; title: string; review?: boolean; taking?: boolean; said?: string; failed?: boolean };
// --- end Hand
export type Btn = "allow" | "deny" | "open" | "stop" | "hangup" | "start" | "update" | "later"
  | "take" | "pass"   // Hand (#34)
  | "shelf" | "grab" | "page" | "shot" | "sol" | "all";   // Grab and Shelf (#200)
export type CardKind = "ask" | "question" | "turn" | "call" | "ping" | "unplugged" | "stable" | "plain"
  | "handed"                // Hand (#34)
  | "grabbing" | "shelf";   // Grab and Shelf: their own kinds, so a row changing re-arms the buttons (ARM_MS)
export type Card = { kind: CardKind; buttons: Btn[]; meta: string; line?: string; ask?: Ask; turn?: Turn; ping?: PingIn; stable?: StableIn
  hand?: HandIn };   // Hand (#34)
export type CardIn = {
  crew: boolean;            // the crew is down in the card: it is the crew's, no buttons
  ping: PingIn | null;      // a ping showing
  unplugged: boolean;
  starting: boolean;        // Start was pressed: "Starting…", nothing more to press
  ask: Ask | null;          // the oldest open ask (creature.ask)
  call: boolean;            // this notch's own call is on (useNotch): Hang up is its toggle
  turn: Turn | null;        // the conversation the notch follows (creature.turn)
  stable?: StableIn | null; // a new stable is out and this checkout is behind it, not put off with Later
  hand?: HandIn | null;     // Hand (#34): a teammate handed me work, not put off with Later
  grabbing: boolean;        // Grab was pressed: the row asks what to grab (Page · Shot · Sol)
  shelfOpen: boolean;       // Shelf was pressed (or a shot just landed): the last three things and All
};

// these need the window's choices (a question's options, a plan's modes): the notch opens them instead
export const OPEN_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
export const LABEL: Record<Btn, string> = { allow: "Allow", deny: "Deny", open: "Open", stop: "Stop", hangup: "Hang up", start: "Start", update: "Update", later: "Later", take: "Take", pass: "Pass",
  shelf: "Shelf", grab: "Grab", page: "Page", shot: "Shot", sol: "Sol", all: "All" };
// the press takes the state's functional tint (palette.css): yellow waiting on Marco, red stopping, green starting
export const TINT: Record<Btn, "yellow" | "red" | "green" | ""> = { allow: "yellow", deny: "yellow", open: "", stop: "red", hangup: "red", start: "green", update: "green", later: "", take: "green", pass: "",
  shelf: "", grab: "", page: "", shot: "", sol: "", all: "" };
/** the buttons drawn as icons (a round disc, the name unfurling on hover); every other button keeps its word capsule */
export const ICONED: ReadonlySet<Btn> = new Set<Btn>(["shelf", "grab", "page", "shot", "sol", "all"]);
/** the shelf row's small text: how many things wait, and that they leave by themselves */
export const shelfMeta = (n: number) => n ? `${n} ${n === 1 ? "thing" : "things"} · cleans itself after a week` : "nothing yet";

const base = (p: string) => p.split("/").filter(Boolean).pop() ?? "";
// about what the island's line holds beside two buttons (360 px, the buttons take a third) at 13 px
export const LINE_MAX = 30;
/** a long line keeps its start and its end, the middle gives way: "run: build the no…n the tests" */
export function middle(s: string, max = LINE_MAX): string {
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2), tail = max - 1 - head;
  return `${s.slice(0, head).trimEnd()}…${s.slice(s.length - tail).trimStart()}`;
}
/** the ask's one line, the thing first: "Notch.tsx · edit", "run: build the notch page". The window keeps its own title
 *  ("Claude wants to edit Notch.tsx"); on the notch the line ellipsised at its end and lost the file */
export function askLine(a: Ask): string {
  const f = a.path ? base(a.path) : "";
  const rest = a.title.replace(/^\S+ wants to /, "");
  if (!f) return middle(rest);
  const verb = rest.includes(f) ? rest.replace(f, "").replace(/\s+/g, " ").trim() : rest;
  return middle(verb && verb !== a.title ? `${f} · ${verb}` : f);
}
/** what the buttons answer: a change of it re-arms them (ARM_MS) and slides the line */
export const cardKey = (c: Card) => `${c.kind}:${c.ask?.id ?? c.ping?.id ?? c.hand?.id ?? c.stable?.sha ?? ""}`;
export const ARM_MS = 400;
/** a press or a Return is taken only ARM_MS after what the card answers last changed */
export const armed = (changedAt: number, now: number) => now - changedAt >= ARM_MS;
/** the conversation a Stop would stop, in small text: "session · ecosystem", "chat" */
export const turnLabel = (t: Turn) => `${t.kind === "work" ? "session" : "chat"}${t.title ? ` · ${t.title}` : ""}`;

// --- Hand (#34)
/** the hand card's one line: who hands me what, or what Take is doing */
// the notch has room for about 30 characters beside three buttons: the title goes only when it fits (the window's line has it)
export const handLine = (h: HandIn) => {
  if (h.said) return h.said;
  if (h.review) return `${h.from} asks you to review #${h.issue}`;
  const base = `${h.from} hands you #${h.issue}`, full = h.title ? `${base} · ${h.title}` : base;
  return full.length <= 30 ? full : base;
};
// --- end Hand

/** the stable card's one line: the offer, or what Update is doing */
export const stableLine = (s: StableIn) => s.said || `a new stable is out (${s.tag || s.sha.slice(0, 7)}${s.by ? `, by ${s.by}` : ""})`;

export function cardOf(c: CardIn): Card {
  if (c.crew) return { kind: "plain", buttons: [], meta: "" };
  if (c.unplugged) return { kind: "unplugged", buttons: c.starting ? [] : ["start"], meta: "" };
  if (c.ask) {
    // the ask first: a ping that rings meanwhile waits in the meta, its cell stays lit
    const meta = [c.ask.of > 1 ? `${c.ask.n} of ${c.ask.of}` : "", c.ping ? "+1 ping" : ""].filter(Boolean).join(" · ");
    return OPEN_TOOLS.has(c.ask.tool)
      ? { kind: "question", buttons: ["open"], meta, line: askLine(c.ask), ask: c.ask }
      : { kind: "ask", buttons: ["allow", "deny"], meta, line: askLine(c.ask), ask: c.ask };
  }
  if (c.ping) return { kind: "ping", buttons: ["open"], meta: "", ping: c.ping };
  if (c.call) return { kind: "call", buttons: ["hangup"], meta: "" };
  // a call on another face is not this notch's to end (Hang up is this door's own call): no button
  if (c.turn && c.turn.kind !== "call") return { kind: "turn", buttons: ["stop"], meta: turnLabel(c.turn), turn: c.turn };
  // a new stable waits for the running turn (Stop stays reachable; an update never lands mid-answer anyway). Once
  // Update has words (running, done, failed) only a failure keeps a button: Later
  // --- Hand (#34): a hand ranks with a new stable, first; once Take has words only a failure keeps a button: Later
  if (c.hand) {
    const h = c.hand, buttons: Btn[] = h.failed ? ["later"] : h.taking || h.said ? [] : h.review ? ["open", "later"] : ["take", "pass", "later"];
    return { kind: "handed", buttons, meta: "", line: handLine(h), hand: h };
  }
  // --- end Hand
  if (c.stable) {
    const s = c.stable, buttons: Btn[] = s.failed ? ["later"] : s.updating || s.said ? [] : ["update", "later"];
    return { kind: "stable", buttons, meta: "", line: stableLine(s), stable: s };
  }
  // --- Grab and Shelf: nothing to answer, so the card offers the shelf and a grab; each press opens its own row
  if (c.grabbing) return { kind: "grabbing", buttons: ["page", "shot", "sol"], meta: "", line: "Grab what?" };
  if (c.shelfOpen) return { kind: "shelf", buttons: ["all"], meta: "" };
  return { kind: "plain", buttons: ["shelf", "grab"], meta: "" };
}

/** Return is the safe answer or nothing (never Deny, never Stop); Escape only closes the card */
export function keyAction(card: Card, key: string): Btn | "close" | null {
  if (key === "Escape") return "close";
  if (key !== "Return" && key !== "Enter") return null;
  if (card.kind === "ask") return "allow";
  if (card.kind === "question" || card.kind === "ping") return "open";
  if (card.kind === "unplugged" && card.buttons.includes("start")) return "start";
  return null;   // the stable card too: Update changes the code under Sol, never the answer of a key
}

/** a press answers the ask the card drew, and only while that ask is still the open one; anything else is dropped */
export function stillShown(card: Card, liveAsk: Ask | null): boolean {
  if (card.kind !== "ask" && card.kind !== "question") return true;
  return !!card.ask && !!liveAsk && card.ask.id === liveAsk.id && card.ask.sessionId === liveAsk.sessionId;
}
