// Gemini Live's prebuilt voices, each with the one word Google gives it. "off" first: Sol listens and writes, it does
// not talk, and no call starts from any face (the engine refuses one with a plain why).
export const VOICE_OFF = "off";
export const VOICES: [string, string][] = [
  [VOICE_OFF, "listens, does not talk"],
  ["Zephyr", "bright"], ["Puck", "upbeat"], ["Charon", "informative"], ["Kore", "firm"], ["Fenrir", "excitable"],
  ["Leda", "youthful"], ["Orus", "firm"], ["Aoede", "breezy"], ["Callirrhoe", "easy-going"], ["Autonoe", "bright"],
  ["Enceladus", "breathy"], ["Iapetus", "clear"], ["Umbriel", "easy-going"], ["Algieba", "smooth"], ["Despina", "smooth"],
  ["Erinome", "clear"], ["Algenib", "gravelly"], ["Rasalgethi", "informative"], ["Laomedeia", "upbeat"], ["Achernar", "soft"],
  ["Alnilam", "firm"], ["Schedar", "even"], ["Gacrux", "mature"], ["Pulcherrima", "forward"], ["Achird", "friendly"],
  ["Zubenelgenubi", "casual"], ["Vindemiatrix", "gentle"], ["Sadachbia", "lively"], ["Sadaltager", "knowledgeable"], ["Sulafat", "warm"],
];

// ElevenLabs' premade voices offered when ElevenLabs carries the call (#24; the engine's ELEVEN_VOICES): id, name, word.
export const ELEVEN_VOICES: [string, string, string][] = [
  ["EXAVITQu4vr4xnSDxMaL", "Sarah", "reassuring"], ["cgSgspJ2msm6clMCkdW9", "Jessica", "bright"], ["SAz9YHcvj6GT2YYXdXww", "River", "relaxed"],
  ["Xb7hH8MSUJpSbSDYk0k2", "Alice", "clear"], ["pFZP5JQG7iQjIQuC4Bku", "Lily", "velvety"], ["CwhRBWXzGAHq8TQ4Fs17", "Roger", "laid-back"],
  ["cjVigY5qzO86Huf0OWal", "Eric", "smooth"], ["iP95p4xoKVk53GoZ742B", "Chris", "down-to-earth"], ["bIHbv24MWmeRgasZH58o", "Will", "optimist"],
  ["JBFqnCBsd6RMkjVDRZzb", "George", "warm"],
];
export const ELEVEN_DEFAULT = "EXAVITQu4vr4xnSDxMaL";
// who carries the call: auto is ElevenLabs when its key is in the engine's .env, else Gemini Live
export const MAKERS: [string, string][] = [["auto", "auto"], ["elevenlabs", "ElevenLabs, Sol answers"], ["gemini", "Gemini Live"]];
