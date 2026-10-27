// Voice: Sol breathes sound (mine/look/DIRECTION-4.html, "Voice", 2026-10-27; Marco: the body with rings is good and
// serves dictation too, a row of dots ruins it). Two pieces, both SVG driven by one small frame loop per instance that
// reads the live level (`live.env`, 0..1, from creature/state.ts) and writes attributes straight to the nodes, so React
// never re-renders per frame. A real level when there is one, otherwise a gentle idle; under prefers-reduced-motion
// both stand still on a mid frame.
//  - VoiceBody: Sol's body with lobed rings in the brand's bands. Speaking, the rings leave the body and fade as they
//    grow; listening, they come in from outside and are absorbed. The body swells a little as each ring leaves or lands;
//    eyes open speaking, half shut listening. Louder means rings come faster and thicker. The call button's badge.
//  - VoiceRibbon: the chat bar's dictation meter, a small liquid ribbon whose edges are two summed sines that rise with
//    the level, in the ambient shore bands. One continuous shape, no dots.
import { useEffect, useId, useRef } from "react";
import { live } from "./state";
import { Bands, JOBS, Light, reduced } from "./goo";
import { SOL_PATH, SOL_BODY, SOL_LOBES, SOL_EYES } from "../solShape";

type Level = () => number;
const TAU = Math.PI * 2;
const f1 = (v: number) => v.toFixed(1);

/** the level to draw: the given one, else the live envelope; never below a slow idle breath */
function useLevel(level?: Level) {
  const sm = useRef(0);
  return (dt: number, t: number) => {
    const v = level ? level() : live.env;   // no level yet (undefined, NaN) is silence, never a NaN in the drawing
    const raw = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    // the engine ticks the envelope at 20-60 fps (or every 250 ms when nothing draws): smooth it here so it glides
    sm.current += (raw - sm.current) * (1 - Math.exp(-dt / 0.07));
    const idle = 0.16 + 0.07 * Math.sin(t * 1.7);
    return Math.max(sm.current, idle);
  };
}

/** one frame loop for a mounted piece; stops when unmounted, does nothing under reduced motion */
function useFrames(step: (dt: number, t: number) => void) {
  const fn = useRef(step);
  fn.current = step;
  useEffect(() => {
    if (reduced) return;
    let raf = 0, prev = performance.now();
    const go = (now: number) => {
      raf = requestAnimationFrame(go);
      if (document.hidden) { prev = now; return; }
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      fn.current(dt, now / 1000);
    };
    raf = requestAnimationFrame(go);
    return () => cancelAnimationFrame(raf);
  }, []);
}

// ---- the body with rings ----
const RINGS = 3, N = 54, R0 = 38;
/** a six-lobed closed outline round (50, 50): a circle whose radius wobbles with sin(6θ), at a scale */
function lobed(scale: number, wob: number, ph: number) {
  let d = "";
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * TAU, r = R0 * scale * (1 + wob * Math.sin(6 * a + ph));
    d += `${i ? "L" : "M"}${f1(50 + r * Math.cos(a))} ${f1(50 + r * Math.sin(a))}`;
  }
  return d + "Z";
}
// the body sits centred (its outline's box centre is about 45, 50) at this scale
const BODY_S = 0.64, BX = 45, BY = 50;
// the rings travel between the body's edge and the box's edge
const IN = 0.62, OUT = 1.28;
// the brand, ordered so neighbours blend warm: pink, orange, yellow, lime
const RING_COLS = [JOBS.brand[5], JOBS.brand[2], JOBS.brand[0], JOBS.brand[4]];

