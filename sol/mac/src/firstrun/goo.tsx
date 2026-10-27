// The first run's goo (#134), on the kit of creature/goo.tsx and the rules of sol/skills/sol/look.md: the hero (Sol
// himself with a goo layer under him, so what he sheds leaves him with a neck), bodies that bud out toward him and
// bridge while they travel apart (the cards, the drawer, the note), the light on the real element as a liquid rim with
// beads riding it, and the small lit buds that carry a glyph. Nothing here is flat; under reduced motion all of it
// stands at its rest frame.
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Sol, hopKeys, type SolLife } from "../Sol";
import { SOL_PATH, SOL_BODY } from "../solShape";
import { Bands, JOBS, Light, budPath, rnd, shoreVar, type Job } from "../creature/goo";
import { outline } from "../creature/indicators";
import { reducedMotion, spring, type Cfg, type Spring } from "../motion";
import type { live } from "../creature/state";

type Look = typeof live.look;
const CX = 46, CY = 58;   // Sol's middle in his 100 x 100 box (face.css transform-origin)
const brandStops = (job: Job) => JOBS[job];

/** the goo filter over a larger region than creature/goo.tsx's (drops fly well outside the 100 box) */
function GooFilter({ id, blur, x, y, w, h }: { id: string; blur: number; x: number; y: number; w: number; h: number }) {
  return (
    <filter id={id} filterUnits="userSpaceOnUse" x={x} y={y} width={w} height={h} colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="b" />
      <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="g" />
      <feBlend in="SourceGraphic" in2="g" />
    </filter>
  );
}

// ---- the hero ----
export type HeroLife = SolLife & {
  /** drops leave him outward and fall, each keeping a neck to him until it lets go */
  shed(n: number, power?: number): void;
  /** a stream of drops falling away below him for `ms` (a flight up) */
  trail(ms: number): void;
};

type Drop = { x: number; y: number; vx: number; vy: number; r: number; tr: number; rk: number; age: number; life: number; home: [number, number, number] | null; c: number; on: boolean };
const POOL = 44;

/**
 * Sol, `size` px, in a box three times his size so his drops have room. `hatch`: he starts as a seed of goo that the
 * drops round him run into, swells, and he grows out of it with his eyes shut; they open once he has landed.
 */
