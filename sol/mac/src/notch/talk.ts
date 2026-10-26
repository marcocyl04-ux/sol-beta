// Anticipate, sitting 2 (#253): the talk as the notch holds it,
// outside React, so a talk of an hour (a thousand turns) never re-renders the page for every word and the drawer opens
// on what is already here. Fed by the engine's broadcasts (anticipate.turn / card / name / asked / buttons / state, through
// useNotch) and filled whole, on load and reload, by one `anticipate.talk` answer (fill). The drawer's view and the
// scroll of each view live here too, so they survive the drawer closing and opening (RUBRIC-2 D5).
// React reads it with useTalk() (useSyncExternalStore on a version number); the Transcript list reads `turns` itself and
// draws only the rows in sight (Drawer.tsx).
import { useSyncExternalStore } from "react";

export type Who = "you" | "them";
export type View = "transcript" | "cards" | "ask";
/** a turn: `at` unix seconds when it started (the engine's), `final` false while it is being written */
export type TalkTurn = { key: string; who: Who; text: string; at: number; final: boolean };
/** a card of this talk: what Sol volunteered (why question / name) or a button gave (pressed); `at` ms since the epoch */
export type TalkRec = { head: string; bullets: string[]; source: string; why: string; button?: string; at: number; ms?: number };
/** one of Marco's questions and Sol's answer; `pending` until the answer is in; `id` this page's own */
export type AskRec = { id: number; q: string; a: string; at: number; ms?: number; spoken: boolean; pending?: boolean; sessionId?: string };
export type Button = { name: string; prompt: string };
export type Mute = { app: string; keys: string };

export const DEFAULT_BUTTONS: Button[] = [
  { name: "Answer", prompt: "" }, { name: "Say next", prompt: "" }, { name: "Recap", prompt: "" }, { name: "Who", prompt: "" },
];
export const DEFAULT_MUTE: Mute[] = [
  { app: "zoom.us", keys: "cmd shift a" }, { app: "Microsoft Teams", keys: "cmd shift m" },
  { app: "FaceTime", keys: "cmd shift m" }, { app: "Google Chrome", keys: "cmd d" },
];

type Scroll = { top: number; follow: boolean };
export type TalkStore = {
  version: number;
  file: string;
  started: number;           // ms since the epoch, 0 when not known (the turns' times are counted from it)
  turns: TalkTurn[];         // final turns, in order
  partial: Partial<Record<Who, TalkTurn>>;   // the turn being written, per side
  cards: TalkRec[];          // oldest first (the view draws them newest first)
  asks: AskRec[];            // oldest first, the thread
  names: Record<Who, string>;
  buttons: Button[];
  mute: Mute[];
  sessionId?: string;        // the talk's session (the Ask thread's seat)
  view: View;
  scroll: Record<View, Scroll>;
  bar: string;               // the drawer's bar, kept across close and open
};

const fresh = (): TalkStore => ({
  version: 0, file: "", started: 0, turns: [], partial: {}, cards: [], asks: [], names: { you: "you", them: "them" },
  buttons: DEFAULT_BUTTONS, mute: DEFAULT_MUTE, view: "transcript",
  scroll: { transcript: { top: 0, follow: true }, cards: { top: 0, follow: false }, ask: { top: 0, follow: true } }, bar: "",
});

let s: TalkStore = fresh();
const subs = new Set<() => void>();
const bump = () => { s = { ...s, version: s.version + 1 }; for (const f of subs) f(); };
export const talkNow = () => s;
export function subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
/** the store in a component: redraws on every change */
export function useTalk(): TalkStore { return useSyncExternalStore(subscribe, talkNow, talkNow); }

