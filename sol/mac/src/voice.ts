// The microphone and the speaker, as raw PCM.
// Dictation collects 16 kHz mono PCM and hands back a WAV; the call streams the same PCM as it comes in
// and plays what the voice sends back. No MediaRecorder, no container decoding: WebKit's MediaRecorder
// writes fragmented mp4 that decodeAudioData does not always read, which was the dictation failure.

export const MIC_RATE = 16000;
export type Capture = { stop: () => Promise<void> };

// A worklet that posts every block of samples to the main thread. Inline, so nothing has to be served.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("sol-tap", Tap);`;

// Linear resample from the context's rate to 16 kHz, then 16-bit.
function to16k(src: Float32Array, from: number, carry: { frac: number }): Int16Array {
  if (from === MIC_RATE) return toInt16(src);
  const ratio = from / MIC_RATE;
  const out: number[] = [];
  let pos = carry.frac;
  while (pos < src.length - 1) {
    const i = Math.floor(pos);
    const t = pos - i;
    out.push(src[i] * (1 - t) + src[i + 1] * t);
    pos += ratio;
  }
  carry.frac = pos - (src.length - 1);
  return toInt16(Float32Array.from(out));
}
function toInt16(f: Float32Array): Int16Array {
  const o = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  return o;
}

// Levels for the creature (0..1-ish RMS): what the microphone hears right now and what the speaker is playing.
// null means nothing is open / nothing is playing, so the caller can fall back to a made-up envelope.
let micsOpen = 0;
let micRms = 0;
let micAt = 0;
const rms = (f: Float32Array) => { let a = 0; for (let i = 0; i < f.length; i++) a += f[i] * f[i]; return Math.sqrt(a / (f.length || 1)); };
const hearLevel = (f: Float32Array) => { micRms = rms(f); micAt = performance.now(); };
export function micLevel(): number | null {
  if (!micsOpen) return null;
  return performance.now() - micAt > 300 ? 0 : micRms;
}
const players = new Set<Player>();
export function outLevel(): number | null {
  let best: number | null = null;
  for (const p of players) { const l = p.level; if (l !== null) best = Math.max(best ?? 0, l); }
  return best;
}

export class MicError extends Error {
  constructor(public kind: "denied" | "none" | "busy" | "other", message: string) { super(message); }
}

// Open the microphone; every block of 16 kHz PCM goes to onChunk until stop().
// deviceId is the microphone picked in settings; "ideal" so a device that was unplugged falls back to the default.
// ctx: a context the caller made inside a tap (iOS only lets a context run if it was made or resumed in a gesture).
export async function openMic(onChunk: (pcm: Int16Array) => void, deviceId?: string, ctx: AudioContext = new AudioContext()): Promise<Capture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError("none", "this window has no microphone access");
  let stream: MediaStream;
  try {
    // A request macOS is still deciding on (or silently blocking) never settles; say so instead of hanging.
    stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(deviceId ? { deviceId: { ideal: deviceId } } : {}) } }),
      new Promise<MediaStream>((_, no) => setTimeout(() => no(new DOMException("the microphone did not answer in 8 s: macOS may be blocking Sol (System Settings → Privacy & Security → Microphone)", "TimeoutError")), 8000)),
    ]);
  } catch (e) {
    const name = (e as DOMException)?.name ?? "";
    if (name === "NotAllowedError" || name === "SecurityError") throw new MicError("denied", "the microphone is not allowed for Sol (System Settings → Privacy & Security → Microphone)");
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new MicError("none", "no microphone found");
    if (name === "NotReadableError" || name === "AbortError") throw new MicError("busy", "the microphone is in use by another app");
    if (name === "TimeoutError") throw new MicError("other", (e as Error).message);
    throw new MicError("other", `${name || "microphone"}: ${(e as Error)?.message ?? e}`);
  }
  await ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  const carry = { frac: 0 };
  let node: AudioNode;
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const w = new AudioWorkletNode(ctx, "sol-tap", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
    w.port.onmessage = (ev) => { hearLevel(ev.data as Float32Array); onChunk(to16k(ev.data as Float32Array, ctx.sampleRate, carry)); };
    node = w;
    source.connect(w);
  } catch {
    // older WebKit: the deprecated processor still works
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (ev) => { const f = ev.inputBuffer.getChannelData(0).slice(0); hearLevel(f); onChunk(to16k(f, ctx.sampleRate, carry)); };
    source.connect(sp);
    sp.connect(ctx.destination); // a script processor only runs when connected
    node = sp;
  }
  micsOpen++;
  let open = true;
  return {
    stop: async () => {
      if (open) { open = false; micsOpen--; }
      try { source.disconnect(); node.disconnect(); } catch { /* already gone */ }
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close().catch(() => {});
    },
  };
}

