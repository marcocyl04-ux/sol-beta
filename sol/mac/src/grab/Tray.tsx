// The shelf's tray (mode "shelf"): everything on the shelf, by day, newest first. A black tray 720 wide in the middle
// of the screen; each day has a row that says when its oldest thing that is not kept leaves (the sweep's week); each
// thing is a 120 × 84 thumb (a picture, or its name on a dark tile) with its name and age under it, and a small mark
// when kept. The keys say themselves in the footer: arrows move the light (a pearl ring on springs), Return sends
// (Where to? with that thing as the picture, no markup), K keeps or lets go, ⌫ deletes, Esc closes. The lit thing
// shows the same three as words (Send · Keep · Delete) for the mouse. The bead sits on the tray's corner and looks at
// the lit thing. The list comes from shelf.list and follows shelf.items.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CFG, enter, slidePill } from "../motion";
import { BEAD, type Bead } from "./Bead";
import type { Rect } from "./Room";
import { age, ask, dayLabel, hear, isImage, leaves, type Item } from "./wire";

const W = 720;

export function Tray({ bead, say, onSend }: { bead: Bead | null; say: (t: string) => void; onSend: (item: Item, from: Rect) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [lit, setLit] = useState(0);
  const tray = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null), ring = useRef<HTMLDivElement>(null);
  const light = useRef<ReturnType<typeof slidePill> | null>(null);

  useEffect(() => {
    let live = true;
    say("The shelf.");
    void ask<{ items?: Item[] }>("shelf.list").then((r) => {
      if (!live) return;
      if (r.error) { say(`Could not read the shelf: ${r.error}`); setItems([]); return; }
      setItems(r.items ?? []);
    });
    const off = hear((m) => { if (m.type === "shelf.items" && Array.isArray(m.items)) setItems(m.items); });
    return () => { live = false; off(); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // the tray slides up into place; the bead comes down from the notch to its corner
  useLayoutEffect(() => {
    enter(tray.current!, { y: 40, cfg: CFG.glide });
    const r = tray.current!.getBoundingClientRect();
    void bead?.hop(r.left - BEAD / 2 + 4, r.top - BEAD / 2 + 4, { lift: 36, ms: 680 });
    light.current = slidePill(body.current!, ring.current!, { cfg: CFG.snap });
    return () => light.current?.destroy();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!items?.length || !body.current) return;
    if (!body.current.dataset.came) {
      body.current.dataset.came = "1";
      body.current.querySelectorAll<HTMLElement>(".thumb").forEach((t, i) => enter(t, { y: 14, delay: 120 + Math.min(i, 12) * 30, cfg: CFG.slide }));
    }
  }, [items]);

  const flat = items ?? [];
  const at = Math.min(lit, Math.max(0, flat.length - 1));
  const thumbs = () => [...(body.current?.querySelectorAll<HTMLElement>(".thumb") ?? [])];
  useEffect(() => {
    const el = thumbs()[at] ?? null;
    window.setTimeout(() => light.current?.to(el?.querySelector<HTMLElement>(".thumb-pic") ?? null), 0);
    if (el && bead) { const r = el.getBoundingClientRect(); bead.lookAt(r.left + r.width / 2, r.top + r.height / 2); }
    el?.scrollIntoView({ block: "nearest" });
  }, [at, flat.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** the nearest thumb in the row above or below (by what is on the screen, so any number of columns works) */
  const vertical = (dir: 1 | -1) => {
    const ts = thumbs(), me = ts[at]?.getBoundingClientRect(); if (!me) return at;
    const cx = me.left + me.width / 2;
    const rows = ts.map((t, i) => ({ i, r: t.getBoundingClientRect() })).filter(({ r }) => dir > 0 ? r.top > me.top + 10 : r.top < me.top - 10);
    if (!rows.length) return at;
    const edge = dir > 0 ? Math.min(...rows.map(({ r }) => r.top)) : Math.max(...rows.map(({ r }) => r.top));
    const row = rows.filter(({ r }) => Math.abs(r.top - edge) < 10);
    return row.reduce((a, b) => (Math.abs(b.r.left + b.r.width / 2 - cx) < Math.abs(a.r.left + a.r.width / 2 - cx) ? b : a)).i;
  };
  const sendIt = (i = at) => {
    const it = flat[i], el = thumbs()[i]?.querySelector(".thumb-pic"); if (!it || !el) return;
    const r = el.getBoundingClientRect();
    onSend(it, { x: r.left, y: r.top, w: r.width, h: r.height });
  };
  const keep = async (i = at) => {
    const it = flat[i]; if (!it) return;
    bead?.nod();
    const r = await ask<{ items?: Item[] }>("shelf.keep", { id: it.id, kept: !it.kept });
    if (r.error) say(`Could not ${it.kept ? "let it go" : "keep it"}: ${r.error}`); else if (r.items) setItems(r.items);
  };
  const del = async (i = at) => {
    const it = flat[i]; if (!it) return;
    const r = await ask<{ items?: Item[] }>("shelf.delete", { id: it.id });
    if (r.error) say(`Could not delete it: ${r.error}`); else if (r.items) setItems(r.items);
  };
  const act = useRef({ sendIt, keep, del, vertical }); act.current = { sendIt, keep, del, vertical };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || e.metaKey || e.ctrlKey) return;
      const n = flat.length; if (!n) return;
      if (e.key === "ArrowRight") setLit(Math.min(n - 1, at + 1));
      else if (e.key === "ArrowLeft") setLit(Math.max(0, at - 1));
      else if (e.key === "ArrowDown") setLit(act.current.vertical(1));
      else if (e.key === "ArrowUp") setLit(act.current.vertical(-1));
      else if (e.key === "Enter") act.current.sendIt();
      else if (e.key === "k" || e.key === "K") void act.current.keep();
      else if (e.key === "Backspace" || e.key === "Delete") void act.current.del();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [at, flat.length]);

  // by day, newest first (the list already is)
  const days: { label: string; items: { it: Item; i: number }[] }[] = [];
  flat.forEach((it, i) => {
    const label = dayLabel(it.at), last = days[days.length - 1];
    if (last?.label === label) last.items.push({ it, i }); else days.push({ label, items: [{ it, i }] });
  });
  return (
    <div className="tray" ref={tray} style={{ width: W }}>
      <div className="tray-head"><span>The shelf</span><span className="dim">{flat.length ? `${flat.length} ${flat.length === 1 ? "thing" : "things"} · cleans itself after a week` : ""}</span></div>
      <div className="tray-body" ref={body}>
        <div className="tray-ring" ref={ring} />
        {items && !flat.length && <div className="tray-empty">Nothing on the shelf. A grab that is not sent lands here, and anything dropped on the notch.</div>}
        {days.map((d) => (
          <section key={d.label} className="day">
            <div className="day-row"><span>{d.label}</span><span className="dim">{leaves(d.items.map((x) => x.it))}</span></div>
            <div className="thumbs">
              {d.items.map(({ it, i }) => (
                <div key={it.id} className={`thumb${i === at ? " on" : ""}`} onPointerEnter={() => setLit(i)} onDoubleClick={() => sendIt(i)}>
                  <div className="thumb-pic">
                    {isImage(it) && it.url ? <img src={it.url} alt="" draggable={false} loading="lazy" crossOrigin="anonymous" /> : <div className="thumb-file"><b>{ext(it.name)}</b><span>{it.name}</span></div>}
                    {it.kept && <span className="kept">kept</span>}
                    {i === at && (
                      <div className="thumb-acts">
                        <button onClick={(e) => { e.stopPropagation(); sendIt(i); }}>Send</button>
                        <button onClick={(e) => { e.stopPropagation(); void keep(i); }}>{it.kept ? "Let go" : "Keep"}</button>
                        <button onClick={(e) => { e.stopPropagation(); void del(i); }}>Delete</button>
                      </div>
                    )}
                  </div>
                  <div className="thumb-name">{it.name}</div>
                  <div className="thumb-age">{age(it.at)}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="tray-foot">↑↓←→ moves · Return sends · K keeps · ⌫ deletes · Esc closes</div>
    </div>
  );
}
const ext = (name: string) => { const m = /\.([a-z0-9]{1,5})$/i.exec(name); return m ? m[1].toUpperCase() : "FILE"; };
