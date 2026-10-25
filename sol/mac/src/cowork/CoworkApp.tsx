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
import { ActionBoard, ACTIONS_HOWTO, openInHome } from "./ActionBoard";
import { Member } from "./Member";
import { Sig } from "./bits";
import { Talk } from "./Talk";   // Talk (#37)
// --- Hand (#34)
import { HandLine } from "./Hands";
// --- end Hand
// --- Try (#35)
import { TryFrame } from "./TryPane";
// --- end Try
import { Shared, SharedPane } from "./Shared";
import "../work/work.css";
import "./cowork.css";

const STORE = "sol.cowork.current";
const keptStage = (): Stage => { try { const s = JSON.parse(sessionStorage.getItem("sol.cowork.stage") ?? "null"); return s?.k ? s : { k: "dashboard" }; } catch { return { k: "dashboard" }; } };
const base = (p?: string) => (p ? p.replace(/\/+$/, "").split("/").pop() : "");
// the Team preset's buttons are Cowork's views: pressed here, each takes the whole stage
const STAGE: Record<string, "dashboard" | "actions" | "chat" | "shared"> = { dashboard: "dashboard", "action-board": "actions", "group-chat": "chat", shared: "shared" };

export function CoworkApp({ e, onMode }: { e: ReturnType<typeof useEngine>; onMode: (m: AppMode) => void }) {
  const raw = useWork(e, undefined, STORE);
  const team = useTeam();
  const [pinned, setPinned] = useState(() => localStorage.getItem("sol.cowork.pin") !== "0");
  const toggleSide = () => setPinned((s) => { localStorage.setItem("sol.cowork.pin", s ? "0" : "1"); return !s; });
  const [stage, setStageS] = useState<Stage>(keptStage);
  const setStage = (s: Stage) => { setStageS(s); try { sessionStorage.setItem("sol.cowork.stage", JSON.stringify(s)); } catch { /* private */ } };
  const [issue, setIssue] = useState<Card | null>(null);   // a new session about a card (its #N names the session)
  const [file, setFile] = useState<string | null>(null);   // the actions README, in the pane at the right
  const [draft, setDraft] = useState<Draft>({ text: "", atts: [] });
  const box = useRef<HTMLTextAreaElement>(null);
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
      if (!folder) { e.flash("no folder on this machine holds that repository"); return false; }
      void team.ask<{ sessionId?: string; error?: string }>("team.session.start", { repo, issue: issue?.number, text, files }, 30_000).then((r) => {
        if (r.sessionId) { setIssue(null); raw.open(r.sessionId); } else { e.flash(r.error ?? "the session did not start"); setDraft({ text, atts: [] }); }
      });
      return true;
    },
  }), [raw, folder, repo, issue, JSON.stringify(folders)]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const onBar = (ev: React.MouseEvent) => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest("button")) return;
    const win = getCurrentWindow();
    if (ev.detail === 2) void win.toggleMaximize().catch(() => {}); else void win.startDragging().catch(() => {});
  };
  const live = stage.k === "session" ? raw.sessions.find((s) => s.id === raw.live) : undefined;
  // the page names itself in its own head; the bar says where you are, and a session's own title
  const title = stage.k !== "session" ? "cowork"
    : live?.title ?? (raw.live ? raw.thread?.title ?? "" : issue ? `#${issue.number} ${issue.title}` : "new session");
  const cwd = stage.k === "session" ? raw.thread?.cwd ?? live?.cwd ?? folder : undefined;
  // with more than one room (#154) the bar names the one you are in before its repos
  const rooms = team.state?.settings.rooms ?? [];
  const roomName = rooms.length > 1 ? rooms.find((r) => r.id === team.state?.settings.room)?.name ?? "" : "";
  const readme = file && folder ? file : null;
  // the rail: the same buttons Home can hold, drawn from the cowork rail of the arrangement, with this team in hand
  const ctx: ButtonCtx = { mode: "cowork", e, w: raw, team, talk: toHome, open: (id) => STAGE[id] && setStage({ k: STAGE[id] }), flash: e.flash,
    armed: false, setArmed: () => {}, mark: () => {} };

  return (
    <div className="face wface cface">
      <Space empty={stage.k !== "session" || items.length === 0} />
      <div className="bar" data-tauri-drag-region onMouseDown={onBar}>
        <button className={`barbtn ${pinned ? "on" : ""}`} onClick={toggleSide} aria-pressed={pinned} title={pinned ? "unpin the side (cmd+\\)" : "pin the side (cmd+\\)"}>
          <BarCells kind="side" on={pinned} />
        </button>
        <div className="wtitle" data-tauri-drag-region>
          <span className="tt">{title || "untitled"}</span>
          {cwd && <span className="where" title={cwd}>{base(cwd)}{raw.thread?.branch ? ` · ${raw.thread.branch}` : ""}</span>}
          {stage.k !== "session" && <span className="where">{[...(roomName ? [roomName] : []), ...(team.board?.repos ?? []).map((r) => r.split("/")[1])].join(" · ")}</span>}
        </div>
        <div className="spacer" data-tauri-drag-region />
        {(stage.k === "dashboard" || stage.k === "actions") && <button className="cbtn ghost" onClick={() => void team.refresh()} title="read the board again">read again</button>}
        <Rail c={ctx} on={Object.keys(STAGE).find((id) => STAGE[id] === stage.k) ?? null} onPane={ctx.open} />
      </div>
      <div className="shell">
        <CoworkSidebar team={team} w={raw} pinned={lay.docked} stage={stage} onMode={onMode} onStage={(s) => { if (s.k === "session") setIssue(null); setStage(s); }}
          onFresh={(r) => newSession(r)} />
        <div ref={main} className="main">
          {team.pings.map((p) => (
            <div key={p.id} className="wcarry cping" role="status">
              <span className="from">{PING_WORD[p.kind] ?? "asked"}{p.issue ? ` #${p.issue}` : ""}</span>
              <span className="t"><b>{p.line}</b><small><Sig s={p.from} /></small></span>
              <button className="wlink" onClick={() => team.closePing(p.id)} aria-label="close">×</button>
            </div>
          ))}
          {/* a friend who typed a room's code waits for my one press before Sol adds them to its repository */}
          {team.waiting.map((a) => (
            <div key={`${a.room} ${a.login}`} className="wcarry cping" role="status">
              <span className="from">wants in</span>
              <span className="t"><b>{a.login} wants into {a.name}</b><small>{a.repos.join(" · ")}</small></span>
              <button className="cbtn" onClick={() => void team.letIn(a, true).then((r) => r.error && e.flash(r.error))}>let in</button>
              <button className="cbtn ghost" onClick={() => void team.letIn(a, false).then((r) => r.error && e.flash(r.error))}>not now</button>
            </div>
          ))}
          {/* --- Hand (#34): a hand to me, Take · Pass · Later; Take opens the session it started here */}
          <HandLine onTaken={(id, r) => { setIssue(null); setStage({ k: "session", repo: r }); raw.open(id); }} />
          {/* --- end Hand */}
          <div ref={page} className="page-in cstage" data-view={stage.k}>
            {stage.k === "dashboard" && <Dashboard team={team} />}
            {stage.k === "actions" && <ActionBoard team={team} onOpenWork={(c) => openInHome(c, raw, folders, toHome)} onNewAction={() => setFile(`${folder ?? ""}/${ACTIONS_HOWTO}`)} />}
            {stage.k === "member" && <Member key={stage.login} team={team} login={stage.login} />}
            {/* --- Share (#36) */}
            {stage.k === "shared" && <Shared team={team} />}
            {/* --- end Share */}
            {/* --- Talk (#37) */}
            {stage.k === "chat" && <Talk team={team} flash={e.flash} />}
            {/* --- end Talk */}
            {stage.k === "session" && (<>
              <div className="talk-wrap">
                <div className="talk" ref={talk}>
                  {items.length > 0 ? (
                    <div className="talk-inner"><WorkTalk items={items} busy={busy} w={w} view="normal" onFresh={(text) => newSession(repo, undefined, text)} onLink={() => {}} onBox={(t) => setDraft((d) => ({ ...d, text: d.text ? `${d.text}\n\n${t}` : t }))} /></div>
                  ) : (
                    <div className="empty wempty">
                      <Mark size={56} live />
                      <p className="wwhere">{folder ? <>a session in <b title={folder}>{base(folder)}</b>, shared on the board as yours</> : "no folder on this machine holds this repository"}</p>
                    </div>
                  )}
                </div>
              </div>
              <Composer w={w} e={e} busy={busy} working={isWorking(raw.run)} cwd={cwd} asideOn={false} setAsideOn={() => {}} box={box} onSent={() => {}} onRec={() => {}} d={draft} setD={setDraft} cowork />
            </>)}
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
  );
}
