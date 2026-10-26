// The doorway: Marco's away screen. One creature, one sentence, one tap to call the home seat.
// Things slide, never fade; the mark is the only live thing; colour only on indicators.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CFG, enter, stagger, useSpring } from "../motion";
import { Swap } from "../MotionKit";
import { Mark } from "../Mark";
import { useCreatureDriver } from "../creature/state";
import { micLevel, outLevel } from "../voice";
import { VOICES } from "../voices";
import { useDoor, type Demo, type Line, type Step } from "./useDoor";

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// Dev only: ?demo=1 seeds a spoken moment, ?demo=working a turn in progress, so every look can be seen without the engine.
function demoFor(): Demo | undefined {
  if (!import.meta.env.DEV) return undefined;
  const d = new URLSearchParams(location.search).get("demo");
  if (!d) return undefined;
  const me = (id: string, text: string): Line => ({ id, who: "me", text, final: true });
  const you = (id: string, text: string): Line => ({ id, who: "you", text, final: true });
  const st = (id: string, text: string, done: boolean): Step => ({ id, text, done, ok: done ? true : undefined });
  const title = "what is due this week for la245";
  if (d === "settings") return { title, call: "off", settings: true, lines: [], steps: [] };
  if (d === "working") return {
    title, call: "live",
    lines: [you("1", "Morning. Your essay is due Thursday."), me("2", "Can you check the syllabus for the reading too?")],
    steps: [st("a", "reading school/la245/brain.md", true), st("b", "searching: BU LA245 syllabus", true), st("c", "reading school/la245/week6.md", false)],
  };
  return {
    title, call: "live",
    lines: [me("1", "What is due this week?"), you("2", "Two things. The LA245 essay is due Thursday at noon, and the reading response is Friday."), me("3", "Is the essay still on the first draft?")],
    steps: [st("a", "reading school/la245/brain.md", true), st("b", "searching: BU LA245 syllabus", true), st("c", "running ls school", true)],
  };
}

