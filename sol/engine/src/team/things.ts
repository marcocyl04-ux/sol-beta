// The things a room is making (#194; docs/cowork-ui-design-2026-10-24/PRD.md section 9.1): a Google Doc, Slides, a
// Sheet, the repo, a Figma file, a website, a file. One small file in the room's record repository, `.sol/things.json`,
// read and written through the record (record.ts files), so git keeps who added what and when and Cowork keeps nothing
// of its own. A thing is a canonical https link with a stable id (a short hash of that link, so the same link added
// twice is one thing), a kind read from the link, who added it and when, and `agent: true` when an agent added it.
//
// Writes are compare-and-swap on the file's sha: read, apply, put with the sha read; a conflict (someone else wrote
// between) reads again and applies again, three times, then says so. Nothing is ever lost: the re-apply is always on
// the fresh file. A refused write (no access, a protected branch) is one plain line, "you can't write to this room yet".
// The URL policy (the review of the PRD, finding 5) is one function, canonicalUrl, and both the face's add and the
// agent's tool go through it: https only, no sign-in in the link, nothing on this machine or a private network.
// Everything that touches GitHub is handed in (ThingsDeps), so the tests run with a fake record and no network.
import { createHash, randomBytes } from "node:crypto";
import type { RoomRecord } from "./record.js";
import type { Board } from "./board.js";

export const THINGS_PATH = ".sol/things.json";
/** the record repo's branch the file lives on: its main, as a plan page and a press do (note.ts, press.ts) */
export const BRANCH = "main";
export const KINDS = ["doc", "slides", "sheet", "github", "figma", "web", "file"] as const;
export type Kind = (typeof KINDS)[number];
export type Thing = { id: string; name: string; url: string; kind: Kind; addedBy: string; at: string; agent?: true; parent?: string };
/** a folder of things, as Google Drive keeps one (ADDITIONS §2, #248): a name, the folder it is in (null: the top), who
 *  made it and when. One parent a thing; one level of folders for now (a folder inside a folder is not made) */
