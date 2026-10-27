// The effort pill, the heat inside the capsule (mine/look/DIRECTION-4.html, 2026-10-27; the pixel knob of SITTING-4
// went). The pill's own background wears the level as heat: low a still shore wash, medium three of the brand's bands
// (yellow, orange, pink) drifting, high and above all six brand bands drifting faster the higher it goes. On a level
// change the capsule swells a little and the new heat pours in from the left over the old. At rest a small lit droplet
// sits before the level's word; on pointer down, or a 300 ms hover, the pill opens in place into a track of dots, one
// per level, and the droplet rides the stops on a springy ease, wearing the heat of the level under it. The word sits
// inside the pill to the right of the track in --dim, changing through the dither. The level commits once, on
// release (a click on the open track commits at the clicked stop). Keyboard: left and right on the focused pill step
// the level. SVG and CSS; the word is the one canvas, on the creature's shared loop (creature/Widget.tsx).
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { reducedMotion } from "./motion";
import { Swap } from "./MotionKit";
import { Creature } from "./creature/Widget";
import { bayer } from "./creature/ring";
import { Bands, JOBS, Light, bandsCss } from "./creature/goo";

const OPEN_MS = 180, HOVER_MS = 300, SWEEP_MS = 220, POUR_MS = 520;
const KNOB = 9;                         // the knob's slot (the droplet is a touch larger, it is round)
const STEP = 14;                        // px between stops
const PADL = 11, PADR = 11;             // the pill's own padding
const GAP_REST = 8, GAP_OPEN = 10;      // between the knob (the track) and the word

// the heat of level k of n, by its name when it has a known one, else by where it sits
const LOW = /^(low|minimal|min|none|off)$/, HIGH = /^(high|xhigh|max|ultra)/;
type Heat = { cols: readonly string[]; op: number; dur: number; tier: 0 | 1 | 2 };
const MEDIUM = [JOBS.sun[1], JOBS.brand[2], JOBS.brand[5]] as const;
function heatOf(options: string[], k: number): Heat {
  const n = options.length, name = (options[k] ?? "").toLowerCase();
  const tier = LOW.test(name) ? 0 : name === "medium" ? 1 : HIGH.test(name) ? 2 : n <= 1 ? 1 : k / (n - 1) < 0.25 ? 0 : k / (n - 1) < 0.5 ? 1 : 2;
  if (tier === 0) return { cols: JOBS.shore, op: 0.35, dur: 0, tier };
  if (tier === 1) return { cols: MEDIUM, op: 0.6, dur: 4, tier };
  const first = options.findIndex((o) => HIGH.test(o.toLowerCase()));   // each level above the first high one drifts faster
  return { cols: JOBS.brand, op: 0.9, dur: Math.max(1.2, 2.2 - 0.4 * Math.max(0, k - (first < 0 ? k : first))), tier };
}

// one layer of heat: the bands twice the pill's width, drifting there and back (low stands still)
function HeatLayer({ h, pour }: { h: Heat; pour?: boolean }) {
  const still = !h.dur || reducedMotion();
  return (
    <span className={`eheat-l${pour ? " pour" : ""}`} style={{ opacity: h.op, animationDuration: pour ? `${POUR_MS}ms` : undefined }}>
      <span className="eheat-b" style={{ backgroundImage: bandsCss(h.cols, 90, h.tier === 2 ? 0.03 : 0.06), animation: still ? "none" : `eheat-drift ${h.dur}s ease-in-out infinite alternate` }} />
    </span>
  );
}

// the knob: a small lit droplet in the heat's colours
function Drop({ h }: { h: Heat }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width="12" height="12" viewBox="0 0 100 100" aria-hidden="true">
      <defs><Bands id={`${id}b`} cols={h.cols} angle={60} spread={0.8} soft={0.06} /><Light id={id} cx={34} cy={30} r={40} /></defs>
      <circle cx="50" cy="50" r="44" fill={`url(#${id}b)`} />
      <circle cx="50" cy="50" r="44" fill={`url(#${id}hi)`} />
      <circle cx="50" cy="50" r="44" fill={`url(#${id}lo)`} />
    </svg>
  );
}

