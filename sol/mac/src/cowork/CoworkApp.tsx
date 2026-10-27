// Cowork (Together, See #31): Work with others, on Work's paper. The side holds the team, the team's functions and the
// team's repositories; the stage shows the dashboard (cmd+B), the action board, a member's page, or a session started
// here. A session started here is a Work session marked `cowork` (PROTOCOL round 17): Work's side does not list it,
// this side lists it under its repo, and "open in Work" on a card is the one way across.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { useEngine } from "../useEngine";
import type { AppMode } from "../ModeSwitch";
import { Space } from "../creature/Space";
import { useCreatureDriver } from "../creature/state";
import { BarCells } from "../BarCells";
import { Mark } from "../Mark";
import { CFG, enter, follow, type Follow } from "../motion";
import { fitRow, useDock, useWidth } from "../fit";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWork, working as isWorking, type Work } from "../work/useWork";
import { WorkTalk } from "../work/WorkTalk";
import { Composer, type Draft } from "../work/Composer";
import { PaneFrame, PaneBody, PANE_FLOOR } from "../work/Panes";
import { button, type ButtonCtx, type Talk as ToTalk } from "../buttons";
import { Rail } from "../buttons/Rail";
import { FilePane } from "../work/FilePane";
import { useTeam, PING_WORD, type Card } from "./useTeam";
import { CoworkSidebar, stageKey, type Stage } from "./CoworkSidebar";
import { Dashboard } from "./Dashboard";
import { Room } from "./Room";   // the room's first page (#234); a person (S3) and the goal (S6) on it (#238)
import { useRoom, type Thing } from "./useRoom";
import { ActionBoard, ACTIONS_HOWTO, openInHome } from "./ActionBoard";
import { MeCtx, Sig } from "./bits";
import { BarCard } from "./BarCard";
import { Talk } from "./Talk";   // Talk (#37)
// --- Hand (#34)
import { HandLine } from "./Hands";
import { useHands } from "./handed";
// --- end Hand
// --- Try (#35)
import { TryFrame } from "./TryPane";
// --- end Try
import { Shared, SharedPane } from "./Shared";
import { ThingPane } from "./ThingPane";   // S4: the thing beside a session (#236)
import { useCover } from "./thingView";
import { Glyph } from "./Room";
import { Droplet } from "../creature/goo";
import "../work/work.css";
import "./cowork.css";

const STORE = "sol.cowork.current";
const keptStage = (): Stage => { try { const s = JSON.parse(sessionStorage.getItem("sol.cowork.stage") ?? "null"); return s?.k ? s : { k: "dashboard" }; } catch { return { k: "dashboard" }; } };
const base = (p?: string) => (p ? p.replace(/\/+$/, "").split("/").pop() : "");
// the Team preset's buttons are Cowork's views: pressed here, each takes the whole stage
// the rail's dashboard button is the board, so it opens the repo page; the room is the sidebar's first row and ⌘B
const STAGE: Record<string, "repo" | "actions" | "chat" | "shared"> = { dashboard: "repo", "action-board": "actions", "group-chat": "chat", shared: "shared" };
// the bar's last word: where I am in the room
const WHERE: Record<string, string> = { thing: "a thing", dashboard: "the room", repo: "the repo", actions: "action board", shared: "shared with me", chat: "talk", member: "a person", goal: "goal" };

// the thing beside each session (S4), kept on this Mac by session id: the engine starts a session with it, and the
// face brings it back beside the session when it is opened again from the side
const BESIDE = "sol.cowork.beside";
const besideOf = (id?: string | null): string | undefined => { if (!id) return undefined; try { return JSON.parse(localStorage.getItem(BESIDE) ?? "{}")[id]; } catch { return undefined; } };
const keepBeside = (id: string, thing?: string) => {
  try {
    const m: Record<string, string> = JSON.parse(localStorage.getItem(BESIDE) ?? "{}");
    delete m[id];   // set again, it is the newest
    if (thing) m[id] = thing;
    const keys = Object.keys(m); for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete m[k];   // the newest 200
    localStorage.setItem(BESIDE, JSON.stringify(m));
  } catch { /* private */ }
};

