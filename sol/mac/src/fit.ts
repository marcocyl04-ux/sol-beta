import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CFG, useSpring } from "./motion";

// How the face fits a window, the same in Life, Work and Cowork. The talk keeps at least TALK px. When the window
// is too narrow for that, the open panes narrow first, in step, down to their floor; then a pinned side lets go and
// floats over the talk (hot strip and hover, as unpinned) without touching the saved pin, and docks again on its own
// when the window grows back. When even that is not enough, the talk and the panes give way together, each in
// proportion to its floor, so nothing is crushed to a sliver. Nothing here is written back, so a wide window gets the
// saved widths again.
export const TALK = 360;

// the window's width, live (one number on resize)
export function useWidth() {
  const [vw, setVw] = useState(innerWidth);
  useEffect(() => { const r = () => setVw(innerWidth); addEventListener("resize", r); return () => removeEventListener("resize", r); }, []);
  return vw;
}

// the open panes' wanted widths (px) squeezed into room: each gives way in proportion to what it has above the
// floor; past the floors the talk shares the shortfall with them
function squeeze(want: number[], room: number, floor: number) {
  const total = want.reduce((s, w) => s + w, 0);
  if (total <= room) return want;
  const above = want.map((w) => w - floor), spare = above.reduce((s, a) => s + a, 0), over = total - room;
  if (over <= spare) return want.map((w, i) => w - (spare ? (over * above[i]) / spare : 0));
  const k = Math.max(0, room + TALK) / (TALK + want.length * floor);
  return want.map(() => floor * k);
}

// want: each pane's saved width in px, open or not. A pane is never wanted under its floor. A closed pane gets the
// width it would have if it opened beside the open ones, so one closing (or about to open) keeps a steady width.
export function fitRow(vw: number, side: number, pinned: boolean, want: number[], open: boolean[], floor: number) {
  const w = want.map((x) => Math.max(floor, x));
  const lay = (on: boolean[]) => {
    const idx = w.map((_, i) => i).filter((i) => on[i]);
    const docked = pinned && idx.length * floor <= vw - side - TALK;
    const got = squeeze(idx.map((i) => w[i]), vw - (docked ? side : 0) - TALK, floor);
    return { docked, at: (i: number) => got[idx.indexOf(i)] };
  };
  const now = lay(open);
  const widths = w.map((_, i) => Math.round(open[i] ? now.at(i) : lay(open.map((o, j) => o || j === i)).at(i)));
  // how wide pane i may be dragged: what the talk leaves beside the others as they stand
  const max = (i: number) => Math.max(0, vw - (now.docked ? side : 0) - TALK - widths.reduce((s, x, j) => s + (j !== i && open[j] ? x : 0), 0));
  return { docked: now.docked, widths, max };
}

// a docked side makes room: the main's left edge travels on the spring the side glides on, and goes when it lets go
export function useDock(side: number, docked: boolean) {
  const main = useRef<HTMLDivElement>(null);
  const dock = useSpring(docked ? side : 0, CFG.glide, (v) => { if (main.current) main.current.style.paddingLeft = `${Math.max(0, v)}px`; });
  useLayoutEffect(() => { if (main.current) main.current.style.paddingLeft = `${dock.v}px`; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { dock.to(docked ? side : 0, { cfg: docked ? CFG.glide : CFG.away }); }, [docked]); // eslint-disable-line react-hooks/exhaustive-deps
  return main;
}
