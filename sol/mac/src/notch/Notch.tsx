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
// The eye (#253): on the quiet card a small eye (Card.tsx EyeMark). A press flicks it at
// once and asks the app (eye_set) to hide or show every Sol window to a share; the app answers every page with
// "eye-changed", so the notch and the island agree; then this Mac's engine is told (useNotch tellEye). While the eye
// is closed Sol says "Sol is hidden: open the eye to grab it" instead of opening the Sol room, whose picture would be blank.
//
// Anticipate (#253):
// the quiet card's ear pill starts a talk (useNotch talkStart; an error, the listener not built or a permission missing,
// is said on the line and the card stays quiet; a permission also opens its System Settings page). While it is on the
// notch stays the notch (D1): the quiet card, Shelf, Grab, the eye, Sol's line; the only sign is the pill lit (a red dot,
// its name "Anticipate · 12:34"). A press on the lit pill opens the drawer (Drawer.tsx) under the slab, a second press,
// Esc or its Stop closes it; it stays open when the mouse leaves and the talk never stops from the pill. The talk's
// words, cards, questions and names live in talk.ts (outside React), filled by one anticipate.talk on load.
// A card pressed in the drawer is pinned at its top for 20 s (Esc sooner); a card Sol volunteers with the drawer closed
// drops under the notch and holds it open for 20 s (sitting 1); its seconds are this page's clock, press to drawn
// (anticipate.took). Fn during a talk is only "speak to Sol": its down mutes the call through the call app's own
// shortcut (the app's call_mute, the apps from the skill's Mute list), the line says what the app's menu read (muted ·
// asking, sent, not confirmed, not muted in red), then the engine is told (anticipate.hold); its up unmutes and sends;
// the answer lands in Ask and, with the drawer closed, drops under the notch with the question above it. Stop (the
// drawer's) packs up quietly: the drawer closes, the dot goes out, the line says "the talk is in Conversations".
// The window: while a talk is on every open asks for `wide` (the drawer is wider than the card); while the drawer is open
// it asks for `room` (its height). An app from before sitting 2 ignores wide and caps room at 360: the drawer is then
// drawn as wide and as tall as the window it got, and a dev log line says so.
// Room under the card: the native window is sized by lib.rs to the open card (plus 16 px), so while something hangs
// under the slab (a talk's card, the drawer, the eye's private row) this page asks for room (notch_expand `room`: the
// thing's measured height plus ROOM_PAD) and the window grows downward by it, back when it goes. An app from before
// the room cannot grow: there the card is drawn inside the slab over the line.
//
// The free notch (#253): a session's ask, question or running turn
// is one line on the open card, its own buttons small under it, the pills (Shelf · Grab · Anticipate, the eye) at the
// right: the card made smaller, not a new surface. Esc (no pin, the drawer closed, nothing under the notch) folds it:
// its key goes in `folded` and a small count with one red dot sits beside the mark; a press on the count unfolds the
// newest fold. The asks are the engine's (the oldest shows; a folded one counts every ask behind it), the fold is
// this page's: a fold whose ask was answered elsewhere is forgotten. A folded ask is not on the card, so Return and the
// buttons answer only the one shown; the notch still stands ajar for it when closed. Shelf or Grab pressed on a line
// folds it first, so the row has the card. There is no bar of the line's own: with the drawer open its bar is the one.
//
// The clean screen (#253): a 500 ms hold on the eye opens the private list's row
// under the card (Card.tsx PrivateRow): the apps the engine keeps (eye.list), a press ticks one (eye.tick, then the
// app's clean_set so an open clean screen cuts out the new list at once), and "Clean screen" last opens the window to
// share (clean_open with the ticked bundles; open, it reads "Close clean screen", clean_close). The app's
// "clean-changed" keeps that word right when the window is closed by its own button. A failure (Screen Recording not
// allowed) is said on the line. A permission sentence on the line, the listener's or the clean screen's, opens its
// System Settings page when the line is pressed (and not the call).
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
import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Mark } from "../Mark";
import { flashNow, setHeld, useCreature, useCreatureDriver } from "../creature/state";
import { SENTENCE } from "../creature/states";
import { CFG, Spring, setOnStall, spring } from "../motion";
import { Swap } from "../MotionKit";
import { useNotch } from "./useNotch";
import { pinLine } from "../useEngine";
import { useRenovation, seen as seenPing, askOpen, pingLine, pingColour } from "../renovation";
import { CrewCanvas, crewState, CLIMB_MS, type CrewMode } from "./Crew";
import { Buttons, EyeMark, Thumbs, useCard, answer, onKey, DEV_CARD, DEV_EYE, DEV_SHELF, SHELF_DRAG } from "./Card";
import { PrivateRow, DEV_PRIVATE, type PrivateApp } from "./Card";   // the clean screen
import { LineBtns, LinePills, FoldCount, DEV_FOLDED } from "./Card";   // the free notch
import { TalkDrop, DEV_TALK, DEV_WHY, DEV_TALK_CARDS } from "./Card";   // Anticipate
import { Drawer, type DrawerApi, type HoldLine } from "./Drawer";
import * as talk from "./talk";
import { QUIET, OWN_ROWS, LINE_KINDS, armed, cardKey, clock, foldKey, shelfMeta, type Btn } from "./answer";
// --- The half moon (#254): the wings shape's open form, its cards (Moon.tsx)
import { decisionCards, runningRows, sessionKey, cardOf, keyAction, type Card as MoonCard } from "./answer";
import { redraw as redrawSpring, MoonDiscs, Float, SessionBody, SayBody, RowBody, MOON_R, MOON_RY, MOON_W, discAt, rimPoint, type DiscApi, type RunRow, type Tool, type P as MoonP } from "./Moon";
import { scene, SceneRenderer } from "./scene";
import { setOnRun } from "../motion";
// --- end The half moon
import type { TalkCard } from "./useNotch";
import { useStable, update as updateStable, later as stableLater } from "../cowork/stable";   // Ship (#33): a new stable is out
// --- Hand (#34): a teammate hands me work
import { useHands, take as takeHand, later as handLater, passing as handPassing } from "../cowork/handed";
// --- end Hand

// events are listened to on this window only: a plain listen() hears what is sent to the other form too
const win = getCurrentWebviewWindow();
const listen = win.listen.bind(win);
const log = (m: string) => { void invoke("face_log", { line: `[${win.label}] ${m}` }).catch(() => {}); };

type Shape = "tab" | "bar" | "lens" | "wings";
type Spot = { form: "notch" | "island"; shape: Shape; cx: number; top: number; bar: number; notch_w: number; notch_h: number; sh?: number };
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
  const screenH = g?.sh || window.screen.height;   // the screen's height (lib.rs sends it since sitting 2)
  if (!g || g.form === "notch") {
    const off = g?.notch_h ?? 0;
    const shape: Shape = g?.shape ?? "tab";
    const sh = SHAPES[shape];
    // the half moon: the wings' open slab is the moon (OW x OH); W1 x H1 stay the open card lib.rs sizes the window by
    const moon = shape === "wings";
    return { form: "notch" as const, shape, off, top: 0, W0: (g?.notch_w ?? 200) + sh.extra, H0: off + sh.chin, W1: sh.W1, H1: off + sh.H1, screenH,
      moon, OW: moon ? MOON_W : sh.W1, OH: off + (moon ? MOON_RY : sh.H1) };
  }
  return { form: "island" as const, shape: "tab" as Shape, off: 0, top: 2, W0: ISLAND_W, H0: g.bar - 4, W1: OPEN_W, H1: OPEN_H, screenH, moon: false, OW: OPEN_W, OH: OPEN_H };
}
// Dev only (shots): ?shape=wings|tab|bar|lens fakes the geometry lib.rs would send (a 185 x 32 cutout), ?open=1 opens it.
const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
const devShape = dev?.get("shape") as Shape | null | undefined;
// ?form=island fakes a monitor's island (a 37 px menu bar).
const devSpot: Spot | null = dev?.get("form") === "island" ? { form: "island", shape: "tab", cx: 0, top: 0, bar: 37, notch_w: 0, notch_h: 0 }
  : devShape && devShape in SHAPES ? { form: "notch", shape: devShape, cx: 0, top: 0, bar: 37, notch_w: 185, notch_h: 32 } : null;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
// engine/src/eye.ts's words, said here before the sheet opens on a blank picture
const HIDDEN = "Sol is hidden: open the eye to grab it";
// Anticipate: how long a card stays under the notch (or pinned in the drawer); the room a card needs under the slab
const DROP_MS = 20_000, DROP_ROOM = 132, DROP_GAP = 8;
// the drawer's width (PRD-2 part 4), and what the window keeps beside it for the spring's overshoot
const DRAWER_W = 520, DRAWER_SIDE = 24;
// Room under the card: what the window is asked to grow by beyond the thing's own height; the least room in which a
// card is drawn under the slab rather than inside it; the private row's height before it is measured; the least room
// an app gives (lib.rs's floor, and the whole cap of an app from before sitting 2)
const ROOM_PAD = 12, MIN_ROOM = 60, PRIV_ROOM = 124, ROOM_FLOOR = 360;
// a button's name as the engine of sitting 1 knows it (the four defaults); a fifth goes by its name
const BTN_ID: Record<string, string> = { answer: "answer", "say next": "next", recap: "recap", who: "who" };
// what the call app's menu read after the mute key (WIRE-2 call_mute), on the drawer's hint and the notch's line
const MUTE_LINE: Record<string, NonNullable<HoldLine>> = {
  muted: { text: "muted · asking" }, sent: { text: "sent, not confirmed" }, unmuted: { text: "not muted", red: true }, none: { text: "not muted", red: true },
};
const FN_HINT_KEY = "sol.anticipate.fn-hint";   // the very first talk says where 🌐 is
// The half moon: the window while the moon is open or a card is out (#254), 760 x 460 from the top of the screen
const MOON_WIN_W = 760, MOON_WIN_H = 460;
// centre field (Marco, 2026-10-26): the biggest card out takes the middle and the rest arrange round it. Today the big
// one is a talk's drawer (520 wide): the window widens to 1040 for it, decisions move to a column at its left and Sol's
// own cards to one at its right, this far from the centre
const MOON_WIN_W_BIG = 1040, BIG_SIDE = DRAWER_W / 2 + 20 + 100;
// where a card first lands (its top edge's middle; x from the moon's centre): sessions stack down the left, the rest
// below the moon (to the right while sessions are out, so they do not land on them); the gap between stacked cards
const SESS_AT = { x: -150, y: 170 }, TOOL_AT = { x: 0, y: 170 }, TOOL_BESIDE = 160, STACK_GAP = 12;
const SAY_MS = 4500;   // Sol's sentence as a card: absorbed after this unless the pointer is on it
const DEV_SAY = dev?.get("say") ?? "";   // dev: a sentence for the say card's still
type Drop = { card: TalkCard; why: "pressed" | "question" | "name"; secs: number | null; t0?: number; kind?: "card" | "ask"; n: number; leaving?: boolean; q?: string };
/** an answer to a spoken question as a card under the notch: its first sentence the head, the next two the bullets */
function answerCard(a: string): TalkCard {
  const parts = a.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).map((x) => x.replace(/^[-•*]\s*/, "")).filter(Boolean);
  const head = parts[0] ?? "answered in the window";
  return { head: head.length > 80 ? `${head.slice(0, 78)}…` : head, bullets: parts.slice(1, 3), source: "the talk · you asked" };
}
// a permission sentence from the listener: its System Settings page opens beside it (RUBRIC A14). The listener's own
// sentences carry the page's address in brackets (sol/mac/listen/Sources.swift); the line shows them without it
const PANE = /\s*\(?(x-apple\.systempreferences:[^\s)]+)\)?/;
const PRIVACY = (e: string) => PANE.exec(e)?.[1]
  ?? (/needs Screen Recording/i.test(e) ? "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"   // clean.rs NO_SCREEN
  : !/permission|denied|not allowed/i.test(e) ? null
    : /microphone/i.test(e) ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
    : /audio|record/i.test(e) ? "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture"
    : "x-apple.systempreferences:com.apple.preference.security");
