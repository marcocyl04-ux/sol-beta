// The button (#132, docs/beta/PRD.md section 3): every feature with a special function is one file exporting one
// ButtonDef. Sol's own are in this folder, a person's own in sol/home/buttons (never committed); index.ts collects
// both. A pane opens on the right in the pane frame (work/Panes.tsx); a press does a thing.
import type { ReactNode } from "react";
import type { useEngine } from "../useEngine";
import type { Item, Work } from "../work/useWork";
import type { TalkView } from "../work/WorkSteps";
import type { PR } from "../work/Panes";
import type { FileAt } from "../work/FilePane";
import type { Page } from "../work/pages";
import type { useThreadMap } from "../work/ThreadPane";
import type { Browser } from "../Browser";
import type { Team } from "../cowork/useTeam";

export type Engine = ReturnType<typeof useEngine>;

export type ButtonDef = {
  id: string;                       // unique, kebab-case; a person's own are prefixed "my-"
  name: string;                     // what the shelf, the tab and the hover say: "changes"
  glyph: ReactNode | string;        // the 14 px ink glyph, or one or two words for a text button ("file it")
  says: string;                     // the description: one useful line; the hover when it has no `hover`
  meant: ("home" | "cowork" | "social")[];   // the mode it was made for; it may still go anywhere
  kind: "pane" | "press";           // a pane opens on the right; a press does a thing (file it, call Sol)
  Pane?: (c: ButtonCtx) => ReactNode;          // kind "pane", drawn as a component
  press?: (c: ButtonCtx) => void;   // kind "press"
  shows?: (c: ButtonCtx) => boolean;           // hidden when it means nothing here (PR with no PR); default: always
  where?: string;                   // where it shows, said when it does not here: "in a session" (#171)
  badge?: (c: ButtonCtx) => ReactNode;         // drawn in the glyph's place: changes' +/−, the thread's count, the PR's state
  key?: string;                     // its keyboard shortcut, kept from today, as the sheet writes it: "⌘⇧D", "⌃`"
  kept?: boolean;                   // a pane kept mounted while its tab is open (the terminal's shell, a draft comment)
  look?: (c: ButtonCtx) => string;  // its cell's classes on the bar, where today's look is its own (the PR's ticket)
  hover?: (c: ButtonCtx) => string; // the hover, where it says something live (the PR's title and checks)
  tab?: string;                     // the pane's tab, where it is not the name ("helper" for helpers)
  on?: (c: ButtonCtx) => boolean;   // a press that is a switch: lit, and pressed for a reader, while on (show to team)
  useOff?: () => boolean;           // a hook: true while it cannot be pressed (file it while the shot is taken)
  made?: { at: string; from?: string };   // a person's own: the day it was made ("2026-10-22") and the session it came from, by title
  bypassed?: string[];              // set by Sol's loader, never written: the design rules its file bypasses (sol/buttons/check)
};

export type ButtonCtx = {
  mode: string; session?: string; cwd?: string; e: Engine; w?: Work;
  open: (id: string) => void;       // shows a pane by its button's id
  flash: (s: string) => void;
  mark: Mark;                       // a piece of a page or the desk, into the open talk's box
  armed: boolean; setArmed: (v: boolean) => void;   // the browser: the next drag marks (cmd+shift+S)
  shell?: WorkShell;                // a session: what its talk holds that the panes show and feed
  team?: Team;                      // Cowork's team, handed to its views; elsewhere a team pane reads its own (buttons/Team.tsx)
  talk?: (to: Talk) => void;        // a talk onto the stage: a session, or a new one in a folder with words in its box
};
export type Talk = { session: string } | { cwd: string; text: string };
export type Mark = Parameters<typeof Browser>[0]["onMark"];

// a session's shell around the talk, handed to its buttons: the open session's items and state, and the ways back into
// the talk (the box, the file pane, the terminal)
export type WorkShell = {
  items: Item[]; busy: boolean; streaming: boolean; branch?: string;
  view: TalkView; cycleView: () => void;
  pages: Page[]; stat: { add: number; del: number } | null;
  pr: PR | null; prState: string; askPr: () => void; openUrl: (url: string) => void;
  fileAt: FileAt | null; toFile: (path: string, line?: number) => void; attach: (path: string) => void; toBox: (text: string) => void;
  termWant: { cwd: string; n: number } | null;
  helper: string | null; setHelper: (id: string | null) => void;
  tmap: ReturnType<typeof useThreadMap>; split: number;
};
