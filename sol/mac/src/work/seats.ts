// The folder says where a talk works, the switch says who does it (#182): what a pick on the seat switch (or a model
// of the other seat) does in Home's box. Pure, so it is tested (seats.test.ts); WorkApp.tsx acts on it.
export type Seat = "codex" | "claude";
export type Pick =
  | { kind: "same" }                          // the seat the talk is on: nothing to do
  | { kind: "new"; seat: Seat; cwd?: string } // nothing said yet: a new talk on that seat, in the folder (none: Sol's home)
  | { kind: "carry"; from: Seat; id: string }; // a talk under way: a new one on the other seat carries it on (work.switch)

/** a folder a talk can work in: "~" and none mean no folder */
export const folderIn = (c?: string | null) => (c && c !== "~" ? c : undefined);

/** a pick of `to` in a talk on `on`, in `cwd`, begun when it has an `id` */
export function seatPick(to: Seat, at: { on: Seat; id?: string | null; cwd?: string | null }): Pick {
  if (to === at.on) return { kind: "same" };
  if (at.id) return { kind: "carry", from: at.on, id: at.id };
  return { kind: "new", seat: to, cwd: folderIn(at.cwd) };
}
