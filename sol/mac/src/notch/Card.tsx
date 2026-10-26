// Notch buttons (#6, design/notch-buttons/PRD.md): the open card answers where it is. One set of small buttons per thing
// the card shows (answer.ts holds the table), in the sentence line's right third; the creature stays a click to call.
//
// The data comes down the page's renovation socket (creature.ask, creature.turn in creature/state.ts); the answers go
// up the same socket (wireSend): work.perm { sessionId, id, allow } for an ordinary ask, work.stop / stop { sessionId }
// for the followed turn, notify.seen and the window's open (askOpen, with the item's id) for a ping or a question.
// Hang up is the door's own toggle (useNotch), Start the app's engine_start; both are handed in by Notch.tsx.
//
// The look is the companion's: ink capsules on the black slab, the first one filled (pearl), no colour at rest; the
// pressed one takes its functional tint (palette.css) and the done flash runs the ring once as the answer leaves. Hover
// lifts on the `pop` spring, a press squashes like the slab. A press never reaches the creature's click. While Return
// is Sol's (lib.rs "notch-keys"), a small ⏎ sits on the button it would press.
// A press whose answer cannot leave (the socket is down: wireSend false) flashes wrong and keeps the card; Notch.tsx
// says "Sol is restarting, try again in the window" in the line.
//
// Grab and Shelf (#200, sol/README.md "Grab and Shelf"; the motion study is on marco/mine): the buttons answer.ts calls
// ICONED (Shelf, Grab, Page, Shot, Sol, All) are not capsules but Wispr pills: a 28 px outlined disc with a 14 px stroke icon.
// Hovered, the disc fills pearl, the icon goes black and the name unfurls from the disc's left on the snap spring; a
// press squashes the disc like a capsule and the creature hops (sol-greet). When one row of icons becomes another
// (Grab → Page · Shot · Sol) the old discs sink up and out while the new rise in place, 70 ms apart, all on springs. The shelf
// row puts the last three things (Thumbs) left of All, each dragged out as its URL. These presses are carried to
// Notch.tsx (act.shelf, act.grab, act.page, act.shot, act.sol, act.all): no done ring here; a Shot's ring runs when it lands.
// The capsules (Allow, Deny, Stop, …) are habits and do not change.
//
// The eye (#253): on the quiet card (nothing to answer: plain, Grab's and Shelf's
// rows) a small eye sits in the corner, the pills' 14 px stroke, no label. Open = Sol can be seen in a screen share
// (the default); closed with a stroke across = every Sol window is skipped by any share or screenshot. A press flicks
// it (Notch.tsx calls the app's eye_set, then tells the engine; the flick never waits on it). The closed notch shows
// nothing new. A 500 ms hold on it (part 3, the clean screen) fills the eye pearl and opens PrivateRow under the card:
// the private list (the apps cut out of the clean screen, the engine's home/private.json), each a chip with a tick, a
// press ticks or unticks it, and "Clean screen" last, pearl, which opens the clean screen (or, open, closes it).
//
// Anticipate (#253): the quiet card's third pill is an
// ear. While a talk is on the card stays the quiet card; the ear is lit (Buttons `lit`: a red dot, its name "Anticipate ·
// 12:34") and a press on it opens the drawer (Drawer.tsx) under the notch. TalkDrop is the card that drops under the
// notch while the drawer is closed: a headline, up to two bullets, the dim source and the seconds the notch's own clock
// measured; a card Sol volunteered carries the red "spoke up" mark; a spoken question's answer has the question above
// it (`q`). Notch.tsx asks the app for room under the slab (notch_expand `room`) and draws it there; an app from before
// that cannot grow its window, so there the same card is drawn inside the slab, over the line.
//
// Dev only: ?card=ask|ask3|askping|question|plan|turn|call|ping|unplugged|starting|stable|handed|review|plain|grabbing|shelf
// fakes the card's content (as ?creature= fakes the state; grabbing and shelf open those rows, with three made-up
// things on the shelf), and ?press=<n> holds the n-th button mid-press, for shots. Pressing a faked ask moves on to the next.
// ?eye=on|off fakes the eye (on: open, Sol visible; off: closed, invisible).
// Anticipate: ?card=listening (a talk on, 12:34, the lit pill), anticard (and a pressed card under the notch; &why=question
// for one Sol volunteered), drawer, drawer-cards, drawer-ask, drawer-pin, drawer-muted (the drawer open on a made-up talk,
// talk.ts devFill; &turns=1000 for the hour-long one); pressing in them moves on with made-up cards, no engine.
// The clean screen: ?card=private (the quiet card, the eye held, the private list's row under it, four made-up apps).
//
// The free notch (#253): a session's ask, question or running turn is one line on the
// open card: the line, its own buttons small under it (LineBtns, with the meta), the pills at the right (LinePills:
// Shelf · Grab · Anticipate, the eye in the corner as on the quiet card). Esc folds it into FoldCount, a small count with
// one red dot beside the mark; a press on the count unfolds the newest fold. useCard takes the folded keys and draws the
// card without them (answer.ts folds), so a folded ask is never what Return or a press answers.
// Dev: ?card=ask-line (a question with three choices as a line), ask-line-listening (the same while a talk is on, the
// pill lit), ask-folded (two asks folded: the count says 2; a press unfolds, both are answered in turn).
// The half moon (#254; Moon.tsx draws it): only a decision buds out as a card; a running turn is a
// row under the Sessions disc's name (hover it). ?card=two (an ask out as a card, 1 of 3, and a running turn in the
// hover list), folded2 (a one-question ask folded into the Sessions disc, which says 1, the turn in the hover list),
// running (a running turn only: no card out, nothing folded, the disc's hover list alone). Moon.tsx's ?t=0.4 freezes a
// card mid-bud.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cardNow, flashNow } from "../creature/state";
import { wireSend, askOpen, seen as seenPing } from "../renovation";
import { CFG, Spring } from "../motion";
import { CHOICES, ICONED, LABEL, OWN_ROWS, TINT, cardKey, cardOf, choiceLabel, folds, keyAction, stillShown, type Ask, type Btn, type Card, type CardIn, type PingIn, type StableIn, type Turn } from "./answer";
// --- Hand (#34)
import type { HandIn } from "./answer";
// --- end Hand
import type { ShelfItem, TalkCard } from "./useNotch";

