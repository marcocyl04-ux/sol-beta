// The notch's wire: the page's one link to the engine (socket.ts), the call (same mic and speaker code as the main face),
// Sol's last sentence, and the shelf (Grab and Shelf, #200): its things as the engine lists them
// (shelf.list on every up, then every shelf.items it sends after a change), a dropped file put on it (shelf.add), and
// a Shot (grab.shot: macOS's own crosshair, landing on the shelf). Asks carry a rid; the answer has the same type and
// rid, or an error. Modelled on away/useDoor.ts.
// The eye (#253): the app hides Sol's windows from a share; this page then tells this
// Mac's engine (`eye { invisible }`, after each flick and on every connect), so a Sol grab refuses while hidden.
// Anticipate (#253, the wire is PROTOCOL.md's Anticipate block): the asks a talk
// needs (anticipate.start / stop / card / ask / answer, rid answered like the shelf's; anticipate.took, no answer), and
// what this Mac's engine tells every face: anticipate.state (on, the seconds, the talk's session) and anticipate.card
// (a card Sol volunteered, or the short form of a typed ask). They go to this Mac's engine: the ears are this Mac's.
// While a talk is on the creature listens, through the same `dictation` flag dictation sets (one flag, two reasons:
// it goes off only when neither holds it). The front window's picture for a held Answer is the grab's own path
// (grab.windows, front to back, then grab.page.take of the first): no native code of its own. During the questions
// after a talk, a dictation lands in the notch's bar (dictInto) instead of being typed into the front app.
// Sitting 2 (#253): every anticipate.* broadcast also feeds the talk's store (talk.ts) the drawer
// draws; anticipate.talk fills it whole on load; anticipate.name / hold are the drawer's and Fn's; the stop answers at once.
// The notch is a door (engine/src/doors.ts): its calls go to conversations of its own, never to the chat
// open in the main window, and it continues its last one when that spoke less than 20 minutes ago. It shows only
// what Sol says through it (Marco, 2026-10-14: the notch must not reflect what happens in a chat).
import { useCallback, useEffect, useRef, useState } from "react";
import { ENGINE, NEXT, sameEngine, type Card, type CallState, type FileOut } from "../useEngine";
import { invoke } from "@tauri-apps/api/core";
import { openMic, startRecording, Player, base64ToInt16, int16ToBase64, type Capture, type Recorder } from "../voice";
import { link, type Link } from "../socket";
import { flashNow } from "../creature/state";
import * as talkStore from "./talk";

const sentence = (s: string) => s.replace(/\s+/g, " ").trim();
const TAP_MS = 300;   // a hold shorter than this is a brushed key: nothing typed, nothing stored

/** where the hold-key came up (lib.rs reads the frontmost app at release) */
export type DictateUp = { app?: string; name?: string; title?: string };
/** a thing on the shelf (sol/README.md "Grab and Shelf"); `url` is the engine's /file address of it */
export type ShelfItem = { id: string; kind: "shot" | "sol" | "page" | "file"; name: string; mime: string; at: number | string; kept: boolean; url: string; w?: number; h?: number };
/** Anticipate: a card as the engine shapes it (anticipate.ts parseCard) */
export type TalkCard = { head: string; bullets: string[]; source: string };
/** Anticipate: the talk as the engine last said (anticipate.state); `at` is when this page heard it, for the local count */
export type TalkState = { on: boolean; seconds: number; at: number; sessionId?: string; error?: string };
/** Anticipate: a card the engine told every face (volunteered, or a typed ask's short form); `n` tells two apart */
export type TalkCast = TalkCard & { why: "pressed" | "question" | "name"; ms: number; n: number };
const SHOT_MS = 5 * 60_000, ADD_MS = 60_000;
// Anticipate: the start waits on the helper's first second; a card on its seat (3 s, Gemini behind it); the stop on the
// recap and the questions (one seat answer); a typed ask on the session's whole answer; the picture on screencapture
// the clean screen: the private list is one small file the engine reads and writes
const PRIVATE_MS = 5000;
const TALK_START_MS = 15_000, TALK_CARD_MS = 20_000, TALK_STOP_MS = 15_000, TALK_ASK_MS = 120_000, TALK_SHOT_MS = 8_000;   // macOS's crosshair waits for Marco as long as he likes; five minutes is plenty

