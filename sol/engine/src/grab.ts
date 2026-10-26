// Grab (Grab and Shelf, #200): the engine's half of the notch's Grab. Three grabs:
//   Shot: macOS's own picker (`screencapture -i`: drag a region, or space and click a window); Esc leaves no file.
//   Sol:  the sheet lists Sol's own windows (CoreGraphics, by owner, any layer, so the notch over the menu bar is one)
//         and takes the one clicked by its window id (`screencapture -l`): that window's pixels, nothing over it.
//   Page: the sheet lists every normal window of every other app (grab.windows) and, while it scrolls the one clicked,
//         asks for it again and again (grab.page.take): each picture comes straight back as a data URL, not onto the
//         shelf; the sheet stitches them into one tall picture and puts only that on the shelf (kind "page").
// Shot and Sol land on the shelf (shelf.ts). After markup the sheet sends the picture back with grab.hold: it becomes File it's
// held shot (team/file.ts), and when it came from the shelf, the shelf's file is replaced with the marked-up one.
//
// handleGrab answers every `shelf.*` and `grab.*` ask (index.ts routes them here like `team.*`): the same type and
// rid back, or { type, rid, error }. The Sol-window filter is pure and tested; nothing in a test takes a picture.
// While the eye is closed (eye.ts) Sol's windows are blank to a picture: the Sol room's two asks answer HIDDEN instead.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdShot } from "./team/file.js";
import { HIDDEN, solHidden } from "./eye.js";
import { addToShelf, deleteFromShelf, fromFileIn, keepOnShelf, listShelf, pngSize, putOnShelf, replaceOnShelf, stampOf, KINDS, type ShelfKind } from "./shelf.js";

export type CGWindow = { id: number; owner: string; title: string; layer: number; onScreen: boolean; bounds: { x: number; y: number; w: number; h: number } };
// `tucked`: the window sits in Stage Manager's strip; its bounds are the leaning thumbnail's box, not a window's
export type SolWindow = { id: number; title: string; x: number; y: number; w: number; h: number; kind: "window" | "notch" | "island"; tucked: boolean };

export type PageWindow = { id: number; owner: string; title: string; x: number; y: number; w: number; h: number; tucked: boolean };

export const SHEET_TITLE = "Sol grab";

/** Stage Manager's strip (2026-10-25): a window put aside is drawn as a leaning thumbnail, and CoreGraphics reports its
 *  bounds as that thumbnail's box, the same box as one of WindowManager's "Gesture Blocking Overlay" cells. A window
 *  whose bounds equal a cell is tucked; the sheet draws its frame leaning like the thumbnail (pure) */
const CELL = "Gesture Blocking Overlay";
export function tuckedIn(all: CGWindow[]): (w: CGWindow) => boolean {
  const cells = (Array.isArray(all) ? all : []).filter((c) => c && c.owner === "WindowManager" && c.title === CELL && c.bounds).map((c) => c.bounds);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  return (w) => cells.some((c) => near(c.x, w.bounds.x) && near(c.y, w.bounds.y) && near(c.w, w.bounds.w) && near(c.h, w.bounds.h));
}

/** Sol's windows a person can pick: owner Sol, on screen, any layer, not the sheet itself, not empty (pure) */
// The notch and the island are left out (2026-10-25): their windows are far larger than the slab Marco sees, so the
// frame the dark room drew round them never fitted; Shot covers them.
export function solWindows(all: CGWindow[], owner = "Sol"): SolWindow[] {
  const tucked = tuckedIn(all);
  return (Array.isArray(all) ? all : [])
    .filter((w) => w && w.owner === owner && w.onScreen && w.title !== SHEET_TITLE && w.title !== "Sol notch" && w.title !== "Sol island" && w.bounds && w.bounds.w > 0 && w.bounds.h > 0)
    .map((w) => ({
      id: w.id, title: w.title ?? "",
      x: w.bounds.x, y: w.bounds.y, w: w.bounds.w, h: w.bounds.h,
      kind: w.title === "Sol notch" ? "notch" : w.title === "Sol island" ? "island" : "window",
      tucked: tucked(w),
    }));
}