export type { Card, CardIn };

const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
export const DEV_CARD = dev?.get("card") ?? null;
const DEV_PRESS = dev?.get("press") != null ? Number(dev.get("press")) : -1;
/** the eye faked for shots: true = invisible (?eye=off), false = visible (?eye=on), null = ask the app */
export const DEV_EYE: boolean | null = dev?.get("eye") === "off" ? true : dev?.get("eye") === "on" ? false : null;

const devAsk = (n: number, of: number, i: number): Ask => [
  { id: "perm:dev-edit", sessionId: "dev-work", seat: "claude", tool: "Edit", title: "Claude wants to edit Notch.tsx", path: "/Users/marcol04/computer/personal/projects/ecosystem/sol/mac/src/notch/Notch.tsx", n, of },
  { id: "perm:dev-bash", sessionId: "dev-work-2", seat: "claude", tool: "Bash", title: "Claude wants to run: build the notch page", n, of },
  { id: "perm:dev-write", sessionId: "dev-work-3", seat: "claude", tool: "Write", title: "Claude wants to write RUBRIC.md", path: "/x/design/notch-buttons/RUBRIC.md", n, of },
][i % 3];
const DEV_TURN: Turn = { seat: "claude", sessionId: "dev-work", title: "ecosystem", kind: "work" };
// the free notch: a session's question with its three choices (the still's)
const DEV_CHOOSE: Ask = { id: "perm:dev-choose", sessionId: "dev-work", seat: "claude", tool: "AskUserQuestion", title: "Claude has a question for you",
  question: "Anime, dramas, or reality shows?", options: ["Anime", "Dramas", "Reality"], n: 1, of: 1 };
/** the folds a dev state starts with (Notch.tsx's folded keys) */
export const DEV_FOLDED: string[] = DEV_CARD === "ask-folded" ? ["ask:dev-work/perm:dev-edit"]
  : DEV_CARD === "folded2" ? ["ask:dev-work/perm:dev-edit"] : [];   // the half moon: the ask in the Sessions disc (a turn is never folded)
const DEV_PING: PingIn = { id: "ping:dev", seat: "work", sessionId: "dev-work", line: "the sidebar's timer row is in" };
// --- Hand (#34)
const DEV_HAND: HandIn = { id: "marcocyl04-ux/sol-dev#34", from: "frank", issue: 34, title: "Hand: give a session, issue or PR to a teammate" };
// --- end Hand
const DEV_STABLE: StableIn = { sha: "7a53b17e2c4d9f1a0b6c3e8d5f2a7b9c1d4e6f80", tag: "stable-20261020-2214", by: "frank" };

/** what the card would hold under a ?card= fake; null when nothing is faked */
function fake(kind: string | null, step: number): Partial<CardIn> | null {
  switch (kind) {
    case "ask": return step ? { ask: null } : { ask: devAsk(1, 1, 0) };
    case "askping": return step ? { ping: DEV_PING } : { ask: devAsk(1, 2, 1), ping: DEV_PING };
    case "ask3": return step >= 3 ? { ask: null } : { ask: devAsk(1, 3 - step, step) };
    case "question": return { ask: { id: "perm:dev-q", sessionId: "dev-work", seat: "claude", tool: "AskUserQuestion", title: "Claude has a question for you", n: 1, of: 1 } };
    case "plan": return { ask: { id: "perm:dev-p", sessionId: "dev-work", seat: "claude", tool: "ExitPlanMode", title: "Claude has a plan for you", n: 1, of: 2 } };
    case "turn": return { turn: DEV_TURN };
    case "call": return { call: true };
    case "ping": return step ? {} : { ping: DEV_PING };
    case "unplugged": return { unplugged: true };
    case "starting": return { unplugged: true, starting: true };
    case "stable": return { stable: step ? { ...DEV_STABLE, updating: true, said: "updating to the new stable…" } : DEV_STABLE };
    // --- Hand (#34)
    case "handed": return { hand: step ? { ...DEV_HAND, taking: true, said: "taking #34…" } : DEV_HAND };
    case "review": return step ? {} : { hand: { ...DEV_HAND, issue: 42, title: "", review: true } };
    // --- end Hand
    case "plain": return {};
    // Grab and Shelf: the rows are the page's own state (Notch.tsx starts them from DEV_CARD), so a press still moves them
    case "grabbing": case "shelf": return {};
    // Anticipate: the talk is the page's own state too (Notch.tsx starts it from DEV_CARD), so presses move it on
    case "listening": case "anticard": case "drawer": case "drawer-cards": case "drawer-ask": case "drawer-pin": case "drawer-muted": return {};
    // the clean screen: the eye's row is the page's own state too (Notch.tsx starts it from DEV_CARD)
    case "private": return {};
    // the free notch: a question as a line (with a talk on too); two asks folded, then answered in turn
    case "ask-line": case "ask-line-listening": return step ? { ask: null } : { ask: DEV_CHOOSE };
    case "ask-folded": return step >= 2 ? { ask: null } : { ask: devAsk(1, 2 - step, step) };
    // the half moon (#254): an ask out as a card and a running turn in the disc's hover list (two); a one-question ask
    // folded in the disc, which counts it 1 (an ask counts every question it holds), the turn in the list (folded2);
    // a running turn only, in the list, nothing out (running)
    case "two": return step ? { turn: DEV_TURN } : { ask: devAsk(1, 3, 0), turn: DEV_TURN };
    case "folded2": return step ? { turn: DEV_TURN } : { ask: devAsk(1, 1, 0), turn: DEV_TURN };
    case "running": return { turn: DEV_TURN };
    // centre field: a talk on with its drawer out (the big one, in the middle), an ask card in the column at its left
    case "drawer-two": return step ? { turn: DEV_TURN } : { ask: devAsk(1, 3, 0), turn: DEV_TURN };
    default: return null;
  }
}

