// Sol outside the main window, one page in two forms (lib.rs picks the form per screen and sends the geometry):
//   notch:  on the MacBook's own screen the tab starts at the top edge, its upper part hidden behind the camera
//           cutout. Four closed shapes (lib.rs reads the pick from a "notch-shape" file in the app's config dir;
//           wings when there is none, Marco's pick 2026-10-14): tab (the cutout's width, a 30px chin), bar (wider
//           than the cutout, a thinner chin), lens (a half-ellipse under the cutout), wings (nothing under the
//           cutout: the creature in the menu bar beside the camera; opening, it travels to the centre of a
//           larger card).
//   island: on a monitor a 150 x (bar - 4) capsule floats in the middle of the menu bar, the creature in it.
// Hover slides it open with Sol's last sentence; click calls the home seat (click again hangs up); the open card's
// buttons (Card.tsx, Notch buttons #6) answer what it shows, and while the mouse is on a card with buttons Return and
// Escape are Sol's (lib.rs registers them only after a fresh movement over the card, "notch-key" brings them here,
// "notch-keys" says when they are, for the ⏎ mark). A press or a Return is taken only 400 ms after what the card answers
// changed (answer.ts armed), and one held Return answers one ask: the next needs a key-up first. Leaving a card with
// buttons closes it after a 250 ms grace, so an overshoot reaching for the far button does not lose the click.
// An ask peeks once per ask. Closed with an ask waiting, the notch stands ajar: the closed slab plus 26 x 9 px, no words,
// no buttons, the window still letting the mouse through; the eye sees it before looking.
// a dropped file goes on the shelf. The shortcut (Cmd+Shift+Space) arrives as the "notch-toggle" event.
//
// Grab and Shelf (#200, sol/README.md "Grab and Shelf"): with nothing to answer the card offers Shelf · Grab. Grab
// asks "Grab what?" (Page · Shot · Sol); Shot closes the notch for macOS's crosshair and, once the picture landed on the shelf,
// says "On the shelf." with the shelf's last three things for 4 s; Page and Sol open the sheet (grab_sheet, the app's) and
// closes; Shelf shows the last three things beside All, which opens the sheet's shelf. Both rows go when the card closes
// or something with an answer outranks them. Over an icon the creature leans 3 px toward it.
//
// Motion. The native window never changes size (a resize mid-motion jerked everything; lib.rs keeps each window at
// its open size, 36 x 16 px larger than the open slab, and ignores the mouse while closed). The slab inside does all
// the moving, on two springs with a touch of overshoot (room for it is in the window): on the notch width leads and
// height follows 40 ms behind (the shape blooms out of the camera slot); on the island height leads and width follows
// 30 ms behind (the capsule swells down out of the menu bar). Closing is stiffer and does not overshoot. In the wings
// shape the creature leaves the wing on an arc for the centre of the card and the corners round out as it opens; on
// the island it rides down into the card. The sentence rises into place once there is room for it and changes by
// sliding (up out, up in). While a call is on,
// cells march round the slab's edge in the call's colours; a file held over it opens it, rings it in green and,
// dropped, presses it.
//
// Two visitors from the face's renovation (issue #15, Crew.tsx). The crew: while Sol is changing a part of the face the
// notch holds itself open and the creature works down in the card, its words in the line; it closes a breath after
// the creature climbs back. The bell: a seat's ping opens it, rings once round the edge in the seat's colour, the
// creature hops, the line slides in; a click then goes to that conversation in the main window (and the ping is
// seen), any other time the click is the call. Not seen in 8 s it closes, a lit cell per ping left on the wing. A
// ping that comes while the crew is down waits for it to climb back.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Mark } from "../Mark";
import { Creature } from "../creature/Widget";
import { outline } from "../creature/indicators";
import { flashNow, live, setHeld, useCreature, useCreatureDriver } from "../creature/state";
import { SENTENCE } from "../creature/states";
import { TINTS, bayer, tintAt, rgba } from "../creature/ring";
import { CFG, Spring, spring } from "../motion";
import { Swap } from "../MotionKit";
import { useNotch } from "./useNotch";
import { pinLine } from "../useEngine";
import { useRenovation, seen as seenPing, askOpen, pingLine, pingColour } from "../renovation";
import { CrewCanvas, crewState, CLIMB_MS, type CrewMode } from "./Crew";
import { Buttons, Thumbs, useCard, answer, onKey, DEV_CARD, DEV_SHELF, SHELF_DRAG } from "./Card";
import { armed, cardKey, shelfMeta, type Btn } from "./answer";
import { useStable, update as updateStable, later as stableLater } from "../cowork/stable";   // Ship (#33): a new stable is out
// --- Hand (#34): a teammate hands me work
import { useHands, take as takeHand, later as handLater, passing as handPassing } from "../cowork/handed";
// --- end Hand

