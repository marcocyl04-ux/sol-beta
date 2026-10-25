// The dark room (mode "sol"): the room goes dark and only Sol is drawn in light. The engine lists Sol's windows
// (grab.sol.windows, CoreGraphics global points); a veil rgba(0,0,0,.74) covers the screen with each window cut out
// of it (an SVG mask, so overlapping windows need nothing special), a 2 px pearl outline draws itself round each
// (pathLength 100, the dash offset on a spring) and a pearl tag names it. The bead hops ahead to the window under the
// pointer; a click takes that window (grab.sol.take: its own pixels, nothing over it) and hands the picture on.
//
// Where the windows are: the sheet covers the main screen from its origin (grab.rs), and CoreGraphics' origin is the
// top-left of the main screen, so a window's page position is its CG position less ORIGIN, which is 0,0. Windows on
// another screen fall outside the page and are simply not seen. The list is taken as front-to-back (CoreGraphics'
// on-screen order), so the front window is the one that answers a click where two overlap.
//
// A picture that comes back blank means the engine may not record the screen yet: the blank one leaves the shelf, the
// creature's card (Permit.tsx, Screen Recording, "node" in the list) waits for the permission, then the same window is
// taken again by itself.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Spring } from "../motion";
import { BEAD, type Bead } from "./Bead";
import { Permit } from "./Permit";
import { blank, rowsOf } from "./stitch";
import { frameClip, framePath, veilClip } from "./frame";
import { ask, type Item, type SolWindow } from "./wire";

export type Rect = { x: number; y: number; w: number; h: number };
const ORIGIN = { x: 0, y: 0 };
const R = 10;   // a macOS window's corner

/** is this picture blank (the engine had no Screen Recording)? Loaded with the page's origin, read as rows */
async function isBlank(src: string): Promise<boolean> {
  const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => no(new Error("no picture")); i.src = src; });
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  try { return blank(rowsOf(g.getImageData(0, 0, c.width, c.height), 0)); } finally { c.width = c.height = 0; }
}

