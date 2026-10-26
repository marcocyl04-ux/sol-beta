import { useRef, useState } from "react";
import { useCover } from "../cowork/thingView";
import { createPortal } from "react-dom";
import { Menu, type MenuItem } from "../work/Menu";
import { OWN_BROKEN, button, grouped, type ButtonCtx, type ButtonDef, type Preset, type RailDef } from ".";
import { Glyph, Tile, useSheet } from "./AddSheet";
import { MAX, about, count, freshId, modesOf, notHere, placed } from "./edit";

// The shelf (#133, #171): what the rail's ⋮ opens, every preset and every button. On the left every preset as a card,
// with the modes whose rail shows it (press one to put it on that rail or take it off), and a new one. On the right the
// preset picked, as a bench to drag along, × off, or drop a button onto; under it every button by group, a lit dot on
// the ones on the bench. A button's hover card says what it does, its key and how often it has been pressed, and puts
// it on or takes it off; a person's own can be changed or deleted from it, by a line put in the talk's box (a button is
// a file, and a file is changed in a chat). At the foot what the ⋮ held before (a pane without a rail, pop out, the
// folder in another app, export, the keys). Every change goes to the engine as a patch of the arrangement; a refusal
// comes back as one line, shown here.
export function Shelf({ r, c, rails, presets, at, onAt, change, foot, onClose }: {
  r: DOMRect; c: ButtonCtx; rails: Record<string, RailDef[]>; presets: Record<string, Preset>; at: string; onAt: (id: string) => void;
  change: (patch: object, line?: string) => void; foot?: MenuItem[]; onClose: () => void;
}) {
  useCover(true);   // a thing's native page (#236) steps aside while this sheet is open
  const el = useRef<HTMLDivElement>(null);
  useSheet(el, onClose);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [sel, setSel] = useState(at);
  const [naming, setNaming] = useState<string | null>(null);     // the new preset's name while it is typed
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [card, setCard] = useState<{ b: ButtonDef } | null>(null);
  const shut = useRef<number | undefined>(undefined);
  const opened = useRef(Date.now());
  const refused = c.e.refused && c.e.refused.n >= opened.current ? c.e.refused.line : null;
  const usage = c.e.arrangement?.usage;
  const modes = Object.keys(rails);
  const id = presets[sel] ? sel : at, p = presets[id], list = p?.buttons ?? [];
  const put = (buttons: string[]) => change({ presets: { [id]: { buttons } } });
  // the presets in the order the rails show them, this mode's first, then any no rail shows
  const order = [...new Set([...(rails[c.mode]?.[0]?.presets ?? []), ...modes.flatMap((m) => rails[m]?.[0]?.presets ?? []), ...Object.keys(presets)])]
    .filter((x) => presets[x]);

  const railPatch = (m: string, ids: string[]) => {
    const r0 = rails[m]?.[0] ?? { presets: [] };
    return { rails: { [m]: [{ presets: ids, ...(r0.at && ids.includes(r0.at) ? { at: r0.at } : {}) }, ...(rails[m] ?? []).slice(1)] } };
  };
  const toggle = (x: string, m: string) => {
    const now = rails[m]?.[0]?.presets ?? [];
    change(railPatch(m, now.includes(x) ? now.filter((y) => y !== x) : [...now, x]));
  };
  const make = (name: string) => {
    const nid = freshId(name, presets);
    change({ presets: { [nid]: { name, buttons: [] } }, ...railPatch(c.mode, [...(rails[c.mode]?.[0]?.presets ?? []), nid]) });
    setSel(nid);
  };
  const remove = () => {
    const patch: { presets: object; rails: Record<string, RailDef[]> } = { presets: { [id]: null }, rails: {} };
    for (const m of modes) patch.rails[m] = (rails[m] ?? []).map((x) => ({ presets: x.presets.filter((y) => y !== id), ...(x.at && x.at !== id ? { at: x.at } : {}) }));
    change(patch, `${p?.name ?? id} deleted`);
    setDeleting(false);
    setSel(order.find((x) => x !== id) ?? at);
  };
  const toggleOn = (b: ButtonDef) => put(list.includes(b.id) ? list.filter((x) => x !== b.id) : [...list, b.id]);
  // the bench: drop a button (from the bench or the groups) before another, or at the end
  const drop = (ev: React.DragEvent, before: string | null) => {
    ev.preventDefault(); ev.stopPropagation();
    const from = ev.dataTransfer.getData("sol/bench"), b = ev.dataTransfer.getData("sol/button");
    if (from !== "") { const l = [...list]; const i = Number(from); const [x] = l.splice(i, 1); const j = before === null ? l.length : list.indexOf(before) - (i < list.indexOf(before) ? 1 : 0); l.splice(j < 0 ? l.length : j, 0, x); put(l); return; }
    if (b) put(placed(list, b, before));
  };
  // one dragged off the bench onto the buttons below is taken off
  const dropOff = (ev: React.DragEvent) => {
    const from = ev.dataTransfer.getData("sol/bench");
    if (from === "") return;
    ev.preventDefault();
    put(list.filter((_, j) => j !== Number(from)));
  };

  // the hover card: it stays while the pointer is on the tile or on the card
  const hover = (b: ButtonDef | null) => {
    window.clearTimeout(shut.current);
    if (!b) { shut.current = window.setTimeout(() => setCard(null), 220); return; }
    setCard({ b });
  };
  const own = (b: ButtonDef, what: "change" | "delete") => {
    const file = `sol/home/buttons/${b.id}.tsx`;
    const line = what === "change" ? `Change my button "${b.name}" (${file}): ` : `Delete my button "${b.name}" (${file}) and take it off every preset.`;
    if (c.shell) { c.shell.toBox(line); c.flash(what === "change" ? "in your box: say what to change, then send" : "in your box: send it to delete the button"); onClose(); }
    else c.flash(`Ask Sol in any chat: ${line}`);
  };
  const footItem = (it: MenuItem, ev: React.MouseEvent) => {
    if (it.sub) { const b = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: b.left, y: b.top - 6, items: it.sub }); return; }
    it.run?.(); onClose();
  };
  const empty = Math.max(0, MAX - count(p));

  return createPortal(
    <div ref={el} className="rsheet rshelf" role="dialog" aria-label="every preset and button"
      style={{ top: r.bottom + 6, right: Math.max(8, innerWidth - r.right) }}>
      <div className="rpresets">
        <h4>presets</h4>
        {order.map((x) => {
          const q = presets[x], n = count(q);
          return (
            <div key={x} className={`rpcard ${x === id ? "sel" : ""}`} onClick={() => { setSel(x); setRenaming(null); setDeleting(false); }}
              role="button" tabIndex={0} onKeyDown={(ev) => { if (ev.key === "Enter") setSel(x); }}>
              <div className="rptop"><b>{q.name}</b><span className={n > MAX ? "over" : ""}>{n}/{MAX}</span></div>
              <div className="rpmini">{q.buttons.filter((b) => b !== "|").map((b) => button(b)).filter((b): b is ButtonDef => !!b).map((b) => <Glyph key={b.id} b={b} />)}</div>
              <div className="rpmodes">{modes.map((m) => {
                const shows = modesOf(rails, x).includes(m);
                return <button key={m} className={shows ? "on" : ""} onClick={(ev) => { ev.stopPropagation(); toggle(x, m); }}
                  title={shows ? `take it off ${m}'s rail` : `put it on ${m}'s rail`}>{shows ? "✓ " : ""}{m}</button>;
              })}</div>
            </div>
          );
        })}
        {naming === null ? <button className="rpnew" onClick={() => setNaming("")}>+ new preset</button>
          : <input className="rpname" autoFocus value={naming} placeholder="its name" onChange={(ev) => setNaming(ev.target.value)}
            onBlur={() => setNaming(null)} onKeyDown={(ev) => {
              if (ev.key === "Enter" && naming.trim()) { make(naming.trim()); setNaming(null); }
              else if (ev.key === "Escape") { ev.stopPropagation(); ev.nativeEvent.stopImmediatePropagation(); setNaming(null); }
            }} />}
        <p className="rhint">The ✓ says which mode's rail shows a preset. Press one to put it on that rail or take it off.</p>
      </div>

      <div className="rbench" onDragOver={(ev) => ev.preventDefault()} onDrop={dropOff}>
        <div className="rbhead">
          {renaming !== null
            ? <input className="rpname" autoFocus value={renaming} onChange={(ev) => setRenaming(ev.target.value)} onBlur={() => setRenaming(null)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && renaming.trim()) { change({ presets: { [id]: { name: renaming.trim() } } }); setRenaming(null); }
                else if (ev.key === "Escape") { ev.stopPropagation(); ev.nativeEvent.stopImmediatePropagation(); setRenaming(null); }
              }} />
            : <h3>{p?.name ?? id}</h3>}
          {deleting
            ? <span className="rbask">delete {p?.name}? its buttons stay here · <button className="danger" onClick={remove}>delete</button> · <button onClick={() => setDeleting(false)}>keep</button></span>
            : <span className="rbask"><button onClick={() => setRenaming(p?.name ?? "")}>rename</button> · <button onClick={() => setDeleting(true)}>delete</button>
              {id !== at && modesOf(rails, id).includes(c.mode) && <> · <button onClick={() => onAt(id)}>show it on the rail</button></>}</span>}
        </div>
        <div className="rbrow" onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => drop(ev, null)}>
          {list.map((b, i) => {
            const d = b === "|" ? null : button(b);
            return (
              <span key={`${b}${i}`} className={`rbslot ${b === "|" ? "rbline" : ""} ${b !== "|" && !d ? "gone" : ""} ${d && notHere(d, c) ? "rfaint" : ""}`} draggable
                onDragStart={(ev) => { ev.dataTransfer.setData("sol/bench", String(i)); ev.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => drop(ev, b)}
                title={b === "|" ? "the thin line between keys" : d ? `${d.name}${notHere(d, c) ? ` (shows ${notHere(d, c)})` : ""}: drag it along, or down to take it off` : `${b} is not on the shelf now; kept for when it comes back`}>
                {b === "|" ? <i /> : d ? <Glyph b={d} /> : <em className="rpill">{b}</em>}
                <button className="rx" onClick={() => put(list.filter((_, j) => j !== i))} aria-label={`take ${d?.name ?? (b === "|" ? "the line" : b)} off`}>×</button>
              </span>
            );
          })}
          {Array.from({ length: empty }, (_, i) => <span key={`e${i}`} className="rbslot rbempty" />)}
        </div>
        <p className="rhint">drag to reorder · drag a button up to add · drag one down to take it off ·{" "}
          <button onClick={() => put([...list, "|"])}>add a line</button></p>
        {refused && <p className="rsaid" role="status"><i>{refused}</i></p>}

        {grouped().map((g) => (
          <section key={g.name}>
            <h4>{g.name}</h4>
            <div className="rtiles">
              {g.buttons.map((b) => (
                <Tile key={b.id} b={b} lit={list.includes(b.id)} away={!!notHere(b, c)} onClick={() => toggleOn(b)} onHover={hover} sel={card?.b.id === b.id} />
              ))}
              {g.name === "Yours" && !g.buttons.length && !OWN_BROKEN.length && <em className="rnone">none yet. Ask Sol in any chat: "make me a button that…"</em>}
            </div>
            {g.name === "Yours" && OWN_BROKEN.map((x) => <p key={x.file} className="rsaid"><i>{x.line}</i></p>)}
          </section>
        ))}

        {!!foot?.length && <div className="rfoot">
          {foot.filter((it) => it.label).map((it) => (
            <button key={it.label} onClick={(ev) => footItem(it, ev)}>{it.label}{it.sub ? " ›" : ""}{it.key && <kbd>{it.key}</kbd>}</button>
          ))}
        </div>}
      </div>

      {card && <div className="rcard"
        onMouseEnter={() => window.clearTimeout(shut.current)} onMouseLeave={() => hover(null)}>
        <b>{card.b.name}</b>
        <p>{card.b.says}</p>
        <small>{about(card.b, usage?.[card.b.id]?.n ?? 0)}{notHere(card.b, c) ? ` · shows ${notHere(card.b, c)}` : ""}{card.b.made?.at ? ` · made ${card.b.made.at}` : ""}{card.b.bypassed?.length ? ` · bypasses ${card.b.bypassed.join(", ")}` : ""}</small>
        <div>
          <button className={list.includes(card.b.id) ? "on" : ""} onClick={() => toggleOn(card.b)}>
            {list.includes(card.b.id) ? `on ${p?.name} ✓` : `add to ${p?.name}`}</button>
          {card.b.id.startsWith("my-") && <>
            <button onClick={() => own(card.b, "change")}>change it</button>
            <button className="danger" onClick={() => own(card.b, "delete")}>delete</button>
          </>}
        </div>
      </div>}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>, document.body);
}
