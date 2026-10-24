// Work mode's own marks on Claude Code sessions: pinned, done, unread, archived, which group a session sits in, which
// session started which, folders Marco added by hand, the groups whole folders sit in, and the names he gave folders. Claude's transcripts stay Claude's (the SDK writes them);
// these marks are Sol's and live in one small JSON file outside the repo:
//   macOS  ~/Library/Application Support/com.marcol04.sol/work.json
//   Linux  ~/.local/share/sol/work.json
//   SOL_STATE=<file> overrides (a test engine uses its own).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";

export type Marks = {
  pinned?: boolean;
  done?: boolean;
  unread?: boolean;
  archived?: boolean;
  group?: string;     // a group id
  parent?: string;    // the session that started this one (a side session)
  seen?: number;      // when Marco last had it open (ms)
  failed?: boolean;   // its last turn failed (kept after the run closes)
  mode?: "life" | "work" | "cowork"; // the conversation's own mode: a Life conversation handed into Work says "work";
                          // one started from Cowork says "cowork" (Together #31: Work's side does not list it)
  card?: string;      // the proposal card (its tool call) this session was started from
  settled?: Record<string, string>;   // thread map ends already reconciled: an end's last entry -> "fold" | "fork:<id>" | "kept:<id>"
  moved?: string;     // its kept end went on in this session (reconcile could not write on here)
  folder?: string;    // shown under this folder instead of its own (its cwd stays as it is)
};
// folders: whole folders in it (one group each). in: a topic group inside that folder, holding that folder's sessions
// only (never folders). about: one line on what it is for, so a fresh session there can be filed in it by the model
export type Group = { id: string; name: string; at: number; folders?: string[]; in?: string; about?: string };
// Work's settings drawers (the ones the engine acts on; the face keeps its own pings and keys)
export type Prefs = {
  wtDir: string;        // where side copies go: "" = inside each repo, <repo>/.claude/worktrees
  prefix: string;       // on the branches Sol makes
  archivePr: boolean;   // archive a side copy's sessions once its pull request is merged or closed
  archiveDays: number;  // archive sessions untouched this many days (0 = never)
  browser: boolean;     // the model may drive the browser pane
  suggest: boolean;     // a suggested next prompt after each turn
  awake: boolean;       // keep the machine awake while a session works
  battery: boolean;     // ... on battery too
  style: string;        // the output style new runs start with ("" = Claude Code's default)
  stale: boolean;       // the side lists gone folders and the Claude app's scratch workspaces too
  newIn: string;        // the folder a fresh session starts in when none is picked ("" = the home folder)
};
export const PREFS: Prefs = { wtDir: "", prefix: "claude/", archivePr: false, archiveDays: 0, browser: true, suggest: true, awake: false, battery: false, style: "", stale: false, newIn: "" };
export type WorkState = {
  marks: Record<string, Marks>;
  groups: Group[];
  folders: string[];         // added by hand; shown even with no sessions
  hidden: string[];          // folders Marco took out of the side
  names: Record<string, string>;   // a folder's shown name, by path (none = its own name)
  order: string[];           // the side's top rows as Marco dragged them: "g:<group id>" or a folder's path (#73)
  prefs?: Partial<Prefs>;
  copies?: Record<string, string>;   // the side copies Sol made: folder → its repo
  moved?: Record<string, string>;    // folders renamed or moved: old path → where it is now (sol/mine/live --rename writes it, #129)
};

const FILE = process.env.SOL_STATE
  ?? (platform() === "darwin"
    ? join(homedir(), "Library", "Application Support", "com.marcol04.sol", "work.json")
    : join(homedir(), ".local", "share", "sol", "work.json"));

export const STATE_DIR = dirname(FILE); // attachments for Work sessions go under it too
let state: WorkState | null = null;

export function workState(): WorkState {
  if (state) return state;
  try {
    const v = JSON.parse(readFileSync(FILE, "utf8"));
    state = { marks: v.marks ?? {}, groups: v.groups ?? [], folders: v.folders ?? [], hidden: v.hidden ?? [], names: v.names ?? {}, order: Array.isArray(v.order) ? v.order.map(String) : [], prefs: v.prefs ?? {}, copies: v.copies ?? {}, moved: v.moved ?? {} };
  } catch {
    state = { marks: {}, groups: [], folders: [], hidden: [], names: {}, order: [] };
  }
  return state;
}

let timer: NodeJS.Timeout | undefined;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    mkdirSync(dirname(FILE), { recursive: true });
    const tmp = FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(state, null, 1));
    renameSync(tmp, FILE);
  }, 150);
}

const KEYS = ["pinned", "done", "unread", "archived", "group", "parent", "seen", "failed", "mode", "card", "moved", "folder"] as const;
export function mark(sessionId: string, patch: Partial<Record<keyof Marks, unknown>>) {
  const s = workState();
  const m = { ...(s.marks[sessionId] ?? {}) } as Record<string, unknown>;
  for (const k of KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === null || v === false || v === "" || v === undefined) delete m[k];
    else m[k] = k === "group" || k === "parent" || k === "card" || k === "moved" || k === "folder" ? String(v) : k === "seen" ? Number(v) : k === "mode" ? (v === "life" || v === "cowork" ? v : "work") : true;
  }
  if (patch.settled && typeof patch.settled === "object") m.settled = { ...(m.settled as object ?? {}), ...(patch.settled as Record<string, string>) };
  if (Object.keys(m).length) s.marks[sessionId] = m as Marks; else delete s.marks[sessionId];
  save();
}

export function forget(sessionId: string) {
  const s = workState();
  delete s.marks[sessionId];
  save();
}

