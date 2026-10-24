import type { ButtonDef } from "./types";

// how much of the work the talk shows: normal, thinking, verbose, round
export default {
  id: "talk-view", name: "talk view", kind: "press", meant: ["home"], glyph: "normal", key: "⌃O",
  shows: ({ shell }) => !!shell,
  where: "in a session",
  says: "how much of the work you watch: the talk, the thinking, or every step",
  badge: ({ shell: s }) => s?.view,
  press: ({ shell: s }) => s?.cycleView(),
} satisfies ButtonDef;
