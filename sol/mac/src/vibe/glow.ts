// The glow: a window the size of the screen, transparent and never in the way (vibe.rs makes it: above everything, on
// every space, the mouse goes through), with one low-resolution canvas. Along its four edges a band of light, Sol's
// colours flowing round the perimeter like the edge of a phone when Siri listens; with music the band widens and
// brightens on the beat, without it a slow breath. It arrives as a ring that spreads from the sidebar's mark across the
// whole screen (vibe.rs sends where the mark is), and leaves the same way back into it.
import { listen } from "@tauri-apps/api/event";
import { Beat } from "./beat";

// the colours come from the face with each on (vibe.ts PRESETS, or Frank's own); Sol's set until then
let COLOURS = ["#fd69b9", "#ff2e4e", "#fb7129", "#f4c82a", "#70df45", "#5ac8fa", "#bf5af2"].map(hex);
function hex(h: string): [number, number, number] { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function colour(p: number): string {
  const n = COLOURS.length, u = ((p % 1) + 1) % 1 * n, i = Math.floor(u), f = u - i;
  const a = COLOURS[i % n], b = COLOURS[(i + 1) % n];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

const SCALE = 3;   // the canvas is a third of the device's pixels each way: the upscale is the blur
const c = document.getElementById("g") as HTMLCanvasElement;
const x = c.getContext("2d")!;
const beat = new Beat();
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let want = false;        // on or going on
let k = 0;               // 0..1 how far the ring has spread (the glow shows inside it)
let ox = 0, oy = 0;      // where it spreads from, in this window's CSS px
let flow = 0;            // the colours' place along the edge, turns
let strength = 0.2;      // how strong, from the face (Settings → music → brightness)
let scale = 1;           // how wide, 0.5..2
let music = false;       // whether it follows the music (off by default: the glow just shines)
let raf = 0, last = 0;
let maskC: HTMLCanvasElement | null = null;
function mask(w: number, h: number) {
  if (!maskC) maskC = document.createElement("canvas");
  if (maskC.width !== w || maskC.height !== h) { maskC.width = w; maskC.height = h; }
  return maskC;
}

function size() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round((window.innerWidth * dpr) / SCALE)), h = Math.max(1, Math.round((window.innerHeight * dpr) / SCALE));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { w, h, s: dpr / SCALE };   // s: CSS px to canvas px
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
  beat.tick(dt, now);
  const { w, h, s } = size();
  const W = window.innerWidth, H = window.innerHeight;
  // the glow just shines: the rhythm lives in the chat box's ring (vibe.ts); the music only hurries the colours a little
  const env = beat.env, bt = beat.beat;
  // the ring spreads in about a second, and comes back a little quicker
  const rate = want ? 1 / 1.1 : 1 / 0.8;
  k = want ? Math.min(1, k + dt * rate) : Math.max(0, k - dt * rate);
  const ease = k < 1 && want ? 1 - Math.pow(1 - k, 2.2) : k;
  flow += dt * (reduced ? 0 : music ? 0.06 + env * 0.35 + bt * 0.2 : 0.05);

  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, w, h);
  x.setTransform(s, 0, 0, s, 0, 0);   // draw in CSS px
  if (k <= 0 && !want) { raf = 0; return; }   // gone, and not asked back: rest (the first frame has dt 0 and k 0, so `want` keeps it going)

  // the band: wider and brighter with the music, breathing slowly without it
  const depth = (56 + strength * 40) * scale + (music ? env * 90 + bt * 60 : 0);
  const bright = Math.min(1, strength * 2.5 + (music ? env * 0.3 + bt * 0.2 : 0));
  // the colour: one turn of Sol's colours round the screen's centre, turning with `flow`; the band's shape is a mask
  // drawn on the side: four fades from the edges added together, so the corners meet without a seam
  const g = x.createConicGradient(flow * Math.PI * 2, W / 2, H / 2);
  const N = 14;
  for (let i = 0; i <= N; i++) g.addColorStop(i / N, colour(i / N));
  x.globalCompositeOperation = "source-over"; x.fillStyle = g; x.fillRect(0, 0, W, H);
  const m = mask(w, h);
  const mx = m.getContext("2d")!;
  mx.setTransform(1, 0, 0, 1, 0, 0); mx.globalCompositeOperation = "source-over";
  mx.clearRect(0, 0, w, h);
  mx.setTransform(s, 0, 0, s, 0, 0);
  mx.globalCompositeOperation = "lighter";
  const fade = (x0: number, y0: number, x1: number, y1: number) => {
    const f = mx.createLinearGradient(x0, y0, x1, y1);
    f.addColorStop(0, `rgba(255,255,255,${bright})`);
    f.addColorStop(0.3, `rgba(255,255,255,${bright * 0.5})`);
    f.addColorStop(0.65, `rgba(255,255,255,${bright * 0.12})`);
    f.addColorStop(1, "rgba(255,255,255,0)");
    mx.fillStyle = f; mx.fillRect(0, 0, W, H);
  };
  fade(0, 0, 0, depth); fade(0, H, 0, H - depth); fade(0, 0, depth, 0); fade(W, 0, W - depth, 0);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = "destination-in"; x.drawImage(m, 0, 0);
  x.setTransform(s, 0, 0, s, 0, 0);
  x.globalCompositeOperation = "source-over";

  // the ring: what is inside it shows; its front is a band of colour while it travels
  const maxR = Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy)) + 140;
  const R = ease * maxR;
  if (k < 1) {
    x.save();
    const m = x.createRadialGradient(ox, oy, Math.max(0, R - 10), ox, oy, R + 120);
    m.addColorStop(0, "rgba(255,255,255,1)"); m.addColorStop(1, "rgba(255,255,255,0)");
    x.globalCompositeOperation = "destination-in"; x.fillStyle = m; x.fillRect(0, 0, W, H);
    x.restore();
    x.save();
    x.globalCompositeOperation = "lighter";
    const ring = x.createRadialGradient(ox, oy, Math.max(0, R - 70), ox, oy, R + 50);
    const a = (1 - ease) * 0.85;
    ring.addColorStop(0, "rgba(255,255,255,0)");
    ring.addColorStop(0.55, `rgba(255,255,255,${a * 0.9})`);
    ring.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = ring; x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = "source-atop";
    const tint = x.createLinearGradient(0, 0, W, H);
    for (let i = 0; i <= 6; i++) tint.addColorStop(i / 6, colour(i / 6 + flow));
    x.globalAlpha = 0.9; x.fillStyle = tint; x.fillRect(0, 0, W, H);
    x.restore();
  }
  raf = requestAnimationFrame(frame);
}
function go() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }

