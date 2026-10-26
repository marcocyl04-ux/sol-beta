import { useEffect, useRef } from "react";
import { toggleVibe } from "./vibe";
import { Creature, clamp, type Life } from "./creature/Widget";
import { live, poke } from "./creature/state";
import { bayer, tintAt, rgba, type RGB } from "./creature/ring";

// Sol's mark, temporary: Marco's pixel creature, cell for cell from his picture (2026-10-14).
// One unit per cell on a 14 x 14 grid; every cell is one flat colour from the Sol palette.
// Source of truth for the grid is the letter map in sol/design/ICON.md; regenerate, don't hand-edit.
// It is always the creature itself, drawn on the device-pixel grid: small (the sidebar, 22 px) it only breathes,
// glances and twitches an ear, and follows the creature's state calmly; `live` (the empty state, 56 px) it also
// watches the pointer, keeps its dust orbit and can be poked. With reduced motion it is the still SVG.
const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// The mark at the top of the sidebar is the vibe switch (vibe.ts): a click turns vibe mode on or off, everything
// spreading from it; a hold (half a second) opens its settings, the music drawer. The creature's own poke still plays.
export function VibeMark({ size = 22 }: { size?: number }) {
  const timer = useRef(0);
  const held = useRef(false);
  const down = () => {
    held.current = false;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { held.current = true; window.dispatchEvent(new CustomEvent("sol-vibe-edit")); }, 450);
  };
  const clear = () => window.clearTimeout(timer.current);
  const up = (e: React.PointerEvent<HTMLSpanElement>) => { clear(); if (!held.current) toggleVibe(e.currentTarget); };
  return (
    // no pointerleave here: the creature captures the pointer on its canvas, which makes the wrapper hear a leave at once
    <span className="vibe-mark" onPointerDown={down} onPointerUp={up} onPointerCancel={clear}
      title="vibe mode: click to turn it on or off, hold to set it up">
      <Mark size={size} />
    </span>
  );
}

export function Mark({ size = 22, className, live: alive }: { size?: number; className?: string; live?: boolean }) {
  if (!reduced) return <MarkLive size={size} big={!!alive} className={className} />;
  return <MarkStill size={size} className={className} />;
}

