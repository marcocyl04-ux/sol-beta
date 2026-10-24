import { TasksPane } from "../work/Panes";
import { Ink } from "./Ink";
import type { ButtonDef } from "./types";

export default {
  id: "tasks", name: "tasks", kind: "pane", meant: ["home"],
  shows: ({ shell }) => !!shell,
  where: "in a session",
  says: "the to-do list the session keeps for itself, ticked off as it goes",
  glyph: <Ink><path d="M5.5 3.5H12M5.5 7H12M5.5 10.5H12" /><path d="M1.8 3.4l.8.8 1.3-1.6M1.8 6.9l.8.8 1.3-1.6" /><circle cx="2.7" cy="10.5" r=".6" /></Ink>,
  Pane: ({ w, open, shell: s }) => <TasksPane items={s!.items} w={w!} onHelper={(id) => { s!.setHelper(id); open("helpers"); }} />,
} satisfies ButtonDef;
