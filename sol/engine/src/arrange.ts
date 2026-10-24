// The arrangement (#133, docs/beta/PRD.md section 6): one person's rails, presets and layout, in one file of the back
// room, sol/home/arrangement.json, never committed (a stamp, sol/promote and a rebase of <you>/mine never name it).
// The face asks with arrange.get and changes it with arrange.set { patch }; the agent's tool `arrange` goes through the
// same merge and check. Every change is written whole (never half a file) and told to every face (arrange.changed).
// Separate from settings.ts on purpose: that cleaner drops what it does not know, this one keeps it. A button id no
// shelf has today stays in its preset, so a button that comes back later returns to its place; the face just does not
// draw it. Missing means Sol's own (the presets the face ships, mac/src/buttons/presets.json); an unreadable file is
// put aside as arrangement.bad-<when>.json (each its own, so a second never covers the first) and one line says so.

import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { ToolResult, TurnCtx } from "./browser.js";

export type Rail = { presets: string[]; at?: string };   // at: the preset showing; none: the mode's own pick (Home: Everyday beside a chat, Build beside a session)
export type Preset = { name: string; buttons: string[] };   // "|": the thin line between two keys
export type Layout = "plain" | "split" | "carousel";
export type Manage = null | "asked" | "agent" | "me";
export type Arrangement = {
  v: 1; modes: string[]; rails: Record<string, Rail[]>; presets: Record<string, Preset>;
  layout: Record<string, Layout>; split: { share: number };
  usage: Record<string, { n: number; last: string }>; manage: Manage;
  [more: string]: unknown;   // a field a later Sol wrote: kept as it is
};

export const MAX = 10;   // buttons on one preset; Sol's own may ship longer (Build is Work's bar as it stood)
export const TOO_MANY = "a preset holds 10. Make another preset?";
const LAYOUTS: Layout[] = ["plain", "split", "carousel"];
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HERE = dirname(fileURLToPath(import.meta.url));
const SOL = resolve(HERE, "..", "..");   // src or dist, both one down from the engine

// Sol's own, from the one file the face draws them from too
type Shipped = { presets: Record<string, Preset>; rails: Record<string, Rail[]> };
const SHIPPED: Shipped = (() => {
  try { return JSON.parse(readFileSync(join(SOL, "mac", "src", "buttons", "presets.json"), "utf8")) as Shipped; }
  catch { return { presets: {}, rails: { home: [], cowork: [] } }; }
})();
export const DEFAULTS: Arrangement = {
  v: 1, modes: ["home", "cowork"], rails: SHIPPED.rails, presets: SHIPPED.presets,
  layout: { home: "plain" }, split: { share: 0.5 }, usage: {}, manage: null,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && ID.test(x)) : []);
export const count = (p?: Preset) => (p?.buttons ?? []).filter((b) => b !== "|").length;