/** the card for this moment: the live inputs, or the dev fake over them; `step` moves a faked ask on after a press.
 *  `folded` (the free notch): the folded asks and turns are left out of `card`; `whole` is the card with them (the
 *  notch stands ajar for a folded ask too), `count` what waits folded, `live` the fold keys that still exist */
export function useCard(c: CardIn, folded: readonly string[] = []): { card: Card; whole: Card; count: number; live: string[]; advance: () => void; liveAsk: () => Ask | null; input: CardIn } {
  const [step, setStep] = useState(0);
  const f = fake(DEV_CARD, step);
  const input: CardIn = f ? { ...c, ask: null, turn: null, ping: null, call: false, unplugged: false, starting: false, stable: null, hand: null, ...f } : c;
  const fo = folds(input.ask, input.turn, folded);
  const card = cardOf({ ...input, ask: fo.ask, turn: fo.turn });
  const whole = fo.count ? cardOf(input) : card;
  const liveAsk = () => (f ? (fake(DEV_CARD, step)?.ask ?? null) : (cardNow().ask as Ask | null));
  // input: what the card was made from, fakes and all (the half moon splits it into its own cards: answer.ts decisionCards, and runningRows for the Sessions disc's list)
  return { card, whole, count: fo.count, live: fo.live, advance: () => setStep((s) => s + 1), liveAsk, input };
}

