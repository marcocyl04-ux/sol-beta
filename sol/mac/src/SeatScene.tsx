// The seat scene (mine/look/DIRECTION-4.html "The seat", Marco 2026-10-27): what sits above the mode pill at the top of
// the side, in place of the brand line. Home is Sol alone, plainly. Cowork is Sol with two of the team's buds beside
// him, and the switch is the visit: the buds bud out of his body (under a goo filter, so each one swells, stretches a
// bridge and lets go), travel out on a spring with a little hop, land squashed and open their eyes, then bob. Back to
// home they drift in, the bridge comes back, and he takes them in. Sol is the vibe switch here (vibe.ts toggleVibe), as
// the old sidebar mark was: a click turns vibe on or off, a hold opens its settings (WorkApp.tsx hears sol-vibe-edit).
// Each side (Home, Cowork) mounts its own scene, so the mode it came from is kept here between mounts: a fresh scene in
// Cowork after Home plays the arrival. Reduced motion: a hard switch, nothing travels, nobody bobs.
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Sol } from "./Sol";
import { Bands, Light, reduced, rnd } from "./creature/goo";
import { SOL_BODY, SOL_PATH } from "./solShape";
import { toggleVibe } from "./vibe";
import type { AppMode } from "./ModeSwitch";

// two families from the direction's palette (mine/look/direction/build.py FAM)
const SEA = ["#8fd6c8", "#159d8d", "#0a8e5d", "#08749e", "#0a5f7a"];
const DUSK = ["#ecbd89", "#e8a86d", "#8d6b5b", "#6d5d93", "#432d3b"];

// the box, in its own units (about px at the default size)
const W = 120, H = 46, CX = 60;
const S = 36;                                  // Sol's size in the box
const SX = CX - 0.45 * S, SY = 3;              // where his 100-box sits
const SC = { x: CX, y: SY + 0.56 * S };        // his middle, for the recoil
const R = 8.5;                                 // a friend's radius at rest

type Friend = { cols: string[]; angle: number; seed: number; lobes: number; bulge: number; side: -1 | 1; out: number; back: number };
const FRIENDS: Friend[] = [
  { cols: SEA.slice(1, 4), angle: 60, seed: 41, lobes: 5, bulge: 0.16, side: -1, out: 0, back: 90 },
  { cols: DUSK.slice(0, 3), angle: 100, seed: 42, lobes: 4, bulge: 0.18, side: 1, out: 120, back: 0 },
];
const core = (f: Friend) => ({ x: CX + f.side * 5, y: SC.y });          // inside Sol: where the bridge holds on
const from = (f: Friend) => ({ x: CX + f.side * 13, y: SC.y + 3 });     // at his edge: where a bud swells
const to = (f: Friend) => ({ x: CX + f.side * 37, y: SC.y + 4 });

/** a lobed bud in a 100 box: a circle whose radius wobbles (build3.py pts_bud); `rot` turns the lobes */
function budPath(f: Friend, rot = 0) {
  const r = rnd(f.seed), p1 = r() * 6.3, p2 = r() * 6.3, n = 40;
  let d = "";
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const rad = 38 * (1 + f.bulge * Math.sin(f.lobes * t + p1 + rot) + 0.06 * Math.sin(2 * t + p2));
    d += `${i ? "L" : "M"}${(50 + rad * Math.cos(t)).toFixed(1)} ${(50 + rad * Math.sin(t)).toFixed(1)}`;
  }
  return d + "Z";
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// the mode the last scene showed, so a scene mounting in the other side knows it is a switch
let shown: AppMode | null = null;

