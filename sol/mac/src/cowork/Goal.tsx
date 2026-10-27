// The goal (#238; the studio PRD §6, frame s6 of vM.html): one per room, set by hand, read by every agent before it
// works. Its title, a few plain lines of what done looks like, and the files and prompts beside it (text under
// .sol/goal/ in the room's record, 64 KB each at most; the engine refuses anything else). No progress, no checkboxes.
import { useRef, useState } from "react";
import type { Team } from "./useTeam";
import type { Room as RoomData } from "./useRoom";
import { Glyph } from "./Room";

const MAX = 64 * 1024;
const date = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(+d) ? "" : `${d.getMonth() + 1}/${d.getDate()}`; };
/** a file's name as the record takes it (goal.ts NAME): a to z, digits, dots, dashes, underscores and spaces, 80 at
 *  most, never starting with a dot or ending with one */
export const goalName = (s: string) => s.replace(/[^A-Za-z0-9._ -]+/g, " ").replace(/\s+/g, " ").trim().replace(/^[^A-Za-z0-9_]+/, "").replace(/[. ]+$/, "").slice(0, 80);

export function GoalPage({ team, room, onBack, flash }: { team: Team; room: RoomData; onBack: () => void; flash: (s: string) => void }) {
  const g = room.goal;
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(""), [lines, setLines] = useState("");
  const [open, setOpen] = useState<{ name: string; text?: string; error?: string } | null>(null);
  const [adding, setAdding] = useState<{ name: string; text: string; error?: string; busy?: boolean } | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const editing = edit || (!!g && !g.title && !g.note);
  const startEdit = () => { setTitle(g?.title ?? ""); setLines(g?.lines ?? ""); setEdit(true); };
  const save = async () => {
    const r = await team.ask<{ error?: string }>("team.goal.set", { title, lines });
    if (r.error) flash(r.error); else { setEdit(false); void room.read(); }
  };
  const read = async (name: string) => {
    if (open?.name === name) { setOpen(null); return; }
    setOpen({ name });
    const r = await team.ask<{ text?: string; error?: string }>("team.goal.file", { name });
    setOpen((o) => (o?.name === name ? { name, ...(typeof r.text === "string" ? { text: r.text } : { error: r.error ?? "couldn't read it" }) } : o));
  };
  const add = async () => {
    if (!adding) return;
    const name = goalName(adding.name);
    if (!name) return setAdding({ ...adding, error: "give it a name in plain letters, like grill prompt.md" });
    if (!adding.text.trim()) return setAdding({ ...adding, error: "paste the prompt, or pick a text file" });
    if (new Blob([adding.text]).size > MAX) return setAdding({ ...adding, error: "a goal file is text of 64 KB at most" });
    setAdding({ ...adding, busy: true, error: undefined });
    const r = await team.ask<{ error?: string }>("team.goal.add_file", { name, text: adding.text });
    if (r.error) setAdding({ ...adding, busy: false, error: r.error }); else { setAdding(null); void room.read(); flash(`${name} is beside the goal`); }
  };
  const file = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX) return setAdding({ name: f.name, text: "", error: "a goal file is text of 64 KB at most" });
    const text = await f.text();
    if (text.includes("\u0000")) return setAdding({ name: f.name, text: "", error: "a goal file is text, not a binary file" });
    setAdding({ name: goalName(f.name), text });
  };

  return (
    <div className="rm-page rm-gp">
      <div className="rm-pg-top">
        <button className="rm-th-link" onClick={onBack}>‹ the room</button>
        <span className="rm-th-sp" />
        {g && !g.note && !editing && <button className="rm-th-link u" onClick={startEdit}>edit</button>}
      </div>
      {!g ? <p className="rm-pg-foot">reading the room's goal…</p> : g.note ? <p className="rm-pg-foot">{g.note}: the goal shows once it has one</p> : (<>
        <Glyph kind="flag" size={56} />
        {editing ? (
          <form className="rm-sh-form rm-gp-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="one line: what this room is for" aria-label="the goal" maxLength={120} />
            <textarea value={lines} onChange={(e) => setLines(e.target.value)} placeholder="a few plain lines: what done looks like (optional)" rows={4} aria-label="what done looks like" />
            <span className="acts"><button className="wbtn" type="submit" disabled={!title.trim()}>set the goal</button>{g.title && <button className="wbtn ghost" type="button" onClick={() => setEdit(false)}>cancel</button>}</span>
          </form>
        ) : (<>
          <h2 className="rm-gp-t">{g.title}</h2>
          <p className="rm-gp-s">set by {g.setBy || "someone"}{g.at ? ` · ${date(g.at)}` : ""}</p>
          {g.lines.trim() && <div className="rm-gp-lines">{g.lines.split("\n").filter((l) => l.trim()).map((l, i) => <p key={i}>{l}</p>)}</div>}
        </>)}
        <h3 className="rm-pg-h">files and prompts · {g.files.length}</h3>
        <ul className="rm-gp-files">
          {g.files.map((f, i) => (
            <li key={f.name} className={open?.name === f.name ? "on" : ""} style={{ "--i": Math.min(i, 11) } as React.CSSProperties}>
              <button onClick={() => void read(f.name)} aria-expanded={open?.name === f.name} title={`open ${f.name}`}>
                <Glyph kind="file" size={22} />
                <span className="nm">{f.name}</span>
                <span className="by">{f.by ? `added by ${f.by}` : ""}</span>
                <span className="at">{date(f.at)}</span>
              </button>
              {open?.name === f.name && (
                <div className="rm-gp-read">
                  {open.text !== undefined ? <pre>{open.text || "(empty)"}</pre> : <p className="dim">{open.error ?? "reading…"}</p>}
                </div>
              )}
            </li>
          ))}
          <li className="add">
            {adding ? (
              <form className="rm-gp-add" onSubmit={(e) => { e.preventDefault(); void add(); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAdding(null); } }}>
                <input autoFocus value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value, error: undefined })} placeholder="its name, like grill prompt.md" aria-label="the file's name" maxLength={80} />
                <textarea value={adding.text} onChange={(e) => setAdding({ ...adding, text: e.target.value, error: undefined })} placeholder="paste a prompt or a brief: text, 64 KB at most" rows={6} aria-label="the file's text" />
                {adding.error && <span className="err" role="alert">{adding.error}</span>}
                <span className="acts">
                  <button className="wbtn" type="submit" disabled={adding.busy}>{adding.busy ? "adding…" : "put it beside the goal"}</button>
                  <button className="wbtn ghost" type="button" onClick={() => pick.current?.click()}>or pick a text file</button>
                  <button className="wbtn ghost" type="button" onClick={() => setAdding(null)}>cancel</button>
                </span>
              </form>
            ) : (
              <button onClick={() => setAdding({ name: "", text: "" })}><span className="plus" aria-hidden="true">+</span><span className="nm">add a file or paste a prompt</span></button>
            )}
            <input ref={pick} type="file" hidden accept=".md,.txt,.markdown,.json,.csv,text/*" onChange={(e) => { void file(e.target.files?.[0]); e.target.value = ""; }} />
          </li>
        </ul>
      </>)}
      <p className="rm-pg-foot rm-gp-foot">set by hand, read by every agent before it works</p>
    </div>
  );
}
