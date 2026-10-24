import type { ButtonDef } from "./types";

// the review seat: Codex reads the branch's whole change, read-only, and its remarks come into the talk as a card
export default {
  id: "review", name: "review", kind: "press", meant: ["home"], glyph: "review",
  says: "a second pair of eyes: Codex reads the whole branch and says what is wrong before anyone else can",
  shows: ({ shell, session, cwd }) => !!shell && !!session && !!cwd,
  where: "in a session that has a folder",
  on: ({ shell }) => !!shell?.items.some((i) => i.kind === "review" && i.head && i.busy),
  press: ({ w, cwd, flash }) => { void w!.review(cwd!, "all").then((r) => { if (r.error) flash(r.error); }); },
} satisfies ButtonDef;
