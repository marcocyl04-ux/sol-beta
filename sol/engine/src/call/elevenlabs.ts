// The call on ElevenLabs (#24): ElevenLabs is only the ears and the mouth; the seat is the brain.
//
//   face 16 kHz PCM → Scribe realtime (speech to text, its own silence detection set by patience)
//   → each finished utterance is one ordinary seat turn on the call's conversation (the seat keeps all its tools)
//   → the answer streams, sentence by sentence, into ElevenLabs' streaming text to speech (24 kHz PCM) → face.
//
// Marco speaking over Sol stops the speech at once (call.clear, the same as Gemini's interruption); the seat's turn
// is not stopped, only no longer spoken: what he said is the next turn, as soon as the seat is free. Utterances that
// arrive while the seat is working wait and go together. Every turn is already in the thread, so hang-up has no
// transcript to hand over; a turn still running at hang-up is stopped (a chat's or a session's alike).
// Everything is outbound from the engine (websockets with the key in a header); no public address is needed.

import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { join as joinBusy } from "../busy.js";
import { languageLine, type Settings } from "../settings.js";
import type { CallOpts, VoiceCall } from "./vendor.js";

export const STT_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
export const STT_MODEL = "scribe_v2_realtime";
export const TTS_MODEL = "eleven_flash_v2_5";   // the lowest-latency model ElevenLabs lists
export const ttsUrl = (voice: string) => `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream-input`;
const OPEN_MS = 15_000;
const OUT_RATE_BYTES_PER_MS = 48;   // 24 kHz, 16-bit, mono
// Scribe's errors that end the call; the others (a throttled commit, too little audio) pass
const FATAL = new Set(["auth_error", "quota_exceeded", "unaccepted_terms", "invalid_request"]);

const CALL_FIRST = "(We are on a call now: Marco is talking to you out loud, and what you write is read out by a voice. " +
  "Answer like a person on the phone: one to three short sentences, plain words, no markdown, lists, headers, code or file paths. " +
  "Use your tools as you always do when something needs them, and say in a few words what you are doing first. " +
  "These lines come from speech to text, so read past small mishearings.";
const CALL_EACH = "\n\n(on the call: answer out loud, short, no markdown)";

// A socket as the call uses it: the ws package's WebSocket, or a fake in the tests.
export type Sock = {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  on(ev: "open" | "message" | "close" | "error", f: (...a: any[]) => void): unknown;
};
export type Dial = (url: string, headers: Record<string, string>) => Sock;
const dialWs: Dial = (url, headers) => new WebSocket(url, { headers }) as unknown as Sock;

export type ElevenDeps = {
  key: string;
  voice: string;
  patienceMs: number;
  language?: Settings["language"];
  dial?: Dial;
  now?: () => number;
};

// Scribe's language for Sol's language setting; "follow" (and Cantonese, whose code Scribe may not take) detect it
const LANG_CODE: Partial<Record<Settings["language"], string>> = { english: "en", dutch: "nl" };

