// The room (#234; the studio PRD §3–§4, frame s1 of vM.html): Cowork's first page. Top to bottom: the people (one
// small worker each, what they are on), the goal (one line, set by hand), the things we are making (one rounded square
// each, a person's mark on the one they are in, the tile ringed in their band), and a line to tell my agent what to start. Beside it: what happened,
// and the room's talk. Everything else (the board, try, ship, hands, settings) is one click away, never on this page.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Team, Member } from "./useTeam";
import type { Room as RoomData, Thing, ThingKind, FeedLine, Folder } from "./useRoom";
import { GLYPHS, type Cell } from "./pixels";
import { since, readAgo, STATE_WORD, Who, useBand } from "./bits";
import { date, hhmm } from "./util";
import { Sol } from "../Sol";
import { Talk } from "./Talk";
import { ThingPane } from "./ThingPane";   // S2: a thing opened in the centre (#236)
import { PersonMain, PersonSide, personOf } from "./Person";   // S3: a person (#238)
import { GoalPage } from "./Goal";   // S6: the goal (#238)
import { ToolPage, TOOLS, toolLine } from "./Tools";   // the room's own tools, pinned first (ADDITIONS §1, #245)
import type { ToolId } from "./useRoom";
import "./room.css";

/** a glyph of the creature's grammar: integer cells, crisp at any size */
export function Glyph({ kind, size = 56 }: { kind: string; size?: number }) {
  const cells: Cell[] = GLYPHS[kind] ?? GLYPHS.web;
  return <svg className="rm-glyph" viewBox="0 0 14 14" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">{cells.map(([x, y, w, h, f], i) => <rect key={i} x={x} y={y} width={w} height={h} fill={f} />)}</svg>;
}

const KIND_WORD: Record<ThingKind, string> = { doc: "a doc", slides: "slides", sheet: "a sheet", github: "a repository", figma: "a Figma file", web: "a page", file: "a file" };

