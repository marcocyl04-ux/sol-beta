// Conversations (#253): the talks
// Anticipate heard, as a page of Home like Settings. Left the talks, newest first; right the open one, reviewed as a
// page: what I promised, what they asked me, decisions, names and dates (each line's time scrolls the words to its
// turn), then the words with a search, the cards, the asks, and the questions the stop left. It asks THIS Mac's
// engine (NEXT, the one link the notch keeps too), never the window's pick: the talks and their ears are this Mac's.
// Nothing reads a talk twice per open: one talks.get, a talks.review only when the file has none.
// Dev: ?page=conversations&demo=1 draws three made-up talks and opens the first, no engine.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NEXT } from "./useEngine";
import { link, type Link } from "./socket";
import "./conversations.css";

type Item = { text: string; at: number };
type Review = { promised: Item[]; asked: Item[]; decisions: Item[]; names: Item[] };
type Turn = { who: "you" | "them"; text: string; at: number; seconds: number };
type Card = { button: string; head: string; bullets: string[]; source: string; at: number; ms: number };
type Ask = { q: string; a: string; at: number; ms: number; spoken: boolean };
export type TalkLine = { file: string; started: number; ended: number | null; seconds: number; who: string[]; recap: string; seen: boolean; questions: number; answered: number; kept: boolean };
type Talk = {
  file: string; started: number; ended: number | null; seconds: number; turns: Turn[]; cards: Card[]; asks: Ask[]; names: { you: string; them: string };
  recap: string[]; review: Review | null; questions: string[]; answers: (string | null | undefined)[]; kept: boolean; seen: boolean;
};
type Answer = { error?: string; [k: string]: any };

const DEMO = typeof location !== "undefined" && new URLSearchParams(location.search).get("demo") === "1";
const BOXES: [keyof Review, string][] = [["promised", "What I promised"], ["asked", "What they asked me"], ["decisions", "Decisions"], ["names", "Names and dates"]];

export const clock = (s: number) => {
  const v = Math.max(0, Math.round(s)), h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), ss = String(v % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
const hm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
function dayOf(ms: number): string {
  const d = new Date(ms), now = new Date(), a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= a) return "Today";
  if (ms >= a - 86_400_000) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
}
const nameOf = (t: Talk, who: "you" | "them") => t.names[who];
const whoLine = (t: Talk) => (t.turns.some((x) => x.who === "them") ? [t.names.you, t.names.them] : [t.names.you]).join(" · ");

// ---- the wire: this Mac's engine, asks with a rid ----

