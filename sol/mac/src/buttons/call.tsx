import { VoiceBody } from "../creature/Voice";
import { forcedState } from "../creature/state";
import { callAt, pressCall, CALL_WHERE, type CallAt } from "../callAt";
import type { ButtonDef, Engine } from "./types";

const PATH = "M3.5 2h2.3l1 3-1.5 1a7 7 0 0 0 3.7 3.7l1-1.5 3 1v2.3a1.5 1.5 0 0 1-1.6 1.5A10.5 10.5 0 0 1 2 3.6 1.5 1.5 0 0 1 3.5 2z";
const phone = (   // the rail's glyph, sized by the rail
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={PATH} />
  </svg>
);
const phoneKey = (   // the chat bar's, the size of dictate's mic
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATH} /></svg>
);
const glyphOf = (e: Engine, size = 22) => e.callState === "live" || forcedState === "speaking" ? <VoiceBody kind="speaking" size={size} /> : e.callState === "ringing" ? <><i className="pulse" />{phone}</> : null;
const hoverOf = (e: Engine) => e.callState === "off" ? "call Sol: say it out loud, the words land in this talk" : e.callState === "ringing" ? "connecting…" : "hang up";

// The call in the chat bar (Picker), beside dictate: the same press as the rail's, in every Home talk and Cowork's
// session (callAt.ts). Hidden where nothing can be called yet: a session before its first line.
export function CallKey({ e, at }: { e: Engine; at: CallAt | null }) {
  if (!at && e.callState === "off") return null;
  return (
    <button type="button" className={`icon call-${e.callState}`} onClick={() => pressCall(e, at)} title={hoverOf(e)} aria-pressed={e.callState !== "off"}>
      {e.callState === "ringing" ? phoneKey : glyphOf(e, 20) ?? phoneKey}
    </button>
  );
}

// a voice call with the talk's seat; pressed again, it hangs up
export default {
  id: "call", name: "call", kind: "press", meant: ["home"], glyph: phone,
  says: "say it out loud instead: Sol picks up, and what you settle stays in this talk",
  shows: (c) => !!callAt(c),
  where: CALL_WHERE,
  on: ({ e }) => e.callState !== "off",
  look: ({ e }) => `barbtn wcall call-${e.callState}`,
  badge: ({ e }) => glyphOf(e),
  hover: ({ e }) => hoverOf(e),
  press: (c) => pressCall(c.e, callAt(c)),
} satisfies ButtonDef;
