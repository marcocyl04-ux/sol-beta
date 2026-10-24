import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CFG, enter, useSpring } from "../motion";
import { CellCheck, Runner } from "../creature/indicators";
import { html } from "../Message";
import { working, type Item, type Work } from "./useWork";
import { WorkSteps, toolLine, type TalkView } from "./WorkSteps";
import { fitRow, useWidth } from "../fit";
import type { ButtonCtx, ButtonDef } from "../buttons/types";

// Work's panes stand at the right of the talk, one frame with a tab per open pane. The frame opens as a curtain on a
// spring (the width), the pane inside keeps its width and drifts in from the right; the grip at its left edge resizes.
// Each pane is a button (buttons/): the frame names its tabs by them, a body draws one.

// the share of the window the frame may take: the grip's bounds, and a kept share is held to them when read (WorkApp)
export const heldFrac = (f: number) => Math.min(0.72, Math.max(0.24, f));
// the narrowest the frame stands while the window has room for it beside the talk (fit.ts)
export const PANE_FLOOR = 280;

// w and max: the width the app fitted to the window (fit.ts) and how far the grip may take it; a frame given neither
// fits itself beside the talk alone
export function PaneFrame({ open, frac, onFrac, tabs, active, onPick, onClose, children, w, max }: {
  open: boolean; frac: number; onFrac: (f: number) => void; tabs: ButtonDef[]; active: string | null;
  onPick: (id: string) => void; onClose: (id: string) => void; children: React.ReactNode; w?: number; max?: number;
}) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const vw = useWidth();
  const own = w === undefined || max === undefined ? fitRow(vw, 0, false, [frac * vw], [true], PANE_FLOOR) : null;
  const W = useRef(0);
  W.current = w ?? own!.widths[0];
  const most = max ?? own!.max(0);
  const isOpen = useRef(open);
  isOpen.current = open;
  const put = (v: number) => {
    if (outer.current) outer.current.style.width = `${Math.max(0, v) * W.current}px`;
    if (inner.current) { inner.current.style.width = `${W.current}px`; inner.current.style.translate = `${(1 - Math.min(1, v)) * 36}px 0`; }
  };
  const sp = useSpring(open ? 1 : 0, CFG.panel, (v) => put(v), () => { if (!isOpen.current) setMounted(false); });
  useLayoutEffect(() => { put(sp.v); });
  useEffect(() => { sp.to(open ? 1 : 0, { cfg: open ? CFG.panel : CFG.away }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // the grip: the pane's left edge follows the pointer; the share is kept when the drag ends
  const drag = (ev: React.PointerEvent) => {
    ev.preventDefault();
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    let f = frac;
    const move = (m: PointerEvent) => { W.current = Math.round(Math.min(most, heldFrac((innerWidth - m.clientX) / innerWidth) * innerWidth)); f = W.current / innerWidth; put(1); };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); onFrac(f); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
  };

  return (
    <div ref={outer} className="wpanes" inert={!open}>
      {mounted && (
        <div ref={inner} className="pane wpane">
          <div className="grip" onPointerDown={drag} />
          <div className="tabs wtabs">
            {tabs.map((b) => (
              <div key={b.id} className={`tab ${b.id === active ? "on" : ""}`} onClick={() => onPick(b.id)}>
                <span>{b.tab ?? b.name}</span>
                <button onClick={(ev) => { ev.stopPropagation(); onClose(b.id); }} aria-label={`close ${b.tab ?? b.name}`}>×</button>
              </div>
            ))}
          </div>
          <div className="wstage" tabIndex={-1}>{children}</div>
        </div>
      )}
    </div>
  );
}

// a pane's body, slid up into view when shown: a button's pane drawn with the frame's context (b, c), or a view of
// its own (k, children). A kept pane stays mounted while its tab is open, so an edit or a comment survives a look at
// another tab; the rest are drawn only while showing
export function PaneBody({ className = "", hidden = false, ...p }: { className?: string; hidden?: boolean } & ({ b: ButtonDef; c: ButtonCtx } | { k: string; children: React.ReactNode })) {
  const ref = useRef<HTMLDivElement>(null);
  const k = "b" in p ? p.b.id : p.k;
  useLayoutEffect(() => { if (ref.current && !hidden) enter(ref.current, { y: 10, cfg: CFG.slide }); }, [k, hidden]);
  if ("b" in p && hidden && !p.b.kept) return null;
  const Pane = "b" in p ? p.b.Pane : null;
  return <div ref={ref} className={`wpbody ${className}`} data-pane={"b" in p ? k : undefined} hidden={hidden}>{Pane ? <Pane {...(p as { c: ButtonCtx }).c} /> : "children" in p && p.children}</div>;
}

export const Empty = ({ children }: { children: React.ReactNode }) => <p className="wpempty">{children}</p>;
const State = ({ run, ok }: { run: boolean; ok?: boolean }) => run ? <span className="wst run"><Runner /></span> : ok === false ? <span className="wst failed"><i /></span> : <span className="wst done"><CellCheck /></span>;

// ---- the plan: the steps, and the plan Claude wrote in plan mode ----
export function PlanPane({ items }: { items: Item[] }) {
  const plan = items.find((i) => i.kind === "plan");
  const steps: { content: string; status: string; active?: string }[] = plan?.steps ?? [];
  const wrote = [...items].reverse().find((i) => i.kind === "tool" && i.name === "ExitPlanMode")?.input?.plan;
  if (!steps.length && !wrote) return <Empty>no plan in this session yet. In plan mode Claude writes one before it builds.</Empty>;
  return (
    <div className="wplanp">
      {steps.length > 0 && (
        <ol className="wpsteps">
          {steps.map((s, i) => (
            <li key={i} className={s.status}>
              <span className="mk">{s.status === "completed" ? <CellCheck /> : s.status === "in_progress" ? <Runner /> : <i />}</span>
              <span>{s.status === "in_progress" && s.active ? s.active : s.content}</span>
            </li>
          ))}
        </ol>
      )}
      {wrote && <div className="md wpmd" dangerouslySetInnerHTML={{ __html: html(String(wrote)) }} />}
    </div>
  );
}

// ---- tasks: what runs behind (background commands), the helpers, the sessions this one started ----
export function TasksPane({ items, w, onHelper }: { items: Item[]; w: Work; onHelper: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const bg = items.filter((i) => i.kind === "tool" && i.bg);
  const helpers = items.filter((i) => i.kind === "tool" && (i.name === "Task" || i.name === "Agent") && !i.parent);
  const started = w.sessions.filter((s) => s.parent && s.parent === w.live);
  if (!bg.length && !helpers.length && !started.length) return <Empty>nothing runs behind this session.</Empty>;
  return (
    <div className="wtasks">
      {bg.length > 0 && <h4>behind</h4>}
      {bg.map((t) => (
        <div key={t.id} className={`wtask ${open === t.id ? "open" : ""}`}>
          <div className="wtrow" onClick={() => setOpen(open === t.id ? null : t.id)}>
            <State run={!t.bgDone} ok={t.ok} /><span className="t">{toolLine(t.name, t.input ?? {})}</span>
            <code>{String(t.input?.command ?? "").split("\n")[0]}</code>
          </div>
          {open === t.id && <pre className="wtout">{String(t.out ?? t.summary ?? "no output yet")}</pre>}
        </div>
      ))}
      {helpers.length > 0 && <h4>helpers</h4>}
      {helpers.map((t) => (
        <div key={t.id} className="wtask"><div className="wtrow" onClick={() => onHelper(t.id)}>
          <State run={!t.done} ok={t.ok} /><span className="t">{toolLine(t.name, t.input ?? {})}</span><span className="who">{String(t.input?.subagent_type ?? "helper")}</span>
        </div></div>
      ))}
      {started.length > 0 && <h4>sessions it started</h4>}
      {started.map((s) => (
        <div key={s.id} className="wtask"><div className="wtrow" onClick={() => w.open(s.id)}>
          <State run={working(w.runs[s.id])} ok={s.failed ? false : undefined} /><span className="t">{s.title || "untitled"}</span>
        </div></div>
      ))}
    </div>
  );
}

// ---- a helper's own talk: the brief it got, every step it took, the report it gave back ----
const report = (out: string) => out.replace(/^[\s\S]*?The report follows:\s*/, "").replace(/\s*agentId: [\s\S]*$/, "").trim();
export function HelperPane({ items, id, onPick, view }: { items: Item[]; id: string | null; onPick: (id: string | null) => void; view: TalkView }) {
  const helpers = items.filter((i) => i.kind === "tool" && (i.name === "Task" || i.name === "Agent"));
  const it = helpers.find((h) => h.id === id) ?? (helpers.length === 1 ? helpers[0] : undefined);
  if (!helpers.length) return <Empty>no helpers in this session yet.</Empty>;
  if (!it) return (
    <div className="wtasks">
      {helpers.map((t) => (
        <div key={t.id} className="wtask"><div className="wtrow" onClick={() => onPick(t.id)}>
          <State run={!t.done} ok={t.ok} /><span className="t">{toolLine(t.name, t.input ?? {})}</span><span className="who">{String(t.input?.subagent_type ?? "helper")}</span>
        </div></div>
      ))}
    </div>
  );
  const kids = items.filter((x) => x.parent === it.id);
  const steps = kids.filter((x) => x.kind === "tool" || x.kind === "think");
  const said = kids.filter((x) => x.kind === "you" && x.text).pop();
  const out = it.out ? report(String(it.out)) : String(said?.text ?? "");
  return (
    <div className="whelper">
      <div className="whhead">
        {helpers.length > 1 && <button className="wback" onClick={() => onPick(null)}>‹ helpers</button>}
        <State run={!it.done} ok={it.ok} /><b>{toolLine(it.name, it.input ?? {})}</b><span className="who">{String(it.input?.subagent_type ?? "helper")}</span>
      </div>
      {it.input?.prompt && <div className="md wbrief" dangerouslySetInnerHTML={{ __html: html(String(it.input.prompt)) }} />}
      {steps.length > 0 && <WorkSteps items={steps} all={items} view={view === "normal" ? "thinking" : view} old nested />}
      {out && <div className="md wreport" dangerouslySetInnerHTML={{ __html: html(out) }} />}
      {!it.done && !steps.length && <p className="wpempty">starting…</p>}
    </div>
  );
}

// ---- the branch's pull request (gh on the engine): its state, checks, body, comments ----
type Check = { name?: string; context?: string; conclusion?: string; state?: string; status?: string; detailsUrl?: string; targetUrl?: string };
type Note = { author?: { login?: string }; body?: string; state?: string; createdAt?: string; submittedAt?: string };
export type PR = {
  number: number; title: string; state: string; url: string; body?: string; isDraft?: boolean; headRefName?: string; baseRefName?: string;
  mergeable?: string; additions?: number; deletions?: number; statusCheckRollup?: Check[]; comments?: Note[]; reviews?: Note[]; reviewDecision?: string;
};
const checkState = (c: Check) => {
  const s = (c.conclusion || c.state || c.status || "").toUpperCase();
  return s === "SUCCESS" || s === "NEUTRAL" || s === "SKIPPED" ? "ok" : s === "FAILURE" || s === "ERROR" || s === "CANCELLED" || s === "TIMED_OUT" || s === "ACTION_REQUIRED" ? "bad" : "run";
};
export const prChecks = (pr?: PR | null) => {
  const cs = pr?.statusCheckRollup ?? [];
  return { n: cs.length, bad: cs.filter((c) => checkState(c) === "bad").length, run: cs.filter((c) => checkState(c) === "run").length };
};
export function PrPane({ pr, state, onRefresh, onOpen }: { pr: PR | null; state: string; onRefresh: () => void; onOpen: (url: string) => void }) {
  if (state === "loading" && !pr) return <Empty>asking GitHub…</Empty>;
  if (!pr) return <Empty>{state === "none" ? "no pull request for this branch." : state || "no folder for this session."} <button className="wlink" onClick={onRefresh}>ask again</button></Empty>;
  const cs = pr.statusCheckRollup ?? [];
  const notes = [...(pr.reviews ?? []).filter((r) => r.body || r.state !== "COMMENTED"), ...(pr.comments ?? [])]
    .sort((a, b) => String(a.submittedAt ?? a.createdAt).localeCompare(String(b.submittedAt ?? b.createdAt)));
  return (
    <div className="wpr">
      <div className="wprhead">
        <span className={`wticket ${pr.isDraft ? "draft" : pr.state.toLowerCase()}`}>#{pr.number} {pr.isDraft ? "draft" : pr.state.toLowerCase()}</span>
        <button className="wlink" onClick={() => onOpen(pr.url)}>open on GitHub</button>
        <button className="wlink" onClick={onRefresh}>{state === "loading" ? "asking…" : "ask again"}</button>
      </div>
      <h3>{pr.title}</h3>
      <p className="wprmeta"><code>{pr.headRefName}</code> into <code>{pr.baseRefName}</code> · <b>+{pr.additions ?? 0}</b> −{pr.deletions ?? 0}{pr.reviewDecision ? ` · ${pr.reviewDecision.toLowerCase().replace(/_/g, " ")}` : ""}{pr.mergeable === "CONFLICTING" ? " · conflicts" : ""}</p>
      {cs.length > 0 && (
        <div className="wchecks">
          {cs.map((c, i) => {
            const st = checkState(c);
            return (
              <div key={i} className={`wcheck ${st}`} onClick={() => { const u = c.detailsUrl || c.targetUrl; if (u) onOpen(u); }}>
                <State run={st === "run"} ok={st === "bad" ? false : undefined} /><span>{c.name || c.context}</span>
              </div>
            );
          })}
        </div>
      )}
      {pr.body && <div className="md wpmd" dangerouslySetInnerHTML={{ __html: html(pr.body) }} />}
      {notes.length > 0 && <h4>said on it</h4>}
      {notes.map((n, i) => (
        <div key={i} className="wnote">
          <b>{n.author?.login ?? "someone"}</b>{n.state && n.state !== "COMMENTED" ? <span className="who">{n.state.toLowerCase().replace(/_/g, " ")}</span> : null}
          {n.body && <div className="md" dangerouslySetInnerHTML={{ __html: html(n.body) }} />}
        </div>
      ))}
    </div>
  );
}
