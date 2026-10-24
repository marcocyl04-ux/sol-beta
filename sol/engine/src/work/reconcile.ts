// The moves on a split thread, and "fork here" for a session open elsewhere. Nothing is ever deleted from a
// transcript and Sol never writes one itself: every write is the SDK's or the CLI's.
//   append   one note on an end, as a user message that asks for no answer (shouldQuery: false): the CLI writes it
//            at the end it resumes at, and no model is called. Resume picks the newest end, so the note also makes
//            the kept end the one a later resume follows.
//   carry    an end into a session of its own, clean: the SDK's forkSession copies the file up to that end (in file
//            order, so the other branch's earlier entries come along), then the CLI forks that copy at its last reply
//            (it copies only the chain it loads, from the last summary on), and the in-between copy is deleted.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { query, forkSession, deleteSession, renameSession, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { threadMap, transcriptPath, type Segment, type ThreadMap, type Writer } from "./thread.js";
import { heldElsewhere, holders, HOLDER_NAME, moving, type Holder } from "./holders.js";
import { getRun, startingRun } from "./runs.js";
import { sessionInfo, invalidate } from "./sessions.js";
import { mark, workState } from "./state.js";
import { summariseBranch } from "../titles.js";

export const WRITER_NAME: Record<Writer, string> = { desktop: "the Claude app", sol: "Sol", terminal: "a terminal", unknown: "another Claude" };

export type ThreadView = ThreadMap & { held?: Holder; open: string[] };

// the map as the face draws it: ends already reconciled are marked, the rest are the open ones
export function threadView(id: string): ThreadView | null {
  const m = threadMap(id);
  if (!m) return null;
  const settled = workState().marks[id]?.settled ?? {};
  const segments = m.segments.map((s) => (s.head && settled[s.end] ? { ...s, settled: settled[s.end] } : s));
  const open = segments.filter((s) => s.head && !(s as any).settled).map((s) => s.id);
  const held = heldElsewhere(id);
  return { ...m, segments, open, ...(held ? { held } : {}) };
}

async function cwdOf(id: string) {
  const cwd = (await sessionInfo(id))?.cwd;
  if (!cwd) throw new Error("no such session");
  return cwd;
}

// nobody may be writing while a move writes: not another process, not Sol's own run of it
// (asked again right before each write: a summary takes seconds, and someone may have opened it meanwhile)
function quiet(id: string) {
  const h = heldElsewhere(id, true);
  if (h) throw new Error(`it is open in ${HOLDER_NAME[h.who]}: close it there first`);
  if (getRun(id) || startingRun(id)) throw new Error("Sol has it open: wait until its run closes (stop it, or 15 minutes idle)");
  if ((holders().get(id) ?? []).length) throw new Error("a run of it is still closing: try again in a moment");
}

const note = (text: string, uuid = randomUUID()): SDKUserMessage =>
  ({ type: "user", uuid, parent_tool_use_id: null, shouldQuery: false, message: { role: "user", content: text } }) as SDKUserMessage;

// one CLI run that only writes the note: the session it ends in, or an error
async function write(cwd: string, opts: { resume: string; at?: string; fork?: boolean }, text: string): Promise<string> {
  async function* one() { yield note(text); }
  let sid = "";
  let failed = "";
  const q = query({
    prompt: one(),
    options: {
      cwd, resume: opts.resume, ...(opts.at ? { resumeSessionAt: opts.at } : {}), ...(opts.fork ? { forkSession: true } : {}),
      settingSources: [], model: "claude-opus-5-5",   // no hooks, no project settings: nothing runs, nothing is asked
    },
  });
  try {
    for await (const m of q as AsyncIterable<any>) {
      if (m.session_id) sid = m.session_id;
      if (m.type === "result" && m.subtype !== "success") failed = (m.errors ?? []).join("; ") || m.subtype;
    }
  } catch (err) { failed ||= err instanceof Error ? err.message.split("\n")[0] : String(err); }
  if (failed) throw new Error(failed);
  return sid;
}

// an end into a clean session of its own, with a first note saying where it came from
async function carry(id: string, end: Segment, cwd: string, text: string, title: string): Promise<string> {
  const slice = (await forkSession(id, { upToMessageId: end.end, title })).sessionId;
  try {
    const path = transcriptPath(slice);
    if (!path) throw new Error("the copy did not appear");
    const rows = readFileSync(path, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e?.uuid && !e.isSidechain);
    if (!rows.some((e) => e.type === "assistant")) throw new Error("the copy has no reply to fork at");
    // the slice ends at this end, so a plain resume loads it, notes after its last reply included
    const out = await write(cwd, { resume: slice, fork: true }, text);
    if (!out || out === slice) throw new Error("the fork did not start");
    await renameSession(out, title).catch(() => {});
    return out;
  } finally {
    await deleteSession(slice).catch(() => {});
  }
}

