// The call: Sol's voice. Which vendor carries it is a setting (src/call/vendor.ts has the wire and the pick);
// this file only makes the one the settings name.

import { getSettings } from "./settings.js";
import { pickVendor, haveKeyFor, VENDOR_KEY, type CallOpts, type VoiceCall, type VoiceVendor } from "./call/vendor.js";
import { GeminiCall } from "./call/gemini.js";
import { ElevenCall } from "./call/elevenlabs.js";

export { VOICE_MODEL } from "./call/gemini.js";
export type { CallOpts, VoiceCall, VoiceVendor };

export const voiceVendor = (): VoiceVendor => pickVendor(getSettings().voiceVendor);
export const haveVoiceKey = () => haveKeyFor(voiceVendor());
export const voiceKeyName = () => VENDOR_KEY[voiceVendor()];

export function makeCall(o: CallOpts): VoiceCall {
  const st = getSettings();
  if (voiceVendor() === "elevenlabs") {
    return new ElevenCall(o, { key: process.env.ELEVENLABS_API_KEY ?? "", voice: st.elevenVoice, patienceMs: st.patienceMs, language: st.language });
  }
  return new GeminiCall(o);
}
