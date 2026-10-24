import type { ButtonDef } from "./types";

// Show (#101): a running session on a team issue, shown read-only to the team while the switch is on
// bypass: glyph, because "show to team" is the switch's own words since #101, and two of them would not say who sees
export default {
  id: "show-to-team", name: "show to team", kind: "press", meant: ["home"], glyph: "show to team",
  says: "let the team watch this session read-only: your prompts, the replies and tool names, never files or diffs",
  shows: ({ session, w, shell }) => !!shell && !!session && !!w?.run?.issue && !!(w.run.relay || w.run.shown),
  where: "in a session on a team issue",
  badge: ({ w }) => w!.run!.shown ? <><i className="wshowdot" />shown to team</> : "show to team",
  look: () => "wviewk wshowk",   // not .wshow: that is the Show pane's own box (work.css), tall and padded
  on: ({ w }) => !!w!.run!.shown,
  hover: ({ w }) => w!.run!.shown ? `the team sees this session (#${w!.run!.issue}) read-only: click to stop; one line on the issue says what was done`
    : `let the team watch this session read-only, tagged #${w!.run!.issue}: your prompts, my replies and tool names, never files or diffs`,
  press: ({ w, session, flash }) => {
    void w!.ask<{ shown?: boolean; note?: string; error?: string }>("work.show", { sessionId: session, on: !w!.run?.shown }, 60_000).then((r) => {
      if (r.error) flash(r.error); else if (r.note) flash(r.note);
    });
  },
} satisfies ButtonDef;
