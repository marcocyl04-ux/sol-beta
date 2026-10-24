// Usage (#133, docs/beta/PRD.md section 8): each press of a button on a rail is counted here, and useEngine sends the
// counts once a minute (arrange.used), added into the arrangement's usage by the engine. A count the link could not take
// stays for the next minute.
const counts = new Map<string, number>();

export const pressed = (id: string) => { counts.set(id, (counts.get(id) ?? 0) + 1); };

/** send what was pressed since the last time; kept when the send fails */
export function sendUsage(send: (o: object) => boolean) {
  if (!counts.size) return;
  if (send({ type: "arrange.used", counts: Object.fromEntries(counts) })) counts.clear();
}
