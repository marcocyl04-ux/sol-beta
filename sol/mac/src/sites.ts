// The map from a file of Sol's face to the part of the window it draws (issue #15). When the seat edits a file, the
// site it names gets the tape; when Vite lands the change, that site shimmers. Explicit on purpose, longest prefix
// wins; anything under mac/src not named here is the whole face (a shared module carries no "the rest is untouched"
// promise: motion.ts or face.css reach everything). design/ is the creature's.
// Part of the fence with Site.tsx, renovation.ts and hot.ts: the seat never edits these four (home/CLAUDE.md).

export type SiteName = "sidebar" | "composer" | "talk" | "browser" | "desk" | "settings" | "panes" | "notch" | "creature" | "face";

// paths relative to mac/src; a trailing "/" is a folder, a "*" one name part
const MAP: [string, SiteName][] = [
  ["sideFloat.ts", "sidebar"], ["ModeSwitch.tsx", "sidebar"], ["work/WorkSidebar.tsx", "sidebar"],
  ["work/Composer.tsx", "composer"], ["Picker.tsx", "composer"],
  ["Message.tsx", "talk"], ["LifeTalk.tsx", "talk"], ["Trail.tsx", "talk"], ["work/ThreadPane.tsx", "talk"], ["work/WorkTalk.tsx", "talk"], ["work/WorkSteps.tsx", "talk"], ["work/Cards.tsx", "desk"],
  ["Browser.tsx", "browser"],
  ["Desk.tsx", "desk"],
  ["Settings.tsx", "settings"], ["work/WorkSettings.tsx", "settings"],
  ["work/Panes.tsx", "panes"], ["work/*Pane.tsx", "panes"], ["work/Show.tsx", "panes"], ["work/Overview.tsx", "panes"], ["work/Diff.tsx", "panes"], ["work/Split.tsx", "panes"],
  ["notch/", "notch"],
  ["creature/", "creature"], ["Mark.tsx", "creature"],
];
const glob = (pat: string) => new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
const RULES = MAP.map(([pat, site]) => ({ pat, site, len: pat.replace("*", "").length, test: pat.endsWith("/") ? (f: string) => f.startsWith(pat) : ((re) => (f: string) => re.test(f))(glob(pat)) }))
  .sort((a, b) => b.len - a.len);

// "mac/src/Sidebar.tsx" (the engine's), "/src/Sidebar.tsx" (Vite's), an absolute path, or "design/..." → its site;
// null for a file that is not part of the face at all
export function siteOf(file: string): SiteName | null {
  const f = file.replace(/\\/g, "/").replace(/\?.*$/, "");
  if (/(^|\/)design\//.test(f) && !/\/mac\/src\//.test(f)) return "creature";
  const m = /(?:^|\/)(?:mac\/)?src\/(.+)$/.exec(f);
  if (!m) return null;
  const rel = m[1];
  for (const r of RULES) if (r.test(rel)) return r.site;
  return "face";
}

// how the site is called in a line ("the sidebar", "the whole face")
export const SITE_WORDS: Record<SiteName, string> = {
  sidebar: "the sidebar", composer: "the box", talk: "the talk", browser: "the browser", desk: "the desk", settings: "settings",
  panes: "the panes", notch: "the notch", creature: "the creature", face: "the whole face",
};
