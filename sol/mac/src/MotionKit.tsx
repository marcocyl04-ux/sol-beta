// The React side of motion.ts: components that carry a transition inside them.
//   Fold   a height that unfolds on a spring, its children arriving one after another
//   Swap   one thing leaves up, the next arrives from below, the box between them resizing on the same spring
//   Turn   a glyph that turns to its other position with overshoot (a caret, a chevron)
//   Pill   the sliding highlight behind a list
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CFG, Spring, reducedMotion, slidePill, stagger, useSpring, type Cfg } from "./motion";

// ---- Fold ----
// Closed: height 0, inert. Open: height auto (so focus rings and dust are never clipped). Between: a spring on the
// height, the content tucked a few pixels behind the edge so it rises into view, and on opening every child (up to
// nine) slides in a beat after the one before. Interrupting it mid-way reverses with the same velocity.
export function Fold({ open, children, className, lazy, from = { y: 12 }, gap = 34, onRest }: {
  open: boolean; children: ReactNode; className?: string; lazy?: boolean; from?: { x?: number; y?: number }; gap?: number; onRest?: () => void;
}) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const [render, setRender] = useState(open || !lazy);
  if (open && !render) setRender(true);
  const first = useRef(true);
  const H = useRef(0);
  const p = useSpring(open ? 1 : 0, CFG.fold, (v, s) => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    if (s.resting && v === 1 && s.target === 1) { o.style.height = ""; o.style.overflow = ""; i.style.translate = ""; return; }
    if (s.resting && v === 0 && s.target === 0) { o.style.height = "0px"; o.style.overflow = "hidden"; i.style.translate = ""; return; }
    o.style.overflow = "hidden";
    o.style.height = `${Math.max(0, Math.round(v * H.current))}px`;   // whole pixels: the slow end of the spring lays nothing out
    i.style.translate = `0 ${(v - 1) * 10}px`;
  }, () => { if (!open && lazy) setRender(false); onRest?.(); });

  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    if (first.current) {
      first.current = false;
      o.style.height = open ? "" : "0px"; o.style.overflow = open ? "" : "hidden";
      return;
    }
    H.current = i.offsetHeight;
    if (open) {
      p.cfg = CFG.fold;
      if (p.resting && p.v === 0) { o.style.height = "0px"; o.style.overflow = "hidden"; }
      if (!reducedMotion()) stagger(i.children, { ...from, gap, delay: 40 });
    } else {
      p.cfg = CFG.tuck;
      if (p.resting && p.v === 1) { o.style.height = `${H.current}px`; o.style.overflow = "hidden"; }
    }
    p.to(open ? 1 : 0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // content that changes size while it is moving (a list that loads) keeps the target honest
  useEffect(() => {
    const i = inner.current;
    if (!i || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (!p.resting) H.current = i.offsetHeight; });
    ro.observe(i);
    return () => ro.disconnect();
  }, [p]);

  return (
    <div ref={outer} className={className} inert={!open}>
      <div ref={inner} className="fold-in">{render ? children : null}</div>
    </div>
  );
}

