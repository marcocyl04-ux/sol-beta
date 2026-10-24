// Conversation names. The CLIs title a conversation with its first message cut at 60 characters; Sol gives it
// a real name of 2 to 6 words after the first answer, using Gemini (the same key as the voice) on a cheap
// text model. Names live in engine/titles.json { [sessionId]: title } (gitignored); threads.ts applies them.
// No key, or any error: the cut first message stays. The CLIs' own files are never touched.

import { GoogleGenAI } from "@google/genai";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "titles.json");
let titles: Record<string, string> | null = null;

export function getTitles(): Record<string, string> {
  if (titles) return titles;
  try { titles = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string>; } catch { titles = {}; }
  return titles;
}

// An empty title clears the override (back to the cut first message).
export function setTitle(sessionId: string, title: string) {
  const t = getTitles();
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 120);
  if (clean) t[sessionId] = clean; else delete t[sessionId];
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(t, null, 2) + "\n");
  renameSync(tmp, FILE);
}

// ---- the naming model ----

let ai: GoogleGenAI | null = null;
let model: Promise<string | null> | null = null;
const key = () => process.env.GEMINI_API_KEY;

// Newest "flash" text model that can generateContent, found once. Names carry versions: gemini-2.5-flash, gemini-3-flash-preview ...
async function findModel(): Promise<string | null> {
  if (!key()) return null;
  ai ??= new GoogleGenAI({ apiKey: key() });
  try {
    const found: { name: string; v: number[] }[] = [];
    for await (const m of await ai.models.list()) {
      const name = (m.name ?? "").replace(/^models\//, "");
      if (!name.includes("flash") || /live|tts|image|audio|embed|robot|computer|exp|vision|thinking/.test(name)) continue;
      if (m.supportedActions && !m.supportedActions.includes("generateContent")) continue;
      found.push({ name, v: (name.match(/\d+(\.\d+)?/g) ?? []).map(Number) });
    }
    const cmp = (a: number[], b: number[]) => { for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0); return 0; };
    // newest version first; of the same version a plain flash before a lite one, a stable name before a preview
    found.sort((a, b) => cmp(a.v, b.v) || Number(a.name.includes("lite")) - Number(b.name.includes("lite")) || Number(a.name.includes("preview")) - Number(b.name.includes("preview")));
    return found[0]?.name ?? null;
  } catch (err) {
    console.log("titles: could not list models:", err instanceof Error ? err.message.split("\n")[0] : String(err));
    return null;
  }
}
export const namingModel = () => (model ??= findModel());

const clip = (s: string) => (s.length > 1500 ? s.slice(0, 1500) : s);

// Google answers 503 in demand spikes: a couple more tries, a moment apart, then give up quietly (#111).
async function patient<T>(ask: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await ask(); } catch (err) {
      if (i >= tries || !/503|UNAVAILABLE|429/.test(String((err as any)?.message ?? err))) throw err;
      await new Promise((ok) => setTimeout(ok, 2500 * i));
    }
  }
}

// Two to six lowercase words for a conversation, or null if it cannot be done.
export async function nameConversation(first: string, answer: string): Promise<string | null> {
  const m = await namingModel();
  if (!m || !ai) return null;
  try {
    const r = await patient(() => ai!.models.generateContent({
      model: m,
      contents: `Marco: ${clip(first)}\n\nSol: ${clip(answer)}\n\nName this conversation in 2 to 6 plain lowercase words, no quotes, no period. Reply with the name only.`,
    }));
    const t = (r.text ?? "").split("\n")[0].toLowerCase().replace(/["'`.*#]/g, "").replace(/\s+/g, " ").trim();
    const words = t.split(" ").filter(Boolean);
    return words.length >= 1 && words.length <= 8 ? words.slice(0, 6).join(" ") : null;
  } catch (err) {
    console.log("titles: naming failed:", err instanceof Error ? err.message.split("\n")[0] : String(err));
    return null;
  }
}

// What happened on a branch of a conversation, in one or two plain sentences (the fold-in note), or null.
export async function summariseBranch(prompts: string[], said: string): Promise<string | null> {
  const m = await namingModel();
  if (!m || !ai) return null;
  try {
    const r = await ai.models.generateContent({
      model: m,
      contents: `Marco asked, in order:\n${prompts.map((p) => "- " + clip(p).slice(0, 300)).join("\n")}\n\nClaude's last answer: ${clip(said)}\n\n` +
        "In one or two plain sentences, say what happened in this conversation branch, for Marco reading it later. No preamble, no quotes.",
    });
    const t = (r.text ?? "").replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 400) : null;
  } catch (err) {
    console.log("titles: summary failed:", err instanceof Error ? err.message.split("\n")[0] : String(err));
    return null;
  }
}

// Which of a folder's topic groups a fresh Work session belongs in, from its first message (#71), or null: the groups
// are numbered, the model answers one number (0 = none). Cheap: one short call, one word back.
export const topicFrom = (text: string, n: number): number | null => {
  const k = Number(/\d+/.exec(text)?.[0] ?? 0);
  return k >= 1 && k <= n ? k - 1 : null;
};
export async function pickTopic(first: string, abouts: string[]): Promise<number | null> {
  if (!abouts.length) return null;
  const m = await namingModel();
  if (!m || !ai) return null;
  try {
    const r = await patient(() => ai!.models.generateContent({
      model: m,
      contents: `Marco's first message to a new coding session: ${clip(first).slice(0, 800)}\n\nGroups:\n${abouts.map((a, i) => `${i + 1}. ${a}`).join("\n")}\n\n` +
        "Which group is this session for? Reply with its number only, or 0 if none fits.",
    }));
    return topicFrom(r.text ?? "", abouts.length);
  } catch (err) {
    console.log("titles: topic failed:", err instanceof Error ? err.message.split("\n")[0] : String(err));
    return null;
  }
}
