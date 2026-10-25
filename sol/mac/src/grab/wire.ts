// The sheet's wire (Grab and Shelf; sol/README.md "Grab and Shelf"): the one socket to the engine, a small
// rid wait like cowork/stable.ts teamAsk, the two lists the sheet follows (threads, the shelf), the Tauri bridge
// (invoke, the "grab-open" event, Page's scroll and its letting the pointer through) and the stand-ins for ?dev=1.
//
// ?dev=1 works only outside Sol.app (a browser, `vite preview`, the stills): inside the app there is always a bridge,
// and then the query is ignored, so a stray ?dev=1 can never fake a send. Under dev nothing is sent: the windows, the
// picture, six sessions and twelve shelf things are made up here, and every ask answers after a short pause. Page's
// stand-in is a made-up tall web page behind three made-up windows: a "scroll" moves down it and each take is the
// screen at that point, so the real stitcher runs on it.
import { link, type Link } from "../socket";
import { ENGINE, NEXT, sameEngine } from "../engine";
import { CELLS, EYES, LET } from "../Mark";

// `tucked`: put aside in Stage Manager's strip, drawn by macOS as a leaning thumbnail (frame.ts draws the frame to match)
export type SolWindow = { id: number | string; title: string; x: number; y: number; w: number; h: number; kind: "window" | "notch" | "island"; tucked?: boolean };
export type PageWindow = { id: number | string; owner: string; title: string; x: number; y: number; w: number; h: number; tucked?: boolean };
export type Mode = "sol" | "page" | "shelf";
export type Item = { id: string; kind: "shot" | "sol" | "page" | "file"; name: string; mime: string; at: string; kept: boolean; url: string; w?: number; h?: number };
export type Thread = { seat: string; sessionId: string; title?: string; door?: string; at?: string | number; updatedAt?: string | number };
export type FileIn = { name: string; mime: string; dataBase64: string };
export type Answer<T> = T & { error?: string };

const q = new URLSearchParams(location.search);
const bridge = !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
export const DEV = q.get("dev") === "1" && !bridge;
export const DEV_ROOM = DEV ? q.get("room") : null;
export const FIRST_MODE: Mode = q.get("mode") === "shelf" || DEV_ROOM === "tray" ? "shelf" : q.get("mode") === "page" || DEV_ROOM === "page" || DEV_ROOM === "permit" || DEV_ROOM === "permit-screen" ? "page" : "sol";
const modeOf = (m: unknown): Mode => (m === "shelf" || m === "page" ? m : "sol");

// ---- the bridge: invoke and the window's own events, both silent when there is no app ----
export async function call<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!bridge) return null;
  try { const { invoke } = await import("@tauri-apps/api/core"); return await invoke<T>(cmd, args); } catch { return null; }
}
export const log = (line: string) => { void call("face_log", { line: `[grab] ${line}` }); };
/** the "grab-open" event, heard on this window only (a plain listen() would hear the other windows' too) */
export function onOpen(f: (mode: Mode) => void): () => void {
  if (!bridge) return () => {};
  let off: (() => void) | null = null, gone = false;
  void import("@tauri-apps/api/webviewWindow").then(async ({ getCurrentWebviewWindow }) => {
    const u = await getCurrentWebviewWindow().listen<{ mode?: string }>("grab-open", (e) => f(modeOf(e.payload?.mode)));
    if (gone) u(); else off = u;
  }).catch(() => {});
  return () => { gone = true; off?.(); };
}
/** hide the sheet (the native command); outside the app only a line in the console */
export const hide = (mode: string) => { if (bridge) void call("grab_sheet", { mode, open: false }); else console.info("[grab] would hide"); };

// ---- Page: the wheel, and the sheet letting the pointer through ----
/** move the pointer to (x, y) (global points, the sheet's own) and scroll there by dy points (0: only move it); the
 *  app's page_scroll. Null when it went, else what went wrong in plain words. Under dev it walks the made-up page. */