// events are listened to on this window only: a plain listen() hears what is sent to the other form too
const win = getCurrentWebviewWindow();
const listen = win.listen.bind(win);
const log = (m: string) => { void invoke("face_log", { line: `[${win.label}] ${m}` }).catch(() => {}); };

type Shape = "tab" | "bar" | "lens" | "wings";
type Spot = { form: "notch" | "island"; shape: Shape; cx: number; top: number; bar: number; notch_w: number; notch_h: number };
const CHIN = 30, ISLAND_W = 150, OPEN_W = 360, OPEN_H = 84;   // the same numbers as lib.rs
const AJAR_W = 26, AJAR_H = 9;   // an ask waiting: the closed slab stands open this much (the mockup's numbers)
const LEAVE_MS = 250;            // a card with buttons outlives the pointer leaving it by this much
// extra: width beyond the cutout and chin: height under it, closed; W1/H1 (under the cutout): the open card
const SHAPES: Record<Shape, { extra: number; chin: number; W1: number; H1: number }> = {
  tab: { extra: 0, chin: CHIN, W1: OPEN_W, H1: OPEN_H }, bar: { extra: 140, chin: 26, W1: OPEN_W, H1: OPEN_H },
  lens: { extra: 84, chin: CHIN, W1: OPEN_W, H1: OPEN_H }, wings: { extra: 88, chin: 0, W1: 440, H1: 120 },
};
// off: the part of the tab hidden behind the cutout; top: where the tab starts inside the window
function dims(g: Spot | null) {
  if (!g || g.form === "notch") {
    const off = g?.notch_h ?? 0;
    const shape: Shape = g?.shape ?? "tab";
    const sh = SHAPES[shape];
    return { form: "notch" as const, shape, off, top: 0, W0: (g?.notch_w ?? 200) + sh.extra, H0: off + sh.chin, W1: sh.W1, H1: off + sh.H1 };
  }
  return { form: "island" as const, shape: "tab" as Shape, off: 0, top: 2, W0: ISLAND_W, H0: g.bar - 4, W1: OPEN_W, H1: OPEN_H };
}
// Dev only (shots): ?shape=wings|tab|bar|lens fakes the geometry lib.rs would send (a 185 x 32 cutout), ?open=1 opens it.
const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
const devShape = dev?.get("shape") as Shape | null | undefined;
// ?form=island fakes a monitor's island (a 37 px menu bar).
const devSpot: Spot | null = dev?.get("form") === "island" ? { form: "island", shape: "tab", cx: 0, top: 0, bar: 37, notch_w: 0, notch_h: 0 }
  : devShape && devShape in SHAPES ? { form: "notch", shape: devShape, cx: 0, top: 0, bar: 37, notch_w: 185, notch_h: 32 } : null;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export default function Notch() {
  const n = useNotch();
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState(false);
  const pill = useRef<HTMLDivElement>(null), say = useRef<HTMLDivElement>(null), markEl = useRef<HTMLDivElement>(null);
  const sp = useRef<{ w: Spring; h: Spring; press: Spring } | null>(null);
  // Grab and Shelf: the creature leans toward the icon under the pointer (3 px, on the snap spring)
  const lean = useRef<{ x: Spring; y: Spring } | null>(null);
  if (!lean.current) {
    const put = () => { const m = markEl.current, l = lean.current; if (m && l) m.style.translate = l.x.v || l.y.v ? `${l.x.v.toFixed(2)}px ${l.y.v.toFixed(2)}px` : ""; };
    lean.current = { x: new Spring(0, CFG.snap, put), y: new Spring(0, CFG.snap, put) };
  }
  const leanTo = useCallback((_b: Btn | null, el: HTMLElement | null) => {
    const l = lean.current!, m = markEl.current;
    if (!el || !m) { l.x.to(0); l.y.to(0); return; }
    const a = m.getBoundingClientRect(), b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2), d = Math.hypot(dx, dy) || 1;
    l.x.to((3 * dx) / d); l.y.to((3 * dy) / d);
  }, []);
  useEffect(() => () => { lean.current?.x.stop(); lean.current?.y.stop(); }, []);
  const shut = useRef<number | undefined>(undefined);
  const openRef = useRef(false);
  const [g, setG] = useState(dims(null));
  const geo = useRef(g);
  const keysOn = useRef(false);   // the card has buttons: the app may take Return and Escape while the mouse is on it
  const ajarRef = useRef(false);  // an ask waits: closed means ajar
  // where the slab rests closed: the closed shape, or ajar
  const rest = () => { const d = geo.current, a = ajarRef.current; return { w: d.W0 + (a ? AJAR_W : 0), h: d.H0 + (a ? AJAR_H : 0) }; };

  if (!sp.current) {
    const put = () => {
      const el = pill.current, s = sp.current;
      if (!el || !s) return;
      el.style.width = `${s.w.v}px`; el.style.height = `${s.h.v}px`;
      el.style.scale = `${1 - 0.05 * s.press.v}`;
      // the sentence rides down from the camera as the pill opens
      const d = geo.current, h0 = d.H0 + (ajarRef.current ? AJAR_H : 0);   // ajar is still closed: nothing rides down
      const k = Math.max(0, Math.min(1, (s.h.v - h0) / (d.H1 - h0)));
      if (d.form === "island") el.style.borderRadius = `${13 + 3 * k}px`;   // capsule, then a rounder island
      else if (d.shape === "lens") el.style.borderRadius = `0 0 ${lerp(d.W0 / 2, 16, k)}px ${lerp(d.W0 / 2, 16, k)}px / 0 0 ${lerp(CHIN, 16, k)}px ${lerp(CHIN, 16, k)}px`;   // the half-ellipse squares up as it opens
      else if (d.shape === "wings") el.style.borderRadius = `0 0 ${lerp(14, 24, k)}px ${lerp(14, 24, k)}px`;   // the corners round out
      else el.style.borderRadius = "";   // the stylesheet's corners (a shape switch must not keep the lens's)
      if (markEl.current) {
        const m = markEl.current.style;
        if (d.form === "island") { m.left = ""; m.top = `${lerp(1, 12, k)}px`; }   // rides down out of the menu bar into the card
        else if (d.shape === "wings") {
          // the creature leaves the wing for the centre of the card, under the camera, on an arc (up and over)
          m.left = `${lerp(10, s.w.v / 2 - 12, k)}px`;
          m.top = `${lerp(2, d.off + 12, k) - 8 * Math.sin(k * Math.PI)}px`;
        } else { m.left = ""; m.top = ""; }
      }
      if (say.current) {
        const t = Math.max(0, Math.min(1, (k - 0.3) / 0.6));   // once the card has room for it
        say.current.style.translate = `0 ${(1 - t) * 10}px`;
        say.current.style.opacity = String(t);   // closed, it must not peek under the slab
      }
    };
    sp.current = {
      w: spring(g.W0, { k: 300, z: 0.82, eps: 0.1 }, put),
      h: spring(g.H0, { k: 300, z: 0.82, eps: 0.1 }, put),
      press: spring(0, CFG.pop, put),
    };
  }
  const expand = useCallback((on: boolean) => {
    window.clearTimeout(shut.current);
    const s = sp.current!;
    if (on === openRef.current) return;
    openRef.current = on;
    log(`expand ${on} W1=${geo.current.W1} H1=${geo.current.H1}`);
    void invoke("notch_expand", { expanded: on, keys: on && keysOn.current });   // open: the window takes the mouse; closed: it lets it through
    const island = geo.current.form === "island";
    if (on) {
      // the notch blooms out of the camera slot, width first; the island swells down out of the menu bar, height first
      s.w.to(geo.current.W1, { delay: island ? 30 : 0, cfg: { k: 210, z: 0.78, eps: 0.1 } });
      s.h.to(geo.current.H1, { delay: island ? 0 : 40, cfg: { k: 200, z: 0.8, eps: 0.1 } });
    } else {
      const r = rest();
      s.w.to(r.w, { cfg: { k: 300, z: 0.95, eps: 0.1 } });
      s.h.to(r.h, { delay: 20, cfg: { k: 300, z: 0.95, eps: 0.1 } });
    }
    // opening is a state change (Companion step 2, gap 5): the creature hops and wakes at once, even from Away (the
    // card open means Marco is at the Mac); closing lets the engine's word back and the creature settles into it
    setHeld(on);
    if (on) window.dispatchEvent(new Event("sol-greet"));
    setOpen(on);
  }, []);
  // the geometry: asked for at start, pushed again when the screens change; the closed tab snaps to the new size
  const take = useCallback((spot: Spot | null) => {
    if (!spot) return;
    const d = dims(spot);
    log(`geometry ${JSON.stringify(spot)} -> ${JSON.stringify(d)}`);
    geo.current = d;
    setG(d);
    if (!openRef.current) { const r = rest(); sp.current!.w.set(r.w); sp.current!.h.set(r.h); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const r = rest(); sp.current!.w.set(r.w); sp.current!.h.set(r.h); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (devSpot) { take(devSpot); if (dev?.get("open")) window.setTimeout(() => expand(true), 60); }
    else void invoke<Spot | null>("notch_geometry").then(take).catch(() => {});
    const off = listen<Spot>("notch-geometry", (e) => take(e.payload));
    return () => { void off.then((f) => f()); };
  }, [take, expand]);
  useEffect(() => () => { const s = sp.current; if (s) { s.w.stop(); s.h.stop(); s.press.stop(); } }, []);

  useEffect(() => {
    const off = listen("notch-toggle", () => n.toggle());
    // the app watches the mouse for us (the webview's hover sleeps while the window is not key)
    // the crew at work and a ringing bell hold it open; the mouse leaving does not close it under them
    // a card with buttons closes LEAVE_MS after the pointer left, if it has not come back
    const hov = listen<boolean>("notch-hover", (e) => {
      log(`hover ${e.payload}`); hovering.current = e.payload;
      window.clearTimeout(leaveT.current);
      if (e.payload) { expand(true); return; }
      retHeld.current.down = false;   // the keys went with the pointer: a key-up may never come
      const close = () => { if (!hovering.current) expand(cs.current.mode !== "up" || bellOn.current); };
      if (openRef.current && cardRef.current.buttons.length) leaveT.current = window.setTimeout(close, LEAVE_MS);
      else close();
    });
    const ks = listen<boolean>("notch-keys", (e) => setKeysLive(e.payload));
    return () => { void off.then((f) => f()); void hov.then((f) => f()); void ks.then((f) => f()); window.clearTimeout(leaveT.current); };
  }, [n.toggle, expand]);
  const leaveT = useRef<number | undefined>(undefined);
  const [keysLive, setKeysLive] = useState(!!DEV_CARD);   // lib.rs: Return and Escape are Sol's now (dev: always, for shots)

  // Dynamic Island: a new sentence from Sol opens the tab by itself for a moment, then it closes unless the mouse is there
  const hovering = useRef(false);
  const peek = useRef<number | undefined>(undefined);
  const seen = useRef<string | null>(null);
  const peekNow = useCallback(() => {
    expand(true);
    window.clearTimeout(peek.current);
    peek.current = window.setTimeout(() => { if (!hovering.current && cs.current.mode === "up" && !bellOn.current) expand(false); }, 4500);
  }, [expand]);
  useEffect(() => {
    log(`sentence working=${n.working} up=${n.up} "${n.sentence.slice(0, 40)}"`);
    if (n.working || !n.sentence) return;
    if (seen.current === null) { seen.current = n.sentence; return; }   // the sentence it starts with is old news
    if (seen.current === n.sentence) return;
    seen.current = n.sentence;
    peekNow();
  }, [n.sentence, n.working, peekNow]);
  // a "notch-peek" file in the app's config dir opens it once (lib.rs sends the event): a way to see it without the mouse
  useEffect(() => {
    const off = listen("notch-peek", () => { log("peek"); peekNow(); });
    return () => { void off.then((f) => f()); };
  }, [peekNow]);

  // the creature draws what the engine says, like every face (no facts of its own, no dozing: Away is the engine's)
  useCreatureDriver({ seat: "codex" });
  const cr = useCreature();
  // unplugged: a click asks the app to start the engine (lib.rs engine_start); "starting" until the socket is back
  const [starting, setStarting] = useState(DEV_CARD === "starting");
  useEffect(() => {
    if (cr.state !== "unplugged") { setStarting(false); return; }
    if (!starting) return;
    const t = window.setTimeout(() => setStarting(false), 25000);   // the app's own grace (START_GRACE) is 20 s
    return () => window.clearTimeout(t);
  }, [cr.state, starting]);

  // a card pinned from the desk (a timer, a flashcard, a score) takes the sentence's place; a fresh sentence from
  // Sol still shows for a few seconds. A running timer ticks on its own; the first pin peeks.
  const [tick, setTick] = useState(0);
  const pinned = n.pin;
  const ticking = !!pinned && (pinned.kind === "timer" || pinned.kind === "exam") && !!pinned.startedAt && !pinned.doneAt;
  useEffect(() => { if (!ticking) return; const t = window.setInterval(() => setTick((k) => k + 1), 1000); return () => window.clearInterval(t); }, [ticking]);
  const [freshAt, setFreshAt] = useState(0);
  useEffect(() => { if (n.sentence) setFreshAt(Date.now()); }, [n.sentence]);
  const pinId = pinned?.id;
  useEffect(() => { if (pinId) peekNow(); }, [pinId, peekNow]);
  void tick;
  const pinText = pinned && Date.now() - freshAt > 8000 ? pinLine(pinned, Date.now()) : "";

  // ---- the crew (issue #15): down while a part is taped or broken, back up on the last peel ----
  const r = useRenovation();
  const work = [...r.sites.values()].filter((e) => !e.transient && e.state !== "peeling");
  const down = work.length > 0;
  const cs = useRef(crewState());
  const [crew, setCrew] = useState<CrewMode>("up");
  const after = useRef<number | undefined>(undefined);
  useEffect(() => {
    const s = cs.current;
    if (down) {
      window.clearTimeout(after.current);
      if (s.mode !== "down") { s.mode = "down"; s.since = performance.now(); setCrew("down"); }
      window.clearTimeout(peek.current);
      expand(true);
    } else if (s.mode === "down") {
      s.mode = "climbing"; s.since = performance.now(); setCrew("climbing");
      after.current = window.setTimeout(() => {
        s.mode = "up"; setCrew("up");
        after.current = window.setTimeout(() => { if (!hovering.current && !bellOn.current && cs.current.mode === "up") expand(false); }, 700);   // a breath
      }, CLIMB_MS);
    }
  }, [down, expand]);
  useEffect(() => () => window.clearTimeout(after.current), []);

  // ---- the bell: each new ping rings once, when the crew is up ----
  const pings = r.pings;
  const newest = pings.length ? pings[pings.length - 1] : null;
  const rung = useRef(new Set<string>());
  const bellOn = useRef(false);
  const bellT = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (crew !== "up") return;
    const fresh = pings.filter((p) => !rung.current.has(p.id));
    if (!fresh.length) return;
    for (const p of fresh) rung.current.add(p.id);
    const p = fresh[fresh.length - 1];
    window.clearTimeout(after.current); window.clearTimeout(peek.current);
    cs.current.bellAt = performance.now(); cs.current.bell = pingColour(p);
    bellOn.current = true;
    expand(true);
    window.dispatchEvent(new Event("sol-greet"));   // the creature hops once
    window.clearTimeout(bellT.current);
    bellT.current = window.setTimeout(() => { bellOn.current = false; if (!hovering.current && cs.current.mode === "up") expand(false); }, 8000);
  }, [pings, crew, expand]);
  useEffect(() => () => window.clearTimeout(bellT.current), []);
  const pingShows = !!newest && open && crew === "up";
  {
    const s = cs.current;
    s.broken = work.some((e) => e.state === "broken");
    if (work[0]) s.colours = work[0].colours;
    s.open = open; s.form = g.form; s.shape = g.shape; s.off = g.off;
    // a lit cell per unseen ping; the quiet mark for pings that went to the phone adds dim ones (no text)
    s.cells = [...[...pings].reverse().map(pingColour), ...Array.from({ length: r.mark }, () => [92, 92, 90] as const)].slice(0, 4);
    s.lit = pingShows;
  }
  // ---- the buttons (Notch buttons #6): one set per thing the card shows ----
  // a new stable (Ship #33): the card offers Update · Later; a stable not seen before peeks the notch open once
  const sb = useStable();
  const stable = sb ? { sha: sb.sha, tag: sb.tag, by: sb.by, updating: sb.doing?.updating, said: sb.doing?.said, failed: sb.doing?.failed } : null;
  const peekedSha = useRef("");
  useEffect(() => { if (sb && !sb.doing && peekedSha.current !== sb.sha) { peekedSha.current = sb.sha; peekNow(); } }, [sb?.sha, sb?.doing, peekNow]); // eslint-disable-line react-hooks/exhaustive-deps
  // --- Hand (#34): the card offers Take · Pass · Later (a review: Open · Later); a hand not seen before peeks once
  const hv = useHands(), hs = hv.current && hv.passing !== hv.current.id ? hv.current : null;   // passing: the window asks the line
  const hand = hs ? { id: hs.id, from: hs.from, issue: hs.issue, title: hs.title, review: hs.review, taking: hs.doing?.taking, said: hs.doing?.said, failed: hs.doing?.failed } : null;
  const peekedHand = useRef("");
  useEffect(() => { if (hs && !hs.doing && peekedHand.current !== `${hs.id}@${hs.at ?? ""}`) { peekedHand.current = `${hs.id}@${hs.at ?? ""}`; peekNow(); } }, [hs?.id, hs?.at, hs?.doing, peekNow]); // eslint-disable-line react-hooks/exhaustive-deps
  // --- end Hand
  // --- Grab and Shelf: the two rows are this page's own state; `note` is a line of their own ("On the shelf.") for a while
  const [grabbing, setGrabbing] = useState(DEV_CARD === "grabbing");
  const [shelfOpen, setShelfOpen] = useState(DEV_CARD === "shelf");
  const [note, setNoteS] = useState<string | null>(null);
  const noteT = useRef<number | undefined>(undefined), shelfT = useRef<number | undefined>(undefined);
  const setNote = useCallback((t: string | null, ms = 0) => {
    window.clearTimeout(noteT.current); setNoteS(t);
    if (t && ms) noteT.current = window.setTimeout(() => setNoteS(null), ms);
  }, []);
  useEffect(() => () => { window.clearTimeout(noteT.current); window.clearTimeout(shelfT.current); }, []);
  const shelfItems = DEV_SHELF && !n.shelf.length ? DEV_SHELF : n.shelf;
  // --- end Grab and Shelf
  const { card, advance, liveAsk } = useCard({
    crew: crew !== "up", ping: pingShows && newest ? newest : null, unplugged: cr.state === "unplugged", starting,
    ask: cr.ask, call: n.callState !== "off", turn: cr.turn, stable,
    hand,   // Hand (#34)
    grabbing, shelfOpen,   // Grab and Shelf
  });
  // --- Grab and Shelf: the rows go when the card closes or something with an answer takes the card
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) { setGrabbing(false); setShelfOpen(false); window.clearTimeout(shelfT.current); }
    wasOpen.current = open;
  }, [open]);
  const outranked = crew !== "up" || !(card.kind === "plain" || card.kind === "grabbing" || card.kind === "shelf");
  useEffect(() => { if (outranked) { setGrabbing(false); setShelfOpen(false); } }, [outranked]);
  /** the sheet (the app's grab_sheet): the notch closes and the sheet carries the rest */
  const sheet = (mode: "sol" | "page" | "shelf") => {
    actRef.current.close();
    void invoke("grab_sheet", { mode, open: true }).catch((e) => { log(`grab_sheet ${mode}: ${e}`); setNote("the sheet did not open", 5000); peekNow(); });
  };
  // --- end Grab and Shelf
  const act = {
    hangup: () => n.toggle(),
    start: () => { if (!starting) { setStarting(true); void invoke("engine_start").catch(() => setStarting(false)); } },
    close: () => { window.clearTimeout(peek.current); bellOn.current = false; expand(false); },
    advance,
    failed: () => {},   // set below, once the card's key is known
    update: () => void updateStable(),
    later: () => stableLater(),
    // --- Hand (#34)
    take: () => { if (hs) void takeHand(hs); },
    pass: () => { if (hs) handPassing(hs.id); },
    handLater: () => { if (hs) handLater(hs); },
    handOpen: () => { if (hs) { import("@tauri-apps/plugin-opener").then((o) => o.openUrl(`https://github.com/${hs.repo}/pull/${hs.issue}`)).catch(() => {}); handLater(hs); } },
    // --- end Hand
    // --- Grab and Shelf
    grab: () => { setNote(null); setShelfOpen(false); setGrabbing(true); },
    shelf: () => { setNote(null); window.clearTimeout(shelfT.current); setGrabbing(false); setShelfOpen(true); },
    shot: () => {
      setGrabbing(false);
      setNote("Pick it on the screen…");
      actRef.current.close();   // macOS's crosshair owns the screen now
      void n.grabShot().then((r) => {
        if (r.item) {
          setNote("On the shelf.", 4000); setShelfOpen(true); flashNow("done"); peekNow();
          window.clearTimeout(shelfT.current); shelfT.current = window.setTimeout(() => setShelfOpen(false), 4000);
        } else if (r.error === "cancelled") setNote(null);
        else { log(`grab.shot: ${r.error}`); setNote("the shot did not land", 5000); peekNow(); }
      });
    },
    page: () => sheet("page"),
    sol: () => sheet("sol"),
    all: () => sheet("shelf"),
    // --- end Grab and Shelf
  };
  const actRef = useRef(act); actRef.current = act;
  // a new ask peeks once (the one waiting when the page starts is old news: the notch stands ajar for it)
  const askId = card.ask ? `${card.ask.sessionId}/${card.ask.id}` : "";
  const peekedAsk = useRef<string | null>(null);
  useEffect(() => {
    if (peekedAsk.current === null) { peekedAsk.current = askId; return; }
    if (askId && peekedAsk.current !== askId) { peekedAsk.current = askId; peekNow(); }
  }, [askId, peekNow]);
  // closed with an ask waiting: ajar; the springs carry it there and back
  const ajar = card.kind === "ask" || card.kind === "question";
  ajarRef.current = ajar;
  useEffect(() => {
    if (openRef.current) return;
    const r = rest();
    sp.current!.w.to(r.w, { cfg: { k: 260, z: 0.8, eps: 0.1 } });
    sp.current!.h.to(r.h, { delay: 20, cfg: { k: 260, z: 0.8, eps: 0.1 } });
  }, [ajar, g]); // eslint-disable-line react-hooks/exhaustive-deps
  // arming: what the card answers changed at this moment; a press or a Return before ARM_MS is refused
  const key = cardKey(card);
  const changed = useRef({ key, at: performance.now() });
  if (changed.current.key !== key) changed.current = { key, at: performance.now() };
  // one Return, one answer: a Return held down answers nothing more until its key-up (or a second without one)
  const retHeld = useRef({ down: false, at: 0 });
  // a press that could not leave: the line says so for a while, and the card stays
  const [failed, setFailed] = useState<string | null>(null);
  act.failed = () => { setFailed(key); peekNow(); };
  useEffect(() => { if (!failed) return; const t = window.setTimeout(() => setFailed(null), 5000); return () => window.clearTimeout(t); }, [failed]);
  const cardRef = useRef(card); cardRef.current = card;
  const hasBtns = card.buttons.length > 0;
  keysOn.current = hasBtns;
  // the card gained or lost its buttons while open: the app's keys follow (lib.rs recomputes on its next hover tick)
  useEffect(() => { if (openRef.current) void invoke("notch_expand", { expanded: true, keys: hasBtns }).catch(() => {}); }, [hasBtns, open]);
  useEffect(() => {
    const off = listen<{ key: string; up?: boolean }>("notch-key", (e) => {
      const { key, up } = e.payload, h = retHeld.current, now = performance.now();
      if (key === "Return") {
        if (up) { h.down = false; return; }
        if (h.down && now - h.at < 1000) { h.at = now; log("key Return held: nothing"); return; }   // a repeat
        h.down = true; h.at = now;
        if (!armed(changed.current.at, now)) { log(`key Return on ${cardRef.current.kind}: not armed`); return; }
      }
      const r = onKey(cardRef.current, key, liveAsk(), actRef.current);
      log(`key ${key} on ${cardRef.current.kind}: ${r}`);
    });
    return () => { void off.then((f) => f()); };
  }, [liveAsk]);
  const press = (b: Parameters<typeof answer>[1]) => {
    if (!armed(changed.current.at, performance.now())) { log(`press ${b} on ${card.kind}: not armed`); return; }
    const r = answer(card, b, liveAsk(), act);
    log(`press ${b} on ${card.kind}: ${r ? "sent" : "dropped"}`);
  };

  const onClick = () => {
    if (cr.state === "unplugged") {
      if (!starting) { setStarting(true); void invoke("engine_start").catch(() => setStarting(false)); }
      return;
    }
    if (pingShows && newest) { seenPing(newest.id); askOpen({ ...newest, itemId: newest.id }); bellOn.current = false; return; }
    n.toggle();
  };

  // the line: unplugged and your-call speak over everything; working keeps its own; then a pin, Sol's last sentence,
  // and last the state's own sentence (design/companion/PRD.md, "The eight states")
  const st = cr.state;
  const urgent = st === "unplugged" || st === "yourcall";
  const said = st === "unplugged" ? (starting ? "Starting…" : "Plug me back in? Click me.")
    : n.working ? "Give me a second." : st === "yourcall" ? SENTENCE.yourcall : pinText || n.sentence || SENTENCE[st];
  // an ask outranks a ringing ping (answer.ts): its line, the ping waits in the meta
  const asking = card.kind === "ask" || card.kind === "question";
  const failNote = failed === key ? "Sol is restarting, try again in the window" : "";
  const noteText = note && (card.kind === "plain" || card.kind === "grabbing" || card.kind === "shelf") ? note : "";   // Grab and Shelf
  const text = crew !== "up" ? (r.crew || "changing a part of me") : failNote || (asking && card.line ? card.line
    : pingShows && newest ? pingLine(newest) : card.ping ? pingLine({ ...card.ping, at: 0 }) : noteText || (st !== "unplugged" && card.line ? card.line : said));
  const dim = crew === "up" && !pingShows && !urgent && !card.line && !card.ping && !noteText && (n.working || (!n.sentence && !pinText));
  // a sentence that is still being written (the new one begins with the old) updates in place; anything else slides
  const prev = useRef({ key: 0, text: "" });
  if (prev.current.text !== text) {
    if (!(prev.current.text && text.startsWith(prev.current.text.replace(/…$/, "")))) prev.current.key++;
    prev.current.text = text;
  }

  return (
    <div
      className={`notch ${g.form} shape-${g.shape}${open ? " open" : ""}${card.kind === "shelf" ? " shelfed" : ""}${drop ? " drop" : ""}${crew !== "up" ? " crew" : ""}${pingShows ? " pinged" : ""}${hasBtns ? " btns" : ""}`}
      style={{ "--off": `${g.off}px`, "--tab-top": `${g.top}px` } as React.CSSProperties}
      onMouseDown={() => sp.current!.press.to(1)}
      onMouseUp={() => sp.current!.press.to(0, { cfg: CFG.pop })}
      onClick={onClick}
      onDragEnter={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes(SHELF_DRAG)) return; setDrop(true); expand(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrop(false);
        const files = Array.from(e.dataTransfer.files);
        if (e.dataTransfer.types.includes(SHELF_DRAG) || !files.length) return;   // its own thumb, or nothing to keep
        sp.current!.press.set(1); sp.current!.press.to(0, { cfg: CFG.pop }); flashNow("done");
        void n.shelfAdd(files).then((ok) => { if (ok) setNote("On the shelf.", 4000); else setNote("the shelf did not take it", 5000); });
      }}
    >
      <div className="slab" ref={pill}>
        <div className="mark" ref={markEl} style={{ visibility: crew !== "up" ? "hidden" : undefined }}><Mark size={24} /></div>
        <div className="say-box" ref={say}>
          <div className="say-text"><Swap k={`${prev.current.key}:${card.ask?.id ?? ""}`} dist={18} cfg={CFG.arrive}><p className={`say${dim ? " dim" : ""}${card.line && text === card.line && card.kind !== "stable" ? " one" : ""}`} aria-live="polite">{text}</p></Swap></div>
          <Buttons card={card} keys={keysLive} onPress={press} onHover={leanTo}
            lead={card.kind === "shelf" ? <Thumbs items={shelfItems} /> : undefined} meta={card.kind === "shelf" ? shelfMeta(shelfItems.length) : undefined} />
        </div>
      </div>
      <Ring pill={pill} call={n.callState !== "off"} drop={drop} />
      <CrewCanvas pill={pill} st={cs} />
    </div>
  );
}

