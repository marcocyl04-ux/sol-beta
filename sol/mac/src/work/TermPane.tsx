import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TermInfo, Work } from "./useWork";
import { Empty } from "./Panes";

// The terminal pane: real shells on the engine's machine (a pty each), drawn with xterm. A tab per terminal, + opens
// one in the session's folder. The engine keeps each terminal's last words, so the pane can close and open again.
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

export function TermPane({ w, cwd, sub, want }: {
  w: Work; cwd?: string; sub: (f: (m: any) => void) => () => void; want?: { cwd: string; n: number } | null;
}) {
  const [tid, setTid] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const terms = w.terms;
  const opening = useRef(false);
  const open = async (at = cwd) => {
    if (!at || opening.current) return;
    opening.current = true;
    const r = await w.ask<TermInfo & { error?: string }>("work.term.open", { cwd: at, cols: 100, rows: 30 });
    opening.current = false;
    if (r.error || !r.tid) { setErr(r.error ?? "the terminal did not open"); return; }
    setErr(""); setTid(r.tid);
  };
  // the pane opens on the newest terminal in this folder, or a fresh one (once: closing the last one leaves it closed)
  const auto = useRef(false);
  useEffect(() => {
    if (tid && terms.some((t) => t.tid === tid)) return;
    const here = [...terms].reverse().find((t) => t.cwd === cwd) ?? terms[terms.length - 1];
    if (want && want.n !== seen.current) return;   // an asked-for folder goes first (its effect below opens it)
    if (here) setTid(here.tid);
    else if (cwd && !err && !auto.current) { auto.current = true; void open(); }
  }, [terms, cwd]); // eslint-disable-line react-hooks/exhaustive-deps
  // "open in terminal" on a folder somewhere in the talk
  const seen = useRef(0);
  useEffect(() => { if (want && want.n !== seen.current) { seen.current = want.n; void open(want.cwd); } }, [want]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = (t: string) => { w.term("close", { tid: t }); if (t === tid) setTid(null); };
  return (
    <div className="wterm">
      <div className="wttabs">
        {terms.map((t) => (
          <div key={t.tid} className={`wtt ${t.tid === tid ? "on" : ""} ${t.alive ? "" : "ended"}`} onClick={() => setTid(t.tid)} title={t.cwd}>
            <span>{base(t.cwd)}</span>
            <button onClick={(ev) => { ev.stopPropagation(); close(t.tid); }} aria-label="close the terminal">×</button>
          </div>
        ))}
        <button className="wtplus" onClick={() => void open()} title="a new terminal in the session's folder" disabled={!cwd}>+</button>
      </div>
      {err ? <Empty>{err}</Empty> : tid ? <Xterm key={tid} tid={tid} w={w} sub={sub} /> : <Empty>{!cwd ? "a new session has no folder yet." : auto.current && !terms.length ? "no terminal open. + opens one." : "opening a terminal…"}</Empty>}
    </div>
  );
}

// the paper's own colours, read from face.css: Work shares Life's charcoal paper and pearl ink, so the terminal does too;
// a selection is the 1px line's colour laid flat (there never was a --line2: it fell to a pearl that hid the ink)
function theme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string, d: string) => cs.getPropertyValue(k).trim() || d;
  return { background: v("--page", "#1a1a1a"), foreground: v("--ink", "#ebebe8"), cursor: v("--ink", "#ebebe8"), cursorAccent: v("--page", "#1a1a1a"), selectionBackground: v("--line", "#303030") };
}

export function Xterm({ tid, w, sub }: { tid: string; w: Pick<Work, "ask" | "term">; sub: (f: (m: any) => void) => () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState<number | null>(null);
  useEffect(() => {
    const el = host.current!;
    const t = new Terminal({ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 12, lineHeight: 1.25, cursorBlink: true, theme: theme(), scrollback: 5000, allowProposedApi: false });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(el);
    let ready = false;
    const early: { data: string; seq: number }[] = [];
    const off = sub((m) => {
      if (m.tid !== tid) return;
      if (m.type === "work.term.out") { if (ready) t.write(m.data); else early.push({ data: m.data, seq: Number(m.seq) || 0 }); }
      else if (m.type === "work.term.exit") setGone(m.code ?? 0);
    });
    // what it said before the pane opened, then only what came after that snapshot (chunks are numbered)
    void w.ask<{ buf?: string; seq?: number; gone?: boolean; alive?: boolean; code?: number }>("work.term.attach", { tid }).then((r) => {
      if (r.buf) t.write(r.buf);
      for (const d of early) if (d.seq > (r.seq ?? 0)) t.write(d.data);
      early.length = 0; ready = true;
      if (r.gone || r.alive === false) setGone(r.code ?? 0);
    });
    const size = () => { try { fit.fit(); w.term("size", { tid, cols: t.cols, rows: t.rows }); } catch { /* hidden */ } };
    const ro = new ResizeObserver(() => requestAnimationFrame(size));
    ro.observe(el);
    size();
    const input = t.onData((d) => w.term("in", { tid, data: d }));
    t.focus();
    return () => { off(); ro.disconnect(); input.dispose(); t.dispose(); };
  }, [tid]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="wxterm">
      <div ref={host} className="wxhost" />
      {gone !== null && <p className="wtgone">the shell ended{gone ? ` (${gone})` : ""}. + opens another.</p>}
    </div>
  );
}