/** the windows Page offers: every app's normal windows (layer 0), on screen, bigger than 40 x 40, not Sol's own and
 *  never the sheet; front to back as CoreGraphics lists them (pure) */
// macOS's own furniture sits at layer 0 too and is never a page: Stage Manager's strip (WindowManager: "App Icon
// Window", "Gesture Blocking Overlay"), the Dock, the desktop's wallpaper, Control and Notification Center, Spotlight.
export const SYSTEM_OWNERS = new Set(["WindowManager", "Dock", "Window Server", "Wallpaper", "Control Center", "Notification Center", "SystemUIServer", "Spotlight", "Screenshot", "loginwindow", "universalaccessd", "TextInputMenuAgent", "CursorUIViewService"]);
export function pageWindows(all: CGWindow[], sol = "Sol"): PageWindow[] {
  const tucked = tuckedIn(all);
  return (Array.isArray(all) ? all : [])
    .filter((w) => w && w.owner && w.owner !== sol && !SYSTEM_OWNERS.has(w.owner) && w.layer === 0 && w.onScreen && w.title !== SHEET_TITLE && w.bounds && w.bounds.w > 40 && w.bounds.h > 40)
    .map((w) => ({ id: w.id, owner: w.owner, title: w.title ?? "", x: w.bounds.x, y: w.bounds.y, w: w.bounds.w, h: w.bounds.h, tucked: tucked(w) }));
}

// ---- the Mac ----
const DIR = join(tmpdir(), "sol-grab");
const run = (cmd: string, args: string[], ms = 10_000) => new Promise<string>((ok, no) =>
  execFile(cmd, args, { timeout: ms, maxBuffer: 8 * 1024 * 1024 }, (err, out, errOut) => (err ? no(new Error(String(errOut || err.message).trim().split("\n")[0])) : ok(String(out)))));
const mac = () => { if (process.platform !== "darwin") throw new Error("a grab needs the Mac"); };
const tmpPng = () => { mkdirSync(DIR, { recursive: true, mode: 0o700 }); return join(DIR, `${randomBytes(6).toString("hex")}.png`); };

// CoreGraphics through JXA: every window of `owner` (or of everyone, when owner is null), all layers, front to back,
// with the on-screen flag and its bounds, as JSON
const LIST = (owner: string | null) => `ObjC.import('CoreGraphics');
const a = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0)); const out = [];
for (let i = 0; i < a.count; i++) { const w = a.objectAtIndex(i); const u = (k) => ObjC.unwrap(w.objectForKey(k));
  if (${owner === null ? "false" : "true"} && u('kCGWindowOwnerName') !== ${JSON.stringify(owner)}) continue;
  const b = w.objectForKey('kCGWindowBounds'); const n = (k) => Number(ObjC.unwrap(b.objectForKey(k)));
  out.push({ id: Number(u('kCGWindowNumber')), owner: String(u('kCGWindowOwnerName')), title: String(u('kCGWindowName') || ''),
    layer: Number(u('kCGWindowLayer')), onScreen: !!u('kCGWindowIsOnscreen'),
    bounds: { x: n('X'), y: n('Y'), w: n('Width'), h: n('Height') } }); }
JSON.stringify(out);`;

/** CoreGraphics' window list, of one owner or of everyone */
async function cgWindows(owner: string | null): Promise<CGWindow[]> {
  mac();
  const out = (await run("osascript", ["-l", "JavaScript", "-e", LIST(owner)])).trim();
  try { const all = JSON.parse(out || "[]"); return Array.isArray(all) ? all : []; } catch { throw new Error("the window list did not read"); }
}
/** Sol's windows on screen now (everyone's list, so Stage Manager's cells are there to tell a tucked one) */
export async function listSolWindows(owner = "Sol"): Promise<SolWindow[]> {
  return solWindows(await cgWindows(null), owner);
}
/** every other app's normal windows on screen now (Page) */
export async function listPageWindows(): Promise<PageWindow[]> {
  return pageWindows(await cgWindows(null));
}

