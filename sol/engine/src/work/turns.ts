// What a run is doing, read from the SDK's stream: when a turn starts, and which background tasks live.
//
// A turn starts with the main thread's first assistant message or stream event. A background agent's own frames
// carry parent_tool_use_id, and they keep coming after the main thread's result: they are not a turn, and a run that
// took them for one stayed "running" with no result ever to end it (#45, 2026-10-20). The background tasks are the
// SDK's own level signal (background_tasks_changed, replace semantics), so a missed edge cannot wedge a stale count;
// the edges (task_started, task_notification) are read too, for a CLI that sends no level.

export type BgTask = { id: string; description: string; agent?: string };

/** a main-thread event that starts a turn (a message queued behind the last, a background task's end waking the main thread) */
export const startsTurn = (m: any): boolean =>
  (m?.type === "assistant" || m?.type === "stream_event") && !m.parent_tool_use_id;

const activity = (t: any): boolean => !!t && !t.ambient;   // watchers and skip-transcript tasks are not activity

/** the live background tasks after this message, or null when the message says nothing about them */
export function tasksAfter(m: any, prev: BgTask[]): BgTask[] | null {
  if (m?.type !== "system") return null;
  if (m.subtype === "background_tasks_changed" && Array.isArray(m.tasks))
    return m.tasks.filter(activity).map((t: any) => ({ id: String(t.task_id), description: String(t.description ?? ""), ...(t.subagent_type ? { agent: String(t.subagent_type) } : {}) }));
  if (m.subtype === "task_notification") {
    const id = String(m.task_id);
    return prev.some((t) => t.id === id) ? prev.filter((t) => t.id !== id) : null;
  }
  if (m.subtype === "task_started" && activity(m)) {
    const id = String(m.task_id);
    if (prev.some((t) => t.id === id)) return null;
    return [...prev, { id, description: String(m.description ?? ""), ...(m.subagent_type ? { agent: String(m.subagent_type) } : {}) }];
  }
  return null;
}

// the run's clock: when this stretch of work began (the turn, then the agents it left behind), 0 while idle. It
// starts when work starts and keeps its start across the turn's end while agents remain (#47).
export const sinceAfter = (working: boolean, since: number, now = Date.now()) => working ? since || now : 0;

/** What Marco says while the main thread works (#51): the run keeps it, in order, until the turn ends and then hands it
 *  to the SDK, where it begins the next turn; `take` pulls one out early, to hand in now (the Claude app's Read now,
 *  the SDK's priority "now": it joins the running turn at its next step) or to drop. */
export class Held<M extends { uuid?: string }> {
  private list: M[] = [];
  get size() { return this.list.length; }
  keep(m: M) { this.list.push(m); }
  take(uuid: string): M | undefined {
    const i = this.list.findIndex((m) => m.uuid === uuid);
    return i < 0 ? undefined : this.list.splice(i, 1)[0];
  }
  release(): M[] { const all = this.list; this.list = []; return all; }
}