const plainError = (e: string) => (e === "offline" ? "The desk is not answering." : e.replace(PANE, "").replace(/^permission:\s*/i, ""));
const openPage = (page: string) => { import("@tauri-apps/plugin-opener").then((o) => o.openUrl(page)).catch((x) => log(`privacy page: ${x}`)); };
const openPane = (e: string) => { const page = PRIVACY(e); if (page) openPage(page); };

export default function Notch() {
  const n = useNotch();
  const [open, setOpen] = useState(false);
  const [dropping, setDrop] = useState(false);   // a file held over the notch
  const pill = useRef<HTMLDivElement>(null), say = useRef<HTMLDivElement>(null), markEl = useRef<HTMLDivElement>(null);
  // the half moon: the creature's layer (the slab's twin, above the scene), the discs' handle
  const pillTop = useRef<HTMLDivElement>(null), discApi = useRef<DiscApi | null>(null);
  const moonShape = useRef({ br: 14, bry: 14 });   // the slab's bottom corner radii now (put), for the hit strips (flushRegions)
  const moonK = useRef(0);
  const moonTo = useRef(false);   // where the moon is headed (open or closed): the discs follow this, not the eased k
  const floatsOutRef = useRef(false), hoverCard = useRef<string | null>(null);
  const moonKeyRef = useRef<(key: string, up: boolean) => void>(() => {});
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
  // Room under the card (computed below, each render): what the window is asked to grow by, and how much taller the slab is
  const roomRef = useRef(0), growRef = useRef(0), wideRef = useRef(0);
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
      const k = Math.max(0, Math.min(1, (s.h.v - h0) / (d.OH - h0)));
      if (d.moon) {
        // the half moon: the corners round out to the moon's radius; the creature's layer is the slab's twin. The black
        // is the scene's moon (scene.ts): the slab's box as laid out (left 50%, translate -50%, scaled about its top
        // middle), its bottom corners a half ellipse when MOON_RY < MOON_R; the slab div itself stays for the pointer
        const br = lerp(14, MOON_R, k), bry = lerp(14, MOON_RY, k);
        moonShape.current = { br, bry };
        el.style.borderRadius = `0 0 ${br.toFixed(2)}px ${br.toFixed(2)}px / 0 0 ${bry.toFixed(2)}px ${bry.toFixed(2)}px`;
        const sc = 1 - 0.05 * s.press.v, mw = s.w.v * sc;
        scene.set("moon", { kind: "moon", x: window.innerWidth / 2 - mw / 2, y: d.top, w: mw, h: s.h.v * sc, r: br * sc, ry: bry * sc, melt: false, on: true });
        const t = pillTop.current;
        if (t) { t.style.width = el.style.width; t.style.height = el.style.height; t.style.scale = el.style.scale; }
        if (markEl.current) {
          const m = markEl.current.style;
          m.left = `${lerp(10, s.w.v / 2 - 12, k)}px`;
          m.top = `${lerp(2, d.off + lerp(4, 10, Math.min(1, Math.max(0, (MOON_RY - 64) / 48))), k) - 8 * Math.sin(k * Math.PI)}px`;   // a flatter moon: closer under the camera
        }
        moonK.current = k;
        discApi.current?.k(moonTo.current ? k : 0);   // closing: the discs go at the first frame, not when k falls under .7
        return;
      }
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
  // the springs on their way to the open card (or the moon) or to the closed rest, for the geometry known now. Also called
  // where a motion was lost: the geometry arriving while open (the page opened before it knew it was the moon), and a
  // remount (StrictMode's mount-unmount-mount in the hot face, a hot edit) whose cleanup stopped the springs in flight
  const aim = (on: boolean) => {
    const s = sp.current!;
    const island = geo.current.form === "island";
    moonTo.current = on && geo.current.moon;
    if (on && geo.current.moon) {
      // the moon swells down out of the cutout: height first, the width narrows to the moon 40 ms behind
      s.h.to(geo.current.OH, { cfg: { k: 210, z: 0.8, eps: 0.1 } });
      s.w.to(geo.current.OW, { delay: 40, cfg: { k: 220, z: 0.82, eps: 0.1 } });
    } else if (on) {
      // the notch blooms out of the camera slot, width first; the island swells down out of the menu bar, height first
      s.w.to(geo.current.W1, { delay: island ? 30 : 0, cfg: { k: 210, z: 0.78, eps: 0.1 } });
      s.h.to(geo.current.H1 + growRef.current, { delay: island ? 0 : 40, cfg: { k: 200, z: 0.8, eps: 0.1 } });
    } else {
      const r = rest();
      s.w.to(r.w, { cfg: { k: 300, z: 0.95, eps: 0.1 } });
      s.h.to(r.h, { delay: 20, cfg: { k: 300, z: 0.95, eps: 0.1 } });
    }
  };
  const expand = useCallback((on: boolean) => {
    window.clearTimeout(shut.current);
    if (on === openRef.current) return;
    openRef.current = on;
    log(`expand ${on} W1=${geo.current.W1} H1=${geo.current.H1}`);
    // open: the window takes the mouse; closed: it lets it through. `wide`: the drawer's width while a talk is on (lib.rs
    // forgets it on every close, so every open while a talk is on asks again)
    // the half moon asks for its window itself (an effect below: the window stays grown while a card is out)
    if (!geo.current.moon) void invoke("notch_expand", { expanded: on, keys: on && keysOn.current, room: on ? roomRef.current : 0, wide: on ? wideRef.current : 0 }).catch(() => {});
    aim(on);
    // opening is a state change (Companion step 2, gap 5): the creature hops and wakes at once, even from Away (the
    // card open means Marco is at the Mac); closing lets the engine's word back and the creature settles into it
    setHeld(on);
    if (on) window.dispatchEvent(new Event("sol-greet"));
    // a transition: the tree's re-render yields to the frame clock, so the first frame of the motion is drawn on time
    // (synchronous, the render sat inside that frame and every open and close began with one dropped frame: the
    // springs' run report read "longest gap 21-24 ms" on the first frame, 2026-10-26)
    startTransition(() => setOpen(on));
  }, []);
  // the geometry: asked for at start, pushed again when the screens change; the closed tab snaps to the new size
  const take = useCallback((spot: Spot | null) => {
    if (!spot) return;
    const d = dims(spot);
    log(`geometry ${JSON.stringify(spot)} -> ${JSON.stringify(d)}`);
    geo.current = d;
    setG(d);
    if (!openRef.current) { const r = rest(); sp.current!.w.set(r.w); sp.current!.h.set(r.h); }
    else aim(true);   // opened before the geometry came (a ping's bell at load): head for this geometry's open size
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const r = rest(); sp.current!.w.set(r.w); sp.current!.h.set(r.h); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the half moon: the tree changed (the geometry arrived): the springs draw on the new elements
  useLayoutEffect(() => { redrawSpring(sp.current!.w); }, [g.moon]);
  useEffect(() => {
    if (devSpot) { take(devSpot); if (dev?.get("open")) window.setTimeout(() => expand(true), 60); }
    else void invoke<Spot | null>("notch_geometry").then(take).catch(() => {});
    const off = listen<Spot>("notch-geometry", (e) => take(e.payload));
    return () => { void off.then((f) => f()); };
  }, [take, expand]);
  useEffect(() => {
    // a remount finds the page open with its springs stopped by the cleanup below: send them on again (2026-10-27: the
    // hot face's StrictMode remount at load left the notch "open" at the pre-geometry 200 x 30, the creature behind the camera)
    if (openRef.current) aim(true);
    return () => { const s = sp.current; if (s) { s.w.stop(); s.h.stop(); s.press.stop(); } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // the springs' fallback clock stepped them (motion.ts): WebKit's frame clock had stopped with a motion in flight
    let n0 = 0;
    setOnStall((ms) => { if (++n0 <= 20 || n0 % 50 === 0) log(`springs: the frame clock was silent ${Math.round(ms)} ms with a motion in flight; stepped by the guard (${n0})`); });
    setOnRun((r) => { if (r.longGaps || r.workMax > 6) log(`springs: run ${r.ms} ms, ${r.frames} frames, longest gap ${r.maxGap} ms, ${r.longGaps} over 20 ms, work p95 ${r.workP95} max ${r.workMax} ms`); });
    const vis = () => log(`page ${document.visibilityState} (WebKit's frame clock ${document.hidden ? "stops" : "runs"})`);
    log(`page ${document.visibilityState} at load`);   // the start state: a page that loads hidden fires no change
    document.addEventListener("visibilitychange", vis);
    return () => { setOnStall(null); setOnRun(null); document.removeEventListener("visibilitychange", vis); };
  }, []);
  useEffect(() => {
    const off = listen("notch-toggle", () => n.toggle());
    // the app watches the mouse for us (the webview's hover sleeps while the window is not key)
    // the crew at work and a ringing bell hold it open; the mouse leaving does not close it under them
    // a card with buttons closes LEAVE_MS after the pointer left, if it has not come back
    const hov = listen<boolean>("notch-hover", (e) => {
      log(`hover ${e.payload}`); hovering.current = e.payload;
      window.clearTimeout(leaveT.current);
      if (e.payload) {
        // the half moon: with cards out the window is Sol's over them too; the pointer arriving on a card is not the
        // moon's hover (a breath for the card's own pointerenter to say so)
        if (geo.current.moon && !openRef.current && floatsOutRef.current) {
          leaveT.current = window.setTimeout(() => { if (hovering.current && !hoverCard.current) expand(true); }, 60);
          return;
        }
        expand(true); return;
      }
      retHeld.current.down = false;   // the keys went with the pointer: a key-up may never come
      const close = () => { if (!hovering.current) expand(cs.current.mode !== "up" || bellOn.current || talkHold.current); };
      if (openRef.current && (cardRef.current.buttons.length || geo.current.moon)) leaveT.current = window.setTimeout(close, LEAVE_MS);
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
  const dictHeld = useRef(false);
  const talkHold = useRef(false);   // Anticipate: a card under the notch, or the questions, hold it open
  const peekNow = useCallback(() => {
    expand(true);
    window.clearTimeout(peek.current);
    const close = () => {
      if (dictHeld.current) { peek.current = window.setTimeout(close, 1000); return; }
      if (!hovering.current && cs.current.mode === "up" && !bellOn.current && !talkHold.current) expand(false);
    };
    peek.current = window.setTimeout(close, 4500);
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

  // Dictate anywhere (#110): the hold-key's down and up arrive as "dictate" (lib.rs); while it is held the card stays
  // open with the words so far, and a done flash when they land
  // Anticipate: while a talk is on the key is "speak to Sol" instead (fnRef, set below); after the stop it is dictation again
  const { dictDown, dictUp } = n;
  const fnRef = useRef<{ on: boolean; down: () => void; up: () => void }>({ on: false, down: () => {}, up: () => {} });
  useEffect(() => {
    const off = listen<{ down: boolean; app?: string; name?: string; title?: string }>("dictate", (e) => {
      log(`dictate ${e.payload.down ? "down" : `up ${e.payload.app ?? ""}`}${fnRef.current.on ? " (speak to Sol)" : ""}`);
      if (fnRef.current.on) { if (e.payload.down) fnRef.current.down(); else fnRef.current.up(); return; }
      if (e.payload.down) void dictDown(); else dictUp(e.payload);
    });
    return () => { void off.then((f) => f()); };
  }, [dictDown, dictUp]);
  const dictOn = n.dictating !== null;
  dictHeld.current = dictOn;   // the peek's close waits while the key is held
  useEffect(() => { if (dictOn) peekNow(); }, [dictOn, n.dictating, peekNow]);

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
        after.current = window.setTimeout(() => { if (!hovering.current && !bellOn.current && !talkHold.current && cs.current.mode === "up") expand(false); }, 700);   // a breath
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
    bellT.current = window.setTimeout(() => { bellOn.current = false; if (!hovering.current && !talkHold.current && cs.current.mode === "up") expand(false); }, 8000);
  }, [pings, crew, expand]);
  // an unmount drops the bell's 8 s timer: the bell ends with it and its pings ring again on a remount, or bellOn stayed
  // true for good and every close (the pointer leaving, the peek) kept the notch open (2026-10-27)
  useEffect(() => () => { window.clearTimeout(bellT.current); if (bellOn.current) { bellOn.current = false; rung.current.clear(); } }, []);
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
  // --- The eye: the app's state (eye_get, "eye-changed"); a flick shows at once, the app and then the engine follow
  const [invisible, setInvisible] = useState(DEV_EYE ?? false);
  const { tellEye } = n;
  useEffect(() => {
    if (DEV_EYE !== null) return;   // a faked eye for shots: the app is not asked
    void invoke<boolean>("eye_get").then((v) => { setInvisible(v); tellEye(v); }).catch(() => {});
    const off = listen<boolean>("eye-changed", (e) => { setInvisible(e.payload); tellEye(e.payload); });
    return () => { void off.then((f) => f()); };
  }, [tellEye]);
  const flickEye = () => {
    const next = !invisible;
    setInvisible(next);
    if (DEV_EYE !== null) return;
    log(`eye ${next ? "invisible" : "visible"}`);
    void invoke<boolean>("eye_set", { invisible: next }).then(tellEye).catch((e) => {
      log(`eye_set: ${e}`);
      // the windows changed even when the file could not be written; only a refusal from the app puts the mark back
      void invoke<boolean>("eye_get").then((v) => { setInvisible(v); tellEye(v); }).catch(() => setInvisible(!next));
    });
  };
  // --- end The eye
  // --- The clean screen: the row the eye's hold opens, the private list in it, and whether the clean screen is open
  const [privOpen, setPrivOpen] = useState(!!DEV_PRIVATE);
  const [privApps, setPrivApps] = useState<PrivateApp[] | null>(DEV_PRIVATE);
  const [cleanOn, setCleanOn] = useState(false);
  const [cleanBusy, setCleanBusy] = useState(false);
  const { privateList, privateTick } = n;
  useEffect(() => {
    if (DEV_PRIVATE) return;
    void invoke<boolean>("clean_get").then(setCleanOn).catch(() => {});
    const off = listen<boolean>("clean-changed", (e) => setCleanOn(!!e.payload));
    return () => { void off.then((f) => f()); };
  }, []);
  // the list is read fresh each time the row opens (a hand edit of home/private.json shows)
  useEffect(() => {
    if (!privOpen || DEV_PRIVATE) return;
    let live = true;
    void privateList().then((r) => {
      if (!live) return;
      if (r.apps) { setPrivApps(r.apps); return; }
      log(`eye.list: ${r.error}`); setPrivApps([]); setNote(r.error === "offline" ? "The desk is not answering." : "the private list did not read", 6000);
    });
    return () => { live = false; };
  }, [privOpen, privateList]); // eslint-disable-line react-hooks/exhaustive-deps
  const holdEye = () => { setGrabbing(false); setShelfOpen(false); setPrivOpen((v) => !v); log("eye held: the private list"); };
  const ticked = (apps: PrivateApp[] | null) => (apps ?? []).filter((a) => a.on).map((a) => a.bundle);
  /** a chip pressed: shown at once, kept by the engine, and an open clean screen takes the new list */
  const tickApp = (a: PrivateApp) => {
    const before = privApps;
    setPrivApps((l) => (l ?? []).map((x) => (x.bundle === a.bundle ? { ...x, on: !a.on } : x)));
    if (DEV_PRIVATE) return;
    void privateTick(a.bundle, !a.on).then((r) => {
      if (!r.apps) { log(`eye.tick: ${r.error}`); setPrivApps(before); setNote("the private list did not change", 5000); return; }
      setPrivApps(r.apps);
      void invoke("clean_set", { bundles: ticked(r.apps) }).catch((e) => log(`clean_set: ${e}`));
    });
  };
  /** "Clean screen": open it with the ticked apps cut out, or close it; a refusal is said on the line */
  const cleanPress = () => {
    if (cleanBusy) return;
    if (DEV_PRIVATE) { setCleanOn((v) => !v); return; }
    if (cleanOn) { void invoke("clean_close").catch((e) => log(`clean_close: ${e}`)); return; }
    setCleanBusy(true);
    log("clean screen: open");
    void invoke<number>("clean_open", { bundles: ticked(privApps) })
      .then(() => setCleanOn(true))
      .catch((e) => { log(`clean_open: ${e}`); setNote(linked(String(e)), 12_000); peekNow(); })
      .finally(() => setCleanBusy(false));
  };
  // --- end The clean screen
  // --- Anticipate: the talk (on or not), its clock, the drawer, the card under the notch or pinned in the drawer, Fn
  const devTalk = DEV_TALK;
  const [devOn, setDevOn] = useState(!!devTalk);
  // dev: the made-up talk is in the store before the first draw (talk.ts devFill; &turns=1000 for the hour-long one)
  useState(() => { if (devTalk) talk.devFill(devTalk, Number(dev?.get("turns")) || 0); return 0; });
  const talkOn = devTalk ? devOn : n.talk.on;
  const [drawer, setDrawerS] = useState(!!devTalk?.startsWith("drawer"));
  const drawerRef = useRef(drawer); drawerRef.current = drawer;
  const drawerApi = useRef<DrawerApi | null>(null);
  const drawerAt = useRef(0);   // the press that opened it, for the first frame's clock (D10)
  const setDrawer = (on: boolean) => {
    if (on === drawerRef.current) return;
    drawerAt.current = on ? performance.now() : 0;
    log(`anticipate: the drawer ${on ? "opens" : "closes"}`);
    drawerRef.current = on; setDrawerS(on);
  };
  useEffect(() => { if (!talkOn) setDrawerS(false); }, [talkOn]);   // the talk stopped (here or on another face)
  // a talk on (this page loaded during it, or the engine came back): one anticipate.talk fills the drawer's store
  const { talkSnapshot } = n;
  useEffect(() => {
    if (devTalk || !talkOn || !n.up) return;
    void talkSnapshot().then((r) => { if (!talk.fill(r)) log(`anticipate.talk: ${r.error ?? "no turns"}; the drawer keeps what the broadcasts brought`); });
  }, [talkOn, n.up, devTalk, talkSnapshot]);
  const [devSecs] = useState(() => ({ seconds: 754, at: Date.now() }));
  const [, setTalkTick] = useState(0);
  useEffect(() => { if (!talkOn) return; const t = window.setInterval(() => setTalkTick((k) => k + 1), 1000); return () => window.clearInterval(t); }, [talkOn]);
  const base = devTalk ? devSecs : n.talk;
  const talkSecs = Math.max(0, base.seconds + (talkOn ? Math.floor((Date.now() - base.at) / 1000) : 0));
  const devDrop = devTalk === "anticard" ? { card: DEV_TALK_CARDS[DEV_WHY], why: DEV_WHY, secs: DEV_WHY === "question" ? 1.4 : 1.8, n: 0 }
    : devTalk === "drawer-pin" ? { card: DEV_TALK_CARDS.pressed, why: "pressed" as const, secs: 1.8, n: 0 } : null;
  const [drop, setDropS] = useState<Drop | null>(devDrop);
  const dropN = useRef(0), dropT = useRef<number | undefined>(undefined), dropRef = useRef(drop); dropRef.current = drop;
  // Room under the card: the window's size as it is now (lib.rs grows it on the page's ask)
  const [winH, setWinH] = useState(() => window.innerHeight);
  const [winW, setWinW] = useState(() => window.innerWidth);
  useEffect(() => { const f = () => { setWinH(window.innerHeight); setWinW(window.innerWidth); }; window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  /** a card under the notch, or pinned in the drawer while it is open (the newest wins); it holds the notch for DROP_MS */
  const showDrop = useCallback((d: Omit<Drop, "n">) => {
    window.clearTimeout(dropT.current);
    setDropS({ ...d, n: ++dropN.current });
    dropT.current = window.setTimeout(() => closeDropRef.current(), DROP_MS);
    window.clearTimeout(peek.current);
    expand(true);
  }, [expand]);
  const closeDrop = () => {
    window.clearTimeout(dropT.current);
    if (!dropRef.current || dropRef.current.leaving) return;
    setDropS((d) => (d ? { ...d, leaving: true } : d));
    dropT.current = window.setTimeout(() => setDropS(null), 260);
  };
  const closeDropRef = useRef(closeDrop); closeDropRef.current = closeDrop;
  useEffect(() => () => window.clearTimeout(dropT.current), []);
  // the notch's own clock (RUBRIC A15): it stops on the first frame the card is drawn, and the engine is told
  const dropShown = drop && !drop.leaving ? drop.n : -1;
  useLayoutEffect(() => {
    const d = dropRef.current;
    if (!d || d.secs !== null || d.t0 === undefined) return;
    const t0 = d.t0, kind = d.kind ?? "card";
    const raf = requestAnimationFrame(() => {
      const ms = performance.now() - t0;
      setDropS((x) => (x && x.n === d.n ? { ...x, secs: ms / 1000 } : x));
      if (!devTalk) n.talkTook(ms, kind);
      log(`anticipate: a ${kind} drawn ${Math.round(ms)} ms after the press`);
    });
    return () => cancelAnimationFrame(raf);
  }, [dropShown]); // eslint-disable-line react-hooks/exhaustive-deps
  // the drawer's first frame after the press on the pill (D10: under 200 ms with a thousand turns)
  useLayoutEffect(() => {
    if (!drawer || !drawerAt.current) return;
    const t0 = drawerAt.current;
    const raf = requestAnimationFrame(() => log(`anticipate: the drawer drawn ${Math.round(performance.now() - t0)} ms after the press (${talk.talkNow().turns.length} turns)`));
    return () => cancelAnimationFrame(raf);
  }, [drawer]);
  // the line's link: an error said on the line remembers its System Settings page, opened when the line is pressed
  const paneOf = useRef<{ text: string; page: string } | null>(null);
  const linked = (e: string) => { const text = plainError(e), page = PRIVACY(e); paneOf.current = page ? { text, page } : null; return text; };
  const [talkNote, setTalkNoteS] = useState<string | null>(null);
  const talkNoteT = useRef<number | undefined>(undefined);
  const setTalkNote = (t: string | null, ms = 6000) => { window.clearTimeout(talkNoteT.current); setTalkNoteS(t); if (t) talkNoteT.current = window.setTimeout(() => setTalkNoteS(null), ms); };
  // a permission the listener misses, mid-talk: on the line, its Settings page a press on the line away (not opened
  // by itself: it would take the screen in the middle of a call)
  useEffect(() => { if (n.talk.on && n.talk.error) { setTalkNote(linked(n.talk.error), 15_000); peekNow(); } }, [n.talk.error, n.talk.on]); // eslint-disable-line react-hooks/exhaustive-deps
  /** a button's card (the drawer's discs): the clock starts at `t0` (the press); `screen` adds the front window's picture */
  const pressSeq = useRef(0);
  const askCard = async (name: string, t0: number, screen: boolean) => {
    const seq = ++pressSeq.current;
    log(`anticipate: ${name}${screen ? " with the screen" : ""}`);
    if (devTalk) {
      window.setTimeout(() => {
        if (seq !== pressSeq.current) return;
        talk.addCard({ ...DEV_TALK_CARDS.pressed, why: "pressed", button: name, at: Date.now(), ms: 900 });
        showDrop({ card: DEV_TALK_CARDS.pressed, why: "pressed", secs: null, t0, kind: "card" });
      }, 900);
      return;
    }
    // the picture through the grab's own path (useNotch frontWindow); none to take, the card goes without it
    const shot = screen ? await n.frontWindow().catch(() => null) : null;
    if (screen && !shot) log("anticipate: no front window to read; the card goes without it");
    const r = await n.talkCard(BTN_ID[name.toLowerCase()] ?? name, shot ?? undefined);
    if (seq !== pressSeq.current) return;   // a newer press is on its way
    if (r.error) { log(`anticipate.card: ${r.error}`); setTalkNote(plainError(r.error)); peekNow(); return; }
    if (!r.card) { log(`anticipate: ${name}: nothing to say`); return; }   // silence is an answer (RUBRIC P3)
    talk.addCard({ ...r.card, why: "pressed", button: name, at: Date.now(), ...(r.ms ? { ms: r.ms } : {}) });
    showDrop({ card: r.card, why: "pressed", secs: null, t0, kind: "card" });
  };
  /** the drawer's bar: a question about the talk, into the Ask thread (talk.ts), answered by the talk's one session */
  const askTyped = (text: string) => {
    log("anticipate: a typed ask");
    const id = talk.askPending(text, false);
    if (devTalk) { window.setTimeout(() => talk.askAnswered(id, "Thursday at four. Frank said 4 pm, and his calendar is free then.", 1400), 1400); return; }
    void n.talkAsk(text).then((r) => {
      if (r.error) { log(`anticipate.ask: ${r.error}`); talk.askFailed(id, plainError(r.error)); return; }
      talk.askAnswered(id, r.a, r.ms, r.sessionId);
    });
  };
  // a card the engine told every face: one Sol volunteered never covers a pressed card still showing (a press wins)
  const cast = n.talkCast;
  useEffect(() => {
    if (!cast) return;
    const d = dropRef.current;
    if (cast.why !== "pressed" && d && !d.leaving && d.why === "pressed") return;
    showDrop({ card: cast, why: cast.why, secs: cast.ms / 1000 });
  }, [cast?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // ---- Fn during a talk: hold to speak to Sol (D11). The call is muted through its app's own shortcut first ----
  const [holdLine, setHoldLine] = useState<HoldLine>(devTalk === "drawer-muted" ? MUTE_LINE.muted : null);
  const hold = useRef<{ state?: string; upWanted: boolean } | null>(null);
  const spokenWait = useRef<number | null>(null);   // the spoken question waiting for its answer (talk.ts askPending)
  /** the call app's mute key, then what its menu reads; an app from before sitting 2 has no call_mute: sent, not confirmed */
  const callMute = async (on: boolean): Promise<string> => {
    try {
      const r = await invoke<{ app?: string; state?: string }>("call_mute", { on, apps: talk.talkNow().mute });
      log(`call_mute ${on}: ${r?.app ?? "?"} ${r?.state ?? "?"}`);
      return r?.state ?? "sent";
    } catch (e) { log(`call_mute ${on}: ${e} (an app from before sitting 2: sent, not confirmed)`); return "sent"; }
  };
  const fnDown = async () => {
    if (hold.current) return;   // a held key repeats
    const h: { state?: string; upWanted: boolean } = { upWanted: false };
    hold.current = h;
    setHoldLine({ text: "muting…" });
    window.clearTimeout(peek.current); expand(true);
    let st = await callMute(true);
    if (st === "unmuted") st = await callMute(true);   // the toggle went the wrong way (the call was muted by hand): once more
    h.state = st;
    if (hold.current === h) setHoldLine(MUTE_LINE[st] ?? MUTE_LINE.sent);
    const r = await n.talkHold(true, st);
    if (r.error) log(`anticipate.hold down: ${r.error}`);
    if (h.upWanted) void fnUp(h);
  };
  const fnUp = async (held?: { state?: string; upWanted: boolean }) => {
    const h = held ?? hold.current;
    if (!h) return;
    if (h.state === undefined) { h.upWanted = true; return; }   // the down is still muting: it lets go when done
    if (hold.current === h) hold.current = null;
    setHoldLine(null);
    const unmute = h.state === "muted" || h.state === "sent" ? callMute(false) : Promise.resolve("");   // the other side hears him again
    const id = talk.askPending("", true);
    spokenWait.current = id;
    setTalkNote("asking Sol…", 20_000);
    const [, r] = await Promise.all([unmute, n.talkHold(false)]);
    if (r.error || !r.asked) {
      if (r.error) log(`anticipate.hold up: ${r.error}`);
      talk.askDrop(id); if (spokenWait.current === id) spokenWait.current = null;
      setTalkNote(r.error ? plainError(r.error) : "nothing heard", 3000);
    }
  };
  fnRef.current = { on: talkOn, down: () => void fnDown(), up: () => void fnUp() };
  // the talk stopped while Fn was held: the call is unmuted, nothing is asked
  useEffect(() => {
    if (talkOn || !hold.current) return;
    const h = hold.current; hold.current = null; setHoldLine(null);
    if (h.state === "muted" || h.state === "sent") void callMute(false);
  }, [talkOn]); // eslint-disable-line react-hooks/exhaustive-deps
  // the spoken question's answer: in Ask (the drawer turns to it), and with the drawer closed under the notch too,
  // the question above it. Watched on the store itself, so the page does not redraw for every word of the talk
  useEffect(() => talk.subscribe(() => {
    const id = spokenWait.current;
    if (id === null) return;
    const a = talk.talkNow().asks.find((x) => x.id === id);
    if (!a || a.pending) return;
    spokenWait.current = null;
    setTalkNote(null);
    if (drawerRef.current) talk.setView("ask");
    else showDrop({ card: answerCard(a.a), why: "pressed", secs: a.ms ? a.ms / 1000 : null, q: a.q });
  }), [showDrop]); // eslint-disable-line react-hooks/exhaustive-deps
  const [fnHeld, setFnHeld] = useState(false);
  useEffect(() => setFnHeld(!!holdLine), [holdLine]);
  /** Esc, in the order of D8: the pinned card, then the drawer, then (closed) the card under the notch; false: not ours */
  const talkEscape = (): boolean => {
    const d = dropRef.current, showing = !!d && !d.leaving;
    if (drawerRef.current && showing) { closeDropRef.current(); log("key Escape: the pinned card"); return true; }
    if (drawerRef.current) { setDrawer(false); log("key Escape: the drawer"); return true; }
    if (showing) { closeDropRef.current(); log("key Escape: the card under the notch"); return true; }
    // the free notch: then a session's line folds into the count beside the mark
    return foldRef.current();
  };
  const escRef = useRef(talkEscape); escRef.current = talkEscape;
  // the drawer focused (a tab pressed, the window key): Esc reaches the page itself; the bar handles its own keys
  useEffect(() => {
    if (!drawer) return;
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); escRef.current(); } };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [drawer]);
  /** a talk's start: the line says "hold 🌐 to talk to Sol" once; on the very first talk ever, where 🌐 is too */
  const talkHints = () => {
    let first = false;
    try { first = !localStorage.getItem(FN_HINT_KEY); localStorage.setItem(FN_HINT_KEY, "1"); } catch { /* private mode: no first */ }
    setTalkNote("hold 🌐 to talk to Sol", 5000); peekNow();
    if (first) window.setTimeout(() => { setTalkNote("🌐 is the fn key, bottom left", 5000); peekNow(); }, 5000);
  };
  /** Stop (the drawer's only): packs up quietly. The drawer closes at once, the dot goes out, one line says where it went */
  const stopTalk = () => {
    log("anticipate: stop");
    pressSeq.current++; spokenWait.current = null;
    setDrawer(false); closeDrop();
    setTalkNote("the talk is in Conversations", 5000); peekNow();
    if (devTalk) { setDevOn(false); return; }
    void n.talkStop().then((r) => { if (r.error) log(`anticipate.stop: ${r.error}`); });
  };
  talkHold.current = !!(drop && !drop.leaving) || drawer || fnHeld;
  const holding = talkHold.current;
  useEffect(() => { if (!holding && openRef.current && !hovering.current && cs.current.mode === "up" && !bellOn.current) expand(false); }, [holding, expand]);
  // the window's extra width while a talk is on (lib.rs `wide`: centred, both sides): room for the drawer beside the card
  wideRef.current = talkOn ? Math.max(0, DRAWER_W + DRAWER_SIDE - (g.W1 + 36)) : 0;
  // --- end Anticipate
  // --- the free notch: what Esc folded (keys, oldest first); the card is drawn without them
  const [folded, setFolded] = useState<string[]>(DEV_FOLDED);
  // the half moon: a ping is a card of its own until it is seen (or folded), open or not
  const [pingGone, setPingGone] = useState<string[]>([]);   // dev: pings closed with × (the engine's seen does it for real)
  const pingOut = newest && !pingGone.includes(newest.id) ? newest : null;
  const { card, whole, count: foldN, live: foldLive, advance, liveAsk, input } = useCard({
    crew: crew !== "up", ping: g.moon ? pingOut : pingShows && newest ? newest : null, unplugged: cr.state === "unplugged", starting,
    ask: cr.ask, call: n.callState !== "off", turn: cr.turn, stable,
    hand,   // Hand (#34)
    grabbing, shelfOpen,   // Grab and Shelf
    talk: null,            // Anticipate (sitting 2): the notch stays the notch during a talk (D1); the drawer has the rest
  }, folded);
  // the half moon: every decision card at once (answer.ts decisionCards), each named by sessionKey; a fold is one of them.
  // What only runs (a turn, a call, a ping: runningRows) is never a card, it is a row in the Sessions disc's hover name
  const sess: MoonCard[] = g.moon ? decisionCards(input) : [];
  const runs: MoonCard[] = g.moon ? runningRows(input) : [];
  const sessKeys = sess.map(sessionKey);
  // a fold whose ask was answered (here, in the window, on another face) or whose turn ended is forgotten
  const liveNow = g.moon ? sessKeys : foldLive;
  const liveKeys = liveNow.join("|");
  useEffect(() => { setFolded((f) => { const k = f.filter((x) => liveNow.includes(x)); return k.length === f.length ? f : k; }); }, [liveKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineOn = crew === "up" && LINE_KINDS.has(card.kind);
  /** Esc's last step: the line folds (false: there is none, the key closes the card as before) */
  const foldLine = (): boolean => {
    const k = lineOn ? foldKey(card) : null;
    if (!k) return false;
    setFolded((f) => (f.includes(k) ? f : [...f, k]));
    log(`fold: ${card.kind} (${k})`);
    return true;
  };
  const foldRef = useRef(foldLine); foldRef.current = foldLine;
  const unfold = () => { setFolded((f) => f.slice(0, -1)); log("unfold: the newest"); };
  // --- end the free notch
  // --- Grab and Shelf: the rows go when the card closes or something with an answer takes the card
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open && !geo.current.moon) { setGrabbing(false); setShelfOpen(false); setPrivOpen(false); window.clearTimeout(shelfT.current); }
    wasOpen.current = open;
  }, [open]);
  const outranked = crew !== "up" || !(card.kind === "plain" || card.kind === "grabbing" || card.kind === "shelf");
  useEffect(() => { if (outranked && !geo.current.moon) { setGrabbing(false); setShelfOpen(false); setPrivOpen(false); } }, [outranked]);   // the moon: each its own card
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
    grab: () => { setNote(null); setShelfOpen(false); setPrivOpen(false); setGrabbing(true); },
    shelf: () => { setNote(null); window.clearTimeout(shelfT.current); setGrabbing(false); setPrivOpen(false); setShelfOpen(true); },
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
    sol: () => { if (invisible) { setGrabbing(false); setNote(HIDDEN, 5000); } else sheet("sol"); },   // the eye is closed: Sol's picture would be blank
    all: () => sheet("shelf"),
    // --- end Grab and Shelf
    // --- Anticipate: the pill starts a talk; during one it opens and closes the drawer (never the talk: Stop is the drawer's)
    anticipate: () => {
      setGrabbing(false); setShelfOpen(false); setPrivOpen(false); setNote(null);
      if (talkOn) { setDrawer(!drawerRef.current); if (drawerRef.current) { window.clearTimeout(peek.current); expand(true); } return; }
      const began = () => { talk.reset(Date.now()); setDrawer(false); talkHints(); };
      if (devTalk) { setDevOn(true); began(); return; }
      log("anticipate: start");
      setTalkNote("listening…", 15_000);
      void n.talkStart().then((r) => {
        setTalkNote(null);
        if (!r.error) { began(); return; }
        log(`anticipate.start: ${r.error}`);
        setNote(linked(r.error), 10_000); peekNow();
        openPane(r.error);   // just pressed: the page opens now, and a press on the line opens it again
      });
    },
    // the drawer's discs carry these now (askCard); kept for a card that still names them
    answer: () => void askCard("answer", pressAt.current ?? performance.now(), false),
    next: () => void askCard("next", pressAt.current ?? performance.now(), false),
    recap: () => void askCard("recap", pressAt.current ?? performance.now(), false),
    who: () => void askCard("who", pressAt.current ?? performance.now(), false),
    ear: () => stopTalk(),
    // --- end Anticipate
  };
  const actRef = useRef(act); actRef.current = act;
  /** a pill on a session's line: Shelf and Grab fold the line first (the row takes the card), Anticipate as ever */
  const pillPress = (b: Btn, downAt?: number) => {
    if (b !== "anticipate") foldLine();
    pressAt.current = downAt;
    log(`pill ${b} on the line`);
    (act as unknown as Record<string, (() => void) | undefined>)[b]?.();
  };
  const pressAt = useRef<number | undefined>(undefined);   // Anticipate: the pill's pointer-down, for the clock and the hold
  // a new ask peeks once (the one waiting when the page starts is old news: the notch stands ajar for it)
  const askId = whole.ask ? `${whole.ask.sessionId}/${whole.ask.id}` : "";
  const peekedAsk = useRef<string | null>(null);
  useEffect(() => {
    if (peekedAsk.current === null) { peekedAsk.current = askId; return; }
    if (askId && peekedAsk.current !== askId) { peekedAsk.current = askId; peekNow(); }
  }, [askId, peekNow]);
  // closed with an ask waiting: ajar; the springs carry it there and back
  const ajar = whole.kind === "ask" || whole.kind === "question";   // a folded ask still waits
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
  // Anticipate: the drawer counts as the open notch for keys (Return sends its bar, Escape closes it) (D8)
  const hasBtns = card.buttons.length > 0 || drawer;
  keysOn.current = hasBtns;
  // --- Room under the card: what hangs under the slab (a talk's card, the private row, the drawer), how tall it is
  // measured, and so the room the window is asked for. A card goes under the slab once there is room for it, and from
  // its first frame once this window has grown before (it would flash inside first otherwise). The drawer is sized to
  // the room the app actually gave (lib.rs caps it at 0.45 × the screen − the open card, floor 360).
  growRef.current = 0;
  const underTop = g.top + g.H1 + DROP_GAP;
  const privShown = privOpen && open && crew === "up" && QUIET.has(card.kind) && !drop && !drawer;
  const underShown = !drawer && (!!(drop && open) || privShown);
  const [underH, setUnderH] = useState(0);
  const underRO = useRef<ResizeObserver | null>(null);
  const underRef = useCallback((el: HTMLDivElement | null) => {
    underRO.current?.disconnect(); underRO.current = null;
    if (!el) { setUnderH(0); return; }
    const ro = new ResizeObserver(() => setUnderH(el.offsetHeight));
    ro.observe(el); underRO.current = ro; setUnderH(el.offsetHeight);
  }, []);
  const grew = useRef(!!devSpot);
  if (underShown && winH >= underTop + MIN_ROOM) grew.current = true;
  const roomy = grew.current || winH >= underTop + MIN_ROOM;
  const under = !underShown ? 0 : (roomy && underH) || (privShown ? PRIV_ROOM : DROP_ROOM);
  const capRoom = Math.max(ROOM_FLOOR, 0.45 * g.screenH - g.H1);
  const [drawerWant, setDrawerWant] = useState(0);
  const drawerRoom = Math.min(drawerWant || 240, capRoom - ROOM_PAD);
  const room = drawer ? Math.round(drawerRoom) + ROOM_PAD : under + (underShown ? ROOM_PAD : 0);
  roomRef.current = room;
  // the drawer as the window lets it be: an app from before sitting 2 has no `wide` and a room of 360 at most
  const drawerW = Math.min(DRAWER_W, winW - 16);
  const drawerMax = Math.max(160, Math.min(capRoom - ROOM_PAD, winH - underTop - 4));
  const toldSmall = useRef(false);
  useEffect(() => {
    if (!drawer || toldSmall.current || devTalk || g.moon) return;   // the moon's window is sized once (#254): nothing to grow
    const t = window.setTimeout(() => {
      const w = window.innerWidth, h = window.innerHeight;
      if (w < g.W1 + 36 + wideRef.current - 2 || h < underTop + drawerRoom - 2) {
        toldSmall.current = true;
        log(`anticipate: the window did not grow as asked (${w}×${h}); an app from before sitting 2, the drawer is drawn ${drawerW} wide, ${Math.round(drawerMax)} tall at most`);
      }
    }, 700);
    return () => window.clearTimeout(t);
  }, [drawer, drawerRoom]); // eslint-disable-line react-hooks/exhaustive-deps
  // --- end Room under the card
  // the card gained or lost its buttons, or the room under it changed, while open: the app follows (lib.rs resizes
  // the window and recomputes the keys on its next hover tick)
  const wide = wideRef.current;
  useEffect(() => { if (openRef.current && !geo.current.moon) void invoke("notch_expand", { expanded: true, keys: hasBtns, room, wide }).catch(() => {}); }, [hasBtns, open, room, wide]);
  useEffect(() => {
    const off = listen<{ key: string; up?: boolean }>("notch-key", (e) => {
      const { key, up } = e.payload, h = retHeld.current, now = performance.now();
      if (geo.current.moon) { moonKeyRef.current(key, !!up); return; }   // the half moon: the card under the pointer
      if (key === "Return") {
        if (up) { h.down = false; return; }
        if (h.down && now - h.at < 1000) { h.at = now; log("key Return held: nothing"); return; }   // a repeat
        h.down = true; h.at = now;
        // Anticipate: the drawer open, Return is its bar's (the one bar on screen) (D8)
        if (drawerRef.current) { drawerApi.current?.send(); log("key Return: the drawer's bar"); return; }
        if (!armed(changed.current.at, now)) { log(`key Return on ${cardRef.current.kind}: not armed`); return; }
      }
      // Anticipate: Escape closes the pinned card, then the drawer, then a card under the notch (talkEscape)
      if (key === "Escape" && escRef.current()) return;
      const r = onKey(cardRef.current, key, liveAsk(), actRef.current);
      log(`key ${key} on ${cardRef.current.kind}: ${r}`);
    });
    return () => { void off.then((f) => f()); };
  }, [liveAsk]);
  const press = (b: Parameters<typeof answer>[1], downAt?: number) => {
    if (!armed(changed.current.at, performance.now())) { log(`press ${b} on ${card.kind}: not armed`); return; }
    pressAt.current = downAt;
    const r = answer(card, b, liveAsk(), act);
    log(`press ${b} on ${card.kind}: ${r ? "sent" : "dropped"}`);
  };

  // Anticipate: a press on a card or an answer lands the window on the talk's session, as Open does for a ping
  const talkOpen = (sid?: string) => {
    const s = sid ?? (devTalk ? null : n.talk.sessionId ?? talk.talkNow().sessionId ?? null);
    if (!s) { log("anticipate: no session to open yet"); return; }
    askOpen({ seat: "claude", sessionId: s, id: `talk:${s}@${Date.now()}` });
    closeDrop(); setDrawer(false); act.close();
  };
  const talkRename = (who: talk.Who, name: string) => {
    talk.setName(who, name);
    if (!devTalk) void n.talkName(who, name).then((r) => { if (r.error) log(`anticipate.name: ${r.error}`); });
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
  // the free notch: with what asks folded, "I need you." gives way to Sol's own line (the count says it)
  const calling = st === "yourcall" && !(foldN > 0 && !LINE_KINDS.has(card.kind));
  const urgent = st === "unplugged" || calling;
  const said = st === "unplugged" ? (starting ? "Starting…" : "Plug me back in? Click me.")
    : dictOn ? n.dictating || SENTENCE.listening : n.working ? "Give me a second." : calling ? SENTENCE.yourcall : pinText || n.sentence || (st === "yourcall" ? SENTENCE.here : SENTENCE[st]);
  // an ask outranks a ringing ping (answer.ts): its line, the ping waits in the meta
  const asking = card.kind === "ask" || card.kind === "question";
  const failNote = failed === key ? "Sol is restarting, try again in the window" : "";
  const noteText = (note || talkNote) && OWN_ROWS.has(card.kind) ? (talkNote || note || "") : "";   // Grab and Shelf, Anticipate
  // Anticipate: Fn held, the call's mute state is the line (D12); the rest of the talk's lines are notes
  const talkLine = holdLine?.text ?? "";
  const text = crew !== "up" ? (r.crew || "changing a part of me") : dictOn ? said : failNote || (asking && card.line ? card.line
    : talkLine ? talkLine
    : pingShows && newest ? pingLine(newest) : card.ping ? pingLine({ ...card.ping, at: 0 }) : noteText || (st !== "unplugged" && card.line ? card.line : said));
  const dim = crew === "up" && !dictOn && !talkLine && !pingShows && !urgent && !card.line && !card.ping && !noteText && (n.working || (!n.sentence && !pinText));
  // a sentence that is still being written (the new one begins with the old) updates in place; anything else slides
  const prev = useRef({ key: 0, text: "" });
  const linePage = paneOf.current && paneOf.current.text === text ? paneOf.current.page : null;
  if (prev.current.text !== text) {
    if (!(prev.current.text && text.startsWith(prev.current.text.replace(/…$/, "")))) prev.current.key++;
    prev.current.text = text;
  }

  // ---- The half moon (#254; Moon.tsx draws it) ----
  // Everything Sol has for you is a card: the decision cards (answer.ts decisionCards: an ask, a hand, a new stable,
  // unplugged; a running turn, a call and a ping are rows in the Sessions disc's hover name), Sol's sentence (the say card), and what the tools open (Grab's question,
  // the shelf, the private list, a talk's card, the drawer). A card buds out of the rim where its place meets the moon,
  // floats where it is put, and is absorbed when closed: a session's into the Sessions disc (folded: the disc counts it,
  // a press buds it back), the rest back into the rim. The moon closing leaves them out; the window stays grown for them.
  const moon = g.moon;
  const [, setMoonTick] = useState(0);
  const redraw = () => setMoonTick((k) => k + 1);
  // the scene (scene.ts, #254): one canvas draws every black shape (the moon, the buds, the necks, the cards'
  // bodies) with one shader; it replaced the SVG goo filter and its melt observer (grey hairlines at every edge, 2026-10-26)
  const sceneEl = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = sceneEl.current;
    if (!moon || !c) return;
    const r = new SceneRenderer(c, log);
    // the moon's entry, written now and again whenever the window's width moves its middle (the drawer's 1040)
    const put = () => redrawSpring(sp.current!.w);
    put();
    window.addEventListener("resize", put);
    return () => { window.removeEventListener("resize", put); r.dispose(); scene.remove("moon"); };
  }, [moon]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const sessOut = sess.filter((c) => !folded.includes(sessionKey(c)));
  // ---- the say card: Sol's sentence, a pin, the dictation's words, the crew's words; it peeks and is absorbed after
  // SAY_MS unless the pointer is on it (dictation and the crew keep it)
  const sayText = crew !== "up" ? (r.crew || "changing a part of me") : dictOn ? said
    : failNote || talkLine || talkNote || note || pinText || n.sentence || DEV_SAY;
  const [sayOn, setSayOn] = useState(!!DEV_SAY);
  const sayT = useRef<number | undefined>(undefined), saySeen = useRef<string | null>(null);
  const sayHold = () => hoverCard.current === "say" || dictHeld.current || cs.current.mode !== "up";
  useEffect(() => {
    if (!moon) return;
    if (saySeen.current === null) { saySeen.current = sayText; return; }   // the sentence it starts with is old news
    if (!sayText || saySeen.current === sayText) return;
    saySeen.current = sayText;
    setSayOn(true);
    window.clearTimeout(sayT.current);
    const tick = () => { if (sayHold()) { sayT.current = window.setTimeout(tick, 1000); return; } setSayOn(false); };
    if (!DEV_SAY) sayT.current = window.setTimeout(tick, SAY_MS);
  }, [moon, sayText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(sayT.current), []);
  const sayShown = moon && !!sayText && (sayOn || dictOn || crew !== "up" || !!talkLine);
  // ---- each session card: its line, its colour, its own arming (a press within ARM_MS of it changing is refused)
  const armAt = useRef(new Map<string, { k: string; at: number }>());
  for (const c of [...sessOut, ...runs]) {   // a running row's buttons are armed the same way
    const id = sessionKey(c), k = cardKey(c), a = armAt.current.get(id);
    if (!a || a.k !== k) armAt.current.set(id, { k, at: performance.now() });
  }
  const lineOf = (c: MoonCard): string => c.kind === "turn" ? `${c.turn?.kind === "work" ? "working" : "answering"}: ${c.turn?.title || (c.turn?.kind === "work" ? "a session" : "a chat")}`
    : c.kind === "ping" && c.ping ? pingLine({ ...c.ping, at: 0 }) : c.kind === "unplugged" ? (starting ? "Starting…" : "Plug me back in?")
    : c.kind === "call" ? "On a call with Sol" : c.line ?? "";
  /** a running thing's row under the Sessions disc's name: "working · ecosystem", "answering · a chat", "on a call" */
  const rowOf = (c: MoonCard): string => c.kind === "turn" ? `${c.turn?.kind === "work" ? "working" : "answering"} · ${c.turn?.title || (c.turn?.kind === "work" ? "a session" : "a chat")}`
    : c.kind === "call" ? "on a call" : lineOf(c);
  // each row keeps the card it would have been, so its buttons come with it (Stop, Hang up, Open; Moon.tsx BudRow)
  const sessRows: RunRow[] = runs.map((c) => ({ id: sessionKey(c), text: rowOf(c), card: c }));
  // the Sessions bud with pressable rows is out (Moon.tsx says so), and the row under the pointer in it
  const [rowsOut, setRowsOut] = useState(false);
  const hoverRow = useRef<string | null>(null), [hoverRowId, setHoverRowId] = useState<string | null>(null);
  const rowHover = (id: string | null) => { hoverRow.current = id; setHoverRowId(id); };
  const colourOf = (c: MoonCard): string => {
    if (c.kind === "ping" && c.ping) { const [r0, g0, b0] = pingColour({ ...c.ping, at: 0 }); return `rgb(${r0}, ${g0}, ${b0})`; }
    return c.kind === "ask" || c.kind === "question" ? "#fd69b9" : c.kind === "turn" || c.kind === "call" ? "#f89b2a" : c.kind === "unplugged" ? "#fd302d" : "#8dc965";
  };
  const pressOn = (c: MoonCard, b: Btn) => {
    const a = armAt.current.get(sessionKey(c));
    if (a && !armed(a.at, performance.now())) { log(`press ${b} on ${c.kind}: not armed`); return; }
    const ok = answer(c, b, liveAsk(), act);
    log(`press ${b} on ${c.kind} (a card): ${ok ? "sent" : "dropped"}`);
  };
  // ---- folding: into the Sessions disc, and back
  const fold = (keys: string[]) => { if (keys.length) setFolded((f) => [...f, ...keys.filter((k) => !f.includes(k))]); };
  const closeSession = (c: MoonCard) => {
    if (c.kind === "ping" && c.ping) {
      log(`moon: the ping seen (${c.ping.id})`);
      if (DEV_CARD) setPingGone((l) => [...l, c.ping!.id]); else seenPing(c.ping.id);
      return;
    }
    fold([sessionKey(c)]); log(`moon: fold ${c.kind}`);
  };
  const closeTool: Record<string, () => void> = {
    say: () => { window.clearTimeout(sayT.current); setSayOn(false); },
    grab: () => setGrabbing(false), shelf: () => setShelfOpen(false), private: () => setPrivOpen(false),
    talk: () => closeDrop(), drawer: () => setDrawer(false),
  };
  /** Escape with no card under the pointer, the Sessions disc with cards out: every card absorbed */
  const absorbAll = () => {
    fold(sessOut.map(sessionKey));
    for (const f of Object.values(closeTool)) f();
    log("moon: absorb all");
  };
  // ---- the cards this moment, in drawing order (the newest kind on top)
  type Spec = { id: string; session?: MoonCard; node: React.ReactNode; home: MoonP; bare?: boolean; close?: () => void; cls?: string };
  const anySess = sessOut.length > 0;
  const big = drawer && talkOn;   // the drawer out: it takes centre field
  const sessAt = { x: big ? -BIG_SIDE : SESS_AT.x, y: SESS_AT.y };
  const toolAt = { x: big ? BIG_SIDE : anySess ? TOOL_BESIDE : TOOL_AT.x, y: TOOL_AT.y };
  const keysHere = (id: string) => keysLive && hoverId === id;
  const specs: Spec[] = !moon ? [] : [
    ...sessOut.map((c): Spec => {
      const id = sessionKey(c);
      return { id, session: c, home: sessAt, close: () => closeSession(c),
        node: <SessionBody card={c} line={lineOf(c)} colour={colourOf(c)} keys={keysHere(id)} onPress={(b) => pressOn(c, b)} /> };
    }),
    ...(sayShown ? [{ id: "say", home: toolAt, close: closeTool.say, cls: "say-card",
      node: <SayBody text={sayText} red={!!holdLine?.red && sayText === talkLine} /> }] : []),
    ...(grabbing ? [{ id: "grab", home: toolAt, close: closeTool.grab,
      node: <RowBody title="Grab what?"><Buttons card={cardOf({ crew: false, ping: null, unplugged: false, starting: false, ask: null, call: false, turn: null, grabbing: true, shelfOpen: false })}
        keys={false} onPress={(b) => (act as unknown as Record<string, (() => void) | undefined>)[b]?.()} onHover={leanTo} /></RowBody> }] : []),
    ...(shelfOpen ? [{ id: "shelf", home: toolAt, close: closeTool.shelf,
      node: <RowBody title="Shelf"><Buttons card={{ kind: "shelf", buttons: ["all"], meta: "" }} keys={false} onPress={(b) => (act as unknown as Record<string, (() => void) | undefined>)[b]?.()}
        onHover={leanTo} lead={<Thumbs items={shelfItems} />} meta={shelfMeta(shelfItems.length)} /></RowBody> }] : []),
    ...(privOpen ? [{ id: "private", home: toolAt, close: closeTool.private,
      node: <PrivateRow apps={privApps} clean={cleanOn} busy={cleanBusy} top={0} onTick={tickApp} onClean={cleanPress} /> }] : []),
    ...(drop && !drop.leaving && !drawer ? [{ id: "talk", home: toolAt, close: closeTool.talk,
      node: <TalkDrop key={drop.n} card={drop.card} why={drop.why} secs={drop.secs} q={drop.q} inside={false} leaving={false} onOpen={() => talkOpen()} /> }] : []),
    ...(drawer && talkOn ? [{ id: "drawer", home: { x: 0, y: TOOL_AT.y }, bare: true, close: closeTool.drawer,
      node: <Drawer top={0} width={Math.min(DRAWER_W, winW - 16)} maxH={Math.max(160, winH - TOOL_AT.y - 24)} secs={talkSecs} hold={holdLine}
        pin={drop ? { card: drop.card, why: drop.why, secs: drop.secs, leaving: !!drop.leaving, n: drop.n, q: drop.q } : null}
        onWant={setDrawerWant} onStop={stopTalk} onButton={(b, at, screen) => void askCard(b, at, screen)} onSend={askTyped}
        onOpen={talkOpen} onRename={talkRename} onEscape={() => escRef.current()} apiRef={drawerApi} /> }] : []),
  ];
  // presence: a card that left the list is absorbed first (its last content kept), then forgotten
  const lastSpecs = useRef(new Map<string, Spec>()), absorbing = useRef(new Map<string, Spec>());
  {
    const cur = new Map(specs.map((x) => [x.id, x]));
    for (const [id, x] of lastSpecs.current) if (!cur.has(id) && !absorbing.current.has(id)) absorbing.current.set(id, x);
    for (const id of cur.keys()) absorbing.current.delete(id);   // called back mid-absorb: it buds again from there
    lastSpecs.current = cur;
  }
  const leaving = [...absorbing.current.values()];
  const floatsOut = specs.length + leaving.length > 0;
  floatsOutRef.current = floatsOut;
  // places: a card keeps where it first landed (or where it was dragged) until it is gone
  const places = useRef(new Map<string, MoonP>()), sizes = useRef(new Map<string, { w: number; h: number }>()), dragged = useRef(new Set<string>());
  // the big one arriving or going: every card not dragged by hand moves to its column
  const lastBig = useRef(big);
  if (lastBig.current !== big) {
    lastBig.current = big;
    for (const x of specs) { const pl = places.current.get(x.id); if (pl && !dragged.current.has(x.id) && x.id !== "drawer") places.current.set(x.id, { x: x.home.x, y: pl.y }); }
  }
  for (const x of specs) {
    if (places.current.has(x.id)) continue;
    if (x.session) {
      let y = x.home.y;
      for (const o of specs) {
        const pl = o.session && o.id !== x.id ? places.current.get(o.id) : undefined;
        if (pl && pl.x === sessAt.x) y = Math.max(y, pl.y + (sizes.current.get(o.id)?.h ?? 76) + STACK_GAP);
      }
      places.current.set(x.id, { x: x.home.x, y });
    } else places.current.set(x.id, { ...x.home });
  }
  const sessDisc = discAt("sessions", g.off);
  const weight = (c: MoonCard) => (c.ask ? c.ask.of : 1);   // an ask counts every question it holds
  const foldedN = sess.filter((c) => folded.includes(sessionKey(c))).reduce((k, c) => k + weight(c), 0);
  // the count updates as each lands
  const landing = leaving.reduce((k, x) => k + (x.session && folded.includes(x.id) ? weight(x.session) : 0), 0);
  const sessCount = Math.max(0, foldedN - landing);
  const moonKeys = sessOut.some((c) => c.buttons.length > 0) || (drawer && talkOn) || rowsOut;
  if (moon) keysOn.current = moonKeys;
  /** the Sessions disc: with cards out, every card absorbed; with none out and some folded, all of them budded back */
  const sessionsPress = () => {
    if (specs.length) { absorbAll(); return; }
    if (folded.length) { setFolded([]); log("moon: unfold all"); }
  };
  const toolPress = (t: Tool, at?: number) => {
    pressAt.current = at;
    log(`moon: ${t}`);
    if (t === "eye") flickEye();
    else if (t === "shelf") { if (shelfOpen) setShelfOpen(false); else act.shelf(); }
    else if (t === "grab") { if (grabbing) setGrabbing(false); else act.grab(); }
    else if (t === "anticipate") act.anticipate();
    else sessionsPress();
  };
  // ---- Return and Escape: the card under the pointer (#254)
  moonKeyRef.current = (key, up) => {
    const h = retHeld.current, now = performance.now(), id = hoverCard.current;
    // a running row under the pointer in the Sessions bud: Return is its safe button (answer.ts keyAction: a ping's
    // Open; never Stop, never Hang up), Escape only closes the bud
    const row = hoverRow.current ? runs.find((x) => sessionKey(x) === hoverRow.current) : undefined;
    if (key === "Return") {
      if (up) { h.down = false; return; }
      if (h.down && now - h.at < 1000) { h.at = now; log("key Return held: nothing"); return; }
      h.down = true; h.at = now;
      if (row) {
        const b = keyAction(row, "Return");
        if (!b || b === "close" || !row.buttons.includes(b)) { log(`key Return on the ${row.kind} row: nothing`); return; }
        pressOn(row, b); return;
      }
      if (id === "drawer") { drawerApi.current?.send(); log("key Return: the drawer's bar"); return; }
      const c = sessOut.find((x) => sessionKey(x) === id);
      if (!c) { log(`key Return: no card under the pointer (${id ?? "none"}): nothing`); return; }
      const a = armAt.current.get(id!);
      if (a && !armed(a.at, now)) { log(`key Return on ${c.kind}: not armed`); return; }
      log(`key Return on ${c.kind} (a card): ${onKey(c, "Return", liveAsk(), act)}`);
      return;
    }
    if (key !== "Escape" || up) return;
    if (rowsOut && !id) { discApi.current?.closeBud(); log("key Escape: the Sessions bud"); return; }
    if (!id) { absorbAll(); return; }
    if (id === "drawer") { escRef.current(); return; }   // the pinned card, then the drawer (D8)
    const c = sessOut.find((x) => sessionKey(x) === id);
    if (c) closeSession(c); else closeTool[id]?.();
    log(`key Escape: the card under the pointer (${id})`);
  };
  // ---- the window: 760 x 460 the whole time the moon is in, open or closed (1040 while the drawer is out); `expanded`
  // is the open state for the keys. The window never changes size at the first frame of an open or a close any more:
  // that resize put the old picture in the new frame for a frame or two, a sideways jump of the moon seen on the real
  // notch at 60 fps (2026-10-26). The hit regions below make the big closed window harmless: only the slab is Sol's.
  const grown = moon && (open || floatsOut);
  const grownRef = useRef(false); grownRef.current = grown;
  useEffect(() => {
    if (!moon) return;
    void invoke("notch_expand", { expanded: grown, keys: grown && moonKeys, room: Math.max(0, MOON_WIN_H - (g.H1 + 16)), wide: Math.max(0, (big ? MOON_WIN_W_BIG : MOON_WIN_W) - (g.W1 + 36)) }).catch(() => {});
  }, [moon, grown, moonKeys, g.H1, g.W1, big]); // eslint-disable-line react-hooks/exhaustive-deps
  // ---- the hit regions (#254): the slab or moon, every card, every name bud and disc; a drag takes the window.
  // Each black shape is its own object and the empty space between them is never the notch's (Marco, 2026-10-26: a stray
  // hover must not route his action into the notch while he moves tabs under it), so the moon is not its bounding box:
  // the straight part is one rectangle and the arc a stair of strips, each as wide as the curve at its top edge.
  const regOk = useRef(true), regT = useRef<number | undefined>(undefined), regLast = useRef(""), dragging = useRef(false);
  const flushRegions = useCallback(() => {
    regT.current = undefined;
    if (!geo.current.moon || !regOk.current) { regLast.current = ""; return; }
    const rs: { x: number; y: number; w: number; h: number }[] = [];
    const add = (b: DOMRect, pad = 0) => { if (b.width > 0 && b.height > 0) rs.push({ x: Math.floor(b.left - pad), y: Math.floor(b.top - pad), w: Math.ceil(b.width + 2 * pad), h: Math.ceil(b.height + 2 * pad) }); };
    if (dragging.current) rs.push({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    else {
      if (pill.current) {
        const b = pill.current.getBoundingClientRect(), { br, bry } = moonShape.current;
        const rx = Math.min(br, b.width / 2), ry = Math.min(bry, b.height), straight = b.height - ry, N = 8;
        if (straight > 0) add(new DOMRect(b.left, b.top, b.width, straight));
        for (let i = 0; i < N; i++) {
          const t = i / N, hw = (b.width / 2 - rx) + rx * Math.sqrt(1 - t * t);
          add(new DOMRect(b.left + b.width / 2 - hw, b.top + straight + ry * t, 2 * hw, ry / N));
        }
      }
      // the scene's buds and bodies (a name growing, a card budding or absorbed): their black takes the mouse too
      for (const sh of scene.read()) if (sh.on && sh.kind === "rrect") add(new DOMRect(sh.x, sh.y, sh.w, sh.h), 2);
      document.querySelectorAll<HTMLElement>(".notch [data-region]").forEach((el) => {
        if (el.style.visibility === "hidden" || el.closest("[style*='visibility: hidden']")) return;
        add(el.getBoundingClientRect(), 2);
      });
    }
    const k = JSON.stringify(rs);
    if (k === regLast.current) return;
    regLast.current = k;
    void invoke("notch_regions", { rects: rs }).catch((e) => {
      if (!regOk.current) return;
      regOk.current = false;
      log(`an app from before the moon: the whole window takes the mouse (${e})`);
    });
  }, []);
  const sendRegions = useCallback(() => { if (regT.current === undefined) regT.current = window.setTimeout(flushRegions, 30); }, [flushRegions]);
  useEffect(() => { sendRegions(); }, [grown, specs.length, leaving.length, sendRegions]);
  useEffect(() => {
    if (!moon || !pill.current) return;
    const ro = new ResizeObserver(sendRegions); ro.observe(pill.current);
    window.addEventListener("resize", sendRegions);
    return () => { ro.disconnect(); window.removeEventListener("resize", sendRegions); };
  }, [moon, sendRegions]);
  // (the cleanup forgets the timer's id too: StrictMode's mount-unmount-mount in the hot page left a dead id behind and
  // no region was ever sent, 2026-10-26)
  useEffect(() => () => { window.clearTimeout(regT.current); regT.current = undefined; }, []);
  const floatsJsx = moon ? [...specs.map((x) => ({ x, phase: "bud" as const })), ...leaving.map((x) => ({ x, phase: "absorb" as const }))].map(({ x, phase }, i) => {
    const pl = places.current.get(x.id) ?? x.home, sz = sizes.current.get(x.id) ?? { w: 280, h: 76 };
    const from = rimPoint({ x: pl.x, y: pl.y + sz.h / 2 }, g.off);
    return (
      <Float key={x.id} id={x.id} x={pl.x} y={pl.y} from={from} to={x.session ? sessDisc : from} phase={phase} z={10 + i} bare={x.bare} className={x.session ? "sess" : x.cls}
        onPlace={(id, px, py) => { places.current.set(id, { x: px, y: py }); dragged.current.add(id); }}
        onGone={(id) => { absorbing.current.delete(id); places.current.delete(id); sizes.current.delete(id); dragged.current.delete(id); if (hoverCard.current === id) { hoverCard.current = null; setHoverId(null); } redraw(); }}
        onLanded={x.session ? () => discApi.current?.squash("sessions") : undefined}
        onHover={(id, on) => { if (on) { hoverCard.current = id; setHoverId(id); } else if (hoverCard.current === id) { hoverCard.current = null; setHoverId(null); } }}
        onSize={(id, w, h) => { const o = sizes.current.get(id); sizes.current.set(id, { w, h }); if (!o || Math.abs(o.h - h) > 1) sendRegions(); }}
        onFrame={sendRegions} onDrag={(on) => { dragging.current = on; flushRegions(); }}
        onClose={phase === "absorb" ? undefined : x.close}>{x.node}</Float>
    );
  }) : null;
  // ---- end The half moon

  return (
    <div
      className={`notch ${g.form} shape-${g.shape}${open ? " open" : ""}${card.kind === "shelf" ? " shelfed" : ""}${talkOn ? " talking" : ""}${drawer ? " drawn" : ""}${dropping ? " drop" : ""}${crew !== "up" ? " crew" : ""}${pingShows ? " pinged" : ""}${hasBtns ? " btns" : ""}${lineOn && open ? " lined" : ""}${moon ? " moon" : ""}`}
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
      {moon ? <>
        {/* the scene: every black shape (the moon, the buds, the necks, the cards' bodies), one canvas, one shader */}
        <canvas className="goo" ref={sceneEl} aria-hidden />
        {/* the slab: no black of its own, the pointer (it opens the moon) and the hit strips' box */}
        <div className="slab" ref={pill} onPointerEnter={() => { if (!openRef.current) expand(true); }} />
        <div className="slab-top" ref={pillTop}>
          <div className="mark" ref={markEl} style={{ visibility: crew !== "up" ? "hidden" : undefined }}><Mark size={24} /></div>
        </div>
        {crew === "up" && <MoonDiscs off={g.off} apiRef={discApi} kNow={moonK} invisible={invisible} privHeld={privOpen} talk={talkOn ? clock(talkSecs) : null} drawerOn={drawer}
          sessDot={sessOut.length > 0 || sessCount > 0 || runs.some((c) => c.kind === "ping")} sessCount={sessCount} sessRows={sessRows} shelfOn={shelfOpen} grabOn={grabbing}
          rowKeys={keysLive ? hoverRowId : null} onRowPress={(r, b) => pressOn(r.card, b)} onRowHover={rowHover} onRows={(on) => { setRowsOut(on); if (!on) rowHover(null); sendRegions(); }}
          onPress={toolPress} onEyeHold={holdEye} onHover={(_t, el) => leanTo(null, el)} onLayout={sendRegions} />}
        {floatsJsx}
      </> : <>
      <div className="slab" ref={pill}>
        <div className="mark" ref={markEl} style={{ visibility: crew !== "up" ? "hidden" : undefined }}><Mark size={24} />
          {open && foldN > 0 && <FoldCount n={foldN} onUnfold={unfold} />}</div>
        <div className="say-box" ref={say}>
          {open && crew === "up" && (QUIET.has(card.kind) || lineOn) && <EyeMark invisible={invisible} held={privShown} onFlick={flickEye} onHold={holdEye} />}
          {/* the line; a permission sentence on it opens its System Settings page when pressed (not the call) */}
          <div className={`say-text${linePage ? " linked" : ""}`} title={linePage ? "Open System Settings" : undefined}
            onClick={linePage ? (e) => { e.stopPropagation(); log(`line pressed: ${linePage}`); openPage(linePage); } : undefined}>
            <Swap k={`${prev.current.key}:${card.ask?.id ?? ""}`} dist={18} cfg={CFG.arrive}><p className={`say${dim ? " dim" : ""}${(card.line && text === card.line && card.kind !== "stable") || lineOn ? " one" : ""}${holdLine?.red && text === talkLine ? " red" : ""}`} aria-live="polite">{text}</p></Swap>
            {/* the free notch: a session's own buttons, small, under its line */}
            {lineOn && <LineBtns card={card} keys={keysLive} onPress={press} />}</div>
          {lineOn ? <LinePills onPress={pillPress} onHover={leanTo} lit={talkOn ? { b: "anticipate", label: `Anticipate · ${clock(talkSecs)}` } : null} />
            : <Buttons card={card} keys={keysLive} onPress={press} onHover={leanTo} lit={talkOn ? { b: "anticipate", label: `Anticipate · ${clock(talkSecs)}` } : null}
            lead={card.kind === "shelf" ? <Thumbs items={shelfItems} /> : undefined} meta={card.kind === "shelf" ? shelfMeta(shelfItems.length) : undefined} />}
        </div>
        {drop && open && !roomy && !drawer && <TalkDrop key={drop.n} card={drop.card} why={drop.why} secs={drop.secs} q={drop.q} inside leaving={!!drop.leaving} onOpen={() => talkOpen()} />}
      </div>
      {drop && open && roomy && !drawer && <TalkDrop key={drop.n} card={drop.card} why={drop.why} secs={drop.secs} q={drop.q} inside={false} leaving={!!drop.leaving} top={underTop} boxRef={underRef} onOpen={() => talkOpen()} />}
      {/* Anticipate: the drawer, under the notch while it is open (it holds the notch open; the pinned card at its top) */}
      {drawer && talkOn && <Drawer top={underTop} width={drawerW} maxH={drawerMax} secs={talkSecs} hold={holdLine}
        pin={drop ? { card: drop.card, why: drop.why, secs: drop.secs, leaving: !!drop.leaving, n: drop.n, q: drop.q } : null}
        onWant={setDrawerWant} onStop={stopTalk} onButton={(b, at, screen) => void askCard(b, at, screen)} onSend={askTyped}
        onOpen={talkOpen} onRename={talkRename} onEscape={() => escRef.current()} apiRef={drawerApi} />}
      {/* the clean screen: the private list's row under the card, while the eye is held open */}
      {privShown && <PrivateRow apps={privApps} clean={cleanOn} busy={cleanBusy} top={underTop} rowRef={underRef} onTick={tickApp} onClean={cleanPress} />}
      </>}
      <CrewCanvas pill={pill} st={cs} />
    </div>
  );
}

