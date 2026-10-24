// One thread upstream (Notch buttons #6, design/notch-buttons/PRD.md): Open from the notch lands the window on the
// engine item the notch showed. App.tsx hears the notch (onOpenAsk) and calls landOn; the talk showing that conversation
// (Life in App.tsx, Work in WorkApp.tsx) calls useLanding, which finds the row carrying data-item="<itemId>" (rows in
// Message.tsx, work/WorkTalk.tsx, work/WorkSteps.tsx), or for a ping whose step has another id the row that made it
// (data-ping="<line>"), scrolls it into view with the follow's goTo and marks it `landed` for 1.2 s, the highlight
// rising and leaving on the companion's arrive spring. No id, or a row not on the page: it lands at the end, as before.
import { useEffect, useState, type RefObject } from "react";
import { CFG, Spring } from "./motion";

type Want = { sessionId: string; itemId?: string; line?: string; at: number };
let want: Want | null = null;
const LAND_MS = 1200, WAIT_MS = 8000;   // the highlight's breath; how long a landing waits for its conversation to load

/** the window is asked to open a conversation at an item (or just open it: no item, no landing) */
export function landOn(m: { sessionId?: string; itemId?: string; line?: string }) {
  want = m.sessionId && (m.itemId || m.line) ? { sessionId: m.sessionId, itemId: m.itemId, line: m.line, at: Date.now() } : null;
  window.dispatchEvent(new Event("sol:land"));
}
/** a ping's line as the engine keeps it (ping.ts): one spaced line, 140 characters at most */
export const pingKey = (line: string) => line.replace(/\s+/g, " ").trim().slice(0, 140);

function find(root: HTMLElement, w: Want): HTMLElement | null {
  if (w.itemId) {
    const el = root.querySelector<HTMLElement>(`[data-item="${CSS.escape(w.itemId)}"]`);
    if (el) return el;
  }
  if (w.line) {
    const key = pingKey(w.line), all = root.querySelectorAll<HTMLElement>("[data-ping]");
    for (let i = all.length - 1; i >= 0; i--) if (all[i].dataset.ping === key) return all[i];
  }
  return null;
}

function highlight(el: HTMLElement) {
  const s = new Spring(0, CFG.arrive, (v) => el.style.setProperty("--land", String(Math.max(0, Math.min(1, v)))));
  el.classList.add("landed");
  s.to(1);
  window.setTimeout(() => { s.to(0, { cfg: CFG.settle }); window.setTimeout(() => { el.classList.remove("landed"); el.style.removeProperty("--land"); s.stop(); }, 700); }, LAND_MS - 700);
}

/** the talk showing `sessionId` lands on the wanted row once it is on the page; `version` changes as rows arrive */
export function useLanding(talk: RefObject<HTMLElement | null>, sessionId: string | null | undefined, version: number, goTo: (y: number) => void) {
  const [asked, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); window.addEventListener("sol:land", f); return () => window.removeEventListener("sol:land", f); }, []);
  useEffect(() => {
    const w = want, t = talk.current;
    if (!w || !t || w.sessionId !== sessionId) return;
    if (Date.now() - w.at > WAIT_MS) { want = null; return; }
    // two frames: after the follow's own jump to the end on opening
    let r = requestAnimationFrame(() => { r = requestAnimationFrame(() => {
      const el = find(t, w);
      if (!el || want !== w) return;   // not on the page yet: the next rows try again; never: it stays at the end
      want = null;
      const y = el.getBoundingClientRect().top - t.getBoundingClientRect().top + t.scrollTop - t.clientHeight / 3;
      goTo(y);
      highlight(el);
    }); });
    return () => cancelAnimationFrame(r);
  }, [talk, sessionId, version, asked, goTo]);
}