/** any time the wire sends (unix seconds, ms, an ISO string) as ms since the epoch; NaN-safe */
export function toMs(x: unknown, fallback = Date.now()): number {
  if (typeof x === "number" && Number.isFinite(x)) return x > 1e12 ? x : x * 1000;
  if (typeof x === "string" && x) { const n = Number(x); if (Number.isFinite(n)) return toMs(n, fallback); const d = Date.parse(x); if (Number.isFinite(d)) return d; }
  return fallback;
}
const who = (x: unknown): Who => (x === "you" ? "you" : "them");
const turnKey = (w: Who, at: number) => `${w}@${at}`;
const str = (x: unknown) => (typeof x === "string" ? x : x == null ? "" : String(x));
const recOf = (m: any, why?: string): TalkRec => ({
  head: str(m.head), bullets: Array.isArray(m.bullets) ? m.bullets.map(str) : [], source: str(m.source), why: str(why ?? m.why) || "pressed",
  ...(m.button ? { button: str(m.button) } : {}), at: toMs(m.at), ...(Number.isFinite(Number(m.ms)) && m.ms != null ? { ms: Number(m.ms) } : {}),
});
const buttonsOf = (x: unknown): Button[] | null => {
  if (!Array.isArray(x)) return null;
  const b = x.map((o: any) => ({ name: str(o?.name).trim(), prompt: str(o?.prompt) })).filter((o) => o.name).slice(0, 5);
  return b.length ? b : null;
};
const muteOf = (x: unknown): Mute[] | null => {
  if (!Array.isArray(x)) return null;
  const m = x.map((o: any) => ({ app: str(o?.app).trim(), keys: str(o?.keys).trim() })).filter((o) => o.app && o.keys);
  return m.length ? m : null;
};

/** a new talk: everything of the last one goes, the view starts on Transcript following the newest */
export function reset(started = Date.now()) { s = { ...fresh(), version: s.version, started }; bump(); }

/** a final turn in place (a repeat of the same turn replaces it: a final turn never appears twice, D4) */
function putTurn(t: TalkTurn) {
  const turns = s.turns;
  // the newest turns are the likely repeats: look back a few only
  for (let i = turns.length - 1; i >= Math.max(0, turns.length - 8); i--) if (turns[i].key === t.key) { const c = turns.slice(); c[i] = t; s = { ...s, turns: c }; return; }
  // in order of time; nearly always at the end
  let i = turns.length;
  while (i > 0 && turns[i - 1].at > t.at) i--;
  const c = turns.slice(); c.splice(i, 0, t);
  s = { ...s, turns: c };
}

/** a card already kept (the engine told every face, and this page added its own press): same head within a minute */
const hasCard = (r: TalkRec) => s.cards.some((c) => c.head === r.head && Math.abs(c.at - r.at) < 60_000);
export function addCard(r: TalkRec) { if (hasCard(r)) return; s = { ...s, cards: [...s.cards, r] }; bump(); }

let askN = 0;
/** a question sent (typed or spoken): pending until its answer; its id */
export function askPending(q: string, spoken: boolean): number {
  const id = ++askN;
  s = { ...s, asks: [...s.asks, { id, q, a: "", at: Date.now(), spoken, pending: true }] };
  bump();
  return id;
}
/** the answer to a pending question (the ask's own reply); a missing answer leaves the window as where it is */
export function askAnswered(id: number, a: string | undefined, ms?: number, sessionId?: string) {
  const i = s.asks.findIndex((x) => x.id === id);
  if (i < 0) return;
  const x = s.asks[i];
  if (!x.pending && x.a) return;   // the broadcast came first
  const c = s.asks.slice();
  c[i] = { ...x, pending: false, a: a ?? x.a, ...(ms !== undefined ? { ms } : {}), ...(sessionId ? { sessionId } : {}) };
  s = { ...s, asks: c, ...(sessionId ? { sessionId } : {}) };
  bump();
}
export function askFailed(id: number, why: string) { const i = s.asks.findIndex((x) => x.id === id); if (i < 0) return; const c = s.asks.slice(); c[i] = { ...c[i], pending: false, a: c[i].a || why }; s = { ...s, asks: c }; bump(); }
/** a spoken question released with nothing heard: its pending row goes */
export function askDrop(id: number) { s = { ...s, asks: s.asks.filter((x) => x.id !== id) }; bump(); }