export type Folder = { id: string; name: string; parent: string | null; by: string; at: string; agent?: true };
// v 2 (#248): `folders`, and a thing's `parent`. A file with no folder is written as v 1, so an older Sol keeps writing a
// room until someone makes its first folder; from then on it reads the room and writes nothing (`newer`, #195).
// newer: the file read says a v above 2 (a newer Sol wrote it): read what we can, write nothing
export type ThingsFile = { v: 1 | 2; things: Thing[]; folders?: Folder[]; newer?: true };
/** one thing as the face sees it: who touched it last, who is in it now (from the roster, #230) */
export type ThingForFace = Thing & { lastTouch: { who: string; at: string }; inNow: string[] };
export const NO_RECORD = "this room has no record yet";
export const NAME_MAX = 60;
/** the highest v this Sol writes */
export const THINGS_V = 2;
const FOLDER_ID = /^[a-z0-9]{4,16}$/;
/** a new folder's id: eight hex digits, random (a folder has no link to hash) */
export const folderId = () => randomBytes(4).toString("hex");
/** why the room's first folder was not made: it turns the file v2, and an older Sol then only reads the things */
export const FIRST_FOLDER = "the room's first folder needs everyone in it on a Sol with folders: an older Sol then only reads this room's things";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const empty = (): ThingsFile => ({ v: 1, things: [] });
// one line of plain text: no control or format characters (a NUL would break the gh command; U+202E would turn a name
// around on a face), whitespace folded, at most max characters
const oneLine = (s: unknown, max: number) => String(s ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
export const URL_MAX = 2048;
// a query key that carries a credential: a token, a key, a secret, a password, a signature (a signed S3 or GCS link)
const SECRET_KEY = /token|api[_-]?key|secret|passw|^sig(nature)?$|^x-(amz|goog)-|^key$|^auth/i;
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
// a Google Doc, Slides or Sheet is one file: /d/<id>, after /u/<n> when the link names an account; anything else under
// those three (the home, /u/0/, the template gallery, /create) is the app, and a thing that opened onto it would open the home
const GOOGLE_APP: Record<string, string> = { document: "Docs", presentation: "Slides", spreadsheets: "Sheets" };
const GOOGLE_FILE = /^\/(document|presentation|spreadsheets)(\/u\/\d+)?\/d\/[\w-]+/;
const GOOGLE_ID = /^\/(document|presentation|spreadsheets)(\/u\/\d+)?\/d\/([\w-]+)/;

// ---- the URL policy ----
/** the link as Sol keeps it, or why it is not taken (pure). https only; the host lowercased and the fragment dropped,
 *  so two pastes of one page are one thing; refused: a sign-in in the link, http, file, javascript or data, this machine
 *  (localhost, .local, .internal), an IP address (a private network is reached by one), a host with no dot */
export function canonicalUrl(raw: unknown): { url: string } | { error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { error: "paste a link" };
  if (s.length > URL_MAX) return { error: "that link is too long" };
  let u: URL;
  try { u = new URL(s); } catch { return { error: "that is not a link Sol can open" }; }
  if (u.protocol !== "https:") return { error: u.protocol === "http:" ? "only https links; this one is http" : "only https links" };
  if (u.username || u.password) return { error: "a link with a sign-in in it is not taken" };
  for (const k of u.searchParams.keys()) if (SECRET_KEY.test(k)) return { error: "a link with a sign-in in it is not taken" };   // git history forgets nothing
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  const labels = host.split(".");
  const local = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa");
  const ip = IPV4.test(host) || host.startsWith("[");   // an IPv6 literal keeps its brackets in hostname
  if (labels.length < 2 || labels.some((l) => !l) || local || ip) return { error: "a link to this machine or a private network is not taken" };
  const app = host === "docs.google.com" ? /^\/(document|presentation|spreadsheets)(\/|$)/.exec(u.pathname)?.[1] : undefined;
  if (app && !GOOGLE_FILE.test(u.pathname)) return { error: `that is the Google ${GOOGLE_APP[app]} home; paste the link of the file itself` };
  u.hostname = host;
  u.hash = "";
  if (u.port === "443") u.port = "";
  const url = sameForm(u);
  return url.length > URL_MAX ? { error: "that link is too long" } : { url };
}

// ---- one thing, one link (ADDITIONS §5) ----
// a query key that only says where a link was shared from: dropped, so a paste from an email and one from a chat are one
const TRACKING = /^(utm_[a-z]+|usp|fbclid|gclid|mc_[a-z]+|ref_src)$/i;
/** the one form of a link that names the same thing (pure; canonicalUrl's last step, so an add and a read agree):
 *  - a Google Doc, Slides or Sheet is its file, `https://docs.google.com/<app>/d/<id>/edit`, whatever account (`/u/1/`),
 *    view (`/view`, `/preview`, `/copy`), query or heading the link said; a Drive file is `drive.google.com/file/d/<id>/view`;
 *  - a GitHub repository or a path in it is `github.com/<owner>/<repo>…` without `www.`, a `.git` or a trailing slash;
 *  - anywhere else, the share-tracking keys (utm_*, usp, fbclid, gclid) are dropped and the rest kept as it was */
export function sameForm(u: URL): string {
  const g = GOOGLE_ID.exec(u.pathname);
  // a file "published to the web" is /d/e/<published id>/pub: its own id is the second part, and it stays as it was
  if (u.hostname === "docs.google.com" && g && g[3] === "e") { u.search = ""; return u.toString(); }
  if (u.hostname === "docs.google.com" && g) return `https://docs.google.com/${g[1]}/d/${g[3]}/edit`;
  const f = /^\/file(?:\/u\/\d+)?\/d\/([\w-]+)/.exec(u.pathname);
  if (u.hostname === "drive.google.com" && f) return `https://drive.google.com/file/d/${f[1]}/view`;
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  if (u.hostname === "github.com" || u.hostname === "www.github.com") {
    u.hostname = "github.com";
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[1]) parts[1] = parts[1].replace(/\.git$/i, "");
    u.pathname = "/" + parts.join("/");
  }
  return u.toString();
}

/** the kind a link is, read from the link alone (pure) */
export function kindOf(url: string): Kind {
  let u: URL;
  try { u = new URL(url); } catch { return "web"; }
  const h = u.hostname, p = u.pathname;
  // a Google file only with its /d/<id> (ADDITIONS §3): the app's home is not a doc, and canonicalUrl refuses it anyway
  const g = h === "docs.google.com" ? GOOGLE_ID.exec(p)?.[1] : undefined;
  if (g) return g === "document" ? "doc" : g === "presentation" ? "slides" : "sheet";
  if (h === "drive.google.com" && /^\/file(\/u\/\d+)?\/d\/[\w-]+/.test(p)) return "file";
  if (h === "github.com" || h === "www.github.com") return "github";
  if (h === "figma.com" || h.endsWith(".figma.com")) return "figma";
  if (h.endsWith(".sharepoint.com") || h === "onedrive.live.com" || h.endsWith(".office.com")) {   // Office in the browser: the share link says the app
    if (p.includes("/:w:/")) return "doc";
    if (p.includes("/:p:/")) return "slides";
    if (p.includes("/:x:/")) return "sheet";
  }
  if (/\.(pdf|docx?|xlsx?|pptx?|csv|md|txt|zip|png|jpe?g|gif|svg|mp4|mov|key|pages|numbers)$/i.test(p)) return "file";
  return "web";
}

