// Share and join (#157, PROTOCOL.md round 35): a room is shared as a six-symbol code its hub keeps (registry.ts), and
// joined by typing that code. Sharing asks the room's hub for its code (this engine's own registry when the room meets
// here) and keeps it on the room. Joining asks the hubs I know, then the shared hub, then my own, for the room the code
// names, and adds it as the room in use. Making (#160) takes a name alone: the hub says whether it is free, the record
// makes the room's repository under my account, and the room is registered at once so it has its code, then cloned
// into the rooms folder (#162, letin.ts). A room coded before rooms[].mine is registered again once a run (shareAgain),
// which makes it mine only when the hub gives me its code back. Everything it touches is handed in, so the tests run
// with no network.
import { activeRoom, cleanRoom, slug, sharedHub, isCloud, type Room, type TeamSettings } from "./settings.js";
import { asGitHub, hubHttp, safeForToken, thisMachine } from "./relay.js";
import { normalCode, type Entry, type RoomIn } from "../hub/index.js";
import type { RoomRecord } from "./record.js";
import { driveFolderId } from "./record/drive.js";

export type RoomsDeps = {
  team: () => TeamSettings;
  patch: (p: Record<string, unknown>) => TeamSettings;
  local: { register: (room: RoomIn, by: string) => Entry; lookup: (code: string) => Entry | null; taken: (name: string) => boolean; forget?: (code: string, by: string) => boolean } | null;   // this engine's registry
  fetch: typeof fetch;
  token: () => Promise<string>;   // the person's GitHub token, fresh from gh; "" when not signed in. To this machine only
  ticket: (hub: string) => Promise<string>;   // my ticket for a hub (proof.ts, relay.ts hubTicket); "" when none
  record: () => Pick<RoomRecord, "room">;   // where a made room's repository is made (#160)
  clone?: (id: string) => Promise<{ folder: string } | { error: string }>;   // a made room's repository, cloned (#162, letin.ts)
  cloudAt?: (hub: string) => boolean;   // do I have an account on the cloud at this http address (#216, cloud.ts accountOn)
  driveCheck?: (folder: string) => Promise<string | null>;   // can I write in this Drive folder with my Google Drive, its record's files made there (#152): null yes, else why not
};

const WAIT = 8000;
const firstLine = async (r: Response) => {
  const text = await r.text().catch(() => "");
  let said = text;
  // a JSON string is the line itself; an object says it in `error`; anything else is plain words
  try { const v = JSON.parse(text); if (typeof v === "string") said = v; else if (v && typeof v.error === "string") said = v.error; } catch { /* plain words */ }
  return said.split("\n")[0].trim().slice(0, 200) || `${r.status}`;
};

// a refusal in the hub's own words (round 35: which gate said no), or an older Sol's bare 403
const REFUSED = "the hub refused";
const refusedLine = async (r: Response) => { const said = await firstLine(r); return said === "403" ? `${REFUSED} (an older Sol there?)` : `${REFUSED}: ${said}`; };
const CLEAR = "that hub is not https; Sol does not send your GitHub sign-in in the clear";
// S6b (#226): Sol's cloud knows me by my Sol account only: a refusal there with no account is that
export const SIGN_IN = "sign in to Sol first: Settings › me › Sol (the cloud knows you by your Sol account)";
const unsigned = (d: RoomsDeps, hub: string) => !!d.cloudAt && isCloud(hub) && !d.cloudAt(hubHttp(hub));

export { hubHttp, safeForToken };   // relay.ts's, for the socket too

/** the url and headers of one call to a hub. Unlike the socket (relayUrl, from before codes), these calls never carry
 *  this engine's own relay.key: a foreign hub gets the room's own key, when it gave one, else no key at all (the
 *  security review of #157). When the room meets as GitHub (relay.ts asGitHub), and only over https or to this
 *  machine, the hub gets its ticket for me (proof.ts), never my token, which could write as me; this machine's own hub
 *  gets my token, which never leaves it. `clear` says it was held back */
async function call(d: RoomsDeps, room: Pick<Room, "hub" | "key" | "org" | "gate">, path: string) {
  const hub = hubHttp(room.hub);
  let url = hub + path;
  if (!room.org && room.key) url += `?key=${encodeURIComponent(room.key)}`;
  const headers: Record<string, string> = {};
  let clear = false;
  if (asGitHub(room.org, room)) {
    if (!safeForToken(url)) clear = true;
    // a cloud I have an account on takes its ticket, on this machine too (a cloud run here): never my GitHub token (#216)
    else { const t = await (thisMachine(url) && !d.cloudAt?.(hub) ? d.token() : d.ticket(hub)).catch(() => ""); if (t) headers.authorization = `Bearer ${t}`; }
  }
  return { url, headers, clear };
}


