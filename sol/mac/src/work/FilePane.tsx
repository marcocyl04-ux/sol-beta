import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { WHICH } from "../useEngine";
import { ENGINE_HTTP } from "../engine";
import type { Work } from "./useWork";
import { Empty } from "./Panes";

// The file pane: one file of the session's folder, to read and edit in place. A search at the top finds a file (the
// same list @ uses); a file link in the talk opens here at its line. ⌘S saves; a save over a change made meanwhile
// stops and says so. Attach puts @path in the box; Open in and Finder reach this Mac's apps (only on this Mac's engine).
export type FileAt = { path: string; line?: number; n: number };
type Read = { path?: string; text?: string; mtime?: number; hash?: string; dir?: boolean; entries?: string[]; binary?: boolean; image?: boolean; tooBig?: boolean; size?: number; error?: string };

const rel = (abs: string, cwd?: string) => (cwd && abs.startsWith(cwd.replace(/\/$/, "") + "/") ? abs.slice(cwd.replace(/\/$/, "").length + 1) : abs.replace(/^\/Users\/[^/]+/, "~"));
const opener = () => import("@tauri-apps/plugin-opener");

export function FilePane({ w, cwd, at, onAttach, flash }: {
  w: Work; cwd?: string; at: FileAt | null; onAttach: (path: string) => void; flash: (s: string) => void;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [f, setF] = useState<Read | null>(null);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [img, setImg] = useState("");
  const imgUrl = f?.image && path ? `${ENGINE_HTTP}/pane-image?path=${encodeURIComponent(path.startsWith("/") ? path : `${(cwd ?? "").replace(/\/$/, "")}/${path}`)}&t=${f.mtime ?? 0}` : "";
  useEffect(() => {
    if (!imgUrl) { setImg(""); return; }
    let url = "", gone = false;
    fetch(imgUrl).then(async (r) => {
      if (!r.ok) throw new Error(`the engine answered ${r.status}`);
      const b = await r.blob();
      if (gone) return;
      url = URL.createObjectURL(b); setImg(url); setNote("");
    }).catch((err) => { if (!gone) setNote(`image: ${(err as Error).message} (${imgUrl})`); });
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [imgUrl]);
  const dirty = !!f && f.text !== undefined && text !== f.text;
  const ed = useRef<HTMLTextAreaElement>(null), gut = useRef<HTMLDivElement>(null);
  const goLine = useRef<number | undefined>(undefined);
  const mac = WHICH === "next";

  const [jump, setJump] = useState(0);
  const load = async (p: string, line?: number) => {
    if (!cwd) return;
    // the file already open with edits in it: go to the line, never read it over the edits
    if (dirty && path && (p === path || p === rel(path, cwd))) { goLine.current = line; setJump((j) => j + 1); return; }
    if (dirty && p !== path) { setNote(`${rel(path ?? "", cwd)} has changes: save or discard them first.`); return; }
    setBusy(true); setNote(""); goLine.current = line;
    const r = await w.ask<Read>("work.read", { cwd, path: p });
    setBusy(false); setF(r); setPath(r.path ?? p); setText(r.text ?? ""); setQ(""); setHits([]);
  };
  useEffect(() => { if (at) void load(at.path, at.line); }, [at?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // a line asked for: the field scrolls to it and selects it
  useLayoutEffect(() => {
    const el = ed.current, n = goLine.current;
    if (!el || !n || f?.text === undefined) return;
    goLine.current = undefined;
    const ls = el.value.split("\n");
    const start = ls.slice(0, n - 1).reduce((s, l) => s + l.length + 1, 0);
    el.focus(); el.setSelectionRange(start, start + (ls[n - 1]?.length ?? 0));
    el.scrollTop = Math.max(0, (n - 6) * 18);
  }, [f, jump]);

  useEffect(() => {
    if (!cwd || !q.trim()) { setHits([]); return; }
    const t = window.setTimeout(() => { void w.files(cwd, q.trim()).then((r) => setHits(r.files.slice(0, 12))); }, 80);
    return () => window.clearTimeout(t);
  }, [q, cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!path || !dirty || !cwd) return;
    setBusy(true);
    const r = await w.ask<{ ok?: boolean; changed?: boolean; mtime?: number; hash?: string; error?: string }>("work.write", { cwd, path, text, hash: f?.hash });
    setBusy(false);
    if (r.changed) { setNote("the file changed since it opened here. Discard to read it again, or copy your text first."); return; }
    if (r.error) { setNote(r.error); return; }
    setF({ ...f, text, mtime: r.mtime, hash: r.hash }); setNote("saved");
    window.setTimeout(() => setNote((n) => (n === "saved" ? "" : n)), 1600);
  };
  const keys = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.metaKey && ev.key.toLowerCase() === "s") { ev.preventDefault(); void save(); }
    else if (ev.key === "Tab" && !ev.shiftKey) {   // a tab is two spaces in the field
      ev.preventDefault();
      const el = ev.currentTarget, a = el.selectionStart, b = el.selectionEnd;
      setText(text.slice(0, a) + "  " + text.slice(b));
      requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
    }
  };
  const copy = () => { if (path) void navigator.clipboard.writeText(path).then(() => flash("path copied")); };
  const openIn = () => { if (path) void opener().then((o) => o.openPath(path)).catch(() => flash("Sol could not open it")); };
  const reveal = () => { if (path) void opener().then((o) => o.revealItemInDir(path)).catch(() => flash("Sol could not show it")); };
  const count = text.split("\n").length;

  if (!cwd) return <Empty>a new session has no folder yet.</Empty>;
  return (
    <div className="wfilep">
      <div className="wfhead">
        <div className="wsearch"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={path ? rel(path, cwd) : "find a file"}
          onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) void load(hits[0]); else if (e.key === "Escape") { e.stopPropagation(); setQ(""); } }} /></div>
        {hits.length > 0 && (
          <div className="wfhits">{hits.map((h) => <button key={h} onClick={() => void load(h)}>{h}</button>)}</div>
        )}
      </div>
      {path && (
        <div className="wfbar">
          <span className="p" title={path}>{rel(path, cwd)}{dirty ? " ·" : ""}</span>
          {dirty && <button className="wbtn" onClick={() => void save()} disabled={busy}>save <kbd>⌘S</kbd></button>}
          {dirty && <button className="wlink" onClick={() => setText(f?.text ?? "")}>discard</button>}
          {!dirty && f?.text !== undefined && <button className="wlink" onClick={() => void load(path)}>read again</button>}
          <span className="grow" />
          <button className="wlink" onClick={() => onAttach(rel(path, cwd))} title="put @path in the box">attach</button>
          <button className="wlink" onClick={copy}>copy path</button>
          {mac && <button className="wlink" onClick={openIn}>open in</button>}
          {mac && <button className="wlink" onClick={reveal}>Finder</button>}
        </div>
      )}
      {note && <p className="wfnote">{note}</p>}
      {!path ? <Empty>find a file above, or click a path in the talk.</Empty>
        : busy && !f ? <Empty>reading…</Empty>
        : f?.error ? <Empty>{f.error}</Empty>
        : f?.dir ? (
          <div className="wfdir">{(f.entries ?? []).map((e) => <button key={e} onClick={() => void load(`${path.replace(/\/$/, "")}/${e}`)}>{e}</button>)}</div>
        ) : f?.image ? <div className="wfimg">{img ? <img src={img} alt={path} /> : <Empty>{note ? "" : "loading the image…"}</Empty>}</div>
        : f?.binary ? <Empty>a binary file ({Math.round((f.size ?? 0) / 1024)} KB).</Empty>
        : f?.tooBig ? <Empty>too big to open here ({Math.round((f.size ?? 0) / 1048576)} MB).</Empty>
        : (
          <div className="wfed">
            <div ref={gut} className="wfgut" aria-hidden>{Array.from({ length: count }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
            <textarea ref={ed} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} onKeyDown={keys}
              onScroll={(e) => { if (gut.current) gut.current.scrollTop = e.currentTarget.scrollTop; }} />
          </div>
        )}
    </div>
  );
}
