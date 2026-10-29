import { Sol } from "./Sol";
import type { RGB } from "./creature/ring";

// Sol's mark: the flat splat (Sol.tsx, from sol/design/sol.svg, 2026-10-26). Small (the sidebar, 22 px) it breathes and
// blinks and follows the creature's state; `live` (the empty state, 56 px) it also watches the pointer and can be poked.
// The pixel creature's cell map stays below for the places that still draw it (the notch crew, Show, Bead, Person).
// The vibe switch is Sol in the seat scene at the top of the sidebar (SeatScene.tsx, vibe.ts), not this mark.
export function Mark({ size = 22, className, live: alive }: { size?: number; className?: string; live?: boolean }) {
  return <Sol size={size} watch={!!alive} className={`${alive ? "mark-live" : "mark-small"} ${className ?? ""}`} />;
}

// The same map as data, for the live mark. Keep in step with sol/design/ICON.md.
const MAP = ["..............", "..........bP..", ".....mF..bPH..", ".....mpbbPHb..", "......bCPHb...", "..GmbbCPHb.pp.", "..mbb#wH#wOAS.",
  "...bCPHEEOASL.", "..bCPHEOOAy...", ".bCPHEEpASLL..", "..b.EEp..yLL..", "....OOp.......", "...pOA........", ".............."];
export const LET: Record<string, RGB> = {
  H: [255, 46, 78], E: [253, 48, 45], P: [255, 72, 136], C: [253, 105, 185], O: [251, 113, 41], A: [248, 155, 42], S: [244, 200, 42],
  L: [232, 239, 84], F: [141, 201, 101], G: [112, 223, 69], b: [251, 158, 213], p: [255, 190, 150], y: [246, 236, 140], m: [206, 236, 178],
};
export const CELLS = MAP.flatMap((row, j) => [...row].map((ch, i) => ({ i, j, ch }))).filter((c) => c.ch !== ".");

export const EYES = [[5, "#0a0a0a"], [6, "#fff"], [8, "#0a0a0a"], [9, "#fff"]] as const;
