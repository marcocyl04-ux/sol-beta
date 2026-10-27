// The mode wheel (Together #31): the pill at the top of the side shows the modes, the current one lit by the capsule,
// which travels as goo (SeatSwitch useBridgeThumb). Hold the pill (350 ms), right-click it, or hold ⌘⌃M (App.tsx) and the names come out on a
// ring around it on the springs; a release on a name picks it, a release elsewhere closes.
// Opened by a right-click or the keys it stays: click a name, or arrows and Enter, Esc closes. Home and Cowork since
// #132; Social returns with its first button. Reduced motion: the names as a plain list, nothing travels.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CFG, enter, reducedMotion } from "./motion";
import { useBridgeThumb } from "./SeatSwitch";
import type { AppMode } from "./ModeSwitch";
import "./cowork/cowork.css";
import { useCover } from "./cowork/thingView";

type Spot = { id: AppMode; name: string; title: string; sx: number; sy: number };
// the ring: home above the pill, cowork below (sx, sy: which quarter)
export const MODES: Spot[] = [
  { id: "home", name: "home", title: "home: your sessions and chats", sx: -1, sy: -1 },
  { id: "cowork", name: "cowork", title: "cowork: work with the team", sx: 1, sy: 1 },
];
const ORDER = MODES.map((m) => m.id);
const NAME = Object.fromEntries(MODES.map((m) => [m.id, m.name])) as Record<AppMode, string>;
const tint = (m: AppMode): "home" | "work" => (m === "cowork" ? "work" : "home");
// each side mounts its own pill, so the mode the last one showed is kept here: a pill mounting after a switch travels
let shown: AppMode | null = null;

export function ModeWheel({ mode, onPick }: { mode: AppMode; onPick: (m: AppMode) => void }) {
  const pill = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<null | { kind: "hold" | "stick"; r: DOMRect }>(null);
  useCover(!!open);   // the wheel's scrim is over everything, a thing's native page too (#236)
  const held = useRef(false), timer = useRef<number | undefined>(undefined);
  const pair = ORDER, at = Math.max(0, pair.indexOf(mode));
  // the thumb: a goo bridge from the word it leaves to the word it lands on, starting where the last pill was
  const [start] = useState(() => Math.max(0, pair.indexOf(shown ?? mode)));
  useLayoutEffect(() => { shown = mode; }, [mode]);
  const thumb = useBridgeThumb(at, start);
  // where the ring goes: round the pill, or the window's top left when the side is away (the keys opened it)
  const rect = () => {
    const r = pill.current?.getBoundingClientRect();
    return r && r.width > 0 && r.right > 40 && r.left >= 0 ? r : new DOMRect(16, 58, 240, 26);
  };
  const show = (kind: "hold" | "stick") => setOpen({ kind, r: rect() });
  useEffect(() => {
    const f = () => show("stick");
    window.addEventListener("sol:mode-wheel", f);
    return () => window.removeEventListener("sol:mode-wheel", f);
  }, []);
  const choose = (m: AppMode) => { setOpen(null); if (m !== mode) onPick(m); };
  const stop = () => { window.clearTimeout(timer.current); timer.current = undefined; };
  return (
    <div className="modesw" data-s>
      <div ref={pill} className={`seatsw mwpill ${open ? "lifted" : ""}`} role="group" title="home or cowork (ctrl+cmd+M flips them; hold it for the wheel)"
        onPointerDown={(ev) => { if (ev.button !== 0) return; held.current = false; stop(); timer.current = window.setTimeout(() => { held.current = true; show("hold"); }, 350); }}
        onPointerUp={stop} onPointerLeave={stop} onContextMenu={(ev) => { ev.preventDefault(); stop(); show("stick"); }}>
        <i ref={thumb as React.RefObject<HTMLUnknownElement>} className="thumb" />
        {pair.map((m) => (
          <button key={m} type="button" data-seat={m === mode ? tint(m) : undefined} data-mode={m} className={m === mode ? "on" : ""}
            onClick={() => { if (held.current) { held.current = false; return; } choose(m); }}>{NAME[m]}</button>
        ))}
      </div>
      {open && createPortal(<Wheel r={open.r} kind={open.kind} mode={mode} onChoose={choose} onClose={() => setOpen(null)} />, document.body)}
    </div>
  );
}

const PAD = 58;   // room above and below the pill for the names
function Wheel({ r, kind, mode, onChoose, onClose }: { r: DOMRect; kind: "hold" | "stick"; mode: AppMode; onChoose: (m: AppMode) => void; onClose: () => void }) {
  const [lit, setLit] = useState<AppMode>(mode);
  const litRef = useRef(lit); litRef.current = lit;
  const over = useRef<AppMode | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const plain = reducedMotion();
  const rx = r.width * 0.5, ry = r.height / 2 + 36;
  const pos = (m: Spot, i: number) => plain
    ? { left: r.width / 2, top: PAD + r.height + 16 + i * 26 }
    : { left: r.width / 2 + m.sx * rx * 0.62, top: PAD + r.height / 2 + m.sy * ry * 0.72 };
  // the names come out of the pill: each slides from the pill's middle to its place on the ring, one after another
  useLayoutEffect(() => {
    if (plain) return;
    box.current?.querySelectorAll<HTMLElement>(".mwspot").forEach((b, i) => {
      const m = MODES[i];
      enter(b, { x: -m.sx * rx * 0.62, y: -m.sy * ry * 0.72, cfg: CFG.pop, delay: i * 28, scale: 0.3 });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const up = () => { if (kind !== "hold") return; const o = over.current; if (o) onChoose(o); else onClose(); };
    const down = (ev: PointerEvent) => { if (!(ev.target as HTMLElement)?.closest?.(".mwheel button")) onClose(); };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); onClose(); }
      else if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); onChoose(litRef.current); }
      else if (ev.key.startsWith("Arrow")) {
        ev.preventDefault(); ev.stopPropagation();
        const d = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : -1;
        setLit((l) => ORDER[(ORDER.indexOf(l) + d + ORDER.length) % ORDER.length]);
      }
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerup", up); window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true); window.removeEventListener("blur", onClose);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const h = plain ? r.height + PAD + 16 + MODES.length * 26 + 8 : r.height + PAD * 2;
  return (<>
    <div className="mwscrim" aria-hidden="true" />
    <div ref={box} className={`mwheel ${plain ? "plain" : ""}`} role="menu" aria-label="modes"
      style={{ left: r.left, top: r.top - PAD, width: r.width, height: h }}>
      {!plain && (
        <svg className="mwring" width={r.width} height={h} aria-hidden="true">
          <ellipse cx={r.width / 2} cy={PAD + r.height / 2} rx={rx - 1} ry={ry} />
        </svg>
      )}
      {!plain && <span className="mwnow" style={{ left: r.width / 2, top: PAD + r.height / 2 }}>in {NAME[mode]}</span>}
      {MODES.map((m, i) => (
        // one spot per name, the lit one raised
        <span key={m.id} className="mwspot" style={pos(m, i)}>
          <button type="button" role="menuitem" data-mode={m.id} data-seat={m.id === lit ? tint(m.id) : undefined}
            className={`${m.id === lit ? "lit" : ""} ${m.id === mode ? "on" : ""}`} title={m.title}
            onPointerEnter={() => { over.current = m.id; setLit(m.id); }} onPointerLeave={() => { if (over.current === m.id) over.current = null; }}
            onClick={() => onChoose(m.id)}>{m.name}</button>
        </span>
      ))}
    </div>
  </>);
}
