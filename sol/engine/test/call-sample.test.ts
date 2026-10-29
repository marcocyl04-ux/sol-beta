// "Hear it" on ElevenLabs (#24, round three): one short line through the TTS stream, as call.audio, then done
import { test } from "node:test";
import assert from "node:assert/strict";
import { ElevenSample, ELEVEN_LINE } from "../src/call/sample.ts";

const body = (...parts: number[]) => new ReadableStream<Uint8Array>({ start(c) { for (const n of parts) c.enqueue(new Uint8Array(n)); c.close(); } });

test("a short line, the chosen voice, the key in a header; the audio in even chunks; then done", async () => {
  assert.ok(ELEVEN_LINE.length <= 60, "about 60 characters a press");
  const out: any[] = [], seen: { url: string; init: any }[] = [];
  const fake = (async (url: string, init: any) => { seen.push({ url, init }); return new Response(body(3000, 3001)); }) as unknown as typeof fetch;
  await new ElevenSample("VOICE123abc", "k-test", (m) => out.push(m), fake).start();
  assert.match(seen[0].url, /text-to-speech\/VOICE123abc\/stream\?output_format=pcm_24000/);
  assert.equal(seen[0].init.headers["xi-api-key"], "k-test");
  assert.equal(JSON.parse(seen[0].init.body).text, ELEVEN_LINE);
  const audio = out.filter((m) => m.type === "call.audio").map((m) => Buffer.from(m.data, "base64").length);
  assert.deepEqual(audio, [4800, 1200], "6001 bytes: 100 ms, then the rest made even");
  assert.deepEqual(out.at(-1), { type: "voice.sample", ok: true, done: true });
});

test("no key, a refused key, a used-up quota: one line, never the key", async () => {
  const out: any[] = [];
  await new ElevenSample("V", "", (m) => out.push(m)).start();
  assert.match(out[0].why, /ELEVENLABS_API_KEY/);
  const refuse = (status: number, text: string) => (async () => new Response(text, { status })) as unknown as typeof fetch;
  const a: any[] = [];
  await new ElevenSample("V", "secret-key", (m) => a.push(m), refuse(401, "{}")).start();
  assert.match(a[0].why, /key was refused/);
  const b: any[] = [];
  await new ElevenSample("V", "secret-key", (m) => b.push(m), refuse(429, '{"detail":{"status":"quota_exceeded"}}')).start();
  assert.match(b[0].why, /quota/);
  assert.ok(![...a, ...b].some((m) => JSON.stringify(m).includes("secret-key")));
});
