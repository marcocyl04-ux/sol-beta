import { Desk } from "../Desk";
import { Site } from "../Site";
import { Ink } from "./Ink";
import type { ButtonDef } from "./types";

// the desk (#9): cards the chat's seat makes on the fly; what is done on one reaches it with the next message
export default {
  id: "desk", name: "desk", kind: "pane", meant: ["home"],
  shows: ({ shell }) => !shell,
  where: "outside a session",
  says: "a study space beside the chat: notes, flashcards, a timer, a page of a PDF, made while you talk",
  glyph: <Ink><rect x="1.5" y="3" width="11" height="8.5" rx="1.5" /><path d="M4.5 7.5h5" /></Ink>,
  Pane: ({ e, mark }) => <Site name="desk"><Desk cards={e.desk} act={e.deskAct} busy={e.busy} frac={1} onFrac={() => {}} maxFrac={1} onMark={mark} /></Site>,
} satisfies ButtonDef;