// Dictation: record until stop(), get a base64 16 kHz WAV of what is still open. With onClip, the clip so far goes
// out every `every` ms with a tag (the preview Marco reads as he speaks); heard(tag, text) takes the words read from
// that clip and gives back what is settled and what is still open. A long open stretch (10 s) is settled at the quietest moment
// near its end once its words are in: those words are kept, and the clips that follow start after it, so each
// reading stays short and the earlier words stop moving. stop() hands back the open stretch; settled() the rest.
export type Recorder = { stop: () => Promise<string>; heard: (tag: number, text: string) => { kept: string; open: string }; settled: () => string };
export async function startRecording(deviceId?: string, onClip?: (wavBase64: string, tag: number) => void, every = 2000): Promise<Recorder> {
  const parts: Int16Array[] = [];
  const loud: number[] = [];                          // each part's energy, for the quiet cut
  const mic = await openMic((c) => { parts.push(c); loud.push(energy(c)); }, deviceId);
  let from = 0;                                       // the open stretch starts at this part
  let kept = "";                                      // the words settled so far
  let open = "";                                      // the words read from the open stretch, latest clip
  let tag = 0;
  const clips = new Map<number, { from: number; end: number }>();
  const samples = (a: number, b: number) => { let n = 0; for (let i = a; i < b; i++) n += parts[i].length; return n; };
  const clip = (a: number, b: number) => {
    const pcm = new Int16Array(samples(a, b));
    let at = 0;
    for (let i = a; i < b; i++) { pcm.set(parts[i], at); at += parts[i].length; }
    return bytesToBase64(wav(pcm, MIC_RATE));
  };
  const LONG = MIC_RATE * 10;
  // where a clip of a long stretch ends: the quietest 100 ms in its last 1.2 s, so the cut falls between words
  const cut = (end: number) => {
    if (samples(from, end) < LONG) return end;
    let i = end, n = 0;
    while (i > from + 1 && n < MIC_RATE * 1.2) { i--; n += parts[i].length; }
    let best = end, bestE = Infinity;
    for (let j = i; j < end; j++) {
      let e = 0, m = 0, k = j;
      while (k < end && m < MIC_RATE * 0.1) { e += loud[k] * parts[k].length; m += parts[k].length; k++; }
      if (m >= MIC_RATE * 0.05 && e / m < bestE) { bestE = e / m; best = j; }
    }
    return best;
  };
  const tick = onClip ? window.setInterval(() => {
    const end = cut(parts.length);
    if (end <= from) return;
    const t = ++tag;
    clips.set(t, { from, end });
    onClip(clip(from, end), t);
  }, every) : undefined;
  const join = (...w: string[]) => w.filter(Boolean).join(" ");
  return {
    stop: async () => { window.clearInterval(tick); await mic.stop(); return from < parts.length ? clip(from, parts.length) : ""; }, // "" when nothing is left open
    heard: (t, text) => {
      const c = clips.get(t);
      clips.delete(t);
      if (c && c.from === from) {
        open = text;
        if (samples(from, c.end) >= LONG) { kept = join(kept, text); open = ""; from = c.end; } // settled: the next clips start after it
      }
      return { kept, open };
    },
    settled: () => kept,
  };
}
const energy = (p: Int16Array) => { let a = 0; for (let i = 0; i < p.length; i++) a += p[i] * p[i]; return a / (p.length || 1); };

function wav(pcm: Int16Array, rate: number): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); out.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, "data"); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, pcm[i], true);
  return new Uint8Array(out.buffer);
}

export function bytesToBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToInt16(s: string): Int16Array {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new Int16Array(b.buffer, 0, Math.floor(b.length / 2));
}
export const int16ToBase64 = (p: Int16Array) => bytesToBase64(new Uint8Array(p.buffer, p.byteOffset, p.byteLength));

// The speaker: chunks of PCM at `rate` play back to back; clear() drops what has not played yet (barge-in).
export class Player {
  private ctx: AudioContext;
  private at = 0;
  private live = new Set<AudioBufferSourceNode>();
  private levels: { from: number; to: number; rms: number }[] = []; // what plays when, for the creature's voice level
  constructor(private rate = 24000, ctx?: AudioContext) { this.ctx = ctx ?? new AudioContext({ sampleRate: rate }); players.add(this); }
  resume() { return this.ctx.resume().catch(() => {}); }
  play(pcm: Int16Array) {
    if (!pcm.length) return;
    const buf = this.ctx.createBuffer(1, pcm.length, this.rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    if (this.at < now + 0.05) this.at = now + 0.05;
    src.start(this.at);
    this.levels.push({ from: this.at, to: this.at + buf.duration, rms: rms(ch) });
    if (this.levels.length > 400) this.levels.splice(0, this.levels.length - 400);
    this.at += buf.duration;
    this.live.add(src);
    src.onended = () => this.live.delete(src);
  }
  clear() {
    for (const s of this.live) { try { s.stop(); } catch { /* ended */ } }
    this.live.clear();
    this.levels = [];
    this.at = 0;
  }
  async close() { players.delete(this); this.clear(); await this.ctx.close().catch(() => {}); }
  // the level of the chunk playing now, or null when nothing is
  get level(): number | null {
    const now = this.ctx.currentTime;
    while (this.levels.length && this.levels[0].to < now) this.levels.shift();
    const c = this.levels[0];
    return c && c.from <= now ? c.rms : null;
  }
  // seconds of audio still queued
  get pending() { return Math.max(0, this.at - this.ctx.currentTime); }
}
