// Work mode's state: every Claude Code session on the machine (the side), the one open (its items), and the live
// runs. It rides on useEngine's socket (work.* messages, PROTOCOL.md round 11).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileOut } from "../useEngine";
import type { Aside } from "./Cards";
import { applyDeltas, buffer, settle, upsert, type Pending } from "./threads";
import { homeSession } from "../migrate";

export type Item = { id: string; kind: string; [k: string]: any };
export type WorkSession = {
  id: string; title: string; cwd: string; project: string; worktree?: string; branch?: string;
  machine?: "mac" | "nucbox";          // where it ran (from its folder's home); the other machine's come over Syncthing
  updatedAt: number; createdAt?: number; size?: number; tag?: string;
  gone?: boolean; failed?: boolean; pinned?: boolean; done?: boolean; unread?: boolean; archived?: boolean; group?: string; parent?: string; seen?: number;
  card?: string; mode?: "life" | "work" | "cowork";
  held?: Holder;                       // open in another live process: read-only here (PROTOCOL.md round 11, the lock)
  settled?: Record<string, string>; moved?: string;   // thread map ends already reconciled; where its kept end went on
  folder?: string;                     // shown under this folder instead of its own (project is that folder then)
  seat?: "codex";                      // a GPT talk in this folder (#182): opened as a talk on the GPT seat
  running?: boolean;                   // a GPT talk with a turn going (a Claude session's runs say so)
};
export type Holder = { pid: number; who: "desktop" | "sol" | "sol-other" | "terminal" | "other"; status: string; waitingFor?: string; name?: string; since: number };
export type Project = { path: string; name: string; count: number; added?: boolean; group?: string };   // group: the group the folder sits in
// folders: whole folders in it; in: a topic group inside that folder (its sessions only); about: what it is for
export type Group = { id: string; name: string; at: number; folders?: string[]; in?: string; about?: string };
// the engine's prefs the side acts on: show stale folders, the folder a fresh session starts in (work.prefs)
export type SidePrefs = { stale?: boolean; newIn?: string };
export type Mode = "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions";
export type RunInfo = {
  sessionId: string; busy: boolean; waiting: number; cwd: string; model: string; effort: string; mode: Mode; fast: boolean;
  context: number; window: number; commands?: string[]; skills?: string[]; agents?: string[]; mcp?: { name: string; status: string }[];
  outputStyle?: string; cost?: number; failed?: boolean;
  tasks?: string[];   // background agents still at work while the main thread waits: the row keeps its runner, stop ends them
  since?: number;     // when this stretch of work began, 0 while idle: the row's clock (#47)
  shown?: boolean;    // shown to the team over the relay (#101)
  issue?: number; relay?: boolean;   // the team issue its branch names, the relay up: the bar's "show to team" switch
};
export const working = (r?: RunInfo) => !!r && (r.busy || !!r.tasks?.length);
export type Files = { files: string[]; missing?: boolean; cwd?: string };
// a folder renamed on the disk (#181, engine work/rename.ts): mentions are files that still say the old path (none changed)
export type FolderRenamed = { error?: string; ok?: boolean; from?: string; to?: string; sessions?: number; mentions?: string[]; mentioned?: number; notes?: string[] };
export type Thread = { sessionId: string; items: Item[]; cwd?: string; branch?: string; title?: string; fresh?: boolean };
export type TermInfo = { tid: string; cwd: string; title: string; alive: boolean; code?: number; at: number };

const uuid = () => crypto.randomUUID();
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; } };
const keep = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

// What the engine last said, kept across mode switches: a mode's tree is unmounted when another is picked, so without
// this Work (and Cowork, which rides on it) came back blank until the engine answered again (0.3–1 s). A mount paints
// the last lists and threads at once; the fresh answers replace them. Of the threads, only the open, beside and
// streaming sessions keep their items (trim below, #75).
const seen: { sessions: WorkSession[]; projects: Project[]; groups: Group[]; order: string[]; runs: Record<string, RunInfo>; threads: Record<string, Thread>; terms: TermInfo[]; loaded: boolean } =
  { sessions: [], projects: [], groups: [], order: [], runs: {}, threads: {}, terms: [], loaded: false };

