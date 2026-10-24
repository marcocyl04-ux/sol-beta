import { memo, useLayoutEffect, useRef, useState } from "react";
import { pingKey } from "./land";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Kind, Msg } from "./useEngine";
import { CardEdge, CellCheck, Runner } from "./creature/indicators";
import { CFG, enter, growTo, reducedMotion } from "./motion";
import { Fold, Swap } from "./MotionKit";
import { onRan, ranOf, request, runnable, stopRun } from "./run";

marked.setOptions({ gfm: true, breaks: false });

// Tables get a scrolling card around them; the rest is marked as is.
export const html = (t: string) =>
  DOMPurify.sanitize((marked.parse(t, { async: false }) as string).replace(/<table>/g, '<div class="tbl"><table>').replace(/<\/table>/g, "</table></div>"));

function openLink(e: React.MouseEvent) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href");
  if (!href) return;
  import("@tauri-apps/plugin-opener").then((o) => o.openUrl(href)).catch(() => window.open(href, "_blank"));
}

const Files = ({ files }: { files?: Msg["files"] }) =>
  files && files.length ? (
    <div className="sent-files">
      {files.map((f, i) => (f.url && /^(data:image|.*\.(png|jpe?g|gif|webp)$)/i.test(f.url + f.name)
        ? <img key={i} src={f.url} alt={f.name} title={f.name} />
        : <span key={i}>{f.name}</span>))}
    </div>
  ) : null;

// The answer, written into its box block by block. The box is kept (not re-set as a string) so a block that is
// still arriving keeps its place and its animation: a block that exists is patched in place, a new block slides up
// from 12 px low while it opens from nothing, and a block that grows a line opens under it on a spring. The caret
// (the eye, in CSS) rides the last block, so it travels with the text. Old messages (loaded, not arriving) are set whole.
function write(el: HTMLElement, h: string, animate: boolean) {
  const tpl = document.createElement("template");
  tpl.innerHTML = h;
  const next = Array.from(tpl.content.children) as HTMLElement[];
  const cur = (Array.from(el.children) as HTMLElement[]).filter((c) => !c.classList.contains("ran"));
  let fresh = 0;
  for (let i = 0; i < next.length; i++) {
    const c = cur[i], n = next[i];
    if (c && c.tagName === n.tagName) {
      if (!c.isEqualNode(n)) {
        c.innerHTML = n.innerHTML;
        for (const a of Array.from(n.attributes)) if (c.getAttribute(a.name) !== a.value) c.setAttribute(a.name, a.value);
        if (animate) growTo(c);
      }
    } else {
      if (c) c.remove();
      const after = (Array.from(el.children) as HTMLElement[]).filter((x) => !x.classList.contains("ran"))[i] ?? null;
      el.insertBefore(n, after);
      if (animate && !reducedMotion()) {
        // when several blocks arrive together (a whole answer at once) they follow one another down the page
        enter(n, { y: 12, delay: fresh * 70, cfg: CFG.arrive });
        growTo(n, 0);
        fresh++;
      }
    }
  }
  for (let i = cur.length - 1; i >= next.length; i--) { if (cur[i].nextElementSibling?.classList.contains("ran")) cur[i].nextElementSibling!.remove(); cur[i].remove(); }
}

