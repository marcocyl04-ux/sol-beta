// The third provider of a room's record (#152, the foundation on the issue): a room whose record is a Google Drive
// folder the room's maker picked. Like the cloud's (record/cloud.ts) it is only the `files` verb, since that is all such
// a room's record is: small files under `.sol/` (its things, its goal and the goal's files), kept as folders and files
// inside the room's folder, read and written through the Drive API with the person's own Google account (drive.ts keeps
// the token). It answers in GitHub's shapes, so things.ts and goal.ts read every provider with the same lines:
// - readSha: `{ sha, content }` (base64); the sha is the file's Drive v2 etag. A file not there throws "Not Found (HTTP 404)";
// - put/putBody: a write with the sha it replaces. Drive v3 has no compare-and-swap, so the write is Drive v2's media PUT
//   with `If-Match: <etag>`, which Drive refuses with 412 when the file moved since: thrown as "(HTTP 409)", a conflict.
//   A write with no sha over a file that is there is a conflict too (GitHub's 422), and so is a sha for a file gone;
// - creating has no precondition at all on Drive, so two people may each make `.sol/things.json`: the oldest of one name
//   (its createdTime, then its id) is the file, and whoever made a younger one trashes it and gets a conflict, so their
//   next try reads the one that stays. Folders the same way. Nothing is lost;
// - list: a folder as the contents API gives it, `[{ name, path, sha, size, type }]`; branch: "main", a folder has one.
// The room's folder itself not there, trashed, not a folder, or not shared with me is "(HTTP 403)": never an empty room,
// which would invite a write over it. Every other verb (cards, notes, code) belongs to a GitHub room: it says so.
import type { RoomRecord, FileWrite } from "../record.js";

export type DriveRecordDeps = {
  /** my Google access token for Drive (drive.ts driveToken), "" when Drive is not connected on this Sol */
  token: () => Promise<string>;
  /** the token was refused (401): the next ask renews it */
  stale?: () => void;
  fetch?: typeof fetch;
  /** how long a new file waits before its name is looked at a second time (Drive's listing may lag a create); tests: 0 */
  settle?: number;
};

export const DRIVE_PREFIX = "drive:";
export const DRIVE_API = "https://www.googleapis.com";
const WAIT = 20_000;
const FOLDER = "application/vnd.google-apps.folder";
/** a Drive id as Drive makes them: letters, digits, - and _ (a folder's is 19 to 44 today; room for more) */
export const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
// a record's path: `.sol/...`, names a Drive folder or file may carry, no `..`, no empty part
const PART = /^[A-Za-z0-9_.][A-Za-z0-9._ -]{0,99}$/;
export const CONNECT = "connect Google Drive first (Cowork › the room › connect Google Drive)";

/** a gh-like failure: the first line is the message, `full` the whole word ending in `(HTTP nnn)` (things.ts reads it) */
const fail = (line: string, status: number) => Object.assign(new Error(`${line} (HTTP ${status})`), { full: `${line} (HTTP ${status})`, status });
const notHere = (verb: string) => () => Promise.reject(new Error(`${verb} is a GitHub room's; this room's record is a Drive folder`));

/** the folder id a pasted link or id names, or why it is not one (pure). Taken: a folder's link on drive.google.com
 *  (`/drive/folders/<id>`, after `/u/<n>/` or `/mobile/`, with or without `?usp=sharing`), `open?id=<id>`, or the
 *  bare id. Refused: a file's or a Doc's link (a room is a folder), another host, http */
