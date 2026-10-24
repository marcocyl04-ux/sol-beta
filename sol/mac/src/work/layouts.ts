// The sidebar's layouts (#133, docs/beta/PRD.md section 5): plain is one list; split is two halves, the folders above
// and the chats and pinned below; carousel is one section at a time, sideways. A layout only arranges the sections the
// sidebar has already worked out (WorkSidebar.tsx), in their order: it never adds, drops or sorts one, and the view
// (group, sort, show) is untouched. The one chosen is the person's arrangement's (layout.home, split.share).
export type Layout = "plain" | "split" | "carousel";
export const LAYOUTS: Layout[] = ["plain", "split", "carousel"];
export const asLayout = (v: unknown): Layout => (LAYOUTS.includes(v as Layout) ? (v as Layout) : "plain");
export const nextLayout = (l: Layout): Layout => LAYOUTS[(LAYOUTS.indexOf(l) + 1) % LAYOUTS.length];

const BELOW = new Set(["pinned", "chats"]);
export function parts<T extends { key: string }>(layout: Layout, sections: T[]): T[][] {
  if (layout === "split") return [sections.filter((s) => !BELOW.has(s.key)), sections.filter((s) => BELOW.has(s.key))];
  if (layout === "carousel") return sections.map((s) => [s]);
  return [sections];
}
