// A group's page (#314, the groups PRD §3, §4.2–§4.4, §9.9; the look is wF.html's S2–S4): Cowork's first page, in
// place of the room's (Room.tsx, whose goal page, person page, tools and thing pane it opens as before). Under the bar,
// three tabs that are always the same three, `talk · build updates N · connectors N`, and the group's code with "copy
// link" at the right; then the people strip (a small Sol each, a name, one word), the goal as one line, and the tab:
// - talk: today's Talk, the whole width, its box at the bottom;
// - build updates: the room's feed, one line each, newest first, an agent's in a thin white ring;
// - connectors: two columns. "this group": the three tools pinned first, the repositories, the things and folders as
//   rows (a click opens them as the grid did), a dashed "+ connect" that takes a link (and, in a cloud group, a
//   repository). "on this Mac": Google and GitHub, connected or the step that connects them (GitHub's is the device-flow
//   card of GithubJoin.tsx). The column is drawn from team.connectors' one answer (#332, rounds 55, 57, 60) when the
//   engine sends it: each repository with who connected it, the small Sols of who was let in and "N of M", a dim
//   "unverified" when my own GitHub did not check it, and one action at the right (connectors.ts rowAction): "connect
//   GitHub", "ask to be let in", "asked", the maker's "add the workflow" (and the permission card GitHub may want first)
//   or "build updates on". An older engine's tab is drawn from team.things, the tools and team.accounts, as before.
// A page opened from it (a thing, a person, the goal, a tool) takes the tab's place under the strip; a tab click comes
// back. N on build updates is the lines since this Mac last showed the tab; on connectors, the rows of "this group".
// With no group yet the centre is the first-time page (FirstGroup): the Sol, "make your first group", and the side's
// own new-group form in the right half.
// A group on the cloud nearly full (#326, wF's S5): one glass banner under the tabs, the amber bar, "18 of 20 MB", one dim
// line and, for its maker, the gradient "connect GitHub to keep going" (quota.ts says when); my own 50 MB line under
// it. The press moves the group's files to a private repository of the maker's (team.room.take); without GitHub the
// device-flow card comes first. A group that moved hangs one card from the bar (MovedAwayLine, in CoworkApp).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Team, Member } from "./useTeam";
import type { Room as RoomData, Thing, ThingKind, FeedLine, Folder, ToolId } from "./useRoom";
import { Body, STATE_WORD, since } from "./bits";
import { hhmm, date } from "./util";
import { Sol } from "../Sol";
import { link } from "../socket";
import { ENGINE } from "../useEngine";
import { Talk } from "./Talk";
import { ThingPane } from "./ThingPane";   // S2: a thing opened in the centre (#236)
import { PersonMain, PersonSide, personOf } from "./Person";   // S3: a person (#238)
import { GoalPage } from "./Goal";   // S6: the goal (#238)
import { ToolPage, TOOLS, toolLine, tileLine } from "./Tools";   // the room's own tools (#245)
import { GithubJoin } from "./GithubJoin";   // the device-flow card (#252), re-homed
import { DriveRow, useDrive } from "./DriveRoom";
import { versionLine, versionShort, sameRelease } from "./version";   // everyone's version, side by side (#417)   // Google on this Mac; a Drive group's folder and its people (#152)
import { RoomForm } from "./CoworkSidebar";
import { HandedRows } from "./Hands";   // put-off hands, under the repository (#34)
import { useHands } from "./handed";
import { TryingRow, useTry } from "./TryPane";   // the PR I am trying (#35)
import { linkFor, useCopied } from "./rooms";   // the join link once the hub serves its page (#327)
import { rowAction, inOf, repoOf, type Connectors as Conn, type RepoRow, type Me } from "./connectors";   // the one answer (#332)
import { bannerOf, keepNotNow, type UsageNow } from "./quota";   // the nearly-full banner (#326)
import type { MovedAway } from "./useRoom";
import { DEV_TEAM } from "./useTeam";
import { openUrl as openOut } from "./util";
import "./group.css";

