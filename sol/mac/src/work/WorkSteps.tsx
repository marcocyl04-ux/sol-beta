import { memo, useLayoutEffect, useRef, useState } from "react";
import { pingKey } from "../land";
import { CellCheck, Runner } from "../creature/indicators";
import { GLYPH, html, reason } from "../Message";
import { CFG, enter, growTo, useSpring } from "../motion";
import { Fold, Swap } from "../MotionKit";
import type { Kind } from "../useEngine";
import type { Item } from "./useWork";
import { Diff, diffStat, editDiff } from "./Diff";
import { Elapsed } from "./Elapsed";

// Claude's work between two messages, as one card of rows. Each kind of tool has its own row: a shell command shows
// the command, an edit its +/− count and the diff, a run of reads and searches folds into one quiet row, a helper
// (subagent) carries its own steps inside it, a background command keeps a small runner until it ends, a web call
// its query, an MCP tool its server. The talk view (ctrl+O) says how much shows: normal hides finished thinking,
// thinking shows it, verbose opens every row.
export type TalkView = "normal" | "thinking" | "verbose";

const KIND: Record<string, Kind> = {
  Bash: "command", BashOutput: "command", KillShell: "command", KillBash: "command", Read: "read", NotebookRead: "read",
  Edit: "write", MultiEdit: "write", Write: "write", NotebookEdit: "write", Grep: "search", Glob: "search", LS: "search",
  WebFetch: "browse", WebSearch: "browse", Task: "desk", Agent: "desk",
};
const QUIET = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead"]);
// a path as a name: the home folder as ~, and a deep path cut to its last two parts
const short = (p: unknown) => {
  const s = String(p ?? "").replace(/^\/Users\/[^/]+/, "~");
  const parts = s.split("/");
  return parts.length > 4 ? `…/${parts.slice(-2).join("/")}` : s;
};
const mcp = (name: string) => /^mcp__(.+?)__(.+)$/.exec(name);

export function toolLine(name: string, i: any): string {
  switch (name) {
    case "Bash": return i.description || `$ ${String(i.command ?? "").split("\n")[0]}`;
    case "BashOutput": return "reading a background command's output";
    case "KillShell": case "KillBash": return "stopping a background command";
    case "Read": return `reading ${short(i.file_path)}`;
    case "Edit": case "MultiEdit": return `editing ${short(i.file_path)}`;
    case "Write": return `writing ${short(i.file_path)}`;
    case "NotebookEdit": return `editing ${short(i.notebook_path)}`;
    case "Grep": return `searching for “${i.pattern}”${i.path ? ` in ${short(i.path)}` : ""}`;
    case "Glob": return `finding ${i.pattern}`;
    case "LS": return `listing ${short(i.path)}`;
    case "WebFetch": { try { return `opening ${new URL(i.url).host}`; } catch { return `opening ${i.url}`; } }
    case "WebSearch": return `searching the web for “${i.query}”`;
    case "Task": case "Agent": return i.description || i.subagent_type || "a helper";
    case "Skill": return `using the ${i.skill ?? i.name ?? ""} skill`;
    case "ToolSearch": return "looking up tools";
    default: {
      const m = mcp(name);
      return m ? m[2].replace(/_/g, " ") : name;
    }
  }
}

// what a tool would do, said as a verb for a question: "run …", "edit app.js"
export function toolAsk(name: string, i: any): string {
  switch (name) {
    case "Bash": return i.description ? `run: ${i.description}` : "run a command";
    case "Edit": case "MultiEdit": return `edit ${short(i.file_path)}`;
    case "Write": return `write ${short(i.file_path)}`;
    case "NotebookEdit": return `edit ${short(i.notebook_path)}`;
    case "WebFetch": case "WebSearch": return toolLine(name, i).replace(/^opening/, "open").replace(/^searching/, "search");
    default: return `use ${toolLine(name, i)}`;
  }
}

// a summarised thought, as one line: its last heading, else its first line
export function gist(t: string) {
  const hs = [...t.matchAll(/\*\*([^*\n]{3,90})\*\*/g)];
  if (hs.length) return hs[hs.length - 1][1];
  const l = t.trim().split("\n").find(Boolean) ?? "";
  return l.length > 100 ? l.slice(0, 100) + "…" : l;
}