// --- Grab and Shelf: three made-up things on the shelf (twelve counted), drawn as small pictures, for shots
const svgUri = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="116" height="80" viewBox="0 0 116 80">${body}</svg>`)}`;
const DEV_PICS = [
  // a piece of Sol's window: the sidebar, two bubbles
  svgUri(`<rect width="116" height="80" fill="#141414"/><rect width="30" height="80" fill="#0f0f0f"/><rect x="5" y="10" width="20" height="3" rx="1.5" fill="#2a2a2a"/><rect x="5" y="18" width="16" height="3" rx="1.5" fill="#2a2a2a"/><rect x="62" y="12" width="46" height="12" rx="6" fill="#e9e6df"/><rect x="36" y="30" width="56" height="16" rx="6" fill="#262626"/><rect x="36" y="62" width="72" height="10" rx="4" fill="none" stroke="#333"/>`),
  // a page of the web: pearl, a headline, lines
  svgUri(`<rect width="116" height="80" fill="#f1efe9"/><rect x="10" y="12" width="60" height="7" rx="2" fill="#111"/><rect x="10" y="28" width="96" height="4" rx="2" fill="#d6d4cd"/><rect x="10" y="38" width="88" height="4" rx="2" fill="#d6d4cd"/><rect x="10" y="48" width="50" height="4" rx="2" fill="#d6d4cd"/><rect x="70" y="54" width="36" height="18" rx="3" fill="#8a877f"/>`),
  // a photo: a dusk, a hill
  svgUri(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3f4a"/><stop offset="1" stop-color="#c9b9a0"/></linearGradient></defs><rect width="116" height="80" fill="url(#g)"/><circle cx="82" cy="34" r="9" fill="#e9e6df"/><path d="M0 62 Q30 44 58 58 T116 52 V80 H0 Z" fill="#1c1c1c"/>`),
];
// ?pic=<url> puts a real picture (a shelf file's /file address) in every made-up thing, to see a real shot in a thumb
const DEV_PIC = typeof location !== "undefined" ? new URLSearchParams(location.search).get("pic") : null;
export const DEV_SHELF: ShelfItem[] | null = DEV_CARD ? Array.from({ length: 12 }, (_, i) => ({
  id: `dev-${i}`, kind: (["sol", "shot", "file"] as const)[i % 3], name: ["sol-window.png", "page.png", "dusk.jpg"][i % 3],
  mime: "image/png", at: Date.now() - i * 3_600_000, kept: false, url: DEV_PIC ?? DEV_PICS[i % 3], w: 116, h: 80,
})) : null;
// --- end Grab and Shelf

// --- Anticipate: made-up talk content for shots and for pressing through without the engine
export const DEV_TALK = DEV_CARD === "listening" || DEV_CARD === "anticard" || DEV_CARD === "ask-line-listening" || DEV_CARD?.startsWith("drawer") ? DEV_CARD : null;
export const DEV_WHY: "pressed" | "question" = dev?.get("why") === "question" ? "question" : "pressed";
export const DEV_TALK_CARDS: Record<"pressed" | "question", TalkCard> = {
  pressed: { head: "Relay key stays until the org", bullets: ["docs/provenance.md names it", "Frank asked at 2:10"], source: "docs/provenance.md · the talk" },
  question: { head: "He asked when you'll send it", bullets: ["Frank, 2:31: \"when do I get the key?\"", "You said at 0:40: after the org is set"], source: "the talk · a question to you" },
};
// --- end Anticipate

/** what a press does: send the answer up, flash the ring once; false when it was dropped (the ask changed under it) or
 *  could not leave (act.failed: the socket is down) */
// update / later: the stable card's (Ship #33), handed in by Notch.tsx from cowork/stable.ts
// take / pass / handLater / handOpen: the hand card's (Hand #34), handed in by Notch.tsx from cowork/handed.ts
// shelf / grab / shot / sol / all: Grab and Shelf's rows, handed in by Notch.tsx (the wire is useNotch's)
export function answer(card: Card, b: Btn, liveAsk: Ask | null, act: { hangup: () => void; start: () => void; close: () => void; advance: () => void; failed: () => void; update?: () => void; later?: () => void
  take?: () => void; pass?: () => void; handLater?: () => void; handOpen?: () => void
  shelf?: () => void; grab?: () => void; page?: () => void; shot?: () => void; sol?: () => void; all?: () => void
  anticipate?: () => void; answer?: () => void; next?: () => void; recap?: () => void; who?: () => void; ear?: () => void }): boolean {
  if (!stillShown(card, liveAsk)) return false;   // the card redraws with what is open now
  const faked = !!DEV_CARD;
  if ((b === "allow" || b === "deny") && card.ask) {
    // ordinary tools only (AskUserQuestion / ExitPlanMode show Open): { allow } alone, no always, no note
    if (!faked) { if (!wireSend({ type: "work.perm", sessionId: card.ask.sessionId, id: card.ask.id, allow: b === "allow" })) return fail(act); }
    else window.setTimeout(act.advance, 320);   // a fake moves on as the engine would, after the tint has shown
  } else if (CHOICES.includes(b) && card.ask?.question && card.ask.options) {
    // the free notch: a question's choice, answered as the window's Questions card answers it (one question, one pick)
    const pick = card.ask.options[CHOICES.indexOf(b)];
    if (pick === undefined) return false;
    if (!faked) { if (!wireSend({ type: "work.perm", sessionId: card.ask.sessionId, id: card.ask.id, allow: true, answers: { [card.ask.question]: pick } })) return fail(act); }
    else window.setTimeout(act.advance, 320);
  } else if (b === "open" && card.ask) {
    askOpen({ seat: "work", sessionId: card.ask.sessionId, id: `${card.ask.id}@${Date.now()}`, itemId: card.ask.id });
    act.close();
  } else if (b === "open" && card.ping) {
    if (!faked) seenPing(card.ping.id); else window.setTimeout(act.advance, 320);
    askOpen({ seat: card.ping.seat, sessionId: card.ping.sessionId, id: card.ping.id, itemId: card.ping.id, line: card.ping.line });
  } else if (b === "stop" && card.turn) {
    if (!faked && !wireSend(card.turn.kind === "work" ? { type: "work.stop", sessionId: card.turn.sessionId } : { type: "stop", sessionId: card.turn.sessionId })) return fail(act);
  } else if (b === "update" && card.stable) {
    if (!faked) act.update?.(); else window.setTimeout(act.advance, 320);
  } else if (b === "later" && card.stable) {
    if (!faked) act.later?.();
    act.close();
    return true;   // put off, not answered: no ring
  // --- Hand (#34): Take answers here; Pass needs a line, so the window's line asks it; Later and Open put it off here
  } else if (b === "take" && card.hand) {
    if (!faked) act.take?.(); else window.setTimeout(act.advance, 320);
  } else if ((b === "pass" || b === "later" || b === "open") && card.hand) {
    if (!faked) (b === "pass" ? act.pass : b === "open" ? act.handOpen : act.handLater)?.();
    else if (b !== "later") window.setTimeout(act.advance, 320);
    act.close();
    return true;   // put off or carried to the window, not answered: no ring
  // --- end Hand
  // --- Grab and Shelf: each press opens a row or carries the grab on (the crosshair, the sheet); nothing is answered
  // here, so no ring (a Shot rings when it lands on the shelf)
  // Anticipate's row is the same kind of row: its presses are this page's (Notch.tsx), never an answer to an ask
  } else if (ICONED.has(b) && OWN_ROWS.has(card.kind)) {
    (act as Record<string, (() => void) | undefined>)[b]?.();
    return true;
  // --- end Grab and Shelf
  } else if (b === "hangup") act.hangup();
  else if (b === "start") act.start();
  else return false;
  flashNow("done");   // the ring runs once as the answer leaves
  return true;
}

const fail = (act: { failed: () => void }) => { flashNow("wrong"); act.failed(); return false; };

/** a key while the keys are Sol's (lib.rs notch-key): Return is the safe answer or nothing, Escape closes */
export function onKey(card: Card, key: string, liveAsk: Ask | null, act: Parameters<typeof answer>[3]): string {
  const a = keyAction(card, key);
  if (a === "close") { act.close(); return "close"; }
  if (!a) return "nothing";
  return answer(card, a, liveAsk, act) ? a : "dropped";
}

// keys: Return is Sol's now; the button Return would press carries ⏎. The buttons are keyed by what they answer, so a
// new ask gets fresh buttons, never the last one's pressed look.
// A row of icons only (Grab and Shelf) draws as discs (IconRow); `lead` sits left of them (the shelf's thumbs) and
// `meta` replaces the card's own small text (the shelf's count); onHover says which icon the pointer is on, for the creature
// onPress's downAt (performance.now() at the pointer's down; Anticipate) lets a hold be told from a press
// lit (Anticipate, sitting 2): that pill carries the red dot and `label` as its name (a talk is on)
export function Buttons({ card, keys, onPress, onHover, lead, meta, lit }: { card: Card; keys: boolean; onPress: (b: Btn, downAt?: number) => void
  onHover?: (b: Btn | null, el: HTMLElement | null) => void; lead?: ReactNode; meta?: string; lit?: { b: Btn; label: string } | null }) {
  if (!card.buttons.length) return null;
  const ret = keys ? keyAction(card, "Return") : null;
  const icons = card.buttons.every((b) => ICONED.has(b));
  const m = meta ?? card.meta;
  return (
    <div className={`card-btns${lead ? " wide" : ""}`} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
      <div className="card-row">
        {lead}
        {icons
          ? <IconRow rowKey={`${cardKey(card)}:${card.buttons.join("+")}`} btns={card.buttons} onPress={onPress} onHover={onHover} lit={lit} />
          : card.buttons.map((b, i) => <Button key={`${cardKey(card)}-${b}`} b={b} first={i === 0} ret={ret === b} held={DEV_PRESS === i} onPress={() => onPress(b)} />)}
      </div>
      {m && <span className="card-meta">{m}</span>}
    </div>
  );
}

// ---- Grab and Shelf: the icons, the row that sinks and rises, the disc, the thumbs ----
// the motion study's SVGs (ICONS), in currentColor so the hovered disc turns them black
export const ICON: Partial<Record<Btn, ReactNode>> = {
  grab: <svg viewBox="0 0 16 16" aria-hidden><path d="M2 5V3a1 1 0 0 1 1-1h2M11 2h2a1 1 0 0 1 1 1v2M14 11v2a1 1 0 0 1-1 1h-2M5 14H3a1 1 0 0 1-1-1v-2" /><circle cx="8" cy="8" r="2.2" /></svg>,
  shelf: <svg viewBox="0 0 16 16" aria-hidden><path d="M2 10h12M3 10V5.5M13 10V5.5M2 10l1.2 3h9.6L14 10" /><path d="M6 7.5h4" /></svg>,
  page: <svg viewBox="0 0 16 16" aria-hidden><rect x="3.5" y="1.5" width="9" height="13" rx="1.5" /><path d="M6 4.5h4M6 7h4M8 9v3.2M6.4 10.8L8 12.4l1.6-1.6" /></svg>,
  shot: <svg viewBox="0 0 16 16" aria-hidden><rect x="2" y="4" width="12" height="9" rx="2" /><circle cx="8" cy="8.5" r="2.4" /><path d="M6 4l1-1.5h2L10 4" /></svg>,
  sol: <svg viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="5.5" /><circle cx="6.2" cy="7.5" r=".9" fill="currentColor" stroke="none" /><circle cx="9.8" cy="7.5" r=".9" fill="currentColor" stroke="none" /></svg>,
  all: <svg viewBox="0 0 16 16" aria-hidden><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></svg>,
  // Anticipate (mock.html's own paths): an ear (the outer curl, the inner fold); Answer a bubble with a plus; Say next
  // an arrow to a bar; Recap three lines, the last short; Who a head and shoulders. The stop is the same ear, lit.
  anticipate: <svg viewBox="0 0 16 16" aria-hidden><path d="M4 6.7a4.7 4.7 0 1 1 8.7 2.4 6.7 6.7 0 0 1-1.3 1.3 5.3 5.3 0 0 0-1.3 2 3 3 0 0 1-4.5.9" /><path d="M6.7 6.7a2 2 0 1 1 3.3 1.5" /></svg>,
  answer: <svg viewBox="0 0 16 16" aria-hidden><path d="M13.5 7.5c0 2.8-2.5 4.8-5.5 4.8-.8 0-1.6-.1-2.3-.4L2.5 13l.9-2.5C2.8 9.6 2.5 8.6 2.5 7.5c0-2.8 2.5-4.8 5.5-4.8s5.5 2 5.5 4.8z" /><path d="M8 5.6v3.8M6.1 7.5h3.8" /></svg>,
  next: <svg viewBox="0 0 16 16" aria-hidden><path d="M2.5 8h8.5M8 4.5L11.5 8 8 11.5" /><path d="M13.5 3.5v9" /></svg>,
  recap: <svg viewBox="0 0 16 16" aria-hidden><path d="M3 4h10M3 8h10M3 12h6" /></svg>,
  who: <svg viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="5.5" r="2.6" /><path d="M3 13.8c.7-2.6 2.7-3.9 5-3.9s4.3 1.3 5 3.9" /></svg>,
};
ICON.ear = ICON.anticipate;
/** Anticipate: a hold this long on Answer (or on Fn) adds the front window's picture */
export const HOLD_MS = 500;
const STAGGER = 70, SINK_MS = 300;
const SINK = { k: 330, z: 0.95 };   // CFG.away's numbers: about 240 ms, no settle
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** one set of discs; when the set changes, the old ones stay a moment over the same spot, sinking, and the new rise */
function IconRow({ rowKey, btns, onPress, onHover, lit }: { rowKey: string; btns: Btn[]; onPress: (b: Btn, downAt?: number) => void; onHover?: (b: Btn | null, el: HTMLElement | null) => void
  lit?: { b: Btn; label: string } | null }) {
  const last = useRef({ k: rowKey, btns });
  const [gone, setGone] = useState<{ k: string; btns: Btn[] } | null>(null);
  useLayoutEffect(() => {
    if (last.current.k === rowKey) return;
    const was = last.current;
    last.current = { k: rowKey, btns };
    setGone(was);
    const t = window.setTimeout(() => setGone((g) => (g === was ? null : g)), SINK_MS);
    return () => window.clearTimeout(t);
  }, [rowKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ib-row">
      {btns.map((b, i) => [
        b === "ear" && <span key={`${rowKey}-sep`} className="ib-sep" aria-hidden />,   // Anticipate: a hairline before the stop
        <IconButton key={`${rowKey}-${b}`} b={b} delay={i * STAGGER} held={DEV_PRESS === i} onPress={(at) => onPress(b, at)} onHover={onHover} label={lit?.b === b ? lit.label : undefined} />,
      ])}
      {gone && <div className="ib-gone" aria-hidden>{gone.btns.map((b) => [
        b === "ear" && <span key={`${gone.k}-sep`} className="ib-sep" />,
        <IconButton key={`${gone.k}-${b}`} b={b} delay={0} leaving held={false} onPress={() => {}} />,
      ])}</div>}
    </div>
  );
}

function IconButton({ b, delay, leaving, held, onPress, onHover, label }: { b: Btn; delay: number; leaving?: boolean; held: boolean; onPress: (downAt?: number) => void; onHover?: (b: Btn | null, el: HTMLElement | null) => void
  label?: string }) {
  const ref = useRef<HTMLButtonElement>(null), disc = useRef<HTMLSpanElement>(null), name = useRef<HTMLSpanElement>(null);
  const hovered = useRef(false);
  // Anticipate: when the pointer went down, and the name's word while Answer is held long enough to add the screen
  const downAt = useRef<number | undefined>(undefined), holdT = useRef<number | undefined>(undefined);
  // only Answer has a hold: the other names are React's (the lit pill's changes every second)
  const holdWord = (on: boolean) => { if (b === "answer" && name.current) name.current.textContent = on ? "Answer with the screen" : LABEL[b]; };
  useEffect(() => () => window.clearTimeout(holdT.current), []);
  const sp = useRef<{ lift: Spring; squash: Spring; nm: Spring; rise: Spring; sink: Spring } | null>(null);
  if (!sp.current) {
    // the disc: the capsule's lift and squash, from its foot
    const putDisc = () => {
      const el = disc.current, s = sp.current;
      if (!el || !s) return;
      const l = s.lift.v, q = s.squash.v;
      el.style.translate = l || q ? `0 ${(-1.5 * l + 0.8 * q).toFixed(2)}px` : "";
      el.style.scale = l || q ? `${((1 + 0.04 * l) * (1 + 0.05 * q)).toFixed(4)} ${((1 + 0.04 * l) * (1 - 0.12 * q)).toFixed(4)}` : "";
    };
    // the name: unfurls above the disc (6 px rise, .9 → 1); above, so it never covers the neighbouring disc
    const putName = () => {
      const el = name.current, s = sp.current;
      if (!el || !s) return;
      const v = s.nm.v;
      el.style.opacity = String(clamp01(v));
      el.style.translate = `0 ${(6 * (1 - v)).toFixed(2)}px`;
      el.style.scale = String((0.9 + 0.1 * v).toFixed(4));
    };
    // the whole button: rising in (from 10 px below, .9) or sinking out (8 px up, .9)
    const putMove = () => {
      const el = ref.current, s = sp.current;
      if (!el || !s) return;
      const r = s.rise.v, k = s.sink.v;
      el.style.opacity = String(clamp01(r) * (1 - clamp01(k)));
      el.style.translate = `0 ${(10 * (1 - r) - 8 * k).toFixed(2)}px`;
      el.style.scale = String(((0.9 + 0.1 * r) * (1 - 0.1 * k)).toFixed(4));
    };
    sp.current = { lift: new Spring(0, CFG.pop, putDisc), squash: new Spring(held ? 1 : 0, CFG.press, putDisc), nm: new Spring(0, CFG.snap, putName),
      rise: new Spring(leaving ? 1 : 0, CFG.slide, putMove), sink: new Spring(0, SINK, putMove) };
  }
  useLayoutEffect(() => {
    const s = sp.current!;
    if (leaving) s.sink.to(1);
    else { s.rise.set(0); s.rise.to(1, { delay }); }
    if (held) { s.squash.set(1); s.nm.set(1); ref.current?.classList.add("on"); }
    return () => { s.lift.stop(); s.squash.stop(); s.nm.stop(); s.rise.stop(); s.sink.stop(); if (hovered.current) onHover?.(null, null); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const hover = (on: boolean) => {
    const s = sp.current!;
    hovered.current = on;
    ref.current?.classList.toggle("on", on || held);
    s.nm.to(on || held ? 1 : 0, { cfg: CFG.snap });
    s.lift.to(on ? 1 : 0, { cfg: CFG.pop });
    if (!on && !held) s.squash.to(0, { cfg: CFG.pop });
    onHover?.(on ? b : null, on ? ref.current : null);
  };
  return (
    <button
      ref={ref}
      type="button"
      data-nopress
      className={`ibtn${b === "ear" ? " lit" : ""}${label ? " dot" : ""}`}
      aria-label={label ?? LABEL[b]}
      tabIndex={leaving ? -1 : undefined}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => { hover(false); window.clearTimeout(holdT.current); holdWord(false); downAt.current = undefined; }}
      onPointerDown={(e) => {
        e.stopPropagation(); sp.current!.squash.to(1, { cfg: CFG.press });
        downAt.current = performance.now();
        if (b === "answer") { window.clearTimeout(holdT.current); holdT.current = window.setTimeout(() => holdWord(true), HOLD_MS); }
      }}
      onPointerUp={() => { if (!held) sp.current!.squash.to(0, { cfg: CFG.pop }); window.clearTimeout(holdT.current); }}
      onClick={(e) => {
        e.stopPropagation(); window.dispatchEvent(new Event("sol-greet"));
        const at = downAt.current; downAt.current = undefined;
        window.setTimeout(() => holdWord(false), 600);
        onPress(at);
      }}
    >
      <span className="ib-disc" ref={disc}>{ICON[b]}</span>
      <span className="ib-name" ref={name} aria-hidden>{label ?? LABEL[b]}</span>
    </button>
  );
}

/** the shelf's last three things, newest first, each dragged out as its URL (a real file drag is sitting 2); they rise
 *  in with the row. The drag carries a mark of its own so the notch does not take its own thumb as a drop */
export const SHELF_DRAG = "application/x-sol-shelf";
export function Thumbs({ items }: { items: ShelfItem[] }) {
  if (!items.length) return null;
  return <div className="thumbs">{items.slice(0, 3).map((it, i) => <Thumb key={it.id} it={it} delay={i * STAGGER} />)}</div>;
}
// crossOrigin: a bare <img> sends no Origin, and the engine's door reads localhost:1420 → 127.0.0.1 as cross-site and
// refuses it (door.ts); with the page's origin on the request the door opens and the picture loads (the sheet does the same)
function Thumb({ it, delay }: { it: ShelfItem; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const sp = useRef<Spring | null>(null);
  if (!sp.current) sp.current = new Spring(0, CFG.slide, (v) => {
    const el = ref.current;
    if (!el) return;
    el.style.opacity = String(clamp01(v));
    el.style.translate = `0 ${(10 * (1 - v)).toFixed(2)}px`;
    el.style.scale = String((0.9 + 0.1 * v).toFixed(4));
  });
  useLayoutEffect(() => { const s = sp.current!; s.set(0); s.to(1, { delay }); return () => s.stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const image = it.mime.startsWith("image/");
  const ext = (it.name.split(".").pop() ?? "").slice(0, 4);
  return (
    <div
      ref={ref}
      className="thumb"
      title={it.name}
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData("text/uri-list", it.url);
        e.dataTransfer.setData("text/plain", it.url);
        e.dataTransfer.setData(SHELF_DRAG, it.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >{image ? <img src={it.url} alt="" draggable={false} crossOrigin="anonymous" /> : <span>{ext || it.kind}</span>}</div>
  );
}
// ---- end Grab and Shelf

// ---- The eye (#253): the mark in the quiet card's corner ----
// an eye, open; closed: the lid down, its lashes, and a stroke across it
export const EYE_OPEN = <svg viewBox="0 0 16 16" aria-hidden><path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2.1" /></svg>;
export const EYE_SHUT = <svg viewBox="0 0 16 16" aria-hidden><path d="M1.5 7.2S3.9 10.8 8 10.8s6.5-3.6 6.5-3.6M4.3 9.6l-1 1.5M8 10.8v1.8M11.7 9.6l1 1.5" /><path d="M2.5 2.5l11 11" /></svg>;

/** the eye: a press flicks it; held HOLD_MS it calls `onHold` instead (the private row) and that press flicks nothing.
 *  `held`: the row is open, the eye is drawn filled. Its own pointer handling, so a press never reaches the slab (the call) */
export function EyeMark({ invisible, held, onFlick, onHold }: { invisible: boolean; held?: boolean; onFlick: () => void; onHold?: () => void }) {
  const [on, setOn] = useState(false);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  // the hold: a timer from the pointer going down; when it fires, the click that follows is the hold's, not a flick
  const holdT = useRef<number | undefined>(undefined), wasHold = useRef(false);
  useEffect(() => () => window.clearTimeout(holdT.current), []);
  return (
    <button
      type="button"
      data-nopress
      className={`eye${invisible ? " shut" : ""}${on ? " on" : ""}${held ? " held" : ""}`}
      aria-label={invisible ? "Sol invisible to screen share" : "Sol visible to screen share"}
      aria-pressed={invisible}
      aria-expanded={onHold ? !!held : undefined}
      onPointerEnter={() => setOn(true)}
      onPointerLeave={() => { setOn(false); window.clearTimeout(holdT.current); }}
      onPointerDown={(e) => {
        stop(e); wasHold.current = false; window.clearTimeout(holdT.current);
        if (onHold) holdT.current = window.setTimeout(() => { wasHold.current = true; onHold(); }, HOLD_MS);
      }}
      onPointerUp={(e) => { stop(e); window.clearTimeout(holdT.current); }}
      onMouseDown={stop} onMouseUp={stop}
      onClick={(e) => { e.stopPropagation(); if (wasHold.current) { wasHold.current = false; return; } onFlick(); }}
    >{invisible ? EYE_SHUT : EYE_OPEN}</button>
  );
}

// ---- The clean screen (#253): the row the eye's hold opens under the card ----
/** an app on the private list as the engine keeps it (engine/src/private.ts) */
export type PrivateApp = { name: string; bundle: string; on: boolean };
/** made up for ?card=private: the engine's own first list */
export const DEV_PRIVATE: PrivateApp[] | null = DEV_CARD === "private" ? [
  { name: "WeChat", bundle: "com.tencent.xinWeChat", on: true }, { name: "WhatsApp", bundle: "net.whatsapp.WhatsApp", on: true },
  { name: "Claude", bundle: "com.anthropic.claudefordesktop", on: true }, { name: "ChatGPT", bundle: "com.openai.chat", on: true },
] : null;
const TICK = <svg viewBox="0 0 16 16" aria-hidden><path d="M3.5 8.4l2.9 2.8 6.1-6.4" /></svg>;
const SCREEN = <svg viewBox="0 0 16 16" aria-hidden><rect x="2" y="3" width="12" height="8.5" rx="1.5" /><path d="M6 14h4M8 11.5V14" /><path d="M5.5 7.2l1.7 1.6 3.3-3.3" /></svg>;
/** the private list under the card: a chip per app (ticked = cut out of the clean screen; a press ticks or unticks),
 *  then "Clean screen" (or "Close clean screen" while it is open). `apps` null: the engine has not answered yet.
 *  Its own pointer handling, so a press never reaches the slab (the call) */
export function PrivateRow({ apps, clean, busy, top, rowRef, onTick, onClean }: { apps: PrivateApp[] | null; clean: boolean; busy: boolean; top: number
  rowRef?: React.Ref<HTMLDivElement>; onTick: (a: PrivateApp) => void; onClean: () => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="priv-row" ref={rowRef} style={{ top }} data-nopress onPointerDown={stop} onPointerUp={stop} onMouseDown={stop} onMouseUp={stop} onClick={stop}>
      <h5><span>private · cut out of the clean screen</span><span className="r">a press unticks</span></h5>
      <div className="priv-chips">
        {apps === null ? <span className="priv-wait">reading the list…</span>
          : apps.map((a) => (
            <button key={a.bundle} type="button" className={`chip${a.on ? "" : " off"}`} aria-pressed={a.on} title={a.bundle}
              onClick={(e) => { e.stopPropagation(); onTick(a); }}>{a.on ? TICK : <i className="chip-dot" aria-hidden />}{a.name}</button>
          ))}
      </div>
      <hr />
      <button type="button" className={`chip go${clean ? " open" : ""}`} disabled={busy} onClick={(e) => { e.stopPropagation(); onClean(); }}>
        {SCREEN}{busy ? "Opening…" : clean ? "Close clean screen" : "Clean screen"}</button>
    </div>
  );
}
// ---- end The clean screen
// ---- end The eye

// ---- Anticipate: the card that drops under the notch ----
/** a card under the notch: six words, two bullets, where it came from, and how long it took (`secs`: null until drawn) */
export function TalkDrop({ card, why, secs, inside, leaving, top, boxRef, onOpen, q }: { card: TalkCard; why: "pressed" | "question" | "name"; secs: number | null
  inside: boolean; leaving: boolean; top?: number; boxRef?: React.Ref<HTMLDivElement>; onOpen?: () => void; q?: string }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div ref={boxRef} className={`talk-drop${inside ? " inside" : ""}${leaving ? " leaving" : ""}${onOpen ? " opens" : ""}`} style={top !== undefined ? { top } : undefined}
      data-nopress onPointerDown={stop} onPointerUp={stop} onMouseDown={stop} onMouseUp={stop}
      onClick={(e) => { e.stopPropagation(); onOpen?.(); }} title={onOpen ? "Open the talk in the window" : undefined}>
      {q && <p className="talk-q">🌐 {q}</p>}
      <h3><span className="head">{card.head}</span>{why !== "pressed" && <span className="spoke"><i />spoke up</span>}</h3>
      {card.bullets.length > 0 && <ul>{card.bullets.slice(0, 2).map((b, i) => <li key={i}>{b}</li>)}</ul>}
      <div className="src"><span>{card.source}</span><span>{secs === null ? "" : `${secs.toFixed(1)} s`}</span></div>
    </div>
  );
}
// ---- end Anticipate

// ---- The free notch (PRD-2 part 7): a session's line, its small buttons, the pills beside it, the count of folds ----
/** under the line: the card's own buttons small (the choices, Allow · Deny, Open or Stop) and its meta, dim */
export function LineBtns({ card, keys, onPress }: { card: Card; keys: boolean; onPress: (b: Btn) => void }) {
  const ret = keys ? keyAction(card, "Return") : null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="fl-row" onClick={stop} onMouseDown={stop} onMouseUp={stop}>
      {card.buttons.map((b, i) => <Button key={`${cardKey(card)}-${b}`} b={b} first={i === 0 && !CHOICES.includes(b)} ret={ret === b} held={DEV_PRESS === i}
        label={choiceLabel(card, b)} small onPress={() => onPress(b)} />)}
      {card.meta && <span className="fl-meta">{card.meta}</span>}
    </div>
  );
}
const PILLS: Btn[] = ["shelf", "grab", "anticipate"];
/** the quiet card's pills, at the right of a session's line; they work as on the quiet card (Notch.tsx folds the line
 *  before Shelf or Grab opens its row) */
export function LinePills({ onPress, onHover, lit }: { onPress: (b: Btn, downAt?: number) => void; onHover?: (b: Btn | null, el: HTMLElement | null) => void; lit?: { b: Btn; label: string } | null }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="card-btns" onClick={stop} onMouseDown={stop} onMouseUp={stop}>
      <div className="card-row"><IconRow rowKey="line-pills" btns={PILLS} onPress={onPress} onHover={onHover} lit={lit} /></div>
    </div>
  );
}
/** what waits folded, beside the mark: one red dot and the number; a press unfolds the newest */
export function FoldCount({ n, onUnfold }: { n: number; onUnfold: () => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <button type="button" data-nopress className="fl-count" aria-label={`${n} waiting: show the newest`} title="show what waits"
      onPointerDown={stop} onPointerUp={stop} onMouseDown={stop} onMouseUp={stop}
      onClick={(e) => { e.stopPropagation(); onUnfold(); }}><i aria-hidden />{n}</button>
  );
}
// ---- end The free notch

export function Button({ b, first, ret, held, onPress, label, small }: { b: Btn; first: boolean; ret: boolean; held: boolean; onPress: () => void; label?: string; small?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pressed, setPressed] = useState(held);
  const sp = useRef<{ lift: Spring; squash: Spring } | null>(null);
  if (!sp.current) {
    const put = () => {
      const el = ref.current, s = sp.current;
      if (!el || !s) return;
      const l = s.lift.v, q = s.squash.v;
      el.style.translate = l || q ? `0 ${(-1.5 * l + 0.8 * q).toFixed(2)}px` : "";
      el.style.scale = l || q ? `${((1 + 0.04 * l) * (1 + 0.05 * q)).toFixed(4)} ${((1 + 0.04 * l) * (1 - 0.12 * q)).toFixed(4)}` : "";
    };
    sp.current = { lift: new Spring(0, CFG.pop, put), squash: new Spring(held ? 1 : 0, CFG.press, put) };
  }
  useEffect(() => { if (held) sp.current!.squash.set(1); const s = sp.current!; return () => { s.lift.stop(); s.squash.stop(); }; }, [held]);
  const release = () => { if (!held) sp.current!.squash.to(0, { cfg: CFG.pop }); };
  return (
    <button
      ref={ref}
      type="button"
      data-nopress
      data-tint={TINT[b] || undefined}
      className={`cbtn ${first ? "first" : ""} ${pressed ? "pressed" : ""}${small ? " fl-btn" : ""}`}
      onPointerEnter={() => sp.current!.lift.to(1, { cfg: CFG.pop })}
      onPointerLeave={() => { sp.current!.lift.to(0, { cfg: CFG.pop }); release(); if (!held) setPressed(false); }}
      onPointerDown={(e) => { e.stopPropagation(); sp.current!.squash.to(1, { cfg: CFG.press }); setPressed(true); }}
      onPointerUp={release}
      onClick={(e) => { e.stopPropagation(); onPress(); window.setTimeout(() => { if (!held) setPressed(false); }, 420); }}
    >{label ?? LABEL[b]}{ret && <span className="ret" aria-hidden>⏎</span>}</button>
  );
}
