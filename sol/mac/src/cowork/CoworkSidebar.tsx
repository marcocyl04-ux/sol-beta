// Cowork's side (Together, See #31): the team (a presence dot per person, click for their page), then the team's
// functions, then the team's repositories as folders holding only the shared things on them: the issue wearing `now`,
// the sessions started here (each one mine, signed by my agent), and later a session handed to me and a PR I try.
// Rooms (#154): "new room" sits under the head, where Home has "new session", and opens a small form in place (a name
// is all it takes, #160; under "more" where it meets and its key); the new room becomes the one in use. The rooms come first
// in the list, always, even one: the active one lit, a click switches (the engine reads the other room's board, people
// and shared things). Making a room lives here and not in Settings (Frank, 2026-10-23).
// A share code (#157): "join a room" under "new room" takes the six symbols a friend gave; the room in use has "share",
// which asks the engine for its code, and a room's code shows in its row, a click copies it.
// Cowork's side (#314, the groups PRD §3, §9.9): only groups. Under the head (the Sol mark, home | cowork), "+ new group"
// and "+ join a group" open their small forms in place (#160, #157; a name is all a group takes, where its record lives
// under it), then GROUPS: one row per room, its name and its code, the one in use lit. Under the one in use, indented,
// my own sessions in it (marked with its id by the engine, newest first), each with my small Sol and when, and a dim
// "+ new session" whose first line starts one. A click on the group in use folds those rows (kept on this Mac, by
// group); a click on another group goes there and opens its page. The team, the room's functions and its repositories
// left the side: the people strip, the connectors tab and the bar's buttons hold them now (the PRD §5). On screen a room
// is a group; the engine's messages still say team.room.*.
import { useEffect, useRef, useState } from "react";
import { SeatScene } from "../SeatScene";
import type { AppMode } from "../ModeSwitch";
import { ModeWheel } from "../ModeWheel";
import { useSideFloat } from "../sideFloat";
import { useCover } from "./thingView";
import { Fold, Pill, Turn } from "../MotionKit";
import { working, type Work, type WorkSession } from "../work/useWork";
import type { Team } from "./useTeam";
import { codeTyped, groupsOf, linkFor, useCopied } from "./rooms";
import { takePendingGroup } from "../homeSuggest";   // Home's group card (#321): the form or the list it asked for
import { GithubJoin } from "./GithubJoin";
import { DriveConnect } from "./DriveRoom";   // a Drive room (#152)
import { Body, StateMark, since } from "./bits";
// --- Hand (#34)
import { Menu, type MenuItem } from "../work/Menu";
import { sessionItems } from "./Hands";
// --- end Hand
import "./group.css";

export type Stage = { k: "dashboard" } | { k: "repo" } | { k: "actions" } | { k: "shared" } | { k: "chat" } | { k: "member"; login: string }
  // a thing open in the room's centre (S2), and a session with a thing beside it (S4; #236)
  | { k: "thing"; id: string } | { k: "session"; repo: string; thing?: string }
  // the room's goal as its own page (S6; #238); one of the room's own tools (#245)
  | { k: "goal" } | { k: "tool"; id: "calendar" | "decisions" | "polls" };
export const stageKey = (s: Stage) => (s.k === "member" ? `member:${s.login}` : s.k === "session" ? `session:${s.repo}` : s.k === "thing" ? `thing:${s.id}` : s.k === "tool" ? `tool:${s.id}` : s.k);
/** the stages drawn on the group page itself: its tabs, or a page opened from it (a thing, a person, the goal, a tool) */
export const onGroupPage = (s: Stage) => s.k === "dashboard" || s.k === "thing" || s.k === "member" || s.k === "goal" || s.k === "tool";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Plus = () => <svg viewBox="0 0 16 16" width="14" height="14" {...P} aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>;
const Caret = () => <svg className="caret" viewBox="0 0 6 6" width="6" height="6" shapeRendering="crispEdges" aria-hidden="true"><path d="M1 0h2v1h1v1h1v2h-1v1h-1v1h-2z" fill="currentColor" /></svg>;
/** my sessions in a group (pure): marked with its id, not archived, newest first */
export const groupSessions = (all: WorkSession[], roomId: string) =>
  all.filter((x) => x.mode === "cowork" && x.roomId === roomId && !x.archived).sort((a, z) => z.updatedAt - a.updatedAt);

