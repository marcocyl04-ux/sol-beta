import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ENGINE_HTTP as HTTP } from "../engine";
import type { useEngine } from "../useEngine";
import { Screencast } from "../Screencast";
import type { Work } from "./useWork";
import { Empty } from "./Panes";
import { describe, lineOf, throughBrowser, wordsOf, withBase, type Page } from "./pages";

// The page pane (#54): a page the session wrote, rendered beside the talk, where Marco points at what is wrong. A
// click pins a spot (the element under it; selected words, when there are some), a drag pins a block (the smallest
// element holding the box); each pin takes a comment, Enter keeps it. ⌘↵ puts them all in the box as one message
// naming the element, the words there and the file and line where it starts, so the session goes straight to it.
// The page comes over the wire (work.read) and renders in a frame of this origin, its own assets from the engine
// (GET /pane-asset). "live" lets the page be used instead (links, buttons); option-click still pins.
// An artifact on claude.ai is shown through Sol's browser instead (Screencast, its own tab in this session): a click
// asks the engine what is under it (browser.inspect) and the answer is a pin like any other; after the pane sends
// input, or the tab goes to another address, the pins are found again by their selectors (browser.locate).
type Read = { path?: string; text?: string; mtime?: number; error?: string; tooBig?: boolean; binary?: boolean; dir?: boolean };
// box: where a pin in a browser tab is, in the tab's CSS px (null: its element is not on the page now)
type Pin = { n: number; sel: string; words: string; line?: number; block?: { w: number; h: number }; text: string; el?: Element; box?: R | null };
type R = { left: number; top: number; width: number; height: number };
type B = { x: number; y: number; w: number; h: number };
type Eng = Pick<ReturnType<typeof useEngine>, "tabs" | "send" | "subscribeFrames">;
const toR = (b: B): R => ({ left: b.x, top: b.y, width: b.w, height: b.h });
const times = (r: R, k: number): R => ({ left: r.left * k, top: r.top * k, width: r.width * k, height: r.height * k });

const rel = (abs: string, cwd?: string) => (cwd && abs.startsWith(cwd.replace(/\/$/, "") + "/") ? abs.slice(cwd.replace(/\/$/, "").length + 1) : abs.replace(/^\/Users\/[^/]+/, "~"));
const newest = (ps: Page[]) => ps.reduce<Page | null>((m, p) => (!m || p.at >= m.at ? p : m), null);

