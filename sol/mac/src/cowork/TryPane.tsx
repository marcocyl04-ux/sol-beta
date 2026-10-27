// Try and review (Together, #35, PROTOCOL round 22): a teammate's PR run as a second Sol beside mine, and the review
// seat on it. The engine makes a side copy of the PR's branch, builds it and starts its engine on 7778 and its face on
// 1421 (own state, an empty home); this pane shows that face, the steps on the way, and Codex's remarks with "put in a
// comment". The card items (try it, ask for a review, mark ready, mark felt or silent (#100), comment) are `tryItems` (ActionBoard `// try`),
// the row under a repo is `TryingRow` (CoworkSidebar). One try at a time: a second asks to stop the first.
// `?dev=try` (vite dev only, with `?dev=team` for the board) fakes the steps, the face and three remarks; nothing is sent.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { link } from "../socket";
import { ENGINE } from "../useEngine";
import { CFG, enter } from "../motion";
import { Pill } from "../MotionKit";
import { CellCheck, Runner } from "../creature/indicators";
import { PaneFrame, PaneBody, Empty } from "../work/Panes";
import type { MenuItem } from "../work/Menu";
import type { Card, PR, Team } from "./useTeam";
import { Sig, StateMark, since } from "./bits";
import "./try.css";

export const DEV_TRY = import.meta.env.DEV && new URLSearchParams(location.search).getAll("dev").includes("try");

type Step = { step: string; done: boolean; ok?: boolean; line: string };
type Trying = { repo: string; pr: number; path: string; branch: string; head: string; title: string; author: string; since: number; up: boolean; engine: number; face: number };
type Item = { id: string; kind: string; round: string; head?: boolean; busy?: boolean; text: string; error?: string; count?: number; files?: number; file?: string; line?: number; state?: "open" | "sent" | "dismissed" };
type Said = { line: string; by?: string; ok: boolean; at: number };
type S = { trying: Trying | null; steps: Step[]; open: boolean; tab: "try" | "review"; review: { repo: string; pr: number; items: Item[]; asked?: boolean } | null; said: Said | null };

// ---- the store: one per window, fed by the engine's team.try.* messages ----
let s: S = { trying: null, steps: [], open: false, tab: "try", review: null, said: null };
const subs = new Set<() => void>();
const set = (p: Partial<S>) => { s = { ...s, ...p }; subs.forEach((f) => f()); };
const useTry = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => s);
let saidT = 0;
const say = (line: string, ok = true, by?: string) => { set({ said: { line, ok, by, at: Date.now() } }); clearTimeout(saidT); saidT = window.setTimeout(() => set({ said: null }), 6000); };

const upsert = (items: Item[], it: Item) => { const i = items.findIndex((x) => x.id === it.id); return i >= 0 ? items.map((x, j) => (j === i ? it : x)) : [...items, it]; };
function hear(m: any) {
  if (m?.type === "team.try.state") set({ trying: m.trying ?? null, steps: Array.isArray(m.steps) ? m.steps : [] });
  else if (m?.type === "team.try.step" && typeof m.step === "string") {
    const st: Step = { step: m.step, done: !!m.done, ok: m.ok, line: String(m.line ?? "") };
    const i = s.steps.findIndex((x) => x.step === st.step);
    set({ steps: i >= 0 ? s.steps.map((x, j) => (j === i ? st : x)) : [...s.steps, st] });
  } else if (m?.type === "team.try.review.item" && m.item?.id) {
    const r = s.review;
    if (r && r.repo === m.repo && r.pr === m.pr) set({ review: { ...r, items: upsert(r.items, m.item) } });
  }
}

// one question to the engine (the dev view answers itself)
const ask = (team: Team, type: string, body: object, wait?: number): Promise<any> => (DEV_TRY ? fake(type, body) : team.ask(type, body, wait));

