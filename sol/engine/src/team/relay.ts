// The team relay, this engine's side (Together, See #31; PROTOCOL.md round 17). Since #206 (S1 of #168) three files:
// the hub and its gate (src/hub/relay-hub.ts since #208, the package sol/hub, which loads nothing of the engine), the client (relay-client.ts), and this one,
// the engine's wiring: where my client goes and with what (team settings, my GitHub by the record, my tickets), the one
// client made at load, and the exports the other slices use. Everything relay.ts exported before still comes from here,
// so no importer changed. The hub's relayServer and relayRoutes are given the engine's own GitHub here (ghVerify, the
// record's gist and org reads), as they had by default before.
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename } from "node:path";
import { getTeam, roomKey, activeRoom, setHubName, isCloud, type Room } from "./settings.js";
import { ghVerify, ghToken } from "./identity.js";
import { record, setCloudRecord, setDriveRecord } from "./record.js";
import { makeCloudRecord } from "./record/cloud.js";
import { makeDriveRecord } from "./record/drive.js";
import { driveFile, driveToken, staleDrive, type DriveDeps } from "./drive.js";
import { setSeen } from "./members.js";
import { RelayClient, type Fn } from "./relay-client.js";
import { STATE_DIR } from "../work/state.js";
import { accountOn, accountsFile, accounts, cloudTicket, dropTicket } from "./cloud.js";
import { RelayHub, relayServer as hubServer, relayRoutes as hubRoutes, ticketFor, refusedBy, presenceOf, type Registry, type ServerOpts, type HubOpts,
  type Kind, type PresenceState, type RosterEntry } from "../hub/index.js";   // the hub (#208: src/hub, the package sol/hub)

export { KINDS, SPOOLED, presenceOf, GONE, SLOWED, type Kind, type From, type RelayMsg, type PresenceState, type RosterEntry } from "../hub/index.js";
export { RelayHub, guessers, relayGate, knock, type Conn, type HubOpts, type ServerOpts } from "../hub/index.js";
export { RelayClient, type Me } from "./relay-client.js";

/** what a session says to the team: a Work turn of a session started under the room its title and repo's name; any
 *  other turn (a private Work session, Life, a call) nothing, only the state (#189's condition, #230) */
export function sessionOf(turn: { kind: string; title: string } | null | undefined, cwd?: string, mine = true): RosterEntry["session"] {
  if (!turn || turn.kind !== "work" || !mine) return undefined;
  return { title: turn.title.slice(0, 120), ...(cwd ? { repo: basename(cwd) } : {}) };
}

/** the engine's own hub keeps its old ways (#208, #223): no cap on people a room, every show line to the whole room,
 *  no cap on shows watched or lines a second, no rate, every version of Sol taken. The cloud's numbers are the
 *  package's defaults; these are what the NucBox's hub always did */
export const ENGINE_HUB: HubOpts = { roomOnlineMax: Infinity, watchOnly: false, streamsMax: Infinity, linesPerSec: Infinity, rate: null, minVersion: 0 };

/** the hub on an http server's upgrade (relay-hub.ts), asking GitHub with this engine's gh unless told otherwise, and
 *  taking messages up to the 64 KB it always took (the cloud's hub takes 4 KB, #208) */
export function relayServer(port: number, key: () => string, hub = new RelayHub(ENGINE_HUB), opts: ServerOpts = {}) {
  return hubServer(port, key, hub, { ...opts, verify: opts.verify ?? ghVerify(), msgMax: opts.msgMax ?? 64 * 1024 });
}

/** the hub's http routes (relay-hub.ts), with this engine's gh to ask GitHub and the record to read proofs, unless told otherwise */
export function relayRoutes(port: number, key: () => string, registry: Registry, opts: ServerOpts = {}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return hubRoutes(port, key, registry, { ...opts, verify: opts.verify ?? ghVerify(),
    reads: opts.reads ?? { proofOf: (id) => record().who.proofOf(id), inOrg: (o, l) => record().members.inOrg(o, l) } });
}

// ---- this engine's one client, and the exports the other slices use ----
// Made at load, started by index.ts once the port listens, so onRelay works from any module at any time.
const PORT = Number(process.env.SOL_PORT ?? process.env.PORT ?? 7777);
let mine: { state: PresenceState; session?: RosterEntry["session"] } = { state: "here" };
// what I am in, in the room in use (#230): the thing and my room sessions; wire.ts works them out (here.ts)
let inside: Pick<RosterEntry, "thing" | "sessions" | "quiet"> = {};