// Whatever is on disk or merged from a patch, made into a valid arrangement. A part that is missing is Sol's own; a
// part that is there is the person's, whole (a preset they deleted never comes back from the defaults).
export function clean(raw: unknown): Arrangement {
  const r = isObj(raw) ? raw : {};
  const presets: Record<string, Preset> = {};
  for (const [id, p] of Object.entries(isObj(r.presets) ? r.presets : DEFAULTS.presets)) {
    if (!ID.test(id) || !isObj(p)) continue;
    const bs = Array.isArray(p.buttons) ? p.buttons.filter((b): b is string => b === "|" || (typeof b === "string" && ID.test(b))) : [];
    presets[id] = {
      name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 40) : id,
      buttons: bs.filter((b, i) => b === "|" || bs.indexOf(b) === i),
    };
  }
  const modes = ids(r.modes).length ? [...new Set(ids(r.modes))] : DEFAULTS.modes;
  const given = isObj(r.rails) ? r.rails : DEFAULTS.rails;
  const rails: Record<string, Rail[]> = {};
  for (const m of modes) {
    const list = (Array.isArray(given[m]) ? given[m] as unknown[] : []).filter(isObj).map((x) => {
      const ps = [...new Set(ids(x.presets))].filter((p) => presets[p]);
      return { presets: ps, ...(typeof x.at === "string" && ps.includes(x.at) ? { at: x.at } : {}) };
    }).filter((x) => x.presets.length);
    rails[m] = list.length ? list : (DEFAULTS.rails[m] ?? []).map((x) => ({ presets: x.presets.filter((p) => presets[p]) })).filter((x) => x.presets.length);
  }
  const layout: Record<string, Layout> = { ...DEFAULTS.layout };
  if (isObj(r.layout)) for (const [m, l] of Object.entries(r.layout)) if (ID.test(m) && LAYOUTS.includes(l as Layout)) layout[m] = l as Layout;
  const sh = isObj(r.split) ? r.split.share : undefined;
  const usage: Arrangement["usage"] = {};
  if (isObj(r.usage)) for (const [id, u] of Object.entries(r.usage)) {
    if (ID.test(id) && isObj(u) && typeof u.n === "number" && u.n >= 0) usage[id] = { n: Math.floor(u.n), last: typeof u.last === "string" ? u.last.slice(0, 10) : "" };
  }
  const more = Object.fromEntries(Object.entries(r).filter(([k]) => !(k in DEFAULTS)));
  return {
    ...more, v: 1, modes, rails, presets, layout,
    split: { share: typeof sh === "number" && isFinite(sh) ? Math.min(0.85, Math.max(0.15, sh)) : 0.5 },
    usage, manage: r.manage === "asked" || r.manage === "agent" || r.manage === "me" ? r.manage : null,
  };
}

// objects merge, anything else (a list, a value) replaces; a null takes the key away (a deleted preset)
export function merge(a: unknown, b: unknown): unknown {
  if (!isObj(a) || !isObj(b)) return b;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === null && k !== "manage") delete out[k];
    else out[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v;
  }
  return out;
}

// what a change may not do, in one plain line, or null
export function check(was: Arrangement, next: Arrangement): string | null {
  for (const [id, p] of Object.entries(next.presets)) if (count(p) > MAX && count(p) > count(was.presets[id])) return TOO_MANY;
  for (const m of next.modes) if ((was.rails[m] ?? []).length && !(next.rails[m] ?? []).length) return "a rail keeps one preset at least. Make another first?";
  return null;
}

// ---- the file ----
let file = "";
let current: Arrangement | null = null;
let note: string | undefined;   // the bad file's line, said to each face until the next write
let tell: (m: object) => void = () => {};
let writes = 0;   // each write's own temp file, so a second engine on the same back room never writes into this one's

/** where the back room is, and how every face is told of a change (index.ts) */
export function setArrangeHome(home: string, everyone?: (m: object) => void) {
  file = join(home, "arrangement.json");
  current = null; note = undefined; before = null;
  if (everyone) tell = everyone;
}

export function getArrangement(): Arrangement {
  if (current) return current;
  let text: string | null = null;
  try { text = readFileSync(file, "utf8"); } catch { /* none yet: Sol's own */ }
  if (text === null) return (current = clean({}));
  try {
    const raw = JSON.parse(text);
    if (!isObj(raw)) throw new Error("not an object");
    current = clean(raw);
  } catch {
    const when = new Date().toISOString().replace(/[:.]/g, "-");
    let bad = `arrangement.bad-${when}.json`;
    for (let n = 2; existsSync(join(dirname(file), bad)); n++) bad = `arrangement.bad-${when}-${n}.json`;
    try { renameSync(file, join(dirname(file), bad)); } catch { /* gone already */ }
    note = `Your arrangement could not be read, so Sol's own is showing; yours is kept aside as ${bad}.`;
    current = clean({});
  }
  return current;
}

export const arrangeMsg = () => ({ type: "arrange.changed", arrangement: getArrangement(), ...(note ? { note } : {}) });

/** merge a patch, check it, write it whole and tell every face; a refusal changes nothing. All of it is synchronous, so
 *  inside the engine one write ends before the next begins: none reads an arrangement another is half way through.
 *  by: an agent's change (the tool), which keeps the arrangement before it for the undo note; any other change drops it */