export function driveFolderId(raw: unknown): { id: string } | { error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { error: "paste the link of a Drive folder" };
  if (DRIVE_ID.test(s)) return { id: s };
  let u: URL;
  try { u = new URL(s); } catch { return { error: "that is not a Drive folder's link" }; }
  if (u.protocol !== "https:") return { error: "a Drive link is https" };
  if (u.hostname.toLowerCase() !== "drive.google.com") return { error: u.hostname.toLowerCase() === "docs.google.com" ? "that is a file's link; a room is a Drive folder" : "that is not a Drive folder's link" };
  const m = /^\/drive\/(?:u\/\d+\/)?(?:mobile\/)?folders\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
  const id = m?.[1] ?? (u.pathname === "/open" ? u.searchParams.get("id") ?? "" : "");
  if (/^\/file\//.test(u.pathname)) return { error: "that is a file's link; a room is a Drive folder" };
  if (!DRIVE_ID.test(id)) return { error: "that is not a Drive folder's link" };
  return { id };
}

/** the room's folder id a `drive:<id>` record names (pure), or "" */
export const folderOfRecord = (repo: string) => { const id = repo.startsWith(DRIVE_PREFIX) ? repo.slice(DRIVE_PREFIX.length) : ""; return DRIVE_ID.test(id) ? id : ""; };

/** a record path cut into its parts, or null when it is not one Sol writes (pure) */
export function partsOf(path: string): string[] | null {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts.length >= 1 && parts.length <= 4 && parts.every((p) => PART.test(p) && p !== "." && p !== ".." && !p.endsWith(" ")) ? parts : null;
}

/** a name inside a Drive query: its backslashes and quotes escaped (pure) */
export const quoted = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

type Item = { id: string; name: string; mimeType: string; createdTime?: string; size?: string };
/** the one item of a name among several (pure): the oldest made, then the smallest id; the others are a race's leftovers */
export const oldest = (list: Item[]): Item | undefined => [...list].sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? "") || a.id.localeCompare(b.id))[0];