// The run cell on a shell block and the output under it (run.ts). write() patches blocks in place, so after each write
// the blocks are decorated again: the cell put back if a patch took it, the output kept right after its block.
let replies = 0;
function decorate(el: HTMLElement, key: string) {
  for (const o of Array.from(el.querySelectorAll(":scope > .ran"))) if (!(o.previousElementSibling?.tagName === "PRE")) o.remove();
  (Array.from(el.querySelectorAll("pre")) as HTMLElement[]).forEach((pre, i) => {
    const code = pre.querySelector("code") as HTMLElement | null;
    if (!code || !runnable(code)) return;
    const rid = `${key}:${i}`, cmd = (code.textContent ?? "").trim();
    pre.classList.add("can-run");
    let cell = pre.querySelector(":scope > .run") as HTMLButtonElement | null;
    if (!cell) {
      cell = document.createElement("button");
      cell.className = "run"; cell.type = "button"; cell.title = "run it here";
      cell.innerHTML = "<i></i><span>run</span>";
      cell.addEventListener("click", (ev) => { ev.stopPropagation(); const r = ranOf(rid); if (r && !r.done) stopRun(rid); else request(rid, cmd); });
      pre.appendChild(cell);
    }
    const r = ranOf(rid);
    cell.classList.toggle("busy", !!r && !r.done);
    cell.querySelector("span")!.textContent = r && !r.done ? "stop" : r ? "again" : "run";
    let out = pre.nextElementSibling as HTMLElement | null;
    if (!out?.classList.contains("ran")) out = null;
    if (!r) { out?.remove(); return; }
    if (!out) {
      out = document.createElement("div");
      out.className = "ran";
      out.innerHTML = '<div class="ran-head"><i></i><span class="ran-code"></span></div><pre class="ran-out"></pre>';
      pre.after(out);
      if (!reducedMotion()) { enter(out, { y: 8, cfg: CFG.arrive }); growTo(out, 0); }
    }
    out.classList.toggle("busy", !r.done);
    out.classList.toggle("bad", r.done && r.code !== 0);
    (out.querySelector(".ran-code") as HTMLElement).textContent = !r.done ? "running" : r.why ?? (r.code === 0 ? "done" : `exit ${r.code}`);
    const body = out.querySelector(".ran-out") as HTMLElement;
    const text = r.out || (r.done && !r.why ? "(no output)" : "");
    if (body.textContent !== text) { body.textContent = text; body.scrollTop = body.scrollHeight; }
  });
}

