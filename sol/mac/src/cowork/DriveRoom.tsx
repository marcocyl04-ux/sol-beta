// A Drive room (#152): its record is a Google Drive folder, read and written with the person's own Google account. Two
// small parts, kept here so the side stays as it was for every other room:
// - DriveConnect: whether Google Drive is connected on this Sol, and the explicit step that connects it (Google's page in
//   the system browser, through the cloud; nothing about it is ever a token on a face);
// - DriveRow: under the rooms, for the room in use when it is a Drive room: who its folder is shared with, from Drive
//   itself; unknown is said as unknown, never as nobody.
import { useCallback, useEffect, useState } from "react";
import type { Team } from "./useTeam";

export type DriveState = { connected: boolean; email: string; whole: boolean; hub?: string };
export type DriveMembers = { known: boolean; people: { email: string; name: string; role: string }[]; anyone: boolean; domain: string; me?: string; error?: string };

/** the Drive connection, asked once and kept while the part is up; connect and let go */
export function useDrive(team: Team) {
  const [drive, setDrive] = useState<DriveState | null>(null);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState("");
  useEffect(() => { let on = true; void team.ask<DriveState>("team.drive").then((d) => { if (on && typeof d?.connected === "boolean") setDrive(d); }); return () => { on = false; }; }, [team]);
  const connect = useCallback(async () => {
    setBusy(true); setBad("");
    const r = await team.ask<DriveState & { ok?: boolean; error?: string }>("team.drive.connect", {}, 11 * 60_000);
    setBusy(false);
    if (r.ok) setDrive({ connected: true, email: r.email ?? "", whole: !!r.whole });
    else setBad(r.error ?? "Google Drive was not connected");
  }, [team]);
  const letGo = useCallback(async () => {
    await team.ask("team.drive.disconnect");
    setDrive({ connected: false, email: "", whole: false });
  }, [team]);
  return { drive, busy, bad, connect, letGo };
}

/** connected as whom, or the button that connects */
export function DriveConnect({ team }: { team: Team }) {
  const { drive, busy, bad, connect } = useDrive(team);
  if (!drive) return null;
  return (
    <div className="cdrive">
      {drive.connected
        ? <small className="cdim">Google Drive: {drive.email || "connected"}{!drive.whole && "; this cloud reaches only folders Sol made, so a pasted folder will not open"}</small>
        : <button className="wlink" disabled={busy} onClick={(ev) => { ev.stopPropagation(); void connect(); }}>{busy ? "finish in your browser…" : "connect Google Drive"}</button>}
      {bad && <p className="cbad">{bad}</p>}
    </div>
  );
}

/** the room in use's folder: connect, then its people */
export function DriveRow({ team, folder }: { team: Team; folder: string }) {
  const { drive, busy, bad, connect } = useDrive(team);
  const [m, setM] = useState<DriveMembers | null>(null);
  useEffect(() => {
    if (!drive?.connected) { setM(null); return; }
    let on = true;
    void team.ask<DriveMembers>("team.drive.members").then((x) => { if (on && typeof x?.known === "boolean") setM(x); });
    return () => { on = false; };
  }, [team, drive?.connected, folder]);
  if (!drive) return null;
  const open = () => window.open(`https://drive.google.com/drive/folders/${encodeURIComponent(folder)}`, "_blank", "noopener");
  return (
    <div className="cdrive" data-s>
      <div className="cdrivehead">
        <button className="wlink" onClick={open} title="open the room's folder in Google Drive">the Drive folder</button>
        {!drive.connected && <button className="wlink" disabled={busy} onClick={() => void connect()}>{busy ? "finish in your browser…" : "connect Google Drive"}</button>}
      </div>
      {bad && <p className="cbad">{bad}</p>}
      {drive.connected && m && (m.known
        ? <ul className="cdrivepeople">
          {m.people.map((p) => <li key={p.email} title={p.email}><span className="t">{p.name || p.email}{p.email === m.me && <small className="cdim"> (you)</small>}</span><small className="cwhat">{p.role === "writer" || p.role === "owner" || p.role === "organizer" || p.role === "fileOrganizer" ? (p.role === "owner" ? "owner" : "can edit") : "can read"}</small></li>)}
          {(m.anyone || m.domain) && <li className="cdim"><small>{m.anyone ? "anyone with the link can open it" : `anyone at ${m.domain} can open it`}; only the people above can open the room's record</small></li>}
        </ul>
        : <small className="cdim">who is in: unknown ({m.error ?? "Drive did not say"})</small>)}
    </div>
  );
}