const readFile = (f: File): Promise<FileOut> =>
  new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => ok({ name: f.name || "pasted", mime: f.type || "application/octet-stream", dataBase64: String(r.result).split(",")[1] ?? "" });
    r.readAsDataURL(f);
  });

export function useNotch() {
  const [up, setUp] = useState(false);
  const [callState, setCallState] = useState<CallState>("off");
  const [said, setSaid] = useState("");
  const [working, setWorking] = useState(false);
  const [pin, setPin] = useState<Card | null>(null); // a card the desk pinned here (a timer, a flashcard, a score)
  const ws = useRef<Link | null>(null);
  const mic = useRef<Capture | null>(null);
  const player = useRef<Player | null>(null);
  const micCtx = useRef<AudioContext | null>(null);
  const callRef = useRef<CallState>("off");
  const sessionRef = useRef<string | undefined>(undefined);
  const upRef = useRef(false);
  const raw = useRef("");
  const texting = useRef(false);
  const setCall = (s: CallState) => { callRef.current = s; setCallState(s); };
  // Dictate anywhere (#110): null while not dictating, else the words so far ("" until the first are read)
  const [dictating, setDictating] = useState<string | null>(null);
  const dict = useRef<{ rec: Recorder | null; at: number; up: DictateUp | null; ending: boolean; settled: string } | null>(null);

  const send = useCallback((o: object) => { ws.current?.send(o); }, []);
  // ---- the creature's listening flag, held by dictation, by a talk, or by both ----
  const listenBy = useRef(new Set<"dict" | "talk">());
  const listenFlag = (by: "dict" | "talk", on: boolean) => {
    const s = listenBy.current, was = s.size > 0;
    if (on) s.add(by); else s.delete(by);
    if (was !== s.size > 0) send({ type: "dictation", on: s.size > 0 });
  };
  // ---- Anticipate: the talk, the cards told to every face, and where a dictation lands during the questions ----
  const [talk, setTalk] = useState<TalkState>({ on: false, seconds: 0, at: 0 });
  const [talkCast, setTalkCast] = useState<TalkCast | null>(null);
  const castN = useRef(0);
  const dictInto = useRef<((text: string) => void) | null>(null);
  const onTalk = (m: any): boolean => {
    if (typeof m.type === "string" && m.type.startsWith("anticipate.") && !m.rid) talkStore.feed(m);   // the drawer's store
    if (m.type === "anticipate.state" && !m.rid) {
      const on = !!m.on;
      setTalk({ on, seconds: Number(m.seconds) || 0, at: Date.now(), ...(m.sessionId ? { sessionId: String(m.sessionId) } : {}), ...(m.error ? { error: String(m.error) } : {}) });
      listenFlag("talk", on);
      return true;
    }
    if (m.type === "anticipate.card" && !m.rid && m.head) {
      setTalkCast({ head: String(m.head), bullets: Array.isArray(m.bullets) ? m.bullets.map(String) : [], source: String(m.source ?? ""), why: m.why === "question" || m.why === "name" ? m.why : "pressed", ms: Number(m.ms) || 0, n: ++castN.current });
      return true;
    }
    return !m.rid && /^anticipate\.(turn|name|asked|buttons)$/.test(m.type);   // the drawer's (talk.ts), fed above
  };
  // ---- the shelf: its things, and the asks that wait for their answer by rid ----
  const [shelf, setShelf] = useState<ShelfItem[]>([]);
  const waits = useRef(new Map<string, (m: any) => void>());
  // grab.* and shelf.* are this Mac's (the screen, home/shelf), so they go to this Mac's engine even when the pick is
  // the NucBox; when the pick is this Mac it is the same socket (link() keeps one per address)
  const here = useRef<Link | null>(null);
  // the eye as the app last said (null: not known yet); told to this Mac's engine on every change and every connect
  const eyeRef = useRef<boolean | null>(null);
  const eyeSay = () => { if (eyeRef.current !== null) (here.current ?? ws.current)?.send({ type: "eye", invisible: eyeRef.current }); };
  const tellEye = useCallback((invisible: boolean) => { eyeRef.current = invisible; eyeSay(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ask = useCallback(<T extends object>(type: string, body: object, ms: number) => new Promise<Partial<T> & { error?: string }>((ok) => {
    const rid = `${type}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const t = window.setTimeout(() => { waits.current.delete(rid); ok({ error: "timeout" } as Partial<T> & { error?: string }); }, ms);
    waits.current.set(rid, (m) => { window.clearTimeout(t); ok(m); });
    if (!(here.current ?? ws.current)?.send({ type, rid, ...body })) { window.clearTimeout(t); waits.current.delete(rid); ok({ error: "offline" } as Partial<T> & { error?: string }); }
  }), []);

  const hangUpLocal = useCallback(() => {
    void mic.current?.stop(); mic.current = null;
    void player.current?.close(); player.current = null;
    void micCtx.current?.close().catch(() => {}); micCtx.current = null;
    setCall("off");
  }, []);

  const callLive = useCallback(async () => {
    if (mic.current) return;
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
      }, undefined, micCtx.current ?? undefined);
      micCtx.current = null; // the mic owns it now
      setCall("live");
    } catch (err) {
      setSaid((err as Error).message || "The microphone is not available.");
      send({ type: "call.end" });
      hangUpLocal();
    }
  }, [send, hangUpLocal]);

  useEffect(() => {
    const L = link(ENGINE);
    ws.current = L;
    const same = sameEngine(ENGINE, NEXT);
    const Hl = same ? L : link(NEXT);
    here.current = Hl;
    const shelfList = () => Hl.send({ type: "shelf.list", rid: `shelf.list:${Date.now().toString(36)}` });
    // Anticipate: every up asks where the talk is (an engine that renewed has none); a down means none either
    const talkSync = () => Hl.send({ type: "anticipate.state" });
    const talkGone = () => { setTalk((t) => (t.on ? { ...t, on: false, at: Date.now() } : t)); listenFlag("talk", false); };
    const offHere = same ? () => {} : Hl.onLink((isUp) => { if (isUp) { shelfList(); eyeSay(); talkSync(); } else talkGone(); });
    const offHereMsg = same ? () => {} : Hl.on((m) => {
      if (m.rid && waits.current.has(m.rid)) { const f = waits.current.get(m.rid)!; waits.current.delete(m.rid); f(m); }
      if ((m.type === "shelf.items" || m.type === "shelf.list") && Array.isArray(m.items)) setShelf(m.items as ShelfItem[]);
      onTalk(m);
    });
    const offLink = L.onLink((isUp) => {
      upRef.current = isUp; setUp(isUp);
      if (isUp) { send({ type: "list" }); if (same) { shelfList(); eyeSay(); talkSync(); } return; }   // every up: the door's last conversation and the shelf again
      setWorking(false); texting.current = false; hangUpLocal(); dictDrop();
      if (same) talkGone();
      for (const [rid, f] of [...waits.current]) { waits.current.delete(rid); f({ error: "offline" }); }   // nothing will answer them now
    });
    const offMsg = L.on((m) => {
      if (m.rid && waits.current.has(m.rid)) { const f = waits.current.get(m.rid)!; waits.current.delete(m.rid); f(m); }
      if ((m.type === "shelf.items" || m.type === "shelf.list") && Array.isArray(m.items)) { setShelf(m.items as ShelfItem[]); return; }
      if (same && onTalk(m)) return;
      if (m.type === "threads") {
        // the door's own newest conversation, for the last thing Sol said through it
        const t = (m.threads ?? []).find((x: any) => x.seat === "codex" && x.door === "notch");
        if (t && callRef.current === "off" && !texting.current) sessionRef.current = t.sessionId;
        if (t && !raw.current) send({ type: "open", seat: "codex", sessionId: t.sessionId });
      } else if (m.type === "thread") {
        if (m.seat === "codex" && m.sessionId === sessionRef.current && !raw.current) {
          const last = [...(m.msgs ?? [])].reverse().find((x: any) => x.who === "you" && x.text);
          if (last) setSaid(sentence(String(last.text)));
        }
      } else if (m.type === "call") {
        if (m.sessionId) sessionRef.current = String(m.sessionId);
        if (m.ok === false) { setSaid(String(m.why ?? "The call did not start.")); hangUpLocal(); }
        else if (m.state === "live") void callLive();
        else if (m.state === "ended") hangUpLocal();
      } else if (m.type === "call.audio") player.current?.play(base64ToInt16(m.data));
      else if (m.type === "call.clear") player.current?.clear();
      else if (m.type === "heard") {
        const d = dict.current;
        if (!d) return;
        if (m.partial) { if (d.rec && !d.ending) { const w = d.rec.heard(Number(m.tag ?? 0), String(m.text ?? "")); setDictating(sentence(`${w.kept} ${w.open}`)); } return; }
        if (!d.ending) return;
        if (m.why) { dictEnd(); setSaid(String(m.why)); return; }
        void dictLand(String(m.text ?? ""));
      }
      else if (m.type === "call.text") {
        if (m.who !== "me" && m.text) setSaid(sentence(String(m.text)));
      } else if (m.type === "start") {
        if ((texting.current || callRef.current !== "off") && m.sessionId) sessionRef.current = String(m.sessionId);
      } else if (m.type === "delta") {
        if (texting.current && m.text) { raw.current += String(m.text); setSaid(sentence(raw.current)); }
      } else if (m.type === "said") {
        // a finished sentence through this door only (the island and the notch are the same door); while this page
        // is texting, its own deltas already carry it
        if (m.seat === "codex" && m.text && !texting.current && (m.door === "notch" || (m.sessionId && m.sessionId === sessionRef.current))) {
          if (m.sessionId) sessionRef.current = String(m.sessionId);
          setSaid(sentence(String(m.text)));
        }
      } else if (m.type === "pin") setPin((m.card as Card) ?? null);
      else if (m.type === "done") {
        texting.current = false; setWorking(false); send({ type: "list" });
      } else if (m.type === "error") {
        texting.current = false; setWorking(false); setSaid(String(m.message ?? "Something went wrong."));
      }
    });
    return () => { offLink(); offMsg(); offHere(); offHereMsg(); ws.current = null; here.current = null; };
  }, [send, hangUpLocal, callLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Dictate anywhere (#110): hold the key, talk, let go; the words are typed where the cursor is ----
  const dictEnd = () => { dict.current = null; setDictating(null); listenFlag("dict", false); };
  // the link went or the mic failed: close what is open, keep nothing
  const dictDrop = () => {
    const d = dict.current;
    if (!d) return;
    void d.rec?.stop().catch(() => {});
    dictEnd();
  };
  // the final words: settled ones plus the last clip's; typed into the front app, then the engine keeps the line
  const dictLand = async (last: string) => {
    const d = dict.current;
    if (!d) return;
    const text = sentence([d.settled, last].filter(Boolean).join(" "));
    const seconds = (Date.now() - d.at) / 1000;
    const up = d.up ?? {};
    dictEnd();
    if (!text) return;   // said nothing: nothing typed, nothing stored
    // Anticipate: the questions after a talk take the words in their bar (the answer is said, not typed into an app)
    if (dictInto.current) { dictInto.current(text); flashNow("done"); return; }
    let went = "clipboard";
    try { went = await invoke<string>("type_text", { text }); } catch { /* no app: the words are not on the clipboard either */ }
    send({ type: "dictated", raw: text, typed: text, app: up.app ?? "", name: up.name ?? "", title: up.title ?? "", seconds, went });
    flashNow("done");   // the creature's done flash: the words landed
    setSaid(went === "app" ? text : "On your clipboard: Sol may not type yet (System Settings → Privacy & Security → Accessibility).");
  };
  const dictDown = useCallback(async () => {
    if (dict.current || callRef.current !== "off") return;   // a held key repeats; a live call owns the mic
    if (!upRef.current) { setSaid("The desk is not answering."); return; }
    const d = { rec: null as Recorder | null, at: Date.now(), up: null as DictateUp | null, ending: false, settled: "" };
    dict.current = d;
    setDictating("");
    listenFlag("dict", true);   // the creature goes listening
    try {
      const rec = await startRecording(undefined, (clip, tag) => send({ type: "hear", audio: clip, done: false, tag }));
      if (dict.current !== d) { void rec.stop().catch(() => {}); return; }
      d.rec = rec;
      if (d.up) void dictFinish(d);   // the key came up while the mic was opening
    } catch (err) {
      if (dict.current === d) { dictEnd(); setSaid((err as Error).message || "The microphone is not available."); }
    }
  }, [send]); // eslint-disable-line react-hooks/exhaustive-deps
  const dictFinish = async (d: NonNullable<typeof dict.current>) => {
    if (!d.rec || d.ending) return;
    d.ending = true;
    const rec = d.rec;
    if (Date.now() - d.at < TAP_MS) { void rec.stop().catch(() => {}); dictEnd(); return; }   // a brushed key
    d.settled = rec.settled();
    try {
      const audio = await rec.stop();
      if (dict.current !== d) return;
      if (audio) send({ type: "hear", audio, done: true }); else void dictLand("");   // everything was already settled
    } catch (err) {
      if (dict.current === d) { dictEnd(); setSaid("Could not read that recording: " + ((err as Error).message ?? err)); }
    }
  };
  const dictUp = useCallback((up: DictateUp) => {
    const d = dict.current;
    if (!d || d.up) return;
    d.up = up;
    if (!d.rec) { if (Date.now() - d.at < TAP_MS) dictEnd(); return; }   // still opening: a tap ends here, a hold when it opens
    void dictFinish(d);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Start or hang up. Audio contexts are made inside the click or shortcut that asks for them.
  const toggle = useCallback(() => {
    if (callRef.current !== "off") { send({ type: "call.end" }); hangUpLocal(); return; }
    if (!upRef.current) { setSaid("The desk is not answering."); return; }
    try {
      const p = new Player(24000);
      void p.resume();
      player.current = p;
      const c = new AudioContext();
      void c.resume().catch(() => {});
      micCtx.current = c;
    } catch { /* no audio: the call will say so */ }
    raw.current = "";
    setCall("ringing");
    send({ type: "call", seat: "codex", door: "notch" });   // the engine continues the door's last conversation, or starts one
  }, [send, hangUpLocal]);

  // ---- Grab and Shelf: a Shot lands on the shelf; a dropped file goes on the shelf (no longer a say to Sol) ----
  /** macOS's crosshair (a region or a window); the item once it landed, or error "cancelled" when Esc was pressed */
  const grabShot = useCallback(async (): Promise<{ item?: ShelfItem; error?: string }> => {
    if (!upRef.current) return { error: "offline" };
    const r = await ask<{ item: ShelfItem }>("grab.shot", {}, SHOT_MS);
    // the shelf.items that follows carries it too; this puts it in at once
    if (r.item) { const it = r.item; setShelf((s) => (s.some((x) => x.id === it.id) ? s : [it, ...s])); }
    return r;
  }, [ask]);
  /** put dropped files on the shelf; true once the engine kept them */
  const shelfAdd = useCallback(async (files: File[]): Promise<boolean> => {
    if (!files.length) return false;
    if (!upRef.current) { setSaid("The desk is not answering."); return false; }
    const got = await Promise.all(files.map(readFile));
    const r = await ask<{ items: ShelfItem[] }>("shelf.add", { files: got }, ADD_MS);
    return !r.error;
  }, [ask]);

  // ---- Anticipate: the asks (PROTOCOL.md's Anticipate block); each answers the engine's message, or { error } ----
  type Err = { error?: string };
  const talkStart = useCallback(async (): Promise<Err> => {
    if (!upRef.current) return { error: "The desk is not answering." };
    const r = await ask<{ talk: string }>("anticipate.start", {}, TALK_START_MS);
    if (!r.error) { setTalk({ on: true, seconds: 0, at: Date.now() }); listenFlag("talk", true); }
    return r;
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps
  /** the stop packs up quietly: the engine answers at once and writes the recap and the review in the background */
  const talkStop = useCallback(async (): Promise<Err> => {
    setTalk((t) => ({ ...t, on: false, seconds: t.on ? t.seconds + Math.round((Date.now() - t.at) / 1000) : t.seconds, at: Date.now() }));
    listenFlag("talk", false);
    return ask<{ ok: boolean }>("anticipate.stop", {}, TALK_STOP_MS);
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps
  /** a button's card by its name (the skill's Buttons; the four defaults go as their old ids, which every engine knows);
   *  `card` null is silence (nothing worth saying) */
  const talkCard = useCallback(async (button: string, screen?: string) =>
    ask<{ card: TalkCard | null; ms: number }>("anticipate.card", { button, ...(screen ? { screen } : {}) }, TALK_CARD_MS), [ask]);
  /** a typed ask: `a` is the answer (it is also told every face as anticipate.asked) */
  const talkAsk = useCallback(async (text: string) => ask<{ a: string; sessionId: string; ms: number }>("anticipate.ask", { text }, TALK_ASK_MS), [ask]);
  /** the whole talk so far, for the drawer's store (talk.ts fill); an engine without it answers an error, and the store
   *  keeps what the broadcasts brought */
  const talkSnapshot = useCallback(async () => ask<Record<string, unknown>>("anticipate.talk", {}, TALK_CARD_MS), [ask]);
  /** a side renamed by a click on its name */
  const talkName = useCallback(async (who: "you" | "them", name: string) => ask<{ ok: boolean }>("anticipate.name", { who, name }, PRIVATE_MS), [ask]);
  /** Fn held during a talk (speak to Sol): down with what the call app's menu read, up sends what was heard */
  const talkHold = useCallback(async (down: boolean, muted?: string) =>
    ask<{ ok: boolean; asked: boolean }>("anticipate.hold", down ? { down, muted } : { down }, PRIVATE_MS), [ask]);
  /** the notch's own clock, press to drawn card (A15): logged by the engine in the talk file */
  const talkTook = useCallback((ms: number, kind: "card" | "ask") => { (here.current ?? ws.current)?.send({ type: "anticipate.took", ms: Math.round(ms), kind }); }, []);
  /** the front window's picture as a png data url, through the grab's own path; null when there is none to take */
  const frontWindow = useCallback(async (): Promise<string | null> => {
    const w = await ask<{ windows: { id: number; tucked?: boolean }[] }>("grab.windows", {}, TALK_SHOT_MS);
    const front = (w.windows ?? []).find((x) => !x.tucked);
    if (!front) return null;
    const p = await ask<{ dataUrl: string }>("grab.page.take", { id: front.id }, TALK_SHOT_MS);
    return p.dataUrl ?? null;
  }, [ask]);
  // ---- The clean screen (#253): the private list, kept by this Mac's engine (private.ts) ----
  type Apps = { apps?: { name: string; bundle: string; on: boolean }[] } & Err;
  const privateList = useCallback(async (): Promise<Apps> => ask<Apps>("eye.list", {}, PRIVATE_MS), [ask]);
  const privateTick = useCallback(async (bundle: string, on: boolean): Promise<Apps> => ask<Apps>("eye.tick", { bundle, on }, PRIVATE_MS), [ask]);
  const setDictInto = useCallback((f: ((text: string) => void) | null) => { dictInto.current = f; }, []);

  return { up, callState, sentence: said, working, pin, toggle, dictating, dictDown, dictUp, shelf, grabShot, shelfAdd, tellEye,
    talk, talkCast, talkStart, talkStop, talkCard, talkAsk, talkSnapshot, talkName, talkHold, talkTook, frontWindow, setDictInto, privateList, privateTick };
}