export const Hero = forwardRef(function Hero({ size, hatch, onHatched }: { size: number; hatch: boolean; onHatched?: () => void }, ref: Ref<HeroLife>) {
  const id = useId().replace(/:/g, "");
  const sol = useRef<SolLife>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const ghost = useRef<SVGGElement>(null);
  const ghostHop = useRef<SVGGElement>(null);
  const circles = useRef<(SVGCircleElement | null)[]>([]);
  const drops = useRef<Drop[]>(Array.from({ length: POOL }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0, tr: 0, rk: 8, age: 0, life: 0, home: null, c: 0, on: false })));
  const raf = useRef(0);
  const reduced = reducedMotion();
  const grown = useRef<Spring | null>(null);
  const setGrown = (s: number) => {
    if (wrap.current) wrap.current.style.scale = String(Math.max(0, s));
    ghost.current?.setAttribute("transform", `translate(${CX} ${CY}) scale(${(Math.max(0, s) * 0.9).toFixed(3)}) translate(${-CX} ${-CY})`);
  };
  const tick = useCallback(() => {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = Math.max(last, now);
      let alive = 0;
      drops.current.forEach((d, i) => {
        if (!d.on) return;
        d.age += dt;
        if (d.home) {
          const [hx, hy, k] = d.home;
          d.vx += (hx - d.x) * k * dt; d.vy += (hy - d.y) * k * dt;
          const damp = Math.exp(-2 * Math.sqrt(k) * 0.55 * dt); d.vx *= damp; d.vy *= damp;
        } else d.vy += 240 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.life && d.age > d.life) { d.tr = 0; d.rk = 5; }
        d.r += (d.tr - d.r) * Math.min(1, d.rk * dt);
        if (d.tr === 0 && d.r < 0.3) { d.on = false; d.r = 0; }
        const c = circles.current[i];
        if (c) { c.setAttribute("cx", d.x.toFixed(2)); c.setAttribute("cy", d.y.toFixed(2)); c.setAttribute("r", d.r.toFixed(2)); }
        if (d.on) alive++;
      });
      raf.current = alive ? requestAnimationFrame(step) : 0;
    };
    if (!raf.current) raf.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const spawn = (o: Partial<Drop>) => {
    const d = drops.current.find((x) => !x.on); if (!d) return null;
    Object.assign(d, { x: CX, y: CY, vx: 0, vy: 0, r: 0, tr: 5, rk: 10, age: 0, life: 1, home: null, c: Math.floor(Math.random() * 6), on: true }, o);
    return d;
  };
  const shed = (n: number, power = 1) => {
    if (reduced) return;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7, sp = (50 + Math.random() * 90) * power;
      // born just inside his edge, so the goo draws a neck out of him before the drop lets go
      spawn({ x: CX + Math.cos(a) * 26, y: CY + Math.sin(a) * 22, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40 * power, r: 2, tr: 3 + Math.random() * 4.5 * Math.min(1.4, power), rk: 14, life: 0.45 + Math.random() * 0.6 });
    }
    tick();
  };
  const trail = (ms: number) => {
    if (reduced) return;
    const t0 = performance.now();
    const f = () => {
      spawn({ x: CX + (Math.random() - 0.5) * 30, y: CY + 22, vx: (Math.random() - 0.5) * 40, vy: 30 + Math.random() * 40, r: 3, tr: 4 + Math.random() * 3, rk: 12, life: 0.4 + Math.random() * 0.4 });
      tick();
      if (performance.now() - t0 < ms) window.setTimeout(f, 45);
    };
    f();
  };
  useImperativeHandle(ref, () => ({
    hop(p = 1) { sol.current?.hop(p); if (!reduced) ghostHop.current?.animate(...hopKeys(p)); },
    eyes(v) { sol.current?.eyes(v); },
    wear(l: Look | null, ms?: number) { sol.current?.wear(l, ms); },
    shed, trail,
  }));
  // the hatch: a seed of goo, the drops round it running in, it swells; he grows out of it, lands, opens his eyes
  useLayoutEffect(() => {
    grown.current = spring(hatch && !reduced ? 0 : 1, { k: 230, z: 0.5 }, (v) => setGrown(v));
    setGrown(hatch && !reduced ? 0 : 1);
    if (!hatch) return;
    if (reduced) { onHatched?.(); return; }
    sol.current?.eyes(0.12);
    const ts: number[] = [];
    const at = (ms: number, f: () => void) => ts.push(window.setTimeout(f, ms));
    let seed: Drop | null = null;
    at(150, () => {
      seed = spawn({ x: CX, y: CY + 4, r: 0, tr: 9, rk: 3, life: 0, home: [CX, CY + 4, 60] });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3, rr = 46 + (i % 2) * 14;
        spawn({ x: CX + Math.cos(a) * rr, y: CY + Math.sin(a) * rr * 0.8, vx: -Math.sin(a) * 30, vy: Math.cos(a) * 30, r: 0, tr: 4 + (i % 3), rk: 6, life: 0, home: [CX, CY + 4, 9 + i * 1.5] });
      }
      tick();
    });
    at(700, () => { if (seed) { seed.tr = 20; seed.rk = 4; } });
    at(1100, () => {
      drops.current.forEach((d) => { if (d.on && d.home) { d.life = d.age + 0.25; } });
      grown.current?.to(1);
    });
    at(1350, () => { sol.current?.hop(1.1); ghostHop.current?.animate(...hopKeys(1.1)); shed(16, 1.1); });
    at(1750, () => sol.current?.eyes(0.4));
    at(2050, () => { sol.current?.eyes(1); onHatched?.(); });
    return () => ts.forEach((t) => window.clearTimeout(t));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const B = size * 3;
  return (
    <div className="fr-herobox" style={{ width: B, height: B }}>
      <svg className="fr-herogoo" width={B} height={B} viewBox="-100 -100 300 300" aria-hidden="true">
        <defs>
          <GooFilter id={`${id}f`} blur={2.6} x={-100} y={-100} w={300} h={300} />
          {JOBS.brand.map((c, i) => (
            <radialGradient key={i} id={`${id}d${i}`} cx=".36" cy=".3" r=".8"><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset=".25" stopColor={c} /><stop offset="1" stopColor={c} /></radialGradient>
          ))}
        </defs>
        <g filter={`url(#${id}f)`}>
          <g ref={ghost}><g ref={ghostHop} style={{ transformOrigin: "46px 88px" }}><path d={SOL_PATH} fill={SOL_BODY} /></g></g>
          {drops.current.map((_, i) => <circle key={i} ref={(el) => { circles.current[i] = el; }} r="0" fill={`url(#${id}d${i % 6})`} />)}
        </g>
      </svg>
      <div ref={wrap} className="fr-sol" style={{ left: size, top: size, width: size, height: size }}>
        <Sol size={size} watch alone life={sol} />
      </div>
    </div>
  );
});

