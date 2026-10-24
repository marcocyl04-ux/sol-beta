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
// Dev only: ?card=ask|ask3|askping|question|plan|turn|call|ping|unplugged|starting|stable|handed|review|plain fakes the card's content (as ?creature=
// fakes the state), and ?press=<n> holds the n-th button mid-press, for shots. Pressing a faked ask moves on to the next.
import { useEffect, useRef, useState } from "react";
import { cardNow, flashNow } from "../creature/state";
import { wireSend, askOpen, seen as seenPing } from "../renovation";
import { CFG, Spring } from "../motion";
import { LABEL, TINT, cardKey, cardOf, keyAction, stillShown, type Ask, type Btn, type Card, type CardIn, type PingIn, type StableIn, type Turn } from "./answer";
// --- Hand (#34)
import type { HandIn } from "./answer";
// --- end Hand

export type { Card, CardIn };

const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
export const DEV_CARD = dev?.get("card") ?? null;
const DEV_PRESS = dev?.get("press") != null ? Number(dev.get("press")) : -1;

const devAsk = (n: number, of: number, i: number): Ask => [
  { id: "perm:dev-edit", sessionId: "dev-work", seat: "claude", tool: "Edit", title: "Claude wants to edit Notch.tsx", path: "/Users/marcol04/computer/personal/projects/ecosystem/sol/mac/src/notch/Notch.tsx", n, of },
  { id: "perm:dev-bash", sessionId: "dev-work-2", seat: "claude", tool: "Bash", title: "Claude wants to run: build the notch page", n, of },
  { id: "perm:dev-write", sessionId: "dev-work-3", seat: "claude", tool: "Write", title: "Claude wants to write RUBRIC.md", path: "/x/design/notch-buttons/RUBRIC.md", n, of },
][i % 3];
const DEV_TURN: Turn = { seat: "claude", sessionId: "dev-work", title: "ecosystem", kind: "work" };
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
    default: return null;
  }
}

/** the card for this moment: the live inputs, or the dev fake over them; `step` moves a faked ask on after a press */
export function useCard(c: CardIn): { card: Card; advance: () => void; liveAsk: () => Ask | null } {
  const [step, setStep] = useState(0);
  const f = fake(DEV_CARD, step);
  const input: CardIn = f ? { ...c, ask: null, turn: null, ping: null, call: false, unplugged: false, starting: false, stable: null, hand: null, filing: null, ...f } : c;
  const card = cardOf(input);
  const liveAsk = () => (f ? (fake(DEV_CARD, step)?.ask ?? null) : (cardNow().ask as Ask | null));
  return { card, advance: () => setStep((s) => s + 1), liveAsk };
}

/** what a press does: send the answer up, flash the ring once; false when it was dropped (the ask changed under it) or
 *  could not leave (act.failed: the socket is down) */
// update / later: the stable card's (Ship #33), handed in by Notch.tsx from cowork/stable.ts
// take / pass / handLater / handOpen: the hand card's (Hand #34), handed in by Notch.tsx from cowork/handed.ts
// file: the plain card's File it (#119), handed in by Notch.tsx from fileit.ts
export function answer(card: Card, b: Btn, liveAsk: Ask | null, act: { hangup: () => void; start: () => void; close: () => void; advance: () => void; failed: () => void; update?: () => void; later?: () => void
  take?: () => void; pass?: () => void; handLater?: () => void; handOpen?: () => void
  file?: () => void }): boolean {
  if (!stillShown(card, liveAsk)) return false;   // the card redraws with what is open now
  const faked = !!DEV_CARD;
  if ((b === "allow" || b === "deny") && card.ask) {
    // ordinary tools only (AskUserQuestion / ExitPlanMode show Open): { allow } alone, no always, no note
    if (!faked) { if (!wireSend({ type: "work.perm", sessionId: card.ask.sessionId, id: card.ask.id, allow: b === "allow" })) return fail(act); }
    else window.setTimeout(act.advance, 320);   // a fake moves on as the engine would, after the tint has shown
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
  // --- File it (#119): the shot now, the words in the window's line; carried there, not answered: no ring
  } else if (b === "file" && card.kind === "plain") {
    if (!faked) act.file?.();
    return true;
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
// new ask gets fresh buttons, never the last one's pressed look
export function Buttons({ card, keys, onPress }: { card: Card; keys: boolean; onPress: (b: Btn) => void }) {
  if (!card.buttons.length) return null;
  const ret = keys ? keyAction(card, "Return") : null;
  return (
    <div className="card-btns" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
      <div className="card-row">
        {card.buttons.map((b, i) => <Button key={`${cardKey(card)}-${b}`} b={b} first={i === 0} ret={ret === b} held={DEV_PRESS === i} onPress={() => onPress(b)} />)}
      </div>
      {card.meta && <span className="card-meta">{card.meta}</span>}
    </div>
  );
}

function Button({ b, first, ret, held, onPress }: { b: Btn; first: boolean; ret: boolean; held: boolean; onPress: () => void }) {
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
      className={`cbtn ${first ? "first" : ""} ${pressed ? "pressed" : ""}`}
      onPointerEnter={() => sp.current!.lift.to(1, { cfg: CFG.pop })}
      onPointerLeave={() => { sp.current!.lift.to(0, { cfg: CFG.pop }); release(); if (!held) setPressed(false); }}
      onPointerDown={(e) => { e.stopPropagation(); sp.current!.squash.to(1, { cfg: CFG.press }); setPressed(true); }}
      onPointerUp={release}
      onClick={(e) => { e.stopPropagation(); onPress(); window.setTimeout(() => { if (!held) setPressed(false); }, 420); }}
    >{LABEL[b]}{ret && <span className="ret" aria-hidden>⏎</span>}</button>
  );
}
