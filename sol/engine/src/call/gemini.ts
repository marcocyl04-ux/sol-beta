// The call on Gemini Live (one of the voice vendors, src/call/vendor.ts). Gemini's model talks; the seat is asked.
//
// The voice hears 16 kHz PCM from the face and answers in 24 kHz PCM. It knows the Home instructions and
// the conversation so far, and it has one tool, ask_sol: anything that needs files, memory, the web or the
// browser goes to the seat as an ordinary turn on the same conversation, and the answer comes back to the
// voice (NON_BLOCKING, so the voice keeps talking while the seat works). At hang-up the transcript goes to
// the seat once more, so what was said is in the thread and anything worth keeping gets written down.
// The wire to the face is the one every vendor speaks (vendor.ts).

import { GoogleGenAI, Modality, Behavior, FunctionResponseScheduling, Type, type Session, type LiveServerMessage, type Content } from "@google/genai";
import { join as joinBusy } from "../busy.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getSettings, languageLine } from "../settings.js";
import type { CallOpts, VoiceCall } from "./vendor.js";

export const VOICE_MODEL = "gemini-3.8-live";
const MIME_IN = "audio/pcm;rate=16000";
const HISTORY_CHARS = 8000;

function voiceInstructions(home: string): string {
  let agents = "";
  try { agents = readFileSync(join(home, "AGENTS.md"), "utf8"); } catch { /* no Home instructions */ }
  let memory = "";
  try {
    for (const f of readdirSync(join(home, "memory")).filter((f) => f.endsWith(".md")).sort()) {
      memory += `\n--- ${f}\n` + readFileSync(join(home, "memory", f), "utf8").trim() + "\n";
    }
  } catch { /* no memory yet */ }
  return [
    "You are Sol's voice: Sol talking with Marco out loud, on a call. Same Sol as the chat, same memory, same conversation.",
    "You have known Marco for a while. Never introduce yourself, never ask how you can help, never say his name more than a friend would.",
    "Pick up where things left off: the conversation so far is in front of you, so that is where you are, and what Sol remembers about him is how you talk to him.",
    "Talk like a person on the phone: short, warm, plain. One or two sentences at a time, then let him talk. No lists, no headers, no markdown, never read out file paths or code.",
    "You cannot see files, the web or the browser yourself. Everything that needs them, Sol can: call ask_sol with a clear request in Marco's words",
    "(what is due this week, open the syllabus, write that down, remember that I ...). Say you are checking, keep the conversation going if he keeps talking, and tell him what came back when it arrives.",
    "Do not guess at facts that ask_sol can look up. Do not promise things you did not ask Sol to do.",
    "If he tells you something worth keeping, ask Sol to write it down (ask_sol), once, briefly.",
    languageLine(getSettings().language),
    "",
    "Sol's own instructions, so you know the house:",
    agents.trim(),
    memory ? "\nWhat Sol remembers about Marco:" + memory : "",
  ].join("\n");
}

function historyTurns(history: CallOpts["history"]): Content[] {
  const turns: Content[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0 && used < HISTORY_CHARS; i--) {
    const h = history[i];
    const text = h.text.length > 2000 ? h.text.slice(0, 2000) + " …" : h.text;
    used += text.length;
    turns.unshift({ role: h.who === "me" ? "user" : "model", parts: [{ text }] });
  }
  return turns;
}

export class GeminiCall implements VoiceCall {
  private ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  private session: Session | null = null;
  private handle: string | undefined;
  private ended = false;
  private opened = false;
  private reconnects = 0;
  private line = { me: { id: "", text: "" }, you: { id: "", text: "" } };
  private transcript: { who: "me" | "you"; text: string }[] = [];
  private asks = new Map<string, AbortController>();
  private writeback: Promise<void> | null = null;
  private leave = () => {};   // the call on the busy counter (busy.ts)

  constructor(private o: CallOpts) {}
  get done() { return this.ended; }

  async start() {
    this.leave = joinBusy("call", randomUUID(), VOICE_MODEL);
    try { await this.connect(); } catch (err) { this.leave(); throw err; }
  }

