// Sol is goo (mine/look/DIRECTION-4.html, 2026-10-27): the colour and the small marks every cosmetic bit shares.
// Six colours with a job each, all siblings of the brand's pink, orange, yellow and lime; nothing is a flat fill, every
// body is a banded gradient lit from the top left and shaded below. The ambient colour (shore) varies a little per
// seed, so no two ambient things match while the meaning stays one. The daily mark (Droplet) is six droplets under a
// goo filter that arrange themselves: a turning drop while running; pulled in and drawn out into a smooth check when
// done; into a bar that sags when it failed; a breathing body with a halo when it needs you. SMIL, so it moves the same
// in WebKit and Chromium and costs no frame loop; under prefers-reduced-motion everything shows its rest frame.
import { useId } from "react";

export const JOBS = {
  brand: ["#fcd50a", "#9ed40a", "#fb7111", "#ef3a2a", "#b8ee3a", "#fb5ad0"],
  shore: ["#ffe08a", "#ffb36b", "#ff8fb8", "#ff6fd0", "#c98cff"],
  spring: ["#f6ff6a", "#b8ee3a", "#5fd98a", "#22c9b6"],
  ember: ["#ffb084", "#fb7111", "#ef3a2a", "#c0177a"],
  sun: ["#fff28a", "#fcd50a", "#fba422", "#fb7111"],
  stone: ["#e8e2dc", "#c9bfb8", "#9c918c", "#5f5553"],
} as const;
export type Job = keyof typeof JOBS;

export const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// a small deterministic random from a seed (a string or a number), so an ambient thing keeps its own variation
export function rnd(seed: string | number) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

/** ambient, varied: three neighbouring shore colours at the seed's own angle */
export function shoreVar(seed: string | number): { cols: string[]; angle: number; spread: number } {
  const r = rnd(seed), cols = JOBS.shore, k = Math.floor(r() * (cols.length - 2));
  return { cols: cols.slice(k, k + 3), angle: [30, 60, 90, 120, 150][Math.floor(r() * 5)], spread: 0.8 + r() * 0.4 };
}

/** a banded gradient with soft seams in a 100 x 100 box: the first colour is the light */
export function Bands({ id, cols, angle = 70, spread = 1, soft = 0.05 }: { id: string; cols: readonly string[]; angle?: number; spread?: number; soft?: number }) {
  const rad = (angle * Math.PI) / 180, n = cols.length;
  const x2 = 50 + 50 * spread * Math.cos(rad), y2 = 50 + 50 * spread * Math.sin(rad);
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={100 - x2} y1={100 - y2} x2={x2} y2={y2}>
      {cols.flatMap((c, j) => [
        <stop key={`${j}a`} offset={Math.max(0, j / n + soft)} stopColor={c} />,
        <stop key={`${j}b`} offset={Math.min(1, (j + 1) / n - soft)} stopColor={c} />,
      ])}
    </linearGradient>
  );
}

/** the same bands as a CSS gradient, for a fill that is a box rather than a shape (a pill's sheen, the effort heat) */
export function bandsCss(cols: readonly string[], angle = 90, soft = 0.05) {
  const n = cols.length, pc = (v: number) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
  return `linear-gradient(${angle}deg, ${cols.map((c, j) => `${c} ${pc(j / n + soft)}, ${c} ${pc((j + 1) / n - soft)}`).join(", ")})`;
}

/** the light: a highlight at the top left and a shade at the bottom right, as two radial gradients to paint over a body */
export function Light({ id, cx = 36, cy = 30, r = 34 }: { id: string; cx?: number; cy?: number; r?: number }) {
  return (<>
    <radialGradient id={`${id}hi`} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={r}><stop offset="0" stopColor="#fff" stopOpacity=".5" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
    <radialGradient id={`${id}lo`} gradientUnits="userSpaceOnUse" cx={100 - cx} cy={110 - cy} r={r + 16}><stop offset="0" stopColor="#000" stopOpacity=".22" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
  </>);
}

/** the goo: a blur and an alpha threshold, so near shapes bridge into one body */
export function Goo({ id, blur = 2.2 }: { id: string; blur?: number }) {
  return (
    <filter id={id} filterUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120" colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="b" />
      <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" />
    </filter>
  );
}

