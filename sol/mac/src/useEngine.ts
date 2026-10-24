import { useCallback, useEffect, useRef, useState } from "react";
import { openMic, Player, base64ToInt16, int16ToBase64, type Capture } from "./voice";
import { link, type Link } from "./socket";
import { ENGINE, ENGINE_HTTP } from "./engine";
import { homeChat } from "./migrate";
import { sendUsage } from "./buttons/usage";

// The wire to the engine, as written in sol/PROTOCOL.md.

export type Seat = "codex" | "claude";
// The chat Life kept for a full reload (issue #15), one key per window (its Tauri label): read once, by the migration
// (migrate.ts). Since Home a reload reopens the chat `sol.home.open` names; a one-session window (?work=) reopens none.
const KEPT: string | null = (() => {
  if (typeof window === "undefined" || new URLSearchParams(location.search).get("work")) return null;
  const label = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "page";
  return `sol.home.session:${label}`;
})();
export function keptSession(): { seat: Seat; sessionId: string } | null {
  if (!KEPT) return null;
  try {
    const k = JSON.parse(sessionStorage.getItem(KEPT) ?? "null");
    if ((k?.seat === "codex" || k?.seat === "claude") && typeof k.sessionId === "string" && /^[\w.:-]{1,128}$/.test(k.sessionId)) return k;
  } catch { /* none */ }
  return null;
}
export type Effort = "low" | "medium" | "high" | "max";
export type FileOut = { name: string; mime: string; dataBase64: string };
export type Shown = { name: string; url?: string };
export type Kind = "command" | "read" | "write" | "search" | "browse" | "desk" | "reasoning" | "note" | "error";
// A step (who: "tool") is one line of the seat's work; the engine sends it again, same id, when it completes.
export type Msg = { who: "me" | "you" | "tool"; text: string; files?: Shown[]; id?: string; kind?: Kind; detail?: string; ok?: boolean; done?: boolean; call?: boolean; old?: boolean };
export type CallState = "off" | "ringing" | "live";
export type Thread = { seat: Seat; sessionId: string; title: string; updatedAt: number | string; door?: string; moved?: boolean };   // moved: handed into Work
export type SeatInfo = {
  seat: Seat; label: string; via: string; models: string[]; default?: string; efforts: Effort[];
  can?: string[]; cannot?: string[];
};
export type Models = { seats: SeatInfo[]; efforts: Effort[] };
export type Part = { name: string; tokens: number };
export type Tab = { id: string; sessionId?: string; title: string; url: string; active?: boolean };
export type Language = "follow" | "english" | "cantonese" | "dutch";
// what Claude may do without asking in a Work session (#94); the engine checks the value
export type WorkMode = "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions";
export type Settings = {
  voice: string; patienceMs: number; language: Language; mic?: string;
  defaults: { seat: Seat; model: Record<Seat, string>; effort: Record<Seat, Effort>; mode: WorkMode };
};
// the person's arrangement (engine/src/arrange.ts, PROTOCOL.md round 31): their rails, presets and layout
export type Arrangement = {
  v: 1; modes: string[]; rails: Record<string, { presets: string[]; at?: string }[]>;
  presets: Record<string, { name: string; buttons: string[] }>; layout: Record<string, string>; split: { share: number };
  usage?: Record<string, { n: number; last: string }>;   // each button's presses (buttons/usage.ts): "swap for" lists the most pressed
};
export type EngineInfo = { haveVoiceKey: boolean; dictationModel: string; since?: string; port?: number };
// the engine's own health (engine/src/health.ts): every five seconds, the dots beside its mark
export type Health = {
  kept: boolean; build: { alive: boolean; errors: number | null } | null; face: boolean;
  reverted: { what: "engine" | "face"; at: string; line?: string } | null;
};
export type GoBackPlan = { engine: string | null; face: string | null; line: string };
export type Frame = { tab: string; data: string; w: number; h: number };
// The desk (PROTOCOL.md, round 8): cards the seat writes as data; the face draws every kind in the house style.
export type Flash = { front: string; back: string; state?: "got" | "again" };
export type Question = { prompt: string; choices?: string[]; answer?: string; explain?: string; given?: string; result?: "right" | "wrong"; open?: boolean };
export type Card = { id: string; kind: "note" | "flashcards" | "question" | "exam" | "page" | "board" | "timer"; title?: string; at: number } & {
  text?: string; cards?: Flash[];                                      // note, flashcards (on a set, at = the card shown)
  prompt?: string; choices?: string[]; answer?: string; explain?: string; given?: string | string[]; result?: "right" | "wrong"; open?: boolean; // question (on an exam, given is one per question)
  minutes?: number; questions?: Question[]; startedAt?: number; doneAt?: number; results?: ("right" | "wrong" | null)[];   // exam
  path?: string; page?: number; pages?: number; image?: string;        // page
  seconds?: number; left?: number;                                     // timer (startedAt while running)
};
// a timer's seconds left now; the engine keeps whether it runs, so the desk and the notch count the same
export const timerLeft = (c: Card, now: number) => (c.startedAt ? Math.max(0, (c.left ?? c.seconds ?? 0) - (now - c.startedAt) / 1000) : c.left ?? c.seconds ?? 0);
export const mmss = (s: number) => { const v = Math.max(0, Math.round(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`; };
// the one line the notch shows for a pinned card
export function pinLine(c: Card, now: number): string {
  if (c.kind === "timer") return `${mmss(timerLeft(c, now))}${c.title ? ` · ${c.title}` : ""}${c.startedAt ? "" : " · paused"}`;
  if (c.kind === "flashcards") { const all = c.cards ?? []; const cur = all[Math.min(c.at ?? 0, all.length - 1)]; const got = all.filter((x) => x.state === "got").length; return cur ? `${cur.front}  ·  ${got}/${all.length}` : c.title ?? "cards"; }
  if (c.kind === "exam") { const qs = c.questions ?? [], g = Array.isArray(c.given) ? c.given.filter(Boolean).length : 0; const left = c.minutes && c.startedAt && !c.doneAt ? mmss(c.minutes * 60 - (now - c.startedAt) / 1000) + " · " : ""; return `${left}${g}/${qs.length} answered${c.title ? ` · ${c.title}` : ""}`; }
  if (c.kind === "question") return c.prompt ?? "a question";
  return c.title ?? c.kind;
}

// Which engine (this Mac, the NucBox, a machine of the list, or the one that served the away page): engine.ts.
export { LIVE, NEXT, FAR_NAME, ENGINE, WHICH, sameEngine, pickEngine, keptMachines, keepMachines, type Which, type Machine } from "./engine";
export const fileUrl = (u?: string) => (!u ? u : /^(https?|data|blob):/.test(u) ? u : ENGINE_HTTP + (u.startsWith("/") ? "" : "/") + u);

const EFFORTS: Effort[] = ["low", "medium", "high", "max"];
const NO_CARDS: Card[] = [];

// A step arriving from the engine: a completion updates the step with the same id, anything else is new.
// Older engines send only { text }: shown as a finished note.
function withStep(prev: Msg[], m: Record<string, unknown>): Msg[] {
  const s: Msg = {
    who: "tool", id: typeof m.id === "string" ? m.id : undefined, kind: (m.kind as Kind) ?? "note", text: String(m.text ?? ""),
    detail: typeof m.detail === "string" ? m.detail : undefined, ok: typeof m.ok === "boolean" ? m.ok : undefined, done: m.done !== false,
  };
  if (s.id) {
    const i = prev.findIndex((x) => x.who === "tool" && x.id === s.id);
    if (i >= 0) return [...prev.slice(0, i), { ...prev[i], ...s, detail: s.detail ?? prev[i].detail }, ...prev.slice(i + 1)];
  }
  return [...prev, s];
}
// A line of the call's transcript: grows under its id until final; an empty final line is dropped.
function withCallLine(prev: Msg[], m: Record<string, unknown>): Msg[] {
  const id = String(m.id ?? "");
  const line: Msg = { who: m.who === "me" ? "me" : "you", text: String(m.text ?? ""), id, call: true, done: m.final === true };
  const i = prev.findIndex((x) => x.call && x.id === id);
  if (!line.text && line.done) return i >= 0 ? [...prev.slice(0, i), ...prev.slice(i + 1)] : prev;
  if (i >= 0) return [...prev.slice(0, i), line, ...prev.slice(i + 1)];
  return [...prev, line];
}
// When the turn ends nothing is still running.
const settle = (prev: Msg[]) => (prev.some((x) => x.who === "tool" && !x.done) ? prev.map((x) => (x.who === "tool" && !x.done ? { ...x, done: true } : x)) : prev);

// Dev only: localStorage sol.demo = "1" shows one made-up exchange, to look at the step card without a seat running.
const DEMO: Msg[] = [
  { who: "me", text: "What is due this week for LA245, and is the syllabus still the one on Blackboard?" },
  { who: "tool", id: "d1", kind: "reasoning", text: "I should check the brain file first, then the course page.", done: true,
    detail: "I should check the brain file first, then the course page. The brain file lists the assignments Marco already knows about; Blackboard has the dates. If they disagree, Blackboard wins and the brain file gets a note." },
  { who: "tool", id: "d2", kind: "read", text: "reading school/la245/brain.md", done: true, ok: true },
  { who: "tool", id: "d3", kind: "command", text: "running ls school/la245", done: true, ok: true, detail: "brain.md\nnotes\nsyllabus-fall.pdf" },
  { who: "tool", id: "d4", kind: "browse", text: "opening learn.bu.edu", done: true, ok: true },
  { who: "tool", id: "d5", kind: "command", text: "running grep -n \"week 7\" school/la245/syllabus.md", done: true, ok: false,
    detail: "$ grep -n \"week 7\" school/la245/syllabus.md\ngrep: school/la245/syllabus.md: No such file or directory" },
  { who: "tool", id: "d6", kind: "search", text: "searching: BU LA245 fall 2026 syllabus", done: false },
  { who: "you", text: "Two things are due this week.\n\n| what | when | where |\n| --- | --- | --- |\n| Case brief, *Hadley v. Baxendale* | Wed 15 Oct, 11:59 pm | Blackboard |\n| Quiz 3 (chapters 9–10) | Fri 17 Oct, in class | room CAS 211 |\n\nThe syllabus on Blackboard is the same file as `school/la245/syllabus-fall.pdf`, so nothing moved. To keep the brain file in step I would add:\n\n```md\n## week 7\n- [ ] case brief: Hadley v. Baxendale (Wed)\n- [ ] quiz 3, ch. 9–10 (Fri)\n```\n\nWant me to write that in?" },
];
const demo = () => { try { return localStorage.getItem("sol.demo") === "1"; } catch { return false; } };
const load = <T,>(k: string, d: T): T => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
};
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export function useEngine() {
  const [msgs, setMsgs] = useState<Msg[]>(() => (demo() ? DEMO : []));
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState(false);
  const [context, setContext] = useState(0);
  const [win, setWin] = useState(1_000_000);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [models, setModels] = useState<Models>({ seats: [], efforts: EFFORTS });
  const [parts, setParts] = useState<Part[] | undefined>();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [desks, setDesks] = useState<Record<string, Card[]>>({}); // every conversation's desk, by sessionId (the draft id until named)
  const [pin, setPin] = useState<Card | null>(null);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | undefined>(undefined);
  const frameSubs = useRef(new Set<(f: Frame) => void>());
  const rawSubs = useRef(new Set<(m: any) => void>()); // Work mode listens to the work.* messages itself (work/useWork.ts)
  const heardCb = useRef<(text: string) => void>(() => {});
  const partialCb = useRef<(text: string, tag: number) => void>(() => {}); // words read from one clip, while dictation goes on
  const interrupting = useRef(0);                               // stopped "done"s still owed by turns a new say cut off
  const [seat, setSeatState] = useState<Seat>(() => load<Seat>("sol.seat", "codex"));
  const [modelPick, setModelPick] = useState<Partial<Record<Seat, string>>>(() => load("sol.model", {}));
  const [effort, setEffortState] = useState<Effort>(() => load<Effort>("sol.effort", "medium"));
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [draft, setDraft] = useState(() => crypto.randomUUID()); // owns the tabs and the desk until the seat names the session
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [arrangement, setArrangement] = useState<Arrangement | null>(null);
  const [refused, setRefused] = useState<{ line: string; n: number } | null>(null);   // the engine's last no to a change of it
  const [undoNote, setUndoNote] = useState<{ line: string; n: number } | null>(null);   // an agent's last change to it, the rail's undo line
  const noted = useRef(false);
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [goBackPlan, setGoBackPlan] = useState<GoBackPlan | null>(null);   // what the Go back row would do (#18)
  const [sampling, setSampling] = useState(false); // a voice sample is playing
  const sample = useRef<Player | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const msgsRef = useRef<Msg[]>([]);
  const modelsRef = useRef<Models>({ seats: [], efforts: EFFORTS });
  const [callState, setCallState] = useState<CallState>("off");
  const mic = useRef<Capture | null>(null);
  const player = useRef<Player | null>(null);
  const linkRef = useRef<Link | null>(null);   // the page's one link to the engine (socket.ts)
  const busyRef = useRef(false);
  const owed = useRef(false);                   // a turn was out when the link went down
  const seatRef = useRef(seat);
  const sessionRef = useRef<string | undefined>(undefined);
  seatRef.current = seat;
  busyRef.current = busy;
  msgsRef.current = msgs;
  modelsRef.current = models;

  const flash = useCallback((t: string) => {
    setNotice(t);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 6000);
  }, []);
  // false when nothing went out (no socket, or not open): a caller waiting on an answer can say so at once
  const send = useCallback((o: object): boolean => linkRef.current?.send(o) ?? false, []);
  // the rail's presses (buttons/usage.ts), to the engine once a minute and as the page goes
  useEffect(() => {
    const go = () => sendUsage(send);
    const t = window.setInterval(go, 60_000);
    window.addEventListener("pagehide", go);
    return () => { window.clearInterval(t); window.removeEventListener("pagehide", go); };
  }, [send]);
  const setSession = (id?: string) => { sessionRef.current = id; setSessionId(id); };
  // a GPT talk's project folder (#182): where a new talk on this box works, and where an opened one works; none is
  // Sol's home. `parent`: the talk a new one carries on from (the switch), marked when it starts
  const [cwd, setCwdState] = useState<string | undefined>();
  const cwdRef = useRef<string | undefined>(undefined);
  const parentRef = useRef<string | undefined>(undefined);
  const setCwd = (c?: string) => { cwdRef.current = c; setCwdState(c); };
  const reopened = useRef(false);
  // A voice sample ends when the engine says so and the last chunk has played.
  const sampleOver = useCallback((later = false) => {
    const p = sample.current;
    if (!p) return;
    const wait = later ? p.pending * 1000 + 250 : 0;
    window.setTimeout(() => { if (sample.current === p) { void p.close(); sample.current = null; setSampling(false); } }, wait);
  }, []);
  // The call's ears and mouth live here, next to the socket they talk through.
  const hangUpLocal = useCallback(() => {
    void mic.current?.stop(); mic.current = null;
    void player.current?.close(); player.current = null;
    setCallState("off");
  }, []);
  const callLive = useCallback(async () => {
    if (mic.current) return;
    player.current = new Player(24000);
    let buf: Int16Array[] = [];
    let have = 0;
    try {
      mic.current = await openMic((pcm) => {
        buf.push(pcm); have += pcm.length;
        if (have < 1600) return; // ~100 ms per message
        const all = new Int16Array(have);
        let at = 0;
        for (const p of buf) { all.set(p, at); at += p.length; }
        buf = []; have = 0;
        send({ type: "call.audio", data: int16ToBase64(all) });
      }, settingsRef.current?.mic);
      setCallState("live");
    } catch (err) {
      flash((err as Error).message || "the microphone is not available");
      send({ type: "call.end" });
      hangUpLocal();
    }
  }, [send, flash, hangUpLocal]);

  // Settings' defaults seed a NEW conversation (its seat, model, effort); an open one keeps its own.
  // `own` = Marco flipped the seat switch: that seat starts on its own default model, not a remembered one.
  const applyDefaults = useCallback((st: Settings | null, to: Seat, own = false) => {
    setSeatState(to); save("sol.seat", to);
    const seatInfo = modelsRef.current.seats.find((x) => x.seat === to);
    const want = own ? seatInfo?.default : st?.defaults.model[to];
    // only ever a model this seat really offers (a Codex name under Work was the bug)
    const m = want && seatInfo?.models.includes(want) ? want : seatInfo?.default ?? seatInfo?.models[0];
    if (m) setModelPick((p) => { const n = { ...p, [to]: m }; save("sol.model", n); return n; });
    const ef = st?.defaults.effort[to];
    if (ef && EFFORTS.includes(ef)) { setEffortState(ef); save("sol.effort", ef); }
  }, []);
  const lastDefaults = useRef("");
  const seed = useCallback((st: Settings) => {
    const key = JSON.stringify(st.defaults);
    if (key === lastDefaults.current) return; // a voice change must not undo the seat Marco just picked
    lastDefaults.current = key;
    if (!sessionRef.current && msgsRef.current.length === 0) applyDefaults(st, st.defaults.seat);
  }, [applyDefaults]);

  useEffect(() => {
    const L = link(ENGINE);
    linkRef.current = L;
    // Every up, not only the first (#17): the list, the models, and the conversation this window shows, so a socket
    // replaced after a sleep comes back to where it was. A Life turn out when the link went down is not lost: the
    // engine let it run, and `open` gives back its record so far and `resumed` (PROTOCOL.md, round 15).
    const offLink = L.onLink((isUp) => {
      if (!isUp) {
        setUp(false);
        if (busyRef.current) owed.current = true;   // a turn was out: ask after it when the link is back
        setBusy(false);
        hangUpLocal();
        return;
      }
      setUp(true);
      setNotice((n) => (n === "engine renewing" ? "" : n));   // the renewed engine is back: the line goes
      rawSubs.current.forEach((f) => f({ type: "open" }));
      send({ type: "list" });
      send({ type: "models" });
      // the settings too: the engine sends them on connect, but the page's link may have opened (renovation.ts) before
      // this hook listened, and Settings then called a current engine "older than this window"
      send({ type: "settings.get" });
      send({ type: "arrange.get" });
      interrupting.current = 0;
      const was = owed.current;
      owed.current = false;
      if (sessionRef.current) send({ type: "open", seat: seatRef.current, sessionId: sessionRef.current, resume: true });
      else if (was) send({ type: "open", seat: seatRef.current, draft: draftRef.current, resume: true });
      else if (!reopened.current) {
        reopened.current = true;
        // the conversation open survives a full reload of the page (issue #15): Home's kept chat, while Home shows
        const k = KEPT && (localStorage.getItem("sol.mode") ?? "home") === "home" ? homeChat() : null;
        if (k) send({ type: "open", seat: k.seat, sessionId: k.sessionId });
      }
      reopened.current = true;
    });
    const offMsg = L.on((m) => {
      // browser.inspected / browser.located: the page pane's questions about a tab, answered by rid (work/PagePane.tsx)
      if (typeof m.type === "string" && (m.type.startsWith("work.") || m.type.startsWith("browser.") || m.type === "ran")) { rawSubs.current.forEach((f) => f(m)); return; }
      if (m.type === "engine.renewing") { setNotice("engine renewing"); return; }   // a new build going live; back in a few seconds
      if (m.type === "engine.reverted") { setNotice("engine went back to its last good build"); window.clearTimeout(noticeTimer.current); noticeTimer.current = window.setTimeout(() => setNotice(""), 60_000); return; }   // the keeper put the last good build back after a bad one
      if (m.type === "face.reverted") { flash(`face went back: ${m.line}`); return; }   // an edit that did not compile was taken back (engine/src/changing.ts)
      if (m.type === "health") { setHealth(m.health as Health); return; }
      if (m.type === "goback.plan") { setGoBackPlan({ engine: m.engine ?? null, face: m.face ?? null, line: String(m.line ?? "") }); return; }
      if (m.type === "goback.done") { setNotice(m.ok ? "going back to the last good Sol" : "could not go back: " + String((m.lines ?? []).slice(-1)[0] ?? "")); window.clearTimeout(noticeTimer.current); noticeTimer.current = window.setTimeout(() => setNotice(""), 60_000); return; }   // Marco pressed go back (#18)
      if (m.type === "start") { if (m.sessionId) setSession(m.sessionId); if (m.cwd) setCwd(m.cwd); parentRef.current = undefined; }
      else if (m.type === "delta") {
        setMsgs((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.who === "you") return [...prev.slice(0, -1), { ...last, text: last.text + m.text }];
          return [...prev, { who: "you", text: m.text }];
        });
      } else if (m.type === "tool") setMsgs((prev) => withStep(prev, m));
      else if (m.type === "usage") { setContext(m.context ?? 0); if (m.window) setWin(m.window); setParts(m.parts); }
      else if (m.type === "tabs") setTabs(m.tabs ?? []);
      else if (m.type === "desk") setDesks((d) => ({ ...d, [String(m.sessionId ?? "")]: (m.cards ?? []) as Card[] }));
      else if (m.type === "pin") setPin((m.card as Card) ?? null);
      else if (m.type === "frame") frameSubs.current.forEach((f) => f(m as Frame));
      else if (m.type === "heard") {
        if (m.partial) partialCb.current(String(m.text ?? ""), Number(m.tag ?? 0));
        else { if (m.why) flash(m.why); heardCb.current(String(m.text ?? "")); }
      } else if (m.type === "settings") {
        const st = m.settings as Settings;
        settingsRef.current = st;
        setSettingsState(st);
        setEngineInfo({ haveVoiceKey: !!m.haveVoiceKey, dictationModel: String(m.dictationModel ?? ""), since: m.up?.since, port: m.up?.port });
        if (m.up?.health) setHealth(m.up.health as Health);
        seed(st);
      } else if (m.type === "arrange.changed") {
        setArrangement(m.arrangement as Arrangement);
        if (m.refused) setRefused({ line: String(m.refused), n: Date.now() });
        if (!m.refused) setUndoNote(m.undo ? { line: `${m.undo.who} ${m.undo.what}`, n: Date.now() } : null);   // any other change lets it go
        if (m.note && !noted.current) { noted.current = true; flash(String(m.note)); }   // the bad file's line, once a window
      } else if (m.type === "voice.sample") {
        if (m.ok === false) { if (m.why) flash(m.why); sampleOver(); }
        else if (m.done) sampleOver(true);
      } else if (m.type === "call") {
        if (m.ok === false) { if (m.why) flash(m.why); hangUpLocal(); }
        else if (m.state === "live") void callLive();
        else if (m.state === "ended") hangUpLocal();
      } else if (m.type === "call.audio") (player.current ?? sample.current)?.play(base64ToInt16(m.data));
      else if (m.type === "call.clear") player.current?.clear();
      else if (m.type === "call.text") setMsgs((prev) => withCallLine(prev, m));
      else if (m.type === "done" && m.stopped && interrupting.current > 0) interrupting.current--; // the turn a say cut off
      else if (m.type === "done") {
        if (m.sessionId && m.ok !== false) setSession(m.sessionId); // a refused session is not ours
        setMsgs(settle);
        setBusy(false);
        send({ type: "list" });
      } else if (m.type === "error") {
        setMsgs((prev) => [...settle(prev), { who: "tool", kind: "error", text: String(m.message ?? "something went wrong"), done: true, ok: false }]);
        setBusy(false);
      } else if (m.type === "threads") setThreads(m.threads ?? []);
      else if (m.type === "thread") {
        setSeatState(m.seat); save("sol.seat", m.seat);
        setSession(m.sessionId);
        setCwd(typeof m.cwd === "string" ? m.cwd : undefined); parentRef.current = undefined;
        // the conversation's own record says what it last ran on; the global picks are only defaults for a new one
        if (m.model) setModelPick((p) => ({ ...p, [m.seat as Seat]: m.model }));
        if (m.effort && EFFORTS.includes(m.effort)) setEffortState(m.effort as Effort);
        setContext(0);
        setMsgs((m.msgs ?? []).map((x: Msg & { files?: Shown[] }) => ({
          who: x.who, text: x.text, old: true,
          files: x.files?.map((f) => ({ name: f.name, url: fileUrl(f.url) })),
        })));
      } else if (m.type === "models") {
        const efforts: Effort[] = m.efforts ?? EFFORTS;
        const seats: SeatInfo[] = Array.isArray(m.seats) ? m.seats : (["codex", "claude"] as Seat[]).map((k) => ({
          seat: k, label: k === "codex" ? "Codex" : "Claude", via: k === "codex" ? "ChatGPT subscription" : "Claude subscription",
          models: m[k] ?? [], efforts,
        }));
        setModels({ seats, efforts: seats[0]?.efforts ?? efforts });
      }
    });
    return () => { offLink(); offMsg(); linkRef.current = null; };
  }, [send, flash, hangUpLocal, callLive, sampleOver, seed]);

  const info = models.seats.find((x) => x.seat === seat);
  const list = info?.models ?? [];
  const model = modelPick[seat] && list.includes(modelPick[seat]!) ? modelPick[seat]! : info?.default && list.includes(info.default) ? info.default : list[0];

  // asked while a turn or a call runs: one word on the notice line, not silence
  const BUSY = "a turn is running: stop it first (Esc)", ON_CALL = "a call is on: hang up first";
  const fresh = useCallback((to?: Seat, at?: { cwd?: string; parent?: string }) => {
    if (busy || callState !== "off") { flash(busy ? BUSY : ON_CALL); return false; }
    setSession(undefined); setMsgs([]); setContext(0); setDraft(crypto.randomUUID());
    setCwd(at?.cwd); parentRef.current = at?.parent;
    const st = settingsRef.current;
    applyDefaults(st, to ?? st?.defaults.seat ?? seatRef.current, !!to);
    return true;
  }, [busy, callState, applyDefaults, flash]);
  // a new talk on `to` in a project folder (#182), on a model of its own if named; `parent` when it carries one on
  const freshIn = (to: Seat, at: { cwd?: string; parent?: string }, m?: string) => {
    if (!fresh(to, at)) return false;
    if (m) setModelPick((p) => { const n = { ...p, [to]: m }; save("sol.model", n); return n; });
    return true;
  };

  const pickSeat = (next: Seat) => {
    if (busy || callState !== "off" || next === seat) return;
    fresh(next);
  };
  const pickModel = (v: string) => { const p = { ...modelPick, [seat]: v }; setModelPick(p); save("sol.model", p); };
  // a model from either seat (#141): the other seat's starts a new chat on it, since a conversation lives on one seat;
  // `anew` starts one even on the same seat (coming from a session)
  const pickSeatModel = (to: Seat, m?: string, anew = false) => {
    if (busy || callState !== "off") { flash(busy ? BUSY : ON_CALL); return; }
    if (to !== seat || anew) fresh(to);
    if (m) setModelPick((p) => { const n = { ...p, [to]: m }; save("sol.model", n); return n; });
  };
  const pickEffort = (v: Effort) => { setEffortState(v); save("sol.effort", v); };
  const efforts = info?.efforts ?? models.efforts;

  // Sending while Sol works interrupts: the engine drops the running turn and starts this one. The dropped turn
  // still ends with a stopped "done"; that one must not read as the new turn being over.
  const say = (text: string, files: (FileOut & { thumb?: string })[], lead = "") => {
    if ((!text && !files.length) || !up) return false;
    if (busy) { interrupting.current++; setMsgs(settle); }
    setMsgs((prev) => [...prev, { who: "me", text, files: files.map((f) => ({ name: f.name, url: f.thumb })) }]);
    setBusy(true);
    send({
      type: "say", text: lead ? text + "\n\n" + lead.trim() : text, seat, sessionId: sessionRef.current,
      draft: sessionRef.current ? undefined : draft, model, effort,
      ...(!sessionRef.current && cwdRef.current ? { cwd: cwdRef.current } : {}),
      ...(!sessionRef.current && parentRef.current ? { parent: parentRef.current } : {}),
      files: files.length ? files.map(({ name, mime, dataBase64 }) => ({ name, mime, dataBase64 })) : undefined,
    });
    return true;
  };
  const stop = () => send({ type: "stop" });
  const open = (t: Thread) => { if (busy) flash(BUSY); else send({ type: "open", seat: t.seat, sessionId: t.sessionId }); };

  const setSettings = (patch: object) => {
    // show it at once; the engine's broadcast is the truth that follows
    setSettingsState((cur) => {
      if (!cur) return cur;
      const merge = (a: any, b: any): any => (b && typeof b === "object" && !Array.isArray(b) ? Object.fromEntries([...Object.keys({ ...a, ...b })].map((k) => [k, k in b ? merge(a?.[k], b[k]) : a[k]])) : b);
      const next = merge(cur, patch) as Settings;
      settingsRef.current = next;
      return next;
    });
    send({ type: "settings.set", patch });
  };
  // "hear it": one voice says one line. The sample plays through its own player while no call is live.
  const hearVoice = (voice: string) => {
    if (!up || callState !== "off") return;
    void sample.current?.close();
    sample.current = new Player(24000);
    setSampling(true);
    send({ type: "voice.sample", voice });
  };
  const rename = (t: Thread, title: string) => send({ type: "thread.rename", sessionId: t.sessionId, title });
  const hear = (audio: string, done = true, tag?: number) => send({ type: "hear", audio, done, tag });
  // The call button: start, or hang up. Starting needs the seat's picks so the voice's asks run like any turn.
  const call = () => {
    if (callState === "off") {
      if (!up) return;
      setCallState("ringing");
      send({ type: "call", seat, sessionId: sessionRef.current, draft: sessionRef.current ? undefined : draft, model, effort });
    } else {
      send({ type: "call.end" });
      hangUpLocal();
    }
  };
  // what Marco does on a card: the engine changes the card, broadcasts the desk, and tells the seat on his next say
  const deskAct = useCallback((id: string, act: string, extra: object = {}) => {
    send({ type: "desk.act", sessionId: sessionRef.current ?? draftRef.current, id, act, ...extra });
  }, [send]);
  const subscribe = useCallback((fn: (m: any) => void) => { rawSubs.current.add(fn); return () => { rawSubs.current.delete(fn); }; }, []);
  const subscribeFrames = (fn: (f: Frame) => void) => { frameSubs.current.add(fn); return () => { frameSubs.current.delete(fn); }; };

  const desk = desks[sessionId ?? draft] ?? NO_CARDS;
  const arrange = useCallback((patch: object) => { setRefused(null); send({ type: "arrange.set", patch }); }, [send]);
  const undo = useCallback(() => { setUndoNote(null); send({ type: "arrange.undo" }); }, [send]);
  return { msgs, busy, up, context, win, parts, threads, models, info, efforts, seat, model, effort, sessionId, draft, cwd, freshIn, tabs, desk, pin, deskAct, notice, callState,
    settings, engineInfo, health, arrangement, arrange, refused, undoNote, undo, goBackPlan, sampling, setSettings, hearVoice, rename,
    say, stop, open, fresh, pickSeat, pickModel, pickSeatModel, pickEffort, hear, call, flash, send, subscribe, subscribeFrames, heardCb, partialCb };
}
