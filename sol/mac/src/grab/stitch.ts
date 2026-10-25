// Page's stitcher (Grab and Shelf, #200; sol/README.md "Grab and Shelf"): the arithmetic that turns screens of
// one scrolling window into one tall picture. Pure (no imports, no DOM), so the engine's tests check it
// (engine/test/grab-shelf.test.ts) and PageRoom.tsx does the pictures, the scrolling and the canvas.
//
// Each screen is boiled down to one number per row of pixels (a hash of a sample across the row) and whether the row
// is one flat colour. Two screens taken before and after a scroll are then compared row against row:
//   - a fixed header is the band at the top that is the same, in the same place, on the first two screens (a site's
//     bar that does not scroll); a fixed footer the same from the bottom. Each is kept once, never repeated.
//   - the shift is how far the rest moved: the d for which the earlier screen's rows d.. match the later screen's rows
//     0.. best. Flat rows (empty margins) are left out of the count, because they match anywhere.
//   - a shift of 0 means the page stopped moving: the bottom was reached.
// The macOS scroll bar shows up at the right edge while scrolling, so the rightmost strip is not hashed.
//   - a fixed column (a site's sidebar, a page's margins) is found the same way, column against column on the first
//     two screens, and left out of every row's hash: with it in, no row of one screen ever equals a row of the next
//     (Marco's Courses page in Safari, 2026-10-25: a sidebar on the left, and a list that fills in after each scroll,
//     so the room also waits for two pictures in a row to be the same before it compares).

export type Px = { width: number; height: number; data: ArrayLike<number> };
export type Rows = { hash: Uint32Array; flat: Uint8Array };
export type Segment = { frame: number; sy: number; sh: number };

/** one hash per row, from about 160 samples across it (the rightmost `skipRight` and leftmost `skipLeft` pixels left
 *  out), and its flatness */
export function rowsOf(img: Px, skipRight = 0, skipLeft = 0): Rows {
  const x0 = Math.min(Math.max(0, skipLeft), img.width - 1), w = Math.max(x0 + 1, img.width - Math.max(0, skipRight));
  const H = img.height, step = Math.max(1, Math.floor((w - x0) / 160));
  const hash = new Uint32Array(H), flat = new Uint8Array(H), d = img.data;
  for (let y = 0; y < H; y++) {
    let h = 0x811c9dc5, first = -1, same = 1;
    for (let x = x0; x < w; x += step) {
      const i = (y * img.width + x) * 4;
      // a little coarser than the pixel, so a value off by one or two (colour matching) still reads the same
      const v = ((d[i] >> 2) << 12) | ((d[i + 1] >> 2) << 6) | (d[i + 2] >> 2);
      if (first < 0) first = v; else if (v !== first) same = 0;
      h = Math.imul(h ^ v, 0x01000193) >>> 0;
    }
    hash[y] = h; flat[y] = same;
  }
  return { hash, flat };
}

/** the same picture twice (the page has stopped changing) */
export function sameRows(a: Rows, b: Rows): boolean {
  if (a.hash.length !== b.hash.length) return false;
  for (let y = 0; y < a.hash.length; y++) if (a.hash[y] !== b.hash[y]) return false;
  return true;
}

/** the fixed columns: pixel columns equal, in the same place, on two screens taken before and after a scroll, counted
 *  from the left edge and from the right edge (inside the scroll bar's `skipRight`), each at most `cap` of the width.
 *  A sidebar, a margin: whatever did not move with the page, so the rows can be hashed without it */
export function fixedColumns(a: Px, b: Px, skipRight = 0, cap = 0.4): { left: number; right: number } {
  const W = Math.min(a.width, b.width), H = Math.min(a.height, b.height), most = Math.floor(W * cap), ystep = Math.max(1, Math.floor(H / 400));
  const same = (x: number) => {
    for (let y = 0; y < H; y += ystep) {
      const i = (y * a.width + x) * 4, j = (y * b.width + x) * 4;
      if ((a.data[i] >> 2) !== (b.data[j] >> 2) || (a.data[i + 1] >> 2) !== (b.data[j + 1] >> 2) || (a.data[i + 2] >> 2) !== (b.data[j + 2] >> 2)) return false;
    }
    return true;
  };
  let left = 0, right = Math.max(0, skipRight);
  while (left < most && same(left)) left++;
  while (right < most && W - 1 - right > left && same(W - 1 - right)) right++;
  return { left, right };
}

/** a screen with nothing on it: every row flat and all one colour (no Screen Recording, or a minimised window) */
export function blank(r: Rows): boolean {
  for (let y = 0; y < r.hash.length; y++) if (!r.flat[y] || r.hash[y] !== r.hash[0]) return false;
  return true;
}

/** the fixed header and footer: rows equal in the same place on two screens, from the top and from the bottom, each
 *  at most a quarter of the screen (more than that is not a bar, it is a page that did not move) */
export function fixedBands(a: Rows, b: Rows, cap = 0.25): { head: number; foot: number } {
  const H = Math.min(a.hash.length, b.hash.length), most = Math.floor(H * cap);
  let head = 0, foot = 0;
  while (head < most && a.hash[head] === b.hash[head]) head++;
  while (foot < most && a.hash[H - 1 - foot] === b.hash[H - 1 - foot]) foot++;
  return { head, foot };
}

/** how far the page moved between two screens, in pixel rows, outside the fixed bands: 0 when it did not move, -1 when
 *  no shift matches well (the page changed under us); among equally good shifts, the one nearest `expect` */
export function shiftOf(prev: Rows, cur: Rows, head: number, foot: number, expect = 0): number {
  const H = Math.min(prev.hash.length, cur.hash.length), n = H - head - foot;
  if (n <= 0) return 0;
  const P = (r: number) => prev.hash[head + r], C = (r: number) => cur.hash[head + r], flat = (r: number) => prev.flat[head + r] === 1;
  // still: (nearly) every row where it was
  let same = 0;
  for (let r = 0; r < n; r++) if (P(r) === C(r)) same++;
  if (same >= n * 0.97) return 0;
  let best = -1, bestScore = 0;
  const minRows = Math.max(4, Math.floor(n * 0.03));
  for (let d = 1; d < n; d++) {
    let seen = 0, hit = 0;
    for (let r = 0; r + d < n; r++) {
      if (flat(r + d)) continue;
      seen++;
      if (P(r + d) === C(r)) hit++;
    }
    if (seen < minRows) continue;
    const score = hit / seen;
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && Math.abs(d - expect) < Math.abs(best - expect))) { best = d; bestScore = score; }
  }
  return bestScore >= 0.85 ? best : -1;
}

/** the pieces of each screen that make the tall picture, top to bottom: the first screen down to the footer, then the
 *  new rows of every later screen (the last d rows above the footer), then the footer once, from the last screen */
export function segments(H: number, foot: number, shifts: number[]): Segment[] {
  if (!shifts.length) return [{ frame: 0, sy: 0, sh: H }];
  const out: Segment[] = [{ frame: 0, sy: 0, sh: H - foot }];
  shifts.forEach((d, i) => out.push({ frame: i + 1, sy: H - foot - d, sh: d }));
  if (foot > 0) out.push({ frame: shifts.length, sy: H - foot, sh: foot });
  return out;   // the header is simply the top of the first screen: later screens' new rows sit below it, never above
}

/** the tall picture's height: the sum of its pieces */
export const stitchedHeight = (segs: Segment[]) => segs.reduce((a, s) => a + s.sh, 0);
