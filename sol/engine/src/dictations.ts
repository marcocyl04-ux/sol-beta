// Dictate anywhere (#110): every dictation the notch typed into an app is one line in home/voice/dictations/<day>.jsonl,
// so it can be read again later (a night pass, memory). Words only; the audio is not kept. The day is the Mac's local day.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type Dictated = { app?: unknown; name?: unknown; title?: unknown; seconds?: unknown; raw?: unknown; typed?: unknown; went?: unknown };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Append one dictation to home/voice/dictations/<YYYY-MM-DD>.jsonl; returns the file. Nothing is written without words. */
export function storeDictation(home: string, m: Dictated, now = new Date()): string | null {
  const raw = str(m.raw).trim();
  if (!raw) return null;
  const line = {
    at: now.toISOString(),
    app: str(m.app),
    name: str(m.name),
    title: str(m.title),
    seconds: typeof m.seconds === "number" && isFinite(m.seconds) ? Math.round(m.seconds * 10) / 10 : 0,
    raw,
    typed: str(m.typed) || raw,
    went: m.went === "clipboard" ? "clipboard" : "app",
  };
  const dir = join(home, "voice", "dictations");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${day(now)}.jsonl`);
  appendFileSync(file, JSON.stringify(line) + "\n");
  return file;
}