function Reply({ m, live }: { m: Msg; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = useRef(`r${++replies}`);
  const animate = !m.old;
  useLayoutEffect(() => { if (ref.current) { write(ref.current, html(m.text), animate); decorate(ref.current, key.current); } }, [m.text, animate]);
  useLayoutEffect(() => onRan(() => { if (ref.current) decorate(ref.current, key.current); }), []);
  return <div ref={ref} data-item={m.id} className={`msg you md ${live ? "live" : ""}`} onClick={openLink} />;
}

// Marco's words leave the box and land: they come up from the composer with a little spring (and a little scale)
function Mine({ m }: { m: Msg }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = ref.current;
    if (row && !m.old) { enter(row, { x: 14, y: 34, scale: 0.08, cfg: { k: 300, z: 0.62 } }); growTo(row, 0, { k: 300, z: 0.8 }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} data-item={m.id} className="me-row"><div className={`msg me ${m.call ? "call" : ""}`}><Files files={m.files} />{m.text}</div></div>;
}

// A line of a call: slides up when it begins; its words update in place while they are still being heard
function CallLine({ m }: { m: Msg }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current && !m.old) { enter(ref.current, { y: 14, cfg: CFG.arrive }); growTo(ref.current, 0); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} className={`msg you call ${m.done ? "" : "live"}`}>{m.text}</div>;
}

export const Message = memo(function Message({ m, live }: { m: Msg; live: boolean }) {
  if (m.who === "me") return <Mine m={m} />;
  if (m.call) return <CallLine m={m} />;
  return <Reply m={m} live={live} />;
});

// ---- steps: a run of the seat's work between two messages ----

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const GLYPH: Record<Kind, React.ReactNode> = {
  command: <svg viewBox="0 0 16 16" {...P}><path d="M3 4.5 7 8l-4 3.5M8.5 12H13" /></svg>,
  read: <svg viewBox="0 0 16 16" {...P}><path d="M4 2h5.5L13 5.5V14H4z M9.5 2v3.5H13 M6.5 8.5h3.5M6.5 11h3.5" /></svg>,
  write: <svg viewBox="0 0 16 16" {...P}><path d="M3 13h10M3 10.5 10.5 3l2.5 2.5L5.5 13H3z M9 4.5l2.5 2.5" /></svg>,
  search: <svg viewBox="0 0 16 16" {...P}><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></svg>,
  browse: <svg viewBox="0 0 16 16" {...P}><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.8 1.8 1.8 9.2 0 11M8 2.5c-1.8 1.8-1.8 9.2 0 11" /></svg>,
  desk: <svg viewBox="0 0 16 16" {...P}><rect x="2.5" y="4" width="11" height="8.5" rx="1.5" /><path d="M5.5 8.5h5" /></svg>,
  reasoning: <svg viewBox="0 0 16 16" {...P}><path d="M8 2.5v1.5M8 12v1.5M2.5 8H4M12 8h1.5M4.1 4.1l1.1 1.1M10.8 10.8l1.1 1.1M4.1 11.9l1.1-1.1M10.8 5.2l1.1-1.1" /></svg>,
  note: <svg viewBox="0 0 16 16" {...P}><circle cx="8" cy="8" r="5.5" /><path d="M8 7v4M8 5.2v.2" /></svg>,
  error: <svg viewBox="0 0 16 16" {...P}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.5M8 11v.2" /></svg>,
};

// A step row: arrives sliding in from the left while its height opens (once the card is already there); its
// detail is a Fold, so it opens and closes on a height spring and keeps its content once loaded.
// a Life ping's step (ping.ts: "pinging Marco: <line>"): the notch's Open lands on it (land.ts)
const PINGING = "pinging Marco: ";
function StepRow({ s, k, shown, can, arrive, onToggle, ran }: {
  s: Msg; k: Kind; shown: boolean; can: boolean; arrive: boolean; onToggle: () => void; ran: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current && arrive) { enter(ref.current, { x: -16, cfg: CFG.arrive }); growTo(ref.current, 0); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const running = s.done === false;
  return (
    <div ref={ref} data-item={s.id} data-ping={s.text?.startsWith(PINGING) ? pingKey(s.text.slice(PINGING.length)) : undefined}
      className={`step ${k} ${running ? "running" : ""} ${s.ok === false ? "failed" : ""} ${can ? "can" : ""} ${shown ? "open" : ""}`}>
      <div className="step-row" onClick={can ? onToggle : undefined}>
        {/* the runner leaves upward as the glyph comes in from below: a step finishing */}
        <span className="glyph"><Swap k={running ? "run" : "glyph"} dist={14} cfg={CFG.snap}>{running ? <Runner /> : GLYPH[k]}</Swap></span>
        <span className="step-text">{k === "reasoning" ? <><span className="pre">thinking… </span>{s.text}</> : s.text}</span>
        <span className="step-state">{running ? null : s.ok === false || k === "error" ? <i className="bad" /> : s.ok === true ? <CellCheck land={ran} /> : null}</span>
      </div>
      {can && <Fold open={shown} lazy from={{ y: 8 }} gap={0}><pre className={`step-detail ${k === "reasoning" ? "prose" : ""}`}>{s.detail}</pre></Fold>}
    </div>
  );
}

export function Steps({ steps, old }: { steps: Msg[]; old?: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const live = steps.some((s) => s.done === false);
  // steps seen running here: when one finishes, its check lands; checks from history are simply there
  const ran = useRef(new Set<string>());
  // the card itself unfolds from nothing when it first appears; rows added later slide in
  const card = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (card.current && !old) { enter(card.current, { y: 14, cfg: CFG.arrive }); growTo(card.current, 0); }
    mounted.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={card} className={`steps ${live ? "live" : ""}`}>
      {live && <CardEdge />}
      {steps.map((s, i) => {
        const k = s.kind ?? "note";
        const key = s.id ?? `i${i}`;
        const can = !!s.detail;
        if (s.done === false) ran.current.add(key);
        return <StepRow key={key} s={s} k={k} can={can} shown={can && !!open[key]} arrive={mounted.current && !old} ran={ran.current.has(key)}
          onToggle={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} />;
      })}
    </div>
  );
}
