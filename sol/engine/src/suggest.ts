// Home offers a group once (#321, Cowork PRD §9.1). When the person is doing something with others, the Home seat may
// call `suggest_group { name? }`; the face draws one card under the answer ("want a group for this?"), and nothing else
// happens until the person presses. The engine only remembers, in memory, which conversations were offered one, so a
// second call in the same conversation is answered "already offered" and sends nothing. It moves no data and makes no
// group: the card's "open a new group" only opens the form in Cowork with the name filled.
// Sent to the faces: { type: "home.suggest", sessionId, name } (sol/PROTOCOL.md, round 56).

import { z } from "zod";
import type { ToolResult, TurnCtx } from "./browser.js";

export const NAME_MAX = 40;   // a group's name in the sidebar's row: a few words, never a sentence
const KEEP = 1000;            // conversations remembered; the oldest is forgotten past this (a long-running engine)

const offered = new Set<string>();
let tell: (m: object) => void = () => {};

/** where the face event goes: index.ts hands in "every face" */
export function setSuggestSend(fn: (m: object) => void) { tell = fn; }

/** a name from the seat, made safe for one row: control and direction characters out, one line, at most NAME_MAX characters */
export function cleanName(raw: unknown): string {
  const t = String(raw ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return [...t].slice(0, NAME_MAX).join("").trim();
}

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

export const SUGGEST_TOOLS = [
  {
    name: "suggest_group",
    description: `Offer the person a group in Cowork for what they are doing with others (teammates, classmates, friends, ` +
      `a group project). The face shows one small card under your answer: open a new group, add to a group they are in, ` +
      `or skip. It moves nothing and makes nothing; the person decides. Once per conversation: a second call is refused. ` +
      `name: a short name for the group from the conversation, at most ${NAME_MAX} characters, or leave it out.`,
    shape: {
      name: z.string().max(NAME_MAX).optional().describe(`A short name for the group, at most ${NAME_MAX} characters.`),
    },
  },
];

/** the tools only Home's seats get: Work's runs leave them out (work/runs.ts) */
export const HOME_ONLY = new Set(SUGGEST_TOOLS.map((t) => t.name));

/** the tool: "shown" and one home.suggest to the faces, once per conversation; Home's seats only */
export async function runSuggestTool(_name: string, args: unknown, turn: TurnCtx = {}): Promise<ToolResult> {
  if (turn.seat === "work") return text("suggest_group is Home's; Work sessions do not offer groups", true);
  const sessionId = turn.sessionId;
  if (!sessionId) return text("no conversation to offer a group in", true);
  if (offered.has(sessionId)) return text("already offered");
  offered.add(sessionId);
  if (offered.size > KEEP) offered.delete(offered.values().next().value!);
  const name = cleanName((args as { name?: unknown } | null)?.name);
  tell({ type: "home.suggest", sessionId, name });
  return text("shown");
}
