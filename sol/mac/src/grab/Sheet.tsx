// The sheet: Grab and Shelf's full-screen page (sol/README.md "Grab and Shelf"). A transparent window over the whole
// main screen with five rooms, one at a time: the dark room (pick a part of Sol), the page room (pick any app's window;
// it is scrolled and stitched into one tall picture, PageRoom.tsx), markup, where to, and the shelf's tray; the receipt
// is where-to's last moment. The room comes from ?mode at first load and from the "grab-open" event
// after (grab.rs shows the same window again with a new mode). Escape leaves any room: the state is dropped first, so
// the next open starts clean, then the window hides. Return is each room's safe step (the rooms listen for it).
//
// One bead (Bead.tsx) and one line (Line.tsx) live here and are lent to the rooms. The threads for Where to? are
// followed from the moment the page loads (the wire asks `list` on every connect), so the list is ready when needed.
import { useCallback, useEffect, useRef, useState } from "react";
import { BeadView, BEAD, type Bead } from "./Bead";
import { Line, type LineSay } from "./Line";
import { Markup, exportPng, fitRect, type Stroke } from "./Markup";
import { PageRoom } from "./PageRoom";
import { Room, type Rect } from "./Room";
import { Tray } from "./Tray";
import { WhereTo, type Out } from "./WhereTo";
import { DEV, DEV_ROOM, FIRST_MODE, dataUrlOf, devPageView, devPageWindows, devPicture, devThreads, devWindows, hear, hide, isImage, log, onOpen, type Item, type Mode, type Thread } from "./wire";

type State =
  | { room: "idle" }
  | { room: "room" }
  | { room: "page" }
  | { room: "markup"; img: HTMLImageElement; item: Item | null; from: Rect | null; start?: Stroke[] }
  | { room: "where"; out: Out; from: Rect | null; auto?: number }
  | { room: "tray" };

const loadImage = (src: string) => new Promise<HTMLImageElement>((ok, no) => {
  const i = new Image();
  i.crossOrigin = "anonymous";   // the engine answers with this page's origin, so the canvas stays clean for toDataURL
  i.onload = () => ok(i); i.onerror = () => no(new Error("the picture did not load"));
  i.src = src;
});
// marks for the dev stills: a box round the sidebar, an arrow, words
const devMarks = (r: Rect): Stroke[] => {
  const k = r.w / 760;
  return [
    { t: "box", a: [8 * k, 44 * k], b: [192 * k, 280 * k] },
    { t: "arrow", a: [330 * k, 330 * k], b: [205 * k, 220 * k] },
    { t: "text", at: [338 * k, 330 * k], s: "this should fold too" },
  ];
};

