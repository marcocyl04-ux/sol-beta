import { useEffect, useState } from "react";
import { Drawer, Pick } from "../Settings";
import { Switch } from "../settingsShell";
import { WHICH } from "../useEngine";
import type { Work } from "./useWork";
import { PINGS, loadPings, savePings, type Pings } from "./pings";

// Work's own drawers, under the shared ones in Settings: how sessions are made (side copies, branches, archive, the
// long leash), the side copies themselves, the box, pings, the browser, the writing style, the tools a run loads,
// and the machine. The engine keeps what it acts on (work.prefs); pings and the leash are this window's.
type Prefs = { wtDir: string; prefix: string; archivePr: boolean; archiveDays: number; browser: boolean; suggest: boolean; awake: boolean; battery: boolean; style: string; stale: boolean; newIn: string };
type Copy = { path: string; repo: string; base?: string; branch?: string; kb?: number; dirty: number; ahead?: number; sessions: number; usedAt?: number; live: boolean; gone?: boolean; stale?: boolean; foreign?: boolean };
type Copies = { copies?: Copy[]; where?: string; kb?: number; transcripts?: number; error?: string };
type About = {
  machine?: string; os?: string; node?: string; engine?: string; sdk?: string; claude?: string; log?: string; lines?: string[]; awake?: boolean; power?: string;
  styles?: { builtIn: string[]; custom: string[]; dir: string };
  tools?: { skills: string[]; plugins: string[]; mcp: { name: string; status: string }[]; agents: string[]; style?: string; cwd?: string } | null;
};

const size = (kb?: number) => (kb === undefined ? "" : kb < 1024 ? `${kb} KB` : kb < 1048576 ? `${Math.round(kb / 1024)} MB` : `${(kb / 1048576).toFixed(1)} GB`);
const ago = (t?: number) => { if (!t) return "never used"; const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
const opener = () => import("@tauri-apps/plugin-opener");

export function Seg<T extends string | boolean | number>({ value, options, onChange, disabled }: { value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="wseg">
      {options.map(([v, l]) => <button key={String(v)} className={v === value ? "on" : ""} disabled={disabled} onClick={() => v !== value && onChange(v)}>{l}</button>)}
    </div>
  );
}
export const OnOff = ({ on, set, disabled, label }: { on: boolean; set: (v: boolean) => void; disabled?: boolean; label?: string }) => <Switch on={on} set={set} disabled={disabled} label={label} />;

// a text setting: kept on Enter or on leaving the field
export function Field({ value, placeholder, onSave }: { value: string; placeholder?: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const keep = () => { if (v.trim() !== value) onSave(v.trim()); };
  return <input className="wfield" value={v} placeholder={placeholder} spellCheck={false} onChange={(ev) => setV(ev.target.value)} onBlur={keep}
    onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); keep(); (ev.target as HTMLInputElement).blur(); } else if (ev.key === "Escape") { ev.stopPropagation(); setV(value); } }} />;
}

