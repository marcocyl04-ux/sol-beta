import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CFG, enter } from "../motion";
import type { Work } from "./useWork";
import { Empty } from "./Panes";

// The changes pane: what the session's folder holds that its base does not (git on the engine), file by file. A click
// on a line opens a comment under it; Enter keeps the comment, ⌘↵ puts them all in the box as one message.
type DF = { path: string; old?: string; status: string; add: number; del: number; patch: string; binary?: boolean };
type Diff = { files?: DF[]; root?: string; base?: string; branch?: string; add?: number; del?: number; notGit?: boolean; error?: string };
type Line = { t: " " | "+" | "-" | "@"; s: string; a?: number; b?: number };
export type Remark = { path: string; line: number; code: string; text: string };

const SCOPES = [["all", "this branch"], ["uncommitted", "not committed"], ["last", "last commit"]] as const;

function lines(patch: string): Line[] {
  const out: Line[] = [];
  let a = 0, b = 0;
  for (const l of patch.split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l);
    if (h) { a = +h[1]; b = +h[2]; out.push({ t: "@", s: h[3].trim() }); continue; }
    if (l.startsWith("\\")) continue;
    if (l.startsWith("+")) out.push({ t: "+", s: l.slice(1), b: b++ });
    else if (l.startsWith("-")) out.push({ t: "-", s: l.slice(1), a: a++ });
    else if (l.startsWith(" ") || l === "") { if (!out.length) continue; out.push({ t: " ", s: l.slice(1), a: a++, b: b++ }); }
  }
  return out;
}
const name = (p: string) => p.split("/").pop() ?? p;
const dir = (p: string) => p.split("/").slice(0, -1).join("/");

