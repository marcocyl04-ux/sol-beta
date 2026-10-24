import { useEffect, useRef, useState, type RefObject } from "react";

// The trail: a thin strip down the right edge of the talk, one cell per message Marco sent, placed along the
// conversation's length. Hover lights the nearest cell and names it; press glides the talk to it; drag runs through
// them one after another. A faint line on the trail is the part of the talk on screen.
type Tick = { y: number; at: number; text: string };
export function Trail({ scroller, version, goTo }: { scroller: RefObject<HTMLDivElement | null>; version: number; goTo: (y: number) => void }) {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [win, setWin] = useState({ top: 0, h: 1 });
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
      setTicks(rows.map((r) => {
        const y = r.getBoundingClientRect().top - top + el.scrollTop;
        return { y, at: y / sh, text: (r.textContent ?? "").trim().slice(0, 70) };
      }));
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
  if (ticks.length < 2) return null;
  return (
    <div ref={trail} className={`trail ${down ? "down" : ""}`} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp}
      onPointerCancel={onUp} onPointerLeave={onLeave} title="the messages you sent: hover to see, press to go">
      <i className="win" style={{ top: `${win.top * 100}%`, height: `${Math.max(1, win.h * 100)}%` }} />
      {ticks.map((t, i) => <i key={i} className={`cell ${i === near ? "near" : ""}`} style={{ top: `${t.at * 100}%` }} />)}
      {near !== null && ticks[near] && <span className="name" style={{ top: `${ticks[near].at * 100}%` }}>{ticks[near].text}</span>}
    </div>
  );
}
