// Every Claude Code session on this machine, read through the SDK (listSessions reads ~/.claude/projects; nothing
// here writes it), grouped by the folder it works in. A side copy (a git worktree Sol made, copies.ts)
// files under its repo with a worktree tag. Syncthing brings the other machine's sessions too: a folder under another
// home (/Users/<x>/… on the Mac, /home/<x>/… on the NucBox) files under the same folder in this home, and the session
// carries the machine it ran on. A folder renamed or moved (state.ts moved, #129) keeps its sessions: a transcript still
// says the old place, and files under the new one. Scratch dirs drop out; a folder that is not here stays, marked gone,
// but a folder whose sessions are all gone drops out too unless the stale pref is on. A folder wears the name Marco gave it, if any.
import { existsSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { listSessions, getSessionMessages, type SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { workState, prefs, moved, type Marks } from "./state.js";
import { Items, type Item } from "./items.js";
import { copyOf } from "./copies.js";
import { heldElsewhere, type Holder } from "./holders.js";
import { lastSaid } from "./said.js";
import { inHome, machineOf, twinIn, type Machine } from "../home.js";

export type WorkSession = {
  id: string; title: string; cwd: string; project: string; worktree?: string; branch?: string; machine?: Machine;
  updatedAt: number; createdAt?: number; size?: number; tag?: string; gone?: boolean;
  held?: Holder;   // open in another live process (the Claude app, another Sol): read-only here
} & Marks;
export type Project = { path: string; name: string; count: number; added?: boolean; group?: string };   // group: the group the folder sits in
export type { Machine };
export { twinIn };

// the same folder in this machine's home
const local = (p: string) => twinIn(p, homedir());

// scratch folders (test fixtures, other sessions' scratchpads) stay out unless Marco adds one by hand
const SCRATCH = /^\/(private\/)?(tmp|var\/folders)\//;
// the Claude desktop app's scratch workspaces: scratch too, shown only with the stale pref (or added by hand)
const APP_SCRATCH = /\/Library\/Application Support\/Claude\/scratch-workspaces\//;
const there = new Map<string, boolean>();
const exists = (p: string) => { let v = there.get(p); if (v === undefined) { v = existsSync(p); there.set(p, v); } return v; };
// a folder renamed or moved (state.ts moved; sol/mine/live --rename writes it, #129): a path recorded in the old place,
// or under it, is the same path in the new one. The map is keyed by this home's paths; the twin goes through it after
const same = (p: string) => p;
export const movedTo = (map: Record<string, string>) => (p: string) => {
  for (const [from, to] of Object.entries(map)) if (p === from || p.startsWith(from + "/")) return to + p.slice(from.length);
  return p;
};
export const relocated = (p: string) => movedTo(moved())(p);

// the folder a session works in on this machine (One Sol, #62): its own, else the same folder in this home (a session
// the other machine made, its transcript brought by Syncthing), where it went if that folder moved (#129), else none
export const workFolderIn = (cwd: string, home: string, isDir: (p: string) => boolean, at: (p: string) => string = same) => {
  if (isDir(cwd)) return cwd;
  const t = at(twinIn(cwd, home));
  return t !== cwd && isDir(t) ? t : undefined;
};

// where Claude Code keeps a session's transcript: under ~/.claude/projects, in a folder named after its cwd. One from
// the other machine keeps its own folder name when it comes over Syncthing; if it was filed under this home instead,
// the next guess finds it; a folder that moved may keep its old name there (a move by hand) or wear the new one (live
// renames them), so both are tried (and a miss costs nothing: lastSaid falls back to the file's time).
const slug = (p: string) => p.replace(/[^A-Za-z0-9]/g, "-");
const transcript = (id: string, ...cwds: string[]) => {
  const guesses = [...new Set(cwds.flatMap((c) => (inHome(c) ? [c, local(c)] : [c])))].map((c) => join(homedir(), ".claude", "projects", slug(c), `${id}.jsonl`));
  return guesses.find((f) => existsSync(f)) ?? guesses[0];
};

// the SDK's list, kept until a transcript changes (the watcher below) or a write here invalidates; 10 s is the net under both
let cache: { at: number; list: SDKSessionInfo[] } | null = null;
async function all(): Promise<SDKSessionInfo[]> {
  if (cache && Date.now() - cache.at < 10_000) return cache.list;
  const list = await listSessions();
  cache = { at: Date.now(), list };
  return list;
}

export async function workSessions(): Promise<{ sessions: WorkSession[]; projects: Project[] }> {
  return fileSessions(await all());
}

// the SDK's list filed by folder, with Sol's marks, groups and names on it (no reading of ~/.claude here: tests feed it)
export function fileSessions(list: SDKSessionInfo[]): { sessions: WorkSession[]; projects: Project[] } {
  const st = workState(), stale = prefs().stale;
  const hidden = new Set(st.hidden), byHand = new Set(st.folders);
  let out: WorkSession[] = [];
  const counts = new Map<string, number>();
  const here = new Set<string>();   // folders with at least one session whose folder is still there
  const at = movedTo(st.moved ?? {});
  for (const s of list) {
    if (!s.cwd) continue;
    const cwd = at(s.cwd);   // a folder that moved: the session is in its new place (its transcript still says the old one)
    const w = copyOf(cwd);
    const marked = st.marks[s.sessionId]?.folder;   // Marco put it under another folder
    const project = marked || at(local(w ? w.repo : cwd));
    if ((SCRATCH.test(cwd) || (APP_SCRATCH.test(cwd) && !stale)) && !byHand.has(project)) continue;
    const gone = !workFolderIn(cwd, homedir(), exists, at);   // a removed side copy: the row stays (search, archive, fork, delete), marked
    if (hidden.has(project)) continue;
    if (!gone) here.add(project);
    counts.set(project, (counts.get(project) ?? 0) + 1);
    out.push({
      id: s.sessionId, title: s.customTitle || s.summary || s.firstPrompt || "untitled", cwd, project,
      ...(machineOf(cwd) ? { machine: machineOf(cwd) } : {}),
      ...(w ? { worktree: w.name } : {}), ...(gone ? { gone: true } : {}), ...(s.gitBranch ? { branch: s.gitBranch } : {}),
      // the row's time is the last message, not the file: the Claude app writes bookkeeping into idle transcripts (#45)
      updatedAt: lastSaid(transcript(s.sessionId, cwd, s.cwd), s.lastModified), createdAt: s.createdAt, size: s.fileSize, ...(s.tag ? { tag: s.tag } : {}),
      ...(st.marks[s.sessionId] ?? {}),
    });
    const h = heldElsewhere(s.sessionId);
    if (h) out[out.length - 1].held = h;
  }
  // a gone folder: every session in it gone and the folder itself not here; it stays only with the stale pref or by hand
  if (!stale) for (const p of [...counts.keys()]) if (!here.has(p) && !byHand.has(p) && !exists(p)) counts.delete(p);
  if (!stale) out = out.filter((s) => counts.has(s.project));
  for (const f of st.folders) if (!counts.has(f) && exists(f)) counts.set(f, 0);
  const added = new Set(st.folders);
  const groupOf = new Map<string, string>();
  for (const g of st.groups) for (const f of g.folders ?? []) groupOf.set(f, g.id);
  const names = new Map<string, number>();
  for (const p of counts.keys()) names.set(basename(p), (names.get(basename(p)) ?? 0) + 1);
  const nameOf = (p: string) => st.names?.[p] || (names.get(basename(p))! > 1 ? `${basename(dirname(p))}/${basename(p)}` : basename(p) || p);
  const projects = [...counts].map(([path, count]) => ({ path, name: nameOf(path), count, ...(added.has(path) ? { added: true } : {}), ...(groupOf.has(path) ? { group: groupOf.get(path) } : {}) }));
  return { sessions: out, projects };
}

// A run the list does not know yet (a fresh session: its transcript is not written, or not read, yet) shows at once as a
// row of its own, under its folder, with Sol's marks on it (#111). The SDK's row replaces it when the file is read.
export function withRuns(filed: { sessions: WorkSession[]; projects: Project[] }, runs: { sessionId: string; cwd: string; since?: number }[]) {
  const st = workState();
  const have = new Set(filed.sessions.map((s) => s.id));
  const sessions = [...filed.sessions], projects = [...filed.projects];
  for (const r of runs) {
    if (have.has(r.sessionId) || !r.cwd) continue;
    const w = copyOf(r.cwd);
    const project = st.marks[r.sessionId]?.folder || local(w ? w.repo : r.cwd);
    const at = r.since ?? Date.now();
    sessions.push({ id: r.sessionId, title: "new session", cwd: r.cwd, project, ...(w ? { worktree: w.name } : {}), updatedAt: at, createdAt: at, ...(st.marks[r.sessionId] ?? {}) });
    const i = projects.findIndex((x) => x.path === project);
    if (i >= 0) projects[i] = { ...projects[i], count: projects[i].count + 1 };
    else projects.push({ path: project, name: st.names?.[project] || basename(project) || project, count: 1 });
  }
  return { sessions, projects };
}

// the folder a session files under (its own, or the one Marco moved it to), and the topic groups there the model may
// pick from: those inside that folder that say what they are for
export function topicsFor(sessionId: string, cwd: string): { id: string; about: string }[] {
  const st = workState(), w = copyOf(cwd);
  const project = st.marks[sessionId]?.folder || relocated(local(w ? w.repo : cwd));
  return st.groups.filter((g) => g.in === project && g.about).map((g) => ({ id: g.id, about: g.about! }));
}

export function invalidate() { cache = null; there.clear(); }

// A session's transcript as items. Subagents' own steps are read on demand (the subagent pane).
export async function sessionItems(id: string): Promise<Items> {
  const items = new Items();
  const msgs = await getSessionMessages(id, { includeSystemMessages: true });
  for (const m of msgs) items.feed(m);
  items.settle(true);
  return items;
}
export const itemsOf = (x: Items): Item[] => x.list;

// the SDK's row, its folder where it is now if that folder moved (#129): a resume starts there
export async function sessionInfo(id: string) {
  const s = (await all()).find((s) => s.sessionId === id);
  return s?.cwd ? { ...s, cwd: relocated(s.cwd) } : s;
}

// ~/.claude/projects changes when any Claude Code session writes (Sol's, the desktop app's, a terminal's): the side
// list follows it, at most every 800 ms.
let watcher: FSWatcher | null = null;
export function watchSessions(changed: () => void) {
  if (watcher) return;
  let t: NodeJS.Timeout | undefined;
  try {
    watcher = watch(join(homedir(), ".claude", "projects"), { recursive: true }, (_e, name) => {
      if (name && !String(name).endsWith(".jsonl")) return;
      clearTimeout(t);
      t = setTimeout(() => { cache = null; changed(); }, 800);
    });
  } catch { /* no folder yet */ }
}