export type Tab = "talk" | "updates" | "connectors";
const TAB_KEY = "sol.cowork.tab";
const readTab = (): Tab => { try { const t = sessionStorage.getItem(TAB_KEY); return t === "updates" || t === "connectors" ? t : "talk"; } catch { return "talk"; } };
// when this Mac last showed each group's build updates (ms, by room id): the tab's count is the lines after it
const SEEN_KEY = "sol.cowork.seenfeed";
const seenOf = (room: string): number | undefined => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}")[room]; } catch { return undefined; } };
const keepSeen = (room: string, at: number) => { try { const m = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}"); m[room] = at; localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch { /* private */ } };
/** the build updates not seen yet (pure): the lines after `seen`; never seen on this Mac, the last day's */
export const unseen = (feed: Pick<FeedLine, "at">[], seen: number | undefined, now = Date.now()) => {
  const after = seen ?? now - 86_400_000;
  return feed.filter((l) => (Date.parse(l.at) || 0) > after).length;
};

export function Group({ team, room, flash, onPerson, onGoal, onThing, onRepo, onTool, onBack, onHand, onWork, open, person, goal, tool }: {
  team: Team; room: RoomData; flash: (s: string) => void;
  onPerson: (login: string) => void; onGoal: () => void; onThing: (t: Thing) => void; onRepo: () => void; onTool: (id: ToolId) => void;
  /** back to the group's tabs from a page opened on it */
  onBack: () => void; onHand: () => void; onWork: (t: Thing) => void;
  open: Thing | null; person: string | null; goal: boolean; tool: ToolId | null;
}) {
  const s = team.state, me = team.me;
  const roster = s?.roster ?? [];
  const up = !!s?.relay.up;
  const roomId = s?.settings.room ?? "";
  const r = s?.settings.rooms.find((x) => x.id === roomId);
  const name = r?.name ?? "this group";
  // the people: me first, then who is on, then every member of the room
  const people = useMemo(() => [...new Set([me, ...roster.map((m) => m.who), ...(s?.members ?? [])].filter(Boolean))], [me, roster, s?.members]);
  const entryOf = (who: string): Member | undefined => roster.find((m) => m.who === who);
  const myVer = entryOf(me)?.version ?? s?.version ?? undefined;   // what my Sol runs (#417), for "the same release as you"
  const [tab, setTabS] = useState<Tab>(readTab);
  const sub = !!(open || person || goal || tool);   // a page opened from the group stands in for the tab
  const setTab = (t: Tab) => { setTabS(t); try { sessionStorage.setItem(TAB_KEY, t); } catch { /* private */ } if (sub) onBack(); };
  // build updates: what this Mac has seen; showing the tab sees the newest line
  const [seen, setSeen] = useState(() => seenOf(roomId));
  useEffect(() => setSeen(seenOf(roomId)), [roomId]);
  const newest = room.feed.reduce((m, l) => Math.max(m, Date.parse(l.at) || 0), 0);
  useEffect(() => { if (tab === "updates" && !sub && roomId && newest && newest !== seen) { keepSeen(roomId, newest); setSeen(newest); } }, [tab, sub, roomId, newest, seen]);
  const fresh = tab === "updates" && !sub ? 0 : unseen(room.feed, seen);
  // a Drive group this Mac has not connected Google Drive for (#266, #393): the record's 401 on the reads, and Drive
  // really not connected here (a passing cloud failure answers the same words to a connected person: no gate then)
  const dr = useDrive(team);
  const driveGate = !!room.needsDrive && !!dr.drive && !dr.drive.connected;
  const rows = connectorRows(room, r, room.conn);
  // S3: their conversation is open on the right until closed; a new person opens it again
  const [convo, setConvo] = useState(true);
  useEffect(() => setConvo(true), [person]);

  return (
    <div className="gp">
      <div className="gp-tabs" role="tablist" aria-label={`${name}'s page`}>
        {([["talk", "talk", undefined], ["updates", "build updates", fresh], ["connectors", "connectors", rows.length]] as const).map(([k, word, n]) => (
          <button key={k} role="tab" aria-selected={tab === k && !sub} className={`gp-tab ${tab === k && !sub ? "on" : ""}`} onClick={() => setTab(k)}>
            {word}{n ? <small>{n}</small> : null}
          </button>
        ))}
        <span className="gp-sp" />
        <Share team={team} />
      </div>

      {/* a group that moved has its card on the bar instead: no "connect GitHub" for files that are on GitHub already */}
      {(r?.provider === "cloud" || DEV_TEAM) && !room.movedAway && <Quota team={team} roomId={roomId} flash={flash} />}

      {/* the people: a small Sol each, the name, one word; away (or not seen) at half */}
      <div className="gp-people" role="list" aria-label={`the people in ${name}`}>
        {people.map((who) => {
          const m = entryOf(who), mine = who === me;
          const dark = !mine && (!up || !m);
          const state = m?.state ?? (mine ? "here" : undefined);
          // showing a session to the group (#101) says so first, as the side's team rows did
          const sh = team.showing.find((x) => x.login === who);
          // what their Sol runs (#417), side by side: the release and their own layer; mine from my engine when the relay is down
          const ver = m?.version ?? (mine ? s?.version ?? undefined : undefined);
          const same = !mine && sameRelease(ver, myVer);
          const word = sh ? (sh.issue ? `showing #${sh.issue}` : "live in a session")
            : dark ? "not seen" : state === "here" || state === "away" || !m ? STATE_WORD[state ?? "here"] : `${STATE_WORD[state ?? "here"]} · ${since(m.since)}`;
          return (
            <button key={who} role="listitem" className={`gp-who ${dark || state === "away" ? "away" : ""} ${person === who ? "on" : ""}`} onClick={() => onPerson(who)}
              title={`${who}${mine ? " (you)" : ""}: ${m?.session?.title ?? word}. Runs ${versionLine(ver)}${same ? ", the same release as you" : ""}. Click for what they did here.`}>
              <Body login={who} size={28} away={dark || state === "away"} />
              <span className="tx"><span className="n">{who}</span><span className="l">{word}</span>
                <span className={`v ${ver ? "" : "unknown"} ${same ? "same" : ""}`} aria-label={`runs ${versionLine(ver)}`}>{versionShort(ver)}</span></span>
            </button>
          );
        })}
      </div>

      {person ? (
        <div className="gp-two">
          <div className="gp-sub"><PersonMain team={team} room={room} login={person} entry={personOf(roster, person)} roomName={name} onBack={onBack}
            onThing={(t) => (t.kind === "github" ? onRepo() : onThing(t))} convo={convo} onConvo={() => setConvo(true)} /></div>
          {convo && <PersonSide team={team} login={person} entry={personOf(roster, person)} roomName={name} onClose={() => setConvo(false)} onHand={onHand} flash={flash} />}
        </div>
      ) : goal ? (
        <div className="gp-sub"><GoalPage key={roomId} team={team} room={room} onBack={onBack} flash={flash} /></div>
      ) : tool ? (
        <div className="gp-sub"><ToolPage key={`${roomId}:${tool}`} team={team} room={room} id={tool} people={people} onBack={onBack} flash={flash} /></div>
      ) : open ? (
        <div className="gp-sub"><ThingPane team={team} thing={open} mode="s2"
          me={{ working: entryOf(me)?.state === "working" }}
          others={people.filter((who) => who !== me && (entryOf(who)?.thing?.id === open.id || open.inNow.includes(who))).map((who) => ({ who, working: entryOf(who)?.state === "working" }))}
          onBack={onBack} onShrink={onBack} onWork={() => onWork(open)} /></div>
      ) : (<>
        {/* the goal: one line, set by hand, read by every agent before it works; a click opens its page */}
        {driveGate ? (
          // one state in place of the goal band, not an empty group; the body stays (talk rides the relay, not Drive)
          <div className="gp-moved" role="status">
            <span>connect Google Drive to see this group: its goal, files and updates are in a Drive folder this Mac cannot open yet{dr.bad ? ` · ${dr.bad}` : ""}</span>
            <button className="gp-quiet" disabled={dr.busy} onClick={() => void dr.connect().then(() => void room.read())}>{dr.busy ? "finish in your browser…" : "connect Google Drive ›"}</button>
          </div>
        ) : (
        <button className="gp-goal" onClick={onGoal} title="the group's goal: set by hand, read by every agent before it works. Click to open it and its files.">
          <span className="k">goal</span>
          {room.goal?.title ? <span className="t">{room.goal.title}</span> : <span className="t dim">nothing set yet · set a goal</span>}
        </button>)}
        {/* this room moved to the cloud (#246): one click joins the new one by its code, or goes there when I am in it */}
        {room.moved && (
          <div className="gp-moved" role="status">
            <span>this group moved to the cloud as {room.moved.name}{room.moved.by ? `, moved by ${room.moved.by}` : ""}{room.moved.at ? ` · ${date(room.moved.at)}` : ""}</span>
            <button className="gp-quiet" onClick={() => void (room.moved!.have
              ? team.ask("team.settings", { patch: { room: room.moved!.have } })
              : team.ask<{ room?: { name?: string }; error?: string }>("team.room.join", { code: room.moved!.code }).then((x) => flash(x.error ? `couldn't join: ${x.error}` : `you are in ${x.room?.name ?? "the new group"} on the cloud`)))}>
              {room.moved.have ? "go there ›" : `join it (${room.moved.code}) ›`}
            </button>
          </div>
        )}
        <div className="gp-body" data-tab={tab}>
          {tab === "talk" && <div className="gp-talk"><Talk team={team} flash={flash} /></div>}
          {tab === "updates" && <Updates lines={room.feed} error={room.feedError} />}
          {tab === "connectors" && <Connectors team={team} room={room} rows={rows} name={name} flash={flash} onThing={onThing} onRepo={onRepo} onTool={onTool} />}
        </div>
      </>)}
    </div>
  );
}

/** how full a cloud group is (team.room.usage): asked on open and every five minutes, and pushed by the engine when a
 *  write answered `warn` or "the group is moving". ?dev=team&full=1 draws wF's S5 */
function useUsage(team: Team, roomId: string): [UsageNow | null, () => void] {
  const [u, setU] = useState<UsageNow | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    setU(null);
    if (DEV_TEAM) { if (new URLSearchParams(location.search).get("full")) setU({ room: roomId, used: 18 * 1024 * 1024, max: 20 * 1024 * 1024, files: 214, frozen: false, maker: team.me, mine: true }); return; }
    let live = true;
    const ask = () => void team.ask<UsageNow & { error?: string }>("team.room.usage", { id: roomId }).then((a) => { if (live && typeof a?.max === "number") setU(a); });
    ask();
    const t = window.setInterval(ask, 5 * 60_000);
    const off = link(ENGINE)?.on((m) => { if (m?.type === "team.room.usage" && !m.rid && m.room === roomId && typeof m.max === "number") setU(m as UsageNow); });
    return () => { live = false; window.clearInterval(t); off?.(); };
  }, [team.ask, team.me, roomId, n]);
  return [u, () => setN((x) => x + 1)];
}

