// Cowork's side (Together, See #31): the team (a presence dot per person, click for their page), then the team's
// functions, then the team's repositories as folders holding only the shared things on them: the issue wearing `now`,
// the sessions started here (each one mine, signed by my agent), and later a session handed to me and a PR I try.
// Rooms (#154): "new room" sits under the head, where Home has "new session", and opens a small form in place (a name
// is all it takes, #160; under "more" where it meets and its key); the new room becomes the one in use. The rooms come first
// in the list, always, even one: the active one lit, a click switches (the engine reads the other room's board, people
// and shared things). Making a room lives here and not in Settings (Frank, 2026-10-23).
// A share code (#157): "join a room" under "new room" takes the six symbols a friend gave; the room in use has "share",
// which asks the engine for its code, and a room's code shows in its row, a click copies it.
import { useEffect, useRef, useState } from "react";
import { SeatScene } from "../SeatScene";
import type { AppMode } from "../ModeSwitch";
import { ModeWheel } from "../ModeWheel";
import { useSideFloat } from "../sideFloat";
import { useCover } from "./thingView";
import { Fold, Pill, Turn } from "../MotionKit";
import { working, type Work, type WorkSession } from "../work/useWork";
import type { Team } from "./useTeam";
import { codeTyped } from "./rooms";
import { GithubJoin } from "./GithubJoin";
import { DriveConnect, DriveRow } from "./DriveRoom";   // a Drive room (#152)
import { PersonDot, STATE_WORD, StateMark, Who } from "./bits";
// --- Hand (#34)
import { Menu, type MenuItem } from "../work/Menu";
import { HandedRows, sessionItems, useHandedCount } from "./Hands";
// --- end Hand
// --- Try (#35)
import { TryingRow } from "./TryPane";
// --- end Try

export type Stage = { k: "dashboard" } | { k: "repo" } | { k: "actions" } | { k: "shared" } | { k: "chat" } | { k: "member"; login: string }
  // a thing open in the room's centre (S2), and a session with a thing beside it (S4; #236)
  | { k: "thing"; id: string } | { k: "session"; repo: string; thing?: string }
  // the room's goal as its own page (S6; #238); one of the room's own tools (#245)
  | { k: "goal" } | { k: "tool"; id: "calendar" | "decisions" | "polls" };
export const stageKey = (s: Stage) => (s.k === "member" ? `member:${s.login}` : s.k === "session" ? `session:${s.repo}` : s.k === "thing" ? `thing:${s.id}` : s.k === "tool" ? `tool:${s.id}` : s.k);

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Plus = () => <svg viewBox="0 0 16 16" width="14" height="14" {...P} aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>;
const Caret = () => <svg className="caret" viewBox="0 0 6 6" width="6" height="6" shapeRendering="crispEdges" aria-hidden="true"><path d="M1 0h2v1h1v1h1v2h-1v1h-1v1h-2z" fill="currentColor" /></svg>;

const FUNCS: { k: "dashboard" | "repo" | "actions" | "shared" | "chat"; name: string; key?: string; later?: string }[] = [
  { k: "dashboard", name: "the room", key: "⌘B" },   // the room's first page (#234)
  { k: "repo", name: "the board" },                   // the board, as it was: the repo page (§7), every function on it
  { k: "actions", name: "action board" },
  // --- Share (#36)
  { k: "shared", name: "shared with me" },
  // --- end Share
  { k: "chat", name: "group chat" },   // Talk (#37): live
];
const inFolder = (s: WorkSession, dir?: string) => !!dir && (s.cwd === dir || s.cwd.startsWith(dir.replace(/\/$/, "") + "/"));

