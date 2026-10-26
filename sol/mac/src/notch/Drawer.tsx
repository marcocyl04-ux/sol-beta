// Anticipate, sitting 2 (#253): the drawer. While a talk
// is on, a press on the lit Anticipate pill hangs this black slab under the notch, in the notch's own window (so the eye
// hides it with the rest). It stays open when the mouse leaves; the pill again, Esc or Stop close it; the talk goes on.
//   top:    Transcript · Cards · Ask, the talk's clock, Stop (the only Stop there is: the talk packs up quietly)
//   middle: a card pressed while the drawer is open, pinned for 20 s (Notch.tsx owns its clock), then the view:
//           Transcript, a turn a line, the side's name at the left (a click renames that side for the whole talk), the
//           time dim, the turn being written grey; it follows the newest, a scroll up holds it and "newest" brings it
//           back; only the rows in sight are drawn (a thousand turns open as fast as ten, D10).
//           Cards, what Sol volunteered and the buttons gave, newest first, in the card shape.
//           Ask, the thread of Marco's questions and Sol's answers, oldest at the top, a spoken one marked 🌐; a press
//           on an answer opens the talk's session in the window.
//   foot:   the skill's buttons as discs (Answer held 500 ms adds the front window's picture) and the bar, "ask Sol about
//           the talk"; typing in it from any view goes to Ask; Return sends; ⌘1 ⌘2 ⌘3 switch views; the dim hint
//           "hold 🌐 to talk to Sol", which while Fn is held says what the call app's menu read (muted, sent, not muted).
// Everything it shows is talk.ts's (outside React); the view and each view's scroll live there, so they survive close
// and open (D5). Its height: as tall as its content, up to `maxH` (Notch.tsx: the room the app gave); it tells Notch.tsx
// the height it wants (onWant) so the window can be asked for it.
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { ICON, HOLD_MS } from "./Card";
import { clock } from "./answer";
import type { TalkCard } from "./useNotch";
import { useTalk, talkNow, setView, setBar, keepScroll, turnSecs, type View, type TalkTurn, type TalkRec, type AskRec, type Who } from "./talk";

/** the pinned card (Notch.tsx's drop, drawn here while the drawer is open) */
export type Pin = { card: TalkCard; why: string; secs: number | null; leaving: boolean; n: number; q?: string };
/** what the call app's menu read while Fn is held (Notch.tsx); null when Fn is not held */
export type HoldLine = { text: string; red?: boolean } | null;
export type DrawerApi = { send: () => void };

const VIEWS: { v: View; label: string }[] = [{ v: "transcript", label: "Transcript" }, { v: "cards", label: "Cards" }, { v: "ask", label: "Ask" }];
const MIN_BODY = 132;   // the view never shrinks below this (a short talk does not make a sliver)
const NAME_W = 64, PAD_X = 18;
/** a button's disc: the four defaults have sitting 1's icons, a fifth from the skill its first letter */
const ICON_OF: Record<string, ReactNode> = { answer: ICON.answer, "say next": ICON.next, next: ICON.next, recap: ICON.recap, who: ICON.who };
const STOP = <svg viewBox="0 0 16 16" aria-hidden><rect x="5" y="5" width="6" height="6" rx="1.2" fill="currentColor" stroke="none" /></svg>;