/** where this engine's client goes: the teammate's hub, or its own. With an org the key stays home: GitHub says who */
export function relayUrl(port = PORT) {
  const s = getTeam();
  const base = s.relay.url || `ws://127.0.0.1:${port}/relay`;
  if (s.org || activeRoom(s).gate === "github") return base;   // #157: a room met as GitHub never carries a key, least of all relay.key
  return `${base}${base.includes("?") ? "&" : "?"}key=${encodeURIComponent(roomKey(s))}`;   // the room's own key, when it has one (#154)
}

/** does this room meet as who I am on GitHub? (#157) With an org, yes (the org's gate); else when the room says so,
 *  its gate "github" (a room joined by a code, the maker's own on the shared hub). A room with gate "key" meets by a
 *  key, as every room from before codes does */
export const asGitHub = (org: string, room: Pick<Room, "gate">) => !!org || room.gate === "github";

/** a hub's socket address as its http one: wss to https, ws to http, the path kept, /relay when it has none */
export function hubHttp(hub: string): string {
  let u: URL;
  try { u = new URL(hub); } catch { return ""; }
  const proto = u.protocol === "wss:" ? "https:" : u.protocol === "ws:" ? "http:" : "";
  if (!proto) return "";
  const path = u.pathname.replace(/\/+$/, "") || "/relay";
  return `${proto}//${u.host}${path}`;
}

/** is this http address one a GitHub token may go to: https, or plain http to this machine only */
export const safeForToken = (url: string) => /^https:\/\//.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);

/** is this http address this machine's: a GitHub token may go there, since it never leaves the machine */
export const thisMachine = (url: string) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);

/** where my Sol accounts on clouds are kept (cloud.ts, #214) */
export const CLOUD_FILE = process.env.SOL_CLOUD_ACCOUNTS ?? accountsFile(STATE_DIR);

/** my ticket for a hub: on a cloud I have an account on (#214), the cloud's own, renewed by that account; on any other
 *  hub (proof.ts), proved with my own gh. What every hub but this machine's own gets instead of my token */
export const hubTicket = (hub: string) => accountOn(hub, CLOUD_FILE) ? cloudTicket(hub, { file: CLOUD_FILE })
  // Sol's cloud gives tickets to its accounts only: with none, nothing is asked of it (no proof, no GitHub login sent)
  : isCloud(hub.replace(/^https:/, "wss:")) ? Promise.resolve("")
  : ticketFor(hub, { fetch: globalThis.fetch, login: () => getTeam().me.login, prove: (text) => record().who.prove(text), unprove: (id) => record().who.unprove(id) });

/** is the room in use met on a cloud I have an account on (#214)? There a name is a Sol name, first come, with no tie
 *  to GitHub: anything that treats a hub login as a GitHub login (letting someone into a repository, pings addressed
 *  by GitHub login) is off until an account carries a GitHub login it proved */
export function onCloud(s = getTeam()): boolean {
  return !!accountOn(hubHttp(activeRoom(s).hub || "ws://127.0.0.1/relay"), CLOUD_FILE);
}

/** who I am on the hub in use: my name in my account there when it is a cloud I signed in to (#214; the hub puts it on
 *  every line I send), else my GitHub login, as before */
export function hubLogin(s = getTeam()): string {
  return accountOn(hubHttp(activeRoom(s).hub || "ws://127.0.0.1/relay"), CLOUD_FILE)?.login || s.me.login;
}

/** the headers of one connect, when the room meets as GitHub (asGitHub): to a wss hub, its ticket for me (proof.ts:
 *  never my token, which could write as me); to this machine's own hub ("" is), my token, fresh from gh, as before.
 *  None otherwise, never anything in the clear. With an org and nothing to send, null: wait. With no org, {} */
export async function relayAuth(org = getTeam().org, token = ghToken, room: Pick<Room, "hub" | "gate"> & { code?: string } = activeRoom(getTeam()), ticket: (hub: string) => Promise<string> = hubTicket): Promise<Record<string, string> | null> {
  const hub = hubHttp(room.hub || "ws://127.0.0.1/relay");
  // a coded room met by a key knocks as GitHub too, beside its key: a hub that lets strangers in meets a coded room
  // under GitHub's word only (a hub that does not ignores it, and gives no ticket)
  if ((!asGitHub(org, room) && !room.code) || !safeForToken(hub)) return {};
  // a cloud I have an account on takes its ticket, on this machine too: never my GitHub token (#216)
  const t = await (thisMachine(hub) && !accountOn(hub, CLOUD_FILE) ? token() : ticket(hub)).catch(() => "");
  return t ? { authorization: `Bearer ${t}` } : org ? null : {};
}