// the word beside the track: a canvas, so a change sweeps old to new through the Bayer dither over SWEEP_MS
function Word({ text }: { text: string }) {
  const st = useRef({ was: text, now: text, at: -1e9 });
  if (st.current.now !== text) { st.current.was = st.current.now; st.current.now = text; st.current.at = performance.now(); }
  return (
    <Creature className="eword-c" dustCell={2} setup={(l) => { l.maxDust = 0; }} draw={(l, x, w, h) => {
      const s = st.current, k = reducedMotion() ? 1 : Math.min(1, (l.now - s.at) / SWEEP_MS);
      x.font = `11.5px ui-monospace, "SF Mono", Menlo, monospace`;
      x.textAlign = "left"; x.textBaseline = "middle"; x.fillStyle = getComputedStyle(x.canvas).color;
      if (k >= 1) { x.fillText(s.now, 0, h / 2 + 0.5); return; }
      const cell = 3, cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
      const fresh = new Path2D(), old = new Path2D();
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) (bayer(i, j) < k ? fresh : old).rect(i * cell, j * cell, cell, cell);
      x.save(); x.clip(fresh); x.fillText(s.now, 0, h / 2 + 0.5); x.restore();
      x.save(); x.clip(old); x.fillText(s.was, 0, h / 2 + 0.5); x.restore();
    }} />
  );
}

