// Doors: the notch (and its monitor form, the island) and the phone are ways in that are not the main window.
// A door talks in conversations of its own, never in whatever chat is open on the Mac. A door's call or text
// continues the door's last conversation when that one last spoke less than DOOR_WINDOW ago; otherwise it starts
// a fresh one (Marco, 2026-10-14: continuation by time, to keep it clean). engine/doors.json (gitignored)
// remembers which conversations belong to which door and when each last spoke; threads.ts shows the door on
// the thread so the sidebar can say "phone" or "notch" next to it.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Door = "notch" | "phone";
export const DOORS: Door[] = ["notch", "phone"];
export const DOOR_WINDOW_MS = 20 * 60_000;

type Book = { of: Record<string, Door>; last: Partial<Record<Door, { sessionId: string; at: number }>> };
const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "doors.json");
let book: Book | null = null;

function load(): Book {
  if (book) return book;
  try { book = JSON.parse(readFileSync(FILE, "utf8")) as Book; } catch { book = { of: {}, last: {} }; }
  book.of ??= {}; book.last ??= {};
  return book;
}
function save() {
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(load(), null, 2) + "\n");
  renameSync(tmp, FILE);
}

export const asDoor = (d: unknown): Door | undefined => (DOORS.includes(d as Door) ? (d as Door) : undefined);

// Which door a conversation belongs to, if any.
export const doorOf = (sessionId: string): Door | undefined => load().of[sessionId];

// The conversation a door continues right now, or undefined when its last one is older than the window.
export function continueDoor(door: Door, now = Date.now()): string | undefined {
  const l = load().last[door];
  return l && now - l.at < DOOR_WINDOW_MS ? l.sessionId : undefined;
}

// The door just spoke in this conversation.
export function touchDoor(door: Door, sessionId: string, now = Date.now()) {
  const b = load();
  b.of[sessionId] = door;
  b.last[door] = { sessionId, at: now };
  save();
}
