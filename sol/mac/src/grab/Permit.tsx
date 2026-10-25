// The permissions guide: when a grab needs a macOS permission Sol does not have, the creature walks you through it
// instead of the sheet printing a sentence (the way Wispr Flow does it). One card in the middle of the veil, in the
// where-to list's look (--surface on a --line hairline, radius --r-l), the creature sitting at its left edge: what the
// permission is called, why Sol needs it, three steps in plain words, a filled pearl capsule that opens the right
// System Settings pane (for Accessibility macOS's own prompt first, so a freshly built Sol gets its own row) and a quiet
// "Not now".
//
// While the card shows it asks every 800 ms whether the permission is there yet (`granted` in wire.ts). The moment it
// is, the card says thank you, the creature nods, and after a beat the grab that was interrupted goes on by itself.
// Opening Settings puts the sheet at the normal window level so Settings can come in front of it (permit.rs); when
// the card goes (granted, Not now, Esc) the sheet is raised again and Settings hidden (permitBack).
// Two permissions use it: Accessibility (Page turns the wheel in another app; the app's own, permit_state) and Screen
// Recording (the pictures; the engine's, which macOS lists as "node", so the test is the caller's: a fresh take that
// is not blank). Esc is the sheet's own (it leaves); Return presses Open.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CFG, enter } from "../motion";
import { BEAD, type Bead } from "./Bead";
import { granted, permitBack, permitOpen, type Permission } from "./wire";

const WORDS: Record<Permission, { head: string; title: string; why: string; steps: string[]; open: string }> = {
  accessibility: {
    head: "Accessibility",
    title: "Let Sol move the page",
    why: "Page scrolls the window for you. macOS calls that Accessibility.",
    steps: [
      "Press Open Accessibility.",
      "Find Sol in the list and switch it on.",
      "If Sol is already on, switch it off and on again: macOS forgets after Sol is rebuilt.",
    ],
    open: "Open Accessibility",
  },
  screen: {
    head: "Screen Recording",
    title: "Let Sol see the screen",
    why: "The picture came back blank. Sol's engine takes the pictures, and macOS calls that Screen Recording.",
    steps: [
      "Press Open Screen Recording.",
      "Find node in the list and switch it on: node is Sol's engine.",
      "If node is already on, switch it off and on again. Still blank? Quit Sol and open it again.",
    ],
    open: "Open Screen Recording",
  },
};
const POLL_MS = 800, THANKS_MS = 1400;

export function Permit({ which, bead, say, test, onGranted, onLater }: {
  which: Permission; bead: Bead | null; say: (t: string, check?: boolean) => void;
  /** the caller's own "is it there yet" (used for Screen Recording) */
  test: () => Promise<boolean>;
  onGranted: () => void; onLater: () => void;
}) {
  const w = WORDS[which];
  const [opened, setOpened] = useState(false);
  const [thanks, setThanks] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const live = useRef(true);
  const testRef = useRef(test); testRef.current = test;
  const doneRef = useRef(onGranted); doneRef.current = onGranted;

  // in: the card slides up, its lines one after another; the creature hops to the card's left edge, by the title
  useLayoutEffect(() => {
    const c = card.current!;
    enter(c, { y: 18, cfg: CFG.slide, scale: 0.03 });
    c.querySelectorAll<HTMLElement>(".permit-step, .permit-acts").forEach((r, i) => enter(r, { y: 8, delay: 140 + i * 70, cfg: CFG.slide }));
    const r = c.getBoundingClientRect();
    void bead?.hop(Math.round(r.left - BEAD - 12), Math.round(r.top + 18), { lift: 36, ms: 620 }).then(() => bead?.look(3, 0));
    say(which === "accessibility" ? "Sol needs one permission to scroll." : "Sol needs one permission to see the window.");
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // wait for it: ask every 800 ms (never two asks at once); the moment it is there, thank and go on
  useEffect(() => {
    live.current = true;
    let t = 0;
    const tick = async () => {
      const yes = await granted(which, () => testRef.current()).catch(() => false);
      if (!live.current) return;
      if (!yes) { t = window.setTimeout(tick, POLL_MS); return; }
      setThanks(true);
      say("Thank you.", true);
      bead?.nod();
      // the sheet back on top and Settings put away before the grab goes on (its wheel must reach the window)
      void permitBack();
      t = window.setTimeout(() => { if (live.current) doneRef.current(); }, THANKS_MS);
    };
    t = window.setTimeout(tick, POLL_MS);
    // gone any other way (Not now, Esc): the sheet back on top too
    return () => { live.current = false; window.clearTimeout(t); void permitBack(); };
  }, [which]);   // eslint-disable-line react-hooks/exhaustive-deps

  const open = async () => {
    if (thanks) return;
    const err = await permitOpen(which);
    if (!live.current) return;
    if (err) { say(`System Settings did not open: ${err}`); return; }
    setOpened(true);
    say(which === "accessibility" ? "Waiting for Sol to be switched on…" : "Waiting for node to be switched on…");
    bead?.look(3, -1);
  };
  const openRef = useRef(open); openRef.current = open;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void openRef.current(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  return (
    <div className={`permit${thanks ? " thanks" : ""}`} ref={card} role="dialog" aria-label={w.title}>
      <div className="permit-head">{w.head}</div>
      <div className="permit-title">{thanks ? "Thank you." : w.title}</div>
      <div className="permit-why">{thanks ? "Going on where it stopped…" : w.why}</div>
      <ol className="permit-steps">
        {w.steps.map((s, i) => <li key={i} className="permit-step"><span className="permit-n">{i + 1}</span><span>{s}</span></li>)}
      </ol>
      <div className="permit-acts">
        <button className="permit-btn on" data-press disabled={thanks} onClick={() => void open()}>{opened ? "Open it again" : w.open}</button>
        <button className="permit-btn" data-press disabled={thanks} onClick={onLater}>Not now</button>
      </div>
    </div>
  );
}
