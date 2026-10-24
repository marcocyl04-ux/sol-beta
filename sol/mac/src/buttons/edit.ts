// Changing a preset by hand (#171): the small sums the rail, its + panel and the shelf share. Every change is a patch of
// the arrangement (arrange.set: objects merge, lists replace, null deletes); the engine says no to an eleventh button
// and to an empty rail, and that no comes back as one line (useEngine's `refused`).
import { keyWords, type ButtonCtx, type ButtonDef, type Preset, type RailDef } from ".";

export const MAX = 10;
export const count = (p?: Preset) => (p?.buttons ?? []).filter((b) => b !== "|").length;
export type Snap = { presets: Record<string, Preset>; rails: Record<string, RailDef[]> };

/** the patch that puts back what was before a change made here: presets made since go, the rest as they were */
export function undoPatch(was: Snap, now: Snap): object {
  const gone = Object.keys(now.presets).filter((id) => !was.presets[id]);
  return { presets: { ...Object.fromEntries(gone.map((id) => [id, null])), ...was.presets }, rails: was.rails };
}

/** the list with `id` placed before `before` (or at the end), taken from where it was */
export function placed(list: string[], id: string, before: string | null): string[] {
  const l = list.filter((b) => b !== id);
  const i = before ? l.indexOf(before) : -1;
  l.splice(i < 0 ? l.length : i, 0, id);
  return l;
}

/** a fresh preset id from its name, never one taken */
export function freshId(name: string, taken: Record<string, unknown>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "preset";
  let id = base;
  for (let n = 2; taken[id]; n++) id = `${base}-${n}`;
  return id;
}

/** the modes whose rails show a preset, for a menu's quiet right-hand word */
export const modesOf = (rails: Record<string, RailDef[]>, id: string) => Object.keys(rails).filter((m) => rails[m]?.some((r) => r.presets.includes(id)));

// what "about" says under a button's line: what a press does, its key, how often it has been pressed
export const about = (b: ButtonDef, n: number) => [b.kind === "pane" ? "opens beside the talk" : "does it in one press", b.key ? keyWords(b.key) : "",
  n ? `pressed ${n === 1 ? "once" : `${n} times`}` : "not pressed yet"].filter(Boolean).join(" · ");

/** where a button shows when it does not show here ("in a session"), or null when it shows here */
export const notHere = (b: ButtonDef, c: ButtonCtx): string | null => (b.shows && !b.shows(c) ? b.where ?? "where it has something to do" : null);
