// A person (#238; the studio PRD §5, frame s3 of vM.html): click a worker and see what they did in this room, newest
// first, and the things they are in now; their conversation with their agent comes in on the right, read-only and live
// (a session started under the room shows to it while it runs, #189 option 2; never kept off their Mac). At its foot:
// a line to them (a ping), "hand them something" and "watch their agent live" (Show, #101). Nothing here changes their work.
import { useEffect, useMemo, useState } from "react";
import type { Team, Member, ShownLine } from "./useTeam";

/** one person's roster entries (one a machine) as one (#238): their state from the newest, every machine's room sessions,
 *  their thing from the one that has it, and quiet only when every machine of theirs says it */
export function personOf(roster: Member[], login: string): Member | undefined {
  const all = roster.filter((m) => m.who === login);
  if (all.length <= 1) return all[0];
  const top = [...all].sort((a, b) => (a.state === "working" ? -1 : 0) - (b.state === "working" ? -1 : 0) || b.since - a.since)[0];
  const sessions = all.flatMap((m) => (m.quiet ? [] : m.sessions ?? []));
  const thing = all.map((m) => m.thing).filter(Boolean).sort((a, b) => b!.at - a!.at)[0];
  const { sessions: _s, thing: _t, quiet: _q, ...rest } = top;
  return { ...rest, ...(sessions.length ? { sessions } : {}), ...(thing ? { thing } : {}), ...(all.every((m) => m.quiet) ? { quiet: true as const } : {}) };
}
import type { Room as RoomData, Thing, FeedLine } from "./useRoom";
import { Glyph } from "./Room";
import { useWatch } from "./Watch";
import { since, STATE_WORD, Who, useBand } from "./bits";
import { hhmm } from "./util";
import { Droplet } from "../creature/goo";

