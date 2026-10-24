// "Hear it": a short Gemini Live session in one voice that says one line and hangs up. No tools, no history.
// Audio goes to the face as call.audio (24 kHz PCM); the face plays it through its Player when no call is live.
// Face → engine { type: "voice.sample", voice }.  Engine → face { type: "voice.sample", ok: true, done: true } | { ok: false, why }.

import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { VOICE_MODEL } from "./call.js";
import { VOICES } from "./settings.js";

const LINE = "Say exactly, warmly: Hey Marco, this is my voice. What are we doing today?";
const TIMEOUT_MS = 25_000;

export class Sample {
  private session: Session | null = null;
  private over = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(private voice: string, private send: (m: object) => void) {}

  async start() {
    if (!process.env.GEMINI_API_KEY) return this.fail("no voice key: put GEMINI_API_KEY in sol/engine/.env");
    if (!VOICES.includes(this.voice)) return this.fail("unknown voice");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    this.timer = setTimeout(() => this.fail("the voice did not answer"), TIMEOUT_MS);
    try {
      const session = await ai.live.connect({
        model: VOICE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } },
        },
        callbacks: {
          onmessage: (m) => {
            if (this.over) return;
            for (const p of m.serverContent?.modelTurn?.parts ?? []) {
              if (p.inlineData?.data) this.send({ type: "call.audio", data: p.inlineData.data });
            }
            if (m.serverContent?.turnComplete) { this.send({ type: "voice.sample", ok: true, done: true }); this.cancel(); }
          },
          onerror: (e) => this.fail(e?.message ?? "connection error"),
          onclose: (e) => { if (!this.over) this.fail(e?.reason || "the voice hung up"); },
        },
      });
      if (this.over) { try { session.close(); } catch { /* gone */ } return; }
      this.session = session;
      session.sendClientContent({ turns: [{ role: "user", parts: [{ text: LINE }] }], turnComplete: true });
    } catch (err) {
      this.fail(err instanceof Error ? err.message.split("\n")[0] : String(err));
    }
  }

  private fail(why: string) {
    if (this.over) return;
    this.send({ type: "voice.sample", ok: false, why: "voice: " + why });
    this.cancel();
  }

  // Also what a newer request calls on this one: stop quietly (the face clears its own player).
  cancel() {
    this.over = true;
    clearTimeout(this.timer);
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
  }
}
