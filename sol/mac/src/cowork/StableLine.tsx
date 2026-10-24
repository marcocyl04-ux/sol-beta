// Ship (#33): the window's half of "a new stable is out". One line over the composer in Work and Cowork (Composer.tsx
// mounts it), the same words as the notch card: the tag, who stamped it, Update (filled) and Later. Update asks the
// engine to fast-forward this checkout (team.update); while it runs the line says so and the buttons go; when the
// engine's code changed Sol renews a moment later. Later puts this stable off on this Mac (both windows) for 12 hours.
import { later, update, useStable } from "./stable";
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
        <i />
        {d ? d.said : <>a new stable is out <b>{name}</b>{s.by && <> · by <span className="by">{s.by}</span></>}</>}
      </span>
      {!d?.updating && !(d && !d.failed) && (
        <span className="moves">
          {!d && <button className="first" onClick={() => void update()} title="bring this Mac up to the new stable; Sol renews itself after when its code changed">Update</button>}
          <button onClick={() => later(s.sha)} title="put it off for 12 hours, here and in the notch">Later</button>
        </span>
      )}
    </div>
  );
}