export function EffortPill({ options, value, onChange, label = "effort" }: { options: string[]; value?: string; onChange: (v: string) => void; label?: string }) {
  const n = Math.max(1, options.length);
  const i = Math.max(0, options.indexOf(value ?? ""));
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [hot, setHot] = useState(i);            // the level under the pointer while the track is open (the knob, the word)
  const [px, setPx] = useState<number | null>(null);   // while dragging the knob rides under the pointer, not the stops
  const [land, setLand] = useState(0);          // bumps when the knob settles on a stop, so it squashes once
  const root = useRef<HTMLDivElement>(null), ghosts = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState<number | undefined>(undefined);   // the pill's width while it animates; unset = auto
  const trackW = KNOB + STEP * (n - 1);
  const armed = useRef(false);                 // a press that opened the pill picks nothing on release; a drag, or a press on the open track, does
  const prev = useRef(i);
  const dir = (k: number) => { const d = k >= prev.current ? 1 : -1; prev.current = k; return d as 1 | -1; };

  // the widest word, measured from hidden ghosts (one per level), so the open pill holds any of them without a jump
  const wordW = () => { const g = ghosts.current; if (!g) return 40; let m = 0; for (const c of Array.from(g.children)) m = Math.max(m, (c as HTMLElement).offsetWidth); return m; };
  const openW = () => PADL + trackW + GAP_OPEN + wordW() + PADR;
  // the rest width of the level as it is now (a close scheduled before a commit landed reads the new word, not the old)
  const now = useRef(i); now.current = i;
  const restW = () => { const g = ghosts.current?.children[now.current] as HTMLElement | undefined; return PADL + KNOB + GAP_REST + (g?.offsetWidth ?? 40) + PADR; };
  const closeTimer = useRef(0), hoverTimer = useRef(0), autoTimer = useRef(0);
  const show = () => {
    if (open) return;
    const r = root.current; if (!r) return;
    window.clearTimeout(autoTimer.current);    // a close's late width reset must not land on the pill opening again
    setW(r.offsetWidth); setOpen(true); setHot(i);
    requestAnimationFrame(() => requestAnimationFrame(() => setW(openW())));
  };
  const hide = () => { setOpen(false); setW(restW()); window.clearTimeout(autoTimer.current); autoTimer.current = window.setTimeout(() => setW(undefined), OPEN_MS + 20); };
  const later = (f: () => void, ms: number) => { window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(f, ms); };
  useEffect(() => () => { window.clearTimeout(closeTimer.current); window.clearTimeout(hoverTimer.current); window.clearTimeout(autoTimer.current); }, []);
  useLayoutEffect(() => { if (!open) setHot(i); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  // the stop nearest the pointer
  const posAt = (ev: { clientX: number }) => { const r = root.current!.getBoundingClientRect(); return Math.max(0, Math.min((n - 1) * STEP, ev.clientX - r.left - PADL - KNOB / 2)); };
  const stopAt = (ev: { clientX: number }) => Math.round(posAt(ev) / STEP);
  const pick = (k: number) => { if (options[k] !== undefined && options[k] !== value) { dir(k); onChange(options[k]); } };
  const down = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    window.clearTimeout(hoverTimer.current); window.clearTimeout(closeTimer.current);
    setDrag(true);
    if (!open) { armed.current = false; show(); return; }   // a press on the closed pill opens the track; the knob stays on its level
    // a press on the open track picks; a press on the word beside it only picks if it then drags
    const r = root.current!.getBoundingClientRect();
    armed.current = ev.clientX - r.left <= PADL + trackW + STEP / 2;
    if (!armed.current) return;
    setPx(posAt(ev)); setHot(stopAt(ev));
  };
  const move = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !open) return;
    armed.current = true;
    setPx(posAt(ev));
    const k = stopAt(ev);
    if (k !== hot) setHot(k);
  };
  const up = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag(false);
    // released outside the pill (the capture ate the leave): it closes as a leave would
    const r = root.current?.getBoundingClientRect();
    const out = !r || ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
    setPx(null);
    if (!open || !armed.current) { if (out) later(hide, OPEN_MS); return; }   // the press only opened it: it stays open under the pointer
    const k = stopAt(ev);
    setHot(k); pick(k); setLand((v) => v + 1);  // once, on release; the knob settles on the stop with a squash
    if (out) later(hide, OPEN_MS);              // else it stays open until the pointer leaves (Marco, 2026-10-27)
  };
  // a pointercancel (the system took the pointer) picks nothing: the knob goes back to its level and the pill closes
  const cancel = () => {
    if (!drag) return;
    setDrag(false); setPx(null); armed.current = false; setHot(i);
    later(hide, OPEN_MS);
  };
  // back inside before the close ran: it stays open
  const enter = () => { window.clearTimeout(closeTimer.current); if (!open) hoverTimer.current = window.setTimeout(show, HOVER_MS); };
  const leave = () => { window.clearTimeout(hoverTimer.current); if (open && !drag) later(hide, OPEN_MS); };
  const key = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    const k = Math.max(0, Math.min(n - 1, i + (ev.key === "ArrowRight" ? 1 : -1)));
    if (k === i) return;                         // at the end: nothing to step to, no squash
    setHot(k); pick(k); setLand((v) => v + 1);  // the knob and the word follow the keys too, open or not
  };

  // the heat: the committed level's, poured in from the left over the last one on a change, with a swell
  const [heat, setHeat] = useState({ now: i, was: i, key: 0 });
  const [swell, setSwell] = useState(false);
  useLayoutEffect(() => {
    if (heat.now === i) return;
    setHeat((h) => ({ now: i, was: h.now, key: h.key + 1 }));
    if (reducedMotion()) return;
    setSwell(true);
    const t = window.setTimeout(() => setSwell(false), 420);
    return () => window.clearTimeout(t);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = options[hot] ?? value ?? "–";
  return (
    <div ref={root} className={`slider epill${open ? " open" : ""}${drag ? " drag" : ""}${swell ? " swell" : ""}`} title={value ? `${label}: ${value}` : label}
      role="slider" tabIndex={0} aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={i} aria-valuetext={value} data-hot={hot}
      style={{ width: w, transition: reducedMotion() ? "none" : `width ${OPEN_MS}ms cubic-bezier(.2,.7,.2,1)` }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onPointerEnter={enter} onPointerLeave={leave} onKeyDown={key}>
      <span className="name"><Swap k={value ?? "–"} className="val" dist={14} dir={prev.current >= i ? 1 : -1}><span>{value ?? "–"}</span></Swap></span>
      <span ref={ghosts} className="eghost" aria-hidden="true">{options.map((o) => <span key={o}>{o}</span>)}</span>
      <span className="eheat" aria-hidden="true">
        {heat.key > 0 && heat.was !== heat.now && <HeatLayer key={`w${heat.key}`} h={heatOf(options, heat.was)} />}
        <HeatLayer key={`n${heat.key}`} h={heatOf(options, heat.now)} pour={heat.key > 0} />
      </span>
      {open && <span className="etrack" aria-hidden="true">{options.map((o, k) => <i key={o} className={k === hot ? "on" : undefined} style={{ left: PADL + KNOB / 2 + k * STEP }} />)}</span>}
      <span className={`eknob${drag && open && hot === n - 1 && n > 1 ? " top" : ""}`} aria-hidden="true" style={{ left: PADL + KNOB / 2 + (open ? (px ?? hot * STEP) : 0) }}>
        <span key={land} className="eknob-d"><Drop h={heatOf(options, open ? hot : i)} /></span>
      </span>
      {open && <span className="eword" style={{ left: PADL + trackW + GAP_OPEN }} aria-hidden="true"><Word text={shown} /></span>}
    </div>
  );
}