/** the banner (wF's S5) and my own 50 MB line; the GitHub card when the move needs it first */
function Quota({ team, roomId, flash }: { team: Team; roomId: string; flash: (s: string) => void }) {
  const [u, again] = useUsage(team, roomId);
  const [take, setTake] = useState<{ busy?: boolean; error?: string; gh?: boolean }>({});
  useEffect(() => setTake({}), [roomId]);
  const b = bannerOf(u);
  // signed in through the card: the press goes on by itself
  useEffect(() => link(ENGINE)?.on((m) => { if (m?.type === "team.github.connected" && take.gh) void go(); }), [take.gh]);
  if (!u || (!b && !u.warn)) return null;
  async function go() {
    setTake({ busy: true });
    const a = await team.ask<{ repo?: string; error?: string; need?: string }>("team.room.take", { id: roomId }, 10 * 60_000);
    if (a.need === "github") return setTake({ gh: true });
    if (a.error) { setTake({ error: a.error }); return again(); }
    setTake({});
    flash(`the group's files are in ${a.repo ?? "your repository"} now`);
  }
  return (<>
    {b && (
      <div className={`gp-quota ${b.moving || take.busy ? "moving" : ""}`} role="status" aria-label={`the group holds ${b.words}`}>
        <div className="tx">
          <div className="gp-meter"><span className="tr" aria-hidden="true"><i style={{ transform: `scaleX(${b.share})` }} /></span><span className="w">{b.words}</span></div>
          <div className="ln">{take.busy ? "moving the group's files to a private repository of yours…" : take.error ?? b.line}</div>
        </div>
        {b.button && !take.gh && <button className="gp-go" disabled={take.busy} onClick={() => void go()}><span>{take.busy ? "moving…" : take.error ? "try again" : "connect GitHub to keep going"}</span></button>}
      </div>
    )}
    {take.gh && <div className="gp-quota-gh"><GithubJoin team={team} keeps="github" connectors /></div>}
    {u.warn && <p className="gp-mine">{u.warn}</p>}
  </>);
}

/** a group that moved to GitHub (#326): one face of the bar card, "the group moved to <repo> · join it · not now". Only
 *  the press switches my copy; without GitHub on this Mac it says so, and the group keeps talk and build updates */
export function MovedAwayLine({ team, roomId, moved, flash, onGone }: { team: Team; roomId: string; moved: MovedAway; flash: (s: string) => void; onGone: () => void }) {
  const [gh, setGh] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void team.ask<{ github?: { in: boolean } }>("team.accounts", {}, 30_000).then((a) => { if (live) setGh(!!a?.github?.in); });
    const off = link(ENGINE)?.on((m) => { if (m?.type === "team.github.connected") setGh(true); });
    return () => { live = false; off?.(); };
  }, [team.ask]);
  const join = async () => {
    setBusy(true);
    const a = await team.ask<{ error?: string; need?: string }>("team.room.follow", { id: roomId }, 60_000);
    setBusy(false);
    if (a.need === "github") return setGh(false);
    if (a.error) return flash(`couldn't join it: ${a.error}`);
    flash(`the group is ${moved.repo} now`);
  };
  return (
    <div className="gline" role="status">
      <span className="from">moved</span>
      <span className="t"><b>the group moved to {moved.repo}</b><small>{gh === false ? "connect GitHub to see the files" : `by ${moved.by}${moved.at ? ` · ${date(moved.at)}` : ""}`}</small></span>
      {gh && <button className="wbtn" disabled={busy} onClick={() => void join()}>{busy ? "…" : "join it"}</button>}
      <button className="wbtn ghost" onClick={() => { keepNotNow(roomId, moved.repo); onGone(); }}>not now</button>
    </div>
  );
}

/** the group's code and its link at the tab row's right: the code (a click copies it), and "copy link" for a group on
 *  Sol's cloud. A group with no code yet (a GitHub room from before codes) has "share", which asks the engine for one */
function Share({ team }: { team: Team }) {
  const s = team.state;
  const r = s?.settings.rooms.find((x) => x.id === s.settings.room);
  const [asked, setAsked] = useState<{ busy?: boolean; code?: string; error?: string }>({});
  useEffect(() => setAsked({}), [r?.id]);
  const [copied, copy] = useCopied();
  if (!r) return null;
  const code = r.code || asked.code;
  if (!code) {
    if (r.provider === "cloud") return null;   // a cloud room always has its code; none yet is a moment, not a step
    return <button className="gp-quiet" disabled={asked.busy} title={asked.error ?? "a code a friend types to join this group"}
      onClick={() => { setAsked({ busy: true }); void team.ask<{ code?: string; error?: string }>("team.room.share", { id: r.id }).then((a) => setAsked(a.code ? { code: a.code } : { error: a.error ?? "no code came back" })); }}>
      {asked.busy ? "…" : asked.error ? "share · try again" : "share"}</button>;
  }
  // the link only once the hub said it serves the join page (#327, team.hub's join); else the code is the way in
  const url = linkFor({ ...r, code }, team.hub.join);
  return (<>
    <code className="gp-code" title="the code a friend types to join">{code}</code>
    {url ? <button className="gp-quiet" title={url} onClick={() => copy(url)}>{copied || "copy link"}</button>
      : <button className="gp-quiet" onClick={() => copy(code)}>{copied || "copy code"}</button>}
  </>);
}

