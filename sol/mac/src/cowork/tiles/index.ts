// The dashboard's tiles (Together, See #31): what the team added to the view, under the columns and the gantt. Each
// tile is one file here exporting `{ name, Tile }`; add it to the list below. A tile is read-only: nothing on the
// dashboard is a button.
import type { Board, Team } from "../useTeam";
import whosOn from "./whos-on";
import eyes from "./eyes";
import leads from "./leads";

export type TileProps = { team: Team; board: Board };
export type TileDef = { name: string; Tile: (p: TileProps) => React.ReactNode };

export const TILES: TileDef[] = [whosOn, eyes, leads];