const KIND_NAME: Record<Kind, string> = { doc: "a doc", slides: "slides", sheet: "a sheet", github: "a repository", figma: "a figma file", web: "a page", file: "a file" };
/** a name for a thing nobody named (pure): a GitHub thing is its owner/name (and what follows), a Figma file its own
 *  name, a file its file name, a page its host, a Google thing its kind until someone renames it */
export function nameOf(url: string, kind: Kind): string {
  let u: URL;
  try { u = new URL(url); } catch { return KIND_NAME[kind]; }
  const parts = u.pathname.split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  let name = "";
  if (kind === "github") name = parts.slice(0, 2).join("/") + (parts.length > 2 ? ` · ${parts.slice(2).join("/")}` : "");
  else if (kind === "figma") name = (parts[2] ?? "").replace(/-/g, " ");
  else if (kind === "file") name = parts[parts.length - 1] ?? "";
  else if (kind === "web") name = u.hostname.replace(/^www\./, "") + (parts.length ? "/" + parts.join("/") : "");
  return oneLine(name, NAME_MAX) || KIND_NAME[kind];
}

/** a thing's id: the first eight hex digits of the sha-256 of its canonical url (pure) */
export const idOf = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 8);

// ---- the file ----
// one entry made valid, or null: its url must pass the policy; its id is always the hash of that url (a hand-edited url
// moves the thing); a kind not among ours is read from the url again; a name is one line of at most 60 characters
function cleanThing(v: unknown): Thing | null {
  if (!isObj(v)) return null;
  const c = canonicalUrl(v.url);
  if ("error" in c) return null;
  const kind = (KINDS as readonly string[]).includes(String(v.kind)) ? (v.kind as Kind) : kindOf(c.url);
  const by = typeof v.addedBy === "string" && LOGIN.test(v.addedBy) ? v.addedBy : "";
  const at = typeof v.at === "string" && !Number.isNaN(Date.parse(v.at)) ? v.at : "";
  const t: Thing = { id: idOf(c.url), name: oneLine(v.name, NAME_MAX) || nameOf(c.url, kind), url: c.url, kind, addedBy: by, at };
  if (v.agent === true) t.agent = true;
  return t;
}

/** the file as read, made valid (pure): bad JSON, a wrong v or junk entries lose only what is junk, never the file; two
 *  entries for one url are one thing (the first stays) */
export function parse(text: unknown): ThingsFile {
  let raw: unknown;
  try { raw = JSON.parse(String(text ?? "")); } catch { return empty(); }
  const folders = cleanFolders(isObj(raw) && Array.isArray(raw.folders) ? raw.folders : []);
  const fids = new Set(folders.map((f) => f.id));
  const list = isObj(raw) && Array.isArray(raw.things) ? raw.things : [];
  const out: Thing[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const t = cleanThing(x);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    // a parent that is not one of the file's folders is the top
    if (isObj(x) && typeof x.parent === "string" && fids.has(x.parent)) t.parent = x.parent;
    out.push(t);
  }
  const newer = isObj(raw) && typeof raw.v === "number" && raw.v > THINGS_V;
  return { ...withFolders(out, folders), ...(newer ? { newer: true } : {}) };
}

// the folders of a file made valid: an id of 4–16 lowercase letters and digits, once; a name of one line; a parent that is
// one of them and never the folder itself or below it (a loop is cut at the top); junk dropped
function cleanFolders(list: unknown[]): Folder[] {
  const out: Folder[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    if (!isObj(v) || typeof v.id !== "string" || !FOLDER_ID.test(v.id) || seen.has(v.id)) continue;
    const name = oneLine(v.name, NAME_MAX);
    if (!name) continue;
    seen.add(v.id);
    out.push({ id: v.id, name, parent: typeof v.parent === "string" ? v.parent : null, by: typeof v.by === "string" && LOGIN.test(v.by) ? v.by : "", at: typeof v.at === "string" && !Number.isNaN(Date.parse(v.at)) ? v.at : "", ...(v.agent === true ? { agent: true as const } : {}) });
  }
  const byId = new Map(out.map((f) => [f.id, f]));
  for (const f of out) {
    if (f.parent !== null && !byId.has(f.parent)) { f.parent = null; continue; }
    const path = new Set([f.id]);
    for (let p = f.parent; p !== null; p = byId.get(p)?.parent ?? null) { if (path.has(p)) { f.parent = null; break; } path.add(p); }
  }
  return out;
}

// a file of these things and folders: v 2 only when it has a folder (a thing's parent needs one)
const withFolders = (things: Thing[], folders: Folder[]): ThingsFile =>
  folders.length ? { v: 2, things, folders } : { v: 1, things: things.map(({ parent: _p, ...t }) => t) };

/** the file as written (pure): one shape, the fields in one order, two spaces, a trailing newline, so
 *  serialize(parse(text)) of a valid file is the text itself and a write that changes nothing is never a commit */