export function makeDriveRecord(d: DriveRecordDeps): RoomRecord {
  const f = d.fetch ?? globalThis.fetch;
  // the ids of the folders under a room's folder, by `<room id>/<path>`, kept a minute: a folder's id never changes, but
  // someone may trash it, and a write must never land in a folder in the trash. A call that says one is gone forgets them all
  const DIR_FOR = 60_000;
  const dirs = new Map<string, { id: string; at: number }>();
  const checked = new Map<string, number>();
  const auth = async () => {
    const t = await d.token().catch(() => "");
    if (!t) throw fail(CONNECT, 401);
    return { authorization: `Bearer ${t}` };
  };
  /** one Drive call; its JSON, or a gh-like failure. `room` says the call is about the room's folder itself */
  const call = async (method: string, url: string, o: { body?: BodyInit; type?: string; ifMatch?: string; room?: boolean; raw?: boolean } = {}): Promise<any> => {
    const headers: Record<string, string> = { ...(await auth()), ...(o.type ? { "content-type": o.type } : {}), ...(o.ifMatch ? { "if-match": o.ifMatch } : {}) };
    let r: Response;
    try { r = await f(`${DRIVE_API}${url}`, { method, headers, ...(o.body !== undefined ? { body: o.body } : {}), signal: AbortSignal.timeout(WAIT) }); }
    catch { throw fail("Google Drive did not answer", 503); }
    if (r.ok) return o.raw ? Buffer.from(await r.arrayBuffer()) : r.status === 204 ? {} : await r.json().catch(() => ({}));
    const v = await r.json().catch(() => null) as { error?: { message?: unknown; errors?: { reason?: unknown }[] } } | null;
    const reason = String(v?.error?.errors?.[0]?.reason ?? "");
    if (r.status === 401) { d.stale?.(); dirs.clear(); checked.clear(); throw fail("Google Drive wants you to connect it again", 401); }
    if (r.status === 412) throw fail("the file does not match the version read", 409);
    if (r.status === 429 || /rateLimit/i.test(reason)) throw fail("Google Drive's rate limit; try again in a minute", 403);
    if (r.status === 404) { dirs.clear(); checked.clear(); throw o.room ? fail("this Drive folder is gone, or not shared with you", 403) : fail("Not Found", 404); }
    if (r.status === 403) throw fail(o.room ? "this Drive folder is not shared with you" : "Google Drive refused: you can only read this room's folder", 403);
    throw fail(r.status >= 500 ? "Google Drive is having trouble" : `Google Drive said ${r.status}`, r.status >= 500 ? 503 : r.status);
  };
  const room = (repo: string) => { const id = folderOfRecord(repo); if (!id) throw fail("not a Drive room", 400); return id; };
  // a folder in a shared drive lists its files only when the query reaches every drive I can see
  const ALL = "supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives";
  const children = async (parent: string, name?: string): Promise<Item[]> => {
    const q = `${quoted(parent)} in parents and trashed = false${name !== undefined ? ` and name = ${quoted(name)}` : ""}`;
    const out: Item[] = [];
    let page = "";
    for (let i = 0; i < 10; i++) {
      const v = await call("GET", `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("nextPageToken,files(id,name,mimeType,createdTime,size)")}&pageSize=200&${ALL}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
      // a search Drive could not finish across every drive is no answer: a file missing from it is not "not there"
      if (v.incompleteSearch === true) throw fail("Google Drive could not finish looking; try again", 503);
      for (const x of Array.isArray(v.files) ? v.files : []) if (x && typeof x.id === "string" && typeof x.name === "string") out.push({ id: x.id, name: x.name, mimeType: String(x.mimeType ?? ""), createdTime: x.createdTime, size: x.size });
      page = typeof v.nextPageToken === "string" ? v.nextPageToken : "";
      if (!page) break;
    }
    return out;
  };
  /** the room's folder, checked: there, not trashed, a folder, and mine to see */
  const check = async (id: string, fresh = false) => {
    if (fresh) { checked.delete(id); dirs.clear(); }
    if (Date.now() - (checked.get(id) ?? -Infinity) < DIR_FOR) return;
    const v = await call("GET", `/drive/v3/files/${id}?fields=id,mimeType,trashed&supportsAllDrives=true`, { room: true });
    if (v.mimeType !== FOLDER || v.trashed === true) { checked.delete(id); throw fail("that Drive link is not a folder, or it is in the trash", 403); }
    checked.set(id, Date.now());
  };
  const trash = (id: string) => call("PATCH", `/drive/v3/files/${id}?supportsAllDrives=true`, { body: JSON.stringify({ trashed: true }), type: "application/json" }).catch(() => {});
  /** something new of one name in a folder, then the race checked: when an older one of that name is there, mine goes
   *  to the trash and the caller hears a conflict */
  const make = async (parent: string, name: string, meta: Record<string, unknown>, content?: Buffer): Promise<Item> => {
    let made: any;
    const m = { name, parents: [parent], ...meta };
    if (content === undefined) made = await call("POST", `/drive/v3/files?fields=id,name,mimeType,createdTime&supportsAllDrives=true`, { body: JSON.stringify(m), type: "application/json" });
    else {
      const b = `sol${Math.random().toString(36).slice(2)}${Date.now()}`;
      const body = Buffer.concat([Buffer.from(`--${b}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(m)}\r\n--${b}\r\ncontent-type: application/octet-stream\r\n\r\n`), content, Buffer.from(`\r\n--${b}--\r\n`)]);
      made = await call("POST", `/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,createdTime&supportsAllDrives=true`, { body, type: `multipart/related; boundary=${b}` });
    }
    if (typeof made?.id !== "string") throw fail("Google Drive's answer was not a file", 502);
    // looked at twice, the second after Drive's listing had time to show another Sol's make of the same name: the oldest
    // stays, a younger one of mine goes to the trash (never deleted) and the caller reads again. The window that is left
    // (another's make shown later still) leaves two files, the older read by everyone, the younger kept in Drive
    for (const wait of [0, d.settle ?? 1500]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const all = await children(parent, name);
      const first = oldest(all.some((x) => x.id === made.id) ? all : [...all, made]);
      if (first && first.id !== made.id) { await trash(made.id); throw fail("someone made it at the same time; it does not match", 409); }
    }
    return made;
  };
  /** the folder at a path inside the room's folder (`.sol`, `.sol/goal`), made when `create`; null when not there */
  const dir = async (root: string, parts: string[], create: boolean): Promise<string | null> => {
    let at = root;
    for (let i = 0; i < parts.length; i++) {
      const key = `${root}/${parts.slice(0, i + 1).join("/")}`;
      const had = dirs.get(key);
      if (had && Date.now() - had.at < DIR_FOR) { at = had.id; continue; }
      const found = oldest((await children(at, parts[i])).filter((x) => x.mimeType === FOLDER));
      let id = found?.id;
      if (!id) {
        if (!create) return null;
        try { id = (await make(at, parts[i], { mimeType: FOLDER })).id; }
        catch (e) { if ((e as { status?: number }).status !== 409) throw e; id = oldest((await children(at, parts[i])).filter((x) => x.mimeType === FOLDER))?.id; }
        if (!id) throw fail("a folder in the room's Drive folder could not be made", 503);
      }
      dirs.set(key, { id, at: Date.now() });
      at = id;
    }
    return at;
  };
  /** the file at a path, or null; its folder made first when `create` (a write) */
  // a write, and any answer that would read as nothing there, asks Drive about the room's folder anew first: one unshared
  // or trashed since it was last asked lists nothing, and that must be a refusal, never an empty room or a write into
  // the trash (the review of #152)
  const locate = async (repo: string, path: string, create = false): Promise<{ parent: string; name: string; file?: Item } | null> => {
    const root = room(repo);
    const parts = partsOf(path);
    if (!parts) throw fail("not a path in a room's record", 400);
    await check(root, create);
    const parent = await dir(root, parts.slice(0, -1), create);
    if (!parent) return null;
    const name = parts[parts.length - 1];
    const file = oldest((await children(parent, name)).filter((x) => x.mimeType !== FOLDER));
    return { parent, name, ...(file ? { file } : {}) };
  };
  const read = async (repo: string, path: string): Promise<{ sha: string; content: Buffer }> => {
    let at = await locate(repo, path);
    if (!at?.file) { await check(room(repo), true); at = await locate(repo, path); }
    if (!at?.file) throw fail("Not Found", 404);
    // the etag first, then the bytes: a change between is read as newer bytes under the older etag, so the next write
    // with it is refused (412) and read again; never older bytes under a newer etag, which would let a write go over
    const meta = await call("GET", `/drive/v2/files/${at.file.id}?fields=etag&supportsAllDrives=true`);
    if (typeof meta.etag !== "string" || !meta.etag) throw fail("Google Drive gave no version of the file", 502);
    const content = await call("GET", `/drive/v3/files/${at.file.id}?alt=media&supportsAllDrives=true`, { raw: true }) as Buffer;
    return { sha: meta.etag, content };
  };
  const put = async (repo: string, path: string, w: { content: string; sha?: string }): Promise<string> => {
    const bytes = Buffer.from(w.content, "base64");
    const at = await locate(repo, path, true);
    if (!at) throw fail("a folder in the room's Drive folder could not be made", 503);
    if (at.file) {
      if (!w.sha) throw fail("the file is there already and no sha was given; it does not match", 409);
      const v = await call("PUT", `/upload/drive/v2/files/${at.file.id}?uploadType=media&supportsAllDrives=true&fields=etag`, { body: bytes, type: "application/octet-stream", ifMatch: w.sha });
      return String(v.etag ?? "");
    }
    if (w.sha) throw fail("the file is gone since it was read; it does not match", 409);
    const made = await make(at.parent, at.name, { mimeType: path.endsWith(".json") ? "application/json" : "text/plain" }, bytes);
    const meta = await call("GET", `/drive/v2/files/${made.id}?fields=etag&supportsAllDrives=true`).catch(() => ({}));
    return String((meta as { etag?: unknown }).etag ?? "");
  };
  const listing = async (repo: string, path: string) => {
    const root = room(repo);
    const parts = partsOf(path);
    if (!parts) throw fail("not a path in a room's record", 400);
    await check(root);
    let at = await dir(root, parts, false);
    // a folder not there is asked about anew only when `.sol` itself is missing: `.sol/goal` is often not made yet, and a
    // fresh look every minute for it would be calls for nothing (the re-review of #152)
    if (!at && !(parts.length > 1 && await dir(root, parts.slice(0, 1), false))) { await check(root, true); at = await dir(root, parts, false); }
    if (!at) throw fail("Not Found", 404);
    return (await children(at)).filter((x) => x.mimeType !== FOLDER);
  };
  return {
    who: { login: notHere("who"), me: notHere("who"), loginAs: notHere("who"), token: notHere("who"), prove: notHere("who"), unprove: notHere("who"), proofOf: notHere("who") },
    members: { ofOrg: notHere("members"), inOrgAs: notHere("members"), inOrg: notHere("members"), admin: notHere("members"), people: notHere("members"), room: notHere("members"),
      canWrite: () => Promise.resolve(false), invitations: () => Promise.resolve([]), accept: notHere("members"), invite: notHere("members") },
    cards: { list: () => Promise.resolve([]), prs: () => Promise.resolve([]), open: notHere("cards"), openIssues: notHere("cards"), held: notHere("cards"), nowIn: notHere("cards"),
      find: notHere("cards"), pr: notHere("cards"), assignees: notHere("cards"), assign: notHere("cards"), give: notHere("cards"), passBack: notHere("cards"),
      addReviewer: notHere("cards"), unlabel: notHere("cards"), letGo: notHere("cards"), takenAt: notHere("cards") },
    notes: { add: notHere("notes"), addOnPr: notHere("notes"), post: notHere("notes"), lines: notHere("notes"), of: () => Promise.resolve([]), recent: () => Promise.resolve([]) },
    files: {
      read: async (repo, path) => (await read(repo, path)).content.toString("utf8"),
      bytes: async (repo, path) => (await read(repo, path)).content,
      readSha: async (repo, path) => { const x = await read(repo, path); return JSON.stringify({ sha: x.sha, content: x.content.toString("base64") }); },
      put: (repo, path, w: FileWrite) => put(repo, path, w),
      putBody: (repo, path, body: { content: string; sha?: string }) => put(repo, path, body),
      // talk.ts (#315): an attachment whose line did not go, to the folder's bin (the sha is not asked: it was just written)
      remove: async (repo, path) => { const at = await locate(repo, path); if (at?.file) await call("PATCH", `/drive/v3/files/${at.file.id}?supportsAllDrives=true`, { body: JSON.stringify({ trashed: true }), type: "application/json" }); return ""; },
      branch: async (repo) => { await check(room(repo)); return "main"; },
      tree: async (repo) => {
        const tree: { path: string; type: string; sha: string; size: number }[] = [];
        const walk = async (path: string, depth: number) => {
          const at = await dir(room(repo), partsOf(path) ?? [], false).catch(() => null);
          if (!at) return;
          for (const x of await children(at)) {
            if (x.mimeType === FOLDER) { if (depth < 3 && partsOf(`${path}/${x.name}`)) await walk(`${path}/${x.name}`, depth + 1); }
            else tree.push({ path: `${path}/${x.name}`, type: "blob", sha: x.id, size: Number(x.size) || 0 });
          }
        };
        await check(room(repo));
        await walk(".sol", 1);
        return JSON.stringify({ tree });
      },
      list: async (repo, path) => {
        const pre = path.replace(/\/+$/, "");
        return JSON.stringify((await listing(repo, pre)).map((x) => ({ name: x.name, path: `${pre}/${x.name}`, sha: x.id, size: Number(x.size) || 0, type: "file" })));
      },
      lastCommits: () => Promise.resolve(null),
    },
    changes: { commitsBy: () => Promise.resolve([]) },
    room: { make: notHere("making a repository") },
    code: { branches: () => Promise.resolve([]), branch: notHere("code"), mainSha: notHere("code"), makeBranch: notHere("code"), heads: notHere("code"), compare: notHere("code"),
      status: notHere("code"), prsOfBranch: notHere("code"), openPrs: notHere("code"), prSearch: notHere("code"), prHead: notHere("code"), ready: notHere("code"),
      prComment: notHere("code"), lineComment: notHere("code") },
  };
}

// ---- who is in: the folder's sharing ----

export type DrivePerson = { email: string; name: string; role: string };
/** who a Drive room's folder is shared with. `known` false: the sharing could not be read (a reader may not see it, no
 *  token, no answer), and then nobody is taken to be in; `anyone`: the folder is open to anyone with its link, which says
 *  nothing about who is in, so it lets nobody in either; `domain`: open to a whole domain, the same */
export type DriveMembers = { known: boolean; people: DrivePerson[]; anyone: boolean; domain: string; error?: string };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
/** the sharing of a folder as the permissions API lists it, made into people (pure): users and groups with an email and
 *  a role, never a deleted one; `anyone` and `domain` said apart */
export function membersOf(permissions: unknown): DriveMembers {
  const list = Array.isArray(permissions) ? permissions : [];
  const people: DrivePerson[] = [];
  let anyone = false, domain = "";
  for (const p of list) {
    if (!p || typeof p !== "object" || p.deleted === true) continue;
    if (p.type === "anyone") { anyone = true; continue; }
    if (p.type === "domain") { domain = String(p.domain ?? "").slice(0, 190); continue; }
    if ((p.type !== "user" && p.type !== "group") || typeof p.emailAddress !== "string" || !EMAIL.test(p.emailAddress)) continue;
    const role = String(p.role ?? "");
    if (!["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"].includes(role)) continue;
    const email = p.emailAddress.toLowerCase();
    if (people.some((x) => x.email === email)) continue;
    people.push({ email, name: String(p.displayName ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 80), role });
  }
  return { known: true, people, anyone, domain };
}

/** is this email one of the folder's people (pure)? Deny by default: unknown sharing, or a link open to anyone or a
 *  domain, lets nobody in by itself; only an email the folder is shared with by name */
export const isMember = (m: DriveMembers, email: string) => m.known && m.people.some((p) => p.email === email.trim().toLowerCase());
/** may this person write the room's record (pure)? the same, with a role that can edit */
export const canEdit = (m: DriveMembers, email: string) => m.known && m.people.some((p) => p.email === email.trim().toLowerCase() && ["owner", "organizer", "fileOrganizer", "writer"].includes(p.role));

/** the folder's sharing, read with my token. Never throws: what could not be read is `known: false` and why */
export async function driveMembers(d: DriveRecordDeps, folder: string): Promise<DriveMembers> {
  const none = (error: string): DriveMembers => ({ known: false, people: [], anyone: false, domain: "", error });
  if (!DRIVE_ID.test(folder)) return none("not a Drive folder");
  const t = await d.token().catch(() => "");
  if (!t) return none(CONNECT);
  const all: unknown[] = [];
  let page = "";
  for (let i = 0; i < 5; i++) {
    let r: Response;
    try {
      r = await (d.fetch ?? globalThis.fetch)(`${DRIVE_API}/drive/v3/files/${folder}/permissions?supportsAllDrives=true&pageSize=100&fields=${encodeURIComponent("nextPageToken,permissions(id,type,role,emailAddress,displayName,domain,deleted)")}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
        { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(WAIT) });
    } catch { return none("Google Drive did not answer"); }
    if (r.status === 401) { d.stale?.(); return none("Google Drive wants you to connect it again"); }
    if (!r.ok) return none(r.status === 403 ? "only the folder's editors can see who it is shared with" : r.status === 404 ? "this Drive folder is gone, or not shared with you" : `Google Drive said ${r.status}`);
    const v = await r.json().catch(() => null) as { permissions?: unknown[]; nextPageToken?: unknown } | null;
    all.push(...(Array.isArray(v?.permissions) ? v.permissions : []));
    page = typeof v?.nextPageToken === "string" ? v.nextPageToken : "";
    if (!page) break;
  }
  return membersOf(all);
}

