// Where a call goes (#24): any talk in Home, either seat. A chat (a Life conversation, Codex or Claude) is called
// through the engine's own call, as before; a project session (Claude Code, the work wire) is called with its id, so
// the voice's turns land in THAT session like typed ones (engine/src/call/work.ts). A session not yet begun has no id:
// the first line starts it, then it can be called. Cowork's session is a project session the same way.
export type CallAt = { work: false } | { work: true; session: string };
export const CALL_WHERE = "in a chat, or in a session once it has begun";

/** where a press calls, or null when nothing here can be called yet */
export function callAt(c: { shell?: unknown; session?: string | null }): CallAt | null {
  if (!c.shell) return { work: false };
  return c.session ? { work: true, session: c.session } : null;
}

type Caller = {
  up: boolean; callState: "off" | "ringing" | "live";
  settings?: { voice?: string } | null;
  call: () => void; send: (m: object) => unknown; flash: (s: string) => void;
};
/** start a call here, or hang up the one that is on (wherever it began) */
export function pressCall(e: Caller, at: CallAt | null) {
  if (e.callState !== "off") return e.call();   // hang up
  if (!at) return e.flash("say one thing in the session first, then call");
  if (!at.work) return e.call();                 // a chat's call, the engine's own
  if (!e.up) return;
  if (e.settings?.voice === "off") return e.flash("voice is off: Sol listens and writes, it does not talk (settings → voice)");
  e.send({ type: "call", work: true, sessionId: at.session });
}