// my name on the hub in use signs what I do in the team view (settings.ts signature), and a cloud room's record is read
// and written with my ticket there (#216, record/cloud.ts): the hub of the room of mine that has the code
setHubName((s) => (onCloud(s) ? hubLogin(s) : ""));
setCloudRecord(makeCloudRecord({
  hubOf: (code) => { const r = getTeam().rooms.find((x) => x.provider === "cloud" && x.code === code); return r ? hubHttp(r.hub) : ""; },
  ticket: (hub) => hubTicket(hub),
}));

/** where my Google Drive connection is kept (drive.ts, #152) */
export const DRIVE_FILE = process.env.SOL_DRIVE_ACCOUNT ?? driveFile(STATE_DIR);
/** the cloud Drive is connected through (#152): the room in use's when I have an account there, else my first cloud's */
export function driveHub(s = getTeam()): string {
  const here = hubHttp(activeRoom(s).hub || "ws://127.0.0.1/relay");
  return accountOn(here, CLOUD_FILE) ? here : accounts(CLOUD_FILE)[0]?.hub ?? "";
}
export const driveDeps = (): DriveDeps => ({ file: DRIVE_FILE, ticket: (hub) => hubTicket(hub) });
// a Drive room's record is read and written with my own Google account (#152, record/drive.ts)
setDriveRecord(makeDriveRecord({ token: () => driveToken(driveDeps()), stale: staleDrive }));

// three connects in a row the hub did not take: my ticket may be the reason (its key or its org changed), so it is
// proved again, at most once an hour (refusedBy)
const client = new RelayClient(() => relayUrl(), () => ({ login: hubLogin(), room: activeRoom(getTeam()).code, ...mine, ...inside }), undefined,
  (misses) => { if (misses >= 3) { const h = hubHttp(activeRoom(getTeam()).hub || "ws://127.0.0.1/relay"); refusedBy(h); dropTicket(h); } return relayAuth(); });
setSeen(() => client.seen());
let started = false;
export function startRelayClient() { if (!started) { started = true; client.start(); } return client; }

/** the creature moved: say it on the relay (state, and the title and repo of a Work turn in a session of the room's;
 *  `room` false: the turn is private, and only the state goes) */
export function setPresence(state: string, turn: { kind: string; title: string } | null, cwd?: string, room = true) {
  const next = { state: presenceOf(state), session: sessionOf(turn, cwd, room) };
  if (JSON.stringify(next) === JSON.stringify(mine)) return;
  mine = next;
  client.presence();
}

/** what I am in changed (#230): the thing in front and my room sessions; sent only when it differs */
export function setInside(next: Pick<RosterEntry, "thing" | "sessions"> & { quiet?: boolean }) {
  // quiet (#238): my room sessions are not shown here, and not named either: the room sees that I turned it off
  const clean = { ...(next.thing ? { thing: next.thing } : {}), ...(next.sessions?.length && !next.quiet ? { sessions: next.sessions } : {}), ...(next.quiet ? { quiet: true as const } : {}) };
  if (JSON.stringify(clean) === JSON.stringify(inside)) return;
  inside = clean;
  client.presence();
}

/** a relay message of this kind arrived (from another engine; never this one's own). "spooled": the hub's kept list,
 *  after each of its messages went to its own kind's handlers with `spooled: true` */
export const onRelay = (kind: Kind | "spooled" | "hub", fn: Fn) => client.on(kind, fn);
/** send a signed message to everyone on the relay (ping goes to payload.to only). false when the relay is down */
export const sendRelay = (kind: Kind, payload: Record<string, unknown> = {}, agent = false) => client.send(kind, payload, agent);
export const relayRoster = () => client.roster;
export const relayUp = () => client.up;
/** what the hub in use said of itself (#223): its light and largest message (null: an old hub), "too old", my queue */
export const relayHub = () => ({ info: client.info, old: client.old, queued: client.queued, gone: client.goneHere });
export const onRelayStatus = (fn: () => void) => client.onStatus(fn);
export const restartRelay = () => client.restart();