function useTalkLink(): { L: Link | null; ask: (type: string, body: object, ms?: number) => Promise<Answer> } {
  const L = useMemo(() => (DEMO ? null : link(NEXT)), []);
  const waits = useRef(new Map<string, (m: Answer) => void>());
  useEffect(() => L?.on((m) => { if (m.rid && waits.current.has(m.rid)) { const f = waits.current.get(m.rid)!; waits.current.delete(m.rid); f(m); } }), [L]);
  const ask = useCallback((type: string, body: object, ms = 20_000) => new Promise<Answer>((ok) => {
    if (!L) return ok({ error: "demo" });
    const rid = `${type}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const t = window.setTimeout(() => { waits.current.delete(rid); ok({ error: "timeout" }); }, ms);
    waits.current.set(rid, (m) => { window.clearTimeout(t); ok(m); });
    if (!L.send({ type, rid, ...body })) { window.clearTimeout(t); waits.current.delete(rid); ok({ error: "this Mac's engine is not answering" }); }
  }), [L]);
  return { L, ask };
}

/** how many talks wait unopened, for the menu's dot: talks.list on every up, then what talks.changed and anticipate.state say */
export function useTalksWaiting(): number {
  const [n, setN] = useState(0);
  const { L, ask } = useTalkLink();
  useEffect(() => {
    if (!L) return;
    const list = () => void ask("talks.list", {}).then((r) => { if (Array.isArray(r.talks)) setN((r.talks as TalkLine[]).filter((t) => !t.seen).length); });
    const off1 = L.onLink((up) => { if (up) list(); });
    const off2 = L.on((m) => { if ((m.type === "talks.changed" || (m.type === "anticipate.state" && !m.rid)) && typeof m.waiting === "number") setN(m.waiting); else if (m.type === "anticipate.state" && !m.rid && m.on === false) list(); });
    return () => { off1(); off2(); };
  }, [L, ask]);
  return DEMO ? 1 : n;
}

// ---- the page ----

export function Conversations({ onOpenChat }: { onOpenChat: (sessionId: string, title: string) => void }) {
  const { L, ask } = useTalkLink();
  const [talks, setTalks] = useState<TalkLine[] | null>(DEMO ? DEMO_LIST : null);
  const [open, setOpen] = useState<string | null>(DEMO ? DEMO_LIST[0].file : null);
  const [talk, setTalk] = useState<Talk | null>(DEMO ? DEMO_TALK : null);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState("");

  const list = useCallback(() => void ask("talks.list", {}).then((r) => { if (Array.isArray(r.talks)) setTalks(r.talks); else if (r.error && r.error !== "demo") setErr(r.error); }), [ask]);
  useEffect(() => {
    if (!L) return;
    const off1 = L.onLink((up) => { if (up) list(); else setErr("this Mac's engine is not answering"); });
    const off2 = L.on((m) => { if (m.type === "talks.changed") list(); });
    return () => { off1(); off2(); };
  }, [L, list]);
  useEffect(() => { if (talks?.length && !open) setOpen(talks[0].file); }, [talks, open]);

  // one talks.get per open; a talk with words and no review is read by the engine (Gemini flash) once, here
  useEffect(() => {
    if (!open || DEMO) return;
    let alive = true;
    setTalk(null); setErr(""); setReading(false);
    void ask("talks.get", { file: open }).then((r) => {
      if (!alive) return;
      if (r.error || !r.talk) { setErr(r.error ?? "the talk did not come"); return; }
      const t = r.talk as Talk;
      setTalk(t);
      setTalks((ls) => ls?.map((x) => (x.file === t.file ? { ...x, seen: true } : x)) ?? ls);
      if (!t.review && t.turns.length) {
        setReading(true);
        void ask("talks.review", { file: open }, 120_000).then((v) => {
          if (!alive) return;
          setReading(false);
          if (v.error) { setErr(`Sol could not review this talk yet: ${v.error}`); return; }
          setTalk((x) => (x && x.file === t.file ? { ...x, recap: x.recap.length ? x.recap : v.recap ?? [], review: v.review ?? null } : x));
        });
      }
    });
    return () => { alive = false; };
  }, [open, ask]);

  const say = (s: string) => { setFlash(s); window.setTimeout(() => setFlash((f) => (f === s ? "" : f)), 3500); };

  return (
    <div className="convo" data-s>
      <aside className="convo-list" aria-label="talks">
        <h1>Conversations</h1>
        {talks === null && !err && <p className="convo-quiet">reading the talks…</p>}
        {talks?.length === 0 && <p className="convo-quiet">No talks yet. Press the notch's Anticipate pill in a call, and the talk lands here after Stop.</p>}
        {talks?.map((t) => (
          <button key={t.file} className={`convo-row ${t.file === open ? "on" : ""} ${t.seen ? "" : "new"}`} onClick={() => setOpen(t.file)} aria-current={t.file === open}>
            <span className="r1"><b>{dayOf(t.started)}</b><span className="len">{hm(t.started)} · {clock(t.seconds)}</span><span className="who">{t.who.join(" · ")}</span></span>
            <span className="r2">{t.recap || "—"}</span>
            {(!t.seen || (t.questions > t.answered && !t.kept)) && <span className="mark" title={t.seen ? "questions waiting" : "not opened yet"} />}
          </button>
        ))}
      </aside>
      <section className="convo-talk">
        {err && <p className="convo-err">{err}</p>}
        {talk ? <TalkPage key={talk.file} t={talk} reading={reading} setT={setTalk} ask={ask} say={say} onOpenChat={onOpenChat}
          onGone={() => { setTalk(null); setOpen(null); setTalks((ls) => ls?.filter((x) => x.file !== talk.file) ?? ls); }} /> : open && !err && <p className="convo-quiet">opening the talk…</p>}
        {flash && <div className="convo-flash" role="status">{flash}</div>}
      </section>
    </div>
  );
}

function TalkPage({ t, reading, setT, ask, say, onOpenChat, onGone }: {
  t: Talk; reading: boolean; setT: (f: (t: Talk | null) => Talk | null) => void; ask: (type: string, body: object, ms?: number) => Promise<Answer>;
  say: (s: string) => void; onOpenChat: (sessionId: string, title: string) => void; onGone: () => void;
}) {
  const [q, setQ] = useState("");
  const [hit, setHit] = useState<number | null>(null);
  const [naming, setNaming] = useState<"you" | "them" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [asking, setAsking] = useState(false);
  const words = useRef<HTMLDivElement>(null);
  const title = t.names.them !== "them" ? `Talk with ${t.names.them}` : "A talk";
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => t.turns.map((x, i) => [x, i] as const).filter(([x]) => !needle || x.text.toLowerCase().includes(needle) || nameOf(t, x.who).toLowerCase().includes(needle)), [t, needle]);

  // a box line's time: the turn it comes from (the last turn started at or before it), scrolled to and marked
  const goTo = (at: number) => {
    let i = 0;
    t.turns.forEach((x, j) => { if (x.at <= at + 1) i = j; });
    setQ(""); setHit(i);
    requestAnimationFrame(() => words.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    window.setTimeout(() => setHit((h) => (h === i ? null : h)), 2400);
  };
  const rename = (who: "you" | "them", name: string) => {
    setNaming(null);
    const n = name.trim();
    if (!n || n === t.names[who]) return;
    setT((x) => (x ? { ...x, names: { ...x.names, [who]: n } } : x));
    void ask("talks.rename", { file: t.file, who, name: n }).then((r) => r.error && say(r.error));
  };
  const askAbout = () => {
    if (asking) return;
    setAsking(true); say("opening a session with the whole talk…");
    void ask("talks.ask", { file: t.file }, 180_000).then((r) => {
      setAsking(false);
      if (r.sessionId) onOpenChat(String(r.sessionId), `${title} · ${new Date(t.started).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`);
      else say(r.error ?? "the session did not open");
    });
  };
  const shelf = () => void ask("talks.export", { file: t.file }).then((r) => say(r.path ? "on the shelf, as one markdown file" : r.error ?? "not on the shelf"));
  const keep = () => {
    if (t.kept) return;
    void ask("talks.keep", { file: t.file }).then((r) => { if (r.error) say(r.error); else { setT((x) => (x ? { ...x, kept: true } : x)); say("kept in memory/talks.md"); } });
  };
  const del = () => void ask("talks.delete", { file: t.file }).then((r) => { if (r.error) say(r.error); else onGone(); });
  const answer = (i: number, text: string | null, rest = false) => {
    setT((x) => {
      if (!x) return x;
      const answers = [...x.answers];
      answers[i] = text;
      if (rest) x.questions.forEach((_, j) => { if (answers[j] === undefined) answers[j] = null; });
      return { ...x, answers, kept: x.kept || x.questions.every((_, j) => answers[j] !== undefined) };
    });
    void ask("talks.answer", { file: t.file, i, text, ...(rest ? { rest: true } : {}) }).then((r) => r.error && say(r.error));
  };

  return (
    <div className="convo-page">
      <header className="convo-head">
        <div>
          <h2>{title}</h2>
          <p className="sub">{dayOf(t.started)} {hm(t.started)} · {clock(t.seconds)} · {whoLine(t)}</p>
        </div>
        <div className="convo-acts">
          <button onClick={askAbout} disabled={asking || !t.turns.length}>Ask about this talk</button>
          <button onClick={shelf}>To the shelf</button>
          <button onClick={keep} disabled={t.kept} title={t.kept ? "in memory/talks.md" : "the recap and the review into memory/talks.md"}>{t.kept ? "Kept" : "Keep"}</button>
          <button className="del" onClick={() => setConfirm(true)}>Delete</button>
        </div>
      </header>
      {confirm && (
        <div className="convo-confirm" role="alertdialog">
          <p>Delete this talk's file? What stays: a session opened from it, its lines in memory/talks.md, any copy on the shelf.</p>
          <button className="del" onClick={del} autoFocus>Delete</button><button onClick={() => setConfirm(false)}>Keep it</button>
        </div>
      )}

      {t.recap.length > 0 && <p className="convo-recap">{t.recap.join(" ")}</p>}
      {t.review ? (
        <div className="convo-boxes">
          {BOXES.map(([k, label]) => (
            <div key={k} className="convo-box">
              <h3>{label}</h3>
              {t.review![k].length ? t.review![k].map((x, i) => (
                <button key={i} className="convo-line" onClick={() => goTo(x.at)} title="show it in the words"><span>{x.text}</span><time>{clock(x.at)}</time></button>
              )) : <span className="none">nothing</span>}
            </div>
          ))}
        </div>
      ) : t.turns.length ? <p className="convo-quiet reading">{reading ? "reading the talk…" : "no review yet"}</p> : <p className="convo-quiet">Nothing was heard in this talk.</p>}

      {t.turns.length > 0 && <>
        <label className="convo-search">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.3" /></svg>
          <input value={q} placeholder="search the words" aria-label="search the words" onChange={(ev) => setQ(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Escape" && q) { ev.stopPropagation(); setQ(""); } }} />
          {needle && <span className="n">{shown.length}</span>}
        </label>
        <div className="convo-words" ref={words}>
          {shown.map(([x, i]) => (
            <div key={i} data-i={i} className={`w ${x.who} ${hit === i ? "hit" : ""}`}>
              <time>{clock(x.at)}</time>
              {naming === x.who ? (
                <input className="who-in" autoFocus defaultValue={nameOf(t, x.who)} aria-label="the name"
                  onKeyDown={(ev) => { if (ev.key === "Enter") rename(x.who, ev.currentTarget.value); if (ev.key === "Escape") { ev.stopPropagation(); setNaming(null); } }}
                  onBlur={(ev) => rename(x.who, ev.currentTarget.value)} />
              ) : <button className="who" onClick={() => setNaming(x.who)} title="rename this side">{nameOf(t, x.who)}</button>}
              <p>{marked(x.text, needle)}</p>
            </div>
          ))}
          {needle && !shown.length && <p className="convo-quiet">no turn has “{q.trim()}”</p>}
        </div>
      </>}

      {t.cards.length > 0 && (
        <section className="convo-sec">
          <h3>Cards</h3>
          <div className="convo-cards">
            {t.cards.map((c, i) => (
              <button key={i} className="convo-card" onClick={() => goTo(c.at)}>
                <span className="k">{c.button} · {clock(c.at)}</span>
                <b>{c.head}</b>
                {c.bullets.map((b, j) => <span key={j} className="b">{b}</span>)}
                {c.source && <span className="src">{c.source}</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      {t.asks.length > 0 && (
        <section className="convo-sec">
          <h3>Asked during the talk</h3>
          {t.asks.map((x, i) => (
            <div key={i} className="convo-ask"><p className="q">{x.spoken && <span title="spoken, holding 🌐">🌐 </span>}{x.q}<time>{clock(x.at)}</time></p><p className="a">{x.a}</p></div>
          ))}
        </section>
      )}
      {t.questions.length > 0 && (
        <section className="convo-sec">
          <h3>{t.kept ? "Questions · kept" : "Questions the talk left"}</h3>
          {t.questions.map((qq, i) => <Question key={i} q={qq} a={t.answers[i]} onAnswer={(text) => answer(i, text)} onSkipRest={() => answer(i, null, true)} />)}
        </section>
      )}
    </div>
  );
}

function Question({ q, a, onAnswer, onSkipRest }: { q: string; a: string | null | undefined; onAnswer: (text: string | null) => void; onSkipRest: () => void }) {
  const [v, setV] = useState("");
  if (a !== undefined) return <div className="convo-q done"><p>{q}</p><p className="a">{a ?? "skipped"}</p></div>;
  return (
    <div className="convo-q">
      <p>{q}</p>
      <div className="row">
        <input value={v} placeholder="answer, or Esc to skip" aria-label={q} onChange={(ev) => setV(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === "Enter" && v.trim()) onAnswer(v.trim()); if (ev.key === "Escape") { ev.stopPropagation(); onAnswer(null); } }} />
        <button onClick={() => onAnswer(null)}>skip</button>
        <button onClick={onSkipRest} title="skip this and the rest">skip all</button>
      </div>
    </div>
  );
}

/** the text with every place of the searched word marked (case-insensitive) */
function marked(text: string, needle: string): React.ReactNode {
  if (!needle) return text;
  const out: React.ReactNode[] = [], low = text.toLowerCase();
  let at = 0;
  for (let i = low.indexOf(needle); i >= 0; i = low.indexOf(needle, at)) {
    out.push(text.slice(at, i), <mark key={i}>{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  out.push(text.slice(at));
  return out;
}

// ---- dev: three made-up talks, the first one open ----

const NOW = Date.now(), T0 = NOW - 40 * 60_000;
const DEMO_LIST: TalkLine[] = [
  { file: "a.jsonl", started: T0, ended: T0 + 754_000, seconds: 754, who: ["you", "Frank"], recap: "Relay key stays; cloud server split after month one.", seen: true, questions: 2, answered: 0, kept: false },
  { file: "b.jsonl", started: NOW - 3 * 86_400_000, ended: null, seconds: 2470, who: ["you", "Isaac"], recap: "The night timer moves to the NucBox; Isaac takes bugs.", seen: false, questions: 0, answered: 0, kept: true },
  { file: "c.jsonl", started: NOW - 5 * 86_400_000, ended: null, seconds: 482, who: ["you", "Mum"], recap: "Dinner Sunday; bring the photos.", seen: true, questions: 0, answered: 0, kept: true },
];
const turn = (who: "you" | "them", at: number, text: string): Turn => ({ who, at, text, seconds: 4 });
const DEMO_TALK: Talk = {
  file: "a.jsonl", started: T0, ended: T0 + 754_000, seconds: 754, names: { you: "you", them: "Frank" }, kept: false, seen: true,
  turns: [
    turn("them", 122, "So the relay key, do we keep it until the org is set?"),
    turn("you", 129, "Yes, until the org. Then we rotate it once."),
    turn("them", 138, "And the cloud server, who pays for that one?"),
    turn("you", 144, "I can cover the first month, then we split."),
    turn("them", 151, "Fine. Can you send me the numbers by Friday?"),
    turn("you", 156, "Friday, yes. The thirtieth."),
  ],
  recap: ["Relay key stays until the org; the cloud server is split after month one."],
  review: {
    promised: [{ text: "Send the numbers by Friday", at: 156 }, { text: "Cover the server's first month", at: 144 }],
    asked: [{ text: "Who pays for the cloud server?", at: 138 }, { text: "Numbers by Friday?", at: 151 }],
    decisions: [{ text: "Relay key stays until the org", at: 129 }, { text: "Rotate it once, after", at: 129 }],
    names: [{ text: "Frank · Isaac", at: 122 }, { text: "Friday 30 Oct · the org", at: 156 }],
  },
  cards: [{ button: "Answer", head: "Keep the key until the org", bullets: ["Rotate once after; Frank agreed in #168."], source: "Frank, 2:02", at: 124, ms: 1800 }],
  asks: [{ q: "what does the cloud server cost a month?", a: "About €12 on the small plan.", at: 140, ms: 2100, spoken: true }],
  questions: ["Keep the server price in memory?", "Is “the org” the GitHub org, or the company?"], answers: [],
};
