// The Space: what sits under the UI. A faint cell grid like paper grain, the seat's tint breathing in the bottom-left
// corner while the conversation is empty, the eye in the bottom-right corner that follows the pointer and closes asleep,
// and a diagonal cell wipe when the seat changes. Ported from drawSpace.
// The tint comes and goes as cells: leaving, they drop out in Bayer order along the diagonal, the far ones first
// and the bottom-left corner last (about 900 ms); coming back it fills in the same way, corner first. Never a fade.
// A full-window canvas at 2x is a tiled layer and window-sized surfaces of graphics memory (#81), so none stays up: the
// grain is a CSS background (one 16x16 tile), the eye a small canvas at the corner of .main, and the tint and the wipe
// get a canvas only while they draw, the tint one the size of its corner.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { onTick, pointer, register, unregister } from "./loop";
import { live, onSeatChange, type SeatName } from "./state";
import { Life, cellFill } from "./Widget";
import { PAPER, TINTS, bayer, tintAt, rgba } from "./ring";

const CELL = 8;
const DITHER_S = 0.9; // how long the tint takes to dither away or back
const EYE_W = 60, EYE_H = 40; // the eye's canvas; the eye sits 46 px from .main's right, 30 from its bottom
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const dprNow = () => Math.min(window.devicePixelRatio || 1, 2);

// the grain: a dot at every other 8 px cell, (i + j) even, so one 16x16 tile holds two dots. Drawn at the device's
// pixels and shown at 16 CSS px, so a dot is one CSS px, as the canvas drew it.
const tiles = new Map<string, string>();
function grainTile(grain: string, dpr: number): string {
  const key = `${grain}@${dpr}`;
  let url = tiles.get(key);
  if (!url) {
    const t = document.createElement("canvas");
    t.width = t.height = Math.round(CELL * 2 * dpr);
    const g = t.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = grain; g.fillRect(0, 0, 1, 1); g.fillRect(CELL, CELL, 1, 1);
    url = `url(${t.toDataURL("image/png")})`;
    tiles.set(key, url);
  }
  return url;
}

// what the tint, the wipe and the eye share between their canvases
type Shared = { want: boolean; shown: number; moving: boolean; T: number; wipe: { t: number; to: SeatName } | null };

export function Space({ empty }: { empty: boolean }) {
  const grain = useRef<HTMLDivElement>(null);
  const s = useRef<Shared | null>(null);
  if (!s.current) s.current = { want: empty, shown: empty ? 1 : 0, moving: false, T: 0, wipe: null };
  s.current.want = empty;
  // the tint's canvas stands while the conversation is empty and until its cells have dithered away
  const [tint, setTint] = useState(empty);
  const tintUp = useRef(empty);
  useEffect(() => { if (empty) { tintUp.current = true; setTint(true); } }, [empty]);
  const [wipe, setWipe] = useState(0);

  useEffect(() => {
    const sh = s.current!;
    const offTick = onTick((dt) => {
      sh.T += dt * live.tempo;
      // how much of the tint stands: 1 all of it, 0 none; walks toward `want` at a constant pace
      const target = sh.want ? 1 : 0;
      sh.moving = sh.shown !== target;
      if (sh.moving) sh.shown = target > sh.shown ? Math.min(1, sh.shown + dt / DITHER_S) : Math.max(0, sh.shown - dt / DITHER_S);
      else if (sh.shown === 0 && tintUp.current) { tintUp.current = false; setTint(false); }
    });
    const offSeat = onSeatChange((to) => { sh.wipe = { t: 0, to }; setWipe((n) => n + 1); });
    return () => { offTick(); offSeat(); };
  }, []);

  // the grain follows the paper (setPaper) and the screen's pixel ratio: checked by the eye each frame
  const grainKey = useRef("");
  const keepGrain = () => {
    const el = grain.current, dpr = dprNow(), key = `${PAPER.grain}@${dpr}`;
    if (!el || key === grainKey.current) return;
    grainKey.current = key; el.style.backgroundImage = grainTile(PAPER.grain, dpr);
  };
  useLayoutEffect(keepGrain, []);

  return (
    <>
      <div ref={grain} className="space" aria-hidden="true" />
      {tint && <Tint s={s.current} />}
      {wipe > 0 && s.current.wipe && <Wipe key={wipe} s={s.current} done={() => setWipe(0)} />}
      <Eye before={keepGrain} />
    </>
  );
}