// a helper's report without the harness's frame around it (the hand-back preamble, the agent id and token tail)
const report = (out: string) => out.replace(/^[\s\S]*?The report follows:\s*/, "").replace(/\s*agentId: [\s\S]*$/, "").trim();

type Row = { key: string; it?: Item; group?: Item[] };

function rows(items: Item[], view: TalkView): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "think") {
      const live = it.done === false;
      if (!live && (!it.text || view === "normal")) continue;
      out.push({ key: it.id, it });
      continue;
    }
    if (it.kind !== "tool") continue;
    // a run of finished reads and searches: one quiet row (verbose shows each)
    if (view !== "verbose" && QUIET.has(it.name) && it.done) {
      let k = i;
      while (k < items.length && items[k].kind === "tool" && QUIET.has(items[k].name) && items[k].done) k++;
      if (k - i >= 2) { out.push({ key: "g" + it.id, group: items.slice(i, k) }); i = k - 1; continue; }
    }
    out.push({ key: it.id, it });
  }
  return out;
}

function groupLine(g: Item[]) {
  const reads = g.filter((x) => x.name === "Read" || x.name === "NotebookRead").length;
  const looks = g.length - reads;
  return [reads && `read ${reads} file${reads > 1 ? "s" : ""}`, looks && `searched ${looks} time${looks > 1 ? "s" : ""}`].filter(Boolean).join(", ");
}

export function WorkSteps({ items, all, view, old, nested }: { items: Item[]; all: Item[]; view: TalkView; old?: boolean; nested?: boolean }) {
  const list = rows(items, view);
  const live = items.some((s) => (s.kind === "tool" || s.kind === "think") && s.done === false);
  const ran = useRef(new Set<string>());
  const card = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (card.current && !old && !nested) { enter(card.current, { y: 14, cfg: CFG.arrive }); growTo(card.current, 0); }
    mounted.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null;
  return (
    <div ref={card} className={`steps wsteps ${live && !nested ? "live" : ""} ${nested ? "nested" : ""}`}>
      {list.map((r) => {
        if (r.it && r.it.done === false) ran.current.add(r.key);
        return <StepRow key={r.key} r={r} all={all} view={view} arrive={mounted.current && !old} ran={ran.current.has(r.key)} />;
      })}
    </div>
  );
}

// a row renders again only when its own item (or one of its group) is another object, the thread's items changed (a
// helper's children live there) or the view did: rows() makes new Row objects on every render, so the compare looks inside
const sameRow = (a: { r: Row; all: Item[]; view: TalkView; arrive: boolean; ran: boolean }, b: typeof a) =>
  a.r.key === b.r.key && a.r.it === b.r.it && a.all === b.all && a.view === b.view && a.arrive === b.arrive && a.ran === b.ran &&
  (a.r.group === b.r.group || (!!a.r.group && !!b.r.group && a.r.group.length === b.r.group.length && a.r.group.every((x, i) => x === b.r.group![i])));