export function WorkDrawers({ w, open, toggle, flash }: { w: Work; open: string; toggle: (n: string) => void; flash: (s: string) => void }) {
  const [p, setP] = useState<Prefs | null>(null);
  const [err, setErr] = useState("");
  const [pings, setPings] = useState<Pings>(loadPings);
  const [copies, setCopies] = useState<Copies | null>(null);
  const [about, setAbout] = useState<About | null>(null);
  const [busy, setBusy] = useState("");
  const [sure, setSure] = useState<string | null>(null);   // a copy with work in it, asked once more before it goes

  useEffect(() => { void w.ask<{ prefs?: Prefs }>("work.prefs", {}).then((r) => r.prefs && setP(r.prefs)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = async (patch: Partial<Prefs>) => {
    setP((x) => (x ? { ...x, ...patch } : x));
    const r = await w.ask<{ prefs?: Prefs; error?: string }>("work.prefs", { patch });
    if (r.prefs) setP(r.prefs);
    setErr(r.error ?? "");
    if (patch.suggest !== undefined) try { localStorage.setItem("sol.work.suggest", patch.suggest ? "1" : "0"); } catch { /* private */ }
  };
  const loadCopies = () => { setCopies(null); void w.ask<Copies>("work.copies", {}, 60_000).then(setCopies); };
  const loadAbout = () => void w.ask<About>("work.about", {}, 15_000).then(setAbout);
  // the slow drawers ask when they open
  useEffect(() => { if (open === "side copies" && !copies) loadCopies(); if (["sessions", "machine"].includes(open)) loadAbout(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (c: Copy, force = false) => {
    setBusy(c.path); setSure(null);
    const r = await w.ask<{ said?: string; error?: string }>("work.copies.remove", { path: c.path, force }, 60_000);
    setBusy("");
    flash(r.error ?? `${base(c.path)}: ${r.said}`);
    loadCopies();
  };
  const clean = async () => {
    setBusy("all");
    const r = await w.ask<{ removed?: number; errors?: string[]; error?: string }>("work.copies.clean", {}, 120_000);
    setBusy("");
    flash(r.error ?? (r.removed ? `${r.removed} side ${r.removed > 1 ? "copies" : "copy"} removed` : "nothing to remove") + (r.errors?.length ? `; ${r.errors.length} kept` : ""));
    loadCopies();
  };
  const setPing = (patch: Partial<Pings>) => setPings((x) => { const n = { ...x, ...patch }; savePings(n); return n; });
  const mac = WHICH === "next";
  const off = !p;
  const staleOf = (c: Copy) => !!c.stale;
  const stale = (copies?.copies ?? []).filter(staleOf);
  const state = (c: Copy) => c.live ? "working now" : c.gone ? "its folder is gone" : c.dirty ? `${c.dirty} uncommitted` : c.ahead ? `${c.ahead} commit${c.ahead > 1 ? "s" : ""} not on ${c.base ?? "the base"}` : c.stale ? "clean, merged" : "clean, used lately";

  return (<>
    <Drawer name="work" open={open === "work"} onToggle={() => toggle("work")}>
      {err && <p className="hint-line top stale">{err}</p>}
      <div className="field-r">
        <div className="lab"><span>side copies live</span><small>{p?.wtDir ? tilde(p.wtDir) + "/<repo>/<name>" : "<repo>/.claude/worktrees/<name>"}</small></div>
        <Seg value={!!p?.wtDir} options={[[false, "inside each repo"], [true, "in one folder"]]} disabled={off}
          onChange={(v) => void set({ wtDir: v ? "~/.sol/side-copies" : "" })} />
      </div>
      {p?.wtDir && <div className="field-r"><div className="lab"><span>that folder</span></div><Field value={tilde(p.wtDir)} onSave={(v) => void set({ wtDir: v })} /></div>}
      <div className="field-r">
        <div className="lab"><span>new sessions start in</span><small>when no folder is picked (right-click a folder: new sessions start here)</small></div>
        <Field value={p?.newIn ? tilde(p.newIn) : ""} placeholder="your home folder" onSave={(v) => void set({ newIn: v })} />
      </div>
      <div className="field-r">
        <div className="lab"><span>branch prefix</span><small>on the branches Sol makes, as {p?.prefix ?? "claude/"}fix-the-notes-3fa2c1</small></div>
        <Field value={p?.prefix ?? ""} placeholder="no prefix" onSave={(v) => void set({ prefix: v })} />
      </div>
      <div className="field-r">
        <div className="lab"><span>archive when its pull request closes</span><small>a side copy's sessions, merged or closed</small></div>
        <OnOff on={!!p?.archivePr} set={(v) => void set({ archivePr: v })} disabled={off} />
      </div>
      <div className="field-r">
        <div className="lab"><span>archive untouched sessions</span><small>pinned ones stay</small></div>
        <Pick value={String(p?.archiveDays ?? 0)} disabled={off} onChange={(v) => void set({ archiveDays: Number(v) })}
          options={[["0", "never"], ["7", "after a week"], ["14", "after two weeks"], ["30", "after a month"], ["90", "after three months"]]} />
      </div>
    </Drawer>

    <Drawer name="side copies" open={open === "side copies"} onToggle={() => toggle("side copies")}>
      {!copies ? <p className="hint-line top">reading the copies…</p> : copies.error ? <p className="hint-line top">{copies.error}</p> : (<>
        <div className="wcopyhead">
          <span>{copies.copies?.length ? `${copies.copies.length} side ${copies.copies.length > 1 ? "copies" : "copy"}, ${size(copies.kb)}` : "no side copies"}</span>
          <span className="dim">transcripts {size(copies.transcripts)}</span>
          <span className="grow" />
          {stale.length > 0 && <button className="wbtn" disabled={!!busy} onClick={() => void clean()}>{busy === "all" ? "removing…" : `remove ${stale.length} stale`}</button>}
          <button className="wlink" onClick={loadCopies}>again</button>
        </div>
        <div className="wcopies">
          {(copies.copies ?? []).map((c) => (
            <div key={c.path} className={`wcopy ${staleOf(c) ? "stale" : ""} ${c.live ? "live" : ""}`}>
              <div className="t">
                <b title={c.path}>{base(c.path)}</b>
                <span>{base(c.repo)}{c.branch ? ` · ${c.branch}` : ""}{c.foreign ? " · not made by Sol" : ""}</span>
              </div>
              <div className="s">
                <span className="st">{state(c)}</span>
                <span>{[size(c.kb), c.sessions ? `${c.sessions} session${c.sessions > 1 ? "s" : ""}, ${ago(c.usedAt)}` : "no session"].filter(Boolean).join(" · ")}</span>
              </div>
              {sure === c.path ? (
                <span className="wsure">{c.foreign ? "another app made it" : c.ahead ? "its branch stays" : "its branch goes too"}<button className="wlink danger" onClick={() => void remove(c, true)}>remove</button><button className="wlink" onClick={() => setSure(null)}>keep</button></span>
              ) : (
                <button className="wlink" disabled={c.live || c.dirty > 0 || !!busy} title={c.dirty ? "commit or drop its changes in the copy first" : undefined} onClick={() => (staleOf(c) ? void remove(c) : setSure(c.path))}>{busy === c.path ? "removing…" : "remove"}</button>
              )}
            </div>
          ))}
        </div>
        <p className="hint-line">stale: a copy Sol made with nothing uncommitted, nothing its base lacks, and no session in it this past hour. A copy with uncommitted changes is never removed here; a removed copy keeps a branch that has commits of its own.</p>
      </>)}
    </Drawer>

    <Drawer name="sessions" open={open === "sessions"} onToggle={() => toggle("sessions")}>
      <div className="field-r">
        <div className="lab"><span>suggested prompts</span><small>after a turn, a next prompt waits in the box; Tab or → takes it</small></div>
        <OnOff on={p?.suggest ?? true} set={(v) => void set({ suggest: v })} disabled={off} />
      </div>
      <div className="field-r">
        <div className="lab"><span>Claude may drive the browser</span><small>open, read and click pages in the browser pane; it still asks. From the next session that starts or wakes</small></div>
        <OnOff on={p?.browser ?? true} set={(v) => void set({ browser: v })} disabled={off} />
      </div>
      <div className="field-r">
        <div className="lab"><span>output style</span><small>how Claude writes in a new session</small></div>
        <Pick value={p?.style ?? ""} disabled={off} onChange={(v) => void set({ style: v })}
          options={[["", "default"], ...[...(about?.styles?.builtIn ?? []), ...(about?.styles?.custom ?? [])].map((x): [string, string] => [x, x])]} />
      </div>
      <p className="hint-line">
        your own styles are .md files in {tilde(about?.styles?.dir ?? "~/.claude/output-styles")}
        {mac && about?.styles?.dir && <> · <button className="link" onClick={() => void opener().then((o) => o.openPath(about.styles!.dir)).catch(() => flash("there is no such folder yet"))}>open it</button></>}
      </p>
    </Drawer>

    <Drawer name="pings" open={open === "pings"} onToggle={() => toggle("pings")}>
      <p className="hint-line top">when Sol is not in front, or the session is not the one open</p>
      {PINGS.map(([k, label]) => (
        <div className="field-r" key={k}>
          <div className="lab"><span>{label}</span></div>
          <Seg value={pings[k]} options={[["off", "off"], ["badge", "badge"], ["banner", "banner"]]} onChange={(v) => setPing({ [k]: v } as Partial<Pings>)} />
        </div>
      ))}
      <div className="field-r"><div className="lab"><span>bounce the dock</span></div><OnOff on={pings.attention} set={(v) => setPing({ attention: v })} /></div>
      <div className="field-r"><div className="lab"><span>a sound</span></div><OnOff on={pings.sound} set={(v) => setPing({ sound: v })} /></div>
      {!mac && <p className="hint-line">banners come from the engine's machine; on the NucBox there are none</p>}
    </Drawer>

    <Drawer name="machine" open={open === "machine"} onToggle={() => toggle("machine")}>
      <div className="field-r">
        <div className="lab"><span>keep awake while a session works</span><small>{about?.awake ? "holding it awake now" : about?.power ?? ""}</small></div>
        <OnOff on={!!p?.awake} set={(v) => void set({ awake: v }).then(loadAbout)} disabled={off} />
      </div>
      {p?.awake && <div className="field-r"><div className="lab"><span>on battery too</span></div><OnOff on={p.battery} set={(v) => void set({ battery: v }).then(loadAbout)} /></div>}
      {about && (
        <dl className="facts wfacts">
          <dt>machine</dt><dd>{about.machine}</dd>
          <dt>engine</dt><dd className="mono">{about.engine ?? "–"}</dd>
          <dt>agent sdk</dt><dd className="mono">{about.sdk ?? "–"}</dd>
          <dt>claude code</dt><dd className="mono">{about.claude ?? "–"}</dd>
          <dt>node</dt><dd className="mono">{about.node}</dd>
          <dt>log</dt><dd>{about.log ? <><span className="mono">{tilde(about.log)}</span>{mac && <button className="link" onClick={() => void opener().then((o) => o.revealItemInDir(about.log!)).catch(() => flash("Sol could not show it"))}>show</button>}</> : "–"}</dd>
        </dl>
      )}
      {!!about?.lines?.length && <pre className="wlog">{about.lines.join("\n")}</pre>}
    </Drawer>
  </>);
}
