// The way back (#49): when the engine this window dials is not this Mac's own and has not answered for a while, one
// line under the composer names it and offers this Mac instead, so a move to a dead or refusing engine never strands
// the app at "engine is starting". A reconnect to this Mac's own engine shows nothing: the notch's plug handles that.
// One Sol (#62): under the "one" pick the window falls to this Mac by itself (oneSol.ts); the line says where it is.
import { useEffect, useState } from "react";
import { ENGINE, FAR_NAME, LIVE, NEXT, keptMachines, pickEngine, sameEngine } from "./useEngine";
import { ONE, fall } from "./engine";
import { riseMs, useOneSol } from "./oneSol";

const LATE_MS = 5000;

export function farName(): string {
  if (sameEngine(ENGINE, LIVE)) return FAR_NAME;
  const m = keptMachines()?.find((x) => sameEngine(x.url, ENGINE));
  if (m) return m.name;
  try { return new URL(ENGINE.replace(/^ws/, "http")).hostname; } catch { return ENGINE; }
}

export function EngineBack({ up }: { up: boolean }) {
  const far = !sameEngine(ENGINE, NEXT);
  const one = useOneSol();
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (up || !far) { setLate(false); return; }
    const t = setTimeout(() => setLate(true), LATE_MS);
    return () => clearTimeout(t);
  }, [up, far]);
  if (ONE && one.fell) return (
    <p className="eback" role="status">
      {one.held.length ? `${FAR_NAME} is back · Sol goes to it once this Mac ends ${one.held.join(", ")}` : `on this Mac · ${FAR_NAME} does not answer; back to it once it has answered for ${Math.round(riseMs() / 60_000)} min`}
    </p>
  );
  if (!late) return null;
  if (ONE) return (
    <p className="eback" role="status">
      {FAR_NAME} does not answer · this Mac in a moment, or <button onClick={fall}>now</button>
    </p>
  );
  return (
    <p className="eback" role="status">
      {farName()} does not answer · <button onClick={() => pickEngine("next")}>this Mac instead</button>
    </p>
  );
}