async function tryIt(team: Team, pr: PR) {
  set({ open: true, tab: "try" });
  const r = await ask(team, "team.try", { repo: pr.repo, pr: pr.number }, 40 * 60_000);
  if (r.error) say(r.error, false);
}
async function stopIt(team: Team) {
  const was = s.trying;
  await ask(team, "team.try.stop", {});
  if (was) say(`stopped trying #${was.pr}; the copy stays`);
}
// the review kept for that PR (the engine keeps it like a session's), shown without asking again
async function loadReview(team: Team, repo: string, pr: number) {
  if (s.review?.repo === repo && s.review.pr === pr) return;
  set({ review: { repo, pr, items: [] } });
  const k = await ask(team, "team.try.reviews", { repo, pr });
  const r = s.review;
  if (Array.isArray(k.items) && r?.repo === repo && r.pr === pr) set({ review: { ...r, items: k.items.reduce(upsert, r.items) } });
}
async function reviewIt(team: Team, repo: string, pr: number) {
  set({ open: true, tab: "review" });
  await loadReview(team, repo, pr);
  if (s.review) set({ review: { ...s.review, asked: true } });
  const r = await ask(team, "team.try.review", { repo, pr });
  if (r.error) { say(r.error, false); if (s.review) set({ review: { ...s.review, asked: false } }); }
}
async function comment(team: Team, repo: string, pr: number, body: string, at?: Item) {
  const r = await ask(team, "team.pr.comment", { repo, pr, body, ...(at ? { path: at.file, line: at.line, remark: at.id } : {}) });
  if (r.error) say(r.error, false);
  else say(at ? `put on #${pr} at ${at.file?.split("/").pop()}:${at.line}${r.inline ? "" : ", as a comment naming the line"}` : `commented on #${pr}`, true, r.by);
}
async function flip(team: Team, repo: string, pr: number, mark: "felt" | "silent") {
  const r = await ask(team, "team.pr.mark", { repo, number: pr, mark });
  if (r.error) say(r.error, false); else { say(`#${pr} is ${mark} now`, true, r.by); void team.refresh(); }
}
async function ready(team: Team, repo: string, pr: number) {
  const r = await ask(team, "team.pr.ready", { repo, pr });
  if (r.error) say(r.error, false); else say(`#${pr} is ready for review`, true, r.by);
}

// ---- the card's items (ActionBoard `// try`) ----
export function tryItems(c: Card, team: Team): MenuItem[] {
  const pr = c.pr ? team.board?.prs.find((p) => p.repo === c.repo && p.number === c.pr) : undefined;
  if (!pr || pr.state !== "open") {
    const no = { disabled: true, note: !c.pr ? "no pull request yet" : `#${c.pr} is ${pr?.state ?? "closed"}` };
    return ["try it", "ask for a review", "mark ready", "mark felt", "comment"].map((label) => ({ label, ...no }));
  }
  const t = s.trying, me = team.me || "me";
  const here = t?.repo === pr.repo && t.pr === pr.number;
  return [
    here ? { label: "show the try", run: () => set({ open: true, tab: "try" }), note: `#${pr.number} runs beside mine` }
      : t ? { label: "try it", confirm: `stop trying #${t.pr} first?`, run: () => void stopIt(team).then(() => tryIt(team, pr)), note: `one at a time: #${t.pr} runs now` }
      : { label: "try it", run: () => void tryIt(team, pr), note: `${pr.head}, a second Sol beside mine` },
    { label: "ask for a review", run: () => void reviewIt(team, pr.repo, pr.number), note: "Codex reads the branch against main" },
    // felt or silent (#100): a felt PR is run here before it is ready (asked, never refused); a silent one is ready without a run
    !pr.draft ? { label: "mark ready", disabled: true, note: "already ready for review" }
      : pr.mark === "silent" ? { label: "mark ready", confirm: `#${pr.number} is silent: mark it ready without a run?`, run: () => void ready(team, pr.repo, pr.number), note: `silent, no try needed · signed ${me}` }
      : pr.mark === "felt" && !here ? { label: "mark ready", confirm: `#${pr.number} is felt and you have not tried it here; mark it ready anyway?`, run: () => void ready(team, pr.repo, pr.number), note: `felt: try it first · signed ${me}` }
      : { label: "mark ready", confirm: `mark #${pr.number} ready for review?`, run: () => void ready(team, pr.repo, pr.number), note: `signed ${me}` },
    pr.mark === "felt" ? { label: "mark silent", run: () => void flip(team, pr.repo, pr.number, "silent"), note: `nobody can notice it · signed ${me}` }
      : { label: "mark felt", run: () => void flip(team, pr.repo, pr.number, "felt"), note: `${pr.mark === "silent" ? "a person can notice it" : "it says neither yet"} · signed ${me}` },
    { label: "comment", ask: "comment", hint: `on #${pr.number}, signed ${me}`, run: (v) => { if (v) void comment(team, pr.repo, pr.number, v); }, note: `signed ${me}` },
  ];
}

