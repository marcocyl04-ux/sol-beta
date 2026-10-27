import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ENGINE_HTTP as HTTP } from "../engine";
import type { useEngine } from "../useEngine";
import { Screencast } from "../Screencast";
import type { Work } from "./useWork";
import { Empty } from "./Panes";
import { describe, lineOf, throughBrowser, wordsOf, withBase, type Page } from "./pages";

// The page pane (#54): a page the session wrote, rendered beside the talk, where Marco points at what is wrong, the
// way comments go on a Claude artifact. Three marks, each exactly where he put it (2026-10-26): a click is a point
// (a dot where he clicked), a drag over words selects them (the words lit, as on any page), a drag anywhere else
// draws a box (over an image too: the box is named inside the image, in percent, so the session can crop to it);
// option-drag always draws a box. Each mark takes a comment, Enter keeps it. ⌘↵ puts them all in the box as one
// message naming the mark, the element, the words there and the file and line where it starts.
// The page comes over the wire (work.read) and renders in a frame of this origin, its own assets from the engine
// (GET /pane-asset). "live" lets the page be used instead (links, buttons); option-click still pins.
// An artifact on claude.ai is shown through Sol's browser instead (Screencast, its own tab in this session): a click
// asks the engine what is under it (browser.inspect) and the answer is a pin like any other; after the pane sends
// input, or the tab goes to another address, the pins are found again by their selectors (browser.locate).
type Read = { path?: string; text?: string; mtime?: number; error?: string; tooBig?: boolean; binary?: boolean; dir?: boolean; assetKey?: string };
// annotate is a switch, off by default (2026-10-26): off, the page is used as any page (option-click or option-drag
// still marks); on, a click, a drag over words and a drag elsewhere each mark. Kept across pages and relaunches.
const ANNOTATE = "sol.page.annotate";
// box: where a pin in a browser tab is, in the tab's CSS px (null: its element is not on the page now)
// kind: point (at: the spot), words (rects: the lines of the selection), box (area, and img when the box lies on a
// picture: its name and the box inside it in percent); all in the page's own coordinates (scroll taken out). A pin
// in a browser tab has none of them, only its element's box.
type Kind = "point" | "words" | "box";
type Img = { name: string; l: number; t: number; r: number; b: number };
type Pin = { n: number; sel: string; words: string; line?: number; block?: { w: number; h: number }; text: string; el?: Element; box?: R | null;
  kind?: Kind; at?: { x: number; y: number }; rects?: R[]; area?: R; img?: Img };
