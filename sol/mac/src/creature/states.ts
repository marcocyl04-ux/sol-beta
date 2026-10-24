// The creature's eight states, the wire's names (sol/PROTOCOL.md "creature"; engine/src/creature.ts has the same list).
// The engine derives them and sends creature.state; the face only adds Unplugged, when it cannot reach the engine.
export const CREATURE_STATES = ["here", "elsewhere", "away", "working", "yourcall", "listening", "speaking", "unplugged"] as const;
export type CreatureState = (typeof CREATURE_STATES)[number];
export type Flash = "done" | "wrong";
export const FLASH_MS: Record<Flash, number> = { done: 900, wrong: 2500 };
// Each state's sentence (design/companion/PRD.md), for the contact sheets and for a reader of the code.
export const SENTENCE: Record<CreatureState, string> = {
  here: "I'm with you.", elsewhere: "I see you're on the Mac but not in Sol.", away: "You left the desk.",
  working: "I'm on it.", yourcall: "I need you.", listening: "Go on.", speaking: "Hear me.", unplugged: "Plug me back in?",
};
