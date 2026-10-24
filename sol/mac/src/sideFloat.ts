import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CFG, reducedMotion, stagger, useSpring } from "./motion";

// The side, floating over the chat from the left edge (both modes). A thin hot strip opens it (after a short grace),
// it stays while the pointer is inside, closes 140 ms after it leaves (at once when the pointer is well past it), and
// pinning keeps it open. `hold` keeps it open too (a rename, a menu).
// Nothing reflows: the panel is fixed and only its transform moves, and it moves on ONE spring (`p`, 0 closed to 1
// open) that is retargeted, never restarted: open it, leave, come back mid-close, and the panel turns round with the
// speed it had. The rows stagger in only when the panel was really closed (never on a mid-flight reversal).
export function useSideFloat(pinned: boolean, hold: boolean, panel = 240) {
  const [hover, setHover] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const intent = useRef(false); // what the pointer currently asks for; the timer only ever moves it, never double-fires
  const aim = (to: boolean, wait: number) => {
    window.clearTimeout(timer.current);
    if (to === intent.current && !wait) return;
    if (wait === 0) { intent.current = to; setHover(to); return; }
    timer.current = window.setTimeout(() => { intent.current = to; setHover(to); }, wait);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const open = pinned || hover || hold;
  // the hot zone is the left HOT px of the window, watched on the window itself (a strip element was 6px and hard
  // to hit): coming into it opens after a short grace; leaving it before the panel opened cancels; once open, the
  // panel's own enter/leave take over, and a pointer well to the right of it with the panel never entered closes it
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (pinned) return;
    const HOT = 28;
    const move = (ev: MouseEvent) => {
      const x = ev.clientX;
      if (x <= HOT) { if (!intent.current) aim(true, 90); }
      else if (!intent.current) window.clearTimeout(timer.current);
      else if (x > panel + 12 && openRef.current && !hold) aim(false, x > panel + 60 ? 0 : 140);
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, [pinned, hold, panel]); // eslint-disable-line react-hooks/exhaustive-deps

  // one spring for the panel
  const ref = useRef<HTMLElement>(null);
  const p = useSpring(open ? 1 : 0, CFG.glide, (v, sp) => {
    const el = ref.current;
    if (!el) return;
    el.style.translate = `${(Math.min(v, 1) - 1) * 100}% 0`;
    const shut = sp.resting && sp.target === 0;
    el.style.visibility = shut ? "hidden" : "visible";
    el.style.pointerEvents = sp.target === 1 || v > 0.04 ? "auto" : "none";
  });
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    // the first paint sets the panel by hand, pointer events too: the spring starts at rest on its target and never runs a
    // frame, so a side that opens pinned kept the stylesheet's pointer-events: none and every click fell through to the chat
    if (first.current) { first.current = false; if (el) { el.style.translate = open ? "0 0" : "-100% 0"; el.style.visibility = open ? "visible" : "hidden"; el.style.pointerEvents = open ? "auto" : "none"; } return; }
    if (open && p.v < 0.35 && el && !reducedMotion()) {
      // really closed: the rows arrive one after another behind the panel's edge, and the mark says hello
      stagger(el.querySelectorAll("[data-s]"), { x: -26, gap: 26, delay: 50, max: 14, cfg: CFG.slide });
      window.dispatchEvent(new Event("sol-greet"));
    }
    // opening glides and settles; closing is brisker, so leaving never feels like the panel hangs on
    p.to(open ? 1 : 0, { cfg: open ? CFG.glide : CFG.away });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ref, open, onMouseEnter: () => aim(true, 0), onMouseLeave: () => aim(false, 140) };
}
