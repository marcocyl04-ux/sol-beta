import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { WHICH, pickEngine } from "../useEngine";
import { Fold } from "../MotionKit";
import { CFG, useSpring } from "../motion";
import type { Item, RunInfo, Work } from "./useWork";
import "./overview.css";

// The overview (2026-10-15, after Claude Code's app; at parity with its session rail since #40, PROTOCOL.md round 20):
// the session at a glance in five cards, in the rail's order and words. Context, how full the window is and, opened,
// what fills it; Environment, the machine, the folder, the branch and Remote Control (the away page over Tailscale);
// Connectors, the session's MCP servers and their states; Outputs, what the session made, newest first; Changes, the
// branch's +n −m and its pull request. Nothing is a made-up number: what cannot be known is "—", an estimate wears ≈.
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || "~";
const short = (p: string, n = 28) => (p.length <= n ? p : `${p.slice(0, 10)}…${p.slice(-(n - 11))}`);
const IMG = /\.(png|jpe?g|gif|webp|svg)$/i;

type Out = { key: string; label: string; kind: "artifact" | "image" | "file"; path?: string; url?: string };
export const outputs = (items: Item[]): Out[] => {
  const seen = new Set<string>(), list: Out[] = [];
  for (const i of [...items].reverse()) {
    if (i.kind !== "tool" || !i.done || i.ok === false) continue;
    if (i.name === "Artifact") {
      const url = /https:\/\/claude\.ai\/\S*artifact\/[\w-]+/.exec(String(i.out ?? ""))?.[0];
      const p = String(i.input?.file_path ?? "");
      const k = url ?? p;
      if (!k || seen.has(k)) continue;
      seen.add(k);
      list.push({ key: k, label: i.input?.title || (p ? base(p).replace(/\.\w+$/, "") : "an artifact"), kind: "artifact", url, path: p || undefined });
    } else if (i.name === "Write" && i.input?.file_path) {
      const p = String(i.input.file_path);
      if (seen.has(p)) continue;
      seen.add(p);
      list.push({ key: p, label: base(p), kind: IMG.test(p) ? "image" : "file", path: p });
    }
  }
  return list;
};

// ---- what the engine sends (round 20) ----
const PARTS = ["messages", "mcpTools", "systemTools", "systemPrompt", "skills", "memory", "mcpInstructions", "agents", "buffer", "free"] as const;
type PartKey = (typeof PARTS)[number];
export type Usage = {
  total: number; window: number; parts: Record<PartKey, number | null>;
  deferred: { mcpTools: number | null; systemTools: number | null };
  lists: { mcp: string[]; memory: string[]; agents: string[] };
  compactSoon: boolean; threshold?: number; how: "counted" | "summary" | "estimated"; est: PartKey[];
  rest?: number; more?: { name: string; tokens: number }[];
};
type Summary = { add?: number; del?: number; files?: number; branch?: string; pr?: { number: number; url: string; draft: boolean; state: string }; notGit?: boolean; error?: string; cwd?: string };
type Remote = { on?: boolean; url?: string; error?: string };
type Mcp = { name: string; status: string };

// the rail's words, and one tint per category from palette.css, muted toward grey (the bar is quiet, never loud)
const NAME: Record<PartKey, string> = {
  messages: "Messages", mcpTools: "MCP tools", systemTools: "System tools", systemPrompt: "System prompt", skills: "Skills",
  memory: "Memory files", mcpInstructions: "MCP server instructions", agents: "Custom agents", buffer: "Autocompact buffer", free: "Free space",
};
const TINT: Record<PartKey, string> = {
  messages: "--blush", mcpTools: "--orange", systemTools: "--green", systemPrompt: "--sun", skills: "--lime",
  memory: "--candy", mcpInstructions: "--amber", agents: "--pink", buffer: "", free: "",
};
const swatch = (k: PartKey) => (k === "buffer" ? "var(--mute)" : k === "free" ? "var(--raised)" : `color-mix(in oklab, var(${TINT[k]}) 46%, #6e6e6b)`);