// ---- bodies that bud in ----
// Each child is a card whose body is drawn here, behind it: a dark goo silhouette (the base's own ink, lit from the top
// left) in one mask, so near bodies bridge. They start as one small drop at the top middle, under Sol, and travel to
// their places one after another; while they pass each other they are one body with necks, at rest they stand apart.
// The child's own words fade in once its body is there.
const BODY: Cfg = { k: 150, z: 0.6, eps: 0.2 };
type Box = { cx: Spring; cy: Spring; w: Spring; h: Spring };
export function GooBodies({ children, className, gap = 110, rx = 26, from = "top", k }: { children: ReactNode[] | ReactNode; className?: string; gap?: number; rx?: number; from?: "top" | "centre"; k?: string | number }) {
  const id = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const rects = useRef<(SVGRectElement | null)[]>([]);
  const springs = useRef<Box[]>([]);
  const [n, setN] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const reduced = reducedMotion();
  const draw = (i: number) => {
    const s = springs.current[i], r = rects.current[i]; if (!s || !r) return;
    const w = Math.max(1, s.w.v), h = Math.max(1, s.h.v);
    r.setAttribute("x", (s.cx.v - w / 2).toFixed(1)); r.setAttribute("y", (s.cy.v - h / 2).toFixed(1));
    r.setAttribute("width", w.toFixed(1)); r.setAttribute("height", h.toFixed(1)); r.setAttribute("rx", Math.min(rx, w / 2, h / 2).toFixed(1));
  };
  const kids = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  const count = kids.length;
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const cards = [...el.querySelectorAll<HTMLElement>(":scope > .fr-body")];
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
    setN(cards.length);
    const fx = el.offsetWidth / 2, fy = from === "top" ? -40 : el.offsetHeight / 2;
    cards.forEach((c, i) => {
      const t = { cx: c.offsetLeft + c.offsetWidth / 2, cy: c.offsetTop + c.offsetHeight / 2, w: c.offsetWidth, h: c.offsetHeight };
      let s = springs.current[i];
      const fresh = !s;
      if (!s) s = springs.current[i] = { cx: spring(fx, BODY, () => draw(i)), cy: spring(fy, BODY, () => draw(i)), w: spring(22, BODY, () => draw(i)), h: spring(22, BODY, () => draw(i)) };
      if (reduced || !fresh) { s.cx.set(t.cx); s.cy.set(t.cy); s.w.set(t.w); s.h.set(t.h); c.dataset.in = "1"; return; }
      const delay = 60 + i * gap;
      s.cx.to(t.cx, { delay }); s.cy.to(t.cy, { delay }); s.w.to(t.w, { delay: delay + 60 }); s.h.to(t.h, { delay: delay + 60 });
      window.setTimeout(() => c.dataset.in = "1", delay + 300);
    });
    requestAnimationFrame(() => cards.forEach((_, i) => draw(i)));
  }, [count, k]); // eslint-disable-line react-hooks/exhaustive-deps
  // the window changing size: the bodies follow at once
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const cards = [...el.querySelectorAll<HTMLElement>(":scope > .fr-body")];
      setSize({ w: el.offsetWidth, h: el.offsetHeight });
      cards.forEach((c, i) => { const s = springs.current[i]; if (!s || !s.cx.resting) return; s.cx.set(c.offsetLeft + c.offsetWidth / 2); s.cy.set(c.offsetTop + c.offsetHeight / 2); s.w.set(c.offsetWidth); s.h.set(c.offsetHeight); });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const M = 80, W = size.w + 2 * M, H = size.h + 2 * M;
  return (
    <div ref={box} className={`fr-bodies ${className ?? ""}`}>
      <svg className="fr-bodies-goo" style={{ left: -M, top: -M }} width={W} height={H} viewBox={`${-M} ${-M} ${W} ${H}`} aria-hidden="true">
        <defs>
          <GooFilter id={`${id}f`} blur={5} x={-M} y={-M} w={W} h={H} />
          <mask id={`${id}m`} maskUnits="userSpaceOnUse" x={-M} y={-M} width={W} height={H}>
            <g filter={`url(#${id}f)`}>{Array.from({ length: n }, (_, i) => <rect key={i} ref={(el) => { rects.current[i] = el; }} fill="#fff" />)}</g>
          </mask>
          <linearGradient id={`${id}d`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="fr-goo-top" /><stop offset="1" className="fr-goo-low" /></linearGradient>
          <Bands id={`${id}b`} cols={JOBS.shore} angle={20} spread={1.2} soft={0.1} />
          <radialGradient id={`${id}h`} cx=".22" cy="0" r=".9"><stop offset="0" stopColor="#fff" stopOpacity=".09" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
        </defs>
        <g mask={`url(#${id}m)`}>
          <rect x={-M} y={-M} width={W} height={H} fill={`url(#${id}d)`} />
          <rect className="fr-goo-bands" width="100" height="100" fill={`url(#${id}b)`} transform={`translate(${-M} ${-M}) scale(${W / 100} ${H / 100})`} />
          <rect x={-M} y={-M} width={W} height={H} fill={`url(#${id}h)`} />
        </g>
      </svg>
      {kids}
    </div>
  );
}