/** build updates: what happened, one line each, newest first; each line wears its person's small Sol (an agent's in a
 *  thin white ring), Sol's own when no one */
function Updates({ lines, error }: { lines: FeedLine[]; error?: string }) {
  return (
    <ol className="gp-feed" aria-label="build updates">
      {error && <li className="none">couldn't read the updates just now: {error}</li>}
      {!error && lines.length === 0 && <li className="none">nothing yet: what anyone does in this group shows here</li>}
      {lines.slice(0, 100).map((l) => (
        <li key={l.id} className={l.agent ? "ag" : ""} title={l.ephemeral ? "live: seen as it happened, not kept" : "from the group's record"}>
          <time dateTime={l.at}>{hhmm(l.at)}</time>
          {l.who ? <Body login={l.who} size={20} agent={l.agent} /> : <span className="cbody"><Sol alone size={20} /></span>}
          <span className="tx"><b>{l.who ? (l.agent ? `${l.who}'s agent` : l.who) : "sol"}</b> {l.text}</span>
        </li>
      ))}
    </ol>
  );
}

// ---- connectors ----

type Row = { k: "repo"; repo: string; row?: RepoRow } | { k: "folder"; f: Folder } | { k: "thing"; t: Thing };
/** the rows of "this group" (pure): the repositories first (the one answer's when the engine sends it, else a GitHub
 *  group's own), then the folders at the top and the things in none, the most recently touched first. A thing that is
 *  a repository of the group is that repository's row */
export function connectorRows(room: Pick<RoomData, "things" | "folders">, r?: { provider: string; repos: string[] }, conn?: Pick<Conn, "repos"> | null): Row[] {
  const repos: Row[] = conn ? conn.repos.map((x) => ({ k: "repo" as const, repo: x.repo, row: x })) : r?.provider === "github" && r.repos[0] ? [{ k: "repo" as const, repo: r.repos[0] }] : [];
  const names = repos.map((x) => (x.k === "repo" ? x.repo.toLowerCase() : ""));
  const isRepo = (t: Thing) => t.kind === "github" && names.some((repo) => t.name.toLowerCase() === repo || t.url.replace(/\/+$/, "").toLowerCase().endsWith(`/${repo}`));
  const folders = room.folders ?? [];
  const ids = new Set(folders.map((f) => f.id));
  const touched = (t: Thing) => Date.parse(t.lastTouch.at || t.at) || 0;
  return [
    ...repos,
    ...folders.filter((f) => !f.parent || !ids.has(f.parent)).map((f) => ({ k: "folder" as const, f })),
    ...room.things.filter((t) => !isRepo(t) && !(t.parent && ids.has(t.parent))).sort((a, b) => touched(b) - touched(a)).map((t) => ({ k: "thing" as const, t })),
  ];
}

const KIND_WORD: Record<ThingKind, string> = { doc: "a doc", slides: "slides", sheet: "a sheet", github: "a repository", figma: "a Figma file", web: "a page", file: "a file" };
const KIND_COLOR: Record<string, string> = { doc: "#4a8df8", sheet: "#34a853", slides: "#fbbc04", figma: "#fb5ad0", web: "#9a9a97", github: "#ebebe8", file: "#9a9a97", folder: "#f4c82a", tool: "#9a9a97" };
/** a connector's flat glyph, 16px, one colour per kind (#314: no pixel glyphs on the group page) */
export function KindGlyph({ kind }: { kind: string }) {
  const c = KIND_COLOR[kind] ?? KIND_COLOR.web;
  const line = { fill: "none", stroke: c, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg className="gp-glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {kind === "doc" && <><rect x="3" y="1.5" width="10" height="13" rx="2" fill={c} /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" /></>}
      {kind === "sheet" && <><rect x="3" y="1.5" width="10" height="13" rx="2" fill={c} /><path d="M5.5 6.5h5v5h-5zM8 6.5v5M5.5 9h5" fill="none" stroke="#fff" strokeWidth="1" /></>}
      {kind === "slides" && <><rect x="3" y="1.5" width="10" height="13" rx="2" fill={c} /><rect x="5.2" y="6" width="5.6" height="4" rx=".6" fill="none" stroke="#fff" strokeWidth="1.1" /></>}
      {kind === "figma" && <><rect x="4.5" y="1.5" width="3.5" height="4.3" rx="1.75" fill={c} /><rect x="8" y="1.5" width="3.5" height="4.3" rx="1.75" fill={c} opacity=".75" /><rect x="4.5" y="5.85" width="3.5" height="4.3" rx="1.75" fill={c} opacity=".85" /><circle cx="9.75" cy="8" r="1.75" fill={c} opacity=".6" /><rect x="4.5" y="10.2" width="3.5" height="4.3" rx="1.75" fill={c} opacity=".9" /></>}
      {kind === "web" && <><rect x="1.5" y="3" width="13" height="10" rx="2" {...line} /><path d="M1.5 6h13" {...line} /></>}
      {kind === "github" && <><circle cx="4.5" cy="3.5" r="1.6" {...line} /><circle cx="4.5" cy="12.5" r="1.6" {...line} /><circle cx="11.5" cy="5.5" r="1.6" {...line} /><path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2 3-5.5 4" {...line} /></>}
      {kind === "file" && <><path d="M4 1.5h5.5L13 5v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" {...line} /><path d="M9.5 1.5V5H13" {...line} /></>}
      {kind === "folder" && <path d="M1.5 4.2a1.2 1.2 0 0 1 1.2-1.2h3.4l1.5 1.6h5.7a1.2 1.2 0 0 1 1.2 1.2v6.5a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2z" fill={c} />}
      {kind === "calendar" && <><rect x="2" y="3" width="12" height="11" rx="2" {...line} /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" {...line} /></>}
      {kind === "decisions" && <><circle cx="8" cy="8" r="6" {...line} /><path d="M5.4 8.2l1.8 1.8 3.5-3.6" {...line} /></>}
      {kind === "polls" && <path d="M3 13.5V8M8 13.5V3M13 13.5V6" {...line} strokeWidth="2" />}
    </svg>
  );
}

const ago = (at: string) => { const x = since(at); return x === "now" ? "now" : date(at); };

function Connectors({ team, room, rows, name, flash, onThing, onRepo, onTool }: {
  team: Team; room: RoomData; rows: Row[]; name: string; flash: (s: string) => void; onThing: (t: Thing) => void; onRepo: () => void; onTool: (id: ToolId) => void;
}) {
  const s = team.state;
  const r = s?.settings.rooms.find((x) => x.id === s.settings.room);
  const folders = room.folders ?? [];
  const [inside, setInside] = useState<Record<string, boolean>>({});   // folders opened in place
  const [at, setAt] = useState("");   // the folder opened last: "+ connect" adds into it, as the grid added into the folder it showed
  const roster = s?.roster ?? [];
  const inIt = (t: Thing) => [...new Set([...roster.filter((m) => m.thing?.id === t.id).map((m) => m.who), ...t.inNow])];
  const [adding, setAdding] = useState<{ url: string; error?: string; repo?: true } | null>(null);   // repo: the field takes owner/name
  const [choosing, setChoosing] = useState(false);   // a cloud group's "+ connect": a link or a repository
  const [lit, setLit] = useState(0);                 // "connect GitHub" on a row: the card on the right is shown and lit
  const conn = room.conn, cloud = conn?.record === "cloud";
  const [removing, setRemoving] = useState("");   // the thing whose × was pressed: asked once, inline
  const [menu, setMenu] = useState("");           // the thing whose "move to…" is open
  const [making, setMaking] = useState<{ name: string; error?: string } | null>(null);   // a new folder being named
  const canFold = room.folders !== undefined && !room.readOnly && !room.thingsNote;
  useEffect(() => { setInside({}); setAt(""); setAdding(null); setChoosing(false); setRemoving(""); setMenu(""); setMaking(null); }, [s?.settings.room]);
  const open = (t: Thing) => (t.kind === "github" ? onRepo() : onThing(t));
  const add = async () => {
    if (!adding?.url.trim()) return;
    if (adding.repo) {
      const repo = repoOf(adding.url);
      if (!repo) return setAdding({ ...adding, error: "which repository? its owner/name" });
      const x = await room.connectRepo(repo);
      if (x.error) return setAdding({ ...adding, error: x.error });
      setAdding(null);
      return flash(`connected ${repo} to ${name}`);
    }
    const x = await room.add(adding.url.trim(), at && folders.some((f) => f.id === at) ? at : undefined);
    if (x.error) return setAdding({ ...adding, error: x.error });
    setAdding(null);
    // the same thing again (ADDITIONS §5): nothing new; the one already here opens, and the feed says so
    if (x.again && x.thing) { flash(`already here: ${x.thing.name}, opened the existing one`); open(x.thing); }
  };
  const move = async (id: string, to: string) => { setMenu(""); const x = await room.move(id, to); if (x.error) flash(x.error); };
  const makeFolder = async () => {
    if (!making) return;
    const x = await room.folderAdd(making.name, folders.length === 0);
    if (x.error) setMaking({ ...making, error: x.error }); else setMaking(null);
  };

  const thingRow = (t: Thing, depth = 0) => {
    const targets = canFold ? [...(t.parent ? [{ id: "", name: `${name} (the top)` }] : []), ...folders.filter((f) => f.id !== t.parent).map((f) => ({ id: f.id, name: f.name }))] : [];
    return (
      <li key={t.id} className="gp-cn" style={depth ? { paddingLeft: depth * 22 } : undefined}>
        <button className="gp-cn-in" onClick={() => open(t)} title={`${KIND_WORD[t.kind]}: ${t.name}. Click to open it${t.kind === "github" ? "'s cards" : " here"}.`}>
          <KindGlyph kind={t.kind} />
          <span className="nm">{t.name}</span>
          <span className="dd">{t.addedBy}{t.agent ? "'s agent" : ""} · {ago(t.at)}</span>
        </button>
        {inIt(t).length > 0 && <span className="gp-in" title={`${inIt(t).join(", ")} in it now`}>{inIt(t).slice(0, 4).map((who) => <Body key={who} login={who} size={18} />)}</span>}
        {removing === t.id ? (
          <span className="gp-ask" role="group" aria-label={`take ${t.name} off the group?`}>
            <span>take it off for everyone?</span>
            <button className="gp-quiet" autoFocus onClick={() => { setRemoving(""); void room.remove(t.id).then((x) => x.error && flash(x.error)); }}>yes</button>
            <button className="gp-quiet" onClick={() => setRemoving("")}>no</button>
          </span>
        ) : !room.readOnly && (
          <span className="gp-cn-acts">
            {targets.length > 0 && <button className="gp-x" aria-haspopup="menu" aria-expanded={menu === t.id} aria-label={`move ${t.name} to…`} title="move to a folder" onClick={() => setMenu(menu === t.id ? "" : t.id)}>⋯</button>}
            <button className="gp-x" title={`take ${t.name} off this group (the link itself is untouched; the group's record keeps who did)`} aria-label={`remove ${t.name}`} onClick={() => setRemoving(t.id)}>×</button>
          </span>
        )}
        {menu === t.id && (
          <span className="gp-menu" role="menu" aria-label={`move ${t.name} to`} onKeyDown={(e) => { if (e.key === "Escape") setMenu(""); }}>
            {targets.map((x, i) => <button key={x.id || "top"} role="menuitem" autoFocus={i === 0} onClick={() => void move(t.id, x.id)}><KindGlyph kind="folder" />{x.name}</button>)}
            <button role="menuitem" className="dim" onClick={() => setMenu("")}>cancel</button>
          </span>
        )}
      </li>
    );
  };
  const folderRow = (f: Folder, depth = 0): React.ReactNode => {
    const things = room.things.filter((t) => t.parent === f.id), subs = folders.filter((x) => x.parent === f.id);
    const n = things.length + subs.length, opened = !!inside[f.id];
    return (
      <li key={f.id} className="gp-cn-f">
        <div className="gp-cn" style={depth ? { paddingLeft: depth * 22 } : undefined}>
          <button className="gp-cn-in" onClick={() => { setInside((x) => ({ ...x, [f.id]: !opened })); setAt(opened ? (at === f.id ? "" : at) : f.id); }} aria-expanded={opened} title={`a folder: ${f.name}, ${n} inside. Click to ${opened ? "close" : "open"} it here.`}>
            <KindGlyph kind="folder" />
            <span className="nm">{f.name}</span>
            <span className="dd">{f.by} · {ago(f.at)} · {n} inside</span>
          </button>
          {canFold && (removing === `f:${f.id}` ? (
            <span className="gp-ask" role="group" aria-label={`take the folder ${f.name} off?`}>
              <span>take the folder off? what is in it moves up</span>
              <button className="gp-quiet" autoFocus onClick={() => { setRemoving(""); void room.unfolder(f.id).then((x) => x.error && flash(x.error)); }}>yes</button>
              <button className="gp-quiet" onClick={() => setRemoving("")}>no</button>
            </span>
          ) : <span className="gp-cn-acts"><button className="gp-x" aria-label={`remove the folder ${f.name}`} title="take the folder off; what is in it moves up one level, nothing is lost" onClick={() => setRemoving(`f:${f.id}`)}>×</button></span>)}
        </div>
        {opened && <ul className="gp-cn-list">{subs.map((x) => folderRow(x, depth + 1))}{things.map((t) => thingRow(t, depth + 1))}{!n && <li className="none" style={{ paddingLeft: (depth + 1) * 22 + 30 }}>nothing in it yet</li>}</ul>}
      </li>
    );
  };

  return (
    <div className="gp-conn">
      <section className="gp-col" aria-label="this group">
        <h3 className="gp-hd"><span>this group</span>
          {canFold && !making && <button className="gp-link-btn" onClick={() => setMaking({ name: "" })} title="a folder for some of the group's things, as in Google Drive">+ new folder</button>}</h3>
        {making && (
          <form className="gp-mk" onSubmit={(e) => { e.preventDefault(); void makeFolder(); }}>
            <input autoFocus value={making.name} maxLength={60} placeholder="the folder's name" aria-label="the new folder's name" onChange={(e) => setMaking({ name: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setMaking(null)} />
            <button type="submit" className="gp-quiet">{folders.length === 0 ? "all updated, make it" : "make"}</button><button type="button" className="gp-quiet" onClick={() => setMaking(null)}>cancel</button>
            {making.error ? <span className="err" role="alert">{making.error}</span> : folders.length === 0 && <span className="dim">the first folder: older Sols then only read this group's things</span>}
          </form>
        )}
        {room.thingsNote && <p className="none">{room.thingsNote}: connectors and the goal show once it has one</p>}
        {room.readOnly && <p className="none">this group's things were written by a newer Sol: you can open them; update Sol to add, move or take any off</p>}
        <ul className="gp-cn-list">
          {/* the group's own tools, pinned first (#245): Sol's own pages */}
          {TOOLS.map((t) => (
            <li key={t.id} className="gp-cn tool">
              <button className="gp-cn-in" onClick={() => onTool(t.id)} title={`${t.name}: ${t.line}`}>
                <KindGlyph kind={t.id} />
                <span className="nm">{t.name}</span>
                <span className="dd">{((tile) => (tile ? tileLine(tile) : toolLine(t.id, room)))(conn?.tools.find((x) => x.id === t.id))}</span>
              </button>
            </li>
          ))}
          {rows.map((x) => x.k === "repo" ? (
            <RepoItem key={`repo:${x.repo}`} team={team} room={room} repo={x.repo} row={x.row} conn={conn} flash={flash} onRepo={onRepo} onGithub={() => setLit((n) => n + 1)} />
          ) : x.k === "folder" ? folderRow(x.f) : thingRow(x.t)).flatMap((node, i) => (rows[i]?.k === "repo" && rows[i + 1]?.k !== "repo" ? [node, <OnTheBoard key="board" team={team} repos={r?.repos ?? []} />] : [node]))}
        </ul>
        {r?.provider === "drive" && r.repos[0] && <div className="gp-drive"><DriveRow team={team} folder={r.repos[0]} /></div>}
        {!room.readOnly && (adding ? (
          <form className="gp-add on" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <input autoFocus value={adding.url} maxLength={adding.repo ? 200 : 2000} placeholder={adding.repo ? "owner/name, a repository of yours on GitHub" : "paste a link (https)"} aria-label={adding.repo ? "the repository to connect, owner/name" : "the link to connect"}
              onChange={(e) => setAdding({ url: e.target.value, ...(adding.repo ? { repo: true as const } : {}) })} onKeyDown={(e) => e.key === "Escape" && setAdding(null)} />
            {adding.error && <span className="err" role="alert">{adding.error}</span>}
            <button type="submit" className="gp-quiet">connect</button><button type="button" className="gp-quiet" onClick={() => setAdding(null)}>cancel</button>
          </form>
        ) : choosing ? (
          <div className="gp-add on gp-pick" role="group" aria-label="connect" onKeyDown={(e) => { if (e.key === "Escape") setChoosing(false); }}>
            <span aria-hidden="true">+</span> connect
            <button className="gp-quiet" autoFocus onClick={() => { setChoosing(false); setAdding({ url: "" }); }} title="a Google Doc, Slides, a Sheet, Figma or a page: paste its link">a link</button>
            <button className="gp-quiet" onClick={() => { setChoosing(false); setAdding({ url: "", repo: true }); }} title="a private repository you are an admin of: its build updates come to the group, and members ask to be let in">a repository</button>
            <button className="gp-quiet" onClick={() => setChoosing(false)}>cancel</button>
          </div>
        ) : (
          <button className="gp-add" onClick={() => (cloud ? setChoosing(true) : setAdding({ url: "" }))} title={cloud ? "connect a link, or a repository of yours on GitHub" : "connect a Google Doc, Slides, a Sheet, a repository, Figma or a page: paste its link"}>
            <span aria-hidden="true">+</span> connect <span className="dim">· {cloud ? "a link or a repository" : "a link"}{at && folders.some((f) => f.id === at) ? ` into ${folders.find((f) => f.id === at)!.name}` : ""}</span>
          </button>
        ))}
      </section>
      <OnThisMac team={team} me={conn?.me} lit={lit} />
    </div>
  );
}

/** a repository of the group (#332): the git glyph, its name, a dim "who · when" (and "unverified" when my own GitHub
 *  did not check it), at the right the small Sols of who was let in and "N of M", then its one action (rowAction).
 *  Without the one answer (an older engine) it is a GitHub group's own repository as before */
function RepoItem({ team, room, repo, row, conn, flash, onRepo, onGithub }: {
  team: Team; room: RoomData; repo: string; row?: RepoRow; conn: Conn | null; flash: (s: string) => void; onRepo: () => void; onGithub: () => void;
}) {
  const [on, setOn] = useState<boolean | undefined>(undefined);   // the workflow added or removed in this session
  const [busy, setBusy] = useState(false);
  const [needs, setNeeds] = useState("");   // GitHub wants one more permission for workflows: the card under the row
  const [menu, setMenu] = useState(false);
  if (!row || !conn) return (
    <li className="gp-cn">
      <button className="gp-cn-in" onClick={onRepo} title={`the group's repository, ${repo}: its board, hands, try and ship`}>
        <KindGlyph kind="github" />
        <span className="nm">{repo}</span>
        <span className="dd">the repository</span>
        <span className="gp-go-on">open the board ›</span>
      </button>
    </li>
  );
  const cloud = conn.record === "cloud";
  const act = rowAction(row, { name: team.me, record: conn.record }, conn.me.github, on);
  const press = async (f: () => Promise<void>) => { if (busy) return; setBusy(true); try { await f(); } finally { setBusy(false); } };
  const ask = () => press(async () => {
    const x = await room.askIn(repo);
    if (x.error) flash(x.error);
    else if (x.in) flash(`you're in ${repo}`);
    else if (x.asked) flash(`asked ${x.to || row.by || "its maker"} to let you into ${repo}`);
  });
  const workflow = (yes: boolean) => press(async () => {
    setMenu(false);
    const x = await room.workflow(repo, yes);
    if (x.needs) { setNeeds(x.say || "GitHub needs one more permission for workflows"); return; }
    if (x.error) { flash(x.error); return; }
    setNeeds("");
    if (yes && x.added) { setOn(true); flash(`build updates on for ${repo}`); }
    if (!yes && x.removed) { setOn(false); flash(`the workflow is off ${repo}`); }
  });
  const n = inOf(row);
  return (<>
    <li className="gp-cn gp-repo">
      <button className="gp-cn-in" onClick={onRepo} title={cloud ? `${repo}, connected by ${row.by || "someone"}: its board, hands, try and ship` : `the group's repository, ${repo}: its board, hands, try and ship`}>
        <KindGlyph kind="github" />
        <span className="nm">{repo}</span>
        <span className="dd">{row.by ? `${row.by} · ${ago(row.at)}` : "the repository"}</span>
        {cloud && !row.checked && <span className="dd gp-unv" title="your own GitHub has not checked this repository; it is the group's word for now">unverified</span>}
        {!cloud && <span className="gp-go-on">open the board ›</span>}
      </button>
      {cloud && row.in.length > 0 && <span className="gp-in" title={`let in: ${row.in.join(", ")}`}>{row.in.slice(0, 4).map((who) => <Body key={who} login={who} size={18} />)}</span>}
      {cloud && n && <span className="gp-nof" title={`${row.in.length} of the group's ${row.members} let into ${repo}`}>{n}</span>}
      {act === "connect GitHub" && <button className="gp-quiet" onClick={onGithub} title="your GitHub, on this Mac, is how you are let in">connect GitHub</button>}
      {act === "ask to be let in" && <button className="gp-quiet" disabled={busy} onClick={() => void ask()} title={`asks ${row.by || "its maker"} to let your GitHub into ${repo}; nothing happens until they press`}>{busy ? "…" : "ask to be let in"}</button>}
      {act === "asked" && <span className="gp-dimw" title={`${row.by || "its maker"} has your ask; it waits a day`}>asked</span>}
      {act === "add the workflow" && <button className="gp-quiet" disabled={busy} onClick={() => void workflow(true)} title={`a small GitHub workflow in ${repo} tells the group what happens there: pushes, pull requests, issues`}>{busy ? "…" : "add the workflow"}</button>}
      {act === "build updates on" && <>
        <span className="gp-dimw">build updates on</span>
        <button className="gp-x" aria-haspopup="menu" aria-expanded={menu} aria-label={`more for ${repo}`} onClick={() => setMenu(!menu)}>⋯</button>
      </>}
      {menu && (
        <span className="gp-menu" role="menu" aria-label={`more for ${repo}`} onKeyDown={(e) => { if (e.key === "Escape") setMenu(false); }}>
          <button role="menuitem" autoFocus disabled={busy} onClick={() => void workflow(false)}>remove the workflow</button>
          <button role="menuitem" className="dim" onClick={() => setMenu(false)}>cancel</button>
        </span>
      )}
    </li>
    {needs && <li className="gp-scope"><ScopeCard team={team} say={needs} onAgain={() => void workflow(true)} onClose={() => setNeeds("")} /></li>}
  </>);
}

const openUrl = (url: string) => { if (!DEV_TEAM) openOut(url); };   // the dev view opens nothing
type Scope = { k: "ask" } | { k: "wait" } | { k: "code"; code: string; url: string } | { k: "done" };
/** GitHub wants the `workflow` permission before the workflow can be pushed (round 60): one press asks gh for it down
 *  the device flow of the GitHub card (the code, github.com, then team.github.connected), then "add the workflow" again */
function ScopeCard({ team, say, onAgain, onClose }: { team: Team; say: string; onAgain: () => void; onClose: () => void }) {
  const [s, setS0] = useState<Scope>({ k: "ask" });
  const now = useRef<Scope>(s);   // the step a push from the engine is read against
  const setS = (x: Scope) => { now.current = x; setS0(x); };
  const [said, setSaid] = useState("");
  const [copied, copy] = useCopied();
  useEffect(() => link(ENGINE)?.on((m) => {
    const waiting = now.current.k === "code" || now.current.k === "wait";
    if (m?.type === "team.github.connected" && waiting) setS({ k: "done" });
    else if (m?.type === "team.github.connect.failed" && waiting) { setS({ k: "ask" }); setSaid(String(m.error ?? "GitHub did not allow it")); }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const allow = async () => {
    setS({ k: "wait" }); setSaid("");
    const r = await team.ask<{ code?: string; url?: string; error?: string }>("team.github.connect", { scope: "workflow" }, 30_000);
    if (r?.code && r.url) setS({ k: "code", code: r.code, url: r.url });
    else { setS({ k: "ask" }); setSaid(r?.error ?? "GitHub did not answer"); }
  };
  const stop = () => { if (s.k === "code" || s.k === "wait") void team.ask("team.github.connect.cancel", {}, 5_000); onClose(); };
  return (
    <div className="gp-gh gp-scope-card" role="group" aria-label="one more GitHub permission">
      <div className="cgh cgh-conn">
        {s.k === "done" ? <>
          <p className="cgh-lead">allowed: GitHub takes workflows from Sol now</p>
          <span className="cgh-codeline"><button className="wbtn" autoFocus onClick={onAgain}>add the workflow</button><button className="wlink" onClick={onClose}>later</button></span>
        </> : s.k === "code" ? <>
          <p className="cgh-lead">paste this on GitHub's page, then press Authorize</p>
          <span className="cgh-big" title="paste it on GitHub's page">{s.code}</span>
          <span className="cgh-codeline">
            <button className="wbtn" onClick={() => openUrl(s.url)}>open github.com</button>
            <button className="wlink" onClick={() => copy(s.code)}>{copied || "copy"}</button>
            <button className="wlink" onClick={stop}>cancel</button>
          </span>
          <p className="cgh-note">waiting for GitHub…</p>
        </> : <>
          <p className="cgh-lead">{say}</p>
          <span className="cgh-codeline">
            <button className="wbtn" disabled={s.k === "wait"} onClick={() => void allow()}>{s.k === "wait" ? "asking GitHub…" : "allow"}</button>
            <button className="wlink" onClick={stop}>not now</button>
          </span>
          <p className="cgh-note">the workflow sends the group what happens in the repository; GitHub asks before Sol may add one</p>
        </>}
        {said && <p className="cgh-said" role="status">{said}</p>}
      </div>
    </div>
  );
}

/** under the repository: what of the board is mine to pick up (#34, #35; they lived under the repo's folder in the side):
 *  the hands to me, a put-off one too (a click brings it back), and the PR I am trying. Nothing, and it draws nothing */
function OnTheBoard({ team, repos }: { team: Team; repos: string[] }) {
  const h = useHands(), t = useTry().trying;
  const here = repos.filter((repo) => h.pending.some((p) => p.repo === repo) || t?.repo === repo);
  if (!here.length) return null;
  return (
    <li className="gp-board" aria-label="on the board">
      <span className="hd">on the board</span>
      {here.map((repo) => <div key={repo}><HandedRows repo={repo} /><TryingRow team={team} repo={repo} /></div>)}
    </li>
  );
}

/** "on this Mac": Google (Drive) and GitHub, each connected here or the step that connects it. Nothing of either leaves
 *  this Mac: the engine holds the sign-ins, the face sees who */
function OnThisMac({ team, me, lit }: { team: Team; me?: Me; lit: number }) {
  const { drive, busy, bad, connect, letGo } = useDrive(team);
  const [asked, setGh] = useState<{ in: boolean; who?: string } | null>(null);
  const [n, setN] = useState(0);
  // the one answer says who is connected here (#332); only an older engine's tab asks team.accounts
  useEffect(() => {
    if (me) return;
    let live = true;
    void team.ask<{ github?: { in: boolean; who?: string } }>("team.accounts", {}, 30_000).then((a) => { if (live) setGh(a?.github ?? { in: false }); });
    return () => { live = false; };
  }, [team.ask, n, !!me]); // eslint-disable-line react-hooks/exhaustive-deps
  const gh = me?.github ?? asked;
  const google = me ? { connected: me.google.in, email: me.google.email } : drive;
  // "connect GitHub" on a repository's row: the card comes into view and lights up once
  const card = useRef<HTMLDivElement>(null);
  const [glow, setGlow] = useState(false);
  useEffect(() => {
    if (!lit) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    card.current?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
    setGlow(true);
    const t = window.setTimeout(() => setGlow(false), 1600);
    return () => window.clearTimeout(t);
  }, [lit]);
  // signed in through the card: the row says so at once
  useEffect(() => link(ENGINE)?.on((m) => { if (m?.type === "team.github.connected") setN((x) => x + 1); }), []);
  return (
    <section className="gp-col" aria-label="on this Mac">
      <h3 className="gp-hd"><span>on this Mac</span></h3>
      <ul className="gp-cn-list">
        <li className="gp-cn">
          <span className="gp-cn-in static"><GoogleG /><span className="nm">Google</span>
            <span className="dd">{!google ? "…" : google.connected ? `connected${google.email ? ` · ${google.email}` : ""}` : "not connected"}</span></span>
          {google && (google.connected
            ? <button className="gp-quiet" onClick={() => void letGo()}>disconnect</button>
            : <button className="gp-quiet" disabled={busy} onClick={() => void connect()}>{busy ? "finish in your browser…" : "connect"}</button>)}
        </li>
        <li className="gp-cn">
          <span className="gp-cn-in static"><KindGlyph kind="github" /><span className="nm">GitHub</span>
            <span className="dd">{!gh ? "…" : gh.in ? `connected${gh.who ? ` · ${gh.who}` : ""}` : "not connected"}</span></span>
        </li>
      </ul>
      {bad && <p className="none">{bad}</p>}
      {gh && !gh.in && <div ref={card} className={`gp-gh ${glow ? "lit" : ""}`}><GithubJoin team={team} keeps="github" connectors /></div>}
    </section>
  );
}

const GoogleG = () => (
  <svg className="gp-glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d="M14.6 8.2c0-.5 0-.9-.1-1.3H8v2.5h3.7a3.2 3.2 0 0 1-1.4 2.1v1.7h2.3c1.3-1.2 2-3 2-5z" fill="#4285f4" />
    <path d="M8 15c1.9 0 3.5-.6 4.6-1.7l-2.3-1.7c-.6.4-1.4.7-2.3.7a4 4 0 0 1-3.8-2.8H1.9v1.8A7 7 0 0 0 8 15z" fill="#34a853" />
    <path d="M4.2 9.5a4.2 4.2 0 0 1 0-2.9V4.8H1.9a7 7 0 0 0 0 6.4z" fill="#fbbc04" />
    <path d="M8 3.8c1 0 2 .4 2.7 1.1l2-2A7 7 0 0 0 1.9 4.8l2.3 1.8A4 4 0 0 1 8 3.8z" fill="#ea4335" />
  </svg>
);

// ---- the first time (S2): no group yet ----

/** no group yet: the Sol, "make your first group", one line, and the gradient "make a group", which opens the side's own
 *  new-group form in the right half. Once made, the form shows the group's link and code until "open" */
export function FirstGroup({ team, onHold }: { team: Team; onHold: (holding: boolean) => void }) {
  const [form, setForm] = useState(false);
  return (
    <div className="gp-first">
      <div className="gp-hero">
        <Sol size={64} alone />
        <h1>make your first group</h1>
        <p>a group is you, your friends, and each one's agent, in one place</p>
        <button className="gp-go" onClick={() => { setForm(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".gp-form .wfield")?.focus()); }}><span>make a group</span></button>
      </div>
      <div className={`gp-half ${form ? "on" : ""}`}>
        {form && <RoomForm team={team} first onMade={() => onHold(true)} onDone={() => { setForm(false); onHold(false); }} />}
      </div>
    </div>
  );
}