  private async connect() {
    const first = !this.opened;
    const st = getSettings(); // read on every (re)connect: a long call keeps the voice it started with only until Google resumes it
    const session = await this.ai.live.connect({
      model: VOICE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: st.voice } } },
        systemInstruction: voiceInstructions(this.o.home),
        tools: [{
          functionDeclarations: [{
            name: "ask_sol",
            description: "Ask Sol (the same assistant, with files, memory, the web and the browser) to look something up, do something, or write something down. Returns Sol's answer. Takes a few seconds to a minute; keep talking meanwhile.",
            parameters: { type: Type.OBJECT, properties: { request: { type: Type.STRING, description: "the request, in plain words, with everything Sol needs to know" } }, required: ["request"] },
            behavior: Behavior.NON_BLOCKING,
          }],
        }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: st.patienceMs, prefixPaddingMs: 100 } },
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: this.handle ? { handle: this.handle } : {},
      },
      callbacks: {
        onopen: () => {
          if (this.ended) return;   // hung up while connecting: no "live" for a call that is over
          this.opened = true;
          if (first) {
            const turns = historyTurns(this.o.history);
            if (turns.length) this.session?.sendClientContent({ turns, turnComplete: false });
            this.o.send({ type: "call", ok: true, state: "live" });
          }
        },
        onmessage: (m) => this.onMessage(m),
        onerror: (e) => { if (!this.ended) this.o.send({ type: "call", ok: false, why: "voice: " + (e?.message ?? "connection error") }); },
        onclose: (e) => {
          if (this.ended) return;
          // the connection has a lifetime; the session can be resumed on a new one
          if (this.handle && this.reconnects < 5) { this.reconnects++; void this.connect().catch((err) => this.fail(err)); }
          else this.fail(new Error(e?.reason || "the voice hung up"));
        },
      },
    });
    // a hang-up during "Connecting" found no session to close: close it now, so no ghost call talks on
    if (this.ended) { try { session.close(); } catch { /* already closed */ } return; }
    this.session = session;
  }

  private fail(err: unknown) {
    if (this.ended) return;
    this.o.send({ type: "call", ok: false, why: "voice: " + (err instanceof Error ? err.message : String(err)) });
    void this.end();
  }

  audio(data: string) {
    if (this.ended || !this.session) return;
    try { this.session.sendRealtimeInput({ audio: { data, mimeType: MIME_IN } }); } catch { /* closing */ }
  }

  private emit(who: "me" | "you", text: string) {
    const l = this.line[who];
    if (!l.id) l.id = randomUUID();
    l.text += text;
    this.o.send({ type: "call.text", id: l.id, who, text: l.text, final: false });
  }
  private flush(who: "me" | "you") {
    const l = this.line[who];
    if (!l.id) return;
    const text = l.text.trim();
    if (text) { this.transcript.push({ who, text }); this.o.send({ type: "call.text", id: l.id, who, text, final: true }); }
    else this.o.send({ type: "call.text", id: l.id, who, text: "", final: true });
    this.line[who] = { id: "", text: "" };
  }

  private onMessage(m: LiveServerMessage) {
    const c = m.serverContent;
    if (c) {
      if (c.interrupted) { this.o.send({ type: "call.clear" }); this.flush("you"); }
      if (c.inputTranscription?.text) {
        if (this.line.you.id) { this.flush("you"); this.flush("me"); } // he is speaking again: new exchange
        this.emit("me", c.inputTranscription.text);
      }
      if (c.outputTranscription?.text) {
        if (this.line.me.id && this.line.you.id === "") this.flush("me");
        this.emit("you", c.outputTranscription.text);
      }
      for (const p of c.modelTurn?.parts ?? []) {
        if (p.inlineData?.data) this.o.send({ type: "call.audio", data: p.inlineData.data });
      }
      if (c.turnComplete) { this.flush("me"); this.flush("you"); }
    }
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) this.handle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) { /* the close that follows reconnects with the handle */ }
    if (m.toolCallCancellation?.ids) for (const id of m.toolCallCancellation.ids) { this.asks.get(id)?.abort(); this.asks.delete(id); }
    for (const fc of m.toolCall?.functionCalls ?? []) void this.onAsk(fc.id ?? randomUUID(), fc.name ?? "", (fc.args ?? {}) as Record<string, unknown>);
  }

  private async onAsk(id: string, name: string, args: Record<string, unknown>) {
    const request = String(args.request ?? "").trim();
    if (name !== "ask_sol" || !request) {
      this.session?.sendToolResponse({ functionResponses: [{ id, name, response: { error: "unknown tool" }, scheduling: FunctionResponseScheduling.SILENT }] });
      return;
    }
    const abort = new AbortController();
    this.asks.set(id, abort);
    this.o.step({ id: "ask-" + id, kind: "note", text: `the voice asks Sol: ${request}`, done: false });
    let result = "";
    let ok = true;
    try {
      result = await this.o.ask(`${request}\n\n(Marco asked this on the call; answer plainly, it will be read out loud.)`, abort.signal);
    } catch (err) {
      ok = false;
      result = "Sol could not do that: " + (err instanceof Error ? err.message : String(err));
    }
    this.o.step({ id: "ask-" + id, kind: "note", text: `the voice asks Sol: ${request}`, done: true, ok, detail: result.slice(0, 4000) || undefined });
    if (abort.signal.aborted || this.ended) return;
    this.asks.delete(id);
    this.session?.sendToolResponse({
      functionResponses: [{ id, name, response: { answer: result || "(no answer)" }, scheduling: FunctionResponseScheduling.WHEN_IDLE }],
    });
  }

  // Hang up: close the voice, then hand the transcript to the seat so the thread has it.
  async end() {
    if (this.ended) return this.writeback ?? undefined;
    this.ended = true;
    this.leave();
    for (const a of this.asks.values()) a.abort();
    this.asks.clear();
    this.flush("me"); this.flush("you");
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
    this.o.send({ type: "call", ok: true, state: "ended" });
    if (this.transcript.length) {
      const lines = this.transcript.map((t) => `${t.who === "me" ? "Marco" : "Sol (voice)"}: ${t.text}`).join("\n");
      const id = "call-" + randomUUID();
      this.o.step({ id, kind: "note", text: "keeping the call", done: false });
      this.writeback = this.o.ask(
        `We just talked on a call. This is the transcript; it is already part of this conversation, so do not repeat it.\n\n${lines}\n\n` +
        "If anything in it is worth keeping (a fact about Marco, a plan, something for a class), write it down where it belongs. Then answer in one short line.",
        new AbortController().signal,
      ).then(() => { this.o.step({ id, kind: "note", text: "kept the call", done: true, ok: true }); },
        (err) => { this.o.step({ id, kind: "note", text: "could not keep the call", done: true, ok: false, detail: String(err) }); });
      return this.writeback;
    }
  }
}
