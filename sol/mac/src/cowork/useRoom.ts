// The room's first page (#234, the studio PRD §3–§4): its things (team.things, round 39; who is in each, round 44),
// its goal (team.goal, round 40), what happened (team.feed, team.feed.line, round 45) and what is for me (team.foryou).
// Asked once when Cowork opens and on a room switch; every push the engine sends after a change is taken as it comes.
// `?dev=team` fakes the room of three (frank, supertsai, marco) with six things, a goal and the room's own tools; nothing is sent.
import { useCallback, useEffect, useRef, useState } from "react";
import { link } from "../socket";
import { ENGINE } from "../useEngine";
import { DEV_TEAM, type Team } from "./useTeam";

export type ThingKind = "doc" | "slides" | "sheet" | "github" | "figma" | "web" | "file";
export type Thing = { id: string; name: string; url: string; kind: ThingKind; addedBy: string; at: string; agent?: true; parent?: string; lastTouch: { who: string; at: string }; inNow: string[] };
/** a folder of things, as Drive keeps one (#248, round 51); parent null is the top */
export type Folder = { id: string; name: string; parent: string | null; by: string; at: string };
export type Goal = { title: string; lines: string; setBy: string; at: string; files: { name: string; size: number; by?: string; at?: string }[]; note?: string };
export type FeedLine = { id: string; at: string; who: string; agent: boolean; kind: string; text: string; ref?: { repo?: string; number?: number; url?: string; thing?: string }; ephemeral?: true };
export type ForYou = { kind: string; line: string; at: string; id: string; actions: string[]; ref?: { repo?: string; number?: number } };
// the room's own tools (#245, round 49): the calendar, the decision log, the polls, each a file in the room's record
export type CalEvent = { id: string; title: string; start: string; end?: string; allDay: boolean; who: string[]; thing?: string; by: string; at: string; agent?: true };
export type Decision = { id: string; title: string; lines: string; by: string; at: string; agent?: true };
export type Poll = { id: string; question: string; options: string[]; votes: Record<string, number>; by: string; at: string; agent?: true; closed?: { by: string; at: string } };
export type Tools = { calendar: CalEvent[] | null; decisions: Decision[] | null; polls: Poll[] | null; note?: string };
export type ToolId = "calendar" | "decisions" | "polls";
// folders: undefined when the engine is older than folders (it sends no field), so the face offers none
/** the room moved to the cloud (#246): its new room's code and name, and my room of that code when I am in it */
export type MovedTo = { code: string; hub: string; name: string; at: string; by?: string; have?: string };
export type RoomNow = { repo?: string; things: Thing[]; folders?: Folder[]; readOnly?: boolean; thingsNote?: string; moved?: MovedTo; goal: Goal | null; feed: FeedLine[]; readAt?: number; feedError?: string; foryou: ForYou[]; tools: Tools };

const NO_TOOLS: Tools = { calendar: null, decisions: null, polls: null };
const EMPTY: RoomNow = { things: [], goal: null, feed: [], foryou: [], tools: NO_TOOLS };