export async function scroll(x: number, y: number, dy: number): Promise<string | null> {
  if (DEV) { devPageTop = Math.max(0, Math.min(devPageMax(), devPageTop + dy)); return null; }
  if (!bridge) return "scrolling needs Sol.app";
  try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("page_scroll", { x, y, dy }); return null; }
  catch (e) { return String(e); }
}
/** while Page scrolls, the sheet lets every click and wheel through to the window under it (and back after) */
/** where the pointer is, in points, for the log (Page checks its warp landed) */
export async function pointer(): Promise<string> {
  if (!bridge) return "(no bridge)";
  try { const { cursorPosition } = await import("@tauri-apps/api/window"); const p = await cursorPosition(); const k = devicePixelRatio || 1; return `${Math.round(p.x / k)},${Math.round(p.y / k)}`; }
  catch (e) { return `(unknown: ${e})`; }
}

export async function passThrough(on: boolean): Promise<void> {
  if (!bridge) return;
  try { const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow"); await getCurrentWebviewWindow().setIgnoreCursorEvents(on); }
  catch (e) { log(`pass through ${on}: ${e}`); }
}

// ---- the permissions guide (Permit.tsx): is it granted yet, and open the right System Settings pane ----
export type Permission = "accessibility" | "screen";
/** the error page_scroll gives when Sol is not trusted for Accessibility (grab.rs) */
export const needsAccessibility = (err: string | null) => !!err && /Accessibility/.test(err);
/** granted yet? Accessibility is the app's own (permit_state); Screen Recording is the engine's, so the caller's own
 *  test is used for it (a fresh take that is not blank). Under dev both flip to yes 6 s after Open was pressed. */
export async function granted(which: Permission, test: () => Promise<boolean>): Promise<boolean> {
  if (DEV) return devGrantAt > 0 && Date.now() >= devGrantAt;
  if (which === "accessibility") return !!(await call<{ accessibility?: boolean }>("permit_state"))?.accessibility;
  return await test();
}
/** ask macOS for its prompt (Accessibility) and open System Settings at the pane; null when it went */
export async function permitOpen(which: Permission): Promise<string | null> {
  if (DEV) { devGrantAt = Date.now() + 6000; console.info(`[grab] would open System Settings: ${which}`); return null; }
  if (!bridge) return "this needs Sol.app";
  try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("permit_open", { which }); return null; }
  catch (e) { return String(e); }
}
/** the card is done: the sheet back above everything, System Settings hidden again if the guide opened it */
export async function permitBack(): Promise<void> { if (DEV) return; await call("permit_back"); }
let devGrantAt = 0;

// ---- the socket and the rid waits ----
// Two engines may be in play (One Sol): sessions live on the picked engine (ENGINE, often the NucBox), but the screen
// and the shelf are this Mac's: grab.* photographs this screen, shelf.* is this Mac's home/shelf, and team.file reads
// the shot grab.hold put in this Mac's slot. So those asks go to NEXT, the rest to ENGINE. When the pick is this Mac
// the two are the same socket (link() keeps one per address) and nothing is doubled.
let L: Link | null = null, H: Link | null = null, n = 0;
const waits = new Map<string, (m: any) => void>();
const subs = new Set<(m: any) => void>();
const HERE = /^(grab|shelf|team)\./;
const onMsg = (m: any) => {
  if (!m || typeof m.type !== "string") return;
  const w = m.rid != null ? waits.get(String(m.rid)) : undefined;
  if (w) { waits.delete(String(m.rid)); w(m); }
  for (const f of [...subs]) f(m);
};
function wire(): Link | null {
  if (DEV || typeof WebSocket === "undefined") return null;
  if (L) return L;
  L = link(ENGINE);
  L.on(onMsg);
  L.onLink((up) => { if (up) L?.send({ type: "list" }); });
  if (sameEngine(ENGINE, NEXT)) H = L;
  else { H = link(NEXT); H.on(onMsg); }
  return L;
}
/** the socket an ask goes on: this Mac's for the screen, the shelf and the tracker; the picked one for sessions */
function wireFor(type: string): Link | null { const l = wire(); return l && HERE.test(type) ? H : l; }
/** every message from the engine (threads, shelf.items) */
export function hear(f: (m: any) => void): () => void { wire(); subs.add(f); return () => { subs.delete(f); }; }
export function send(o: object): boolean { if (DEV) return true; return !!wire()?.send(o); }

