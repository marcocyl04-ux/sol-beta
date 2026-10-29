// The room's first page (#234) gave way to the group's page (#314, Group.tsx). What stays here is what the pages it
// opened still draw: the creature's glyph for a kind of thing (the thing pane's head, the goal page, the tools, a person's
// page) and room.css, the grammar of those pages (rm-page, rm-thing, rm-convo, rm-gp-*, rm-ps-*).
import { GLYPHS, type Cell } from "./pixels";
import "./room.css";

/** a glyph of the creature's grammar: integer cells, crisp at any size */
export function Glyph({ kind, size = 56 }: { kind: string; size?: number }) {
  const cells: Cell[] = GLYPHS[kind] ?? GLYPHS.web;
  return <svg className="rm-glyph" viewBox="0 0 14 14" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">{cells.map(([x, y, w, h, f], i) => <rect key={i} x={x} y={y} width={w} height={h} fill={f} />)}</svg>;
}
