// Sol, flat (Marco's splat, 2026-10-26, replacing the pixel creature's mark): the outline from sol/design/sol.svg, six
// colour lobes laid flat with soft seams, no shine, and the two black-and-white squares for eyes. One body, any colour:
// `fill` paints the whole body one colour (a seat's gradient, a state's colour) and the lobes stay off.
// Its life, all small and all CSS or one timer: it breathes (a slow scale), blinks now and then, and when `watch` is on
// the eyes follow the pointer and a click squashes it (the creature's poke). It wears the creature's state: a done flash
// washes it green, wrong or unplugged ember, Your call leaves the eyes wide open, listening and speaking sway it.
// Under prefers-reduced-motion it stands still.
import { useEffect, useId, useRef, useState } from "react";
import { live, poke } from "./creature/state";
import { SOL_PATH, SOL_BODY, SOL_LOBES, SOL_EYES } from "./solShape";

const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const WASH: Partial<Record<typeof live.look, string>> = { ok: "#8de84a", warn: "#f2867c" };

export function Sol({ size = 22, fill, watch, eyes = true, className, onClick, title }: {
  size?: number; fill?: string; watch?: boolean; eyes?: boolean; className?: string; onClick?: () => void; title?: string;
}) {
  const id = useId();
  const el = useRef<SVGSVGElement>(null);
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState(live.look);
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
      <g className="body">
        {fill ? <path d={SOL_PATH} fill={fill} /> : (
          <g clipPath={`url(#${id}b)`}>
            <rect width="100" height="100" fill={SOL_BODY} />
            {SOL_LOBES.map((_, i) => <rect key={i} width="100" height="100" fill={`url(#${id}g${i})`} />)}
          </g>
        )}
        {wash && <path d={SOL_PATH} fill={wash} opacity=".85" />}
        {eyes && (
          <g className="eyes" style={{ transform: blink ? "translate(var(--lx, 0px), var(--ly, 0px)) scaleY(.12)" : "translate(var(--lx, 0px), var(--ly, 0px))" }}>
            {SOL_EYES.map((e, i) => <rect key={i} x={e.x} y={e.y} width={e.w} height={look === "attention" ? e.h * 1.25 : e.h} fill={e.fill} />)}
          </g>
        )}
      </g>
    </svg>
  );
}
