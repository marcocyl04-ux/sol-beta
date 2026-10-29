import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// The trail: a thin strip down the right edge of the talk, one cell per message Marco sent, placed along the
// conversation's length. Hover lights the nearest cell and names it; press glides the talk to it; drag runs through
// them one after another. A faint line on the trail is the part of the talk on screen.
type Tick = { y: number; at: number; text: string };
export function Trail({ scroller, version, goTo }: { scroller: RefObject<HTMLDivElement | null>; version: number; goTo: (y: number) => void }) {
  const [ticks, setTicks] = useState<Tick[]>([]);
  // the window on the trail is written straight to its element: a state set on every scroll event rendered the trail
  // (and laid it out) once per wheel tick, ~3 ms a frame on the main thread while the hand scrolled (2026-10-25, SMOOTH.md).
  // It moves by transform (the line is the trail's full height, moved and scaled), so a scroll or a follow gliding
  // every frame lays nothing out (its top and height did, each frame)
  const win = useRef<HTMLElement>(null);
  const setWin = (w: { top: number; h: number }) => { const el = win.current; if (el) el.style.transform = `translateY(${(w.top * 100).toFixed(3)}%) scaleY(${Math.max(0.01, w.h).toFixed(4)})`; };
  const [near, setNear] = useState<number | null>(null);
  const [down, setDown] = useState(false);
  const trail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const sh = el.scrollHeight || 1;
      const top = el.getBoundingClientRect().top;
      const rows = Array.from(el.querySelectorAll<HTMLElement>(".me-row"));
      const next = rows.map((r) => {
        const y = r.getBoundingClientRect().top - top + el.scrollTop;
        return { y, at: y / sh, text: (r.textContent ?? "").trim().slice(0, 70) };
      });
      // the talk resizes every frame while an answer grows: the trail draws again only when a cell really moved
      setTicks((was) => (was.length === next.length && was.every((t, i) => Math.abs(t.y - next[i].y) < 0.5 && Math.abs(t.at - next[i].at) < 0.001 && t.text === next[i].text) ? was : next));
      setWin({ top: el.scrollTop / sh, h: el.clientHeight / sh });
    };
    measure();
    const onScroll = () => { const sh = el.scrollHeight || 1; setWin({ top: el.scrollTop / sh, h: el.clientHeight / sh }); };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, [scroller, version]);

  const pick = (clientY: number) => {
    const r = trail.current?.getBoundingClientRect();
    if (!r || !ticks.length) return null;
    const f = (clientY - r.top) / r.height;
    let best = 0, d = Infinity;
    ticks.forEach((t, i) => { const dd = Math.abs(t.at - f); if (dd < d) { d = dd; best = i; } });
    return best;
  };
  const go = (i: number | null) => { if (i !== null) goTo(ticks[i].y - 8); };
  const onMove = (ev: React.PointerEvent) => { const i = pick(ev.clientY); if (i !== near) { setNear(i); if (down) go(i); } };
  const onDown = (ev: React.PointerEvent) => { ev.currentTarget.setPointerCapture(ev.pointerId); setDown(true); const i = pick(ev.clientY); setNear(i); go(i); };
  const onUp = () => setDown(false);
  const onLeave = () => { if (!down) setNear(null); };
  useLayoutEffect(() => { const el = scroller.current; if (el) setWin({ top: el.scrollTop / (el.scrollHeight || 1), h: el.clientHeight / (el.scrollHeight || 1) }); });
  if (ticks.length < 2) return null;
  return (
    <div ref={trail} className={`trail ${down ? "down" : ""}`} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp}
      onPointerCancel={onUp} onPointerLeave={onLeave} title="the messages you sent: hover to see, press to go">
      <i ref={win} className="win" />
      {ticks.map((t, i) => <i key={i} className={`cell ${i === near ? "near" : ""}`} style={{ top: `${t.at * 100}%` }} />)}
      {near !== null && ticks[near] && <span className="name" style={{ top: `${ticks[near].at * 100}%` }}>{ticks[near].text}</span>}
    </div>
  );
}
