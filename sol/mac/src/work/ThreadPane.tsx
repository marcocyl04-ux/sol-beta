// The thread map: the open session's transcript as its tree. Time runs left to right in whole cells; a straight talk is
// one line, a split is lanes, one per end. Each end says who wrote it (the Claude app, Sol, a terminal), the model,
// its turns and when. With more than one open end the moves are here: keep one, and fold the other in (a note on the
// kept end saying what happened there) or fork it out (its own session). Nothing is deleted from the transcript.
// Ink only, the show's square cells; lanes slide in on a spring.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CFG, useSpring } from "../motion";
import type { Work } from "./useWork";

export type Seg = {
  id: string; from?: string; end: string; at?: string; n: number; turns: number; replies: number;
  writer: "desktop" | "sol" | "terminal" | "unknown"; model?: string; first: number; last: number; prompts: string[];
  head?: boolean; twig?: boolean; settled?: string;
};
export type ThreadMap = { sessionId: string; segments: Seg[]; heads: string[]; open: string[]; entries: number; held?: { who: string; status: string } };

export const WRITER: Record<Seg["writer"], string> = { desktop: "the Claude app", sol: "Sol", terminal: "a terminal", unknown: "another Claude" };
const model = (m?: string) => (m ?? "").replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2");
const when = (t: number) => {
  const d = new Date(t), today = new Date().toDateString() === d.toDateString();
  return (today ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " ") + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

type Laid = Seg & { lane: number; x0: number; x1: number };
// lanes: ends in the order they began, the trunk on the first; each segment as long as the root of its size, in cells
function lay(segs: Seg[]): { laid: Laid[]; lanes: number; cells: number } {
  const kids = new Map<string, Seg[]>();
  for (const s of segs) if (s.from) kids.set(s.from, [...(kids.get(s.from) ?? []), s]);
  const root = segs.find((s) => !s.from);
  const out: Laid[] = [];
  let lanes = 0;
  const len = (s: Seg) => Math.max(3, Math.min(36, Math.round(Math.sqrt(s.n) * 1.4)));
  const walk = (s: Seg, x0: number, lane: number) => {
    const me: Laid = { ...s, lane, x0, x1: x0 + len(s) };
    out.push(me);
    const ks = (kids.get(s.id) ?? []).sort((a, b) => a.first - b.first);
    ks.forEach((k, i) => walk(k, me.x1 + 1, i === 0 ? lane : ++lanes));
  };
  if (root) walk(root, 0, 0);
  return { laid: out, lanes: lanes + 1, cells: Math.max(1, ...out.map((s) => s.x1)) };
}

// the open session's map, asked again whenever its row changes (a write, a holder, a move); the bar and the pane share it
export function useThreadMap(w: Work, id: string | null): { map: ThreadMap | null; err: string } {
  const [got, setGot] = useState<{ id: string; map: ThreadMap | null; err: string } | null>(null);
  const asked = useRef(0);
  const sess = id ? w.sessions.find((s) => s.id === id) : undefined;
  const stamp = `${sess?.updatedAt ?? 0}:${sess?.held?.status ?? ""}:${JSON.stringify(sess?.settled ?? {})}`;
  useEffect(() => {
    if (!id) return;
    const n = ++asked.current;
    void w.ask<{ map?: ThreadMap | null; error?: string }>("work.map", { sessionId: id }, 20_000).then((r) => {
      if (n === asked.current) setGot({ id, map: r.map ?? null, err: r.error ?? "" });
    });
  }, [id, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  return got && got.id === id ? got : { map: null, err: "" };
}

export function ThreadPane({ w, id, map, err }: { w: Work; id: string; map: ThreadMap | null; err: string }) {
  const [keep, setKeep] = useState<string | null>(null);
  const [doing, setDoing] = useState("");
  useLayoutEffect(() => { setKeep(null); setDoing(""); }, [id]);
  useEffect(() => { setDoing(""); }, [w.error, map]);

  const { laid, lanes, cells } = useMemo(() => lay(map?.segments ?? []), [map]);
  const box = useRef<HTMLDivElement>(null);
  const [wpx, setW] = useState(480);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.floor(el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!map]); // eslint-disable-line react-hooks/exhaustive-deps
  // the lanes grow in from the left, on a spring, each time the map changes shape
  const grow = useRef<SVGGElement>(null);
  const sp = useSpring(0, CFG.slide, (v) => { grow.current?.style.setProperty("--grow", String(Math.max(0, Math.min(1, v)))); });
  const shape = laid.map((s) => s.id + s.x1 + (s.settled ?? "")).join();
  useEffect(() => { sp.set(0); sp.to(1); }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err || !map) return <div className="wthread" ref={box}><p className="wthdim">{err || "reading the transcript…"}</p></div>;

  const inner = Math.max(1, wpx - 36);   // the pane's padding: the map draws inside it
  const cell = Math.max(4, Math.min(12, Math.floor((inner - 24) / (cells + 1)) - 1));
  const LANE = 34, H = lanes * LANE + 8;
  const open = map.open;
  const ends = laid.filter((s) => s.head || s.twig).sort((a, b) => a.lane - b.lane);
  const settledText = (v: string) => (v === "fold" ? "folded in" : v.startsWith("fork:") ? "forked out" : v.startsWith("kept:") ? "went on in a new session" : v);
  const target = (v?: string) => v && /^(fork|kept):/.test(v) ? v.split(":")[1] : undefined;
  const move = (other: string, how: "fold" | "fork") => {
    if (!keep) return;
    setDoing(other + how);
    w.reconcile(id, keep, other, how);
  };

  return (
    <div className="wthread" ref={box}>
      <svg className="wthmap" width="100%" height={H} viewBox={`0 0 ${inner} ${H}`}>
        <g ref={grow} style={{ ["--grow" as any]: 0 }}>
          {laid.map((s) => {
            const y = 6 + s.lane * LANE + LANE / 2 - cell / 2;
            const parent = laid.find((p) => p.id === s.from);
            const n = s.x1 - s.x0;
            const tone = s.twig ? "twig" : s.settled ? "settled" : s.head ? "open" : "trunk";
            return (
              <g key={s.id} className={`wths ${tone}`} style={{ transform: `translateX(calc((var(--grow) - 1) * ${Math.round(s.x0 * (cell + 1) * 0.4)}px))` }}>
                {parent && parent.lane !== s.lane && (   // the split: a column of cells down from where the parent ends
                  Array.from({ length: Math.max(1, Math.round(((s.lane - parent.lane) * LANE) / (cell + 1))) }, (_, k) => (
                    <rect key={k} x={20 + (s.x0 - 1) * (cell + 1)} y={6 + parent.lane * LANE + LANE / 2 - cell / 2 + (k + 1) * (cell + 1)} width={cell} height={cell} className="c" />
                  ))
                )}
                {Array.from({ length: n }, (_, k) => (
                  <rect key={k} x={20 + (s.x0 + k) * (cell + 1)} y={y} width={cell} height={cell} className="c" />
                ))}
                {(s.head || s.twig) && <rect x={20 + s.x1 * (cell + 1) - 1} y={y - 2} width={cell + 4} height={cell + 4} className="end" />}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="wthends">
        {ends.map((s) => {
          const isOpen = open.includes(s.id);
          const tgt = target(s.settled);
          return (
            <div key={s.id} className={`wthend ${s.twig ? "twig" : s.settled ? "settled" : ""} ${keep === s.id ? "wkept" : ""}`}>
              <div className="wthwho"><b>{WRITER[s.writer]}</b> <span>{model(s.model)}</span></div>
              <div className="wthwhat">
                {s.turns} {s.turns === 1 ? "turn" : "turns"} · {s.replies} replies · {when(s.last)}
                {s.twig && " · left behind"}
                {s.settled && <> · {tgt ? <a onClick={() => w.open(tgt)}>{settledText(s.settled)}</a> : settledText(s.settled)}</>}
              </div>
              {s.prompts.length > 0 && <div className="wthlast">“{s.prompts[s.prompts.length - 1]}”</div>}
              {isOpen && open.length > 1 && (
                <div className="wthmoves">
                  {!keep ? <button onClick={() => setKeep(s.id)}>keep this end</button>
                    : keep === s.id ? <><span>kept</span><button className="q" onClick={() => setKeep(null)}>change</button></>
                    : <>
                      <button disabled={!!doing} onClick={() => move(s.id, "fold")}>{doing === s.id + "fold" ? "folding…" : "fold in"}</button>
                      <button disabled={!!doing} onClick={() => move(s.id, "fork")}>{doing === s.id + "fork" ? "forking…" : "fork out"}</button>
                    </>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {open.length > 1 && <p className="wthdim">two writers went on from the same point. Keep one end; the other is folded in as a note on it, or forked out into its own session. Nothing is deleted.</p>}
    </div>
  );
}
