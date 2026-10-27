import { landOn } from "./land";
import { Suspense, lazy, useEffect, useLayoutEffect, useState } from "react";
import { useEngine, keptSession } from "./useEngine";
import { useOneSol } from "./oneSol";
import { type AppMode } from "./ModeSwitch";
import { WorkApp } from "./work/WorkApp";
import { CoworkApp } from "./cowork/CoworkApp";
import { usePings, useWorkWho } from "./work/pings";
import { setPaper } from "./creature/ring";
import { startPresence } from "./creature/state";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onOpenAsk, wireSend } from "./renovation";
import { migrate } from "./migrate";
import { applyLook } from "./look";
import { firstRunWanted } from "./firstrun/FirstRun";

// the first run (#134, firstrun/FirstRun.tsx) lies over the app: a new person meets Sol inside the real window
const FirstRun = lazy(() => import("./firstrun/FirstRun"));

// The app has its modes, picked on the wheel at the top of the side: Home (#132: sessions in folders and chats, on
// Work's shell, work/WorkApp.tsx) and Cowork (Home with the team, Together #31: its own side). Social waits off the
// wheel until its first button. Each is its own tree on one engine socket.
// A window opened with ?work=<id> is one session popped out of the main window: that session only.
const SOLO = new URLSearchParams(location.search).get("work") || undefined;
// once, before the first draw: what Life and Work kept becomes Home's (migrate.ts)
const MODE0: AppMode = SOLO ? "home" : migrate(localStorage, keptSession);
const keep = (open: object) => localStorage.setItem("sol.home.open", JSON.stringify(open));

export default function App() {
  const e = useEngine();
  const [mode, setMode] = useState<AppMode>(MODE0);
  const [first, setFirst] = useState(firstRunWanted);
  const pick = (m: AppMode) => { localStorage.setItem("sol.mode", m); setMode(m); };
  useLayoutEffect(() => { document.documentElement.dataset.mode = mode; setPaper(mode === "home" ? "home" : "work"); }, [mode]);   // Cowork is on Work's paper
  useLayoutEffect(() => { if (e.settings) applyLook(e.settings.look); }, [e.settings]);   // the look, whenever settings arrive (look.ts)
  // ctrl+cmd+M: pressed, it flips Home and Cowork; held 350 ms, it opens the wheel (ModeWheel.tsx).
  // WebKit sends no keyup for M while cmd is down, so letting go of cmd or ctrl counts as letting go of the keys.
  useEffect(() => {
    let t: number | undefined, wheel = false;
    const down = (ev: KeyboardEvent) => {
      if (SOLO || !(ev.metaKey && ev.ctrlKey && ev.key.toLowerCase() === "m")) return;
      ev.preventDefault();
      if (ev.repeat || t !== undefined || wheel) return;
      t = window.setTimeout(() => { t = undefined; wheel = true; window.dispatchEvent(new Event("sol:mode-wheel")); }, 350);
    };
    const up = (ev: KeyboardEvent) => {
      if (ev.key.toLowerCase() !== "m" && ev.key !== "Meta" && ev.key !== "Control") return;
      if (t !== undefined) { window.clearTimeout(t); t = undefined; pick(document.documentElement.dataset.mode === "cowork" ? "home" : "cowork"); }
      if (ev.key === "Meta" || ev.key === "Control") wheel = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.clearTimeout(t); };
  }, []);
  // a ping clicked in the notch: its talk opens in Home (a session, or a chat), kept first so a Home that mounts now opens it
  useEffect(() => onOpenAsk((m) => {
    if (SOLO || !m.sessionId) return;
    landOn(m);   // Open from the notch lands on the item it showed (land.ts)
    if (m.seat === "work") {
      keep({ kind: "session", id: m.sessionId });
      pick("home"); window.dispatchEvent(new CustomEvent("sol:open-work", { detail: m.sessionId }));
    } else {
      const seat = m.seat === "claude" ? "claude" : "codex";
      keep({ kind: "chat", id: m.sessionId, seat });
      pick("home"); window.dispatchEvent(new CustomEvent("sol:open-chat", { detail: { seat, sessionId: m.sessionId, title: "", updatedAt: 0 } }));
    }
    import("@tauri-apps/api/window").then((w) => w.getCurrentWindow().requestUserAttention(2)).catch(() => {});
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  // the creature: this window tells the engine its focus and the Mac's idle (the main window only, not a pop-out)
  useEffect(() => {
    let label = "main";
    try { label = getCurrentWindow().label; } catch { /* a plain browser: report anyway */ }
    return label === "main" ? startPresence(wireSend) : undefined;
  }, []);
  // the sessions' pings live here, above the mode, so a permission asked while Cowork shows still reaches Marco (#16 blocker 7)
  usePings(e, useWorkWho(e, mode === "home"), SOLO);
  useOneSol();   // One Sol (#62): the main window watches the NucBox, whatever the mode shows
  if (SOLO) return <WorkApp e={e} onMode={() => {}} solo={SOLO} />;
  return (
    <>
      {mode === "cowork" ? <CoworkApp e={e} onMode={pick} /> : <WorkApp e={e} onMode={pick} />}
      {first && <Suspense fallback={null}><FirstRun e={e} onDone={() => setFirst(false)} /></Suspense>}
    </>
  );
}
