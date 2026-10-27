// Sol, flat (Marco's splat, 2026-10-26, replacing the pixel creature's mark): the outline from sol/design/sol.svg, six
// colour lobes laid flat with soft seams, no shine, and the two black-and-white squares for eyes. One body, any colour:
// `fill` paints the whole body one colour (a seat's gradient, a state's colour) and the lobes stay off.
// Its life, all small and all CSS or one timer: it breathes (a slow scale), blinks now and then, and when `watch` is on
// the eyes follow the pointer and a click squashes it (the creature's poke). It wears the creature's state: a done flash
// washes it green, wrong or unplugged ember, Your call leaves the eyes wide open, listening and speaking sway it.
// Under prefers-reduced-motion it stands still.
// `life` hands a caller (the first run, firstrun/FirstRun.tsx) the body on cue: a hop with its squash and stretch, the
// eyes held shut or half open (presence: shut while it starts), and a look worn for a moment (a sense landing washes it
// green). The drops it sheds are the caller's (a goo layer under it, so they leave him with a neck).
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { live, poke } from "./creature/state";
import { SOL_PATH, SOL_BODY, SOL_LOBES, SOL_EYES } from "./solShape";

const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const WASH: Partial<Record<typeof live.look, string>> = { ok: "#8de84a", warn: "#f2867c" };
type Look = typeof live.look;

export type SolLife = {
  /** a hop: down into a squash, up stretched, a squash on landing; `power` 1 is a full hop (about a fifth of him) */
  hop(power?: number): void;
  /** the eyes: 1 open, 0.4 half shut (starting), 0.12 shut */
  eyes(open: number): void;
  /** wear a look for `ms` (or until the next call with null), over the creature's own */
  wear(look: Look | null, ms?: number): void;
};

/** the hop's keyframes, for Sol and for anything that must move with him (the first run's goo copy of his outline) */
export function hopKeys(power = 1): [Keyframe[], KeyframeAnimationOptions] {
  const p = Math.max(0.15, Math.min(2, power)), up = -18 * p, sq = 0.1 * Math.min(1.4, p);
  return [[
    { transform: "translateY(0) scale(1, 1)" },
    { transform: `translateY(0) scale(${1 + sq}, ${1 - sq})`, offset: 0.16 },
    { transform: `translateY(${up}px) scale(${1 - sq * 0.6}, ${1 + sq * 0.9})`, offset: 0.48 },
    { transform: `translateY(${up * 0.35}px) scale(1, 1.02)`, offset: 0.7 },
    { transform: `translateY(0) scale(${1 + sq * 1.2}, ${1 - sq * 1.1})`, offset: 0.84 },
    { transform: "translateY(0) scale(1, 1)" },
  ], { duration: 380 + 260 * Math.min(1.4, p), easing: "cubic-bezier(.3,.7,.4,1)" }];
}

export function Sol({ size = 22, fill, watch, eyes = true, className, onClick, title, life, alone }: {
  size?: number; fill?: string; watch?: boolean; eyes?: boolean; className?: string; onClick?: () => void; title?: string; life?: Ref<SolLife>;
  /** wear only what `life` gives him, not the creature's state (the first run: no engine yet, which is not "unplugged") */
  alone?: boolean;
}) {
  const id = useId();
  const el = useRef<SVGSVGElement>(null);
  const hopEl = useRef<SVGGElement>(null);
  const [blink, setBlink] = useState(false);
  const [own, setLook] = useState(live.look);
  const [worn, setWorn] = useState<Look | null>(null);
  const [open, setOpen] = useState(1);
  const wornT = useRef(0);
  useImperativeHandle(life, () => ({
    hop(power = 1) { const g = hopEl.current; if (g && !reduced) g.animate(...hopKeys(power)); },
    eyes(v) { setOpen(Math.max(0.12, Math.min(1, v))); },
    wear(l, ms) { window.clearTimeout(wornT.current); setWorn(l); if (l && ms) wornT.current = window.setTimeout(() => setWorn(null), ms); },
  }), []);
  useEffect(() => () => window.clearTimeout(wornT.current), []);
  const look = worn ?? (alone ? "rest" : own);
  // blink: a short close at an uneven interval
  useEffect(() => {
    if (reduced || !eyes) return;
    let t = 0;
    const next = () => { t = window.setTimeout(() => { setBlink(true); window.setTimeout(() => { setBlink(false); next(); }, 110); }, 2400 + Math.random() * 3600); };
    next();
    return () => window.clearTimeout(t);
  }, [eyes]);
  // the creature's look, polled: the canvases read `live` each frame, this needs it a few times a second
  useEffect(() => { const t = window.setInterval(() => setLook((l) => (l === live.look ? l : live.look)), 150); return () => window.clearInterval(t); }, []);
  // watch: the eyes slide a little toward the pointer
  useEffect(() => {
    if (!watch || reduced) return;
    const on = (ev: PointerEvent) => {
      const s = el.current; if (!s) return;
      const r = s.getBoundingClientRect(), dx = (ev.clientX - (r.left + r.width / 2)) / r.width, dy = (ev.clientY - (r.top + r.height / 2)) / r.height;
      const k = Math.min(1, Math.hypot(dx, dy) / 3);
      s.style.setProperty("--lx", `${(dx / (Math.hypot(dx, dy) || 1)) * k * 2.4}`);
      s.style.setProperty("--ly", `${(dy / (Math.hypot(dx, dy) || 1)) * k * 1.6}`);
    };
    window.addEventListener("pointermove", on);
    return () => window.removeEventListener("pointermove", on);
  }, [watch]);
  const [squash, setSquash] = useState(false);
  const click = () => { if (!reduced) { setSquash(true); window.setTimeout(() => setSquash(false), 320); } if (watch) poke(); onClick?.(); };
  const wash = WASH[look];
  const cls = ["sol", reduced ? "still" : "", look === "listening" || look === "speaking" ? "sway" : "", look === "thinking" ? "think" : "", squash ? "squash" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <svg ref={el} className={cls} width={size} height={size} viewBox="0 0 100 100" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} onClick={onClick || watch ? click : undefined}>
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={`${id}b`}><path d={SOL_PATH} /></clipPath>
        {!fill && SOL_LOBES.map((l, i) => (
          <radialGradient key={i} id={`${id}g${i}`} cx={l.x} cy={l.y} r={l.r} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={l.c0} /><stop offset=".45" stopColor={l.c1} /><stop offset="1" stopColor={l.c1} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      <g ref={hopEl} className="hop">
      <g className="body">
        {fill ? <path d={SOL_PATH} fill={fill} /> : (
          <g clipPath={`url(#${id}b)`}>
            <rect width="100" height="100" fill={SOL_BODY} />
            {SOL_LOBES.map((_, i) => <rect key={i} width="100" height="100" fill={`url(#${id}g${i})`} />)}
          </g>
        )}
        {wash && <path d={SOL_PATH} fill={wash} opacity=".85" />}
        {eyes && (
          <g className="eyes" style={{ transform: blink || open < 1 ? `translate(var(--lx, 0px), var(--ly, 0px)) scaleY(${blink ? 0.12 : open})` : "translate(var(--lx, 0px), var(--ly, 0px))" }}>
            {SOL_EYES.map((e, i) => <rect key={i} x={e.x} y={e.y} width={e.w} height={look === "attention" ? e.h * 1.25 : e.h} fill={e.fill} />)}
          </g>
        )}
      </g>
      </g>
    </svg>
  );
}