export function Room({ bead, say, onTaken, onLeave }: {
  bead: Bead | null; say: (t: string, check?: boolean) => void; onTaken: (item: Item, from: Rect) => void; onLeave: () => void;
}) {
  const [wins, setWins] = useState<SolWindow[] | null>(null);
  const [lit, setLit] = useState<SolWindow["id"] | null>(null);
  const [taking, setTaking] = useState<SolWindow["id"] | null>(null);
  const [permit, setPermit] = useState<SolWindow | null>(null);   // the window whose picture came back blank
  const veil = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const hopT = useRef(0);

  useEffect(() => {
    let live = true;
    say("Looking for Sol…");
    void ask<{ windows?: SolWindow[] }>("grab.sol.windows", {}, 10_000).then((r) => {
      if (!live) return;
      if (r.error) { say(`Could not find Sol's windows: ${r.error}`); setWins([]); return; }
      const w = (r.windows ?? []).map((x) => ({ ...x, x: x.x - ORIGIN.x, y: x.y - ORIGIN.y }))
        .filter((x) => x.w > 4 && x.h > 4 && x.x + x.w > 0 && x.y + x.h > 0 && x.x < innerWidth && x.y < innerHeight);
      setWins(w);
      say(w.length ? "Click a part of Sol." : "No Sol window is on this screen.");
    });
    return () => { live = false; window.clearTimeout(hopT.current); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // the veil comes in (the one fade the room has), the outlines draw themselves, the tags slide up
  useLayoutEffect(() => {
    const v = veil.current!;
    const s = new Spring(0, { k: 120, z: 1 }, (x) => { v.style.opacity = String(x); });
    s.to(1);
    return () => s.stop();
  }, []);
  useLayoutEffect(() => {
    if (!wins?.length || !svg.current) return;
    const springs: Spring[] = [];
    svg.current.querySelectorAll<SVGPathElement>("path.outline").forEach((r, i) => {
      const s = new Spring(100, { k: 90, z: 1, eps: 0.05 }, (x) => { r.style.strokeDashoffset = String(x); });
      s.to(0, { delay: 150 + i * 140 }); springs.push(s);
    });
    document.querySelectorAll<HTMLElement>(".room .tag").forEach((t, i) => {
      const s = new Spring(0, { k: 260, z: 0.8 }, (x) => { t.style.opacity = String(x); t.style.translate = `0 ${(1 - x) * 6}px`; });
      s.to(1, { delay: 560 + i * 60 }); springs.push(s);
    });
    // the bead dives in from the notch to the middle of the first window
    const w = wins[0];
    void bead?.hop(w.x + w.w / 2 - BEAD / 2, Math.max(8, w.y + Math.min(w.h / 2, 120)), { lift: 40, ms: 640 });
    return () => springs.forEach((s) => s.stop());
  }, [wins]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the bead hops ahead to the window under the pointer: onto its top edge, near the right corner
  const over = (w: SolWindow | null) => {
    setLit(w?.id ?? null);
    window.clearTimeout(hopT.current);
    if (!w || !bead) return;
    hopT.current = window.setTimeout(() => {
      void bead.hop(Math.min(innerWidth - BEAD - 4, w.x + w.w - BEAD - 18), Math.max(4, w.y - BEAD + 6)).then(() => bead.look(-2, 3));
    }, 140);
  };
  const take = async (w: SolWindow, again = false) => {
    if (taking != null && !again) return;
    setTaking(w.id);
    say("Taking it…");
    const r = await ask<{ item?: Item }>("grab.sol.take", { id: w.id }, 20_000);
    if (r.error || !r.item) { setTaking(null); say(`Could not take it: ${r.error ?? "no picture came back"}`); return; }
    if (await isBlank(r.item.url).catch(() => false)) {
      void ask("shelf.delete", { id: r.item.id });
      setPermit(w); return;
    }
    onTaken(r.item, { x: w.x, y: w.y, w: w.w, h: w.h });
  };

  // Screen Recording's own test: a fresh picture of the window (grab.page.take: straight back, not onto the shelf)
  const seen = async (w: SolWindow) => {
    const t = await ask<{ dataUrl?: string }>("grab.page.take", { id: w.id }, 10_000);
    return !t.error && !!t.dataUrl && !(await isBlank(t.dataUrl).catch(() => true));
  };
  const list = permit ? [] : wins ?? [];
  return (
    <div className="room">
      <div ref={veil} className="veil" style={{ clipPath: veilClip(list.map((w) => ({ ...w, r: w.kind === "window" ? R : 14 })), R) }} />
      <svg ref={svg} className="room-svg" width="100%" height="100%">
        {list.map((w) => (
          <path key={w.id} className={`outline${lit === w.id ? " lit" : ""}${taking === w.id ? " taking" : ""}`}
            d={framePath(w, w.kind === "window" ? R : 14)} pathLength={100} />
        ))}
      </svg>
      {/* a window at the top edge (the notch) has its tag beside it, not under it where the next window's tag sits */}
      {/* hit areas, back to front so the front window is on top */}
      {[...list].reverse().map((w) => (
        <div key={w.id} className="hit" style={{ left: w.x, top: w.y, width: w.w, height: w.h, borderRadius: w.kind === "window" ? R : 14, clipPath: frameClip(w) }}
          onPointerEnter={() => over(w)} onPointerLeave={() => over(null)} onClick={() => void take(w)} />
      ))}
      {list.map((w) => <div key={w.id} className="tag" style={w.y < 28 ? { left: w.x + w.w + 10, top: w.y + w.h - 30 } : { left: Math.max(6, w.x + 12), top: w.y - 24 }}>{w.tucked ? "put aside" : w.kind}</div>)}
      {permit && <Permit which="screen" bead={bead} say={say} test={() => seen(permit)} onLater={onLeave}
        onGranted={() => { const w = permit; setPermit(null); setTaking(null); void take(w, true); }} />}
      {!permit && taking != null && (() => { const w = list.find((x) => x.id === taking); return w ? <Shutter w={w} /> : null; })()}
    </div>
  );
}

/** the shutter: the one flash in the sheet, over the window being taken */
function Shutter({ w }: { w: SolWindow }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const e = el.current!;
    const s = new Spring(0, { k: 900, z: 1 }, (x) => { e.style.opacity = String(0.85 * x); }, () => { if (s.target === 1) s.to(0, { cfg: { k: 90, z: 1 } }); });
    s.to(1);
    return () => s.stop();
  }, []);
  return <div ref={el} className="shutter" style={{ left: w.x, top: w.y, width: w.w, height: w.h, borderRadius: w.kind === "window" ? R : 14, clipPath: frameClip(w) }} />;
}
