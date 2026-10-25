// The sheet's one line, at the top centre in a black pill: what to do now, or what happened. Lines slide, never swap
// (motion.html): the old one rides up out of the pill, the new one comes up from below, each on a spring, clipped by
// the pill so nothing fades. The pill's width follows the words on a spring. A receipt draws its check first.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CFG, Spring } from "../motion";

export type LineSay = { text: string; check?: boolean; id: number };

export function Line({ say }: { say: LineSay | null }) {
  const [shown, setShown] = useState<{ now: LineSay | null; was: LineSay | null }>({ now: say, was: null });
  const pill = useRef<HTMLDivElement>(null), nowEl = useRef<HTMLDivElement>(null), wasEl = useRef<HTMLDivElement>(null), chk = useRef<SVGPathElement>(null);
  const width = useRef<Spring | null>(null), drop = useRef<Spring | null>(null);
  useEffect(() => { if (say?.id !== shown.now?.id) setShown({ now: say, was: shown.now }); }, [say]);   // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const p = pill.current!, n = nowEl.current, w = wasEl.current;
    // the pill's width, to the new words (0 when there is nothing to say: the pill tucks up)
    const want = n ? n.scrollWidth + 36 : 0;
    if (!width.current) width.current = new Spring(want, CFG.snap, (v) => { p.style.width = `${Math.max(0, v)}px`; });
    width.current.to(want);
    if (!drop.current) drop.current = new Spring(want ? 0 : -60, CFG.slide, (v) => { p.style.translate = `-50% ${v}px`; });
    drop.current.to(want ? 0 : -60);
    p.style.width = `${width.current.v}px`;
    if (n) { const s = new Spring(30, CFG.slide, (v) => { n.style.translate = `0 ${v}px`; }); s.set(30); s.to(0, { delay: 40 }); }
    if (w) { const s = new Spring(0, { k: 330, z: 0.95 }, (v) => { w.style.translate = `0 ${v}px`; }); s.to(-30); }
    if (n && shown.now?.check && chk.current) { const c = chk.current, s = new Spring(100, { k: 120, z: 1 }, (v) => { c.style.strokeDashoffset = String(v); }); s.set(100); s.to(0, { delay: 160 }); }
  }, [shown]);
  return (
    <div className="line" ref={pill}>
      {shown.was && <div className="line-text" ref={wasEl} key={`w${shown.was.id}`}>{shown.was.check && <Check />}{shown.was.text}</div>}
      {shown.now && <div className="line-text" ref={nowEl} key={`n${shown.now.id}`}>{shown.now.check && <Check path={chk} />}{shown.now.text}</div>}
    </div>
  );
}
function Check({ path }: { path?: React.Ref<SVGPathElement> }) {
  return <svg className="line-check" viewBox="0 0 24 24" width="16" height="16"><path ref={path} d="M4 12.5 L10 18 L20 6" pathLength={100} strokeDasharray="100" strokeDashoffset={path ? 100 : 0} /></svg>;
}
