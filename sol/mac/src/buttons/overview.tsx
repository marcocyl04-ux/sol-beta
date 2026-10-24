import { OverviewPane } from "../work/Overview";
import { Ink } from "./Ink";
import type { ButtonDef } from "./types";

export default {
  id: "overview", name: "overview", kind: "pane", meant: ["home"],
  shows: ({ shell }) => !!shell,
  where: "in a session",
  says: "what this session can see and reach: its context, its tools, its folder and what it made",
  glyph: <Ink><rect x="1.5" y="2" width="11" height="10" rx="1.8" /><path d="M4.2 5.2h.1M6.5 5.2h3.5M4.2 8.8h.1M6.5 8.8h3.5" /></Ink>,
  Pane: ({ w, e, cwd, open, shell: s }) => <OverviewPane w={w!} items={s!.items} cwd={cwd} branch={s!.branch} onUrl={s!.openUrl}
    onFile={(p) => s!.toFile(p)} send={e.send} onPr={() => { s!.askPr(); open("pr"); }} />,
} satisfies ButtonDef;
