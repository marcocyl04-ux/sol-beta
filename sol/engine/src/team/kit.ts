// The room's own tools (ADDITIONS §1, #245): a shared calendar, the decision log and polls, each one small file in the
// room's record beside the things and the goal (things.ts, goal.ts), so a GitHub room keeps them in its record repo
// and a cloud room on the cloud, with no line here knowing which. This is the one store the three share: a read cached
// 60 s a repo like the things, and a change made compare-and-swap on the file's sha (read, apply, put with the sha
// read; a conflict reads and applies again, three tries, then says so), so no edit is ever lost. What each file holds
// and what a change does is the tool's own pure module (calendar.ts, decisions.ts, polls.ts); nothing else is kept
// anywhere. Everything that touches the record is handed in (ThingsDeps), so the tests run with a fake record.
import { putFailure, recordBranch, type ThingsDeps } from "./things.js";

export const KIT_TTL = 60_000;
const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].trim().slice(0, 200);
const wordOf = (e: unknown) => String((e as { full?: string })?.full ?? (e as Error)?.message ?? e);
const notFound = (e: unknown) => /\(HTTP 404\)\s*$/.test(wordOf(e).trim()) || (/not found/i.test(wordOf(e)) && !/no commit found/i.test(wordOf(e)));
const PUT_LINE: Record<string, string> = { refused: "you can't write to this room yet", limit: "the record is rate-limiting you; try again in a minute" };

/** a change on one file (pure): the file after, whether it changed, a refusal in words, what the asker gets back, and
 *  the commit's message */
export type Applied<F, R> = { file: F; changed: boolean; error?: string; result?: R; message?: string };

/** why my agent may not write here, or "" (pure): no record; or my agent may not speak where the record is (GitHub for
 *  a GitHub room, Cowork for a cloud or a Drive room) */
export function agentRefusal(repo: string, may: boolean, verb = "added"): string {
  if (!repo) return "this room has no record yet; nothing " + verb;
  if (!may) return repo.startsWith("cloud:") || repo.startsWith("drive:") ? `not ${verb}: my agent may not speak in Cowork (Settings, my agent)` : `not ${verb}: my agent may not speak on GitHub (Settings, my agent), and the room's record is GitHub`;
  return "";
}

export class Store<F extends { newer?: true }, Op, R = unknown> {
  private cache = new Map<string, { file: F; at: number }>();
  private gen = 0;
  private subs = new Set<(repo: string, file: F) => void>();
  constructor(readonly path: string, private parse: (text: string) => F, private serialize: (f: F) => string, private apply: (f: F, op: Op) => Applied<F, R>, private what: string) {}

  /** the file and its sha on the record's branch; a missing file is the empty one. Throws when the record cannot be read */
  async read(d: ThingsDeps, repo: string): Promise<{ file: F; sha?: string; branch: string }> {
    const branch = await recordBranch(d, repo);
    let out = "";
    try { out = await d.record().files.readSha(repo, this.path, branch); }
    catch (e) { if (notFound(e)) return { file: this.parse(""), branch }; throw e; }
    let j: Record<string, unknown> = {};
    try { const v = JSON.parse(out); if (v && typeof v === "object") j = v as Record<string, unknown>; } catch { /* not what gh prints: an empty file */ }
    // GitHub sends a file over 1 MB with a sha and no content: never read that as empty, or the next write would replace
    // it (an empty file reads the same way, and is refused too: the file is fixed by hand, nothing is lost)
    if (j.sha && !j.content) throw new Error(`the room's ${this.what} file came back empty (over 1 MB?); nothing is written over it`);
    return { file: this.parse(Buffer.from(String(j.content ?? ""), "base64").toString("utf8")), sha: typeof j.sha === "string" ? j.sha : undefined, branch };
  }

  /** the file: the cached one when it is this repo's and under a minute old, else read anew; a read that fails answers
   *  the cached one when there is one, else throws */
  async get(d: ThingsDeps, repo: string, refresh = false, now = Date.now): Promise<F> {
    const had = this.cache.get(repo);
    if (!refresh && had && now() - had.at < KIT_TTL) return had.file;
    const g = this.gen;
    try {
      const { file } = await this.read(d, repo);
      if (g !== this.gen && this.cache.has(repo)) return this.cache.get(repo)!.file;   // a write landed while this read was out
      this.cache.set(repo, { file, at: now() });
      return file;
    } catch (e) {
      if (had) return had.file;
      throw e;
    }
  }

  /** one change, compare-and-swap, three tries; a change that changes nothing is no commit */
  async change(d: ThingsDeps, repo: string, op: Op): Promise<{ file: F; changed: boolean; result?: R } | { error: string }> {
    if (!repo) return { error: "this room has no record yet" };
    for (let i = 0; i < 3; i++) {
      let have: { file: F; sha?: string; branch: string };
      try { have = await this.read(d, repo); } catch (e) { return { error: `couldn't read the room's ${this.what}: ${firstLine(e)}` }; }
      if (have.file.newer) return { error: `this room's ${this.what} was written by a newer Sol; update Sol first` };
      const r = this.apply(have.file, op);
      if (r.error) return { error: r.error };
      if (!r.changed) return { file: have.file, changed: false, result: r.result };
      try {
        await d.record().files.putBody(repo, this.path, { message: r.message ?? `${this.what}: changed`, branch: have.branch, content: Buffer.from(this.serialize(r.file)).toString("base64"), ...(have.sha ? { sha: have.sha } : {}) });
      } catch (e) {
        const why = putFailure(e);
        if (why === "conflict") continue;
        return { error: PUT_LINE[why] ?? why };
      }
      this.cache.set(repo, { file: r.file, at: Date.now() });
      this.gen++;
      d.changed?.(repo);
      for (const f of this.subs) f(repo, r.file);
      return { file: r.file, changed: true, result: r.result };
    }
    return { error: "someone else changed it, try again" };
  }

  /** forget what was read: the room changed, or the relay said the record did */
  forget() { this.cache.clear(); this.gen++; }   // a read already out lands in no cache
  /** every change made here (wire.ts pushes the file to the Cowork faces) */
  on(fn: (repo: string, file: F) => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
}