// a folder sits in one group at most: putting it in one takes it out of the others
function moveFolder(s: WorkState, id: string | null, folder: string) {
  for (const x of s.groups) if (x.folders?.includes(folder)) { x.folders = x.folders.filter((p) => p !== folder); if (!x.folders.length) delete x.folders; }
  const g = id && s.groups.find((x) => x.id === id && !x.in);   // a topic group holds sessions only
  if (g) g.folders = [...(g.folders ?? []), folder];
}
const pathsIn = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : undefined);

const aboutOf = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 160);

export function groupOp(op: string, a: { id?: string | null; name?: string; sessions?: string[]; folders?: unknown; folder?: unknown; in?: unknown; about?: unknown }): string | undefined {
  const s = workState();
  if (op === "add") {
    let id = "g" + Date.now().toString(36);
    while (s.groups.some((x) => x.id === id)) id += "x";   // two made in the same millisecond
    const g: Group = { id, name: String(a.name || "group").slice(0, 60), at: Date.now() };
    if (a.in) g.in = String(a.in);
    if (aboutOf(a.about)) g.about = aboutOf(a.about);
    s.groups.push(g);
    for (const sid of a.sessions ?? []) mark(sid, { group: id });
    if (!g.in) for (const f of pathsIn(a.folders) ?? []) moveFolder(s, id, f);
    save();
    return id;
  }
  if (op === "move") {   // a folder into a group, or (id null) out of any
    const f = String(a.folder ?? "");
    if (!f) return;
    moveFolder(s, a.id ? String(a.id) : null, f);
    save();
    return a.id ?? undefined;
  }
  const g = s.groups.find((x) => x.id === a.id);
  if (!g) return;
  if (op === "rename") {
    g.name = String(a.name || g.name).slice(0, 60);
    if ("about" in a) { const t = aboutOf(a.about); if (t) g.about = t; else delete g.about; }
    if ("in" in a) { if (a.in) { g.in = String(a.in); for (const f of g.folders ?? []) moveFolder(s, null, f); } else delete g.in; }
    const fs = g.in ? undefined : pathsIn(a.folders);
    if (fs) { for (const f of g.folders ?? []) if (!fs.includes(f)) moveFolder(s, null, f); for (const f of fs) if (!g.folders?.includes(f)) moveFolder(s, g.id, f); }
  }
  else if (op === "delete") {
    s.groups = s.groups.filter((x) => x !== g);
    for (const [sid, m] of Object.entries(s.marks)) if (m.group === g.id) mark(sid, { group: null });
  }
  save();
  return g.id;
}

export function folderOp(op: string, path: string, name?: unknown) {
  const s = workState();
  if (!path) return;
  if (op === "add") { s.folders = [...new Set([...s.folders, path])]; s.hidden = s.hidden.filter((p) => p !== path); }
  else if (op === "hide") { s.hidden = [...new Set([...s.hidden, path])]; s.folders = s.folders.filter((p) => p !== path); }
  else if (op === "show") s.hidden = s.hidden.filter((p) => p !== path);
  else if (op === "name") {   // the folder's shown name; an empty one gives it its own name back
    const t = String(name ?? "").trim().slice(0, 60);
    s.names = { ...s.names };
    if (t) s.names[path] = t; else delete s.names[path];
  }
  save();
}

// the side's top rows in Marco's order: the list replaces the last one; a row not in it goes after, in the side's own rule
export function setOrder(keys: unknown): string[] {
  const s = workState();
  // a key is a group ("g:<id>") or a folder (an absolute path); anything else is not a row and is left out
  const isKey = (k: unknown): k is string => typeof k === "string" && (/^g:[^\s]+$/.test(k) || k.startsWith("/"));
  s.order = [...new Set(Array.isArray(keys) ? keys.filter(isKey).map((k) => k.slice(0, 1000)) : [])].slice(0, 500);
  save();
  return s.order;
}

export const prefs = (): Prefs => ({ ...PREFS, ...(workState().prefs ?? {}) });
// a change from the drawers: each value checked for its kind, anything else ignored
export function setPrefs(patch: Record<string, unknown>): Prefs {
  const s = workState(), p = { ...(s.prefs ?? {}) } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in PREFS)) continue;
    const kind = typeof PREFS[k as keyof Prefs];
    if (kind === "boolean") p[k] = !!v;
    else if (kind === "number") p[k] = Math.max(0, Math.min(365, Math.round(Number(v) || 0)));
    else {
      let t = String(v ?? "").trim();
      if (k === "wtDir" || k === "newIn") { t = t.replace(/^~(?=\/|$)/, homedir()); if (t && !t.startsWith("/")) throw new Error(k === "wtDir" ? "the side-copy folder must be a full path" : "the folder for new sessions must be a full path"); t = t.replace(/\/+$/, ""); }
      if (k === "prefix" && !/^(?![-/.])(?!.*\.\.)[\w./-]{0,40}$/.test(t)) throw new Error("a branch prefix is letters, digits, - _ . /");
      if (k === "style") t = t.slice(0, 80);
      p[k] = t;
    }
  }
  s.prefs = p as Partial<Prefs>;
  save();
  return prefs();
}
export const copies = (): Record<string, string> => workState().copies ?? {};
// a folder renamed or moved (#129): Claude's transcripts still say the old place, so sessions.ts files them under the new one
export const moved = (): Record<string, string> => workState().moved ?? {};
export function noteCopy(at: string, repo: string | null) {
  const s = workState(), c = { ...(s.copies ?? {}) };
  if (repo) c[at] = repo; else delete c[at];
  s.copies = c;
  save();
}
