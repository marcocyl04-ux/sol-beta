// Dev only: every goo bit at its size and large, on the dark, for shooting (gallery.html on the scratch Vite).
// Each build piece adds its own <Section>. Not shipped: nothing imports this.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./face.css";
import { Droplet, JOBS, shoreVar, Bud, familyOf } from "./creature/goo";
import { Sol } from "./Sol";
import { SeatScene } from "./SeatScene";
import { ModeWheel } from "./ModeWheel";
import { SeatSwitch } from "./SeatSwitch";
import { Aurora, CellRange, Status } from "./creature/indicators";
import { EffortPill } from "./EffortPill";
import { VoiceBody, VoiceRibbon } from "./creature/Voice";

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "18px 24px", borderBottom: "1px solid #222" }} data-section={title}>
      <h2 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600, color: "#9a9a96" }}>{title}</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>{children}</div>
    </section>
  );
}

function Marks() {
  const [n, setN] = useState(0);
  return (
    <Section title="droplet: the daily mark">
      {(["running", "done", "failed", "needs"] as const).map((k) => (
        <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <Droplet kind={k} size={96} seed={k} />
          <Droplet kind={k} size={16} seed={k} />
          <span style={{ color: "#777" }}>{k}</span>
        </div>
      ))}
      <button onClick={() => setN((v) => v + 1)} style={{ background: "#222", color: "#ddd", border: 0, borderRadius: 8, padding: "6px 10px" }}>land again</button>
      <Droplet key={`d${n}`} kind="done" size={96} land />
      <Droplet key={`f${n}`} kind="failed" size={96} land />
      <Droplet key={`s${n}`} kind="done" size={16} land />
      <div className="rows" style={{ display: "flex", flexDirection: "column", gap: 6, width: 260 }}>
        {(["running", "done", "failed", "needs"] as const).map((k, i) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}><Droplet kind={k} size={16} seed={i} /><span>a step called {k}</span></div>
        ))}
      </div>
    </Section>
  );
}

