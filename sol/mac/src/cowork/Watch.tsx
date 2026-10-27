// Watching a teammate's shown session (Show to team, #101): read-only, no box, no reply, no tool. The tail comes from
// this engine's memory (team.shown.get), then every line as it is heard. A person's page draws it (Person.tsx Convo).
import { useEffect, useState } from "react";
import type { ShownLine, Team } from "./useTeam";

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
