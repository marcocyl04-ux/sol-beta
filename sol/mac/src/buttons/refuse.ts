import type { ButtonDef } from "./types";

// What a face can tell about a person's own button without the type checker (#133, PRD section 7): the check's id and
// fields rules (sol/buttons/check names them), or null. Kept apart from own.tsx so node's test runner can read it.
const MEANT: ButtonDef["meant"] = ["home", "cowork", "social"];
export function refuse(b: unknown, id: string): string | null {
  const d = b as Partial<ButtonDef> | undefined;
  if (!d || typeof d !== "object") return "fields: it has no default export to draw";
  if (d.id !== id) return `id: its id must be its file's name, "${id}"`;
  if (!/^my-[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) return "id: a person's own button's id starts with my-, in small letters and dashes";
  for (const k of ["name", "says"] as const) if (typeof d[k] !== "string" || !d[k]) return `fields: it needs ${k}, a line of words`;
  if (d.glyph === undefined || d.glyph === null) return "fields: it needs a glyph";
  if (!Array.isArray(d.meant) || !d.meant.every((m) => MEANT.includes(m))) return `fields: meant is a list of modes, from ${MEANT.join(", ")}`;
  if (d.kind !== "pane" && d.kind !== "press") return "fields: its kind is pane or press";
  if (d.kind === "pane" ? typeof d.Pane !== "function" : typeof d.press !== "function") return "fields: a pane needs Pane, a press needs press";
  return null;
}
