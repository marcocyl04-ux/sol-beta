import { PlanPane } from "../work/Panes";
import type { ButtonDef } from "./types";

export default {
  id: "plan", name: "plan", kind: "pane", meant: ["home"], glyph: "plan",
  shows: ({ shell }) => !!shell,
  where: "in a session",
  says: "the plan before the work: read what it means to do, then let it",
  Pane: ({ shell: s }) => <PlanPane items={s!.items} />,
} satisfies ButtonDef;
