// The team settings (Together, sol/design/together/BUILD.md): one JSON file beside the engine, sol/engine/team.json
// (gitignored; SOL_TEAM overrides the path, for tests and a second engine). The same clean/merge pattern as
// ../settings.ts: whatever is on disk or in a patch is made into a valid TeamSettings, anything unknown is dropped.
// See owns this file; the other slices read and write through its exports. The schema is complete: no slice changes it.
// Control (#32) adds: the machine rows, the login guard and the Life seat mirror in patchTeam, and where my agent may
// speak (mayAgentSpeak, speakParagraph, speakRefusal). The night job (#99) adds `night`: its hour and the days a claim
// may sit still (docs/how-we-work/PRD.md section 12, a team value). Pings (#100) add the dials: per ping kind, always,
// when it matters, or never (pings.ts).
// Rooms (#154, docs/room-provider/FOUNDATION.md): a list of rooms, one active. A room is a group's record and its
// people: a provider, an org or repos, the hub it meets on. `org`, `repos` and `relay.url` stay at the top and are
// always the active room's, derived here, so nothing that reads getTeam() had to change. A file from before rooms
// reads as one room, "team", made of those three; a patch that names them writes into the active room.
// A share code (#157): a room may carry the six-symbol code it was shared with, looked up on the hub it meets on
// (registry.ts). `relay.open` lets anyone signed in to GitHub meet on the hub this engine runs, the beta's hub.
// A room's folder (#162): where Sol cloned the room's repository on this machine, one folder a room under ROOMS_DIR.
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings, patchSettings } from "../settings.js";
import { cleanDials, DIAL_DEFAULTS, type Dials } from "./pings.js";
import { makeGithubRecord, runners } from "./record.js";
import { ownGhOnPath } from "./gh.js";
import { DRIVE_ID } from "./record/drive.js";

/** one room (#154): id a slug, the provider that keeps its record, a GitHub org or repos (a Drive room's folders), the
 *  hub, and the key that hub gave me ("" = this engine's own relay.key); the key never goes to a face, like relay.key.
 *  code (#157): the share code the room's hub knows it by, "" until it is shared; not a secret, a face sees it.
 *  gate (#157): how the room's hub knows me. "key": by a key (the room's, or relay.key given by hand), every room from
 *  before codes; "github": by my GitHub token, a room joined by a code or made on the shared hub with no key.
 *  folder (#162): the absolute path Sol cloned the room's repository into, "" until it did; only the engine sets it.
 *  mine (#162): the repos are my own words: a room I made (#160) or first shared (#157) from here, or one whose hub
 *  says I registered its code; never one joined by a code, whose repos are the hub's word, written by whoever shared
 *  it. Only for such a room does my Sol let anyone into a repository. Only the engine sets it. A room whose repos any
 *  patch changes is no longer mine: the hub's word was for the repos it had.
 *  joined (#162): the room came to me by a code I typed (team.room.join). Such a room is never registered again to see
 *  whether it is mine, and its repository is cloned only on an answer heard in it. Only the engine sets it */
export type Room = { id: string; name: string; provider: "github" | "drive" | "cloud"; org: string; repos: string[]; hub: string; key: string; code: string; gate: "key" | "github"; folder: string; mine: boolean; joined: boolean; was?: Was;
  /** "show my room sessions" off for this room (#238, the studio PRD §5): my room sessions do not stream to it, and my
   *  roster entry there says so. Absent: on, the default (#189, option 2) */
  quiet?: true };
/** a room that moved hubs (A10, S6b): how team.json says it, the hub, key and gate before the move. The move is made on
 *  every read and never written: team.json keeps the old words, so a Sol from before the move (one stable back) still
 *  meets where it did, and SOL_HUB_MOVED=off undoes it. Only the engine has it; never a face's (forFace) */
export type Was = { hub: string; key: string; gate: "key" | "github" };

export type TeamSettings = {
  me: { login: string; name: string };                 // from `gh api user` on first run (no gh: name from SOL_OWNER); the person may edit name
  org: string;                                         // the GitHub org ("" until Marco makes it); the active room's
  repos: string[];                                     // "owner/name"; when org is "", this list is the org; the active room's
  relay: { url: string; key: string; host: boolean; open: boolean };  // url "" = this engine's own relay (the active room's hub); host = this engine runs one; open (#157) = anyone signed in to GitHub may meet on it
  rooms: Room[];                                       // every room I am in (#154); never empty once cleaned
  room: string;                                        // the active room's id
  speak: { github: boolean; cowork: boolean; discord: "never" | "builds" | "any"; whatsapp: boolean };
  leaves: { prompts: boolean; memory: boolean; transcripts: boolean; audit: "ask" | "never" };
  seats: { life: "codex" | "claude"; work: "codex" | "claude" };
  machines: { name: string; url: string }[];           // my machines (the engines I can pick); Control owns the rows
  night: { hour: number; staleDays: number };          // the night job (#99): when it runs, and when a still claim is dropped
  dials: Dials;                                        // per ping kind: always, matters (default), never (#100)
};

