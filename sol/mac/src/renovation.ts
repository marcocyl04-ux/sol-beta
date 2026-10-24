// What of Sol's face is being changed right now, and the pings Sol sent Marco (issue #15). One small store per page
// (main, notch, island), on the page's one link to the engine (socket.ts), so it lives on when the part under work breaks and
// whichever mode is showing: Life or Work, hot or bundled.
//
// Fed by three things. The engine's `changing` events (engine/src/changing.ts): an edit's start tapes its site, a mutate
// or an undo that went through peels the sites its commit touched, the turn's end peels whatever is left. Vite's HMR
// (hot.ts): an update that lands makes its sites shimmer once, a compile error goes to the taped site whose file it
// names. The boundaries (Site.tsx): a part that throws mid-change shows broken until the next update mends it; the
// window it broke in tells the engine (face.broken, face.mended), which takes a recent face edit back if it stays broken.
// And the engine's `notify` / `notify.clear`: the pings Marco has not seen yet, for the notch and the side's rows.
//
// Cleared on launch and on reconnect (the engine has no memory of what was taped); a broken part stays broken, that
// is this page's own state. Part of the fence: the seat never edits this file (home/CLAUDE.md).
import { useSyncExternalStore } from "react";
import { siteOf, type SiteName } from "./sites";
import { LANES, seatEnds, seatName, type RGB } from "./creature/ring";
import { CREATURE, FUNCTIONAL, GRADIENTS } from "./creature/palette";
import { link } from "./socket";
import { ENGINE } from "./engine";   // the one pick (fenced), the same engine useEngine and the away page dial

export type State = "taped" | "landing" | "broken" | "peeling";
export type Entry = {
  site: SiteName; seat: string; sessionId?: string; since: number; files: string[]; state: State;
  line: string;          // the corner's words (empty: the default for the state)
  error?: string;        // a compile error or a render error, its first line
  landAt?: number;       // a shimmer started then (an update landed)
  peelAt?: number;       // the tape comes off from then, cell by cell
  colours: [RGB, RGB];   // the stripes: the seat's slice, or a helper's lane colour
  transient?: boolean;   // a shimmer without tape (a change landed that no seat announced)
};
export type Ping = { id: string; seat: string; sessionId?: string; line: string; at: number };
export type Snapshot = {
  sites: ReadonlyMap<SiteName, Entry>;
  pings: readonly Ping[];      // unseen, oldest first
  mark: number;                // the notch: pings that went to the phone, not seen yet (a count, no text)
  crew: string;                // what the notch says while the crew is down (Sol's words from the events)
  note: string;                // the last thing with no site to go to (a compile error, a page error): the engine drawer
  gen: number;                 // goes up with every HMR update that landed: a broken part tries again
  up: boolean;
};

export const LAND_MS = 1400, PEEL_MS = 900;
const ZERO: Snapshot = { sites: new Map(), pings: [], mark: 0, crew: "", note: "", gen: 0, up: false };
let snap: Snapshot = ZERO;
const subs = new Set<() => void>();
function set(patch: Partial<Snapshot>) { snap = { ...snap, ...patch }; for (const f of subs) f(); }
const withSite = (e: Entry | null, site: SiteName) => { const m = new Map(snap.sites); if (e) m.set(site, e); else m.delete(site); return m; };
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const current = () => snap;
export function useRenovation(): Snapshot { return useSyncExternalStore(subscribe, current, current); }
// read-only, for a look from outside (the tests of issue #15, the devtools): what is taped, broken, pinged
if (typeof window !== "undefined") (window as unknown as { __solRenovation?: { current: () => Snapshot } }).__solRenovation = { current };

