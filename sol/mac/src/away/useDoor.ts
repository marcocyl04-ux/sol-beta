// The doorway's wire: the few messages the phone page needs (PROTOCOL.md, round 6), nothing of the desktop's chat.
import { useCallback, useEffect, useRef, useState } from "react";
import { openMic, Player, base64ToInt16, int16ToBase64, type Capture } from "../voice";
import { link, type Link } from "../socket";
import { ENGINE } from "../engine";

export type DoorSettings = { voice: string; patienceMs: number; language: string };

export type Line = { id: string; who: "me" | "you"; text: string; final: boolean };
export type Step = { id: string; text: string; done: boolean; ok?: boolean };
export type Thread = { seat: string; sessionId: string; title: string; updatedAt?: number };
export type CallState = "off" | "ringing" | "live";

// The page is served by the engine itself (behind `tailscale serve`, https), so the socket is the same host at /; the
// pick lives in engine.ts, shared with renovation, so the page keeps one socket. Dev (vite, or ?ws=host:port) follows it.
export type Demo = { lines: Line[]; steps: Step[]; title: string; call: CallState; settings?: boolean };

const sentence = (s: string) => s.replace(/\s+/g, " ").trim();

export function useDoor(demo?: Demo) {
  const [up, setUp] = useState(false);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [fresh, setFresh] = useState(false); // a long press asked for a new conversation
  const [lines, setLines] = useState<Line[]>(demo?.lines ?? []);
  const [steps, setSteps] = useState<Step[]>(demo?.steps ?? []);
  const [callState, setCallState] = useState<CallState>(demo?.call ?? "off");
  const [why, setWhy] = useState("");
  const [settings, setSettings] = useState<DoorSettings | null>(demo?.settings ? { voice: "Kore", patienceMs: 600, language: "follow" } : null);
  const [since, setSince] = useState<string | undefined>(demo?.settings ? new Date(Date.now() - 95 * 60000).toISOString() : undefined);
  const [sampling, setSampling] = useState<string | null>(demo?.settings ? "Kore" : null); // the voice being sampled
  const [sampleWhy, setSampleWhy] = useState<{ voice: string; why: string } | null>(null);
  const sample = useRef<Player | null>(null);
  const sampleTimer = useRef<number | undefined>(undefined);
  const ws = useRef<Link | null>(null);
  const mic = useRef<Capture | null>(null);
  const player = useRef<Player | null>(null);
  const micCtx = useRef<AudioContext | null>(null);
  const [texting, setTexting] = useState(false); // a typed message is out and Sol has not finished
  const textRef = useRef({ on: false, seq: 0, raw: "", id: "", session: undefined as string | undefined });
  const sessionRef = useRef<string | undefined>(undefined);
  const callRef = useRef<CallState>(demo?.call ?? "off");
  const setCall = (s: CallState) => { callRef.current = s; setCallState(s); };

  const newest = threads?.find((t) => t.seat === "codex");
  const sessionId = fresh ? undefined : newest?.sessionId;
  sessionRef.current = sessionId;
  const title = demo ? demo.title : fresh ? "a new conversation" : newest?.title ?? "";

  const send = useCallback((o: object) => { ws.current?.send(o); }, []);

  const endText = useCallback(() => {
    const t = textRef.current;
    if (!t.on) return;
    t.on = false; setTexting(false);
    const id = t.id;
    setLines((prev) => prev.map((x) => (x.id === id ? { ...x, final: true } : x)));
  }, []);

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
      setWhy((err as Error).message || "the microphone is not available");
      send({ type: "call.end" });
      hangUpLocal();
    }
  }, [send, hangUpLocal]);

  const sampleOver = useCallback((later: boolean) => {
    const p = sample.current;
    window.clearTimeout(sampleTimer.current);
    sampleTimer.current = window.setTimeout(() => setSampling(null), later && p ? p.pending * 1000 + 250 : 0);
  }, []);

  useEffect(() => {
    if (demo) return;
    // the page's one link (socket.ts): a phone that slept gets a fresh socket within seconds of waking
    const L = link(ENGINE);
    ws.current = L;
    const offLink = L.onLink((isUp) => {
      setUp(isUp);
      if (isUp) { send({ type: "list" }); send({ type: "settings.get" }); return; }
      if (textRef.current.on) { setWhy("the desk went away"); endText(); }
      hangUpLocal();
    });
    const offMsg = L.on((m) => {
      if (m.type === "threads") setThreads(m.threads ?? []);
      else if (m.type === "settings") {
        const st = m.settings ?? {};
        setSettings({ voice: String(st.voice ?? "Kore"), patienceMs: Number(st.patienceMs ?? 600), language: String(st.language ?? "follow") });
        setSince(m.up?.since);
      } else if (m.type === "voice.sample") {
        if (m.ok === false) { setSampleWhy({ voice: "", why: String(m.why ?? "the sample did not play") }); sampleOver(false); window.setTimeout(() => setSampleWhy(null), 5000); }
        else if (m.done) sampleOver(true);
      } else if (m.type === "call") {
        if (m.ok === false) { setWhy(String(m.why ?? "the call did not start")); hangUpLocal(); }
        else if (m.state === "live") { setWhy(""); void callLive(); }
        else if (m.state === "ended") hangUpLocal();
      } else if (m.type === "call.audio") (player.current ?? sample.current)?.play(base64ToInt16(m.data));
      else if (m.type === "call.clear") player.current?.clear();
      else if (m.type === "call.text") {
        const id = String(m.id);
        const line: Line = { id, who: m.who === "me" ? "me" : "you", text: sentence(String(m.text ?? "")), final: m.final === true };
        setLines((prev) => {
          const i = prev.findIndex((x) => x.id === id);
          if (i >= 0) return prev.map((x, k) => (k === i ? line : x));
          return line.text ? [...prev, line] : prev;
        });
      } else if (m.type === "tool") {
        const st: Step = { id: String(m.id), text: String(m.text ?? ""), done: m.done === true, ok: m.ok };
        setSteps((prev) => {
          const i = prev.findIndex((x) => x.id === st.id);
          const next = i >= 0 ? prev.map((x, k) => (k === i ? { ...x, ...st } : x)) : [...prev, st];
          return next.slice(-12);
        });
      } else if (m.type === "start") {
        if (textRef.current.on && m.sessionId) { textRef.current.session = String(m.sessionId); setFresh(false); }
      } else if (m.type === "delta") {
        const t = textRef.current;
        if (t.on && m.text) {
          t.raw += String(m.text);
          const id = t.id, line: Line = { id, who: "you", text: sentence(t.raw), final: false };
          setLines((prev) => (prev.some((x) => x.id === id) ? prev.map((x) => (x.id === id ? line : x)) : [...prev, line]));
        }
      } else if (m.type === "done") {
        endText();
        setSteps((prev) => prev.map((x) => (x.done ? x : { ...x, done: true })));
        send({ type: "list" });
      } else if (m.type === "error") setWhy(String(m.message ?? "something went wrong"));
      // start, settings: nothing to show here
    });
    return () => { offLink(); offMsg(); ws.current = null; };
  }, [send, hangUpLocal, callLive, demo, sampleOver, endText]);

  // The tap. Contexts are made and resumed HERE, inside the gesture: iOS keeps any later one silent.
  const tap = useCallback(() => {
    if (callRef.current !== "off") { send({ type: "call.end" }); if (demo) setCall("off"); return; }
    if (!demo && !up) { setWhy("the desk is not answering"); return; }
    try {
      const p = new Player(24000);
      void p.resume();
      player.current = p;
      const c = new AudioContext();
      void c.resume().catch(() => {});
      micCtx.current = c;
    } catch { /* no audio: the call will say so */ }
    setWhy("");
    if (!demo) { setLines([]); setSteps([]); }
    setCall("ringing");
    if (demo) { setCall("live"); return; }
    send({ type: "call", seat: "codex", ...(sessionRef.current ? { sessionId: sessionRef.current } : {}) });
  }, [send, up, demo]);

  // A tap on a voice: choose it and hear it. The player is made and resumed here, inside the tap (iOS).
  const pick = useCallback((voice: string) => {
    if (!sample.current) { try { sample.current = new Player(24000); } catch { /* no audio */ } }
    void sample.current?.resume();
    sample.current?.clear();
    setSettings((s) => (s ? { ...s, voice } : s));
    setSampleWhy(null);
    setSampling(voice);
    window.clearTimeout(sampleTimer.current);
    if (demo) return;
    send({ type: "settings.set", patch: { voice } });
    send({ type: "voice.sample", voice });
  }, [send, demo]);
  const set = useCallback((patch: Partial<DoorSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    if (!demo) send({ type: "settings.set", patch });
  }, [send, demo]);

  const freshConversation = useCallback(() => { if (callRef.current === "off") { textRef.current.session = undefined; setFresh((f) => !f); } }, []);

  // Type to Sol: the same say as the screenshot shortcut, on the thread a call would use.
  const say = useCallback((raw: string) => {
    const text = raw.trim();
    const t = textRef.current;
    if (!text || t.on || callRef.current !== "off") return false;
    if (!demo && !up) { setWhy("the desk is not answering"); return false; }
    setWhy("");
    t.seq += 1; t.on = true; t.raw = ""; t.id = `t${t.seq}y`;
    setTexting(true);
    setSteps([]);
    setLines((prev) => [...prev, { id: `t${t.seq}m`, who: "me", text: sentence(text), final: true }]);
    const session = fresh ? undefined : t.session ?? sessionRef.current;
    send({ type: "say", text, seat: "codex", ...(session ? { sessionId: session } : {}) });
    return true;
  }, [send, up, demo, fresh]);

  return { settings, since, sampling, sampleWhy, pick, set, up: demo ? true : up, title, sessionId, lines, steps, callState, why, tap, say, texting, freshConversation, fresh };
}
