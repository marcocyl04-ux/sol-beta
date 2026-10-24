import { Talk } from "../cowork/Talk";
import { WithTeam } from "./Team";
import type { ButtonDef } from "./types";

// the team's own talk, human to human (#37)
export default {
  id: "group-chat", name: "group chat", kind: "pane", meant: ["cowork"], glyph: "group chat",
  says: "the team talking, people only: say it here and it reaches everyone's Sol",
  Pane: (c) => <WithTeam c={c}>{(team) => <Talk team={team} flash={c.flash} />}</WithTeam>,
} satisfies ButtonDef;