// 197.8k in the head, 130k / 21.1k / 755 in the rows, as the rail writes them
const kTok = (n: number, row = false) => (n < 1000 ? String(Math.round(n)) : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : row && n >= 100_000 ? `${Math.round(n / 1000)}k` : `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`);
const share = (n: number, w: number) => (w > 0 ? `${((n / w) * 100).toFixed(1)}%` : "—");
const dispName = (n: string) => { const s = n.replace(/^claude\.ai /, "").replace(/^plugin:[^:]+:/, ""); return s.charAt(0).toUpperCase() + s.slice(1); };

const I = { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const Ico = {
  machine: <svg {...I}><rect x="2.5" y="3" width="9" height="6" rx="1" /><path d="M1 11.5h12" /></svg>,
  folder: <svg {...I}><path d="M1.5 4V11.5h11V5H7L5.8 3.5H1.5z" /></svg>,
  branch: <svg {...I}><circle cx="4" cy="3" r="1.3" /><circle cx="4" cy="11" r="1.3" /><circle cx="10.5" cy="4.5" r="1.3" /><path d="M4 4.3v5.4M10.5 5.8c0 2.5-6.5 1.5-6.5 4" /></svg>,
  remote: <svg {...I}><path d="M3 2l8 4.2-3.4 1L6.3 11z" /><path d="M7.6 7.2l3 3.3" /></svg>,
  artifact: <svg {...I}><circle cx="4" cy="4.5" r="2" /><path d="M2 12.5l2-4 2 4z" /><rect x="8" y="7.5" width="4.5" height="5" rx=".6" /><path d="M6 4.5h4.5v3" /></svg>,
  image: <svg {...I}><rect x="1.5" y="2" width="11" height="10" rx="1" /><circle cx="5" cy="5.5" r="1" /><path d="M1.5 10l3.5-3 3 2.5 2-1.5 2.5 2" /></svg>,
  file: <svg {...I}><path d="M3 1.5h5l3 3v8H3z" /><path d="M8 1.5v3h3" /></svg>,
  diff: <svg {...I}><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" /><path d="M7 3.8v4M5 5.8h4M5 10h4" /></svg>,
};

function Card({ name, right, open, onToggle, chev, children }: {
  name: string; right?: React.ReactNode; open?: boolean; onToggle?: () => void; chev: "side" | "down"; children?: React.ReactNode;
}) {
  return (
    <section className={`wocard ${open ? "open" : ""}`}>
      <button className="wohead" onClick={onToggle} aria-expanded={open}>
        <b>{name}</b><i className={`wochev ${chev === "side" ? "aside" : chev} ${open ? "open" : ""}`} />
        <span className="woright">{right}</span>
      </button>
      {children && <Fold open={!!open} gap={0}><div className="wobody">{children}</div></Fold>}
    </section>
  );
}

// an on/off switch: the knob slides on the snap spring; on is ink, off is the track, no colour either way
function Switch({ on, busy, onChange, label }: { on: boolean; busy?: boolean; onChange: (v: boolean) => void; label: string }) {
  const knob = useRef<HTMLElement>(null);
  const put = (v: number) => { if (knob.current) knob.current.style.translate = `${v * 12}px 0`; };
  const sp = useSpring(on ? 1 : 0, CFG.snap, put);
  useLayoutEffect(() => put(sp.v));
  useEffect(() => { sp.to(on ? 1 : 0); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button className={`woswitch ${on ? "on" : ""} ${busy ? "busy" : ""}`} role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={() => onChange(!on)}>
      <i ref={knob} />
    </button>
  );
}

// one of the context's three lists: a count that opens to the names
function List({ name, items, render }: { name: string; items: string[]; render?: (s: string) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="wolist">
      <button className="wolisthead" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!items.length}>
        <i className={`wochev aside ${open ? "open" : ""}`} /><span>{name}</span><em>{items.length}</em>
      </button>
      <Fold open={open} lazy gap={0}><div className="wolistbody">{items.slice(0, 400).map((s, i) => <div key={i}>{render ? render(s) : s}</div>)}{items.length > 400 && <div className="dim">and {items.length - 400} more</div>}</div></Fold>
    </div>
  );
}

// the MCP tools by server: "linear · 23" then the tools, so 390 names read as a dozen lines
function mcpBy(list: string[]) {
  const by = new Map<string, string[]>();
  for (const s of list) { const i = s.indexOf(":"); const sv = i > 0 ? s.slice(0, i) : "?"; by.set(sv, [...(by.get(sv) ?? []), i > 0 ? s.slice(i + 1) : s]); }
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([sv, t]) => `${sv.replace(/^claude_ai_/, "")}\u0000${t.length}\u0000${t.join(", ")}`);
}