export function serialize(f: ThingsFile): string {
  const folders = f.folders ?? [];
  const things = f.things.map((t) => ({ id: t.id, name: t.name, url: t.url, kind: t.kind, addedBy: t.addedBy, at: t.at, ...(t.agent ? { agent: true } : {}), ...(t.parent && folders.length ? { parent: t.parent } : {}) }));
  if (!folders.length) return JSON.stringify({ v: 1, things }, null, 2) + "\n";
  return JSON.stringify({ v: 2, folders: folders.map((x) => ({ id: x.id, name: x.name, parent: x.parent, by: x.by, at: x.at, ...(x.agent ? { agent: true } : {}) })), things }, null, 2) + "\n";
}

// ---- one change ----
export type Op =
  | { add: { url: unknown; name?: unknown; by: string; at: string; agent?: boolean; parent?: unknown } }
  | { remove: { id: unknown } }
  // make a folder (#248). everyone: a person said everyone in the room runs a Sol with folders; the room's first folder
  // needs it, since from then on an older Sol only reads the room's things (ADDITIONS §2: folders once all have updated)
  | { folder: { id: string; name: unknown; parent?: unknown; by: string; at: string; agent?: boolean; everyone?: boolean } }
  | { move: { id: unknown; to: unknown } }                                                 // a thing into a folder, or to the top ("" / null)
  | { unfolder: { id: unknown } };                                                         // a folder off; what was in it moves up one level
/** say: the commit message after `things: ` */
export type Applied = { file: ThingsFile; thing?: Thing; folder?: Folder; changed: boolean; error?: string; say?: string };

const low = (s: string) => s.toLocaleLowerCase();
/** a name no other thing in that folder wears (pure; ADDITIONS §5): the name itself, else "name (2)", "(3)"…, the name cut
 *  so the whole stays within 60 characters. Case does not make two names two */
export function freeName(name: string, taken: Iterable<string>): string {
  const have = new Set([...taken].map(low));
  if (!have.has(low(name))) return name;
  const base = name.replace(/ \(\d+\)$/, "") || name;   // "plan (2)" taken again is "plan (3)", never "plan (2) (2)"
  for (let n = 2; ; n++) {
    const tail = ` (${n})`, v = base.slice(0, NAME_MAX - tail.length).trimEnd() + tail;
    if (!have.has(low(v))) return v;
  }
}
const namesIn = (things: Thing[], parent: string | undefined, but?: string) => things.filter((t) => (t.parent ?? undefined) === parent && t.id !== but).map((t) => t.name);
const folderOf = (f: ThingsFile, id: unknown) => (f.folders ?? []).find((x) => x.id === String(id ?? ""));
// "" or null or undefined is the top; else a folder of the file, or not
const whereTo = (f: ThingsFile, to: unknown): { parent?: string } | { error: string } => {
  if (to === null || to === undefined || to === "") return {};
  const d = folderOf(f, to);
  return d ? { parent: d.id } : { error: "no such folder" };
};

/** one op on one file (pure): an add of a link already there changes nothing and answers that thing; a remove of an id
 *  not there changes nothing and says so; a refused link says why. A thing's name is unique in its folder ("(2)"); a
 *  folder's name in its level is refused when taken; a folder is made at the top only, for now */
