// The room's own tools (ADDITIONS §1, #245): three tiles pinned first in "what we're making", each opening one of Sol's
// own pages in the room's centre, never a web view. The calendar (what is due when, for whom; each person's Sol reminds
// them), the decision log (what the room decided, only ever added to; agents read it with the goal), polls (one
// question, two to five answers, a vote a person). Their files live in the room's record beside the things
// (engine team/calendar.ts, decisions.ts, polls.ts). While a page is open my worker stands on its tile, as on a thing's.
import { useEffect, useState } from "react";
import type { Team } from "./useTeam";
import type { Room as RoomData, ToolId, CalEvent, Decision, Poll } from "./useRoom";
import type { ToolTile } from "./connectors";
import { Glyph } from "./Room";
import { Who } from "./bits";
import { since } from "./bits";
import { focusMsg, FOCUS_AGAIN_MS } from "./thingView";
import "./tools.css";

export const TOOLS: { id: ToolId; tile: string; name: string; glyph: string; line: string }[] = [
  { id: "calendar", tile: "tool-calendar", name: "the calendar", glyph: "calendar", line: "what is due when, and for whom. Each person's Sol reminds them ten minutes before, or at nine on the day" },
  { id: "decisions", tile: "tool-decisions", name: "decisions", glyph: "decisions", line: "what this room decided, only ever added to. Every agent reads it with the goal before it works" },
  { id: "polls", tile: "tool-polls", name: "polls", glyph: "poll", line: "one question, two to five answers, one vote a person, changed until it closes" },
];

const DAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const localDay = (e: Pick<CalEvent, "start" | "allDay">) => (e.allDay ? new Date(`${e.start}T00:00:00`) : new Date(e.start));
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const dayWord = (d: Date) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const n = Math.round((+new Date(d.getFullYear(), d.getMonth(), d.getDate()) - +today) / 86_400_000);
  return `${n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : DAY[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
};
const hm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const endOf = (e: CalEvent) => (e.allDay ? new Date(`${e.end ?? e.start}T23:59:59`).getTime() : Date.parse(e.end ?? e.start));
/** the events from now on, soonest first (pure) */
export const coming = (list: CalEvent[], now = Date.now()) => list.filter((e) => endOf(e) >= now);

/** a tool tile's one dim line (pure): the next event, the decisions and the newest, the open polls */
export function toolLine(id: ToolId, room: Pick<RoomData, "tools">): string {
  const t = room.tools;
  if (id === "calendar") {
    if (!t.calendar) return "the room's calendar";
    const next = coming(t.calendar)[0];
    return next ? `next · ${dayWord(localDay(next))}${next.allDay ? "" : ` ${hm(next.start)}`} · ${next.title}` : "nothing coming up";
  }
  if (id === "decisions") return t.decisions ? decided(t.decisions.length, t.decisions[0] ?? null) : "what the room decided";
  if (!t.polls) return "ask the room";
  const open = t.polls.filter((p) => !p.closed);
  return open.length ? `${open.length} open · ${open[0].question}` : "no open poll";
}
const decided = (n: number, d: Decision | null) => (d ? `${n} decided · last by ${d.by || "someone"}${d.agent ? "'s agent" : ""} · ${since(d.at) === "now" ? "now" : `${since(d.at)} ago`}` : "nothing decided yet");

/** a tile of the connectors tab's one answer (team.connectors, #332), said as toolLine says it, in local time: the
 *  engine sends the parts raw (the next event, how many decided and the newest, the open polls newest first) */
export function tileLine(t: ToolTile): string {
  if (t.id === "decisions") return t.read ? decided(t.count, t.newest) : "what the room decided";
  return toolLine(t.id, { tools: t.id === "calendar"
    ? { calendar: t.read ? (t.next ? [t.next] : []) : null, decisions: null, polls: null }
    : { calendar: null, decisions: null, polls: t.read ? t.open : null } });
}

/** while a tool's page is open, my worker stands on its tile: the face says so now and again, as a thing's pane does */
function useOnTile(team: Team, tile: string) {
  useEffect(() => {
    const say = (on: boolean) => { void team.ask("team.thing.focus", focusMsg(tile, on)).catch(() => {}); };
    say(true);
    const t = window.setInterval(() => say(true), FOCUS_AGAIN_MS);
    return () => { window.clearInterval(t); say(false); };
  }, [team.ask, tile]);
}

function Top({ onBack, children }: { onBack: () => void; children?: React.ReactNode }) {
  return <div className="rm-pg-top"><button className="rm-th-link" onClick={onBack}>‹ the room</button><span className="rm-th-sp" />{children}</div>;
}
function Head({ id, others }: { id: ToolId; others: { who: string }[] }) {
  const t = TOOLS.find((x) => x.id === id)!;
  return (
    <div className="tl-head">
      <Glyph kind={t.glyph} size={56} />
      <div>
        <h2 className="rm-gp-t">{t.name}</h2>
        <p className="rm-gp-s">{t.line}</p>
      </div>
      {others.length > 0 && <span className="tl-here">{others.map((o) => <Who key={o.who} login={o.who} size={24} title={`${o.who} is here too`} />)}<span>{others.map((o) => o.who).join(", ")} here too</span></span>}
    </div>
  );
}

export function ToolPage({ team, room, id, people, onBack, flash }: { team: Team; room: RoomData; id: ToolId; people: string[]; onBack: () => void; flash: (s: string) => void }) {
  const tile = TOOLS.find((t) => t.id === id)!.tile;
  useOnTile(team, tile);
  const others = (team.state?.roster ?? []).filter((m) => m.who !== team.me && m.thing?.id === tile).map((m) => ({ who: m.who }));
  const note = room.tools.note ?? room.thingsNote;
  return (
    <div className="rm-page tl-page">
      {id === "calendar" ? <CalendarPage team={team} room={room} people={people} onBack={onBack} flash={flash} others={others} note={note} />
        : id === "decisions" ? <DecisionsPage room={room} onBack={onBack} flash={flash} others={others} note={note} />
        : <PollsPage team={team} room={room} people={people} onBack={onBack} flash={flash} others={others} note={note} />}
    </div>
  );
}

type PageProps = { room: RoomData; onBack: () => void; flash: (s: string) => void; others: { who: string }[]; note?: string };

// ---- the calendar ----
function CalendarPage({ team, room, people, onBack, flash, others, note }: PageProps & { team: Team; people: string[] }) {
  const list = room.tools.calendar;
  const [form, setForm] = useState<{ title: string; date: string; time: string; allDay: boolean; who: string[]; error?: string; busy?: boolean } | null>(null);
  const [removing, setRemoving] = useState("");
  const [early, setEarly] = useState(false);
  const ics = async () => {
    const r = await team.ask<{ name?: string; text?: string; error?: string }>("team.calendar.ics");
    if (!r.text) return flash(r.error ?? "couldn't make the .ics");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.text], { type: "text/calendar" }));
    a.download = r.name ?? "room calendar.ics";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash("the calendar is in your Downloads: open it in your calendar app");
  };
  const add = async () => {
    if (!form) return;
    if (!form.title.trim()) return setForm({ ...form, error: "give it a title, one line" });
    if (!form.date) return setForm({ ...form, error: "which day?" });
    if (!form.allDay && !form.time) return setForm({ ...form, error: "what time? or make it all day" });
    setForm({ ...form, busy: true, error: undefined });
    // a time is this Mac's: sent with its offset, so the engine keeps the moment it means
    const start = form.allDay ? form.date : new Date(`${form.date}T${form.time}`).toISOString();
    const r = await room.tool("team.calendar.add", { title: form.title, start, allDay: form.allDay, ...(form.who.length ? { who: form.who } : {}) });
    if (r.error) setForm({ ...form, busy: false, error: r.error });
    else { setForm(null); flash(r.again ? "it is on the calendar already: the same title at the same time is one event" : "on the calendar; everyone named is reminded"); }
  };
  if (note && !list) return (<><Top onBack={onBack} /><Head id="calendar" others={others} /><p className="rm-pg-foot">{note}: the calendar shows once it has one</p></>);
  const now = Date.now();
  const ahead = list ? coming(list, now) : [], past = list ? list.filter((e) => endOf(e) < now).reverse() : [];
  const shown = early ? [...past.slice().reverse(), ...ahead] : ahead;
  const days: { key: string; d: Date; events: CalEvent[] }[] = [];
  for (const e of shown) { const d = localDay(e), k = dayKey(d); const g = days.find((x) => x.key === k); if (g) g.events.push(e); else days.push({ key: k, d, events: [e] }); }
  return (<>
    <Top onBack={onBack}><button className="rm-th-link u" onClick={() => void ics()} title="download the room's calendar as an .ics file, for your own calendar app">export .ics</button></Top>
    <Head id="calendar" others={others} />
    {!list ? <p className="rm-pg-foot">reading the room's calendar…</p> : (<>
      {past.length > 0 && <button className="rm-th-link tl-early" onClick={() => setEarly((x) => !x)}>{early ? "hide the earlier ones" : `${past.length} earlier, in the last month`}</button>}
      {days.length === 0 && <p className="tl-none">nothing coming up: add the next deadline, a review, a call</p>}
      {days.map((g) => (
        <section key={g.key} className="tl-day" aria-label={dayWord(g.d)}>
          <h4 className="rm-pg-h">{dayWord(g.d)}</h4>
          <ul className="tl-rows">
            {g.events.map((e) => (
              <li key={e.id} className={endOf(e) < now ? "past" : ""}>
                <span className="when">{e.allDay ? "all day" : `${hm(e.start)}${e.end ? `–${hm(e.end)}` : ""}`}</span>
                <span className="what">{e.title}</span>
                <span className="who">{e.who.length ? `for ${e.who.join(", ")}` : "for everyone"}</span>
                <span className="by">{e.by ? `${e.by}${e.agent ? "'s agent" : ""}` : ""}</span>
                {removing === e.id ? (
                  <span className="ask" role="group" aria-label={`take ${e.title} off the calendar?`}>
                    <button className="wbtn" autoFocus onClick={() => { setRemoving(""); void room.tool("team.calendar.remove", { id: e.id }).then((r) => r.error && flash(r.error)); }}>take it off</button>
                    <button className="wbtn ghost" onClick={() => setRemoving("")}>keep</button>
                  </span>
                ) : <button className="x" aria-label={`take ${e.title} off the calendar`} title="take it off the calendar for everyone" onClick={() => setRemoving(e.id)}>×</button>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="tl-add">
        {form ? (
          <form onSubmit={(ev) => { ev.preventDefault(); void add(); }} onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); setForm(null); } }}>
            <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, error: undefined })} placeholder="what is it? the review, the deadline, the call" aria-label="the event's title" maxLength={120} />
            <span className="row">
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value, error: undefined })} aria-label="the day" />
              {/* all day is said, never read from an empty time box: WebKit draws an empty one as a time */}
              <button type="button" className={`chip ${form.allDay ? "on" : ""}`} aria-pressed={form.allDay} onClick={() => setForm({ ...form, allDay: !form.allDay, error: undefined })}>all day</button>
              {!form.allDay && <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value, error: undefined })} aria-label="the time" />}
            </span>
            <span className="row who" role="group" aria-label="who it is for">
              <span className="dim">for</span>
              {people.map((p) => <button type="button" key={p} className={`chip ${form.who.includes(p) ? "on" : ""}`} aria-pressed={form.who.includes(p)}
                onClick={() => setForm({ ...form, who: form.who.includes(p) ? form.who.filter((x) => x !== p) : [...form.who, p] })}>{p}</button>)}
              <span className="dim">{form.who.length ? "" : "everyone"}</span>
            </span>
            {form.error && <span className="err" role="alert">{form.error}</span>}
            <span className="acts"><button className="wbtn" type="submit" disabled={form.busy}>{form.busy ? "adding…" : "put it on the calendar"}</button><button className="wbtn ghost" type="button" onClick={() => setForm(null)}>cancel</button></span>
          </form>
        ) : <button className="tl-plus" onClick={() => { const d = new Date(); setForm({ title: "", date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, time: "10:00", allDay: true, who: [] }); }}><span aria-hidden="true">+</span> add an event or a deadline</button>}
      </div>
    </>)}
    <p className="rm-pg-foot rm-gp-foot">kept in the room's record · a Sol that is not running reminds nobody · two-way Google Calendar is not here</p>
  </>);
}

// ---- the decision log ----
function DecisionsPage({ room, onBack, flash, others, note }: PageProps) {
  const list = room.tools.decisions;
  const [form, setForm] = useState<{ title: string; lines: string; error?: string; busy?: boolean } | null>(null);
  const add = async () => {
    if (!form) return;
    if (!form.title.trim()) return setForm({ ...form, error: "say what was decided, in one line" });
    setForm({ ...form, busy: true, error: undefined });
    const r = await room.tool("team.decisions.add", { title: form.title, lines: form.lines });
    if (r.error) setForm({ ...form, busy: false, error: r.error }); else { setForm(null); flash("written in the room's decision log"); }
  };
  if (note && !list) return (<><Top onBack={onBack} /><Head id="decisions" others={others} /><p className="rm-pg-foot">{note}: the log shows once it has one</p></>);
  return (<>
    <Top onBack={onBack} />
    <Head id="decisions" others={others} />
    {!list ? <p className="rm-pg-foot">reading the room's decisions…</p> : (<>
      <div className="tl-add top">
        {form ? (
          <form onSubmit={(ev) => { ev.preventDefault(); void add(); }} onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); setForm(null); } }}>
            <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, error: undefined })} placeholder="what the room decided, in one line" aria-label="the decision" maxLength={120} />
            <textarea value={form.lines} onChange={(e) => setForm({ ...form, lines: e.target.value })} placeholder="why, and what it rules out (optional)" rows={3} aria-label="why" />
            {form.error && <span className="err" role="alert">{form.error}</span>}
            <span className="acts"><button className="wbtn" type="submit" disabled={form.busy}>{form.busy ? "writing…" : "write it in the log"}</button><button className="wbtn ghost" type="button" onClick={() => setForm(null)}>cancel</button></span>
            <span className="dim">the log is only added to: what is written stays as it was</span>
          </form>
        ) : <button className="tl-plus" onClick={() => setForm({ title: "", lines: "" })}><span aria-hidden="true">+</span> write down a decision</button>}
      </div>
      {list.length === 0 && <p className="tl-none">nothing decided yet: the first decision you write here is read by every agent before it works</p>}
      <ol className="tl-log">
        {list.map((d) => (
          <li key={d.id}>
            <h3>{d.title}</h3>
            <p className="by">{d.by || "someone"}{d.agent ? "'s agent" : ""}{d.at ? ` · ${new Date(d.at).getMonth() + 1}/${new Date(d.at).getDate()}` : ""}</p>
            {d.lines.trim() && <div className="lines">{d.lines.split("\n").filter((l) => l.trim()).map((l, i) => <p key={i}>{l.replace(/^\\#/, "#")}</p>)}</div>}
          </li>
        ))}
      </ol>
    </>)}
    <p className="rm-pg-foot rm-gp-foot">kept in the room's record, newest last in the file · agents read it with the goal, as the room's words</p>
  </>);
}

// ---- polls ----
function PollsPage({ team, room, people, onBack, flash, others, note }: PageProps & { team: Team; people: string[] }) {
  const list = room.tools.polls;
  const me = team.me;
  const [form, setForm] = useState<{ question: string; options: string[]; error?: string; busy?: boolean } | null>(null);
  const [old, setOld] = useState(false);
  const add = async () => {
    if (!form) return;
    const options = form.options.map((o) => o.trim()).filter(Boolean);
    if (!form.question.trim()) return setForm({ ...form, error: "ask a question, in one line" });
    if (options.length < 2) return setForm({ ...form, error: "two answers at least" });
    setForm({ ...form, busy: true, error: undefined });
    const r = await room.tool("team.polls.add", { question: form.question, options });
    if (r.error) setForm({ ...form, busy: false, error: r.error });
    else { setForm(null); flash(r.again ? "that question is open already: vote on it below" : "asked the room"); }
  };
  const vote = (p: Poll, i: number) => void room.tool("team.polls.vote", { id: p.id, option: i }).then((r) => r.error && flash(r.error));
  const close = (p: Poll) => void room.tool("team.polls.close", { id: p.id }).then((r) => r.error && flash(r.error));
  if (note && !list) return (<><Top onBack={onBack} /><Head id="polls" others={others} /><p className="rm-pg-foot">{note}: polls show once it has one</p></>);
  const open = (list ?? []).filter((p) => !p.closed), closed = (list ?? []).filter((p) => p.closed);
  return (<>
    <Top onBack={onBack} />
    <Head id="polls" others={others} />
    {!list ? <p className="rm-pg-foot">reading the room's polls…</p> : (<>
      <div className="tl-add top">
        {form ? (
          <form onSubmit={(ev) => { ev.preventDefault(); void add(); }} onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); setForm(null); } }}>
            <input autoFocus value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value, error: undefined })} placeholder="the question, in one line" aria-label="the question" maxLength={120} />
            {form.options.map((o, i) => (
              <input key={i} value={o} onChange={(e) => setForm({ ...form, options: form.options.map((x, j) => (j === i ? e.target.value : x)), error: undefined })} placeholder={`answer ${i + 1}`} aria-label={`answer ${i + 1}`} maxLength={60} />
            ))}
            {form.options.length < 5 && <button type="button" className="rm-th-link u" onClick={() => setForm({ ...form, options: [...form.options, ""] })}>+ another answer</button>}
            {form.error && <span className="err" role="alert">{form.error}</span>}
            <span className="acts"><button className="wbtn" type="submit" disabled={form.busy}>{form.busy ? "asking…" : "ask the room"}</button><button className="wbtn ghost" type="button" onClick={() => setForm(null)}>cancel</button></span>
          </form>
        ) : <button className="tl-plus" onClick={() => setForm({ question: "", options: ["", ""] })}><span aria-hidden="true">+</span> ask the room a question</button>}
      </div>
      {open.length === 0 && <p className="tl-none">no open poll</p>}
      <ul className="tl-polls">{open.map((p) => <PollCard key={p.id} p={p} me={me} people={people} vote={vote} close={close} />)}</ul>
      {closed.length > 0 && <button className="rm-th-link tl-early" onClick={() => setOld((x) => !x)}>{old ? "hide the closed ones" : `${closed.length} closed`}</button>}
      {old && <ul className="tl-polls">{closed.map((p) => <PollCard key={p.id} p={p} me={me} people={people} vote={vote} close={close} />)}</ul>}
    </>)}
    <p className="rm-pg-foot rm-gp-foot">kept in the room's record · who voted what is the room's to see · an agent may ask, never vote</p>
  </>);
}

// one poll: its question, a bar an answer (mine outlined, who voted as their hands), and close while it is open. Its own
// component, outside the page, so a vote's new list keeps the focus on the answer pressed
function PollCard({ p, me, people, vote, close }: { p: Poll; me: string; people: string[]; vote: (p: Poll, i: number) => void; close: (p: Poll) => void }) {
  const n = Object.keys(p.votes).length, mine = p.votes[me];
  return (
    <li className={`tl-poll ${p.closed ? "closed" : ""}`}>
      <h3>{p.question}</h3>
      <p className="by">asked by {p.by || "someone"}{p.agent ? "'s agent" : ""} · {n} of {people.length} voted{p.closed ? ` · closed by ${p.closed.by || "someone"}` : ""}</p>
      <ul className="opts" role={p.closed ? undefined : "radiogroup"} aria-label={p.question}>
        {p.options.map((o, i) => {
          const who = Object.keys(p.votes).filter((k) => p.votes[k] === i).sort();
          const w = n ? Math.round((who.length / n) * 100) : 0;
          return (
            <li key={i}>
              <button disabled={!!p.closed} role={p.closed ? undefined : "radio"} aria-checked={p.closed ? undefined : mine === i} className={mine === i ? "mine" : ""} onClick={() => vote(p, i)}
                title={p.closed ? `${o}: ${who.length}` : mine === i ? "your vote" : `vote ${o}`}>
                <span className="bar" style={{ transform: `scaleX(${w / 100})` }} aria-hidden="true" />
                <span className="o">{o}</span>
                <span className="hands" aria-label={who.length ? `${who.join(", ")}` : "no votes"}>{who.map((x) => <Who key={x} login={x} size={16} title={x} />)}</span>
                <span className="n">{who.length}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {!p.closed && <button className="rm-th-link u tl-close" onClick={() => close(p)}>close the poll</button>}
    </li>
  );
}