/** the code a room is shared with: the one it has, else one its hub gives it, kept on the room. A room whose code this
 *  share made is mine (#162): its repos are my own words. A room that has a code and is not marked mine (one from before
 *  #162, or whose repos were edited since) is registered again (claim) */
export async function shareRoom(d: RoomsDeps, id?: string): Promise<{ code: string } | { error: string }> {
  const s = d.team();
  const r = s.rooms.find((x) => x.id === (id || s.room));
  if (!r) return { error: "which room?" };
  if (r.code) {
    if (claimable(r)) await claim(d, r);
    return { code: r.code };
  }
  const got = await register(d, r, s.me.login);
  if ("error" in got) return got;
  // the rooms as they are now, from the settings (never a face's), so every key is kept as it is; mine only while its
  // repos are still the ones registered (a face may have edited them while the hub answered)
  d.patch({ rooms: d.team().rooms.map((x) => (x.id === r.id ? { ...x, code: got.code, mine: sameRepos(x, r) } : x)) });
  return { code: got.code };
}

const sameRepos = (a: Pick<Room, "repos">, b: Pick<Room, "repos">) => a.repos.join("\n") === b.repos.join("\n");
// a room that may be registered again to see whether it is mine: it has a code, is not mine yet, came to me by no code
// I typed (a joined room's repos are the word of whoever registered it: never claimed, renamed or not), and has no org
// (an org room's people are the org's; nobody is let in by me)
const claimable = (r: Room) => !!r.code && !r.mine && !r.joined && !r.org && !r.was;   // a moved room's code is its old hub's (S6b)

/** said when the hub could not be reached: the room's try is not spent (shareAgain) */
export const NO_ANSWER = "the hub did not answer";

/** a room with a code registered again (#162): the hub gives the same code back only for the same room by the same
 *  maker (registry.ts), so the room is mine when it does, and only while its repos and code are still those. Anyone else
 *  is answered "that name is taken", or a code of their own, and the room stays as it is */
async function claim(d: RoomsDeps, r: Room): Promise<{ mine: boolean } | { error: string }> {
  const again = await register(d, r, d.team().me.login);
  if ("error" in again) return again;
  if (again.code !== r.code) return { mine: false };
  d.patch({ rooms: d.team().rooms.map((x) => (x.id === r.id && x.code === r.code && !x.joined && sameRepos(x, r) ? { ...x, mine: true } : x)) });
  return { mine: d.team().rooms.find((x) => x.id === r.id)?.mine === true };
}

// the rooms registered again in this engine's run: each at most once (a hub that did not answer is not a try)
const claimed = new Set<string>();
/** for the tests: every room may be registered again */
export const resetShareAgain = () => claimed.clear();

/** every room coded before rooms[].mine (#162), or whose repos were edited since, registered again once an engine run:
 *  at start and on each relay connect (wire.ts). A room that has a code, is not mine, is not joined, has no org. The ids
 *  that are mine now */
export async function shareAgain(d: RoomsDeps): Promise<string[]> {
  const out: string[] = [];
  for (const r of d.team().rooms) {
    if (!claimable(r) || claimed.has(r.id)) continue;
    claimed.add(r.id);
    const got = await claim(d, r).catch(() => ({ error: NO_ANSWER }));
    if ("error" in got && got.error === NO_ANSWER) claimed.delete(r.id);
    else if ("mine" in got && got.mine) out.push(r.id);
  }
  return out;
}

/** a room registered on its hub (this engine's own registry when it meets here), and the code the hub answers */
async function register(d: RoomsDeps, r: Room, me: string): Promise<{ code: string } | { error: string }> {
  const body = { name: r.name, provider: r.provider, org: r.org, repos: r.repos };
  let code = "";
  if (!r.hub) {
    if (!d.local) return { error: "this Sol keeps no codes" };
    try { code = d.local.register(body, me).code; }
    catch (e) { return { error: String((e as Error)?.message ?? e).slice(0, 200) }; }
  } else {
    const { url, headers, clear } = await call(d, r, "/rooms");
    if (!url.startsWith("http")) return { error: "where the room meets is not an address" };
    let res: Response;
    try { res = await d.fetch(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(WAIT) }); }
    catch { return { error: NO_ANSWER }; }
    if (res.status === 403) return { error: clear ? CLEAR : await refusedLine(res) };
    if (!res.ok) return { error: `the hub said: ${await firstLine(res)}` };
    const v = await res.json().catch(() => null) as { code?: unknown } | null;
    code = normalCode(v?.code);
    if (!code) return { error: "the hub said nothing like a code" };
  }
  return { code };
}

