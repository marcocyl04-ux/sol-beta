// Dictation: a clip comes in (base64 wav, or webm/opus which ffmpeg converts), whisper.cpp turns it into text.
// Everything stays on the machine. Files live in home/voice/ (gitignored).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const run = promisify(execFile);
const PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;
const env = { ...process.env, PATH };
export const DICTATION_MODEL = "whisper.cpp base.en (on this machine)";
const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";

async function which(bin: string): Promise<string | null> {
  try {
    return (await run("which", [bin], { env })).stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function transcribe(home: string, audioBase64: string): Promise<{ text: string; why?: string }> {
  const dir = join(home, "voice");
  const tmp = join(dir, "tmp");
  mkdirSync(tmp, { recursive: true });
  const model = join(dir, "ggml-base.en.bin");
  const bin = (await which("whisper-cli")) ?? (await which("whisper-cpp"));
  if (!bin) return { text: "", why: "whisper.cpp is not installed (brew install whisper-cpp)" };
  if (!existsSync(model)) return { text: "", why: `speech model missing: ${model} (from ${MODEL_URL})` };

  const id = randomUUID();
  const raw = join(tmp, id + ".in");
  const wav = join(tmp, id + ".wav");
  try {
    const buf = Buffer.from(audioBase64, "base64");
    if (!buf.length) return { text: "", why: "empty audio" };
    const isWav = buf.subarray(0, 4).toString() === "RIFF";
    await writeFile(raw, buf);
    // The face sends 16 kHz mono wav; anything else goes through ffmpeg.
    const ff = isWav ? null : await which("ffmpeg");
    if (!isWav && !ff) return { text: "", why: "audio is not wav and ffmpeg is not installed" };
    if (ff) await run(ff, ["-y", "-loglevel", "error", "-i", raw, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { env });
    const input = ff ? wav : raw;
    const { stdout } = await run(bin, ["-m", model, "-f", input, "-nt", "-np"], { env, timeout: 120_000, maxBuffer: 10_000_000 });
    return { text: clean(stdout) };
  } catch (err) {
    return { text: "", why: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  } finally {
    await rm(raw, { force: true });
    await rm(wav, { force: true });
  }
}

// whisper's stage directions ("[BLANK_AUDIO]", "(upbeat music)", "[Music]") and the lines it makes up over silence
// ("Thank you.", "you") are not words Marco said.
const MADE_UP = /^(thank you\.?|thanks for watching!?|you\.?|bye\.?|\.+)$/i;
export function clean(raw: string): string {
  const t = raw.replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return MADE_UP.test(t) ? "" : t;
}