/** read the picture screencapture left, then forget the temp file; null when there is none (Esc) */
function taken(path: string): Buffer | null {
  try { return existsSync(path) ? readFileSync(path) : null; } finally { rmSync(path, { force: true }); }
}

/** Shot: macOS's own picker; the png, or null when Esc was pressed */
export async function shot(): Promise<Buffer | null> {
  mac();
  const path = tmpPng();
  // the person picks for as long as they like; Esc exits without a file (sometimes with a non-zero code)
  await run("screencapture", ["-i", "-x", "-t", "png", path], 10 * 60_000).catch(() => "");
  const buf = taken(path);
  return buf && buf.length ? buf : null;
}

/** one window by its id, its own pixels, no shadow (Sol's grab and each of Page's screens) */
export async function takeWindow(id: number): Promise<Buffer> {
  mac();
  if (!Number.isInteger(id) || id <= 0) throw new Error("which window? an id from the window list");
  const path = tmpPng();
  await run("screencapture", ["-x", "-o", "-t", "png", "-l", String(id), path]);
  const buf = taken(path);
  if (!buf?.length) throw new Error("that window could not be taken");
  return buf;
}

// ---- the wire ----
type Out = { send: (m: object) => void };
const RID = (v: unknown) => (typeof v === "string" || typeof v === "number" ? v : undefined);
const IMAGE_IN = /^data:[^;]+;base64,/;

/** every `shelf.*` and `grab.*` ask: the answer with the same type and rid, or { type, rid, error } */
export async function handleGrab(w: Out, m: any): Promise<void> {
  const rid = RID(m?.rid), type = String(m?.type ?? "");
  const reply = (o: object) => w.send({ type, ...(rid !== undefined ? { rid } : {}), ...o });
  try {
    switch (type) {
      case "shelf.list":
        return reply({ items: listShelf() });
      case "shelf.add": {
        const kind: ShelfKind = KINDS.includes(m.kind) ? m.kind : "file";
        return reply({ items: addToShelf(fromFileIn(m.files), kind).items });
      }
      case "shelf.keep":
        return reply({ items: keepOnShelf(String(m.id ?? ""), m.kept !== false) });
      case "shelf.delete":
        return reply({ items: deleteFromShelf(String(m.id ?? "")) });
      case "grab.shot": {
        const buf = await shot();
        if (!buf) return reply({ error: "cancelled" });
        return reply({ item: putOnShelf(buf, `shot-${stampOf(new Date())}.png`, "image/png", "shot") });
      }
      case "grab.sol.windows":
        if (solHidden()) return reply({ error: HIDDEN });
        return reply({ windows: await listSolWindows() });
      case "grab.sol.take": {
        if (solHidden()) return reply({ error: HIDDEN });
        const buf = await takeWindow(Number(m.id));
        return reply({ item: putOnShelf(buf, `sol-${stampOf(new Date())}.png`, "image/png", "sol") });
      }
      case "grab.windows":
        return reply({ windows: await listPageWindows() });
      case "grab.page.take": {
        // one screen of the page, straight back to the sheet (it stitches; only the whole page goes on the shelf)
        const buf = await takeWindow(Number(m.id));
        const size = pngSize(buf);
        return reply({ dataUrl: `data:image/png;base64,${buf.toString("base64")}`, w: size?.w ?? 0, h: size?.h ?? 0 });
      }
      case "grab.hold": {
        const img = m.image;
        if (!img || typeof img.dataBase64 !== "string") throw new Error("no picture to hold");
        const buf = Buffer.from(img.dataBase64.replace(IMAGE_IN, ""), "base64");   // a canvas's data url is fine too
        const held = holdShot(buf);
        // only when the id still names a shelf item (it may have been swept or deleted meanwhile): the hold stands
        if (m.id) { try { replaceOnShelf(String(m.id), buf, String(img.mime || "image/png")); } catch { /* not on the shelf */ } }
        return reply({ shot: held });
      }
      default:
        return reply({ error: `unknown ask ${type}` });
    }
  } catch (e) {
    reply({ error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
  }
}
