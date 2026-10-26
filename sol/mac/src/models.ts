// A model's id as the pill says it (mine/look/SITTING-3.md, item 1): "Fable 5.1" for claude-fable-5-1, "GPT-5.6 Luna"
// for gpt-5.6-luna. Pure; the full id stays in the pill's title and in the native list beside the friendly name.
// The rule for an id this file has not met: drop the seat's own prefix when the seat pill already names it, read the
// digits as a version with dots, capitalise the family, and keep whatever trails the version as words.
const KNOWN: Record<string, string> = {
  "claude-fable-5-1": "Fable 5.1", "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5",
  "gpt-5.6-luna": "GPT-5.6 Luna", "gpt-5.6": "GPT-5.6", "gpt-6.1-sol": "GPT-6.1 Sol",
  // the rest of Codex's list as the engine gives it (sitting 5): "sol" is a name, not an acronym, so it is not shouted
  "gpt-6-astra": "GPT-6 Astra", "gpt-6-sol": "GPT-6 Sol", "gpt-6-luna": "GPT-6 Luna", "gpt-5.6-sol": "GPT-5.6 Sol", "gpt-5.6-terra": "GPT-5.6 Terra",
};
const cap = (w: string) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1));
export function prettyModel(id: string, seat?: string): string {
  if (!id) return "–";
  const tail = id.match(/\[.*\]$/)?.[0] ?? "";          // "[1m]" and the like ride along
  let core = tail ? id.slice(0, -tail.length) : id;
  const known = KNOWN[core];
  if (known) return tail ? `${known} ${tail}` : known;
  let dropped = false;
  if (seat && core.toLowerCase().startsWith(`${seat.toLowerCase()}-`)) { core = core.slice(seat.length + 1); dropped = true; }
  const parts = core.split("-").filter(Boolean);
  const first = parts.findIndex((p) => /^\d/.test(p));
  if (first < 0) return parts.map(cap).join(" ") || id;
  let last = first;
  while (last + 1 < parts.length && /^\d+$/.test(parts[last + 1])) last++;
  const family = parts.slice(0, first).map(cap).join(" ");
  const version = parts.slice(first, last + 1).join(".");
  const rest = parts.slice(last + 1).map(cap).join(" ");
  const head = family ? (dropped ? `${family} ${version}` : `${family}-${version}`) : version;
  return [head, rest, tail].filter(Boolean).join(" ");
}
// the native list's line: the friendly name, then the id, so a person who knows ids finds theirs
export const modelLine = (id: string, seat?: string) => { const p = prettyModel(id, seat); return p === id ? id : `${p} · ${id}`; };
