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
// Dev only: ?card=ask|ask3|askping|question|plan|turn|call|ping|unplugged|starting|stable|handed|review|plain|grabbing|shelf
// fakes the card's content (as ?creature= fakes the state; grabbing and shelf open those rows, with three made-up
// things on the shelf), and ?press=<n> holds the n-th button mid-press, for shots. Pressing a faked ask moves on to the next.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cardNow, flashNow } from "../creature/state";
import { wireSend, askOpen, seen as seenPing } from "../renovation";
import { CFG, Spring } from "../motion";
import { ICONED, LABEL, TINT, cardKey, cardOf, keyAction, stillShown, type Ask, type Btn, type Card, type CardIn, type PingIn, type StableIn, type Turn } from "./answer";
// --- Hand (#34)
import type { HandIn } from "./answer";
// --- end Hand
import type { ShelfItem } from "./useNotch";

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
    // Grab and Shelf: the rows are the page's own state (Notch.tsx starts them from DEV_CARD), so a press still moves them
    case "grabbing": case "shelf": return {};
    default: return null;
  }
}

/** the card for this moment: the live inputs, or the dev fake over them; `step` moves a faked ask on after a press */
export function useCard(c: CardIn): { card: Card; advance: () => void; liveAsk: () => Ask | null } {
  const [step, setStep] = useState(0);
  const f = fake(DEV_CARD, step);
  const input: CardIn = f ? { ...c, ask: null, turn: null, ping: null, call: false, unplugged: false, starting: false, stable: null, hand: null, ...f } : c;
  const card = cardOf(input);
  const liveAsk = () => (f ? (fake(DEV_CARD, step)?.ask ?? null) : (cardNow().ask as Ask | null));
  return { card, advance: () => setStep((s) => s + 1), liveAsk };
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

/** what a press does: send the answer up, flash the ring once; false when it was dropped (the ask changed under it) or
 *  could not leave (act.failed: the socket is down) */
// update / later: the stable card's (Ship #33), handed in by Notch.tsx from cowork/stable.ts
// take / pass / handLater / handOpen: the hand card's (Hand #34), handed in by Notch.tsx from cowork/handed.ts
// shelf / grab / shot / sol / all: Grab and Shelf's rows, handed in by Notch.tsx (the wire is useNotch's)
export function answer(card: Card, b: Btn, liveAsk: Ask | null, act: { hangup: () => void; start: () => void; close: () => void; advance: () => void; failed: () => void; update?: () => void; later?: () => void
  take?: () => void; pass?: () => void; handLater?: () => void; handOpen?: () => void
  shelf?: () => void; grab?: () => void; page?: () => void; shot?: () => void; sol?: () => void; all?: () => void }): boolean {
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
  // --- Grab and Shelf: each press opens a row or carries the grab on (the crosshair, the sheet); nothing is answered
  // here, so no ring (a Shot rings when it lands on the shelf)
  } else if (ICONED.has(b) && (card.kind === "plain" || card.kind === "grabbing" || card.kind === "shelf")) {
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
export function Buttons({ card, keys, onPress, onHover, lead, meta }: { card: Card; keys: boolean; onPress: (b: Btn) => void
  onHover?: (b: Btn | null, el: HTMLElement | null) => void; lead?: ReactNode; meta?: string }) {
  if (!card.buttons.length) return null;
  const ret = keys ? keyAction(card, "Return") : null;
  const icons = card.buttons.every((b) => ICONED.has(b));
  const m = meta ?? card.meta;
  return (
    <div className={`card-btns${lead ? " wide" : ""}`} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
      <div className="card-row">
        {lead}
        {icons
          ? <IconRow rowKey={`${cardKey(card)}:${card.buttons.join("+")}`} btns={card.buttons} onPress={onPress} onHover={onHover} />
          : card.buttons.map((b, i) => <Button key={`${cardKey(card)}-${b}`} b={b} first={i === 0} ret={ret === b} held={DEV_PRESS === i} onPress={() => onPress(b)} />)}
      </div>
      {m && <span className="card-meta">{m}</span>}
    </div>
  );
}

// ---- Grab and Shelf: the icons, the row that sinks and rises, the disc, the thumbs ----
// the motion study's SVGs (ICONS), in currentColor so the hovered disc turns them black
const ICON: Partial<Record<Btn, ReactNode>> = {
  grab: <svg viewBox="0 0 16 16" aria-hidden><path d="M2 5V3a1 1 0 0 1 1-1h2M11 2h2a1 1 0 0 1 1 1v2M14 11v2a1 1 0 0 1-1 1h-2M5 14H3a1 1 0 0 1-1-1v-2" /><circle cx="8" cy="8" r="2.2" /></svg>,
  shelf: <svg viewBox="0 0 16 16" aria-hidden><path d="M2 10h12M3 10V5.5M13 10V5.5M2 10l1.2 3h9.6L14 10" /><path d="M6 7.5h4" /></svg>,
  page: <svg viewBox="0 0 16 16" aria-hidden><rect x="3.5" y="1.5" width="9" height="13" rx="1.5" /><path d="M6 4.5h4M6 7h4M8 9v3.2M6.4 10.8L8 12.4l1.6-1.6" /></svg>,
  shot: <svg viewBox="0 0 16 16" aria-hidden><rect x="2" y="4" width="12" height="9" rx="2" /><circle cx="8" cy="8.5" r="2.4" /><path d="M6 4l1-1.5h2L10 4" /></svg>,
  sol: <svg viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="5.5" /><circle cx="6.2" cy="7.5" r=".9" fill="currentColor" stroke="none" /><circle cx="9.8" cy="7.5" r=".9" fill="currentColor" stroke="none" /></svg>,
  all: <svg viewBox="0 0 16 16" aria-hidden><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></svg>,
};
const STAGGER = 70, SINK_MS = 300;
const SINK = { k: 330, z: 0.95 };   // CFG.away's numbers: about 240 ms, no settle
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** one set of discs; when the set changes, the old ones stay a moment over the same spot, sinking, and the new rise */
function IconRow({ rowKey, btns, onPress, onHover }: { rowKey: string; btns: Btn[]; onPress: (b: Btn) => void; onHover?: (b: Btn | null, el: HTMLElement | null) => void }) {
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
      {btns.map((b, i) => <IconButton key={`${rowKey}-${b}`} b={b} delay={i * STAGGER} held={DEV_PRESS === i} onPress={() => onPress(b)} onHover={onHover} />)}
      {gone && <div className="ib-gone" aria-hidden>{gone.btns.map((b) => <IconButton key={`${gone.k}-${b}`} b={b} delay={0} leaving held={false} onPress={() => {}} />)}</div>}
    </div>
  );
}

function IconButton({ b, delay, leaving, held, onPress, onHover }: { b: Btn; delay: number; leaving?: boolean; held: boolean; onPress: () => void; onHover?: (b: Btn | null, el: HTMLElement | null) => void }) {
  const ref = useRef<HTMLButtonElement>(null), disc = useRef<HTMLSpanElement>(null), name = useRef<HTMLSpanElement>(null);
  const hovered = useRef(false);
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
      className="ibtn"
      aria-label={LABEL[b]}
      tabIndex={leaving ? -1 : undefined}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onPointerDown={(e) => { e.stopPropagation(); sp.current!.squash.to(1, { cfg: CFG.press }); }}
      onPointerUp={() => { if (!held) sp.current!.squash.to(0, { cfg: CFG.pop }); }}
      onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new Event("sol-greet")); onPress(); }}
    >
      <span className="ib-disc" ref={disc}>{ICON[b]}</span>
      <span className="ib-name" ref={name} aria-hidden>{LABEL[b]}</span>
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