export function apply(f: ThingsFile, op: Op): Applied {
  const folders = f.folders ?? [];
  if ("add" in op) {
    const c = canonicalUrl(op.add.url);
    if ("error" in c) return { file: f, changed: false, error: c.error };
    const id = idOf(c.url);
    const had = f.things.find((t) => t.id === id);
    if (had) return { file: f, thing: had, changed: false };
    const w = whereTo(f, op.add.parent);
    if ("error" in w) return { file: f, changed: false, error: w.error };
    const kind = kindOf(c.url);
    const name = freeName(oneLine(op.add.name, NAME_MAX) || nameOf(c.url, kind), namesIn(f.things, w.parent));
    const thing: Thing = { id, name, url: c.url, kind, addedBy: LOGIN.test(op.add.by) ? op.add.by : "", at: op.add.at };
    if (op.add.agent) thing.agent = true;
    if (w.parent) thing.parent = w.parent;
    return { file: withFolders([...f.things, thing], folders), thing, changed: true, say: `added ${thing.name}` };
  }
  if ("remove" in op) {
    const id = String(op.remove.id ?? "");
    const thing = f.things.find((t) => t.id === id);
    if (!thing) return { file: f, changed: false, error: "no such thing" };
    return { file: withFolders(f.things.filter((t) => t.id !== id), folders), thing, changed: true, say: `removed ${thing.name}` };
  }
  if ("folder" in op) {
    const name = oneLine(op.folder.name, NAME_MAX);
    if (!name) return { file: f, changed: false, error: "give the folder a name" };
    if (op.folder.parent !== undefined && op.folder.parent !== null && op.folder.parent !== "") return { file: f, changed: false, error: "one level of folders for now: a folder inside a folder is not made yet" };
    if (!FOLDER_ID.test(op.folder.id) || folders.some((x) => x.id === op.folder.id)) return { file: f, changed: false, error: "that folder id is taken; try again" };
    if (!folders.length && !op.folder.everyone) return { file: f, changed: false, error: FIRST_FOLDER };
    const same = folders.find((x) => x.parent === null && low(x.name) === low(name));
    if (same) return { file: f, changed: false, folder: same, error: `there is a folder called ${same.name} here already` };
    const folder: Folder = { id: op.folder.id, name, parent: null, by: LOGIN.test(op.folder.by) ? op.folder.by : "", at: op.folder.at, ...(op.folder.agent ? { agent: true as const } : {}) };
    return { file: withFolders(f.things, [...folders, folder]), folder, changed: true, say: `made the folder ${name}` };
  }
  if ("move" in op) {
    const id = String(op.move.id ?? "");
    const thing = f.things.find((t) => t.id === id);
    if (!thing) return { file: f, changed: false, error: folderOf(f, id) ? "a folder stays at the top for now; move the things in it instead" : "no such thing" };
    const w = whereTo(f, op.move.to);
    if ("error" in w) return { file: f, changed: false, error: w.error };
    if ((thing.parent ?? undefined) === w.parent) return { file: f, thing, changed: false };
    const moved: Thing = { ...thing, name: freeName(thing.name, namesIn(f.things, w.parent, thing.id)) };
    delete moved.parent;
    if (w.parent) moved.parent = w.parent;
    const to = w.parent ? folderOf(f, w.parent)!.name : "the top";
    return { file: withFolders(f.things.map((t) => (t.id === id ? moved : t)), folders), thing: moved, changed: true, say: `moved ${moved.name} to ${to}` };
  }
  const folder = folderOf(f, op.unfolder.id);
  if (!folder) return { file: f, changed: false, error: "no such folder" };
  // what was in it moves up one level, each thing's name made free there in turn; a folder in it (a newer Sol's) too
  const up = folder.parent ?? undefined;
  const things: Thing[] = f.things.filter((t) => t.parent !== folder.id);
  for (const t of f.things.filter((x) => x.parent === folder.id)) {
    const moved: Thing = { ...t, name: freeName(t.name, namesIn(things, up)) };
    delete moved.parent;
    if (up) moved.parent = up;
    things.push(moved);
  }
  const order = new Map(f.things.map((t, i) => [t.id, i]));
  things.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const rest = folders.filter((x) => x.id !== folder.id).map((x) => (x.parent === folder.id ? { ...x, parent: folder.parent } : x));
  return { file: withFolders(things, rest), folder, changed: true, say: `removed the folder ${folder.name}` };
}

// ---- the record ----
export type ThingsDeps = {
  record: () => Pick<RoomRecord, "files">;
  changed?: (repo: string) => void;   // the relay's `changed` word after a write, so another Sol reads the file anew (wire.ts)
};

const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].trim().slice(0, 200);
// gh's whole word (runGh keeps it on `full`; the message is its first line), and the status it ends with, `(HTTP nnn)`
const wordOf = (e: unknown) => String((e as { full?: string })?.full ?? (e as Error)?.message ?? e);
const statusOf = (e: unknown) => Number(/\(HTTP (\d{3})\)\s*$/.exec(wordOf(e).trim())?.[1] ?? 0);
const notFound = (e: unknown) => statusOf(e) === 404 || /not found/i.test(wordOf(e));
/** what a put that failed means (pure): `conflict` = someone wrote between (GitHub's 409 on a sha that moved, or its
 *  422 "sha wasn't supplied" when a file appeared since a read said 404): read again; `refused` = no access, a ruleset
 *  or protected branch (GitHub says that as a 409 too, in words), a repo or branch that is not there: say so; `limit`
 *  = GitHub's rate limit; else the first line of gh's word */
export function putFailure(e: unknown): "conflict" | "refused" | "limit" | string {
  const word = wordOf(e), status = statusOf(e);
  if (status === 409) return /rule|pull request|protected/i.test(word) ? "refused" : "conflict";
  if (status === 422 && /sha/i.test(word)) return "conflict";
  if (status === 403 && /rate limit/i.test(word)) return "limit";
  if (status === 401 || status === 403 || status === 404) return "refused";
  if (!status && /does not match/i.test(word)) return "conflict";
  return firstLine(e);
}
const PUT_LINE: Record<string, string> = { refused: "you can't write to this room yet", limit: "GitHub is rate-limiting you; try again in a minute" };

