import { ShowPane } from "../work/Show";
import { Ink } from "./Ink";
import type { ButtonDef } from "./types";

export default {
  id: "show", name: "the show", kind: "pane", meant: ["home"], key: "⌘⇧O",
  shows: ({ shell }) => !!shell,
  where: "in a session",
  says: "the session at work, drawn: the files it reads and writes light up as it goes",
  glyph: <Ink><path d="M2 11.5h10" /><rect x="5" y="4" width="4" height="4.5" rx=".6" /><path d="M3 9.5v2M11 9.5v2" opacity=".5" /></Ink>,
  Pane: ({ w, cwd, shell: s }) => <ShowPane items={s!.items} busy={s!.busy} streaming={s!.streaming} w={w!} cwd={cwd} stat={s!.stat} />,
} satisfies ButtonDef;
