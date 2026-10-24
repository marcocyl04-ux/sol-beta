// A team member's page (Together, See #31): their plan as they wrote it (plan.md on their branch <login>/plan) and
// their log from the record (issues, comments, PRs, commits, hand lines; the last 30, newest first, each signed).
// "request an audit" sends them a ping over the team's line and says it asked.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { html } from "../Message";
import { CFG, stagger } from "../motion";
import type { MemberPage, Team } from "./useTeam";
import { Dot, STATE_WORD, Sig, since } from "./bits";
import { Watch } from "./Watch";   // Show (#101)

const KIND: Record<string, string> = { issue: "opened", comment: "said", pr: "PR", commit: "commit", hand: "hand" };

export function Member({ team, login }: { team: Team; login: string }) {
  const [page, setPage] = useState<MemberPage | null>(null);
  const [asked, setAsked] = useState<"" | "asking" | "asked" | "failed">("");
  const [watching, setWatching] = useState<string | null>(null);   // Show (#101): the shown session open read-only here
  useEffect(() => {
    setPage(null); setAsked("");
    let live = true;
    void team.ask<MemberPage>("team.member", { login }, 60_000).then((p) => { if (live) setPage({ ...p, log: p.log ?? [] }); });
    return () => { live = false; };
  }, [login]); // eslint-disable-line react-hooks/exhaustive-deps
  const log = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => { if (log.current) stagger(log.current.children, { x: 14, cfg: CFG.slide, gap: 26, max: 12 }); }, [page]);
  const m = team.state?.roster.find((r) => r.who === login);
  const up = !!team.state?.relay.up, mine = login === team.me;
  const shows = team.showing.filter((x) => x.login === login);
  const watched = shows.find((x) => x.session.id === watching) ?? null;
  const audit = async () => {
    setAsked("asking");
    const r = await team.ask<{ ok?: boolean }>("team.ping", { to: login, line: `${team.me} asks for an audit` });
    setAsked(r.ok ? "asked" : "failed");
  };
  return (
    <div className="cpage cmember">
      <header className="chead1">
        <Dot state={m?.state ?? (mine ? "here" : undefined)} dark={!mine && (!up || !m)} />
        <h2>{login}</h2>
        <span className="cdim">{m ? `${STATE_WORD[m.state]} on ${m.machine}${m.session ? ` · ${m.session.title}` : ""} · ${since(m.since)}` : mine ? "you" : "not seen now"}</span>
        <span className="cgrow1" />
        {!mine && (
          asked === "asked" ? <span className="cdim">asked {login} for an audit</span>
          : <button className="cbtn" onClick={audit} disabled={asked === "asking" || !up} title={up ? `ask ${login} to look over your work` : "the team is not in sight"}>
              {asked === "failed" ? "could not reach them, again" : asked === "asking" ? "asking…" : "request an audit"}</button>
        )}
      </header>
      {/* --- Show (#101): a session this person is showing, one line each; a click opens it read-only */}
      {shows.map((x) => (
        <button key={x.session.id} className={`cshowline ${watching === x.session.id ? "on" : ""}`} onClick={() => setWatching(watching === x.session.id ? null : x.session.id)}
          title={mine ? "your session, as the team sees it" : `watch ${login}'s session, read-only`}>
          <span className="cwatchdot" />showing #{x.issue} {x.session.title.replace(/^#\d+\s*/, "")}
        </button>
      ))}
      {watched && <Watch team={team} show={watched} onClose={() => setWatching(null)} />}
      {/* --- end Show */}
      <div className="cmcols">
        <section className="cplan">
          <h4 className="csub">plan</h4>
          {!page ? <p className="cnone">reading…</p>
            : page.plan ? <div className="md cplanmd" dangerouslySetInnerHTML={{ __html: html(page.plan) }} />
            : <p className="cnone">no plan shared yet</p>}
        </section>
        <section className="clog">
          <h4 className="csub">log</h4>
          {!page ? <p className="cnone">reading…</p> : !page.log.length ? <p className="cnone">nothing in the record yet</p> : (
            <ol ref={log}>
              {page.log.map((l, i) => (
                <li key={i}>
                  <small className="cwhen">{since(l.at)}</small>
                  <span className={`ckind ${l.kind}`}>{KIND[l.kind] ?? l.kind}</span>
                  <span className="ct">{l.text.replace(/\*\*/g, "")}</span>
                  <Sig s={l.sign} />
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
