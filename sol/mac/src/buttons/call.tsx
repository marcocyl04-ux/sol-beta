import { VoiceBody } from "../creature/Voice";
import { forcedState } from "../creature/state";
import type { ButtonDef } from "./types";

const phone = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 2h2.3l1 3-1.5 1a7 7 0 0 0 3.7 3.7l1-1.5 3 1v2.3a1.5 1.5 0 0 1-1.6 1.5A10.5 10.5 0 0 1 2 3.6 1.5 1.5 0 0 1 3.5 2z" />
  </svg>
);
// a voice call with the chat's seat (Codex's realtime voice); pressed again, it hangs up
export default {
  id: "call", name: "call", kind: "press", meant: ["home"], glyph: phone,
  says: "say it out loud instead: Sol picks up, and what you settle stays in this chat",
  shows: ({ shell, e }) => !shell && e.seat === "codex",
  where: "outside a session, with Codex",
  on: ({ e }) => e.callState !== "off",
  look: ({ e }) => `barbtn wcall call-${e.callState}`,
  badge: ({ e }) => e.callState === "live" || forcedState === "speaking" ? <VoiceBody kind="speaking" size={22} /> : e.callState === "ringing" ? <><i className="pulse" />{phone}</> : null,
  hover: ({ e }) => e.callState === "off" ? "call Sol" : e.callState === "ringing" ? "connecting…" : "hang up",
  press: ({ e }) => e.call(),
} satisfies ButtonDef;
