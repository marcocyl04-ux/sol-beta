import { useLayoutEffect, useRef, useState } from "react";
import { CellCheck, Runner } from "../creature/indicators";
import { html } from "../Message";
import { CFG, enter, growTo } from "../motion";
import { Fold } from "../MotionKit";
import { working, type Item, type Work } from "./useWork";
import { Diff, editDiff } from "./Diff";
import { toolAsk, toolLine } from "./WorkSteps";

// a card arrives sliding up while its height opens, like a step card
function useArrive(on = true) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current && on) { enter(ref.current, { y: 14, cfg: CFG.arrive }); growTo(ref.current, 0); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

// ---- the task list under the latest message ----
export function PlanCard({ it, w, old }: { it: Item; w: Work; old?: boolean }) {
  const ref = useArrive(!old);
  const steps: { content: string; status: string; active?: string; session?: string }[] = it.steps ?? [];
  const done = steps.filter((s) => s.status === "completed").length;
  return (
    <div ref={ref} className="wcard wplan">
      <div className="whead"><span>{done} of {steps.length}</span></div>
      {steps.map((s, i) => {
        const sess = s.session ? w.sessions.find((x) => x.id === s.session || x.title === s.session) : undefined;
        return (
          <div key={i} className={`pstep ${s.status}`}>
            <span className="pmark">{s.status === "completed" ? <CellCheck /> : s.status === "in_progress" ? <Runner /> : <i />}</span>
            <span className="pt">{s.status === "in_progress" && s.active ? s.active : s.content}</span>
            {s.session && <button className="ptag" disabled={!sess} onClick={() => sess && w.open(sess.id)} title="the session this step went to">{sess && <StateMark st={stateOf(w, sess.id)} />}{sess?.title ?? s.session}</button>}
          </div>
        );
      })}
    </div>
  );
}

// ---- the next-step box: the recap, and at most one question with its buttons ----
const ACTION: Record<string, string> = {
  commit: "commit", create_pr: "open a PR", merge: "merge", fix_ci: "fix CI", address_comments: "address comments",
  resolve_conflicts: "resolve conflicts", verify: "verify", archive: "archive", new_session: "new session",
};
const ACTION_SAYS: Record<string, string> = {
  commit: "Commit the changes.", create_pr: "Open a pull request for this branch.", merge: "Merge the pull request.",
  fix_ci: "Fix the failing CI checks.", address_comments: "Address the review comments.",
  resolve_conflicts: "Resolve the merge conflicts with the base branch.", verify: "Verify that the change works.",
};
// new_session opens a fresh session with the button's message in its box (not sent): Marco reads it, then presses Enter
export function WrapBox({ it, w, last, onFresh, old }: { it: Item; w: Work; last: boolean; onFresh: (text?: string) => void; old?: boolean }) {
  const ref = useArrive(!old);
  const acts: { label?: string; message?: string; action?: string }[] = it.actions ?? [];
  const run = (a: (typeof acts)[number]) => {
    if (a.action === "archive") { if (w.live) w.mark(w.live, { archived: true }); return; }
    if (a.action === "new_session") { onFresh(a.message?.trim() || undefined); return; }
    w.say(a.message || (a.action ? ACTION_SAYS[a.action] ?? a.action : a.label || ""));
  };
  return (
    <div ref={ref} className={`wcard wwrap ${last ? "last" : ""}`}>
      <p className="recap">{String(it.recap ?? "")}</p>
      {it.ask && <p className="wask">{String(it.ask)}</p>}
      {last && acts.length > 0 && (
        <div className="choices">
          {acts.map((a, i) => <button key={i} className={i === 0 ? "first" : ""} onClick={() => run(a)}>{a.label || (a.action ? ACTION[a.action] ?? a.action : "")}</button>)}
        </div>
      )}
    </div>
  );
}

// ---- Codex's review of the change: what it is doing, then each thing it found wrong, to send to Claude or dismiss ----
const SCOPE: Record<string, string> = { all: "this branch", uncommitted: "not committed", last: "last commit" };
export function ReviewCard({ items, w, onBox, old }: { items: Item[]; w: Work; onBox?: (text: string) => void; old?: boolean }) {
  const head = items.find((i) => i.head);
  const ref = useArrive(!old || !!head?.busy);
  const remarks = items.filter((i) => !i.head);
  const where = (r: Item) => (r.file ? `${r.file}${r.line ? `:${r.line}` : ""}` : "");
  const send = (r: Item) => {
    const text = `Codex reviewed the change and says${where(r) ? `, at ${where(r)}` : ""}: ${String(r.text ?? "")}`;
    if (onBox) onBox(text); else w.say(text);
    w.reviewMark(r.id, "sent");
  };
  return (
    <div ref={ref} className="wcard wreview">
      <div className="whead">
        <span>codex review{head ? ` · ${SCOPE[head.scope] ?? head.scope} · ${head.files} file${head.files === 1 ? "" : "s"}` : ""}</span>
        {head?.busy && <button className="wlink" onClick={() => w.reviewStop()}>stop</button>}
      </div>
      {head && <p className={`wrvstat ${head.busy ? "busy" : ""}`}>{String(head.text ?? "")}{head.busy && head.step ? <code>{String(head.step)}</code> : null}{head.error ? <em>{String(head.error)}</em> : null}</p>}
      {remarks.map((r) => (
        <div key={r.id} className={`wrv ${r.state}`}>
          {where(r) && <code className="at">{where(r)}</code>}
          <div className="md" dangerouslySetInnerHTML={{ __html: html(String(r.text ?? "")) }} />
          {r.state === "open" ? (
            <div className="choices">
              <button className="first" onClick={() => send(r)}>send to Claude</button>
              <button onClick={() => w.reviewMark(r.id, "dismissed")}>dismiss</button>
            </div>
          ) : <span className="was">{r.state === "sent" ? "sent to Claude" : "dismissed"}</span>}
        </div>
      ))}
    </div>
  );
}

// ---- a question for Marco: a tool to allow, a question with options, a plan to approve ----
export function PermCard({ it, w }: { it: Item; w: Work }) {
  const ref = useArrive(it.state === "ask");
  const [note, setNote] = useState("");
  const tool = String(it.tool), input = it.input ?? {};
  const answer = (a: object) => w.perm(it.id, a);
  if (tool === "mcp__sol__start_session") return <Offer it={it} w={w} />;
  if (it.state !== "ask") {
    const word = it.state === "always" ? "always allowed" : it.state === "allow" ? "allowed" : it.state === "answered" ? "answered" : "not allowed";
    return <p className={`wline perm-done ${it.state}`}>{word}: {tool === "AskUserQuestion" ? "a question" : tool === "ExitPlanMode" ? "the plan" : toolLine(tool, input)}{it.note ? ` (${it.note})` : ""}</p>;
  }
  if (tool === "AskUserQuestion") return <div ref={ref}><Questions it={it} onAnswer={answer} /></div>;
  if (tool === "ExitPlanMode") return (
    <div ref={ref} className="wcard wperm plan">
      <div className="whead"><span>the plan</span></div>
      <div className="md planmd" dangerouslySetInnerHTML={{ __html: html(String(input.plan ?? "")) }} />
      <div className="choices">
        <button className="first" onClick={() => answer({ allow: true, mode: "acceptEdits" })}>build it, edits allowed</button>
        <button onClick={() => answer({ allow: true, mode: "default" })}>build it, ask for each</button>
      </div>
      <Instead note={note} setNote={setNote} onSend={() => answer({ allow: false, note: note || "keep planning" })} hint="keep planning: say what to change" />
    </div>
  );
  const d = editDiff(tool, input);
  return (
    <div ref={ref} className="wcard wperm">
      <div className="whead"><span>{it.title ? String(it.title) : `Claude wants to ${toolAsk(tool, input)}`}</span></div>
      {it.reason && <p className="why">{String(it.reason)}</p>}
      {it.path && <p className="why">{String(it.path)}</p>}
      {tool === "Bash" ? <pre className="cmdblock">$ {String(input.command ?? "")}</pre>
        : d ? <Diff d={d} max={60} />
        : <pre className="cmdblock">{JSON.stringify(input, null, 1).slice(0, 1200)}</pre>}
      <div className="choices">
        <button className="first" onClick={() => answer({ allow: true })}>allow</button>
        {it.always && <button onClick={() => answer({ allow: true, always: true })}>always allow</button>}
        <button onClick={() => answer({ allow: false, note: note || undefined })}>no</button>
      </div>
      <Instead note={note} setNote={setNote} onSend={() => answer({ allow: false, note })} hint="or tell Claude what to do instead" />
    </div>
  );
}

function Instead({ note, setNote, onSend, hint }: { note: string; setNote: (v: string) => void; onSend: () => void; hint: string }) {
  return <input className="instead" value={note} placeholder={hint} onChange={(e) => setNote(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) { e.preventDefault(); onSend(); } }} />;
}

