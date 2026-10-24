// One Sol (#62): the watch that moves a window between the NucBox and this Mac under the "one" pick (engine.ts).
// On the NucBox: its socket down for FALL_MS of the page being awake means fall to this Mac. A gap in the tick (the Mac
// slept, or a hidden page's timers ran late) starts the count again, so the socket's own wake check (socket.ts) gets
// its go first. On this Mac: a second socket keeps asking the NucBox; up without a break for riseMs(), and this Mac's engine
// letting go (POST /letgo: granted only while nothing is live there, and then it starts nothing new for a moment), or
// not answering at all, means go back. A turn on this Mac is never cut off, nor started in the gap before the reload.
// One watch per page, whoever asks; the line under the composer (EngineBack.tsx) reads it.
import { useEffect, useState } from "react";
import { link } from "./socket";
import { ENGINE, ENGINE_HTTP, FELL, LIVE, ONE, fall, falls, rise } from "./engine";

const WORDS: Record<string, string> = { life: "a chat turn", work: "a session turn", call: "a call", run: "a run cell", try: "a try", review: "a review", term: "a terminal" };
const FALL_MS = 12_000, TICK_MS = 1000, GAP_MS = 5000, ASK_MS = 3000;
// how long the NucBox answers without a break before Sol goes back: 3 min after the first fall of the hour, doubled for
// each further one, at most 30 min (engine.ts counts the falls)
export const riseMs = () => Math.min(3 * 60_000 * 2 ** Math.max(0, falls() - 1), 30 * 60_000);

export type OneState = { fell: boolean; down: boolean; held: string[] };   // held: what keeps this Mac from letting go
let state: OneState = { fell: FELL, down: false, held: [] };
const subs = new Set<(s: OneState) => void>();
const set = (s: Partial<OneState>) => { state = { ...state, ...s }; for (const f of [...subs]) f(state); };
let started = false;

function watch() {
  if (started || !ONE) return;
  started = true;
  let last = Date.now(), since = 0, asked = 0;
  if (!FELL) {
    const l = link(ENGINE);
    let up = l.up();
    l.onLink((u) => { up = u; set({ down: !u }); });
    let down = 0;
    window.setInterval(() => {
      const now = Date.now(), gap = now - last;
      last = now;
      if (gap > GAP_MS || up) { down = 0; return; }
      down += gap;
      if (down >= FALL_MS) fall();
    }, TICK_MS);
    return;
  }
  const nuc = link(LIVE), wait = riseMs();
  // the NucBox dropping again clears "the NucBox is back" at once
  nuc.onLink((u) => { since = u ? Date.now() : 0; if (!u) set({ held: [] }); });
  window.setInterval(() => {
    const now = Date.now(), gap = now - last;
    last = now;
    if (gap > GAP_MS && since) { since = now; set({ held: [] }); }   // a sleep in between: the NucBox's socket proves itself again
    if (!since || now - since < wait || now - asked < ASK_MS) return;
    asked = now;
    const at = since;   // an answer counts only if the NucBox's socket stayed up the whole ask (no drop, no new link)
    void fetch(`${ENGINE_HTTP}/letgo`, { method: "POST", cache: "no-store" })
      .then((r) => r.json() as Promise<{ ok?: boolean; busy?: { kind?: string }[] }>)
      .then((h) => {
        if (h.ok) return [];
        const b = Array.isArray(h.busy) ? h.busy : [];
        return b.length ? [...new Set(b.map((j) => WORDS[j?.kind ?? ""] ?? "a job"))] : ["a job"];
      }, () => [] as string[])   // this Mac's engine not answering: nothing of it to wait for
      .then((held) => { if (since !== at) return; if (held.length) set({ held }); else rise(); });
  }, TICK_MS);
}

export function useOneSol(): OneState {
  const [s, setS] = useState(state);
  useEffect(() => { watch(); subs.add(setS); setS(state); return () => { subs.delete(setS); }; }, []);
  return s;
}
