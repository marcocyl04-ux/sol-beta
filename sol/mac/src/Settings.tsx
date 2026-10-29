import { useEffect, useState } from "react";
import { Fold, Turn } from "./MotionKit";
import { reducedMotion } from "./motion";
import { PART_NAMES, PRESETS, setPart, setVibe, useVibe, type Part, type Prefs } from "./vibe";
import { ONE, FELL } from "./engine";
import { ENGINE, WHICH, LIVE, NEXT, FAR_NAME, pickEngine, sameEngine, keptMachines, type Effort, type EngineInfo, type Health, type Models, type Seat, type Settings as S, type GoBackPlan } from "./useEngine";
import { VOICES, VOICE_OFF, ELEVEN_VOICES, ELEVEN_DEFAULT, MAKERS } from "./voices";
import { ControlDrawers } from "./control/Control";
import { CellRange, Status } from "./creature/indicators";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useRenovation } from "./renovation";
import { applyLook, BUBBLES, LOOK_DEFAULT, SWATCHES } from "./look";
import { SettingsShell, ShellSection, Switch, useShell } from "./settingsShell";

// Mutable mode (lib.rs, hot.rs): the app's windows load Vite's dev pages, so edits to sol/mac/src appear in place.
// Only inside Sol.app; in a plain browser there is no shell to ask.
type Face = { hot: boolean; state: string };
const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
function useFace(): [Face | null, (hot: boolean) => void] {
  const [face, setFace] = useState<Face | null>(null);
  useEffect(() => {
    if (!inApp) return;
    let alive = true;
    const ask = () => invoke<Face>("face_state").then((f) => { if (alive) setFace(f); }).catch(() => {});
    void ask();
    const un = listen<Face>("face-state", (e) => setFace(e.payload));
    const t = window.setInterval(ask, 2000);
    return () => { alive = false; window.clearInterval(t); void un.then((f) => f()); };
  }, []);
  const set = (hot: boolean) => { setFace((f) => (f ? { ...f, hot, state: hot ? "starting" : "bundled" } : f)); void invoke<Face>("face_mode", { hot }).catch(() => {}); };
  return [face, set];
}

// one part of vibe mode (vibe.ts Prefs): on, follows the music, size, brightness, colours (a preset or its own swatches)
function PartRows({ k, p }: { k: keyof Prefs; p: Part }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const preset = Object.keys(PRESETS).find((n) => PRESETS[n].join() === p.colours.join()) ?? "own";
  return (
    <div className="vpart">
      <p className="vpart-h">{PART_NAMES[k]}</p>
      <div className="field-r">
        <div className="lab"><span>shown</span></div>
        <Switch on={p.on} label={`${PART_NAMES[k]} shown`} set={(v) => setPart(k, { on: v })} />
      </div>
      <div className="field-r">
        <div className="lab"><span>follows the music</span><small>{k === "ring" ? "turns faster and swells on the beat" : "widens and brightens with what is playing"}</small></div>
        <Switch on={p.music} label={`${PART_NAMES[k]} follows the music`} set={(v) => setPart(k, { music: v })} />
      </div>
      <div className="field-r">
        <div className="lab"><span>size</span></div>
        <div className="range">
          <CellRange min={50} max={200} step={10} value={Math.round(p.size * 100)} aria-label="size" onChange={(ev) => setPart(k, { size: Number(ev.target.value) / 100 })} />
          <span className="val">{pct(p.size)}</span>
        </div>
      </div>
      <div className="field-r">
        <div className="lab"><span>brightness</span></div>
        <div className="range">
          <CellRange min={5} max={100} step={5} value={Math.round(p.bright * 100)} aria-label="brightness" onChange={(ev) => setPart(k, { bright: Number(ev.target.value) / 100 })} />
          <span className="val">{pct(p.bright)}</span>
        </div>
      </div>
      <div className="field-r">
        <div className="lab"><span>colours</span></div>
        <Pick value={preset} options={[...Object.keys(PRESETS).map((n): [string, string] => [n, n]), ["own", "my own"]]}
          onChange={(v) => { if (PRESETS[v]) setPart(k, { colours: PRESETS[v] }); }} />
      </div>
      <div className="swatches" aria-label="colours">
        {p.colours.map((c, i) => (
          <span key={i} className="swatch" style={{ background: c }} title={c}>
            <input type="color" value={c} aria-label={`colour ${i + 1}`} onChange={(ev) => { const n = [...p.colours]; n[i] = ev.target.value; setPart(k, { colours: n }); }} />
            {p.colours.length > 2 && <button className="x" aria-label="remove this colour" onClick={() => setPart(k, { colours: p.colours.filter((_, j) => j !== i) })}>×</button>}
          </span>
        ))}
        {p.colours.length < 8 && <button className="swatch add" aria-label="add a colour" onClick={() => setPart(k, { colours: [...p.colours, p.colours[0]] })}>+</button>}
      </div>
    </div>
  );
}