const StepRow = memo(function StepRow({ r, all, view, arrive, ran }: { r: Row; all: Item[]; view: TalkView; arrive: boolean; ran: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mine, setOpen] = useState<boolean | null>(null);
  const [seenView, setSeenView] = useState(view);
  if (seenView !== view) { setSeenView(view); setOpen(null); }
  // a new step draws in left to right as it slides (the show), on a spring: the clip opens from the right edge
  const draw = useSpring(0, CFG.slide, (v) => { if (ref.current) ref.current.style.clipPath = v > 0.5 ? `inset(-4px ${v}% -4px 0)` : ""; });
  useLayoutEffect(() => { if (ref.current && arrive) { enter(ref.current, { x: -16, cfg: CFG.arrive }); growTo(ref.current, 0); draw.set(100); draw.to(0); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  let k: Kind = "note", text = "", meta: React.ReactNode = null, detail: React.ReactNode = null, running = false, ok: boolean | undefined, cls = "", why = "";
  if (r.group) {
    k = "read"; text = groupLine(r.group); ok = r.group.every((x) => x.ok !== false); cls = "quiet";
    detail = <WorkSteps items={r.group} all={all} view="verbose" old nested />;
  } else {
    const it = r.it!;
    if (it.kind === "think") {
      k = "reasoning"; running = it.done === false;
      text = it.text ? gist(String(it.text)) : "";
      if (it.text) detail = <div className="step-detail prose md" dangerouslySetInnerHTML={{ __html: html(String(it.text)) }} />;
    } else {
      const name = String(it.name), input = it.input ?? {};
      k = KIND[name] ?? "note"; text = toolLine(name, input); running = !it.done; ok = it.done ? it.ok !== false : undefined;
      const out = it.out ? String(it.out) : "";
      if (it.done && it.ok === false) why = reason(out);
      const m = mcp(name);
      const d = editDiff(name, input);
      if (name === "Bash") {
        cls = "wsh";
        meta = it.input?.description ? <code className="cmd">{String(input.command ?? "").split("\n")[0]}</code> : null;
        detail = <pre className="step-detail"><b>$ {String(input.command ?? "")}</b>{out ? "\n\n" + out : ""}</pre>;
      } else if (d) {
        const st = diffStat(d);
        meta = <span className="stat"><b>+{st.add}</b> <i>−{st.del}</i></span>;
        detail = <div className="step-detail flush"><Diff d={d} />{it.ok === false && out ? <pre className="err">{out}</pre> : null}</div>;
      } else if (name === "Task" || name === "Agent") {
        cls = "helper";
        const kids = all.filter((x) => x.parent === it.id);
        const steps = kids.filter((x) => x.kind === "tool" || x.kind === "think");
        const said = kids.filter((x) => x.kind === "you" && x.text).pop();
        const n = steps.filter((x) => x.kind === "tool").length;
        meta = <span className="who">{String(input.subagent_type ?? "helper")}{n ? ` · ${n} step${n > 1 ? "s" : ""}` : ""}</span>;
        if (running && it.progress) text = `${text}: ${it.progress}`;
        detail = (
          <div className="step-detail flush helper-in">
            {input.prompt && <p className="brief">{String(input.prompt).slice(0, 600)}</p>}
            <button className="wlink wopen" onClick={(ev) => { ev.stopPropagation(); window.dispatchEvent(new CustomEvent("sol:helper", { detail: it.id })); }}>open in the helper pane</button>
            <WorkSteps items={steps} all={all} view={view} old nested />
            {(said || out) && <div className="report md" dangerouslySetInnerHTML={{ __html: html(report(out) || String(said?.text ?? "")) }} />}
          </div>
        );
      } else {
        if (m) meta = <span className="srv">{m[1].replace(/^plugin_[^_]+_/, "")}</span>;
        const shown = name === "WebSearch" || name === "WebFetch" ? String(input.url ?? input.query ?? "") : JSON.stringify(input, null, 1);
        detail = <pre className="step-detail">{shown && shown !== "{}" ? shown + "\n\n" : ""}{out}</pre>;
      }
      if (it.bg) { cls += " bg"; meta = <>{meta}<span className={`behind ${it.bgDone ? "over" : ""}`}>{it.bgDone ? (it.ok === false ? "failed behind" : "done behind") : <><Runner />behind</>}</span></>; }
      if (it.summary && !running) text = String(it.summary);
    }
  }
  const can = !!detail;
  const open = can && (mine ?? (view === "verbose"));
  return (
    <div ref={ref} data-item={r.it?.id} data-ping={r.it && /__ping$/.test(String(r.it.name)) ? pingKey(String(r.it.input?.line ?? "")) : undefined} className={`step wstep ${k} ${cls} ${running ? "running" : ""} ${ok === false ? "failed" : ""} ${can ? "can" : ""} ${open ? "open" : ""}`}>
      <div className="step-row" onClick={can ? () => setOpen(!open) : undefined}>
        <span className="glyph"><Swap k={running ? "run" : "glyph"} dist={14} cfg={CFG.snap}>{running ? <Runner /> : GLYPH[k]}</Swap></span>
        <span className="step-text">{k === "reasoning" ? <><span className="pre">{running ? "thinking… " : "thought: "}</span>{text}</> : text}</span>
        {meta && <span className="step-meta">{meta}</span>}
        <span className="step-state">{running ? <Elapsed at={r.it?.at} /> : ok === false ? <i className="bad" /> : ok === true ? <CellCheck land={ran} /> : null}</span>
      </div>
      {why && <div className="step-why" title={why}>{why}</div>}
      {can && <Fold open={open} lazy from={{ y: 8 }} gap={0}>{detail}</Fold>}
    </div>
  );
}, sameRow);