type R = { left: number; top: number; width: number; height: number };
type B = { x: number; y: number; w: number; h: number };
type Eng = Pick<ReturnType<typeof useEngine>, "tabs" | "send" | "subscribeFrames">;
const toR = (b: B): R => ({ left: b.x, top: b.y, width: b.w, height: b.h });
const times = (r: R, k: number): R => ({ left: r.left * k, top: r.top * k, width: r.width * k, height: r.height * k });
const shift = (r: R, dx: number, dy: number): R => ({ left: r.left + dx, top: r.top + dy, width: r.width, height: r.height });
const union = (rs: R[]): R => { const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top)); return { left: l, top: t, width: Math.max(...rs.map((r) => r.left + r.width)) - l, height: Math.max(...rs.map((r) => r.top + r.height)) - t }; };
// is there a glyph under the point? (then a drag selects words; elsewhere it draws a box)
const overText = (d: Document, x: number, y: number) => {
  const c = (d as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(x, y);
  if (!c || c.startContainer.nodeType !== 3) return false;
  const t = c.startContainer as Text, i = Math.min(c.startOffset, t.length - 1);
  if (i < 0) return false;
  const rg = d.createRange(); rg.setStart(t, i); rg.setEnd(t, i + 1);
  const b = rg.getBoundingClientRect();
  return b.width > 0 && x >= b.left - 6 && x <= b.right + 6 && y >= b.top - 8 && y <= b.bottom + 8;   // between two lines counts as words
};
// the selection's lines, one rect per line (a long line's pieces joined)
const lineRects = (sel: Selection): R[] => {
  const out: R[] = [];
  for (let i = 0; i < sel.rangeCount; i++) for (const r of sel.getRangeAt(i).getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.top - r.top) < 3 && Math.abs(last.height - r.height) < 3) { const right = Math.max(last.left + last.width, r.right); last.left = Math.min(last.left, r.left); last.width = right - last.left; }
    else out.push({ left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return out;
};
const pct = (v: number) => Math.round(Math.max(0, Math.min(100, v)));

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
  const [mode, setModeRaw] = useState<"comment" | "live">(() => (localStorage.getItem(ANNOTATE) === "1" ? "comment" : "live"));
  const setMode = (f: (m: "comment" | "live") => "comment" | "live") => setModeRaw((m) => { const n = f(m); localStorage.setItem(ANNOTATE, n === "comment" ? "1" : "0"); return n; });
  const [key, setKey] = useState("");
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
    setKey(r.assetKey ?? "");
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
    // an image the engine refused (no Referer, and an engine from before the key): the pane fetches it itself, its
    // request carrying this window's Origin, and hands the page the bytes
    const fix = (img: HTMLImageElement) => {
      if (img.dataset.solFetched || !img.src.includes("/pane-asset/")) return;
      img.dataset.solFetched = "1";
      void fetch(img.src).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) img.src = URL.createObjectURL(b); }).catch(() => {});
    };
    d.addEventListener("error", (ev) => { if (ev.target instanceof d.defaultView!.HTMLImageElement) fix(ev.target); }, true);
    for (const img of d.images) if (img.complete && img.naturalWidth === 0) fix(img);
    d.addEventListener("scroll", bump, { passive: true, capture: true });
    d.defaultView?.addEventListener("resize", bump);
  };
  useEffect(() => { const ro = new ResizeObserver(bump); if (stage.current) ro.observe(stage.current); return () => ro.disconnect(); }, [via, pages.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // pointing: in comment mode a click pins a point and nothing in the page acts; a drag that starts on words selects
  // them, a drag anywhere else (or with option) draws a box; live, option does the same. The drag in flight lives in
  // a ref: the listeners are put back on every render (the box drawn is one), and a closure would forget the press
  const drag = useRef<{ start: { x: number; y: number } | null; moved: boolean; words: boolean }>({ start: null, moved: false, words: false });
  useEffect(() => {
    if (!doc || !html) return;
    const g = drag.current;
    const arm = (ev: MouseEvent) => mode === "comment" || ev.altKey;
    const down = (ev: MouseEvent) => {
      if (ev.button !== 0 || !arm(ev)) return;
      g.start = { x: ev.clientX, y: ev.clientY }; g.moved = false; g.words = !ev.altKey && overText(doc, ev.clientX, ev.clientY);
      if (!g.words) { ev.preventDefault(); doc.getSelection()?.removeAllRanges(); }   // a box drag selects nothing on the way
    };
    const move = (ev: MouseEvent) => {
      if (!g.start) return;
      const x = Math.min(g.start.x, ev.clientX), y = Math.min(g.start.y, ev.clientY), width = Math.abs(ev.clientX - g.start.x), height = Math.abs(ev.clientY - g.start.y);
      if (!g.moved && Math.hypot(width, height) < 6) return;
      g.moved = true;
      if (!g.words) setBox({ left: x, top: y, width, height });
    };
    const up = (ev: MouseEvent) => {
      if (!g.start) return;
      const s = g.start; g.start = null; setBox(null);
      const sel = doc.getSelection();
      if (g.moved && g.words && sel && !sel.isCollapsed) pinWords(sel);
      else if (g.moved) pinBox({ left: Math.min(s.x, ev.clientX), top: Math.min(s.y, ev.clientY), width: Math.abs(ev.clientX - s.x), height: Math.abs(ev.clientY - s.y) });
      else if (!g.moved) { sel?.removeAllRanges(); pinPoint({ x: ev.clientX, y: ev.clientY }); }
    };
    const click = (ev: MouseEvent) => { if (arm(ev)) { ev.preventDefault(); ev.stopPropagation(); } };
    doc.addEventListener("mousedown", down, true); doc.addEventListener("mousemove", move, true); doc.addEventListener("mouseup", up, true); doc.addEventListener("click", click, true);
    return () => { doc.removeEventListener("mousedown", down, true); doc.removeEventListener("mousemove", move, true); doc.removeEventListener("mouseup", up, true); doc.removeEventListener("click", click, true); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // the page's own coordinates: the frame's scroll taken out, so a mark stays on its spot when the page scrolls
  const scroll = () => ({ x: doc?.defaultView?.scrollX ?? 0, y: doc?.defaultView?.scrollY ?? 0 });
  const begin = (pin: Omit<Pin, "n" | "text">) => {
    setWriting({ n: pins.length + 1, text: "", ...pin });
    setText("");
    requestAnimationFrame(() => field.current?.focus());
  };
  const under = (x: number, y: number) => { const el = doc!.elementFromPoint(x, y); return !el || el === doc!.documentElement ? doc!.body! : el; };
  // a click: a dot where it landed, named by the element under it
  const pinPoint = (p: { x: number; y: number }) => {
    if (!doc || !html) return;
    const el = under(p.x, p.y), words = wordsOf(el), sc = scroll();
    begin({ kind: "point", at: { x: p.x + sc.x, y: p.y + sc.y }, sel: describe(el), words, line: page?.path ? lineOf(html, el, words) : undefined, el });
  };
  // words selected: lit as they stand, named by the words themselves
  const pinWords = (s: Selection) => {
    if (!doc || !html) return;
    const picked = s.toString().replace(/\s+/g, " ").trim();
    const rs = lineRects(s);
    if (!picked || !rs.length) return;
    const a = s.anchorNode!.nodeType === 1 ? (s.anchorNode as Element) : s.anchorNode!.parentElement ?? doc.body!;
    const words = picked.length > 70 ? picked.slice(0, 69).trimEnd() + "…" : picked, sc = scroll();
    begin({ kind: "words", rects: rs.map((r) => shift(r, sc.x, sc.y)), sel: describe(a), words, line: page?.path ? lineOf(html, a, picked) : undefined, el: a });
  };
  // a box drawn: kept as drawn; named by the smallest element holding it, and when that is a picture (or the box sits
  // on one), by the picture and the box inside it in percent, for the session to crop to
  const pinBox = (b: R) => {
    if (!doc || !html) return;
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    let el: Element = under(cx, cy);
    const pic = el.tagName === "IMG" ? (el as HTMLImageElement) : (el.querySelector("img") as HTMLImageElement | null) ?? (el.closest("img") as HTMLImageElement | null);
    while (el && el !== doc.body) {   // the smallest element that holds the whole box
      const r = el.getBoundingClientRect();
      if (r.left <= b.left + 1 && r.top <= b.top + 1 && r.right >= b.left + b.width - 1 && r.bottom >= b.top + b.height - 1) break;
      el = el.parentElement ?? doc.body!;
    }
    let img: Img | undefined;
    if (pic) {
      const r = pic.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom)
        img = { name: pic.alt || (pic.getAttribute("src") ?? "").split("/").pop()?.split("?")[0] || "the image", l: pct(((b.left - r.left) / r.width) * 100), t: pct(((b.top - r.top) / r.height) * 100), r: pct(((b.left + b.width - r.left) / r.width) * 100), b: pct(((b.top + b.height - r.top) / r.height) * 100) };
    }
    const words = img ? img.name : wordsOf(el), sc = scroll();
    begin({ kind: "box", area: shift(b, sc.x, sc.y), block: { w: Math.round(b.width), h: Math.round(b.height) }, img, sel: describe(el), words, line: page?.path ? lineOf(html, el, img ? "" : words) : undefined, el });
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
    const mark = (p: Pin) =>
      p.kind === "point" ? `a point at (${Math.round(p.at!.x)}, ${Math.round(p.at!.y)}) on \`${p.sel}\`${p.words ? ` "${p.words}"` : ""}`
      : p.kind === "words" ? `the words "${p.words}" in \`${p.sel}\``
      : p.kind === "box" ? `a box ${p.block!.w}×${p.block!.h} at (${Math.round(p.area!.left)}, ${Math.round(p.area!.top)})${p.img ? ` inside the image ${p.img.name}, x ${p.img.l}–${p.img.r} %, y ${p.img.t}–${p.img.b} % of it (crop there to see what is meant)` : ` on \`${p.sel}\`${p.words ? ` "${p.words}"` : ""}`}`
      : `\`${p.sel}\`${p.words ? ` "${p.words}"` : ""}${p.block ? ` (the block, ${p.block.w}×${p.block.h})` : ""}`;
    const body = all.map((p) => `${p.n}. ${mark(p)}${p.line && page.path ? ` — ${where}:${p.line}` : ""}: ${p.text}`).join("\n");
    onBox(`Comments on the page ${where}${title ? ` ("${title}")` : ""}, each pinned where it is (page coordinates in CSS px, from the top left):\n${body}`);
    setPins([]); setWriting(null); setText("");
  };
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.metaKey && ev.key === "Enter" && (pins.length || (writing && text.trim())) && pane.current?.offsetParent) { ev.preventDefault(); send(); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  // where a pin is now, in the frame: its own mark moved by the scroll (a point, words, a box), else its element's
  // box (a pin from before, or one in a browser tab: the element found again by its selector after a reload)
  const rectsOf = (p: Pin): R[] | null => {
    if (!doc) return null;
    const sc = scroll();
    if (p.kind === "point" && p.at) return [{ left: p.at.x - sc.x, top: p.at.y - sc.y, width: 0, height: 0 }];
    if (p.kind === "words" && p.rects) return p.rects.map((r) => shift(r, -sc.x, -sc.y));
    if (p.kind === "box" && p.area) return [shift(p.area, -sc.x, -sc.y)];
    let el: Element | null = null;
    try { el = p.el?.isConnected ? p.el : doc.querySelector(p.sel); } catch { el = null; }
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [{ left: r.left, top: r.top, width: r.width, height: r.height }];
  };
  useLayoutEffect(() => { if (writing) field.current?.focus(); }, [writing]);
  // the pins, the one being written with its comment field under it (above it near the bottom), and the box in
  // flight, over a stage of W × H; rect: where a pin is on that stage
  const marks = (rects: (p: Pin) => R[] | null, W: number, H: number) => {
    const wrs = writing ? rects(writing) : null;
    const wr = wrs?.length ? union(wrs) : null;
    const fieldAt = wr ? { left: Math.max(6, Math.min(wr.left, W - 286)), top: wr.top + wr.height + 8 > H - 90 ? Math.max(6, wr.top - 90) : wr.top + wr.height + 8 } : null;
    // a pin drawn: a dot, the lit lines (the number on the first), the box as drawn, or the element's box
    const draw = (p: Pin, rs: R[], live = false) => rs.map((r, i) => (
      <div key={`${p.n}.${i}`} className={`wpin ${p.kind ?? "elem"} ${live ? "live" : ""}`} style={r}>{i === 0 && <b>{p.n}</b>}</div>
    ));
    return (
      <div className="wpover">
        {pins.map((p) => { const rs = rects(p); return rs?.length ? draw(p, rs) : null; })}
        {wrs?.length ? draw(writing!, wrs, true) : null}
        {box && <div className="wpbox" style={box} />}
        {writing && fieldAt && (
          <div className="wpwrite" style={fieldAt}>
            <small title={writing.sel}>{writing.kind === "words" ? `"${writing.words}"` : writing.img ? `${writing.img.name} · x ${writing.img.l}–${writing.img.r} % · y ${writing.img.t}–${writing.img.b} %` : writing.sel}{writing.line ? ` · line ${writing.line}` : ""}</small>
            <textarea ref={field} rows={2} value={text} placeholder={writing.kind === "words" ? "a comment on these words" : writing.kind === "box" ? "a comment on what is boxed" : "a comment on this spot"} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.metaKey) { e.preventDefault(); keep(); } else if (e.key === "Escape") { e.stopPropagation(); setWriting(null); setText(""); } }} />
          </div>
        )}
      </div>
    );
  };

  const dir = page?.path ? page.path.replace(/\/[^/]*$/, "") : "";
  const src = html && page?.path ? withBase(html, `${HTTP}/pane-asset/${key ? `k.${key}/` : ""}${encodeURIComponent(dir)}/`, dir) : "";

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
          {(page.path || via) && <button className={`wpannot ${mode === "comment" ? "on" : ""}`} aria-pressed={mode === "comment"} onClick={() => setMode((m) => (m === "live" ? "comment" : "live"))}
            title={mode === "live" ? "annotate is off: the page works as usual (option-click or option-drag still marks). Click to annotate" : via ? "annotate is on: a click marks a spot. Click to turn it off" : "annotate is on: a click marks a point, a drag over words lights them, a drag elsewhere draws a box. Click to turn it off"}>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden><path d="M3 13l1-3.5L10.5 3a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L6.5 12 3 13z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
            annotate<i aria-hidden /></button>}
          {(pins.length > 0 || (writing && text.trim())) && <button className="wbtn" onClick={send}>to the box <kbd>⌘↵</kbd></button>}
        </div>
      )}
      {note && <p className="wfnote">{note}</p>}
      {via ? (
        <Screencast tab={tab?.id} send={e.send} subscribe={e.subscribeFrames} live={mode === "live"} marking={mode === "comment"}
          onPick={(p) => void pinInside(p)} onInput={() => { touched.current = Date.now(); placeAgain(); }} onFrame={onFrame}
          over={(k, s) => marks((p) => (p.box ? [times(p.box, k)] : null), s.w, s.h)} />
      ) : (
        <div ref={stage} className={`wpstage ${mode === "comment" ? "marking" : ""}`}>
          {src && <iframe ref={frame} title={title || page?.name} srcDoc={src} onLoad={onLoad} />}
          {marks(rectsOf, stage.current?.clientWidth ?? 0, stage.current?.clientHeight ?? 0)}
        </div>
      )}
      {pins.length > 0 && (
        <div className="wpkept">
          {pins.map((p) => (
            <div key={p.n} className="wremark">
              <b>{p.n}</b>
              <span><code>{p.kind === "words" ? `"${p.words}"` : p.img ? `${p.img.name} · x ${p.img.l}–${p.img.r} % · y ${p.img.t}–${p.img.b} %` : p.kind === "box" ? `box · ${p.sel}` : p.sel}</code>{p.line && page?.path ? <button className="wlink" onClick={() => onFile(page.path!, p.line)}>line {p.line}</button> : null} {p.text}</span>
              <button onClick={() => drop(p.n)} aria-label="drop the comment">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
