// Watching a teammate's shown session (Show to team, #101): read-only, plain lines with a mark for who said it (them,
// their agent, a tool it used), following the end as new lines come. No box, no reply, no tool: to say something,
// use the chat. The tail comes from this engine's memory (team.shown.get), then every line as it is heard.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ShownLine, Showing, Team } from "./useTeam";
import { since } from "./bits";

const MARK: Record<ShownLine["role"], string> = { person: "›", agent: "◆", tool: "·" };

/** one teammate's shown session, watched while the caller is mounted (#101, #223; a room session's too, #238): its tail
 *  from this engine's memory, then every line as it is heard; on a cloud, the hub is asked to send its lines here, and
 *  let go on unmount. `refused`: why the cloud would not send it now; `note`: the light's word, when there is one */
export function useWatch(team: Team, login: string, id: string, ask = true) {
  const [lines, setLines] = useState<ShownLine[] | null>(null);
  const [ended, setEnded] = useState(false);
  const [refused, setRefused] = useState("");   // why the cloud would not send this show (#223), or ""
  const [waiting, setWaiting] = useState(false);   // no start of it heard yet: not live yet, never "ended" (#238)
  useEffect(() => {
    setLines(null); setEnded(false); setWaiting(false);
    if (!login || !id) return;
    let live = true;
    const heard: ShownLine[] = [];   // lines that arrive while the tail is asked for
    let ready = false;
    const off = team.onShown((m) => {
      if (m.login !== login || m.session.id !== id) return;
      if (m.event === "end") { setEnded(true); return; }
      if (m.event === "start") { setEnded(false); setWaiting(false); }
      if (!m.line) return;
      setWaiting(false);   // a line is live, whatever came first
      const l = m.line;
      if (ready) setLines((x) => [...(x ?? []), l].slice(-200)); else heard.push(l);
    });
    void team.ask<{ lines?: ShownLine[]; ended?: boolean }>("team.shown.get", { login, id }).then((r) => {
      if (!live) return;
      const tail = r.lines ?? [];
      const last = tail.length ? tail[tail.length - 1].at : 0;
      setLines([...tail, ...heard.filter((l) => l.at > last)].slice(-200));
      ready = true;
      // nothing of it known here: an issue show that ended, or a room session whose start has not come yet
      if (r.ended && !heard.length) setWaiting(true);
    });
    // my own session (#238): its lines are this engine's already; asking the hub would take one of my two watches
    if (!ask) return () => { live = false; off(); };
    // on a cloud the hub sends a show's lines only to the Sols watching it (#223): opening asks, closing lets go
    setRefused("");
    void team.ask("team.shown.watch", { login, id, on: true });
    const offH = team.onHub((w) => { if (w.say === "light" && w.light === "green") setRefused(""); if (w.say === "watch" && w.login === login && w.session === id && w.on !== false) setRefused(w.ok ? "" : w.why ?? "the cloud would not send this show now"); });
    return () => { live = false; off(); offH(); void team.ask("team.shown.watch", { login, id, on: false }); };
  }, [login, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const light = team.hub.light;
  const note = refused || (light === "red" ? "Cowork is chat only for now; the AI view comes back later"
    : light === "yellow" || light === "orange" ? "the cloud is busy: updates come slower" : "");
  return { lines, ended, note, waiting };
}

export function Watch({ team, show, onClose }: { team: Team; show: Showing; onClose: () => void }) {
  const w = useWatch(team, show.login, show.session.id), { lines, note } = w, ended = w.ended || w.waiting;   // a show this engine no longer knows is no longer shown

  // the pane follows the end while you are at the end; scrolled up, it stays where you are
  const box = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useLayoutEffect(() => { const b = box.current; if (b && atEnd.current) b.scrollTop = b.scrollHeight; }, [lines]);

  return (
    <section className="cwatch" aria-label={`${show.login}'s session, read-only`}>
      <header>
        <span className={`cwatchdot ${ended ? "off" : ""}`} />
        <b>{show.login}</b>
        <span className="cdim">{show.issue ? `#${show.issue} ` : ""}{show.session.title.replace(/^#\d+\s*/, "")}</span>
        <span className="cgrow1" />
        <span className="cdim">{ended ? "no longer shown" : "read-only"}</span>
        <button className="wlink" onClick={onClose} aria-label="close">×</button>
      </header>
      {note && <p className="cdim" role="status">{note}</p>}
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