// ---- the row under a repo (CoworkSidebar): the PR I am trying ----
export function TryingRow({ team, repo }: { team: Team; repo: string }) {
  const t = useTry().trying;
  if (!t || t.repo !== repo) return null;
  const pr = team.board?.prs.find((p) => p.repo === repo && p.number === t.pr);
  const who = t.author || pr?.author || "";
  return (
    <div className={`row crow ctrying ${s.open ? "on" : ""}`} data-s onClick={() => set({ open: true, tab: "try" })} title={`a PR I am trying: #${t.pr} ${t.title}`}>
      {t.up ? <StateMark kind="done" seed={`try${t.pr}`} /> : <StateMark kind="running" seed={`try${t.pr}`} />}
      <span className="t"><span className="cnum">#{t.pr}</span> trying {who ? `${who}'s branch` : t.head}</span>
      {who && <Sig s={{ login: who, agent: !!pr?.agent }} />}
    </div>
  );
}

// ---- the pane at the right, and the said capsule ----
const NAMES: Record<string, string> = { copy: "the copy", "engine npm ci": "its packages", "engine build": "its build", "face npm ci": "its face's packages", "face build": "its face's build", engine: "its Sol, on 7778", face: "its face, on 1421" };
const State = ({ st }: { st: Step }) => !st.done ? <span className="wst run"><Runner /></span> : st.ok === false ? <span className="wst failed"><StateMark kind="failed" /></span> : <span className="wst done"><CellCheck /></span>;

