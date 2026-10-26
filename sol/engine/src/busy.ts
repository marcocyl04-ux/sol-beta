// Busy (sitting 6, #16): the one place that knows what is live in this engine, so that nothing restarts it mid-job.
//
// The counter: every long job joins it when it starts and leaves when it ends: a Life turn (either seat), a Work run's
// turn, a call, a terminal, a review, a run cell's command, a talk (Anticipate). `renew` waits until the count is zero before going live
// with a new build, and says who it is waiting on; `promote` reads the count from /health on the live engine and waits
// the same way; the keeper never has to know, it only restarts what ended. No cap: a job that never ends (a terminal
// left open) holds the renew and is named in the log and the window, so Marco can close it.
//
// The writer lock: git's rule, one writer per session. A Life turn and a Work run on the same session id, or two Life
// turns on it, would write one transcript at once; the second is refused with the reason. One holder may take its own
// lock again (a Work run's turns under the run's own hold).

// A job that works in a folder says which (a GPT talk in a project folder, #182; a Work run): `busyIn` answers "is
// something running in this folder", for whatever would move or rename it (#181).
export type Job = { kind: string; id: string; since: number; note?: string; cwd?: string };

const jobs = new Map<symbol, Job>();
const waiters = new Set<() => void>();
let listeners: ((jobs: Job[]) => void)[] = [];

function changed() {
  const list = busyList();
  for (const l of listeners) l(list);
  if (!list.length) { const w = [...waiters]; waiters.clear(); for (const r of w) r(); }
}

/** a long job starts: returns the leave function (safe to call twice) */
export function join(kind: string, id: string, note?: string, cwd?: string): () => void {
  const key = Symbol(kind);
  jobs.set(key, { kind, id, since: Date.now(), ...(note ? { note } : {}), ...(cwd ? { cwd } : {}) });
  changed();
  let left = false;
  return () => { if (left) return; left = true; jobs.delete(key); changed(); };
}

export const busyCount = () => jobs.size;
export const busyList = (): Job[] => [...jobs.values()];
export const idle = () => jobs.size === 0;
/** the live jobs working in `path` or a folder under it */
export const busyIn = (path: string): Job[] => busyList().filter((j) => !!j.cwd && (j.cwd === path || j.cwd.startsWith(path.replace(/\/+$/, "") + "/")));
export function onBusy(l: (jobs: Job[]) => void) { listeners.push(l); return () => { listeners = listeners.filter((x) => x !== l); }; }

/** resolves when nothing is live (at once if nothing is) */
export function whenIdle(): Promise<void> {
  if (idle()) return Promise.resolve();
  return new Promise((r) => waiters.add(r));
}

/** one line naming what is live, for the log and the window */
export function busyLine(now = Date.now()): string {
  return busyList().map((j) => `${j.kind} ${j.id.slice(0, 8)}${j.note ? ` (${j.note})` : ""} ${Math.round((now - j.since) / 1000)}s`).join(", ");
}

// ---- the writer lock ----
const locks = new Map<string, { holder: string; depth: number; cwd?: string }>();

export class Held extends Error {
  constructor(public sessionId: string, public holder: string) { super(`${sessionId.slice(0, 8)} is being written by ${holder}`); }
}

/** take the session for `holder`; throws Held when another holder has it; returns the release (safe to call twice) */
export function lockSession(sessionId: string, holder: string, cwd?: string): () => void {
  const cur = locks.get(sessionId);
  if (cur && cur.holder !== holder) throw new Held(sessionId, cur.holder);
  if (cur) cur.depth++; else locks.set(sessionId, { holder, depth: 1, ...(cwd ? { cwd } : {}) });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const l = locks.get(sessionId);
    if (!l || l.holder !== holder) return;
    if (--l.depth <= 0) locks.delete(sessionId);
  };
}
export const sessionHolder = (sessionId: string) => locks.get(sessionId)?.holder ?? null;
/** the folder the session's writer works in, when it said */
export const sessionCwd = (sessionId: string) => locks.get(sessionId)?.cwd ?? null;

/** a turn that learns its session id after it started (a fresh Life conversation): move the hold onto the id */
export function relockSession(from: string, to: string, holder: string, cwd?: string): () => void {
  const l = locks.get(from);
  if (l && l.holder === holder) locks.delete(from);
  return lockSession(to, holder, cwd ?? l?.cwd);
}

// ---- letting go (One Sol, #62) ----
// A window going back to the NucBox asks this engine to let go. It is granted only while nothing is live, and for
// LET_GO_MS after it the engine refuses whatever would start a new job, so none starts between the answer and the
// window's reload (and none is left running unseen on this Mac).
export const LET_GO_MS = 15_000;
const STARTS = new Set(["say", "call", "work.say", "work.handover", "work.start", "work.fork", "work.forkhere", "work.compact",
  "work.review", "work.term.open", "team.session.start", "team.try", "team.try.review", "anticipate.start", "anticipate.ask"]);
let goneUntil = 0;
/** true (and the engine lets go for LET_GO_MS) when nothing is live; false, nothing changed, when something is */
export function letGo(now = Date.now()): boolean { if (!idle()) return false; goneUntil = now + LET_GO_MS; return true; }
/** a message that would start a job, while the engine is letting go */
export const refusedWhileLettingGo = (type: unknown, now = Date.now()) => now < goneUntil && typeof type === "string" && STARTS.has(type);

export const _reset = () => { jobs.clear(); locks.clear(); waiters.clear(); goneUntil = 0; };