/** an `anticipate.asked` broadcast: fills the pending question it answers, or adds it (another face asked, or it was spoken) */
function asked(m: any): AskRec {
  const q = str(m.q), a = str(m.a), spoken = !!m.spoken, at = toMs(m.at), ms = Number.isFinite(Number(m.ms)) ? Number(m.ms) : undefined;
  // already here with this answer (the ask's reply came first): nothing new
  const same = s.asks.find((x) => x.q === q && x.a === a && !x.pending);
  if (same) return same;
  // the pending row it answers: the same words typed, or the spoken one waiting for its words
  const i = s.asks.findIndex((x) => x.pending && (x.q === q || (spoken && x.spoken && !x.q)));
  const rec: AskRec = { id: i >= 0 ? s.asks[i].id : ++askN, q, a, at, ms, spoken, pending: false };
  const c = s.asks.slice();
  if (i >= 0) c[i] = { ...c[i], ...rec, sessionId: c[i].sessionId }; else c.push(rec);
  s = { ...s, asks: c };
  return rec;
}

export function setView(v: View) { if (s.view === v) return; s = { ...s, view: v }; bump(); }
/** the scroll of a view: kept without a redraw (only the "newest" pill depends on follow, and it asks for one) */
export function keepScroll(v: View, top: number, follow: boolean) {
  const was = s.scroll[v];
  const changed = was.follow !== follow;
  s.scroll = { ...s.scroll, [v]: { top, follow } };
  if (changed) bump();
}
export function setBar(text: string) { s = { ...s, bar: text }; bump(); }
export function setName(w: Who, name: string) { const n = name.trim(); if (!n || s.names[w] === n) return; s = { ...s, names: { ...s.names, [w]: n } }; bump(); }
export const nameOf = (w: Who) => s.names[w] || w;

/** a broadcast from the engine (useNotch hands every anticipate.* without a rid here); returns what it added, for the page */
export function feed(m: any): { card?: TalkRec; asked?: AskRec } | null {
  switch (m?.type) {
    case "anticipate.turn": {
      const w = who(m.who), at = Number(m.at) || Date.now() / 1000, text = str(m.text);
      if (m.name) s = { ...s, names: { ...s.names, [w]: w === "you" ? s.names.you : str(m.name) || s.names[w] } };
      if (m.final === false) { s = { ...s, partial: { ...s.partial, [w]: { key: `p:${w}`, who: w, text, at, final: false } } }; bump(); return null; }
      const p = { ...s.partial }; delete p[w];
      s = { ...s, partial: p };
      if (text.trim()) putTurn({ key: turnKey(w, at), who: w, text, at, final: true });
      bump();
      return null;
    }
    case "anticipate.card": {
      if (!m.head) return null;
      const r = recOf(m);
      if (hasCard(r)) return null;
      s = { ...s, cards: [...s.cards, r] }; bump();
      return { card: r };
    }
    case "anticipate.name": {
      const w = who(m.who);
      if (w === "you" && m.by === "talk") return null;   // `you` is never renamed by the talk (N4)
      setName(w, str(m.name));
      return null;
    }
    case "anticipate.asked": { const r = asked(m); bump(); return { asked: r }; }
    case "anticipate.buttons": {
      const b = buttonsOf(m.buttons), mu = muteOf(m.mute);
      s = { ...s, ...(b ? { buttons: b } : {}), ...(mu ? { mute: mu } : {}) }; bump();
      return null;
    }
    case "anticipate.state": {
      if (m.sessionId && m.sessionId !== s.sessionId) { s = { ...s, sessionId: str(m.sessionId) }; bump(); }
      // the start known from the seconds, when nothing better came (a turn's time is counted from it)
      if (m.on && !s.started && Number.isFinite(Number(m.seconds))) { s = { ...s, started: Date.now() - Number(m.seconds) * 1000 }; bump(); }
      return null;
    }
  }
  return null;
}

