// Sol changing its own face, as one wire (issue #15, 2026-10-16). The engine already sees every step a seat takes:
// an Edit or Write that lands in the face (mac/src, design/: inventory's mutableWrite), and ../mutate and ../undo. Each
// one goes out to every window, hot or bundled, as { type: "changing" }, so the face can tape the part under work,
// shimmer it when the change lands and peel the tape when the seat commits it; the notch sends the crew down.
//
//   { type: "changing", seat, sessionId, kind: "edit", file, line, done, ok? }     at the start and the end of the edit
//   { type: "changing", seat, sessionId, kind: "mutate" | "undo", files?, line, done, ok? }   files read from git at the end
//   { type: "changing", seat, sessionId, kind: "turn", done: true }                the seat's turn ended: peel what is left
//   { type: "face.reverted", seat, sessionId, files, line }                       an edit that did not compile was taken back,
//                                                                                  or a part that broke after an edit did not mend
//
// The face never stays broken (2026-10-16): when a turn ends, every file it edited under mac/src is asked of the hot
// face (http://localhost:1420/src/..., which answers 500 for a file that does not compile). Still broken ten seconds
// later, the edit is taken back: an uncommitted edit with git checkout (a new file is removed), a committed one with
// ../undo. The window hears face.reverted; the log says which file. A cold face (no hot server) is never checked.
//
// A part that compiles but throws when it draws (2026-10-16): Site.tsx's boundary catches it and the window tells the
// engine { type: "face.broken", site, error }, and { type: "face.mended", site } when it draws again. With face files
// edited by a seat in the last two minutes, the engine waits ten seconds (longer while a turn that edits the face is
// still running; after two minutes of that it leaves it to the seat); no mend by then, those edits are taken back the
// same way, and face.reverted names the part. A crash with no recent edit behind it is left alone: nothing of Sol's to take back.
//
// Paths are relative to sol/ ("mac/src/Sidebar.tsx"). `line` is Sol's own words: the sentence the seat said just before
// the step (home/CLAUDE.md asks it to name the part it changes), the commit's one line at mutate and undo, else "".
// Nothing here invents a step: no event without a real tool call behind it.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpathSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname, sep } from "node:path";
import { mutableWrite } from "./inventory.js";

const run = promisify(execFile);
const EDITS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const FACE = /^mac\/src\/.+\.(tsx?|css)$/;   // what the hot face compiles: the files a take-back may touch
const RECENT_MS = 120_000, MEND_MS = 10_000;
const partWords = (site: string) => (site === "face" ? "the whole face" : site === "settings" ? "settings" : `the ${site}`);

// as the OS sees it, for a file that may not exist yet
function real(p: string): string {
  let cur = resolve(p);
  const rest: string[] = [];
  while (!existsSync(cur) && dirname(cur) !== cur) { rest.unshift(cur.slice(dirname(cur).length + 1)); cur = dirname(cur); }
  try { cur = realpathSync(cur); } catch { /* keep it */ }
  return resolve(cur, ...rest);
}
const oneLine = (s: string, n = 90) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
// the last sentence the seat wrote before the tool call: its "one line" about what it is changing
export function lastSentence(text: string): string {
  const parts = text.split(/(?<=[.!?:])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  return oneLine(parts[parts.length - 1] ?? "");
}

// a tool result's text: a string, or the SDK's blocks
export function resultText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : "")).join("\n");
  return "";
}

type Pending = { kind: "edit"; file: string } | { kind: "mutate" | "undo"; line: string };
export type Bus = (m: object) => void;

// One watcher per engine: `home` is home/, so sol/ is its parent. Each seat's stream calls tool(), result() and turn().
export class Changing {
  readonly sol: string;
  private pending = new Map<string, Pending & { seat: string; sessionId?: string }>();
  private edited = new Map<string | undefined, Set<string>>();   // per session: the face files its turn touched
  private recent = new Map<string, { seat: string; sessionId?: string; at: number }>();   // face file -> its last edit
  private before = new Map<string, string | null>();   // face file -> its content before the seat's first edit (null: did not exist), so a take-back restores Marco's own uncommitted work too (#16 blocker 4)
  private broken = new Map<string, { error: string; since: number; timer?: NodeJS.Timeout }>();   // part -> waiting to mend
  constructor(private home: string, private bus: Bus) { this.sol = resolve(real(home), ".."); }