/** one ask, answered by the message with the same rid; a team.* error comes back as team.error with `message` */
export function ask<T = Record<string, unknown>>(type: string, body: object = {}, ms = 30_000): Promise<Answer<T>> {
  if (DEV) return devAsk(type, body) as Promise<Answer<T>>;
  const l = wireFor(type);
  const no = (error: string) => ({ error }) as Answer<T>;
  if (!l) return Promise.resolve(no("Sol is not connected."));
  const rid = `grab-${Date.now().toString(36)}-${++n}`;
  return new Promise((res) => {
    const t = window.setTimeout(() => { waits.delete(rid); res(no("Sol did not answer.")); }, ms);
    waits.set(rid, (m) => {
      window.clearTimeout(t);
      const error = m.error ?? (String(m.type).endsWith(".error") ? m.message ?? "something went wrong" : undefined);
      res(error ? { ...m, error: String(error) } : m);
    });
    if (!l.send({ type, rid, ...body })) { window.clearTimeout(t); waits.delete(rid); res(no("Sol is not connected.")); }
  });
}

// ---- small pure helpers ----
/** "now", "2 min", "1 h", "yesterday", "3 days", else the date */
export function age(at: string | number | undefined, now = Date.now()): string {
  const t = typeof at === "number" ? at : Date.parse(String(at ?? ""));
  if (!isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  if (t >= d0.getTime()) return `${h} h`;
  if (t >= d0.getTime() - 86_400_000) return "yesterday";
  const d = Math.ceil((d0.getTime() - t) / 86_400_000);
  return d < 7 ? `${d} days` : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
/** the day a shelf thing belongs to: Today, Yesterday, a weekday in the last week, else the date */
export function dayLabel(at: string, now = Date.now()): string {
  const t = Date.parse(at), d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  if (t >= d0.getTime()) return "Today";
  if (t >= d0.getTime() - 86_400_000) return "Yesterday";
  if (t >= d0.getTime() - 6 * 86_400_000) return new Date(t).toLocaleDateString(undefined, { weekday: "long" });
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "long" });
}
/** what the day row says: when its oldest thing that is not kept leaves (the sweep's seven days) */
export function leaves(items: Item[], now = Date.now()): string {
  const left = items.filter((i) => !i.kept).map((i) => Date.parse(i.at));
  if (!left.length) return "kept";
  const d = Math.ceil((Math.min(...left) + 7 * 86_400_000 - now) / 86_400_000);
  return d <= 0 ? "leaves today" : d === 1 ? "leaves tomorrow" : `leaves in ${d} days`;
}
export const isImage = (i: Pick<Item, "mime">) => /^image\//.test(i.mime);
export const b64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);
/** a shelf thing's bytes as a data url (fetched from the engine; it answers with this page's origin) */
export async function dataUrlOf(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`the file did not come (${r.status})`);
  const blob = await r.blob();
  return await new Promise((ok, no) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = () => no(new Error("the file could not be read")); f.readAsDataURL(blob); });
}
/** the mode File it labels the issue with: the window's own pick (localStorage "sol.mode": home | cowork) */
export function fileMode(): "work" | "cowork" {
  try { return localStorage.getItem("sol.mode") === "cowork" ? "cowork" : "work"; } catch { return "work"; }
}

