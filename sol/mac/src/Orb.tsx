import { useEffect, useRef, useState } from "react";
import { CFG, useSpring, type Follow } from "./motion";

// The orb (notch buttons #6, "The scroll"): a small round button at the bottom centre of the talk, above the box.
// It shows when Marco has released the follow and the end is out of view, and hides at the end. New words while he
// is away put a small dot on it, nothing else. A press glides the talk to its end on the spring and sticks it again.
// It rises and fades on the companion's `arrive` spring, never pops; reduced motion: it is there or not, no fade.
// One orb for every talk: Life (App.tsx), Work (work/WorkApp.tsx), the session beside (work/Split.tsx).
export function Orb({ f }: { f: Follow | null }) {
  const el = useRef<HTMLButtonElement>(null);
  const [on, setOn] = useState(false);
  const [dot, setDot] = useState(false);
  const sp = useSpring(0, { ...CFG.arrive, eps: 0.004 }, (v) => {
    const b = el.current;
    if (!b) return;
    b.style.opacity = String(Math.max(0, Math.min(1, v)));
    b.style.translate = `0 ${(1 - v) * 10}px`;
    b.style.scale = String(0.86 + 0.14 * v);
    b.style.visibility = v < 0.01 ? "hidden" : "visible";
  });
  useEffect(() => {
    if (!f) { setOn(false); sp.set(0); return; }
    const look = () => {
      const s = f.state(), show = !s.stuck && s.away;
      setOn(show); setDot(show && s.fresh);
      if (sp.target !== (show ? 1 : 0)) sp.to(show ? 1 : 0);
    };
    look();
    return f.onChange(look);
  }, [f, sp]);
  return (
    <button ref={el} className={`orb ${dot ? "fresh" : ""}`} data-nopress tabIndex={on ? 0 : -1} aria-hidden={!on}
      aria-label={dot ? "new words below: back to the end" : "back to the end"} title="back to the end"
      onClick={() => f?.glide()}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.5v8.5M3 7.5 7 11.5 11 7.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <i className="orb-dot" />
    </button>
  );
}
