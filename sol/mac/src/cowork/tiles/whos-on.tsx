// A tile: who is on, from the roster (the team's line): each person, their mark, and the session they are in.
import type { TileDef } from "./index";
import { STATE_WORD, Who, since } from "../bits";

const whosOn: TileDef = {
  name: "who's on",
  Tile: ({ team }) => {
    const roster = team.state?.roster ?? [];
    const up = !!team.state?.relay.up;
    if (!roster.length) return <p className="ctile-none">{up ? "nobody yet" : "the team is not in sight"}</p>;
    return (
      <ul className="ctile-list">
        {roster.map((m) => (
          <li key={m.who + m.machine}>
            <Who login={m.who} away={!up || m.state === "away"} working={up && m.state === "working"} needs={up && m.state === "yourcall"} title={`${m.who}: ${up ? STATE_WORD[m.state] : "not seen"}`} />
            <b>{m.who}</b>
            <span className="cdim">{m.session ? `${m.session.title}${m.session.repo ? ` · ${m.session.repo}` : ""}` : STATE_WORD[m.state]}</span>
            <small>{since(m.since)}</small>
          </li>
        ))}
      </ul>
    );
  },
};
export default whosOn;
