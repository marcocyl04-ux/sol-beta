import { PagePane } from "../work/PagePane";
import { Ink } from "./Ink";
import type { ButtonDef } from "./types";

// the page the session wrote (#54), kept while another tab shows so its pins stay
export default {
  id: "page", name: "page", kind: "pane", meant: ["home"], key: "⌘⇧P", kept: true,
  says: "the page this session wrote, live beside the talk",
  glyph: <Ink><rect x="1.5" y="2" width="11" height="10" rx="1.5" /><path d="M4 5h6M4 7.5h4" opacity=".5" /><circle cx="9.5" cy="9.5" r="1.8" fill="currentColor" stroke="none" /></Ink>,
  shows: ({ shell: s }) => !!s?.pages.length,
  where: "in a session that has pages",
  Pane: ({ w, e, cwd, shell: s }) => <PagePane w={w!} e={e} cwd={cwd} pages={s!.pages} onBox={s!.toBox} onFile={s!.toFile} />,
} satisfies ButtonDef;
