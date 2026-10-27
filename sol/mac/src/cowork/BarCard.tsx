// The bar card (mine/look/COWORK.html, 2026-10-27): what waits on me in the room hangs from the bar as one black goo
// card, the notch card's recipe, its neck under the for-you pill. A hand to me, a friend who wants in and a ping are
// each one face of it; with more than one, a count steps to the next. Only the look: every face keeps its own words,
// buttons and handlers (CoworkApp hands them in), and each stays mounted while it is not the one shown, so a hand
// taken from the notch still opens its session here.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type Face = { key: string; on: boolean; node: ReactNode };

export function BarCard({ faces }: { faces: Face[] }) {
  const live = faces.filter((f) => f.on);
  const [at, setAt] = useState(0);
  const shown = live.length ? live[at % live.length].key : "";
  const el = useRef<HTMLDivElement>(null);
  // the neck hangs under the for-you pill: its centre, measured from the card's right edge
  const [neck, setNeck] = useState(120);
  useLayoutEffect(() => {
    const place = () => {
      const pill = document.querySelector<HTMLElement>(".cface .rm-fy-pill"), me = el.current;
      if (!pill || !me) return;
      const p = pill.getBoundingClientRect(), c = me.getBoundingClientRect();
      setNeck(Math.max(14, Math.round(c.right - (p.left + p.width / 2) - 15)));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [live.length]);
  return (
    <div ref={el} className={`cbarcard ${live.length ? "" : "none"}`} style={{ "--neck": `${neck}px` } as React.CSSProperties}>
      {live.length > 0 && <i className="cneck" aria-hidden="true" />}
      <div className="gcard" role={live.length ? "group" : undefined} aria-label={live.length ? "waiting on you" : undefined} hidden={!live.length}>
        {faces.map((f) => <div key={f.key} className="gface" hidden={f.key !== shown}>{f.node}</div>)}
        {live.length > 1 && (
          <button className="gmore" onClick={() => setAt((a) => (a % live.length) + 1)} title={`${live.length - 1} more waiting on you; show the next`}>+{live.length - 1}</button>
        )}
      </div>
    </div>
  );
}
