// Run a code block (2026-10-16). Marco: "make it so I can run that code block directly in here and it prints the
// results like it would in Claude Code". A shell block in a message gets a "run" cell at its corner; pressed, the
// command goes to the engine ({ type: "run", rid, seat, sessionId, work, cmd }) and the output comes back as "ran"
// pieces, printed under the block as it arrives, the exit code at the end. The engine runs only a command it finds
// verbatim in a message of that conversation, and only for Sol's own windows (engine/src/run.ts).
// This module is the one store: who sends (the mode showing sets it), the outputs by rid, and the listeners.
export type Ran = { cmd: string; out: string; done: boolean; code: number | null; why?: string; heard?: boolean };

type Sender = { send: (o: object) => boolean; seat: "codex" | "claude"; sessionId: string | null; work?: boolean };
let sender: Sender | null = null;
const runs = new Map<string, Ran>();
const subs = new Set<() => void>();
const tell = () => { for (const f of subs) f(); };

export function setRunner(s: Sender | null) { sender = s; }
export const ranOf = (rid: string) => runs.get(rid);
export function onRan(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; }

export function request(rid: string, cmd: string) {
  if (!sender?.sessionId) return;
  const cur = runs.get(rid);
  if (cur && !cur.done) return;
  runs.set(rid, { cmd, out: "", done: false, code: null });
  // nothing went out (the socket is down): say so now, not after the wait
  if (!sender.send({ type: "run", rid, seat: sender.seat, sessionId: sender.sessionId, work: !!sender.work, cmd })) Object.assign(runs.get(rid)!, { done: true, why: "not connected" });
  tell();
  // an engine older than the run button never answers: say so instead of "running" forever
  setTimeout(() => { const r = runs.get(rid); if (r && !r.done && !r.heard) { r.done = true; r.why = "the engine did not answer: restart it to run blocks"; tell(); } }, 5000);
}
export const stopRun = (rid: string) => sender?.send({ type: "run.stop", rid });

/** the engine's "ran" pieces; the mode's subscribe feeds them here */
export function ran(m: { type?: string; rid?: string; out?: string; done?: boolean; code?: number | null; why?: string }) {
  if (m.type !== "ran") return;
  const r = runs.get(String(m.rid));
  if (!r) return;
  r.heard = true;
  if (m.out) r.out += m.out;
  if (m.why) r.why = m.why;
  if (m.done) { r.done = true; r.code = m.code ?? null; }
  tell();
}

/** which blocks get the cell: a shell fence, or a short untagged one */
export function runnable(code: HTMLElement): boolean {
  const lang = (code.className.match(/language-([\w-]+)/) ?? [])[1];
  if (lang) return /^(bash|sh|zsh|shell|console)$/.test(lang);
  const t = (code.textContent ?? "").trim();
  return t.length > 0 && t.split("\n").length <= 3;
}
