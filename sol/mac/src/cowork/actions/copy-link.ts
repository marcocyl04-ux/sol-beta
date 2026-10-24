// An action: copy the issue's link (the smallest action there is, and the example README.md points at).
import type { ActionDef } from "./index";

const copyLink: ActionDef = {
  name: "copy the link",
  when: (card) => !!card.url,
  run: (card) => navigator.clipboard?.writeText(card.url),
};
export default copyLink;
