// The frame the dark room draws round a window. A window on the desk is a rounded rectangle. A window put aside in
// Stage Manager's strip (`tucked`, told by the engine) is drawn by macOS as a thumbnail leaning away to the right:
// its left edge is the full height, its right edge about 85 % of it, and the whole leans a little toward the middle
// of the screen (measured on Marco's MacBook, 2026-10-25: right/left 0.84 to 0.86; the right edge's centre moves 3 to
// 11 points toward the screen's middle). A rectangle never sat on it; this path does, within a few points.
export type Framed = { x: number; y: number; w: number; h: number; tucked?: boolean };

const LEAN = 0.85;    // the right edge's height over the left edge's
const PULL = 0.08;    // how far the right edge's centre slides toward the screen's middle, per point of distance

/** the four corners, clockwise from top left: a rectangle, or the leaning quad of a tucked window */
export function corners(f: Framed, midY = innerHeight / 2): [number, number][] {
  const { x, y, w, h } = f;
  if (!f.tucked) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const inset = (h * (1 - LEAN)) / 2, shift = PULL * (midY - (y + h / 2));
  return [[x, y], [x + w, y + inset + shift], [x + w, y + h - inset + shift], [x, y + h]];
}

/** the SVG path of the frame: corners rounded by `r` (a leaning quad gets a smaller round, like the thumbnail's) */
export function framePath(f: Framed, r: number, midY = innerHeight / 2): string {
  const c = corners(f, midY), n = c.length, rr = f.tucked ? Math.min(r, 6) : r;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = c[(i + n - 1) % n], q = c[i], s = c[(i + 1) % n];
    const inn = toward(q, p, rr), out = toward(q, s, rr);
    parts.push(`${i === 0 ? "M" : "L"}${inn[0]} ${inn[1]} Q${q[0]} ${q[1]} ${out[0]} ${out[1]}`);
  }
  return parts.join(" ") + " Z";
}
const toward = (from: [number, number], to: [number, number], d: number): [number, number] => {
  const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy) || 1, k = Math.min(d, len / 2) / len;
  return [r2(from[0] + dx * k), r2(from[1] + dy * k)];
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** the CSS clip-path of the same frame, for the hit area and the shutter of a tucked window (undefined otherwise) */
export function frameClip(f: Framed, midY = innerHeight / 2): string | undefined {
  if (!f.tucked) return undefined;
  const { x, y } = f;
  return `polygon(${corners(f, midY).map(([px, py]) => `${r2(px - x)}px ${r2(py - y)}px`).join(", ")})`;
}

/** the veil with the frames cut out, as one CSS clip-path (even-odd: the screen's rectangle, then every hole). The veil
 *  is a plain div clipped this way, not an SVG mask: WebKit keeps a clipped layer on the compositor, so the veil's fade
 *  and the outlines drawing themselves no longer repaint the whole Retina screen every frame (2026-10-25) */
export function veilClip(holes: (Framed & { r?: number })[], r: number, W = innerWidth, H = innerHeight): string {
  const midY = H / 2;
  return `path(evenodd, "M0 0H${W}V${H}H0Z ${holes.map((h) => framePath(h, h.r ?? r, midY)).join(" ")}")`;
}