export function DiffPane({ w, cwd, busy, onSend, onFile }: {
  w: Work; cwd?: string; busy: boolean; onSend: (text: string) => void; onFile: (path: string, line?: number) => void;
}) {
  const [scope, setScope] = useState<string>(() => localStorage.getItem("sol.work.diffscope") ?? "all");
  const [d, setD] = useState<Diff | null>(null);
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState<string | null>(null);   // one file, or every file
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [writing, setWriting] = useState<{ path: string; line: number; code: string } | null>(null);
  const [text, setText] = useState("");
  const gen = useRef(0);   // only the newest question's answer lands (a folder or scope change outruns a slow one)
  const load = () => {
    if (!cwd) return;
    const n = ++gen.current;
    setLoading(true);
    void w.ask<Diff>("work.diff", { cwd, scope }).then((r) => { if (n !== gen.current) return; setD(r); setLoading(false); });
  };
  // comments belong to the folder they were written on
  useEffect(() => { setRemarks([]); setWriting(null); setText(""); setD(null); setPick(null); }, [cwd]);
  // asked again when the scope or folder changes, and when a turn ends (the files may have moved)
  useEffect(load, [cwd, scope, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  // a review by Codex of the scope shown: its remarks arrive in the talk (review.ts); a refusal shows on the button
  const [said, setSaid] = useState("");
  const reviewing = !!w.thread?.items.some((i) => i.kind === "review" && i.head && i.busy);
  const askReview = () => {
    if (!cwd) return;
    setSaid("");
    void w.review(cwd, scope).then((r) => { if (r.error) { setSaid(r.error); window.setTimeout(() => setSaid(""), 5000); } });
  };
  const setS = (s: string) => { setScope(s); localStorage.setItem("sol.work.diffscope", s); };

  const send = () => {   // a comment still being written goes too
    const all = writing && text.trim() ? [...remarks, { ...writing, text: text.trim() }] : remarks;
    if (!all.length) return;
    const body = all.map((r) => `- ${r.path}:${r.line}${r.code.trim() ? ` (\`${r.code.trim().slice(0, 80)}\`)` : ""}: ${r.text}`).join("\n");
    onSend(`Comments on the changes:\n${body}`);
    setRemarks([]); setWriting(null); setText("");
  };
  const keep = () => {
    if (!writing || !text.trim()) { setWriting(null); return; }
    setRemarks((r) => [...r, { ...writing, text: text.trim() }]);
    setWriting(null); setText("");
  };
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.metaKey && ev.key === "Enter" && (remarks.length || (writing && text.trim())) && pane.current?.offsetParent) { ev.preventDefault(); send(); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  if (!cwd) return <Empty>a new session has no folder yet.</Empty>;
  if (d?.notGit) return <Empty>this folder is not a git repository, so there are no changes to show.</Empty>;
  if (d?.error) return <Empty>{d.error}</Empty>;
  const files = d?.files ?? [];
  const shown = pick ? files.filter((f) => f.path === pick) : files;
  return (
    <div ref={pane} className="wdiffp">
      <div className="wdhead">
        <div className="wseg">{SCOPES.map(([k, l]) => <button key={k} className={scope === k ? "on" : ""} onClick={() => setS(k)}>{l}</button>)}</div>
        <span className="wdstat"><b>+{d?.add ?? 0}</b> −{d?.del ?? 0}</span>
        <button className="wlink" onClick={load}>{loading ? "reading…" : "again"}</button>
        <button className="wlink" disabled={!w.live || !files.length || reviewing} onClick={askReview}
          title={said || "Codex reads this change (read-only) and names what is wrong, in the talk"}>{reviewing ? "codex reads…" : "review"}</button>
        {said && <span className="wdstat">{said}</span>}
      </div>
      {!d && <Empty>reading the changes…</Empty>}
      {d && !files.length && <Empty>{scope === "uncommitted" ? "nothing waits to be committed." : scope === "last" ? "no last commit." : "no changes on this branch."}</Empty>}
      {files.length > 1 && (
        <div className="wdfiles">
          <button className={`wdf ${pick ? "" : "on"}`} onClick={() => setPick(null)}><span className="n">every file</span><span className="c">{files.length}</span></button>
          {files.map((f) => (
            <button key={f.path} className={`wdf ${pick === f.path ? "on" : ""} ${f.status}`} onClick={() => setPick(f.path)} title={f.path}>
              <i className="st" /><span className="n">{name(f.path)}</span><span className="d">{dir(f.path)}</span><span className="c"><b>+{f.add}</b> −{f.del}</span>
            </button>
          ))}
        </div>
      )}
      <div className="wdbody">
        {shown.map((f) => (
          <FileDiff key={f.path + scope} f={f} remarks={remarks.filter((r) => r.path === f.path)} writing={writing?.path === f.path ? writing : null}
            text={text} setText={setText} onLine={(line, code) => { if (writing && text.trim()) keep(); setWriting({ path: f.path, line, code }); setText(""); }}
            onKeep={keep} onCancel={() => setWriting(null)} onDrop={(r) => setRemarks((x) => x.filter((y) => y !== r))}
            onFile={(p, l) => onFile(d?.root ? `${d.root}/${p}` : p, l)} />
        ))}
      </div>
      {remarks.length > 0 && (
        <div className="wdsend">
          <span>{remarks.length} comment{remarks.length > 1 ? "s" : ""}</span>
          <button className="wbtn" onClick={send}>put in the box <kbd>⌘↵</kbd></button>
        </div>
      )}
    </div>
  );
}

function FileDiff({ f, remarks, writing, text, setText, onLine, onKeep, onCancel, onDrop, onFile }: {
  f: DF; remarks: Remark[]; writing: { line: number } | null; text: string; setText: (s: string) => void;
  onLine: (line: number, code: string) => void; onKeep: () => void; onCancel: () => void; onDrop: (r: Remark) => void; onFile: (p: string, l?: number) => void;
}) {
  const ls = lines(f.patch);
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (writing && field.current) { field.current.focus(); enter(field.current.parentElement!, { y: -6, cfg: CFG.snap }); } }, [writing?.line]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = (l: Line) => l.b ?? l.a ?? 0;
  return (
    <div className="wdfile">
      <div className="wdfh" onClick={() => onFile(f.path)} title="open the file">
        <span className={`wdtag ${f.status}`}>{f.status === "added" ? "new" : f.status === "deleted" ? "gone" : f.status === "renamed" ? "moved" : "changed"}</span>
        <span className="p">{f.old ? `${f.old} → ` : ""}{f.path}</span><span className="c"><b>+{f.add}</b> −{f.del}</span>
      </div>
      {f.binary ? <p className="wpempty">a binary file, or too big to show.</p> : (
        <div className="wdiff wdlines">
          {ls.map((l, i) => {
            const n = at(l);
            const mine = l.t !== "@" ? remarks.filter((r) => r.line === n && l.t !== "-") : [];
            return (
              <div key={i}>
                {l.t === "@" ? <div className="dl gap">⋯ {l.s}</div> : (
                  <div className={`dl ${l.t === "+" ? "add" : l.t === "-" ? "del" : ""} can`} onClick={() => l.t !== "-" && onLine(n, l.s)}>
                    <u>{l.a ?? ""}</u><u>{l.b ?? ""}</u><i>{l.t}</i><span>{l.s || " "}</span>
                  </div>
                )}
                {mine.map((r, k) => <div key={k} className="wremark"><span>{r.text}</span><button onClick={() => onDrop(r)} aria-label="drop the comment">×</button></div>)}
                {writing && l.t !== "@" && l.t !== "-" && writing.line === n && (
                  <div className="wcomment">
                    <textarea ref={field} rows={2} value={text} placeholder="a comment on this line" onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.metaKey) { e.preventDefault(); onKeep(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } }} />
                    <span className="wkeys"><kbd>↵</kbd> keep · <kbd>⌘↵</kbd> all to the box</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