export function Drawer({ top, width, maxH, secs, pin, hold, onWant, onStop, onButton, onSend, onOpen, onRename, onEscape, onPin, apiRef, boxRef }: {
  top: number; width: number; maxH: number; secs: number; pin: Pin | null; hold: HoldLine
  onWant: (h: number) => void; onStop: () => void; onButton: (name: string, downAt: number, screen: boolean) => void
  onSend: (text: string) => void; onOpen: (sessionId?: string) => void; onRename: (who: Who, name: string) => void
  onEscape: () => void; onPin?: (el: HTMLDivElement | null) => void; apiRef: React.RefObject<DrawerApi | null>; boxRef?: React.Ref<HTMLDivElement>
}) {
  const t = useTalk();
  const root = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null), bar = useRef<HTMLInputElement>(null);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  // ---- the height: the chrome (rows, pin) measured, the view's content reported by the view ----
  const [chrome, setChrome] = useState(118);
  const [content, setContent] = useState(MIN_BODY);
  useLayoutEffect(() => {
    const r = root.current, b = body.current;
    if (!r || !b) return;
    const ro = new ResizeObserver(() => setChrome(r.offsetHeight - b.offsetHeight));
    ro.observe(r); setChrome(r.offsetHeight - b.offsetHeight);
    return () => ro.disconnect();
  }, []);
  const bodyH = Math.max(Math.min(MIN_BODY, maxH - chrome), Math.min(Math.max(content, MIN_BODY), maxH - chrome));
  const want = chrome + Math.max(content, MIN_BODY);
  useEffect(() => { onWant(want); }, [want]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(() => {
    const text = talkNow().bar.trim();
    if (!text) return;
    setBar(""); setView("ask");
    onSend(text);
  }, [onSend]);
  apiRef.current = { send };

  const textW = width - PAD_X * 2 - NAME_W - 10;
  return (
    <div ref={(el) => { root.current = el; if (typeof boxRef === "function") boxRef(el); else if (boxRef) (boxRef as React.RefObject<HTMLDivElement | null>).current = el; }}
      className="drawer" style={{ top, width }} data-nopress
      onPointerDown={stop} onPointerUp={stop} onMouseDown={stop} onMouseUp={stop} onClick={stop}>
      <div className="dr-top">
        {VIEWS.map((x, i) => (
          <button key={x.v} type="button" className={`dr-tab${t.view === x.v ? " on" : ""}`} title={`⌘${i + 1}`}
            onClick={() => setView(x.v)}>{x.label}{x.v === "ask" && t.asks.some((a) => a.pending) ? <i className="dr-wait" /> : null}</button>
        ))}
        <span className="dr-clock"><i />{clock(secs)}</span>
        <button type="button" className="dr-stop" aria-label="Stop the talk" title="Stop: the talk goes to Conversations" onClick={onStop}>{STOP}<span>Stop</span></button>
      </div>
      {pin && <PinCard pin={pin} boxRef={onPin} />}
      <div className="dr-body" ref={body} style={{ height: bodyH }}>
        {t.view === "transcript" && <Transcript turns={t.turns} partial={t.partial} names={t.names} textW={textW} height={bodyH} follow={t.scroll.transcript.follow} onContent={setContent} onRename={onRename} />}
        {t.view === "cards" && <Cards cards={t.cards} height={bodyH} onContent={setContent} />}
        {t.view === "ask" && <Thread asks={t.asks} height={bodyH} onContent={setContent} onOpen={onOpen} sessionId={t.sessionId} />}
      </div>
      <div className="dr-foot">
        <div className="dr-discs">{t.buttons.map((b) => <Disc key={b.name} name={b.name} onPress={onButton} />)}</div>
        <div className="dr-bar">
          <input ref={bar} value={t.bar} placeholder="ask Sol about the talk" spellCheck={false} autoComplete="off"
            onChange={(e) => { setBar(e.target.value); if (e.target.value.trim()) setView("ask"); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); send(); }
              else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onEscape(); }
              else if (e.metaKey && (e.key === "1" || e.key === "2" || e.key === "3")) { e.preventDefault(); setView(VIEWS[Number(e.key) - 1].v); }
            }} />
          <span className={`dr-hint${hold ? " held" : ""}${hold?.red ? " red" : ""}`}>{hold ? hold.text : "hold 🌐 to talk to Sol"}</span>
        </div>
      </div>
    </div>
  );
}

/** the card pressed while the drawer is open, above the view; Esc or 20 s take it (Notch.tsx) */
function PinCard({ pin, boxRef }: { pin: Pin; boxRef?: (el: HTMLDivElement | null) => void }) {
  return (
    <div ref={boxRef} className={`dr-pin${pin.leaving ? " leaving" : ""}`} key={pin.n}>
      {pin.q && <p className="dr-q">🌐 {pin.q}</p>}
      <CardShape head={pin.card.head} bullets={pin.card.bullets} source={pin.card.source} volunteered={pin.why !== "pressed"}
        right={pin.secs === null ? "" : `${pin.secs.toFixed(1)} s`} tag="esc" />
    </div>
  );
}

function CardShape({ head, bullets, source, volunteered, right, tag }: { head: string; bullets: string[]; source: string; volunteered: boolean; right: string; tag?: string }) {
  return (
    <div className="dr-card">
      <h3><span className="head">{head}</span>{volunteered ? <span className="spoke"><i />spoke up</span> : tag ? <span className="tag">{tag}</span> : null}</h3>
      {bullets.length > 0 && <ul>{bullets.slice(0, 2).map((b, i) => <li key={i}>{b}</li>)}</ul>}
      <div className="src"><span>{source}</span><span>{right}</span></div>
    </div>
  );
}

// ---- Transcript: a virtual list (only the rows in sight are in the page) over talk.ts's turns ----
const heights = new Map<string, number>();   // measured row heights, by turn key (kept across close and open)
const LINE_H = 18, TIME_H = 15, ROW_PAD = 12;
const estimate = (text: string, textW: number) => Math.max(1, Math.ceil((text.length * 6.7) / Math.max(120, textW))) * LINE_H + TIME_H + ROW_PAD;
const OVERSCAN = 240;

