import { useEffect, useState } from "react";

// How long something has been going on, said the way the Claude app says it under a running step: "20s", "1m 5s",
// "1h 2m". A long step and a stuck one look the same without it (#47).
export const span = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

// the time, ticking once a second while `on`
export function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

export function Elapsed({ at, title }: { at: unknown; title?: string }) {
  const now = useNow(true);
  const t = Number(at);
  if (!t) return null;
  return <span className="elapsed" title={title}>{span(now - t)}</span>;
}
