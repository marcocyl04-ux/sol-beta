// The first run's permissions (#134) on the per-OS API of #271 (PR #277, src-tauri/src/permission.rs):
// permission_check / permission_ask / permission_settings, states granted | denied | prompt | unsupported. Its rules,
// which the senses scene (FirstRun.tsx) follows without knowing the OS: "unsupported" means no switch exists here, so
// the card is skipped (Windows and Linux answer it for the microphone, because the webview's own sheet is the real ask
// and cannot be read back; the first talk asks then); notifications are "granted" everywhere; the Mac answers all
// four; permission_settings errs where no page exists (Linux), so the settings button sits behind a catch. In an app
// built before #277 the branches below stand in with what the Mac had (permit.rs permit_state and permit_open, the
// web view's getUserMedia and Notification); a browser harness (?firstrun) answers "prompt" for all four.
import { invoke } from "@tauri-apps/api/core";

export type Permission = "microphone" | "screen" | "accessibility" | "notifications";
export type PermissionState = "granted" | "denied" | "prompt" | "unsupported";
export const POLL_MS = 800;   // the senses scene asks again this often while a card shows (Permit.tsx's rhythm)

const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
// a browser harness (?firstrun=<scene>, no app): every switch is "prompt", allow grants it, so the scene can be seen whole
const DEMO = typeof location !== "undefined" && new URLSearchParams(location.search).has("firstrun") && !inApp;
const demo: Partial<Record<Permission, PermissionState>> = {};
// the screen has no readable state from the face today (permit_state knows accessibility alone): the card's own
// "it's on" press records it here until #271's permission_check reads CGPreflightScreenCaptureAccess
let screenSaid: PermissionState | null = null;

// does the first run have a real OS switch behind it on this machine?
async function has(): Promise<Record<Permission, boolean>> {
  if (DEMO) return { microphone: true, screen: true, accessibility: true, notifications: true };
  // #271 first: the one command, the same on every OS
  if (inApp) {
    try { await invoke<PermissionState>("permission_check", { which: "microphone" }); return { microphone: true, screen: true, accessibility: true, notifications: true }; }
    catch { /* an app from before #271: the Mac's own pieces below */ }
  }
  return { microphone: true, screen: inApp && isMac, accessibility: inApp && isMac, notifications: typeof Notification !== "undefined" };
}
let ported: boolean | null = null;   // #271's commands answer in this app
const newApi = async () => {
  if (ported !== null) return ported;
  if (!inApp) return (ported = false);
  try { await invoke<PermissionState>("permission_check", { which: "microphone" }); ported = true; } catch { ported = false; }
  return ported;
};

export async function check(which: Permission): Promise<PermissionState> {
  if (DEMO) return demo[which] ?? "prompt";
  if (await newApi()) return invoke<PermissionState>("permission_check", { which }).catch((): PermissionState => "unsupported");
  const can = await has();
  if (!can[which]) return "unsupported";
  switch (which) {
    case "microphone": {
      try {
        const p = await navigator.permissions?.query({ name: "microphone" as PermissionName });
        if (p) return p.state === "granted" ? "granted" : p.state === "denied" ? "denied" : "prompt";
      } catch { /* WebKit has no query for it: prompt until getUserMedia says */ }
      return "prompt";
    }
    case "accessibility": {
      const s = await invoke<{ accessibility: boolean }>("permit_state").catch(() => null);
      return s ? (s.accessibility ? "granted" : "prompt") : "unsupported";
    }
    case "screen": return screenSaid ?? "prompt";
    case "notifications": return Notification.permission === "granted" ? "granted" : Notification.permission === "denied" ? "denied" : "prompt";
  }
}

// the system's own prompt, then the state as it stands; never blocks on the person
export async function ask(which: Permission): Promise<PermissionState> {
  if (DEMO) { demo[which] = "granted"; return "granted"; }
  if (await newApi()) return invoke<PermissionState>("permission_ask", { which }).catch((): PermissionState => "unsupported");
  switch (which) {
    case "microphone": {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); return "granted"; }
      catch { return "denied"; }
    }
    case "notifications": {
      try { const r = await Notification.requestPermission(); return r === "granted" ? "granted" : r === "denied" ? "denied" : "prompt"; }
      catch { return "unsupported"; }
    }
    case "accessibility": case "screen": {
      // the Mac's prompt (accessibility) and System Settings at the pane (both): permit.rs
      await invoke("permit_open", { which }).catch(() => {});
      return check(which);
    }
  }
}

// the OS's settings pane for it (denied: the only way back)
export async function settings(which: Permission): Promise<void> {
  if (DEMO) return;
  if (await newApi()) { await invoke("permission_settings", { which }).catch(() => {}); return; }
  if (which === "accessibility" || which === "screen") await invoke("permit_open", { which }).catch(() => {});
}

// the screen card's own word in an app before #277 (the new API reads CGPreflightScreenCaptureAccess itself)
export function sayScreen(state: PermissionState) { screenSaid = state; }
// does this app read the screen's state itself? (false: the card offers "it's on" so a person can say so)
export const readsScreen = () => newApi();

// microphone granted: one getUserMedia so the device names appear and the first talk does not ask again
export async function warmMicrophone() {
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); } catch { /* the next talk asks */ }
}
