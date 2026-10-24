// One frame loop for every creature canvas. A canvas registers a draw function; the loop sizes it for the
// device pixel ratio, clears it, skips it while off-screen, caps at 60 fps and stops when the window is hidden.
// Part of the fence (#16 blocker 5): it imports nothing a seat may edit; the creature's state registers its tick here.

export type Draw = (x: CanvasRenderingContext2D, w: number, h: number, dt: number, now: number) => void;
type Entry = { c: HTMLCanvasElement; x: CanvasRenderingContext2D; draw: Draw; w: number; h: number; visible: boolean };

const entries = new Map<HTMLCanvasElement, Entry>();
const ticks = new Set<(dt: number, now: number) => void>();
/** once per frame, before the canvases draw (creature/state.ts registers its tick) */
export function onTick(f: (dt: number, now: number) => void) { ticks.add(f); return () => { ticks.delete(f); }; }
let raf = 0;
let prev = 0;

// Where the pointer is in the window, for things that watch it without being under it.
export const pointer = { x: -1, y: -1, inside: false };
if (typeof window !== "undefined") {
  window.addEventListener("pointermove", (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true; }, { passive: true });
  document.addEventListener("pointerleave", () => { pointer.inside = false; });
  window.addEventListener("blur", () => { pointer.inside = false; });
  document.addEventListener("visibilitychange", () => start());
}

const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver((list) => {
  for (const r of list) {
    const e = entries.get(r.target as HTMLCanvasElement);
    if (e) { e.w = r.contentRect.width; e.h = r.contentRect.height; }
  }
}) : null;
const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((list) => {
  for (const r of list) { const e = entries.get(r.target as HTMLCanvasElement); if (e) e.visible = r.isIntersecting; }
}, { rootMargin: "50px" }) : null;

function frame(now: number) {
  raf = 0;
  if (document.hidden || !entries.size) return;
  raf = requestAnimationFrame(frame);
  if (now - prev < 1000 / 60 - 3) return; // at most 60 fps, also on a 120 Hz screen
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;
  for (const t of ticks) { try { t(dt, now); } catch (err) { console.error("creature tick", err); } }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const e of entries.values()) {
    if (!e.visible || e.w < 1 || e.h < 1) continue;
    const bw = Math.round(e.w * dpr), bh = Math.round(e.h * dpr);
    if (e.c.width !== bw || e.c.height !== bh) { e.c.width = bw; e.c.height = bh; }
    e.x.setTransform(dpr, 0, 0, dpr, 0, 0);
    e.x.clearRect(0, 0, e.w, e.h);
    e.x.globalAlpha = 1;
    try { e.draw(e.x, e.w, e.h, dt, now); } catch (err) { console.error("creature draw", err); }
  }
}

function start() {
  if (raf || document.hidden || !entries.size) return;
  prev = performance.now() - 1000 / 60;
  raf = requestAnimationFrame(frame);
}

export function register(c: HTMLCanvasElement, draw: Draw) {
  const x = c.getContext("2d");
  if (!x) return;
  const r = c.getBoundingClientRect();
  entries.set(c, { c, x, draw, w: r.width, h: r.height, visible: true });
  ro?.observe(c);
  io?.observe(c);
  start();
}

export function unregister(c: HTMLCanvasElement) {
  if (!entries.delete(c)) return;
  ro?.unobserve(c);
  io?.unobserve(c);
  if (!entries.size && raf) { cancelAnimationFrame(raf); raf = 0; }
}
