// The one card about counting (#356, Frank 2026-10-29): on the first window after the first run, once, over either mode.
// Four lines and one button. It says what Sol counts, what it never records, that it reads Claude Code's and Codex's
// files on this Mac for numbers, that the counts carry the person's name, and where to say no (the beta Discord). The
// press writes settings.track.told; nothing else on the wire. There is no switch in Settings: a tester who wants it off
// or gone says so in Discord and the team does it by hand (engine/src/track.ts, docs/analytics/tracking.md).
import "./counts.css";

export function CountsCard({ onOk }: { onOk: () => void }) {
  return (
    <div className="counts" role="dialog" aria-label="Sol counts how it is used">
      <p className="counts-h">Sol counts how it is used</p>
      <p className="counts-p">Which buttons you press, how long a turn takes, which mode and which AI answered, what broke. Never what you type, say, read or open.</p>
      <p className="counts-p">It also reads Claude Code's and Codex's files on this Mac to count tokens and your plan, and sends numbers, not content.</p>
      <p className="counts-p">The counts carry your name and go to the team once a day. To turn it off or delete it, say so in the beta testers' Discord.</p>
      <button className="counts-ok" onClick={onOk} autoFocus>OK</button>
    </div>
  );
}