export function setArrangement(patch: unknown, by?: Undo): { ok: true; a: Arrangement } | { ok: false; why: string } {
  const was = getArrangement();
  const next = clean(merge(was, isObj(patch) ? patch : {}));
  const why = check(was, next);
  if (why) return { ok: false, why };
  write(next);
  before = by ? was : null;
  tell({ ...arrangeMsg(), ...(by ? { undo: by } : {}) });
  return { ok: true, a: next };
}

// ---- the undo note (PRD section 8) ----
// An agent's change shows one quiet line on the rail, "<agent> <what> · undo". The arrangement before it is kept here,
// one step back only; undo writes it back (with the presses counted since, which are not the agent's), and any other
// change, or the undo itself, lets it go.
export type Undo = { who: string; what: string };
let before: Arrangement | null = null;
export function undoArrangement(): boolean {
  if (!before) return false;
  write({ ...before, usage: getArrangement().usage });
  before = null;
  tell(arrangeMsg());
  return true;
}

function write(next: Arrangement) {
  const tmp = `${file}.${process.pid}.${++writes}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, file);   // never a half-written file
  current = next; note = undefined;
}

// ---- usage and the one ask (PRD section 8) ----
// The face counts the presses on its rails and sends them once a minute (arrange.used { counts }); they are added into
// usage here. Nothing a face draws changes, so no face is told.
export const ASK_AT = 100;   // presses in all before the one ask
export function addUsage(counts: unknown, day = new Date().toISOString().slice(0, 10)) {
  if (!isObj(counts)) return;
  const was = getArrangement(), usage = { ...was.usage };
  for (const [id, n] of Object.entries(counts)) {
    if (ID.test(id) && typeof n === "number" && n >= 1 && n <= 10_000) usage[id] = { n: (usage[id]?.n ?? 0) + Math.floor(n), last: day };
  }
  write({ ...was, usage });
}

/** the one ask: past ASK_AT presses with manage still null, the line for the next chat's prompt, and manage "asked" in
 *  the same write, so it is asked once. Null every other time. */
export function oneAsk(): string | null {
  const a = getArrangement(), use = Object.entries(a.usage);
  if (a.manage !== null || use.reduce((s, [, u]) => s + u.n, 0) < ASK_AT) return null;
  const top = use.sort((x, y) => y[1].n - x[1].n).slice(0, 5).map(([id, u]) => `${id} ${u.n}`);
  const known = new Set(shelf().map((b) => b.id));
  const onRails = new Set(Object.values(a.rails).flat().flatMap((r) => r.presets).flatMap((p) => a.presets[p]?.buttons ?? []));
  const never = [...onRails].filter((b) => known.has(b) && !a.usage[b]);
  write({ ...a, manage: "asked" });
  return `Sol's rail use so far: ${top.join(", ")}${never.length ? `; never pressed: ${never.join(", ")}` : ""}. ` +
    "Ask once whether they want you to keep their rail tidy, or keep choosing themselves.";
}

// ---- the agent's tool ----

// every button on the shelf, Sol's and the person's own, with its line: read from the files, so nothing here goes stale
export function shelf(): { id: string; says: string; own: boolean }[] {
  const read = (dir: string, own: boolean) => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => /^[a-z0-9][a-z0-9-]*\.tsx$/.test(f)).flatMap((f) => {
      const src = readFileSync(join(dir, f), "utf8");
      // among Sol's files, a button is one that says it is (own.tsx, the loader, is not), as sol/buttons/check reads them
      return own || /satisfies ButtonDef/.test(src) ? [{ id: f.slice(0, -4), says: /says:\s*"([^"]*)"/.exec(src)?.[1] ?? "", own }] : [];
    });
  };
  return [...read(join(SOL, "mac", "src", "buttons"), false), ...read(join(dirname(file), "buttons"), true)];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const tx = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