function Transcript({ turns, partial, names, textW, height, follow, onContent, onRename }: { turns: TalkTurn[]; partial: Partial<Record<Who, TalkTurn>>
  names: Record<Who, string>; textW: number; height: number; follow: boolean; onContent: (h: number) => void; onRename: (who: Who, name: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const [top, setTop] = useState(() => talkNow().scroll.transcript.top);
  const [editing, setEditing] = useState<{ who: Who; value: string } | null>(null);
  const rows: TalkTurn[] = [...turns];
  if (partial.them) rows.push(partial.them);
  if (partial.you) rows.push(partial.you);
  // where each row starts (measured, or estimated until it has been drawn)
  const tops = new Array<number>(rows.length + 1);
  tops[0] = 0;
  for (let i = 0; i < rows.length; i++) tops[i + 1] = tops[i] + (heights.get(rows[i].key) ?? estimate(rows[i].text, textW));
  const total = tops[rows.length];
  useLayoutEffect(() => { onContent(total + 8); }, [total]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = Math.max(0, upper(tops, top - OVERSCAN) - 1), last = Math.min(rows.length, upper(tops, top + height + OVERSCAN));
  // measured rows that differ from their guess: kept, and the list drawn again with the true heights
  useLayoutEffect(() => {
    let changed = false;
    for (const [k, r] of rowEls.current) { const h = r.offsetHeight; if (h && heights.get(k) !== h) { heights.set(k, h); changed = true; } }
    if (changed) redraw();
  });
  // following: the newest in sight after every change; else the place it was left at (D5)
  const opened = useRef(false);
  useLayoutEffect(() => {
    const e = el.current;
    if (!e) return;
    if (follow) { const want = Math.max(0, total - e.clientHeight); if (Math.abs(e.scrollTop - want) > 1) e.scrollTop = want; }
    else if (!opened.current) e.scrollTop = talkNow().scroll.transcript.top;
    opened.current = true;
  });
  const raf = useRef(0);
  const onScroll = () => {
    const e = el.current;
    if (!e) return;
    const atEnd = e.scrollTop + e.clientHeight >= e.scrollHeight - 6;
    keepScroll("transcript", e.scrollTop, atEnd);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setTop(e.scrollTop));
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const newest = () => { const e = el.current; if (!e) return; keepScroll("transcript", e.scrollTop, true); e.scrollTop = e.scrollHeight; };
  return (
    <>
      <div className="dr-scroll" ref={el} onScroll={onScroll}>
        {!rows.length ? <p className="dr-empty">nothing said yet</p> : (
          <div className="dr-rows" style={{ height: total }}>
            {rows.slice(first, last).map((r, j) => {
              const i = first + j;
              return (
                <div key={r.key} className={`dr-turn ${r.who}${r.final ? "" : " part"}`} style={{ top: tops[i] }}
                  ref={(x) => { if (x) rowEls.current.set(r.key, x); else rowEls.current.delete(r.key); }}>
                  {editing?.who === r.who && rowEditing(r, rows, first, last) ? (
                    <input className="dr-rename" autoFocus value={editing.value} spellCheck={false}
                      onChange={(e) => setEditing({ who: r.who, value: e.target.value })}
                      onBlur={() => setEditing(null)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") { e.preventDefault(); if (editing.value.trim()) onRename(r.who, editing.value.trim()); setEditing(null); }
                        else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                      }} />
                  ) : (
                    <button type="button" className="w" title={`rename "${names[r.who]}" for the whole talk`}
                      onClick={() => setEditing({ who: r.who, value: names[r.who] === "them" ? "" : names[r.who] })}>{names[r.who] || r.who}</button>
                  )}
                  <span className="t">{r.text}</span>
                  <span className="at">{clock(turnSecs(r.at))}{r.final ? "" : " · writing"}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!follow && rows.length > 0 && <button type="button" className="dr-newest" onClick={newest}>newest ↓</button>}
    </>
  );
}
/** the rename input sits on the newest drawn row of that side only (one input, where the eye is) */
function rowEditing(r: TalkTurn, rows: TalkTurn[], first: number, last: number) {
  for (let i = last - 1; i >= first; i--) if (rows[i].who === r.who) return rows[i].key === r.key;
  return false;
}
/** the first index whose start is past y (tops is sorted) */
function upper(tops: number[], y: number) {
  let lo = 0, hi = tops.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tops[m] <= y) lo = m + 1; else hi = m; }
  return lo;
}

/** the content's own height, for the drawer's (a short list makes a short drawer) */
function useContent(onContent: (h: number) => void) {
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const e = inner.current;
    if (!e) return;
    const ro = new ResizeObserver(() => onContent(e.offsetHeight + 8));
    ro.observe(e); onContent(e.offsetHeight + 8);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return inner;
}
/** a view's scroll kept in talk.ts; `end` follows the bottom (the thread) */
function useKeptScroll(v: View, end: boolean, dep: unknown) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const e = el.current;
    if (!e) return;
    const k = talkNow().scroll[v];
    e.scrollTop = end && k.follow ? e.scrollHeight : k.top;
  }, [dep]); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => { const e = el.current; if (e) keepScroll(v, e.scrollTop, e.scrollTop + e.clientHeight >= e.scrollHeight - 6); };
  return { el, onScroll };
}

function Cards({ cards, onContent }: { cards: TalkRec[]; height: number; onContent: (h: number) => void }) {
  const inner = useContent(onContent);
  const { el, onScroll } = useKeptScroll("cards", false, null);
  const list = [...cards].reverse();
  return (
    <div className="dr-scroll" ref={el} onScroll={onScroll}>
      <div ref={inner} className="dr-cards">
        {!list.length ? <p className="dr-empty">no cards yet · the discs below ask for one</p>
          : list.map((c, i) => <div key={`${c.at}-${c.head}`} className={i ? "old" : undefined}>
            <CardShape head={c.head} bullets={c.bullets} source={[c.source, c.button].filter(Boolean).join(" · ")} volunteered={c.why !== "pressed"}
              right={c.ms ? `${(c.ms / 1000).toFixed(1)} s` : ""} tag={i === 0 ? "newest" : undefined} />
          </div>)}
      </div>
    </div>
  );
}

function Thread({ asks, onContent, onOpen, sessionId }: { asks: AskRec[]; height: number; onContent: (h: number) => void; onOpen: (sessionId?: string) => void; sessionId?: string }) {
  const inner = useContent(onContent);
  const last = asks[asks.length - 1];
  const { el, onScroll } = useKeptScroll("ask", true, `${asks.length}:${last?.pending ? 1 : 0}`);
  return (
    <div className="dr-scroll" ref={el} onScroll={onScroll}>
      <div ref={inner} className="dr-thread">
        {!asks.length ? <p className="dr-empty">ask Sol about the talk below, or hold 🌐 and speak</p>
          : asks.map((a) => (
            <div key={a.id} className="dr-ask">
              <p className="dr-q">{a.spoken && <span className="globe" title="spoken">🌐</span>}{a.q || (a.pending ? "listening…" : "")}</p>
              {a.pending ? <p className="dr-a wait">Sol is thinking…</p>
                : <button type="button" className="dr-a" title="Open the talk's session in the window" onClick={() => onOpen(a.sessionId ?? sessionId)}>
                  {a.a || "answered in the window"}{a.ms ? <span className="ms">{(a.ms / 1000).toFixed(1)} s</span> : null}</button>}
            </div>
          ))}
      </div>
    </div>
  );
}

/** a button's disc: its icon (or its first letter), its name rising above while the pointer is on it; Answer held 500 ms
 *  says "Answer with the screen" and sends the front window's picture with it */
function Disc({ name, onPress }: { name: string; onPress: (name: string, downAt: number, screen: boolean) => void }) {
  const [on, setOn] = useState(false), [long, setLong] = useState(false);
  const down = useRef<number | null>(null), holdT = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(holdT.current), []);
  const answer = name.toLowerCase() === "answer";
  const icon = ICON_OF[name.toLowerCase()];
  return (
    <button type="button" className={`dr-disc${on ? " on" : ""}`} aria-label={name}
      onPointerEnter={() => setOn(true)} onPointerLeave={() => { setOn(false); setLong(false); down.current = null; window.clearTimeout(holdT.current); }}
      onPointerDown={() => { down.current = performance.now(); if (answer) holdT.current = window.setTimeout(() => setLong(true), HOLD_MS); }}
      onClick={() => {
        const at = down.current ?? performance.now();
        window.clearTimeout(holdT.current); down.current = null;
        window.dispatchEvent(new Event("sol-greet"));
        onPress(name, at, answer && performance.now() - at >= HOLD_MS);
        window.setTimeout(() => setLong(false), 500);
      }}>
      <span className="disc">{icon ?? <b>{name.trim()[0]?.toUpperCase()}</b>}</span>
      <span className="nm" aria-hidden>{long ? "Answer with the screen" : name}</span>
    </button>
  );
}
