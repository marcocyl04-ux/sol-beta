// The private list (#253): the apps to cut out of the clean
// screen, the window Marco shares instead of his whole screen. No app can hide another app's windows from a share, so
// the clean screen (src-tauri/src/clean.rs) shows the display live without these apps; this file only keeps which ones.
// The notch's row under the eye (a hold on the eye) lists them, a tick turns one on or off, and the notch hands the
// ticked bundle ids to `clean_open` / `clean_set`.
//
// One small file, home/private.json: { apps: [{ name, bundle, on }] }. The first read with no file (or one that does
// not read) seeds it with the four chat apps, all on, and writes it, so the list is there to edit by hand too. Asks
// (PROTOCOL.md round 52, "The private list"), each answered under its own type and rid:
//   eye.list                  -> { apps }
//   eye.tick { bundle, on }   -> { apps }   (an unknown bundle is an error)
//   eye.add { name, bundle }  -> { apps }   (an app already on the list is ticked on, not added twice)
// The pure parts (the read, the tick, the add) are exported and tested; nothing here opens a window or a picture.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type PrivateApp = { name: string; bundle: string; on: boolean };
type Face = { send: (m: object) => void };

/** the list a first read starts from: the chats a share must never show */
export const SEED: readonly PrivateApp[] = Object.freeze([
  { name: "WeChat", bundle: "com.tencent.xinWeChat", on: true },
  { name: "WhatsApp", bundle: "net.whatsapp.WhatsApp", on: true },
  { name: "Claude", bundle: "com.anthropic.claudefordesktop", on: true },
  { name: "ChatGPT", bundle: "com.openai.chat", on: true },
]);

/** a bundle id as macOS writes them: letters, digits, dots, dashes, underscores; at least one dot (pure) */
export const isBundle = (b: unknown): b is string => typeof b === "string" && b.length <= 200 && /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/.test(b);

/** private.json read: the valid apps in their order, one per bundle; null when the text is not a list at all (pure) */
export function parseList(text: string): PrivateApp[] | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  const apps = (raw && typeof raw === "object" ? (raw as any).apps : undefined);
  if (!Array.isArray(apps)) return null;
  const out: PrivateApp[] = [];
  for (const a of apps) {
    if (!a || typeof a !== "object" || !isBundle(a.bundle) || out.some((o) => o.bundle === a.bundle)) continue;
    const name = typeof a.name === "string" && a.name.trim() ? a.name.trim().slice(0, 60) : a.bundle;
    out.push({ name, bundle: a.bundle, on: a.on !== false });
  }
  return out;
}

/** the list with one app ticked on or off; throws for a bundle not on it (pure) */
export function tick(apps: PrivateApp[], bundle: unknown, on: unknown): PrivateApp[] {
  if (!apps.some((a) => a.bundle === bundle)) throw new Error(`${String(bundle)} is not on the private list`);
  return apps.map((a) => (a.bundle === bundle ? { ...a, on: on === true } : a));
}

/** the list with one app added at the end, on; an app already there is ticked on instead (pure) */
export function add(apps: PrivateApp[], name: unknown, bundle: unknown): PrivateApp[] {
  if (!isBundle(bundle)) throw new Error(`"${String(bundle)}" is not an app's bundle id`);
  if (apps.some((a) => a.bundle === bundle)) return tick(apps, bundle, true);
  const n = typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : bundle;
  return [...apps, { name: n, bundle, on: true }];
}

let HOME = "";
export function setPrivateHome(home: string) { HOME = home; }
const file = () => join(HOME, "private.json");

/** the list as kept; the first read (no file, or one that does not read) writes the seed */
export function readList(): PrivateApp[] {
  const f = file();
  const kept = existsSync(f) ? parseList(readFileSync(f, "utf8")) : null;
  if (kept) return kept;
  const seed = SEED.map((a) => ({ ...a }));
  writeList(seed);
  return seed;
}

/** written whole, through a temporary file, so a crash never leaves half a list */
export function writeList(apps: PrivateApp[]): void {
  const f = file();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f + ".tmp", JSON.stringify({ apps }, null, 2) + "\n");
  renameSync(f + ".tmp", f);
}

/** eye.list / eye.tick / eye.add: the whole list back under the ask's type and rid, or its error */
export async function handlePrivate(face: Face, msg: { type: string; [k: string]: any }): Promise<void> {
  const answer = (m: object) => face.send({ type: msg.type, ...(msg.rid !== undefined ? { rid: msg.rid } : {}), ...m });
  try {
    switch (msg.type) {
      case "eye.list": return answer({ apps: readList() });
      case "eye.tick": { const apps = tick(readList(), msg.bundle, msg.on); writeList(apps); return answer({ apps }); }
      case "eye.add": { const apps = add(readList(), msg.name, msg.bundle); writeList(apps); return answer({ apps }); }
      default: return answer({ error: `no such ask: ${msg.type}` });
    }
  } catch (err) {
    answer({ error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
  }
}