function MarkStill({ size, className }: { size: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 14" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      <rect x="10" y="1" width="1" height="1" fill="#fb9ed5" />
      <rect x="11" y="1" width="1" height="1" fill="#ff4888" />
      <rect x="5" y="2" width="1" height="1" fill="#ceecb2" />
      <rect x="6" y="2" width="1" height="1" fill="#8dc965" />
      <rect x="9" y="2" width="1" height="1" fill="#fb9ed5" />
      <rect x="10" y="2" width="1" height="1" fill="#ff4888" />
      <rect x="11" y="2" width="1" height="1" fill="#ff2e4e" />
      <rect x="5" y="3" width="1" height="1" fill="#ceecb2" />
      <rect x="6" y="3" width="1" height="1" fill="#ffbe96" />
      <rect x="7" y="3" width="1" height="1" fill="#fb9ed5" />
      <rect x="8" y="3" width="1" height="1" fill="#fb9ed5" />
      <rect x="9" y="3" width="1" height="1" fill="#ff4888" />
      <rect x="10" y="3" width="1" height="1" fill="#ff2e4e" />
      <rect x="11" y="3" width="1" height="1" fill="#fb9ed5" />
      <rect x="6" y="4" width="1" height="1" fill="#fb9ed5" />
      <rect x="7" y="4" width="1" height="1" fill="#fd69b9" />
      <rect x="8" y="4" width="1" height="1" fill="#ff4888" />
      <rect x="9" y="4" width="1" height="1" fill="#ff2e4e" />
      <rect x="10" y="4" width="1" height="1" fill="#fb9ed5" />
      <rect x="2" y="5" width="1" height="1" fill="#70df45" />
      <rect x="3" y="5" width="1" height="1" fill="#ceecb2" />
      <rect x="4" y="5" width="1" height="1" fill="#fb9ed5" />
      <rect x="5" y="5" width="1" height="1" fill="#fb9ed5" />
      <rect x="6" y="5" width="1" height="1" fill="#fd69b9" />
      <rect x="7" y="5" width="1" height="1" fill="#ff4888" />
      <rect x="8" y="5" width="1" height="1" fill="#ff2e4e" />
      <rect x="9" y="5" width="1" height="1" fill="#fb9ed5" />
      <rect x="11" y="5" width="1" height="1" fill="#ffbe96" />
      <rect x="12" y="5" width="1" height="1" fill="#ffbe96" />
      <rect x="2" y="6" width="1" height="1" fill="#ceecb2" />
      <rect x="3" y="6" width="1" height="1" fill="#fb9ed5" />
      <rect x="4" y="6" width="1" height="1" fill="#fb9ed5" />
      <rect x="7" y="6" width="1" height="1" fill="#ff2e4e" />
      <rect x="10" y="6" width="1" height="1" fill="#fb7129" />
      <rect x="11" y="6" width="1" height="1" fill="#f89b2a" />
      <rect x="12" y="6" width="1" height="1" fill="#f4c82a" />
      <rect x="3" y="7" width="1" height="1" fill="#fb9ed5" />
      <rect x="4" y="7" width="1" height="1" fill="#fd69b9" />
      <rect x="5" y="7" width="1" height="1" fill="#ff4888" />
      <rect x="6" y="7" width="1" height="1" fill="#ff2e4e" />
      <rect x="7" y="7" width="1" height="1" fill="#fd302d" />
      <rect x="8" y="7" width="1" height="1" fill="#fd302d" />
      <rect x="9" y="7" width="1" height="1" fill="#fb7129" />
      <rect x="10" y="7" width="1" height="1" fill="#f89b2a" />
      <rect x="11" y="7" width="1" height="1" fill="#f4c82a" />
      <rect x="12" y="7" width="1" height="1" fill="#e8ef54" />
      <rect x="2" y="8" width="1" height="1" fill="#fb9ed5" />
      <rect x="3" y="8" width="1" height="1" fill="#fd69b9" />
      <rect x="4" y="8" width="1" height="1" fill="#ff4888" />
      <rect x="5" y="8" width="1" height="1" fill="#ff2e4e" />
      <rect x="6" y="8" width="1" height="1" fill="#fd302d" />
      <rect x="7" y="8" width="1" height="1" fill="#fb7129" />
      <rect x="8" y="8" width="1" height="1" fill="#fb7129" />
      <rect x="9" y="8" width="1" height="1" fill="#f89b2a" />
      <rect x="10" y="8" width="1" height="1" fill="#f6ec8c" />
      <rect x="1" y="9" width="1" height="1" fill="#fb9ed5" />
      <rect x="2" y="9" width="1" height="1" fill="#fd69b9" />
      <rect x="3" y="9" width="1" height="1" fill="#ff4888" />
      <rect x="4" y="9" width="1" height="1" fill="#ff2e4e" />
      <rect x="5" y="9" width="1" height="1" fill="#fd302d" />
      <rect x="6" y="9" width="1" height="1" fill="#fd302d" />
      <rect x="7" y="9" width="1" height="1" fill="#ffbe96" />
      <rect x="8" y="9" width="1" height="1" fill="#f89b2a" />
      <rect x="9" y="9" width="1" height="1" fill="#f4c82a" />
      <rect x="10" y="9" width="1" height="1" fill="#e8ef54" />
      <rect x="11" y="9" width="1" height="1" fill="#e8ef54" />
      <rect x="2" y="10" width="1" height="1" fill="#fb9ed5" />
      <rect x="4" y="10" width="1" height="1" fill="#fd302d" />
      <rect x="5" y="10" width="1" height="1" fill="#fd302d" />
      <rect x="6" y="10" width="1" height="1" fill="#ffbe96" />
      <rect x="9" y="10" width="1" height="1" fill="#f6ec8c" />
      <rect x="10" y="10" width="1" height="1" fill="#e8ef54" />
      <rect x="11" y="10" width="1" height="1" fill="#e8ef54" />
      <rect x="4" y="11" width="1" height="1" fill="#fb7129" />
      <rect x="5" y="11" width="1" height="1" fill="#fb7129" />
      <rect x="6" y="11" width="1" height="1" fill="#ffbe96" />
      <rect x="3" y="12" width="1" height="1" fill="#ffbe96" />
      <rect x="4" y="12" width="1" height="1" fill="#fb7129" />
      <rect x="5" y="12" width="1" height="1" fill="#f89b2a" />
      <rect x="5" y="6" width="1" height="1" fill="#0a0a0a" />
      <rect x="6" y="6" width="1" height="1" fill="#ffffff" />
      <rect x="8" y="6" width="1" height="1" fill="#0a0a0a" />
      <rect x="9" y="6" width="1" height="1" fill="#ffffff" />
    </svg>
  );
}