// the default branch of each record repo, asked once an engine run (the file lives on it; a room made by Sol has main,
// a repo brought in may have master); asking also says whether the repo can be seen at all
const branches = new Map<string, string>();
// the read under way is kept too, so two reads at once (the things and the goal, #232) ask once
const asking = new Map<string, Promise<string>>();
async function branchOf(d: ThingsDeps, repo: string): Promise<string> {
  const had = branches.get(repo);
  if (had) return had;
  let p = asking.get(repo);
  if (!p) { p = d.record().files.branch(repo).then((b) => { const v = b.trim() || "main"; branches.set(repo, v); return v; }).finally(() => asking.delete(repo)); asking.set(repo, p); }
  return p;
}
/** the record repo's default branch, read once a repo (the goal's head reads with it too, #232) */
export const recordBranch = (d: ThingsDeps, repo: string) => branchOf(d, repo);
/** for tests: forget the default branches read */
export const forgetBranches = () => { branches.clear(); };

/** the file as it is on the record repo's default branch, and its sha; a missing file is an empty list and no sha.
 *  Throws when the repo cannot be seen or read at all (gh signed out, no access, no network): that is not an empty room */
export async function readThings(d: ThingsDeps, repo: string): Promise<{ file: ThingsFile; sha?: string; branch: string }> {
  const branch = await branchOf(d, repo);
  let text = "";
  try { text = await d.record().files.readSha(repo, THINGS_PATH, branch); }
  catch (e) { if (notFound(e) && !/no commit found/i.test(wordOf(e))) return { file: empty(), branch }; throw e; }
  if (!text.trim()) return { file: empty(), branch };
  let j: Record<string, unknown> = {};
  try { const v = JSON.parse(text); if (isObj(v)) j = v; } catch { /* not what gh prints: an empty file */ }
  const content = Buffer.from(String(j.content ?? ""), "base64").toString("utf8");
  return { file: parse(content), sha: typeof j.sha === "string" ? j.sha : undefined, branch };
}

export type Changed = { file: ThingsFile; thing?: Thing; folder?: Folder; changed: boolean } | { error: string };

/** one change on the room's things, compare-and-swap: read, apply, put with the sha read; a conflict reads and applies
 *  again, three tries in all; a change that changes nothing is no commit. The commit says what was done: `things:
 *  added <name>` or `things: removed <name>`, by the person's own gh; an agent's add is `agent: true` on the thing.
 *  The body rides on --input (putBody), never on the command line: a list of a few hundred things is still one write */
export async function changeThings(d: ThingsDeps, repo: string, op: Op): Promise<Changed> {
  for (let i = 0; i < 3; i++) {
    let have: { file: ThingsFile; sha?: string; branch: string };
    try { have = await readThings(d, repo); }
    catch (e) { return { error: `couldn't read the room's things: ${firstLine(e)}` }; }
    if (have.file.newer) return { error: "this room's things were written by a newer Sol; update Sol first" };
    const r = apply(have.file, op);
    if (r.error) return { error: r.error };
    if (!r.changed) {
      // the same thing again (ADDITIONS §5): nothing written; who asked hears it, and the room's feed here says so
      if ("add" in op && r.thing) for (const f of again) f(repo, r.thing, { by: op.add.by, agent: !!op.add.agent });
      return { file: have.file, thing: r.thing, folder: r.folder, changed: false };
    }
    const message = `things: ${oneLine(r.say ?? "", 200)}`;
    try {
      await d.record().files.putBody(repo, THINGS_PATH, { message, branch: have.branch, content: Buffer.from(serialize(r.file)).toString("base64"), ...(have.sha ? { sha: have.sha } : {}) });
    } catch (e) {
      const why = putFailure(e);
      if (why === "conflict") continue;
      return { error: PUT_LINE[why] ?? why };
    }
    remember(repo, r.file);
    d.changed?.(repo);
    for (const f of subs) f(repo, r.file);
    return { file: r.file, thing: r.thing, folder: r.folder, changed: true };
  }
  return { error: "someone else changed it, try again" };
}

// ---- the cache, 60 s a repo like the board, and who hears a change ----
const TTL = 60_000;
let cache: { repo: string; file: ThingsFile; at: number } | null = null;
let gen = 0;   // bumped by every write made here, so a read that began before the write never covers it (the review of #194)
const subs = new Set<(repo: string, file: ThingsFile) => void>();
const again = new Set<(repo: string, thing: Thing, who: { by: string; agent: boolean }) => void>();
/** an add of a thing the room has already (the same link, or the same Google file by another link): wire.ts says it in
 *  the feed, "already here, opened the existing one", for a person's add and an agent's alike */