/** the room in use to register at once, or null (#157): only a room met as GitHub with no code yet, since an open hub
 *  opens only coded rooms; and only when the room in use changed (its id or its hub) or the engine started (before
 *  null), never on every patch */
export function shareOnArrival(before: TeamSettings | null, after: TeamSettings): string | null {
  const r = activeRoom(after), was = before ? activeRoom(before) : null;
  if (r.gate !== "github" || r.code) return null;
  return !was || was.id !== r.id || was.hub !== r.hub ? r.id : null;
}

/** an id for a new room: the name's slug, then -2, -3 and on (the face's rule, mac/src/cowork/rooms.ts) */
function freeId(list: { id: string }[], name: string): string {
  const root = slug(name) || "room";
  let id = root;
  for (let i = 2; list.some((x) => x.id === id); i++) id = `${root.slice(0, 36)}-${i}`;
  return id;
}

/** the room a code names, added as the room in use; a code of a room I am in already only goes there */
export async function joinRoom(d: RoomsDeps, typed: unknown): Promise<{ room: Room; already?: true } | { error: string }> {
  const code = normalCode(typed);
  if (!code) return { error: "a code is six letters and digits" };
  const s = d.team();
  const mine = s.rooms.find((r) => r.code === code);
  if (mine) { d.patch({ room: mine.id }); return { room: mine, already: true }; }
  if (s.rooms.length >= 20) return { error: "you are in twenty rooms already; forget one first" };
  // the hubs to ask, in order: every hub my rooms meet on, then the shared hub, each once; then this engine's own
  const hubs: string[] = [];
  for (const h of [...s.rooms.map((r) => r.hub), sharedHub()]) if (h && !hubs.includes(h)) hubs.push(h);
  let found: { entry: Pick<Entry, "name" | "provider" | "org" | "repos">; hub: string } | null = null;
  let refused = "", missed = false, inClear = false;
  for (const hub of hubs) {
    // met the way a room of mine on that hub meets it; a hub none of mine meets on, as a room joined by a code would
    const like = s.rooms.find((r) => r.hub === hub) ?? { hub, key: "", org: "", gate: "github" as const };
    const { url, headers, clear } = await call(d, { hub, key: like.key, org: like.org, gate: like.gate }, `/rooms/${code}`);
    if (!url.startsWith("http")) continue;
    let res: Response;
    try { res = await d.fetch(url, { headers, signal: AbortSignal.timeout(WAIT) }); } catch { continue; }
    if (res.status === 403) { if (clear) inClear = true; else refused ||= unsigned(d, hub) ? SIGN_IN : await refusedLine(res); continue; }
    if (res.status === 404) { missed = true; continue; }
    if (!res.ok) continue;
    const v = await res.json().catch(() => null) as { room?: Entry } | null;
    if (v?.room && typeof v.room === "object") { found = { entry: v.room, hub }; break; }
  }
  if (!found && d.local) {
    const e = d.local.lookup(code);   // my own registry: a miss here says nothing about the hubs
    if (e) found = { entry: e, hub: "" };
  }
  // a hub that could not be asked is said first: the code may well be there
  if (!found) return { error: refused || (inClear ? CLEAR : missed ? "no room has that code" : "the hub did not answer") };
  const name = typeof found.entry.name === "string" && found.entry.name.trim() ? found.entry.name.trim().slice(0, 60) : "room";
  // met as GitHub on the hub that answered; one found in my own registry meets here, by this engine's key
  const room = cleanRoom({ id: freeId(s.rooms, name), name, provider: found.entry.provider, org: found.entry.org, repos: found.entry.repos, hub: found.hub, key: "", code, gate: found.hub ? "github" : "key", mine: false, joined: true });
  if (!room) return { error: "the hub's answer was not a room" };
  // the same record on the same hub as a room I am in already (its provider, org, repos and the hub that answered),
  // with no code yet: that room takes the code, and I go there. One with another code is another room on that hub
  const same = (r: Room) => r.hub === room.hub && !r.code && r.provider === room.provider && r.org.toLowerCase() === room.org.toLowerCase()
    && [...r.repos].map((x) => x.toLowerCase()).sort().join(",") === [...room.repos].map((x) => x.toLowerCase()).sort().join(",");
  const had = s.rooms.find(same);
  if (had) {
    // its repos are now also the hub's word, from whoever registered the code: no longer mine, and joined, since the code
    // came from a hub's answer to one I typed (#162)
    const after = d.patch({ rooms: s.rooms.map((r) => (r.id === had.id ? { ...r, code, mine: false, joined: true } : r)), room: had.id });
    return { room: after.rooms.find((r) => r.id === had.id) ?? had, already: true };
  }
  const after = d.patch({ rooms: [...s.rooms, room], room: room.id });
  const kept = after.rooms.find((r) => r.id === room.id);
  return kept ? { room: kept } : { error: "Sol did not keep that room; try again" };
}

