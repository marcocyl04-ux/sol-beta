// Dictation: a clip comes in (base64 wav, or webm/opus which ffmpeg converts), whisper.cpp turns it into text.
// Everything stays on the machine. Files live in home/voice/ (gitignored).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { writeFile, rm, rename, open } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const run = promisify(execFile);
const PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;
const env = { ...process.env, PATH };
export const DICTATION_MODEL = "whisper.cpp base.en (on this machine)";
const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";

// the speech model is fetched once, the first time the mic is used, into home/voice (148 MB): a tester's install does
// not carry it (#169), and nothing else puts it there. The fetch runs on its own; the clip that started it, and any
// clip while it runs, is told so at once rather than waiting on 148 MB. One fetch at a time; a half file never sits
// under the model's name, and a page a captive portal or a proxy answers with is not taken for the model (ggml magic)
const FETCH_LIMIT_MS = 10 * 60_000;
const FETCHING = "fetching the speech model once (148 MB); try the mic again in a minute";
let fetching: Promise<void> | null = null;
let fetchFailed: string | null = null;
const errWords = (err: unknown) => {
  const e = err as { message?: string; cause?: { code?: string } };
  const code = e?.cause?.code;
  return `${(e?.message ?? String(err)).split("\n")[0]}${code ? ` (${code})` : ""}`;
};
export async function fetchModel(model: string): Promise<void> {
  const part = model + ".part";
  try {
    const res = await fetch(MODEL_URL, { redirect: "follow", signal: AbortSignal.timeout(FETCH_LIMIT_MS) });
    if (!res.ok || !res.body) throw new Error(`${res.status} from huggingface.co; is the network up?`);
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(part));
    const head = Buffer.alloc(4);
    const fh = await open(part, "r");
    try { await fh.read(head, 0, 4, 0); } finally { await fh.close(); }
    if (head.toString("latin1") !== "lmgg") throw new Error("what came is not a whisper model (a sign-in page on this network?)");
    await rename(part, model);
    fetchFailed = null;
  } catch (err) {
    await rm(part, { force: true });
    fetchFailed = `could not fetch the speech model: ${errWords(err)}`;
  }
}
function ensureModel(model: string): string | null {
  if (existsSync(model)) return null;
  if (fetching) return FETCHING;
  const once = fetchModel(model).finally(() => { if (fetching === once) fetching = null; });
  fetching = once;
  return fetchFailed ? `${FETCHING}; the last try failed: ${fetchFailed}` : FETCHING;
}

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
  if (!bin) return { text: "", why: `dictation needs whisper.cpp on the engine's machine (${process.platform === "darwin" ? "in Terminal, brew install whisper-cpp" : "built from github.com/ggml-org/whisper.cpp"}); typing works without it` };
  const missing = ensureModel(model);
  if (missing) return { text: "", why: missing };

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