export function Room({ team, room, onPerson, onGoal, onThing, onRepo, onStart, flash, open, onClose, onShrink, onWork, person, goal, onBack, onHand, tool, onTool }: {
  team: Team; room: RoomData; onPerson: (login: string) => void; onGoal: () => void; onThing: (t: Thing) => void; onRepo: (t: Thing) => void;
  onStart: (text: string, thing?: Thing) => Promise<boolean>; flash: (s: string) => void;
  /** S2 (#236): the thing open in the centre, the people strip above it and the right column beside it as on S1 */
  open?: Thing | null; onClose?: () => void; onShrink?: () => void; onWork?: (t: Thing) => void;
  /** S3 (#238): a person's page in the centre, their conversation on the right; S6: the goal's page in the centre */
  person?: string | null; goal?: boolean; onBack?: () => void; onHand?: () => void;
  /** one of the room's own tools open in the centre (#245): Sol's own page, never a web view */
  tool?: ToolId | null; onTool?: (id: ToolId) => void;
}) {
  const s = team.state, me = team.me;
  const band = useBand();   // a person's family band: the ring on a tile they are in, and the neck to their mark
  const roster = s?.roster ?? [];
  const up = !!s?.relay.up;
  // the people: me first, then who is on, then every member of the room
  const people = useMemo(() => [...new Set([me, ...roster.map((m) => m.who), ...(s?.members ?? [])].filter(Boolean))], [me, roster, s?.members]);
  const name = s?.settings.rooms.find((r) => r.id === s.settings.room)?.name ?? "this room";
  const [line, setLine] = useState("");
  const [adding, setAdding] = useState<{ url: string; error?: string } | null>(null);
  const box = useRef<HTMLInputElement>(null);
  // the thing a line names: a name of three characters or more, whole, in the line; shown under the box, and dropped
  // with one click, so nothing goes beside a session unseen
  const [unnamed, setUnnamed] = useState("");
  const [removing, setRemoving] = useState("");   // the thing whose × was pressed: asked once, inline ("f:<id>" a folder's)
  // folders (#248, ADDITIONS §2): the folder I am in ("" the top), the thing whose "move to…" is open, a folder being
  // named, the thing being dragged and the drop target under it ("top" the breadcrumb's first crumb)
  const [at, setAt] = useState("");
  const [menu, setMenu] = useState("");
  const [making, setMaking] = useState<{ name: string; error?: string } | null>(null);
  const [drag, setDrag] = useState("");
  const [over, setOver] = useState("");
  useEffect(() => { setAt(""); setMenu(""); setMaking(null); }, [s?.settings.room]);
  // a folder someone else took off while I was in it: back to the top, and a half-typed add there is not kept
  useEffect(() => { if (at && room.folders && !room.folders.some((f) => f.id === at)) { setAt(""); setAdding(null); } }, [at, room.folders]);
  // the open "move to…" closes on a press outside it (a document pointerdown, not a blur: WebKit gives a button no
  // focus on click, so a blur there would close the menu before its own item got the click)
  const menuEl = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menu) return;
    const out = (e: PointerEvent) => { const n = e.target as Node; if (!menuEl.current?.contains(n) && !(n as Element).closest?.(".rm-tile-mv")) setMenu(""); };
    document.addEventListener("pointerdown", out, true);
    return () => document.removeEventListener("pointerdown", out, true);
  }, [menu]);
  // a tile moved or gone under a drag (another Sol's push): the drag is over
  useEffect(() => { if (drag && !room.things.some((t) => t.id === drag)) { setDrag(""); setOver(""); } }, [drag, room.things]);
  const named = useMemo(() => {
    const low = line.toLowerCase();
    const hit = room.things.filter((t) => t.name.trim().length >= 3).find((t) => {
      const n = t.name.toLowerCase().trim(), at = low.indexOf(n);
      return at >= 0 && !/[\p{L}\p{N}]/u.test(low[at - 1] ?? " ") && !/[\p{L}\p{N}]/u.test(low[at + n.length] ?? " ");
    });
    return hit && hit.id !== unnamed ? hit : null;
  }, [line, room.things, unnamed]);

  const entryOf = (who: string): Member | undefined => roster.find((m) => m.who === who);
  // S3: their conversation is open on the right until closed; a new person opens it again
  const [convo, setConvo] = useState(true);
  useEffect(() => setConvo(true), [person]);
  // the thing a person stands on: their roster's, else the things' own word (an engine before round 44 says neither)
  const onThingOf = (who: string) => room.things.find((t) => entryOf(who)?.thing?.id === t.id || t.inNow.includes(who));

  const start = async () => {
    const text = line.trim();
    if (!text) return;
    // the line names one of the things, or clearly concerns it: that thing goes beside the session
    if (await onStart(text, named ?? undefined)) { setLine(""); setUnnamed(""); }
  };
  const folders = room.folders ?? [];
  const folderIds = new Set(folders.map((f) => f.id));
  const here = folders.find((f) => f.id === at);
  const cur = here?.id ?? "";   // a folder gone (taken off by someone else) is the top again
  // the folder a thing is in, "" the top (a parent that is not a folder is the top)
  const placeOf = (t: Thing) => (t.parent && folderIds.has(t.parent) ? t.parent : "");
  const touched = (t: Thing) => Date.parse(t.lastTouch.at || t.at) || 0;
  // a folder's things, every level under it; who stands on any of them; when the newest of them was touched
  const under = (f: Folder): Thing[] => [...room.things.filter((t) => t.parent === f.id), ...folders.filter((x) => x.parent === f.id).flatMap(under)];
  const folderTouched = (f: Folder) => Math.max(Date.parse(f.at) || 0, ...under(f).map(touched));
  // as Drive: folders first, then things, each the most recently touched first
  const shownFolders = folders.filter((f) => (f.parent && folderIds.has(f.parent) ? f.parent : "") === cur).sort((a, b) => folderTouched(b) - folderTouched(a));
  const shown = room.things.filter((t) => placeOf(t) === cur).sort((a, b) => touched(b) - touched(a));
  const lead = cur ? 0 : TOOLS.length;   // the room's own tools stand first at the top (#245); the motion counts them
  const trail: Folder[] = [];
  for (let f = here; f && trail.length < 8; f = folders.find((x) => x.id === f!.parent)) trail.unshift(f);
  // folders can be made and things moved when this engine knows folders and the room's things can be written
  const canFold = room.folders !== undefined && !room.readOnly && !room.thingsNote;
  const inThing = (t: Thing) => people.filter((who) => entryOf(who)?.thing?.id === t.id || t.inNow.includes(who));
  const moveTo = async (id: string, to: string) => {
    setMenu(""); setDrag(""); setOver("");
    const t = room.things.find((x) => x.id === id);
    if (!t || placeOf(t) === to) return;
    const r = await room.move(id, to);
    if (r.error) flash(r.error);
  };
  // the room's first folder turns its file v2: an older Sol then only reads the things, so the form says so and the
  // press is the person's word that everyone here has updated (ADDITIONS §2)
  const first = folders.length === 0;
  const makeFolder = async () => {
    if (!making) return;
    const r = await room.folderAdd(making.name, first);
    if (r.error) setMaking({ ...making, error: r.error }); else setMaking(null);
  };
  // a tile or a crumb a thing may be dropped on
  const dropOn = (to: string, key: string) => canFold ? {
    onDragOver: (e: React.DragEvent) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== key) setOver(key); },
    onDragLeave: () => setOver((o) => (o === key ? "" : o)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); const id = drag || e.dataTransfer.getData("text/plain"); if (id) void moveTo(id, to); },
  } : {};
  const add = async () => {
    if (!adding?.url.trim()) return;
    const r = await room.add(adding.url.trim(), cur || undefined);
    if (r.error) return setAdding({ ...adding, error: r.error });
    setAdding(null);
    // the same thing again (ADDITIONS §5): nothing new; the one already here opens (wherever it is), and the feed says so
    if (r.again && r.thing) {
      const where = r.thing.parent && folderIds.has(r.thing.parent) ? ` in ${folders.find((f) => f.id === r.thing!.parent)!.name}` : "";
      flash(`already here: ${r.thing.name}${where}, opened the existing one`);
      if (r.thing.kind === "github") onRepo(r.thing); else onThing(r.thing);
    }
  };

  return (
    <div className="rm-room">
      <div className="rm-centre">
        {/* the people: one small worker each, what they are on, for how long */}
        <div className="rm-strip" role="list" aria-label="the people in this room">
          {people.map((who) => {
            const m = entryOf(who), mine = who === me, t = onThingOf(who);
            const dark = !mine && (!up || !m);
            const state = m?.state ?? (mine ? "here" : undefined);
            const what = t ? `in ${t.name}` : m?.session?.title ? m.session.title : dark ? "not seen" : STATE_WORD[state ?? "here"];
            return (
              <span key={who} role="listitem" className="rm-li"><button className={`rm-worker ${dark ? "unseen" : ""} ${person === who ? "on" : ""}`} aria-current={person === who ? "page" : undefined} onClick={() => onPerson(who)}
                title={`${who}${mine ? " (you)" : ""}: ${what}. Click for what they did here.`}>
                <Who login={who} size={34} away={dark || state === "away"} working={!dark && state === "working"} needs={!dark && state === "yourcall"} />
                <span className="tx">
                  <span className="n">{who}{mine && <span> (you)</span>}</span>
                  <span className="l">{what}{m && !dark ? ` · ${since(m.since)}` : ""}</span>
                </span>
              </button></span>
            );
          })}
        </div>

        {person ? (
          <PersonMain team={team} room={room} login={person} entry={personOf(roster, person)} roomName={name} onBack={() => onBack?.()}
            onThing={(t) => (t.kind === "github" ? onRepo(t) : onThing(t))} convo={convo} onConvo={() => setConvo(true)} />
        ) : goal ? (
          <GoalPage key={s?.settings.room} team={team} room={room} onBack={() => onBack?.()} flash={flash} />
        ) : tool ? (
          <ToolPage key={`${s?.settings.room}:${tool}`} team={team} room={room} id={tool} people={people} onBack={() => onBack?.()} flash={flash} />
        ) : open ? (
          <ThingPane team={team} thing={open} mode="s2"
            me={{ working: entryOf(me)?.state === "working" }}
            others={people.filter((who) => who !== me && (entryOf(who)?.thing?.id === open.id || open.inNow.includes(who)))
              .map((who) => ({ who, working: entryOf(who)?.state === "working" }))}
            onBack={onClose} onShrink={onShrink} onWork={() => onWork?.(open)} />
        ) : (<>
        {/* the goal: one line, set by hand, read by every agent before it works */}
        <button className="rm-goal" onClick={onGoal} title="the room's goal: set by hand, read by every agent before it works. Click to open it and its files.">
          <Glyph kind="flag" size={34} />
          <span className="gk">goal</span>
          {room.goal?.title ? (
            <span className="gtx">
              <span className="gt">{room.goal.title}</span>
              <span className="gs">set by {room.goal.setBy || "someone"}{room.goal.at ? ` · ${date(room.goal.at)}` : ""} · {room.goal.files.length} file{room.goal.files.length === 1 ? "" : "s"}</span>
            </span>
          ) : (
            <span className="gtx"><span className="gt dimt">nothing set yet</span><span className="gs">{room.goal?.note ?? "set a goal, so everyone and every agent knows what this room is for"}</span></span>
          )}
          <span className="op">{room.goal?.title ? "open ›" : "set a goal ›"}</span>
        </button>

        {/* this room moved to the cloud (#246): one click joins the new room by its code, or goes there when I am in it */}
        {room.moved && (
          <div className="rm-moved" role="status">
            <span><b>this room moved to the cloud</b> as {room.moved.name}{room.moved.by ? `, moved by ${room.moved.by}` : ""}{room.moved.at ? ` · ${date(room.moved.at)}` : ""}. What is said and added here now happens there.</span>
            <button className="wbtn" onClick={() => void (room.moved!.have
              ? team.ask("team.settings", { patch: { room: room.moved!.have } })
              : team.ask<{ room?: { name?: string }; error?: string }>("team.room.join", { code: room.moved!.code }).then((r) => flash(r.error ? `couldn't join: ${r.error}` : `you are in ${r.room?.name ?? "the new room"} on the cloud`)))}>
              {room.moved.have ? "go there ›" : `join it (${room.moved.code}) ›`}
            </button>
          </div>
        )}
        {/* the things: one rounded square each; a person's mark on a thing, its ring in their band, means they are in it now */}
        <div className="rm-gh">
          <nav className="rm-crumbs" aria-label="where you are in the room's things">
            <b>what we're making in </b>
            {cur ? <button className={`rm-crumb ${over === "top" ? "drop" : ""}`} onClick={() => setAt("")} title={`back to everything in ${name}${canFold ? "; drop a thing here to move it out of the folder" : ""}`} {...dropOn("", "top")}>{name}</button>
              : <b aria-current="page">{name}</b>}
            {trail.map((f, i) => (
              <span key={f.id} className="rm-crumb-on"><span className="sep" aria-hidden="true">›</span>
                {i === trail.length - 1 ? <b aria-current="page">{f.name}</b> : <button className={`rm-crumb ${over === f.id ? "drop" : ""}`} onClick={() => setAt(f.id)} {...dropOn(f.id, f.id)}>{f.name}</button>}
              </span>
            ))}
          </nav>
          {!making && <span>{cur ? `${shown.length} thing${shown.length === 1 ? "" : "s"} here` : `${room.things.length} thing${room.things.length === 1 ? "" : "s"}${folders.length ? ` · ${folders.length} folder${folders.length === 1 ? "" : "s"}` : ""}`} · a mark on a tile means that person is in it now</span>}
          {canFold && !cur && (making ? (
            <form className="rm-mkfolder" onSubmit={(e) => { e.preventDefault(); void makeFolder(); }}>
              <input autoFocus value={making.name} maxLength={60} placeholder="the folder's name" aria-label="the new folder's name"
                onChange={(e) => setMaking({ name: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setMaking(null)} />
              <button type="submit" className="wbtn">{first ? "all updated, make it" : "make"}</button><button type="button" className="wbtn ghost" onClick={() => setMaking(null)}>cancel</button>
              {making.error ? <span className="err" role="alert">{making.error}</span>
                : first && <span className="warn">the first folder: older Sols then only read this room’s things</span>}
            </form>
          ) : <button className="rm-newfolder" onClick={() => setMaking({ name: "" })} title="a folder for some of the room's things, as in Google Drive">+ new folder</button>)}
        </div>
        <div className="rm-grid-wrap">
          {room.thingsNote && <p className="rm-note">{room.thingsNote}: things and the goal show once it has one</p>}
          {room.readOnly && <p className="rm-note">this room's things were written by a newer Sol: you can open them; update Sol to add, move or take any off</p>}
          {cur && !shown.length && <p className="rm-note">nothing in {here!.name} yet: drag a thing onto it in {name}, use a thing's “move to…”, or add one here</p>}
          <div className="rm-grid">
            {/* the room's own tools, pinned first at the top (#245): Sol's own pages; a mark when someone has one open */}
            {!cur && TOOLS.map((t, ti) => {
              const inNow = people.filter((who) => entryOf(who)?.thing?.id === t.tile);
              const who = inNow[0], col = who ? band(who) : undefined;
              return (
                <div key={t.id} className={`rm-tile own ${who ? "in" : ""}`} style={{ "--i": ti, ...(col ? { "--fam": col } : {}) } as React.CSSProperties}>
                  <button className="rm-tile-in" onClick={() => onTool?.(t.id)} title={`${t.name}: ${t.line}. Sol's own page; click to open it.`}>
                    <Glyph kind={t.glyph} size={56} />
                    <span className="nm">{t.name}</span>
                    {who ? <span className="wh now">{who}{inNow.length > 1 ? ` and ${inNow.length - 1} more` : ""} · in it now</span>
                      : <span className="wh">{toolLine(t.id, room)}</span>}
                  </button>
                  <span className="rm-tile-tag" aria-hidden="true">sol</span>
                  {who && <span className="rm-tile-hand"><i className="neck" aria-hidden="true" /><Who login={who} size={28} working={entryOf(who)?.state === "working"} title={`${who} is in it now`} /></span>}
                </div>
              );
            })}
            {shownFolders.map((f, fi) => {
              const inside = under(f), n = inside.length;
              const there = [...new Set(inside.flatMap(inThing))];
              const last = inside.reduce<Thing | null>((b, t) => (!b || touched(t) > touched(b) ? t : b), null);
              const lastWho = last ? last.lastTouch.who || last.addedBy : f.by, lastAt = last ? last.lastTouch.at || last.at : f.at;
              const col = there[0] ? band(there[0]) : undefined;
              return (
                <div key={f.id} className={`rm-tile folder ${there.length ? "in" : ""} ${over === f.id ? "drop" : ""}`} style={{ "--i": Math.min(lead + fi, 11), ...(col ? { "--fam": col } : {}) } as React.CSSProperties} {...dropOn(f.id, f.id)}>
                  <button className="rm-tile-in" onClick={() => { setAt(f.id); setMenu(""); }}
                    title={`a folder: ${f.name}, ${n} thing${n === 1 ? "" : "s"}. Click to go in${canFold ? "; drop a thing on it to move it in" : ""}.`}>
                    <Glyph kind="folder" size={56} />
                    <span className="nm">{f.name}</span>
                    {there.length ? <span className="wh now">{there.join(", ")} · in it now</span>
                      : <span className="wh">{n} thing{n === 1 ? "" : "s"}{lastWho ? ` · ${lastWho}` : ""}{lastAt ? ` · ${since(lastAt) === "now" ? "now" : `${since(lastAt)} ago`}` : ""}</span>}
                  </button>
                  {there.length > 0 && <span className="rm-tile-hand stack"><i className="neck" aria-hidden="true" />{there.slice(0, 3).map((who) => <Who key={who} login={who} size={26} working={entryOf(who)?.state === "working"} title={`${who} is in a thing in ${f.name}`} />)}</span>}
                  {canFold && (removing === `f:${f.id}` ? (
                    <span className="rm-tile-ask" role="group" aria-label={`take the folder ${f.name} off?`}>
                      <span>take the folder off? {n ? `its ${n} thing${n === 1 ? "" : "s"} move${n === 1 ? "s" : ""} up to ${trail.length ? trail[trail.length - 1].name : name}` : "it is empty"}</span>
                      <button className="wbtn" autoFocus onClick={() => { setRemoving(""); void room.unfolder(f.id).then((r) => r.error && flash(r.error)); }}>yes</button>
                      <button className="wbtn ghost" onClick={() => setRemoving("")}>no</button>
                    </span>
                  ) : (
                    <button className="rm-tile-x" title={`take the folder ${f.name} off; what is in it moves up one level, nothing is lost`} aria-label={`remove the folder ${f.name}`}
                      onClick={() => setRemoving(`f:${f.id}`)}>×</button>
                  ))}
                </div>
              );
            })}
            {shown.map((t, ti) => {
              const inNow = inThing(t);
              const who = inNow[0], col = who ? band(who) : undefined;
              const working = who ? entryOf(who)?.state === "working" : false;
              const by = entryOf(who ?? "")?.thing?.source === "agent" ? `${who}'s agent` : who;
              const targets: { id: string; name: string }[] = canFold ? [...(cur ? [{ id: "", name: `${name} (the top)` }] : []), ...folders.filter((f) => f.id !== cur).map((f) => ({ id: f.id, name: f.name }))] : [];
              return (
                <div key={t.id} className={`rm-tile ${who ? "in" : ""} ${drag === t.id ? "dragging" : ""}`} style={{ "--i": Math.min(lead + shownFolders.length + ti, 11), ...(col ? { "--fam": col } : {}) } as React.CSSProperties}
                  draggable={canFold && targets.length > 0} onDragStart={(e) => { setDrag(t.id); setMenu(""); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); }}
                  onDragEnd={() => { setDrag(""); setOver(""); }}>
                  <button className="rm-tile-in" onClick={() => (t.kind === "github" ? onRepo(t) : onThing(t))}
                    title={`${KIND_WORD[t.kind]}: ${t.name}. Click to open it${t.kind === "github" ? "'s cards" : " here"}.`}>
                    <Glyph kind={t.kind} size={56} />
                    <span className="nm">{t.name}</span>
                    {who ? <span className="wh now">{by} · {working ? "changing it now" : "in it now"}</span>
                      : <span className="wh">{t.lastTouch.who || t.addedBy} · {since(t.lastTouch.at || t.at) === "now" ? "now" : `${since(t.lastTouch.at || t.at)} ago`}</span>}
                  </button>
                  {who && <span className="rm-tile-hand"><i className="neck" aria-hidden="true" /><Who login={who} size={28} working={working} title={`${by} is in it now`} /></span>}
                  {targets.length > 0 && removing !== t.id && (
                    <button className="rm-tile-mv" aria-haspopup="menu" aria-expanded={menu === t.id} aria-label={`move ${t.name} to…`} title="move to a folder"
                      onClick={() => setMenu(menu === t.id ? "" : t.id)}>⋯</button>
                  )}
                  {menu === t.id && (
                    <span className="rm-tile-menu" role="menu" aria-label={`move ${t.name} to`}
                      onKeyDown={(e) => { if (e.key === "Escape") { setMenu(""); (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus(); } }}
                      ref={menuEl}>
                      <span className="hd">move to…</span>
                      {targets.map((x, i) => <button key={x.id || "top"} role="menuitem" autoFocus={i === 0} onClick={() => void moveTo(t.id, x.id)}><Glyph kind="folder" size={14} />{x.name}</button>)}
                      <button role="menuitem" className="cancel" onClick={() => setMenu("")}>cancel</button>
                    </span>
                  )}
                  {room.readOnly ? null : removing === t.id ? (
                    <span className="rm-tile-ask" role="group" aria-label={`take ${t.name} off the room?`}>
                      <span>take it off for everyone?</span>
                      <button className="wbtn" autoFocus onClick={() => { setRemoving(""); void room.remove(t.id).then((r) => r.error && flash(r.error)); }}>yes</button>
                      <button className="wbtn ghost" onClick={() => setRemoving("")}>no</button>
                    </span>
                  ) : (
                    <button className="rm-tile-x" title={`take ${t.name} off this room's things (the link itself is untouched; the room's record keeps who did)`} aria-label={`remove ${t.name}`}
                      onClick={() => setRemoving(t.id)}>×</button>
                  )}
                </div>
              );
            })}
            {/* the last tile: add a thing (a link pasted; an agent adds with room_thing_add) */}
            {!room.readOnly && <div className="rm-tile add" style={{ "--i": Math.min(lead + shownFolders.length + shown.length, 11) } as React.CSSProperties}>
              {adding ? (
                <form className="rm-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
                  <input autoFocus value={adding.url} placeholder="paste a link (https)" aria-label="the link of the thing"
                    onChange={(e) => setAdding({ url: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setAdding(null)} />
                  {adding.error ? <span className="err">{adding.error}</span> : <span className="wh">a Google Doc, Slides, a Sheet, a repo, Figma, a page</span>}
                  <span className="acts"><button type="submit" className="wbtn">add</button><button type="button" className="wbtn ghost" onClick={() => setAdding(null)}>cancel</button></span>
                </form>
              ) : (
                <button className="rm-tile-in" onClick={() => setAdding({ url: "" })} title={`add a thing the room is making${cur ? ` to ${here!.name}` : ""}: paste its link`}>
                  <Glyph kind="add" size={56} />
                  <span className="nm">+ add a thing{cur ? ` to ${here!.name}` : ""}</span>
                  <span className="wh">a doc, a sheet, a site, a repo, a file</span>
                </button>
              )}
            </div>}
          </div>
        </div>

        {/* the box: me and my own agent; it opens a session under this room, the thing beside it */}
        <form className="rm-box" onSubmit={(e) => { e.preventDefault(); void start(); }}>
          <input ref={box} value={line} onChange={(e) => setLine(e.target.value)} aria-label="tell your agent what you want to start"
            placeholder="tell your agent what you want to start · it opens a session here, the thing beside it" />
          {named && <button type="button" className="rm-chip" onClick={() => setUnnamed(named.id)} title={`${named.name} goes beside the session; click to leave it out`}>
            <Glyph kind={named.kind} size={14} />{named.name} ×</button>}
          <span className="k" aria-hidden="true">↵</span>
        </form>
        </>)}
      </div>

      {person && convo ? (
        <PersonSide team={team} login={person} entry={personOf(roster, person)} roomName={name} onClose={() => setConvo(false)} onHand={() => onHand?.()} flash={flash} />
      ) : (
        <aside className="rm-side">
          <Happened lines={room.feed} readAt={room.readAt} error={room.feedError} />
          <div className="rm-talk"><Talk team={team} flash={flash} /></div>
        </aside>
      )}
    </div>
  );
}

/** what happened, newest first; each line wears its person's mark (an agent wears its person's), Sol's own when no one */
function Happened({ lines, readAt, error }: { lines: FeedLine[]; readAt?: number; error?: string }) {
  return (
    <section className="rm-feed" aria-label="what happened">
      <div className="fh"><b>what happened</b><span className="mono">{error ? "couldn't read" : readAt ? readAgo(readAt) : "newest first"}</span></div>
      <ol className="flist">
        {lines.length === 0 && <li className="none">nothing yet: what anyone does in this room shows here</li>}
        {lines.slice(0, 60).map((l) => (
          <li key={l.id} className={l.agent ? "ag" : ""} title={l.ephemeral ? "live: seen as it happened, not kept" : "from the room's record"}>
            <time dateTime={l.at}>{hhmm(l.at)}</time>
            <span>{l.who ? <Who login={l.who} size={14} className="fwho" /> : <span className="cwho fwho"><Sol size={14} /></span>}<b>{l.who ? (l.agent ? `${l.who}'s agent` : l.who) : "sol"}</b> {l.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
