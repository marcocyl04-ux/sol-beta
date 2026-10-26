import { useCallback, useRef, useState } from "react";
import { SeatSwitch } from "./SeatSwitch";
import { Swap } from "./MotionKit";
import { Status, VoiceArms } from "./creature/indicators";
import { forcedState } from "./creature/state";
import type { Effort, Health, Part, Seat, SeatInfo } from "./useEngine";
import { prettyModel } from "./models";
import { Menu, type MenuItem } from "./work/Menu";
import { EffortPill } from "./EffortPill";

// The model pill (mine/look/SITTING-5-model.md): the friendly name alone, the id in its title; a click opens a Sol menu above it,
// the same `.menu` as the mode menu (work/Menu.tsx), with only the toggled seat's models under a small-caps head naming the
// seat, each row the friendly name and the id at its right, the current one ticked. Switching seats is the seat switch's business.
function ModelPill({ options, value, onChange, label, seatName, seat }: {
  options: string[]; value?: string; onChange: (v: string) => void; label: string; seatName: string; seat: Seat;
}) {
  const i = Math.max(0, options.indexOf(value ?? ""));
  const prev = useRef(i);
  const dirOf = (k: number) => { const d = k >= prev.current ? 1 : -1; prev.current = k; return d as 1 | -1; };
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const closing = useRef(false);   // a press on the pill while the menu is open: the menu's own outside-press closes it, and the click that follows must not reopen it
  const items: MenuItem[] = [
    { head: seatName },
    ...options.map((m) => ({ label: prettyModel(m, seat), meta: m, on: m === value, run: () => onChange(m) })),
  ];
  return (
    <div className="slider" title={value ? `${label}: ${value}` : label}>
      <button type="button" className="name list" aria-haspopup="listbox" aria-expanded={!!menu} aria-label={`${label}: ${value ? prettyModel(value, seat) : "–"}`}
        onMouseDown={() => { closing.current = !!menu; }}
        onClick={(ev) => { if (closing.current) { closing.current = false; return; } const r = ev.currentTarget.parentElement!.getBoundingClientRect(); setMenu({ x: r.left, y: r.top - 6 }); }}>
        <Swap k={value ?? "–"} className="val" dist={14} dir={dirOf(i)}><span>{value ? prettyModel(value, seat) : "–"}</span></Swap>
      </button>
      {menu && options.length > 0 && <Menu x={menu.x} y={menu.y} items={items} onClose={close} up box scroll={options.length > 8} />}
    </div>
  );
}

const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const tones = ["var(--ink)", "var(--dim)", "var(--mute)", "var(--line)"];

function Card({ context, win, parts }: { context: number; win: number; parts?: Part[] }) {
  const list: Part[] = parts?.length ? parts : [
    { name: "this conversation", tokens: context }, { name: "free", tokens: Math.max(0, win - context) },
  ];
  const total = list.reduce((a, p) => a + p.tokens, 0) || 1;
  return (
    <div className="card">
      <div className="card-h"><span>context</span><span>{short(win)} window</span></div>
      <div className="split">
        {list.map((p, k) => <i key={p.name} style={{ width: `${(p.tokens / total) * 100}%`, background: tones[Math.min(k, 3)] }} />)}
      </div>
      {list.map((p, k) => (
        <div className="card-r" key={p.name}>
          <i style={{ background: tones[Math.min(k, 3)] }} />
          <span>{p.name}</span><b>{short(p.tokens)}</b>
        </div>
      ))}
      <div className="card-f">{context.toLocaleString()} of {win.toLocaleString()}</div>
    </div>
  );
}