// What a voice can say of a piece of the seat's answer: the words without the markdown, links or code around them.
export function speakable(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/[*_~|`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Socket messages wait until it is open.
class Outbox {
  private q: string[] = [];
  constructor(private s: Sock) { s.on("open", () => { for (const m of this.q.splice(0)) this.s.send(m); }); }
  send(m: object) {
    const line = JSON.stringify(m);
    if (this.s.readyState === 1) this.s.send(line); else if (this.s.readyState === 0) this.q.push(line);
  }
}

export class ElevenCall implements VoiceCall {
  private stt: { s: Sock; out: Outbox } | null = null;
  private tts: { s: Sock; out: Outbox } | null = null;
  private ended = false;
  private reconnects = 0;
  private me = { id: "", text: "" };
  private you = { id: "", text: "" };
  private pending: string[] = [];
  private thinking = false;
  private first = true;
  private gen = 0;            // bumps when Marco speaks over Sol: the answer that was talking is no longer spoken
  private playUntil = 0;      // when the face will have played the last audio it was sent
  private buf = "";           // the answer's words not yet sent to the voice
  private inCode = false;     // inside a fenced code block, which is never read out
  private leave = () => {};
  private dial: Dial;
  private now: () => number;

  constructor(private o: CallOpts, private d: ElevenDeps) {
    this.dial = d.dial ?? dialWs;
    this.now = d.now ?? Date.now;
  }
  get done() { return this.ended; }

  async start() {
    this.leave = joinBusy("call", randomUUID(), "elevenlabs");
    try { await this.openStt(); } catch (err) { this.leave(); this.ended = true; throw err; }
    if (this.ended) { this.closeStt(); return; }
    this.o.send({ type: "call", ok: true, state: "live" });
  }

  private openStt(): Promise<void> {
    const q = new URLSearchParams({
      model_id: STT_MODEL, audio_format: "pcm_16000", commit_strategy: "vad",
      vad_silence_threshold_secs: String(Math.max(0.3, this.d.patienceMs / 1000)),
    });
    const lang = this.d.language && LANG_CODE[this.d.language];
    if (lang) q.set("language_code", lang);
    const s = this.dial(`${STT_URL}?${q}`, { "xi-api-key": this.d.key });
    const me = { s, out: new Outbox(s) };
    this.stt = me;
    return new Promise((ok, no) => {
      let up = false;
      const timer = setTimeout(() => { if (!up) { no(new Error("the ears did not answer")); try { s.close(); } catch { /* gone */ } } }, OPEN_MS);
      s.on("message", (raw) => {
        let m: any;
        try { m = JSON.parse(String(raw)); } catch { return; }
        if (m.message_type === "session_started") { up = true; clearTimeout(timer); ok(); return; }
        if (!up && m.error) { clearTimeout(timer); no(new Error(String(m.error))); return; }
        if (this.stt === me) this.onStt(m);
      });
      s.on("error", (e: Error) => { if (!up) { clearTimeout(timer); no(e); } });
      s.on("close", (_code: number, reason: unknown) => {
        clearTimeout(timer);
        if (!up) { no(new Error(String(reason || "") || "the ears hung up")); return; }
        if (this.stt !== me || this.ended) return;
        // a session has a time limit; a new one picks up (Marco hears nothing of it)
        this.stt = null;
        if (this.reconnects++ < 5) void this.openStt().catch((err) => this.fail(err));
        else this.fail(new Error(String(reason || "") || "the ears hung up"));
      });
    });
  }

  audio(data: string) {
    if (this.ended || !this.stt || !data) return;
    try { this.stt.out.send({ message_type: "input_audio_chunk", audio_base_64: data, commit: false, sample_rate: 16000 }); } catch { /* closing */ }
  }

  private speaking() { return !!this.tts || this.now() < this.playUntil; }

  private onStt(m: any) {
    const t = m.message_type;
    if (t === "partial_transcript") {
      const text = String(m.text ?? "").trim();
      if (!text) return;
      if (text.replace(/\W/g, "").length >= 2 && this.speaking()) this.bargeIn();
      if (!this.me.id) this.me.id = randomUUID();
      this.me.text = text;
      this.o.send({ type: "call.text", id: this.me.id, who: "me", text, final: false });
    } else if (t === "committed_transcript") {
      const text = String(m.text ?? "").trim();
      if (text && this.speaking()) this.bargeIn();
      this.me.text = text;
      this.flush("me");
      if (!text) return;
      this.pending.push(text);
      void this.turn();
    } else if (FATAL.has(t)) {
      this.fail(new Error(String(m.error ?? t)));
    }
  }

  // Marco spoke over Sol: stop the voice, drop what the face has not played, and stop speaking this answer.
  private bargeIn() {
    this.gen++;
    this.closeTts();
    this.playUntil = 0;
    this.buf = "";
    this.o.send({ type: "call.clear" });
    this.flush("you");
  }

  private asking: AbortController | null = null;   // the running turn's stop
  private async turn() {
    if (this.thinking || this.ended || !this.pending.length) return;
    this.thinking = true;
    const said = this.pending.splice(0).join(" ");
    const text = this.first ? `${CALL_FIRST} ${languageLine(this.d.language ?? "follow")})\n\n${said}` : said + CALL_EACH;
    this.first = false;
    const gen = ++this.gen;
    this.buf = ""; this.inCode = false;
    try {
      const abort = (this.asking = new AbortController());
      await this.o.ask(text, abort.signal, (delta) => { if (gen === this.gen && !this.ended) this.take(delta); });
      if (gen === this.gen && !this.ended) this.finish();
    } catch (err) {
      if (this.ended) return;   // hung up: the turn was stopped on purpose
      const id = "call-" + randomUUID();
      this.o.step({ id, kind: "note", text: "the call's turn did not finish", done: true, ok: false, detail: err instanceof Error ? err.message : String(err) });
    } finally {
      this.thinking = false;
      this.asking = null;
    }
    void this.turn();
  }

  // The seat's words as they stream: each finished sentence goes to the voice at once.
  private take(delta: string) {
    this.buf += delta;
    let cut = -1;
    const re = /[.!?…](?=\s)|\n/g;
    for (let m; (m = re.exec(this.buf)); ) cut = m.index + 1;
    if (cut < 0 && this.buf.length > 160) cut = this.buf.lastIndexOf(" ") + 1;
    if (cut <= 0) return;
    this.say(this.buf.slice(0, cut));
    this.buf = this.buf.slice(cut);
  }

  private finish() {
    if (this.buf) this.say(this.buf);
    this.buf = "";
    this.tts?.out.send({ text: "" });   // speak what is left, then the voice closes
    if (!this.tts) this.flush("you");
  }

  private say(piece: string) {
    // fenced code is never read out
    const parts = piece.split("```");
    let words = "";
    parts.forEach((p, i) => { if (i > 0) this.inCode = !this.inCode; if (!this.inCode) words += p; });
    const text = speakable(words);
    if (!text) return;
    this.mouth().out.send({ text: text + " ", flush: true });
    if (!this.you.id) this.you.id = randomUUID();
    this.you.text = (this.you.text + " " + text).trim();
    this.o.send({ type: "call.text", id: this.you.id, who: "you", text: this.you.text, final: false });
  }

  // The answer's voice: one streaming text-to-speech socket per answer, opened on its first sentence.
  private mouth() {
    if (this.tts) return this.tts;
    const q = new URLSearchParams({ model_id: TTS_MODEL, output_format: "pcm_24000", inactivity_timeout: "60" });
    const s = this.dial(`${ttsUrl(this.d.voice)}?${q}`, { "xi-api-key": this.d.key });
    const me = { s, out: new Outbox(s) };
    this.tts = me;
    me.out.send({ text: " ", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 }, generation_config: { chunk_length_schedule: [50, 90, 120, 160] } });
    s.on("message", (raw) => {
      if (this.tts !== me) return;
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (typeof m.audio === "string" && m.audio) {
        this.o.send({ type: "call.audio", data: m.audio });
        const ms = (m.audio.length * 3) / 4 / OUT_RATE_BYTES_PER_MS;
        this.playUntil = Math.max(this.now(), this.playUntil) + ms;
      }
      if (m.isFinal) { this.tts = null; try { s.close(); } catch { /* gone */ } this.flush("you"); }
      else if (!m.audio && (m.error || m.message)) console.error("call: the voice said", String(m.error ?? m.message).slice(0, 200));
    });
    s.on("error", (e: Error) => { if (this.tts === me) console.error("call: the voice failed", e.message); });
    s.on("close", (code: number, reason: unknown) => {
      if (this.tts !== me) return;
      this.tts = null;
      this.flush("you");
      // the voice refused (a bad key, no characters left): the call cannot talk, so it says why and ends
      if (code !== 1000 && code !== 1005 && !this.ended) this.fail(new Error(String(reason || "") || `the voice closed (${code})`));
    });
    return me;
  }

  private flush(who: "me" | "you") {
    const l = this[who];
    if (!l.id) return;
    this.o.send({ type: "call.text", id: l.id, who, text: l.text.trim(), final: true });
    this[who] = { id: "", text: "" };
  }

  private closeTts() { const t = this.tts; this.tts = null; try { t?.s.close(); } catch { /* gone */ } }
  private closeStt() { const t = this.stt; this.stt = null; try { t?.s.close(); } catch { /* gone */ } }

  private fail(err: unknown) {
    if (this.ended) return;
    this.o.send({ type: "call", ok: false, why: "voice: " + (err instanceof Error ? err.message : String(err)) });
    void this.end();
  }

  async end() {
    if (this.ended) return;
    this.ended = true;
    this.leave();
    this.gen++;
    this.asking?.abort();   // hanging up stops the turn the seat is still on (round three)
    this.flush("me"); this.flush("you");
    this.closeStt(); this.closeTts();
    this.o.send({ type: "call", ok: true, state: "ended" });
  }
}
