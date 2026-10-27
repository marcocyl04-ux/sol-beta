// Ship (#33): the window's half of "a new stable is out". One line over the composer in Work and Cowork (Composer.tsx
// mounts it), the same words as the notch card: the tag, who stamped it, Update (filled) and Later. Update asks the
// engine to fast-forward this checkout (team.update); while it runs the line says so and the buttons go; when the
// engine's code changed Sol renews a moment later. Later puts this stable off on this Mac (both windows) for 12 hours.
import { later, update, useStable } from "./stable";
import { Droplet } from "../creature/goo";
import "./ship.css";

export function StableLine() {
  const s = useStable();
  if (!s) return null;
  const d = s.doing;
  const name = s.tag || s.sha.slice(0, 7);
  const cls = d ? (d.updating ? "busy" : d.failed ? "failed" : "done") : "";
  return (
    <div className={`sline ${cls}`} role="status">
      <span className="what" title={`${s.tag} · ${s.sha.slice(0, 7)}`}>
        <Droplet kind={d ? (d.updating ? "running" : d.failed ? "failed" : "done") : "needs"} size={12} seed={s.sha} className="cstate" />
        {d ? d.said : <>a new stable is out <b>{name}</b>{s.by && <> · by <span className="by">{s.by}</span></>}</>}
      </span>
      {!d?.updating && !(d && !d.failed) && (
        <span className="moves">
          {!d && <button className="wbtn" onClick={() => void update()} title="bring this Mac up to the new stable; Sol renews itself after when its code changed">Update</button>}
          <button className="wbtn ghost" onClick={() => later(s.sha)} title="put it off for 12 hours, here and in the notch">Later</button>
        </span>
      )}
    </div>
  );
}
