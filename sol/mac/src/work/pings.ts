// Pings: Work tells Marco when a session wants him and he is not looking (Sol not in front, or another session
// open). Three moments — a permission asked, a question asked (AskUserQuestion), a turn done — each off, a badge (the
// dock count and the window title) or a banner (Notification Center on the engine's machine, the Mac). Besides: a
// bounce of the dock, and a short sound. The choices are this window's (localStorage sol.work.pings).
// Mounted by App, not by Work (#16 blocker 7): while Life shows, Work is unmounted, and a permission asked then must
// still ping; `live` is the Work session in front of Marco, null while Life shows.
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { WHICH } from "../useEngine";
import { homeSession } from "../migrate";

export type PingWay = "off" | "badge" | "banner";
export type Pings = { perm: PingWay; question: PingWay; done: PingWay; attention: boolean; sound: boolean };
export const PINGS: [keyof Pick<Pings, "perm" | "question" | "done">, string][] = [["perm", "a permission is asked"], ["question", "a question is asked"], ["done", "a turn is done"]];
const DEFAULT: Pings = { perm: "banner", question: "banner", done: "badge", attention: true, sound: false };
const WAYS = new Set(["off", "badge", "banner"]);

export function loadPings(): Pings {
  try {
    const v = JSON.parse(localStorage.getItem("sol.work.pings") ?? "{}");
    const out = { ...DEFAULT };
    for (const [k] of PINGS) if (WAYS.has(v?.[k])) out[k] = v[k];
    if (typeof v?.attention === "boolean") out.attention = v.attention;
    if (typeof v?.sound === "boolean") out.sound = v.sound;
    return out;
  } catch { return { ...DEFAULT }; }
}
export const savePings = (p: Pings) => { try { localStorage.setItem("sol.work.pings", JSON.stringify(p)); } catch { /* private */ } };

// a soft two-note blip, made here (no sound file)
let ctx: AudioContext | null = null;
function blip() {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    for (const [f, at] of [[880, 0], [1320, 0.09]] as const) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(0.08, t + at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.22);
      o.connect(g).connect(ctx.destination); o.start(t + at); o.stop(t + at + 0.25);
    }
  } catch { /* no audio */ }
}

const TITLE = document.title;
export type Who = { live: string | null; title: (id: string) => string };
export function usePings(e: { send: (o: object) => void; subscribe: (f: (m: any) => void) => () => void }, who: Who, solo?: string) {
  const live = useRef(who.live);
  live.current = who.live;
  const seen = useRef<(() => void) | null>(null);
  const titles = useRef(who.title);
  titles.current = who.title;
  useEffect(() => {
    if (solo) return;   // a pop-out window: the main window pings
    let win: ReturnType<typeof getCurrentWindow> | null = null;
    try { win = getCurrentWindow(); } catch { /* not in Sol.app (a plain browser): the title and the sound only */ }
    const asked = new Set<string>();
    // what waits, per session: the badge counts them; opening a session clears its own, coming back to Sol the one shown
    const waiting = new Map<string, number>();
    let count = 0;
    const show = () => {
      count = [...waiting.values()].reduce((a, b) => a + b, 0);
      document.title = count ? `(${count}) ${TITLE}` : TITLE;
      try { void (win as any)?.setBadgeCount?.(count || undefined)?.catch?.(() => {}); } catch { /* an older Sol.app */ }
    };
    const ping = (kind: "perm" | "question" | "done", sessionId: string, body: string) => {
      const away = !document.hasFocus();
      if (!away && sessionId === live.current) return;
      const p = loadPings(), way = p[kind];
      if (way === "off") return;
      const title = titles.current(sessionId) || "a session";
      // a banner shows on the engine's machine, so only when that is this Mac; elsewhere it falls back to the badge
      if (way === "banner" && WHICH === "next") e.send({ type: "work.notify", title: `Home: ${title}`, body });
      waiting.set(sessionId, (waiting.get(sessionId) ?? 0) + 1); show();
      if (away && p.attention && win) void win.requestUserAttention(UserAttentionType.Informational).catch(() => {});
      if (p.sound) blip();
    };
    const off = e.subscribe((m) => {
      if (m.type === "work.item" && m.item?.kind === "perm" && m.item.state === "ask" && !asked.has(m.item.id)) {
        asked.add(m.item.id);
        const q = m.item.tool === "AskUserQuestion";
        ping(q ? "question" : "perm", m.sessionId, q ? String(m.item.input?.questions?.[0]?.question ?? "Claude asks you something") : `Claude asks to use ${m.item.tool}`);
      } else if (m.type === "work.run" && m.ended && !m.waiting) {
        ping("done", m.sessionId, m.failed ? "it stopped with an error" : "done; it is your turn");
      }
    });
    const back = () => { if (live.current && waiting.delete(live.current)) show(); };
    seen.current = back;
    window.addEventListener("focus", back);
    return () => { off(); window.removeEventListener("focus", back); seen.current = null; waiting.clear(); show(); };
  }, [e.subscribe, e.send, solo]);
  // opening a session is seeing it
  useEffect(() => { if (document.hasFocus()) seen.current?.(); }, [who.live]);
}

// what App needs to ping for Work from anywhere: the Work session in front (useWork says so on "sol:work-live"; null
// while Life shows, so every Work ping counts then) and the sessions' titles (the list is asked once the engine is up)
export function useWorkWho(e: { send: (o: object) => void; subscribe: (f: (m: any) => void) => () => void; up: boolean }, inWork: boolean): Who {
  const [live, setLive] = useState<string | null>(homeSession);
  const titles = useRef(new Map<string, string>());
  useEffect(() => {
    const on = (ev: Event) => setLive((ev as CustomEvent<string | null>).detail ?? null);
    window.addEventListener("sol:work-live", on);
    return () => window.removeEventListener("sol:work-live", on);
  }, []);
  useEffect(() => e.subscribe((m) => { if (m.type === "work.sessions") titles.current = new Map((m.sessions ?? []).map((s: { id: string; title: string }) => [s.id, s.title])); }), [e.subscribe]);
  useEffect(() => { if (e.up && !inWork) e.send({ type: "work.list" }); }, [e.up, e.send, inWork]);
  return { live: inWork ? live : null, title: (id) => titles.current.get(id) ?? "" };
}
