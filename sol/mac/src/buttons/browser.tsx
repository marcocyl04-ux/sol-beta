import { Browser } from "../Browser";
import { Site } from "../Site";
import { Ink } from "./Ink";
import type { ButtonDef } from "./types";

// the open talk's tabs (the ones its seat opened for it, and the person's); a mark goes in the box
export default {
  id: "browser", name: "browser", kind: "pane", meant: ["home"], key: "⌘⇧B",
  says: "a browser beside the talk; drag over a page to hand Sol just that piece",
  glyph: <Ink><rect x="1.5" y="2.5" width="11" height="9" rx="1.5" /><path d="M1.5 5h11" /></Ink>,
  Pane: ({ e, session, armed, setArmed, mark }) => <Site name="browser"><Browser tabs={e.tabs} sessionId={session} send={e.send} subscribe={e.subscribeFrames}
    frac={1} onFrac={() => {}} maxFrac={1} armed={armed} onArmed={setArmed} onMark={mark} /></Site>,
} satisfies ButtonDef;
