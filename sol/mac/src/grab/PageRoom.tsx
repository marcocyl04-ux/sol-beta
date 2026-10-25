// The page room (mode "page"): Page, the third grab. The same dark room as Room.tsx, but over every app's windows: the
// engine lists every normal on-screen window (grab.windows: layer 0, front to back, not Sol's own, never this sheet);
// each is cut out of the veil, drawn in with the pearl outline and tagged "Owner · title". The bead hops ahead to the
// window under the pointer. A click takes that window and makes one tall picture of it, in front of Marco:
//
//   take a screen (grab.page.take: the window's own pixels, back as a data URL, not onto the shelf); turn the wheel
//   at the window's centre by 0.7 of its height (the app's page_scroll), wait 350 ms, take again; find how far the page
//   moved (stitch.ts: rows matched, a fixed header and footer kept once); again, until it stops moving, 40 screens, or
//   20000 px. The line counts the screens. Then the page is scrolled back by what it travelled and the pointer put back
//   where the click was, the screens are drawn into one canvas at their own pixel scale, and that goes on the shelf as
//   kind "page"; the sheet carries it on into markup like a Sol grab.
//
// While it scrolls, the sheet lets the pointer through (setIgnoreCursorEvents), so the wheel reaches the window under
// it; the other windows go back under the veil and only the one being taken stays lit. Esc stops it at any point: the
// loop sees the room is gone, puts the page and the pointer back, and lets the pointer stop passing through.
// Two permissions can stop it, and then the creature's card (Permit.tsx) takes over instead of a sentence: a first
// screen that comes back blank means the engine may not record the screen yet (Screen Recording, "node" in the list);
// a scroll refused for Accessibility means Sol may not turn the wheel. The pointer and the page are put back first, as
// always; the card waits for the permission and then this same window is taken again from the start, by itself.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Spring } from "../motion";
import { BEAD, type Bead } from "./Bead";
import type { Rect } from "./Room";
import { blank, fixedBands, fixedColumns, rowsOf, sameRows, segments, shiftOf, stitchedHeight, type Px, type Rows } from "./stitch";
import { Permit } from "./Permit";
import { frameClip, framePath, veilClip } from "./frame";
import { DEV_ROOM, ask, b64, log, needsAccessibility, passThrough, pointer, scroll, type Item, type PageWindow, type Permission } from "./wire";

const R = 10;                 // a macOS window's corner
const MAX_SCREENS = 40, MAX_PX = 20_000, STEP = 0.7, SETTLE_MS = 350, LOOKS = 3;
const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const tagOf = (w: PageWindow) => (w.title ? `${w.owner} · ${w.title}` : w.owner);
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");

type Screen = { img: HTMLImageElement; rows: Rows; px?: Px };
/** a screen's picture, loaded, and its rows (the stitcher's numbers); `keepPx` keeps the pixels too, for the one
 *  comparison that finds the fixed columns (then they are let go: a Retina screen is some 27 MB) */
async function screenOf(dataUrl: string, skipRight: number, skipLeft = 0, keepPx = false): Promise<Screen> {
  const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("a screen did not load")); i.src = dataUrl; });
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height);
  const rows = rowsOf(px, skipRight, skipLeft);
  c.width = c.height = 0;
  return keepPx ? { img, rows, px } : { img, rows };
}

type Click = { x: number; y: number };