function Context({ u: given, run, onCompact }: { u?: Usage; run?: RunInfo; onCompact?: () => void }) {
  const [asked, setAsked] = useState(false);
  if (!run) return <p className="woline dim">no session running: the split shows once it runs</p>;
  // an engine from before round 20 sends no split: the total is still its own count and "not split" is that whole total;
  // every part is "—", and free is the window less the total, wearing ≈ because the auto-compact buffer inside it is not known
  const u: Usage = given ?? { total: run.context, window: run.window, parts: { ...Object.fromEntries(PARTS.map((k) => [k, null])), free: Math.max(0, run.window - run.context) } as Usage["parts"], deferred: { mcpTools: null, systemTools: null }, lists: { mcp: [], memory: [], agents: [] }, compactSoon: run.context >= 0.8 * run.window, how: "estimated", est: ["free"], rest: run.context };
  const est = (k: PartKey) => u.est.includes(k) && (u.parts[k] ?? 0) > 0;
  const bar = PARTS.filter((k) => k !== "free" && (u.parts[k] ?? 0) > 0);
  const pct = u.window ? Math.round((u.total / u.window) * 100) : 0;
  const listed: Partial<Record<PartKey, string[]>> = { mcpTools: u.lists.mcp, memory: u.lists.memory, agents: u.lists.agents, skills: run.skills };
  return (
    <div className="woctx">
      <div className="woctxhead"><span>{pct}% used</span><em>{kTok(u.total)} / {kTok(u.window)}</em></div>
      <div className="wostack" aria-hidden>
        {bar.map((k) => <i key={k} style={{ flexGrow: u.parts[k]!, background: swatch(k) }} />)}
        {u.rest ? <i className="rest" style={{ flexGrow: u.rest }} /> : null}
        <i className="free" style={{ flexGrow: Math.max(0, u.parts.free ?? Math.max(0, u.window - u.total)) }} />
      </div>
      <div className="woparts">
        {PARTS.map((k) => {
          const v = u.parts[k];
          const list = listed[k];
          return (
            <div key={k} className={`wopart ${k}`}>
              <i style={{ background: swatch(k) }} />
              <span className={list?.length ? "listed" : ""} title={list?.length ? list.slice(0, 40).join("\n") + (list.length > 40 ? `\n… ${list.length - 40} more` : "") : undefined}>{NAME[k]}</span>
              <b>{v === null ? "—" : <>{est(k) && <small>≈</small>}{kTok(v, true)}</>}</b>
              <em>{v === null ? "—" : share(v, u.window)}</em>
            </div>
          );
        })}
        {u.rest ? <div className="wopart rest" title="in the window, but it cannot be split from here: the system prompt, the tools, skills and agents"><i /><span>Not split</span><b>{given && <small>≈</small>}{kTok(u.rest, true)}</b><em>{share(u.rest, u.window)}</em></div> : null}
        {(u.more ?? []).map((m) => <div key={m.name} className="wopart"><i style={{ background: "var(--dim)" }} /><span>{m.name}</span><b>{kTok(m.tokens, true)}</b><em>{share(m.tokens, u.window)}</em></div>)}
      </div>
      <div className="woparts deferred">
        <div className="wopart"><i /><span>MCP tools (deferred)</span><b>{u.deferred.mcpTools === null ? "—" : kTok(u.deferred.mcpTools, true)}</b><em>—</em></div>
        <div className="wopart"><i /><span>System tools (deferred)</span><b>{u.deferred.systemTools === null ? "—" : kTok(u.deferred.systemTools, true)}</b><em>—</em></div>
      </div>
      <div className="wolists">
        <List name="MCP tools" items={mcpBy(u.lists.mcp)} render={(s) => { const [sv, n, t] = s.split("\u0000"); return <span title={t}><b>{sv}</b> <em>· {n}</em></span>; }} />
        <List name="Memory files" items={u.lists.memory} render={(p) => <span title={p}>{tilde(p)}</span>} />
        <List name="Custom agents" items={u.lists.agents} />
      </div>
      <div className="wocompact">
        <span>{u.compactSoon ? "Auto-compacts soon" : u.threshold ? `Auto-compacts at ${kTok(u.threshold)}` : ""}</span>
        {asked
          ? <span className="woask"><button className="wocap first" onClick={() => { setAsked(false); onCompact?.(); }}>compact now</button><button className="wolink dim" onClick={() => setAsked(false)}>not now</button></span>
          : <button className="wocap" onClick={() => setAsked(true)} disabled={!onCompact || run.busy} title={run.busy ? "it is working: compact when the turn ends" : "/compact: Claude sums up the session and frees the window"}>Compact session</button>}
      </div>
      <p className="woline dim wohow">{u.how === "counted" ? "counted after the last turn" : u.how === "summary" ? "≈ a quick estimate until the turn ends and it is counted" : !given ? "this engine does not split the window yet: — cannot be known here" : "≈ estimated from the talk's length and the memory files; — cannot be known here"}</p>
    </div>
  );
}

