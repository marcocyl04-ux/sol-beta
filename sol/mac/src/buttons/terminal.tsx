import { TermPane } from "../work/TermPane";
import { Ink } from "./Ink";
import type { ButtonDef } from "./types";

// kept while another tab shows, so its shell and screen are kept
export default {
  id: "terminal", name: "terminal", kind: "pane", meant: ["home"], key: "⌃`", kept: true,
  shows: ({ shell }) => !!shell,
  where: "in a session",
  says: "a shell in this folder, no window switch",
  glyph: <Ink><path d="M2 3.5l3.5 3.5L2 10.5M7 11h5" /></Ink>,
  Pane: ({ w, e, cwd, shell: s }) => <TermPane w={w!} cwd={cwd} sub={e.subscribe} want={s!.termWant} />,
} satisfies ButtonDef;
