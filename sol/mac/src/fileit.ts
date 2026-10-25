// File it (#119, PROTOCOL.md round 29): the face's side of "seeing a bug and filing it is one press". One store per
// page, on the page's one socket (teamAsk, cowork/stable.ts). The press takes the window's shot at once (team.file.shot)
// and opens the line over the composer for one line of words; Return files it (team.file) with the mode's label and
// the screen; the number comes back as the line's receipt (and the creature's RECEIPT, creature.receipt).
//   the window  its own "file it" (the button on the bar) does both here
//   the notch   no longer has a File it (Grab and Shelf, #200: the tracker is one destination of a Sol grab, in the
//               sheet). The window still takes up an ask left under `sol.file.asking` (takeAsk, the `storage` event):
//               FileLine reads it on mount
// Under ?dev=file (dev builds only) nothing is sent: the shot and the number are made up, for shots of each state.
import { useSyncExternalStore } from "react";
import { teamAsk } from "./cowork/stable";

export type FileMode = "life" | "work" | "cowork";
export type Said = { text: string; number?: number; url?: string; failed?: boolean };
type State = { open: boolean; shot: string; shooting: boolean; filing: boolean; said: Said | null; at: number };

const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
export const DEV_FILE = dev?.get("dev") === "file";
const ASK_KEY = "sol.file.asking", ASK_MS = 10 * 60_000;

let S: State = { open: false, shot: "", shooting: false, filing: false, said: null, at: 0 };
if (DEV_FILE) S = dev?.get("said") ? { ...S, said: { text: "filed #120", number: 120, url: "https://github.com" } } : { ...S, open: true, shot: "dev" };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { S = { ...S, ...p }; for (const f of [...subs]) f(); };
export const useFile = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => S, () => S);

async function shoot(): Promise<{ shot: string; error?: string }> {
  if (DEV_FILE) return { shot: "dev" };
  const r = await teamAsk<{ shot?: string }>("team.file.shot", {}, 15_000);
  return { shot: r.shot ?? "", ...(r.error ? { error: r.error } : {}) };
}

/** the window's press: the shot now, then the field */
export async function begin() {
  if (S.shooting || S.filing) return;
  set({ open: true, shooting: true, said: null, shot: "" });
  const r = await shoot();
  set({ shooting: false, shot: r.shot, ...(r.error ? { said: { text: r.error, failed: true } } : {}) });
}

/** the window takes up an ask the notch left (on mount, and on the storage event); stale ones are dropped */
export function takeAsk(raw = localStorage.getItem(ASK_KEY)): boolean {
  if (!raw) return false;
  localStorage.removeItem(ASK_KEY);
  try {
    const a = JSON.parse(raw) as { at: number; shot?: string; error?: string };
    if (!(Date.now() - a.at < ASK_MS)) return false;
    set({ open: true, shooting: false, filing: false, shot: a.shot ?? "", said: a.error ? { text: a.error, failed: true } : null, at: Date.now() });
    import("@tauri-apps/api/window").then((w) => w.getCurrentWindow().requestUserAttention(2)).catch(() => {});
    return true;
  } catch { return false; }
}

/** Return in the field: the issue, with what the line knows of the screen */
export async function file(words: string, screen: { page: string; conversation?: string | null }, mode: FileMode) {
  const w = words.replace(/\s+/g, " ").trim();
  if (!w || S.filing) return;
  set({ filing: true, said: { text: "filing…" } });
  const r = DEV_FILE
    ? await new Promise<{ number?: number; url?: string; error?: string }>((ok) => window.setTimeout(() => ok({ number: 120, url: "https://github.com" }), 700))
    : await teamAsk<{ number?: number; url?: string; note?: string }>("team.file", { mode, words: w, page: screen.page, conversation: screen.conversation ?? "", shot: S.shot }, 60_000);
  if (r.error || !r.number) { set({ filing: false, said: { text: r.error || "GitHub did not say the number", failed: true } }); return; }
  set({ filing: false, open: false, shot: "", said: { text: `filed #${r.number}`, number: r.number, url: r.url } });
}

/** keep it: the field closes, nothing is filed (the held shot is forgotten by the next press or in 10 minutes) */
export function cancel() { set({ open: false, shooting: false, shot: "", said: null }); }
/** the receipt read: the line goes */
export function clear() { if (!S.open && !S.filing) set({ said: null }); }

if (typeof window !== "undefined") window.addEventListener("storage", (e) => { if (e.key === ASK_KEY && e.newValue) takeAsk(e.newValue); });
