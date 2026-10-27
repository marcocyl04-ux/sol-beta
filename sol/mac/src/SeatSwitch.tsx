import { useLayoutEffect, useRef } from "react";
import { useSpring } from "./motion";
import type { Seat } from "./useEngine";

/**
 * The lit capsule under a two-word pill, moving as goo (the photo-1 bridge, DIRECTION-4 "The seat"): its leading edge
 * leaps to the other word on a quick spring while the trailing edge follows on a slower one, so the capsule stretches
 * across, thins as it stretches, then the tail snaps in and it lands with a small squash (taller, narrower) before it
 * settles. `at` is 0 or 1; `start` is where it is drawn first (the side it came from, when a pill mounts on a switch).
 * Reduced motion: the springs jump (motion.ts).
 */
export function useBridgeThumb(at: number, start = at) {
  const el = useRef<HTMLElement>(null);
  const ed = useRef({ l: start, r: start + 1 });
  const draw = () => {
    const t = el.current; if (!t) return;
    const { l, r } = ed.current, w = Math.max(0.6, r - l);
    t.style.left = `calc(2px + ${l.toFixed(4)} * (50% - 2px))`;
    t.style.width = `calc(${w.toFixed(4)} * (50% - 2px))`;
    t.style.transform = `scaleY(${Math.min(1.14, Math.max(0.72, 1 / Math.sqrt(w))).toFixed(3)})`;
  };
  const L = useSpring(start, { k: 300, z: 0.62, eps: 0.002 }, (v) => { ed.current.l = v; draw(); });
  const R = useSpring(start + 1, { k: 300, z: 0.62, eps: 0.002 }, (v) => { ed.current.r = v; draw(); });
  const lead = { k: 620, z: 0.7, eps: 0.002 }, tail = { k: 210, z: 0.5, eps: 0.002 };
  useLayoutEffect(() => {
    draw();
    const right = at > ed.current.l;
    L.to(at, { cfg: right ? tail : lead });
    R.to(at + 1, { cfg: right ? lead : tail });
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
  return el;
}

// Codex / Claude as a two-position switch in a pill: under a new chat's box (the seat it starts on) and in settings.
// Two plain words and the lit capsule, which travels as goo (useBridgeThumb).
// (The diagonal wipe across the window follows the active conversation's seat; see creature/Space.)
export function SeatSwitch({ seat, locked, onPick, title }: { seat: Seat; locked?: boolean; onPick: (s: Seat) => void; title?: string }) {
  const thumb = useBridgeThumb(seat === "codex" ? 0 : 1);
  return (
    <div className={`seatsw ${locked ? "locked" : ""}`} role="group" title={title}>
      <i ref={thumb as React.RefObject<HTMLUnknownElement>} className="thumb" />
      <button type="button" data-seat="home" className={seat === "codex" ? "on" : ""} disabled={locked} onClick={() => onPick("codex")}>codex</button>
      <button type="button" data-seat="work" className={seat === "claude" ? "on" : ""} disabled={locked} onClick={() => onPick("claude")}>claude</button>
    </div>
  );
}
