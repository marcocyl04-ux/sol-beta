// The permission wheel (mine/look/DIRECTION-4.html "the permission wheel, kept", built 2026-10-27 on Marco's ask):
// hold the mode chip (350 ms), right-click it, or click it, and the modes bud out of the chip onto an arc of dark goo
// over the chat bar, one drop per mode. The current one is the big drop, lit in the brand's bands with Sol sat in it;
// the drop under the pointer swells and its name brightens. Release on a drop (held) or click one (opened by a click)
// picks it; a release or click elsewhere closes. Arrows walk the arc, Enter picks, Esc closes. Bypass is risky, so its
// first pick turns the drop ember and asks once; the next pick on it goes (walking away with the arrows takes the ask
// back). Near a window edge the whole box slides inside the window, so no name or drop is cut; the buds still come out
// of the chip. Reduced motion: no budding, the arc just is.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CFG, enter, reducedMotion } from "../motion";
import { JOBS } from "../creature/goo";
import { Sol } from "../Sol";
import { useCover } from "../cowork/thingView";

export type LeashItem = { m: string; label: string; note: string; risky?: string };
const RY = 60, TOP = 64, BOT = 30, SIDE = 80;   // the arc's half height; room above for the names; below, down to the chip; beside, the end drops
const A0 = Math.PI * (190 / 180), A1 = Math.PI * (350 / 180);   // the arc: a dome over the chip, its ends lifted clear of the bar

