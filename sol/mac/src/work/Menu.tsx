import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CFG, enter } from "../motion";
import { Fold } from "../MotionKit";

// A small menu at the pointer (right-click), sliding down a few pixels on a spring as it opens. Items act and close;
// `keep` items act and stay (the view options); `sub` opens a list in place; `ask` turns the row into a field;
// `hint` is the empty field's placeholder; `note` is a dim line under the label; `confirm` turns it into a yes/no in place (delete never happens on one click).
export type MenuItem = {
  label?: string; run?: (v?: string) => void; key?: string; on?: boolean; danger?: boolean; disabled?: boolean; keep?: boolean;
  note?: string; confirm?: string; ask?: string; hint?: string; empty?: boolean; sub?: MenuItem[]; sep?: boolean; head?: string;   // empty: an emptied field is an answer too (clears)
};

export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [open, setOpen] = useState<number | null>(null);    // the sub list open
  const [confirm, setConfirm] = useState<number | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [val, setVal] = useState("");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, innerWidth - r.width - 8), y: y + r.height > innerHeight - 8 ? Math.max(8, y - r.height) : y });
    enter(el, { y: -6, cfg: CFG.snap });
    el.focus({ preventScroll: true });   // the keys are the menu's now, not the box's under it
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const down = (ev: MouseEvent) => { if (!ref.current?.contains(ev.target as Node)) onClose(); };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); onClose(); return; }
      // 1–9 pick a row of the list that shows (the open sub list's when one is open), not while a field is asked
      const t = ev.target as HTMLElement | null, typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !ref.current?.contains(t);
      if (/^[1-9]$/.test(ev.key) && !typing && !ev.metaKey && !ev.ctrlKey && !ev.altKey && pick.current) {
        if (pick.current(Number(ev.key))) { ev.preventDefault(); ev.stopPropagation(); }
      }
    };
    const t = window.setTimeout(() => { window.addEventListener("mousedown", down); window.addEventListener("contextmenu", down); }, 0);
    window.addEventListener("keydown", key, true);
    return () => { window.clearTimeout(t); window.removeEventListener("mousedown", down); window.removeEventListener("contextmenu", down); window.removeEventListener("keydown", key, true); };
  }, [onClose]);

  // the rows a number picks: actionable ones, in order
  const rows = (its: MenuItem[]) => its.filter((it) => !it.sep && !it.head && !it.disabled);
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
        <button className={`mitem ${it.danger ? "danger" : ""} ${it.on ? "on" : ""} ${open === i ? "open" : ""}`} disabled={it.disabled} onClick={() => act(it, i)}>
          <i className="tick" />
          <span>{it.label}{it.note && <em className="mnote">{it.note}</em>}</span>
          {it.sub ? <small>›</small> : it.key ? <kbd>{it.key}</kbd> : null}
          {!it.sub && !it.key && num(its, it, base) > 0 && <kbd className="mnum">{num(its, it, base)}</kbd>}
        </button>
        {it.sub && <Fold open={open === i} gap={0} from={{ x: -8 }}><div className="msub">{list(it.sub, String(j + 1))}</div></Fold>}
      </div>
    );
  });
  // on the page itself, so a menu opened inside a pane (whose frame moves on a translate) stands at the pointer
  return createPortal(
    <div ref={ref} className="menu" tabIndex={-1} style={{ left: pos.x, top: pos.y }} onContextMenu={(ev) => ev.preventDefault()}>
      {list(items, "")}
    </div>, document.body);
}