export function PagePane({ w, e, cwd, pages, onBox, onFile }: {
  w: Work; e: Eng; cwd?: string; pages: Page[]; onBox: (text: string) => void; onFile: (path: string, line?: number) => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const last = newest(pages);
  const page = pages.find((p) => p.key === pick) ?? last;
  // a page written anew shows itself (as the Claude app's artifact does); a chip picks another
  useEffect(() => { if (last) setPick(last.key); }, [last?.key, last?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [html, setHtml] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"comment" | "live">("comment");
  const [pins, setPins] = useState<Pin[]>([]);
  const [writing, setWriting] = useState<Pin | null>(null);
  const [text, setText] = useState("");
  const [box, setBox] = useState<R | null>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [, setTick] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null), stage = useRef<HTMLDivElement>(null), field = useRef<HTMLTextAreaElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const via = !!page && throughBrowser(page);

  // the file, read when the page changes and again after each edit the session makes to it
  const load = async () => {
    if (!page?.path || !cwd) return;
    setNote("");
    const r = await w.ask<Read>("work.read", { cwd, path: page.path });
    if (r.error || r.tooBig || r.binary || r.dir || r.text === undefined) { setHtml(null); setNote(r.error ?? (r.tooBig ? "too big to show here." : "not a page that can be shown.")); return; }
    setHtml(r.text);
  };
  useEffect(() => { void load(); }, [page?.path, page?.n, cwd]); // eslint-disable-line react-hooks/exhaustive-deps
  // the pins belong to the page they were put on
  useEffect(() => { setPins([]); setWriting(null); setText(""); setBox(null); }, [page?.key]);

  const bump = () => requestAnimationFrame(() => setTick((t) => t + 1));
  const onLoad = () => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    setDoc(d); setTitle(d.title); bump();
    d.addEventListener("scroll", bump, { passive: true, capture: true });
    d.defaultView?.addEventListener("resize", bump);
  };
  useEffect(() => { const ro = new ResizeObserver(bump); if (stage.current) ro.observe(stage.current); return () => ro.disconnect(); }, [via, pages.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // pointing: in comment mode a click pins and nothing in the page acts; a drag draws a box; live, option does the same
  // the drag in flight lives in a ref: the listeners are put back on every render (the box drawn is one), and a
  // closure would forget the press
  const drag = useRef<{ start: { x: number; y: number } | null; moved: boolean }>({ start: null, moved: false });
  useEffect(() => {
    if (!doc || !html) return;
    const g = drag.current;
    const arm = (ev: MouseEvent) => mode === "comment" || ev.altKey;
    const down = (ev: MouseEvent) => { if (ev.button !== 0 || !arm(ev)) return; g.start = { x: ev.clientX, y: ev.clientY }; g.moved = false; };
    const move = (ev: MouseEvent) => {
      if (!g.start) return;
      const x = Math.min(g.start.x, ev.clientX), y = Math.min(g.start.y, ev.clientY), width = Math.abs(ev.clientX - g.start.x), height = Math.abs(ev.clientY - g.start.y);
      if (!g.moved && Math.hypot(width, height) < 6) return;
      g.moved = true; doc.getSelection()?.removeAllRanges(); setBox({ left: x, top: y, width, height });
    };
    const up = (ev: MouseEvent) => {
      if (!g.start) return;
      const s = g.start; g.start = null; setBox(null);
      if (g.moved) pinAt(s, { left: Math.min(s.x, ev.clientX), top: Math.min(s.y, ev.clientY), width: Math.abs(ev.clientX - s.x), height: Math.abs(ev.clientY - s.y) });
      else pinAt({ x: ev.clientX, y: ev.clientY });
    };
    const click = (ev: MouseEvent) => { if (arm(ev)) { ev.preventDefault(); ev.stopPropagation(); } };
    doc.addEventListener("mousedown", down, true); doc.addEventListener("mousemove", move, true); doc.addEventListener("mouseup", up, true); doc.addEventListener("click", click, true);
    return () => { doc.removeEventListener("mousedown", down, true); doc.removeEventListener("mousemove", move, true); doc.removeEventListener("mouseup", up, true); doc.removeEventListener("click", click, true); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const pinAt = (p: { x: number; y: number }, block?: R) => {
    if (!doc || !html) return;
    let el: Element | null = block ? doc.elementFromPoint(block.left + block.width / 2, block.top + block.height / 2) : doc.elementFromPoint(p.x, p.y);
    if (!el || el === doc.documentElement) el = doc.body;
    if (!el) return;
    if (block) {   // the smallest element that holds the whole box
      while (el && el !== doc.body) {
        const r = el.getBoundingClientRect();
        if (r.left <= block.left + 1 && r.top <= block.top + 1 && r.right >= block.left + block.width - 1 && r.bottom >= block.top + block.height - 1) break;
        el = el.parentElement;
      }
      if (!el) el = doc.body;
    }
    const s = doc.getSelection();
    const picked = !block && s && !s.isCollapsed ? s.toString().replace(/\s+/g, " ").trim() : "";
    if (picked && s?.anchorNode) { const a = s.anchorNode.nodeType === 1 ? (s.anchorNode as Element) : s.anchorNode.parentElement; if (a && el.contains(a)) el = a; }
    const words = picked ? (picked.length > 70 ? picked.slice(0, 69).trimEnd() + "…" : picked) : wordsOf(el);
    const line = page?.path ? lineOf(html, el, picked || words) : undefined;
    setWriting({ n: pins.length + 1, sel: describe(el), words, line, text: "", el, ...(block ? { block: { w: Math.round(block.width), h: Math.round(block.height) } } : {}) });
    setText("");
    requestAnimationFrame(() => field.current?.focus());
  };

  // ---- an artifact, through the browser ----
  // its tab: the one opened for it here, else one of this session's already at its address. It is opened once the
  // pane is seen (a pane kept behind another tab opens nothing) and remembered when it comes, wherever it goes after
  // (a sign-in page, another artifact).
  const sid = w.live ?? undefined;
  const mine = e.tabs.filter((t) => t.sessionId === sid);
  const bound = useRef(new Map<string, string>());
  const opening = useRef<{ url: string; known: Set<string> } | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSeen(el.clientWidth > 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pages.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const url = via ? page!.url! : "";
  const tab = via ? mine.find((t) => t.id === bound.current.get(url)) ?? mine.find((t) => t.url.startsWith(url)) : undefined;
  useEffect(() => {
    const o = opening.current;
    const come = o ? mine.find((t) => !o.known.has(t.id)) : undefined;
    if (o && come) { bound.current.set(o.url, come.id); opening.current = null; setTick((t) => t + 1); }
    if (tab) bound.current.set(url, tab.id);
    if (!url || !seen || tab || come || opening.current?.url === url) return;
    opening.current = { url, known: new Set(mine.map((t) => t.id)) };
    e.send({ type: "browser.open", url, sessionId: sid });
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (via && tab?.title) setTitle(tab.title); }, [via, tab?.title]);

  // a click (comment mode) or an option-click (live) asks what is under it; the answer is the pin being written
  const pinsNow = useRef(pins); pinsNow.current = pins;
  const writingNow = useRef(writing); writingNow.current = writing;
  const tabNow = useRef(tab?.id); tabNow.current = tab?.id;
  const pinInside = async (p: { x: number; y: number }) => {
    const id = tab?.id;
    if (!id) return;
    const r = await w.ask<{ sel?: string; words?: string; title?: string; box?: B }>("browser.inspect", { tab: id, x: p.x, y: p.y }, 4000);
    if (!r.sel || !r.box || tabNow.current !== id) return;
    if (r.title) setTitle(r.title);
    setWriting({ n: pinsNow.current.length + 1, sel: r.sel, words: r.words ?? "", text: "", box: toR(r.box) });
    setText("");
  };
  // the pins found again ~150 ms after the pane last sent input, its tab went to another address or its frame changed
  // size; frames for a second after input count too (a scroll that eases, a page that moves when clicked)
  const again = useRef<number | undefined>(undefined), touched = useRef(0), frameSize = useRef("");
  const placeAgain = () => {
    window.clearTimeout(again.current);
    again.current = window.setTimeout(async () => {
      const id = tabNow.current, ps = [...pinsNow.current, ...(writingNow.current ? [writingNow.current] : [])];
      if (!id || !ps.length) return;
      const sels = [...new Set(ps.map((p) => p.sel))];
      const r = await w.ask<{ boxes?: (B | null)[] }>("browser.locate", { tab: id, sels }, 4000);
      if (!r.boxes || tabNow.current !== id) return;
      const at = new Map(sels.map((s, i) => [s, r.boxes![i] ? toR(r.boxes![i]!) : null]));
      setPins((ps) => ps.map((p) => (at.has(p.sel) ? { ...p, box: at.get(p.sel) } : p)));
      setWriting((wr) => (wr && at.has(wr.sel) ? { ...wr, box: at.get(wr.sel) } : wr));
    }, 150);
  };
  useEffect(() => () => window.clearTimeout(again.current), []);
  useEffect(() => { if (via) placeAgain(); }, [via, tab?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const onFrame = (f: { w: number; h: number }) => {
    const size = `${f.w}x${f.h}`;
    if (size !== frameSize.current) { frameSize.current = size; placeAgain(); }
    else if (Date.now() - touched.current < 1000) placeAgain();
  };

  const keep = () => {
    if (!writing) return;
    if (text.trim()) setPins((ps) => [...ps, { ...writing, text: text.trim() }]);
    setWriting(null); setText("");
  };
  const drop = (n: number) => setPins((ps) => ps.filter((p) => p.n !== n).map((p, i) => ({ ...p, n: i + 1 })));
  // the message: one line per pin, the element, its words, the file and line, the comment
  const send = () => {
    const all = writing && text.trim() ? [...pins, { ...writing, text: text.trim() }] : pins;
    if (!all.length || !page) return;
    const where = page.path ? rel(page.path, cwd) : page.url ?? "";
    const body = all.map((p) => `${p.n}. \`${p.sel}\`${p.words ? ` "${p.words}"` : ""}${p.block ? ` (the block, ${p.block.w}×${p.block.h})` : ""}${p.line && page.path ? ` — ${where}:${p.line}` : ""}: ${p.text}`).join("\n");
    onBox(`Comments on the page ${where}${title ? ` ("${title}")` : ""}, pinned where they are:\n${body}`);
    setPins([]); setWriting(null); setText("");
  };
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.metaKey && ev.key === "Enter" && (pins.length || (writing && text.trim())) && pane.current?.offsetParent) { ev.preventDefault(); send(); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  // where a pin is now: its element's box in the frame (the element found again by its selector after a reload)
  const rectOf = (p: Pin): R | null => {
    if (!doc) return null;
    let el: Element | null = null;
    try { el = p.el?.isConnected ? p.el : doc.querySelector(p.sel); } catch { el = null; }
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  useLayoutEffect(() => { if (writing) field.current?.focus(); }, [writing]);
  // the pins, the one being written with its comment field under it (above it near the bottom), and the box in
  // flight, over a stage of W × H; rect: where a pin is on that stage
  const marks = (rect: (p: Pin) => R | null, W: number, H: number) => {
    const wr = writing ? rect(writing) : null;
    const fieldAt = wr ? { left: Math.max(6, Math.min(wr.left, W - 286)), top: wr.top + wr.height + 8 > H - 90 ? Math.max(6, wr.top - 90) : wr.top + wr.height + 8 } : null;
    return (
      <div className="wpover">
        {pins.map((p) => { const r = rect(p); return r ? <div key={p.n} className="wpin" style={r}><b>{p.n}</b></div> : null; })}
        {wr && <div className="wpin live" style={wr}><b>{writing!.n}</b></div>}
        {box && <div className="wpbox" style={box} />}
        {writing && fieldAt && (
          <div className="wpwrite" style={fieldAt}>
            <small title={writing.sel}>{writing.sel}{writing.line ? ` · line ${writing.line}` : ""}</small>
            <textarea ref={field} rows={2} value={text} placeholder={writing.block ? "a comment on this block" : "a comment on this spot"} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.metaKey) { e.preventDefault(); keep(); } else if (e.key === "Escape") { e.stopPropagation(); setWriting(null); setText(""); } }} />
          </div>
        )}
      </div>
    );
  };

  const dir = page?.path ? page.path.replace(/\/[^/]*$/, "") : "";
  const src = html && page?.path ? withBase(html, `${HTTP}/pane-asset/${encodeURIComponent(dir)}/`) : "";

  if (!pages.length) return <Empty>no page in this session yet. When Claude writes an HTML file or an artifact, it shows here.</Empty>;
  return (
    <div ref={pane} className="wpagep">
      {pages.length > 1 && (
        <div className="wpchips">
          {pages.map((p) => <button key={p.key} className={p.key === page?.key ? "on" : ""} onClick={() => setPick(p.key)} title={p.path ?? p.url}>{p.url ? `${p.name} ↗` : p.name}</button>)}
        </div>
      )}
      {page && (
        <div className="wfbar">
          <span className="p" title={page.path ?? page.url}>{title || page.name}</span>
          {page.path && <button className="wlink" onClick={() => void load()}>read again</button>}
          {page.path && <button className="wlink" onClick={() => onFile(page.path!)} title="the source, in the file pane">source</button>}
          <span className="grow" />
          {(page.path || via) && <button className={`wlink ${mode === "live" ? "on" : ""}`} onClick={() => setMode((m) => (m === "live" ? "comment" : "live"))}
            title={mode === "live" ? "the page is live: click, scroll and type as usual; option-click pins. Click to go back to commenting" : via ? "a click pins a spot. Click to use the page instead" : "a click pins a spot, a drag pins a block. Click to use the page instead"}>
            {mode === "live" ? "live" : "commenting"}</button>}
          {(pins.length > 0 || (writing && text.trim())) && <button className="wbtn" onClick={send}>to the box <kbd>⌘↵</kbd></button>}
        </div>
      )}
      {note && <p className="wfnote">{note}</p>}
      {via ? (
        <Screencast tab={tab?.id} send={e.send} subscribe={e.subscribeFrames} live={mode === "live"} marking={mode === "comment"}
          onPick={(p) => void pinInside(p)} onInput={() => { touched.current = Date.now(); placeAgain(); }} onFrame={onFrame}
          over={(k, s) => marks((p) => (p.box ? times(p.box, k) : null), s.w, s.h)} />
      ) : (
        <div ref={stage} className={`wpstage ${mode === "comment" ? "marking" : ""}`}>
          {src && <iframe ref={frame} title={title || page?.name} srcDoc={src} onLoad={onLoad} />}
          {marks(rectOf, stage.current?.clientWidth ?? 0, stage.current?.clientHeight ?? 0)}
        </div>
      )}
      {pins.length > 0 && (
        <div className="wpkept">
          {pins.map((p) => (
            <div key={p.n} className="wremark">
              <b>{p.n}</b>
              <span><code>{p.sel}</code>{p.line && page?.path ? <button className="wlink" onClick={() => onFile(page.path!, p.line)}>line {p.line}</button> : null} {p.text}</span>
              <button onClick={() => drop(p.n)} aria-label="drop the comment">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