// The state's ring (Companion step 2, gap 1): in the coloured states the same cells sit on the slab's edge, closed too,
// so the state reads at 24 px: working marches slowly, your-call runs fast and dense, unplugged (and the wrong flash)
// blinks every other cell in place, the done flash closes the whole ring. The slab itself stays smooth black.
// The call's ring: cells marching along the inside of the pill's edge, in the creature's colours (so listening is
// sun and amber, speaking heart and orange, and it quickens with the voice). Starting a call it runs out from the top
// centre both ways; ending, it drops out in Bayer order. A dropped file's ring is green and sparkles.
function Ring({ pill, call, drop }: { pill: React.RefObject<HTMLDivElement | null>; call: boolean; drop: boolean }) {
  const on = useRef({ call, drop });
  on.current = { call, drop };
  return (
    <Creature className="ring-c" dustCell={2} setup={(l) => { l.data.amt = 0; l.data.shift = 0; }} draw={(l, x, w, _h, t, dt) => {
      const look = live.look;
      const mode = on.current.drop ? "drop" : on.current.call ? "call" : look === "thinking" || look === "attention" || look === "warn" || look === "ok" ? look : null;
      const want = mode ? 1 : 0;
      const d = l.data;
      d.amt += (want - d.amt) * (want > d.amt ? 1 - Math.pow(0.001, dt / 0.35) : 1 - Math.pow(0.001, dt / 0.5));
      if (d.amt < 0.01) return;
      const el = pill.current;
      if (!el) return;
      const pw = el.offsetWidth, ph = el.offsetHeight, oy = el.offsetTop;
      const ox = (w - pw) / 2, cell = 2, pad = 3;
      const o = outline(ox + pad, oy + pad - 2, pw - pad * 2, ph - pad * 2 + 2, 13);
      const nc = Math.floor(o.len / cell);
      const sl = mode === "drop" ? TINTS.done : live.slice;
      d.shift += (mode === "drop" ? 60 : mode === "call" || !mode ? 14 + Math.abs(l.flowV.v) * 120 + live.env * 160
        : mode === "thinking" ? 10 : mode === "attention" ? 40 : mode === "ok" ? 30 : 0) * dt;
      const blinkOff = mode === "warn" && Math.floor(t * 1.6) % 3 === 2;
      for (let k = 0; k < nc; k++) {
        const run = (k + Math.floor(d.shift / cell)) % 9;
        if ((mode === "call" || mode === "thinking" || !mode) && run > 4) continue;
        if ((mode === "drop" || mode === "attention") && run > 6) continue;
        if (mode === "warn" && (k % 2 || blinkOff)) continue;
        // the ring grows from the top centre and leaves in Bayer order
        const frac = Math.abs(((k / nc + 0.25) % 1) - 0.5) * 2;
        if (frac > d.amt * 1.2 || (d.amt < 1 && bayer(k & 3, (k >> 2) & 3) > d.amt + 0.1)) continue;
        const p = o.at(k * cell);
        const a = mode === "drop" || mode === "attention" ? (run % 2 ? 1 : 0.55) : mode === "warn" || mode === "ok" ? 1 : [1, 0.75, 0.5, 0.3, 0.2][run];
        x.fillStyle = rgba(tintAt(sl, (k / nc) * 2 + t * 0.3), a);
        x.fillRect(Math.round(p[0] / cell) * cell, Math.round(p[1] / cell) * cell, cell, cell);
      }
    }} />
  );
}
