import { Component, type ReactNode } from "react";
import type { ButtonCtx, ButtonDef } from "./types";
import { refuse } from "./refuse";

// A person's own buttons (#133, docs/beta/PRD.md section 7): sol/home/buttons/my-<id>.tsx, never committed. Each file is
// taken in on its own, so one that does not load (a typo, a throw at its top) is passed over with one plain line on the
// shelf and the rest of Sol goes on. One that loads is checked for what Sol needs to draw it (the rules sol/buttons/check
// names, the ones a face can see), and everything it hands Sol is guarded: its pane and glyph draw inside a boundary
// that shows one line if they throw, and a throw from its press, hover or badge is that line too, never a blank window.
// React resolves for these files from the face's own node_modules (vite.config.ts, resolve.dedupe).

export type Broken = { file: string; line: string };

// the bypass lines a file carries ("// bypass: colour, because…"): the shelf marks the button with them
const bypasses = (src: string) => [...src.matchAll(/^\s*\/\/\s*bypass:\s*([a-z]+)/gm)].map((m) => m[1]);
const said = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 120);
export const brokeLine = (id: string, e: unknown) => `${id} broke: ${said(e)}. The rest of Sol is fine; ask your agent to fix it.`;

// a part of a button that drew wrong: one line in its place
export class Boundary extends Component<{ id: string; small?: boolean; children: ReactNode }, { err: unknown }> {
  state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown) { return { err: err ?? "it threw" }; }
  componentDidCatch(err: unknown) { console.error(`[own button ${this.props.id}]`, err); }
  render() {
    if (!this.state.err) return this.props.children;
    return this.props.small ? <span title={brokeLine(this.props.id, this.state.err)}>!</span> : <p className="ownbroke" role="status">{brokeLine(this.props.id, this.state.err)}</p>;
  }
}

// the button with everything it hands Sol wrapped, so nothing of it can take the window down
export function guard(b: ButtonDef, bypassed: string[]): ButtonDef {
  const safe = <R,>(f: ((c: ButtonCtx) => R) | undefined, or: (c: ButtonCtx) => R) => f && ((c: ButtonCtx) => {
    try { return f(c); } catch (e) { console.error(`[own button ${b.id}]`, e); return or(c); }
  });
  const P = b.Pane, glyph = b.glyph, badge = b.badge;
  return {
    ...b, bypassed,
    glyph: typeof glyph === "string" ? glyph : <Boundary id={b.id} small>{glyph}</Boundary>,
    Pane: P && ((c: ButtonCtx) => <Boundary id={b.id}><P {...c} /></Boundary>),
    press: b.press && ((c: ButtonCtx) => {
      try { const r: unknown = b.press!(c); if (r instanceof Promise) r.catch((e) => c.flash(brokeLine(b.id, e))); }
      catch (e) { c.flash(brokeLine(b.id, e)); }
    }),
    badge: badge && ((c: ButtonCtx) => { const n = safe(badge, () => null)!(c); return n ? <Boundary id={b.id} small>{n}</Boundary> : n; }),
    shows: safe(b.shows, () => false), on: safe(b.on, () => false), look: safe(b.look, () => ""), hover: safe(b.hover, () => b.says),
    useOff: b.useOff && (() => { try { return b.useOff!(); } catch { return false; } }),
  };
}

// every file in the folder, loaded one at a time: the ones that draw, and a line for each that does not
export async function loadOwn(files: Record<string, () => Promise<unknown>>, sources: Record<string, string>, taken: Set<string>) {
  const buttons: ButtonDef[] = [], broken: Broken[] = [];
  for (const [path, load] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.split("/").pop()!, id = file.replace(/\.tsx$/, "");
    let b: unknown;
    try { b = ((await load()) as { default?: unknown }).default; }
    catch (e) { broken.push({ file, line: `${id} did not load: ${said(e)}` }); continue; }
    const no = refuse(b, id) ?? (taken.has(id) ? "id: Sol has a button with that id" : null);
    if (no) { broken.push({ file, line: `${id} is off the shelf, ${no}` }); continue; }
    buttons.push(guard(b as ButtonDef, bypasses(sources[path] ?? "")));
  }
  return { buttons, broken };
}
