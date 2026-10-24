// Watching a teammate's shown session (Show to team, #101): read-only, plain lines with a mark for who said it (them,
// their agent, a tool it used), following the end as new lines come. No box, no reply, no tool: to say something,
// use the chat. The tail comes from this engine's memory (team.shown.get), then every line as it is heard.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ShownLine, Showing, Team } from "./useTeam";
import { since } from "./bits";

const MARK: Record<ShownLine["role"], string> = { person: "›", agent: "◆", tool: "·" };

export function Watch({ team, show, onClose }: { team: Team; show: Showing; onClose: () => void }) {
  const [lines, setLines] = useState<ShownLine[] | null>(null);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    setLines(null); setEnded(false);
    let live = true;
    const heard: ShownLine[] = [];   // lines that arrive while the tail is asked for
    let ready = false;
    const off = team.onShown((m) => {
      if (m.login !== show.login || m.session.id !== show.session.id) return;
      if (m.event === "end") { setEnded(true); return; }
      if (m.event === "start") setEnded(false);
      if (!m.line) return;
      const l = m.line;
      if (ready) setLines((x) => [...(x ?? []), l].slice(-200)); else heard.push(l);
    });
    void team.ask<{ lines?: ShownLine[]; ended?: boolean }>("team.shown.get", { login: show.login, id: show.session.id }).then((r) => {
      if (!live) return;
      const tail = r.lines ?? [];
      const last = tail.length ? tail[tail.length - 1].at : 0;
      setLines([...tail, ...heard.filter((l) => l.at > last)].slice(-200));
      ready = true;
      if (r.ended) setEnded(true);
    });
    return () => { live = false; off(); };
  }, [show.login, show.session.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // the pane follows the end while you are at the end; scrolled up, it stays where you are
  const box = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useLayoutEffect(() => { const b = box.current; if (b && atEnd.current) b.scrollTop = b.scrollHeight; }, [lines]);

  return (
    <section className="cwatch" aria-label={`${show.login}'s session, read-only`}>
      <header>
        <span className={`cwatchdot ${ended ? "off" : ""}`} />
        <b>{show.login}</b>
        <span className="cdim">#{show.issue} {show.session.title.replace(/^#\d+\s*/, "")}</span>
        <span className="cgrow1" />
        <span className="cdim">{ended ? "no longer shown" : "read-only"}</span>
        <button className="wlink" onClick={onClose} aria-label="close">×</button>
      </header>
      <div className="cwatchlines" ref={box} onScroll={(ev) => { const b = ev.currentTarget; atEnd.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24; }}>
        {lines === null ? <p className="cnone">reading…</p>
          : !lines.length ? <p className="cnone">nothing said since the show began</p>
          : lines.map((l, i) => (
            <p key={i} className={`cwl ${l.role}`} title={`${l.role === "person" ? show.login : l.role === "agent" ? `${show.login}'s agent` : "a tool"} · ${since(l.at)}`}>
              <i>{MARK[l.role]}</i><span>{l.text}</span>
            </p>
          ))}
      </div>
    </section>
  );
}