// ---- the daily mark ----
type Pt = [number, number, number];   // x, y, r
const SP = ".5 0 .15 1";
const cluster = (phase: number): Pt[] => Array.from({ length: 6 }, (_, i) => {
  const a = phase + (i * 2 * Math.PI) / 6, big = i % 2 === 0, rr = big ? 19 : 9;
  return [50 + rr * Math.cos(a), 50 + rr * Math.sin(a), big ? 15 : 11];
});
const TURN = Array.from({ length: 7 }, (_, k) => cluster((k * 2 * Math.PI) / 6));
const ONE: Pt[] = Array.from({ length: 6 }, () => [50, 50, 13]);
const f1 = (v: number) => v.toFixed(1);
const keyed = (frames: Pt[][], times: number[], dur: number, once?: boolean) => {
  const kt = times.map((t) => t.toFixed(2)).join(";"), spl = Array(frames.length - 1).fill(SP).join(";");
  const rep = once ? { fill: "freeze" as const } : { repeatCount: "indefinite" };
  return (i: number, attr: "cx" | "cy" | "r") => (
    <animate attributeName={attr} dur={`${dur}s`} values={frames.map((f) => f1(f[i][attr === "cx" ? 0 : attr === "cy" ? 1 : 2])).join(";")} keyTimes={kt} calcMode="spline" keySplines={spl} {...rep} />
  );
};
function Drops({ frames, times, dur, fill, once }: { frames: Pt[][]; times: number[]; dur: number; fill: string; once?: boolean }) {
  const an = keyed(frames, times, dur, once);
  const first = reduced ? frames[frames.length - 1] : frames[0];
  return (<>
    {first.map(([x, y, r], i) => (
      <circle key={i} cx={f1(x)} cy={f1(y)} r={f1(r)} fill={fill}>
        {!reduced && <>{an(i, "cx")}{an(i, "cy")}{an(i, "r")}</>}
      </circle>
    ))}
  </>);
}

const CHECK_D = "M24 52 L42 70 L78 30", CHECK_LEN = 78;
const BAR_D = "M28 50 L72 50", BAR_SAG = "M28 54 Q50 66 72 54";

export type DropletKind = "running" | "done" | "failed" | "needs";
/**
 * the daily mark. `running` turns for ever; `done` and `failed` show their settled mark, or with `land` play the arrival
 * once (the drop pulls in, the check or bar draws out of it); `needs` breathes with a halo. `seed` picks the ambient
 * variation of the running drop.
 */