// the music drawer's line: what vibe mode is doing, or why it is not (vibe.ts)
function vibeHint(v: ReturnType<typeof useVibe>): string {
  if (!inApp) return "only inside Sol.app";
  if (reducedMotion()) return "off while the Mac asks for reduced motion";
  if (v.error) return v.error;
  if (!v.want) return "macOS asks once to let Sol hear this Mac's sound; nothing is recorded";
  if (!v.up) return "starting…";
  if (v.playing) return "hearing it";
  return "hearing nothing: play something. If macOS was told no, allow Sol under Privacy & Security › Screen & System Audio Recording";
}

// Takes the place of the talk and the box. One drawer open at a time; the height animates with a grid row.
export function Drawer({ name, open, onToggle, children }: { name: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  if (useShell()) return <ShellSection name={name}>{children}</ShellSection>;   // in Settings: one section of the rail, drawn when picked
  return (
    <section className={`drawer ${open ? "open" : ""}`}>
      <button className="drawer-h" onClick={onToggle} aria-expanded={open}>
        <span>{name}</span>
        <Turn to={open ? 180 : 0} cfg={{ k: 360, z: 0.5 }}><svg className="chev" viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><path d="M1 2.5 4 5.5 7 2.5" fill="none" stroke="currentColor" strokeWidth="1" /></svg></Turn>
      </button>
      <Fold open={open} from={{ y: 14 }} gap={40}>{children}</Fold>
    </section>
  );
}

export function Pick({ value, options, onChange, disabled }: { value: string; options: [string, string][]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <span className="pick">
      <select value={value} disabled={disabled} onChange={(ev) => onChange(ev.target.value)}>
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      <svg className="chev" viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><path d="M1 2.5 4 5.5 7 2.5" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
    </span>
  );
}

const LANGS: [string, string][] = [["follow", "follow Marco"], ["english", "English"], ["cantonese", "Cantonese"], ["dutch", "Dutch"]];

function uptime(since?: string, now = Date.now()) {
  const t = since ? Date.parse(since) : NaN;
  if (!isFinite(t)) return "";
  const m = Math.max(0, Math.floor((now - t) / 60000));
  return m < 1 ? "just started" : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}

// What the engine starts with (engine/src/settings.ts DEFAULTS), for an engine too old to send its own:
// shown read-only, so the page is honest about what is in force without pretending a change would land.
// the Work modes' names, as the composer says them (#94)
const MODE_NAMES: [string, string][] = [["auto", "auto"], ["default", "manual: ask for each"], ["acceptEdits", "accept edits"], ["plan", "plan"], ["bypassPermissions", "bypass permissions"]];
export const FALLBACK: S = {
  voice: "Kore", patienceMs: 600, language: "follow",
  defaults: { seat: "codex", model: { codex: "gpt-6.1-sol", claude: "claude-opus-5-5" }, effort: { codex: "medium", claude: "medium" }, mode: "default" },
  look: LOOK_DEFAULT,
};

// The look (mine/look/SPEC.md): the base colour, how much of the desktop shows through, the blur behind, and his bubble.
// A slider shows live while it drags (applyLook on the root) and tells the engine once, at the end, like patience.
export function LookDrawer({ s, off, onSet, open, onToggle }: { s: S; off: boolean; onSet: (patch: object) => void; open: boolean; onToggle: () => void }) {
  const look = s.look ?? LOOK_DEFAULT;
  const [live, setLive] = useState<{ alpha?: number; blur?: number; text?: number }>({});
  const alpha = live.alpha ?? look.alpha, blur = live.blur ?? look.blur, text = live.text ?? look.text ?? LOOK_DEFAULT.text;
  const drag = (k: "alpha" | "blur" | "text", v: number) => { setLive((l) => ({ ...l, [k]: v })); applyLook({ ...look, ...live, [k]: v }); };
  const drop = (k: "alpha" | "blur" | "text") => { if (live[k] !== undefined) { onSet({ look: { [k]: live[k] } }); setLive((l) => ({ ...l, [k]: undefined })); } };
  const custom = !SWATCHES.some(([c]) => c === look.color);
  return (
    <Drawer name="look" open={open} onToggle={onToggle}>
      <div className="field-r">
        <div className="lab"><span>base</span><small>the window's colour, over the desktop</small></div>
        <div className="swatches">
          {SWATCHES.map(([c, name]) => (
            <button key={c} className={`swatch ${look.color === c ? "on" : ""}`} style={{ background: c }} title={name} aria-label={name} disabled={off}
              onClick={() => onSet({ look: { color: c } })} />
          ))}
          <label className={`swatch any ${custom ? "on" : ""}`} title="any colour" style={custom ? { background: look.color } : undefined}>
            <input type="color" value={look.color} disabled={off} onChange={(ev) => onSet({ look: { color: ev.target.value } })} />
          </label>
        </div>
      </div>
      <div className="field-r">
        <div className="lab"><span>opacity</span><small>how much of the desktop shows through</small></div>
        <div className="range">
          <CellRange min={50} max={100} step={1} value={Math.round(alpha * 100)} aria-label="opacity" disabled={off}
            onChange={(ev) => drag("alpha", Number(ev.target.value) / 100)} onPointerUp={() => drop("alpha")} onKeyUp={() => drop("alpha")} />
          <span className="val">{alpha.toFixed(2)}</span>
        </div>
      </div>
      <div className="field-r">
        <div className="lab"><span>blur</span><small>of the desktop behind</small></div>
        <div className="range">
          <CellRange min={0} max={64} step={1} value={blur} aria-label="blur" disabled={off}
            onChange={(ev) => drag("blur", Number(ev.target.value))} onPointerUp={() => drop("blur")} onKeyUp={() => drop("blur")} />
          <span className="val">{blur} px</span>
        </div>
      </div>
      <div className="field-r">
        <div className="lab"><span>text</span><small>the chat's words alone; nothing around them grows</small></div>
        <div className="range">
          <CellRange min={12} max={24} step={1} value={text} aria-label="text size" disabled={off}
            onChange={(ev) => drag("text", Number(ev.target.value))} onPointerUp={() => drop("text")} onKeyUp={() => drop("text")} />
          <span className="val">{text} px</span>
        </div>
      </div>
      <div className="field-r bubbles">
        <div className="lab"><span>your bubble</span><small>a cosmetic pick; the seat's colour stays the one hue</small></div>
        <div className="pair">
          {BUBBLES.map(([k, name]) => (
            <button key={k} className={`bpill ${look.bubble === k ? "on" : ""}`} disabled={off} onClick={() => onSet({ look: { bubble: k } })}>{name}</button>
          ))}
        </div>
      </div>
      <div className="bpreview" data-bubble={look.bubble}>
        <div className="me-row"><div className="msg me">this is how your words will look.</div></div>
      </div>
    </Drawer>
  );
}

// The call's maker and ElevenLabs voice (#24), and the maker that carries a call now ("auto" resolved, the engine's
// read-only voiceNow); absent on an older engine. Read here, not added to useEngine's Settings (on the fence).
type Voiced = S & { voiceVendor?: "auto" | "gemini" | "elevenlabs"; elevenVoice?: string; voiceNow?: "gemini" | "elevenlabs" };

// The way out, where every pane closes: the top right, under the bar. Escape is the same door: both apps' window
// listeners already close a view that is not the chat, after a menu or a pane's own key has had its turn.
function Shut({ onClose }: { onClose: () => void }) {
  return <button className="barbtn settings-x" onClick={onClose} title="close (esc)" aria-label="close settings">×</button>;
}

export function Settings({ s: real, stale, info, up, health = null, goBack = null, send, models, efforts, sampling, onSet, onHear, first = "voice", more, onClose }: {
  s: S | null; stale: boolean; info: EngineInfo | null; up: boolean; health?: Health | null; models: Models; efforts: Effort[]; sampling: boolean;
  goBack?: GoBackPlan | null; send?: (o: object) => void;   // the Go back row (#18): what a click would do, and the wire to ask
  onSet: (patch: object) => void; onHear: (voice: string) => void;
  first?: string;   // the drawer open at first
  more?: (open: string, toggle: (n: string) => void) => React.ReactNode;   // Work's own drawers, after the shared ones
  onClose: () => void;   // back to the chat
}) {
  const [open, setOpen] = useState(up ? first : "engine");
  const note = useRenovation().note;   // a compile or page error with no part to show it in (issue #15)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [now, setNow] = useState(Date.now());
  const [patience, setPatience] = useState<number | null>(null); // while dragging, so the engine is told once
  const [face, setFace] = useFace();
  const vb = useVibe();

  const look = () => navigator.mediaDevices?.enumerateDevices().then((d) => setMics(d.filter((x) => x.kind === "audioinput"))).catch(() => {});
  useEffect(() => {
    void look();
    navigator.mediaDevices?.addEventListener("devicechange", look);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", look);
  }, []);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  // names only show once the window has had the microphone; ask once, let go at once
  const allow = async () => {
    try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); } catch { /* denied: the list stays as it is */ }
    void look();
  };

  // in the shell a section is picked, never closed: toggle is the drawers' old word for "open this one"
  const toggle = (n: string) => setOpen(n);
  // Sol held while settings are up (SeatScene.tsx, the vibe switch): the music drawer opens here, nothing else is redrawn
  useEffect(() => {
    const f = () => setOpen("music");
    // and a drawer asked for by name (#342, sol:settings: the join card's "sign in" opens "me")
    const named = (ev: Event) => { const d = (ev as CustomEvent).detail; if (typeof d === "string") setOpen(d); };
    window.addEventListener("sol-vibe-edit", f);
    window.addEventListener("sol:settings", named);
    return () => { window.removeEventListener("sol-vibe-edit", f); window.removeEventListener("sol:settings", named); };
  }, []);
  // the Go back row asks the engine what one step back would do, each time the drawer opens with the engine up
  useEffect(() => { if (open === "engine" && up && send) send({ type: "goback.plan" }); }, [open, up, send]);
  const [sure, setSure] = useState(false);   // go back asks once more: it ends what is running
  useEffect(() => { if (!sure) return; const t = window.setTimeout(() => setSure(false), 8000); return () => window.clearTimeout(t); }, [sure]);
  // which Sol: my machines (Control, the copy this window keeps), or the old two when the list is empty
  // one Sol (#62) comes first: the NucBox, this Mac when it does not answer; the rest are pins
  const which = (() => {
    const ONE_OPT: [string, string] = ["one", FELL ? `one Sol (on this Mac until ${FAR_NAME} answers)` : `one Sol: ${FAR_NAME}, this Mac as backup`];
    const list = keptMachines() ?? [];
    if (!list.length) return { value: ONE ? "one" : WHICH as string, options: [ONE_OPT, ["next", "this Mac only"], ["live", `${FAR_NAME} only`]] as [string, string][] };
    const options = list.map((m): [string, string] => [m.url, m.name]);
    const at = list.find((m) => sameEngine(m.url, ENGINE));
    if (!at) options.unshift([ENGINE, sameEngine(ENGINE, NEXT) ? "next, this Mac" : sameEngine(ENGINE, LIVE) ? `live, ${FAR_NAME}` : ENGINE]);
    options.unshift(ONE_OPT);
    return { value: ONE ? "one" : at?.url ?? ENGINE, options };
  })();
  // the line HELP.md gives: ~/Sol is where the install puts a tester's Sol; a Sol cloned by hand lives where it was put
  const BACK_LINE = "bash ~/Sol/sol/back";
  const [copied, setCopied] = useState(false);
  const copyBack = () => { void navigator.clipboard?.writeText(BACK_LINE).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }); };
  // the engine drawer, the one part that must work with the engine down (#16 blocker 6): status, which engine, the
  // face, the address, the last error; the controls that need the engine wait for it
  const engineDrawer = (
    <Drawer name="engine" open={open === "engine"} onToggle={() => toggle("engine")}>
      <dl className="facts">
        <dt>status</dt><dd><Status up={up} />{up ? "up" : "down"}{up && info?.since ? `, ${uptime(info.since, now)}` : ""}{!up && health?.reverted?.what === "engine" ? `; went back to its last good build at ${new Date(health.reverted.at).toLocaleTimeString()}` : ""}</dd>
        <dt>which</dt><dd><Pick value={which.value} options={which.options} onChange={(v) => pickEngine(v)} /></dd>
        {face && <><dt>face</dt><dd><Pick value={face.hot ? "hot" : "bundled"} options={[["bundled", "bundled"], ["hot", "hot, edits appear live"]]} onChange={(v) => setFace(v === "hot")} /></dd>
          <dt /><dd className={`face-state ${face.state === "hot" ? "hot" : face.state === "dev server down" ? "down" : ""}`}>{face.state}</dd></>}
        <dt>address</dt><dd className="mono">{ENGINE}</dd>
        {health && <><dt>kept</dt><dd>{health.kept ? "by its keeper" : "not by its keeper"}{health.build ? `; build watcher ${health.build.alive ? "alive" : "dead"}${health.build.errors ? `, ${health.build.errors} error${health.build.errors > 1 ? "s" : ""}` : ""}` : ""}</dd></>}
        {up && send && <><dt>go back</dt><dd className="goback">
          {!sure
            ? <button className="stop" disabled={!goBack || (!goBack.engine && !goBack.face)} onClick={() => setSure(true)}>go back</button>
            : <button className="stop sure" onClick={() => { setSure(false); send({ type: "goback" }); }}>yes, go back now</button>}
          <span className="goback-line">{goBack ? goBack.line : "…"}</span></dd></>}
        {!up && <><dt>if it stays down</dt><dd><ol className="help-steps">
          <li>wait a minute: the keeper restarts it, and after three bad starts puts the last good build back by itself</li>
          <li>or pick the other engine above and keep working there</li>
          <li>still down after two minutes: press Cmd-Space, type Terminal, and paste this line
            <code className="mono">{BACK_LINE}</code>
            <button className="link" onClick={copyBack}>{copied ? "copied" : "copy"}</button>
            <span>it puts the last good build back, takes back the face's last change, starts the engine again, and says what it did (~/Sol is where the install put Sol; a Sol you cloned yourself: that folder instead)</span></li>
          <li>Sol.app itself will not open: the same line, then open Sol again</li>
          <li>none of it helps: say so in the beta testers' Discord (Tell us… in the menu bar) with the end of ~/Library/Logs/sol-engine.log; or Claude Code in Sol's folder, "Sol is down, read sol/HELP.md"</li>
        </ol></dd></>}
        {health?.reverted && <><dt>last take-back</dt><dd title={health.reverted.line}>{health.reverted.what === "engine" ? "the engine's last good build" : "a face edit"}, {new Date(health.reverted.at).toLocaleTimeString()}{health.reverted.line ? `: ${health.reverted.line}` : ""}</dd></>}
        <dt>voice key</dt><dd>{info ? `${(real as Voiced | null)?.voiceNow === "elevenlabs" ? "ElevenLabs" : "Gemini"}, ${info.haveVoiceKey ? "set" : "not set"}` : "–"}</dd>
        <dt>dictation</dt><dd>{info?.dictationModel || "–"}</dd>
        {note && <><dt>last error</dt><dd className="mono" title={note}>{note}</dd></>}
      </dl>
    </Drawer>
  );
  if (!up || (!real && !stale)) {
    return (
      <SettingsShell open="engine" setOpen={setOpen} peek={{ engine: <i className={`sdot ${up ? "up" : "down"}`} /> }}
        top={<><Shut onClose={onClose} /><p className="hint-line top stale">{up ? "loading…" : "the engine is down; it comes back by itself under its keeper, or pick the other one"}</p></>}>
        {engineDrawer}
      </SettingsShell>
    );
  }
  // no settings from this engine: its defaults, every control disabled until real ones arrive
  const off = !real;
  const seatDefault = (k: Seat) => models.seats.find((x) => x.seat === k)?.default;
  const s: S = real ?? { ...FALLBACK, defaults: { ...FALLBACK.defaults,
    model: { codex: seatDefault("codex") ?? FALLBACK.defaults.model.codex, claude: seatDefault("claude") ?? FALLBACK.defaults.model.claude } } };
  const named = mics.some((m) => m.label);
  const seatModels = (k: Seat) => models.seats.find((x) => x.seat === k)?.models ?? [];
  const patience_ = patience ?? s.patienceMs;
  // ElevenLabs carries the call (#24): its voices stand in for Gemini's; "off" stays first
  const sv = s as Voiced;
  const eleven = sv.voiceNow === "elevenlabs";
  const elevenNow = sv.elevenVoice ?? ELEVEN_DEFAULT;
  const cards: [string, string, string][] = eleven
    ? [[VOICE_OFF, VOICE_OFF, VOICES[0][1]], ...ELEVEN_VOICES]
    : VOICES.map(([name, word]): [string, string, string] => [name, name, word]);
  const cardOn = (id: string) => eleven ? (id === VOICE_OFF ? s.voice === VOICE_OFF : s.voice !== VOICE_OFF && elevenNow === id) : s.voice === id;
  const pickCard = (id: string) => onSet(!eleven || id === VOICE_OFF ? { voice: id }
    : { elevenVoice: id, ...(s.voice === VOICE_OFF ? { voice: FALLBACK.voice } : {}) });

  // what each section is set to now, as a word or a mark beside it in the rail
  const seatNow = s.defaults.seat ?? "codex";
  const micNow = s.mic ? mics.find((m) => m.deviceId === s.mic)?.label : "";
  const peek: Record<string, React.ReactNode> = {
    voice: s.voice === VOICE_OFF ? "off" : eleven ? (ELEVEN_VOICES.find((v) => v[0] === elevenNow)?.[1] ?? "eleven").toLowerCase() : s.voice.toLowerCase(),
    microphone: micNow ? micNow.replace(/\s*\(.*\)$/, "").slice(0, 14) : "default",
    defaults: (s.defaults.model[seatNow] ?? "").replace(/^claude-/, "").replace(/^gpt-/, "gpt "),
    look: <i className="sdot swatch-peek" style={{ background: s.look?.color ?? LOOK_DEFAULT.color }} />,
    music: vb.want ? "on" : "off",
    engine: <i className={`sdot ${up ? "up" : "down"}`} />,
  };

  return (
    <SettingsShell open={open} setOpen={setOpen} peek={peek}
      top={<><Shut onClose={onClose} />{off && <p className="hint-line top stale">the engine is older than this window; restart it to change these</p>}</>}>
      <div className={off ? "settings-off" : ""} style={{ display: "contents" }}>
        <ControlDrawers open={open} toggle={toggle} onSet={onSet} />
        <Drawer name="voice" open={open === "voice"} onToggle={() => toggle("voice")}>
          <div className="field-r">
            <div className="lab"><span>maker</span><small>who hears and talks on a call</small></div>
            <Pick value={sv.voiceVendor ?? "auto"} options={MAKERS} disabled={off || !sv.voiceVendor} onChange={(v) => onSet({ voiceVendor: v })} />
          </div>
          <div className="voices">
            {cards.map(([id, name, word]) => {
              const on = cardOn(id);
              return (
                <div key={id} className={`vcard ${on ? "on" : ""}`} role="button" tabIndex={off ? -1 : 0} aria-disabled={off}
                  onClick={() => { if (!off) pickCard(id); }}
                  onKeyDown={(ev) => { if (!off && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); pickCard(id); } }}>
                  <b>{name.toLowerCase()}</b>
                  <span>{word}</span>
                  {on && name !== VOICE_OFF && (
                    <button className={`hear ${sampling ? "playing" : ""}`} disabled={off || sampling || !up} onClick={(ev) => { ev.stopPropagation(); onHear(eleven ? id : name); }}
                      title="a real sample in this voice">{sampling ? "playing…" : "hear it"}</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="field-r">
            <div className="lab"><span>patience</span><small>how long a pause before it answers</small></div>
            <div className="range">
              <CellRange min={200} max={1500} step={50} value={patience_} aria-label="patience" disabled={off}
                onChange={(ev) => setPatience(Number(ev.target.value))}
                onPointerUp={() => { if (patience !== null) { onSet({ patienceMs: patience }); setPatience(null); } }}
                onKeyUp={() => { if (patience !== null) { onSet({ patienceMs: patience }); setPatience(null); } }} />
              <span className="val">{patience_} ms</span>
            </div>
          </div>
          <div className="field-r">
            <div className="lab"><span>language</span></div>
            <Pick value={s.language} options={LANGS} disabled={off} onChange={(v) => onSet({ language: v })} />
          </div>
        </Drawer>

        <Drawer name="microphone" open={open === "microphone"} onToggle={() => toggle("microphone")}>
          <div className="field-r">
            <div className="lab"><span>input</span></div>
            <Pick value={s.mic && mics.some((m) => m.deviceId === s.mic) ? s.mic : ""}
              options={[["", "system default"], ...mics.filter((m) => m.deviceId && m.deviceId !== "default").map((m, i): [string, string] => [m.deviceId, m.label || `microphone ${i + 1}`])]}
              onChange={(v) => onSet({ mic: v || null })} disabled={off} />
          </div>
          {!named && mics.length > 0 && <p className="hint-line">names appear once Sol is allowed the microphone. <button className="link" onClick={allow}>allow</button></p>}
          <p className="hint-line">hold the mic to talk, tap to toggle</p>
        </Drawer>

        <Drawer name="music" open={open === "music"} onToggle={() => toggle("music")}>
          <div className="field-r">
            <div className="lab"><span>vibe mode</span><small>Sol's colours round the screen and the chat box, moving with what this Mac plays</small></div>
            <Switch on={vb.want} label="vibe mode" disabled={!inApp || reducedMotion()} set={setVibe} />
          </div>
          <p className="hint-line">{vibeHint(vb)}</p>
          {(["screen", "frame", "ring"] as (keyof Prefs)[]).map((k) => <PartRows key={k} k={k} p={vb.prefs[k]} />)}
        </Drawer>

        <Drawer name="defaults" open={open === "defaults"} onToggle={() => toggle("defaults")}>
          <p className="hint-line top">for new conversations only; an open one keeps its own. Who answers a new chat is in my accounts</p>
          {(["codex", "claude"] as Seat[]).map((k) => (
            <div className="field-r" key={k}>
              <div className="lab"><span>{k}</span></div>
              <div className="pair">
                <Pick value={s.defaults.model[k]} options={(seatModels(k).length ? seatModels(k) : [s.defaults.model[k]]).map((m): [string, string] => [m, m])}
                  onChange={(v) => onSet({ defaults: { model: { [k]: v } } })} disabled={off} />
                <Pick value={s.defaults.effort[k]} options={efforts.map((e): [string, string] => [e, e])}
                  onChange={(v) => onSet({ defaults: { effort: { [k]: v } } })} disabled={off} />
              </div>
            </div>
          ))}
          <div className="field-r">
            <div className="lab"><span>work may</span></div>
            <Pick value={s.defaults.mode} options={MODE_NAMES}
              onChange={(v) => onSet({ defaults: { mode: v } })} disabled={off} />
          </div>
          <p className="hint-line">what Claude does without asking in a session, and in every session a card starts</p>
        </Drawer>

        <LookDrawer s={s} off={off} onSet={onSet} open={open === "look"} onToggle={() => toggle("look")} />
        {engineDrawer}
        {more?.(open, toggle)}
      </div>
    </SettingsShell>
  );
}