function Colours() {
  return (
    <Section title="six jobs, and the ambient variation">
      {Object.entries(JOBS).map(([k, cols]) => (
        <div key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", height: 10, width: 120, borderRadius: 5, overflow: "hidden" }}>{cols.map((c) => <i key={c} style={{ flex: 1, background: c }} />)}</div>
          <span style={{ color: "#777" }}>{k}</span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        {Array.from({ length: 10 }, (_, i) => { const v = shoreVar(i); return <div key={i} style={{ width: 22, height: 22, borderRadius: 11, background: `linear-gradient(${v.angle}deg, ${v.cols.join(",")})` }} />; })}
      </div>
    </Section>
  );
}

// a fake level for the gallery: syllables, a pause now and then
const talk = () => { const t = performance.now() / 1000; return Math.max(0, Math.sin(t * 2.1) * 0.5 + Math.sin(t * 7.3) * 0.35 + 0.25); };
const X4 = ({ px, children }: { px: number; children: React.ReactNode }) => (
  <div style={{ width: px * 4, height: px * 4, display: "grid", placeItems: "center" }}><div style={{ transform: "scale(4)", transformOrigin: "center", display: "grid" }}>{children}</div></div>
);
function Voice() {
  const cell = (label: string, px: number, el: (big: boolean) => React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <X4 px={px}>{el(true)}</X4>
      <div style={{ display: "grid", placeItems: "center", width: 28, height: 28, background: "#1a1a1a", borderRadius: 6 }}>{el(false)}</div>
      <span style={{ color: "#777" }}>{label}</span>
    </div>
  );
  return (
    <Section title="voice: Sol breathes sound (call badge), the ribbon (dictation)">
      {cell("speaking, idle", 22, () => <VoiceBody kind="speaking" size={22} />)}
      {cell("speaking, talking", 22, () => <VoiceBody kind="speaking" size={22} level={talk} />)}
      {cell("listening, idle", 22, () => <VoiceBody kind="listening" size={22} />)}
      {cell("listening, talking", 22, () => <VoiceBody kind="listening" size={22} level={talk} />)}
      {cell("ribbon, idle", 20, () => <VoiceRibbon size={20} />)}
      {cell("ribbon, talking", 20, () => <VoiceRibbon size={20} level={talk} />)}
    </Section>
  );
}

function Sliders() {
  const [a, setA] = useState(850), [b, setB] = useState(40);
  return (
    <Section title="slider: liquid in a dry channel">
      <div style={{ display: "flex", flexDirection: "column", gap: 28, padding: "30px 0 0" }}>
        <div className="range" data-slider="small"><CellRange min={200} max={1500} step={50} value={a} aria-label="patience" onChange={(e) => setA(Number(e.target.value))} /><span className="val">{a} ms</span></div>
        <div className="range"><CellRange min={0} max={64} step={1} value={b} aria-label="blur" disabled onChange={(e) => setB(Number(e.target.value))} /><span className="val">disabled</span></div>
      </div>
      <div style={{ width: 640, height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div data-slider="big" style={{ transform: "scale(3)" }}><CellRange min={0} max={64} step={1} value={b} aria-label="blur big" onChange={(e) => setB(Number(e.target.value))} /></div>
      </div>
    </Section>
  );
}

function People() {
  const names = ["frank", "isaac", "marcocyl04-ux", "ada", "lin", "otto", "mira", "sven", "yuki"];
  return (
    <Section title="people: each person's agent wears their family (yours is Sol)">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}><Sol size={56} /><Sol size={14} /><span style={{ color: "#777" }}>mine</span></div>
      {names.map((n) => (
        <div key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}><Bud login={n} size={56} /><Bud login={n} size={14} /><span style={{ color: "#777" }}>{n} · {familyOf(n)}</span></div>
      ))}
      <div className="rows" style={{ display: "flex", flexDirection: "column", gap: 6, width: 260 }}>
        {names.slice(0, 3).map((n) => (<div key={n} style={{ display: "flex", alignItems: "center", gap: 8 }}><Bud login={n} size={14} /><span>{n}'s agent said a thing</span></div>))}
      </div>
    </Section>
  );
}

function Seats() {
  const [mode, setMode] = useState<"home" | "cowork">("home");
  const [seat, setSeat] = useState<"codex" | "claude">("codex");
  const flip = () => setMode((m) => (m === "home" ? "cowork" : "home"));
  return (
    <Section title="the seat: the scene over the mode pill">
      <div className="side-head" data-s style={{ width: 236, background: "var(--side)", borderRadius: 12 }}>
        <SeatScene mode={mode} />
        <ModeWheel mode={mode} onPick={setMode} />
      </div>
      <div className="seat-big" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: 300 }}>
        <SeatScene mode={mode} size={120} />
      </div>
      <button className="seat-flip" onClick={flip} style={{ background: "#222", color: "#ddd", border: 0, borderRadius: 8, padding: "6px 10px" }}>flip the mode</button>
      <div style={{ width: 180 }}><SeatSwitch seat={seat} onPick={setSeat} /></div>
    </Section>
  );
}

function Engine() {
  const [lvl, setLvl] = useState("medium");
  const states = [["up", true, undefined], ["starting", false, "starting"], ["down", false, "down"]] as const;
  return (<>
    <Section title="engine status: the eyes on a pill (1x and 4x)">
      {states.map(([k, up, ph]) => (
        <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ width: 104, height: 64, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ transform: "scale(4)", display: "inline-flex" }}><Status up={up} phase={ph} /></span></div>
          <Status up={up} phase={ph} />
          <span style={{ color: "#777" }}>{k}</span>
        </div>
      ))}
    </Section>
    <Section title="bypass sheen and the effort heat">
      <div className="picker" style={{ padding: 0 }}>
        <button className="wchip leash bypassPermissions" style={{ position: "relative", color: "#ededea" }}><Aurora /><span className="leash-w" style={{ position: "relative" }}>Bypass permissions</span></button>
        <EffortPill options={["low", "medium", "high", "xhigh", "max"]} value={lvl} onChange={setLvl} />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {["low", "medium", "high", "xhigh", "max"].map((o) => <button key={o} onClick={() => setLvl(o)} style={{ background: "#222", color: "#ddd", border: 0, borderRadius: 8, padding: "6px 10px" }}>set {o}</button>)}
      </div>
      <div className="picker" style={{ padding: 0, gap: 10 }}>
        {["low", "medium", "high", "max"].map((o) => <EffortPill key={o} options={["low", "medium", "high", "xhigh", "max"]} value={o} onChange={() => {}} />)}
      </div>
    </Section>
  </>);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Colours />
    <Marks />
    <Sliders />
    <Voice />
    <People />
    <Seats />
    <Engine />
  </StrictMode>,
);