export const ARRANGE_TOOLS = [
  {
    name: "arrange",
    description: "Change how Sol looks for this person, only when they ask (\"put the terminal on my rail\", \"make a preset for " +
      "studying\"). A rail is the row of buttons at the top of a mode (home, cowork); it shows one preset at a time, a named set of " +
      "at most 10 buttons, and the person scrolls over it to change preset. do: get (the arrangement and every button on the shelf, " +
      "with what each is for: start here), add / remove / move a button on a preset, new / rename / delete a preset, show (the preset " +
      "the rail shows), layout (the sidebar's: plain, split or carousel), manage (their answer to the one ask: agent, you keep " +
      "their rail tidy; me, you never move anything unasked), or set with a raw patch. Never mention files to the person.",
    shape: {
      do: z.enum(["get", "add", "remove", "move", "new", "rename", "delete", "show", "layout", "manage", "set"]),
      button: z.string().optional().describe("A button's id from the shelf (\"terminal\")."),
      preset: z.string().optional().describe("A preset's id; for add, remove and move, the one the rail shows when left out."),
      to: z.number().int().optional().describe("add, move: the place on the preset, 0 first; the end when left out."),
      name: z.string().optional().describe("new, rename: the preset's name as the person says it (\"Study\")."),
      buttons: z.array(z.string()).optional().describe("new: the buttons it starts with."),
      mode: z.string().optional().describe("The mode whose rail: home (the default) or cowork."),
      layout: z.enum(["plain", "split", "carousel"]).optional(),
      manage: z.enum(["agent", "me"]).optional().describe("manage: who keeps the rail tidy from now on."),
      patch: z.record(z.string(), z.unknown()).optional().describe("set: merged into the arrangement; null takes a key away."),
    },
  },
];

type Args = { do?: string; button?: string; preset?: string; to?: number; name?: string; buttons?: string[]; mode?: string; layout?: string; manage?: string; patch?: unknown };

// a patch for one asked change, or the line why not
function patchFor(a: Args, cur: Arrangement): object | string {
  const mode = a.mode && ID.test(a.mode) ? a.mode : "home";
  const rail = cur.rails[mode]?.[0];
  const pid = a.preset ?? rail?.at ?? rail?.presets[0] ?? "";
  const p = cur.presets[pid];
  const place = (list: string[], b: string) => { const l = [...list]; l.splice(typeof a.to === "number" ? Math.max(0, a.to) : l.length, 0, b); return l; };
  const rails = (r: Rail) => ({ rails: { [mode]: [r, ...(cur.rails[mode] ?? []).slice(1)] } });
  const showing = (r: Rail | undefined) => (r && r.presets.includes(pid) ? rails({ ...r, at: pid }) : {});
  switch (a.do) {
    case "add": case "remove": case "move": {
      if (!p) return `there is no preset "${pid}"`;
      const b = String(a.button ?? "");
      if (!ID.test(b)) return "which button? its id, from get";
      const on = p.buttons.includes(b);
      if (a.do === "add" && on) return `${b} is on ${p.name} already`;
      if (a.do !== "add" && !on) return `${b} is not on ${p.name}`;
      const rest = p.buttons.filter((x) => x !== b);
      return { presets: { [pid]: { buttons: a.do === "remove" ? rest : place(rest, b) } }, ...showing(rail) };
    }
    case "new": {
      const id = slug(a.name ?? "");
      if (!id) return "a new preset needs a name";
      if (cur.presets[id]) return `there is a preset "${id}" already`;
      const bs = a.buttons ?? [], known = new Set(shelf().map((b) => b.id));
      const unknown = bs.filter((b) => b !== "|" && !known.has(b));
      if (unknown.length) return `not on the shelf: ${unknown.join(", ")}. Their ids are in get`;
      if (count({ name: "", buttons: [...new Set(bs)] }) > MAX) return TOO_MANY;
      const r = rail ?? { presets: [] };
      return { presets: { [id]: { name: a.name!.trim(), buttons: a.buttons ?? [] } }, ...rails({ presets: [...r.presets, id], at: id }) };
    }
    case "rename": return p && a.name?.trim() ? { presets: { [pid]: { name: a.name.trim() } } } : "rename needs a preset and a name";
    case "delete": {
      if (!p) return `there is no preset "${pid}"`;
      const out: Record<string, unknown> = { presets: { [pid]: null } };
      out.rails = Object.fromEntries(Object.entries(cur.rails).map(([m, rs]) => [m, rs.map((r) => ({ presets: r.presets.filter((x) => x !== pid), ...(r.at && r.at !== pid ? { at: r.at } : {}) }))]));
      return out;
    }
    case "show": return rail?.presets.includes(pid) ? rails({ ...rail, at: pid }) : `${pid} is not on the ${mode} rail`;
    case "layout": return LAYOUTS.includes(a.layout as Layout) ? { layout: { [mode]: a.layout } } : "layout is plain, split or carousel";
    case "manage": return a.manage === "agent" || a.manage === "me" ? { manage: a.manage } : "manage is agent or me";
    case "set": return isObj(a.patch) ? a.patch : "set needs a patch";
    default: return `do is one of get, add, remove, move, new, rename, delete, show, layout, manage, set`;
  }
}

