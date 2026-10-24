// The gist: where a talk stood, in its own words, for a talk on the other seat to carry on from. The switch (#182) puts
// it in the box of the new talk, for Marco to read and send; the old handover (work.handover, PROTOCOL round 11) made it
// the first message of a Work session. Both read the same: the last 14 turns, each cut at 1400 characters, the whole at
// 9000, back-to-back lines of one speaker joined first (a Claude turn is many items).
export type Said = { who: string; text: unknown };
export type Item = { kind: string; text?: unknown; parent?: unknown };

export function gist(said: Said[], o: { title?: string; from: string; to: string; me?: string; you?: string }): string {
  const turns: { who: string; text: string }[] = [];
  for (const x of said) {
    const text = String(x.text ?? "").trim();
    if (!text) continue;
    const last = turns[turns.length - 1];
    if (last && last.who === x.who) last.text += "\n\n" + text;
    else turns.push({ who: x.who, text });
  }
  let brief = turns.slice(-14).map((x) => `${x.who === "me" ? o.me ?? "Marco" : o.you ?? "Sol"}: ${x.text.slice(0, 1400)}`).join("\n\n");
  if (brief.length > 9000) brief = "…" + brief.slice(-9000);
  return `Carried over from ${o.from}${o.title ? ` ("${String(o.title).slice(0, 120)}")` : ""}. Where it stood:\n\n${brief}\n\nCarry on from here ${o.to}.`;
}

// a Work thread's items as what was said: Marco's lines and Claude's answers, not its tools, thinking or subagents
export const saidOf = (items: Item[]): Said[] =>
  items.filter((i) => !i.parent && (i.kind === "me" || i.kind === "you")).map((i) => ({ who: i.kind, text: i.text }));