  // a tool call is starting. `cwd` is where the seat runs (home/ for Life, the session's folder for Work); `said` is its
  // text in the same message, before the call
  tool(seat: string, sessionId: string | undefined, id: string, name: string, input: any, cwd: string, said = "") {
    const i = input ?? {};
    const line = lastSentence(said);
    if (EDITS.has(name)) {
      const p = typeof i.file_path === "string" ? i.file_path : typeof i.notebook_path === "string" ? i.notebook_path : "";
      if (!p) return;
      const abs = isAbsolute(p) ? p : resolve(cwd, p);
      if (!mutableWrite(this.home, abs)) return;
      const file = relative(this.sol, real(abs)).split(sep).join("/");
      this.pending.set(id, { kind: "edit", file, seat, sessionId });
      if (!this.edited.has(sessionId)) this.edited.set(sessionId, new Set());
      this.edited.get(sessionId)!.add(file);
      if (FACE.test(file)) {
        this.recent.set(file, { seat, sessionId, at: Date.now() });
        if (!this.before.has(file)) { try { this.before.set(file, readFileSync(resolve(this.sol, file), "utf8")); } catch { this.before.set(file, null); } }
      }
      this.bus({ type: "changing", seat, sessionId, kind: "edit", file, line, done: false });
    } else if (name === "Bash") {
      const cmd = String(i.command ?? "").trim();
      const which = this.script(cmd, cwd);
      if (!which) return;
      const msg = which === "mutate" ? oneLine(cmd.replace(/^\S+\s*/, "").replace(/^(['"])([\s\S]*)\1$/, "$2")) : "";
      this.pending.set(id, { kind: which, line: msg, seat, sessionId });
      this.bus({ type: "changing", seat, sessionId, kind: which, line: msg || line, done: false });
    }
  }

  // its result came back; `out` is the tool result's content (mutate and undo print "<kind>: <hash> ..."), so the
  // commit read is the one this step made, never a later one that landed while this was awaited
  async result(id: string, ok: boolean, out?: unknown) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (p.kind === "edit") { this.bus({ type: "changing", seat: p.seat, sessionId: p.sessionId, kind: "edit", file: p.file, line: "", done: true, ok }); return; }
    const hash = new RegExp(`^${p.kind}: ([0-9a-f]{7,40})\\b`, "m").exec(resultText(out))?.[1];
    const head = ok ? await this.head(hash ?? "HEAD") : null;
    this.bus({ type: "changing", seat: p.seat, sessionId: p.sessionId, kind: p.kind, files: head?.files ?? [], line: head?.line ?? p.line, done: true, ok: ok && !!head });
  }

  // the turn is over (finished, failed or stopped): anything a step left open closes too
  turn(seat: string, sessionId?: string) {
    for (const [id, p] of this.pending) if (p.sessionId === sessionId) this.pending.delete(id);
    this.bus({ type: "changing", seat, sessionId, kind: "turn", done: true });
    const files = [...(this.edited.get(sessionId) ?? [])].filter((f) => FACE.test(f));
    this.edited.delete(sessionId);
    if (files.length) void this.compiles(seat, sessionId, files);
  }

  // ---- a part that throws when it draws (the window's boundary, Site.tsx) ----
  private recentFiles(): string[] {
    const since = Date.now() - RECENT_MS;
    return [...this.recent].filter(([, r]) => r.at >= since).map(([f]) => f);
  }
  broke(site: string, error = "") {
    if (!site || this.broken.has(site)) return;
    const files = this.recentFiles();
    if (!files.length) { console.log(`face: ${partWords(site)} broke (${oneLine(error, 80)}), no recent edit behind it, left alone`); return; }
    console.log(`face: ${partWords(site)} broke (${oneLine(error, 80)}) after ${files.join(", ")} changed; ten seconds to mend`);
    this.broken.set(site, { error, since: Date.now(), timer: setTimeout(() => void this.settle(site), MEND_MS) });
  }
  mended(site: string) {
    const b = this.broken.get(site);
    if (!b) return;
    clearTimeout(b.timer);
    this.broken.delete(site);
    console.log(`face: ${partWords(site)} mended by itself, nothing taken back`);
  }
  private async settle(site: string) {
    const b = this.broken.get(site);
    if (!b) return;
    // a turn that edits the face is still running: the seat may be mid-change, so ask again in ten seconds; still at it
    // after two minutes, it is left to the seat (a take-back now would overwrite the edits it is making)
    const busy = [...this.edited.values()].some((set) => [...set].some((f) => FACE.test(f)));
    if (busy && Date.now() - b.since < RECENT_MS) { b.timer = setTimeout(() => void this.settle(site), MEND_MS); return; }
    this.broken.delete(site);
    if (busy) { console.log(`face: ${partWords(site)} still broken, but a turn is still editing the face; left to the seat`); return; }
    const files = this.recentFiles();
    if (!files.length) return;
    const last = files.map((f) => this.recent.get(f)!).sort((x, y) => y.at - x.at)[0];
    for (const f of files) this.recent.delete(f);   // taken back once: the same edit never triggers a second take-back
    console.log(`face: ${partWords(site)} did not mend, taking back ${files.join(", ")}`);
    const taken = await this.takeBack(files);
    if (!taken.length) return;
    const line = `${partWords(site)} broke (${oneLine(b.error, 60)}); took back ${taken.map((f) => f.slice("mac/src/".length)).join(", ")}`;
    console.log(`face: ${line}`);
    this.bus({ type: "face.reverted", seat: last.seat, sessionId: last.sessionId, site, files: taken, line });
  }

  // the hot face's answer for a file: true compiles (a module came back), false does not (Vite answers 5xx with its
  // error page), null nothing to check (no hot face, or its index.html fallback for a path it does not serve)
  private async hot(file: string): Promise<boolean | null> {
    try {
      const r = await fetch(`http://localhost:1420/${file.slice("mac/".length)}`, { signal: AbortSignal.timeout(4000) });
      if (r.status >= 500) return false;
      return /javascript|css/.test(r.headers.get("content-type") ?? "") ? true : null;
    } catch { return null; }
  }

  private async compiles(seat: string, sessionId: string | undefined, files: string[]) {
    const broken = async (list: string[]) => { const out: string[] = []; for (const f of list) if ((await this.hot(f)) === false) out.push(f); return out; };
    await new Promise((r) => setTimeout(r, 1500));   // Vite serves the old transform for a moment after a write
    let bad = await broken(files);
    if (!bad.length) return;
    await new Promise((r) => setTimeout(r, 10_000));   // a seat may be mid-change across turns: give it a moment
    bad = await broken(bad);
    if (!bad.length) return;
    console.log(`face: ${bad.join(", ")} did not compile after the turn, taking the edit back`);
    const taken = await this.takeBack(bad);
    for (const f of taken) this.recent.delete(f);
    if (!taken.length) return;
    const still = await broken(taken);
    const line = `${taken.map((f) => f.slice("mac/src/".length)).join(", ")} did not compile${still.length ? ", and still does not" : ""}`;
    console.log(`face: ${line}`);
    this.bus({ type: "face.reverted", seat, sessionId, files: taken, line });
  }

  // Take face files back to before the seat touched them. An edit not yet committed: the file goes back to the content
  // it had before the seat's first edit (kept at that edit, so Marco's own uncommitted work in it survives; a file that
  // did not exist is removed); with no such copy (the seat edited through a shell), git checkout as a last resort, said
  // so in the log. An edit already committed by ../mutate: ../undo, only when the newest commit is a mutate that touched
  // the file; a file the newest mutate did not touch is left alone and named in the log, never undone by proxy. Returns
  // the files really taken back (#16 blocker 4).
  async takeBack(files: string[]): Promise<string[]> {
    const taken: string[] = [];
    let undid: string[] = [];
    for (const f of files) {
      try {
        if (undid.includes(f)) { taken.push(f); continue; }
        const abs = resolve(this.sol, f);
        const tracked = await run("git", ["-C", this.sol, "ls-files", "--error-unmatch", f], { timeout: 5000 }).then(() => true, () => false);
        const dirty = tracked && await run("git", ["-C", this.sol, "diff", "--quiet", "--", f], { timeout: 5000 }).then(() => false, () => true);
        if (!tracked || dirty) {
          if (this.before.has(f)) {
            const was = this.before.get(f)!;
            if (was === null) rmSync(abs, { force: true }); else { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, was); }
          } else if (!tracked) rmSync(abs, { force: true });
          else { console.log(`face: no copy of ${f} from before the seat's edit; git checkout (any uncommitted edit of Marco's in it goes too)`); await run("git", ["-C", this.sol, "checkout", "--", f], { timeout: 5000 }); }
          this.before.delete(f);
          taken.push(f);
          continue;
        }
        const head = await this.head("HEAD");
        if (!head || !head.line.startsWith("mutate: ") || !head.files.includes(f)) {
          console.log(`face: could not take back ${f}: the newest commit is not a mutate that touched it; left as it is`);
          continue;
        }
        const { stdout } = await run(resolve(this.sol, "undo"), [], { timeout: 15000 });   // the broken edit is that mutate commit
        undid = head.files;
        this.before.delete(f);
        taken.push(f);
        console.log(stdout.trim());
      } catch (err) {
        console.log(`face: could not take back ${f}:`, err instanceof Error ? err.message.split("\n")[0] : String(err));
      }
    }
    return taken;
  }


  // "../mutate msg", "sol/mutate msg", or the full path: the first word, from where the seat runs, is sol/mutate or sol/undo
  private script(cmd: string, cwd: string): "mutate" | "undo" | null {
    const first = cmd.split(/\s+/)[0] ?? "";
    if (!first || !/(^|\/)(mutate|undo)$/.test(first)) return null;
    const abs = real(isAbsolute(first) ? first : resolve(cwd, first));
    for (const name of ["mutate", "undo"] as const) if (abs === resolve(this.sol, name)) return name;
    return null;
  }

  // what the commit the script just made touched (mac/src and design/ only), and its one line without the prefix
  private async head(rev: string): Promise<{ files: string[]; line: string } | null> {
    try {
      const { stdout } = await run("git", ["-C", this.sol, "show", "--name-only", "--relative", "--format=%s", rev, "--"], { timeout: 5000 });
      const [subject, ...rest] = stdout.split("\n");
      if (!/^(mutate|undo): /.test(subject)) return null;
      const files = rest.map((f) => f.trim()).filter((f) => f.startsWith("mac/src/") || f.startsWith("design/"));
      return { files, line: oneLine(subject) };
    } catch { return null; }
  }
}
