import { Dashboard } from "../cowork/Dashboard";
import { WithTeam } from "./Team";
import type { ButtonDef } from "./types";

// the board, read: the tracker as columns and across the weeks, the team's tiles under it
export default {
  id: "dashboard", name: "dashboard", kind: "pane", meant: ["cowork"], glyph: "dashboard",
  says: "where everything the team is doing stands, and since when, at a glance",
  Pane: (c) => <WithTeam c={c}>{(team) => <Dashboard team={team} issue={c.shell ? c.w?.run?.issue : undefined} />}</WithTeam>,
} satisfies ButtonDef;
