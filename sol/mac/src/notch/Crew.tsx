// The notch's crew and its bell (issue #15). When Sol starts changing a part of the face, the notch opens by itself
// and the creature goes down to work: on the notch it lets itself down a rope of cells from where it sits (the wing,
// or the top of the tab), on the island it rides down out of the capsule. Down there it writes (eyes on the page, a
// scribble of cells in the seat's colour, a bob a cell at a time) while the part is taped; when the part broke it
// turns to Marco and holds still but for a one-cell shake, and the notch says "broke it, fixing". On the last peel
// it climbs back, the rope goes up after it cell by cell, and the notch closes a breath later.
//
// The bell: a ping from a seat. A slice of the ring, in the seat's colour, runs once round the slab's edge (the
// call's marching cells, one lap), then settles as a short lit run at the top edge while the line shows. Closed again
// and still not seen, the ping stays as a lit cell on the wing (on the island: on the capsule's edge), one per ping,
// the newest first, four at most. Everything here is whole cells, moving in steps; nothing fades.
import { useEffect, useRef } from "react";
import { register, unregister } from "../creature/loop";
import { outline } from "../creature/indicators";
import { bayer, rgba, type RGB } from "../creature/ring";
import { GRADIENTS } from "../creature/palette";
import { CELLS, LET, EYES } from "../Mark";
import { notchGesture, TEMPO } from "../creature/scenes";

export const CLIMB_MS = 520;   // the way down and the way back, the same length
const BELL_MS = 1100;          // one lap of the bell
export type CrewMode = "up" | "down" | "climbing";
export type CrewState = {
  mode: CrewMode; since: number;           // since: when it started down, or started climbing (performance.now)
  broken: boolean; colours: [RGB, RGB];
  bellAt: number; bell: RGB;               // the last bell's start, and its colour
  lit: boolean;                            // the short lit run at the top edge (a ping showing)
  cells: RGB[];                            // the unseen pings' cells, newest first (drawn while closed)
  open: boolean;
  form: "notch" | "island"; shape: string; off: number;
};
export const crewState = (): CrewState => ({
  mode: "up", since: 0, broken: false, colours: [GRADIENTS.home[0], GRADIENTS.home[GRADIENTS.home.length - 1]], bellAt: -1e9, bell: GRADIENTS.home[0],
  lit: false, cells: [], open: false, form: "notch", shape: "wings", off: 0,
});

const C = 2;              // the creature's cell here: 14 cells, 28 px
// where the creature hangs in the open card, from the slab's top-left corner
function spot(s: CrewState) {
  const top = s.form === "island" ? 0 : s.shape === "wings" ? 2 : s.off;   // the rope's top: where it sits closed
  return { x: 16, top, y: (s.form === "island" ? 8 : s.off + 10) };
}

function drawBody(x: CanvasRenderingContext2D, ox: number, oy: number, eyeDy: number, lid: number) {
  for (const cell of CELLS) {
    x.fillStyle = rgba(LET[cell.ch === "#" || cell.ch === "w" ? "b" : cell.ch]);
    x.fillRect(ox + cell.i * C, oy + cell.j * C, C, C);
  }
  for (const [i, col] of EYES) { x.fillStyle = col; x.fillRect(ox + i * C, oy + (6 + eyeDy) * C + lid, C, C - lid); }
}

