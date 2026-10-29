// "Hear it" on ElevenLabs (#24): one short line through the TTS stream, 24 kHz PCM, sent to the face as call.audio like
// Gemini's sample (sample.ts beside the engine). About 55 characters a press, the free tier's budget in mind.
// Face → engine { type: "voice.sample", voice }  (an ElevenLabs voice id; any other falls back to the chosen one).
import { TTS_MODEL } from "./elevenlabs.js";

export const ELEVEN_LINE = "Hey Marco, this is my voice. What are we doing today?";
const TIMEOUT_MS = 20_000;
const CHUNK = 4800;   // 100 ms of 24 kHz 16-bit audio per message

export class ElevenSample {
  private over = false;
  private ctl = new AbortController();
  constructor(private voice: string, private key: string, private send: (m: object) => void,
    private fetcher: typeof fetch = fetch) {}

  async start() {
    if (!this.key) return this.fail("no voice key: put ELEVENLABS_API_KEY in sol/engine/.env");
    const timer = setTimeout(() => this.fail("the voice did not answer"), TIMEOUT_MS);
    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voice)}/stream?output_format=pcm_24000`;
      const r = await this.fetcher(url, {
        method: "POST", signal: this.ctl.signal,
        headers: { "xi-api-key": this.key, "content-type": "application/json" },
        body: JSON.stringify({ text: ELEVEN_LINE, model_id: TTS_MODEL }),
      });
      if (!r.ok || !r.body) {
        const said = await r.text().catch(() => "");
        const why = /quota/i.test(said) ? "the ElevenLabs quota is used up" : r.status === 401 ? "the ElevenLabs key was refused" : `ElevenLabs said ${r.status}`;
        return this.fail(why);
      }
      let held = Buffer.alloc(0);
      for await (const part of r.body as unknown as AsyncIterable<Uint8Array>) {
        if (this.over) return;
        held = Buffer.concat([held, Buffer.from(part)]);
        while (held.length >= CHUNK) { this.send({ type: "call.audio", data: held.subarray(0, CHUNK).toString("base64") }); held = held.subarray(CHUNK); }
      }
      const even = held.length - (held.length % 2);
      if (even && !this.over) this.send({ type: "call.audio", data: held.subarray(0, even).toString("base64") });
      if (!this.over) { this.send({ type: "voice.sample", ok: true, done: true }); this.cancel(); }
    } catch (err) {
      if (!this.over) this.fail(err instanceof Error ? err.message.split("\n")[0] : String(err));
    } finally { clearTimeout(timer); }
  }

  private fail(why: string) {
    if (this.over) return;
    this.send({ type: "voice.sample", ok: false, why: "voice: " + why });
    this.cancel();
  }
  cancel() { this.over = true; this.ctl.abort(); }
}
