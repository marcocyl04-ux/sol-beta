import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SeatScene } from "../SeatScene";
import type { AppMode } from "../ModeSwitch";
import { ModeWheel } from "../ModeWheel";
import { CFG, enter, useSpring } from "../motion";
import { LAYOUTS, asLayout, nextLayout, parts, type Layout } from "./layouts";
import { useSideFloat } from "../sideFloat";
import { Fold, Pill, Turn } from "../MotionKit";
import { CellCheck, Runner } from "../creature/indicators";
import { working, type Group, type Project, type RunInfo, type Work, type WorkSession } from "./useWork";
import { Menu, type MenuItem } from "./Menu";
import { span, useNow } from "./Elapsed";
import { Unseen } from "../Site";
import { WHICH, type Thread } from "../useEngine";
import { useTalksWaiting } from "../Conversations";

// Home's side (#132): every Claude Code session on this machine, under the folder it ran in, and below them the chats
// (Life's conversations, in no folder). Pinned on top, then Marco's own groups, then the folders (or dates, or states). A row says its state with one mark: the runner while Claude
// works, a glow dot when it waits for Marco, an ember dot when it failed, an ink dot when it finished unseen, a check
// when he marked it done. Right-click for everything else; drag a row onto a group to move it there. A whole folder
// can go in a group too (drag its title): it sits inside the group, folded with it. A folder can hold topic groups of
// its own sessions, and a session can be dropped on another folder to be shown there. The top rows (groups, and folders in
// no group) go in the order Marco drags them to: a line above or below the row says where one lands (#73).
// Sessions started from Cowork sit last, under "cowork", one fold per Cowork group by its name (#314): both sides list
// them. They stay where Cowork files them: no drag moves one into a folder or a group of Home's.

type GroupBy = "project" | "date" | "state" | "none";
type SortBy = "recent" | "alpha" | "created";
type Status = "active" | "archived" | "all";
type View = { by: GroupBy; sort: SortBy; status: Status };
const VIEW0: View = { by: "project", sort: "recent", status: "active" };
const loadView = (): View => { try { return { ...VIEW0, ...JSON.parse(localStorage.getItem("sol.work.view") ?? "{}") }; } catch { return VIEW0; } };
const SHOW = 6; // rows a folder shows before "more"
const baseOf = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
// a file a rename listed: inside the folder from its own name on, else from the home folder (~)
const shortPath = (f: string, dir: string) => (f.startsWith(dir + "/") ? baseOf(dir) + f.slice(dir.length) : f.replace(/^\/(Users|home)\/[^/]+/, "~"));

// who holds a session open elsewhere (the lock): one writer per transcript, so here it is read-only
export const HELD: Record<string, string> = { desktop: "the Claude app", sol: "Sol", "sol-other": "another Sol", terminal: "a terminal", other: "another Claude" };
const HELD_SHORT: Record<string, string> = { desktop: "app", sol: "sol", "sol-other": "other sol", terminal: "terminal", other: "elsewhere" };
// a session from the other machine (Syncthing brings its transcripts) wears that machine's name; the engine's own go bare
const HERE = WHICH === "live" ? "nucbox" : "mac";
const MACHINE: Record<string, string> = { mac: "the Mac", nucbox: "the NucBox" };
const away = (s: WorkSession) => !!s.machine && s.machine !== HERE;   // its folder is there, not gone: not struck through

export type RowState = "running" | "needs" | "failed" | "unread" | "done" | "";
export const rowState = (s: WorkSession, r?: RunInfo): RowState =>
  r?.waiting ? "needs" : working(r) || s.running ? "running" : (r ? r.failed : s.failed) ? "failed" : s.unread ? "unread" : s.done ? "done" : "";

const age = (t: number) => {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const dayBucket = (t: number) => {
  const d = new Date(t), n = new Date();
  const start = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  if (t >= start) return "today";
  if (t >= start - 86400e3) return "yesterday";
  if (t >= start - 6 * 86400e3) return "this week";
  if (d.getFullYear() === n.getFullYear()) return d.toLocaleDateString(undefined, { month: "long" });
  return String(d.getFullYear());
};
const STATE_ORDER: [RowState | "rest", string][] = [["needs", "needs you"], ["running", "running"], ["failed", "failed"], ["unread", "finished, unseen"], ["rest", "the rest"], ["done", "done"]];

// ---- glyphs ----
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Plus = () => <svg viewBox="0 0 16 16" width="14" height="14" {...P} aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>;
// two speech marks: the talks Anticipate heard (Conversations)
const Talks = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2.5 3.5h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H6l-2.5 2v-2h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z" /><path d="M12.5 6h1a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1v2L10 12H7.5" />
  </svg>
);
const Gear = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" {...P} aria-hidden="true">
    <circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3" />
  </svg>
);
const Lens = () => <svg viewBox="0 0 16 16" width="14" height="14" {...P} aria-hidden="true"><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></svg>;
const Sliders = () => <svg viewBox="0 0 16 16" width="14" height="14" {...P} aria-hidden="true"><path d="M3 5h10M3 11h10" /><circle cx="6" cy="5" r="1.6" fill="var(--knob, var(--side))" /><circle cx="10.5" cy="11" r="1.6" fill="var(--knob, var(--side))" /></svg>;
const Folder = () => <svg className="fic" viewBox="0 0 16 16" width="12" height="12" {...P} aria-hidden="true"><path d="M1.5 4V13h13V5.5H7.5L6 4z" /></svg>;
const Box = () => <svg viewBox="0 0 16 16" width="12" height="12" {...P} aria-hidden="true"><path d="M2.5 5h11v8.5h-11zM1.5 2.5h13V5h-13zM6.5 8h3" /></svg>;
const Caret = () => <svg className="caret" viewBox="0 0 6 6" width="6" height="6" shapeRendering="crispEdges" aria-hidden="true"><path d="M1 0h2v1h1v1h1v2h-1v1h-1v1h-2z" fill="currentColor" /></svg>;
// the layout button's glyph: a small picture of the layout it shows (one column, two halves, three cards), never a gear
const LayGlyph = ({ l }: { l: Layout }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" {...P} aria-hidden="true">
    {l === "plain" ? <><rect x="4" y="2" width="8" height="12" rx="1.5" /><path d="M6.5 5.5h3M6.5 8h3M6.5 10.5h3" /></>
      : l === "split" ? <><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M2.5 8h11" /></>
      : <><rect x="5" y="2.5" width="6" height="11" rx="1.2" /><path d="M2 4.5v7M14 4.5v7" /></>}
  </svg>
);
const LAY_SAYS: Record<Layout, string> = { plain: "one list", split: "two halves: folders above, chats and pinned below", carousel: "one section at a time, sideways" };
const Branch = () => <svg viewBox="0 0 12 12" width="10" height="10" {...P} aria-hidden="true"><circle cx="3.5" cy="2.5" r="1.3" /><circle cx="3.5" cy="9.5" r="1.3" /><circle cx="8.5" cy="4" r="1.3" /><path d="M3.5 3.8v4.4M8.5 5.3c0 2-5 1.5-5 3" /></svg>;