export function OverviewPane({ w, items, cwd, branch, onFile, onUrl, onPr, send }: {
  w: Work; items: Item[]; cwd?: string; branch?: string; onFile: (path: string) => void; onUrl: (url: string) => void;
  onPr?: () => void; send?: (o: object) => void;
}) {
  const dev = DEV ? devData() : null;
  const run: (RunInfo & { usage?: Usage }) | undefined = dev ? dev.run : (w.run as (RunInfo & { usage?: Usage }) | undefined);
  if (dev) { items = dev.items; cwd = dev.cwd; branch = dev.branch; }
  const [open, setOpen] = useState<Record<string, boolean>>({ env: true, out: true, chg: true });
  const flip = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const [moving, setMoving] = useState(false);
  const u = run?.usage;
  const ctx = u?.total ?? run?.context ?? 0, win = u?.window || run?.window || 200000;
  const pct = Math.min(100, Math.round((ctx / win) * 100));
  const hot = !!u?.compactSoon || pct >= 80;

  // connectors: one row a name (two plugins can bring the same one), the rail's order, the ones needing Marco counted
  const seen = new Map<string, Mcp>();
  for (const m of (run?.mcp ?? []).filter((x) => x.name !== "sol")) {
    const n = dispName(m.name), was = seen.get(n);
    if (!was || (was.status === "connected" && m.status !== "connected")) seen.set(n, { name: m.name, status: m.status });
  }
  const mcp = [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const off = mcp.filter(([, m]) => m.status !== "connected");
  const [more, setMore] = useState(false);
  const outs = outputs(items);
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

  // Remote Control: asked once when the pane opens; turning on asks in place first
  const [rc, setRc] = useState<Remote | null>(dev ? dev.remote : null);
  const [rcBusy, setRcBusy] = useState(false);
  const [rcAsk, setRcAsk] = useState(false);
  useEffect(() => { if (!dev && w.loaded && rc === null) void w.ask<Remote>("work.remote", {}, 20_000).then(setRc); }, [w.loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const setRemote = (on: boolean) => {
    setRcAsk(false);
    if (dev) { setRc({ on, url: on ? "https://mac.example.ts.net/away" : undefined }); return; }
    setRcBusy(true);
    void w.ask<Remote>("work.remote", { on }, 30_000).then((r) => { setRc(r); setRcBusy(false); });
  };

  // Changes: the branch's +n −m and its pull request, asked when the folder changes and when a turn ends
  const busy = !!run?.busy;
  const [sum, setSum] = useState<Summary | null>(dev ? dev.summary : null);
  const here = useRef(cwd);
  here.current = cwd;
  useEffect(() => {
    if (dev || !cwd || !w.loaded || (busy && sum && !sum.error && here.current === sum.cwd)) return;
    const at = cwd;
    void w.ask<Summary>("work.changes.summary", { cwd }, 30_000).then((r) => here.current === at && setSum({ ...r, cwd: at }));
  }, [cwd, busy, w.loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const [prAsk, setPrAsk] = useState(false);
  const [prBusy, setPrBusy] = useState(false);
  const [prErr, setPrErr] = useState("");
  const createPr = () => {
    setPrAsk(false); setPrErr("");
    if (dev || !cwd) return;
    setPrBusy(true);
    void w.ask<{ pr?: Summary["pr"]; error?: string }>("work.pr.create", { cwd }, 120_000).then((r) => {
      setPrBusy(false);
      if (r.pr) { setSum((s) => ({ ...(s ?? {}), pr: r.pr })); onPr?.(); } else setPrErr(r.error ?? "it did not go");
    });
  };
  const mainLine = ["main", "master", "trunk", "live", "stable"].includes(sum?.branch ?? branch ?? "");
  const compact = dev ? () => {} : w.live && send ? () => send({ type: "work.compact", sessionId: w.live, model: w.model, effort: w.effort, mode: w.mode, fast: w.fast }) : undefined;

  return (
    <div className="wover">
      <Card name="Context" chev={open.ctx ? "down" : "side"} open={open.ctx} onToggle={() => flip("ctx")}
        right={open.ctx ? null : run ? <><span>{pct}%</span><span className={`wobar ${hot ? "hot" : ""}`}><i style={{ width: `${pct}%` }} /></span></> : <span>no session yet</span>}>
        <Context u={u} run={run} onCompact={compact} />
      </Card>

      <Card name="Environment" chev="down" open={open.env} onToggle={() => flip("env")}>
        <div className="worow">{Ico.machine}<span>{WHICH === "live" ? "the NucBox" : "this Mac"}</span>
          {moving
            ? <span className="woright"><button className="wolink" onClick={() => pickEngine(WHICH === "live" ? "next" : "live")}>move, Sol reloads</button><button className="wolink dim" onClick={() => setMoving(false)}>keep</button></span>
            : <button className="wolink woright dim" onClick={() => setMoving(true)}>{WHICH === "live" ? "this Mac instead" : "the NucBox instead"}</button>}
        </div>
        <div className="worow" title={cwd}>{Ico.folder}<span>{cwd ? base(cwd) : "~"}</span>{cwd && <em>· {short(tilde(cwd).replace(/\/[^/]+\/?$/, ""))}</em>}</div>
        <div className="worow">{Ico.branch}<span>{branch || "no branch"}</span></div>
        <div className="worow" title="the away page: this session from your phone, over Tailscale">{Ico.remote}<span>Remote Control</span>
          <span className="woright">{rc === null ? <em>asking…</em> : null}<Switch on={!!rc?.on} busy={rc === null || rcBusy} label="Remote Control" onChange={(v) => (v ? setRcAsk(true) : setRemote(false))} /></span>
        </div>
        {rcAsk && <div className="woask row"><span>Open the away page to your phone over Tailscale? Only your tailnet reaches it.</span><button className="wocap first" onClick={() => setRemote(true)}>turn on</button><button className="wolink dim" onClick={() => setRcAsk(false)}>not now</button></div>}
        {rc?.on && rc.url && <button className="wolink woline wourl" onClick={() => onUrl(rc.url!)}>{rc.url.replace(/^https:\/\//, "")}</button>}
        {rc?.error && <p className="woline wobad">{rc.error}</p>}
      </Card>

      <Card name="Connectors" chev={open.mcp ? "down" : "side"} open={open.mcp} onToggle={() => flip("mcp")}
        right={open.mcp ? null : !run ? "" : !mcp.length ? "none" : off.length ? `${off.length} to reconnect` : `${mcp.length} connected`}>
        {(more ? mcp : mcp.slice(0, 3)).map(([n, m]) => {
          const ai = m.name.startsWith("claude.ai ");
          return (
            <div className="worow woconn" key={n}><i className="wolet">{n.charAt(0).toUpperCase()}</i><span>{n}</span>
              <span className="woright">
                {m.status === "needs-auth" ? (ai ? <button className="wolink woauth" onClick={() => onUrl("https://claude.ai/settings/connectors")}>Authenticate</button>
                  : <em className="woauth" title="run /mcp in a terminal in this folder to sign in">Authenticate</em>)
                  : m.status === "failed" ? <em className="wobad">Failed</em> : m.status === "connected" ? null : <em>{m.status.replace(/-/g, " ")}</em>}
              </span>
            </div>
          );
        })}
        {mcp.length > 3 && <button className="wolink dim wolinkmore" onClick={() => setMore((x) => !x)}>{more ? "Show less" : "Show more"}</button>}
        {!mcp.length && <p className="woline dim">{run ? "no connectors in this session" : "the connectors show once the session runs"}</p>}
      </Card>

      <Card name="Outputs" chev="down" open={open.out} onToggle={() => flip("out")} right={outs.length ? "" : "nothing yet"}>
        {outs.slice(0, 12).map((o) => (
          <button className="worow wolinkrow" key={o.key} onClick={() => (o.url ? onUrl(o.url) : o.path && onFile(o.path))} title={o.url ?? o.path}>
            {Ico[o.kind]}<span>{o.label}</span><em className="woright">{o.kind === "artifact" ? "Artifact" : ""}</em>
          </button>
        ))}
      </Card>

      <Card name="Changes" chev="down" open={open.chg} onToggle={() => flip("chg")}
        right={!cwd ? "no folder" : sum?.notGit ? "not a git folder" : sum === null ? "" : ""}>
        {cwd && !sum?.notGit && (
          <div className="worow wochg">{Ico.diff}
            {sum === null ? <em>counting…</em> : sum.error ? <em className="wobad">{sum.error}</em>
              : <span className="wonum" title={`${sum.files ?? 0} files changed on ${sum.branch || "this branch"}`}><b>+{k(sum.add ?? 0)}</b> −{k(sum.del ?? 0)}</span>}
            <span className="woright">
              {sum?.pr ? <button className="wocap" onClick={() => onPr?.()} title={sum.pr.url}>#{sum.pr.number} {sum.pr.draft ? "draft" : sum.pr.state}</button>
                : mainLine ? <em title="a pull request needs its own branch">on {sum?.branch ?? branch}</em>
                : prBusy ? <em>creating…</em>
                : !prAsk && sum && !sum.error ? <button className="wocap" onClick={() => setPrAsk(true)}>Create PR</button> : null}
            </span>
          </div>
        )}
        {prAsk && <div className="woask row"><span>Push <b>{sum?.branch || branch}</b> and open a draft pull request from its commits?</span><button className="wocap first" onClick={createPr}>create</button><button className="wolink dim" onClick={() => setPrAsk(false)}>not now</button></div>}
        {prErr && <p className="woline wobad">{prErr}</p>}
      </Card>
    </div>
  );
}

// ---- ?dev=overview: the pane's data faked (a run at 79% with every part, 14 connectors, 5 outputs, +625 −0), so the
// shots need no live session. Only on the dev server, and it only replaces what this pane draws.
const DEV = import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).get("dev") === "overview";
let devCache: ReturnType<typeof makeDev> | null = null;
const devData = () => (devCache ??= makeDev());
function makeDev() {
  const q = new URLSearchParams(location.search);
  const how = (q.get("how") as Usage["how"]) || "counted";
  const servers: [string, number][] = [["claude_ai_Asana", 42], ["claude_ai_Atlassian", 61], ["claude_ai_Clickup", 38], ["claude_ai_Figma", 22], ["claude_ai_Gmail", 14], ["claude_ai_Google_Calendar", 9], ["claude_ai_Higgsfield", 57], ["claude_ai_Intercom", 18], ["linear", 46], ["claude_ai_Monday", 31], ["claude_ai_Notion", 27], ["claude_ai_Slack", 19], ["claude_ai_Pika", 21], ["claude_ai_Claude_Docs", 5]];
  const mcpList = servers.flatMap(([s, n]) => Array.from({ length: n }, (_, i) => `${s}:${["search", "create", "update", "list", "get", "delete"][i % 6]}_${["issue", "page", "task", "event", "comment", "file", "user"][i % 7]}${i >= 42 ? i : ""}`));
  const usage: Usage = how === "estimated" ? {
    total: 197800, window: 250000,
    parts: { messages: 128400, mcpTools: null, systemTools: null, systemPrompt: null, skills: null, memory: 4100, mcpInstructions: null, agents: null, buffer: null, free: 52200 },
    deferred: { mcpTools: null, systemTools: null }, lists: { mcp: mcpList, memory: ["/Users/marcol04/.claude/CLAUDE.md", "/Users/marcol04/computer/CLAUDE.md", "/Users/marcol04/computer/personal/CLAUDE.md"], agents: ["coder", "researcher", "reviewer"] },
    compactSoon: true, how, est: ["messages", "memory"], rest: 65300,
  } : {
    total: 197800, window: 250000,
    parts: { messages: 130000, mcpTools: 21100, systemTools: 20200, systemPrompt: 12800, skills: 8200, memory: 4300, mcpInstructions: 1700, agents: 755, buffer: 33000, free: 17800 },
    deferred: { mcpTools: 314000, systemTools: 20200 },
    lists: {
      mcp: mcpList,
      memory: ["/Users/marcol04/.claude/CLAUDE.md", "/Users/marcol04/computer/CLAUDE.md", "/Users/marcol04/computer/personal/CLAUDE.md", "/Users/marcol04/computer/personal/projects/ecosystem/CLAUDE.md", "/Users/marcol04/.claude/projects/-Users-marcol04-computer-personal-projects-ecosystem/memory/MEMORY.md"],
      agents: ["Brand Guardian", "China Market Localization Strategist", "coder", "Content Creator", "Growth Hacker", "researcher", "reviewer", "SEO Specialist", "Social Media Strategist", "UI Designer", "UX Architect"],
    },
    compactSoon: true, threshold: 217000, how, est: how === "summary" ? ["messages", "mcpTools", "systemTools", "systemPrompt", "skills", "memory", "mcpInstructions", "agents"] : [],
  };
  const st = ["needs-auth", "needs-auth", "needs-auth", "needs-auth", "failed", "failed", "needs-auth", "needs-auth", "connected", "needs-auth", "needs-auth", "needs-auth", "connected", "pending"];
  const names = ["claude.ai Asana", "claude.ai Atlassian", "claude.ai Clickup", "claude.ai Figma", "plugin:design:gmail", "plugin:productivity:google calendar", "claude.ai Higgsfield", "claude.ai Intercom", "linear", "claude.ai Monday", "claude.ai Notion", "claude.ai Slack", "claude.ai Pika", "claude.ai Claude Docs"];
  const run = {
    sessionId: "dev", busy: false, waiting: 0, cwd: "/Users/marcol04/computer/personal/projects/ecosystem", model: "claude-opus-5-5", effort: "high", mode: "default" as const, fast: false,
    context: 197800, window: 1_000_000, mcp: names.map((name, i) => ({ name, status: st[i] })), skills: ["design", "frontend-design", "pdf", "xlsx", "docx"], usage,
  };
  const at = Date.now();
  const tool = (id: string, name: string, input: object, out = "") => ({ id, kind: "tool", name, input, out, done: true, ok: true, at });
  const items: Item[] = [
    tool("t1", "Write", { file_path: "/Users/marcol04/computer/personal/projects/ecosystem/sol/test/26/1-life-take-this-to-work.jpg" }),
    tool("t2", "Write", { file_path: "/Users/marcol04/computer/personal/projects/ecosystem/sol/test/26/2a-plug-scene-before.jpg" }),
    tool("t3", "Write", { file_path: "/Users/marcol04/computer/personal/projects/ecosystem/sol/test/26/2b-plug-scene-after-engine-up.jpg" }),
    tool("t4", "Write", { file_path: "/Users/marcol04/computer/personal/projects/ecosystem/sol/test/26/3-after-engine-restart-same-conversation.jpg" }),
    tool("t5", "Artifact", { title: "Seven Slices" }, "published https://claude.ai/artifact/A9zJKtykYS2Ej9zuNgcHo2"),
  ];
  return {
    run, items, cwd: run.cwd, branch: "marco/together-overview",
    summary: { add: 625, del: 0, files: 9, branch: "marco/together-overview" } as Summary,
    remote: { on: q.get("remote") === "on", url: q.get("remote") === "on" ? "https://mac.example.ts.net/away" : undefined } as Remote,
  };
}