export default function Sheet() {
  const [mode, setMode] = useState<Mode>(FIRST_MODE);
  const [st, setSt] = useState<State>({ room: "idle" });
  const [say, setSay] = useState<LineSay | null>(null);
  const [bead, setBead] = useState<Bead | null>(null);
  const [threads, setThreads] = useState<Thread[]>(DEV ? devThreads() : []);
  const sayN = useRef(0), gen = useRef(0);
  const line = useCallback((text: string, check = false) => setSay({ text, check, id: ++sayN.current }), []);

  useEffect(() => hear((m) => { if (m.type === "threads" && Array.isArray(m.threads)) setThreads(m.threads); }), []);

  // entering a room from nothing: the bead starts at the notch, every room starts clean
  const begin = useCallback((m: Mode) => {
    gen.current++;
    setMode(m);
    bead?.place(innerWidth / 2 - BEAD / 2, -BEAD - 8);
    setSay(null);
    setSt({ room: "idle" });
    window.setTimeout(() => setSt(m === "shelf" ? { room: "tray" } : m === "page" ? { room: "page" } : { room: "room" }), 0);
  }, [bead]);
  const leave = useCallback(() => {
    gen.current++;
    setSt({ room: "idle" }); setSay(null);
    bead?.place(innerWidth / 2 - BEAD / 2, -BEAD - 8);
    if (DEV) { console.info("[grab] Escape: the sheet would hide"); return; }
    hide(mode);
  }, [bead, mode]);

  // first entry: ?mode (or a dev room) once the bead is there; later entries: grab-open
  const started = useRef(false);
  useEffect(() => {
    if (!bead || started.current) return;
    started.current = true;
    if (DEV && DEV_ROOM && DEV_ROOM !== "room" && DEV_ROOM !== "tray" && DEV_ROOM !== "page" && !DEV_ROOM.startsWith("permit")) void devRoom(DEV_ROOM);
    else begin(FIRST_MODE);
  }, [bead]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onOpen((m) => { log(`open ${m}`); begin(m); }), [begin]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); leave(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [leave]);

  // the dark room or the page room took a window: its picture, then markup
  const taken = async (item: Item, from: Rect) => {
    const g = gen.current;
    try {
      const img = await loadImage(item.url);
      if (g === gen.current) setSt({ room: "markup", img, item, from });
    } catch (e) { line(`Could not open the picture: ${(e as Error).message}`); }
  };
  const marked = (st.room === "markup" ? st : null);
  const done = (png: string, at: Rect) => {
    if (!marked) return;
    setSt({ room: "where", from: at, out: { dataUrl: png, name: marked.item?.kind === "page" ? "page-grab.png" : "sol-grab.png", mime: "image/png", image: true, item: marked.item, w: marked.img.naturalWidth, h: marked.img.naturalHeight } });
  };
  // the tray sends a thing: its own file as the picture, no markup
  const fromShelf = async (item: Item, from: Rect) => {
    const g = gen.current;
    try {
      const dataUrl = item.url.startsWith("data:") ? item.url : await dataUrlOf(item.url);
      let w = item.w ?? 4, h = item.h ?? 3;
      if (isImage(item)) { const i = await loadImage(dataUrl); w = i.naturalWidth; h = i.naturalHeight; }
      if (g === gen.current) setSt({ room: "where", from, out: { dataUrl, name: item.name, mime: item.mime, image: isImage(item), item, w, h } });
    } catch (e) { line(`Could not open it: ${(e as Error).message}`); }
  };

  // dev: straight into a room with the made-up picture
  async function devRoom(room: string) {
    const win = devWindows()[0], img = await loadImage(devPicture());
    const at = fitRect(img.naturalWidth, img.naturalHeight);
    if (room === "markup") { setSt({ room: "markup", img, item: null, from: null, start: devMarks(at) }); return; }
    const png = exportPng(img, devMarks(at), at.w);
    setSt({ room: "where", from: { x: win.x, y: win.y, w: win.w, h: win.h }, auto: room === "receipt" ? 1 : undefined,
      out: { dataUrl: png, name: "sol-grab.png", mime: "image/png", image: true, item: null, w: img.naturalWidth, h: img.naturalHeight } });
  }

  return (
    <div className={`sheet room-${st.room}`}>
      {DEV && <DevDesk page={mode === "page"} />}
      {st.room !== "room" && st.room !== "page" && st.room !== "idle" && <div className="shade" />}
      {st.room === "room" && <Room bead={bead} say={line} onTaken={(it, r) => void taken(it, r)} onLeave={leave} />}
      {st.room === "page" && <PageRoom bead={bead} say={line} onTaken={(it, r) => void taken(it, r)} onLeave={leave} />}
      {st.room === "markup" && <Markup img={st.img} tall={st.item?.kind === "page"} from={st.from} start={st.start} bead={bead} say={line} onDone={done} />}
      {st.room === "where" && <WhereTo out={st.out} from={st.from} bead={bead} threads={threads} say={line} auto={st.auto}
        onSent={() => { if (DEV) console.info("[grab] sent: the sheet would hide"); else leave(); }} />}
      {st.room === "tray" && <Tray bead={bead} say={line} onSend={(it, r) => void fromShelf(it, r)} />}
      <Line say={say} />
      <BeadView onReady={setBead} />
    </div>
  );
}

/** dev only: a desk behind the transparent sheet (a browser window, Sol's window, the notch), so the rooms read; for
 *  Page, the browser shows its made-up long page and a notes window and a folder stand beside it instead of Sol */
function DevDesk({ page }: { page: boolean }) {
  const [sol, notch] = devWindows();
  const [pic] = useState(() => devPicture(sol.w, sol.h));
  const [view] = useState(() => (page ? devPageView() : ""));
  if (page) {
    const [web, notes, folder] = devPageWindows();
    return (
      <div className="dev-desk">
        <div className="dev-bar" />
        <img className="dev-win" src={view} alt="" style={{ left: web.x, top: web.y, width: web.w, height: web.h }} />
        <div className="dev-win dev-web" style={{ left: notes.x, top: notes.y, width: notes.w, height: notes.h }}>
          <div className="dev-tb"><i /><i /><i /><span>Notes</span></div>
          <h4>Groceries</h4><p style={{ width: "40%" }} /><p style={{ width: "55%" }} /><p style={{ width: "30%" }} />
        </div>
        <div className="dev-win dev-web" style={{ left: folder.x, top: folder.y, width: folder.w, height: folder.h }}>
          <div className="dev-tb"><i /><i /><i /><span>Finder</span></div>
          <p /><p style={{ width: "70%" }} />
        </div>
        <div className="dev-notch" style={{ left: notch.x, top: notch.y, width: notch.w, height: notch.h }} />
      </div>
    );
  }
  return (
    <div className="dev-desk">
      <div className="dev-bar" />
      <div className="dev-win dev-web" style={{ left: 80, top: 120, width: 420, height: 600 }}>
        <div className="dev-tb"><i /><i /><i /><span>Safari</span></div>
        <h4>Something else</h4><p /><p /><p style={{ width: "50%" }} /><p />
      </div>
      <img className="dev-win" src={pic} alt="" style={{ left: sol.x, top: sol.y, width: sol.w, height: sol.h }} />
      <div className="dev-notch" style={{ left: notch.x, top: notch.y, width: notch.w, height: notch.h }} />
    </div>
  );
}