// ---- dev: made-up windows, a picture, sessions and a shelf ----
const pause = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const MIN = 60_000, HR = 60 * MIN, DAY = 24 * HR;
export function devWindows(): SolWindow[] {
  const W = innerWidth;
  return [
    { id: 4101, title: "Sol", x: Math.round(W * 0.38), y: 150, w: 760, h: 560, kind: "window" },
    { id: 4102, title: "Sol notch", x: Math.round(W / 2 - 220), y: 0, w: 440, h: 120, kind: "notch" },
  ];
}
/** Page's made-up desk: a browser, a notes window and a folder, front to back (the browser's place is DevDesk's) */
export function devPageWindows(): PageWindow[] {
  const W = innerWidth;
  return [
    { id: 5101, owner: "Safari", title: "The long read · Field notes", x: 80, y: 120, w: 420, h: 600 },
    { id: 5102, owner: "Notes", title: "Groceries", x: Math.round(W * 0.42), y: 170, w: 520, h: 380 },
    { id: 5103, owner: "Finder", title: "", x: Math.round(W * 0.5), y: 590, w: 600, h: 250 },
    // one put aside in Stage Manager's strip, the size macOS gives its thumbnail
    { id: 5104, owner: "Mail", title: "Inbox", x: 15, y: Math.round(innerHeight * 0.58), w: 159, h: 156, tucked: true },
  ];
}
// the made-up page behind the browser: 2.6 screens tall, a fixed bar on top; `devPageTop` is how far it is scrolled
let devPageTop = 0, devPageCanvas: HTMLCanvasElement | null = null;
const DEV_BAR = 44;
const devPageMax = () => { const w = devPageWindows()[0]; return Math.round(w.h * 1.6); };
function devPage(): HTMLCanvasElement {
  if (devPageCanvas) return devPageCanvas;
  const win = devPageWindows()[0], k = 2, W = win.w, H = win.h + devPageMax();
  const c = document.createElement("canvas"); c.width = W * k; c.height = H * k;
  const g = c.getContext("2d")!; g.scale(k, k);
  // the dev desk's own browser colours (grab.css .dev-web): paper, ink, bars
  g.fillStyle = "#f1efe9"; g.fillRect(0, 0, W, H);
  const FONT = "-apple-system, BlinkMacSystemFont, system-ui, sans-serif";
  let y = DEV_BAR + 26, seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) / 65536;
  for (let s = 1; y < H - 40; s++) {
    g.font = `600 17px ${FONT}`; g.fillStyle = "#111"; g.fillText(`Part ${s}: what the river kept`, 22, y); y += 22;
    const lines = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < lines; i++) { g.fillStyle = "#d6d4cd"; g.beginPath(); g.roundRect(22, y, (W - 44) * (0.55 + rnd() * 0.45), 7, 4); g.fill(); y += 16; }
    if (s % 2 === 0) { g.fillStyle = "#c9c6bd"; g.beginPath(); g.roundRect(22, y + 4, W - 44, 110 + Math.round(rnd() * 40), 8); g.fill(); y += 130 + Math.round(rnd() * 40); }
    y += 18;
  }
  devPageCanvas = c;
  return c;
}
/** the browser's screen now: the page from devPageTop, under its fixed bar */
function devPageShot(): { dataUrl: string; w: number; h: number } {
  const win = devPageWindows()[0], k = 2, page = devPage();
  const c = document.createElement("canvas"); c.width = win.w * k; c.height = win.h * k;
  const g = c.getContext("2d")!;
  g.drawImage(page, 0, devPageTop * k, win.w * k, win.h * k, 0, 0, win.w * k, win.h * k);
  g.scale(k, k);
  g.fillStyle = "#2a2a2a"; g.fillRect(0, 0, win.w, DEV_BAR);
  g.fillStyle = "#555"; [14, 30, 46].forEach((x) => { g.beginPath(); g.arc(x, DEV_BAR / 2, 4.5, 0, 7); g.fill(); });
  g.fillStyle = "#999"; g.font = "11px -apple-system, system-ui, sans-serif"; g.fillText("fieldnotes.example/the-long-read", 70, DEV_BAR / 2 + 4);
  return { dataUrl: c.toDataURL("image/png"), w: c.width, h: c.height };
}
/** the made-up page as a picture (DevDesk draws it in the browser window, at the top) */
export const devPageView = () => devPageShot().dataUrl;