// the stripes' colours: the first session at work wears its seat's gradient ends (home candy/heart, work sun/orange),
// every other one a lane colour of its own (ring.ts LANES)
function coloursFor(seat: string, sessionId?: string): [RGB, RGB] {
  for (const e of snap.sites.values()) if (!e.transient && e.sessionId === sessionId && e.seat === seat) return e.colours;
  const others = new Set([...snap.sites.values()].filter((e) => !e.transient).map((e) => `${e.seat}:${e.sessionId}`));
  if (others.size === 0) {
    return seatEnds(seatName(seat));
  }
  const c = LANES[(others.size - 1) % LANES.length];
  return [c, c];
}
const base = (f: string) => f.split("/").pop() ?? f;
const first = (s: string, n = 96) => { const t = (s.split("\n").find((x) => x.trim()) ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

// ---- timers: a landing settles, a peel ends, the store forgets ----
const timers = new Map<SiteName, number>();
function later(site: SiteName, ms: number, fn: () => void) {
  window.clearTimeout(timers.get(site));
  timers.set(site, window.setTimeout(() => { timers.delete(site); fn(); }, Math.max(0, ms)));
}
function peel(site: SiteName, line?: string) {
  const e = snap.sites.get(site);
  if (!e || e.state === "broken") return;   // a broken part keeps its tape until it is mended
  const now = performance.now();
  const at = Math.max(now, (e.landAt ?? 0) + LAND_MS);   // a shimmer still playing finishes first
  set({ sites: withSite({ ...e, state: "peeling", peelAt: at, line: line ?? e.line }, site) });
  later(site, at - now + PEEL_MS, () => {
    const x = snap.sites.get(site);
    if (x?.state === "peeling") set({ sites: withSite(null, site), crew: [...snap.sites.values()].some((y) => y.site !== site && y.state !== "peeling") ? snap.crew : "" });
  });
}
function tape(site: SiteName, seat: string, sessionId: string | undefined, file: string | undefined, line: string) {
  const e = snap.sites.get(site);
  const files = e ? [...new Set([...e.files, ...(file ? [file] : [])])] : file ? [file] : [];
  if (e && !e.transient) {
    set({ sites: withSite({ ...e, files, line: line || (e.state === "peeling" ? "" : e.line), state: e.state === "peeling" ? "taped" : e.state, peelAt: undefined }, site) });
    window.clearTimeout(timers.get(site));
    return;
  }
  set({ sites: withSite({ site, seat, sessionId, since: Date.now(), files, state: "taped", line, colours: coloursFor(seat, sessionId) }, site) });
}

// ---- the engine's events ----
export function feed(m: any) {
  if (!m || typeof m.type !== "string") return;
  if (m.type === "notify" || m.type === "notify.dot") {   // a dot: the window's sidebar only, for a ping that went elsewhere
    if (snap.pings.some((p) => p.id === m.id)) return;
    set({ pings: [...snap.pings, { id: String(m.id), seat: String(m.seat ?? "codex"), sessionId: m.sessionId ? String(m.sessionId) : undefined, line: String(m.line ?? ""), at: Number(m.at) || Date.now() }] });
    return;
  }
  if (m.type === "notify.clear") { set({ pings: snap.pings.filter((p) => p.id !== m.id) }); return; }
  if (m.type === "notify.mark") { set({ mark: Number(m.count) || 0 }); return; }
  if (m.type !== "changing") return;
  const seat = String(m.seat ?? "claude"), sessionId = m.sessionId ? String(m.sessionId) : undefined, line = String(m.line ?? "");
  if (m.kind === "edit") {
    const site = siteOf(String(m.file ?? ""));
    if (!site) return;
    if (!m.done) {
      tape(site, seat, sessionId, String(m.file), line);
      set({ crew: line || `changing ${base(String(m.file))}` });
    }
    return;
  }
  if (m.kind === "mutate" || m.kind === "undo") {
    if (!m.done) { if (line) set({ crew: line }); return; }
    if (!m.ok) return;   // refused: the tape stays, the seat goes on
    const files: string[] = Array.isArray(m.files) ? m.files.map(String) : [];
    const sites = new Set(files.map(siteOf).filter((s): s is SiteName => !!s));
    // undo is a forward change: what it touches is taped now, shimmers when Vite lands it, then peels
    if (m.kind === "undo") for (const s of sites) if (!snap.sites.has(s) || snap.sites.get(s)!.transient) tape(s, seat, sessionId, undefined, line);
    set({ crew: line || snap.crew });
    for (const s of sites) peel(s, line);
    return;
  }
  if (m.kind === "turn") {
    for (const e of snap.sites.values()) {
      if (e.transient || e.state === "peeling" || e.state === "broken") continue;
      if (e.sessionId !== sessionId) continue;
      peel(e.site, e.files.length ? "changed, not kept" : "");
    }
  }
}

// ---- Vite's side (hot.ts) ----
export function landed(paths: string[]) {
  const now = performance.now();
  const sites = new Set(paths.map(siteOf).filter((s): s is SiteName => !!s));
  const next = new Map(snap.sites);
  for (const s of sites) {
    const e = next.get(s);
    if (e) next.set(s, { ...e, state: e.state === "broken" || e.state === "peeling" ? e.state : "landing", landAt: now, error: e.state === "broken" ? e.error : undefined });
    else next.set(s, { site: s, seat: "", since: Date.now(), files: [], state: "landing", line: "", landAt: now, colours: [CREATURE.sun, CREATURE.orange], transient: true });
    later(s, LAND_MS, () => {
      const x = snap.sites.get(s);
      if (!x) return;
      if (x.transient) set({ sites: withSite(null, s) });
      else if (x.state === "landing") set({ sites: withSite({ ...x, state: "taped" }, s) });
    });
  }
  set({ sites: next });
  // a broken part tries again once React Refresh has swapped the new code in (it runs a beat after vite:afterUpdate;
  // tried at once, the part would rerun its old, throwing self and stay broken)
  window.setTimeout(() => set({ gen: snap.gen + 1 }), 150);
}
export function compileError(file: string, message: string) {
  const site = file ? siteOf(file) : null;
  const e = site ? snap.sites.get(site) : undefined;
  if (site && e && !e.transient) set({ sites: withSite({ ...e, error: first(message) }, site) });
  else set({ note: `${file ? base(file) + ": " : ""}${first(message)}` });
}
export function pageError(message: string) { set({ note: first(message) }); }

// ---- the boundaries (Site.tsx) ----
// a part that breaks in one window is news for the others too (the notch's crew turns to Marco): told over a
// BroadcastChannel, and Tauri's event for webviews that do not share one; a window never re-tells what it heard
const PARTS = "sol-renovation";
let partCh: BroadcastChannel | null = null;
function tell(m: { kind: "broke" | "mended"; site: SiteName; message?: string; from: string }) {
  try { partCh?.postMessage(m); } catch { /* none */ }
  if ((window as any).__TAURI_INTERNALS__) import("@tauri-apps/api/event").then((ev) => ev.emit(PARTS, m)).catch(() => {});
}
const ME = Math.random().toString(36).slice(2);
function heard(m: any) {
  if (!m || m.from === ME || typeof m.site !== "string") return;
  if (m.kind === "broke") broke(m.site, String(m.message ?? ""), true);
  else if (m.kind === "mended") mended(m.site, true);
}
// returns its own undoing (the channel closed, the Tauri listener removed, even if it was still being set up)
function listenParts(): () => void {
  try { partCh = new BroadcastChannel(PARTS); partCh.onmessage = (e) => heard(e.data); } catch { /* none */ }
  let off: (() => void) | null = null, gone = false;
  if ((window as any).__TAURI_INTERNALS__) import("@tauri-apps/api/event").then((ev) => ev.listen(PARTS, (e) => heard(e.payload))).then((f) => { if (gone) f(); else off = f; }).catch(() => {});
  return () => { gone = true; partCh?.close(); partCh = null; off?.(); };
}
// the parts that broke in this window (not heard from another): this window is the one that tells the engine
const mine = new Set<SiteName>();
export function broke(site: SiteName, message: string, told = false) {
  if (!told) { tell({ kind: "broke", site, message, from: ME }); mine.add(site); send({ type: "face.broken", site, error: first(message) }); }
  const e = snap.sites.get(site);
  window.clearTimeout(timers.get(site));
  set({
    sites: withSite(e ? { ...e, state: "broken", error: first(message), transient: false, peelAt: undefined }
      : { site, seat: "", since: Date.now(), files: [], state: "broken", line: "", error: first(message), colours: [FUNCTIONAL.red.strong, FUNCTIONAL.red.soft] }, site),
    crew: "broke it, fixing",
  });
}
export function mended(site: SiteName, told = false) {
  if (!told) tell({ kind: "mended", site, from: ME });
  const e = snap.sites.get(site);
  if (e?.state !== "broken") return;
  if (mine.delete(site)) send({ type: "face.mended", site });
  if (!e.seat) { set({ sites: withSite(null, site) }); return; }   // nobody announced it: nothing left to peel
  set({ sites: withSite({ ...e, state: "taped", error: undefined, landAt: performance.now() }, site) });
}

// a full reload is coming (vite:beforeFullReload): the page says so for a breath when it is back
const RELOADED = "sol.reloaded";
export function reloading() { try { sessionStorage.setItem(RELOADED, String(Date.now())); } catch { /* private */ } }
function welcomeBack() {
  let at = 0;
  try { at = Number(sessionStorage.getItem(RELOADED)) || 0; sessionStorage.removeItem(RELOADED); } catch { /* private */ }
  if (!at || Date.now() - at > 15_000) return;
  const now = performance.now();
  snap = { ...snap, sites: withSite({ site: "face", seat: "", since: Date.now(), files: [], state: "landing", line: "whole face reloaded", landAt: now, colours: [CREATURE.sun, CREATURE.orange], transient: true }, "face") };
  later("face", LAND_MS + 600, () => set({ sites: withSite(null, "face") }));
}

// ---- pings ----
// seen: here and on every other window (the engine clears it everywhere)
export function seen(id: string) { send({ type: "notify.seen", id }); set({ pings: snap.pings.filter((p) => p.id !== id) }); }
// a conversation opened in the main window: its pings are seen
export function seenSession(sessionId?: string) { if (sessionId) for (const p of snap.pings) if (p.sessionId === sessionId) seen(p.id); }
// the notch asks the main window to open a ping's conversation (BroadcastChannel; Tauri's event too, for webviews that
// do not share one). The main window listens with onOpenAsk.
// One thread upstream (Notch buttons #6): `itemId` is the engine item the notch showed (a perm item, a ping); the window
// scrolls to the row carrying data-item="<itemId>" (or, for a ping, the row that made it: data-ping="<line>") and
// highlights it. `id` only makes each ask unique (a ping's id, or an ask's id and a moment).
const ASK = "sol-open";
export type OpenAsk = { seat: string; sessionId?: string; id: string; itemId?: string; line?: string };
export function askOpen(p: OpenAsk) {
  const msg: OpenAsk = { seat: p.seat, sessionId: p.sessionId, id: p.id, ...(p.itemId ? { itemId: p.itemId } : {}), ...(p.line ? { line: p.line } : {}) };
  try { const ch = new BroadcastChannel(ASK); ch.postMessage(msg); ch.close(); } catch { /* no channel */ }
  if ((window as any).__TAURI_INTERNALS__) import("@tauri-apps/api/event").then((ev) => ev.emit(ASK, msg)).catch(() => {});
}
export function onOpenAsk(fn: (m: OpenAsk) => void): () => void {
  const seenIds = new Set<string>();
  const once = (m: any) => { if (!m?.id || seenIds.has(m.id)) return; seenIds.add(m.id); fn(m); };
  let ch: BroadcastChannel | null = null;
  try { ch = new BroadcastChannel(ASK); ch.onmessage = (e) => once(e.data); } catch { /* none */ }
  let off: (() => void) | null = null, gone = false;
  if ((window as any).__TAURI_INTERNALS__) import("@tauri-apps/api/event").then((ev) => ev.listen(ASK, (e) => once(e.payload))).then((f) => { if (gone) f(); else off = f; }).catch(() => {});
  return () => { gone = true; ch?.close(); off?.(); };
}
// the colour a ping lights in: its seat's first colour (home candy, work sun); the word in front says the seat too
// the seat that said it, always in front of its words (#11, 2026-10-17): a steered seat cannot pass a ping off as Sol's
export const pingMark = (p: Ping) => (seatName(p.seat) === "work" ? "Session" : "Chat");   // both in Home since #132
export const pingLine = (p: Ping) => `${pingMark(p)}: ${p.line}`;
export function pingColour(p: Ping): RGB {
  return GRADIENTS[seatName(p.seat)][0];
}

// ---- the socket ----
// the page's one link to the engine (socket.ts), shared with useEngine / useNotch: one socket per window
const wire = typeof window === "undefined" || typeof WebSocket === "undefined" ? null : link(ENGINE);
// true when it left: false while the socket is down (nothing is queued), so a press can say it did not go (the notch)
function send(o: object): boolean { return wire?.send(o) ?? false; }
export const wireSend = send;
// Which face this page is: pings are routed by it (engine/src/ping.ts). The notch and island pages are the notch.
export const FACE: "window" | "notch" | "phone" = typeof location === "undefined" ? "window" : location.pathname.includes("notch") ? "notch" : location.pathname.includes("away") ? "phone" : "window";
// The creature (creature/state.ts) listens here: this page's link, and the engine's creature/engine messages.
type WireEvent = { link: boolean } | { msg: any };
const wireSubs = new Set<(e: WireEvent) => void>();
let linked = false;
// the engine's standing word since this link opened (engine phase, creature state, ask, turn), the newest of each type:
// a listener that comes late (the app is loaded after the socket opens, main.tsx) hears it too, not only the link
const standing = new Map<string, any>();
const STANDING = new Set(["engine", "creature.state", "creature.ask", "creature.turn"]);
export function onWire(f: (e: WireEvent) => void) {
  wireSubs.add(f); f({ link: linked });
  if (linked) for (const msg of standing.values()) f({ msg });
  return () => { wireSubs.delete(f); };
}
const tellWire = (e: WireEvent) => {
  if ("link" in e) { linked = e.link; standing.clear(); }
  else if (STANDING.has(e.msg?.type)) standing.set(e.msg.type, e.msg);
  for (const f of wireSubs) f(e);
};
let started = false;
// start() wires this page; stop() unwires it all (its listeners on the link, the part listeners), for a hot reload of
// this module (import.meta.hot.dispose below) or a page going away. The link itself stays: other hooks share it.
let stop: () => void = () => {};
export function start() {
  if (started || !wire) return;
  started = true;
  welcomeBack();
  const unParts = listenParts();
  const onError = (e: ErrorEvent) => pageError(e.message || "an error on the page");
  const onReject = (e: PromiseRejectionEvent) => pageError(String((e.reason as Error)?.message ?? e.reason ?? "a promise failed"));
  const offLink = wire.onLink((up) => {
    if (!up) { if (snap.up) { set({ up: false }); tellWire({ link: false }); } return; }
    // what was taped before is unknown now; a broken part stays
    const kept = new Map([...snap.sites].filter(([, e]) => e.state === "broken" || e.transient));
    set({ up: true, sites: kept, pings: [], mark: 0, crew: kept.size ? snap.crew : "" });
    send({ type: "hello", face: FACE });
    tellWire({ link: true });
    for (const site of mine) send({ type: "face.broken", site, error: snap.sites.get(site)?.error ?? "" });   // a new engine knows nothing of it
  });
  const offMsg = wire.on((m) => {
    const t = typeof m?.type === "string" ? m.type : "";
    if (t.startsWith("creature.") || t === "engine") { tellWire({ msg: m }); return; }
    if (t === "changing" || t.startsWith("notify")) feed(m);   // the rest is useEngine's
  });
  stop = () => {
    started = false;
    offLink(); offMsg();
    unParts();
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onReject);
    for (const t of timers.values()) window.clearTimeout(t);
    timers.clear();
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onReject);
}
// this module hot-reloaded (it is in the fence, so only by hand): the old copy lets go of everything before the new starts
if (import.meta.hot) import.meta.hot.dispose(() => stop());
