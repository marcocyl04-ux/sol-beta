import { ActionBoard, ACTIONS_HOWTO, openInHome } from "../cowork/ActionBoard";
import { WithTeam } from "./Team";
import type { ButtonDef } from "./types";

// the action board: each card's ⋯ acts (open in Home, try it, hand it on); beside a session, its issue's card is marked
export default {
  id: "action-board", name: "action board", kind: "pane", meant: ["cowork"], glyph: "action board",
  says: "the team's cards, beside whatever you're doing: open one, try it, hand it on",
  Pane: (c) => <WithTeam c={c}>{(team) => {
    const folder = team.board?.folders[team.board.repos[0]];
    return <ActionBoard team={team} issue={c.shell ? c.w?.run?.issue : undefined}
      onOpenWork={(card) => c.w && c.talk && openInHome(card, c.w, team.board?.folders ?? {}, c.talk)}
      onNewAction={() => { if (folder && c.shell) c.shell.toFile(`${folder}/${ACTIONS_HOWTO}`); else c.flash("open a session in the team's folder to read how an action is made"); }} />;
  }}</WithTeam>,
} satisfies ButtonDef;
