import { begin, useFile } from "../fileit";
import type { ButtonDef } from "./types";

// File it (#119): the press; the line over the composer and the store are FileLine.tsx and fileit.ts
export default {
  id: "file-it", name: "file it", kind: "press", meant: ["home", "cowork"], glyph: "file it",
  says: "something off? one line of yours becomes an issue, the window's picture attached",
  press: () => void begin(),
  useOff: () => { const f = useFile(); return f.shooting || f.filing; },
} satisfies ButtonDef;