export function PageRoom({ bead, say, onTaken, onLeave }: {
  bead: Bead | null; say: (t: string, check?: boolean) => void; onTaken: (item: Item, from: Rect) => void; onLeave: () => void;
}) {
  const [wins, setWins] = useState<PageWindow[] | null>(null);
  const [lit, setLit] = useState<PageWindow["id"] | null>(null);
  const [taking, setTaking] = useState<PageWindow["id"] | null>(null);
  // the permissions card, and the grab it interrupted (taken again once the permission is there)
  const [permit, setPermit] = useState<{ which: Permission; w: PageWindow; click: Click } | null>(null);
  const veil = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const hopT = useRef(0), live = useRef(true);

  useEffect(() => {
    live.current = true;
    say("Looking for windows…");
    void ask<{ windows?: PageWindow[] }>("grab.windows", {}, 10_000).then((r) => {
      if (!live.current) return;
      if (r.error) { say(`Could not list the windows: ${r.error}`); setWins([]); return; }
      const w = (r.windows ?? []).filter((x) => x.w > 40 && x.h > 40 && x.x + x.w > 0 && x.y + x.h > 0 && x.x < innerWidth && x.y < innerHeight);
      setWins(w);
      // dev: ?room=permit (Accessibility) or permit-screen, the card over the browser as if its grab had just been refused
      if (DEV_ROOM?.startsWith("permit") && w[0]) {
        setTaking(w[0].id); setLit(w[0].id);
        setPermit({ which: DEV_ROOM === "permit-screen" ? "screen" : "accessibility", w: w[0], click: { x: w[0].x + w[0].w / 2, y: w[0].y + w[0].h / 2 } });
        return;
      }
      say(w.length ? "Click the window to grab." : "No window is on this screen.");
    });
    return () => { live.current = false; window.clearTimeout(hopT.current); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // the dark room's entrance, exactly: the veil comes in, the outlines draw themselves, the tags slide up
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
    const w = wins[0];
    if (!permit) void bead?.hop(w.x + w.w / 2 - BEAD / 2, Math.max(8, w.y + Math.min(w.h / 2, 120)), { lift: 40, ms: 640 });
    return () => springs.forEach((s) => s.stop());
  }, [wins]);   // eslint-disable-line react-hooks/exhaustive-deps

  const over = (w: PageWindow | null) => {
    if (taking != null) return;
    setLit(w?.id ?? null);
    window.clearTimeout(hopT.current);
    if (!w || !bead) return;
    hopT.current = window.setTimeout(() => {
      void bead.hop(Math.min(innerWidth - BEAD - 4, w.x + w.w - BEAD - 18), Math.max(4, w.y - BEAD + 6)).then(() => bead.look(-2, 3));
    }, 140);
  };

  /** the whole loop: screens, scrolls, the stitch, the shelf */
  const take = (w: PageWindow, click: Click) => { if (taking == null) void run(w, click); };
  const run = async (w: PageWindow, click: Click) => {
    setTaking(w.id); setLit(w.id);
    say("Taking it…");
    const fail = (t: string) => { if (live.current) { setTaking(null); say(t); } };
    const first = await ask<{ dataUrl?: string; w?: number; h?: number }>("grab.page.take", { id: w.id }, 20_000);
    if (!live.current) return;
    if (first.error || !first.dataUrl) return fail(`Could not take it: ${first.error ?? "no picture came back"}`);
    const k = (first.w || w.w) / w.w;   // pixels per point (2 on a Retina screen)
    const skip = Math.round(18 * k);     // the scroll bar's strip at the right edge
    let s0: Screen, skipL = 0, skipR = skip;
    try { s0 = await screenOf(first.dataUrl, skip, 0, true); } catch (e) { return fail(`Could not read it: ${(e as Error).message}`); }
    if (blank(s0.rows)) { setPermit({ which: "screen", w, click }); return; }   // no Screen Recording yet (or minimised)

    const H = s0.img.naturalHeight, cx = Math.round(w.x + w.w / 2), cy = Math.round(w.y + w.h / 2), dy = Math.round(STEP * w.h);
    const imgs = [s0.img], shifts: number[] = [];
    let prev = s0.rows, foot = 0, head = 0, total = H, travelled = 0, trouble: string | null = null;
    await passThrough(true);
    log(`page window ${w.id} ${w.owner} "${w.title}" at ${w.x},${w.y} ${w.w}×${w.h}; scrolling at ${cx},${cy} by ${dy} pt a step`);
    try {
      for (let n = 1; n < MAX_SCREENS && live.current; n++) {
        say(`Scrolling… ${imgs.length} screen${imgs.length === 1 ? "" : "s"}`);
        const err = await scroll(cx, cy, dy);
        if (n === 1) log(`page scroll 1: ${err ?? "posted"}, pointer now at ${await pointer()}`);
        if (err) { trouble = err; break; }
        // one scroll, then pictures until two in a row are the same: an app may still be animating the scroll, or
        // filling a list in after it (Marco's first tries, 2026-10-25, ended at the viewport); at most LOOKS of them
        let d = 0, cur: Screen | null = null, last: Rows | null = null;
        for (let look = 0; look < LOOKS && live.current; look++) {
          await wait(look === 0 ? SETTLE_MS : SETTLE_MS * (look + 1));
          const t = await ask<{ dataUrl?: string }>("grab.page.take", { id: w.id }, 20_000);
          if (t.error || !t.dataUrl) { trouble = t.error ?? "a screen did not come back"; break; }
          cur = await screenOf(t.dataUrl, skipR, skipL, !shifts.length);
          if (cur.img.naturalHeight !== H) { trouble = "the window changed size"; break; }
          if (last && sameRows(last, cur.rows)) break;
          last = cur.rows;
        }
        if (!trouble && cur) {
          // the first movement tells what stays put: the fixed columns (a sidebar, the margins), then the header and
          // footer; the first screen's rows are hashed again without the columns
          if (!shifts.length && s0.px && cur.px) {
            const cols = fixedColumns(s0.px, cur.px, skip);
            skipL = cols.left; skipR = Math.max(skip, cols.right);
            s0.rows = rowsOf(s0.px, skipR, skipL); cur.rows = rowsOf(cur.px, skipR, skipL); prev = s0.rows;
            ({ head, foot } = fixedBands(prev, cur.rows));
            log(`page columns fixed: ${skipL} left, ${skipR} right (of ${s0.px.width} px)`);
          }
          d = shiftOf(prev, cur.rows, head, foot, dy * k);
          if (d > 0) { delete s0.px; delete cur.px; }   // the pixels are no longer needed once the page has moved
        }
        log(`page screen ${n}: shift ${d} px (asked ${dy} pt, bands ${head}/${foot})`);
        if (trouble || !cur) break;
        if (d <= 0) break;                        // the bottom (0), or the page changed under us (-1): keep what we have
        if (total + d > MAX_PX) break;
        imgs.push(cur.img); shifts.push(d); total += d; travelled += d; prev = cur.rows;
      }
    } catch (e) {
      trouble = (e as Error).message;
    } finally {
      // Marco's page back where it was, the pointer back where he clicked, the sheet catching clicks again
      if (travelled) await scroll(cx, cy, -Math.round(travelled / k));
      await scroll(click.x, click.y, 0);
      await passThrough(false);
    }
    log(`page done: ${imgs.length} screen${imgs.length === 1 ? "" : "s"}, ${travelled} px travelled${trouble ? `, trouble: ${trouble}` : ""}`);
    if (!live.current) return;
    // no scroll at all (no Accessibility): say why rather than landing one screen as a "page"
    if (trouble && !shifts.length) {
      if (needsAccessibility(trouble)) { setPermit({ which: "accessibility", w, click }); return; }
      return fail(`Could not scroll it: ${trouble}`);
    }

    say(`Stitching ${imgs.length} screen${imgs.length === 1 ? "" : "s"}…`);
    const segs = segments(H, foot, shifts);
    const c = document.createElement("canvas"); c.width = s0.img.naturalWidth; c.height = stitchedHeight(segs);
    const g = c.getContext("2d")!;
    let y = 0;
    for (const s of segs) { g.drawImage(imgs[s.frame], 0, s.sy, c.width, s.sh, 0, y, c.width, s.sh); y += s.sh; }
    let png: string;
    try { png = c.toDataURL("image/png"); } catch (e) { return fail(`Could not make the picture: ${(e as Error).message}`); }
    c.width = c.height = 0;
    const r = await ask<{ items?: Item[] }>("shelf.add", { files: [{ name: `page-${stamp()}.png`, mime: "image/png", dataBase64: b64(png) }], kind: "page" }, 60_000);
    if (!live.current) return;
    const item = r.items?.[0];
    if (r.error || !item) return fail(`Could not put it on the shelf: ${r.error ?? "nothing came back"}`);
    onTaken(item, { x: w.x, y: w.y, w: w.w, h: w.h });
  };

  // Screen Recording's own test: a fresh take of the window that is not blank
  const seen = async (w: PageWindow) => {
    const t = await ask<{ dataUrl?: string; w?: number }>("grab.page.take", { id: w.id }, 10_000);
    if (t.error || !t.dataUrl) return false;
    return !blank((await screenOf(t.dataUrl, Math.round(18 * ((t.w || w.w) / w.w)))).rows);
  };

  // while the card shows, the veil is whole (no window lit, no tags)
  const all = permit ? [] : wins ?? [];
  // while one is being taken, only it stays out of the veil
  const list = taking != null ? all.filter((w) => w.id === taking) : all;
  return (
    <div className="room">
      <div ref={veil} className="veil" style={{ clipPath: veilClip(list, R) }} />
      <svg ref={svg} className="room-svg" width="100%" height="100%">
        {all.map((w) => (
          <path key={w.id} className={`outline${lit === w.id ? " lit" : ""}${taking === w.id ? " taking" : ""}`}
            style={taking != null && taking !== w.id ? { display: "none" } : undefined}
            d={framePath(w, R)} pathLength={100} />
        ))}
      </svg>
      {/* hit areas, back to front so the front window is on top; none while one is being taken */}
      {taking == null && [...all].reverse().map((w) => (
        <div key={w.id} className="hit" style={{ left: w.x, top: w.y, width: w.w, height: w.h, borderRadius: R, clipPath: frameClip(w) }}
          onPointerEnter={() => over(w)} onPointerLeave={() => over(null)} onClick={(e) => void take(w, { x: e.clientX, y: e.clientY })} />
      ))}
      {/* a window right under the menu bar has its tag just inside its top edge */}
      {all.map((w) => (
        <div key={w.id} className="tag page-tag" style={{ ...(w.y < 28 ? { left: w.x + 12, top: w.y + 10 } : { left: Math.max(6, w.x + 12), top: w.y - 24 }),
          ...(taking != null && taking !== w.id ? { display: "none" } : {}) }}>{tagOf(w)}</div>
      ))}
      {permit && <Permit key={permit.which} which={permit.which} bead={bead} say={say} test={() => seen(permit.w)}
        onGranted={() => { const p = permit; setPermit(null); void run(p.w, p.click); }} onLater={onLeave} />}
    </div>
  );
}
