// The look (mine/look/SPEC.md): one recipe from Settings, applied on the root as CSS custom properties and data-bubble.
// face.css derives every surface, line and word from --base-color / --base-alpha / --on; the creature's canvases get
// the same colours flattened (ring.ts setPaperLook). The last look is kept in localStorage so a cold start draws it
// before the engine answers.
import type { Look } from "./useEngine";
import { setPaperLook } from "./creature/ring";
import type { RGB } from "./creature/palette";

export const LOOK_DEFAULT: Look = { color: "#000000", alpha: 0.78, blur: 48, bubble: "edge", text: 15 };
export const BUBBLES: [Look["bubble"], string][] = [["edge", "edge"], ["slab", "slab"], ["glass", "glass"], ["outline", "outline"], ["bare", "bare"], ["classic", "classic"]];
export const SWATCHES: [string, string][] = [["#000000", "black"], ["#06101f", "deep blue"], ["#2a1030", "aubergine"], ["#0c2418", "forest"], ["#ffffff", "white"]];
const KEY = "sol.look";

export const hexRgb = (h: string): RGB => { const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// is the base dark? the same rule as face.css's --on (relative luminance, the sRGB way)
export function darkBase(hex: string): boolean {
  const [r, g, b] = hexRgb(hex).map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.179;   // the WCAG line between white and black text
}

// Whatever came from the engine or from localStorage, made into a valid Look (the engine's clean() rules, settings.ts).
export function cleanLook(raw: unknown): Look {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    color: typeof r.color === "string" && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color.toLowerCase() : LOOK_DEFAULT.color,
    alpha: num(r.alpha, 0.5, 1, LOOK_DEFAULT.alpha),
    blur: Math.round(num(r.blur, 0, 64, LOOK_DEFAULT.blur)),
    bubble: BUBBLES.some(([b]) => b === r.bubble) ? (r.bubble as Look["bubble"]) : LOOK_DEFAULT.bubble,
    text: Math.round(num(r.text, 12, 24, LOOK_DEFAULT.text)),
  };
}

export function keptLook(): Look {
  try { return cleanLook(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return LOOK_DEFAULT; }
}

// The kept look is applied once, before the engine answers, and never over a look the engine has already sent
// (main.tsx loads this module asynchronously, so it can arrive after App's first settings).
let fromEngine = false;
export function applyKeptLook() { if (!fromEngine) applyLook(keptLook(), false); }

// the surfaces (face.css): every token derived here too, in plain rgba, so a WebKit without relative colour syntax
// draws the same; inline on the root, these win over the stylesheet's derivations.
const STEPS: [string, "base" | "on", number][] = [["--page", "base", 0.10], ["--side", "base", 0.10], ["--surface", "base", 0.25], ["--raised", "base", 0.40], ["--island", "base", 0.55], ["--pop", "base", 0.96],
  ["--line", "on", 0.06], ["--edge", "on", 0.10], ["--ink", "on", 0.92], ["--dim", "on", 0.55], ["--mute", "on", 0.32]];

export function applyLook(look: Look | undefined | null, engine = true) {
  if (engine) fromEngine = true;
  const l = cleanLook(look);
  const root = document.documentElement;
  const base = hexRgb(l.color);
  const on: RGB = darkBase(l.color) ? [255, 255, 255] : [0, 0, 0];
  const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  root.style.setProperty("--base-color", l.color);
  root.style.setProperty("--base-alpha", String(l.alpha));
  root.style.setProperty("--base-blur", `${l.blur}px`);
  root.style.setProperty("--on", `rgb(${on.join(",")})`);
  root.style.setProperty("--base", rgba(base, l.alpha));
  for (const [name, of, a] of STEPS) root.style.setProperty(name, rgba(of === "base" ? base : on, a));
  root.style.colorScheme = on[0] ? "dark" : "light";
  root.dataset.bubble = l.bubble;
  root.style.setProperty("--chat-text", `${l.text}px`);   // the talk's words (face.css .msg, cowork's .tk-line); nothing else reads it
  setPaperLook(base, on);
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* private mode: the default next time */ }
}