// `chip`: the button that opened it; a press on it is left to the chip (its click closes the wheel), never a close here
// and then a reopen by that same click
export function LeashWheel({ r, kind, items, mode, onPick, onClose, chip }: { r: DOMRect; kind: "hold" | "stick"; items: LeashItem[]; mode: string; onPick: (m: string) => void; onClose: () => void; chip?: HTMLElement | null }) {
  const n = items.length, at = Math.max(0, items.findIndex((x) => x.m === mode));
  const [lit, setLit] = useState(at);
  const [sure, setSure] = useState<number | null>(null);     // the risky one asked once, waiting for its second pick
  const litRef = useRef(lit); litRef.current = lit;
  const sureRef = useRef(sure); sureRef.current = sure;
  const over = useRef<number | null>(null);
  const moved = useRef(false);                                 // drops budding out under a still pointer must not light; the pointer has to move first
  const stick = useRef(kind === "stick");
  const box = useRef<HTMLDivElement>(null);
  const plain = reducedMotion();
  useCover(true);
  const rx = Math.max(120, r.width / 2 + 64);
  const W = 2 * rx + 2 * SIDE, H = TOP + RY + BOT;
  const cx = W / 2, cy = TOP + RY;                            // the dome's centre: over the chip's top edge
  // where the box goes: centred on the chip, slid back inside the window when the chip sits near an edge
  const fit = (want: number, size: number, room: number) => (size + 8 > room ? (room - size) / 2 : Math.max(4, Math.min(room - size - 4, want)));
  const left = fit(r.left + r.width / 2 - cx, W, window.innerWidth), top = fit(r.top - 6 - cy, H, window.innerHeight);
  const ox = r.left + r.width / 2 - left, oy = r.top - top;   // the chip's middle and top inside the box
  // the spots: from the left end of the dome over the top to the right end
  const ang = (k: number) => A0 + (n > 1 ? (k / (n - 1)) * (A1 - A0) : (A1 - A0) / 2);
  const spot = (k: number) => ({ x: cx + rx * Math.cos(ang(k)), y: cy + RY * Math.sin(ang(k)) });
  const out = (k: number) => { const a = ang(k); return [Math.cos(a), Math.sin(a)]; };   // outward
  const p0 = spot(0), p1 = spot(n - 1);
  const arc = `M${p0.x} ${p0.y} A${rx} ${RY} 0 0 1 ${p1.x} ${p1.y}`;
  const choose = (k: number) => {
    const it = items[k]; if (!it) return onClose();
    if (it.risky && it.m !== mode && sureRef.current !== k) { setSure(k); stick.current = true; return; }   // asked once; the wheel stays for the answer
    onPick(it.m); onClose();
  };
  useLayoutEffect(() => {
    if (plain) return;
    box.current?.querySelectorAll<HTMLElement>(".lwspot").forEach((b, i) => { const s = spot(i); enter(b, { x: ox - s.x, y: oy + r.height / 2 - s.y, cfg: CFG.pop, delay: i * 24, scale: 0.3 }); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const up = () => { if (stick.current) return; const o = over.current; if (o !== null) choose(o); else onClose(); };
    const down = (ev: PointerEvent) => { const t = ev.target as HTMLElement; if (!t?.closest?.(".lwheel button") && !chip?.contains(t)) onClose(); };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); onClose(); }
      else if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); choose(litRef.current); }
      else if (ev.key.startsWith("Arrow")) {
        ev.preventDefault(); ev.stopPropagation();
        const d = ev.key === "ArrowRight" || ev.key === "ArrowUp" ? 1 : -1;
        setLit((l) => (l + d + n) % n); setSure(null);
      }
    };
    const move = () => { moved.current = true; window.removeEventListener("pointermove", move); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true); window.removeEventListener("blur", onClose);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const big = sure ?? lit;                                    // the one big drop: the lit one (the asked one while it asks)
  const bs = spot(big);
  return (<>
    <div className="mwscrim lwscrim" aria-hidden="true" />
    <div ref={box} className={`lwheel${plain ? " plain" : ""}`} role="menu" aria-label="mode" style={{ left, top, width: W, height: H }}>
      <svg className="lwring" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <defs>
          <linearGradient id="lwdark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a3a3a" /><stop offset="1" stopColor="#161616" /></linearGradient>
          <linearGradient id="lwlit" x1="0" y1="0" x2="1" y2="1">{JOBS.brand.map((c, i) => <stop key={i} offset={i / (JOBS.brand.length - 1)} stopColor={c} />)}</linearGradient>
          <linearGradient id="lwember" x1="0" y1="0" x2="1" y2="1">{JOBS.ember.map((c, i) => <stop key={i} offset={i / (JOBS.ember.length - 1)} stopColor={c} />)}</linearGradient>
          <radialGradient id="lwhi" cx="0.36" cy="0.3" r="0.5"><stop offset="0" stopColor="#fff" stopOpacity=".45" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
          <radialGradient id="lwlo" cx="0.64" cy="0.8" r="0.6"><stop offset="0" stopColor="#000" stopOpacity=".22" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
          <filter id="lwgoo" filterUnits="userSpaceOnUse" x="-20" y="-20" width={W + 40} height={H + 40}><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b" /><feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" /></filter>
        </defs>
        <g className="lwarc" style={{ transformOrigin: `${ox}px ${oy}px` }}>
          <g filter="url(#lwgoo)">
            <path d={arc} fill="none" stroke="url(#lwdark)" strokeWidth="10" strokeLinecap="round" />
            {items.map((_, k) => { const s = spot(k); return <circle key={k} className={`lwdrop${k === big ? " big" : ""}`} cx={s.x} cy={s.y} r={k === big ? 22 : 13} fill="url(#lwdark)" />; })}
          </g>
          <circle className="lwbig" cx={bs.x} cy={bs.y} r="22" fill={sure !== null ? "url(#lwember)" : "url(#lwlit)"} />
          <circle className="lwbig" cx={bs.x} cy={bs.y} r="22" fill="url(#lwlo)" />
          <circle className="lwbig" cx={bs.x} cy={bs.y} r="22" fill="url(#lwhi)" />
        </g>
      </svg>
      <span className="lwsol" style={{ left: bs.x, top: bs.y }} aria-hidden="true"><Sol size={30} eyes watch /></span>
      {items.map((it, k) => {
        const s = spot(k), o = out(k), d = k === big ? 44 : 26;   // the name sits above its drop, leaning outward, never down on the bar
        return (
          <span key={it.m} className="lwspot" style={{ left: s.x, top: s.y }}>
            <button type="button" role="menuitem" data-mode={it.m} className={`${k === lit ? "lit" : ""} ${k === at ? "on" : ""}`} title={it.note}
              onPointerEnter={() => { if (moved.current) { over.current = k; setLit(k); } }} onPointerMove={() => { moved.current = true; if (over.current !== k) { over.current = k; setLit(k); } }} onPointerLeave={() => { if (over.current === k) over.current = null; }}
              onClick={() => { if (stick.current) choose(k); }} />
            <span className={`lwname${k === lit ? " lit" : ""}${sure === k ? " sure" : ""}`} style={{ left: o[0] * d * 0.9, top: Math.min(o[1] * d, -d * 0.8) }}>{sure === k ? `sure? ${it.risky}` : it.label}</span>
          </span>
        );
      })}
    </div>
  </>);
}
