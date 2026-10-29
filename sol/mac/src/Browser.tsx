import { useLayoutEffect, useState } from "react";
import type { Frame, Tab } from "./useEngine";
import { Screencast } from "./Screencast";

// The browser pane: one row above the page (the conversation's tabs, a new one, back, forward, reload and the
// address), and the page itself, live, drawn by Screencast. Option-drag (or Work's cmd+shift+S) marks an area of
// the page for Sol: the crop goes into the box as an image with a line naming the page.
type Mark = { name: string; mime: string; dataBase64: string; thumb: string; note: string };

const url = (v: string) => { const t = v.trim(); return !t ? "" : /^[a-z]+:\/\//i.test(t) ? t : "https://" + t; };
// An address as the field shows it: the host, then the rest dimmed.
const split = (u: string): { host: string; rest: string } => {
  try {
    const x = new URL(u);
    const rest = (x.pathname === "/" ? "" : x.pathname) + x.search + x.hash;
    return { host: x.host.replace(/^www\./, ""), rest };
  } catch { return { host: u, rest: "" }; }
};

// The grip on a pane's left edge: dragging it sets the pane's share of the shell (its right edge stays where it
// is, so the panes to its right do not move). Shared with the desk.
export const gripResize = (frac: number, onFrac: (f: number) => void, maxFrac: number) => (ev: React.PointerEvent<HTMLDivElement>) => {
  ev.currentTarget.setPointerCapture(ev.pointerId);
  const pane = ev.currentTarget.parentElement!.getBoundingClientRect();
  const shell = ev.currentTarget.parentElement!.closest(".shell")!.getBoundingClientRect();
  const mv = (e: PointerEvent) => onFrac(Math.min(maxFrac, Math.max(0.2, (pane.right - e.clientX) / shell.width)));
  const end = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", end); };
  window.addEventListener("pointermove", mv); window.addEventListener("pointerup", end);
  void frac;
};

export function Browser({ tabs, sessionId, send, subscribe, onMark, frac, onFrac, maxFrac, armed, onArmed }: {
  tabs: Tab[]; sessionId?: string;
  send: (o: object) => void; subscribe: (fn: (f: Frame) => void) => () => void;
  onMark: (m: Mark) => void;
  frac: number; onFrac: (f: number) => void; maxFrac: number; // the pane's share of the shell, kept by App (panes tile)
  armed?: boolean; onArmed?: (v: boolean) => void;   // Work's cmd+shift+S: the next plain drag marks, then it disarms
}) {
  const mine = tabs.filter((t) => t.sessionId === sessionId);
  const [picked, setPicked] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const [addr, setAddr] = useState("");
  const [fresh, setFresh] = useState("");
  const [loading, setLoading] = useState(false);
  const active = mine.find((t) => t.id === picked) ?? mine.find((t) => t.active) ?? mine[0];
  const activeId = active?.id;

  // a new address means a page on its way: the thin line runs until the next frame
  useLayoutEffect(() => { setAddr(active?.url ?? ""); setLoading(!!activeId); }, [active?.url, activeId]);

  const resize = gripResize(frac, onFrac, maxFrac);

  const choose = (id: string) => { setPicked(id); setAdding(false); send({ type: "browser.select", tab: id }); };
  const nav = (action: "back" | "forward" | "reload") => { if (activeId) { setLoading(true); send({ type: "browser.navigate", tab: activeId, action }); } };
  const go = (u: string) => { if (activeId && url(u)) { setLoading(true); send({ type: "browser.navigate", tab: activeId, action: { url: url(u) } }); } };
  const openNew = () => { setAdding(true); setFresh(""); };
  const shownAddr = split(active?.url ?? "");

  return (
    <section className="pane" style={{ width: `${frac * 100}%` }}>
      <div className="grip" onPointerDown={resize} />
      <div className="tabs">
        <div className="strip">
          {mine.map((t) => (
            <div key={t.id} className={`tab ${!adding && t.id === activeId ? "on" : ""}`} onClick={() => choose(t.id)} title={t.url}>
              <i className="site" />
              <span>{t.title || split(t.url).host || "new tab"}</span>
              <button onClick={(e) => { e.stopPropagation(); send({ type: "browser.close", tab: t.id }); }} title="close">×</button>
            </div>
          ))}
        </div>
        <button className="plus" onClick={openNew} title="new tab">+</button>
        <div className="addr">
          {adding ? (
            <>
              <button onClick={() => setAdding(false)} title="cancel">×</button>
              <div className="field">
                <input autoFocus value={fresh} placeholder="address" spellCheck={false} onChange={(e) => setFresh(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && url(fresh)) { send({ type: "browser.open", url: url(fresh), sessionId }); setAdding(false); }
                    else if (e.key === "Escape") setAdding(false);
                  }} />
              </div>
            </>
          ) : (
            <>
              <button onClick={() => nav("back")} title="back" disabled={!active}>‹</button>
              <button onClick={() => nav("forward")} title="forward" disabled={!active}>›</button>
              <button onClick={() => nav("reload")} title="reload" disabled={!active}>↻</button>
              <div className={`field ${active ? "" : "off"}`}>
                <input value={addr} spellCheck={false} placeholder={active ? "" : "no tab"} disabled={!active}
                  onChange={(e) => setAddr(e.target.value)}
                  onBlur={() => setAddr(active?.url ?? "")}
                  onKeyDown={(e) => { if (e.key === "Enter") { go(addr); e.currentTarget.blur(); } else if (e.key === "Escape") e.currentTarget.blur(); }} />
                {active && <span className="url" aria-hidden="true"><b>{shownAddr.host}</b><span>{shownAddr.rest}</span></span>}
                {loading && active && <i className="loading" />}
              </div>
            </>
          )}
        </div>
      </div>
      <Screencast tab={activeId} send={send} subscribe={subscribe} hold={(ev) => ev.altKey || !!armed} marking={armed}
        onFrame={() => setLoading(false)}
        onMark={({ data }) => {
          onMark({ name: "page-mark.png", mime: "image/png", dataBase64: data.split(",")[1], thumb: data, note: `Marco marked this area of the page: ${active?.url ?? ""}` });
          onArmed?.(false);
        }}
        blank={active ? undefined : <>
          <span>no tabs in this conversation</span>
          <button onClick={openNew} title="new tab">+</button>
          <small>on a page, option-drag marks an area for Sol</small>
        </>} />
    </section>
  );
}