export function TryFrame({ team }: { team: Team }) {
  const v = useTry();
  useEffect(() => {
    if (DEV_TRY) return;
    const L = link(ENGINE);
    const off = L.on(hear);
    const offL = L.onLink((u) => { if (u) L.send({ type: "team.try.get" }); });
    return () => { off(); offL(); };
  }, []);
  const t = v.trying, r = v.review;
  const pr = t ? team.board?.prs.find((p) => p.repo === t.repo && p.number === t.pr) : undefined;
  const subject = t ?? (r ? { repo: r.repo, pr: r.pr, head: team.board?.prs.find((p) => p.repo === r.repo && p.number === r.pr)?.head ?? "" } : null);
  return (<>
    <PaneFrame open={v.open} frac={0.44} onFrac={() => {}} tabs={[]} active={null} onPick={() => {}} onClose={() => set({ open: false })}>
      <div className="tpane">
        <header className="thead">
          <div className="tline">
            {subject ? <>
              <b>{t ? "trying" : "reviewing"} #{subject.pr}</b>
              {subject.head && <span className="thd">({subject.head})</span>}
              {t && <span className="cdim">· a second Sol on {t.engine}</span>}
              {(t?.author || pr?.author) && <Sig s={{ login: t?.author || pr!.author, agent: !!pr?.agent }} />}
            </> : <b>nothing tried yet</b>}
            <span className="cgrow1" />
            {t && <button className="wbtn" onClick={() => void stopIt(team)} title="ends both programs and keeps the copy">stop trying</button>}
            <button className="tclose" onClick={() => set({ open: false })} aria-label="close the pane" title="close (the try keeps running)">×</button>
          </div>
          {/* the test note (#100): what to try and what to notice, as its PR says it, plain text */}
          {subject && (() => { const p = team.board?.prs.find((x) => x.repo === subject.repo && x.number === subject.pr); return p?.note || p?.mark ? (
            <div className="tnote">
              {p.mark && <span className={`cmark ${p.mark}`}>{p.mark}</span>}
              <p>{p.note ? <><b>what to try</b> {p.note}</> : <span className="cdim">the PR says nothing to try</span>}</p>
            </div>
          ) : null; })()}
          <div className="tabs ttabs">
            <Pill selector=".tab.on" mode="on" watch={v.tab} className="on" />
            {(["try", "review"] as const).map((k) => (
              <div key={k} className={`tab ${v.tab === k ? "on" : ""}`} onClick={() => { set({ tab: k }); if (k === "review" && t && !r) void loadReview(team, t.repo, t.pr); }}><span>{k === "try" ? "the try" : "the review"}</span></div>
            ))}
          </div>
        </header>
        {v.tab === "try" ? (
          <PaneBody k="try" className="tbody">
            {t?.up ? <Face url={DEV_TRY ? `${location.origin}/?dev=team` : `http://127.0.0.1:${t.face}/`} t={t} />
              : v.steps.length ? <Steps steps={v.steps} t={t} onAgain={pr ? () => void tryIt(team, pr) : undefined} />
              : <Empty>{t ? `reading #${t.pr}…` : "try a pull request from its card on the action board: its branch runs here as a second Sol, beside mine, with its own state and an empty home."}</Empty>}
          </PaneBody>
        ) : (
          <PaneBody k="review" className="tbody">
            {r ? <Review team={team} r={r} /> : <Empty>ask for a review from a pull request's card: Codex reads its branch against main, and each remark can go on GitHub as a comment, signed by my agent.</Empty>}
          </PaneBody>
        )}
      </div>
    </PaneFrame>
    <SaidCap said={v.said} />
  </>);
}

function Face({ url, t }: { url: string; t: Trying }) {
  return (
    <div className="tface">
      <div className="taddr"><StateMark kind="done" seed={`try${t.pr}`} /><span className="mono">{t.branch || t.head}</span><span className="cdim">· up {since(t.since)} · its own state, an empty home</span></div>
      <iframe src={url} title={`#${t.pr} running as a second Sol`} />
    </div>
  );
}

function Steps({ steps, t, onAgain }: { steps: Step[]; t: Trying | null; onAgain?: () => void }) {
  const ref = useRef<HTMLOListElement>(null);
  const n = useRef(0);
  useLayoutEffect(() => {
    const els = ref.current?.children;
    if (els && els.length > n.current) for (let i = n.current; i < els.length; i++) enter(els[i] as HTMLElement, { y: 8, cfg: CFG.slide });
    n.current = els?.length ?? 0;
  }, [steps.length]);
  const failed = steps.some((x) => x.ok === false);
  return (
    <div className="tsteps-wrap">
      <p className="tlead">{t ? <>making #{t.pr} {t.title ? <b>{t.title}</b> : null} into a second Sol beside mine</> : failed ? "the last try stopped" : "the last try"}</p>
      <ol ref={ref} className="tsteps">
        {steps.map((st) => (
          <li key={st.step} className={st.ok === false ? "bad" : st.done ? "ok" : "now"}>
            <State st={st} />
            <span className="tn">{NAMES[st.step] ?? st.step}</span>
            <span className="tl mono" title={st.line}>{st.line}</span>
          </li>
        ))}
      </ol>
      {!t && failed && onAgain && <button className="wbtn" onClick={onAgain}>try again</button>}
    </div>
  );
}

function Review({ team, r }: { team: Team; r: NonNullable<S["review"]> }) {
  const heads = r.items.filter((i) => i.head);
  const head = heads[heads.length - 1];
  const remarks = head ? r.items.filter((i) => !i.head && i.round === head.round && i.state !== "dismissed") : [];
  const me = team.me || "me";
  const ref = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => { const els = ref.current?.children; if (els) Array.from(els).forEach((el, i) => enter(el as HTMLElement, { y: 10, delay: i * 40, cfg: CFG.slide })); }, [head?.round, remarks.length]);
  return (
    <div className="trev">
      <div className="trhead">
        {!head ? (r.asked ? <><span className="wst run"><Runner /></span><span>asking Codex…</span></>
          : <><span>no review of #{r.pr} yet</span><span className="cdim">· Codex reads the branch against main, read-only</span><span className="cgrow1" /><button className="wbtn" onClick={() => void reviewIt(team, r.repo, r.pr)}>ask for a review</button></>)
          : head.busy ? <><span className="wst run"><Runner /></span><span>{head.text}</span><span className="cdim">· {head.files} file{head.files === 1 ? "" : "s"}, the branch against main</span></>
          : head.error ? <><span className="wst failed"><StateMark kind="failed" /></span><span className="tbad">{head.error}</span></>
          : <><span className="wst done"><CellCheck /></span><span>{remarks.length ? `${remarks.length} remark${remarks.length === 1 ? "" : "s"} on #${r.pr}` : `nothing to say on #${r.pr}`}</span><span className="cdim">· read-only, {head.files} file{head.files === 1 ? "" : "s"}</span></>}
        <span className="cgrow1" />
        {head && !head.busy && <button className="wbtn ghost" onClick={() => void reviewIt(team, r.repo, r.pr)}>ask again</button>}
      </div>
      <ul ref={ref} className="trems">
        {remarks.map((it) => (
          <li key={it.id} className={it.state === "sent" ? "sent" : ""}>
            <span className="tat mono">{it.file}{it.line ? `:${it.line}` : ""}</span>
            <p>{it.text}</p>
            <div className="tact">
              {it.state === "sent" ? <><span className="tsent"><CellCheck /> on GitHub</span><Sig s={{ login: me, agent: true }} /></>
                : <><button className="wbtn ghost" onClick={() => void comment(team, r.repo, r.pr, it.text, it)}>put in a comment</button><span className="cdim">signed {me}'s agent</span></>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SaidCap({ said }: { said: Said | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (said && ref.current) enter(ref.current, { y: 14, cfg: CFG.snap }); }, [said?.at]);
  if (!said) return null;
  return (
    <div ref={ref} className={`tsaid ${said.ok ? "" : "bad"}`} role="status">
      {said.ok ? <span className="wst done"><CellCheck /></span> : <span className="wst failed"><StateMark kind="failed" /></span>}
      <span>{said.line}</span>
      {said.by && <span className="csig">{said.by}</span>}
    </div>
  );
}

// ---- the dev view (?dev=try): a try that plays its steps, a face, three remarks ----
const DEV_STEPS: [string, string][] = [
  ["copy", "made try-41 on try/marco/41 at 9f3c2e1"], ["engine npm ci", "added 318 packages in 11s"], ["engine build", "tsc -p . done"],
  ["face npm ci", "added 402 packages in 14s"], ["face build", "built in 3.92s"], ["engine", "up on 7778, its own state and an empty home"], ["face", "up on 1421, talking to 7778"],
];
const DEV_REMARKS: [string, number, string][] = [
  ["sol/engine/src/team/hand.ts", 88, "The hand is written to the record before the teammate's machine says yes, so a refused hand leaves a record behind. Write it on the answer."],
  ["sol/mac/src/cowork/ActionBoard.tsx", 31, "\"hand to\" lists every member of the roster, me included when I am signed in on two machines; filter me out by login, not by machine."],
  ["sol/engine/test/together-hand.test.ts", 12, "The test reads the real team.json when SOL_TEAM_FILE is unset; set it in the test's own env so a run never sees a person's settings."],
];
const later = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
async function fake(type: string, body: any): Promise<any> {
  const R = String(body.repo ?? ""), N = Number(body.pr);
  if (type === "team.try") {
    if (s.trying) return { error: `already trying #${s.trying.pr}; stop that one first` };
    set({ trying: { repo: R, pr: N, path: `.claude/worktrees/try-${N}`, branch: `try/marco/${N}`, head: N === 41 ? "frank/34-hand" : "marco/together-see", title: N === 41 ? "Hand: give a session to a teammate" : "See: Cowork, the board and presence", author: N === 41 ? "frank" : "marco", since: Date.now(), up: false, engine: 7778, face: 1421 }, steps: [] });
    for (const [step, line] of DEV_STEPS) {
      hear({ type: "team.try.step", step, done: false, line: step === "copy" ? `reading #${N}` : step.endsWith("ci") ? "npm ci" : step.endsWith("build") ? "npm run build" : "starting" });
      await later(650);
      if (!s.trying) return { error: "stopped" };
      hear({ type: "team.try.step", step, done: true, ok: true, line });
    }
    const cur = s.trying as Trying | null;
    if (cur) set({ trying: { ...cur, up: true } });
    return { ok: true, engine: 7778, face: 1421 };
  }
  if (type === "team.try.stop") { set({ trying: null }); return { ok: true }; }
  if (type === "team.try.reviews") return { items: [] };
  if (type === "team.try.review") {
    const round = `review:${Date.now().toString(36)}`;
    hear({ type: "team.try.review.item", repo: R, pr: N, item: { id: round, kind: "review", head: true, round, busy: true, files: 9, text: "Codex is reading the change" } });
    void later(1400).then(() => {
      DEV_REMARKS.forEach(([file, line, text], i) => hear({ type: "team.try.review.item", repo: R, pr: N, item: { id: `${round}:${i + 1}`, kind: "review", round, file, line, text, state: "open" } }));
      hear({ type: "team.try.review.item", repo: R, pr: N, item: { id: round, kind: "review", head: true, round, busy: false, files: 9, count: 3, text: "Codex read the change" } });
    });
    return { round };
  }
  if (type === "team.pr.comment") {
    if (body.remark && s.review) { const it = s.review.items.find((x) => x.id === body.remark); if (it) hear({ type: "team.try.review.item", repo: R, pr: N, item: { ...it, state: "sent" } }); }
    return { ok: true, by: body.remark ? "marco's agent" : "marco", inline: !!body.path };
  }
  if (type === "team.pr.ready") return { ok: true, by: "marco" };
  return {};
}