// The same map as data, for the live mark. Keep in step with sol/design/ICON.md.
const MAP = ["..............", "..........bP..", ".....mF..bPH..", ".....mpbbPHb..", "......bCPHb...", "..GmbbCPHb.pp.", "..mbb#wH#wOAS.",
  "...bCPHEEOASL.", "..bCPHEOOAy...", ".bCPHEEpASLL..", "..b.EEp..yLL..", "....OOp.......", "...pOA........", ".............."];
export const LET: Record<string, RGB> = {
  H: [255, 46, 78], E: [253, 48, 45], P: [255, 72, 136], C: [253, 105, 185], O: [251, 113, 41], A: [248, 155, 42], S: [244, 200, 42],
  L: [232, 239, 84], F: [141, 201, 101], G: [112, 223, 69], b: [251, 158, 213], p: [255, 190, 150], y: [246, 236, 140], m: [206, 236, 178],
};
export const CELLS = MAP.flatMap((row, j) => [...row].map((ch, i) => ({ i, j, ch }))).filter((c) => c.ch !== ".");

// The live mark. Layers, back to front: the far half of the dust orbit (big only), the body, the eyes, the near half.
// Motion, all from the Life (Widget.tsx) and all drawn in whole cells: the hop and its landing squash, press squash,
// the flinch shake, the asleep settle (a cell lower), the breath (the head rises a cell, the row under it stretches),
// the ear twitch (one ear cell flicks up a cell), and the eyes: lid from the top, look, glance.
const EARS = [[11, 1], [10, 1]];
function MarkLive({ size, big, className }: { size: number; big: boolean; className?: string }) {
  const pad = big ? 0 : Math.ceil((size / 14) * 3); // the small one gets room above to hop into
  const me = useRef<Life | null>(null);
  // the small mark greets when the sidebar opens (a hop and a blink), once the rows have started to arrive
  useEffect(() => {
    if (big) return;
    const hello = () => { const l = me.current; if (l) window.setTimeout(() => { l.body.jump(0.7); l.blink = 0.12; }, 120); };
    window.addEventListener("sol-greet", hello);
    return () => window.removeEventListener("sol-greet", hello);
  }, [big]);
  return (
    <Creature life={me} className={`${big ? "mark-live" : "mark-small"} ${className ?? ""}`} watch={big} dustCell={Math.max(1, Math.round(size / 14))}
      style={big ? { width: size * 3, height: size * 2 } : { width: size, height: size + pad, marginTop: -pad }}
      setup={(l) => { l.idle = true; if (!big) l.maxDust = 0; /* the small one sheds nothing: it sits next to the word */ }}
      onPoke={(l) => { l.poke(); if (big) { l.shed(16, l.w / 2, l.h / 2, 1.2); poke(); } return true; }}
      transition={(l, _from, to) => {
        if (!l.fresh) return;
        if (to === "listening") l.twitch.vel = 22;                     // ears prick
        // the big one rings out a wave of cells when it changes: the answer to a tap, a call starting, an error
        if (big && (to === "listening" || to === "speaking" || to === "warn" || to === "attention" || to === "ok")) l.rippleAt = l.now + MOVES_RING_DELAY;
      }}
      draw={(l, x, w, h, t) => {
        const dpr = x.canvas.width / (w || 1), px = (v: number) => Math.round(v * dpr) / dpr;
        const cell = Math.max(1, Math.floor((size * dpr) / 14)) / dpr; // a whole number of device pixels
        // dust behind the creature on the far half of its orbit, in front on the near half
        const n = l.hover ? 14 : 6, R = (l.hover ? 42 : 36) * l.orb.v, oc = Math.max(1, Math.round(size / 14));
        const orbit = (front: boolean) => {
          if (!big) return;
          for (let k = 0; k < n; k++) {
            const a = l.orbA + k * ((Math.PI * 2) / n);
            if ((Math.sin(a) > 0) !== front) continue;
            const r = (R + Math.sin(t * 2 + k) * 4 * l.orb.v) * (size / 56);
            const ox = w / 2 + Math.cos(a) * r * 1.6, oy = h / 2 + Math.sin(a) * r * 0.6;
            x.fillStyle = rgba(tintAt(l.sliceAt(k, 0, k / n), (k / n) * 2 + l.flow), 0.5);
            x.fillRect(Math.round(ox / oc) * oc, Math.round(oy / oc) * oc, oc, oc);
          }
        };
        orbit(false);
        // squash: wider and shorter, standing on its feet; whole device pixels
        const sq = clamp(l.body.sq.v + l.press.v, -0.4, 0.6);
        const cw = Math.max(1 / dpr, px(cell * (1 + sq * 0.12))), ch = Math.max(1 / dpr, px(cell * (1 - sq * 0.15)));
        const feet = big ? h / 2 + 7 * cell : h - (size - 14 * cell) / 2;
        // small, listening and speaking show as motion too: it bobs a cell on the voice's peaks
        const voice = !big && (live.look === "listening" || live.look === "speaking") && live.env > 0.5 ? -1 : 0;
        const lift = l.body.cy - Math.round(l.settle.v) + voice; // cells, negative is up
        const ox = px(w / 2 - 7 * cw + (Math.round(l.shake.v) + Math.round(l.sway.v)) * cell + (big ? l.look.x * 3 : 0));
        const oy = px(feet - 14 * ch + lift * cell);
        const br = Math.round(l.breath.v), tw = Math.round(l.twitch.v), ear = EARS[l.twitchCell];
        for (const c of CELLS) {
          const col = c.ch === "#" || c.ch === "w" ? LET.b : LET[c.ch];
          x.fillStyle = rgba(col);
          let j = c.j;
          if (c.j <= 5) { // the head rises on the breath; row 5 stays too, so the body stretches rather than splits
            if (br && c.j === 5) x.fillRect(ox + c.i * cw, oy + j * ch, cw, ch);
            j -= br;
          }
          if (tw && c.i === ear[0] && c.j === ear[1]) j -= tw;
          x.fillRect(ox + c.i * cw, oy + j * ch, cw, ch);
        }
        const open = l.eyeOpen();
        if (open >= 0.3) {
          // the eyes: black then white, the lid coming down from the top, shifted toward what they look at
          const eh = Math.max(1 / dpr, px(ch * Math.min(1, open)));
          const dx = big ? px(l.look.x * cw * 0.4) : Math.abs(l.look.x) > 0.4 ? Math.sign(l.look.x) / dpr : 0;
          const dy = (big ? px(l.look.y * ch * 0.3) : l.look.y < -0.4 ? -1 / dpr : 0) + (ch - eh);
          for (const [i, col] of EYES) {
            x.fillStyle = col;
            x.fillRect(ox + i * cw + dx, oy + 6 * ch + dy, cw, eh);
          }
        }
        orbit(true);
        // the ring: cells on a wide ellipse, travelling out and dropping away in Bayer order (never fading)
        const rt = (l.now - l.rippleAt) / 900;
        if (big && rt > 0 && rt < 1) {
          const cnt = 40, e = 1 - (1 - rt) * (1 - rt) * (1 - rt), rr = (34 + 130 * e) * (size / 56);
          for (let k = 0; k < cnt; k++) {
            if (bayer(k & 3, (k >> 2) & 3) < rt * 1.15 - 0.1) continue;
            const a = (k / cnt) * Math.PI * 2 + 0.3;
            x.fillStyle = rgba(tintAt(live.slice, (k / cnt) * 2 + l.flow), 0.75);
            x.fillRect(Math.round((w / 2 + Math.cos(a) * rr * 1.5) / oc) * oc, Math.round((h / 2 + Math.sin(a) * rr * 0.7) / oc) * oc, oc * 2, oc * 2);
          }
        }
      }} />
  );
}
const MOVES_RING_DELAY = 90; // the ring leaves with the launch, not the anticipation
export const EYES = [[5, "#0a0a0a"], [6, "#fff"], [8, "#0a0a0a"], [9, "#fff"]] as const;
