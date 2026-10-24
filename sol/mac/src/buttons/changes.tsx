import { DiffPane } from "../work/DiffPane";
import { Roll } from "../work/Show";
import { Ink } from "./Ink";
import type { ButtonDef } from "./types";

// the branch's changes; on the bar the lines added and taken, rolling as each edit lands
export default {
  id: "changes", name: "changes", kind: "pane", meant: ["home"], key: "⌘⇧D", kept: true,
  shows: ({ shell }) => !!shell,
  where: "in a session",
  says: "every line this session touched, before you trust it",
  glyph: <Ink><path d="M4 2.5v5M1.5 5h5M8 10.5h4.5" /><path d="M9.5 2.5l-5 9" opacity=".5" /></Ink>,
  badge: ({ shell: s }) => s?.stat && (s.stat.add || s.stat.del) ? <span className="wstat"><b>+<Roll n={s.stat.add} /></b> −<Roll n={s.stat.del} /></span> : null,
  look: () => "barbtn wpk",
  Pane: ({ w, cwd, shell: s }) => <DiffPane w={w!} cwd={cwd} busy={s!.busy} onFile={s!.toFile} onSend={s!.toBox} />,
} satisfies ButtonDef;