export function CoworkSidebar({ team, w, pinned, stage, onMode, onStage, onNew }: {
  team: Team; w: Work; pinned: boolean; stage: Stage; onMode: (m: AppMode) => void; onStage: (s: Stage) => void;
  /** "+ new session": a new session of the group in use, its first line starts it; in one of its repositories when picked */
  onNew: (repo?: string) => void;
}) {
  const [making, setMaking] = useState<"" | "new" | "join">("");
  const [note, setNote] = useState("");   // a group made without its code: the engine's warning, until the next press
  const [joining, setJoining] = useState(false);   // GitHub's sign-up pane is up (#252): the side, with its code and buttons, stays open
  // Home's group card (#321, homeSuggest.ts), read once as Cowork opens: "open a new group" opens the form here with the
  // name filled (nothing is made until "make it"); "add to a group I'm in" lights the rooms with "pick a group" over
  // them until the first click. Either holds a floating side open while it waits.
  const [named, setNamed] = useState<string | null>(null);
  const [pickHint, setPickHint] = useState(false);
  useEffect(() => {
    const p = takePendingGroup();
    if (p?.k === "new") { setNamed(p.name); setMaking("new"); }
    else if (p?.k === "pick") setPickHint(true);   // the groups are always listed (#314): nothing to unfold
  }, []);
  useEffect(() => {
    if (!pickHint) return;
    const gone = () => setPickHint(false);
    window.addEventListener("pointerdown", gone, { capture: true, once: true });
    return () => window.removeEventListener("pointerdown", gone, { capture: true });
  }, [pickHint]);
  const f = useSideFloat(pinned, (making === "new" && (joining || named !== null)) || pickHint, 272);
  useCover(!pinned && f.open, "side");   // floating over the pane, the thing's page steps aside (#236)
  // a group's own rows folded, by room id; kept on this Mac
  const [folded, setFolded] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("sol.cowork.folded") ?? "{}"); } catch { return {}; } });
  const setFold = (k: string, v: boolean) => setFolded((x) => { const n = { ...x, [k]: v }; try { localStorage.setItem("sol.cowork.folded", JSON.stringify(n)); } catch { /* private */ } return n; });
  const s = team.state, me = team.me;
  // my groups: the rooms, less the one the engine makes up when none was made (rooms.ts madeUp)
  const rooms = groupsOf(s?.settings.rooms ?? []), room = s?.settings.room ?? "";
  const page = onGroupPage(stage);
  // the group in use: on its page a click folds its rows (or opens them again); off it, a click brings the page back,
  // its rows open. Another group: Sol goes there (the engine reads its things, people and talk) and its page opens
  const pick = (id: string) => {
    if (id === room) {
      if (page && stage.k === "dashboard") setFold(id, !folded[id]);
      else { setFold(id, false); onStage({ k: "dashboard" }); }
      return;
    }
    void team.ask("team.settings", { patch: { room: id } });
    setFold(id, false);
    onStage({ k: "dashboard" });
  };
  // --- Hand (#34): a session row's right-click hands it on, in a group whose record is a repository
  const [handMenu, setHandMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const others = [...new Set([...(s?.roster ?? []).map((m) => m.who), ...(s?.members ?? [])])].filter((who) => who !== me);
  const repo = team.board?.repos[0] ?? "";
  const handSession = (ev: React.MouseEvent, x: WorkSession) => { if (!repo) return; ev.preventDefault(); ev.stopPropagation(); setHandMenu({ x: ev.clientX, y: ev.clientY, items: sessionItems(repo, x.id, x.title, others) }); };
  // --- end Hand
  const mine = groupSessions(w.sessions, room);
  const live = stage.k === "session" ? w.live : null;
  return (
    <aside ref={f.ref} className={`side wside cside ${f.open ? "open" : ""} ${pinned ? "pinned" : ""}`} onMouseEnter={f.onMouseEnter} onMouseLeave={f.onMouseLeave}
      aria-hidden={!f.open} inert={!f.open}>
      <div className="side-head" data-s>
        <SeatScene mode="cowork" />
        <ModeWheel mode="cowork" onPick={onMode} />
      </div>
      {making === "new" ? <RoomForm team={team} initial={named ?? ""} onPane={setJoining} onDone={(m) => { setMaking(""); setNamed(null); setNote(m?.warn ?? ""); }} />
        : making === "join" ? <JoinForm team={team} onDone={() => setMaking("")} />
        : <>
          <button className="newc" data-s onClick={() => { setNote(""); setMaking("new"); }}><Plus /><span>new group</span></button>
          <button className="newc cjoin" data-s onClick={() => { setNote(""); setMaking("join"); }}><Plus /><span>join a group</span></button>
          {note && <p className="none gs-note" role="status">{note}</p>}
        </>}
      <div className="side-list">
        <Pill selector=".row.on" mode="on" watch={`${stageKey(stage)}|${JSON.stringify(folded)}|${live}|${room}|${rooms.length}|${mine.length}`} className="on" />
        <Pill selector=".row" mode="hover" className="hov" />
        {pickHint && <p className="cpickhint" role="status">{rooms.length ? "pick a group" : "no groups yet: make one above"}</p>}
        <div className="group gs-head" data-s><span>groups</span><small>{rooms.length}</small></div>
        {rooms.length === 0 && <p className="none">no groups yet</p>}
        {rooms.map((r) => {
          const here = r.id === room, open = here && !folded[r.id];
          return (
            <div key={r.id} className="gs-group">
              <div className={`row crow gs-room ${here && page ? "on" : ""}`} data-s onClick={() => pick(r.id)} aria-expanded={here ? open : undefined}
                title={here ? (page ? (open ? `fold ${r.name}'s sessions` : `show ${r.name}'s sessions`) : `back to ${r.name}`) : `go to ${r.name}`}>
                <Turn to={open ? 90 : 0} cfg={{ k: 380, z: 0.5 }}><Caret /></Turn>
                <span className="t">{r.name}</span>
                {r.code && <code className="gs-code">{r.code}</code>}
              </div>
              {here && (
                <Fold open={open} from={{ x: -18 }} gap={30}>
                  {mine.map((x) => {
                    const run = w.runs[x.id];
                    return (
                      <div key={x.id} className={`row crow gs-sess ${live === x.id ? "on" : ""}`} data-s onClick={() => { w.open(x.id); onStage({ k: "session", repo: "" }); }} title={x.title}
                        onContextMenu={(ev) => handSession(ev, x)}>
                        {working(run) ? <StateMark kind="running" seed={x.id} /> : run?.waiting ? <StateMark kind="needs" seed={x.id} /> : <Body login={me} size={16} />}
                        <span className="t">{x.title || "untitled"}</span>
                        <small className="gs-when">{since(x.updatedAt)}</small>
                      </div>
                    );
                  })}
                  <div className={`row crow gs-sess gs-new ${stage.k === "session" && !w.live ? "on" : ""}`} data-s title={`a new session in ${r.name}: your first line starts it`}
                    onClick={(ev) => (r.provider === "github" && r.repos.length > 1
                      // a GitHub group of several repositories: which one it works in, asked in a small menu
                      ? setHandMenu({ x: ev.clientX, y: ev.clientY, items: r.repos.map((x) => ({ label: x.split("/")[1] ?? x, note: x, run: () => onNew(x) })) })
                      : onNew())}>
                    <Plus /><span className="t">new session</span>
                  </div>
                </Fold>
              )}
            </div>
          );
        })}
      </div>
      {handMenu && <Menu x={handMenu.x} y={handMenu.y} items={handMenu.items} onClose={() => setHandMenu(null)} />}{/* Hand (#34) */}
    </aside>
  );
}

