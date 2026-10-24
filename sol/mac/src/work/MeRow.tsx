// The row under one of Marco's messages (#51), as the Claude app draws it: when it was said, one tick while it waits
// and two once Claude has it, copy, fork from here; under a queued one also read now and drop. Shown on hover, so the
// talk stays clean; a queued message wears it all the time, that is its state.
import { useState } from "react";
import { useNow } from "./Elapsed";
import type { Item, Work } from "./useWork";

const HOUR = 3600_000;
export const when = (at: number, now: number) => {
  const d = now - at;
  if (d < 60_000) return "just now";
  if (d < HOUR) return `${Math.floor(d / 60_000)}m ago`;
  const t = new Date(at);
  const today = new Date(now).toDateString() === t.toDateString();
  return t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + (today ? "" : ` · ${t.toLocaleDateString([], { day: "numeric", month: "short" })}`);
};

const I = { width: 12, height: 12, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const Ico = {
  copy: <svg {...I}><rect x="4.5" y="4.5" width="7.5" height="7.5" rx="1.2" /><path d="M9.5 4.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5" /></svg>,
  fork: <svg {...I}><circle cx="3.5" cy="3" r="1.3" /><circle cx="10.5" cy="3" r="1.3" /><circle cx="7" cy="11" r="1.3" /><path d="M3.5 4.3C3.5 7 7 6.5 7 9.7M10.5 4.3C10.5 7 7 6.5 7 9.7" /></svg>,
};

export function MeRow({ it, w, busy }: { it: Item; w: Work; busy: boolean }) {
  const at = typeof it.at === "number" ? it.at : 0;
  const now = useNow(at > 0 && Date.now() - at < HOUR);
  const [copied, setCopied] = useState(false);
  const queued = !!it.queued;
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(it.text ?? "")); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* no clipboard here */ }
  };
  return (
    <div className="merow" role="toolbar" aria-label="this message">
      {at > 0 && <span className="mwhen" title={new Date(at).toLocaleString()}>{when(at, now)}</span>}
      <span className={`mticks ${queued ? "one" : "two"}`} title={queued ? "sent: Claude reads it after this turn, or now" : "Claude has it"}>{queued ? "✓" : "✓✓"}</span>
      {queued && w.live && <button className="mnow" onClick={() => w.readNow(w.live!, it.id)} title="Claude reads it at its next step, inside this turn">read now</button>}
      {queued && w.live && <button onClick={() => w.drop(w.live!, it.id)} title="forget it: Claude never sees it">drop</button>}
      <button onClick={() => void copy()} title="copy the text">{copied ? <span className="mdone">copied</span> : Ico.copy}</button>
      {!busy && w.live && <button onClick={() => w.fork(w.live!, it.id)} title="a new session with the talk up to here">{Ico.fork}</button>}
    </div>
  );
}