function Questions({ it, onAnswer }: { it: Item; onAnswer: (a: object) => void }) {
  const qs: { question: string; header?: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }[] = it.input?.questions ?? [];
  const [pick, setPick] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const toggle = (q: number, l: string, multi?: boolean) => setPick((p) => {
    const cur = p[q] ?? [];
    return { ...p, [q]: multi ? (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]) : [l] };
  });
  const ready = qs.every((_, q) => (pick[q]?.length ?? 0) > 0 || other[q]?.trim());
  const send = () => onAnswer({ allow: true, answers: Object.fromEntries(qs.map((q, i) => [q.question, other[i]?.trim() || (pick[i] ?? []).join(", ")])) });
  return (
    <div className="wcard wperm questions">
      {qs.map((q, i) => (
        <div key={i} className="q">
          {q.header && <div className="whead"><span>{q.header}</span></div>}
          <p className="qt">{q.question}</p>
          <div className="opts">
            {(q.options ?? []).map((o) => (
              <button key={o.label} className={`opt ${(pick[i] ?? []).includes(o.label) ? "on" : ""}`} onClick={() => { toggle(i, o.label, q.multiSelect); if (qs.length === 1 && !q.multiSelect) onAnswer({ allow: true, answers: { [q.question]: o.label } }); }}>
                <b>{o.label}</b>{o.description && <span>{o.description}</span>}
              </button>
            ))}
          </div>
          <input className="instead" placeholder="something else" value={other[i] ?? ""} onChange={(e) => setOther((o) => ({ ...o, [i]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter" && ready) send(); }} />
        </div>
      ))}
      {(qs.length > 1 || qs.some((q) => q.multiSelect)) && <div className="choices"><button className="first" disabled={!ready} onClick={send}>answer</button></div>}
    </div>
  );
}

// ---- doors between sessions: "started from …" at the top, a session started from here ----
// a session's state, as its row dot says it
export function stateOf(w: Work, id?: string) {
  if (!id) return "";
  const s = w.sessions.find((x) => x.id === id), r = w.runs[id];
  return r?.waiting ? "needs" : working(r) ? "running" : s?.failed ? "failed" : s?.done ? "done" : "";
}
const StateMark = ({ st }: { st: string }) => <span className="wst-i">{st === "running" ? <Runner /> : st === "done" ? <CellCheck /> : <i className={st} />}</span>;

// a new session Claude wants to start: asked as "new session or do it here" (an offer), or "start it or not"
function Offer({ it, w }: { it: Item; w: Work }) {
  const ref = useArrive(it.state === "ask");
  const input = it.input ?? {};
  const offer = input.initiation === "offer";
  const title = String(input.title ?? "a new session");
  if (it.state !== "ask") {
    const word = it.state === "deny" ? (offer ? "done here" : "not started") : "a new session";
    return <p className={`wline perm-done ${it.state}`}>{word}: {title}</p>;
  }
  return (
    <div ref={ref} className="wcard wperm woffer">
      <div className="whead"><span>{offer ? "where should this run" : "a session of its own"}</span></div>
      <p className="ot">{title}{input.worktree ? <small> · in a side copy</small> : null}</p>
      {input.prompt && <p className="op">{String(input.prompt)}</p>}
      <div className="choices">
        <button className="first" onClick={() => w.perm(it.id, { allow: true })}>{offer ? "new session" : "start it"}</button>
        <button onClick={() => w.perm(it.id, { allow: false })}>{offer ? "do it here" : "no"}</button>
      </div>
    </div>
  );
}

// a follow-up Claude only proposed: a card that starts it when Marco wants; once started it is that session's row
export function Proposal({ it, w, old }: { it: Item; w: Work; old?: boolean }) {
  const ref = useArrive(!old);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = it.input ?? {};
  const made = w.sessions.find((s) => s.card === it.id);
  if (made) return <SessionCard id={made.id} w={w} lead="proposed" />;
  const start = async () => {
    if (!w.live) return;
    setBusy(true); setErr("");
    const r = await w.start({ from: w.live, title: input.title, prompt: input.prompt, cwd: input.cwd, fork: input.fork, worktree: input.worktree, card: it.id });
    setBusy(false);
    if (r.error) setErr(r.error);
  };
  return (
    <div ref={ref} className="wcard woffer wprop">
      <div className="whead"><span>a follow-up</span></div>
      <p className="ot">{String(input.title ?? "")}{input.worktree ? <small> · in a side copy</small> : null}</p>
      {input.prompt && <p className="op">{String(input.prompt)}</p>}
      {err && <p className="why err">{err}</p>}
      <div className="choices"><button className="first" disabled={busy || !w.live} onClick={() => void start()}>{busy ? "starting…" : "start it"}</button></div>
    </div>
  );
}

export function SessionCard({ id, w, lead }: { id: string; w: Work; lead: string }) {
  const s = w.sessions.find((x) => x.id === id);
  const r = w.runs[id];
  const st = stateOf(w, id);
  return (
    <button className={`wsess ${st}`} onClick={() => w.open(id)} disabled={!s && !r}>
      <span className="lead">{lead}</span>
      <span className="t">{s?.title ?? id.slice(0, 8)}</span>
      <StateMark st={st} />
      <span className="chev">›</span>
    </button>
  );
}

// ---- the aside: a side answer over the box, the task untouched ----
export type Aside = { id: string; q: string; text: string; done: boolean; error?: string };
export function AsideCard({ a, onClose }: { a: Aside; onClose: () => void }) {
  const ref = useArrive(true);
  return (
    <div ref={ref} className="wcard waside">
      <div className="whead"><span>aside</span><button className="x" onClick={onClose} title="close (esc)">×</button></div>
      <p className="aq">{a.q}</p>
      <Fold open gap={0}>
        {a.error ? <p className="why err">{a.error}</p>
          : <div className={`md ${a.done ? "" : "live"}`} dangerouslySetInnerHTML={{ __html: html(a.text || (a.done ? "" : "…")) }} />}
      </Fold>
    </div>
  );
}