// A new group, in place under the head (#160): a name is all it takes. Enter or "make it" asks the engine, which checks
// the name is free on the hub, makes the room (its record where the person picked), adds it as the one in use and gives
// it its code. Under "more", where it meets (the shared hub unless blanked: this Mac) and the key that place gave.
// Esc or "not now" closes. A group made without its code comes back with a warning, said under the buttons.
// Where its record lives (#152): Sol's cloud (when signed in there, the engine's own default), GitHub (a repository under
// my account), or a Drive folder: its link pasted, read with my own Google Drive, which is connected here first.
// The first-time page (S2, #314) draws the same form in the centre's right half (`first`): a label over the name, and,
// once made, the group's link with "copy link", its code large, and "open <name>", which is when the page lets go.
type Keeps = "cloud" | "github" | "drive";
const KEEPS: { k: Keeps; word: string; title: string }[] = [
  { k: "cloud", word: "Sol's cloud", title: "the group's things and goal on Sol's cloud" },
  { k: "github", word: "GitHub", title: "a repository under your GitHub account, for a group that writes code" },
  { k: "drive", word: "a Drive folder", title: "a Google Drive folder you pick: its people are the folder's" },
];
type Made = { id: string; name: string; code?: string; provider?: string; hub?: string; warn?: string };
// initial: a name from Home's group card (#321), filled in and left for the person to change or make
export function RoomForm({ team, initial = "", onDone, onPane, first: big, onMade }: {
  team: Team; initial?: string; onDone: (made?: Made) => void; onPane?: (up: boolean) => void;
  /** the first-time page's form (S2): it stays up once the group is made, until "open" */
  first?: boolean; onMade?: (made: Made) => void;
}) {
  const [name, setName] = useState(initial);
  const signed = !!team.state?.cloud?.login;
  const [keeps, setKeeps] = useState<Keeps>(signed ? "cloud" : "github");
  const [folder, setFolder] = useState("");
  const [more, setMore] = useState(false);
  const [hub, setHub] = useState(team.state?.hub ?? "");   // #157: the shared hub, unless the person blanks it
  const [key, setKey] = useState("");
  const [bad, setBad] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const make = async () => {
    if (busy || made) return;
    if (!name.trim()) return setBad("a group needs a name");
    if (keeps === "drive" && !folder.trim()) return setBad("paste the link of a Drive folder");
    setBusy(true);
    const a = await team.ask<{ room?: { id: string; name?: string; code?: string; provider?: string; hub?: string }; warn?: string; error?: string }>("team.room.make", { name: name.trim(), hub: hub.trim(), key: key.trim(),
      ...(keeps === "github" ? { code: true } : {}), ...(keeps === "drive" ? { drive: folder.trim() } : {}) }, 90_000);
    setBusy(false);
    if (!a.room) return setBad(a.error ?? "Sol did not make that group; try again");
    const m: Made = { id: a.room.id, name: a.room.name ?? name.trim(), ...(a.room.code ? { code: a.room.code } : {}), ...(a.room.provider ? { provider: a.room.provider } : {}), ...(a.room.hub ? { hub: a.room.hub } : {}), ...(a.warn ? { warn: a.warn } : {}) };
    if (!big) return onDone(m);
    setMade(m);
    onMade?.(m);
  };
  const keys = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); onDone(); }
    else if (ev.key === "Enter") { ev.preventDefault(); void make(); }
  };
  const field = (v: string, set: (s: string) => void, placeholder: string, o: { type?: string; ref?: React.RefObject<HTMLInputElement | null>; label?: string } = {}) => (
    <input ref={o.ref} className="wfield" type={o.type ?? "text"} value={v} placeholder={placeholder} spellCheck={false} autoComplete="off" aria-label={o.label}
      disabled={!!made} onChange={(e) => { set(e.target.value); setBad(""); }} onKeyDown={keys} />
  );
  return (
    <div className={big ? "gp-form" : "croomnew"} data-s>
      {big && <label className="gp-lbl">name</label>}
      {field(name, setName, big ? "what your group is called" : "name", { ref: first, label: "the group's name" })}
      {made ? <MadeLink made={made} join={team.hub.join} onOpen={() => onDone(made)} /> : <>
      <div className="ckeeps" role="radiogroup" aria-label="where its record lives">
        {KEEPS.filter((x) => x.k !== "cloud" || signed).map((x) => (
          <button key={x.k} role="radio" aria-checked={keeps === x.k} className={`wlink ckeep ${keeps === x.k ? "on" : ""}`} title={x.title}
            onClick={() => { setKeeps(x.k); setBad(""); }}>{x.word}</button>
        ))}
      </div>
      {keeps === "drive" && <>
        {field(folder, setFolder, "the Drive folder's link")}
        <DriveConnect team={team} />
      </>}
      {keeps === "github" && <GithubJoin team={team} keeps={keeps} onPane={onPane} />}{/* no GitHub yet (#252, ADDITIONS §4c): GitHub rooms only */}
      <button className="wlink croommore" onClick={() => setMore((m) => !m)} aria-expanded={more}>{more ? "less" : "more"}</button>
      {more && <>
        {field(hub, setHub, "where it meets, blank: this Mac")}
        {field(key, setKey, "its key, if that place gave one", { type: "password" })}
      </>}
      {bad && <p className="cbad">{bad}</p>}
      <div className="cacts">
        <button className="wlink" onClick={() => onDone()}>not now</button>
        {big ? <button className="gp-go" disabled={busy || !name.trim()} onClick={() => void make()}><span>{busy ? "making it…" : "make it"}</span></button>
          : <button className="wbtn" disabled={busy || !name.trim()} onClick={() => void make()}>{busy ? "making it…" : "make it"}</button>}
      </div>
      </>}
    </div>
  );
}

