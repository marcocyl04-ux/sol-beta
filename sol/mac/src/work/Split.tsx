import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { composing } from "../ime";
import { CFG, enter, follow, type Follow } from "../motion";
import { Orb } from "../Orb";
import { scoped, working as isWorking, type Work } from "./useWork";
import { WorkTalk } from "./WorkTalk";
import type { TalkView } from "./WorkSteps";

// A second session beside the open one (⌘-click a row, or "open beside"): its talk, following its end, and a small box
// of its own. Its questions are answered for it, not for the open one. Swap makes it the open one.
export function Beside({ w, id, view, up, onClose, onSwap, onLink }: {
  w: Work; id: string; view: TalkView; up: boolean; onClose: () => void; onSwap: () => void; onLink: (ev: React.MouseEvent, at?: string) => void;
}) {
  const sw = scoped(w, id);
  const items = sw.thread?.items ?? [];
  const busy = !!sw.run?.busy;            // its main thread streams
  const working = isWorking(sw.run);      // or its background agents still work: escape stops them too (#45)
  const title = w.sessions.find((s) => s.id === id)?.title ?? sw.thread?.title ?? "";
  const [draft, setDraft] = useState("");
  useEffect(() => { if (up) w.peek(id); }, [id, up]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => w.unpeek(id), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const talk = useRef<HTMLDivElement>(null), page = useRef<HTMLDivElement>(null);
  const stick = useRef<Follow | null>(null);
  const [flw, setFlw] = useState<Follow | null>(null);   // the same follow, for the orb to draw
  const has = items.length > 0;
  useEffect(() => {
    const t = talk.current, inner = t?.querySelector(".talk-inner") as HTMLElement | null;
    if (!t || !inner) return;
    const f = (stick.current = follow(t, inner));
    setFlw(f);
    f.jump();
    return () => { f.destroy(); stick.current = null; setFlw(null); };
  }, [id, has]);
  useLayoutEffect(() => { if (page.current) enter(page.current, { x: 28, cfg: CFG.panel }); }, [id]);

  const send = () => { if (sw.say(draft)) { setDraft(""); stick.current?.glide(); } };
  return (
    <div ref={page} className="wbeside">
      <div className="wbhead">
        <span className="tt" title={title}>{title || "untitled"}</span>
        <button className="wlink" onClick={onSwap} title="make it the open session">swap</button>
        <button className="wlink" onClick={onClose} aria-label="close the session beside">×</button>
      </div>
      <div className="talk-wrap">
        <div className="talk" ref={talk}>
          {has ? <div className="talk-inner"><WorkTalk items={items} busy={busy} w={sw} view={view} onFresh={() => {}} onLink={(ev) => onLink(ev, sw.thread?.cwd ?? w.sessions.find((s) => s.id === id)?.cwd)} /></div>
            : <p className="wpempty">reading the session…</p>}
        </div>
        <Orb f={flw} />
      </div>
      <div className="wbbox">
        <textarea rows={1} value={draft} placeholder={working ? "it is working; this goes in next" : "say something to this one"} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !composing(e)) { e.preventDefault(); send(); } else if (e.key === "Escape" && working) { e.preventDefault(); e.stopPropagation(); sw.stop(); } }} />
      </div>
    </div>
  );
}

// a session in a window of its own: Sol's page with ?work=<id> (App opens Work on that one session, no side)
export async function popOut(id: string, title: string): Promise<boolean> {
  const hot = location.origin.startsWith("http://localhost");
  const url = hot ? `${location.origin}${location.pathname}?work=${id}` : `index.html?work=${id}`;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { LogicalPosition } = await import("@tauri-apps/api/dpi");
    if (!(window as any).__TAURI_INTERNALS__) throw new Error("not in Sol.app");
    const label = `work-${id.slice(0, 8)}`;
    const old = await WebviewWindow.getByLabel(label);
    if (old) { await old.setFocus(); return true; }
    const win = new WebviewWindow(label, {
      url, title: title || "Sol", width: 760, height: 720, minWidth: 420, minHeight: 360,
      titleBarStyle: "overlay", hiddenTitle: true, trafficLightPosition: new LogicalPosition(16, 24), dragDropEnabled: false,
    });
    return await new Promise<boolean>((ok) => { void win.once("tauri://created", () => ok(true)); void win.once("tauri://error", () => ok(false)); });
  } catch {
    return !!window.open(url, `work-${id.slice(0, 8)}`, "width=760,height=720");
  }
}