/** the rooms of mine with a code that a patch took away: each forgotten on its hub (the stack's review), so its code
 *  and its name are free again at once, not when the hub is full. Only rooms that are mine (a joined room's code is
 *  its maker's), and nothing is waited for: a hub that does not answer keeps the room until it is quiet. The codes sent */
export async function forgetGone(d: RoomsDeps, before: TeamSettings, after: TeamSettings): Promise<string[]> {
  // a cloud room is left, mine or not (#216): I am no longer one of its members, and it passes to the next member when I
  // made it (C11, sol/cloud/src/rooms.ts); leaving, never the maker's forget, so another of my machines that made me a
  // member again is answered the same way
  // and so is any room on a cloud I have an account on (codex, #227): a GitHub room imported from the NucBox (S6b) has a
  // maker no Sol name can be, so only leaving takes me out of it
  const member = (r: Room) => r.provider === "cloud" || (!!r.hub && !!d.cloudAt?.(hubHttp(r.hub)));
  const gone = before.rooms.filter((r) => (r.mine || member(r)) && r.code && !after.rooms.some((x) => x.id === r.id));
  const me = after.me.login, sent: string[] = [];
  for (const r of gone) {
    if (!r.hub) { if (d.local?.forget?.(r.code, me)) sent.push(r.code); continue; }
    const { url, headers, clear } = await call(d, r, member(r) ? `/rooms/${r.code}/members/me` : `/rooms/${r.code}`);
    if (clear || !url.startsWith("http") || !headers.authorization) continue;   // only GitHub's word forgets a room
    const res = await d.fetch(url, { method: "DELETE", headers, signal: AbortSignal.timeout(WAIT) }).catch(() => null);
    if (res?.ok) sent.push(r.code);
  }
  return sent;
}

/** a room made from its name alone (#160): the hub says the name is free, the record makes its repository under my
 *  account, the room is added as the room in use and registered at once, so its code is on it. hub: the one given,
 *  else the shared hub ("" is this Mac's own); a key given makes it a room met by that key, else one met as GitHub.
 *  A register that fails keeps the room with no code and says why in `warn` */