export const TEAM_DEFAULTS: TeamSettings = {
  me: { login: "", name: "" },
  org: "",
  repos: ["marcocyl04-ux/sol-dev"],
  relay: { url: "", key: "", host: false, open: false },   // host off by default (#210, MASTER section 8 step 1): see readTeam
  rooms: [],      // absent in a file: one room, "team", from org, repos and relay.url (#154)
  room: "",
  speak: { github: true, cowork: true, discord: "builds", whatsapp: false },
  leaves: { prompts: false, memory: false, transcripts: false, audit: "ask" },
  seats: { life: "codex", work: "claude" },
  machines: [],   // absent in a file: this Mac and the relay's machine (defaultMachines); present and empty: empty
  night: { hour: 3, staleDays: 7 },
  dials: { ...DIAL_DEFAULTS },
};

// The rows when a file names none (#169): this Mac, and the machine that runs the team's relay when team.json names
// one (`wss://HOST/relay` is also a Sol at `wss://HOST/`: the NucBox for Marco's team). Before this the NucBox's
// address was written here, and so went into every copy of Sol; a Sol with no relay now knows this machine alone.
export const THIS_MACHINE = { name: "this Mac", url: "ws://127.0.0.1:7777" };
export function defaultMachines(relayUrl: string): { name: string; url: string }[] {
  let u: URL;
  try { u = new URL(relayUrl.trim()); } catch { return [{ ...THIS_MACHINE }]; }
  if (!/^wss?:$/.test(u.protocol) || !u.hostname) return [{ ...THIS_MACHINE }];
  const host = u.hostname;                                   // an IPv6 host keeps its brackets, `[::1]`
  if (["127.0.0.1", "localhost", "[::1]"].includes(host)) return [{ ...THIS_MACHINE }];
  return [{ ...THIS_MACHINE }, { name: host.startsWith("[") ? host : host.split(".")[0], url: `${u.protocol}//${u.host}/` }];
}