// ---- Swap ----
// Change `k` and the old content slides out (up by default) while the new slides in from the other side; the box
// between them resizes on the same spring. Same `k` just updates in place (a sentence still being written).
type Layer = { k: string; node: ReactNode };
export function Swap({ k, children, className, style, dir = 1, dist = 22, cfg = CFG.arrive }: {
  k: string; children: ReactNode; className?: string; style?: CSSProperties; dir?: 1 | -1; dist?: number; cfg?: Cfg;
}) {
  const [shown, setShown] = useState<Layer>({ k, node: children });
  const [out, setOut] = useState<Layer | null>(null);
  const box = useRef<HTMLDivElement>(null), inEl = useRef<HTMLDivElement>(null), outEl = useRef<HTMLDivElement>(null);
  const dims = useRef({ from: 0, to: 0 });
  const sp = useSpring(1, { ...cfg, eps: 0.002 }, (v, s) => {
    const b = box.current;
    if (!b) return;
    const done = s.resting && v === 1;
    if (inEl.current) inEl.current.style.translate = done ? "" : `0 ${(1 - v) * dist * dir}px`;
    if (outEl.current) outEl.current.style.translate = `0 ${-v * (dist + 6) * dir}px`;
    b.style.height = done ? "" : `${Math.round(dims.current.from + (dims.current.to - dims.current.from) * Math.min(v, 1.04))}px`;
  }, () => setOut(null));

  useLayoutEffect(() => {
    if (k !== shown.k) {
      dims.current.from = box.current?.offsetHeight ?? 0;
      setOut(shown);
      setShown({ k, node: children });
    } else if (shown.node !== children) setShown({ k, node: children });
  }, [k, children]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!out) return;
    const b = box.current!;
    b.style.height = "";
    dims.current.to = b.offsetHeight; // the new layer is the one in flow
    if (reducedMotion()) { setOut(null); return; }
    b.style.height = `${dims.current.from}px`;
    sp.set(0);
    sp.to(1);
  }, [out]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={box} className={`swap ${className ?? ""}`} style={style}>
      <div ref={inEl} className="swap-in">{shown.node}</div>
      {out && <div ref={outEl} className="swap-out" aria-hidden="true">{out.node}</div>}
    </div>
  );
}

// ---- Turn: rotate to a new angle with a spring that overshoots, like a caret that is let go of ----
export function Turn({ to, children, className, cfg = CFG.snap }: { to: number; children: ReactNode; className?: string; cfg?: Cfg }) {
  const el = useRef<HTMLSpanElement>(null);
  const s = useSpring(to, { ...cfg, eps: 0.05 }, (v) => { if (el.current) el.current.style.rotate = `${v}deg`; });
  useLayoutEffect(() => { if (el.current) el.current.style.rotate = `${s.v}deg`; }, [s]);
  useEffect(() => { if (s.target !== to) s.to(to, { cfg: { ...cfg, eps: 0.05 } }); }, [to]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={el} className={className} style={{ display: "inline-flex" }}>{children}</span>;
}

// ---- Pill: the highlight that slides to the hovered row, or to the row that is on ----
// `mode="hover"` follows the pointer over `selector` children of the parent; `mode="on"` follows `selector` (the
// active one) whenever `watch` changes. Mount it as the first child of a positioned container.
export function Pill({ selector, mode, watch, className, fit = true, dx, dy }: {
  selector: string; mode: "hover" | "on"; watch?: unknown; className?: string; fit?: boolean; dx?: number; dy?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const api = useRef<ReturnType<typeof slidePill> | null>(null);
  useLayoutEffect(() => {
    const pill = ref.current, box = pill?.parentElement;
    if (!pill || !box) return;
    const a = (api.current = slidePill(box, pill, { fit, dx, dy }));
    if (mode === "hover") {
      let cur: HTMLElement | null = null;
      const over = (e: PointerEvent) => {
        const t = (e.target as Element).closest?.(selector) as HTMLElement | null;
        cur = t && box.contains(t) ? t : null;
        a.to(cur);
      };
      const leave = () => { cur = null; a.to(null); };
      const scroll = () => a.follow();
      box.addEventListener("pointerover", over);
      box.addEventListener("pointermove", over);
      box.addEventListener("pointerleave", leave);
      box.addEventListener("scroll", scroll, { passive: true });
      return () => { box.removeEventListener("pointerover", over); box.removeEventListener("pointermove", over); box.removeEventListener("pointerleave", leave); box.removeEventListener("scroll", scroll); a.destroy(); };
    }
    return () => a.destroy();
  }, [selector, mode, fit, dx, dy]);
  useLayoutEffect(() => {
    if (mode !== "on") return;
    const box = ref.current?.parentElement;
    api.current?.to((box?.querySelector(selector) as HTMLElement | null) ?? null);
  }, [watch, mode, selector]);
  return <i ref={ref as React.RefObject<HTMLElement & HTMLUnknownElement>} className={`pill ${className ?? ""}`} aria-hidden="true" />;
}

export { Spring };