export function SeatScene({ mode, size = 46 }: { mode: AppMode; size?: number }) {
  const id = useId().replace(/:/g, "");
  const [start] = useState<AppMode>(() => shown ?? mode);
  useLayoutEffect(() => { shown = mode; }, [mode]);
  const goo = useRef<SVGGElement>(null), sol = useRef<SVGGElement>(null), proxy = useRef<SVGGElement>(null);
  const bud = useRef<(SVGGElement | null)[]>([]), neck = useRef<(SVGGElement | null)[]>([]), eye = useRef<(SVGGElement | null)[]>([]);
  const shape = useRef<(SVGPathElement | null)[][]>([[], []]);
  // each friend is a spring on p: 0 inside Sol, 1 at its spot
  const st = useRef(FRIENDS.map(() => ({ p: start === "cowork" ? 1 : 0, g: start === "cowork" ? 1 : 0, v: 0, wait: 0, spin: 0 })));
  const raf = useRef(0);

  const draw = () => {
    let recoil = 0;
    FRIENDS.forEach((f, i) => {
      const s = st.current[i], a = from(f), b = to(f);
      const pc = clamp(s.p, 0, 1.4);
      const g = s.g * s.g * (3 - 2 * s.g);                 // the swell, eased
      const c = core(f);
      const x = a.x + (b.x - a.x) * pc, y = a.y + (b.y - a.y) * pc - Math.sin(Math.PI * clamp(pc)) * 7;
      const vx = (b.x - a.x) * s.v, vy = (b.y - a.y) * s.v - Math.cos(Math.PI * clamp(pc)) * 7 * Math.PI * s.v;
      const sp = Math.hypot(vx, vy), str = Math.min(0.38, sp * 0.0016), ang = (Math.atan2(vy, vx) * 180) / Math.PI;
      // landing: a squash as the spring turns round past its spot
      const land = s.p > 0.9 ? clamp((s.p - 1) * 2.4, -0.16, 0.16) : 0;
      const k = (R / 38) * g;
      bud.current[i]?.setAttribute("transform",
        `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${ang.toFixed(1)}) scale(${(1 + str).toFixed(3)} ${(1 - str * 0.55).toFixed(3)}) rotate(${(-ang).toFixed(1)}) scale(${(k * (1 + land)).toFixed(4)} ${(k * (1 - land)).toFixed(4)}) translate(-50 -50)`);
      if (sp > 1) { s.spin += sp * 0.00012 * f.side; shape.current[i].forEach((el) => el?.setAttribute("d", budPath(f, s.spin))); }
      // the bridge: a drop between Sol and the bud that thins and goes, so the goo stretches and lets go
      const nr = R * 0.6 * g * (1 - smooth(0.25, 0.68, s.p)), nx = c.x + (x - c.x) * 0.62, ny = c.y + (y - c.y) * 0.62;
      neck.current[i]?.setAttribute("transform", `translate(${nx.toFixed(2)} ${ny.toFixed(2)}) scale(${(nr / 38).toFixed(4)}) translate(-50 -50)`);
      const open = smooth(0.62, 0.95, s.p);
      const e = eye.current[i];
      if (e) {
        e.setAttribute("transform", `translate(${x.toFixed(2)} ${(y + land * 3).toFixed(2)}) scale(${((R / 38) * Math.max(g, 0.01)).toFixed(4)} ${((R / 38) * Math.max(g, 0.01) * Math.max(0.08, open)).toFixed(4)}) translate(-50 -50)`);
        e.style.opacity = open > 0.02 ? "1" : "0";
      }
      if (i === 0) recoil = clamp(s.v * 0.035 * (s.p < 0.6 ? 1 : 0), -0.09, 0.09);
    });
    const tr = `translate(${SC.x} ${SC.y}) scale(${(1 + recoil).toFixed(3)} ${(1 - recoil).toFixed(3)}) translate(${-SC.x} ${-SC.y})`;
    sol.current?.setAttribute("transform", tr);
    proxy.current?.setAttribute("transform", tr);
    // at rest in Home the goo is empty: no filter work at all
    const home = st.current.every((s) => s.p <= 0.001 && s.g <= 0.001 && Math.abs(s.v) < 0.01);
    if (goo.current) goo.current.style.display = home ? "none" : "";
  };

  const run = (target: number) => {
    cancelAnimationFrame(raf.current);
    const now = performance.now();
    st.current.forEach((s, i) => { s.wait = now + (target ? FRIENDS[i].out : FRIENDS[i].back); });
    if (reduced) { st.current.forEach((s) => { s.p = target; s.g = target; s.v = 0; }); draw(); return; }
    let last = now;
    const tick = (t: number) => {
      const dt = Math.min(0.034, (t - last) / 1000); last = t;
      let moving = false;
      for (const s of st.current) {
        if (t < s.wait) { moving = true; continue; }
        // out: first the bud swells at Sol's edge, still held by the bridge, and only then does it leave
        if (target && s.g < 1) { s.g = Math.min(1, s.g + dt / 0.3); moving = true; if (s.g < 0.7) continue; }
        // out: lively, one clear overshoot; back: quicker and calmer, so they are taken in rather than flung
        const kk = target ? 64 : 46, z = target ? 0.5 : 0.9;
        for (let left = dt; left > 1e-6; left -= 1 / 240) {
          const h = Math.min(left, 1 / 240);
          s.v += (-(s.p - target) * kk - 2 * z * Math.sqrt(kk) * s.v) * h;
          s.p += s.v * h;
        }
        if (!target && s.p < 0) { s.p = 0; s.v = 0; }
        // back: once it is home behind him it is taken in
        if (!target) s.g = Math.min(s.g, smooth(0, 0.3, s.p));
        if (Math.abs(s.p - target) > 0.0015 || Math.abs(s.v) > 0.003 || (!target && s.g > 0.001)) moving = true; else { s.p = target; s.g = target; s.v = 0; }
      }
      draw();
      if (moving) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useLayoutEffect(() => {
    draw();
    const target = mode === "cowork" ? 1 : 0;
    // the swell counts too: a flip back while a bud is still swelling at his edge (it has not left yet, p is 0) must
    // still take it in, or it stays there half grown
    if (st.current.some((s) => s.p !== target || s.v !== 0 || s.g !== target)) run(target);
    return () => cancelAnimationFrame(raf.current);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sol is the vibe switch (vibe.ts): a click toggles, a hold opens its settings
  const timer = useRef(0), held = useRef(false);
  const down = () => {
    held.current = false;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { held.current = true; window.dispatchEvent(new CustomEvent("sol-vibe-edit")); }, 450);
  };
  const clear = () => window.clearTimeout(timer.current);
  const up = (ev: React.PointerEvent<SVGGElement>) => { clear(); if (!held.current) toggleVibe(ev.currentTarget as unknown as HTMLElement); };

  const fid = `${id}goo`;
  return (
    <svg className={`seat-scene ${reduced ? "still" : ""}`} width={(size * W) / H} height={size} viewBox={`0 0 ${W} ${H}`} data-mode={mode}>
      <defs>
        <filter id={fid} filterUnits="userSpaceOnUse" x={-20} y={-20} width={W + 40} height={H + 40} colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="b" />
          <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="g" />
          <feBlend in="SourceGraphic" in2="g" />
        </filter>
        {FRIENDS.map((f, i) => <Bands key={i} id={`${id}f${i}`} cols={f.cols} angle={f.angle} spread={0.8} />)}
        <Light id={`${id}l`} cx={38} cy={32} r={40} />
      </defs>
      {/* the goo: a copy of Sol's outline (hidden under him, only its bridges show), the bridges and the buds; the friends
          never take the pointer, so a press on Sol is his even while they pass over him */}
      <g ref={goo} filter={`url(#${fid})`} pointerEvents="none">
        <g ref={proxy}><g transform={`translate(${SC.x} ${SC.y}) scale(0.9) translate(${-SC.x} ${-SC.y}) translate(${SX} ${SY}) scale(${S / 100})`}><path d={SOL_PATH} fill={SOL_BODY} /></g></g>
        {FRIENDS.map((f, i) => (
          <g key={i}>
            <g ref={(el) => { neck.current[i] = el; }}><circle cx="50" cy="50" r="38" fill={`url(#${id}f${i})`} /></g>
            <g ref={(el) => { bud.current[i] = el; }}>
              <g className={`bob b${i}`}>
                {(["f", "lhi", "llo"] as const).map((k, j) => (
                  <path key={k} ref={(el) => { shape.current[i][j] = el; }} d={budPath(f)} fill={k === "f" ? `url(#${id}f${i})` : `url(#${id}${k})`} />
                ))}
              </g>
            </g>
          </g>
        ))}
      </g>
      <g ref={sol} className="seat-sol" onPointerDown={down} onPointerUp={up} onPointerCancel={clear}>
        <title>vibe mode: click to turn it on or off, hold to set it up</title>
        <g transform={`translate(${SX} ${SY})`}><Sol size={S} watch /></g>
      </g>
      {/* the friends' eyes, crisp on top: each looks toward Sol */}
      {FRIENDS.map((f, i) => (
        <g key={i} ref={(el) => { eye.current[i] = el; }} style={{ opacity: 0 }} pointerEvents="none">
          <g className={`bob b${i}`}>
            <g className={`blink k${i}`}>
              {[[30, "#000"], [37, "#fff"], [55, "#000"], [62, "#fff"]].map(([x, c]) => (
                <rect key={x} x={(x as number) - f.side * 5} y={42} width={7} height={8} fill={c as string} />
              ))}
            </g>
          </g>
        </g>
      ))}
    </svg>
  );
}
