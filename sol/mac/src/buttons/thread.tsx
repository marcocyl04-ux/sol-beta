import { ThreadPane } from "../work/ThreadPane";
import { Ink } from "./Ink";
import type { ButtonDef } from "./types";

const glyph = <Ink><path d="M1.5 4h5.5M7 4l2 0M7 4v1.5c0 2 1 3 3 3h2.5M9 4h3.5" /><rect x="11.5" y="3" width="2" height="2" fill="currentColor" stroke="none" /><rect x="11.5" y="7.5" width="2" height="2" fill="currentColor" stroke="none" /></Ink>;
// the thread map: on the bar only when the thread split (two writers went on), with the count of ends
export default {
  id: "thread", name: "thread map", kind: "pane", meant: ["home"], glyph,
  says: "when a talk forks, the map of every end it grew",
  shows: ({ session, shell: s }) => !!session && (s?.split ?? 0) > 1,
  where: "in a session split into threads",
  badge: ({ shell: s }) => <>{glyph}<span>{s!.split}</span></>,
  look: () => "barbtn wsplit",
  hover: ({ shell: s }) => `this thread split: ${s!.split} ends went on from one point (the thread map)`,
  Pane: ({ w, session, shell: s }) => session ? <ThreadPane key={session} w={w!} id={session} map={s!.tmap.map} err={s!.tmap.err} /> : null,
} satisfies ButtonDef;