export function Droplet({ kind, size = 16, seed = 0, land, className, title }: { kind: DropletKind; size?: number; seed?: string | number; land?: boolean; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const sv = shoreVar(seed);
  const g = `${id}g`, s = `${id}s`, goo = `${id}f`;
  const play = !!land && !reduced;
  let body: React.ReactNode;
  if (kind === "running") {
    body = <g filter={`url(#${goo})`}><Drops frames={TURN} times={[0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]} dur={4.2} fill={`url(#${s})`} /></g>;
  } else if (kind === "needs") {
    body = (<>
      <circle cx="50" cy="50" r="30" fill="none" stroke={JOBS.sun[1]} strokeWidth="3">
        {!reduced && <><animate attributeName="r" dur="2.6s" values="22;48" repeatCount="indefinite" /><animate attributeName="opacity" dur="2.6s" values=".8;0" repeatCount="indefinite" /></>}
      </circle>
      <g filter={`url(#${goo})`}><Drops frames={[cluster(0).map(([x, y, r]) => [50 + (x - 50) * 0.9, 50 + (y - 50) * 0.9, r * 0.9] as Pt), cluster(0.5).map(([x, y, r]) => [50 + (x - 50) * 1.25, 50 + (y - 50) * 1.25, r * 0.85] as Pt), cluster(1).map(([x, y, r]) => [50 + (x - 50) * 0.9, 50 + (y - 50) * 0.9, r * 0.9] as Pt)]} times={[0, 0.35, 1]} dur={2.6} fill={`url(#${g})`} /></g>
    </>);
  } else {
    const done = kind === "done";
    const d = done ? CHECK_D : play ? BAR_D : BAR_SAG, len = done ? CHECK_LEN : 44;
    // settled: the mark as one smooth stroke in its colour; arriving: the running drop pulls into one dot, the stroke
    // draws out of it with the dot riding its tip, the bar then sags
    const stroke = (
      <path d={d} fill="none" stroke={`url(#${g})`} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={play ? len : undefined} strokeDashoffset={play ? len : undefined}>
        {play && <animate attributeName="stroke-dashoffset" begin="0.55s" dur="0.42s" values={`${len};-2;0`} keyTimes="0;.85;1" calcMode="spline" keySplines={`${SP};${SP}`} fill="freeze" />}
        {play && !done && <animate attributeName="d" begin="1.1s" dur="0.5s" values={`${BAR_D};${BAR_SAG}`} calcMode="spline" keySplines={SP} fill="freeze" />}
      </path>
    );
    body = (
      <g filter={`url(#${goo})`}>
        {play && (<>
          <g><Drops frames={[TURN[0], TURN[2], ONE]} times={[0, 0.5, 1]} dur={0.55} fill={`url(#${s})`} once /><animate attributeName="opacity" begin="0.55s" dur="0.3s" values="1;0" fill="freeze" /></g>
          <circle r="13" fill={`url(#${g})`}><animateMotion begin="0.55s" dur="0.42s" path={d} fill="freeze" calcMode="spline" keySplines={SP} keyTimes="0;1" keyPoints="0;1" /><animate attributeName="r" begin="0.97s" dur="0.3s" values="13;8.5" fill="freeze" /><animate attributeName="opacity" begin="0s" dur="0.55s" values="0;0" fill="freeze" /><animate attributeName="opacity" begin="0.55s" dur="0.01s" values="1" fill="freeze" /></circle>
        </>)}
        {stroke}
      </g>
    );
  }
  const cls = `droplet droplet-${kind} ${className ?? ""}`.trim();
  return (
    <svg className={cls} width={size} height={size} viewBox="0 0 100 100" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <defs>
        <Goo id={goo} />
        <Bands id={s} cols={sv.cols} angle={sv.angle} spread={0.7} />
        <Bands id={g} cols={kind === "failed" ? JOBS.ember : kind === "needs" ? JOBS.sun : JOBS.spring} angle={kind === "failed" ? 80 : 60} spread={0.7} />
        <Light id={id} cx={40} cy={36} r={44} />
      </defs>
      {body}
    </svg>
  );
}

// ---- people: the nine families, one per person, so everyone's agent is told apart at a glance ----
export const FAMILIES = {
  sea: ["#8fd6c8", "#159d8d", "#0a8e5d", "#08749e"],
  tide: ["#f3c2d8", "#f29f7b", "#c95442", "#3327e8"],
  dusk: ["#ecbd89", "#e8a86d", "#8d6b5b", "#6d5d93"],
  parade: ["#f9c3a9", "#f0a9c9", "#d63b34", "#a1bcb4"],
  meadow: ["#f0e060", "#b4de9a", "#8bc34a", "#3f8fe0"],
  fog: ["#b0c5b8", "#7e8ee8", "#3b5bdb", "#5bb07a"],
  sun: JOBS.sun,
  ember: JOBS.ember,
  shore: JOBS.shore,
} as const;
export type Family = keyof typeof FAMILIES;
const FAMILY_NAMES = Object.keys(FAMILIES) as Family[];
/** the family a person wears: their own by name, stable across machines */
export const familyOf = (login: string): Family => FAMILY_NAMES[Math.floor(rnd(login.toLowerCase())() * FAMILY_NAMES.length)];

/** a bud: a lobed body of its own from a seed, in a 100 x 100 box (radius 38, lobes of sin(kθ)), as a path */
export function budPath(seed: string | number, lobes = 4, bulge = 0.2, n = 48): string {
  const r = rnd(seed), p1 = r() * 6.3, p2 = r() * 6.3;
  const pts: [number, number][] = Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI, rad = 38 * (1 + bulge * Math.sin(lobes * t + p1) + 0.06 * Math.sin(2 * t + p2));
    return [50 + rad * Math.cos(t), 50 + rad * Math.sin(t)];
  });
  // Catmull-Rom through the points as cubic Béziers
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1_ = pts[i], p2_ = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1_[0] + (p2_[0] - p0[0]) / 6, p1_[1] + (p2_[1] - p0[1]) / 6], c2 = [p2_[0] - (p3[0] - p1_[0]) / 6, p2_[1] - (p3[1] - p1_[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2_[0].toFixed(1)} ${p2_[1].toFixed(1)}`;
  }
  return d + "Z";
}

/** a person's agent as a bud in their family, eyes open while `on` */
export function Bud({ login, size = 14, on = true, className }: { login: string; size?: number; on?: boolean; className?: string }) {
  const id = useId().replace(/:/g, "");
  const fam = familyOf(login), r = rnd(login), lobes = 3 + Math.floor(r() * 3), angle = 30 + Math.floor(r() * 5) * 30;
  const d = budPath(login, lobes, 0.16 + r() * 0.1);
  return (
    <svg className={`bud ${className ?? ""}`.trim()} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs><Bands id={`${id}b`} cols={FAMILIES[fam]} angle={angle} spread={0.9} /><Light id={id} /></defs>
      <path d={d} fill={`url(#${id}b)`} />
      <path d={d} fill={`url(#${id}lo)`} /><path d={d} fill={`url(#${id}hi)`} />
      {on && <g><rect x="30" y="44" width="7" height="7.5" fill="#000" /><rect x="37" y="44" width="7" height="7.5" fill="#fff" /><rect x="50" y="44" width="7" height="7.5" fill="#000" /><rect x="57" y="44" width="7" height="7.5" fill="#fff" /></g>}
    </svg>
  );
}
