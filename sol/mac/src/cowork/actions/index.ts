// The action board's own actions (Together, See #31): anyone on the team adds one as one file in this folder and one
// line in the list below, landed on a branch like any change (README.md here says how). An action shows in a card's
// menu when `when(card)` says so, after the built-in items; `run` does it. The built-in items (open in Work, try it,
// ask for a review, mark ready, comment, hand to) live in ActionBoard.tsx.
import type { Card, Team } from "../useTeam";
import copyLink from "./copy-link";

export type ActionDef = {
  name: string;                                   // the menu's words, lower case, a verb first
  when: (card: Card) => boolean;                  // shown for this card?
  run: (card: Card, team: Team) => void | Promise<void>;
};

export const ACTIONS: ActionDef[] = [copyLink];
