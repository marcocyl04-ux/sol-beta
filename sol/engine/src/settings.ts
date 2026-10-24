// Marco's settings, one small JSON file next to the engine (engine/settings.json, gitignored).
// The face asks with settings.get and changes with settings.set { patch }; the engine merges, checks,
// writes and tells every face. Anything it does not recognise is dropped, so a bad patch cannot break a call.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Seat = "codex" | "claude";
// what Claude may do without asking in a Work session, as Claude Code names it; the face's starting pick and the pick of
// every session started by a card, a hand-off or a tool (#94: a card session never copies its parent)
export type WorkMode = "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions";
export const WORK_MODES: WorkMode[] = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"];
export type Settings = {
  voice: string;
  patienceMs: number;
  language: "follow" | "english" | "cantonese" | "dutch";
  mic?: string;
  defaults: { seat: Seat; model: Record<Seat, string>; effort: Record<Seat, string>; mode: WorkMode };
};

// Gemini Live's prebuilt voices.
export const VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
];
const LANGS = ["follow", "english", "cantonese", "dutch"];
const EFFORTS = ["low", "medium", "high", "max"];
const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "settings.json");

export const DEFAULTS: Settings = {
  voice: "Kore",
  patienceMs: 600,
  language: "follow",
  defaults: {
    seat: "codex",
    model: { codex: "gpt-6.1-sol", claude: "claude-opus-5-5" },
    effort: { codex: "medium", claude: "medium" },
    mode: "default",
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v : d);

// Whatever is on disk or in a patch, made into a valid Settings.
function clean(raw: unknown): Settings {
  const r = isObj(raw) ? raw : {};
  const d = isObj(r.defaults) ? r.defaults : {};
  const dm = isObj(d.model) ? d.model : {};
  const de = isObj(d.effort) ? d.effort : {};
  const effort = (v: unknown, k: string) => (typeof v === "string" && EFFORTS.includes(v) ? v : DEFAULTS.defaults.effort[k as Seat]);
  const out: Settings = {
    voice: typeof r.voice === "string" && VOICES.includes(r.voice) ? r.voice : DEFAULTS.voice,
    patienceMs: typeof r.patienceMs === "number" && isFinite(r.patienceMs) ? Math.min(1500, Math.max(200, Math.round(r.patienceMs))) : DEFAULTS.patienceMs,
    language: typeof r.language === "string" && LANGS.includes(r.language) ? (r.language as Settings["language"]) : "follow",
    defaults: {
      seat: d.seat === "claude" ? "claude" : "codex",
      model: { codex: str(dm.codex, DEFAULTS.defaults.model.codex), claude: str(dm.claude, DEFAULTS.defaults.model.claude) },
      effort: { codex: effort(de.codex, "codex"), claude: effort(de.claude, "claude") },
      mode: WORK_MODES.includes(d.mode as WorkMode) ? (d.mode as WorkMode) : DEFAULTS.defaults.mode,
    },
  };
  if (typeof r.mic === "string" && r.mic) out.mic = r.mic;
  return out;
}

function merge(a: unknown, b: unknown): unknown {
  if (!isObj(a) || !isObj(b)) return b;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v;
  return out;
}

let current: Settings | null = null;

export function getSettings(): Settings {
  if (current) return current;
  try { current = clean(JSON.parse(readFileSync(FILE, "utf8"))); } catch { current = clean({}); }
  return current;
}

// A null mic in a patch means "back to the system default".
export function patchSettings(patch: unknown): Settings {
  const p = isObj(patch) ? { ...patch } : {};
  const base = { ...getSettings() } as Record<string, unknown>;
  if ("mic" in p && !p.mic) { delete base.mic; delete p.mic; }
  current = clean(merge(base, p));
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, FILE); // never a half-written file
  return current;
}

export function languageLine(l: Settings["language"]): string {
  return l === "english" ? "Answer in English." : l === "cantonese" ? "Answer in Cantonese." : l === "dutch" ? "Answer in Dutch." : "Answer in the language Marco speaks.";
}