type Row = { id: string; at: string; text: string; sub?: string; agent: boolean };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** what a person did in the room, newest first (pure): the room's feed lines that are theirs, and the record's log of
 *  them (#31's member page) where it says something the feed does not; one row each */
export function didOf(login: string, feed: FeedLine[], log: { at: string; text: string; repo?: string; number?: number; sign: { login: string; agent: boolean } }[] = []): Row[] {
  const rows: Row[] = feed.filter((l) => l.who && same(l.who, login)).map((l) => ({
    id: l.id, at: l.at, text: l.text, agent: l.agent,
    ...(l.ref?.repo && l.ref.number ? { sub: `${l.ref.repo.split("/").pop()} #${l.ref.number}` } : l.ephemeral ? { sub: "seen live, not kept" } : {}),
  }));
  const key = (t: string) => t.toLowerCase().replace(/\*\*/g, "").replace(/[^\p{L}\p{N}#]+/gu, " ").trim().slice(0, 48);
  const had = new Set(rows.map((r) => key(r.text)));
  for (const [i, l] of log.entries()) {
    const text = l.text.replace(/\*\*/g, "");
    if (!same(l.sign.login, login) || had.has(key(text))) continue;
    had.add(key(text));
    rows.push({ id: `log:${i}:${l.at}`, at: l.at, text, agent: l.sign.agent, ...(l.repo && l.number ? { sub: `${l.repo.split("/").pop()} #${l.number}` } : {}) });
  }
  return rows.filter((r) => !Number.isNaN(Date.parse(r.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 40);
}

/** the centre of S3: the larger worker, what they did, the things they are in */
export function PersonMain({ team, room, login, entry, roomName, onBack, onThing, convo, onConvo }: {
  team: Team; room: RoomData; login: string; entry?: Member; roomName: string; onBack: () => void; onThing: (t: Thing) => void;
  convo: boolean; onConvo: () => void;
}) {
  const me = team.me, mine = login === me, up = !!team.state?.relay.up;
  const dark = !mine && (!up || !entry);
  const [log, setLog] = useState<Parameters<typeof didOf>[2]>([]);
  const [feed, setFeed] = useState<FeedLine[] | null>(null);   // a longer read of the room's feed than the page's 50
  const [asked, setAsked] = useState<"" | "asking" | "asked" | "failed">("");
  const roomNow = team.state?.settings.room ?? "";
  useEffect(() => {
    let live = true;
    setLog([]); setFeed(null); setAsked("");
    void team.ask<{ log?: Parameters<typeof didOf>[2] }>("team.member", { login }, 60_000).then((p) => { if (live && Array.isArray(p.log)) setLog(p.log); });
    void team.ask<{ lines?: FeedLine[] }>("team.feed", { limit: 200 }).then((r) => { if (live && Array.isArray(r.lines)) setFeed(r.lines); });
    return () => { live = false; };
  }, [login, roomNow]); // eslint-disable-line react-hooks/exhaustive-deps
  // the page's own feed holds the live lines that came since the long read: both, each line once
  const lines = useMemo(() => { const all = [...room.feed, ...(feed ?? [])]; const seen = new Set<string>(); return all.filter((l) => !seen.has(l.id) && !!seen.add(l.id)); }, [room.feed, feed]);
  const rows = useMemo(() => didOf(login, lines, log), [login, lines, log]);
  const inNow = room.things.filter((t) => entry?.thing?.id === t.id || t.inNow.includes(login));
  const thing = inNow[0];
  const state = entry?.state ?? (mine ? "here" : undefined);
  const where = dark ? "not seen now" : [STATE_WORD[state ?? "here"], entry?.machine ? `on ${entry.machine}` : "", thing ? `in ${thing.name}` : entry?.session?.title ? `on ${entry.session.title}` : "", entry ? `for ${since(entry.since)}` : ""].filter(Boolean).join(" · ");
  const audit = async () => {
    setAsked("asking");
    const r = await team.ask<{ ok?: boolean }>("team.ping", { to: login, line: `${me} asks for an audit` });
    setAsked(r.ok ? "asked" : "failed");
  };
  const band = useBand();
  return (
    <div className="rm-page rm-person">
      <div className="rm-pg-top">
        <button className="rm-th-link" onClick={onBack}>‹ the room</button>
        <span className="rm-th-sp" />
        {!convo && <button className="rm-th-link" onClick={onConvo}>{mine ? "your conversation ›" : "their conversation ›"}</button>}
      </div>
      <header className="rm-ps-head">
        <Who login={login} size={64} away={dark || state === "away"} working={!dark && state === "working"} needs={!dark && state === "yourcall"} />
        <div className="rm-ps-name">
          <h2>{login}{mine && <span> (you)</span>}</h2>
          <p>{where}</p>
        </div>
      </header>
      <h3 className="rm-pg-h">what {mine ? "you" : "they"} did in {roomName} · newest first</h3>
      <ol className="rm-ps-did">
        {rows.length === 0 && <li className="none">{feed === null ? "reading…" : `nothing yet: what ${mine ? "you do" : "they do"} here shows as it happens`}</li>}
        {rows.map((r, i) => (
          <li key={r.id} style={{ "--i": Math.min(i, 11) } as React.CSSProperties}>
            <time dateTime={r.at}>{hhmm(r.at)}</time>
            <span className="tx"><span>{r.text}{r.agent && <em className="ag"><Who login={login} size={12} />{mine ? "your" : "their"} agent</em>}</span>{r.sub && <small>{r.sub}</small>}</span>
          </li>
        ))}
      </ol>
      <h3 className="rm-pg-h">things {mine ? "you are" : "they are"} in</h3>
      <div className="rm-ps-in">
        {inNow.length === 0 ? <p className="none">none right now</p> : inNow.map((t) => (
          <button key={t.id} className="rm-ps-thing" style={{ "--fam": band(login) } as React.CSSProperties} onClick={() => onThing(t)} title={`open ${t.name}`}>
            <Glyph kind={t.kind} size={36} />
            <span><b>{t.name}</b><small>{entry?.thing?.source === "agent" ? `${mine ? "your" : "their"} agent is in it now` : "in it now"}</small></span>
          </button>
        ))}
      </div>
      <p className="rm-pg-foot">{mine ? "this is what the room sees of you" : "their page only shows; nothing here changes their work"}</p>
      {!mine && (
        <div className="rm-ps-audit">
          {asked === "asked" ? <span>asked {login} for an audit</span>
            : <button className="rm-th-link" onClick={audit} disabled={asked === "asking" || !up} title={up ? `ask ${login} to look over your work` : "the team is not in sight"}>
                {asked === "failed" ? "could not reach them, again" : asked === "asking" ? "asking…" : "request an audit"}</button>}
        </div>
      )}
    </div>
  );
}

/** the right of S3: their conversation with their agent, live, read-only; a line to them; hand and watch */
export function PersonSide({ team, login, entry, roomName, onClose, onHand, flash }: {
  team: Team; login: string; entry?: Member; roomName: string; onClose: () => void; onHand: () => void; flash: (s: string) => void;
}) {
  const mine = login === team.me;
  // their room sessions (the roster's word), then a session they show on an issue (Show, #101)
  const rooms = entry?.quiet ? [] : entry?.sessions ?? [];
  const issues = team.showing.filter((x) => x.login === login && x.issue > 0);
  const [pick, setPick] = useState("");
  const ids = [...rooms.map((s) => s.id), ...issues.map((x) => x.session.id)];
  const id = ids.includes(pick) ? pick : rooms[0]?.id ?? "";
  const [line, setLine] = useState("");
  const say = async () => {
    const text = line.trim();
    if (!text) return;
    const r = await team.ask<{ ok?: boolean }>("team.ping", { to: login, line: text, kind: "chat" });
    if (r.ok) { setLine(""); flash(`said to ${login}`); } else flash("could not reach them now");
  };
  const tabs = [...rooms.map((s) => ({ id: s.id, title: s.title || "a room session" })), ...issues.map((x) => ({ id: x.session.id, title: `#${x.issue} ${x.session.title.replace(/^#\d+\s*/, "")}` }))];
  return (
    <aside className="rm-convo" aria-label={`${login}'s conversation with their agent`}>
      <div className="rm-cv-head">
        <div><b>{mine ? "your conversation with your agent" : "their conversation with their agent"}</b>
          <small>on {roomName} · {mine ? "as the room sees it" : entry?.quiet ? "not showing" : id ? "you are watching, read-only" : "read-only, live"}</small></div>
        <button className="rm-th-link" onClick={onClose}>close ›</button>
      </div>
      {tabs.length > 1 && (
        <div className="rm-cv-tabs" role="tablist">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={t.id === id} className={t.id === id ? "on" : ""} onClick={() => setPick(t.id)}>{t.title}</button>)}
        </div>
      )}
      {entry?.quiet ? (
        <div className="rm-cv-stand">{mine
          ? <><p>not showing</p><p className="dim">you turned off showing your sessions in {roomName} (settings › what leaves this machine)</p></>
          : <><p>not showing · ask them</p><p className="dim">{login} turned off showing their sessions in {roomName}</p></>}</div>
      ) : !id ? (
        <div className="rm-cv-stand">
          <p>{!entry && !mine ? "not here now" : `no session in ${roomName} now`}</p>
          <p className="dim">{mine ? `a session you start here shows to ${roomName} while it runs; Home's never do` : `when they start one here, it shows as it runs`}</p>
        </div>
      ) : <Convo key={id} team={team} login={login} id={id} mine={mine} />}
      <div className="rm-cv-foot">
        {!mine && (
          <form className="rm-box" onSubmit={(e) => { e.preventDefault(); void say(); }}>
            <input value={line} onChange={(e) => setLine(e.target.value)} placeholder={`say something to ${login}`} aria-label={`say something to ${login}`} maxLength={300} />
            <span className="k" aria-hidden="true">↵</span>
          </form>
        )}
        <div className="rm-cv-links">
          {!mine && <button className="rm-th-link u" onClick={onHand} title="hand them a card from the room's repository">hand them something ›</button>}
          <button className="rm-th-link u" disabled={!issues.length} onClick={() => issues[0] && setPick(issues[0].session.id)}
            title={issues.length ? "their agent on an issue, as they show it" : `${mine ? "you are" : "they are"} not showing an issue session now`}>watch {mine ? "your" : "their"} agent live ›</button>
        </div>
      </div>
    </aside>
  );
}

// a tool line is one or more tool names, glued with " · " when they came together (show.ts Throttle)
const steps = (ls: ShownLine[]) => ls.reduce((n, l) => n + l.text.split(" · ").length, 0);

/** one watched session as a conversation: their words on the right, the agent's with the mark, a run of tool steps folded */
function Convo({ team, login, id, mine }: { team: Team; login: string; id: string; mine: boolean }) {
  const { lines, ended, note, waiting } = useWatch(team, login, id, !mine);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    // each group keyed by its first line, never its place: the 200-line trim moves every place by one (the review of #243)
    const out: { i: number; k: string; role: ShownLine["role"]; lines: ShownLine[] }[] = [];
    for (const [i, l] of (lines ?? []).entries()) {
      const last = out[out.length - 1];
      if (l.role === "tool" && last?.role === "tool") last.lines.push(l); else out.push({ i, k: `${l.at}:${l.role}:${l.text.slice(0, 24)}`, role: l.role, lines: [l] });
    }
    return out;
  }, [lines]);
  return (
    <div className="rm-cv-body">
      <p className="rm-cv-live">{ended ? <Droplet kind="done" size={12} seed={id} /> : waiting ? <span className="cnobody" aria-hidden="true" /> : <Droplet kind="running" size={12} seed={id} />}{ended ? "this session ended" : waiting ? "not live yet: it shows once it starts showing" : mine ? "live to the room" : "live · you are watching"}</p>
      {note && <p className="rm-cv-note" role="status">{note}</p>}
      <div className="rm-cv-lines" aria-live="polite">
        {lines === null ? <p className="none">reading…</p>
          : !lines.length ? <p className="none">nothing said since it began showing</p>
          : groups.map((g) => g.role === "tool" ? (
            <button key={g.k} className="rm-cv-steps" aria-expanded={open.has(g.k)} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(g.k)) n.delete(g.k); else n.add(g.k); return n; })}>
              <span>{open.has(g.k) ? "▾" : "▸"} {steps(g.lines)} step{steps(g.lines) === 1 ? "" : "s"}</span>
              <span className="nm">{open.has(g.k) ? g.lines.map((l) => l.text).join(" · ") : g.lines.map((l) => l.text).join(" · ").slice(0, 80)}</span>
            </button>
          ) : (
            <div key={g.k} className={`rm-cv-l ${g.role}`}>
              {g.role === "agent" && <Who login={login} size={14} className="mk" />}
              <div><time>{hhmm(new Date(g.lines[0].at).toISOString())}</time><p>{g.lines[0].text}</p></div>
            </div>
          ))}
      </div>
    </div>
  );
}
