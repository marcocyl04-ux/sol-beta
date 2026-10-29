// Who is in which thing (#230; the studio PRD §9.2, §9.6): what my presence says I am in, for the room in use only.
// Two sources say it: my faces, while one has a thing open in front (team.thing.focus), and my agent, when it says so
// (the tool in_thing). The most recent wins. A face's thing stays while it is in front (said again within ten minutes)
// and 60 s after it went behind; a face that goes away takes it at once; an agent's 60 s after its last in_thing, and
// not past the end of the session that said it. Pure: the
// clock and "is this session still going" are handed in, so the tests run on a fake clock.
// Also the #189 condition: a session's title goes to the room only when the session was started under that room.
import { createHash } from "node:crypto";
import type { RosterThing, RosterSession } from "../hub/index.js";

export const LINGER_MS = 60_000;
/** a face's thing in front holds this long after the face last said so: a face that died without a word (a crash, a
 *  closed window the engine missed) does not leave me on a tile; a face in front says it again within this time */
export const FRONT_MS = 10 * 60_000;

type Face = { id: string; name: string; at: number; said: number; front: boolean; left?: number };
type Agent = { id: string; name: string; at: number; session: string };

export class Here {
  private faces = new Map<unknown, Face>();   // each face of mine (a window), its own thing
  private agent: Agent | null = null;

  /** a face of mine has a thing in front (focused), says so again, or has it no longer; another thing in front
   *  replaces the first. A blur of a thing this face does not have in front changes nothing */
  focus(face: unknown, id: string, name: string, focused: boolean, now: number) {
    const had = this.faces.get(face);
    if (focused) { this.faces.set(face, had?.front && had.id === id ? { ...had, said: now } : { id, name, at: now, said: now, front: true }); return; }
    if (had && had.id === id && had.front) this.faces.set(face, { ...had, front: false, left: now });
  }

  /** a face went away: its thing goes with it, at once */
  drop(face: unknown) { this.faces.delete(face); }

  /** my agent, in the session `session`, said it is in this thing */
  said(id: string, name: string, session: string, now: number) { this.agent = { id, name, at: now, session }; }

  /** the room changed: nothing I was in belongs to the new one */
  clear() { this.faces.clear(); this.agent = null; }

  /** the thing I am in now, or none: the most recent of my faces' and my agent's that still holds */
  thing(now: number, alive: (session: string) => boolean = () => true): RosterThing | undefined {
    let pick: { id: string; name: string; at: number; source: "face" | "agent" } | null = null;
    for (const f of this.faces.values()) {
      const holds = f.front ? now - f.said < FRONT_MS : now - (f.left ?? 0) < LINGER_MS;
      if (holds && (!pick || f.at > pick.at)) pick = { id: f.id, name: f.name, at: f.at, source: "face" };
    }
    const a = this.agent && now - this.agent.at < LINGER_MS && alive(this.agent.session) ? this.agent : null;
    if (a && (!pick || a.at > pick.at)) pick = { id: a.id, name: a.name, at: a.at, source: "agent" };
    // `at` is when it was said, never now: a presence that changed every look would be sent every look
    return pick ? { id: pick.id, name: pick.name, source: pick.source, at: pick.at } : undefined;
  }

  /** when what thing() says next changes by the clock alone (an expiry), or null: the caller looks again then */
  next(now: number): number | null {
    const t: number[] = [];
    for (const f of this.faces.values()) t.push(f.front ? f.said + FRONT_MS : (f.left ?? 0) + LINGER_MS);
    if (this.agent) t.push(this.agent.at + LINGER_MS);
    const later = t.filter((x) => x > now);
    return later.length ? Math.min(...later) : null;
  }
}

/** each face's focus words in the order they came (#236): a focus waits on the room's things before it counts, a blur
 *  does not, so a blur sent after a focus can be done first; the focus that finds a later word said is dropped */
