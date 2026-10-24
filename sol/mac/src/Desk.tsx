// The desk: a study space beside the browser (PROTOCOL.md, round 8). The seat writes cards as data; this pane draws
// every kind in the house style, so a set of flashcards Sol made a second ago looks like everything else in Sol.
// Cards belong to the conversation; the newest one is the one on show (Sol just put it there). What Marco does on a
// card goes to the engine as an act and reaches Sol with his next say; a mark on a page or the board rides as a chip.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fileUrl, mmss, timerLeft, type Card, type Question } from "./useEngine";
import { gripResize } from "./Browser";
import { html } from "./Message";
import { Fold, Swap } from "./MotionKit";
import { CFG, enter, useSpring } from "./motion";

type Mark = { name: string; mime: string; dataBase64: string; thumb: string; note: string };
type Act = (id: string, act: string, extra?: object) => void;
type Box = { x: number; y: number; w: number; h: number };

const WORD: Record<Card["kind"], string> = { note: "note", flashcards: "cards", question: "question", exam: "exam", page: "page", board: "board", timer: "timer" };
const label = (c: Card) => c.title || (c.kind === "page" && c.path ? c.path.split("/").pop() ?? "page" : WORD[c.kind]);
const Md = ({ text, className }: { text: string; className?: string }) => <div className={`md ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html(text) }} />;

export function Desk({ cards, act, busy, frac, onFrac, maxFrac, onMark }: {
  cards: Card[]; act: Act; busy: boolean;
  frac: number; onFrac: (f: number) => void; maxFrac: number;
  onMark: (m: Mark) => void;
}) {
  const [picked, setPicked] = useState<string | undefined>();
  // a card that has just arrived is the one on show
  const n = cards.length, ids = cards.map((c) => c.id).join(" ");
  const seen = useRef(ids);
  useEffect(() => {
    if (ids === seen.current) return;
    const before = new Set(seen.current.split(" "));
    const fresh = cards.filter((c) => !before.has(c.id));
    seen.current = ids;
    if (fresh.length) setPicked(fresh[fresh.length - 1].id);
  }, [ids, cards]);
  const card = cards.find((c) => c.id === picked) ?? cards[n - 1];
  const close = (c: Card) => { act(c.id, "close"); if (picked === c.id) setPicked(undefined); };

  return (
    <section className="pane desk" style={{ width: `${frac * 100}%` }}>
      <div className="grip" onPointerDown={gripResize(frac, onFrac, maxFrac)} />
      <div className="tabs">
        {cards.map((c) => (
          <div key={c.id} className={`tab ${card && c.id === card.id ? "on" : ""}`} onClick={() => setPicked(c.id)} title={label(c)}>
            <i className="site" />
            <span>{label(c)}</span>
            <button onClick={(e) => { e.stopPropagation(); close(c); }} title="take it off the desk">×</button>
          </div>
        ))}
        <div className="grow" />
        {n > 0 && <span className="hint">{busy ? "Sol is working" : "what you do here reaches Sol with your next message"}</span>}
      </div>
      <div className="stage desk-stage">
        {card ? (
          <Swap k={card.id} className="desk-swap" dist={16} cfg={CFG.panel}>
            <CardView key={card.id} card={card} act={act} onMark={onMark} />
          </Swap>
        ) : (
          <div className="blank">
            <span>nothing on the desk</span>
            <small>ask Sol to put something here: notes, flashcards, a question, a page</small>
          </div>
        )}
      </div>
    </section>
  );
}

function CardView({ card, act, onMark }: { card: Card; act: Act; onMark: (m: Mark) => void }) {
  switch (card.kind) {
    case "note": return <Note card={card} />;
    case "flashcards": return <Flashcards card={card} act={act} />;
    case "question": return <QuestionCard card={card} act={act} />;
    case "exam": return <Exam card={card} act={act} />;
    case "page": return <PageCard card={card} act={act} onMark={onMark} />;
    case "board": return <Board card={card} onMark={onMark} />;
    case "timer": return <Timer card={card} act={act} />;
  }
}

// ---- a note: Sol's words, in the house markdown ----
function Note({ card }: { card: Card }) {
  return (
    <div className="dcard note">
      {card.title && <h3 className="dtitle">{card.title}</h3>}
      <Md text={card.text ?? ""} />
    </div>
  );
}

// ---- flashcards: one card at a time, a flip that slides, got it / again ----
function Flashcards({ card, act }: { card: Card; act: Act }) {
  const all = card.cards ?? [];
  const [pos, setPos] = useState(Math.min(card.at ?? 0, Math.max(0, all.length - 1))); // on a set, `at` is the card shown
  const [side, setSide] = useState<"front" | "back">("front");
  const done = all.length > 0 && pos >= all.length;
  const cur = all[pos];
  const pressed = useRef<HTMLDivElement>(null);
  const press = useSpring(0, CFG.pop, (v) => { if (pressed.current) pressed.current.style.scale = v === 0 ? "" : `${1 - 0.02 * v}`; });
  const go = (to: number) => { setSide("front"); setPos(to); act(card.id, "turn", { at: to }); };
  const flip = () => { press.set(1); press.to(0, { cfg: CFG.pop }); setSide((s) => (s === "front" ? "back" : "front")); };
  const mark = (state: "got" | "again") => { act(card.id, "mark", { at: pos, state }); go(pos + 1); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!done) flip(); }
    else if (e.key === "ArrowRight" && side === "back") { e.preventDefault(); mark("got"); }
    else if (e.key === "ArrowLeft" && side === "back") { e.preventDefault(); mark("again"); }
  };
  const got = all.filter((c) => c.state === "got").length, again = all.filter((c) => c.state === "again").length;
  return (
    <div className="dcard cards" tabIndex={0} onKeyDown={onKey}>
      <div className="drow">
        {card.title && <h3 className="dtitle">{card.title}</h3>}
        <span className="grow" />
        <span className="dim">{done ? `${got} of ${all.length} got it` : `${Math.min(pos + 1, all.length)} of ${all.length}`}</span>
      </div>
      <div className="cells">
        {all.map((c, i) => <i key={i} className={`cell ${c.state ?? ""} ${i === pos ? "here" : ""}`} />)}
      </div>
      {done ? (
        <div className="flash over">
          <p>{again ? `${again} to see again: ${all.filter((c) => c.state === "again").map((c) => c.front).join(", ")}` : "all of them."}</p>
          <button className="dbtn" onClick={() => go(0)}>start over</button>
        </div>
      ) : cur ? (
        <>
          <div ref={pressed} className={`flash ${side}`} onClick={flip} role="button" title="flip">
            <Swap k={side} dist={26} cfg={CFG.panel}>
              <div className="face-text"><Md text={side === "front" ? cur.front : cur.back} /></div>
            </Swap>
            <span className="corner">{side === "front" ? "front" : "back"}</span>
          </div>
          <div className="drow under">
            <button className="dbtn quiet" onClick={() => go(Math.max(0, pos - 1))} disabled={pos === 0} title="previous">‹</button>
            <span className="grow" />
            {side === "back" ? (
              <>
                <button className="dbtn again" onClick={() => mark("again")}>again</button>
                <button className="dbtn got" onClick={() => mark("got")}>got it</button>
              </>
            ) : <span className="dim">click to flip</span>}
            <span className="grow" />
            <button className="dbtn quiet" onClick={() => go(Math.min(all.length, pos + 1))} title="next">›</button>
          </div>
        </>
      ) : <p className="dim">an empty set</p>}
    </div>
  );
}

// ---- one question: choices as rows, or a line to write on; the answer and the why unfold under it ----
function Ask({ q, given, locked, onAnswer, showResult, onReveal }: {
  q: Question; given?: string; locked?: boolean; onAnswer: (given: string) => void; showResult: boolean; onReveal?: () => void;
}) {
  const [text, setText] = useState(given ?? "");
  const answered = given != null && given !== "";
  const choices = q.choices ?? [];
  const right = showResult && answered && q.answer != null ? (q.result ?? (choices.length ? (given?.trim().toLowerCase() === q.answer.trim().toLowerCase() ? "right" : "wrong") : undefined)) : undefined;
  return (
    <div className="ask-q">
      <Md text={q.prompt} className="prompt" />
      {choices.length ? (
        <div className="choices">
          {choices.map((c, i) => {
            const mine = given === c;
            const cls = `choice ${mine ? "mine" : ""} ${showResult && q.open && q.answer === c ? "key" : ""} ${right && mine ? right : ""}`;
            return (
              <button key={i} className={cls} disabled={locked || (answered && showResult)} onClick={() => onAnswer(c)}>
                <b>{String.fromCharCode(65 + i)}</b><Md text={c} />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="line">
          <textarea rows={2} value={text} placeholder="your answer" disabled={locked || (answered && showResult)} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) onAnswer(text.trim()); } }} />
          {!(answered && showResult) && <button className="dbtn" disabled={locked || !text.trim()} onClick={() => onAnswer(text.trim())}>answer</button>}
        </div>
      )}
      {showResult && answered && (
        <div className="verdict">
          {right === "right" && <span className="ok">right</span>}
          {right === "wrong" && <span className="bad">not this one</span>}
          {right == null && <span className="dim">sent to Sol: the grade comes in the chat</span>}
          <span className="grow" />
          {(q.answer || q.explain) && !q.open && onReveal && <button className="dbtn quiet" onClick={onReveal}>show me</button>}
        </div>
      )}
      {(q.answer || q.explain) && (
        <Fold open={!!q.open && showResult} lazy>
          <div className="why">
            {q.answer && !choices.length && <p><span className="dim">the answer</span> {q.answer}</p>}
            {q.explain && <Md text={q.explain} />}
          </div>
        </Fold>
      )}
    </div>
  );
}

function QuestionCard({ card, act }: { card: Card; act: Act }) {
  const given = typeof card.given === "string" ? card.given : undefined;
  const q: Question = { prompt: card.prompt ?? "", choices: card.choices, answer: card.answer, explain: card.explain, given, result: card.result, open: card.open };
  return (
    <div className="dcard question">
      {card.title && <h3 className="dtitle">{card.title}</h3>}
      <Ask q={q} given={given} onAnswer={(given) => act(card.id, "answer", { given })} showResult onReveal={() => act(card.id, "reveal")} />
    </div>
  );
}

// ---- an exam: a run of questions on one clock; nothing is graded until it is handed in ----
function Exam({ card, act }: { card: Card; act: Act }) {
  const qs = card.questions ?? [];
  const givens = Array.isArray(card.given) ? card.given : [];
  const results = card.results ?? [];
  const [at, setAt] = useState(0);
  const started = !!card.startedAt, over = !!card.doneAt;
  const now = useNow(started && !over);
  const left = card.minutes && card.startedAt ? card.minutes * 60 - (now - card.startedAt) / 1000 : undefined;
  useEffect(() => { if (left != null && left <= 0 && !over) act(card.id, "submit"); }, [left, over, act, card.id]);
  const answered = qs.reduce((k, _q, i) => k + (givens[i] ? 1 : 0), 0);
  const okAt = (i: number) => results[i] ?? (qs[i]?.answer != null ? ((givens[i] ?? "").trim().toLowerCase() === qs[i].answer!.trim().toLowerCase() ? "right" : "wrong") : null);
  const score = over ? qs.reduce((k, _q, i) => k + (okAt(i) === "right" ? 1 : 0), 0) : 0;
  const gradable = qs.filter((q) => q.answer != null).length;
  const q = qs[at];
  return (
    <div className="dcard exam">
      <div className="drow">
        <h3 className="dtitle">{card.title ?? "exam"}</h3>
        <span className="grow" />
        {started && !over && left != null && <span className={`clock ${left < 60 ? "low" : ""}`}>{mmss(left)}</span>}
        {started && !over && <button className="dbtn" onClick={() => act(card.id, "submit")}>hand in</button>}
      </div>
      {!started ? (
        <div className="flash over">
          <p>{qs.length} question{qs.length === 1 ? "" : "s"}{card.minutes ? `, ${card.minutes} minutes` : ""}. Nothing is graded until you hand in.</p>
          <button className="dbtn" onClick={() => act(card.id, "start")}>start</button>
        </div>
      ) : over ? (
        <div className="result">
          <p className="big">{gradable ? `${score} of ${gradable}` : `${answered} of ${qs.length} answered`}</p>
          <p className="dim">{gradable < qs.length ? "Sol grades the written ones in the chat." : "handed in."}</p>
          <ol className="recap">
            {qs.map((qq, i) => {
              const ok = okAt(i);
              return <li key={i} className={ok === "right" ? "ok" : ok === "wrong" ? "bad" : ""}><span>{givens[i] || "—"}</span>{ok === "wrong" && <small>the answer: {qq.answer}</small>}</li>;
            })}
          </ol>
        </div>
      ) : q ? (
        <>
          <div className="cells">{qs.map((_q, i) => <i key={i} className={`cell ${givens[i] ? "got" : ""} ${i === at ? "here" : ""}`} onClick={() => setAt(i)} />)}</div>
          <p className="dim">question {at + 1} of {qs.length}</p>
          <Swap k={String(at)} dist={14} cfg={CFG.panel}>
            <Ask key={at} q={q} given={givens[at]} onAnswer={(given) => { act(card.id, "answer", { given, at }); if (at < qs.length - 1) setAt(at + 1); }} showResult={false} />
          </Swap>
          <div className="drow under">
            <button className="dbtn quiet" disabled={at === 0} onClick={() => setAt(at - 1)}>‹</button>
            <span className="grow" />
            <span className="dim">{answered} answered</span>
            <span className="grow" />
            <button className="dbtn quiet" disabled={at >= qs.length - 1} onClick={() => setAt(at + 1)}>›</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---- a page of a file: the picture, page by page; option-drag marks a part of it for Sol (as in the browser) ----
function PageCard({ card, act, onMark }: { card: Card; act: Act; onMark: (m: Mark) => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const at = (ev: React.PointerEvent) => { const r = ev.currentTarget.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  const down = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!ev.altKey) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const p = at(ev); drag.current = p; setBox({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const move = (ev: React.PointerEvent<HTMLDivElement>) => {
    const s = drag.current;
    if (!s) return;
    const p = at(ev);
    setBox({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const up = () => {
    const b = box, el = img.current;
    drag.current = null; setBox(null);
    if (!b || !el || b.w < 6 || b.h < 6) return;
    const kx = el.naturalWidth / el.clientWidth, ky = el.naturalHeight / el.clientHeight;
    const c = document.createElement("canvas");
    c.width = Math.round(b.w * kx); c.height = Math.round(b.h * ky);
    try {
      c.getContext("2d")!.drawImage(el, b.x * kx, b.y * ky, b.w * kx, b.h * ky, 0, 0, c.width, c.height);
      const data = c.toDataURL("image/png");
      onMark({ name: "page-mark.png", mime: "image/png", dataBase64: data.split(",")[1], thumb: data,
        note: `Marco marked this part of page ${card.page ?? 1} of ${card.path ?? "the page"}` });
    } catch { /* the picture could not be read back; nothing to send */ }
  };
  const page = card.page ?? 1, pages = card.pages ?? page;
  return (
    <div className="dcard pagecard">
      <div className="drow">
        <h3 className="dtitle">{card.title ?? card.path?.split("/").pop()}</h3>
        <span className="grow" />
        <button className="dbtn quiet" disabled={page <= 1} onClick={() => act(card.id, "page", { page: page - 1 })}>‹</button>
        <span className="dim">{page} of {pages}</span>
        <button className="dbtn quiet" disabled={page >= pages} onClick={() => act(card.id, "page", { page: page + 1 })}>›</button>
      </div>
      <div className={`sheet ${box ? "marking" : ""}`} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        {card.image ? <img ref={img} src={fileUrl(card.image)} crossOrigin="anonymous" alt="" draggable={false} /> : <p className="dim">this page could not be drawn</p>}
        {box && <div className="box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      </div>
      <p className="dim small">hold ⌥ and drag to mark a part for Sol</p>
    </div>
  );
}

// ---- the board: a canvas on the cell grid; "show Sol" sends what is drawn as a picture ----
type Stroke = { pts: [number, number][] };
function Board({ card, onMark }: { card: Card; onMark: (m: Mark) => void }) {
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const live = useRef<Stroke | null>(null);
  const [dirty, setDirty] = useState(false);
  const paint = useCallback(() => {
    const c = cv.current, w = wrap.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1, W = w.clientWidth, H = w.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const x = c.getContext("2d")!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    const ink = getComputedStyle(c).getPropertyValue("--ink").trim() || "#ebebe8";
    const grid = getComputedStyle(c).getPropertyValue("--line").trim() || "#303030";
    x.fillStyle = grid;
    for (let gy = 8; gy < H; gy += 16) for (let gx = 8; gx < W; gx += 16) x.fillRect(gx, gy, 1, 1);
    x.strokeStyle = ink; x.lineWidth = 2; x.lineCap = "round"; x.lineJoin = "round";
    for (const s of [...strokes.current, ...(live.current ? [live.current] : [])]) {
      if (s.pts.length < 2) { const [px, py] = s.pts[0]; x.fillStyle = ink; x.fillRect(px - 1, py - 1, 2, 2); continue; }
      x.beginPath(); x.moveTo(s.pts[0][0], s.pts[0][1]);
      for (const [px, py] of s.pts.slice(1)) x.lineTo(px, py);
      x.stroke();
    }
  }, []);
  useLayoutEffect(() => {
    paint();
    const w = wrap.current;
    if (!w) return;
    const ro = new ResizeObserver(paint);
    ro.observe(w);
    return () => ro.disconnect();
  }, [paint]);
  const at = (ev: React.PointerEvent): [number, number] => { const r = ev.currentTarget.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const down = (ev: React.PointerEvent<HTMLCanvasElement>) => { ev.currentTarget.setPointerCapture(ev.pointerId); live.current = { pts: [at(ev)] }; paint(); };
  const move = (ev: React.PointerEvent<HTMLCanvasElement>) => { if (!live.current) return; live.current.pts.push(at(ev)); paint(); };
  const up = () => { if (!live.current) return; strokes.current.push(live.current); live.current = null; setDirty(true); paint(); };
  const clear = () => { strokes.current = []; setDirty(false); paint(); };
  const show = () => {
    const c = cv.current;
    if (!c) return;
    // on paper: the page colour under the ink, so the picture reads outside Sol too
    const out = document.createElement("canvas");
    out.width = c.width; out.height = c.height;
    const x = out.getContext("2d")!;
    x.fillStyle = getComputedStyle(c).getPropertyValue("--page").trim() || "#1a1a1a";
    x.fillRect(0, 0, out.width, out.height);
    x.drawImage(c, 0, 0);
    const data = out.toDataURL("image/png");
    onMark({ name: "board.png", mime: "image/png", dataBase64: data.split(",")[1], thumb: data, note: `Marco drew this on the board${card.title ? ` (${card.title})` : ""}` });
  };
  return (
    <div className="dcard board">
      <div className="drow">
        <h3 className="dtitle">{card.title ?? "board"}</h3>
        <span className="grow" />
        <button className="dbtn quiet" disabled={!dirty} onClick={clear}>clear</button>
        <button className="dbtn" disabled={!dirty} onClick={show}>show Sol</button>
      </div>
      <div className="canvas-wrap" ref={wrap}>
        <canvas ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </div>
    </div>
  );
}

// ---- a timer: one clock, big; the engine keeps whether it runs, so the notch can count too ----
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [on]);
  return on ? now : Date.now();
}
function Timer({ card, act }: { card: Card; act: Act }) {
  const running = !!card.startedAt;
  const now = useNow(running);
  const left = timerLeft(card, now);
  const up = running && left <= 0;
  const face = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (up && face.current) enter(face.current, { y: 6, cfg: CFG.pop }); }, [up]);
  return (
    <div className="dcard timer">
      <div className="drow">
        <h3 className="dtitle">{card.title ?? "timer"}</h3>
      </div>
      <p ref={face} className={`big clockface ${up ? "up" : ""}`}>{mmss(left)}</p>
      <div className="drow centre">
        {!up && (running
          ? <button className="dbtn" onClick={() => act(card.id, "pause")}>pause</button>
          : <button className="dbtn" onClick={() => act(card.id, "start")}>{(card.left ?? card.seconds) === card.seconds ? "start" : "go on"}</button>)}
        <button className="dbtn quiet" onClick={() => act(card.id, "reset")}>reset</button>
      </div>
      {up && <p className="dim centre">time</p>}
    </div>
  );
}
