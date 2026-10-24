import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CFG, useSpring } from "../motion";
import { PRESETS, RAILS, button, keyWords, mostUsed, type ButtonCtx, type ButtonDef, type Preset, type RailDef } from ".";
import { AddSheet } from "./AddSheet";
import { about, freshId, modesOf, notHere, placed, undoPatch, type Snap } from "./edit";
import { Ink } from "./Ink";
import { Shelf } from "./Shelf";
import { pressed } from "./usage";
import { Menu, type MenuItem } from "../work/Menu";

// The rail (#132, #171): one preset's buttons in a row on the bar, its name quiet before them with a dot per preset the
// rail holds, then a + (on hover) and the ⋮. Every mode's bar draws its buttons here and nowhere else. A text glyph draws
// as a capsule, an ink one as a key; a pane's key is lit while its pane shows (`on`). Scroll or swipe over the bar, or
// press a dot, to go round the mode's presets: the row slides out on the spring as the next slides in, and the rail's
// width follows on the same spring, so nothing jumps.
// The rail changes where it is (#171): drag a button sideways to move it along, off the bar to take it off; right-click
// one to swap it, move it to another preset or take it off; the + opens the panel for the preset showing (AddSheet.tsx),
// the ⋮ every preset and button (Shelf.tsx). A change made here leaves one quiet line with an undo, as an agent's does.
// The rails and presets are the person's arrangement (engine/src/arrange.ts), Sol's own until the engine has said; the
// one showing is kept there too. `foot` is what else the ⋮ holds.
export function Rail({ c, fallback, on, onPane, foot }: {
  c: ButtonCtx; fallback?: string; on: string | null; onPane: (id: string) => void; foot?: MenuItem[];
}) {
  const a = c.e.arrangement;
  // a mode the arrangement gives no rail (or an empty one) draws Sol's own, never nothing
  const railsOf = (m: string): RailDef[] => (a?.rails[m]?.some((r) => r.presets.length) ? a.rails[m] : RAILS[m] ?? []);
  const theirs = a?.rails[c.mode]?.some((r) => r.presets.length);
  const all: Record<string, Preset> = theirs ? a!.presets : { ...PRESETS, ...a?.presets };
  const rails = railsOf(c.mode);
  const allRails: Record<string, RailDef[]> = Object.fromEntries([...new Set([...(a?.modes ?? []), ...Object.keys(RAILS), c.mode])].map((m) => [m, railsOf(m)]));
  const mine = rails[0] ?? { presets: [] };
  const presets = mine.presets;
  // the one gone round to, held here until the engine writes it back (and kept if the engine is away)
  const [went, setWent] = useState<string | null>(null);
  useEffect(() => setWent(null), [a]);
  const ok = (id?: string | null) => (id && presets.includes(id) ? id : undefined);
  const at = ok(went) ?? ok(mine.at) ?? ok(fallback) ?? presets[0] ?? "";
  const onAt = (id: string) => { setWent(id); c.e.arrange({ rails: { [c.mode]: [{ ...mine, at: id }, ...rails.slice(1)] } }); };
  const [sheet, setSheet] = useState<{ kind: "shelf" | "add"; swap?: string } | null>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // a change made by hand: sent as a patch, and kept so its line can put it back
  const snap = (): Snap => ({ presets: all, rails: allRails });
  const [said, setSaid] = useState<{ line: string; n: number; was: Snap } | null>(null);
  const change = (patch: object, line?: string) => { const was = snap(); c.e.arrange(patch); if (line) setSaid({ line, n: Date.now(), was }); };
  // the one quiet line: the newest of an agent's change (PRD section 8), one made here, and the engine's no to one made
  // here; it goes after a few seconds or at the next press on the rail
  const born = useRef(Date.now());
  const notes = [
    c.e.undoNote && { line: c.e.undoNote.line, n: c.e.undoNote.n, undo: () => c.e.undo() },
    said && { line: said.line, n: said.n, undo: () => c.e.arrange(undoPatch(said.was, snap())) },
    !sheet && c.e.refused && c.e.refused.n >= born.current && { line: c.e.refused.line, n: c.e.refused.n },
  ].filter((x): x is { line: string; n: number; undo?: () => void } => !!x).sort((x, y) => y.n - x.n);
  const [noteGone, setNoteGone] = useState(0);
  const note = notes[0] && notes[0].n > noteGone ? notes[0] : null;
  useEffect(() => { if (!note) return; const t = window.setTimeout(() => setNoteGone(note.n), 6000); return () => clearTimeout(t); }, [note?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // the preset leaving, while it slides out; dir: the way the rows go (1: the next comes up from below)
  const [shown, setShown] = useState(at);
  const [gone, setGone] = useState<string | null>(null);
  const dir = useRef<1 | -1>(1);
  if (shown !== at) { setGone(shown); setShown(at); }
  const box = useRef<HTMLDivElement>(null), row = useRef<HTMLDivElement>(null), out = useRef<HTMLDivElement>(null);
  const span = useRef({ from: 0, to: 0 });
  const sp = useSpring(1, CFG.slide, (v) => {
    const h = box.current?.offsetHeight ?? 0, d = dir.current;
    if (row.current) row.current.style.translate = v >= 1 ? "" : `0 ${(1 - v) * h * d}px`;
    if (out.current) out.current.style.translate = `0 ${-v * h * d}px`;
    if (box.current) box.current.style.width = v >= 1 ? "" : `${span.current.from + (span.current.to - span.current.from) * v}px`;
  }, () => setGone(null));
  useLayoutEffect(() => {
    if (!gone || !row.current || !out.current) return;
    span.current = { from: out.current.offsetWidth, to: row.current.offsetWidth };
    sp.set(0); sp.to(1);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  // a slide that never lands (frames paused, a reload mid-way) still ends: the row in place, the leaving one gone
  useEffect(() => {
    if (!gone) return;
    const t = window.setTimeout(() => {
      if (row.current) row.current.style.translate = "";
      if (box.current) box.current.style.width = "";
      setGone(null);
    }, 900);
    return () => clearTimeout(t);
  }, [gone]);
  const go = (id: string) => { if (id === at) return; dir.current = presets.indexOf(id) > presets.indexOf(at) ? 1 : -1; onAt(id); };

  // a scroll or a sideways swipe over the bar: one preset per gesture (a trackpad's glide after it is the same gesture).
  // The whole bar listens, not the rail alone, so a scroll reaches it wherever the window's own title strip lets one
  // through. A native listener, not React's passive one, so the page under the bar does not scroll as well.
  const rail = useRef<HTMLDivElement>(null);
  const now_ = useRef({ presets, at, onAt });
  now_.current = { presets, at, onAt };
  useEffect(() => {
    const el = rail.current?.closest<HTMLElement>(".bar") ?? rail.current;
    if (!el) return;
    const w = { sum: 0, last: 0, spent: false };
    const onWheel = (ev: WheelEvent) => {
      const { presets, at, onAt } = now_.current;
      if (presets.length < 2) return;
      ev.preventDefault();
      const t = performance.now();
      if (t - w.last > 180) { w.sum = 0; w.spent = false; }
      w.last = t;
      if (w.spent) return;
      w.sum += Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
      if (Math.abs(w.sum) < 24) return;
      const d = w.sum > 0 ? 1 : -1;
      w.spent = true;
      dir.current = d;
      const i = presets.indexOf(at);
      onAt(presets[(Math.max(0, i) + d + presets.length) % presets.length]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- changing it where it is ----
  const p = all[at], list = p?.buttons ?? [];
  const put = (buttons: string[], line?: string) => change({ presets: { [at]: { buttons } } }, line);
  const takeOff = (b: ButtonDef) => put(list.filter((x) => x !== b.id), `${b.name} taken off ${p?.name ?? ""}`);

  // drag: sideways moves it along (a caret shows where it lands), down off the bar takes it off; the press after a drag
  // is not a press
  const [drag, setDrag] = useState<{ b: ButtonDef; x: number; y: number; off: boolean; before: string | null; caret: number | null } | null>(null);
  const dragged = useRef(false);
  const lift = (ev: React.PointerEvent, b: ButtonDef) => {
    if (ev.button !== 0 || !row.current || gone) return;
    dragged.current = false;
    const x0 = ev.clientX, y0 = ev.clientY, bottom = row.current.getBoundingClientRect().bottom;
    let live = false, last: NonNullable<typeof drag> | null = null;
    const move = (e: PointerEvent) => {
      if (!live && Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
      live = true;
      const cells = [...row.current!.querySelectorAll<HTMLElement>("[data-cell]")].filter((el) => el.dataset.cell !== b.id);
      const next = cells.find((el) => { const r = el.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
      const off = e.clientY > bottom + 14;
      const caret = off ? null : next ? next.getBoundingClientRect().left - 5 : (cells[cells.length - 1]?.getBoundingClientRect().right ?? x0) + 3;
      last = { b, x: e.clientX, y: e.clientY, off, before: next?.dataset.cell ?? null, caret };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!live || !last) return;
      dragged.current = true;   // the click this release makes, if any, is not a press; the next one is
      window.setTimeout(() => { dragged.current = false; }, 0);
      if (last.off) { takeOff(b); return; }
      const l = placed(list, b.id, last.before);
      if (l.join() !== list.join()) put(l);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // right-click: swap it (the most pressed first, never one already on the preset), move it, about it, take it off
  const ask = (ev: React.MouseEvent, b: ButtonDef) => {
    ev.preventDefault();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const { used, more } = mostUsed(a?.usage, list, c.mode, 5, (x) => x.shows?.(c) ?? true);
    const swapTo = (x: ButtonDef) => put(list.map((y) => (y === b.id ? x.id : y)), `${b.name} swapped for ${x.name}`);
    const uses = (x: ButtonDef) => { const n = a?.usage?.[x.id]?.n ?? 0; return n === 1 ? "once" : `${n}×`; };
    const moveTo = (id: string) => {
      const to = all[id].buttons;
      change({ presets: { [at]: { buttons: list.filter((x) => x !== b.id) }, ...(to.includes(b.id) ? {} : { [id]: { buttons: [...to, b.id] } }) } },
        `${b.name} moved to ${all[id].name}`);
    };
    const others = Object.keys(all).filter((id) => id !== at);
    setMenu({ x: r.left, y: r.bottom + 6, items: [
      { label: "swap for", sub: [
        ...(used.length ? [{ head: "you use most" }, ...used.map((x) => ({ label: x.name, key: uses(x), run: () => swapTo(x) }))] : []),
        ...(more.length ? [{ head: used.length ? `more for ${c.mode}` : `made for ${c.mode}` }, ...more.map((x) => ({ label: x.name, run: () => swapTo(x) }))] : []),
        { sep: true },
        { label: "all buttons…", run: () => setSheet({ kind: "add", swap: b.id }) },
      ] },
      { label: "move to", sub: [
        ...others.map((id) => ({ label: all[id].name, key: modesOf(allRails, id).join(" · "), run: () => moveTo(id) })),
        ...(others.length ? [{ sep: true }] : []),
        { label: "a new preset…", ask: "", hint: "its name", run: (v?: string) => {
          if (!v) return;
          const id = freshId(v, all);
          change({ presets: { [id]: { name: v, buttons: [b.id] }, [at]: { buttons: list.filter((x) => x !== b.id) } },
            rails: { [c.mode]: [{ ...mine, presets: [...presets, id] }, ...rails.slice(1)] } }, `${b.name} moved to ${v}`);
        } },
      ] },
      { label: `about ${b.name}`, sub: [{ label: b.says, note: about(b, a?.usage?.[b.id]?.n ?? 0), keep: true }] },
      { sep: true },
      { label: "take off", danger: true, run: () => takeOff(b) },
    ] });
  };

  const open = (kind: "shelf" | "add") => setSheet(sheet?.kind === kind ? null : { kind });
  return (
    <div ref={rail} className="rail" onPointerDownCapture={(ev) => { if (note && !(ev.target as HTMLElement).closest(".railundo")) setNoteGone(note.n); }}
      onClickCapture={(ev) => { if (dragged.current) { dragged.current = false; ev.stopPropagation(); ev.preventDefault(); } }}>
      {note && <span className="railundo" role="status">{note.line}{note.undo && <> · <button onClick={() => { setNoteGone(note.n); note.undo!(); }}>undo</button></>}</span>}
      <div ref={box} className="railrows">
        <Row ref={row} p={all[shown]} c={c} on={on} onPane={onPane} lift={lift} ask={ask} lifted={drag?.b.id} all={!!sheet}
          dots={presets.length > 1 && <span className="raildots">{presets.map((id) => (
            <button key={id} className={id === shown ? "on" : ""} onClick={() => go(id)} title={all[id]?.name ?? id} aria-label={`show ${all[id]?.name ?? id}`} />
          ))}</span>} />
        {gone && <Row ref={out} p={all[gone]} c={c} on={on} onPane={onPane} leaving />}
      </div>
      <button ref={plus} className={`barbtn railplus ${sheet?.kind === "add" ? "on" : ""}`} onClick={() => open("add")}
        title={`add a button to ${p?.name ?? "this preset"}`} aria-expanded={sheet?.kind === "add"}>
        <Ink><path d="M7 3.5v7M3.5 7h7" /></Ink>
      </button>
      <button className={`barbtn ${sheet?.kind === "shelf" ? "on" : ""}`} onClick={() => open("shelf")}
        title="every preset and every button" aria-expanded={sheet?.kind === "shelf"}>
        <Ink><circle cx="7" cy="3" r=".7" /><circle cx="7" cy="7" r=".7" /><circle cx="7" cy="11" r=".7" /></Ink>
      </button>
      {sheet?.kind === "shelf" && rail.current && <Shelf r={rail.current.getBoundingClientRect()} c={c} rails={allRails} presets={all} at={at} onAt={go}
        change={change} foot={foot} onClose={() => setSheet(null)} />}
      {sheet?.kind === "add" && plus.current && <AddSheet r={plus.current.getBoundingClientRect()} c={c} id={at} presets={all} swap={sheet.swap}
        change={change} onAll={() => setSheet({ kind: "shelf" })} onClose={() => setSheet(null)} />}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {drag && createPortal(<>
        {drag.caret !== null && rail.current && <i className="railcaret" style={{ left: drag.caret, top: rail.current.getBoundingClientRect().top + 10 }} />}
        <span className={`railghost ${drag.off ? "off" : ""}`} style={{ left: drag.x, top: drag.y }}>
          {typeof drag.b.glyph === "string" ? <em>{drag.b.glyph}</em> : drag.b.glyph}<small>{drag.off ? "take off" : drag.b.name}</small>
        </span>
      </>, document.body)}
    </div>
  );
}

// one preset's row: its name and the rail's dots, then a cell per button that shows here, in the preset's order; a thin
// line between two shown ones only. While the preset is being changed (`all`: its + panel or the ⋮ is open) the row draws
// every button on it, the ones that do not show here faint, so what was just added is there to see.
function Row({ ref, p, c, on, onPane, leaving, dots, lift, ask, lifted, all }: {
  ref: React.Ref<HTMLDivElement>; p?: Preset; c: ButtonCtx; on: string | null; onPane: (id: string) => void; leaving?: boolean;
  dots?: React.ReactNode; lift?: (ev: React.PointerEvent, b: ButtonDef) => void; ask?: (ev: React.MouseEvent, b: ButtonDef) => void; lifted?: string;
  all?: boolean;
}) {
  const cells = (p?.buttons ?? []).map((b) => (b === "|" ? b : button(b))).filter((b): b is ButtonDef | "|" => b === "|" || (!!b && (all || !notHere(b, c))))
    .filter((b, i, all) => b !== "|" || (i > 0 && all[i - 1] !== "|" && i < all.length - 1));
  return (
    <div ref={ref} className={`railrow ${leaving ? "out" : ""}`} inert={leaving} aria-hidden={leaving}>
      {p && <span className="railname">{p.name}</span>}
      {dots}
      {cells.map((b, i) => b === "|" ? <i key={i} className="barsep" />
        : notHere(b, c) ? <Away key={b.id} b={b} c={c} where={notHere(b, c)!} lift={lift} ask={ask} lifted={lifted === b.id} />
        : <Cell key={b.id} b={b} c={c} lit={b.kind === "pane" ? on === b.id : b.on?.(c)} onPane={onPane} lift={lift} ask={ask} lifted={lifted === b.id} />)}
    </div>
  );
}

// a button on the preset that does not show here, drawn while the preset is being changed: faint, its glyph alone (its
// badge and look read a session that is not here), moved and right-clicked like the rest, and a press says where it shows
function Away({ b, c, where, lift, ask, lifted }: {
  b: ButtonDef; c: ButtonCtx; where: string; lifted?: boolean;
  lift?: (ev: React.PointerEvent, b: ButtonDef) => void; ask?: (ev: React.MouseEvent, b: ButtonDef) => void;
}) {
  return (
    <button data-cell={b.id} className={`${typeof b.glyph === "string" ? "wviewk" : "barbtn"} railaway ${lifted ? "raillifted" : ""}`}
      onClick={() => c.flash(`${b.name} shows ${where}`)}
      onPointerDown={lift && ((ev) => lift(ev, b))} onContextMenu={ask && ((ev) => ask(ev, b))} title={`${b.name}: shows ${where}`}>
      {b.glyph}
    </button>
  );
}

// one button: its own component, so a button's hook (useOff) runs in it
function Cell({ b, c, lit, onPane, lift, ask, lifted }: {
  b: ButtonDef; c: ButtonCtx; lit?: boolean; onPane: (id: string) => void; lifted?: boolean;
  lift?: (ev: React.PointerEvent, b: ButtonDef) => void; ask?: (ev: React.MouseEvent, b: ButtonDef) => void;
}) {
  const off = b.useOff?.() ?? false;
  const look = b.look?.(c) ?? (typeof b.glyph === "string" ? "wviewk" : "barbtn");
  return (
    <button data-cell={b.id} className={`${look} ${lit ? "on" : ""} ${lifted ? "raillifted" : ""}`} disabled={off}
      onClick={() => { pressed(b.id); if (b.kind === "pane") onPane(b.id); else b.press?.(c); }}
      onPointerDown={lift && ((ev) => lift(ev, b))} onContextMenu={ask && ((ev) => ask(ev, b))}
      aria-pressed={b.on ? !!lit : undefined} title={b.hover?.(c) ?? (b.key ? `${b.says} (${keyWords(b.key)})` : b.says)}>
      {b.badge?.(c) || b.glyph}
    </button>
  );
}
