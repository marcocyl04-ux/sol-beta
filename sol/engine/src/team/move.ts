// A GitHub room moves to the cloud (#216, C15 of MASTER §6): its record, the files under `.sol/` in its record repo (the
// things, the goal and its files, anything else Sol keeps there), goes into a new room on the cloud with the same name.
// In this order, and it stops at the first step that fails:
// 1. a backup on this machine first: every file under `.sol/`, as GitHub has it, with a manifest of each path, size and
//    SHA-256, in `<state>/cloud/moves/<room>-<time>/` (0700, the files 0600). Nothing is written anywhere before it is
//    complete;
// 2. the cloud room is made (rooms.ts makeRoom on the cloud I am signed in to, no repository);
// 3. each file is written there, then read back, and its SHA-256 compared with the backup's. A file the cloud refuses
//    (over 5 MB, not text under .sol/goal/) is said, and is still in the backup;
// 4. a room with code beside its record (anything outside `.sol/` but a README) gets its repository as one of the new
//    room's things, so the code room it was is one click away.
// 5. the old room says where it went: `.sol/moved.json` { code, hub, name, at } in its record repo, so a teammate's Sol or
//    agent reading it learns the new code, and my own copy of the old room is named "<name> (moved)".
// Only the repository's owner (GitHub's word, members.admin) moves a room: the room's record is theirs to take.
// The GitHub room and its repository are otherwise left as they are: nothing is deleted. Its people join the new room by
// its new code: a GitHub login is not a Sol name (S4), so nobody can be added for them.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { RoomRecord } from "./record.js";
import { recordOf, type Room, type TeamSettings } from "./settings.js";
import { makeRoom, type RoomsDeps } from "./rooms.js";
import { changeThings } from "./things.js";

export type MoveDeps = RoomsDeps & {
  github: () => Pick<RoomRecord, "files"> & { members: Pick<RoomRecord["members"], "admin"> };   // the room's record as it is (GitHub)
  files: () => Pick<RoomRecord, "files">;    // the record that picks by the repo (record.ts record()): the cloud's for `cloud:`
  dir: string;                                // where backups go (<state>/cloud/moves)
  hub: string;                                // the cloud's socket address (SOL_HUB)
  now?: () => Date;
};

export type Moved = { room: Room; code: string; name: string; marked: boolean; backup: string; files: { path: string; size: number; sha256: string }[]; refused: { path: string; why: string }[]; thing?: string };

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].trim().slice(0, 200);
const README = /^readme(\.[a-z]+)?$/i;

/** the paths a repo's tree holds (gh's `git/trees/HEAD?recursive=1`): its files under `.sol/`, and whether it holds code */
export function pathsOf(treeJson: string): { sol: string[]; code: boolean } {
  let v: { tree?: { path?: unknown; type?: unknown }[]; truncated?: unknown } = {};
  try { v = JSON.parse(treeJson); } catch { throw new Error("GitHub's list of the repository's files was not readable"); }
  if (v.truncated === true) throw new Error("the repository is too big for GitHub to list in one go; move it by hand");
  const blobs = (v.tree ?? []).filter((x) => x.type === "blob" && typeof x.path === "string").map((x) => x.path as string);
  return { sol: blobs.filter((p) => p.startsWith(".sol/")).sort(), code: blobs.some((p) => !p.startsWith(".sol/") && !README.test(p)) };
}

