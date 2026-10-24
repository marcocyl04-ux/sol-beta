import { FilePane } from "../work/FilePane";
import { Ink } from "./Ink";
import type { ButtonDef } from "./types";

export default {
  id: "files", name: "files", kind: "pane", meant: ["home"], kept: true,
  shows: ({ shell }) => !!shell,
  where: "in a session",
  says: "the folder's files beside the talk: read one, or hand it to the box",
  glyph: <Ink><path d="M3 1.5h5l3 3v8H3z" /><path d="M8 1.5v3h3" /></Ink>,
  Pane: ({ w, cwd, flash, shell: s }) => <FilePane w={w!} cwd={cwd} at={s!.fileAt} onAttach={s!.attach} flash={flash} />,
} satisfies ButtonDef;
