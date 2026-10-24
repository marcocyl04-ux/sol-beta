import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CFG, enter } from "../motion";
import { BUTTONS, button, grouped, type ButtonCtx, type ButtonDef, type Preset } from ".";
import { MAX, count, notHere, placed } from "./edit";

// The + panel (#171): what the rail's + opens, for the preset showing and nothing else. Its ten slots are the preset:
// the next empty one is where a new button lands, the rest say how much room is left. Under them every button, by
// group, found by typing; a lit dot is one already on. Press a button to put it on (a lit one to take it off), or drag
// it onto a slot; drag a slot along, or × it off. Opened from a button's "swap for › all buttons…", it swaps instead:
// the slot being swapped is marked, and the buttons already on the preset are not offered.
export function AddSheet({ r, c, id, presets, swap, change, onAll, onClose }: {
  r: DOMRect; c: ButtonCtx; id: string; presets: Record<string, Preset>; swap?: string;
  change: (patch: object, line?: string) => void; onAll: () => void; onClose: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  useSheet(el, onClose);
  const p = presets[id], list = p?.buttons ?? [], on = list.filter((b) => b !== "|");
  const groups = grouped().map((g) => ({ ...g, buttons: swap ? g.buttons.filter((b) => !list.includes(b.id)) : g.buttons }));
  const [tab, setTab] = useState(() => (groups.find((g) => g.buttons.some((b) => !list.includes(b.id))) ?? groups[0]).name);
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<ButtonDef | null>(null);
  const opened = useRef(Date.now());
  const refused = c.e.refused && c.e.refused.n >= opened.current ? c.e.refused.line : null;
  const put = (buttons: string[], line?: string) => change({ presets: { [id]: { buttons } } }, line);
  const was = swap ? button(swap) : undefined;

  const pick = (b: ButtonDef) => {
    if (swap) { put(list.map((x) => (x === swap ? b.id : x)), `${was?.name ?? swap} swapped for ${b.name}`); onClose(); return; }
    // one that does not show here is still on it: the rail draws it faint while this is open, and the line says where
    const away = !list.includes(b.id) && count(p) < MAX && notHere(b, c);
    put(list.includes(b.id) ? list.filter((x) => x !== b.id) : [...list, b.id], away ? `${b.name} is on ${p?.name ?? id}; it shows ${away}` : undefined);
  };
  const drop = (ev: React.DragEvent, before: string | null) => {
    ev.preventDefault();
    const b = ev.dataTransfer.getData("sol/button");
    if (!b || b === before) return;
    put(placed(list, b, before));
  };
  const words = q.trim().toLowerCase();
  const shown = words ? BUTTONS.filter((b) => !(swap && list.includes(b.id)) && `${b.name} ${b.says} ${b.id}`.toLowerCase().includes(words))
    : groups.find((g) => g.name === tab)?.buttons ?? [];

  return createPortal(
    <div ref={el} className="rsheet radd" role="dialog" aria-label={`add to ${p?.name ?? id}`}
      style={{ top: r.bottom + 8, right: Math.max(8, innerWidth - r.right) }}>
      <h3>{swap ? <>swap {was?.name ?? swap} for…</> : p?.name ?? id}<span>{count(p)} of {MAX}</span></h3>
      <div className="raddslots">
        {Array.from({ length: Math.max(MAX, on.length) }, (_, i) => {
          const b = on[i] ? button(on[i]) : undefined, next = i === on.length && !swap;
          if (!on[i]) return <div key={i} className={`raddslot ${next ? "next" : ""}`} onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => drop(ev, null)}>{next && "next"}</div>;
          return (
            <div key={i} className={`raddslot full ${on[i] === swap ? "swap" : ""} ${b ? "" : "gone"} ${b && notHere(b, c) ? "rfaint" : ""}`} draggable={!swap}
              onDragStart={(ev) => { ev.dataTransfer.setData("sol/button", on[i]); ev.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => drop(ev, on[i])}
              onMouseEnter={() => b && setHover(b)} onMouseLeave={() => setHover(null)}
              title={b ? undefined : `${on[i]} is not on the shelf now; kept here for when it comes back`}>
              {b ? <Glyph b={b} /> : <em className="rpill">{on[i]}</em>}
              {!swap && <button className="rx" onClick={() => put(list.filter((x) => x !== on[i]))} aria-label={`take ${b?.name ?? on[i]} off`}>×</button>}
            </div>
          );
        })}
      </div>
      <input className="raddfind" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="find a button" autoFocus
        onKeyDown={(ev) => { if (ev.key === "Escape" && q) { ev.stopPropagation(); ev.nativeEvent.stopImmediatePropagation(); setQ(""); } }} />
      {!words && <div className="raddtabs" role="tablist">
        {groups.map((g) => <button key={g.name} role="tab" aria-selected={g.name === tab} className={g.name === tab ? "on" : ""} onClick={() => setTab(g.name)}>{g.name}</button>)}
      </div>}
      <div className="rtiles">
        {shown.map((b) => <Tile key={b.id} b={b} lit={list.includes(b.id)} away={!!notHere(b, c)} onClick={() => pick(b)} onHover={setHover} />)}
        {!shown.length && <em className="rnone">{words ? "no button by that name" : tab === "Yours" ? "none yet. Ask Sol in any chat: \"make me a button that…\"" : swap ? "all of these are on it already" : "none here"}</em>}
      </div>
      <p className="rsaid">{refused ? <i>{refused}</i> : hover ? <><b>{hover.name}</b> · {hover.says}{notHere(hover, c) && <> · <em>shows {notHere(hover, c)}</em></>}</>
        : swap ? `pick the one to put where ${was?.name ?? swap} is` : "press one to put it on · drag it onto a slot · press a lit one to take it off"}</p>
      <div className="raddfoot"><button onClick={onAll}>all presets and buttons ›</button></div>
    </div>, document.body);
}

// a button's glyph as the bar draws it: a text one in its capsule, an ink one as it is
export const Glyph = ({ b }: { b: ButtonDef }) => (typeof b.glyph === "string" ? <em className="rpill">{b.glyph}</em> : <>{b.glyph}</>);

// one button on a sheet: its glyph and name (a text one is its capsule alone); the dot when it is on the preset; faint
// (`away`) when it does not show here
export function Tile({ b, lit, onClick, onHover, sel, away }: {
  b: ButtonDef; lit: boolean; onClick: () => void; onHover: (b: ButtonDef | null) => void; sel?: boolean; away?: boolean;
}) {
  return (
    <button className={`rtile ${lit ? "in" : ""} ${sel ? "sel" : ""} ${away ? "rfaint" : ""} ${b.id.startsWith("my-") ? "own" : ""}`} draggable onClick={onClick}
      onDragStart={(ev) => { ev.dataTransfer.setData("sol/button", b.id); ev.dataTransfer.effectAllowed = "copyMove"; }}
      onMouseEnter={() => onHover(b)} onMouseLeave={() => onHover(null)} aria-pressed={lit}>
      <Glyph b={b} />{typeof b.glyph !== "string" && <span>{b.name}</span>}
    </button>
  );
}

// a sheet under the bar: it slides in, and goes at Esc or a press outside it (a menu it opened, and the rail, are not
// outside)
export function useSheet(el: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useLayoutEffect(() => { if (el.current) enter(el.current, { y: -6, cfg: CFG.snap }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const down = (ev: MouseEvent) => { const t = ev.target as HTMLElement; if (!t.closest(".rsheet, .menu, .rail")) close.current(); };
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !document.querySelector(".menu")) { ev.preventDefault(); close.current(); } };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, []);
}
