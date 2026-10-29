// The call's voice vendor (#24): the pick, and the ElevenLabs call with its two sockets faked. The seat is the brain:
// an utterance from Scribe becomes one ask, the answer's sentences go to the voice as they stream, the voice's audio
// goes to the face, and Marco speaking over Sol clears the face and stops the voice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickVendor, haveKeyFor } from "../src/call/vendor.ts";
import { ElevenCall, speakable, STT_URL, TTS_MODEL, type Sock } from "../src/call/elevenlabs.ts";

class FakeSock implements Sock {
  readyState = 0;
  sent: any[] = [];
  closed = false;
  private h: Record<string, ((...a: any[]) => void)[]> = {};
  constructor(public url: string, public headers: Record<string, string>) {}
  on(ev: string, f: (...a: any[]) => void) { (this.h[ev] ??= []).push(f); }
  emit(ev: string, ...a: unknown[]) { for (const f of this.h[ev] ?? []) f(...a); }
  open() { this.readyState = 1; this.emit("open"); }
  msg(o: object) { this.emit("message", Buffer.from(JSON.stringify(o))); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close(code = 1000) { if (this.closed) return; this.closed = true; this.readyState = 3; this.emit("close", code, Buffer.from("")); }
}

function rig(answer: (text: string, onDelta?: (t: string) => void, abort?: AbortSignal) => Promise<string>) {
  const socks: FakeSock[] = [];
  const face: any[] = [];
  const asked: string[] = [];
  let t = 1_000;
  const call = new ElevenCall({
    home: "/nowhere", history: [], send: (m) => face.push(m), step: () => {},
    ask: (text, abort, onDelta) => { asked.push(text); return answer(text, onDelta, abort); },
  }, {
    key: "k-test", voice: "VOICE123abc", patienceMs: 600, language: "english", now: () => t,
    dial: (url, headers) => { const s = new FakeSock(url, headers); socks.push(s); return s; },
  });
  return { call, socks, face, asked, tick: (ms: number) => { t += ms; } };
}

const tick = () => new Promise((r) => setImmediate(r));

test("the pick: auto is ElevenLabs when its key is set, else Gemini; a named maker wins; the key is the maker's", () => {
  assert.equal(pickVendor("auto", { ELEVENLABS_API_KEY: "x" }), "elevenlabs");
  assert.equal(pickVendor("auto", {}), "gemini");
  assert.equal(pickVendor(undefined, { ELEVENLABS_API_KEY: "x" }), "elevenlabs");
  assert.equal(pickVendor("gemini", { ELEVENLABS_API_KEY: "x" }), "gemini");
  assert.equal(pickVendor("elevenlabs", {}), "elevenlabs");
  assert.equal(haveKeyFor("elevenlabs", { GEMINI_API_KEY: "g" }), false);
  assert.equal(haveKeyFor("gemini", { GEMINI_API_KEY: "g" }), true);
});

test("speakable: the words without markdown, links or code marks", () => {
  assert.equal(speakable("**Sure.** See [the plan](https://x.y/z) and `npm test`."), "Sure. See the plan and npm test.");
  assert.equal(speakable("## Due\n- maths on Friday\n2. essay"), "Due maths on Friday essay");
  assert.equal(speakable("go to https://example.com now"), "go to a link now");
});

test("an ElevenLabs call: Scribe hears, the seat answers, the voice talks, and the face gets the audio", async () => {
  const r = rig(async (_text, onDelta) => { onDelta?.("It is **three** o'clock. "); onDelta?.("Anything"); onDelta?.(" else?"); return "It is three o'clock. Anything else?"; });
  const started = r.call.start();
  const stt = r.socks[0];
  assert.ok(stt.url.startsWith(STT_URL + "?"));
  const q = new URL(stt.url).searchParams;
  assert.equal(q.get("audio_format"), "pcm_16000");
  assert.equal(q.get("commit_strategy"), "vad");
  assert.equal(q.get("vad_silence_threshold_secs"), "0.6");
  assert.equal(q.get("language_code"), "en");
  assert.equal(stt.headers["xi-api-key"], "k-test");
  stt.open();
  stt.msg({ message_type: "session_started", session_id: "s1", config: {} });
  await started;
  assert.deepEqual(r.face.at(-1), { type: "call", ok: true, state: "live" });

  r.call.audio("AAAA");
  assert.deepEqual(stt.sent[0], { message_type: "input_audio_chunk", audio_base_64: "AAAA", commit: false, sample_rate: 16000 });

  stt.msg({ message_type: "partial_transcript", text: "what time" });
  assert.equal(r.face.at(-1).who, "me");
  stt.msg({ message_type: "committed_transcript", text: "what time is it" });
  await tick();
  assert.equal(r.asked.length, 1);
  assert.match(r.asked[0], /on a call/);
  assert.match(r.asked[0], /what time is it$/);
  assert.ok(r.face.some((m) => m.type === "call.text" && m.who === "me" && m.final && m.text === "what time is it"));

  const tts = r.socks[1];
  const tq = new URL(tts.url);
  assert.match(tq.pathname, /\/v1\/text-to-speech\/VOICE123abc\/stream-input$/);
  assert.equal(tq.searchParams.get("output_format"), "pcm_24000");
  assert.equal(tq.searchParams.get("model_id"), TTS_MODEL);
  tts.open();
  assert.equal(tts.sent[0].text, " ");
  assert.deepEqual(tts.sent[1], { text: "It is three o'clock. ", flush: true });
  assert.deepEqual(tts.sent[2], { text: "Anything else? ", flush: true });
  assert.deepEqual(tts.sent[3], { text: "" });

  tts.msg({ audio: "UklGRg==", alignment: null });
  assert.deepEqual(r.face.find((m) => m.type === "call.audio"), { type: "call.audio", data: "UklGRg==" });
  tts.msg({ isFinal: true });
  assert.ok(r.face.some((m) => m.type === "call.text" && m.who === "you" && m.final && m.text === "It is three o'clock. Anything else?"));

  await r.call.end();
  assert.deepEqual(r.face.at(-1), { type: "call", ok: true, state: "ended" });
  assert.equal(stt.closed, true);
});

test("Marco speaks over Sol: the face is cleared, the voice stops, and the rest of that answer is not spoken", async () => {
  let more: ((t: string) => void) | undefined;
  let finish!: () => void;
  const r = rig((_t, onDelta) => { more = onDelta; onDelta?.("Here is a long answer. "); return new Promise((ok) => { finish = () => ok("x"); }); });
  const started = r.call.start();
  r.socks[0].open(); r.socks[0].msg({ message_type: "session_started", session_id: "s", config: {} });
  await started;
  r.socks[0].msg({ message_type: "committed_transcript", text: "tell me everything" });
  await tick();
  const tts = r.socks[1];
  tts.open();
  tts.msg({ audio: "A".repeat(4800) });   // 3600 bytes: 75 ms still to play
  r.socks[0].msg({ message_type: "partial_transcript", text: "wait wait" });
  assert.ok(r.face.some((m) => m.type === "call.clear"));
  assert.equal(tts.closed, true);
  more?.("And more words nobody hears. ");
  assert.equal(r.socks.length, 2, "no new voice for the old answer");
  // what he said is the next turn once the seat is free
  r.socks[0].msg({ message_type: "committed_transcript", text: "wait wait, stop" });
  await tick();
  assert.equal(r.asked.length, 1);
  finish();
  await tick(); await tick();
  assert.equal(r.asked.length, 2);
  assert.match(r.asked[1], /^wait wait, stop/);
  await r.call.end();
});

test("a refused key ends the call with the reason", async () => {
  const r = rig(async () => "");
  const started = r.call.start();
  r.socks[0].open(); r.socks[0].msg({ message_type: "session_started", session_id: "s", config: {} });
  await started;
  r.socks[0].msg({ message_type: "quota_exceeded", error: "no characters left" });
  assert.ok(r.face.some((m) => m.type === "call" && m.ok === false && /no characters left/.test(m.why)));
  assert.deepEqual(r.face.at(-1), { type: "call", ok: true, state: "ended" });
});

test("Scribe refusing at the start fails the start", async () => {
  const r = rig(async () => "");
  const started = r.call.start();
  r.socks[0].open(); r.socks[0].msg({ message_type: "auth_error", error: "invalid api key" });
  await assert.rejects(started, /invalid api key/);
  assert.equal(r.call.done, true);
});

test("hanging up stops the turn the seat is still on, quietly", async () => {
  let stopped = false;
  const r = rig((_t, _d, abort) => new Promise((_ok, no) => abort?.addEventListener("abort", () => { stopped = true; no(new Error("stopped")); })));
  const started = r.call.start();
  r.socks[0].open();
  r.socks[0].msg({ message_type: "session_started", session_id: "s1", config: {} });
  await started;
  r.socks[0].msg({ message_type: "committed_transcript", text: "write me a long essay" });
  await tick();
  assert.equal(r.asked.length, 1);
  await r.call.end();
  await tick();
  assert.equal(stopped, true, "the seat's turn was aborted");
  assert.equal(r.face.filter((m) => m.type === "tool").length, 0, "no 'did not finish' note for a hang-up");
  assert.deepEqual(r.face.at(-1), { type: "call", ok: true, state: "ended" });
});
