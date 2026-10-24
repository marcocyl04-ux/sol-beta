import { useLayoutEffect, useRef } from "react";
import { useSpring } from "./motion";
import type { Seat } from "./useEngine";
import { SeatCells } from "./creature/indicators";
import type { Life } from "./creature/Widget";
import { TINTS } from "./creature/ring";

// Codex / Claude as a two-position switch in a pill: under a new chat's box (the seat it starts on) and in settings.
// Each seat carries a 3x3 fragment of the creature with an eye, in that seat's colours; picking one sheds cells.
// (The diagonal wipe across the window follows the active conversation's seat; see creature/Space.)
export function SeatSwitch({ seat, locked, onPick, title }: { seat: Seat; locked?: boolean; onPick: (s: Seat) => void; title?: string }) {
  const life = useRef<Life | null>(null);
  const pick = (to: Seat) => {
    const name = to === "codex" ? "home" : "work";
    const l = life.current;
    if (l && to !== seat) { l.slice = TINTS[name]; l.blink = 0.16; l.shed(8, l.data[name] ?? l.w / 2, l.h / 2, 0.5); }
    onPick(to);
  };
  // the thumb is a spring: it stretches while it travels (squash and stretch, from its speed) and lands with one overshoot
  const thumb = useRef<HTMLElement>(null);
  const th = useSpring(seat === "codex" ? 0 : 1, { k: 330, z: 0.52, eps: 0.002 }, (v, sp) => {
    const el = thumb.current;
    if (!el) return;
    const stretch = 1 + Math.min(0.28, Math.abs(sp.vel) * 0.07);
    el.style.transform = `translateX(${v * 100}%) scaleX(${stretch})`;
    el.style.transformOrigin = sp.vel > 0 ? "0 50%" : "100% 50%";
  });
  const placed = useRef(false);
  useLayoutEffect(() => {
    const to = seat === "codex" ? 0 : 1;
    if (placed.current) th.to(to); else { placed.current = true; th.set(to); }
  }, [seat]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`seatsw ${locked ? "locked" : ""}`} role="group" title={title}>
      <i ref={thumb as React.RefObject<HTMLUnknownElement>} className="thumb" />
      <SeatCells seat={seat === "codex" ? "home" : "work"} life={life} />
      <button type="button" data-seat="home" className={seat === "codex" ? "on" : ""} disabled={locked} onClick={() => pick("codex")}>codex</button>
      <button type="button" data-seat="work" className={seat === "claude" ? "on" : ""} disabled={locked} onClick={() => pick("claude")}>claude</button>
    </div>
  );
}