export function CrewCanvas({ pill, st }: { pill: React.RefObject<HTMLDivElement | null>; st: React.RefObject<CrewState> }) {
  const c = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = c.current;
    if (!cv) return;
    register(cv, (x, _w, _h, _dt, now) => {
      const s = st.current, el = pill.current;
      if (!s || !el) return;
      const r = el.getBoundingClientRect();
      const L = Math.round(r.left), T = Math.round(r.top), W = Math.round(r.width), H = Math.round(r.height);
      x.imageSmoothingEnabled = false;

      // ---- the bell: one lap of a slice of the ring, then a short lit run at the top edge ----
      const o = outline(L + 3, T + 1, W - 6, H - 4, 12);
      const nc = Math.floor(o.len / C);
      const topMid = Math.floor((W - 6 - 24) / 2 / C);   // the top edge's middle, in cells along the outline
      const age = now - s.bellAt;
      if (age >= 0 && age < BELL_MS) {
        const head = topMid + Math.floor((age / BELL_MS) * nc);
        for (let k = 0; k < 18; k++) {
          const p = o.at((head - k) * C);
          const a = [1, 1, 0.75, 0.75, 0.5, 0.5, 0.3, 0.3, 0.2][Math.floor(k / 2)] ?? 0.2;
          x.fillStyle = rgba(s.bell, a);
          x.fillRect(Math.round(p[0] / C) * C, Math.round(p[1] / C) * C, C, C);
        }
      } else if (s.lit && s.open && H > 30) {
        // settled: a run of lit cells at the top edge, one cell in two stepping along it
        const step = Math.floor(now / 160) % 2;
        for (let k = -6; k < 6; k++) {
          const p = o.at((topMid + k) * C);
          x.fillStyle = rgba(s.bell, (k + step) % 2 ? 0.55 : 1);
          x.fillRect(Math.round(p[0] / C) * C, Math.round(p[1] / C) * C, C, C);
        }
      }

      // ---- the unseen pings, closed: a lit cell each, on the wing or on the capsule's edge ----
      if (!s.open && s.cells.length && H < 44) {
        const n = Math.min(4, s.cells.length), sz = 4, gap = 2;
        for (let k = 0; k < n; k++) {
          let px: number, py: number;
          if (s.form === "island") { px = L + W - 12 - k * (sz + gap); py = T + Math.round(H / 2 - sz / 2); }
          else if (s.shape === "wings") { px = L + 38 + k * (sz + gap); py = T + 12; }
          else { px = L + W / 2 + 18 + k * (sz + gap); py = T + s.off + 12; }
          // a lit cell breathes in whole steps: on, a cell's worth darker, on
          const on = Math.floor(now / 600 + k) % 4 !== 3;
          x.fillStyle = rgba(s.cells[k], on ? 1 : 0.6);
          x.fillRect(Math.round(px), Math.round(py), sz, sz);
        }
      }

      // ---- Sol directing (Companion step 4): while EDIT runs in the window, closed on the wing, a baton of three
      // cells beside the creature beats time with the hands, one beat per scene beat (tempo.json); nothing else
      if (notchGesture() === "direct" && s.mode === "up" && s.form === "notch" && H < 44) {
        const beat = TEMPO.M + TEMPO.P, k = (now % beat) / beat;
        const a = -0.9 + Math.sin(k * Math.PI * 2) * 0.7;      // the arc it sweeps, radians from up
        const bx = s.shape === "wings" ? L + 32 : L + W / 2 + 18, by = T + (s.shape === "wings" ? 22 : s.off + 22);
        for (let q = 1; q <= 3; q++) {
          x.fillStyle = rgba(s.colours[q === 3 ? 0 : 1], q === 3 ? 1 : 0.8);
          x.fillRect(Math.round((bx + Math.sin(a) * q * 3) / C) * C, Math.round((by - Math.cos(a) * q * 3) / C) * C, C, C);
        }
      }

      // ---- the crew ----
      if (s.mode === "up") return;
      const sp = spot(s);
      const t = Math.min(1, (now - s.since) / CLIMB_MS);
      const k = s.mode === "down" ? t : 1 - t;                       // how far down it is
      const drop = sp.y - sp.top;
      const y = sp.top + Math.round((k * drop) / C) * C;             // whole cells, never in between
      const ox = L + sp.x;
      if (s.form === "notch") {
        // the rope: from the top to the creature's head, cells in the seat's two colours, dithered
        for (let j = 0, ry = T + sp.top; ry < T + y + 2; j++, ry += C) {
          x.fillStyle = rgba(bayer(0, j) < 0.5 ? s.colours[0] : s.colours[1]);
          x.fillRect(ox + 7 * C, ry, C, C);
        }
      }
      let bob = 0, shake = 0, eyeDy = 1, lid = 0;
      if (s.mode === "down" && t >= 1) {
        if (s.broken) {
          eyeDy = 0;
          shake = Math.floor(now / 1500) !== Math.floor((now - 120) / 1500) ? C : 0;   // a one-cell shake, now and then
        } else {
          bob = Math.floor(now / 280) % 2 ? C : 0;                     // the scribble's bob
          lid = Math.floor(now / 280) % 2;
          // the scribble: three cells under its front foot, lit in turn
          const at = Math.floor(now / 140) % 3;
          for (let q = 0; q < 3; q++) {
            x.fillStyle = rgba(s.colours[q === at ? 0 : 1], q === at ? 1 : 0.5);
            x.fillRect(ox + (10 + q) * C, T + y + 14 * C + (q % 2) * C, C, C);
          }
        }
      }
      drawBody(x, ox + shake, T + y + bob, eyeDy, lid);
    });
    return () => unregister(cv);
  }, [pill, st]);
  return <canvas ref={c} className="crew-c" aria-hidden="true" />;
}