const title = async (id: string) => { const i = await sessionInfo(id); return i?.customTitle || i?.summary || "this conversation"; };

// "fork here": a session another process holds goes on in a new one here, from the end it is at (the holder's own
// end when the thread is split)
export async function forkHere(id: string, endId?: string): Promise<string> {
  const v = threadView(id);
  if (!v) throw new Error("no transcript");
  const h = heldElsewhere(id);
  const heads = v.segments.filter((s) => s.head);
  const byHolder = h ? heads.filter((s) => s.writer === (h.who === "desktop" ? "desktop" : h.who === "terminal" ? "terminal" : "sol")) : [];
  const end = (endId && heads.find((s) => s.id === endId)) || [...(byHolder.length ? byHolder : heads)].sort((a, b) => b.last - a.last)[0];
  if (!end?.at) throw new Error("nothing to fork yet");
  const t = await title(id);
  const where = h ? `, which is open in ${HOLDER_NAME[h.who]}` : "";
  const out = await carry(id, end, await cwdOf(id), `[forked here from "${t}"${where}]`, `${t} (here)`);
  invalidate();
  return out;
}

// one end kept; the other folded in as a note on it, or carried into its own session. One move per session at a
// time, and no run starts while it writes (moving)
export async function reconcile(id: string, keepId: string, otherId: string, how: "fold" | "fork"): Promise<{ kept: string; forked?: string; note: string }> {
  if (moving.has(id)) throw new Error("a move on this thread is already under way");
  quiet(id);
  moving.add(id);
  try { return await settle(id, keepId, otherId, how); } finally { moving.delete(id); }
}

async function settle(id: string, keepId: string, otherId: string, how: "fold" | "fork") {
  const v = threadView(id);
  if (!v) throw new Error("no transcript");
  const keep = v.segments.find((s) => s.id === keepId && s.head);
  const other = v.segments.find((s) => s.id === otherId && s.head);
  if (!keep?.at || !other?.at || keep === other || !v.open.includes(other.id)) throw new Error("pick two open ends of this thread");
  const cwd = await cwdOf(id);
  const t = await title(id);
  let forked: string | undefined;
  let text: string;
  if (how === "fork") {
    quiet(id);
    forked = await carry(id, other, cwd, `[split off from "${t}": the branch ${WRITER_NAME[other.writer]} wrote, on its own]`, `${t} (${WRITER_NAME[other.writer]})`);
    // settled now: if the note below fails, a retry must not carry it out a second time
    mark(forked, { parent: id });
    mark(id, { settled: { [other.end]: `fork:${forked}` } });
    text = `[the branch ${WRITER_NAME[other.writer]} wrote went to its own session: "${t} (${WRITER_NAME[other.writer]})"]`;
  } else {
    const sum = await summariseBranch(other.prompts, other.said ?? "");
    const what = sum ?? (other.prompts.length ? `Marco asked ${other.prompts.slice(-4).map((p) => `"${p.slice(0, 90)}"`).join(", then ")}` : `${other.replies} replies, no new prompt`);
    text = `meanwhile, in ${WRITER_NAME[other.writer]}: ${what}`;
  }
  // the note goes on the kept end's tail. When that tail is the file's last entry a plain resume loads it (earlier
  // notes on it included); otherwise the CLI is asked to resume at its last reply, and when it will not (it loads the
  // newest end only) the kept end goes on in a clean session of its own instead, and this one points at it
  quiet(id);
  let kept = id;
  try {
    await write(cwd, keep.end === v.last ? { resume: id } : { resume: id, at: keep.at }, text);
  } catch (err) {
    if (!/No message found/.test(String((err as Error).message))) throw err;
    kept = await carry(id, keep, cwd, `[the thread "${t}" went on here, from the end ${WRITER_NAME[keep.writer]} wrote]\n\n${text}`, t);
    mark(id, { moved: kept });
  }
  mark(id, { settled: { [other.end]: how === "fork" ? `fork:${forked}` : "fold", ...(kept !== id ? { [keep.end]: `kept:${kept}` } : {}) } });
  invalidate();
  return { kept, ...(forked ? { forked } : {}), note: text };
}