function glowTo(on: boolean, x: number, y: number, colours?: string[], bright?: number, sz?: number, mu?: boolean) {
  if (colours && colours.length >= 2) COLOURS = colours.map(hex);
  if (typeof bright === "number") strength = Math.max(0.05, Math.min(1, bright));
  if (typeof sz === "number") scale = Math.max(0.5, Math.min(2, sz));
  if (typeof mu === "boolean") music = mu;
  want = on;
  if (want) { ox = x; oy = y; }
  go();
}
if ("__TAURI_INTERNALS__" in window) {
  void listen<{ full: number; low: number }>("vibe", (e) => beat.hear(e.payload.full, e.payload.low));
  void listen<{ on: boolean; x: number; y: number; colours?: string[]; bright?: number; size?: number; music?: boolean }>("vibe-glow", (e) => glowTo(e.payload.on, e.payload.x, e.payload.y, e.payload.colours, e.payload.bright, e.payload.size, e.payload.music));
} else {
  // outside Sol.app (a browser, a test): window.__glow(on, x, y) and window.__hear(full, low) stand in for the shell
  (window as unknown as { __glow: typeof glowTo }).__glow = glowTo;
  (window as unknown as { __hear: (f: number, l: number) => void }).__hear = (f, l) => beat.hear(f, l);
}
window.addEventListener("resize", () => { if (k > 0) go(); });