export function onAgain(fn: (repo: string, thing: Thing, who: { by: string; agent: boolean }) => void) { again.add(fn); return () => { again.delete(fn); }; }
const remember = (repo: string, file: ThingsFile, at = Date.now()) => { cache = { repo, file, at }; gen++; };
/** forget what was read: the room changed, or the relay said the repo did */
export const forgetThings = () => { cache = null; };
/** every change made here (wire.ts pushes the list to the Cowork faces; a read anew after the relay's `changed` is pushed
 *  by wire.ts itself) */
export function onThings(fn: (repo: string, file: ThingsFile) => void) { subs.add(fn); return () => { subs.delete(fn); }; }

/** the room's things: the cached list when it is this repo's and younger than 60 s, else read anew. A read that fails
 *  answers the cached list when there is one for this repo, else throws */
export async function getThings(d: ThingsDeps, repo: string, refresh = false, now = Date.now): Promise<ThingsFile> {
  if (!refresh && cache && cache.repo === repo && now() - cache.at < TTL) return cache.file;
  const g = gen;
  try {
    const { file } = await readThings(d, repo);
    if (gen !== g && cache && cache.repo === repo) return cache.file;   // a write landed while this read was out: the write is newer
    remember(repo, file, now());
    return file;
  } catch (e) {
    if (cache && cache.repo === repo) return cache.file;
    throw e;
  }
}

// ---- for the face and the agent ----
/** who touched a thing last (pure): for a GitHub thing that is one of the board's repos, the newest PR or card there
 *  (its author, its time); for everything else, who added it and when (a Google Doc's edits are not Sol's to see; who is
 *  in it now is step 2's presence) */