/** a picture of a Sol window, drawn at 2x so it behaves like a real Retina shot */
export function devPicture(w = 760, h = 560, tint = 0): string {
  // the face's look (face.css): --page paper, a --side sidebar on a --line hairline, the mark, the title in --ink, Marco's
  // turns as --surface bubbles on a --line border (radius --r-l, the corner by the composer --r-s), Sol's as plain ink, the
  // composer a --surface field on a --line border
  const k = 2, c = document.createElement("canvas"); c.width = w * k; c.height = h * k;
  const g = c.getContext("2d")!; g.scale(k, k);
  const PAGE = "#1a1a1a", SIDE = "#151515", SURFACE = "#222222", RAISED = "#2a2a2a", LINE = "#303030", INK = "#ebebe8", DIM = "#9a9a97", MUTE = "#5c5c5a";
  const FONT = "-apple-system, BlinkMacSystemFont, system-ui, sans-serif";
  g.fillStyle = PAGE; g.fillRect(0, 0, w, h);
  g.fillStyle = SIDE; g.fillRect(0, 0, 200, h);
  g.fillStyle = LINE; g.fillRect(200, 0, 1, h);
  for (const m of CELLS) { g.fillStyle = `rgb(${(m.ch === "#" || m.ch === "w" ? LET.b : LET[m.ch]).join(",")})`; g.fillRect(16 + m.i * 1.5, 14 + m.j * 1.5, 1.5, 1.5); }
  for (const [i, col] of EYES) { g.fillStyle = col; g.fillRect(16 + i * 1.5, 14 + 6 * 1.5, 1.5, 1.5); }
  g.font = `600 13px ${FONT}`; g.fillStyle = INK; g.fillText("Sol", 44, 29);
  const names = ["sidebar folders", "dictate anywhere", "the shelf sweep", "untitled", "rooms stack", "notch on wake"];
  names.forEach((n, i) => {
    if (i === tint % 3) { g.fillStyle = RAISED; g.beginPath(); g.roundRect(10, 52 + i * 30, 180, 26, 6); g.fill(); }
    g.font = `13px ${FONT}`; g.fillStyle = i === tint % 3 ? INK : DIM; g.fillText(n, 22, 69 + i * 30);
  });
  g.font = `600 15px ${FONT}`; g.fillStyle = INK; g.fillText("sidebar folders", 230, 34);
  g.fillStyle = LINE; g.fillRect(201, 52, w - 201, 1);
  const me = (y: number, text: string) => {
    g.font = `13px ${FONT}`; const bw = g.measureText(text).width + 28, x = w - 24 - bw;
    g.fillStyle = SURFACE; g.strokeStyle = LINE; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x + 0.5, y + 0.5, bw, 34, [14, 14, 6, 14]); g.fill(); g.stroke();
    g.fillStyle = INK; g.fillText(text, x + 14, y + 22);
  };
  const you = (y: number, text: string) => { g.font = `13px ${FONT}`; g.fillStyle = INK; g.fillText(text, 230, y + 22); };
  me(76, "make the sidebar narrower");
  you(124, "Done: the sidebar is 240 px now, the folders fold.");
  me(178, "and the icons smaller");
  you(226, "Smaller icons: 14 px, stroke 1.6.");
  g.fillStyle = SURFACE; g.strokeStyle = LINE; g.lineWidth = 1;
  g.beginPath(); g.roundRect(230.5, h - 63.5, w - 254, 44, 14); g.fill(); g.stroke();
  g.font = `13px ${FONT}`; g.fillStyle = MUTE; g.fillText("Say something…", 246, h - 37);
  return c.toDataURL("image/png");
}
export function devThreads(now = Date.now()): Thread[] {
  return [
    { seat: "claude", sessionId: "d1", title: "sidebar folders", at: now - 2 * MIN },
    { seat: "codex", sessionId: "d2", title: "dictate anywhere", door: "notch", at: now - 64 * MIN },
    { seat: "claude", sessionId: "d3", title: "the shelf sweep", at: now - 3 * HR },
    { seat: "codex", sessionId: "d4", title: "", at: now - 26 * HR },
    { seat: "claude", sessionId: "d5", title: "rooms stack for Frank", at: now - 2 * DAY },
    { seat: "claude", sessionId: "d6", title: "why the notch flickers on wake", at: now - 4 * DAY },
  ];
}
let devShelf: Item[] | null = null;
function devItems(): Item[] {
  if (devShelf) return devShelf;
  const now = Date.now(), d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const at = (ms: number) => new Date(ms).toISOString();
  const pics = [0, 1, 2].map((t) => devPicture(480, 336, t));
  const mk = (i: number, kind: Item["kind"], name: string, mime: string, ms: number, kept = false): Item =>
    ({ id: `s${i}`, kind, name, mime, at: at(ms), kept, url: mime.startsWith("image/") ? pics[i % 3] : "", w: 960, h: 672 });
  devShelf = [
    mk(1, "sol", "sol-20261024-153012.png", "image/png", now - 4 * MIN),
    mk(2, "shot", "shot-20261024-142201.png", "image/png", now - 50 * MIN),
    mk(3, "file", "invoice-october.pdf", "application/pdf", now - 2 * HR),
    mk(4, "shot", "shot-20261024-091544.png", "image/png", Math.max(d0.getTime() + 5 * MIN, now - 5 * HR), true),
    mk(5, "sol", "sol-20261023-221000.png", "image/png", d0.getTime() - 2 * HR),
    mk(6, "file", "notes.txt", "text/plain", d0.getTime() - 5 * HR),
    mk(7, "shot", "shot-20261023-101200.png", "image/png", d0.getTime() - 13 * HR),
    mk(8, "sol", "sol-20261021-180000.png", "image/png", d0.getTime() - 2 * DAY - 6 * HR, true),
    mk(9, "shot", "shot-20261021-120000.png", "image/png", d0.getTime() - 2 * DAY - 12 * HR),
    mk(10, "file", "receipt.png", "image/png", d0.getTime() - 4 * DAY - 3 * HR),
    mk(11, "shot", "shot-20261019-090000.png", "image/png", d0.getTime() - 5 * DAY - 14 * HR),
    mk(12, "file", "contract-draft.pdf", "application/pdf", d0.getTime() - 5 * DAY - 16 * HR),
  ];
  return devShelf;
}
async function devAsk(type: string, body: any): Promise<any> {
  await pause(type === "grab.sol.take" ? 380 : type === "grab.page.take" ? 120 : 220);
  switch (type) {
    case "grab.sol.windows": return { windows: devWindows() };
    case "grab.windows": return { windows: devPageWindows() };
    case "grab.page.take": return devPageShot();
    case "shelf.add": {
      const f = body.files?.[0];
      const it: Item = { id: `dev-${Date.now().toString(36)}`, kind: body.kind ?? "file", name: f?.name ?? "file", mime: f?.mime ?? "image/png", at: new Date().toISOString(), kept: false,
        url: `data:${f?.mime ?? "image/png"};base64,${f?.dataBase64 ?? ""}` };
      devShelf = [it, ...devItems()];
      return { items: devShelf };
    }
    case "grab.sol.take": return { item: { id: "dev-take", kind: "sol", name: "sol-dev.png", mime: "image/png", at: new Date().toISOString(), kept: false, url: devPicture(), w: 1520, h: 1120 } };
    case "shelf.list": return { items: devItems() };
    case "shelf.keep": devShelf = devItems().map((i) => (i.id === body.id ? { ...i, kept: !!body.kept } : i)); return { items: devShelf };
    case "shelf.delete": devShelf = devItems().filter((i) => i.id !== body.id); return { items: devShelf };
    case "grab.hold": return { shot: "dev-shot" };
    case "team.file": await pause(500); return { number: 212, url: "https://github.com" };
    default: return { error: `dev: no stand-in for ${type}` };
  }
}
