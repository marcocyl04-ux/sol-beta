import { setRunner } from "./run";
import { useLanding } from "./land";
import { useCallback, useEffect, useRef, useState } from "react";
import { composing } from "./ime";
import type { useEngine, FileOut } from "./useEngine";
import { EngineBack } from "./EngineBack";
import { startRecording, type Recorder } from "./voice";
import { Trail } from "./Trail";
import { Orb } from "./Orb";
import { Picker } from "./Picker";
import { Message, Steps } from "./Message";
import { Mark } from "./Mark";
import { Fringe } from "./creature/indicators";
import { useCreature } from "./creature/state";
import { SceneLayer } from "./creature/Widget";
import { play as playScene, end as endScene, stop as stopScene, setSceneBox } from "./creature/scenes";
import { CFG, follow, reducedMotion, useSpring, type Follow } from "./motion";
import { Site } from "./Site";
import { seenSession } from "./renovation";
import { FileLine } from "./FileLine";   // File it (#119)
import type { Mark as Marked } from "./buttons";

// A chat in Home's stage (#132): a Life conversation (useEngine, Codex or Claude) as it always drew. The talk, its box,
// the picker under it (the seat switch while the chat is new), the trail and the orb; the desk's and the browser's
// marks come into its box through `mark`. Home's shell (work/WorkApp.tsx) holds the bar, the side and the panes.

type Att = FileOut & { thumb?: string; note?: string };

const readFile = (f: File): Promise<Att> =>
  new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      ok({ name: f.name || "pasted", mime: f.type || "application/octet-stream", dataBase64: url.split(",")[1] ?? "",
        thumb: f.type.startsWith("image/") ? url : undefined });
    };
    r.readAsDataURL(f);
  });

// what the chat was typing survives a trip to a session and back (this is unmounted meanwhile), and a full reload of
// the page (sessionStorage: an edit to the face's root may reload it, issue #15); so does the talk's scroll
const kept = <T,>(k: string, d: T): T => { try { const v = sessionStorage.getItem(k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; } };
const keepS = (k: string, v: unknown) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private */ } };
const homeKept: { draft: string; atts: Att[] } = { draft: kept("sol.home.draft", ""), atts: [] };

