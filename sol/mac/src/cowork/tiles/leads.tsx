// A tile: who leads what (#117), the six labels and their leads as CODEOWNERS says them on main. Read-only, like every
// tile; the owner sets them with one press from the action board's head (Leads.tsx).
import type { TileDef } from "./index";
import { PersonDot } from "../bits";
import { LABELS, leadsOf } from "../useTeam";
import "../leads.css";

const leads: TileDef = {
  name: "who leads what",
  Tile: ({ team, board }) => {
    if (!board.repos.some((r) => board.leads?.[r])) return <p className="ctile-none">no CODEOWNERS read yet</p>;
    const s = team.state;
    return (
      <ul className="ctile-list">
        {LABELS.map((l) => {
          const who = leadsOf(board, l);
          return (
            <li key={l}>
              <span className="clabel">{l}</span>
              {who.length ? who.map((p) => (
                <span key={p} className="clead"><PersonDot login={p} roster={s?.roster ?? []} up={!!s?.relay.up} me={team.me} /><b>{p}</b></span>
              )) : <span className="cdim">nobody</span>}
            </li>
          );
        })}
      </ul>
    );
  },
};
export default leads;