export function CoworkApp({ e, onMode }: { e: ReturnType<typeof useEngine>; onMode: (m: AppMode) => void }) {
  const raw = useWork(e, undefined, STORE);
  const team = useTeam();
  const room = useRoom(team);
  const [pinned, setPinned] = useState(() => localStorage.getItem("sol.cowork.pin") !== "0");
  const toggleSide = () => setPinned((s) => { localStorage.setItem("sol.cowork.pin", s ? "0" : "1"); return !s; });
  const [stage, setStageS] = useState<Stage>(keptStage);
  const setStage = (s: Stage) => { setStageS(s); try { sessionStorage.setItem("sol.cowork.stage", JSON.stringify(s)); } catch { /* private */ } };
  const [issue, setIssue] = useState<Card | null>(null);   // a new session about a card (its #N names the session)
  const [file, setFile] = useState<string | null>(null);   // the actions README, in the pane at the right
  const [draft, setDraft] = useState<Draft>({ text: "", atts: [] });
  const box = useRef<HTMLTextAreaElement>(null);
  const starting = useRef(false);   // a room session's first line is on its way (#236)
  const folders = team.board?.folders ?? {};
  const repo = stage.k === "session" ? stage.repo : team.board?.repos[0] ?? "";
  const folder = folders[repo];

  // the session view's Work: the same hook, its own memory (sol.cowork.current); a first message goes through
  // team.session.start (the engine makes it in the repo's folder and marks it cowork), then it opens here
  const w: Work = useMemo(() => ({
    ...raw,
    freshCwd: folder ?? "",
    copy: false,
    setCopy: () => {},
    projects: Object.entries(folders).map(([r, path]) => ({ path, name: r.split("/")[1] ?? r, count: 1 })),
    fresh: (cwd?: string) => {
      const r = cwd ? Object.keys(folders).find((k) => folders[k] === cwd) : undefined;
      if (r) setStage({ k: "session", repo: r });
      raw.fresh();
    },
    say: (text: string, files = []) => {
      if (raw.live) return raw.say(text, files);
      if (!text.trim() && !files.length) return false;
      // "work on this" (#236): a new session of the room, the thing beside it; it starts as the box's line does
      if (stage.k === "session" && !stage.repo) {
        if (starting.current) return false;   // one press, one session: a second Enter while it starts does nothing
        starting.current = true;
        void startFromBox(text, room.things.find((t) => t.id === stage.thing)).then((ok) => { if (!ok) setDraft({ text, atts: [] }); })
          .finally(() => { starting.current = false; });
        return true;
      }
      if (!folder) { e.flash("no folder on this machine holds that repository"); return false; }
      void team.ask<{ sessionId?: string; error?: string }>("team.session.start", { repo, issue: issue?.number, text, files }, 30_000).then((r) => {
        if (r.sessionId) { setIssue(null); raw.open(r.sessionId); } else { e.flash(r.error ?? "the session did not start"); setDraft({ text, atts: [] }); }
      });
      return true;
    },
  }), [raw, folder, repo, issue, JSON.stringify(folders), stage, room.things]); // eslint-disable-line react-hooks/exhaustive-deps

  const newSession = (r: string, c?: Card, text?: string) => {
    setIssue(c ?? null);
    setStage({ k: "session", repo: r });
    raw.fresh();
    setDraft({ text: text ?? (c ? `#${c.number} ${c.title}\n\n` : ""), atts: [] });
    requestAnimationFrame(() => box.current?.focus());
  };

  // a talk opened from here opens in Home: kept where Home reads it as it mounts (ActionBoard.tsx, openInHome)
  const toHome = (to: ToTalk) => {
    if ("session" in to) {
      localStorage.setItem("sol.home.open", JSON.stringify({ kind: "session", id: to.session }));
      onMode("home");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("sol:open-work", { detail: to.session })), 60);
      return;
    }
    // a repo with no folder mapped here leaves no folder behind: an old one would open the session in the wrong place
    if (to.cwd) localStorage.setItem("sol.work.cwd", JSON.stringify(to.cwd)); else localStorage.removeItem("sol.work.cwd");
    sessionStorage.setItem("sol.work.draft", JSON.stringify(to.text));
    localStorage.setItem("sol.home.open", JSON.stringify({ kind: "session", id: null }));
    onMode("home");
  };

  // a ping that reached me (#100: a decision, a chat line naming me, or any kind my dial brings): one card each under
  // the bar until closed; never a gate

  // the side docks while the window has room for it beside the stage and the README pane (fit.ts); narrower, it floats
  const vw = useWidth();
  const lay = fitRow(vw, 272, pinned, [0.42 * vw], [!!(file && folder)], PANE_FLOOR);
  const main = useDock(272, lay.docked);

  const h = useRef({ toggleSide, setStage, stage });
  h.current = { toggleSide, setStage, stage };
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (ev.metaKey && !ev.shiftKey && !ev.ctrlKey && ev.key.toLowerCase() === "b") { ev.preventDefault(); h.current.setStage({ k: "dashboard" }); }
      else if (ev.metaKey && !ev.shiftKey && ev.key === "\\") { ev.preventDefault(); h.current.toggleSide(); }
      else if (ev.key === "Escape" && h.current.stage.k !== "dashboard" && h.current.stage.k !== "session") { ev.preventDefault(); h.current.setStage({ k: "dashboard" }); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useCreatureDriver({ seat: "claude" });
  useEffect(() => { if (e.up && stage.k === "session") raw.view(raw.live); }, [stage.k, raw.live, e.up]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => raw.view(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  // the talk follows its end, as in Work
  const talk = useRef<HTMLDivElement>(null);
  const [, setFlw] = useState<Follow | null>(null);
  const items = stage.k === "session" ? raw.thread?.items ?? [] : [];
  const busy = !!raw.run?.busy;
  const has = items.length > 0;
  useEffect(() => {
    const t = talk.current, inner = t?.querySelector(".talk-inner") as HTMLElement | null;
    if (!t || !inner) { setFlw(null); return; }
    const f = follow(t, inner); f.jump(); setFlw(f);
    return () => { f.destroy(); setFlw(null); };
  }, [stage.k, has, raw.current]);

  const page = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => { if (!first.current && page.current) enter(page.current, { y: 14, cfg: CFG.panel }); first.current = false; }, [stageKey(stage), raw.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // the box (#234): a line to my own agent opens a session under this room, the thing it names beside it (step 6 draws
  // the thing; until then the session opens alone). Nothing else is asked first
  const startFromBox = async (text: string, thing?: Thing) => {
    const r = await team.ask<{ sessionId?: string; repo?: string; error?: string }>("team.session.start", { text, ...(thing ? { thing: thing.id } : {}) }, 30_000);
    if (!r.sessionId) { e.flash(r.error ?? "the session did not start"); return false; }
    if (thing) keepBeside(r.sessionId, thing.id);
    setIssue(null); setStage({ k: "session", repo: r.repo ?? "", ...(thing ? { thing: thing.id } : {}) }); raw.open(r.sessionId);
    return true;
  };
  // S2's "work on this" (#236): a new session of the room with the thing beside it; its first line starts it
  const workOn = (t: Thing) => {
    setIssue(null); setStage({ k: "session", repo: "", thing: t.id }); raw.fresh(); setDraft({ text: "", atts: [] });
    requestAnimationFrame(() => box.current?.focus());
  };
  // S4: the thing beside this session, put there or taken away (a session opened from the side brings its own back)
  const beside = stage.k === "session" ? room.things.find((t) => t.id === (stage.thing ?? besideOf(raw.live))) : undefined;
  const putBeside = (id?: string) => {
    if (stage.k !== "session") return;
    if (raw.live) keepBeside(raw.live, id);
    setStage({ k: "session", repo: stage.repo, ...(id ? { thing: id } : {}) });
  };
  const [picking, setPicking] = useState(false);
  const openable = room.things.filter((t) => t.kind !== "github");
  // a hand from for you: take (it starts the session the hand carries, as Take always has, so the button says so) or pass
  const answerHand = async (id: string, how: "take" | "pass", start = true) => {
    const r = await team.ask<{ ok?: boolean; error?: string; note?: string; sessionId?: string }>("team.hand.answer", { id, how, start }, 60_000);
    if (r.note) e.flash(r.note);
    if (r.error) e.flash(r.error); else void room.read();
    if (r.sessionId) { setStage({ k: "session", repo: "" }); raw.open(r.sessionId); }
  };
  const roomNow = team.state?.settings.rooms.find((r) => r.id === team.state?.settings.room);
  const [fyOpen, setFyOpen] = useState(false);
  const handNow = useHands().current;   // only to count the bar card's faces; HandLine reads its own
  // focus goes into for you once, when it opens (a ref callback would take it back on every render)
  const fyPop = useRef<HTMLDivElement>(null);
  useCover(fyOpen || picking);   // drawn over the pane: the thing's page steps aside while it is open (#236)
  useEffect(() => { if (fyOpen) fyPop.current?.querySelector<HTMLElement>("button")?.focus(); }, [fyOpen]);
  // a ping that just reached me is in for you at once, not at the next minute's read
  useEffect(() => { if (team.pings.length) void room.read(); }, [team.pings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onBar = (ev: React.MouseEvent) => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest("button")) return;
    const win = getCurrentWindow();
    if (ev.detail === 2) void win.toggleMaximize().catch(() => {}); else void win.startDragging().catch(() => {});
  };
  const live = stage.k === "session" ? raw.sessions.find((s) => s.id === raw.live) : undefined;
  // the page names itself in its own head; the bar says where you are, and a session's own title
  const title = stage.k !== "session" ? `cowork${roomNow?.name ? ` · ${roomNow.name}` : ""}`
    : live?.title ?? (raw.live ? raw.thread?.title ?? "" : issue ? `#${issue.number} ${issue.title}` : "new session");
  const cwd = stage.k === "session" ? raw.thread?.cwd ?? live?.cwd ?? folder : undefined;
  // with more than one room (#154) the bar names the one you are in before its repos
  const readme = file && folder ? file : null;
  // the rail: the same buttons Home can hold, drawn from the cowork rail of the arrangement, with this team in hand
  const ctx: ButtonCtx = { mode: "cowork", e, w: raw, team, talk: toHome, open: (id) => STAGE[id] && setStage({ k: STAGE[id] }), flash: e.flash,
    armed: false, setArmed: () => {}, mark: () => {} };

  return (
    <MeCtx.Provider value={team.me}>
    <div className="face wface cface">
      <Space empty={stage.k !== "session" || items.length === 0} />
      <div className="bar" data-tauri-drag-region onMouseDown={onBar}>
        <button className={`barbtn ${pinned ? "on" : ""}`} onClick={toggleSide} aria-pressed={pinned} title={pinned ? "unpin the side (cmd+\\)" : "pin the side (cmd+\\)"}>
          <BarCells kind="side" on={pinned} />
        </button>
        <div className="wtitle" data-tauri-drag-region>
          <span className="tt">{title || "untitled"}</span>
          {cwd && <span className="where" title={cwd}>{base(cwd)}{raw.thread?.branch ? ` · ${raw.thread.branch}` : ""}</span>}
          {stage.k !== "session" && <span className="where">{stage.k === "thing" ? room.things.find((t) => t.id === stage.id)?.name ?? WHERE.thing : stage.k === "member" ? stage.login : stage.k === "tool" ? ({ calendar: "the calendar", decisions: "decisions", polls: "polls" } as const)[stage.id] : WHERE[stage.k] ?? ""}</span>}
        </div>
        <div className="spacer" data-tauri-drag-region />
        {(stage.k === "repo" || stage.k === "actions") && <button className="wbtn ghost" onClick={() => void team.refresh()} title="read the board again">read again</button>}
        {/* for you (§3, §9.4): the hands to me and the pings that reached me, one list */}
        <div className="rm-fy">
          <button className={`rm-fy-pill ${room.foryou.length ? "on" : ""}`} onClick={() => setFyOpen((o) => !o)} aria-expanded={fyOpen}
            title="what waits on you in this room: a hand to you, a decision, a line naming you, a clash or a claim">
            {room.foryou.length ? <Droplet kind="needs" size={13} seed="foryou" /> : <span className="cnobody" aria-hidden="true" />}for you {room.foryou.length}
          </button>
          {fyOpen && (
            <div className="rm-fy-pop" role="dialog" aria-label="for you" ref={fyPop}
              onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); setFyOpen(false); } }}
              onBlur={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node | null) && !(ev.relatedTarget as HTMLElement | null)?.closest?.(".rm-fy")) setFyOpen(false); }}>
              {room.foryou.length === 0 && <p className="none">nothing waits on you here</p>}
              {room.foryou.map((f) => (
                <div key={f.id} className="fy">
                  <span className="k">{f.kind === "hand" ? "handed to you" : f.kind}</span>
                  <span>{f.line}</span>
                  {f.kind === "hand" && <span className="acts">
                    <button className="wbtn" title="take it, and a session starts on it here with the brief it came with" onClick={() => { setFyOpen(false); void answerHand(f.id, "take", true); }}>take · start a session</button>
                    <button className="wbtn ghost" title="take it, and start nothing: no agent runs until you open it" onClick={() => { setFyOpen(false); void answerHand(f.id, "take", false); }}>just take it</button>
                    <button className="wbtn ghost" onClick={() => { setFyOpen(false); void answerHand(f.id, "pass"); }}>pass</button>
                    <button className="wbtn ghost" onClick={() => setFyOpen(false)}>later</button>
                  </span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <span className="rm-who" title="who you are in this room, and which machine this Sol runs on">{team.me || "not signed in"} · this Mac</span>
        <Rail c={ctx} on={Object.keys(STAGE).find((id) => STAGE[id] === stage.k) ?? null} onPane={ctx.open} />
      </div>
      <div className="shell">
        <CoworkSidebar team={team} w={raw} pinned={lay.docked} stage={stage} onMode={onMode} onStage={(s) => { if (s.k === "session") setIssue(null); setStage(s); }}
          onFresh={(r) => newSession(r)} />
        <div ref={main} className="main">
          {/* what waits on me hangs from the bar as one black card (BarCard), one face at a time: a hand to me, a friend who
              wants in, and, off the room's page (where a ping is in for you, the bar's pill), a ping as before */}
          <BarCard faces={[
            /* --- Hand (#34): a hand to me, Take · Pass · Later; Take opens the session it started here */
            { key: "hand", on: !!handNow, node: <HandLine onTaken={(id, r) => { setIssue(null); setStage({ k: "session", repo: r }); raw.open(id); }} /> },
            /* --- end Hand */
            /* a friend who typed a room's code waits for my one press before Sol adds them to its repository */
            ...team.waiting.map((a) => ({ key: `in ${a.room} ${a.login}`, on: true, node: (
              <div className="gline" role="status">
                <span className="from">wants in</span>
                <span className="t"><b>{a.login} wants into {a.name}</b><small>{a.repos.join(" · ")}</small></span>
                <button className="wbtn" onClick={() => void team.letIn(a, true).then((r) => r.error && e.flash(r.error))}>let in</button>
                <button className="wbtn ghost" onClick={() => void team.letIn(a, false).then((r) => r.error && e.flash(r.error))}>not now</button>
              </div>
            ) })),
            ...(stage.k !== "dashboard" && stage.k !== "thing" && stage.k !== "member" && stage.k !== "goal" && stage.k !== "tool" ? team.pings : []).map((p) => ({ key: `ping ${p.id}`, on: true, node: (
              <div className="gline" role="status">
                <span className="from">{PING_WORD[p.kind] ?? "asked"}{p.issue ? ` #${p.issue}` : ""}</span>
                <span className="t"><b>{p.line}</b><small><Sig s={p.from} /></small></span>
                <button className="gx" onClick={() => team.closePing(p.id)} aria-label="close">×</button>
              </div>
            ) })),
          ]} />
          <div ref={page} className="page-in cstage" data-view={stage.k}>
            {(stage.k === "dashboard" || stage.k === "thing" || stage.k === "member" || stage.k === "goal" || stage.k === "tool") && <Room team={team} room={room} flash={e.flash}
              onPerson={(login) => setStage({ k: "member", login })} onGoal={() => setStage({ k: "goal" })} onThing={(t) => setStage({ k: "thing", id: t.id })}
              onRepo={() => setStage({ k: "repo" })} onStart={startFromBox}
              open={stage.k === "thing" ? room.things.find((t) => t.id === stage.id) ?? null : null}
              person={stage.k === "member" ? stage.login : null} goal={stage.k === "goal"} tool={stage.k === "tool" ? stage.id : null} onTool={(id) => setStage({ k: "tool", id })} onBack={() => setStage({ k: "dashboard" })} onHand={() => setStage({ k: "repo" })}
              onClose={() => setStage({ k: "dashboard" })} onShrink={() => setStage({ k: "dashboard" })} onWork={workOn} />}
            {/* the repo page (§7): the board as it was, one click from the repo's tile */}
            {stage.k === "repo" && <Dashboard team={team} />}
            {stage.k === "actions" && <ActionBoard team={team} onOpenWork={(c) => openInHome(c, raw, folders, toHome)} onNewAction={() => setFile(`${folder ?? ""}/${ACTIONS_HOWTO}`)} />}
            {/* --- Share (#36) */}
            {stage.k === "shared" && <Shared team={team} />}
            {/* --- end Share */}
            {/* --- Talk (#37) */}
            {stage.k === "chat" && <Talk team={team} flash={e.flash} />}
            {/* --- end Talk */}
            {stage.k === "session" && (<div className={`rm-s4 ${beside ? "with" : ""}`}><div className="rm-s4-talk">
              {!beside && openable.length > 0 && (
                <div className="rm-s4-open">
                  <button className="rm-th-link" onClick={() => setPicking((p) => !p)} aria-expanded={picking} title="put one of the room's things beside this session">open a thing beside it ▾</button>
                  {picking && (
                    <div className="rm-s4-pick" role="menu" aria-label="the room's things" onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); setPicking(false); } }}>
                      {openable.map((t, i) => <button key={t.id} role="menuitem" autoFocus={i === 0} onClick={() => { setPicking(false); putBeside(t.id); }}><Glyph kind={t.kind} size={16} />{t.name}</button>)}
                    </div>
                  )}
                </div>
              )}
              <div className="talk-wrap">
                <div className="talk" ref={talk}>
                  {items.length > 0 ? (
                    <div className="talk-inner"><WorkTalk items={items} busy={busy} w={w} view="normal" onFresh={(text) => newSession(repo, undefined, text)} onLink={() => {}} onBox={(t) => setDraft((d) => ({ ...d, text: d.text ? `${d.text}\n\n${t}` : t }))} /></div>
                  ) : (
                    <div className="empty wempty">
                      <Mark size={56} live />
                      <p className="wwhere">{stage.k === "session" && !stage.repo ? <>a session of {roomNow?.name ?? "this room"}{beside ? <>, <b>{beside.name}</b> beside it</> : ""}: your first line starts it</> : folder ? <>a session in <b title={folder}>{base(folder)}</b>, shared on the board as yours</> : "no folder on this machine holds this repository"}</p>
                    </div>
                  )}
                </div>
              </div>
              <Composer w={w} e={e} busy={busy} working={isWorking(raw.run)} cwd={cwd} asideOn={false} setAsideOn={() => {}} box={box} onSent={() => {}} onRec={() => {}} d={draft} setD={setDraft} cowork />
              </div>
              {beside && <ThingPane key={beside.id} team={team} thing={beside} mode="s4" onPutAway={() => putBeside(undefined)}
                me={{ working: busy }}
                others={(team.state?.roster ?? []).filter((m) => m.who !== team.me && m.thing?.id === beside.id).map((m) => ({ who: m.who, working: m.state === "working" }))} />}
            </div>)}
          </div>
        </div>
        <PaneFrame open={!!readme} frac={0.42} w={lay.widths[0]} max={lay.max(0)} onFrac={() => {}} tabs={readme ? [button("files")!] : []} active={readme ? "files" : null} onPick={() => {}} onClose={() => setFile(null)}>
          {readme && <PaneBody k="files"><FilePane w={raw} cwd={folder} at={{ path: readme, n: 1 }} onAttach={() => {}} flash={e.flash} /></PaneBody>}
        </PaneFrame>
        {/* --- Try (#35): a teammate's PR as a second Sol, and the review of it, in a pane at the right */}
        <TryFrame team={team} />
        {/* --- end Try */}
        {/* --- Share (#36) */}
        {stage.k === "shared" && <SharedPane e={e} w={raw} folders={folders} />}
        {/* --- end Share */}
      </div>
    </div>
    </MeCtx.Provider>
  );
}