const FILE = process.env.SOL_TEAM ?? process.env.SOL_TEAM_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "team.json");

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, d = "", max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const seat = (v: unknown, d: "codex" | "claude") => (v === "codex" || v === "claude" ? v : d);
const int = (v: unknown, d: number, lo: number, hi: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : d);
// the format rules are the hub's (#206): hub/hub-types.ts keeps the one copy (#208: the package sol/hub), read here as before
import { REPO, LOGIN, CODE } from "../hub/index.js";
export { REPO, LOGIN, CODE };
const WS = /^wss?:\/\/\S+$/;
const URL_OK = /^wss?:\/\/[^\s/]+(\/\S*)?$/;
const SLUG = /^[a-z0-9-]{1,40}$/;
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 40).replace(/-+$/, "");
// never a key pasted into the address: the key has its own field
const hubOf = (v: unknown) => { const u = str(v, "", 300).replace(/[?#].*$/, ""); return u === "" || WS.test(u) ? u : ""; };
const nameOf = (org: string, repos: string[]) => (org || (repos[0] ?? "").split("/").pop() || "").slice(0, 60);
const codeOf = (v: unknown) => { const c = str(v, "", 20).toUpperCase(); return CODE.test(c) ? c : ""; };

/** the hosts this engine's hub answers at (proof.ts): SOL_HUB_HOST in sol/engine/.env, one or more, comma between.
 *  A proof gist must name one, so the hub's own setting says who it is, never a request's Host, which the sender
 *  writes. None: the hub gives no tickets */
export const hubHosts = (): string[] => (process.env.SOL_HUB_HOST ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+(:\d+)?$/.test(h));
/** the cloud (#168, S6b): the hub every Sol meets on unless its .env names another (SOL_HUB) */
export const CLOUD_HUB = "wss://cloud.matterfold.tech/relay";
/** A10 (#216, MASTER §6): old hub addresses a Sol rewrites to new ones, so a room kept on a hub that moved follows it
 *  with nothing done by hand. SOL_HUB_MOVED in sol/engine/.env, `old=>new` pairs, comma between, each a ws(s) address.
 *  S6b (#226) adds the built-in pairs below; SOL_HUB_MOVED adds to them, and the word `off` in it turns them off. A
 *  room's hub, as read from team.json or a hub's answer, goes through it (cleanRoom), so nothing else needs to know */
export function movedHubs(env = process.env.SOL_HUB_MOVED ?? ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of env.split(",")) {
    const [from, to] = pair.split("=>").map((x) => (x ?? "").trim().replace(/[?#].*$/, "").replace(/\/+$/, ""));
    if (from && to && WS.test(from) && WS.test(to) && from.toLowerCase() !== to.toLowerCase()) out.set(from.toLowerCase(), to);
  }
  return out;
}
/** the hubs that moved, built in (S6b, #226): the NucBox's hub, the beta's until the cloud, now the cloud. Each old
 *  address is kept as the SHA-256 of its plain form (hubKey), never as written: it is a tailnet's private address, and
 *  nothing that names one may leave in the beta export (ship.ts exportOffence) */
export const BUILT_IN_MOVED: ReadonlyMap<string, string> = new Map([
  ["2024c1bbae72cf6754651c08066f2b52887e036bf2b1c4c9084becd636a160a5", CLOUD_HUB],
]);
/** a hub address in one plain form, to compare: lower case, no query, no trailing slash, no :443, `/relay` when it has no path */
export const hubKey = (hub: string): string => {
  const h = hub.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase().replace(/^(wss:\/\/[^/]+):443(?=\/|$)/, "$1");
  return /^wss?:\/\/[^/]+$/.test(h) ? `${h}/relay` : h;
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** is this hub Sol's cloud, where a person is known by a Sol account and nothing else (S6b) */
export const isCloud = (hub: string): boolean => !!hub && hubKey(hub) === hubKey(CLOUD_HUB);
/** a hub's address after the A10 table (one step, so a table that loops never loops): SOL_HUB_MOVED first, then the
 *  built-in pairs unless SOL_HUB_MOVED says `off`. The built-in pairs move only a room with a share code (`coded`): its
 *  code is in the old hub's registry, which the cloud takes in (sol/cloud/import-hub-rooms); a room met by a key alone,
 *  the common space, has no code the cloud could know, and stays where it was. "" (this engine's own hub) never moves:
 *  the NucBox stays a relay */
export function moved(hub: string, coded = true, builtIn: ReadonlyMap<string, string> = BUILT_IN_MOVED): string {
  if (!hub) return hub;
  const env = process.env.SOL_HUB_MOVED ?? "";
  const k = hubKey(hub);
  const given = movedHubs(env);
  const to = given.get(hub.replace(/\/+$/, "").toLowerCase()) ?? given.get(k);
  if (to) return to;
  if (!coded || /(^|,)\s*off\s*(,|$)/i.test(env)) return hub;
  return builtIn.get(sha(k)) ?? hub;
}
/** the hub a new room meets on and a code is looked up on (#157): SOL_HUB when it names one (a self-hoster's hub), none
 *  when it says `off` (a Sol that meets only on its own relay), else the cloud (S6b, #226); blank is not said, so
 *  .env.example's `SOL_HUB=` is the cloud. Read when asked, not at import: the engine reads .env after its imports */
export const sharedHub = (): string => {
  const h = (process.env.SOL_HUB ?? "").trim().replace(/[?#].*$/, "");
  if (/^(off|none)$/i.test(h)) return "";
  return WS.test(h) ? h : h ? "" : CLOUD_HUB;
};

/** where Sol clones a room's repository (#162), one folder a room, named by the room's id. SOL_ROOMS moves it (tests) */
export const ROOMS_DIR = resolve(process.env.SOL_ROOMS || join(homedir(), "sol-rooms"));   // absolute, as a room's folder must be
// a room's folder as written: an absolute path of at most 500 characters, else none
const folderOf = (v: unknown) => (typeof v === "string" && v.length <= 500 && isAbsolute(v) ? v : "");

// One room (#154), made valid, or null when it points at nothing (no org and none of its own repos or folders). A
// GitHub room with an org and no repos reads the default repo, as the team did before rooms; a Drive room's "repos"
// are folder ids, kept as written. A cloud room (#216, S5) keeps its record on the cloud it meets on: no org, no repos,
// and it points at its code on its hub, so one with no code or no hub points at nothing.
export function cleanRoom(v: unknown): Room | null {
  if (!isObj(v)) return null;
  const provider = v.provider === "drive" ? "drive" : v.provider === "cloud" ? "cloud" : "github";
  if (provider === "cloud") {
    const code = codeOf(v.code), hub = moved(hubOf(v.hub));
    if (!code || !hub) return null;
    const name = str(v.name, "", 60) || "room";
    const given = typeof v.id === "string" ? v.id.trim() : "";
    const id = SLUG.test(given) ? given : slug(given) || slug(name) || "room";
    return { id, name, provider, org: "", repos: [], hub, key: "", code, gate: "github", folder: "", mine: v.mine === true, joined: v.joined === true, ...(v.quiet === true ? { quiet: true as const } : {}) };
  }
  const o = str(v.org), org = LOGIN.test(o) ? o : "";
  const all = Array.isArray(v.repos) ? v.repos.filter((x): x is string => typeof x === "string").map((x) => x.trim()) : [];
  const own = [...new Set(provider === "github" ? all.filter((x) => REPO.test(x)) : all.filter((x) => x && x.length <= 200))];
  if (!org && !own.length) return null;
  const repos = own.length || provider === "drive" ? own : [...TEAM_DEFAULTS.repos];
  const name = str(v.name, "", 60) || nameOf(org, repos) || "room";
  const given = typeof v.id === "string" ? v.id.trim() : "";
  const id = SLUG.test(given) ? given : slug(given) || slug(name) || "room";
  const code = codeOf(v.code), w = isObj(v.was) ? v.was : null;
  // the room as team.json says it: its words from before a move when it carries them and they still move to where it is
  const before = w && moved(hubOf(w.hub), !!code) === hubOf(v.hub) && hubOf(w.hub)
    ? { hub: hubOf(w.hub), key: str(w.key, "", 200), gate: w.gate === "github" ? "github" as const : "key" as const }
    : { hub: hubOf(v.hub), key: str(v.key, "", 200), gate: v.gate === "github" ? "github" as const : "key" as const };
  const hub = moved(before.hub, !!code);
  // a room that moved to Sol's cloud sends no key: a key is a hub's own, and in a query string it would go to the cloud,
  // which is public and knows people by their accounts alone; it meets there as who I am (codex, #227). A key never
  // meets the cloud at all, moved or not. A move to another hub (a self-hoster's) takes the key along, as before
  const moving = hub !== before.hub, bare = isCloud(hub);
  return { id, name, provider, org, repos, hub, key: bare ? "" : before.key, code, gate: bare ? "github" : before.gate, folder: folderOf(v.folder), mine: v.mine === true, joined: v.joined === true, ...(v.quiet === true ? { quiet: true as const } : {}), ...(moving || (bare && before.key) ? { was: before } : {}) };
}

/** the active room (pure): the one `room` names, else the first; a TeamSettings made by hand with no rooms reads as its own */
export function activeRoom(s: TeamSettings): Room {
  return s.rooms.find((r) => r.id === s.room) ?? s.rooms[0]
    ?? { id: "team", name: nameOf(s.org, s.repos), provider: "github", org: s.org, repos: [...s.repos], hub: s.relay.url, key: "", code: "", gate: "key", folder: "", mine: false, joined: false };
}

/** the room's record repository (#194, the PRD's "one record repo per room"): the first GitHub repo of a GitHub room,
 *  as the clone (letin.ts) and the board's first repo already take it; a cloud room's code, a Drive room's first folder
 *  (#152); "" for a room with none, and then
 *  the room's things and goal read as "this room has no record yet". The one place that says which (pure) */
export const recordOf = (r: Pick<Room, "provider" | "repos"> & { code?: string }): string =>
  r.provider === "cloud" ? (r.code && CODE.test(r.code) ? `${CLOUD_RECORD}${r.code}` : "")
  : r.provider === "drive" ? (DRIVE_ID.test(r.repos[0] ?? "") ? `${DRIVE_RECORD}${r.repos[0]}` : "")
  : r.provider === "github" && REPO.test(r.repos[0] ?? "") ? r.repos[0] : "";
/** how a Drive room's record is named where a repo's name goes (#152): `drive:<folder id>`, its first folder (record/drive.ts) */
export const DRIVE_RECORD = "drive:";
/** how a cloud room's record is named where a repo's name goes (#216): `cloud:<code>`, never a repository's shape, so
 *  record() can tell them apart (record.ts) and things.ts and goal.ts need no word of their own for it */
export const CLOUD_RECORD = "cloud:";

/** the room whose hub this engine hosts (review of #154): the first that meets here (hub ""), else the active one. The
 *  hub's gate goes by it, so going to a room elsewhere never changes who may meet here */
export const hostedRoom = (s: TeamSettings): Room => s.rooms.find((r) => r.hub === "") ?? activeRoom(s);

/** the key this engine's client meets with: the active room's (or the one given) when it meets elsewhere and has one,
 *  else relay.key */
export function roomKey(s: TeamSettings, r: Room = activeRoom(s)): string {
  return r.hub && r.key ? r.key : s.relay.key;
}

// My machines (Control): a name and a ws(s) address each, at most twelve, one row per address. Absent: the defaults
// (this Mac, and the relay's machine when there is one); present and empty: empty (the face then offers this Mac).
export function cleanMachines(v: unknown, relayUrl = ""): { name: string; url: string }[] {
  if (!Array.isArray(v)) return defaultMachines(relayUrl);
  const out: { name: string; url: string }[] = [];
  for (const r of v) {
    if (!isObj(r)) continue;
    const url = str(r.url, "", 300), name = str(r.name, "", 60);
    if (!URL_OK.test(url) || out.some((m) => m.url === url)) continue;
    out.push({ name: name || url.replace(/^wss?:\/\//, "").replace(/[:/].*$/, ""), url });
    if (out.length === 12) break;
  }
  return out;
}

/** whatever came in, made into a valid TeamSettings (pure; exported for the tests) */
export function cleanTeam(raw: unknown): TeamSettings {
  const r = isObj(raw) ? raw : {};
  const me = isObj(r.me) ? r.me : {}, relay = isObj(r.relay) ? r.relay : {}, speak = isObj(r.speak) ? r.speak : {};
  const leaves = isObj(r.leaves) ? r.leaves : {}, seats = isObj(r.seats) ? r.seats : {}, night = isObj(r.night) ? r.night : {};
  const login = str(me.login);
  const repos = Array.isArray(r.repos)
    ? [...new Set(r.repos.filter((x): x is string => typeof x === "string" && REPO.test(x.trim())).map((x) => x.trim()))]
    : TEAM_DEFAULTS.repos;
  const o = str(r.org), org = LOGIN.test(o) ? o : "";
  // the rooms (#154): a valid list wins, one each by id, at most twenty; else today's org, repos and relay are the one room
  const rooms: Room[] = [];
  if (Array.isArray(r.rooms)) for (const x of r.rooms) {
    const c = cleanRoom(x);
    if (c && !rooms.some((y) => y.id === c.id)) rooms.push(c);
    if (rooms.length === 20) break;
  }
  if (!rooms.length) {
    const rs = repos.length ? repos : [...TEAM_DEFAULTS.repos];
    rooms.push({ id: "team", name: nameOf(org, rs), provider: "github", org, repos: rs, hub: hubOf(relay.url), key: "", code: "", gate: "key", folder: "", mine: false, joined: false });
  }
  const here = rooms.find((x) => x.id === r.room) ?? rooms[0];
  return {
    me: { login: LOGIN.test(login) ? login : "", name: str(me.name, "", 80) },
    org: here.org,
    repos: [...here.repos],
    relay: { url: here.hub, key: str(relay.key, "", 200), host: bool(relay.host, TEAM_DEFAULTS.relay.host), open: bool(relay.open, false) },
    rooms,
    room: here.id,
    speak: {
      github: bool(speak.github, true), cowork: bool(speak.cowork, true),
      discord: speak.discord === "never" || speak.discord === "any" ? speak.discord : "builds",
      whatsapp: bool(speak.whatsapp, false),
    },
    leaves: {
      // prompts, memory and transcripts never leave this machine (Marco's rule): fixed rows, not switches
      prompts: false, memory: false, transcripts: false,
      audit: leaves.audit === "never" ? "never" : "ask",
    },
    seats: { life: seat(seats.life, "codex"), work: seat(seats.work, "claude") },
    machines: cleanMachines(r.machines, here.hub),   // #169: the rows by default follow the relay this Sol dials
    night: { hour: int(night.hour, 3, 0, 23), staleDays: int(night.staleDays, 7, 1, 90) },
    dials: cleanDials(r.dials),
  };
}

/** a deep merge of b over a: objects merge, everything else (arrays included) replaces */
export function mergeTeam(a: unknown, b: unknown): unknown {
  if (!isObj(a) || !isObj(b)) return b;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(a[k]) ? mergeTeam(a[k], v) : v;
  return out;
}

/** the signature of anything done in the team view: a human, or that human's agent (never unsigned). A Sol with no
 * GitHub (a tester's, #169) signs with the name the install asked for. */
export const signature = (s: TeamSettings, agent: boolean) => { const who = hubName(s) || s.me.login || s.me.name; return agent ? `${who}'s agent` : who; };
// my name on the hub in use when it is not my GitHub login (#216): my Sol name on a cloud I signed in to (relay.ts
// hubLogin, which registers here at load: relay.ts reads these settings, so this file cannot import it)
let hubName: (s: TeamSettings) => string = () => "";
export const setHubName = (fn: (s: TeamSettings) => string) => { hubName = fn; };

/** what a face may see: everything but the relay key ("set" says one exists); a room's code goes as it is */
export const forFace = (s: TeamSettings) => ({
  ...s, relay: { url: s.relay.url, host: s.relay.host, open: s.relay.open, key: s.relay.key ? "set" : "" },
  rooms: s.rooms.map(({ was: _, ...r }) => ({ ...r, key: r.key ? "set" : "" })),   // a room's key too (#154); never its words from before a move
});

// What is read from disk (review of #154): once a file has rooms, the top level is still what a person edits by hand
// (the README says so). When the top-level org, repos or relay.url differ from the active room's, the top level wins
// and is written into that room. Only on a read: a patch goes by the rooms (patchTeam).
// relay.host (#210): an engine is no hub unless its team.json says so, since the hub moves to the cloud (#168). Until
// S6 a team.json already on disk that never said keeps what it had, a hub: the NucBox's may be such a file, and its hub
// is everyone's today. setup has written `host: false` for every install since #169, so only files from before differ.
export const HOST_BEFORE = true;
export function readTeam(raw: unknown): TeamSettings {
  if (isObj(raw) && !(isObj(raw.relay) && typeof raw.relay.host === "boolean")) raw = { ...raw, relay: { ...(isObj(raw.relay) ? raw.relay : {}), host: HOST_BEFORE } };
  const s = cleanTeam(raw);
  if (!isObj(raw) || !Array.isArray(raw.rooms)) return s;
  const here = activeRoom(s);
  // a cloud room's record is not the top level's to say (#216): its org and repos are none, and a hand edit there is for
  // a GitHub room
  if (here.provider === "cloud") return s;
  const top = cleanTeam({ org: raw.org, repos: raw.repos, relay: raw.relay }).rooms[0];
  const edit: Partial<Room> = {};
  if ("org" in raw && top.org !== here.org) edit.org = top.org;
  if (Array.isArray(raw.repos) && top.repos.join(",") !== here.repos.join(",")) edit.repos = top.repos;
  // a moved room (S6b) is written in its words from before the move, so the top level is compared with those
  if (isObj(raw.relay) && "url" in raw.relay && hubKey(top.hub) !== hubKey(here.was?.hub ?? here.hub)) edit.hub = top.hub;
  if (!Object.keys(edit).length) return s;
  // the edit applies to the room as team.json says it (a moved room in its old words), so its key and gate stay
  const next = cleanTeam({ ...raw, rooms: onDisk(s).rooms.map((r) => (r.id === here.id ? { ...r, ...edit } : r)), room: here.id });
  return next.room === here.id ? next : s;   // an edit that empties the room: the rooms as they were
}

let current: TeamSettings | null = null;
const subs = new Set<(s: TeamSettings) => void>();

// Cloud rooms kept beside team.json (S6b, #226). A Sol from before S5 reads a `provider: "cloud"` room as a GitHub room
// with no repositories, drops it, and its next write loses it: "one stable back" after the cloud's release would do just
// that. So every write here also writes `team.cloud.json` (600): my cloud rooms, and the SHA-256 of the team.json
// written with them. A team.json someone else wrote since (its hash differs) that holds no cloud room at all is an older
// Sol's: the cloud rooms it dropped come back on the next read here. A cloud room forgotten here leaves the side file too.
const SIDE = FILE.replace(/(\.json)?$/, ".cloud.json");

/** team.json as it is written: a moved room in its words from before the move (Was), and the top level's relay.url too
 *  when the room in use moved (pure; exported for the tests) */
export function onDisk(s: TeamSettings): TeamSettings {
  const rooms = s.rooms.map(({ was, ...r }) => (was ? { ...r, ...was } : r));
  const here = s.rooms.find((r) => r.id === s.room);
  return { ...s, rooms, relay: { ...s.relay, url: here?.was ? here.was.hub : s.relay.url } };
}

function write(s: TeamSettings) {
  const tmp = FILE + ".tmp", body = JSON.stringify(onDisk(s), null, 2) + "\n";
  // the side file first (codex, #227): a stop between the two leaves it ahead of team.json, never behind, so a cloud room
  // just added is in it either way
  try {
    writeFileSync(SIDE + ".tmp", JSON.stringify({ of: sha(body), rooms: s.rooms.filter((r) => r.provider === "cloud") }, null, 2) + "\n", { mode: 0o600 });
    renameSync(SIDE + ".tmp", SIDE);
  } catch (e) { console.warn(`team: could not write ${SIDE} (${(e as Error).message}); an older Sol could drop my cloud rooms`); }
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, FILE);   // never a half-written file
}

/** a team.json as read (its text and parsed), with the cloud rooms an older Sol dropped put back from the side file, or
 *  null when nothing is to be put back (pure; exported for the tests) */
export function cloudBack(text: string, raw: unknown, side: unknown): Record<string, unknown> | null {
  if (!isObj(raw) || !Array.isArray(raw.rooms) || !isObj(side) || !Array.isArray(side.rooms) || side.of === sha(text)) return null;
  const had = raw.rooms.filter(isObj);
  if (had.some((r) => r.provider === "cloud")) return null;   // a Sol that keeps cloud rooms wrote it: what it says stands
  const back = side.rooms.map(cleanRoom).filter((r): r is Room => !!r && r.provider === "cloud"
    && !had.some((x) => x.id === r.id || (typeof x.code === "string" && x.code.toUpperCase() === r.code)));
  return back.length ? { ...raw, rooms: [...raw.rooms, ...back] } : null;
}

export function getTeam(): TeamSettings {
  if (current) return current;
  let raw: unknown = null, back = false;
  try {
    const text = readFileSync(FILE, "utf8");
    raw = JSON.parse(text);
    let side: unknown = null;
    try { side = JSON.parse(readFileSync(SIDE, "utf8")); } catch { /* none yet */ }
    const fixed = cloudBack(text, raw, side);
    if (fixed) { raw = fixed; back = true; }
  } catch { /* first run */ }
  // no team.json yet: Life's helper starts as the one the person already picked (settings.defaults.seat), not Codex
  current = raw ? readTeam(raw) : cleanTeam({ seats: { life: getSettings().defaults.seat } });
  // no GitHub login and no name yet: the name is the one the install asked for (SOL_OWNER, in .env), so a Sol that
  // never meets gh still knows what to call its person (#169). Written back only with the key below or a later patch.
  if (!current.me.login && !current.me.name && process.env.SOL_OWNER) current.me.name = str(process.env.SOL_OWNER, "", 80);
  // the relay key: made once, here, kept in team.json (a teammate is given it by hand; it never goes to a face)
  const fresh = !current.relay.key;
  if (fresh) current.relay.key = randomBytes(18).toString("base64url");
  if (fresh || back) {
    if (back) console.log("team: an older Sol dropped my cloud rooms from team.json; they are back (team.cloud.json)");
    try { write(current); } catch { /* a read-only checkout: the key lives for this run */ }
  }
  if (!current.me.login && !process.env.SOL_TEAM_OFFLINE) void fillMe();
  return current;
}

// A patch in the words from before rooms (#154): `org`, `repos` or `relay.url` with no `rooms` writes into the active
// room (the one the same patch switches to, when it names one), so Control's org field and an older face still work.
function intoRoom(before: TeamSettings, p: Record<string, unknown>): Record<string, unknown> {
  const url = isObj(p.relay) && "url" in p.relay;
  if ("rooms" in p || !("org" in p || "repos" in p || url)) return p;
  const to = typeof p.room === "string" && before.rooms.some((r) => r.id === p.room) ? p.room : activeRoom(before).id;
  const rooms = before.rooms.map((r) => {
    if (r.id !== to) return r;
    const { was, ...plain } = r;
    const edited = { ...plain, ...(was ?? {}), ...("org" in p ? { org: p.org } : {}), ...("repos" in p ? { repos: p.repos } : {}), ...(url ? { hub: (p.relay as Record<string, unknown>).url } : {}) };
    // an edit that would leave the room pointing at nothing (no org, no valid repo) keeps its repos: the room is never
    // dropped, nor the person moved to another, by an emptied field (review of #154)
    return cleanRoom(edited) ? edited : { ...edited, repos: r.repos.length ? r.repos : [...TEAM_DEFAULTS.repos] };
  });
  return { ...p, rooms };
}

// A face sees a room's key as "set" or "" and sends the list back whole: "set", or no key at all, keeps the stored one
// (as relay.key does on the wire); anything else is the new key ("" takes it away).
// A room's code and gate (#157) the same way: a room sent back with no code (or "") keeps the stored one, since only the
// engine sets codes (share, join); a room with no gate keeps its stored gate, so an older face never turns a room met
// as GitHub back into one met by a key. A room's folder and `mine` (#162) too: only the engine clones and only the engine
// knows whose words a room's repos are, so a room sent with none keeps the stored ones (wire.ts drops a face's); `joined`
// the same way.
function keepKeys(before: TeamSettings, p: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(p.rooms)) return p;
  return { ...p, rooms: p.rooms.map((r) => {
    if (!isObj(r)) return r;
    const had = before.rooms.find((x) => x.id === r.id);
    const key = typeof r.key === "string" && r.key !== "set" ? r.key : had?.key ?? "";
    const code = typeof r.code === "string" && r.code ? r.code : had?.code ?? "";
    const gate = r.gate === "github" || r.gate === "key" ? r.gate : had?.gate ?? "key";
    const folder = typeof r.folder === "string" && r.folder ? r.folder : had?.folder ?? "";
    const mine = typeof r.mine === "boolean" ? r.mine : had?.mine ?? false;
    const joined = typeof r.joined === "boolean" ? r.joined : had?.joined ?? false;
    // a moved room's words from before the move stay while it is still where it moved to (S6b)
    const was = had?.was && (r.hub === undefined || r.hub === had.hub) ? { was: had.was } : {};
    return { ...r, key, code, gate, folder, mine, joined, ...was };
  }) };
}

// `mine` (#162) is the hub's word on the repos a room had when it was registered. A patch that changes a room's repos
// (a face's edit, Control's repos field) makes them words the hub never said: the room is no longer mine, so my Sol lets
// nobody into the repository it now names. Registering it again (rooms.ts shareAgain) makes it mine only if the hub
// gives back the same code, which it does only for the same repos and maker. A room new in the patch is as it came
function unmine(before: TeamSettings, s: TeamSettings): TeamSettings {
  const changed = (r: Room) => { const had = before.rooms.find((x) => x.id === r.id); return !!had && had.repos.join("\n") !== r.repos.join("\n"); };
  if (!s.rooms.some((r) => r.mine && changed(r))) return s;
  return { ...s, rooms: s.rooms.map((r) => (r.mine && changed(r) ? { ...r, mine: false } : r)) };
}

export function patchTeam(patch: unknown): TeamSettings {
  const p = isObj(patch) ? { ...patch } : {};
  const before = getTeam();
  const merged = mergeTeam(before, keepKeys(before, intoRoom(before, p))) as Record<string, unknown>;
  current = unmine(before, cleanTeam(merged));
  // a switch to a room that is not there stays where it was, rather than falling to the first
  if (typeof p.room === "string" && current.room !== p.room && current.rooms.some((r) => r.id === before.room)) current = unmine(before, cleanTeam({ ...merged, room: before.room }));
  if (!current.relay.key) current.relay.key = before.relay.key;
  try { write(current); } catch { /* read-only: kept for this run */ }
  // which helper serves Life is one fact: Life's new conversations start on settings.defaults.seat, so it follows,
  // and only when the patch names it (a name edit never moves the person's Life helper)
  if (isObj(p.seats) && "life" in p.seats && current.seats.life !== getSettings().defaults.seat) patchSettings({ defaults: { seat: current.seats.life } });
  for (const f of subs) f(current);
  return current;
}

export function onTeam(fn: (s: TeamSettings) => void) { subs.add(fn); return () => { subs.delete(fn); }; }

// who I am, from the record (GitHub: `gh api user`) once, on the first read with no login (gh's own sign-in; no token in
// Sol). again: asked once more after a sign-in since (#174), when the last ask has finished
let filling: Promise<void> | null = null, filled = false;
export function fillMe(again = false): Promise<void> {
  if (filling && !(again && filled)) return filling;
  filled = false;
  ownGhOnPath();   // the record's gh is the bare name: Sol's own, fetched since the engine started, is found
  filling = new Promise<void>((resolve) => {
    const done = () => { filled = true; resolve(); };
    makeGithubRecord(runners.settings).who.me().then((out) => {
      try {
        const u = JSON.parse(String(out)) as { login?: unknown; name?: unknown };
        const s = getTeam();
        if (typeof u.login === "string" && u.login && !s.me.login)
          patchTeam({ me: { login: u.login, name: s.me.name || (typeof u.name === "string" && u.name ? u.name : u.login) } });
      } catch { /* gh said something else */ }
    }, () => {}).then(done);
  });
  return filling;
}

// ---- where my agent may speak (Control, #32) ----

export type Where = "github" | "cowork" | "discord" | "whatsapp";
/** may the agent post here? Discord's channel matters only when the setting is "builds" */
export function mayAgentSpeak(s: TeamSettings, where: Where, channel?: string): boolean {
  if (where === "discord") return s.speak.discord === "any" || (s.speak.discord === "builds" && (channel === undefined || channel.replace(/^#/, "") === "builds"));
  return s.speak[where];
}

/** the paragraph every seat's system prompt carries: where it may speak, how it signs, what never leaves */
export function speakParagraph(s: TeamSettings): string {
  const who = s.me.login || s.me.name;
  const sig = who ? `"${who}'s agent"` : `"<their GitHub login>'s agent"`;
  const person = who || "the person at this machine";
  const yn = (b: boolean) => (b ? "yes" : "no");
  const discord = s.speak.discord === "never" ? "never" : s.speak.discord === "builds" ? "only the #builds channel" : "any channel";
  return [
    `Where you may speak (${person}'s own setting in Sol): you act for ${person}, and anything you write where other people read it is signed ${sig}, never as ${person} and never unsigned.`,
    `GitHub (issues, pull requests, comments, reviews): ${yn(s.speak.github)}. Sol's team view (Cowork): ${s.speak.cowork ? "yes, signed" : "no"}. Discord: ${discord}. WhatsApp: ${s.speak.whatsapp ? "yes" : "never"}.`,
    `Prompts, memory and transcripts never leave this machine${s.leaves.audit === "ask" ? `; an audit asks ${person} first` : "; audits are refused"}.`,
    `When a task needs a place you may not speak, say so and stop there; do not find a way around it.`,
  ].join(" ");
}

// What the engine can refuse on its own: a shell command that posts where the setting says no. A Bash call an allow
// rule lets through never reaches this check; the paragraph above covers that case. Returns the reason, or null.
const DISCORD = /discord(?:app)?\.com\/api\//i;
const WHATSAPP = /\b(?:wa\.me|api\.whatsapp\.com|graph\.facebook\.com\/\S*\/messages)\b/i;
const GH_POST = /\bgh\s+(?:(?:pr|issue)\s+(?:create|comment|edit|close|reopen|review|merge|ready|lock)\b|release\s+create\b|gist\s+create\b|api\b[^|;&]*(?:-X\s*|--method[\s=]+)(?:POST|PATCH|PUT|DELETE)\b|api\s+graphql\b[^|;&]*\bmutation\b|api\b(?!\s+graphql\b)[^|;&]*\s(?:-f|-F|--field|--raw-field|--input)\s)/i;
export function speakRefusal(s: TeamSettings, tool: string, input: unknown): string | null {
  if (tool !== "Bash" || !isObj(input) || typeof input.command !== "string") return null;
  const cmd = input.command;
  if (DISCORD.test(cmd) && s.speak.discord === "never") return "My agent may not speak on Discord (Settings, my agent).";
  if (WHATSAPP.test(cmd) && !s.speak.whatsapp) return "My agent may not speak on WhatsApp (Settings, my agent).";
  if (GH_POST.test(cmd) && !s.speak.github) return "My agent may not speak on GitHub (Settings, my agent).";
  return null;
}

/** my GitHub login, asked of gh once when team.json has none yet (Ship signs the stamp with it) */
export async function myLogin(): Promise<string> {
  const s = getTeam();
  if (s.me.login) return s.me.login;
  await fillMe();
  return getTeam().me.login;
}