// solo: a window of its own showing one session (a pop-out); it keeps nothing in this machine's Work state.
// store: where Cowork keeps its open session, so the two modes do not open each other's; Home keeps none here, its
// open talk is `sol.home.open` (WorkApp.tsx, migrate.ts), and its session starts from it
export function useWork(e: { up: boolean; send: (o: object) => boolean; subscribe: (f: (m: any) => void) => () => void }, solo?: string, store?: string) {
  const [sessions, setSessions] = useState<WorkSession[]>(seen.sessions);
  const [projects, setProjects] = useState<Project[]>(seen.projects);
  const [groups, setGroups] = useState<Group[]>(seen.groups);
  const [order, setOrderS] = useState<string[]>(seen.order);   // the side's top rows as Marco dragged them (#73)
  const [runs, setRuns] = useState<Record<string, RunInfo>>(seen.runs);
  const [threads, setThreads] = useState<Record<string, Thread>>(seen.threads);
  const [current, setCurrent] = useState<string | null>(() => solo ?? (store ? load<string | null>(store, null) : homeSession()));
  const [terms, setTerms] = useState<TermInfo[]>(seen.terms);
  const dropped = useRef(new Set<string>()); // asides closed or replaced: their late words are ignored
  const asks = useRef(new Map<string, (r: any) => void>()); // questions asked of the engine (files, diff, pr…), by request id
  const [freshCwd, setFreshCwd] = useState<string>(() => load("sol.work.cwd", ""));
  const [model, setModel] = useState(() => load("sol.work.model", "claude-opus-5-5"));
  const [effort, setEffort] = useState(() => load("sol.work.effort", "high"));
  // the mode starts at the Work default in Settings (#94), never at what a session last set; the pick lasts the window
  const [mode, setMode] = useState<Mode>("default");
  useEffect(() => {
    const off = e.subscribe((m) => { const d = m?.type === "settings" ? m.settings?.defaults?.mode as Mode | undefined : undefined; if (d) setMode(d); });
    e.send({ type: "settings.get" });
    return off;
  }, [e.subscribe, e.send]);
  const [fast, setFast] = useState(() => load("sol.work.fast", false));
  const [copy, setCopyS] = useState(() => load("sol.work.copy", false));   // a new session starts in a side copy
  const setCopy = useCallback((v: boolean) => { setCopyS(v); keep("sol.work.copy", v); }, []);
  const [error, setError] = useState("");
  // a new session's first words, until its run exists: a side copy git refused gives them back to the box
  const firstSay = useRef<{ id: string; text: string } | null>(null);
  const forkSay = useRef<{ from: string; rid: string; say: object } | null>(null);
  const [unsent, setUnsent] = useState<{ text: string; n: number } | null>(null);
  const [asides, setAsides] = useState<Record<string, Aside>>({});   // per session: the latest side answer
  const [loaded, setLoaded] = useState(seen.loaded);
  const [prefs, setPrefsS] = useState<SidePrefs>(() => load("sol.work.prefs", {}));
  const keepPrefs = useCallback((p?: SidePrefs) => { if (!p) return; const v = { stale: !!p.stale, newIn: p.newIn ?? "" }; setPrefsS(v); keep("sol.work.prefs", v); }, []);
  const cur = useRef(current);
  cur.current = current;
  // streamed words, painted at most every 50 ms in one update (a copy per word made a two-hour window hold 2.7 GB, #75)
  const pending = useRef<Pending>(new Map());
  const tick = useRef(0);
  const flush = useCallback(() => {
    window.clearTimeout(tick.current); tick.current = 0;
    const p = pending.current;
    if (!p.size) return;
    pending.current = new Map();
    setThreads((t) => applyDeltas(t, p));
  }, []);
  const beside = useRef(new Set<string>());   // sessions shown beside the open one (peek): their items stay
  const runsNow = useRef(runs);
  runsNow.current = runs;
  // The window keeps the items of the open session, the one beside it and the ones streaming now; the others drop
  // theirs (opening one reads it again from the engine). Words still buffered land first, so none is lost.
  const retrim = useCallback(() => {
    window.clearTimeout(tick.current); tick.current = 0;
    const p = pending.current;
    pending.current = new Map();
    const keep = new Set<string>(beside.current);
    for (const id in runsNow.current) if (working(runsNow.current[id])) keep.add(id);
    const c = cur.current;
    if (c) keep.add(c.startsWith("new:") ? c.slice(4) : c);
    setThreads((t) => settle(t, p, keep));
  }, []);
  const send = e.send;
  // the lists and threads as they stand, for the next mount (not a pop-out's: it holds one session)
  useEffect(() => { if (!solo) Object.assign(seen, { sessions, projects, groups, order, runs, threads, terms, loaded }); }, [solo, sessions, projects, groups, order, runs, threads, terms, loaded]);

  useEffect(() => e.subscribe((m) => {
    if (m.type === "work.sessions") {
      setSessions(m.sessions ?? []); setProjects(m.projects ?? []); setGroups(m.groups ?? []); setOrderS(m.order ?? []); setLoaded(true);
      setRuns(Object.fromEntries((m.runs ?? []).map((r: RunInfo) => [r.sessionId, r])));
    } else if (m.type === "work.thread") {
      flush();
      setThreads((t) => ({ ...t, [m.sessionId]: { sessionId: m.sessionId, items: m.items ?? [], cwd: m.cwd, branch: m.branch, title: m.title } }));
      if (m.run) setRuns((r) => ({ ...r, [m.sessionId]: m.run }));
    } else if (m.type === "work.item") {
      flush();   // the words before it land first: an item's final text replaces what streamed
      setThreads((t) => {
        const th = t[m.sessionId] ?? { sessionId: m.sessionId, items: [] };
        return { ...t, [m.sessionId]: { ...th, items: upsert(th.items, m.item) } };
      });
    } else if (m.type === "work.delta") {
      buffer(pending.current, m.sessionId, m.id, String(m.text ?? ""));
      if (!tick.current) tick.current = window.setTimeout(flush, 50);
    } else if (m.type === "work.run") {
      const { type: _t, ended: _e, ...info } = m;
      setRuns((r) => ({ ...r, [m.sessionId]: info as RunInfo }));
      if (firstSay.current?.id === m.sessionId) firstSay.current = null;
      // the run's folder is the true one (a side copy is made by the engine): the panes follow it
      if (m.cwd) setThreads((t) => (t[m.sessionId] && t[m.sessionId].cwd !== m.cwd ? { ...t, [m.sessionId]: { ...t[m.sessionId], cwd: m.cwd } } : t));
    } else if (m.type === "work.closed") {
      setRuns((r) => { const n = { ...r }; delete n[m.sessionId]; return n; });
    } else if (m.type === "work.deleted") {
      if (cur.current === m.sessionId) setCurrent(null);
    } else if (m.type === "work.forked") {
      openId(m.sessionId);
      // "fork here" with words in the box: they are the new session's first message
      const p = forkSay.current;
      if (p && m.here && p.rid === m.rid) { forkSay.current = null; send({ ...p.say, type: "work.say", sessionId: m.sessionId }); }
    } else if (m.type === "work.reconciled") {
      if (m.kept && m.kept !== m.sessionId && cur.current === m.sessionId) openId(m.kept);   // the kept end went on in a new session
    } else if (m.type === "work.aside") {
      if (dropped.current.has(m.id)) return;
      setAsides((a) => {
        const o = a[m.sessionId]?.id === m.id ? a[m.sessionId] : { id: m.id, q: m.q ?? "", text: "", done: false };
        const n: Aside = { ...o, ...(m.q !== undefined ? { q: m.q } : {}), text: m.delta ? o.text + m.delta : m.text ?? o.text, done: !!m.done, ...(m.error ? { error: m.error } : {}) };
        return { ...a, [m.sessionId]: n };
      });
    } else if (m.type === "work.terms") {
      setTerms(m.terms ?? []);
    } else if (m.type === "work.prefs" && !m.rid) {   // another face changed them
      keepPrefs(m.prefs);
    } else if (m.rid && asks.current.has(m.rid)) {
      const f = asks.current.get(m.rid)!;
      asks.current.delete(m.rid); f(m);
    } else if (m.type === "work.error") {
      setError(m.message); window.setTimeout(() => setError(""), 4000);
      if (forkSay.current && forkSay.current.from === m.sessionId) forkSay.current = null;   // a "fork here" that failed keeps nothing waiting (its words stay in the box)
      // a new session that never started: back to a new session, its words back in the box
      const f = firstSay.current;
      if (f && f.id === m.sessionId) {
        firstSay.current = null;
        flush();
        setThreads((t) => { const n = { ...t }; delete n[f.id]; return n; });
        if (cur.current === f.id) setCurrent("new:" + f.id);
        setUnsent((u) => ({ text: f.text, n: (u?.n ?? 0) + 1 }));
      }
    }
  }), [e.subscribe]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), [flush]);

  // trimmed when the open one changes or a run settles (and on peek and unpeek)
  const streaming = Object.keys(runs).filter((id) => working(runs[id])).sort().join(" ");
  useEffect(retrim, [current, streaming, retrim]);

  // Work can open on a socket that is already up (a switch from Home), and the socket can come back: either way the
  // list is asked for and the open session read again
  useEffect(() => {
    if (!e.up) return;
    send({ type: "work.list" }); send({ type: "work.term.list" });
    void ask<{ prefs?: SidePrefs }>("work.prefs", {}).then((r) => keepPrefs(r.prefs));
    if (cur.current && !cur.current.startsWith("new:")) send({ type: "work.open", sessionId: cur.current });
  }, [e.up, send]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (solo) return;
    const id = current?.startsWith("new:") ? null : current;
    if (store) keep(store, id);
    window.dispatchEvent(new CustomEvent("sol:work-live", { detail: id }));   // App pings for the sessions not in front (pings.ts)
  }, [current, solo, store]);

  const openId = useCallback((id: string) => {
    setCurrent(id);
    send({ type: "work.open", sessionId: id });
  }, [send]);
  // a new session: nothing exists until the first message; the id is made here so the face can follow it at once
  // with no folder picked, ever, it starts in the folder Marco chose for new sessions (prefs.newIn)
  // `parent`: the talk this one carries on from (the switch, #182), marked when it starts
  const parentNext = useRef<string | undefined>(undefined);
  const fresh = useCallback((cwd?: string, o?: { parent?: string }) => {
    parentNext.current = o?.parent;
    if (cwd) { setFreshCwd(cwd); keep("sol.work.cwd", cwd); }
    else if (!freshCwd && prefs.newIn) setFreshCwd(prefs.newIn);
    setCurrent("new:" + uuid());
    send({ type: "work.view", sessionId: null });
  }, [send, freshCwd, prefs.newIn]);

  const say = useCallback((text: string, files: FileOut[] = []) => {
    if (!text.trim() && !files.length) return false;
    let id = cur.current;
    const isFresh = !id || id.startsWith("new:");
    if (isFresh) {
      id = id?.slice(4) || uuid();
      setThreads((t) => ({ ...t, [id!]: { sessionId: id!, items: [], cwd: freshCwd, fresh: true } }));
      setCurrent(id);
      firstSay.current = { id: id!, text };
    }
    // a session keeps its own picks: a message carries the run's model, effort, mode and fast, and the window's only for
    // a fresh one or a run the engine closed (#111: a stale window once sent its own "auto" with every message)
    const r = isFresh ? undefined : runsNow.current[id!];
    const parent = isFresh ? parentNext.current : undefined;
    if (isFresh) parentNext.current = undefined;
    send({ type: "work.say", sessionId: id, fresh: isFresh, cwd: isFresh ? freshCwd || undefined : undefined, ...(isFresh && copy ? { worktree: true } : {}), ...(parent ? { parent } : {}), text, files,
      model: r?.model ?? model, effort: r?.effort ?? effort, mode: r?.mode ?? mode, fast: r?.fast ?? fast });
    return true;
  }, [send, freshCwd, model, effort, mode, fast, copy]);

  // a message to a session that is not the open one (the one beside it)
  const sayTo = useCallback((id: string, text: string, files: FileOut[] = []) => {
    if (!text.trim() && !files.length) return false;
    const r = runs[id];
    send({ type: "work.say", sessionId: id, text, files, model: r?.model ?? model, effort: r?.effort ?? effort, mode: r?.mode ?? mode, fast: r?.fast ?? fast });
    return true;
  }, [send, runs, model, effort, mode, fast]);

  const live = current && !current.startsWith("new:") ? current : null;
  const adjust = useCallback((p: Partial<{ model: string; effort: string; mode: Mode; fast: boolean }>) => {
    if (p.model) { setModel(p.model); keep("sol.work.model", p.model); }
    if (p.effort) { setEffort(p.effort); keep("sol.work.effort", p.effort); }
    if (p.mode) setMode(p.mode);
    if (p.fast !== undefined) { setFast(p.fast); keep("sol.work.fast", p.fast); }
    if (live) send({ type: "work.adjust", sessionId: live, ...p });
  }, [send, live]);
  const send2adjust = useCallback((id: string, p: object) => send({ type: "work.adjust", sessionId: id, ...p }), [send]);

  // one question to the engine, answered by rid; a silent engine answers { error } after the wait, a closed socket at once
  const ask = useCallback(<T = any,>(type: string, a: object, wait = 20_000) => new Promise<T>((ok) => {
    const rid = uuid();
    asks.current.set(rid, ok);
    if (!send({ type, rid, ...a })) { asks.current.delete(rid); ok({ error: "not connected" } as T); return; }
    window.setTimeout(() => { if (asks.current.delete(rid)) ok({ error: "the engine did not answer" } as T); }, wait);
  }), [send]);

  const act = useMemo(() => ({
    stop: (id = live) => id && send({ type: "work.stop", sessionId: id }),
    perm: (id: string, a: object, sid = live) => sid && send({ type: "work.perm", sessionId: sid, id, ...a }),
    mark: (ids: string | string[], patch: object) => send({ type: "work.mark", ...(Array.isArray(ids) ? { sessionIds: ids } : { sessionId: ids }), patch }),
    rename: (id: string, title: string) => send({ type: "work.rename", sessionId: id, title }),
    group: (op: "add" | "rename" | "delete" | "move", a: { id?: string | null; name?: string; sessions?: string[]; folders?: string[]; folder?: string; in?: string; about?: string }) => send({ type: "work.group", op, ...a }),
    // the order is shown at once; the engine's list comes back with the next work.sessions
    setOrder: (keys: string[]) => { setOrderS(keys); send({ type: "work.order", keys }); },
    folder: (op: "add" | "hide" | "show", path: string) => send({ type: "work.folder", op, path }),
    // the real folder renamed on the disk (#181): the reason when refused, else where it went and the files that still say the old place
    renameFolder: (path: string, name: string) => ask<FolderRenamed>("work.folder", { op: "rename", path, name }, 60_000),
    del: (id: string) => send({ type: "work.delete", sessionId: id }),
    fork: (id: string, upTo?: string) => send({ type: "work.fork", sessionId: id, upTo }),
    // a message queued behind the running turn: read at its next step, or forgotten (#51)
    readNow: (id: string, item: string) => send({ type: "work.readnow", sessionId: id, id: item }),
    drop: (id: string, item: string) => send({ type: "work.drop", sessionId: id, id: item }),
    // a session open elsewhere goes on in a new one here (the engine answers work.forked, which opens it)
    forkHere: (id: string, text = "", files: FileOut[] = []) => {
      const rid = uuid();
      forkSay.current = text.trim() || files.length ? { from: id, rid, say: { text, files, model, effort, mode, fast } } : null;
      send({ type: "work.forkhere", sessionId: id, rid });
    },
    reconcile: (id: string, keep: string, other: string, how: "fold" | "fork") => send({ type: "work.reconcile", sessionId: id, keep, other, how }),
    // a proposal card's session, started now (nested under the one that proposed it)
    start: (a: { from: string; title?: string; prompt?: string; cwd?: string; fork?: boolean; worktree?: boolean; card?: string }) =>
      ask<{ sessionId?: string; error?: string }>("work.start", a, 60_000),
    view: (id: string | null) => { send({ type: "work.view", sessionId: id }); },   // void: an effect cleanup calls it
    // a new aside replaces the open one: the old answer's late words are dropped
    aside: (text: string, id = live) => {
      if (!id || !text.trim()) return false;
      setAsides((a) => { if (a[id]) dropped.current.add(a[id].id); const n = { ...a }; delete n[id]; return n; });
      send({ type: "work.aside", sessionId: id, text });
      return true;
    },
    // the paths under a folder that fit what follows @ (q "" checks that the folder is there)
    files: (cwd: string, q: string): Promise<Files> => ask<any>("work.files", { cwd, q }, 6000).then((r) => ({ files: r.files ?? [], missing: !!r.missing, cwd: r.cwd })),
    peek: (id: string) => { beside.current.add(id); retrim(); send({ type: "work.peek", sessionId: id }); },
    unpeek: (id: string) => { beside.current.delete(id); retrim(); },   // its items go now
    term: (type: "in" | "size" | "close" | "list", a: object = {}) => send({ type: `work.term.${type}`, ...a }),
    // Codex reviews the session's change in this folder and scope (review.ts on the engine); its remarks come as items
    review: (cwd: string, scope: string, id = live) => id ? ask<{ round?: string; error?: string }>("work.review", { sessionId: id, cwd, scope }, 30_000) : Promise.resolve({ error: "a new session has no change yet" }),
    reviewStop: (id = live) => id && send({ type: "work.review", sessionId: id, stop: true }),
    reviewMark: (item: string, state: "sent" | "dismissed", id = live) => id && send({ type: "work.review.mark", sessionId: id, id: item, state }),
    dropAside: (id = live) => id && setAsides((a) => { if (a[id]) dropped.current.add(a[id].id); const n = { ...a }; delete n[id]; return n; }),
    setPref: (patch: SidePrefs) => { setPrefsS((p) => ({ ...p, ...patch })); void ask<{ prefs?: SidePrefs }>("work.prefs", { patch }).then((r) => keepPrefs(r.prefs)); },
  }), [send, live, ask, model, effort, mode, fast, keepPrefs, retrim]);

  const thread = live ? threads[live] : undefined;
  const run = live ? runs[live] : undefined;
  return {
    loaded, sessions, projects, groups, order, prefs, runs, threads, current, live, thread, run, freshCwd, setFreshCwd, terms, ask, sayTo, solo, copy, setCopy,
    model: run?.model ?? model, effort: run?.effort ?? effort, mode: run?.mode ?? mode, fast: run?.fast ?? fast,
    send2adjust, error, unsent, sideAnswer: live ? asides[live] : undefined, open: openId, fresh, say, adjust, ...act,
  };
}
export type Work = ReturnType<typeof useWork>;

// the same hook's face for another session (the one beside): its thread and run, its questions answered for it
export function scoped(w: Work, id: string): Work {
  return {
    ...w, live: id, current: id, thread: w.threads[id], run: w.runs[id],
    model: w.runs[id]?.model ?? w.model, effort: w.runs[id]?.effort ?? w.effort, mode: w.runs[id]?.mode ?? w.mode, fast: w.runs[id]?.fast ?? w.fast,
    say: (text: string, files?: FileOut[]) => w.sayTo(id, text, files),
    stop: () => w.stop(id), perm: (pid: string, a: object) => w.perm(pid, a, id),
    adjust: (p) => w.send2adjust(id, p),
    review: (cwd: string, scope: string) => w.review(cwd, scope, id), reviewStop: () => w.reviewStop(id),
    reviewMark: (item: string, state: "sent" | "dismissed") => w.reviewMark(item, state, id),
  };
}
