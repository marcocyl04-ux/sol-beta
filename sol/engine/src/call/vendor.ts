// The call's voice vendor, a part that can be swapped (#24). Every vendor speaks the same wire to the face, and every
// vendor reaches the seat through the same ask: the engine (index.ts) does not know which one carries the call.
//
// Face → engine:  { type: "call", seat?, sessionId?, draft?, model?, effort? }   start
//                 { type: "call.audio", data }      base64 16-bit PCM, 16 kHz, mono
//                 { type: "call.end" }
// Engine → face:  { type: "call", ok: true, state: "live" | "ended" } | { type: "call", ok: false, why }
//                 { type: "call.audio", data }      base64 16-bit PCM, 24 kHz, mono; play in order
//                 { type: "call.clear" }            Marco spoke over it: drop what has not played yet
//                 { type: "call.text", id, who: "me" | "you", text, final }   a transcript line, growing until final
//
// The vendors:
//   gemini      Gemini Live hears, thinks and talks; it asks the seat through a tool (gemini.ts)
//   elevenlabs  ElevenLabs hears (Scribe) and talks (TTS); the seat itself is the brain, every utterance is a turn
//               on the call's conversation (elevenlabs.ts)
// Settings' voiceVendor picks one; "auto" is ElevenLabs when ELEVENLABS_API_KEY is in sol/engine/.env, else Gemini.

import type { VoiceVendorPick } from "../settings.js";

export type VoiceVendor = "gemini" | "elevenlabs";

export type CallOpts = {
  home: string;
  history: { who: "me" | "you"; text: string }[];
  send: (m: object) => void;
  // Run one seat turn on this conversation and resolve with its answer text; onDelta hears the answer as it streams.
  ask: (text: string, abort: AbortSignal, onDelta?: (text: string) => void) => Promise<string>;
  // Show one step in the face (kind "note"), for what the voice asked the seat.
  step: (s: { id: string; kind: "note"; text: string; done: boolean; ok?: boolean; detail?: string }) => void;
};

export interface VoiceCall {
  readonly done: boolean;
  start(): Promise<void>;
  audio(data: string): void;
  end(): Promise<void>;
}

export const VENDOR_KEY: Record<VoiceVendor, string> = { gemini: "GEMINI_API_KEY", elevenlabs: "ELEVENLABS_API_KEY" };

export function pickVendor(pick: VoiceVendorPick | undefined, env: NodeJS.ProcessEnv = process.env): VoiceVendor {
  if (pick === "gemini" || pick === "elevenlabs") return pick;
  return env.ELEVENLABS_API_KEY ? "elevenlabs" : "gemini";
}

export const haveKeyFor = (v: VoiceVendor, env: NodeJS.ProcessEnv = process.env) => !!env[VENDOR_KEY[v]];