export function useRoom(team: Team) {
  // ?dev=team&moved=1: the room says it moved to the cloud (#246)
  const [now, setNow] = useState<RoomNow>(DEV_TEAM ? { ...FAKE, ...(new URLSearchParams(location.search).get("moved") ? { moved: { code: "K7QX2M", hub: "wss://cloud.matterfold.tech/relay", name: "ecosystem", at: new Date().toISOString(), by: "marcocyl04-ux" } } : {}) } : EMPTY);
  const room = team.state?.settings.room ?? "";
  // each read is numbered: an answer of a read older than the last one (a room switched since) is dropped
  const seq = useRef(0), repoNow = useRef<string | undefined>(undefined);
  const read = useCallback(async () => {
    if (DEV_TEAM) return;
    const n = ++seq.current;
    const [t, g, f, y, c, d, p] = await Promise.all([
      team.ask<{ things?: Thing[]; folders?: Folder[]; readOnly?: boolean; repo?: string; note?: string; moved?: MovedTo; error?: string }>("team.things"),
      team.ask<Goal & { error?: string }>("team.goal"),
      team.ask<{ lines?: FeedLine[]; readAt?: number; error?: string }>("team.feed", { limit: 50 }),
      team.ask<{ items?: ForYou[] }>("team.foryou"),
      team.ask<{ events?: CalEvent[]; note?: string; error?: string }>("team.calendar"),
      team.ask<{ decisions?: Decision[]; error?: string }>("team.decisions"),
      team.ask<{ polls?: Poll[]; error?: string }>("team.polls"),
    ]);
    if (n !== seq.current) return;
    // a read that failed keeps the room's record it knew: answers and pushes for this room are still taken
    repoNow.current = typeof t.repo === "string" ? t.repo : t.error ? repoNow.current : undefined;
    setNow((was) => ({
      ...(repoNow.current !== undefined ? { repo: repoNow.current } : {}),
      // a read that failed keeps the things it had: an open thing (S2, S4) is never closed by a missed read (#236)
      things: Array.isArray(t.things) ? t.things : t.error ? was.things : [], ...(t.note ? { thingsNote: t.note } : {}),
      ...foldersOf(t, was),
      ...(t.moved?.code ? { moved: t.moved } : t.error && was.moved ? { moved: was.moved } : {}),
      goal: g && typeof g.title === "string" ? g : null,
      feed: Array.isArray(f.lines) ? f.lines : [], ...(f.readAt ? { readAt: f.readAt } : {}), ...(f.error ? { feedError: f.error } : {}),
      foryou: Array.isArray(y.items) ? y.items : [],
      // a tool that could not be read keeps what it had; one an old engine does not know is null (its tile says so)
      tools: { calendar: Array.isArray(c.events) ? c.events : c.error ? was.tools.calendar : null, decisions: Array.isArray(d.decisions) ? d.decisions : d.error ? was.tools.decisions : null,
        polls: Array.isArray(p.polls) ? p.polls : p.error ? was.tools.polls : null, ...(c.note ? { note: c.note } : {}) },
    }));
  }, [team.ask]);
  // a room switch empties the page at once: nothing of the room before is drawn under the new one's name
  useEffect(() => { if (!DEV_TEAM) { repoNow.current = undefined; setNow(EMPTY); } }, [room]);
  // asked on open, on a room switch, and once a minute (the feed's own cache is a minute)
  useEffect(() => { void read(); if (DEV_TEAM) return; const t = window.setInterval(() => void read(), 60_000); return () => window.clearInterval(t); }, [read, room, team.up]);
  // the engine's pushes: the things after any change (and who is in each), the goal, a live line
  useEffect(() => {
    if (DEV_TEAM) return;
    return link(ENGINE).on((m) => {
      if (m?.rid) return;   // an answer to an ask: read() has it
      // a push is this room's only when it names this room's record (read() learnt it); before that, none is taken
      const ours = typeof m?.repo === "string" && repoNow.current !== undefined && m.repo === repoNow.current;
      if (m?.type === "team.things" && Array.isArray(m.things) && ours) setNow((n) => ({ ...n, things: m.things, ...foldersOf(m, n) }));
      else if (m?.type === "team.goal" && typeof m.title === "string" && ours) setNow((n) => ({ ...n, goal: m }));
      else if (m?.type === "team.calendar" && Array.isArray(m.events) && ours) setNow((n) => ({ ...n, tools: { ...n.tools, calendar: m.events } }));
      else if (m?.type === "team.decisions" && Array.isArray(m.decisions) && ours) setNow((n) => ({ ...n, tools: { ...n.tools, decisions: m.decisions } }));
      else if (m?.type === "team.polls" && Array.isArray(m.polls) && ours) setNow((n) => ({ ...n, tools: { ...n.tools, polls: m.polls } }));
      else if (m?.type === "team.feed.line" && m.line?.id) setNow((n) => (n.feed.some((l) => l.id === m.line.id) ? n : { ...n, feed: [m.line, ...n.feed].slice(0, 200) }));
    });
  }, []);
  // every change on the things answers the whole list and its folders, taken at once when it is this room's (an answer
  // for the room before a switch is not); a refusal is its one line; an add of a thing already here (ADDITIONS §5)
  // answers that thing and `again`: the room opens it, the feed says so
  type Answer = { things?: Thing[]; folders?: Folder[]; readOnly?: boolean; repo?: string; error?: string; thing?: Thing; changed?: boolean };
  const change = useCallback(async (type: string, body: Record<string, unknown>): Promise<{ error?: string; thing?: Thing; again?: boolean }> => {
    const r = await team.ask<Answer>(type, body);
    if (r.things && r.repo === repoNow.current) setNow((n) => ({ ...n, things: r.things!, ...foldersOf(r, n) }));
    return { error: r.error, ...(r.thing ? { thing: r.thing } : {}), ...(type === "team.things.add" && r.changed === false && r.thing ? { again: true } : {}) };
  }, [team.ask]);
  const add = useCallback(async (url: string, parent?: string): Promise<{ error?: string; thing?: Thing; again?: boolean }> => {
    if (DEV_TEAM) {
      if (!url.startsWith("https://")) return { error: "only https links" };
      // the engine's own words for a Google app's home (things.ts canonicalUrl), so a shot shows it
      const app = /^https:\/\/docs\.google\.com\/(document|presentation|spreadsheets)(\/|$)/.exec(url)?.[1];
      if (app && !/^https:\/\/docs\.google\.com\/(document|presentation|spreadsheets)(\/u\/\d+)?\/d\/[\w-]+/.test(url)) return { error: `that is the Google ${{ document: "Docs", presentation: "Slides", spreadsheets: "Sheets" }[app]} home; paste the link of the file itself` };
      // the engine's one form, roughly (things.ts sameForm): no account in the path, no query, no view
      const one = url.replace(/\/u\/\d+\//, "/").replace(/[?#].*$/, "").replace(/\/(edit|view)$/, "");
      const same = FAKE.things.find((t) => one === t.url.replace(/\/(edit|view)$/, ""));
      if (same) setNow((n) => ({ ...n, feed: [{ id: `again-${Date.now()}`, at: new Date().toISOString(), who: "marco", agent: false, kind: "thing-again", text: `added ${same.name} again: already here, opened the existing one`, ephemeral: true }, ...n.feed] }));
      return same ? { thing: same, again: true } : {};
    }
    return change("team.things.add", { url, ...(parent ? { parent } : {}) });
  }, [change]);
  // one change on a tool: the answer is the tool's whole list, taken at once (every other face hears the push)
  const tool = useCallback(async (type: string, body: Record<string, unknown>): Promise<{ error?: string; again?: boolean }> => {
    if (DEV_TEAM) { setNow((n) => ({ ...n, tools: fakeTool(n.tools, type, body) })); return {}; }
    const r = await team.ask<{ events?: CalEvent[]; decisions?: Decision[]; polls?: Poll[]; again?: boolean; repo?: string; error?: string }>(type, body);
    if (r.repo === repoNow.current) setNow((n) => ({ ...n, tools: { ...n.tools, ...(r.events ? { calendar: r.events } : {}), ...(r.decisions ? { decisions: r.decisions } : {}), ...(r.polls ? { polls: r.polls } : {}) } }));
    return { error: r.error, ...(r.again ? { again: true } : {}) };
  }, [team.ask]);
  const remove = useCallback(async (id: string) => {
    if (DEV_TEAM) { setNow((n) => ({ ...n, things: n.things.filter((t) => t.id !== id) })); return {}; }
    return change("team.things.remove", { id });
  }, [change]);
  // folders (#248): make one at the top; a thing into one (to "" is the top); a folder off, what was in it moves up
  const folderAdd = useCallback(async (name: string, everyone = false): Promise<{ error?: string }> => {
    if (DEV_TEAM) {
      const n = name.trim();
      if (!n) return { error: "give the folder a name" };
      let error: string | undefined;
      setNow((r) => {
        const same = (r.folders ?? []).find((f) => f.name.toLowerCase() === n.toLowerCase());
        if (same) { error = `there is a folder called ${same.name} here already`; return r; }
        return { ...r, folders: [...(r.folders ?? []), { id: Math.random().toString(16).slice(2, 10), name: n, parent: null, by: "frank", at: new Date().toISOString() }] };
      });
      return { error };
    }
    return change("team.things.folder", { name, ...(everyone ? { everyone: true } : {}) });
  }, [change]);
  const move = useCallback(async (id: string, to: string): Promise<{ error?: string }> => {
    if (DEV_TEAM) { setNow((n) => ({ ...n, things: n.things.map((t) => (t.id === id ? { ...t, ...(to ? { parent: to } : { parent: undefined }) } : t)) })); return {}; }
    return change("team.things.move", { id, to });
  }, [change]);
  const unfolder = useCallback(async (id: string): Promise<{ error?: string }> => {
    if (DEV_TEAM) { setNow((n) => ({ ...n, folders: (n.folders ?? []).filter((f) => f.id !== id), things: n.things.map((t) => (t.parent === id ? { ...t, parent: undefined } : t)) })); return {}; }
    return change("team.things.unfolder", { id });
  }, [change]);
  return { ...now, read, add, remove, tool, folderAdd, move, unfolder };
}
export type Room = ReturnType<typeof useRoom>;

// the folders of an answer: its list when it sends one (an engine with folders always does), else none known; a read
// that failed keeps the ones it had
function foldersOf(m: { folders?: unknown; readOnly?: unknown; error?: unknown }, was: RoomNow): Pick<RoomNow, "folders" | "readOnly"> {
  if (Array.isArray(m.folders)) return { folders: m.folders as Folder[], readOnly: m.readOnly === true };
  return m.error ? { folders: was.folders, readOnly: was.readOnly } : { folders: undefined, readOnly: false };
}

// ---- the dev fakes (?dev=team): the room of three, as the mockup drew it ----
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
// minutes from today's midnight, and a day from today, for the fake calendar
const at = (m: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); return new Date(+d + m * 60_000).toISOString(); };
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** ?dev=team: a tool's change done in the face alone, the way the engine would answer it */
function fakeTool(t: Tools, type: string, b: Record<string, any>): Tools {
  const now = new Date().toISOString(), id = Math.random().toString(16).slice(2, 10);
  if (type === "team.calendar.add") return { ...t, calendar: [...(t.calendar ?? []), { id, title: String(b.title), start: String(b.start), allDay: !!b.allDay, who: b.who ?? [], by: "marco", at: now }].sort((x, y) => (x.start < y.start ? -1 : 1)) };
  if (type === "team.calendar.remove") return { ...t, calendar: (t.calendar ?? []).filter((e) => e.id !== b.id) };
  if (type === "team.decisions.add") return { ...t, decisions: [{ id, title: String(b.title), lines: String(b.lines ?? ""), by: "marco", at: now }, ...(t.decisions ?? [])] };
  if (type === "team.polls.add") return { ...t, polls: [{ id, question: String(b.question), options: b.options, votes: {}, by: "marco", at: now }, ...(t.polls ?? [])] };
  if (type === "team.polls.vote") return { ...t, polls: (t.polls ?? []).map((p) => (p.id === b.id ? { ...p, votes: { ...p.votes, marco: Number(b.option) } } : p)) };
  if (type === "team.polls.close") return { ...t, polls: (t.polls ?? []).map((p) => (p.id === b.id ? { ...p, closed: { by: "marco", at: now } } : p)) };
  return t;
}
const FAKE: RoomNow = {
  folders: [
    { id: "f0a1b2c3", name: "marketing", parent: null, by: "marco", at: ago(60 * 20) },
    { id: "f1a1b2c3", name: "research", parent: null, by: "frank", at: ago(60 * 30) },
  ],
  goal: { title: "finding where a first-time user gives up", lines: "five give-up points, each with a path\na first-timer says what it is for", setBy: "marco", at: ago(60 * 26), files: [{ name: "teacher prompt.md", size: 900, by: "marco", at: ago(60 * 26) }, { name: "our grill prompt.md", size: 1200, by: "frank", at: ago(60 * 25) }, { name: "day 0 findings.md", size: 4000, by: "frank", at: ago(60 * 24) }] },
  things: [
    { id: "a1b2c3d4", name: "Cowork studio · PRD", url: "https://docs.google.com/document/d/x", kind: "doc", addedBy: "frank", at: ago(60 * 30), lastTouch: { who: "frank", at: ago(3) }, inNow: ["marco"] },
    { id: "b1b2c3d4", name: "Day 0 findings", url: "https://docs.google.com/presentation/d/x", kind: "slides", addedBy: "frank", at: ago(60 * 28), parent: "f1a1b2c3", lastTouch: { who: "frank", at: ago(60 * 20) }, inNow: [] },
    { id: "c1b2c3d4", name: "give-up points", url: "https://docs.google.com/spreadsheets/d/x", kind: "sheet", addedBy: "frank", at: ago(60 * 27), parent: "f1a1b2c3", lastTouch: { who: "frank", at: ago(9) }, inNow: ["isaac"] },
    { id: "c2b2c3d4", name: "October launch deck", url: "https://docs.google.com/presentation/d/y", kind: "slides", addedBy: "marco", at: ago(60 * 19), parent: "f0a1b2c3", lastTouch: { who: "marco", at: ago(60 * 2) }, inNow: [] },
    { id: "c3b2c3d4", name: "ad copy", url: "https://docs.google.com/document/d/z", kind: "doc", addedBy: "marco", at: ago(60 * 18), parent: "f0a1b2c3", lastTouch: { who: "marco", at: ago(60 * 3) }, inNow: [] },
    { id: "d1b2c3d4", name: "marcocyl04-ux/sol-dev", url: "https://github.com/marcocyl04-ux/sol-dev", kind: "github", addedBy: "marco", at: ago(60 * 40), agent: true, lastTouch: { who: "frank", at: ago(12) }, inNow: ["frank"] },
    { id: "e1b2c3d4", name: "studio mockups", url: "https://www.figma.com/file/x", kind: "figma", addedBy: "frank", at: ago(60 * 12), lastTouch: { who: "frank", at: ago(60 * 12) }, inNow: [] },
    { id: "f1b2c3d4", name: "sol-beta page", url: "https://sol.matterfold.tech", kind: "web", addedBy: "marco", at: ago(60 * 5), lastTouch: { who: "marco", at: ago(60 * 5) }, inNow: [] },
  ],
  feed: [
    { id: "0", at: ago(2), who: "isaac", agent: false, kind: "showing", text: "stopped showing their sessions in this room", ephemeral: true },
    { id: "1", at: ago(4), who: "frank", agent: true, kind: "thing-changed", text: "is in marcocyl04-ux/sol-dev", ephemeral: true },
    { id: "1b", at: ago(6), who: "frank", agent: false, kind: "session-started", text: "started a session: the goal page", ephemeral: true },
    { id: "2", at: ago(25), who: "frank", agent: false, kind: "took", text: "took #5", ref: { repo: "marcocyl04-ux/sol-dev", number: 5 } },
    { id: "3", at: ago(48), who: "isaac", agent: true, kind: "pr-opened", text: "opened a draft #6 the box opens a session", ref: { repo: "marcocyl04-ux/sol-dev", number: 6 } },
    { id: "4", at: ago(70), who: "frank", agent: false, kind: "thing-added", text: "added Cowork studio · PRD" },
    { id: "4b", at: ago(60 * 3), who: "frank", agent: true, kind: "landed", text: "#237 a thing opens inside Sol landed on main", ref: { repo: "marcocyl04-ux/sol-dev", number: 237 } },
    { id: "5", at: ago(60 * 9), who: "marco", agent: true, kind: "digest", text: "the night digest: what landed, what is open, what may clash" },
    { id: "6", at: ago(60 * 26), who: "marco", agent: false, kind: "goal-set", text: "set the goal: finding where a first-time user gives up" },
  ],
  readAt: Date.now(),
  tools: {
    calendar: [
      { id: "c1", title: "Tuesday review: the goal page", start: at(60 * 24 + 14 * 60), allDay: false, who: [], by: "marco", at: ago(60 * 5) },
      { id: "c2", title: "sol-beta export to Isaac", start: day(2), allDay: true, who: ["marco"], by: "frank", at: ago(60 * 3), agent: true },
      { id: "c3", title: "beta testers, first call", start: at(60 * 24 * 4 + 11 * 60), end: at(60 * 24 * 4 + 12 * 60), allDay: false, who: ["frank", "isaac"], by: "frank", at: ago(60 * 2) },
      { id: "c0", title: "cloud on stable", start: day(-1), allDay: true, who: [], by: "frank", at: ago(60 * 30) },
    ],
    decisions: [
      { id: "d3", title: "polls are one file, one vote a write", lines: "two to five people: a conflict is rare and read again", by: "frank", at: ago(60 * 4), agent: true },
      { id: "d2", title: "a cloud room's sessions open in ~/Sol/rooms/<id>", lines: "the other choice was the home folder", by: "frank", at: ago(60 * 20) },
      { id: "d1", title: "rooms meet on the cloud by default", lines: "the NucBox keeps its own hub for the common space until Marco turns it off\nnothing is stored off the machine but the room's own files", by: "marco", at: ago(60 * 30) },
    ],
    polls: [
      { id: "p2", question: "which mark for the beta page?", options: ["the sun", "the creature", "the word Sol"], votes: { marco: 1, frank: 1 }, by: "marco", at: ago(50) },
      { id: "p1", question: "Tuesday review at 10 or at 2?", options: ["10", "2"], votes: { marco: 1, frank: 1, isaac: 0 }, by: "frank", at: ago(60 * 26), closed: { by: "frank", at: ago(60 * 20) } },
    ],
  },
  foryou: [
    { kind: "hand", id: "marcocyl04-ux/sol-dev#4", at: ago(30), line: "frank handed you #4 the goal page", actions: ["take", "pass", "later"], ref: { repo: "marcocyl04-ux/sol-dev", number: 4 } },
    { kind: "clash", id: "p1", at: ago(90), line: "a clash predicted between #163 and #176 on team/wire.ts", actions: ["seen"] },
    { kind: "named", id: "p2", at: ago(200), line: "marco: marco, look at the goal band", actions: ["seen"] },
  ],
};
