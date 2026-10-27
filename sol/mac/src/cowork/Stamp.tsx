// Ship (#33, design/together/3-ship/PRD.md): "stamp stable" for the action board's head (See's ActionBoard mounts
// <Stamp others={…} />; nothing else is needed). Three things in one row:
//   stamp stable      → a confirm in place: "stamp 2dc6b98 as stable? Frank's and Isaac's Sols will be offered it"
//                       stamp / keep. Stamp asks the engine (team.stamp), which refuses with the reason when this
//                       checkout is dirty, off main, not pushed, or does not build; the row says what came back
//   one stable back   → the last five stables (team.stables), the one now ticked; picking one asks once more, then
//                       moves stable to it (team.stamp { to })
// `others`: the team's other people by name, for the confirm's words; none → "every Sol on the team".
// The words never name the parts behind it: it is stable, Sol, and the people.
import { useEffect, useRef, useState } from "react";
import { Menu, type MenuItem } from "../work/Menu";
import { stables, stamp, type Stables, type StampDone } from "./stable";
import { StateMark } from "./bits";
import "./ship.css";

type Phase =
  | { k: "rest" }
  | { k: "looking" }
  | { k: "confirm"; short: string }
  | { k: "busy"; said: string }
  | { k: "done"; r: StampDone; back?: boolean };

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
};
/** "Frank's and Isaac's Sols", "Frank's Sol", "every Sol on the team" */
export function offeredTo(others: string[]): string {
  const n = others.filter(Boolean).map((o) => `${o}'s`);
  if (!n.length) return "every Sol on the team";
  const list = n.length === 1 ? n[0] : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  return `${list} ${n.length === 1 ? "Sol" : "Sols"}`;
}

export function Stamp({ others = [] }: { others?: string[] }) {
  const [p, setP] = useState<Phase>({ k: "rest" });
  const [menu, setMenu] = useState<{ x: number; y: number; s: Stables } | null>(null);
  const backBtn = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const put = (x: Phase) => { if (alive.current) setP(x); };
  // a result stays a while, then the row is the two buttons again
  useEffect(() => {
    if (p.k !== "done") return;
    const t = window.setTimeout(() => put({ k: "rest" }), "error" in p.r ? 14_000 : 9_000);
    return () => window.clearTimeout(t);
  }, [p]);
  const to = offeredTo(others);

  const ask = async () => {
    put({ k: "looking" });
    const s = await stables();
    put({ k: "confirm", short: s.head?.short || "this" });
  };
  const go = async (tag?: string) => {
    put({ k: "busy", said: tag ? `moving stable back to ${tag}…` : "checking it builds, then stamping…" });
    const r = await stamp(tag);
    put({ k: "done", r, back: !!tag });
  };
  const openBack = async () => {
    const b = backBtn.current?.getBoundingClientRect();
    put({ k: "looking" });
    const s = await stables();
    put({ k: "rest" });
    if (s.error && !s.tags.length) { put({ k: "done", r: { error: s.error }, back: true }); return; }
    setMenu({ x: b ? b.left : 40, y: b ? b.bottom + 6 : 40, s });
  };

  const items = (s: Stables): MenuItem[] => {
    const rows: MenuItem[] = [{ head: "one stable back" }];
    if (!s.tags.length) rows.push({ label: "no stable stamped yet", disabled: true });
    for (const t of s.tags) {
      const now = !!s.stable && t.sha === s.stable;
      rows.push({
        label: when(t.at), note: now ? "stable now" : t.tag, on: now, disabled: now,
        confirm: `move stable back to this one? ${to[0].toUpperCase()}${to.slice(1)} will be offered it`,
        run: () => void go(t.tag),
      });
    }
    return rows;
  };

  return (
    <div className="stamp">
      {p.k === "confirm" ? (
        <>
          <span className="q">stamp <b>{p.short}</b> as stable? {to} will be offered it</span>
          <button className="wbtn" onClick={() => void go()} autoFocus>stamp</button>
          <button className="wbtn ghost" onClick={() => put({ k: "rest" })}>keep</button>
        </>
      ) : p.k === "busy" ? (
        <span className="said busy"><StateMark kind="running" />{p.said}</span>
      ) : p.k === "done" ? (
        "error" in p.r
          ? <span className="said no" title={p.r.error}><StateMark kind="failed" />{p.back ? "not moved" : "not stamped"}: {p.r.error}</span>
          : <span className="said ok" title={p.r.note || ""}><StateMark kind="done" />{p.back ? "stable is back on " : "stamped "}<b>{p.r.tag}</b>{p.r.recorded ? ` · ${p.r.recorded}` : ""}{p.r.beta ? ` · ${p.r.beta}` : ""}{p.r.note ? ` · ${p.r.note}` : ""}</span>
      ) : (
        <>
          <button className="wbtn" disabled={p.k === "looking"} onClick={() => void ask()} title="make what main has now the version everyone runs">stamp stable</button>
          <button ref={backBtn} className="quiet" disabled={p.k === "looking"} onClick={() => void openBack()} title="move stable back to one of the last five">one stable back</button>
        </>
      )}
      {menu && <Menu x={menu.x} y={menu.y} items={items(menu.s)} onClose={() => setMenu(null)} />}
    </div>
  );
}