export function VoiceBody({ kind, size = 22, level, className, title }: { kind: "speaking" | "listening"; size?: number; level?: Level; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const rings = useRef<(SVGPathElement | null)[]>([]);
  const body = useRef<SVGGElement>(null);
  const lvl = useLevel(level);
  const st = useRef({ phase: 0, swell: 0 });
  const speak = kind === "speaking";

  // where a ring is at progress p (0 = just born, 1 = gone), and how it looks there
  const place = (p: number, k: number, e: number, t: number) => {
    const s = speak ? IN + (OUT - IN) * p : OUT - (OUT - IN) * p;
    // fade in quickly at its start and out over its travel: born strong at the body, or arriving faint and landing strong
    const op = speak ? Math.min(1, p * 8) * (1 - p) ** 1.3 : Math.min(1, (1 - p) * 8) * p ** 1.1;
    const w = (4.5 + 7 * e) * (speak ? 1 - 0.45 * p : 0.55 + 0.45 * p);
    return { d: lobed(s, 0.07 + 0.05 * e, k * 2.1 + t * (speak ? 0.6 : -0.6)), op: Math.min(1, op * 1.5) * (0.8 + 0.2 * e), w };
  };

  useFrames((dt, t) => {
    const e = lvl(dt, t), s = st.current;
    s.phase = (s.phase + dt * (0.32 + 0.95 * e)) % 1;
    let bump = 0;
    for (let k = 0; k < RINGS; k++) {
      const p = (s.phase + k / RINGS) % 1, el = rings.current[k];
      // the body swells as a ring leaves it (speaking, p near 0) or lands in it (listening, p near 1)
      bump = Math.max(bump, Math.exp(-(speak ? p : 1 - p) * 9));
      if (!el) continue;
      const r = place(p, k, e, t);
      el.setAttribute("d", r.d);
      el.setAttribute("stroke-width", f1(r.w));
      el.setAttribute("opacity", r.op.toFixed(2));
    }
    s.swell += (bump * (0.04 + 0.06 * e) - s.swell) * (1 - Math.exp(-dt / 0.06));
    body.current?.setAttribute("transform", `translate(50 50) scale(${(BODY_S * (1 + s.swell)).toFixed(4)}) translate(${-BX} ${-BY})`);
  });

  const eyeOpen = speak ? 1 : 0.42;
  return (
    <svg className={`voicebody voice-${kind} ${className ?? ""}`.trim()} width={size} height={size} viewBox="0 0 100 100" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <defs>
        {/* the rings: the brand's bands across each ring's own box, so every ring carries all of them as it grows */}
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
          {RING_COLS.flatMap((c, j) => [<stop key={`${j}a`} offset={j / RING_COLS.length + 0.03} stopColor={c} />, <stop key={`${j}b`} offset={(j + 1) / RING_COLS.length - 0.03} stopColor={c} />])}
        </linearGradient>
        <clipPath id={`${id}b`}><path d={SOL_PATH} /></clipPath>
        {SOL_LOBES.map((l, i) => (
          <radialGradient key={i} id={`${id}g${i}`} cx={l.x} cy={l.y} r={l.r} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={l.c0} /><stop offset=".45" stopColor={l.c1} /><stop offset="1" stopColor={l.c1} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {Array.from({ length: RINGS }, (_, k) => {
        const r = place((k + 0.5) / RINGS, k, 0.3, 0);
        return <path key={k} ref={(el) => { rings.current[k] = el; }} d={r.d} fill="none" stroke={`url(#${id}r)`} strokeWidth={f1(r.w)} strokeLinejoin="round" opacity={r.op.toFixed(2)} />;
      })}
      <g ref={body} transform={`translate(50 50) scale(${BODY_S}) translate(${-BX} ${-BY})`}>
        <g clipPath={`url(#${id}b)`}>
          <rect width="100" height="100" fill={SOL_BODY} />
          {SOL_LOBES.map((_, i) => <rect key={i} width="100" height="100" fill={`url(#${id}g${i})`} />)}
        </g>
        {SOL_EYES.map((e, i) => <rect key={i} x={e.x} y={e.y + e.h * (1 - eyeOpen)} width={e.w} height={e.h * eyeOpen} fill={e.fill} />)}
      </g>
    </svg>
  );
}

// ---- the ribbon ----
const RN = 28, X0 = 6, X1 = 94;
function ribbon(e: number, t: number) {
  // the half-thickness at u: a lens that tapers to the ends, plus a surface of two sines that rises with the level
  const amp = 6 + 24 * e;
  const top: string[] = [], bot: string[] = [];
  for (let i = 0; i <= RN; i++) {
    const u = i / RN, x = X0 + (X1 - X0) * u, env = Math.sin(Math.PI * u) ** 0.9;
    const w1 = 0.5 + 0.5 * (0.6 * Math.sin(TAU * 1.15 * u - t * 5.2) + 0.4 * Math.sin(TAU * 2.3 * u + t * 3.4));
    const w2 = 0.5 + 0.5 * (0.55 * Math.sin(TAU * 1.4 * u - t * 4.1 + 1.3) + 0.45 * Math.sin(TAU * 2.0 * u + t * 2.7 + 0.4));
    top.push(`${f1(x)} ${f1(50 - env * (7 + amp * w1))}`);
    bot.push(`${f1(x)} ${f1(50 + env * (7 + amp * 0.8 * w2))}`);
  }
  return `M${top.join("L")}L${bot.reverse().join("L")}Z`;
}

export function VoiceRibbon({ size = 20, level, className, title }: { size?: number; level?: Level; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const path = useRef<SVGPathElement>(null);
  const shine = useRef<SVGPathElement>(null);
  const lvl = useLevel(level);
  const tt = useRef(0);
  useFrames((dt, t) => {
    const e = lvl(dt, t);
    tt.current += dt * (0.7 + 1.1 * e);   // louder, the surface runs quicker
    const d = ribbon(e, tt.current);
    path.current?.setAttribute("d", d);
    shine.current?.setAttribute("d", d);
  });
  const d0 = ribbon(0.35, 0.8);
  return (
    <svg className={`voiceribbon ${className ?? ""}`.trim()} width={size} height={size} viewBox="0 0 100 100" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <defs>
        <Bands id={`${id}s`} cols={JOBS.shore} angle={10} spread={1} soft={0.06} />
        <Light id={id} cx={34} cy={34} r={40} />
      </defs>
      <path ref={path} d={d0} fill={`url(#${id}s)`} />
      <path ref={shine} d={d0} fill={`url(#${id}hi)`} />
    </svg>
  );
}
