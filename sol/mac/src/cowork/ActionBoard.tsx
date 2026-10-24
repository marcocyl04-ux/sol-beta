// The action board (Together, See #31): the dashboard's cards on the same one line, and here they act. Each card has a
// ⋯ (and a right-click) with the memo's items: open in Work, try it, ask for a review, mark ready, comment, hand to
// each member, the team's own actions (actions/), and last "+ an action: one file on a branch". See builds the frame
// and "open in Work"; Ship, Hand and Try fill their items where marked `// ship`, `// hand`, `// try`. Until their
// slice is merged an item is present and disabled, with the note "not built yet". Every card shows its signature.
import { useState } from "react";
import { Menu, type MenuItem } from "../work/Menu";
import type { Card, Team } from "./useTeam";
import type { Work } from "../work/useWork";
import type { Talk } from "../buttons";
import { Columns } from "./Dashboard";
import { ACTIONS } from "./actions";
import { readAgo } from "./bits";
import { Stamp } from "./Stamp";
import { Leads } from "./Leads";   // the owner's press (#117)
// --- Hand (#34)
import { handItems, HandsRecord } from "./Hands";
// --- end Hand
// --- Try (#35)
import { tryItems } from "./TryPane";
// --- end Try

// where an action is explained, in the team's checkout
export const ACTIONS_HOWTO = "sol/mac/src/cowork/actions/README.md";

// "open in Home": the one way across. My cowork session on that issue loses its mark and opens; with none, a new session
// opens in the repo's folder with the issue in the box. `talk` is where it opens: Home's stage, or Home from Cowork
export function openInHome(c: Card, w: Pick<Work, "sessions" | "mark">, folders: Record<string, string>, talk: (to: Talk) => void) {
  const mine = w.sessions.find((s) => s.mode === "cowork" && s.title.startsWith(`#${c.number} `));
  if (mine) { w.mark(mine.id, { mode: null }); talk({ session: mine.id }); return; }
  talk({ cwd: folders[c.repo] ?? "", text: `#${c.number} ${c.title}\n\n` });
}

// the board as a full stage in Cowork, or a pane beside a talk in Home (buttons/action-board.tsx); issue: the open
// session's, its card marked
export function ActionBoard({ team, issue, onOpenWork, onNewAction }: { team: Team; issue?: number; onOpenWork: (c: Card) => void; onNewAction: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const b = team.board;
  const others = [...new Set((team.state?.roster ?? []).map((m) => m.who))].filter((who) => who !== team.me);
  const itemsFor = (c: Card): MenuItem[] => [
    { head: `#${c.number} ${c.title}`.slice(0, 44) },
    { label: "open in Home", run: () => onOpenWork(c), note: "your own session on it, in Home" },
    // try: Try and review (#35) fills these four
    // --- Try (#35): try it, ask for a review, mark ready, comment (TryPane.tsx)
    ...tryItems(c, team),
    // --- end Try
    { sep: true },
    // --- Hand (#34): "hand to <member>", one per teammate (with a line, as it is, its PR), and "ask <member> to review"
    ...handItems(c, others, b?.prs ?? []),
    // --- end Hand
    ...(ACTIONS.some((a) => a.when(c)) ? [{ sep: true } as MenuItem] : []),
    ...ACTIONS.filter((a) => a.when(c)).map((a) => ({ label: a.name, run: () => void a.run(c, team) })),
    { sep: true },
    { label: "+ an action: one file on a branch", run: onNewAction, note: "how to add one" },
  ];
  const open = (ev: React.MouseEvent, c: Card) => {
    ev.preventDefault(); ev.stopPropagation();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: ev.type === "contextmenu" ? ev.clientX : r.right - 8, y: ev.type === "contextmenu" ? ev.clientY : r.bottom + 4, items: itemsFor(c) });
  };
  if (!b) return <p className="wpempty">{team.up ? "reading the board…" : "not connected"}</p>;
  return (
    <div className="cpage cact">
      <header className="chead1">
        <h2>the action board</h2>
        <span className="cdim cat">{readAgo(b.at)}</span>
        <span className="cgrow1" />
        <Leads team={team} />   {/* the owner's press (#117): who leads each label, set at once */}
        <Stamp others={others} />   {/* ship (#33): stamp stable, one stable back, the offer */}
      </header>
      <Columns board={b} team={team} sign="always" here={issue} onMenu={open}
        cardExtra={(c) => <button className="cmore" title="what to do with it" onClick={(ev) => open(ev, c)} aria-label={`actions for #${c.number}`}>⋯</button>} />
      {/* --- Hand (#34): the hands record, under the columns, read from the issues' comments */}
      <HandsRecord />
      {/* --- end Hand */}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