export function lastTouchOf(t: Thing, board: Pick<Board, "cards" | "prs"> | null): { who: string; at: string } {
  const own = { who: t.addedBy, at: t.at };
  if (t.kind !== "github" || !board) return own;
  const m = /^https:\/\/(?:www\.)?github\.com\/([^/]+\/[^/?#]+)/i.exec(t.url);
  if (!m) return own;
  const repo = m[1].toLowerCase();
  let best = own;
  const take = (who: string, at?: string) => { if (at && (!best.at || Date.parse(at) > Date.parse(best.at))) best = { who, at }; };
  for (const p of board.prs) if (p.repo.toLowerCase() === repo) take(p.author, p.updated ?? p.mergedAt);
  for (const c of board.cards) if (c.repo.toLowerCase() === repo) take(c.author, c.closed ?? c.created);
  return best;
}

/** the `team.things` message (pure) */
export function thingsMsg(file: ThingsFile, board: Pick<Board, "cards" | "prs"> | null, repo: string, rid?: unknown, roster: { who: string; thing?: { id: string } }[] = []): { type: "team.things"; rid?: unknown; repo: string; things: ThingForFace[]; folders: Folder[]; readOnly?: true; note?: string } {
  // inNow (#230): the people whose presence stands on the thing, from the relay's roster of the room
  const things = file.things.map((t) => ({ ...t, lastTouch: lastTouchOf(t, board), inNow: [...new Set(roster.filter((e) => e.thing?.id === t.id).map((e) => e.who))] }));
  // folders (#248): always a list, so a face tells "no folders" from an engine before folders (no field at all)
  return { type: "team.things", ...(rid !== undefined ? { rid } : {}), repo, things, folders: file.folders ?? [], ...(file.newer ? { readOnly: true } : {}), ...(repo ? {} : { note: NO_RECORD }) };
}

/** room_thing_add: an agent's add, through the same policy and compare-and-swap as the face's, marked as the agent's;
 *  refused in one line when the room has no record or my agent may not speak on GitHub (the record is GitHub) */
// why my agent may not change the room's things, or "" (pure)
const agentBar = (repo: string, mayGitHub: boolean, verb: string) =>
  !repo ? `${NO_RECORD}; nothing ${verb}`
    : mayGitHub ? ""
    : repo.startsWith("cloud:") || repo.startsWith("drive:") ? `not ${verb}: my agent may not speak in Cowork (Settings, my agent)` : `not ${verb}: my agent may not speak on GitHub (Settings, my agent), and the room's record is GitHub`;

export async function agentAdd(d: ThingsDeps, a: { repo: string; mayGitHub: boolean; login: string; url: unknown; name?: unknown; parent?: unknown; at?: string }): Promise<string> {
  const bar = agentBar(a.repo, a.mayGitHub, "added");
  if (bar) return bar;
  let parent: string | undefined;
  if (a.parent !== undefined && a.parent !== "") {
    let have: ThingsFile;
    try { have = await getThings(d, a.repo, true); } catch (e) { return `not added: couldn't read the room's things: ${firstLine(e)}`; }
    const p = placeOf(have, a.parent);
    if (!p) return `not added: no folder ${String(a.parent)}; room_things lists them`;
    parent = p.parent;
  }
  const r = await changeThings(d, a.repo, { add: { url: a.url, name: a.name, by: a.login, at: a.at ?? new Date().toISOString(), agent: true, ...(parent ? { parent } : {}) } });
  if ("error" in r) return `not added: ${r.error}`;
  const t = r.thing!;
  const where = t.parent ? ` in ${(r.file.folders ?? []).find((x) => x.id === t.parent)?.name ?? "a folder"}` : "";
  return r.changed ? `added ${t.kind} · ${t.name} (${t.id})${where}; the room sees it` : `already here, so nothing was added: ${t.kind} · ${t.name} (${t.id})${where}; use that one`;
}

/** a folder by its name (case does not count), else by its id, for an agent that names it either way (pure); a name
 *  wins over an id, since an agent reads names */
export function findFolder(file: ThingsFile, key: unknown): Folder | undefined {
  const raw = String(key ?? "").trim(), k = raw.length > 1 ? raw.replace(/\/$/, "") : raw;
  const all = file.folders ?? [];
  return all.find((x) => low(x.name) === low(k)) ?? all.find((x) => x.id === k);
}
/** where an agent's words put a thing (pure): a folder they name, else the top for "", "/", "top" or "the top", else none */
export function placeOf(file: ThingsFile, key: unknown): { parent?: string } | null {
  if (key === undefined || key === null) return {};
  const f = findFolder(file, key);
  if (f) return { parent: f.id };
  return /^\s*(|\/|top|the top)\s*$/i.test(String(key)) ? {} : null;
}

/** room_folder_add: an agent makes a folder at the top of the room's things */
export async function agentFolder(d: ThingsDeps, a: { repo: string; mayGitHub: boolean; login: string; name: unknown; at?: string; id?: string }): Promise<string> {
  const bar = agentBar(a.repo, a.mayGitHub, "made");
  if (bar) return bar;
  // the room's first folder is a person's call (older Sols go read-only on it): an agent makes folders only after it
  const r = await changeThings(d, a.repo, { folder: { id: a.id ?? folderId(), name: a.name, by: a.login, at: a.at ?? new Date().toISOString(), agent: true } });
  if ("error" in r) return r.error === FIRST_FOLDER ? "not made: the room's first folder is your human's to make, in Cowork (+ new folder), since an older Sol then only reads this room's things" : `not made: ${r.error}`;
  return `made the folder ${r.folder!.name} (${r.folder!.id}); move things in with room_thing_move { id, to: "${r.folder!.name}" }`;
}

/** room_thing_move: an agent moves a thing into a folder (its id or name) or to the top ("") */
export async function agentMove(d: ThingsDeps, a: { repo: string; mayGitHub: boolean; id: unknown; to: unknown }): Promise<string> {
  const bar = agentBar(a.repo, a.mayGitHub, "moved");
  if (bar) return bar;
  let have: ThingsFile;
  try { have = await getThings(d, a.repo, true); } catch (e) { return `not moved: couldn't read the room's things: ${firstLine(e)}`; }
  const p = placeOf(have, a.to);
  if (!p) return `not moved: no folder ${String(a.to)}; room_things lists them`;
  const to = p.parent;
  const r = await changeThings(d, a.repo, { move: { id: a.id, to: to ?? null } });
  if ("error" in r) return `not moved: ${r.error}`;
  const where = to ? (r.file.folders ?? []).find((x) => x.id === to)?.name ?? to : "the top";
  return r.changed ? `moved ${r.thing!.name} to ${where}` : `${r.thing!.name} is in ${where} already`;
}

/** the list as plain lines, for an agent (pure): a tree, the folders first, each with its things under it, then the
 *  things at the top; a thing is `<id>  <kind> · <name> · <url> · added by <who>[ 's agent]` */
export function thingsText(file: ThingsFile, repo: string): string {
  if (!repo) return NO_RECORD;
  const folders = file.folders ?? [];
  if (!file.things.length && !folders.length) return "no things yet; add one with room_thing_add { url, name? }";
  const line = (t: Thing, pad: string) => `${pad}${t.id}  ${t.kind} · ${t.name} · ${t.url} · added by ${t.addedBy || "someone"}${t.agent ? "'s agent" : ""}${t.at ? ` · ${t.at.slice(0, 10)}` : ""}`;
  const out: string[] = [];
  const walk = (parent: string | null, pad: string) => {
    for (const d of folders.filter((x) => x.parent === parent)) {
      const n = file.things.filter((t) => t.parent === d.id).length;
      out.push(`${pad}${d.name}/  (folder ${d.id} · ${n} thing${n === 1 ? "" : "s"}${d.by ? ` · made by ${d.by}` : ""})`);
      walk(d.id, pad + "  ");
    }
    for (const t of file.things.filter((x) => (x.parent ?? null) === parent)) out.push(line(t, pad));
  };
  walk(null, "");
  return out.join("\n");
}