export async function moveRoom(d: MoveDeps, id: unknown, as?: unknown): Promise<Moved | { error: string }> {
  const s: TeamSettings = d.team();
  const r = s.rooms.find((x) => x.id === id);
  if (!r) return { error: "which room? (its id, as Settings shows it)" };
  if (r.provider !== "github") return { error: r.provider === "cloud" ? "that room is on the cloud already" : "only a GitHub room moves to the cloud" };
  const repo = recordOf(r);
  if (!repo) return { error: "that room has no record repository to move" };
  if (!d.hub || !d.cloudAt?.(d.hub.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, ""))) return { error: "sign in to the cloud first (bash sol/signin)" };

  // only the repository's owner, as GitHub says
  const admin = await d.github().members.admin(repo).then((t) => t.trim() === "true", () => false);
  if (!admin) return { error: `only the owner of ${repo} moves this room (GitHub says you are not)` };
  // 1. the backup, complete before anything else
  let branch = "main", paths: { sol: string[]; code: boolean };
  try {
    branch = (await d.github().files.branch(repo)).trim() || "main";
    paths = pathsOf(await d.github().files.tree(repo));
  } catch (e) { return { error: `couldn't list the room's record on GitHub: ${firstLine(e)}` }; }
  const stamp = (d.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const backup = join(d.dir, `${r.id}-${stamp}`);
  const got: { path: string; bytes: Buffer }[] = [];
  try {
    for (const p of paths.sol) got.push({ path: p, bytes: await d.github().files.bytes(repo, p, branch) });
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    for (const f of got) {
      const to = join(backup, "files", f.path);
      mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
      writeFileSync(to, f.bytes, { mode: 0o600 });
    }
    const manifest = { room: { id: r.id, name: r.name, repo, branch }, at: stamp, files: got.map((f) => ({ path: f.path, size: f.bytes.length, sha256: sha(f.bytes) })) };
    writeFileSync(join(backup, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    chmodSync(backup, 0o700);
  } catch (e) { return { error: `the backup failed, so nothing was moved: ${firstLine(e)}` }; }

  // 2. the cloud room
  // the same name; when the cloud has a room of that name (the room itself, made there the GitHub way before S5), the
  // name with "(cloud)" after it. A name given (--as) is taken as it is
  const given = typeof as === "string" && as.trim() ? as.trim() : "";
  let name = given || r.name;
  let made = await makeRoom(d, { name, hub: d.hub });
  if ("error" in made && made.error === "that name is taken" && !given) { name = `${r.name.slice(0, 52)} (cloud)`; made = await makeRoom(d, { name, hub: d.hub }); }
  if ("error" in made) return { error: `${made.error}${made.error === "that name is taken" ? " on the cloud; move it with another name (--as)" : ""} (the backup is in ${backup})` };
  const room = made.room, to = recordOf(room);
  if (room.provider !== "cloud" || !to) return { error: `the new room is not a cloud room; nothing was copied (the backup is in ${backup})` };

  // 3. each file, written and read back
  const files: Moved["files"] = [], refused: Moved["refused"] = [];
  for (const f of got) {
    const want = sha(f.bytes);
    try {
      await d.files().files.putBody(to, f.path, { message: `moved from ${repo}`, branch: "main", content: f.bytes.toString("base64") });
      const back = await d.files().files.bytes(to, f.path, "main");
      if (sha(back) !== want) { refused.push({ path: f.path, why: "it read back different from what was sent" }); continue; }
      files.push({ path: f.path, size: f.bytes.length, sha256: want });
    } catch (e) { refused.push({ path: f.path, why: firstLine(e).replace(/\s*\(HTTP \d{3}\)$/, "") }); }
  }

  // 4. a code room's repository, as a thing of the new room
  let thing: string | undefined;
  if (paths.code) {
    const t = await changeThings({ record: d.files }, to, { add: { url: `https://github.com/${repo}`, name: repo.split("/")[1] ?? repo, by: s.me.login || "sol", at: new Date().toISOString() } });
    if (!("error" in t) && t.thing) thing = t.thing.id; else if ("error" in t) refused.push({ path: "the repository as a thing", why: t.error });
  }
  // 5. the old room says where it went
  const note = JSON.stringify({ v: 1, code: room.code, hub: d.hub, name: room.name, at: new Date().toISOString() }, null, 2) + "\n";
  let marked = false;
  try {
    const had = await d.github().files.readSha(repo, ".sol/moved.json", branch).then((t) => JSON.parse(t)?.sha as string | undefined, () => undefined);
    await d.github().files.putBody(repo, ".sol/moved.json", { message: `moved to the cloud: ${room.code}`, branch, content: Buffer.from(note).toString("base64"), ...(had ? { sha: had } : {}) });
    marked = true;
  } catch (e) { refused.push({ path: ".sol/moved.json in the GitHub room", why: firstLine(e) }); }
  d.patch({ rooms: d.team().rooms.map((x) => (x.id === r.id && !x.name.endsWith(" (moved)") ? { ...x, name: `${x.name.slice(0, 52)} (moved)` } : x)) });
  return { room, code: room.code, name: room.name, marked, backup, files, refused, ...(thing ? { thing } : {}) };
}