// ---- the light on a real element: the rest of the window dimmed, the element in a liquid rim of the brand's bands
// with beads running round it (they bridge into the rim as they pass) ----
export function GooSpot({ box, pad = 10, r = 18 }: { box: DOMRect; pad?: number; r?: number }) {
  const id = useId().replace(/:/g, "");
  const beads = useRef<(SVGCircleElement | null)[]>([]);
  const geo = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const x = box.left - pad, y = box.top - pad, w = box.width + pad * 2, h = box.height + pad * 2;
  geo.current = { x, y, w, h };
  useEffect(() => {
    if (reducedMotion()) return;
    let raf = 0;
    const t0 = performance.now();
    const f = (now: number) => {
      const g = geo.current, o = outline(g.x, g.y, g.w, g.h, r), t = (now - t0) / 1000;
      beads.current.forEach((c, i) => {
        if (!c) return;
        const [px, py] = o.at(o.len * (i / 3) + t * (70 + i * 9));
        c.setAttribute("cx", px.toFixed(1)); c.setAttribute("cy", py.toFixed(1));
        c.setAttribute("r", (4.5 + 1.5 * Math.sin(t * 2.2 + i * 2)).toFixed(2));
      });
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [r]);
  const VW = window.innerWidth, VH = window.innerHeight;
  return (
    <svg className="fr-spot" width={VW} height={VH} viewBox={`0 0 ${VW} ${VH}`} aria-hidden="true">
      <defs>
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width={VW} height={VH}>
          <rect width={VW} height={VH} fill="#fff" />
          <rect x={x} y={y} width={w} height={h} rx={r} fill="#000" />
        </mask>
        <GooFilter id={`${id}f`} blur={2.4} x={0} y={0} w={VW} h={VH} />
        <linearGradient id={`${id}b`} gradientUnits="userSpaceOnUse" x1={x} y1={y} x2={x + w} y2={y + h}>
          {[JOBS.brand[5], JOBS.brand[3], JOBS.brand[2], JOBS.brand[0]].flatMap((c, j, a) => [
            <stop key={`${j}a`} offset={j / a.length + 0.06} stopColor={c} />, <stop key={`${j}b`} offset={(j + 1) / a.length - 0.06} stopColor={c} />,
          ])}
        </linearGradient>
      </defs>
      <rect className="fr-dim" width={VW} height={VH} mask={`url(#${id}m)`} />
      <g filter={`url(#${id}f)`} fill={`url(#${id}b)`}>
        <rect x={x} y={y} width={w} height={h} rx={r} fill="none" stroke={`url(#${id}b)`} strokeWidth="5" />
        {[0, 1, 2].map((i) => <circle key={i} ref={(el) => { beads.current[i] = el; }} cx={x} cy={y} r="5" />)}
      </g>
    </svg>
  );
}

// ---- a lit bud carrying a glyph: a lobed body of its own (creature/goo budPath), banded and lit ----
export function GlyphBud({ seed, job, size = 38, children }: { seed: string; job?: Job; size?: number; children?: ReactNode }) {
  const id = useId().replace(/:/g, "");
  const sv = shoreVar(seed), r = rnd(seed);
  const cols = job ? brandStops(job) : sv.cols;
  const d = budPath(seed, 3 + Math.floor(r() * 3), 0.1 + r() * 0.06);
  return (
    <span className={`fr-bud ${job ? `job-${job}` : ""}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <defs><Bands id={`${id}b`} cols={cols} angle={job ? 60 : sv.angle} spread={0.9} soft={0.08} /><Light id={id} /></defs>
        <path d={d} fill={`url(#${id}b)`} /><path d={d} fill={`url(#${id}lo)`} /><path d={d} fill={`url(#${id}hi)`} />
      </svg>
      <span className="fr-bud-glyph">{children}</span>
    </span>
  );
}
