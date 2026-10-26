import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CFG, enter } from "../motion";
import { Fold } from "../MotionKit";
import { useCover } from "../cowork/thingView";

// A small menu at the pointer (right-click), sliding down a few pixels on a spring as it opens. Items act and close;
// `keep` items act and stay (the view options); `sub` opens a list in place; `ask` turns the row into a field;
// `hint` is the empty field's placeholder; `note` is a dim line under the label; `meta` is a mono word at the row's right (a
// model's id); `confirm` turns it into a yes/no in place (delete never happens on one click).
export type MenuItem = {
  label?: string; run?: (v?: string) => void; key?: string; on?: boolean; danger?: boolean; disabled?: boolean; keep?: boolean;
  note?: string; meta?: string; confirm?: string; ask?: string; hint?: string; empty?: boolean; sub?: MenuItem[]; sep?: boolean; head?: string;   // empty: an emptied field is an answer too (clears)
};

// `up`: the menu stands on y (its foot there) instead of hanging from it, for a thing at the window's foot (the model pill);
// `scroll`: a long list scrolls inside (max-height in the css); `box`: it is a listbox (role, arrow keys, Enter, type-ahead by the
// first letters of a label, and it closes when focus leaves it). The arrows, Enter and type-ahead work on every menu.
export function Menu({ x, y, items, onClose, up, scroll, box }: { x: number; y: number; items: MenuItem[]; onClose: () => void; up?: boolean; scroll?: boolean; box?: boolean }) {
  useCover(true);   // a thing's native page (#236) steps aside while a menu is open, never drawn over it
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y: up ? -9999 : y });
  const [open, setOpen] = useState<number | null>(null);    // the sub list open
  const [confirm, setConfirm] = useState<number | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [val, setVal] = useState("");
  const [hot, setHot] = useState<number | null>(null);      // the row the keys stand on (top-level index), none until a key moves
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = up ? Math.max(8, y - r.height) : y + r.height > innerHeight - 8 ? Math.max(8, y - r.height) : y;
    setPos({ x: Math.min(x, innerWidth - r.width - 8), y: top });
    enter(el, { y: up ? 6 : -6, cfg: CFG.snap });
    const held = document.activeElement as HTMLElement | null;   // who had the keys before: the box, mostly
    el.focus({ preventScroll: true });   // the keys are the menu's now, not the box's under it
    if (box) { const k = items.findIndex((it) => it.on); if (k >= 0) { setHot(k); el.querySelectorAll<HTMLElement>(".mitem")[rows(items).indexOf(items[k])]?.scrollIntoView({ block: "nearest" }); } }
    // when the menu goes, the keys go back where they were (a pick must not leave the box deaf until a click)
    return () => { if (held && held !== document.body && document.contains(held) && (!document.activeElement || document.activeElement === document.body)) held.focus({ preventScroll: true }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const typed = useRef({ s: "", at: 0 });
  const onKey = useRef<(ev: KeyboardEvent) => void>(() => {});
  onKey.current = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); onClose(); return; }
      // 1–9 pick a row of the list that shows (the open sub list's when one is open), not while a field is asked
      const t = ev.target as HTMLElement | null, typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !ref.current?.contains(t);
      if (/^[1-9]$/.test(ev.key) && !typing && !ev.metaKey && !ev.ctrlKey && !ev.altKey && pick.current) {
        if (pick.current(Number(ev.key))) { ev.preventDefault(); ev.stopPropagation(); }
      }
      if (typing || asking !== null || open !== null || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      // the arrows walk the top-level rows, Enter acts on the one they stand on, letters jump to the next label that starts so
      const its = rows(items);
      const step = (d: 1 | -1) => {
        const cur = hot === null ? -1 : its.indexOf(items[hot]);
        const k = cur < 0 ? (d > 0 ? 0 : its.length - 1) : (cur + d + its.length) % its.length;
        land(items.indexOf(its[k]));
      };
      if (ev.key === "ArrowDown") { ev.preventDefault(); ev.stopPropagation(); step(1); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); ev.stopPropagation(); step(-1); }
      else if (ev.key === "Enter" && hot !== null) { ev.preventDefault(); ev.stopPropagation(); act(items[hot], hot); }
      else if (/^[a-z0-9]$/i.test(ev.key) && !/^[1-9]$/.test(ev.key)) {
        const now = Date.now(), tp = typed.current;
        tp.s = (now - tp.at < 700 ? tp.s : "") + ev.key.toLowerCase(); tp.at = now;
        const cur = hot === null ? -1 : its.indexOf(items[hot]);
        const from = tp.s.length === 1 ? cur + 1 : cur;   // one letter steps on through the matches; more letters refine the one it stands on
        const hit = [...its.slice(Math.max(0, from)), ...its.slice(0, Math.max(0, from))].find((it) => (it.label ?? "").toLowerCase().startsWith(tp.s));
        if (hit) { ev.preventDefault(); ev.stopPropagation(); land(items.indexOf(hit)); }
      }
  };
  useEffect(() => {
    const down = (ev: MouseEvent) => { if (!ref.current?.contains(ev.target as Node)) onClose(); };
    const key = (ev: KeyboardEvent) => onKey.current(ev);
    const t = window.setTimeout(() => { window.addEventListener("mousedown", down); window.addEventListener("contextmenu", down); }, 0);
    window.addEventListener("keydown", key, true);
    return () => { window.clearTimeout(t); window.removeEventListener("mousedown", down); window.removeEventListener("contextmenu", down); window.removeEventListener("keydown", key, true); };
  }, [onClose]);

  // the rows a number picks: actionable ones, in order
  const rows = (its: MenuItem[]) => its.filter((it) => !it.sep && !it.head && !it.disabled);
  const land = (i: number) => { setHot(i); ref.current?.querySelectorAll<HTMLElement>(".mitem")[rows(items).indexOf(items[i])]?.scrollIntoView({ block: "nearest" }); };
  const pick = useRef<((n: number) => boolean) | null>(null);
  pick.current = asking !== null ? null : (n) => {
    const sub = open !== null ? items[open]?.sub : undefined;
    const its = sub ?? items, it = rows(its)[n - 1];
    if (!it) return false;
    act(it, sub ? (open! + 1) * 100 + its.indexOf(it) + 1 : its.indexOf(it));
    return true;
  };
  const act = (it: MenuItem, i: number) => {
    if (it.disabled) return;
    if (it.sub) { setOpen((o) => (o === i ? null : i)); return; }
    if (it.ask !== undefined) { setAsking(i); setVal(it.hint !== undefined || it.ask === "group name" ? "" : it.ask); return; }
    if (it.confirm && confirm !== i) { setConfirm(i); return; }
    it.run?.();
    if (!it.keep) onClose();
  };
  // the number shows on the list a key would pick from
  const num = (its: MenuItem[], it: MenuItem, base: string) => {
    if (base ? open !== Number(base) - 1 : open !== null) return 0;
    const k = rows(its).indexOf(it) + 1;
    return k > 0 && k < 10 ? k : 0;
  };
  const list = (its: MenuItem[], base: string) => its.map((it, j) => {
    const i = base ? Number(base) * 100 + j + 1 : j;
    if (it.sep) return <hr key={i} />;
    if (it.head) return <div key={i} className="mhead">{it.head}</div>;
    if (asking === i) return (
      <div key={i} className="mitem asking">
        <input autoFocus value={val} placeholder={it.hint ?? it.ask} onChange={(ev) => setVal(ev.target.value)} onFocus={(ev) => ev.target.select()}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") { ev.preventDefault(); const v = val.trim(); if (v || it.empty) it.run?.(v); onClose(); }
            else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setAsking(null); }
          }} />
      </div>
    );
    if (confirm === i) return (
      <div key={i} className="mitem confirming">
        <span>{it.confirm}</span>
        <button className="yes" onClick={() => { it.run?.(); onClose(); }}>{it.label}</button>
        <button onClick={() => setConfirm(null)}>keep</button>
      </div>
    );
    return (
      <div key={i}>
        <button className={`mitem ${it.danger ? "danger" : ""} ${it.on ? "on" : ""} ${open === i ? "open" : ""} ${hot === i && !base ? "hot" : ""}`} disabled={it.disabled}
          role={box ? "option" : undefined} aria-selected={box ? !!it.on : undefined} onClick={() => act(it, i)} onPointerEnter={() => { if (hot !== null && !base) setHot(null); }}>
          <i className="tick" />
          <span>{it.label}{it.note && <em className="mnote">{it.note}</em>}</span>
          {it.meta && <code className="mmeta">{it.meta}</code>}
          {it.sub ? <small>›</small> : it.key ? <kbd>{it.key}</kbd> : null}
          {!it.sub && !it.key && num(its, it, base) > 0 && <kbd className="mnum">{num(its, it, base)}</kbd>}
        </button>
        {it.sub && <Fold open={open === i} gap={0} from={{ x: -8 }}><div className="msub">{list(it.sub, String(j + 1))}</div></Fold>}
      </div>
    );
  });
  // on the page itself, so a menu opened inside a pane (whose frame moves on a translate) stands at the pointer
  return createPortal(
    <div ref={ref} className={`menu${scroll ? " scroll" : ""}`} tabIndex={-1} style={{ left: pos.x, top: pos.y }} onContextMenu={(ev) => ev.preventDefault()}
      role={box ? "listbox" : undefined} onBlur={box ? (ev) => { if (!ev.relatedTarget || !ref.current?.contains(ev.relatedTarget as Node)) onClose(); } : undefined}>
      {list(items, "")}
    </div>, document.body);
}