export class FocusOrder {
  private seq = new WeakMap<object, number>();
  /** a word from this face came in: its number */
  begin(face: object): number { const n = (this.seq.get(face) ?? 0) + 1; this.seq.set(face, n); return n; }
  /** is word n still this face's last? */
  last(face: object, n: number): boolean { return this.seq.get(face) === n; }
}

/** the room sessions my roster entry lists (pure): the open sessions marked as this room's, newest first, at most five */
export function roomSessions(open: { id: string; room?: string; title?: string; thing?: string; at?: number }[], room: string): RosterSession[] {
  if (!room) return [];
  return open.filter((s) => s.room === room).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 5)
    .map((s) => ({ id: s.id, title: (s.title ?? "").slice(0, 120), ...(s.thing ? { thing: s.thing } : {}) }));
}

/** what a session started under a room is marked with (pure): the room as no other room is, its provider, hub, code,
 *  record and id together. Never the room's id alone: an id is a slug of its name, so a stranger's room of the same name
 *  (or the default "team") would get the same id, and a session of mine its title */
export const roomMark = (r: { id: string; provider: string; hub: string; code: string }, record: string) =>
  createHash("sha256").update(JSON.stringify([r.provider, r.hub.toLowerCase(), r.code, record.toLowerCase(), r.id])).digest("hex").slice(0, 16);

/** the room id each cowork session is filed under in the face (#314, pure), among the rooms I have now: its own
 *  `roomId` mark while that room's roomMark is still its `room` hash (a room I left and a stranger's room of the same
 *  name, which would take the same id, do not keep it); else the room whose roomMark its hash is (a session marked
 *  before #314); else the room whose clone folder it ran in (a session from before #230, with no hash at all). A
 *  session of none of my rooms keeps no id and lists under no group */
export function withRoomIds<S extends { mode?: string; room?: string; roomId?: string; cwd?: string }>(sessions: S[], rooms: { id: string; provider: string; hub: string; code: string; record: string; folder?: string }[]): S[] {
  let byMark: Map<string, string> | undefined;
  const under = (p: string, d: string) => !!d && (p === d || p.startsWith(d.replace(/\/+$/, "") + "/"));
  return sessions.map((s) => {
    if (s.mode !== "cowork") return s;
    byMark ??= new Map(rooms.map((r) => [roomMark(r, r.record), r.id]));
    const own = s.roomId && (!s.room || byMark.get(s.room) === s.roomId) && rooms.some((r) => r.id === s.roomId) ? s.roomId : undefined;
    const id = own ?? (s.room ? byMark.get(s.room) : undefined) ?? (s.cwd ? rooms.find((r) => r.folder && under(s.cwd!, r.folder))?.id : undefined);
    if (id === s.roomId) return s;
    const { roomId: _, ...rest } = s;
    return (id ? { ...rest, roomId: id } : rest) as S;
  });
}

/** does a Work turn's session belong to the room in use (#189's condition)? Only one started under it, by its mark */
export const belongs = (marks: { room?: string } | undefined, mark: string) => !!mark && marks?.room === mark;


// ---- this engine's one Here: the face (team/wire.ts) and the agent's tool (work/wire.ts) tell it; wire.ts says it on
// the relay. `changed` is set by wire.ts, so this module loads nothing of the engine
export const here = new Here();
let changed: () => void = () => {};
export const onHereChanged = (fn: () => void) => { changed = fn; };
/** something told Here: wire.ts works out my presence again */
export const hereChanged = () => changed();

/** in_thing (#230): my agent says it is in this thing of the room's; the id must be one of the room's things. One line */
export function agentIn(things: { id: string; name: string }[], id: string, session: string, now = Date.now()): string {
  const t = things.find((x) => x.id === id.trim());
  if (!t) return things.length ? `no thing ${id} in this room; room_things lists their ids` : "this room has no things yet; nothing to be in";
  here.said(t.id, t.name, session, now);
  hereChanged();
  return `in ${t.name}: the room sees you on it for a minute after each in_thing, and not past this session`;
}