// the undo note's words for one asked change: what the agent did, in a few words
const SEATS: Record<string, string> = { claude: "Claude", codex: "Codex" };
function what(a: Args, cur: Arrangement): string {
  const rail = cur.rails[a.mode && ID.test(a.mode) ? a.mode : "home"]?.[0];
  const pid = a.preset ?? rail?.at ?? rail?.presets[0] ?? "", pn = cur.presets[pid]?.name ?? pid, b = (a.button ?? "").replace(/-/g, " ");
  switch (a.do) {
    case "add": return `put ${b} on ${pn}`;
    case "remove": return `took ${b} off ${pn}`;
    case "move": return `moved ${b} on ${pn}`;
    case "new": return `made ${a.name?.trim() ?? "a preset"}`;
    case "rename": return `renamed ${pn} ${a.name?.trim() ?? ""}`.trim();
    case "delete": return `took away ${pn}`;
    case "show": return `showed ${pn}`;
    case "layout": return `made the side ${a.layout}`;
    default: return "changed the rail";
  }
}

// the arrangement in a few lines an agent can read: each rail's presets and what they hold, unknown ids marked
function says(cur: Arrangement): string {
  const known = new Set(shelf().map((b) => b.id));
  const lines: string[] = [];
  for (const [m, rs] of Object.entries(cur.rails)) rs.forEach((r, i) => {
    lines.push(`${m} rail${rs.length > 1 ? ` ${i + 1}` : ""}${r.at ? `, showing ${r.at}` : ""}:`);
    for (const id of r.presets) lines.push(`  ${id} "${cur.presets[id].name}": ${cur.presets[id].buttons.map((b) => (b === "|" || known.has(b) ? b : `${b} (not on the shelf, kept)`)).join(" ")}`);
  });
  const loose = Object.keys(cur.presets).filter((id) => !Object.values(cur.rails).flat().some((r) => r.presets.includes(id)));
  if (loose.length) lines.push(`on no rail: ${loose.join(", ")}`);
  lines.push(`layout: ${Object.entries(cur.layout).map(([m, l]) => `${m} ${l}`).join(", ")}`);
  const use = Object.entries(cur.usage).sort((x, y) => y[1].n - x[1].n).slice(0, 10);
  if (use.length) lines.push(`presses: ${use.map(([id, u]) => `${id} ${u.n}`).join(", ")}`);
  lines.push(`who tidies the rail: ${cur.manage === "agent" ? "you, when it helps" : cur.manage === "me" ? "they do; move nothing unasked" : cur.manage === "asked" ? "asked, no answer yet" : "not asked yet"}`);
  return lines.join("\n");
}

export async function runArrangeTool(name: string, args: unknown, turn: TurnCtx = {}): Promise<ToolResult> {
  if (name !== "arrange") return tx(`Unknown tool: ${name}`, true);
  const a = (isObj(args) ? args : {}) as Args;
  const cur = getArrangement();
  if (a.do === "get") return tx(`${says(cur)}\n\nthe shelf:\n${shelf().map((b) => `  ${b.id}${b.own ? " (theirs)" : ""}: ${b.says}`).join("\n")}`);
  const p = patchFor(a, cur);
  const by = a.do === "manage" ? undefined : { who: SEATS[turn.seat ?? ""] ?? "your agent", what: what(a, cur) };
  const r = typeof p === "string" ? { ok: false as const, why: p } : setArrangement(p, by);
  turn.sink?.({ id: randomUUID(), kind: "desk", text: "arranging the rail", done: true, ok: r.ok, detail: r.ok ? undefined : r.why });
  return r.ok ? tx(`Done; their rail shows it now.\n${says(r.a)}`) : tx(r.why, true);
}
