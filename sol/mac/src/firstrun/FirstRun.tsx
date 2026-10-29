// The first run (#134): the first five minutes with Sol, inside the real window. Nothing here is a picture of the
// face: the hero is Sol himself (Sol.tsx, its life on cue; goo.tsx gives him drops that leave with a neck), every card,
// button and light is goo (sol/skills/sol/look.md, creature/goo.tsx), the look controls are Settings' own drawer
// (Settings.tsx LookDrawer), the notch is the real notch window asked to peek, and the last scenes are done in the
// real Home with a light on the real elements. The storyboard is sol/design/onboarding/dawn.html; its eight scenes:
//   0 the door is the website (not here)      4 yours: glass, colour, bubble, the real look controls
//   1 hello: it hatches, asks a name,          5 the notch: it flies up there; the shortcut
//     the install runs behind as a thin line   6 together: ask, start work, keep on the desk, in the real window
//   2 senses: one card per permission          7 a card to keep
//   3 your AIs: each signs in through its own flow (the legal line in #134: never a Sol sign-in button)
// When: App.tsx mounts it over the app when the person is new (nothing kept in this profile) or the page says so:
// ?firstrun=1 is the app with no code yet (lib.rs: the install runs), ?firstrun=<2..7> opens one scene to look at.
// Fun, not a chore: no form, no list of steps, the creature says one thing at a time and the person does one thing.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CellCheck } from "../creature/indicators";
import { Sol } from "../Sol";
import { JOBS, bandsCss } from "../creature/goo";
import { CFG, enter, reducedMotion, spring, stagger, type Spring } from "../motion";
import { Swap } from "../MotionKit";
import { LookDrawer, FALLBACK } from "../Settings";
import { applyLook, cleanLook, keptLook } from "../look";
import type { useEngine } from "../useEngine";
import { check, ask, settings as openSettings, sayScreen, readsScreen, warmMicrophone, POLL_MS, type Permission, type PermissionState } from "./permissions";
import { startInstall, installWanted, type Install } from "./install";
import { Hero as Body, GooBodies, GooSpot, GlyphBud, type HeroLife } from "./goo";
import "./firstrun.css";

type Engine = ReturnType<typeof useEngine>;
const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const KEY = isMac ? ["⌘", "⇧", "Space"] : ["Ctrl", "⇧", "Space"];
const DONE = "sol.firstrun";

// is this a first run? the page asks for it, or nothing of Sol is kept in this profile yet
export function firstRunWanted(): boolean {
  const p = new URLSearchParams(location.search);
  if (p.has("firstrun")) return true;
  if (p.has("work")) return false;   // a pop-out window is never new
  try { return !localStorage.getItem(DONE) && !localStorage.getItem("sol.mode") && !localStorage.getItem("sol.home.open"); } catch { return false; }
}
const sceneAsked = (): number => { const v = Number(new URLSearchParams(location.search).get("firstrun")); return v >= 2 && v <= 7 ? v : 1; };

// one line the creature says, typed out a letter at a time (reduced motion: whole)
function Say({ text, className, onDone, delay = 0 }: { text: string; className?: string; onDone?: () => void; delay?: number }) {
  const [n, setN] = useState(reducedMotion() ? text.length : 0);
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    if (reducedMotion()) { done.current?.(); return; }
    let i = 0, t = 0;
    const tick = () => { i++; setN(i); if (i < text.length) t = window.setTimeout(tick, /[.,?!]/.test(text[i - 1]) ? 180 : 26); else done.current?.(); };
    t = window.setTimeout(tick, delay);
    return () => window.clearTimeout(t);
  }, [text, delay]);
  return <p className={`fr-say ${className ?? ""}`} aria-label={text}>{text.slice(0, n)}<span className="fr-caret" style={{ opacity: n < text.length ? 1 : 0 }} /></p>;
}

// a row of things arriving one after another (motion.ts stagger)
function Arrive({ children, className, gap = 70 }: { children: ReactNode; className?: string; gap?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current) stagger(ref.current.children, { y: 14, gap, cfg: CFG.slide }); }, [gap]);
  return <div ref={ref} className={className}>{children}</div>;
}