function StateMark({ st }: { st: RowState }) {
  if (st === "running") return <span className="wst run"><Runner /></span>;
  if (st === "done") return <span className="wst done"><CellCheck /></span>;
  return <span className={`wst ${st}`}><i /></span>;
}

type Section = {
  key: string; label: string; rows: WorkSession[]; project?: Project; group?: Group; drop?: (id: string) => void;
  folders?: Section[]; dropFolder?: (path: string) => void;   // a group's folders, nested in it; a folder dropped on it
  topics?: Section[];   // a folder's topic groups, nested in it
  top?: string;   // a top row's key in work.order ("g:<id>" or the folder's path): it can be dragged above or below another
};

// the chats: Life's threads, both seats; active is the one showing (undefined while a session shows). A Claude one
// that went to Work lists there, as a session. Pinned is this face's own (the engine keeps no pin for a chat).
export type Chats = { threads: Thread[]; active?: string | null; onOpen: (t: Thread) => void; onNew: () => void; onRename: (t: Thread, title: string) => void };
const ms = (t: number | string) => (typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : Date.parse(t) || 0);
const CHAT_PINS = "sol.home.chatpins";

// the layout and the split's share, from the person's arrangement, and the way to change them (arrange.set)
export type Lay = { layout?: string; share?: number; arrange: (patch: object) => void };

