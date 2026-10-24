import type { ReactNode } from "react";
import { useTeam, type Team } from "../cowork/useTeam";
import type { ButtonCtx } from "./types";

// Cowork's views as panes (#132): Cowork hands its own team in the context; anywhere else the team is read here, so it
// is mounted only while one of these panes shows
export function WithTeam({ c, children }: { c: ButtonCtx; children: (team: Team) => ReactNode }) {
  return c.team ? <>{children(c.team)}</> : <Read>{children}</Read>;
}
function Read({ children }: { children: (team: Team) => ReactNode }) {
  return <>{children(useTeam())}</>;
}
