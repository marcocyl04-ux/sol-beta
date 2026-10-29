// A call in a project session (#24, round two): the voice's turns go into THAT session, as if typed in its box. The
// run's events already reach every face (work/wire.ts), so the session shows the call's words and answers like any
// turn; this only listens to the same events to hand the answer's words to the voice as they stream.
//
// What it hears, per session: `work.item` (an item put or changed: the voice's "me", Claude's "you", tools, thinking),
// `work.delta` (a chunk of an item's text) and `work.run` with `ended` (the turn is over). The voice speaks only the
// main thread's words ("you" items with no parent), never thinking or a helper's. A line said while a turn runs waits
// in the run's queue (#51): the turn it waits for ends first, and that end is not this one's.
export type WorkAsk = { sessionId: string; text: string };
export type WorkDeps = {
  say: (s: WorkAsk) => Promise<unknown>;   // workSay with the wire's bus
  stop: (sessionId: string) => void;       // the run's stop
  listen: (fn: (m: any) => void) => () => void;   // the wire's events; returns the unlisten
};

export function askWork(d: WorkDeps, s: WorkAsk, abort: AbortSignal, onDelta?: (text: string) => void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const kinds = new Map<string, { kind: string; parent?: string }>();
    const streamed = new Set<string>();   // the items whose words came in chunks
    let mine: string | null = null, queued = false, said = "";
    const speak = (t: string) => { said += t; onDelta?.(t); };
    const off = d.listen((m) => {
      if (!m || m.sessionId !== s.sessionId) return;
      if (m.type === "work.item" && m.item?.id) {
        const it = m.item;
        kinds.set(it.id, { kind: it.kind, parent: it.parent });
        if (!mine && it.kind === "me" && it.text === s.text) { mine = it.id; queued = !!it.queued; }
        else if (it.id === mine && !it.queued) queued = false;
        // a "you" line that arrives whole, with no chunks before it, is spoken whole
        else if (mine && !queued && it.kind === "you" && !it.parent && !it.live && it.text && !streamed.has(it.id)) { streamed.add(it.id); speak(String(it.text)); }
      } else if (m.type === "work.delta" && mine && !queued) {
        const k = kinds.get(m.id);
        if (k?.kind === "you" && !k.parent && m.text) { streamed.add(m.id); speak(String(m.text)); }
      } else if (m.type === "work.run" && m.ended && mine && !queued) { done(); resolve(said); }
    });
    const done = () => { off(); abort.removeEventListener("abort", stop); };
    const stop = () => { d.stop(s.sessionId); done(); reject(new Error("stopped")); };
    abort.addEventListener("abort", stop, { once: true });
    d.say(s).catch((err) => { done(); reject(err); });
  });
}
