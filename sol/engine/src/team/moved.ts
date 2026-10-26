// Where a room went (#246; docs/cloud-box-2026-10-25/COMMON-SPACE-MOVE.md): when a GitHub room moves to the cloud
// (move.ts, `bash sol/cloud/move <room-id>`), its maker's Sol writes `.sol/moved.json` { v, code, hub, name, at } in the
// old room's record repo. This is the teammates' half: their Sol reads that file beside the room's things and their
// room page offers one click to join the new room by its code (team.room.join), so nobody has to pass a code around by
// hand. The common space (the room from before rooms, id `team`, met by the relay key on an engine's own hub) moves
// the same way. The file is room content: only its code, its hub's address and its name are taken, each checked.
import type { RoomRecord } from "./record.js";
import { CODE } from "./settings.js";

export const MOVED_PATH = ".sol/moved.json";
export const MOVED_TTL = 10 * 60_000;
export type Moved = { code: string; hub: string; name: string; at: string; by: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const oneLine = (v: unknown, max: number) => (typeof v === "string" ? v : "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** the file as read (pure): a code of six, a ws(s) hub, a name of one line; anything else is no move */
export function parseMoved(text: unknown): Moved | null {
  let v: unknown;
  try { v = JSON.parse(String(text ?? "")); } catch { return null; }
  if (!isObj(v)) return null;
  const code = typeof v.code === "string" ? v.code.trim().toUpperCase() : "";
  const hub = typeof v.hub === "string" ? v.hub.trim() : "";
  if (!CODE.test(code) || !/^wss?:\/\/[^\s/]+(\/\S*)?$/.test(hub)) return null;
  return { code, hub, name: oneLine(v.name, 60) || "the room", at: typeof v.at === "string" && !Number.isNaN(Date.parse(v.at)) ? v.at : "", by: "" };
}

// read once in ten minutes a repo: a move is rare, and the file never changes once written
const seen = new Map<string, { at: number; moved: Moved | null }>();
/** for tests: forget what was read */
export const forgetMoved = () => seen.clear();

const wordOf = (e: unknown) => String((e as { full?: string })?.full ?? (e as Error)?.message ?? e);

/** the move the room's record says, or null: a GitHub room only (a cloud room is where rooms move to). Only moves made
 *  the way move.ts makes them are taken (the review of #246: anyone with push could write the file, but only the
 *  repository's owner moves a room): the file's last commit is by the repository's owner, and its hub is one this Sol
 *  already trusts (`trusted`: the cloud it meets on). A file not there is no move, at once (a deleted file takes the
 *  line away); a read that fails keeps what was read before. `refresh` reads anew */
export async function movedOf(d: { record: () => Pick<RoomRecord, "files">; trusted: (hub: string) => boolean; admin?: (repo: string, login: string) => Promise<boolean> }, repo: string, now = Date.now(), refresh = false): Promise<Moved | null> {
  if (!repo || repo.includes(":")) return null;
  const had = seen.get(repo);
  if (!refresh && had && now - had.at < MOVED_TTL) return had.moved;
  let moved: Moved | null = null;
  try {
    const branch = (await d.record().files.branch(repo)).trim() || "main";
    const out = await d.record().files.readSha(repo, MOVED_PATH, branch);
    const j = JSON.parse(out) as { content?: string };
    const m = parseMoved(Buffer.from(String(j.content ?? ""), "base64").toString("utf8"));
    if (m && d.trusted(m.hub)) {
      const got = await d.record().files.lastCommits(repo, [{ path: MOVED_PATH, ref: branch }]);
      if (!got) throw new Error("couldn't read who wrote it");   // a refusal or a rate limit: keep what was read before
      const by = got[0]?.author?.user?.login ?? "";
      // move.ts lets an admin of the repository move it: its owner, or an admin of an org's repository
      const owner = !!by && by.toLowerCase() === repo.split("/")[0].toLowerCase();
      if (by && (owner || (await d.admin?.(repo, by).catch(() => false)))) moved = { ...m, by };
    }
  } catch (e) { moved = /\(HTTP 404\)\s*$|not found/i.test(wordOf(e).trim()) ? null : had?.moved ?? null; }
  seen.set(repo, { at: now, moved });
  return moved;
}

/** what the room page says about a move (pure): the new room, and whether I am in it already (then the click goes there) */
export function movedForFace(m: Moved | null, rooms: { id: string; code: string }[]): (Moved & { have?: string }) | undefined {
  if (!m) return undefined;
  const have = rooms.find((r) => r.code === m.code);
  return { ...m, ...(have ? { have: have.id } : {}) };
}
