// A thing opened inside Sol (#236; the studio PRD §4.5, §9.8; POLICY.md §2): the face's side of the shell's child web
// views (src-tauri/src/thing.rs). The page itself is native, drawn over the pane the face measures; the face only
// says where the pane is, which tab is shown, and hears which address a tab is at and what the shell refused. Nothing
// of the page (its cookies, its words, its title, the query of an address) ever comes here, and so nothing of it can reach the engine: the one
// message the face sends about a thing is `team.thing.focus { id, focused }` (focusMsg, tested).
// Outside the app (a browser on `?dev=team`) there is no shell: the pane draws a stand-in and says so.
import { useEffect, useSyncExternalStore } from "react";

export const inShell = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** the one message about a thing that leaves the face: which thing, in front or not. Pure */
export const focusMsg = (id: string, focused: boolean) => ({ id, focused });

/** a face in front says so again this often; the engine lets a thing go 10 minutes after the last word (FRONT_MS) */
export const FOCUS_AGAIN_MS = 4 * 60_000;

/** the origin the pane's bar shows: the host of an https page, in full; anything else as it is. Pure */
export function originOf(url: string): string {
  try { const u = new URL(url); return u.protocol === "https:" ? u.host : u.protocol === "about:" ? "" : `${u.protocol}//${u.host}`; } catch { return url; }
}

/** a tab's name in the shell: the thing's id for its first tab, then id.2, id.3 (thing.rs takes [a-z0-9.-] only). Pure */
export const tabOf = (thing: string, n: number) => (n <= 1 ? thing : `${thing}.${n}`);
/** an extra tab's number: never one used before in this face, so a tab closed late is never shown again for a new link */
let tabs = 1;
export const nextTab = () => ++tabs;

/** a thing kind opens inside Sol; a repository opens its cards (the repo page) instead. Pure */
export const opensInside = (kind: string) => kind !== "github";

// ---- the shell's commands ----
const call = async <T = void>(cmd: string, args: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
};
export type Box = { x: number; y: number; w: number; h: number };
const at = (b: Box) => ({ x: b.x, y: b.y, w: Math.max(1, b.w), h: Math.max(1, b.h), innerH: window.innerHeight });
export const shell = {
  open: (tab: string, url: string, site: string, b: Box, show = true, kept?: number) => call("thing_open", { tab, url, site, show, ...(kept ? { kept } : {}), ...at(b) }),
  /** the browser, on a press: a kept link by its number, or the page a tab is at now (thing.rs thing_outside) */
  outside: (to: { id: number } | { tab: string }) => call("thing_outside", to),
  show: (tab: string) => call("thing_show", { tab }),
  /** one tab shown or hidden, the others left as they are (GitHub's sign-up, #252) */
  only: (tab: string, on: boolean) => call("thing_show", { tab, only: on ? "show" : "hide" }),
  /** every thing's tab follows the pane; GitHub's sign-up (#252) only when named, and only it */
  bounds: (b: Box, tab?: string) => call("thing_bounds", { ...at(b), ...(tab ? { tab } : {}) }),
  close: (tab = "") => call("thing_close", { tab }),
  reload: (tab: string) => call("thing_nav", { tab, reload: true }),
  home: (tab: string, url: string) => call("thing_nav", { tab, reload: false, url }),
  signOut: () => call("sites_sign_out", {}),
  clear: () => call("sites_clear", {}),
};
// addresses come as origin and path only; a full one stays in the shell, named by `id` (thing.rs `shown`, `keep`)
export type ShellNote = { tab: string; url?: string; load?: string; refused?: string; open?: string; outside?: string; download?: string; id?: number; cleared?: boolean };
/** what the shell says about the tabs (thing.rs `tell`): an address, a refusal, a new window asked for */
export async function onShell(f: (n: ShellNote) => void): Promise<() => void> {
  if (!inShell()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ShellNote>("thing", (e) => f(e.payload));
}

// ---- covers: something of the face drawn over the pane (a popover, the floating side) ----
// A native view is always above the page, so while anything covers the pane the page is hidden, never drawn over it.
// Each cover has a kind ("" for most); GitHub's sign-up pane (#252) steps aside only for kinds other than its own and
// the side's.
const covers = new Map<string, number>();
const subs = new Set<() => void>();
const bump = (kind: string, d: number) => { covers.set(kind, Math.max(0, (covers.get(kind) ?? 0) + d)); subs.forEach((f) => f()); };
const count = (skip: string[] = []) => [...covers].reduce((n, [k, v]) => (skip.includes(k) ? n : n + v), 0);
/** while `on`, the thing's page steps aside for what the face draws over it */
export function useCover(on: boolean, kind = "") {
  useEffect(() => { if (!on) return; bump(kind, 1); return () => bump(kind, -1); }, [on, kind]);
}
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useCovered = () => useSyncExternalStore(sub, () => count() > 0);
/** covered by anything but these kinds, now (outside React) */
export const coveredBy = (skip: string[]) => count(skip) > 0;
/** covered by anything but these kinds */
export const useCoveredBy = (skip: string[]) => useSyncExternalStore(sub, () => count(skip) > 0);
