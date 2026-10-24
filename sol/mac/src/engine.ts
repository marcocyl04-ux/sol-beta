// Which engine this page talks to: the one pick, read by useEngine, renovation and the away page.
// Before this there were three copies and they drifted: renovation never learnt "at:", so a window pointed at another
// machine wired its creature to this Mac's engine; the away page's second socket dialled 127.0.0.1, the phone itself.
//
// Two Sols (2026-10-15): "next" is this Mac's own engine, "live" is the NucBox over the tailnet (behind tailscale serve,
// which adds the owner header the engine checks). Settings picks; the pick is kept in localStorage and a reload applies it.
// Every window of the app (main, notch, island) reads the same key.
// My machines (Control, #32): any other Sol in the person's list is kept as "at:<address>"; WHICH stays "next" for an
// address on this Mac and "live" for one elsewhere, so what reads WHICH (banners, files) keeps its meaning. The list
// itself lives in the engine's team.json; the window keeps a copy (sol.machines) to pick from before it connects.
// The away page is the one page an engine serves (/away, over tailscale serve on the phone): it talks to the engine
// that served it, its own host, whatever the pick says. Dev only: ?ws=host:port on any page dials that engine.
// One Sol (#62): the default pick is "one", the NucBox first and this Mac as the backup. The main window's watch
// (oneSol.ts) writes "fallen" when the NucBox stays silent and clears it when the NucBox is back and this Mac is quiet;
// either reloads, and the words in a composer outlive it (sessionStorage). Every other window follows the key (the storage listener at the end). A stored "next" or "live" from
// before One Sol moves to "one" once; a pin set after that stays. Dev only: VITE_LIVE stands in for the far Sol.
// Part of the fence: the seat never edits this file (home/CLAUDE.md), and it imports nothing.

export type Which = "live" | "next";
export type Machine = { name: string; url: string };
export const NEXT: string = import.meta.env.VITE_ENGINE ?? "ws://127.0.0.1:7777";
const bare = (u: string) => u.trim().replace(/\/+$/, "");
export const isEngineUrl = (u: string) => /^wss?:\/\/[^\s/]+(\/\S*)?$/.test(u);
const local = (u: string) => { try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(u.replace(/^ws/, "http")).hostname); } catch { return false; } };
export function keptMachines(): Machine[] | null {
  try {
    const v = JSON.parse(localStorage.getItem("sol.machines") ?? "null");
    return Array.isArray(v) ? v.filter((m) => m && typeof m.name === "string" && typeof m.url === "string" && isEngineUrl(m.url)) : null;
  } catch { return null; }
}
// The far Sol (#169): the first machine in the person's list that is not this one. The NucBox's address used to be
// written here and so went into every copy of Sol; now the engine's team.json names it (derived from the relay) and
// the window keeps the copy. A Sol with no other machine has LIVE equal to NEXT: it dials this machine alone, and
// the "one" pick has nothing to follow.
export const FAR: Machine | null = (() => { try { return keptMachines()?.find((m) => !local(m.url)) ?? null; } catch { return null; } })();
export const LIVE: string = import.meta.env.VITE_LIVE ?? FAR?.url ?? NEXT;
export const FAR_NAME: string = FAR?.name ?? "the far Sol";
// the page an engine served: /away over http(s) (vite's dev copy is /away.html, which follows the pick)
const served = () => typeof location !== "undefined" && /^https?:$/.test(location.protocol) && /^\/away\/?$/.test(location.pathname);
const PICK = "sol.engine", FALLEN = "sol.engine.fallen", MOVED = "sol.engine.one";
const fixed = () => (import.meta.env.DEV && new URLSearchParams(location.search).get("ws")) || served();
function pick(): string {
  if (!localStorage.getItem(MOVED)) {
    const k = localStorage.getItem(PICK);
    if (k === "next" || k === "live") localStorage.setItem(PICK, "one");
    localStorage.setItem(MOVED, "1");
  }
  return localStorage.getItem(PICK) ?? "one";
}
function choose(): string {
  try {
    const q = import.meta.env.DEV ? new URLSearchParams(location.search).get("ws") : null;
    if (q) return `ws://${q}`;
    if (served()) return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/`;
    const k = pick();
    if (k === "one") return localStorage.getItem(FALLEN) ? NEXT : LIVE;
    return k === "live" ? LIVE : k.startsWith("at:") && isEngineUrl(k.slice(3)) ? k.slice(3) : NEXT;
  } catch { return NEXT; }
}
export const ENGINE: string = choose();
// "one": this window follows the NucBox-first pick; FELL: it is on this Mac because the NucBox did not answer
export const ONE: boolean = (() => { try { return !fixed() && pick() === "one" && bare(LIVE) !== bare(NEXT); } catch { return false; } })();
export const FELL: boolean = ONE && (() => { try { return !!localStorage.getItem(FALLEN); } catch { return false; } })();
// each fall within FORGET_MS of the last one doubles how long the NucBox must answer before Sol goes back (oneSol.ts),
// so a NucBox that keeps dropping out does not reload the window every half minute
const FALLS = "sol.engine.falls", FORGET_MS = 60 * 60_000;
export function falls(): number {
  try { const f = JSON.parse(localStorage.getItem(FALLS) ?? "null") as { n: number; at: number } | null; return f && Date.now() - f.at < FORGET_MS ? f.n : 0; } catch { return 0; }
}
export function fall() {
  try { localStorage.setItem(FALLS, JSON.stringify({ n: falls() + 1, at: Date.now() })); localStorage.setItem(FALLEN, String(Date.now())); } catch { /* private mode */ }
  location.reload();
}
export function rise() { try { localStorage.removeItem(FALLEN); } catch { /* private mode */ } location.reload(); }
// the same engine over http, for files and page images
export const ENGINE_HTTP = ENGINE.replace(/^ws/, "http");
export const WHICH: Which = bare(ENGINE) === bare(NEXT) || local(ENGINE) ? "next" : "live";
export const sameEngine = (a: string, b: string) => bare(a) === bare(b);
// "one", "next", "live", or a machine's address
export function pickEngine(w: Which | "one" | string) {
  const v = w === "live" || w === "next" || w === "one" ? w : sameEngine(w, LIVE) ? "live" : sameEngine(w, NEXT) ? "next" : isEngineUrl(w) ? `at:${w}` : "next";
  try { localStorage.setItem(PICK, v); localStorage.setItem(MOVED, "1"); localStorage.removeItem(FALLEN); } catch { /* private mode */ }
  location.reload();
}
export function keepMachines(list: Machine[]) { try { localStorage.setItem("sol.machines", JSON.stringify(list)); } catch { /* private mode */ } }
// another window changed the pick or fell or rose: this one follows when that moves its engine
if (typeof window !== "undefined") window.addEventListener("storage", (e) => {
  if ((e.key === PICK || e.key === FALLEN || e.key === null) && !fixed() && choose() !== ENGINE) location.reload();
});
