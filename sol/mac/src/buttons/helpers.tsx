import { HelperPane } from "../work/Panes";
import type { ButtonDef } from "./types";

export default {
  id: "helpers", name: "helpers", tab: "helper", kind: "pane", meant: ["home"], glyph: "helpers",
  shows: ({ shell }) => !!shell,
  where: "in a session",
  says: "a helper's own talk: the brief it got, every step it took, the report it gave back",
  Pane: ({ shell: s }) => <HelperPane key={s!.helper} items={s!.items} id={s!.helper} onPick={s!.setHelper} view={s!.view} />,
} satisfies ButtonDef;