/** the whole talk so far (`anticipate.talk`'s answer): replaces what this page heard, keeps the view, the scroll and the bar */
export function fill(r: any): boolean {
  if (!r || r.error || !Array.isArray(r.turns)) return false;
  const turns: TalkTurn[] = [];
  const seen = new Set<string>();
  for (const t of r.turns) {
    const w = who(t?.who), at = Number(t?.at) || 0, text = str(t?.text);
    if (!text.trim()) continue;
    const key = turnKey(w, at);
    if (seen.has(key)) continue;
    seen.add(key); turns.push({ key, who: w, text, at, final: true });
  }
  turns.sort((a, b) => a.at - b.at);
  const cards: TalkRec[] = Array.isArray(r.cards) ? r.cards.filter((c: any) => c?.head).map((c: any) => recOf(c)) : [];
  const asks: AskRec[] = Array.isArray(r.asks) ? r.asks.map((x: any) => ({ id: ++askN, q: str(x?.q), a: str(x?.a), at: toMs(x?.at), ms: Number(x?.ms) || undefined, spoken: !!x?.spoken })) : [];
  // a question still waiting here (sent, not answered yet) stays at the end of the thread
  const waiting = s.asks.filter((x) => x.pending);
  const names = { you: str(r.names?.you) || "you", them: str(r.names?.them) || "them" };
  s = {
    ...s, file: str(r.file), started: r.started != null ? toMs(r.started) : s.started || Date.now() - (Number(r.seconds) || 0) * 1000,
    turns, partial: s.file === str(r.file) ? s.partial : {}, cards, asks: [...asks, ...waiting], names,
    buttons: buttonsOf(r.buttons) ?? s.buttons, mute: muteOf(r.mute) ?? s.mute, ...(r.sessionId ? { sessionId: str(r.sessionId) } : {}),
  };
  bump();
  return true;
}

/** seconds into the talk of a turn (unix seconds), for its dim time */
export const turnSecs = (at: number) => (s.started ? Math.max(0, at - s.started / 1000) : 0);

// ---- Dev only: a made-up talk for ?card=drawer… (shots, and Marco looking without a talk) ----
const LINES: [Who, string][] = [
  ["you", "So, the relay key: we keep it until the org is set up?"],
  ["them", "Yes, that's fine for now."],
  ["them", "Hi, it's Frank by the way, Isaac's on mute."],
  ["you", "Thanks Frank. And the cloud server, who pays for that one?"],
  ["them", "I can cover the first month, then we split it."],
  ["you", "Works for me. Do we need the bigger plan?"],
  ["them", "Not yet. Rooms and the relay fit on the small one, we checked last week."],
  ["you", "Good. I'll write it down on the issue."],
  ["them", "Can you send me the numbers by Friday?"],
  ["them", "And put Isaac on the thread too, he wants to see the cost."],
  ["you", "Friday works. I'll send them in the morning."],
  ["them", "Perfect. Then Thursday at four for the demo?"],
];
/** fills the store with a talk of ~12 turns (or `n` made-up ones, for the thousand-turn timing), a name learned */
export function devFill(kind: string, n = 0) {
  const start = Date.now() / 1000 - 754;   // 12:34 in
  const turns: TalkTurn[] = [];
  const count = n || LINES.length;
  for (let i = 0; i < count; i++) {
    const [w, text] = LINES[i % LINES.length];
    const at = n ? start + (i * 750) / count : start + 520 + i * 19;
    turns.push({ key: turnKey(w, at), who: w, text: n ? `${text} (${i + 1})` : text, at, final: true });
  }
  s = {
    ...fresh(), version: s.version, file: "dev.jsonl", started: start * 1000, turns,
    partial: { you: { key: "p:you", who: "you", text: "and I'll put the invoice in the", at: start + 752, final: false } },
    names: { you: "you", them: "Frank" },
    cards: [
      { head: "Relay key stays until the org", bullets: ["docs/provenance.md names it", "Rotate it once, after"], source: "docs/provenance.md", why: "question", at: Date.now() - 300_000, ms: 1400 },
      { head: "Numbers by Friday, you said yes", bullets: ["Cloud server: first month on Frank", "Then split"], source: "the talk", why: "pressed", button: "Answer", at: Date.now() - 40_000, ms: 1800 },
    ],
    asks: [
      { id: ++askN, q: "what did he want by Friday?", a: "The numbers for the cloud server: the first month on Frank, then a split. He also wants Isaac on the thread.", at: Date.now() - 200_000, ms: 2100, spoken: false },
      { id: ++askN, q: "and the price he said?", a: "He did not say a price. He said the small plan fits rooms and the relay; the bigger plan is not needed yet.", at: Date.now() - 60_000, ms: 1900, spoken: true },
    ],
    view: kind === "drawer-cards" ? "cards" : kind === "drawer-ask" ? "ask" : "transcript",
  };
  bump();
}
