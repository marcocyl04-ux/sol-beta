// A thing opened (#236; the studio PRD §4.5, frames s2 and s4 of vM.html): the real page, inside Sol, in this pane.
// S2 is the room with the thing in its centre: "‹ back to the room · glyph + name · you are in it / X is in it · ⤡
// shrink · work on this · open in browser ↗", the address it is at under it. S4 is a session with the thing beside it,
// the same pane with a shorter head. The page is the shell's child web view (thingView.ts, thing.rs) laid over the body
// this draws; a target=_blank on the thing's site comes back as a tab here, anything off the site is refused and named.
// While the page is in front (shown, uncovered, the window focused) the face tells the engine, again every few minutes,
// so my worker stands on the tile for everyone (here.ts); behind, it says so once.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Team } from "./useTeam";
import type { Thing } from "./useRoom";
import { Glyph } from "./Room";
import { Who } from "./bits";
import { openUrl, rectOf } from "./util";
import { FOCUS_AGAIN_MS, focusMsg, inShell, nextTab, onShell, originOf, shell, tabOf, useCovered, type Box } from "./thingView";

type Tab = { tab: string; url: string };
export type InIt = { who: string; working: boolean };

const same = (a: Box | null, b: Box) => !!a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export function ThingPane({ team, thing, mode, me, others, onBack, onShrink, onWork, onPutAway }: {
  team: Team; thing: Thing; mode: "s2" | "s4"; me: { working: boolean }; others: InIt[];
  onBack?: () => void; onShrink?: () => void; onWork?: () => void; onPutAway?: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [tabs, setTabs] = useState<Tab[]>([{ tab: tabOf(thing.id, 1), url: thing.url }]);
  const [active, setActive] = useState(tabOf(thing.id, 1));
  const [note, setNote] = useState<{ line: string; id?: number } | null>(null);
  const [opened, setOpened] = useState(false);
  const covered = useCovered();
  const [winFocus, setWinFocus] = useState(() => typeof document === "undefined" || document.hasFocus());
  const shown = opened && !covered;
  const front = shown && winFocus;
  const last = useRef<Box | null>(null);
  const live = useRef({ tabs, active, thing, covered });
  live.current = { tabs, active, thing, covered };

  // the first tab opens when the pane has its place; leaving the pane hides the page, kept as it was (back closes it)
  useLayoutEffect(() => {
    if (!inShell() || !body.current) return;
    const b = rectOf(body.current); last.current = b;
    let gone = false;
    shell.open(tabOf(thing.id, 1), thing.url, thing.url, b, !live.current.covered).then(() => { if (!gone) setOpened(true); })
      .catch((e) => { if (!gone) setNote({ line: `this page could not open here: ${String(e)}` }); });
    // the extra tabs go with the pane; the thing's own page stays, hidden, for the tile or the session to bring back
    return () => { gone = true; void shell.show("").catch(() => {}); for (const t of live.current.tabs.slice(1)) void shell.close(t.tab).catch(() => {}); };
  }, [thing.id, thing.url]);

  // the pane moves (the side docks, the window resizes, the column changes): the page follows it
  useEffect(() => {
    if (!inShell() || !opened) return;
    const follow = () => { const el = body.current; if (!el) return; const b = rectOf(el); if (!same(last.current, b)) { last.current = b; void shell.bounds(b).catch(() => {}); } };
    const ro = new ResizeObserver(follow);
    if (body.current) ro.observe(body.current);
    window.addEventListener("resize", follow);
    const t = window.setInterval(follow, 300);   // a move with no resize (a column sliding) is seen within a beat
    return () => { ro.disconnect(); window.removeEventListener("resize", follow); window.clearInterval(t); };
  }, [opened]);

  // shown or stepped aside: only the active tab is ever on screen
  useEffect(() => { if (inShell() && opened) void shell.show(shown ? active : "").catch(() => {}); }, [shown, active, opened]);

  // what the shell says about this thing's tabs
  useEffect(() => {
    let off = () => {}, gone = false;
    void onShell((n) => {
      const { tabs: ts, thing: th } = live.current;
      // settings cleared Sol's browser: every page closed; this one opens again, fresh
      if (n.cleared) {
        const b = body.current ? rectOf(body.current) : last.current;
        setTabs([{ tab: tabOf(th.id, 1), url: th.url }]); setActive(tabOf(th.id, 1));
        if (b) void shell.open(tabOf(th.id, 1), th.url, th.url, b, !live.current.covered).catch(() => {});
        return;
      }
      if (!ts.some((t) => t.tab === n.tab)) return;
      if (n.url) setTabs((xs) => xs.map((t) => (t.tab === n.tab ? { ...t, url: n.url! } : t)));
      else if (n.refused) setNote({ line: `kept out of this pane: ${originOf(n.refused)}`, id: n.id });
      else if (n.outside) setNote({ line: `a link to ${originOf(n.outside)}, off this thing's site`, id: n.id });
      else if (n.download) setNote({ line: "a download was refused here", id: n.id });
      else if (n.open) {
        const tab = tabOf(th.id, nextTab());
        const b = body.current ? rectOf(body.current) : last.current;
        if (!b) return;
        void shell.open(tab, "", th.url, b, !live.current.covered, n.id).then(() => { setTabs((xs) => [...xs, { tab, url: n.open! }]); setActive(tab); })
          .catch((e) => setNote({ line: `that tab did not open: ${String(e)}`, id: n.id }));
      }
    }).then((f) => { if (gone) f(); else off = f; });   // unmounted before the listener came: let it go at once
    return () => { gone = true; off(); };
  }, []);

  // the window's own focus (a click into the page moves the keyboard, never the window's focus)
  useEffect(() => {
    if (!inShell()) return;
    let off = () => {}, gone = false;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      const f = await w.onFocusChanged(({ payload }) => setWinFocus(payload));
      if (gone) { f(); return; }
      off = f;
      setWinFocus(await w.isFocused().catch(() => true));
    });
    const vis = () => { if (document.visibilityState === "hidden") setWinFocus(false); else setWinFocus(document.hasFocus()); };
    document.addEventListener("visibilitychange", vis);
    return () => { gone = true; off(); document.removeEventListener("visibilitychange", vis); };
  }, []);

  // in front: the engine hears it now and again every few minutes; behind (or gone): once
  const say = useCallback((on: boolean) => { void team.ask("team.thing.focus", focusMsg(thing.id, on)).catch(() => {}); }, [team.ask, thing.id]);
  useEffect(() => {
    if (!front) return;
    say(true);
    const t = window.setInterval(() => say(true), FOCUS_AGAIN_MS);
    return () => { window.clearInterval(t); say(false); };
  }, [front, say]);

  const closeTab = (tab: string) => {
    void shell.close(tab).catch(() => {});
    const rest = tabs.filter((t) => t.tab !== tab);
    setTabs(rest);
    if (active === tab) setActive(rest[rest.length - 1]?.tab ?? tabOf(thing.id, 1));
  };
  const closeAll = () => { for (const t of tabs) void shell.close(t.tab).catch(() => {}); };
  const back = () => { closeAll(); onBack?.(); };
  const at = tabs.find((t) => t.tab === active) ?? tabs[0];
  const origin = originOf(at?.url ?? thing.url);
  const who = front ? "you are in it" : others[0] ? `${others[0].who}${others.length > 1 ? ` and ${others.length - 1} more` : ""} ${others.length > 1 ? "are" : "is"} in it` : "";

  return (
    <section className={`rm-thing ${mode}`} aria-label={`${thing.name}, open`}>
      <div className="rm-th-head">
        {mode === "s2" && <button className="rm-th-link" onClick={back} title="close the page and go back to the room's things">‹ back to the room</button>}
        <span className="rm-th-name"><Glyph kind={thing.kind} size={20} /><b>{thing.name}</b></span>
        {who && <span className="rm-th-in">{front ? <Who login={team.me} size={20} working={me.working} /> : <Who login={others[0].who} size={20} working={others[0].working} />}{who}</span>}
        <span className="rm-th-sp" />
        {mode === "s2" && <button className="rm-th-link" onClick={onShrink} title="back to the room's things; the page stays as it is, a click on its tile brings it back">⤡ shrink</button>}
        {mode === "s2" && <button className="wbtn" onClick={onWork} title="start a session with this thing beside it">work on this</button>}
        {mode === "s4" && <button className="rm-th-link" onClick={() => { closeAll(); onPutAway?.(); }} title="take the thing away from beside the session">put it away</button>}
        <button className="rm-th-link" onClick={() => (inShell() && opened ? void shell.outside({ tab: active }).catch(() => openUrl(thing.url)) : openUrl(thing.url))} title="open this page in your own browser">open in browser ↗</button>
      </div>
      <div className="rm-th-where">
        <span className="rm-th-origin" title={at?.url ?? thing.url}><i aria-hidden="true" />{origin || "about:blank"}</span>
        {tabs.length > 1 && (
          <span className="rm-th-tabs" role="tablist" aria-label="tabs of this thing">
            {tabs.map((t, i) => (
              <span key={t.tab} className={`rm-th-tab ${t.tab === active ? "on" : ""}`}>
                <button role="tab" aria-selected={t.tab === active} onClick={() => setActive(t.tab)} title={t.url}>{i === 0 ? "the thing" : originOf(t.url)}</button>
                {i > 0 && <button className="x" aria-label="close this tab" onClick={() => closeTab(t.tab)}>×</button>}
              </span>
            ))}
          </span>
        )}
        {note && <span className="rm-th-note" role="status">{note.line}{note.id && <button className="rm-th-link" onClick={() => { void shell.outside({ id: note.id! }).catch(() => {}); setNote(null); }}>open in browser ↗</button>}
          <button className="rm-th-link" aria-label="dismiss" onClick={() => setNote(null)}>×</button></span>}
        <span className="rm-th-sp" />
        {inShell() && <button className="rm-th-link" onClick={() => void shell.reload(active).catch(() => {})} title="load the page again">↻</button>}
      </div>
      <div className="rm-th-body" ref={body}>
        {!inShell() && (
          <div className="rm-th-stand">
            <Glyph kind={thing.kind} size={40} />
            <p><b>{thing.name}</b> opens here as the real page, in Sol's own browser on this Mac.</p>
            <p className="dim">this is a stand-in: outside the app there is no page to show</p>
          </div>
        )}
        {inShell() && !opened && !note && <p className="rm-th-wait">opening {origin}…</p>}
      </div>
    </section>
  );
}