export function CoworkSidebar({ team, w, pinned, stage, onMode, onStage, onFresh }: {
  team: Team; w: Work; pinned: boolean; stage: Stage; onMode: (m: AppMode) => void; onStage: (s: Stage) => void; onFresh: (repo: string) => void;
}) {
  const [making, setMaking] = useState<"" | "new" | "join">("");
  const [joining, setJoining] = useState(false);   // GitHub's sign-up pane is up (#252): the side, with its code and buttons, stays open
  const f = useSideFloat(pinned, making === "new" && joining, 272);
  useCover(!pinned && f.open, "side");   // floating over the pane, the thing's page steps aside (#236)
  const [folded, setFolded] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("sol.cowork.folded") ?? "{}"); } catch { return {}; } });
  const fold = (k: string) => setFolded((x) => { const n = { ...x, [k]: !x[k] }; localStorage.setItem("sol.cowork.folded", JSON.stringify(n)); return n; });
  const s = team.state, b = team.board, me = team.me;
  const up = !!s?.relay.up;
  // the team: me, who is on now, and every member (#102: an org member shows with no hand-off, dark until seen)
  const people = [...new Set([me, ...(s?.roster ?? []).map((m) => m.who), ...(s?.members ?? [])].filter(Boolean))];
  // the room's repos: the board's until it is read again after a switch, so the new room's name never sits over the
  // old room's folders (review of #154)
  const repos = s && b && s.settings.repos.join(",") !== b.repos.join(",") ? s.settings.repos : b?.repos ?? s?.settings.repos ?? [];
  const rooms = s?.settings.rooms ?? [], room = s?.settings.room ?? "";   // an engine from before rooms sends none
  const switchRoom = (id: string) => { if (id !== room) void team.ask("team.settings", { patch: { room: id } }); };
  // #157: a share under way, the code the engine just gave a room, or what went wrong, by room id. The settings' code
  // wins: an answer is dropped once team.state carries a code for its room, or when its room is gone
  const [shared, setShared] = useState<Record<string, { busy?: boolean; code?: string; error?: string }>>({});
  const share = async (id: string) => {
    setShared((x) => ({ ...x, [id]: { busy: true } }));
    const a = await team.ask<{ code?: string; error?: string }>("team.room.share", { id });
    setShared((x) => ({ ...x, [id]: a.code ? { code: a.code } : { error: a.error ?? "no code came back" } }));
  };
  const roomIds = rooms.map((r) => r.id).join(","), roomCodes = rooms.map((r) => `${r.id}:${r.code ?? ""}`).join(",");
  // a room that is gone takes its answer with it (a room made since keeps the warning it came with)
  useEffect(() => { setShared((x) => Object.fromEntries(Object.entries(x).filter(([id]) => rooms.some((r) => r.id === id)))); }, [roomIds]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setShared((x) => { const n = { ...x }; for (const r of rooms) if (r.code) delete n[r.id]; return n; }); }, [roomCodes]);   // eslint-disable-line react-hooks/exhaustive-deps
  const at = stageKey(stage);
  // --- Hand (#34): what is handed to me under each repo; a session row's right-click hands it on
  const handedIn = useHandedCount();
  const [handMenu, setHandMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const others = [...new Set([...(s?.roster ?? []).map((m) => m.who), ...(s?.members ?? [])])].filter((who) => who !== me);
  const handSession = (ev: React.MouseEvent, repo: string, x: WorkSession) => { ev.preventDefault(); ev.stopPropagation(); setHandMenu({ x: ev.clientX, y: ev.clientY, items: sessionItems(repo, x.id, x.title, others) }); };
  // --- end Hand
  const Sec = ({ k, label, n, here, children }: { k: string; label: string; n?: number; here?: () => void; children: React.ReactNode }) => (
    <div className="wsec">
      <div className={`group tog ${folded[k] ? "" : "open"}`} data-s onClick={() => fold(k)}>
        <Turn to={folded[k] ? 0 : 90} cfg={{ k: 380, z: 0.5 }}><Caret /></Turn>
        <span className="gl">{label}</span>
        {!!n && <small>{n}</small>}
        {here && <button className="here" title={`a new session in ${label}`} onClick={(ev) => { ev.stopPropagation(); here(); }}><Plus /></button>}
      </div>
      <Fold open={!folded[k]} from={{ x: -18 }} gap={30}>{children}</Fold>
    </div>
  );
  return (
    <aside ref={f.ref} className={`side wside cside ${f.open ? "open" : ""} ${pinned ? "pinned" : ""}`} onMouseEnter={f.onMouseEnter} onMouseLeave={f.onMouseLeave}
      aria-hidden={!f.open} inert={!f.open}>
      <div className="side-head" data-s>
        <SeatScene mode="cowork" />
        <ModeWheel mode="cowork" onPick={onMode} />
      </div>
      {making === "new" ? <RoomForm team={team} onPane={setJoining} onDone={(made) => { setMaking(""); if (made?.warn) setShared((x) => ({ ...x, [made.id]: { error: made.warn } })); }} />
        : making === "join" ? <JoinForm team={team} onDone={() => setMaking("")} />
        : <>
          <button className="newc" data-s onClick={() => setMaking("new")}><Plus /><span>new room</span></button>
          <button className="newc cjoin" data-s onClick={() => setMaking("join")}><Plus /><span>join a room</span></button>
        </>}
      <div className="side-list">
        <Pill selector=".row.on" mode="on" watch={`${at}|${JSON.stringify(folded)}|${people.length}|${w.live}|${room}|${rooms.length}`} className="on" />
        <Pill selector=".row" mode="hover" className="hov" />
        {rooms.length > 0 && (
          <Sec k="rooms" label="rooms" n={rooms.length}>
            {rooms.map((r) => {
              const sh = shared[r.id], code = r.code || sh?.code;
              return (
                <div key={r.id} className={`row crow ${r.id === room ? "on" : ""}`} data-s onClick={() => switchRoom(r.id)}
                  title={r.id === room ? `you are in ${r.name}` : `go to ${r.name}`}>
                  <span className="t">{r.name}</span>
                  {r.provider !== "github" && <small className="cwhat">{r.provider}</small>}
                  {code ? <Code code={code} />
                    : r.id === room && <button className="wlink cshare" disabled={!!sh?.busy} title={sh?.error ?? "a code a friend types to join this room"}
                      onClick={(ev) => { ev.stopPropagation(); void share(r.id); }}>{sh?.busy ? "…" : "share"}</button>}
                </div>
              );
            })}
            {(() => { const r = rooms.find((x) => x.id === room); return r?.provider === "drive" && r.repos[0] ? <DriveRow team={team} folder={r.repos[0]} /> : null; })()}
          </Sec>
        )}
        <Sec k="team" label="the team" n={people.length}>
          {people.map((who) => {
            const m = s?.roster.find((r) => r.who === who);
            return (
              <div key={who} className={`row crow ${at === `member:${who}` ? "on" : ""}`} data-s onClick={() => onStage({ k: "member", login: who })}>
                <PersonDot login={who} roster={s?.roster ?? []} up={up} me={me} />
                <span className="t">{who}{who === me && <small className="cdim"> (you)</small>}</span>
                {/* Show (#101): someone showing a session says so here; their page opens the watch */}
                {(() => { const sh = team.showing.find((x) => x.login === who); return sh
                  ? <small className="cwhat cshowing" title={`${who} is ${sh.issue ? `showing #${sh.issue}` : "in a session of the room"} ${sh.session.title}: open their page to watch`}>{sh.issue ? `showing #${sh.issue}` : "live in a session"}</small>
                  : <small className="cwhat">{m?.session?.title ?? (m ? STATE_WORD[m.state] : who === me ? "" : "not seen")}</small>; })()}
              </div>
            );
          })}
        </Sec>
        <Sec k="together" label="together">
          {FUNCS.map((x) => (
            <div key={x.k} className={`row crow ${at === x.k ? "on" : ""} ${x.later ? "later" : ""}`} data-s onClick={() => onStage({ k: x.k })} title={x.later}>
              <span className="t">{x.name}</span>
              {x.key && <kbd className="ckey">{x.key}</kbd>}
              {x.later && <small className="cwhat">later</small>}
            </div>
          ))}
        </Sec>
        {repos.map((repo) => {
          const dir = b?.folders[repo];
          const name = repo.split("/")[1] ?? repo;
          const now = (b?.cards ?? []).filter((c) => c.repo === repo && c.labels.includes("now"));
          const mine = w.sessions.filter((x) => x.mode === "cowork" && !x.archived && (inFolder(x, dir) || (!dir && x.project.endsWith("/" + name))))
            .sort((a, z) => z.updatedAt - a.updatedAt);
          const handed = handedIn(repo);   // Hand (#34)
          return (
            <Sec key={repo} k={`repo:${repo}`} label={name} n={now.length + mine.length + handed} here={dir ? () => onFresh(repo) : undefined}>
              {now.map((c) => (
                <div key={c.number} className="row crow" data-s onClick={() => onStage({ k: "actions" })} title={`the issue wearing now: #${c.number} ${c.title}`}>
                  <span className="cnow">now</span><span className="t"><span className="cnum">#{c.number}</span> {c.title}</span>
                  {(() => { const s = c.sign ?? (c.assignees[0] ? { login: c.assignees[0], agent: false } : undefined);
                    return s ? <span className="chold" title={s.agent ? `moved last by ${s.login}'s agent` : `moved last by ${s.login}`}><Who login={s.login} size={14} /></span> : null; })()}
                </div>
              ))}
              {mine.map((x) => {
                const run = w.runs[x.id];
                return (
                  <div key={x.id} className={`row crow ${w.live === x.id && stage.k === "session" ? "on" : ""}`} data-s onClick={() => { w.open(x.id); onStage({ k: "session", repo }); }} title={x.title}
                    onContextMenu={(ev) => handSession(ev, repo, x)}>
                    {working(run) ? <StateMark kind="running" seed={x.id} /> : run?.waiting ? <StateMark kind="needs" seed={x.id} /> : <span className="cslot" aria-hidden="true" />}
                    <span className="t">{x.title || "untitled"}</span>
                    <span className="chold" title={`${me}'s agent`}><Who login={me} size={14} /></span>
                  </div>
                );
              })}
              {/* --- Hand (#34): handed to you, here */}
              <HandedRows repo={repo} />
              {/* --- end Hand */}
              {/* --- Try (#35): the PR I am trying, under its repo */}
              <TryingRow team={team} repo={repo} />
              {/* --- end Try */}
              {!now.length && !mine.length && !handed && <p className="none">nothing shared here yet</p>}
            </Sec>
          );
        })}
        {!repos.length && <p className="none">no repositories yet</p>}
      </div>
      {handMenu && <Menu x={handMenu.x} y={handMenu.y} items={handMenu.items} onClose={() => setHandMenu(null)} />}{/* Hand (#34) */}
    </aside>
  );
}

// A new room, in place under the head (#160): a name is all it takes. Enter or "make it" asks the engine, which checks
// the name is free on the hub, makes the room's repository under my GitHub account, adds the room as the one in use and
// gives it its code. Under "more", where it meets (the shared hub unless blanked: this Mac) and the key that place gave.
// Esc or "not now" closes. A room made without its code comes back with a warning, said on its share button.
// Where its record lives (#152): Sol's cloud (when signed in there, the engine's own default), GitHub (a repository under
// my account), or a Drive folder: its link pasted, read with my own Google Drive, which is connected here first.
type Keeps = "cloud" | "github" | "drive";
const KEEPS: { k: Keeps; word: string; title: string }[] = [
  { k: "cloud", word: "Sol's cloud", title: "the room's things and goal on Sol's cloud" },
  { k: "github", word: "GitHub", title: "a repository under your GitHub account, for a room that writes code" },
  { k: "drive", word: "a Drive folder", title: "a Google Drive folder you pick: its people are the folder's" },
];
function RoomForm({ team, onDone, onPane }: { team: Team; onDone: (made?: { id: string; warn?: string }) => void; onPane?: (up: boolean) => void }) {
  const [name, setName] = useState("");
  const signed = !!team.state?.cloud?.login;
  const [keeps, setKeeps] = useState<Keeps>(signed ? "cloud" : "github");
  const [folder, setFolder] = useState("");
  const [more, setMore] = useState(false);
  const [hub, setHub] = useState(team.state?.hub ?? "");   // #157: the shared hub, unless the person blanks it
  const [key, setKey] = useState("");
  const [bad, setBad] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const make = async () => {
    if (busy) return;
    if (!name.trim()) return setBad("a room needs a name");
    if (keeps === "drive" && !folder.trim()) return setBad("paste the link of a Drive folder");
    setBusy(true);
    const a = await team.ask<{ room?: { id: string }; warn?: string; error?: string }>("team.room.make", { name: name.trim(), hub: hub.trim(), key: key.trim(),
      ...(keeps === "github" ? { code: true } : {}), ...(keeps === "drive" ? { drive: folder.trim() } : {}) }, 90_000);
    setBusy(false);
    if (a.room) return onDone({ id: a.room.id, ...(a.warn ? { warn: a.warn } : {}) });
    setBad(a.error ?? "Sol did not make that room; try again");
  };
  const keys = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); onDone(); }
    else if (ev.key === "Enter") { ev.preventDefault(); void make(); }
  };
  const field = (v: string, set: (s: string) => void, placeholder: string, o: { type?: string; ref?: React.RefObject<HTMLInputElement | null> } = {}) => (
    <input ref={o.ref} className="wfield" type={o.type ?? "text"} value={v} placeholder={placeholder} spellCheck={false} autoComplete="off"
      onChange={(e) => { set(e.target.value); setBad(""); }} onKeyDown={keys} />
  );
  return (
    <div className="croomnew" data-s>
      {field(name, setName, "name", { ref: first })}
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
        <button className="wbtn" disabled={busy || !name.trim()} onClick={() => void make()}>{busy ? "making it…" : "make it"}</button>
      </div>
    </div>
  );
}

// A room's share code in its row (#157): a click copies it, and the title says so for a moment
function Code({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const t = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const copy = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.clearTimeout(t.current);
      t.current = window.setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };
  return <small className="ccode" title={copied ? "copied" : "click to copy"} onClick={copy}><code>{code}</code></small>;
}

// Join a room (#157), in place under the head like a new room: the six symbols a friend gave, upper-cased as typed; a
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
    setBad(a.error ?? "Sol did not find that room; try again");
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

