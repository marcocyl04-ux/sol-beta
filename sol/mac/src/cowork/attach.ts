// Talk's attachments on the face (#315, PROTOCOL.md round 54): the small pure rules the box and the lines share. A
// file is picked or dropped, read here as base64 (nothing is written to disk by the face), and sent with the line; the
// engine checks it again and writes it into the group's record. A sent one is read back by its path through
// `team.talk.file` and kept in memory by that path, so a thumbnail is asked once.
export const FILE_MAX = 5 * 1024 * 1024;
export const NAME_MAX = 100;
/** the image button's types: the four a thumbnail draws (the engine decides by the bytes, not by this) */
export const IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";
export const TOO_BIG = "a file is 5 MB at most; put a big one on Google Drive and add its link";

export type TalkFile = { path: string; name: string; size: number; kind: "image" | "file" };
/** a file chosen and not sent yet: what the chip shows and what goes with the line */
export type Chip = { name: string; size: number; kind: "image" | "file"; bytes: string };

/** a size as a person reads it: "812 B", "34 KB", "2.1 MB" (pure) */
export function sizeLine(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** a file's name as the engine takes it (pure): one line, no `/`, at most 100 characters with its extension kept */
export function fitName(name: string): string {
  const one = name.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "").replace(/\//g, "-").trim() || "file";
  if (one.length <= NAME_MAX) return one;
  const dot = one.lastIndexOf("."), ext = dot > 0 && one.length - dot <= 9 ? one.slice(dot) : "";
  return one.slice(0, NAME_MAX - ext.length) + ext;
}

/** a picked or dropped file read as base64 for the line, or the one sentence that says why not */
export function readChip(f: File, kind: "image" | "file"): Promise<Chip | { error: string }> {
  if (f.size > FILE_MAX) return Promise.resolve({ error: TOO_BIG });
  if (!f.size) return Promise.resolve({ error: "that file is empty" });
  return new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result ?? ""); const i = s.indexOf(","); ok(i > 0 ? { name: fitName(f.name), size: f.size, kind, bytes: s.slice(i + 1) } : { error: "that file could not be read" }); };
    r.onerror = () => ok({ error: "that file could not be read" });
    r.readAsDataURL(f);
  });
}

/** a dropped file goes as an image when the browser says it is one of the four, else as a file (pure) */
export const kindOfDrop = (type: string): "image" | "file" => (IMAGE_TYPES.split(",").includes(type) ? "image" : "file");

/** what a sent file is called on the face (the review's P1-3): the sender's name is a label only, and the extension
 *  that counts is the path's, which the group's record holds; when the two differ it is said after the name (pure) */
export function labelOf(f: Pick<TalkFile, "name" | "path">): string {
  const ext = f.path.slice(f.path.lastIndexOf(".") + 1).toLowerCase();
  const said = /\.([^./]+)$/.exec(f.name)?.[1]?.toLowerCase() ?? "";
  return said === ext ? f.name : `${f.name} (.${ext})`;
}

/** a small store that keeps the last `max` entries by use and hands back the ones it lets go (pure but for its map) */
export class Lru<V> {
  private m = new Map<string, V>();
  private max: number;
  private gone: (v: V) => void;
  constructor(max: number, gone: (v: V) => void = () => {}) { this.max = max; this.gone = gone; }   // no parameter properties: node's tests strip types only
  get(k: string): V | undefined { const v = this.m.get(k); if (v !== undefined) { this.m.delete(k); this.m.set(k, v); } return v; }
  set(k: string, v: V) { this.m.delete(k); this.m.set(k, v); while (this.m.size > this.max) { const [old, ov] = this.m.entries().next().value!; this.m.delete(old); this.gone(ov); } }
  delete(k: string) { this.m.delete(k); }
  get size() { return this.m.size; }
}

export type Cursor = { at: number; id: string };
/** where each thread's next page of earlier lines starts (the second review): the cloud's own `next` after a page, else
 *  the oldest line here whose time the hub stamped. Forgotten for a thread when its lines are read anew, and for every
 *  thread when the room changes, so a cursor never reaches into another reading or another group */
export class Cursors {
  private at: Record<string, Cursor> = {};
  private room = "";
  /** the room in use; another one forgets every cursor */
  inRoom(room: string) { if (room !== this.room) { this.room = room; this.at = {}; } }
  /** a thread's lines read anew: its cursor goes */
  drop(thread: string) { delete this.at[thread]; }
  /** the cloud's cursor for the page before the one just read */
  set(thread: string, c: Cursor | undefined) { if (c) this.at[thread] = c; else delete this.at[thread]; }
  /** the cursor to ask with, or null when there is no line to start from */
  of(thread: string, lines: { at: number; id: string; heard?: true }[]): Cursor | null {
    const kept = this.at[thread];
    if (kept) return kept;
    const s = lines.find((l) => l.heard) ?? lines[0];
    return s ? { at: s.at, id: s.heard ? s.id : "" } : null;
  }
}
