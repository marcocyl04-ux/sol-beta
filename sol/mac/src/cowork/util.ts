// Small pure helpers Cowork used to keep a copy of in each file: a date as the room says it, a link opened outside, a
// box's place on the screen.
import type { Box } from "./thingView";

/** "10/25": a day as the room writes it */
export const date = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : `${d.getMonth() + 1}/${d.getDate()}`; };
/** "14:02" today, "10/25" before */
export const hhmm = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : Date.now() - +d > 86_400_000 ? date(iso) : d.toTimeString().slice(0, 5); };

/** a link in the person's own browser (a plain tab outside Sol.app) */
export const openUrl = (url: string) => { import("@tauri-apps/plugin-opener").then((o) => o.openUrl(url)).catch(() => window.open(url, "_blank", "noopener")); };

/** an element's box in whole pixels, as the shell's web views take it */
export const rectOf = (el: HTMLElement): Box => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