export function LifeTalk({ e, mark }: { e: ReturnType<typeof useEngine>; mark: React.MutableRefObject<Marked> }) {
  // a code block's run cell sends for the conversation showing (run.ts); the output comes back on the socket (Home subscribes)
  useEffect(() => { setRunner({ send: e.send, seat: e.seat === "claude" ? "claude" : "codex", sessionId: e.sessionId ?? null }); }, [e.send, e.seat, e.sessionId]);
  const [draft, setDraft] = useState(homeKept.draft);
  const [atts, setAtts] = useState<Att[]>(homeKept.atts);
  homeKept.draft = draft; homeKept.atts = atts;
  useEffect(() => keepS("sol.home.draft", draft), [draft]);
  mark.current = (a) => setAtts((x) => [...x.filter((y) => y.name !== a.name), a]);
  const [drop, setDrop] = useState(false);
  const [rec, setRec] = useState<"off" | "on" | "ending">("off"); // ending: the mic is closed, the last words are being read
  const [live, setLive] = useState({ kept: "", open: "" });       // words settled (ink) and still being read (dim), as he speaks
  const settledWords = useRef("");                                // what the recorder had settled when it stopped
  const [boxFocus, setBoxFocus] = useState(false);
  // a new chat starts on the seat Control's "in Life" picks (seats.life, mirrored into defaults.seat), Codex until the
  // settings come; the seat switch under the box changes it while the chat is new. An old chat opens where it lives;
  // there the switch, or the other seat's model in the list, starts a new chat on that seat (#141).
  const lifeSeat = e.settings?.defaults.seat ?? "codex";
  useEffect(() => { if (!e.sessionId && e.seat !== lifeSeat) e.pickSeat(lifeSeat); }, [lifeSeat]); // eslint-disable-line react-hooks/exhaustive-deps
  const recorder = useRef<Recorder | null>(null);
  // leaving the chat (to a session) while dictating closes the mic; the words heard so far are dropped with it
  useEffect(() => () => { const r = recorder.current; recorder.current = null; void r?.stop().catch(() => {}); }, []);
  const recStart = useRef(0);
  const talk = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // the composer grows on a spring: measure what it would be, then let the height travel there (overshoots a hair)
  const boxH = useSpring(0, CFG.grow, (v) => { if (box.current) box.current.style.height = `${v}px`; });
  const grow = () => {
    const t = box.current;
    if (!t) return;
    const prev = boxH.v || t.offsetHeight;
    t.style.height = "auto";
    const nat = Math.min(200, t.scrollHeight);
    t.style.overflowY = nat >= 200 ? "auto" : "hidden";
    t.style.height = `${prev}px`;
    if (!boxH.v || reducedMotion()) boxH.set(nat); else boxH.to(nat);
  };
  // sending: the box presses down, then comes back past rest; the words fly up from it
  const askBox = useRef<HTMLDivElement>(null);
  const sendP = useSpring(0, CFG.pop, (v) => { const el = askBox.current; if (el) el.style.scale = v === 0 ? "" : `${1 - 0.012 * v} ${1 - 0.075 * v}`; });
  const stick = useRef<Follow | null>(null);
  const [flw, setFlw] = useState<Follow | null>(null);   // the same follow, for the orb to draw
  const attach = async (files: File[]) => {
    const got = await Promise.all(files.map(readFile));
    setAtts((a) => [...a, ...got]);
  };
  const micDown = async () => {
    if (recorder.current) { await micStop(); recStart.current = -1; return; }
    if (rec === "ending") return;
    try {
      recorder.current = await startRecording(e.settings?.mic, (clip, tag) => e.hear(clip, false, tag));
      recStart.current = Date.now();
      setLive({ kept: "", open: "" }); setRec("on");
    } catch (err) { e.flash((err as Error).message || "the microphone is not available"); }
  };
  const micUp = () => {
    if (recStart.current > 0 && Date.now() - recStart.current > 500) void micStop();
  };
  // Stopping keeps the words on screen, with an ellipsis, until the last stretch is read; then they land in the draft.
  const micStop = async () => {
    const r = recorder.current;
    recorder.current = null;
    if (!r) return;
    setRec("ending");
    settledWords.current = r.settled();
    try {
      const audio = await r.stop();
      if (audio) e.hear(audio); else e.heardCb.current("");   // everything was already settled
    } catch (err) { setRec("off"); e.flash("could not read that recording: " + ((err as Error).message ?? err)); }
  };
  e.partialCb.current = (text, tag) => { const r = recorder.current; if (r) setLive(r.heard(tag, text)); };
  e.heardCb.current = (last) => {
    const text = [settledWords.current, last].filter(Boolean).join(" ");
    settledWords.current = "";
    setRec("off"); setLive({ kept: "", open: "" });
    if (text) {
      const t = box.current;
      const at = t?.selectionStart ?? draft.length;
      const end = t?.selectionEnd ?? at;
      setDraft((d) => {
        const pad = at > 0 && d[at - 1] && !/\s/.test(d[at - 1]) ? " " : "";
        return d.slice(0, at) + pad + text + d.slice(end);
      });
    }
    requestAnimationFrame(() => { grow(); box.current?.focus(); });
  };
  const send = () => {
    const lead = atts.filter((a) => a.note).map((a) => a.note + "\n").join("");
    if (e.say(draft.trim(), atts, lead)) {
      setDraft(""); setAtts([]); requestAnimationFrame(grow);
      sendP.set(1); sendP.to(0, { cfg: CFG.pop, delay: 60 });
      stick.current?.glide();
    }
  };

  // the chat's own keys and drops; the shell's (side, settings, new) are Home's
  const h = useRef({ stop: e.stop, busy: e.busy });
  h.current = { stop: e.stop, busy: e.busy };
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (ev.metaKey && ev.key === "a" && ev.target !== box.current) ev.preventDefault();
      else if (ev.key === "Escape" && h.current.busy && !ev.defaultPrevented) { ev.preventDefault(); h.current.stop(); }
    };
    let depth = 0;
    const over = (ev: DragEvent) => ev.preventDefault();
    const enter = (ev: DragEvent) => { ev.preventDefault(); depth++; setDrop(true); };
    const leave = () => { if (--depth <= 0) { depth = 0; setDrop(false); } };
    const dropped = (ev: DragEvent) => {
      ev.preventDefault(); depth = 0; setDrop(false);
      const fs = Array.from(ev.dataTransfer?.files ?? []);
      if (fs.length) attachRef.current(fs);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("dragover", over);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", dropped);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", dropped);
    };
  }, []);
  const attachRef = useRef(attach);
  attachRef.current = attach;

  // the talk follows its own end on a spring while the answer grows; it jumps when a conversation is opened
  const hasMsgs = e.msgs.length > 0;
  useEffect(() => {
    const t = talk.current, inner = t?.querySelector(".talk-inner") as HTMLElement | null;
    if (!t || !inner) { stick.current = null; setFlw(null); return; }
    const f = (stick.current = follow(t, inner));
    setFlw(f);
    const back = kept<{ id?: string; y: number } | null>("sol.home.scroll", null);
    if (back && back.id === e.sessionId && back.y >= 0) { requestAnimationFrame(() => f.goTo(back.y)); } else f.jump();
    const onScroll = () => keepS("sol.home.scroll", { id: e.sessionId, y: t.scrollTop });
    t.addEventListener("scroll", onScroll, { passive: true });
    return () => { t.removeEventListener("scroll", onScroll); f.destroy(); stick.current = null; setFlw(null); };
  }, [hasMsgs, e.sessionId]);
  useLanding(talk, e.sessionId, e.msgs.length, useCallback((y: number) => stick.current?.goTo(y), []));
  useEffect(() => { if (!e.busy) box.current?.focus(); }, [e.busy, e.sessionId]);
  useEffect(() => { seenSession(e.sessionId); }, [e.sessionId]);

  const last = e.msgs.length - 1;
  const waiting = e.busy && e.msgs[last]?.who !== "you";

  useEffect(() => { e.send({ type: "dictation", on: rec === "on" }); }, [rec === "on", e.up]);
  // the scenes (creature/scenes.ts) stand beside the composer
  useEffect(() => { setSceneBox(() => askBox.current?.getBoundingClientRect() ?? null); return () => setSceneBox(null); }, []);
  // EDIT: while a turn writes or edits files, hands rewrite them beside the box; the turn's end lets the scene settle
  const turnFrom = e.msgs.map((m) => m.who).lastIndexOf("me");
  const edits = e.busy ? e.msgs.slice(turnFrom + 1).filter((m) => m.who === "tool" && m.kind === "write") : [];
  const editFiles = edits.map((m) => m.text.replace(/^\w+ /, "").replace(/ \(\+\d+\)$/, "").split("/").slice(-2).join("/")).join("\n");
  useEffect(() => {
    if (editFiles) playScene("edit", undefined, { title: `editing ${edits.length === 1 ? "a file" : `${edits.length} files`}`, lines: editFiles.split("\n") });
    else endScene("edit");
  }, [editFiles]); // eslint-disable-line react-hooks/exhaustive-deps
  // DICTATE: a notepad takes the words as they come; when the words land in the draft it is handed into the box
  const said = [live.kept, live.open].filter(Boolean).join(" ");
  useEffect(() => {
    if (rec !== "off") playScene("dictate", undefined, { text: said });
    else endScene("dictate", { sent: true });
  }, [rec, said]);
  // UNPLUGGED: the cable scene while the creature says unplugged
  const cstate = useCreature().state;
  useEffect(() => { if (cstate === "unplugged") playScene("unplugged"); else endScene("unplugged"); }, [cstate]);
  // the scene lives on this talk's canvas: leaving the chat takes it away at once
  useEffect(() => () => stopScene("unplugged"), []);
  // consecutive steps become one card; everything else is a message
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i <= last; i++) {
    const m = e.msgs[i];
    if (m.who === "tool") {
      const run: typeof e.msgs = [];
      const start = i;
      for (; i <= last && e.msgs[i].who === "tool"; i++) {
        const t = e.msgs[i];
        if (t.kind === "reasoning" && t.done !== false && !t.detail) continue; // thought without a summary: nothing to show
        run.push(t);
      }
      i--;
      if (run.length) blocks.push(<Steps key={`s${start}`} steps={run} />);
    } else blocks.push(<Message key={i} m={m} live={e.busy && i === last} />);
  }

  return (<>
    <SceneLayer />
    <Site name="talk">
    <div className="talk-wrap">
      <div className="talk" ref={talk}>
        {e.msgs.length > 0 ? (
          <div className="talk-inner">
            {blocks}
            {waiting && <div className="msg you md live"><p /></div>}
          </div>
        ) : <div className="empty"><Mark size={56} live /></div>}
      </div>
      <Trail scroller={talk} version={e.msgs.length} goTo={(y) => stick.current?.goTo(y)} />
      <Orb f={flw} />
    </div>
    </Site>
    <Site name="composer">
    <div className={`ask ${drop ? "dropping" : ""}`}>
      <div className="ask-col">
        {atts.length > 0 && (
          <div className="chips">
            {atts.map((a, i) => (
              <div className="chip" key={i}>
                {a.thumb && <img src={a.thumb} alt="" />}
                <span>{a.name}</span>
                <button onClick={() => setAtts((x) => x.filter((_, j) => j !== i))} title="remove">×</button>
              </div>
            ))}
          </div>
        )}
        <FileLine mode="life" page={`Home · chat · ${e.seat}`} conversation={e.sessionId} />
        <EngineBack up={e.up} />
        <div className="ask-inner" ref={askBox} onFocus={() => setBoxFocus(true)} onBlur={() => setBoxFocus(false)}>
          {boxFocus && <Fringe eye={!e.busy} />}
          {rec !== "off" && (
            <p className="live" aria-live="polite">
              {draft.trim() || live.kept || live.open ? <>{[draft.trim(), live.kept].filter(Boolean).join(" ")}{live.open && <span className="said">{(draft.trim() || live.kept) ? " " : ""}{live.open}</span>}{rec === "ending" && <span className="said">…</span>}</>
                : <span className="said">{rec === "ending" ? "…" : "listening…"}</span>}
            </p>
          )}
          <textarea
            ref={box}
            rows={1}
            value={draft}
            placeholder={!e.up ? "engine is starting" : e.busy ? "say something, Sol stops to listen" : "say something"}
            disabled={!e.up}
            onChange={(ev) => { setDraft(ev.target.value); grow(); }}
            onPaste={(ev) => {
              const fs = Array.from(ev.clipboardData.files);
              if (fs.length) { ev.preventDefault(); attach(fs); }
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !ev.shiftKey && !composing(ev)) { ev.preventDefault(); send(); }
            }}
          />
          {e.busy && <button className="stop" onClick={e.stop}>stop</button>}
        </div>
        <Picker seat={e.seat} info={e.info} seats={e.models.seats} model={e.model} effort={e.effort} efforts={e.efforts}
          up={e.up} health={e.health} context={e.context} win={e.win} parts={e.parts} rec={rec !== "off"} notice={e.notice}
          onSeat={e.pickSeat} onModel={e.pickModel} onSeatModel={e.pickSeatModel} onEffort={e.pickEffort}
          onMicDown={micDown} onMicUp={micUp} />
      </div>
    </div>
    </Site>
  </>);
}