export default function Away() {
  const demo = useMemo(demoFor, []);
  const d = useDoor(demo);
  const openTranscript = (o: boolean) => { if (o) setGear(false); setOpen(o); };
  const [open, setOpen] = useState(false);
  const [gear, setGear] = useState(demo?.settings ?? false);
  const [dy, setDy] = useState<number | null>(null);

  const lastMe = [...d.lines].reverse().find((l) => l.who === "me");
  const lastYou = [...d.lines].reverse().find((l) => l.who === "you");
  const running = d.steps.filter((s) => !s.done);
  const spokeYet = d.lines.length > 0 && d.lines[d.lines.length - 1].who === "you";
  const lastId = d.lines[d.lines.length - 1]?.who;
  const working = d.texting ? lastId !== "you" : running.length > 0 && !spokeYet;
  const [draft, setDraft] = useState("");
  const failures = d.steps.filter((s) => s.done && s.ok === false).length;

  void failures;
  useCreatureDriver({ seat: "codex" });   // the creature draws what the engine says

  const lines = working ? d.steps.slice(-3) : [];
  const did = d.steps.slice(-3).map((s) => s.text).join(" · ");

  // the long press on the top strip: a fresh conversation
  const press = useRef<number | undefined>(undefined);
  const long = useRef(false);
  const strip = {
    onPointerDown: () => { press.current = window.setTimeout(() => { press.current = undefined; long.current = true; d.freshConversation(); navigator.vibrate?.(12); }, 600); },
    onPointerUp: () => window.clearTimeout(press.current),
    onPointerLeave: () => window.clearTimeout(press.current),
    onPointerCancel: () => window.clearTimeout(press.current),
    onContextMenu: (e: React.SyntheticEvent) => e.preventDefault(),
  };

  return (
    <div className="away">
      <header className="strip" {...strip}>
        <button className="gear" onClick={() => { if (long.current) { long.current = false; return; } setOpen(false); setGear((g) => !g); }} >settings</button>
        <span className="right">{d.up ? `away · ${d.title ? trim(d.title, 26) : "the desk is on"}` : "away · the desk is off"}</span>
      </header>

      <main className="mid">
        <button className="creature-btn" onClick={d.tap} aria-label={d.callState === "off" ? "start the call" : "end the call"}>
          <Mark size={112} live />
        </button>

        <div className="said" aria-live="polite">
          {/* the sentence changes by sliding: the old one leaves upward, the new rises from below (a sentence still being written updates in place) */}
          <Swap k={working ? "w" : lastYou ? `y${lastYou.id}` : `c${d.callState}`} dist={30}>
            {working ? <p className="say dim">Give me a second.</p>
              : lastYou ? <p className="say">{lastYou.text}</p>
              : <p className="say dim">{d.callState === "ringing" ? "Connecting." : d.callState === "live" ? "Listening." : "Tap me to talk."}</p>}
          </Swap>
          {working ? (
            <ul className="doing">
              {lines.map((s) => (
                <Li key={s.id} s={s} />
              ))}
            </ul>
          ) : (
            <p className="did">{d.why || did || " "}</p>
          )}
        </div>

        <Swap k={lastMe?.id ?? "-"} dist={16} className="meswap">
          <p className="me">
            {lastMe && (<>
              <svg viewBox="0 0 8 12" width="8" height="12" aria-hidden="true"><rect x="2.5" y="0.5" width="3" height="6" rx="1.5" /><path d="M1 5.5a3 3 0 0 0 6 0M4 8.5v2.5" /></svg>
              <span>{lastMe.text}</span>
            </>)}
          </p>
        </Swap>
      </main>

      <form className="type" onSubmit={(e) => { e.preventDefault(); if (d.say(draft)) setDraft(""); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type to Sol" enterKeyHint="send"
          disabled={d.callState !== "off"} autoComplete="off" aria-label="type to Sol" />
      </form>

      <footer className="foot">
        <Bars live={d.callState === "live"} demo={!!demo} />
        <Handle open={open} setOpen={openTranscript} setDy={setDy} />
      </footer>

      <Sheet open={open} setOpen={openTranscript} dy={dy} setDy={setDy} follow={d.lines}>
        {d.lines.length === 0 && <p className="none">Nothing said yet.</p>}
        {d.lines.map((l) => <p key={l.id} className={l.who}><b>{l.who === "me" ? "me" : "sol"}</b>{l.text}</p>)}
      </Sheet>
      <Sheet open={gear} setOpen={setGear} className="settings" follow={null}>
        <SettingsBody d={d} demo={!!demo} />
      </Sheet>
    </div>
  );
}

// Five level bars: the mic when the call is live; still when not.
function Bars({ live, demo }: { live: boolean; demo: boolean }) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const h = [0, 0, 0, 0, 0];
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      let l = live ? micLevel() : 0;
      if (live && l === null && demo) l = 0.04 + 0.03 * Math.sin(now / 90);
      const e = Math.min(1, Math.sqrt(l ?? 0) * 2);
      refs.current.forEach((el, k) => {
        if (!el) return;
        const shape = 1 - Math.abs(k - 2) / 4;
        const want = live ? 0.12 + e * shape * (0.55 + 0.45 * Math.sin(now / 130 + k * 1.7)) : 0;
        h[k] += (want - h[k]) * 0.35;
        el.style.height = `${4 + Math.round(h[k] * 24)}px`;
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [live, demo]);
  return (
    <div className={`bars${live ? " on" : ""}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((k) => <i key={k} ref={(el) => { refs.current[k] = el; }} />)}
    </div>
  );
}

// The pull handle: a tap toggles, a drag moves the sheet with the finger.
function useDrag(open: boolean, setOpen: (o: boolean) => void, drag: (dy: number | null) => void) {
  const start = useRef<{ y: number; moved: boolean } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => { start.current = { y: e.clientY, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s) return;
      const dy = e.clientY - s.y;
      if (Math.abs(dy) > 6) s.moved = true;
      if (s.moved) drag(dy);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dy = e.clientY - s.y;
      drag(null);
      if (!s.moved) setOpen(!open);
      else if (dy < -40) setOpen(true);
      else if (dy > 40) setOpen(false);
    },
    onPointerCancel: () => { start.current = null; drag(null); },
  };
}

// The foot handle only starts the pull; the sheet itself follows the finger.
function Handle({ open, setOpen, setDy }: { open: boolean; setOpen: (o: boolean) => void; setDy: (dy: number | null) => void }) {
  const h = useDrag(open, setOpen, setDy);
  return <div className="handle-zone" role="button" aria-label="the transcript" {...h}><i className="handle" /></div>;
}

function Sheet({ open, setOpen, dy: dyIn, setDy: setDyIn, follow, className, children }: {
  open: boolean; setOpen: (o: boolean) => void; dy?: number | null; setDy?: (dy: number | null) => void; follow: unknown;
  className?: string; children: React.ReactNode;
}) {
  const [own, setOwn] = useState<number | null>(null);
  const dy = dyIn !== undefined ? dyIn : own;
  const setDy = setDyIn ?? setOwn;
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(500);
  useEffect(() => { if (ref.current) setH(ref.current.offsetHeight); }, [open]);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && follow && body.current) body.current.scrollTop = body.current.scrollHeight;
    if (open && body.current) stagger(body.current.children, { y: 20, gap: 32, delay: 90, max: 10, cfg: CFG.slide }); // the lines rise in behind the sheet
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && follow && body.current) body.current.scrollTop = body.current.scrollHeight; }, [follow]); // eslint-disable-line react-hooks/exhaustive-deps
  // the sheet is one spring on its height above the foot. A finger drags it directly (and the spring remembers how
  // fast the finger was going); letting go flings it to open or shut with that speed.
  const base = open ? 0 : h;
  const sy = useSpring(base, { k: 210, z: 0.8, eps: 0.3 }, (v) => { if (ref.current) ref.current.style.transform = `translateY(${v}px)`; });
  const last = useRef({ y: 0, t: 0, v: 0 });
  const placed = useRef(false), wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (!placed.current) { placed.current = true; sy.set(ref.current ? Math.max(base, open ? 0 : ref.current.offsetHeight) : base); return; }
    if (dy !== null) {
      const y = Math.max(0, Math.min(h, base + dy)), n = performance.now();
      const dt = (n - last.current.t) / 1000;
      if (dt > 0 && dt < 0.2) last.current.v = (y - last.current.y) / dt;
      last.current.y = y; last.current.t = n;
      sy.set(y, last.current.v);
    } else if (wasOpen.current === open && sy.resting) { sy.set(base); } // only the sheet's size changed
    else { sy.to(base, { vel: last.current.v * 0.5 }); last.current.v = 0; }
    wasOpen.current = open;
  }, [dy, base, h]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = useDrag(open, setOpen, setDy);
  return (
    <div className={`asheet ${className ?? ""}${dy !== null ? " dragging" : ""}`} ref={ref} style={{ transform: "translateY(100%)" }} aria-hidden={!open} inert={!open}>
      <div className="handle-zone top" {...g}><i className="handle" /></div>
      <div className="lines" ref={body}>{children}</div>
    </div>
  );
}

const LANGS: [string, string][] = [["follow", "follow"], ["english", "English"], ["cantonese", "Cantonese"], ["dutch", "Dutch"]];

// Five small bars on a voice row while its sample plays, driven by the speaker's level.
function RowBars({ demo }: { demo: boolean }) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      let l = outLevel();
      if (l === null && demo) l = 0.03 + 0.03 * Math.sin(now / 90);
      const e = Math.min(1, Math.sqrt(l ?? 0) * 2);
      refs.current.forEach((el, k) => { if (el) el.style.height = `${3 + Math.round(e * (1 - Math.abs(k - 2) / 4) * (0.6 + 0.4 * Math.sin(now / 110 + k * 1.7)) * 16)}px`; });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [demo]);
  return <span className="rowbars" aria-hidden="true">{[0, 1, 2, 3, 4].map((k) => <i key={k} ref={(el) => { refs.current[k] = el; }} />)}</span>;
}

function Patience({ value, onDone }: { value: number; onDone: (v: number) => void }) {
  const [v, setV] = useState<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round((200 + Math.max(0, Math.min(1, (x - r.left) / r.width)) * 1300) / 50) * 50;
  };
  const cur = v ?? value;
  return (
    <div className="patience">
      <div className="ptrack" ref={track} role="slider" aria-valuemin={200} aria-valuemax={1500} aria-valuenow={cur}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setV(at(e.clientX)); }}
        onPointerMove={(e) => { if (v !== null) setV(at(e.clientX)); }}
        onPointerUp={(e) => { const n = at(e.clientX); setV(null); onDone(n); }}
        onPointerCancel={() => setV(null)}>
        <i className="fill" style={{ width: `${((cur - 200) / 1300) * 100}%` }} />
        <i className="knob" style={{ left: `${((cur - 200) / 1300) * 100}%` }} />
      </div>
      <span className="val">{cur} ms</span>
    </div>
  );
}

function SettingsBody({ d, demo }: { d: ReturnType<typeof useDoor>; demo: boolean }) {
  const s = d.settings;
  const since = d.since ? new Date(d.since) : null;
  const engine = !d.up ? "engine not answering" : since && isFinite(+since) ? `engine up since ${since.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "engine up";
  if (!s) return <p className="none">{d.up ? "Loading." : "The desk is not answering."}</p>;
  return (
    <>
      <h2>voice</h2>
      <ul className="vlist">
        {VOICES.map(([name, word]) => {
          const on = s.voice === name;
          return (
            <li key={name}>
              <button className={`vrow${on ? " on" : ""}`} onClick={() => d.pick(name)}>
                <span className="mk">{d.sampling === name && name !== "off" ? <RowBars demo={demo} /> : on ? <i className="sq" /> : null}</span>
                <b>{name}</b><span className="w">{word}</span>
              </button>
              {d.sampleWhy && on && <p className="why">{d.sampleWhy.why}</p>}
            </li>
          );
        })}
      </ul>
      <p className="note">takes effect on the next call</p>
      <h2>patience</h2>
      <Patience value={s.patienceMs} onDone={(v) => d.set({ patienceMs: v })} />
      <h2>language</h2>
      <div className="langs">
        {LANGS.map(([v, label]) => <button key={v} className={s.language === v ? "on" : ""} onClick={() => d.set({ language: v })}>{label}</button>)}
      </div>
      <p className="note engine">{engine}</p>
    </>
  );
}

// a step line slides in from the left; a finished one's marker turns over
function Li({ s }: { s: Step }) {
  const ref = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => { if (ref.current) enter(ref.current, { x: -22, cfg: CFG.slide }); }, []);
  return <li ref={ref} className={s.done ? "done" : "run"}><i />{s.text}</li>;
}
