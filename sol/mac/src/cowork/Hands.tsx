// Hand (#34, design/together/4-hand/PRD.md): the pieces Cowork draws for a hand.
//   handItems     a card's menu: hand to <member> (with a line, or as it is; its PR too), ask <member> to review
//   sessionItems  a session row's menu in the side: hand it to <member>; Sol writes the brief from the session
//   HandsRecord   under the action board's columns: who gave what to whom, read from the issues' comments, newest first
//   HandLine      over Cowork's stage: "frank hands you #34 · <title>", Take · Pass · Later (Pass asks one line)
//   HandedRows    under a repo in the side: what is handed to me there, put off with Later or not yet answered
// The store is handed.ts; the words on GitHub and the relay are the engine's (team/hand.ts).
import { useEffect, useRef, useState } from "react";
import type { MenuItem } from "../work/Menu";
import { Fold } from "../MotionKit";
import { CFG, enter } from "../motion";
import type { Card, PR } from "./useTeam";
import { Sig, since } from "./bits";
import { handTo, later, pass, passing, take, unlater, useHands, type HandRow, type Handed } from "./handed";
import "./hands.css";

const HOW: Record<HandRow["how"], string> = { hand: "handed", taken: "taken", passed: "passed back", review: "review asked" };
/** the brief in one dim line: its lines without the title and the headings Sol writes ("the plan:", "where it stands:") */
const briefLine = (b: string) => b.split("\n").map((l) => l.trim().replace(/^- /, "")).filter((l, i) => l && !(i === 0 && /^#\d+/.test(l)) && !/:$/.test(l)).slice(0, 3).join(" · ");
const openUrl = (url: string) => { import("@tauri-apps/plugin-opener").then((o) => o.openUrl(url)).catch(() => window.open(url, "_blank")); };

/** a card's hand items: one per teammate, each a short list; with nobody on the team's line, a login can be typed */
export function handItems(c: Card, others: string[], prs: PR[] = []): MenuItem[] {
  const pr = c.pr ? prs.find((p) => p.repo === c.repo && p.number === c.pr) : undefined;
  const per = (who: string): MenuItem[] => [
    { label: "with a line", ask: "brief", hint: `the brief for ${who}, one line`, run: (v) => void handTo({ repo: c.repo, issue: c.number, to: who, brief: v }) },
    { label: "as it is", note: "its title is the brief", run: () => void handTo({ repo: c.repo, issue: c.number, to: who }) },
    ...(c.pr ? [{ label: `its PR #${c.pr}`, note: pr?.title ? `the PR's title and link: ${pr.title}`.slice(0, 60) : "the PR's title and link", run: () => void handTo({ repo: c.repo, pr: c.pr, to: who }) }] : []),
  ];
  const people: MenuItem[] = others.length
    ? others.map((who) => ({ label: `hand to ${who}`, sub: per(who) }))
    : [{ label: "hand to…", ask: "login", hint: "their GitHub login", run: (v) => void handTo({ repo: c.repo, issue: c.number, to: String(v ?? "").replace(/^@/, "") }) }];
  const reviews: MenuItem[] = c.pr ? others.map((who) => ({ label: `ask ${who} to review #${c.pr}`, note: "adds them as reviewer, with a comment", run: () => void handTo({ repo: c.repo, pr: c.pr, to: who, review: true }) })) : [];
  return [...people, ...reviews];
}

/** a cowork session's hand items: Sol writes the brief from the session (its title, plan and recap), never its talk */
export function sessionItems(repo: string, sessionId: string, title: string, others: string[]): MenuItem[] {
  const n = /#(\d+)/.exec(title)?.[1];
  return [
    { head: (title || "untitled").slice(0, 44) },
    ...(others.length
      ? others.map((who) => ({ label: `hand to ${who}`, note: n ? `with Sol's brief, on #${n}` : "its title must name an issue (#N)", disabled: !n, run: () => void handTo({ repo, sessionId, to: who }) }))
      : [{ label: "hand to…", ask: "login", hint: "their GitHub login", disabled: !n, run: (v?: string) => void handTo({ repo, sessionId, to: String(v ?? "").replace(/^@/, "") }) }]),
  ];
}

/** under the columns: the record, from the comments; my own last hand's answer on top */
export function HandsRecord() {
  const h = useHands();
  const said = h.said && Date.now() - h.said.at < 120_000 ? h.said : null;
  return (
    <section className="chands hrec">
      <h4 className="csub">hands</h4>
      {said && <p className={`hsaid ${said.failed ? "failed" : ""}`} role="status"><i />{said.text}</p>}
      {h.hands.length ? (
        <ol>
          {h.hands.map((r, i) => (
            <li key={`${r.repo}#${r.number}@${r.at}#${i}`} className={`handrow ${r.how}`} title={r.brief && r.how !== "review" ? r.brief : r.url ?? ""} onClick={() => r.url && openUrl(r.url)}>
              <span className="who">{r.how === "taken" ? <>{r.to}<small> from {r.from || "someone"}</small></> : <>{r.from} <span className="arr">→</span> {r.to}</>}</span>
              <span className="cnum">#{r.number}</span>
              <span className="how">{HOW[r.how]}</span>
              {r.line && <span className="line">“{r.line}”</span>}
              <span className="grow" />
              <small className="ago">{since(r.at)}</small>
              <Sig s={r.sign} />
            </li>
          ))}
        </ol>
      ) : <p className="cnone">nobody has handed anything yet · a card's ⋯ hands it to a teammate</p>}
    </section>
  );
}

/** over the stage: a hand to me, Take · Pass · Later; a review asked, Open · Later */
export function HandLine({ onTaken }: { onTaken: (sessionId: string, repo: string) => void }) {
  const { current: h, passing: passingId } = useHands();
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const cb = useRef(onTaken); cb.current = onTaken;
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ sessionId: string; repo: string }>).detail; if (d?.sessionId) cb.current(d.sessionId, d.repo); };
    window.addEventListener("sol:hand-taken", on);
    return () => window.removeEventListener("sol:hand-taken", on);
  }, []);
  // the notch's Pass: the field opens here
  useEffect(() => { if (h && passingId === h.id && !h.review) { setAsking(true); requestAnimationFrame(() => field.current?.focus()); } }, [h?.id, passingId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setWhy(""); if (!(h && passingId === h.id)) setAsking(false); }, [h?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ref.current && h) enter(ref.current, { y: -8, cfg: CFG.arrive }); }, [h?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!h) return null;
  const d = h.doing;
  const cls = d ? (d.taking ? "busy" : d.failed ? "failed" : "done") : "";
  const line = h.review ? <><span className="by">{h.from}</span> asks you to review <b>#{h.issue}</b></>
    : <><span className="by">{h.from}</span> hands you <b>#{h.issue}</b>{h.title && <> · {h.title}</>}</>;
  const send = () => { const v = why.trim(); if (!v) return; setAsking(false); void pass(h, v); };
  return (
    <div ref={ref} className={`hline ${cls}`} role="status">
      <div className="hrow1">
        <span className="what" title={h.brief}><i />{d ? d.said : line}</span>
        {!d?.taking && !(d && !d.failed) && !asking && (
          <span className="moves">
            {!d && (h.review
              ? <button className="first" onClick={() => { openUrl(`https://github.com/${h.repo}/pull/${h.issue}`); later(h); }} title="open the PR on GitHub">Open</button>
              : <>
                <button className="first take" onClick={() => void take(h)} title="the branch comes down, and a session opens with the brief">Take</button>
                <button onClick={() => { setAsking(true); requestAnimationFrame(() => field.current?.focus()); }} title="give it back, with one line why">Pass</button>
              </>)}
            <button onClick={() => later(h)} title="keep it under its repo, in the side, as handed to you">Later</button>
          </span>
        )}
      </div>
      {!d && !h.review && h.brief && h.brief !== h.title && !asking && <p className="brief">{briefLine(h.brief)}</p>}
      <Fold open={asking} gap={0} from={{ y: -6 }}>
        <div className="hpass">
          <input ref={field} value={why} placeholder={`why, in one line, for ${h.from}`} onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAsking(false); passing(""); } }} />
          <button className="first" disabled={!why.trim()} onClick={send}>Pass back</button>
          <button onClick={() => { setAsking(false); passing(""); }}>keep it</button>
        </div>
      </Fold>
    </div>
  );
}

/** under a repo in the side: handed to me there and not answered (put off with Later, or still open) */
export function HandedRows({ repo }: { repo: string }) {
  const h = useHands();
  const mine = h.pending.filter((p) => p.repo === repo);
  return <>{mine.map((p: Handed) => (
    <div key={p.id} className="row crow hside" data-s onClick={() => unlater(p.id)} title={`handed to you by ${p.from}${h.laterOf(p.id) ? " · put off; click to see it again" : ""}`}>
      <span className="cdot yourcall"><i /></span>
      <span className="t"><span className="cnum">#{p.issue}</span> {p.title || "handed to you"}</span>
      <Sig s={{ login: p.from, agent: false }} />
    </div>
  ))}</>;
}
/** how many rows HandedRows draws under a repo (the side's count) */
export const useHandedCount = () => { const h = useHands(); return (repo: string) => h.pending.filter((p) => p.repo === repo).length; };
