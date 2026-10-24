// A tile: eyes wanted, the pull requests waiting for a review (open, not a draft, no approval yet).
import type { TileDef } from "./index";
import { Sig, since } from "../bits";

const eyes: TileDef = {
  name: "eyes wanted",
  Tile: ({ board }) => {
    const want = board.prs.filter((p) => p.state === "open" && !p.draft && p.review !== "APPROVED");
    if (!want.length) return <p className="ctile-none">no pull request waits for a review</p>;
    return (
      <ul className="ctile-list">
        {want.map((p) => (
          <li key={p.repo + p.number}>
            <span className="cnum">#{p.number}</span>
            <span className="ct">{p.title}</span>
            <Sig s={{ login: p.author.replace(/\[bot\]$/, ""), agent: p.agent }} />
            {p.updated && <small>{since(p.updated)}</small>}
          </li>
        ))}
      </ul>
    );
  },
};
export default eyes;
