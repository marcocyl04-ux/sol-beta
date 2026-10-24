// The shelf (#132): every button Sol has, and the person's own. Sol's are one file each here, added to the list below
// (the shape of cowork/tiles); a person's own are the files in sol/home/buttons, never committed, taken in by the glob:
// live on the hot face, at the next build on the bundled one. The bar draws buttons from here and names none itself.
import type { ButtonDef } from "./types";
import { loadOwn } from "./own";
import shipped from "./presets.json";
import overview from "./overview";
import changes from "./changes";
import terminal from "./terminal";
import files from "./files";
import page from "./page";
import tasks from "./tasks";
import plan from "./plan";
import helpers from "./helpers";
import pr from "./pr";
import browser from "./browser";
import show from "./show";
import thread from "./thread";
import fileIt from "./file-it";
import talkView from "./talk-view";
import showToTeam from "./show-to-team";
import desk from "./desk";
import call from "./call";
import review from "./review";
import dashboard from "./dashboard";
import actionBoard from "./action-board";
import groupChat from "./group-chat";
import shared from "./shared";

export type { ButtonDef, ButtonCtx, WorkShell, Mark, Talk } from "./types";

const SOL: ButtonDef[] = [overview, changes, terminal, files, page, tasks, plan, helpers, pr, browser, show, thread, fileIt, talkView, showToTeam, desk,
  call, review, dashboard, actionBoard, groupChat, shared];
// a missing or empty folder is no files; each file loads on its own, so one that does not is a line on the shelf (own.tsx)
const OWN = await loadOwn(import.meta.glob("../../../home/buttons/*.tsx"),
  import.meta.glob<string>("../../../home/buttons/*.tsx", { query: "?raw", import: "default", eager: true }), new Set(SOL.map((b) => b.id)));

export const OWN_BUTTONS = OWN.buttons;
export const OWN_BROKEN = OWN.broken;
export const SOL_BUTTONS = SOL;
export const BUTTONS: ButtonDef[] = [...SOL, ...OWN_BUTTONS];
const BY = new Map(BUTTONS.map((b) => [b.id, b]));
export const button = (id: string): ButtonDef | undefined => BY.get(id);

// The presets Sol ships (#132), a labelled set of buttons each; "|" is the thin line between keys. Build is Work's bar as it
// stood. They live in presets.json, the one file the engine reads too: the person's arrangement (engine/src/arrange.ts)
// starts from them, and the rail draws from them until the engine has said what the person's are.
export type Preset = { name: string; buttons: string[] };
export type RailDef = { presets: string[]; at?: string };
export const PRESETS: Record<string, Preset> = shipped.presets;
export const RAILS: Record<string, RailDef[]> = shipped.rails;
// The shelf's groups (#171): how the + panel and the menu sort every button. A person's own are always "Yours"; a button
// of Sol's not named here falls into Session, where most of them are.
export const GROUPS: { name: string; ids: string[] }[] = [
  { name: "Everyday", ids: ["call", "browser", "desk"] },
  { name: "Session", ids: ["overview", "changes", "terminal", "files", "page", "tasks", "plan", "helpers", "thread", "talk-view"] },
  { name: "Ship", ids: ["pr", "review", "show-to-team", "file-it", "show"] },
  { name: "Team", ids: ["dashboard", "action-board", "group-chat", "shared"] },
];
export function grouped(): { name: string; buttons: ButtonDef[] }[] {
  const named = new Set(GROUPS.flatMap((g) => g.ids));
  return [
    ...GROUPS.map((g) => ({ name: g.name, buttons: [...g.ids.map(button).filter((b): b is ButtonDef => !!b),
      ...(g.name === "Session" ? SOL.filter((b) => !named.has(b.id)) : [])] })),
    { name: "Yours", buttons: OWN_BUTTONS },
  ];
}
export type Usage = Record<string, { n: number; last: string }>;
// The ones to swap in (#171): the buttons pressed most (the press counter, usage.ts, kept in the arrangement), never
// one already on the preset nor one that would not show here; when fewer than `n` have been pressed, the ones made for
// this mode fill the list in shelf order.
export function mostUsed(usage: Usage | undefined, on: string[], mode: string, n = 5, shows: (b: ButtonDef) => boolean = () => true): { used: ButtonDef[]; more: ButtonDef[] } {
  const free = BUTTONS.filter((b) => !on.includes(b.id) && shows(b));
  const used = free.filter((b) => (usage?.[b.id]?.n ?? 0) > 0)
    .sort((x, y) => usage![y.id].n - usage![x.id].n || usage![y.id].last.localeCompare(usage![x.id].last)).slice(0, n);
  const more = free.filter((b) => !used.includes(b) && (b.meant as string[]).includes(mode)).slice(0, n - used.length);
  return { used, more };
}

// the panes the shelf sheet's foot opens without putting them on a rail (today's ⋮ list)
export const MORE = ["plan", "pr", "helpers", "browser", "page", "show", "thread", "action-board"];

// a button's key as the sheet writes it ("⌘⇧D", "⌃`") against a key pressed: cmd, ctrl and shift exactly as written
export function keyIs(ev: KeyboardEvent, key: string): boolean {
  const ch = key.replace(/[⌘⇧⌃]/g, "");
  if (ev.metaKey !== key.includes("⌘") || ev.ctrlKey !== key.includes("⌃") || ev.shiftKey !== key.includes("⇧")) return false;
  return ev.key.toLowerCase() === ch.toLowerCase() || (ch === "`" && ev.code === "Backquote");
}
// the same key in words, for a hover: "cmd+shift+D"
export const keyWords = (key: string) => key.replace("⌘", "cmd+").replace("⇧", "shift+").replace("⌃", "ctrl+");
