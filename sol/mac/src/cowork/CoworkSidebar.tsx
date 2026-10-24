// Cowork's side (Together, See #31): the team (a presence dot per person, click for their page), then the team's
// functions, then the team's repositories as folders holding only the shared things on them: the issue wearing `now`,
// the sessions started here (each one mine, signed by my agent), and later a session handed to me and a PR I try.
import { useState } from "react";
import { Mark } from "../Mark";
import type { AppMode } from "../ModeSwitch";
import { ModeWheel } from "../ModeWheel";
import { useSideFloat } from "../sideFloat";
import { Fold, Pill, Turn } from "../MotionKit";
import { Runner } from "../creature/indicators";
import { working, type Work, type WorkSession } from "../work/useWork";
import type { Team } from "./useTeam";
import { DEV_TEAM } from "./useTeam";
import { PersonDot, STATE_WORD, Sig } from "./bits";
// --- Hand (#34)
import { Menu, type MenuItem } from "../work/Menu";
import { HandedRows, sessionItems, useHandedCount } from "./Hands";
// --- end Hand
// --- Try (#35)
import { TryingRow } from "./TryPane";
// --- end Try

export type Stage = { k: "dashboard" } | { k: "actions" } | { k: "shared" } | { k: "chat" } | { k: "member"; login: string } | { k: "session"; repo: string };
export const stageKey = (s: Stage) => (s.k === "member" ? `member:${s.login}` : s.k === "session" ? `session:${s.repo}` : s.k);

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Plus = () => <svg viewBox="0 0 16 16" width="14" height="14" {...P} aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>;
const Caret = () => <svg className="caret" viewBox="0 0 6 6" width="6" height="6" shapeRendering="crispEdges" aria-hidden="true"><path d="M1 0h2v1h1v1h1v2h-1v1h-1v1h-2z" fill="currentColor" /></svg>;

const FUNCS: { k: "dashboard" | "actions" | "shared" | "chat"; name: string; key?: string; later?: string }[] = [
  { k: "dashboard", name: "dashboard", key: "⌘B" },
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
  const f = useSideFloat(pinned, false, 272);
  const [folded, setFolded] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("sol.cowork.folded") ?? "{}"); } catch { return {}; } });
  const fold = (k: string) => setFolded((x) => { const n = { ...x, [k]: !x[k] }; localStorage.setItem("sol.cowork.folded", JSON.stringify(n)); return n; });
  const s = team.state, b = team.board, me = team.me;
  const up = !!s?.relay.up;
  // the team: me, who is on now, and every member (#102: an org member shows with no hand-off, dark until seen)
  const people = [...new Set([me, ...(s?.roster ?? []).map((m) => m.who), ...(s?.members ?? [])].filter(Boolean))];
  const repos = b?.repos ?? s?.settings.repos ?? [];
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
        <div className="brand"><Mark size={22} /><span className="word">sol</span></div>
        <ModeWheel mode="cowork" onPick={onMode} />
      </div>
      <div className="side-list">
        <Pill selector=".row.on" mode="on" watch={`${at}|${JSON.stringify(folded)}|${people.length}|${w.live}`} className="on" />
        <Pill selector=".row" mode="hover" className="hov" />
        <Sec k="team" label="the team" n={people.length}>
          {people.map((who) => {
            const m = s?.roster.find((r) => r.who === who);
            return (
              <div key={who} className={`row crow ${at === `member:${who}` ? "on" : ""}`} data-s onClick={() => onStage({ k: "member", login: who })}>
                <PersonDot login={who} roster={s?.roster ?? []} up={up} me={me} />
                <span className="t">{who}{who === me && <small className="cdim"> (you)</small>}</span>
                {/* Show (#101): someone showing a session says so here; their page opens the watch */}
                {(() => { const sh = team.showing.find((x) => x.login === who); return sh
                  ? <small className="cwhat cshowing" title={`${who} is showing #${sh.issue} ${sh.session.title}: open their page to watch`}>showing #{sh.issue}</small>
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
          const extra = DEV_TEAM ? DEV_SHARED : [];
          const handed = handedIn(repo);   // Hand (#34)
          return (
            <Sec key={repo} k={`repo:${repo}`} label={name} n={now.length + mine.length + extra.length + handed} here={dir ? () => onFresh(repo) : undefined}>
              {now.map((c) => (
                <div key={c.number} className="row crow" data-s onClick={() => onStage({ k: "actions" })} title={`the issue wearing now: #${c.number} ${c.title}`}>
                  <span className="cnow">now</span><span className="t"><span className="cnum">#{c.number}</span> {c.title}</span>
                  <Sig s={c.sign ?? (c.assignees[0] ? { login: c.assignees[0], agent: false } : undefined)} />
                </div>
              ))}
              {mine.map((x) => {
                const run = w.runs[x.id];
                return (
                  <div key={x.id} className={`row crow ${w.live === x.id && stage.k === "session" ? "on" : ""}`} data-s onClick={() => { w.open(x.id); onStage({ k: "session", repo }); }} title={x.title}
                    onContextMenu={(ev) => handSession(ev, repo, x)}>
                    {working(run) ? <span className="cdot run"><Runner /></span> : <span className={`cdot ${run?.waiting ? "yourcall" : "here"}`}><i /></span>}
                    <span className="t">{x.title || "untitled"}</span>
                    <Sig s={{ login: me, agent: true }} />
                  </div>
                );
              })}
              {/* --- Hand (#34): handed to you, here */}
              <HandedRows repo={repo} />
              {/* --- end Hand */}
              {/* --- Try (#35): the PR I am trying, under its repo */}
              <TryingRow team={team} repo={repo} />
              {/* --- end Try */}
              {extra.map((x) => (
                <div key={x.title} className="row crow later" data-s title={x.what}>
                  <span className="cdot here"><i /></span><span className="t">{x.title}</span><Sig s={x.sign} />
                </div>
              ))}
              {!now.length && !mine.length && !extra.length && !handed && <p className="none">nothing shared here yet</p>}
            </Sec>
          );
        })}
        {!repos.length && <p className="none">no repositories yet</p>}
      </div>
      {handMenu && <Menu x={handMenu.x} y={handMenu.y} items={handMenu.items} onClose={() => setHandMenu(null)} />}{/* Hand (#34) */}
    </aside>
  );
}

// ?dev=team: what Hand and Try will put under a repo, so the shot shows the shape
const DEV_SHARED = [
  { title: "#34 the hands record", what: "a session handed to me (Hand)", sign: { login: "frank", agent: false } },
  { title: "#41 trying frank's branch", what: "a PR I am trying (Try)", sign: { login: "frank", agent: true } },
];
