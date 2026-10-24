import { useEffect, useLayoutEffect, useRef } from "react";
import { CFG, spring, type Spring } from "./motion";
// The side button in the title bar, drawn as cells (a 7 x 7 grid of 2 px cells, 14 px). Each cell is one rect
// that slides to its other place when the button turns on: the three bars gather into one column on the left (the
// side standing open). The column is two cells wide so it reads as a panel's edge, not a text cursor. Ink only, never a ring colour; slides, never fades.
type Cell = { from: [number, number]; to: [number, number] };
const C = 2;

// three bars, 1 cell high, 5 wide; pinned: a column at the left, columns 1-2, rows 1-5. Each bar fills its own
// row and the gap row under it (the last bar only its row), its left cells left, its right cells right.
const SIDE: Cell[] = [0, 1, 2].flatMap((b) =>
  [0, 1, 2, 3, 4].map((k): Cell => ({ from: [1 + k, 1 + b * 2], to: [1 + (k % 2 === 1 || k === 4 ? 1 : 0), Math.min(5, 1 + b * 2 + (k >= 2 ? 1 : 0))] })));

export function BarCells({ on }: { kind: "side"; on: boolean }) {
  const cells = SIDE;
  const rects = useRef<(SVGRectElement | null)[]>([]);
  const sp = useRef<{ x: Spring; y: Spring }[]>([]);
  const first = useRef(true);
  // every cell is two springs (x, y) with its own delay: the ones that travel furthest leave first going in and
  // arrive last coming back, and each lands past its place by a fraction of a cell and settles
  useLayoutEffect(() => {
    cells.forEach((c, n) => {
      const el = rects.current[n];
      if (!el) return;
      const [i, j] = on ? c.to : c.from;
      let s = sp.current[n];
      const put = () => { el.style.transform = `translate(${s.x.v * C}px, ${s.y.v * C}px)`; };
      if (!s) {
        const [i0, j0] = first.current ? [i, j] : on ? c.from : c.to;
        s = sp.current[n] = { x: spring(i0, CFG.snap, put), y: spring(j0, CFG.snap, put) };
        put();
      }
      if (first.current) { s.x.set(i); s.y.set(j); return; }
      const far = Math.abs(c.from[0] - c.to[0]);
      const delay = (on ? 6 - far : far) * 16;
      s.x.to(i, { delay, cfg: { k: 380, z: 0.58, eps: 0.01 } }); s.y.to(j, { delay: delay + 14, cfg: { k: 380, z: 0.58, eps: 0.01 } });
    });
    first.current = false;
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => sp.current.forEach((s) => { s.x.stop(); s.y.stop(); }), []);
  return (
    <svg className="barcells" viewBox="0 0 14 14" width="14" height="14" shapeRendering="crispEdges" aria-hidden="true">
      {cells.map((c, n) => {
        const [i, j] = c.from;
        return <rect key={n} ref={(el) => { rects.current[n] = el; }} x="0" y="0" width={C} height={C} fill="currentColor" style={{ transform: `translate(${i * C}px, ${j * C}px)` }} />;
      })}
    </svg>
  );
}