export function WorkSidebar({ w, pinned, view: page, onMode, onSettings, onConversations, onFresh, menuHold, onBeside, onPop, chats, lay }: {
  w: Work; pinned: boolean; view: "chat" | "settings" | "conversations"; onMode: (m: AppMode) => void; onSettings: () => void; onConversations: () => void;
  onFresh: (cwd?: string) => void; menuHold?: boolean; onBeside: (id: string) => void; onPop: (id: string, title: string) => void; chats?: Chats; lay?: Lay;
}) {
  const [pins, setPins] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem(CHAT_PINS) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } });
  const pin = (id: string) => setPins((p) => { const n = p.includes(id) ? p.filter((x) => x !== id) : [id, ...p]; localStorage.setItem(CHAT_PINS, JSON.stringify(n)); return n; });
  const [view, setView] = useState<View>(loadView);
  const waiting = useTalksWaiting();   // talks not opened yet, from this Mac's engine: the dot on conversations
  const setV = (p: Partial<View>) => setView((v) => { const n = { ...v, ...p }; localStorage.setItem("sol.work.view", JSON.stringify(n)); return n; });
  const [q, setQ] = useState("");
  const [folded, setFolded] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("sol.work.folded") ?? "{}"); } catch { return {}; } });
  const fold = (k: string) => setFolded((f) => { const n = { ...f, [k]: !f[k] }; localStorage.setItem("sol.work.folded", JSON.stringify(n)); return n; });
  const [more, setMore] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);   // the top row being dragged, by its order key
  const [line, setLine] = useState<{ key: string; at: "above" | "below" } | null>(null);
  // what a folder rename said (#181), under that folder, quietly, a while: the reason it was refused, or that it went
  // through and which files still say the old name (a click lists them)
  const [said, setSaid] = useState<{ path: string; text: string; files?: string[]; open?: boolean } | null>(null);
  const saidTimer = useRef<number | undefined>(undefined);
  const say = (x: typeof said, ms = 12_000) => { window.clearTimeout(saidTimer.current); setSaid(x); if (x) saidTimer.current = window.setTimeout(() => setSaid(null), ms); };
  const renameFolder = (p: Project, name: string) => {
    say({ path: p.path, text: `renaming to ${name}…` }, 60_000);
    void w.renameFolder(p.path, name).then((r) => {
      if (r.error || !r.to) return say({ path: p.path, text: r.error ?? "the engine said nothing" });
      const n = r.mentioned ?? 0, old = baseOf(p.path);
      say({ path: r.to, text: `renamed on the disk${n ? ` · ${n} ${n === 1 ? "file still says" : "files still say"} ${old}` : ""}`, files: r.mentions }, n ? 30_000 : 8000);
    });
  };
  const searchRef = useRef<HTMLInputElement>(null);
  // the layout (#133): the arrangement's, held here from a press until the engine writes it back (kept if it is away)
  const [went, setWent] = useState<{ layout?: Layout; share?: number }>({});
  useEffect(() => setWent({}), [lay?.layout, lay?.share]);
  const layout = went.layout ?? asLayout(lay?.layout), share = went.share ?? lay?.share ?? 0.5;
  const [picking, setPicking] = useState(false);
  const setLayout = (l: Layout) => { setWent((x) => ({ ...x, layout: l })); setPicking(false); lay?.arrange({ layout: { home: l } }); };
  const f = useSideFloat(pinned, editing !== null || !!menu || !!menuHold || !!q || picking, 272);

  // cmd+F (while the side is open) and cmd+shift+F search the sessions
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (ev.metaKey && ev.shiftKey && ev.key.toLowerCase() === "f") { ev.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const runs = w.runs;
  const now = useNow(Object.values(runs).some((r) => !!r?.since));   // the running rows' clocks tick
  // a session started from Cowork lists in Cowork and here too (#314, the groups PRD §7.1; Together #31 kept it out):
  // here only under the "cowork" fold, by its group's name, never in a folder, so Home's folders read as before
  const shows = (s: WorkSession) => (view.status === "all" ? true : view.status === "archived" ? !!s.archived : !s.archived);
  const visible = useMemo(() => w.sessions.filter((s) => s.mode !== "cowork" && shows(s)), [w.sessions, view.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const cowork = useMemo(() => w.sessions.filter((s) => s.mode === "cowork" && shows(s)), [w.sessions, view.status]); // eslint-disable-line react-hooks/exhaustive-deps
  // a session at work sorts by when the work began, not by its transcript's last write: that moved with every list the
  // engine sent during a reply, and the rows changed places about three times per answer. It moves once, as it starts.
  const sortAt = (s: WorkSession) => { const r = runs[s.id]; return working(r) && r?.since ? r.since : s.updatedAt; };
  const sorter = useMemo(() => {
    if (view.sort === "alpha") return (a: WorkSession, b: WorkSession) => (a.title || "").localeCompare(b.title || "");
    if (view.sort === "created") return (a: WorkSession, b: WorkSession) => (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt);
    return (a: WorkSession, b: WorkSession) => sortAt(b) - sortAt(a);
  }, [view.sort, runs]); // eslint-disable-line react-hooks/exhaustive-deps

  // side sessions sit under the one that started them, when that one is in the list too; a side session Marco
  // pinned or put in a group himself goes where he put it
  const ids = new Set(visible.map((s) => s.id));
  const nests = (s: WorkSession) => !!s.parent && s.parent !== s.id && ids.has(s.parent) && !s.pinned && !s.group;
  const kids = new Map<string, WorkSession[]>();
  for (const s of visible) if (nests(s)) kids.set(s.parent!, [...(kids.get(s.parent!) ?? []), s]);
  const top = visible.filter((s) => !nests(s));

  const sections: Section[] = [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const hits = [...visible, ...cowork].filter((s) => words.every((x) => `${s.title} ${s.cwd} ${s.branch ?? ""}`.toLowerCase().includes(x))).sort(sorter);
    sections.push({ key: "search", label: hits.length ? `${hits.length} found` : "nothing found", rows: hits });
  } else {
    const pinnedRows = top.filter((s) => s.pinned).sort(sorter);
    sections.push({ key: "pinned", label: "pinned", rows: pinnedRows, drop: (id) => w.mark(id, { pinned: true }) });
    const rest = top.filter((s) => !s.pinned);
    const loose = rest.filter((s) => !s.group || !w.groups.some((g) => g.id === s.group));
    // by folder, a group holds its folders too (nested, folded with it); the other views list sessions only
    const byP = new Map<string, WorkSession[]>();
    for (const s of loose) byP.set(s.project, [...(byP.get(s.project) ?? []), s]);
    const latest = (p: Project) => Math.max(0, ...(byP.get(p.path) ?? []).map(sortAt));
    // a session dropped on a folder (or a topic group in it) is shown under that folder from then on
    const toFolder = (id: string, path: string, group: string | null) => {
      const s = w.sessions.find((x) => x.id === id);
      w.mark(id, { group, ...(s && s.project !== path ? { folder: path } : {}) });
    };
    const topicSec = (g: Group): Section => ({ key: "g:" + g.id, label: g.name, group: g, rows: rest.filter((s) => s.group === g.id).sort(sorter), drop: (id) => toFolder(id, g.in!, g.id) });
    const folderSec = (p: Project): Section => ({
      key: "p:" + p.path, label: p.name, project: p, rows: (byP.get(p.path) ?? []).sort(sorter), drop: (id) => toFolder(id, p.path, null),
      topics: w.groups.filter((g) => g.in === p.path).map(topicSec),
    });
    const inGroup = (p: Project) => view.by === "project" && !!p.group && w.groups.some((g) => g.id === p.group);
    const folders = [...w.projects].sort((a, b) => latest(b) - latest(a));
    // a topic group sits in its folder by folder; in the other views (or when its folder is not listed) it is a group of its own
    const nestsIn = (g: Group) => view.by === "project" && !!g.in && w.projects.some((p) => p.path === g.in);
    // the top rows: the ones Marco ordered first, in his order; the rest after them, groups first, then folders by last activity
    const tops: Section[] = [];
    for (const g of w.groups) if (!nestsIn(g)) tops.push({
      key: "g:" + g.id, top: "g:" + g.id, label: g.name, group: g, rows: rest.filter((s) => s.group === g.id).sort(sorter), drop: (id) => w.mark(id, { group: g.id }),
      ...(g.in ? {} : { folders: folders.filter((p) => inGroup(p) && p.group === g.id).map(folderSec), dropFolder: (path: string) => w.group("move", { id: g.id, folder: path }) }),
    });
    if (view.by === "project") for (const p of folders) if (!inGroup(p)) tops.push({ ...folderSec(p), top: p.path });
    const rank = (x: Section) => { const i = w.order.indexOf(x.top!); return i < 0 ? w.order.length : i; };
    sections.push(...tops.sort((a, b) => rank(a) - rank(b)));
    if (view.by === "date") {
      const order: string[] = [];
      const by = new Map<string, WorkSession[]>();
      for (const s of [...loose].sort((a, b) => sortAt(b) - sortAt(a))) {
        const k = dayBucket(s.updatedAt);
        if (!by.has(k)) { by.set(k, []); order.push(k); }
        by.get(k)!.push(s);
      }
      for (const k of order) sections.push({ key: "d:" + k, label: k, rows: by.get(k)!.sort(sorter) });
    } else if (view.by === "state") {
      for (const [st, label] of STATE_ORDER) {
        const rows = loose.filter((s) => { const r = rowState(s, runs[s.id]); return st === "rest" ? r === "" : r === st; }).sort(sorter);
        sections.push({ key: "s:" + st, label, rows });
      }
    } else if (view.by === "none") sections.push({ key: "all", label: "sessions", rows: [...loose].sort(sorter) });
    // the cowork fold (#314): one fold inside it per Cowork group, by name ("groups" here are Home's own); a session of
    // a group I left says so
    const byRoom = new Map<string, WorkSession[]>();
    for (const s of cowork) byRoom.set(s.roomId ?? "", [...(byRoom.get(s.roomId ?? "") ?? []), s]);
    const roomName = (id: string) => (id ? w.roomNames[id] ?? "a group you left" : "no group");
    const rooms = [...byRoom.keys()].sort((a, b) => Math.max(...byRoom.get(b)!.map((s) => s.updatedAt)) - Math.max(...byRoom.get(a)!.map((s) => s.updatedAt)));
    if (rooms.length) sections.push({ key: "rooms", label: "cowork", rows: [], topics: rooms.map((id) => ({ key: "room:" + id, label: roomName(id), rows: byRoom.get(id)!.sort(sorter) })) });
  }

  const chatRows = (chats?.threads ?? []).filter((t) => !(t.moved && t.seat === "claude") && words.every((x) => (t.title || "").toLowerCase().includes(x)))
    .sort((a, b) => (+pins.includes(b.sessionId) - +pins.includes(a.sessionId)) || ms(b.updatedAt) - ms(a.updatedAt));
  const begin = (s: WorkSession) => { setEditing(s.id); setText(s.title); };
  // a GPT talk in a folder (#182) is a Life thread to the engine: opened, and named, as a chat on the GPT seat
  const asChat = (s: WorkSession): Thread => ({ seat: "codex", sessionId: s.id, title: s.title, updatedAt: new Date(s.updatedAt).toISOString() });
  const commit = (s: WorkSession) => { const v = text.trim(); setEditing(null); if (v && v !== s.title) { if (s.seat === "codex") chats?.onRename(asChat(s), v); else w.rename(s.id, v); } };

  const rowMenu = (ev: React.MouseEvent, s: WorkSession) => {
    ev.preventDefault();
    const r = runs[s.id], gpt = s.seat === "codex";   // a GPT talk: no beside, window, fork or delete (Claude Code's)
    const items: MenuItem[] = [
      ...(gpt ? [] : [
        { label: "open beside", key: "⌘ click", run: () => onBeside(s.id) },
        { label: "open in a window", run: () => onPop(s.id, s.title) },
        { sep: true },
      ]),
      { label: "rename", key: "↵", run: () => begin(s) },
      { label: s.pinned ? "unpin" : "pin", run: () => w.mark(s.id, { pinned: !s.pinned }) },
      { label: s.done ? "not done" : "mark done", run: () => w.mark(s.id, { done: !s.done }) },
      { label: s.unread ? "mark read" : "mark unread", run: () => w.mark(s.id, { unread: !s.unread }) },
      { label: "move to", sub: [
        ...w.groups.filter((g) => !g.in || g.in === s.project).map((g) => ({ label: g.name, on: s.group === g.id, run: () => w.mark(s.id, { group: s.group === g.id ? null : g.id }) })),
        { label: "new group…", ask: "group name", run: (name?: string) => name && w.group("add", { name, sessions: [s.id] }) },
        ...(s.group ? [{ label: "out of the group", run: () => w.mark(s.id, { group: null }) }] : []),
      ] },
      { label: "move to folder", sub: [
        ...[...w.projects].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ label: p.name, on: s.project === p.path,
          run: () => w.mark(s.id, { group: null, folder: s.project === p.path ? null : p.path }) })),
        ...(s.folder ? [{ label: "back to its own folder", run: () => w.mark(s.id, { group: null, folder: null }) }] : []),
      ] },
      ...(gpt ? [] : [{ label: "fork", run: () => w.fork(s.id) }]),
      { sep: true },
      { label: s.archived ? "unarchive" : "archive", run: () => w.mark(s.id, { archived: !s.archived }) },
      ...(gpt ? [] : [{ label: "delete", danger: true, confirm: working(r) ? undefined : "delete for good?", disabled: working(r), run: () => w.del(s.id) }]),
    ];
    setMenu({ x: ev.clientX, y: ev.clientY, items });
  };
  const sectionMenu = (ev: React.MouseEvent, sec: Section) => {
    ev.preventDefault();
    const items: MenuItem[] = [];
    if (sec.project) {
      const p = sec.project;
      items.push({ label: "new session here", run: () => onFresh(p.path) },
        { label: folded[sec.key] ? "unfold" : "fold", run: () => fold(sec.key) },
        { sep: true }, { label: "hide this folder", run: () => w.folder("hide", p.path) });
      const into = (id: string | null) => w.group("move", { id, folder: p.path });
      const starts = w.prefs.newIn === p.path, other = !starts && w.prefs.newIn ? w.prefs.newIn.split("/").pop() : "";
      items.splice(2, 0,
        // the real folder, on the disk (#181): the engine renames it, or says in one line why not
        { label: "rename…", ask: baseOf(p.path), run: (name?: string) => { if (name && name !== baseOf(p.path)) renameFolder(p, name); } },
        { label: "move to", sub: [
          ...w.groups.map((g) => ({ label: g.name, on: p.group === g.id, run: () => into(p.group === g.id ? null : g.id) })),
          { label: "a new group with it…", ask: "group name", run: (name?: string) => name && w.group("add", { name, folders: [p.path] }) },
          ...(p.group ? [{ label: "out of the group", run: () => into(null) }] : []),
        ] },
        { label: "new group…", note: "a topic group in this folder", ask: "group name", run: (name?: string) => name && w.group("add", { name, in: p.path }) },
        { label: "new sessions start here", on: starts, note: other ? `now in ${other}` : undefined, run: () => w.setPref({ newIn: starts ? "" : p.path }) });
    } else if (sec.group) {
      const g = sec.group;
      items.push({ label: "rename group", ask: g.name, run: (name?: string) => name && w.group("rename", { id: g.id, name }) },
        { label: "what it is for…", ask: g.about ?? "", hint: g.about ? undefined : "one line: new sessions here are filed by it", note: g.about, empty: true,
          run: (about?: string) => w.group("rename", { id: g.id, about: about ?? "" }) },
        { label: "archive its sessions", run: () => w.mark(sec.rows.map((s) => s.id), { archived: true }) },
        { sep: true }, { label: "delete group", danger: true, confirm: "delete the group? the sessions stay", run: () => w.group("delete", { id: g.id }) });
    } else items.push({ label: folded[sec.key] ? "unfold" : "fold", run: () => fold(sec.key) });
    setMenu({ x: ev.clientX, y: ev.clientY, items });
  };
  const viewMenu = (ev: React.MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const opt = <K extends keyof View>(k: K, v: View[K], label: string): MenuItem => ({ label, on: view[k] === v, keep: true, run: () => setV({ [k]: v } as Partial<View>) });
    setMenu({ x: r.left, y: r.bottom + 6, items: [
      { head: "group by" }, opt("by", "project", "folder"), opt("by", "date", "date"), opt("by", "state", "state"), opt("by", "none", "nothing"),
      { head: "sort" }, opt("sort", "recent", "last active"), opt("sort", "created", "started"), opt("sort", "alpha", "a to z"),
      { head: "show" }, opt("status", "active", "active"), opt("status", "archived", "archived"), opt("status", "all", "everything"),
      { label: "stale folders", on: !!w.prefs.stale, keep: true, note: "gone ones, the Claude app's scratch", run: () => w.setPref({ stale: !w.prefs.stale }) },
      { sep: true }, { label: "new group…", ask: "group name", run: (name?: string) => name && w.group("add", { name }) },
    ] });
  };

  // a new row slides in from the left
  const known = useRef<Set<string> | null>(null);
  useEffect(() => { known.current = new Set([...visible, ...cowork].map((s) => s.id)); });
  const fresh = (id: string) => !!known.current && known.current.size > 0 && !known.current.has(id);

  // live: Claude is working on it, or it waits on Marco. A folded section still shows these (#111)
  const live = (s: WorkSession) => { const st = rowState(s, runs[s.id]); return st === "running" || st === "needs"; };
  // every session under a section: its rows, their side sessions, and the folders and topic groups nested in it
  const under = (sec: Section): WorkSession[] => {
    const out: WorkSession[] = [];
    const walk = (s: WorkSession) => { out.push(s); for (const c of kids.get(s.id) ?? []) walk(c); };
    for (const s of sec.rows) walk(s);
    for (const x of [...(sec.topics ?? []), ...(sec.folders ?? [])]) out.push(...under(x));
    return out;
  };

  const row = (s: WorkSession, depth = 0, bare = false): React.ReactNode => {
    const on = s.id === w.live || (s.seat === "codex" && s.id === chats?.active);
    const st = rowState(s, runs[s.id]);
    const children = bare ? [] : (kids.get(s.id) ?? []).sort(sorter);
    return (
      <Arrive key={s.id} on={!bare && fresh(s.id)}>
        {editing === s.id ? (
          <div className="row on editing" style={{ marginLeft: depth * 14 }}>
            <input autoFocus value={text} onChange={(ev) => setText(ev.target.value)} onFocus={(ev) => ev.target.select()} onBlur={() => commit(s)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") { ev.preventDefault(); commit(s); }
                else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setEditing(null); }
              }} />
          </div>
        ) : (
          <div data-sid={s.id} className={`row wrow ${bare ? "peek" : ""} ${on ? "on" : ""} ${st} ${s.archived ? "archived" : ""} ${s.gone && !away(s) ? "gone" : ""} ${dragging === s.id ? "dragged" : ""}`} style={{ paddingLeft: 10 + depth * 14 }}
            draggable={s.mode !== "cowork"} onDragStart={(ev) => { if (s.mode === "cowork") return; ev.dataTransfer.setData("sol/session", s.id); ev.dataTransfer.effectAllowed = "move"; setDragging(s.id); }}
            onDragEnd={() => { setDragging(null); setOver(null); }}
            onClick={(ev) => (s.seat === "codex" ? chats?.onOpen(asChat(s)) : ev.metaKey ? onBeside(s.id) : w.open(s.id))} onDoubleClick={() => begin(s)} onContextMenu={(ev) => rowMenu(ev, s)}
            title={`${s.title}\n${s.cwd}${away(s) ? ` (on ${MACHINE[s.machine!]})` : s.gone ? " (folder gone)" : ""}${s.branch ? `\n${s.branch}` : ""}`}>
            {depth > 0 && <i className="twig" />}
            <StateMark st={st} />
            <span className="t">{s.title || "untitled"}</span><Unseen sessionId={s.id} />
            {s.seat === "codex" && <small className="tag" title="a talk with GPT (Codex), run in this folder">gpt</small>}
            {s.worktree && <small className="tag" title={`a side copy: ${s.worktree}`}><Branch />{s.worktree.replace(/-[0-9a-f]{6}$/, "")}</small>}
            {away(s) && <small className="tag away" title={`ran on ${MACHINE[s.machine!]}; its transcript came over Syncthing`}>{s.machine}</small>}
            {s.held && <small className={`tag held ${s.held.status}`} title={`open in ${HELD[s.held.who]} (${s.held.status}${s.held.waitingFor ? `: ${s.held.waitingFor}` : ""}): read-only here`}>{HELD_SHORT[s.held.who]} · {s.held.status}</small>}
            {!!runs[s.id]?.tasks?.length && <small className="tag agents" title={runs[s.id]!.tasks!.join("\n")}>{runs[s.id]!.tasks!.length} {runs[s.id]!.tasks!.length === 1 ? "agent" : "agents"}</small>}
            {runs[s.id]?.since ? <small className="age live" title="working for">{span(now - runs[s.id]!.since!)}</small> : <small className="age">{age(s.updatedAt)}</small>}
            <button className="arch" title={s.archived ? "unarchive" : "archive"} onClick={(ev) => { ev.stopPropagation(); w.mark(s.id, { archived: !s.archived }); }}><Box /></button>
          </div>
        )}
        {children.map((c) => row(c, depth + 1))}
      </Arrive>
    );
  };

  // a session drops on any section that takes one; a folder only on a group (a folder nested in a group passes it up)
  const takes = (sec: Section, ev: React.DragEvent) => (ev.dataTransfer.types.includes("sol/session") && !!sec.drop) || (ev.dataTransfer.types.includes("sol/folder") && !!sec.dropFolder);
  const dropOn = (sec: Section) => (sec.drop || sec.dropFolder) && {
    onDragOver: (ev: React.DragEvent) => { if (takes(sec, ev)) { ev.preventDefault(); ev.stopPropagation(); setOver(sec.key); } },
    onDragLeave: () => setOver((o) => (o === sec.key ? null : o)),
    onDrop: (ev: React.DragEvent) => {
      if (!takes(sec, ev)) return;
      ev.preventDefault(); ev.stopPropagation();
      const id = ev.dataTransfer.getData("sol/session"), path = ev.dataTransfer.getData("sol/folder");
      setOver(null); setDragging(null);
      if (id) sec.drop?.(id); else if (path && path !== sec.project?.path) sec.dropFolder?.(path);
    },
  };

  // a top row dragged over another's title: its upper half puts it above, its lower half below. A folder over a group's
  // title still goes into the group from the middle of it, as before; only the title's top and bottom quarter order it
  const spot = (sec: Section, ev: React.DragEvent): "above" | "below" | null => {
    if (!sec.top || !moving || moving === sec.top || !ev.dataTransfer.types.includes("sol/row")) return null;
    const r = ev.currentTarget.getBoundingClientRect(), y = (ev.clientY - r.top) / r.height;
    if (takes(sec, ev) && y > 0.25 && y < 0.75) return null;
    return y < 0.5 ? "above" : "below";
  };
  const reorder = (key: string, target: string, at: "above" | "below") => {
    const shown = sections.flatMap((x) => (x.top && x.top !== key ? [x.top] : []));
    const i = shown.indexOf(target);
    if (i < 0) return;
    shown.splice(at === "above" ? i : i + 1, 0, key);
    w.setOrder([...shown, ...w.order.filter((k) => !shown.includes(k))]);   // a row not shown now keeps its place for later
  };
  // only by folder: there every top row is on the side, so the order he drags is the whole order
  const ordering = (sec: Section) => !!sec.top && view.by === "project" && !words.length;
  const endDrag = () => { setDragging(null); setOver(null); setMoving(null); setLine(null); };
  const orderOn = (sec: Section) => ordering(sec) && {
    onDragOver: (ev: React.DragEvent) => {
      const at = spot(sec, ev);
      if (!at) { setLine((l) => (l?.key === sec.top ? null : l)); return; }
      ev.preventDefault(); ev.stopPropagation(); setOver(null);
      setLine((l) => (l && l.key === sec.top && l.at === at ? l : { key: sec.top!, at }));
    },
    onDragLeave: (ev: React.DragEvent) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setLine((l) => (l?.key === sec.top ? null : l)); },
    onDrop: (ev: React.DragEvent) => {
      const at = spot(sec, ev);
      if (!at) return;
      ev.preventDefault(); ev.stopPropagation();
      const key = ev.dataTransfer.getData("sol/row");
      endDrag();
      if (key) reorder(key, sec.top!, at);
    },
  };

  // whether a section draws at all: an empty pinned only while a row is dragged, an empty folder only if it was added
  const drawn = (sec: Section) => {
    const count = sec.rows.length + [...(sec.folders ?? []), ...(sec.topics ?? [])].reduce((n, x) => n + x.rows.length, 0);
    if (!count && !sec.drop && !sec.dropFolder) return false;   // the groups fold has no rows of its own, only its groups
    if (!sec.rows.length && sec.key === "pinned" && !dragging) return false;
    return !(!count && sec.group === undefined && sec.project && !sec.project.added);
  };
  const section = (sec: Section): React.ReactNode => {
    const nested = sec.folders ?? [], topics = sec.topics ?? [];
    const count = sec.rows.length + [...nested, ...topics].reduce((n, x) => n + x.rows.length, 0);
    if (!drawn(sec)) return null;
    const isFolded = !!folded[sec.key] && sec.key !== "search";
    // a group shows all its rows; a folder, and a topic group inside one, shows SHOW and then "n more"
    const all = more[sec.key] || sec.key === "search" || sec.key === "pinned" || (!!sec.group && !sec.group.in);
    const shown = all ? sec.rows : sec.rows.slice(0, SHOW);
    const p = sec.project;
    // MY SOL's card (#76): how many of his own commits sit over stable, their subjects on hover
    const mine = (p as (Project & { mine?: { base: string; count: number; subjects: string[] } }) | undefined)?.mine;
    return (
      <div key={sec.key} className={`wsec ${over === sec.key ? "over" : ""} ${(p && dragging === "f:" + p.path) || (sec.top && moving === sec.top) ? "dragged" : ""} ${line && line.key === sec.top ? "line-" + line.at : ""}`} {...dropOn(sec)}>
        <div className={`group tog ${isFolded ? "" : "open"}`} data-s onClick={() => fold(sec.key)} onContextMenu={(ev) => sectionMenu(ev, sec)}
          title={p ? p.path + (w.prefs.newIn === p.path ? "\nnew sessions start here" : "") : undefined}
          draggable={(!!p || ordering(sec)) && !words.length}
          onDragStart={(p || ordering(sec)) ? ((ev) => {
            if (p) { ev.dataTransfer.setData("sol/folder", p.path); setDragging("f:" + p.path); }
            if (ordering(sec) && sec.top) { ev.dataTransfer.setData("sol/row", sec.top); setMoving(sec.top); }
            ev.dataTransfer.effectAllowed = "move";
          }) : undefined}
          onDragEnd={(p || ordering(sec)) ? endDrag : undefined} {...orderOn(sec)}>
          <Turn to={isFolded ? 0 : 90} cfg={{ k: 380, z: 0.5 }}><Caret /></Turn>
          {p && <Folder />}<span className="gl">{sec.label}</span>
          {count > 0 && <small>{count}</small>}
          {p && <button className="here" title={`new session in ${p.path}`} onClick={(ev) => { ev.stopPropagation(); onFresh(p.path); }}><Plus /></button>}
        </div>
        {mine && <p className="wmine" title={mine.subjects.length ? `over ${mine.base}:\n` + mine.subjects.join("\n") + (mine.count > mine.subjects.length ? `\n…and ${mine.count - mine.subjects.length} more` : "") : `on ${mine.base}`}>
          {mine.count ? `${mine.count} of his own over stable` : "nothing of his own yet"}</p>}
        {p && said?.path === p.path && <>
          <p className="wmine" style={said.files?.length ? { cursor: "pointer" } : undefined} title={said.files?.length ? said.files.join("\n") : undefined}
            onClick={said.files?.length ? () => say({ ...said, open: !said.open }, 120_000) : undefined}>{said.text}</p>
          {said.open && said.files?.map((f) => <p key={f} className="wmine" title={f}>{shortPath(f, p.path)}</p>)}
        </>}
        {isFolded && (() => {   // folded, the live rows still show, flat, from everything under it (#111)
          const peek = under(sec).filter(live).sort(sorter);
          return peek.length > 0 ? <div className="wpeek">{peek.map((s) => row(s, 0, true))}</div> : null;
        })()}
        <Fold open={!isFolded} from={{ x: -18 }} gap={30}>
          {topics.length > 0 && <div className="wnest">{topics.map((x) => section(x))}</div>}
          {!sec.rows.length && !nested.length && !topics.length && <p className="none">{sec.key === "pinned" ? "drop here to pin" : sec.group ? (sec.dropFolder ? "drag sessions or folders here" : "drag sessions here") : "no sessions yet"}</p>}
          {shown.map((s) => row(s))}
          {!all && sec.rows.length > SHOW && (
            <button className="wmore" onClick={() => setMore((m) => ({ ...m, [sec.key]: true }))}>{sec.rows.length - SHOW} more</button>
          )}
          {nested.length > 0 && <div className="wnest">{nested.map((x) => section(x))}</div>}
        </Fold>
      </div>
    );
  };

  // the chats, after the folders: one group, foldable, SHOW then "n more"; a "+" starts a new one (its seat under the box)
  const chatSection = () => {
    const c = chats!, isFolded = !!folded.chats && !words.length, all = more.chats || !!words.length;
    const shown = all ? chatRows : chatRows.slice(0, SHOW);
    const done = (t: Thread) => { const v = text.trim(); setEditing(null); if (v && v !== t.title) c.onRename(t, v); };
    const chatMenu = (ev: React.MouseEvent, t: Thread) => {
      ev.preventDefault();
      setMenu({ x: ev.clientX, y: ev.clientY, items: [
        { label: "rename", run: () => { setEditing("c:" + t.sessionId); setText(t.title); } },
        { label: pins.includes(t.sessionId) ? "unpin" : "pin", run: () => pin(t.sessionId) },
      ] });
    };
    return (
      <div key="chats" className="wsec wchats">
        <div className={`group tog ${isFolded ? "" : "open"}`} data-s onClick={() => fold("chats")}>
          <Turn to={isFolded ? 0 : 90} cfg={{ k: 380, z: 0.5 }}><Caret /></Turn>
          <span className="gl">{words.length ? `chats · ${chatRows.length} found` : "Chats"}</span>
          {chatRows.length > 0 && <small>{chatRows.length}</small>}
          <button className="here" title="new chat" onClick={(ev) => { ev.stopPropagation(); c.onNew(); }}><Plus /></button>
        </div>
        <Fold open={!isFolded} from={{ x: -18 }} gap={30}>
          {!chatRows.length && <p className="none">no chats yet</p>}
          {shown.map((t) => editing === "c:" + t.sessionId ? (
            <div key={t.sessionId} className="row on editing" data-s>
              <input autoFocus value={text} onChange={(ev) => setText(ev.target.value)} onFocus={(ev) => ev.target.select()} onBlur={() => done(t)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") { ev.preventDefault(); done(t); }
                  else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setEditing(null); }
                }} />
            </div>
          ) : (
            <div key={t.sessionId} data-s data-cid={t.sessionId} className={`row wrow ${t.sessionId === c.active ? "on" : ""}`} style={{ paddingLeft: 10 }}
              onClick={() => c.onOpen(t)} onDoubleClick={() => { setEditing("c:" + t.sessionId); setText(t.title); }} onContextMenu={(ev) => chatMenu(ev, t)}
              title={`${t.title || "untitled"}\n${t.seat}`}>
              <span className={`wst ${pins.includes(t.sessionId) ? "pin" : ""}`}><i /></span>
              <span className="t">{t.title || "untitled"}</span><Unseen sessionId={t.sessionId} />
              {t.door && <small className="door">{t.door}</small>}
              <small className="age">{age(ms(t.updatedAt))}</small>
            </div>
          ))}
          {!all && chatRows.length > SHOW && <button className="wmore" onClick={() => setMore((m) => ({ ...m, chats: true }))}>{chatRows.length - SHOW} more</button>}
        </Fold>
      </div>
    );
  };

  // what the list draws, in its order, then laid out: one list, two halves, or one section a page (layouts.ts)
  type Part = Section | { key: "chats" };
  const items: Part[] = [...sections.filter(drawn), ...(chats && (chatRows.length > 0 || !words.length) ? [{ key: "chats" as const }] : [])];
  const draw = (x: Part) => (x.key === "chats" ? chatSection() : section(x as Section));
  const laid = parts(layout, items);
  const label = (x: Part) => (x.key === "chats" ? "Chats" : (x as Section).label);

  // the button: a press goes to the next layout, a hold shows the three
  const held = useRef<{ t: number | null; fired: boolean }>({ t: null, fired: false });
  const holdDown = () => { held.current.fired = false; held.current.t = window.setTimeout(() => { held.current = { t: null, fired: true }; setPicking(true); }, 420); };
  const holdOff = () => { if (held.current.t !== null) clearTimeout(held.current.t); held.current.t = null; };
  const layClick = () => { holdOff(); if (held.current.fired) { held.current.fired = false; return; } setLayout(nextLayout(layout)); };
  const pick = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (picking && pick.current) enter(pick.current, { x: -10, cfg: CFG.snap }); }, [picking]);
  useEffect(() => {
    if (!picking) return;
    const down = (ev: MouseEvent) => { if (!(ev.target as HTMLElement).closest(".wlay")) setPicking(false); };
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.stopPropagation(); setPicking(false); } };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key, true); };
  }, [picking]);

  // split: the line between the halves drags, and the share is kept when it is let go
  const list = useRef<HTMLDivElement>(null);
  const dragLine = (ev: React.PointerEvent<HTMLDivElement>) => {
    const el = ev.currentTarget, box = list.current!.getBoundingClientRect();
    el.setPointerCapture(ev.pointerId);
    el.classList.add("on");
    let s = share;
    const move = (e: PointerEvent) => { s = Math.min(0.85, Math.max(0.15, (e.clientY - box.top) / box.height)); setWent((x) => ({ ...x, share: s })); };
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.classList.remove("on");
      lay?.arrange({ split: { share: Math.round(s * 100) / 100 } });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  // carousel: the pages scroll sideways (a swipe, snapped); a dot goes there on the spring
  const car = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const here = Math.min(at, Math.max(0, laid.length - 1));
  const carSp = useSpring(0, CFG.glide, (v, s) => { const el = car.current; if (!el) return; el.scrollLeft = v; if (s.resting) el.style.scrollSnapType = ""; });
  const goPage = (i: number) => { const el = car.current; if (!el) return; el.style.scrollSnapType = "none"; carSp.set(el.scrollLeft); carSp.to(i * el.clientWidth); setAt(i); };
  // and the keys: with the side focused (not its search), left and right go a page; the pages not showing are inert, so
  // tab never lands in one, and the focus moves with the page
  const carKey = (ev: React.KeyboardEvent) => {
    if (layout !== "carousel" || (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") || ev.metaKey || ev.altKey || ev.shiftKey) return;
    if ((ev.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
    const i = here + (ev.key === "ArrowRight" ? 1 : -1);
    ev.preventDefault();
    if (i < 0 || i >= laid.length) return;
    goPage(i);
    requestAnimationFrame(() => (car.current?.children[i]?.querySelector<HTMLElement>("button, [tabindex], a[href]") ?? car.current)?.focus());
  };

  const loading = !w.loaded && <p className="none">reading the sessions…</p>;
  const newGroup = dragging && !words.length && (
    <div className={`wsec newgroup ${over === "new" ? "over" : ""}`}
      onDragOver={(ev) => { ev.preventDefault(); setOver("new"); }} onDragLeave={() => setOver(null)}
      onDrop={(ev) => {
        ev.preventDefault(); const id = ev.dataTransfer.getData("sol/session"), path = ev.dataTransfer.getData("sol/folder"); setOver(null); setDragging(null);
        if (id) w.group("add", { name: "new group", sessions: [id] }); else if (path) w.group("add", { name: "new group", folders: [path] });
      }}>
      <Plus /><span>drop for a new group</span>
    </div>
  );

  return (
    <>
      <aside ref={f.ref} className={`side wside ${f.open ? "open" : ""} ${pinned ? "pinned" : ""}`} onMouseEnter={f.onMouseEnter} onMouseLeave={f.onMouseLeave}
        aria-hidden={!f.open} inert={!f.open} onKeyDown={carKey}>
        <div className="side-head" data-s>
          <SeatScene mode="home" />
          <ModeWheel mode="home" onPick={onMode} />
        </div>
        <button className="newc" data-s onClick={() => onFresh()}><Plus /><span>new session</span><kbd>⌘N</kbd></button>
        <div className="wfind" data-s>
          <label className="wsearch"><Lens />
            <input ref={searchRef} value={q} placeholder="search" aria-label="search sessions and chats" onChange={(ev) => setQ(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); setQ(""); ev.currentTarget.blur(); } }} />
          </label>
          <span className="wlay">
            <button className="wview" onPointerDown={holdDown} onPointerLeave={holdOff} onClick={layClick} aria-label={`layout: ${layout}`}
              title={`${LAY_SAYS[layout]}\npress for the next layout, hold for all three`}><LayGlyph l={layout} /></button>
            {picking && (
              <div ref={pick} className="wlaypick" role="menu">
                {LAYOUTS.map((l) => <button key={l} className={`wview ${l === layout ? "on" : ""}`} role="menuitemradio" aria-checked={l === layout} aria-label={l} title={LAY_SAYS[l]} onClick={() => setLayout(l)}><LayGlyph l={l} /></button>)}
              </div>
            )}
          </span>
          <button className="wview" onClick={viewMenu} title="group, sort, show"><Sliders /></button>
        </div>
        {layout === "carousel" && laid.length > 1 && (
          <div className="wdots" data-s>{laid.map((p, i) => <button key={p[0].key} className={`wdot ${i === here ? "on" : ""}`} title={label(p[0])} aria-label={label(p[0])} onClick={() => goPage(i)} />)}</div>
        )}
        {layout === "split" ? (
          <div ref={list} className="side-list whalves">
            <div className="wpart" style={{ flex: `${share} 1 0` }}><Pill selector=".row" mode="hover" className="hov" />{loading}{laid[0].map(draw)}{newGroup}</div>
            <div className="wline" role="separator" aria-orientation="horizontal" title="drag to share the side between them" onPointerDown={dragLine} />
            <div className="wpart" style={{ flex: `${1 - share} 1 0` }}><Pill selector=".row" mode="hover" className="hov" />{laid[1].map(draw)}</div>
          </div>
        ) : layout === "carousel" ? (
          <div className="side-list wcarousel">
            <div ref={car} className="wcar" tabIndex={-1} onScroll={(ev) => { const el = ev.currentTarget; if (el.style.scrollSnapType !== "none") setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}>
              {(laid.length ? laid : [[]]).map((p, i) => (
                <div key={p[0]?.key ?? i} className="wpage" inert={i !== here} aria-label={p[0] ? label(p[0]) : undefined}><Pill selector=".row" mode="hover" className="hov" />{loading}{p.map(draw)}{newGroup}</div>
              ))}
            </div>
          </div>
        ) : (
          <div className="side-list">
            <Pill selector=".row" mode="hover" className="hov" />
            {loading}
            {laid[0].map(draw)}
            {newGroup}
          </div>
        )}
        <div className="side-foot">
          <button className={`newc setc ${page === "conversations" ? "on" : ""}`} data-s onClick={onConversations} aria-pressed={page === "conversations"}
            title={waiting ? `conversations (cmd+;): ${waiting} talk${waiting === 1 ? "" : "s"} not opened yet` : "conversations (cmd+;)"}>
            <Talks /><span>conversations{waiting > 0 && <i className="newc-dot" aria-label="a talk waits" />}</span><kbd>⌘;</kbd>
          </button>
          <button className={`newc setc ${page === "settings" ? "on" : ""}`} data-s onClick={onSettings} aria-pressed={page === "settings"} title="settings (cmd+,)">
            <Gear /><span>settings</span><kbd>⌘,</kbd>
          </button>
        </div>
      </aside>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
}

function Arrive({ on, children }: { on: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (on && ref.current) enter(ref.current, { x: -24, cfg: CFG.slide }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} data-s>{children}</div>;
}