// four cells beside the engine's mark (engine/src/health.ts): kept, build, face, last put back. A full cell is fine, a
// hollow one is off or nothing to say (a cold face, no watcher on this machine, nothing put back), red only when wrong.
const ago = (at: string) => { const m = Math.round((Date.now() - Date.parse(at)) / 60_000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
function Dots({ h }: { h: Health }) {
  const b = h.build;
  const dots: [string, "on" | "off" | "wrong", string][] = [
    ["kept", h.kept ? "on" : "wrong", h.kept ? "kept: the keeper restarts it and goes back to the last good build" : "not kept: the engine runs without its keeper"],
    ["build", !b ? "off" : !b.alive || (b.errors ?? 0) > 0 ? "wrong" : "on",
      !b ? "build: no watcher on this machine" : !b.alive ? "build: the watcher is stopped, edits do not go live" : (b.errors ?? 0) > 0 ? `build: ${b.errors} error${b.errors === 1 ? "" : "s"} in the last pass, the engine keeps the build before` : "build: watching, 0 errors"],
    ["face", h.face ? "on" : "off", h.face ? "face: hot on localhost:1420, edits show live" : "face: cold, the bundled build"],
    ["reverted", h.reverted ? "on" : "off", h.reverted ? `put back ${ago(h.reverted.at)}: ${h.reverted.what === "engine" ? "the engine went to its last good build" : h.reverted.line ? `face, ${h.reverted.line}` : "a face edit"}` : "nothing put back since the engine started"],
  ];
  return <span className="health">{dots.map(([k, st, t]) => <i key={k} className={st} title={t} />)}</span>;
}

const Mic = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="1.5" width="4" height="8" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" />
  </svg>
);

export function Picker({ seat, info, model, effort, efforts, up, health, context, win, parts, rec, notice, locked,
  onSeat, onModel, onEffort, onMicDown, onMicUp, noSeat, children }: {
  noSeat?: boolean; children?: React.ReactNode; // the mode lives in the side now; Work puts its own controls in
  seat: Seat; info?: SeatInfo; seats: SeatInfo[]; model?: string; effort: Effort; efforts: Effort[]; locked?: boolean;
  up: boolean; health?: Health | null; context: number; win: number; parts?: Part[]; rec: boolean; notice: string;
  onSeat: (s: Seat) => void; onModel: (m: string) => void; onEffort: (e: Effort) => void;
  onSeatModel?: (s: Seat, m: string) => void;   // kept for the callers; the list shows one seat's models now, the seat switch does the rest (sitting 5)
  onMicDown: () => void; onMicUp: () => void;   // the call is a button on the rail (buttons/call.tsx)
}) {
  const fill = Math.min(1, context / (win || 1));
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const label = (s: SeatInfo) => s.label ?? s.seat;
  const models = info?.models ?? [];
  return (
    <>
      <div className="picker">
        {!noSeat && <SeatSwitch seat={seat} locked={locked} onPick={onSeat}
          title={locked ? `this conversation lives on ${info ? label(info) : seat}${info?.via ? ` (via ${info.via})` : ""}; a new conversation (cmd+N) can be on the other seat` : `${info?.via ? `via ${info.via}. ` : ""}switching starts a new conversation`} />}
        <ModelPill options={models} value={model} onChange={onModel} label="model" seatName={info ? label(info) : seat} seat={seat} />
        <EffortPill options={efforts} value={effort} onChange={(v) => onEffort(v as Effort)} label="effort" />
        {children}
        <span className="grow" />
        <button className={`icon ${rec ? "rec" : ""}`} onPointerDown={onMicDown} onPointerUp={onMicUp} title="dictate (click, or hold)">
          {rec || forcedState === "listening" ? <VoiceArms /> : <Mic />}
        </button>
        {up && health && <Dots h={health} />}
        <div className="state">
          <svg className="ring" viewBox="0 0 14 14" aria-hidden="true">
            <circle cx="7" cy="7" r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
            <circle cx="7" cy="7" r={r} fill="none" stroke="var(--ink)" strokeWidth="2"
              strokeDasharray={`${c * fill} ${c}`} transform="rotate(-90 7 7)" />
          </svg>
          <Status up={up} />
          <Card context={context} win={win} parts={parts} />
        </div>
      </div>
      {notice && <div className="notice">{notice}</div>}
    </>
  );
}
