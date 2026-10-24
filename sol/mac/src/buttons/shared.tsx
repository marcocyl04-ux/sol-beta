import { SharedHere } from "../cowork/Shared";
import { WithTeam } from "./Team";
import type { ButtonDef } from "./types";

// shared with me (#36): the team's memory, designs and desk cards; one opens in the same pane, with a way back
export default {
  id: "shared", name: "shared with me", kind: "pane", meant: ["cowork"], glyph: "shared",
  says: "what the team wrote down, drew and made, from their repositories, never their homes",
  Pane: (c) => <WithTeam c={c}>{(team) => <SharedHere team={team} e={c.e} w={c.w} folders={team.board?.folders ?? {}} />}</WithTeam>,
} satisfies ButtonDef;
