import { PrPane, prChecks } from "../work/Panes";
import type { ButtonDef } from "./types";

// the branch's pull request; on the bar its ticket, the dot its checks
export default {
  id: "pr", name: "pull request", kind: "pane", meant: ["home"], glyph: "PR",
  says: "the pull request without the website: its state, its checks, every comment",
  shows: ({ shell: s }) => !!s?.pr,
  where: "in a session that has a PR",
  badge: ({ shell: s }) => <>#{s!.pr!.number}<i /></>,
  look: ({ shell: s }) => { const pr = s!.pr!, c = prChecks(pr); return `wticket ${pr.isDraft ? "draft" : pr.state.toLowerCase()} ${c.bad ? "bad" : c.run ? "run" : ""}`; },
  hover: ({ shell: s }) => { const pr = s!.pr!, c = prChecks(pr); return `${pr.title}${c.n ? `\n${c.n - c.bad - c.run} of ${c.n} checks passed` : ""}`; },
  Pane: ({ shell: s }) => <PrPane pr={s!.pr} state={s!.prState} onRefresh={s!.askPr} onOpen={s!.openUrl} />,
} satisfies ButtonDef;
