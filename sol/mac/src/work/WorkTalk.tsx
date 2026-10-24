import { Message } from "../Message";
import type { Item, Work } from "./useWork";
import { WorkSteps, type TalkView } from "./WorkSteps";
import { PermCard, PlanCard, Proposal, ReviewCard, SessionCard, WrapBox } from "./Cards";
import { Elapsed } from "./Elapsed";
import { MeRow } from "./MeRow";

export { toolLine } from "./WorkSteps";

// A Work session's items, drawn. Marco's messages and Claude's text are the same bubbles as Home; a run of tool
// calls and thinking between two messages is one card of steps (WorkSteps); questions for Marco are cards in the
// talk; the task list sits under the latest message; the next-step box ends a turn; quiet lines say what happened
// to the talk itself (summarised, stopped, failed).
const STARTED = /started ([0-9a-f-]{36})/;
// a file link [name](path:12) reads as an unknown scheme to the shared sanitizer, so it becomes path#L12 first
const fileLinks = (t: string) => t.replace(/\]\(([^)\s:]+):(\d+)\)/g, (_all, p: string, n: string) => `](${p}#L${n})`);

export function WorkTalk({ items, busy, w, view, onFresh, onLink, onBox }: {
  items: Item[]; busy: boolean; w: Work; view: TalkView; onFresh: (text?: string) => void; onLink: (ev: React.MouseEvent) => void; onBox?: (text: string) => void;
}) {
  // an allowed tool needs no line of its own: its step's check says it ran (a no, an answer, a plan stay as lines)
  const top = items.filter((i) => !i.parent && !i.quiet && i.kind !== "plan" && i.kind !== "suggest" &&
    !(i.kind === "perm" && (i.state === "allow" || i.state === "always") && i.tool !== "ExitPlanMode"));
  const plan = items.find((i) => i.kind === "plan" && (i.steps?.length ?? 0) > 0);
  const old = !busy;
  const out: React.ReactNode[] = [];
  const parent = w.live ? w.sessions.find((s) => s.id === w.live)?.parent : undefined;
  if (parent) out.push(<SessionCard key="from" id={parent} w={w} lead="started from" />);
  const last = top.length - 1;
  const lastWrap = top.map((x) => x.kind).lastIndexOf("wrap");
  const drawn = new Set<string>();   // review rounds already drawn
  for (let i = 0; i <= last; i++) {
    const it = top[i];
    if (it.kind === "tool" || it.kind === "think") {
      const start = i;
      while (i <= last && (top[i].kind === "tool" || top[i].kind === "think")) i++;
      const run = top.slice(start, i);
      i--;
      out.push(<WorkSteps key={`s${top[start].id}`} items={run} all={items} view={view} old={old} />);
      // a session this run started (or handed the task to) gets its own row card after the steps; a proposal its card
      for (const t of run) {
        if (t.kind !== "tool" || !/__(start_session|hand_off)$/.test(String(t.name))) continue;
        const m = STARTED.exec(String(t.out ?? ""));
        if (m) out.push(<SessionCard key={`ss${t.id}`} id={m[1]} w={w} lead={/hand_off$/.test(String(t.name)) ? "handed to" : "started"} />);
        else if (t.input?.initiation === "proposal" && t.ok !== false) out.push(<Proposal key={`pp${t.id}`} it={t} w={w} old={old} />);
      }
    } else if (it.kind === "me") {
      if (it.dropped) continue;   // queued, then forgotten before it was read (#51)
      const text = String(it.text ?? "") + (it.images ? `\n[${it.images} image${it.images > 1 ? "s" : ""}]` : "");
      out.push(
        <div key={it.id} data-item={it.id} className={`wme ${it.queued ? "queued" : ""}`}>
          <Message m={{ who: "me", text, files: it.files, old }} live={false} />
          <MeRow it={it} w={w} busy={busy} />
        </div>,
      );
    } else if (it.kind === "you") out.push(
      <div key={it.id} data-item={it.id} className="wyou">
        <Message m={{ who: "you", text: fileLinks(String(it.text ?? "")), old: old && !it.live }} live={busy && i === last && !!it.live} />
        {!busy && it.uuid && w.live && <button className="wforkhere" onClick={() => w.fork(w.live!, String(it.uuid))} title="a new session with the talk up to here">fork from here</button>}
      </div>,
    );
    else if (it.kind === "review") {   // Codex's review: its head and remarks, one card per round, where the round began
      if (drawn.has(it.round)) continue;
      drawn.add(it.round);
      out.push(<ReviewCard key={`r${it.round}`} items={top.filter((x) => x.kind === "review" && x.round === it.round)} w={w} onBox={onBox} old={old} />);
    }
    else if (it.kind === "perm") out.push(<div key={it.id} data-item={it.id}><PermCard it={it} w={w} /></div>);   // the notch's Open lands here (land.ts)
    else if (it.kind === "wrap") out.push(<WrapBox key={it.id} it={it} w={w} last={i === lastWrap && !busy && !top.slice(lastWrap + 1).some((x) => x.kind === "me")} onFresh={onFresh} old={old} />);
    else out.push(<p key={it.id} data-item={it.id} className={`wline ${it.kind}`}>{String(it.text ?? "")}</p>);
  }
  if (busy && top[last]?.kind === "me" && !top[last].queued) out.push(<div key="wait" className="msg you md live"><p className="wwait"><Elapsed at={top[last].at} /></p></div>);
  if (plan) out.push(<PlanCard key="plan" it={plan} w={w} old={old} />);
  return <div className="wtalk" onClickCapture={onLink}>{out}</div>;
}