/** a made group's way in (S2): its link and "copy link" for a group on Sol's cloud, its code large, and "open <name>" */
function MadeLink({ made, join, onOpen }: { made: Made; join?: boolean; onOpen: () => void }) {
  const [copied, copy] = useCopied();
  const url = linkFor(made, join);   // once the hub said it serves the join page (#327)
  return (<>
    {url && <>
      <label className="gp-lbl">link</label>
      <div className="gp-link"><span className="u">{url.replace(/^https:\/\//, "")}</span>
        <button className="gp-quiet" onClick={() => copy(url)}>{copied || "copy link"}</button></div>
    </>}
    {made.code && <p className="gp-bigcode"><b>{made.code}</b><span>{url ? "or they type this code" : "they type this code to join"}</span>
      {!url && <button className="gp-quiet" onClick={() => copy(made.code!)}>{copied || "copy code"}</button>}</p>}
    {made.warn && <p className="cbad">{made.warn}</p>}
    <button className="gp-go" autoFocus onClick={onOpen}><span>open {made.name}</span></button>
  </>);
}

// Join a group (#157), in place under the head like a new one: the six symbols a friend gave, upper-cased as typed; a
// pasted code with a space or a dash in it ("K7Q X2M") comes down to its six symbols.
// Enter or "join" asks the engine, which finds the room on its hub, adds it and goes there; the form then closes.
function JoinForm({ team, onDone }: { team: Team; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [bad, setBad] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const join = async () => {
    if (busy) return;
    if (code.length !== 6) return setBad("a code is six letters and digits");
    setBusy(true);
    const a = await team.ask<{ room?: { id: string }; already?: boolean; error?: string }>("team.room.join", { code });
    setBusy(false);
    if (a.room) return onDone();   // a new room, or one I am in already: the engine went there either way
    setBad(a.error ?? "Sol did not find that group; try again");
  };
  const keys = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); onDone(); }
    else if (ev.key === "Enter") { ev.preventDefault(); void join(); }
  };
  return (
    <div className="croomnew" data-s>
      <input ref={first} className="wfield ccodein" type="text" value={code} placeholder="the code a friend gave you" spellCheck={false} autoComplete="off"
        onChange={(e) => { setCode(codeTyped(e.target.value)); setBad(""); }} onKeyDown={keys} />
      {bad && <p className="cbad">{bad}</p>}
      <div className="cacts">
        <button className="wlink" onClick={onDone}>not now</button>
        <button className="wbtn" disabled={busy || !code.trim()} onClick={() => void join()}>join</button>
      </div>
    </div>
  );
}

