import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { useEngine } from "../useEngine";
import { CFG, enter } from "../motion";
import { composing } from "../ime";
// The sticky note (engine/src/sticky.ts): a key at the right of Home's bar, and a small note under it, on Sol's own paper, the
// way a paper one sits on a screen's corner. One short line a thing; a click crosses it out, a second click brings it
// back; "next page" tears off what is crossed out and the rest carry over. Kept by the engine on this machine, so it
// is the same note tomorrow and in every window; a seat may write on it too (the tool "sticky").

type Line = { id: string; text: string; done: boolean; at: number };
const MAX = 40;   // engine/src/sticky.ts MAX_CHARS
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function StickyKey({ e }: { e: ReturnType<typeof useEngine> }) {
  const [open, setOpen] = useState(() => localStorage.getItem("sol.sticky.open") === "1");
  const [lines, setLines] = useState<Line[]>([]);
  const [page, setPage] = useState(Date.now());
  useEffect(() => e.subscribe((m) => {
    if (m.type === "sticky") { setLines(Array.isArray(m.lines) ? m.lines : []); setPage(Number(m.page) || Date.now()); }
    else if (m.type === "sticky.refused") e.flash(`sticky note: ${m.message}`);
  }), [e.subscribe, e.flash]);
  useEffect(() => { if (e.up) e.send({ type: "sticky.get" }); }, [e.up, e.send]);
  const flip = () => setOpen((o) => { localStorage.setItem("sol.sticky.open", o ? "0" : "1"); return !o; });
  const left = lines.filter((l) => !l.done).length;
  // the note hangs on the page's body, above the bar's and the talk's layers
  return (
    <>
      <button className={`barbtn wsticky ${open ? "on" : ""}`} onClick={flip} aria-pressed={open} title={open ? "put the note away" : "the sticky note"}>
        <svg viewBox="0 0 14 14" aria-hidden><path d="M2.5 2.5h9v6l-3 3h-6z M8.5 11.5v-3h3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
        {left > 0 && <i>{left}</i>}
      </button>
      {open && createPortal(<Note e={e} lines={lines} page={page} />, document.body)}
    </>
  );
}

function Note({ e, lines, page }: { e: ReturnType<typeof useEngine>; lines: Line[]; page: number }) {
  const el = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  useLayoutEffect(() => { if (el.current) enter(el.current, { y: -8, cfg: CFG.panel }); }, []);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    e.send({ type: "sticky.add", text: t });
    setText("");
  };
  const crossed = lines.some((l) => l.done);
  return (
    <div ref={el} className="wnote" role="dialog" aria-label="sticky note">
      <ul>
        {lines.map((l) => (
          <li key={l.id} className={l.done ? "done" : ""}>
            <button className="ln" onClick={() => e.send({ type: "sticky.mark", id: l.id, done: !l.done })}>{l.text}</button>
            <button className="x" onClick={() => e.send({ type: "sticky.remove", id: l.id })} aria-label="remove" title="remove">×</button>
          </li>
        ))}
      </ul>
      <input value={text} maxLength={MAX} placeholder={lines.length ? "+" : "+ one thing to do"} onChange={(ev) => setText(ev.target.value)}
        onKeyDown={(ev) => { if (ev.key === "Enter" && !composing(ev)) { ev.preventDefault(); add(); } }} />
      <div className="foot">
        <span>{day(page)}</span>
        <button disabled={!crossed} onClick={() => e.send({ type: "sticky.turn" })} title="tear off the crossed-out lines; the rest carry over">next page</button>
      </div>
    </div>
  );
}
