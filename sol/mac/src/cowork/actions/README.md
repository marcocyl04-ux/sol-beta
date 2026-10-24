# Adding an action to the action board

An action is one thing a card's menu can do. It is one file in this folder.

1. Make a branch: `<your-login>/action-<what>`.
2. Add `sol/mac/src/cowork/actions/<what>.ts`, in this shape:

   ```ts
   import type { ActionDef } from "./index";

   const myAction: ActionDef = {
     name: "copy the link",                  // the menu's words: lower case, a verb first
     when: (card) => !!card.url,             // which cards show it
     run: (card, team) => navigator.clipboard?.writeText(card.url),
   };
   export default myAction;
   ```

   `card` is one issue on the board: `repo`, `number`, `title`, `column`, `assignees`, `labels`, `url`, `pr`,
   `branch`, `sign`. `team` is the Cowork state: `team.me`, `team.state.roster`, `team.board`, and
   `team.ask(type, body)` to send a `team.*` message to Sol (PROTOCOL.md, round 17 and on).
3. Add it to the list in `index.ts`: one import, one name in `ACTIONS`.
4. Build the face (`cd sol/mac && npm run build`), look at it in Cowork, open a draft PR that names its issue.

`copy-link.ts` is the smallest one there is; start from it. An action does what a person could do from the card by
hand. It never writes where the person did not ask, and anything it writes carries their signature.