// the seat's tint: a diagonal breath in the bottom-left corner, dithered. Its cells are worked out ten times a second
// at rest, every frame while it dithers in or out, and drawn every frame. Its canvas covers the corner it can reach,
// i < cols * 0.75 and j >= rows * 0.25 of the window's cells.
function Tint({ s }: { s: Shared }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let drawn = -1, place = "";
    let cells: { f: string; i: number; j: number }[] = [];
    // the corner in the window's cells; the canvas follows it when the window changes size
    const corner = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
      const iMax = Math.ceil(cols * 0.75), jMin = Math.floor(rows * 0.25);
      const p = `${iMax}:${jMin}:${H}`;
      if (p !== place) {
        place = p; drawn = -1;
        Object.assign(c.style, { top: `${jMin * CELL}px`, width: `${iMax * CELL}px`, height: `${H - jMin * CELL}px` });
      }
      return { cols, rows, iMax, jMin };
    };
    corner();
    register(c, (x, _w, _h, _dt, now) => {
      const { cols, rows, iMax, jMin } = corner();
      if (s.moving || now - drawn > 100) {
        drawn = now;
        cells = [];
        const sl = live.slice, shown = s.shown, T = s.T;
        for (let j = jMin; j < rows; j++) for (let i = 0; i < iMax; i++) {
          const d = i / cols + (1 - j / rows);
          const v = Math.max(0, 1.15 - d * 2.3) + Math.sin(T * 0.5 + i * 0.1) * 0.02; // a smaller corner than the prototype: a full window is big
          if (v <= 0 || bayer(i, j) >= v * v * 0.5) continue;
          // each cell's turn to go: mostly its place on the diagonal (the corner is 0, the tint's edge ~1),
          // broken up by the Bayer matrix so the edge is a dither, not a line
          if (shown < 1) { const turn = Math.min(1, d / 0.5) * 0.7 + bayer(j, i) * 0.3; if (turn >= shown) continue; }
          cells.push({ f: rgba(tintAt(sl, d + T * sl.speed), 0.09), i, j });
        }
      }
      // drawn against where the canvas stands now, not where it was asked to stand: the loop learns a resize a frame late
      const top = Math.round(c.getBoundingClientRect().top);
      for (const k of cells) { x.fillStyle = k.f; x.fillRect(k.i * CELL, k.j * CELL - top, CELL - 1, CELL - 1); }
    });
    return () => unregister(c);
  }, [s]);
  return <canvas ref={ref} className="space-tint" aria-hidden="true" />;
}

// the wipe: the new seat's colour sweeps the diagonal, bottom-left to top-right; a full-window canvas for its second
function Wipe({ s, done }: { s: Shared; done: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    register(c, (x, w, h, dt) => {
      const wipe = s.wipe;
      if (!wipe) return;
      const cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL);
      wipe.t += dt * 1.4;
      const k = wipe.t, to = TINTS[wipe.to];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const d = (i / cols + (1 - j / rows)) / 2;
        const edge = k * 1.3 - d;
        if (edge > 0 && edge < 0.12 && bayer(i, j) < 1 - edge / 0.12) cellFill(x, tintAt(to, d * 2), i, j, CELL - 1, 0.8);
      }
      if (k > 1.2) { s.wipe = null; doneRef.current(); }
    });
    return () => unregister(c);
  }, [s]);
  return <canvas ref={ref} className="space-wipe" aria-hidden="true" />;
}

// the eye in the corner of the work area: always awake (closed only asleep), looking at the pointer. Its canvas is
// placed on whole CSS px each frame, so the eye lands on the same pixels as when it was drawn on the window.
function Eye({ before }: { before: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const beforeRef = useRef(before);
  beforeRef.current = before;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const eye = new Life();
    let main: Element | null = null;
    let at = "";
    register(c, (x, _w, _h, dt) => {
      beforeRef.current();
      const W = window.innerWidth, H = window.innerHeight;
      if (!main?.isConnected) main = document.querySelector(".main");
      const mr = main?.getBoundingClientRect();
      const ex = (mr ? mr.right : W) - 46, ey = (mr ? mr.bottom : H) - 30;
      const left = Math.floor(ex + 46) - EYE_W, top = Math.floor(ey + 30) - EYE_H;
      const p = `${left},${top}`;
      if (p !== at) { at = p; c.style.left = `${left}px`; c.style.top = `${top}px`; }
      eye.tick(dt, W, H, c);
      const lx = pointer.inside ? clamp((pointer.x - ex) / 200) : 0, ly = pointer.inside ? clamp((pointer.y - ey) / 120) : 0;
      eye.eye(x, ex - left, ey - top, 7, eye.eyeOpen(), lx, ly);
    });
    return () => unregister(c);
  }, []);
  return <canvas ref={ref} className="space-eye" aria-hidden="true" />;
}