/** can I write in this folder (#152, the review): a room is made only over a folder whose record its maker can write.
 *  null when I can, else why not, in the room's words */
export async function driveFolderWritable(d: DriveRecordDeps, folder: string): Promise<string | null> {
  if (!DRIVE_ID.test(folder)) return "that is not a Drive folder's link";
  const t = await d.token().catch(() => "");
  if (!t) return CONNECT;
  let r: Response;
  try { r = await (d.fetch ?? globalThis.fetch)(`${DRIVE_API}/drive/v3/files/${folder}?fields=${encodeURIComponent("mimeType,trashed,capabilities(canAddChildren)")}&supportsAllDrives=true`, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(WAIT) }); }
  catch { return "Google Drive did not answer"; }
  if (r.status === 401) { d.stale?.(); return "Google Drive wants you to connect it again"; }
  if (r.status === 404 || r.status === 403) return "this Drive folder is gone, or not shared with you";
  if (!r.ok) return `Google Drive said ${r.status}`;
  const v = await r.json().catch(() => null) as { mimeType?: unknown; trashed?: unknown; capabilities?: { canAddChildren?: unknown } } | null;
  if (v?.mimeType !== FOLDER || v.trashed === true) return "that Drive link is not a folder, or it is in the trash";
  if (v.capabilities?.canAddChildren !== true) return "you can only read this Drive folder; its owner can share it with you as an editor";
  return null;
}