export async function makeRoom(d: RoomsDeps, typed: { name?: unknown; hub?: unknown; key?: unknown; code?: unknown; drive?: unknown }): Promise<{ room: Room; warn?: string } | { error: string }> {
  const name = typeof typed.name === "string" ? typed.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 60) return { error: "a room needs a name" };
  // a Drive room (#152): its record is the folder pasted, seen first with my own Google Drive, so a room is never made
  // over a folder nobody here can open; then the name is checked and the room registered on its hub like any other
  let folder = "";
  if (typed.drive !== undefined) {
    const f = driveFolderId(typed.drive);
    if ("error" in f) return f;
    if (!d.driveCheck) return { error: "this Sol has no Google Drive" };
    const why = await d.driveCheck(f.id).catch((e) => String((e as Error)?.message ?? e).split("\n")[0].replace(/\s*\(HTTP \d{3}\)\s*$/, "").slice(0, 200));
    if (why) return { error: why };
    folder = f.id;
  }
  const hub = typeof typed.hub === "string" ? typed.hub.trim() : sharedHub();
  if (hub && !/^wss?:\/\/\S+$/.test(hub)) return { error: "where it meets starts with ws:// or wss://, or stays blank for this Mac" };
  const key = typeof typed.key === "string" ? typed.key.trim() : "";
  const gate = key ? "key" as const : hub ? "github" as const : "key" as const;
  const s = d.team();
  if (s.rooms.length >= 20) return { error: "you are in twenty rooms already; forget one first" };
  // (a) is the name free where it meets
  if (!hub) { if (d.local?.taken(name)) return { error: "that name is taken" }; }
  else {
    const { url, headers, clear } = await call(d, { hub, key, org: "", gate }, `/names/${encodeURIComponent(name)}`);
    if (!url.startsWith("http")) return { error: "where it meets is not an address" };
    let res: Response;
    try { res = await d.fetch(url, { headers, signal: AbortSignal.timeout(WAIT) }); } catch { return { error: "the hub did not answer" }; }
    if (res.status === 403) return { error: clear ? CLEAR : unsigned(d, hub) ? SIGN_IN : await refusedLine(res) };
    if (res.status === 404) return { error: "that hub is an older Sol: it cannot make a room from a name yet" };
    if (!res.ok) return { error: `the hub said: ${await firstLine(res)}` };
    const v = await res.json().catch(() => null) as { free?: unknown } | null;
    if (v?.free !== true) return { error: "that name is taken" };
  }
  // (b'') a Drive room's record is its folder: nothing is made, the room is added and registered at once
  if (folder) return makeDriveRoom(d, name, folder, hub, key, gate);
  // (b') on a cloud I am signed in to (#216), an ordinary room keeps its record there: no repository is made. Only a room
  // for code (typed.code) is made the GitHub way, below
  if (hub && !key && typed.code !== true && d.cloudAt?.(hubHttp(hub))) return makeCloudRoom(d, name, hub);
  // (b) its repository, under my account
  let repo = "";
  try { repo = (await d.record().room.make(name)).trim(); }
  catch (e) { return { error: String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200) }; }
  // (c) the room, the one in use
  const room = cleanRoom({ id: freeId(s.rooms, name), name, provider: "github", org: "", repos: [repo], hub, key, code: "", gate, mine: true });
  if (!room) return { error: `GitHub answered ${repo || "nothing"}, not a repository` };
  const after = d.patch({ rooms: [...d.team().rooms, room], room: room.id });
  if (!after.rooms.some((r) => r.id === room.id)) return { error: "Sol did not keep that room; try again" };
  // (d) its code, at once
  const shared = await shareRoom(d, room.id);
  // (e) its repository on this machine (#162), so a session can start in it soon: in the background, since a clone may
  // take longer than the face waits; cloneRoom says how it went in its own receipt
  if (d.clone) void d.clone(room.id).catch(() => {});
  const now = d.team().rooms.find((r) => r.id === room.id) ?? room;
  return "error" in shared ? { room: now, warn: shared.error } : { room: now };
}

/** a room whose record is the cloud's (#216): registered first, since its code is what it is, then added as the room in
 *  use. Nothing is made on GitHub and nothing is cloned */
async function makeCloudRoom(d: RoomsDeps, name: string, hub: string): Promise<{ room: Room } | { error: string }> {
  const s = d.team();
  const draft: Room = { id: "", name, provider: "cloud", org: "", repos: [], hub, key: "", code: "", gate: "github", folder: "", mine: true, joined: false };
  const got = await register(d, draft, s.me.login);
  if ("error" in got) return got;
  const room = cleanRoom({ ...draft, id: freeId(s.rooms, name), code: got.code });
  if (!room) return { error: "the cloud's answer was not a room" };
  const after = d.patch({ rooms: [...d.team().rooms, room], room: room.id });
  const kept = after.rooms.find((r) => r.id === room.id);
  return kept ? { room: kept } : { error: "Sol did not keep that room; try again" };
}

/** a room whose record is a Drive folder (#152): added as the room in use, then registered, so its code is on it. Like a
 *  room made from a repository, a register that fails keeps the room with no code and says why. Nothing is cloned */
async function makeDriveRoom(d: RoomsDeps, name: string, folder: string, hub: string, key: string, gate: "key" | "github"): Promise<{ room: Room; warn?: string } | { error: string }> {
  const s = d.team();
  const room = cleanRoom({ id: freeId(s.rooms, name), name, provider: "drive", org: "", repos: [folder], hub, key, code: "", gate, mine: true });
  if (!room) return { error: "that folder is not one a room can keep its record in" };
  const after = d.patch({ rooms: [...d.team().rooms, room], room: room.id });
  if (!after.rooms.some((r) => r.id === room.id)) return { error: "Sol did not keep that room; try again" };
  const shared = await shareRoom(d, room.id);
  const now = d.team().rooms.find((r) => r.id === room.id) ?? room;
  return "error" in shared ? { room: now, warn: shared.error } : { room: now };
}