// a scene: its children arrive one after another from below, on the arrive spring, so a scene is entered, not shown
function Scene({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (ref.current) stagger(ref.current.children, { y: 22, gap: 80, cfg: CFG.arrive }); }, []);
  return <section ref={ref} className={`fr-scene ${className ?? ""}`}>{children}</section>;
}

// ---- the hero: Sol, one for the whole run ----
// He lives outside the scenes (the swap would clip and remount him): he hatches large at the centre out of a seed of
// goo, and when a scene moves on he hops to his perch at the top, smaller, the same body all along, his drops falling
// away as he goes. Scene 5 sends him to the notch, a trail of drops under him.
type Pose = "centre" | "lift" | "perch" | "notch" | "gone";
const HERO = 168;   // Sol's size at the centre; his box (goo.tsx Hero) is three times it, room for the drops
function heroAt(p: Pose) {
  const W = window.innerWidth, H = window.innerHeight;
  switch (p) {
    case "centre": return { x: W / 2, y: H * 0.44, s: 1 };
    case "lift": return { x: W / 2, y: H * 0.27, s: 0.72 };
    case "perch": return { x: W / 2, y: 104, s: 0.4 };
    case "notch": return { x: W / 2, y: -26, s: 0.18 };
    case "gone": return { x: W / 2, y: -80, s: 0.1 };
  }
}
function Hero({ life, pose, hatch, onRest }: { life: React.RefObject<HeroLife | null>; pose: Pose; hatch: boolean; onRest?: (p: Pose) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const cur = useRef({ x: 0, y: 0, s: 1 });
  const sp = useRef<{ x: Spring; y: Spring; s: Spring } | null>(null);
  const first = useRef(true);
  const rest = useRef(onRest); rest.current = onRest;
  const put = () => { const d = el.current; if (!d) return; const c = cur.current; d.style.translate = `${c.x}px ${c.y}px`; d.style.scale = String(c.s); };
  useLayoutEffect(() => {
    const d = el.current; if (!d) return;
    const t = heroAt(pose);
    if (first.current) {
      first.current = false;
      cur.current = { ...t }; put();
      sp.current = {
        x: spring(t.x, CFG.arrive, (v) => { cur.current.x = v; put(); }),
        y: spring(t.y, CFG.arrive, (v) => { cur.current.y = v; put(); }, () => rest.current?.(pose)),
        s: spring(t.s, CFG.arrive, (v) => { cur.current.s = v; put(); }),
      };
      if (!hatch) { d.style.opacity = "1"; return; }
      // the hatch is the body's own (goo.tsx Hero: a seed of goo, he grows out of it); here he only rises a little into place
      d.style.opacity = "1";
      if (reducedMotion()) return;
      sp.current!.y.set(t.y + 30);
      const h = window.setTimeout(() => sp.current!.y.to(t.y), 900);
      return () => window.clearTimeout(h);
    }
    const l = life.current;
    if (l && pose !== "gone") { l.hop(pose === "notch" ? 1.3 : 0.9); if (pose === "notch") l.trail(520); }
    d.style.opacity = pose === "gone" ? "0" : "1";
    const cfg = pose === "notch" ? { k: 120, z: 0.86 } : CFG.arrive;
    sp.current!.y.rest = () => rest.current?.(pose);
    sp.current!.x.to(t.x, { cfg }); sp.current!.y.to(t.y, { cfg }); sp.current!.s.to(t.s, { cfg });
  }, [pose]); // eslint-disable-line react-hooks/exhaustive-deps
  // the window changing size: the perch moves with it, at once
  useEffect(() => {
    const f = () => { const t = heroAt(pose); sp.current?.x.set(t.x); sp.current?.y.set(t.y); sp.current?.s.set(t.s); };
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [pose]);
  return <div ref={el} className="fr-hero" style={{ opacity: 0, width: HERO * 3, height: HERO * 3, left: -HERO * 1.5, top: -HERO * 1.5 }}><Body ref={life} size={HERO} hatch={hatch} /></div>;
}

export default function FirstRun({ e, onDone }: { e: Engine; onDone: () => void }) {
  const [scene, setScene] = useState(sceneAsked);
  const [name, setName] = useState(() => localStorage.getItem("sol.firstrun.name") ?? "");
  const [inst, setInst] = useState<Install | null>(null);
  const [claudeSeen, setClaudeSeen] = useState(false);
  const life = useRef<HeroLife>(null);
  const stop = useRef<(() => void) | null>(null);
  const installing = installWanted();
  // what "open Sol" answered when it could not open (#375): said under the button, never dropped
  const [word, setWord] = useState<string | null>(null);
  // the install, started over any that ran: once the name is given (scene 1), it runs under every scene after
  const run = useCallback((who: string) => {
    stop.current?.();
    setInst(null); setWord(null);
    stop.current = startInstall(who, setInst);
  }, []);
  const begin = useCallback((who: string) => {
    if (stop.current) return;
    localStorage.setItem("sol.firstrun.name", who);
    if (installing || !inApp) run(who);
  }, [installing, run]);
  // the app opened again before the install got far (#375): the name is kept, Hello skips the asking, so the
  // install starts here, on the spot; otherwise the last button had nothing behind it
  useEffect(() => { if (name && !stop.current && (installing || (!inApp && sceneAsked() === 1))) run(name); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stop.current?.(); stop.current = null; }, []);
  const next = () => setScene((s) => Math.min(7, s + 1));
  const finish = () => {
    try { localStorage.setItem(DONE, "done"); } catch { /* private mode */ }
    // the root read again, the engine started, the face at "/"; what could not be done is said under the button
    if (installing) { setWord(null); invoke("welcome_done").catch((e) => setWord(String(e))); return; }
    history.replaceState(null, "", location.pathname);
    onDone();
  };
  // → moves a scene on, for whoever looks at it in a browser
  useEffect(() => {
    const f = (ev: KeyboardEvent) => { if (ev.key === "ArrowRight" && ev.altKey) next(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  const together = scene === 6;
  // the Claude card's own ask (#307): `claude auth status` (welcome.rs claude_status) every STATUS_MS while scene 3 shows
  // and the card is not yet signed in; the install's own line misses a sign-in done in Terminal from the card, and the
  // line's door, where no install runs in the app. Held here, not in the scene: the swap's leaving copy keeps it green.
  const claudeIn = !!inst?.signedIn || claudeSeen;
  useEffect(() => {
    if (!inApp || scene !== 3 || claudeIn) return;
    let alive = true, asking = false;
    const look = () => {
      if (asking) return;   // a slow answer is never asked over
      asking = true;
      void invoke<boolean>("claude_status").then((ok) => { if (alive && ok) setClaudeSeen(true); }).catch(() => {}).finally(() => { asking = false; });
    };
    look();
    const t = window.setInterval(look, STATUS_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, [scene, claudeIn]);
  // where the creature is: the centre while it hatches, lifted when it asks, its perch at the top for the scenes
  // after, the notch when scene 5 sends it, gone while the real window is in use (6)
  const [pose, setPose] = useState<Pose>(() => (sceneAsked() === 1 && !localStorage.getItem("sol.firstrun.name") ? "centre" : sceneAsked() === 6 ? "gone" : "perch"));
  const [flown, setFlown] = useState(false);
  useEffect(() => { if (scene >= 2) setPose(scene === 6 ? "gone" : scene === 5 && flown ? "notch" : "perch"); }, [scene, flown]);
  // while the first run owns the creature, the desk's own mark (the empty state behind) stays out of sight
  useEffect(() => {
    if (together) delete document.body.dataset.firstrun; else document.body.dataset.firstrun = "1";
    return () => { delete document.body.dataset.firstrun; };
  }, [together]);
  return (
    <div className={`firstrun ${together ? "clear" : ""}`} data-scene={scene}>
      <Swap k={String(scene)} className="fr-stage" dir={1} dist={28}>
        {scene === 1 && <Hello name={name} setName={setName} life={life} onNamed={begin} onNext={next} onLift={() => setPose("lift")} />}
        {scene === 2 && <Senses name={name} life={life} onNext={next} />}
        {scene === 3 && <Minds signedIn={claudeIn} onNext={next} />}
        {scene === 4 && <Yours e={e} onNext={next} />}
        {scene === 5 && <TheNotch flown={flown} onFly={() => { setFlown(true); setPose("notch"); }} onNext={next} />}
        {scene === 7 && <Keep e={e} name={name} inst={inst} word={word} onDone={finish} onRetry={() => run(name)} />}
      </Swap>
      {/* the creature and the light sit outside the swap: a thing inside its clipped layer would be cut or remounted */}
      <Hero life={life} pose={pose} hatch={pose === "centre"} onRest={(p) => { if (p === "notch") setPose("gone"); }} />
      {together && <Together e={e} onNext={next} />}
      {inst && !inst.done && scene < 7 && <InstallLine inst={inst} />}
    </div>
  );
}

// ---- 1 hello ----
function Hello({ name, setName, life, onNamed, onNext, onLift }: { name: string; setName: (n: string) => void; life: React.RefObject<HeroLife | null>; onNamed: (n: string) => void; onNext: () => void; onLift: () => void }) {
  const [step, setStep] = useState<"hatch" | "hello" | "ask" | "named">(name ? "named" : "hatch");
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLSpanElement>(null);
  // the hatch is the hero's (Hero above, the same 500 ms); the first word comes once it has landed
  useEffect(() => {
    if (step !== "hatch") return;
    const t = window.setTimeout(() => setStep("hello"), 2300);
    return () => window.clearTimeout(t);
  }, [step]);
  // when it asks, it lifts a little to make room for the answer
  // and listens while the name is typed (the creature's listening look: a sway)
  useEffect(() => { if (step === "ask") { onLift(); input.current?.focus(); life.current?.wear("listening"); } }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  const said = (ev: React.FormEvent) => {
    ev.preventDefault();
    const v = (input.current?.value ?? "").trim();
    if (!v) return;
    setName(v); setStep("named"); onNamed(v);
    const l = life.current; if (l) { l.wear(null); l.hop(1.5); l.shed(26, 1.5); l.wear("ok", 900); }
  };
  return (
    <section className="fr-scene fr-hello">
      <div className="fr-room" />
      {step === "hello" && <Say text="hello." onDone={() => window.setTimeout(() => setStep("ask"), 500)} />}
      {step === "ask" && (
        <form className="fr-name" onSubmit={said}>
          <Say text="what should I call you?" />
          <span className="fr-field" style={{ "--wet": Math.min(1, name.length / 8) } as React.CSSProperties} ref={field}>
            <input ref={input} className="fr-input" aria-label="your name" autoComplete="name" spellCheck={false} placeholder="your name" defaultValue={name}
              onInput={(ev) => { const v = ev.currentTarget.value; field.current?.style.setProperty("--wet", String(Math.min(1, v.trim().length / 8))); const l = life.current; if (l && v) l.hop(0.22); }} />
          </span>
        </form>
      )}
      {step === "named" && (
        <Arrive className="fr-col">
          <p className="fr-say">nice to meet you, <b className="fr-who">{name}</b>.</p>
          <p className="fr-say dim">I'll set myself up in the background while we do the fun part.</p>
          <button className="fr-go" onClick={onNext}><span>let's go</span></button>
        </Arrive>
      )}
    </section>
  );
}

// the install as one liquid line at the foot of the window, and a phrase under it
function InstallLine({ inst }: { inst: Install }) {
  const [open, setOpen] = useState(false);
  // liquid in a dry channel of dots (the Settings slider's own, CellRange): the shore's bands up to a head that wets
  // the dots as it goes; the run fails into ember
  const bands = bandsCss(inst.failed ? JOBS.ember : JOBS.shore, 90, 0.06);
  return (
    <div className={`fr-install ${inst.failed ? "failed" : ""}`}>
      <div className="fr-line"><i style={{ width: `max(10px, ${Math.round(inst.frac * 100)}%)`, backgroundImage: bands, backgroundSize: "100vw 100%" }} /></div>
      <p className="fr-phrase">
        {inst.failed ? <>something stopped: {inst.failed} <button className="link" onClick={() => setOpen((o) => !o)}>{open ? "hide" : "what it said"}</button></> : <>{inst.phrase} · {Math.round(inst.frac * 100)}%</>}
      </p>
      {open && <pre className="fr-log">{inst.lines.join("\n")}</pre>}
    </div>
  );
}

// ---- 2 senses: one card per permission this machine has a switch for ----
const SENSES: { k: Permission; name: string; what: string; glyph: ReactNode }[] = [
  { k: "microphone", name: "hear you", what: "talk instead of typing, and call me by voice.", glyph: <Glyph d="M8 1.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0V4A2.5 2.5 0 0 1 8 1.5zM3.5 8a4.5 4.5 0 0 0 9 0M8 12.5v2" /> },
  { k: "screen", name: "see your screen", what: "a grab of a page or a window when you ask for one.", glyph: <Glyph d="M1.5 3h13v8h-13zM5.5 13.5h5" /> },
  { k: "accessibility", name: "lend a hand", what: "type and scroll for you in other apps, when you say so.", glyph: <Glyph d="M8 2.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM3 6l5 1 5-1M8 7v3l-2 4M8 10l2 4" /> },
  { k: "notifications", name: "tap your shoulder", what: "a small note when something you started is done.", glyph: <Glyph d="M8 2a4 4 0 0 1 4 4v3l1.5 2h-11L4 9V6a4 4 0 0 1 4-4zM6.5 13.5a1.5 1.5 0 0 0 3 0" /> },
];
function Glyph({ d }: { d: string }) { return <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>; }

function Senses({ name, life, onNext }: { name: string; life: React.RefObject<HeroLife | null>; onNext: () => void }) {
  const cardEls = useRef<Partial<Record<Permission, HTMLDivElement | null>>>({});
  // a sense landing is felt: the card pops on the pop spring and washes spring green, Sol hops, sheds and washes green
  // with it (done), the glyph's bud turns spring
  const landed = (k: Permission) => {
    const el = cardEls.current[k]; if (el) { enter(el, { scale: 0.05, cfg: CFG.pop }); el.dataset.just = "1"; window.setTimeout(() => { delete el.dataset.just; }, 1200); }
    const l = life.current; if (l) { l.hop(1.1); l.shed(14, 1.1); l.wear("ok", 900); }
  };
  const [state, setState] = useState<Partial<Record<Permission, PermissionState>>>({});
  const [asking, setAsking] = useState<Permission | null>(null);
  const warmed = useRef(false);
  const [selfRead, setSelfRead] = useState(true);   // the app reads the screen's switch itself (#277); before it, the person says
  useEffect(() => { void readsScreen().then(setSelfRead); }, []);
  // every card asks again on the beat (POLL_MS) while it shows; a switch flipped in System Settings lands by itself
  useEffect(() => {
    let alive = true;
    const look = async () => {
      const next: Partial<Record<Permission, PermissionState>> = {};
      for (const s of SENSES) next[s.k] = await check(s.k);
      if (!alive) return;
      setState(next);
      if (next.microphone === "granted" && !warmed.current) { warmed.current = true; void warmMicrophone(); }
    };
    void look();
    const t = window.setInterval(look, POLL_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  const cards = SENSES.filter((s) => state[s.k] && state[s.k] !== "unsupported");
  const known = Object.keys(state).length > 0;
  const allow = async (k: Permission) => { setAsking(k); const r = await ask(k); setState((s) => ({ ...s, [k]: r })); setAsking(null); if (r === "granted") landed(k); };
  const left = cards.filter((c) => state[c.k] !== "granted").length;
  return (
    <Scene className="fr-senses">
      <Say text={cards.length ? `${name ? name + ", " : ""}give me some senses?` : known ? "this machine trusts me with everything already." : "one moment."} />
      <p className="fr-hint">each one is a switch you can turn off any time, in Settings. no audio is kept.</p>
      <GooBodies className="fr-cards">
        {cards.map((s) => {
          const st = state[s.k]!;
          return (
            <div key={s.k} ref={(x) => { cardEls.current[s.k] = x; }} className={`fr-body fr-card ${st}`}>
              <GlyphBud seed={s.k} job={st === "granted" ? "spring" : st === "denied" ? "ember" : undefined}>{s.glyph}</GlyphBud>
              <h3 className="dtitle">{s.name}</h3>
              <p>{s.what}</p>
              <div className="fr-card-foot">
                {st === "granted" && <span className="fr-got"><CellCheck land /> on</span>}
                {st === "prompt" && <button className="fr-btn sun" disabled={asking === s.k} onClick={() => void allow(s.k)}><span>{asking === s.k ? "asking…" : "allow"}</span></button>}
                {st === "prompt" && s.k === "screen" && inApp && !selfRead && <button className="fr-btn stone" onClick={() => { sayScreen("granted"); setState((x) => ({ ...x, screen: "granted" })); landed("screen"); }}><span>it's on</span></button>}
                {st === "denied" && <button className="fr-btn stone" onClick={() => void openSettings(s.k)}><span>open Settings</span></button>}
              </div>
            </div>
          );
        })}
      </GooBodies>
      <button className="fr-go" onClick={onNext}><span>{known && left === 0 ? "next" : "later"}</span></button>
    </Scene>
  );
}

// ---- 3 your AIs: each through its own door ----
// signedIn is the install's line or the card's own ask (FirstRun above, #307): once in, the Terminal word goes
const STATUS_MS = 3000;
function Minds({ signedIn, onNext }: { signedIn: boolean; onNext: () => void }) {
  const [word, setWord] = useState("");
  useEffect(() => { if (signedIn) setWord(""); }, [signedIn]);
  const claude = () => invoke("claude_login").then(() => setWord("Terminal is open on Claude's sign-in; come back here when it says you are in."))
    .catch((e) => setWord(String(e)));
  return (
    <Scene className="fr-minds">
      <Say text="bring your AIs." />
      <p className="fr-hint">sign in with the accounts you already pay for, in each one's own window. Sol never sees a password.</p>
      <GooBodies className="fr-cards">
        <div key="claude" className="fr-body fr-card">
          <GlyphBud seed="claude"><Glyph d="M8 2v12M2.8 5l10.4 6M2.8 11l10.4-6" /></GlyphBud>
          <h3 className="dtitle">Claude</h3>
          <p>Claude Code runs inside Sol. Its sign-in opens in Terminal, the way Anthropic allows.</p>
          <div className="fr-card-foot">{signedIn ? <span className="fr-got"><CellCheck land /> signed in</span> : inApp ? <button className="fr-btn sun" onClick={() => void claude()}><span>sign in to Claude</span></button> : <span className="dim">inside Sol.app</span>}</div>
        </div>
        <div key="codex" className="fr-body fr-card">
          <GlyphBud seed="codex"><Glyph d="M3 4.5l3.5 3.5L3 11.5M8.5 12h4.5" /></GlyphBud>
          <h3 className="dtitle">Codex</h3>
          <p>ChatGPT's Codex comes inside Sol too. It signs you in itself the first time you talk to it.</p>
          <div className="fr-card-foot"><span className="dim">nothing to do here</span></div>
        </div>
        <div key="gemini" className="fr-body fr-card">
          <GlyphBud seed="gemini"><Glyph d="M8 1.5C8.6 5.6 10.4 7.4 14.5 8 10.4 8.6 8.6 10.4 8 14.5 7.4 10.4 5.6 8.6 1.5 8 5.6 7.4 7.4 5.6 8 1.5z" /></GlyphBud>
          <h3 className="dtitle">Gemini</h3>
          <p>optional: it lets me talk out loud and name your conversations. A key, later, in Settings.</p>
          <div className="fr-card-foot"><span className="dim">later is fine</span></div>
        </div>
      </GooBodies>
      {word && <p className="fr-hint">{word}</p>}
      <button className="fr-go" onClick={onNext}><span>next</span></button>
    </Scene>
  );
}

// ---- 4 yours: the real look controls (Settings.tsx LookDrawer) ----
function Yours({ e, onNext }: { e: Engine; onNext: () => void }) {
  // with the engine up the drawer writes the real settings; before it (the install still running, a browser) the
  // same controls change the window here and are kept for the engine's first settings
  const [local, setLocal] = useState(() => ({ ...FALLBACK, look: keptLook() }));
  const live = e.up && e.settings;
  const s = live ? e.settings! : local;
  const onSet = (patch: object) => {
    if (live) { e.setSettings(patch); return; }
    const look = cleanLook({ ...local.look, ...((patch as { look?: object }).look ?? {}) });
    setLocal((l) => ({ ...l, look })); applyLook(look, false);
  };
  return (
    <Scene className="fr-yours">
      <Say text="can you make this feel like mine?" className="q" />
      <Say text="it already is. move a slider and watch me change." delay={1400} />
      <GooBodies className="fr-drawerbox" rx={30}>
        <div key="drawer" className="fr-body fr-drawer">
          <div className="settings-col">
            <LookDrawer s={s} off={false} onSet={onSet} open onToggle={() => {}} />
          </div>
        </div>
      </GooBodies>
      <p className="fr-hint">the whole window follows. it's all in Settings › look, later.</p>
      <button className="fr-go" onClick={onNext}><span>looks good</span></button>
    </Scene>
  );
}

// ---- 5 the notch: it flies up there ----
function TheNotch({ flown, onFly, onNext }: { flown: boolean; onFly: () => void; onNext: () => void }) {
  const fly = () => {
    onFly();   // the hero takes the notch pose (Hero above): up and small on its own spring
    // the real notch window peeks as it arrives (lib.rs "notch-peek"); both forms, whichever screen it is on
    window.setTimeout(() => {
      void import("@tauri-apps/api/event").then(({ emitTo }) => Promise.all([emitTo("notch", "notch-peek"), emitTo("island", "notch-peek")])).catch(() => {});
    }, 500);
  };
  return (
    <Scene className="fr-notch">
      {!flown && <Say text="when you're elsewhere, I live up there." />}
      {!flown && <button className="fr-go" onClick={fly}><span>show me</span></button>}
      {flown && (
        <Arrive className="fr-col">
          <p className="fr-say">{inApp ? "look up: that's me, in the notch." : "inside the app I'd be in the notch now."}</p>
          <p className="fr-say dim">call me from anywhere with <kbd className="fr-keys">{KEY.map((k) => <span key={k}>{k}</span>)}</kbd></p>
          <p className="fr-hint">try it now if you like. then come back.</p>
          <button className="fr-go" onClick={onNext}><span>next</span></button>
        </Arrive>
      )}
    </Scene>
  );
}

// ---- 6 together: three real things in the real window, a light on the real element ----
type Step = { key: string; find: string[]; say: string; sub: string; done: (e: Engine, seen: Snapshot) => boolean };
type Snapshot = { msgs: number; deskOpen: boolean; fresh: number };
const STEPS: Step[] = [
  { key: "ask", find: [".ask-inner", ".ask"], say: "ask me something.", sub: "anything. type it here and press ⏎.", done: (e, s0) => e.msgs.length > s0.msgs || e.busy },
  { key: "work", find: [".newc", ".side-foot"], say: "when it's a big job, start a session.", sub: "it gets its own folder, its own thread, and I work in it while you do something else.", done: (_e, s0) => fresh() > s0.fresh },
  { key: "desk", find: ["[title='desk']", "[aria-label='desk']", ".ask-inner"], say: "keep something on the desk.", sub: "ask me to \"keep this on the desk\": a note, a card, a page I made stays beside the chat.", done: (e, s0) => !!document.querySelector(".pane.desk") || e.desk.length > 0 || !s0.deskOpen && !!document.querySelector(".pane.desk") },
];
let freshN = 0;
const fresh = () => freshN;
function Together({ e, onNext }: { e: Engine; onNext: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const start = useRef<Snapshot>({ msgs: e.msgs.length, deskOpen: !!document.querySelector(".pane.desk"), fresh: freshN });
  const step = STEPS[i];
  // a press on the new-session button counts (the sidebar's own click handler runs too)
  useEffect(() => {
    const f = (ev: MouseEvent) => { if ((ev.target as Element).closest?.(".newc, .here")) freshN++; };
    document.addEventListener("click", f, true);
    return () => document.removeEventListener("click", f, true);
  }, []);
  // the light follows the real element, wherever the layout puts it: read every frame (a sidebar sliding, the box
  // growing), drawn again only when it moved. A 120 ms timer left it trailing its target by up to seven frames.
  useLayoutEffect(() => {
    let raf = 0, at = "";
    const look = () => {
      let el: Element | null = null;
      for (const sel of step.find) { el = document.querySelector(sel); if (el) break; }
      const r = el ? el.getBoundingClientRect() : null;
      const k = r ? `${r.left.toFixed(1)} ${r.top.toFixed(1)} ${r.width.toFixed(1)} ${r.height.toFixed(1)}` : "";
      if (k !== at) { at = k; setBox(r); }
      raf = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(raf);
  }, [step]);
  // done the moment the real thing happened
  useEffect(() => {
    const t = window.setInterval(() => {
      if (step.done(e, start.current)) { start.current = { msgs: e.msgs.length, deskOpen: !!document.querySelector(".pane.desk"), fresh: freshN }; if (i + 1 < STEPS.length) setI(i + 1); else onNext(); }
    }, 250);
    return () => window.clearInterval(t);
  }, [i, e, step, onNext]);
  const pad = 10;
  const below = box ? box.top > window.innerHeight * 0.55 : false;
  return (
    <>
      {box && <GooSpot box={box} pad={pad} />}
      <div className="fr-caption fr-goo" style={box ? (below ? { left: Math.max(16, Math.min(box.left, window.innerWidth - 380)), bottom: window.innerHeight - box.top + pad + 12 } : { left: Math.max(16, Math.min(box.left, window.innerWidth - 380)), top: box.bottom + pad + 12 }) : { left: "50%", top: "40%", translate: "-50% 0" }}>
        <span className="fr-count">{i + 1} of {STEPS.length}</span>
        <Say text={step.say} />
        <p className="fr-hint">{step.sub}</p>
        <div className="fr-row"><button className="fr-btn stone" onClick={() => (i + 1 < STEPS.length ? setI(i + 1) : onNext())}><span>skip</span></button></div>
      </div>
    </>
  );
}

// ---- 7 a card to keep: a real desk card, in the house style ----
// the last button (#375): while the install runs it waits, and a line under says so; stopped, it is "try again" (the
// install over, from here, no Terminal needed); done, it is "open Sol", and what that could not do is said under it
function Keep({ e, name, inst, word, onDone, onRetry }: { e: Engine; name: string; inst: Install | null; word: string | null; onDone: () => void; onRetry: () => void }) {
  const text = `Call me from anywhere with ${KEY.join(" ")}. I answer here, or open a session if it's a big one. Make me yours in Settings › look.`;
  const [kept, setKept] = useState(false);
  // a real ask: the seat puts the note on the desk itself (its desk tool), the first card of many
  const keep = () => { if (e.say(`keep this on my desk as a note titled "Sol, for ${name || "you"}": ${text}`, [])) setKept(true); };
  const running = !!inst && !inst.done && !inst.failed, stopped = !!inst?.failed || !!word;   // what Open Sol could not do is also tried again
  return (
    <Scene className="fr-keep">
      <Say text="that's us." />
      <GooBodies className="fr-keepbox" rx={28}>
      <div key="note" className="fr-body fr-keepcard">
        <Sol size={34} alone />
        <h3 className="dtitle">Sol, for {name || "you"}</h3>
        <p>call me from anywhere with <kbd className="fr-keys">{KEY.map((k) => <span key={k}>{k}</span>)}</kbd>.</p>
        <p>I answer here, or open a session when it's a big one. make me yours in Settings › look.</p>
        <p className="dim">{new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</p>
      </div>
      </GooBodies>
      <div className="fr-row">
        {e.up && !kept && <button className="fr-btn stone" onClick={keep}><span>keep it on the desk</span></button>}
        {kept && <span className="fr-got"><CellCheck land /> on your desk</span>}
        <button className="fr-go" onClick={stopped ? onRetry : onDone} disabled={running}><span>{running ? `${inst?.phrase}…` : stopped ? "try again" : "open Sol"}</span></button>
      </div>
      {running && <p className="fr-hint">I'm still setting up behind this. the button lights up when I'm done.</p>}
      {stopped && <p className="fr-hint">the install stopped: {inst?.failed}. try again here, or from Terminal: curl -fsSL https://marcocyl04-ux.github.io/sol-beta/install | sh</p>}
      {word && <p className="fr-hint">{word}</p>}
    </Scene>
  );
}
