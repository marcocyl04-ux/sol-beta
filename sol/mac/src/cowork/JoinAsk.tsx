// The join card (#327; the groups PRD §9.2): a group's link opened in the app asks first, over whichever mode is in
// front, and switches nothing until "join" is pressed. It hears the app's `sol-url` (and takes the link that launched
// Sol once it listens, src-tauri link.rs), keeps the course in joinlink.ts joinFlow (pure, tested), and talks to the
// engine on the page's one link: team.room.peek for the name, team.room.join { code, hub, name } on the press, which
// is the side's own join asking only the hub that was peeked. Once joined it opens Cowork on the group's page. A Sol
// with no account on that hub (#342, the peek's `signedIn: false`) gets "sign in to Sol first" and a "sign in" that
// opens Settings › me (onSignIn), never the join. The main window only; a pop-out session has none. `?dev=team` (vite
// dev only) answers from useTeam's fakes and hears a page's own `sol-url` event, so the card can be shot in a browser.
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { link } from "../socket";
import { ENGINE } from "../useEngine";
import { joinCodeOf, joinFlow, NOT_CONNECTED, READY_MS, type JoinCard, type JoinEvent } from "./joinlink";
import { DEV_TEAM, fakeAnswer } from "./useTeam";

/** the card: onJoined opens Cowork on the group the engine just went to; onSignIn opens Settings on that drawer */
export function JoinAsk({ onJoined, onSignIn }: { onJoined: () => void; onSignIn: (drawer: string) => void }) {
  const [card, setCard] = useState<JoinCard>({ k: "none" });
  const now = useRef(card);
  const [ready, setReady] = useState(false);   // "join" is off for READY_MS after a code is shown
  const asks = useRef(new Map<string, (m: any) => void>());
  const L = link(ENGINE);
  const joined = useRef(onJoined), signIn = useRef(onSignIn);
  joined.current = onJoined;
  signIn.current = onSignIn;
  const up = () => DEV_TEAM || L.up();   // the dev view has no engine: its fakes always answer

  // one question to the engine, answered by rid; a closed socket answers NOT_CONNECTED at once
  const ask = (type: string, body: object, wait: number) => new Promise<any>((ok) => {
    if (DEV_TEAM) { ok(fakeAnswer(type, body)); return; }
    const rid = crypto.randomUUID();
    asks.current.set(rid, ok);
    if (!L.send({ type, rid, ...body })) { asks.current.delete(rid); ok({ error: NOT_CONNECTED }); return; }
    window.setTimeout(() => { if (asks.current.delete(rid)) ok({ error: "Sol did not answer; try again" }); }, wait);
  });
  // a step of the course, and what it says to send
  const step = (ev: JoinEvent) => {
    const r = joinFlow(now.current, ev);
    now.current = r.card;
    setCard(r.card);
    if (r.settings) signIn.current(r.settings);
    if (r.peek) { const code = r.peek; void ask("team.room.peek", { code }, 15_000).then((a) => step({ e: "peeked", code, ...a, at: Date.now() })); }
    if (r.join) {
      void ask("team.room.join", r.join, 60_000).then((a) => {
        step({ e: "joined", ...(a.room ? {} : { error: a.error ?? "Sol did not find that group; try again" }) });
        if (a.room) joined.current();
      });
    }
  };

  // the engine's answers, and the socket's state on every change
  useEffect(() => {
    const offM = L.on((m) => { if (m?.rid && asks.current.has(m.rid)) { const f = asks.current.get(m.rid)!; asks.current.delete(m.rid); f(m); } });
    const offL = L.onLink((up) => step({ e: "link", up, at: Date.now() }));
    return () => { offM(); offL(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // a held code looks at the socket every second
  useEffect(() => {
    if (card.k !== "holding") return;
    const t = window.setInterval(() => step({ e: "link", up: up(), at: Date.now() }), 1000);
    return () => window.clearInterval(t);
  }, [card.k]); // eslint-disable-line react-hooks/exhaustive-deps
  // "join" waits a moment after each new code is shown
  const shown = card.k === "ask" ? `${card.code} ${card.at}` : "";
  useEffect(() => {
    setReady(false);
    if (!shown) return;
    const t = window.setTimeout(() => setReady(true), READY_MS);
    return () => window.clearTimeout(t);
  }, [shown]);

  // the app's links: sol-url as they come, and the one that launched Sol once this listens
  const heard = (url: unknown) => { const code = joinCodeOf(url); if (code) step({ e: "open", code, up: up(), at: Date.now() }); };
  // ?dev=team: a page's own `sol-url` (a CustomEvent whose detail is the link), as the app's would come
  useEffect(() => {
    if (!DEV_TEAM) return;
    const f = (ev: Event) => heard((ev as CustomEvent).detail);
    window.addEventListener("sol-url", f);
    return () => window.removeEventListener("sol-url", f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window) || getCurrentWindow().label !== "main") return;
    let off: (() => void) | undefined, gone = false;
    // a link heard here is also dropped from the app's keep, so a page that loads again does not ask about it twice
    const drop = () => void import("@tauri-apps/api/core").then(({ invoke }) => invoke("sol_url_take")).catch(() => {});
    void import("@tauri-apps/api/event").then(({ listen }) => listen<string>("sol-url", (ev) => { heard(ev.payload); drop(); }))
      .then((f) => { if (gone) f(); else off = f; })
      // taken only by a page still listening: a mount undone at once (React's strict mode) leaves it for the next
      .then(() => (gone ? [] : import("@tauri-apps/api/core").then(({ invoke }) => invoke<string[]>("sol_url_take"))))
      .then((urls) => { for (const u of urls ?? []) heard(u); }).catch(() => {});
    return () => { gone = true; off?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (card.k === "none") return null;
  const c = card;
  return (
    <div className="joinask" role="status" aria-label="a group's link">
      <div className="gcard"><div className="gface"><div className="gline">
        <span className="from">a link</span>
        {(c.k === "holding" || c.k === "asking") && <span className="t"><b>looking up {c.code}…</b></span>}
        {c.k === "ask" && c.out && <>
          <span className="t"><b>join {c.name}?</b><small>sign in to Sol first</small></span>
          <button className="wbtn" onClick={() => step({ e: "signin" })}>sign in</button>
          <button className="wbtn ghost" onClick={() => step({ e: "dismiss" })}>not now</button>
        </>}
        {((c.k === "ask" && !c.out) || c.k === "joining") && <>
          <span className="t"><b>{c.k === "ask" && c.already ? `open ${c.name}?` : `join ${c.name}?`}</b><small>{c.code}</small></span>
          <button className="wbtn" disabled={c.k === "joining" || !ready} onClick={() => step({ e: "join", at: Date.now() })}>{c.k === "joining" ? "joining…" : c.k === "ask" && c.already ? "open" : "join"}</button>
          <button className="wbtn ghost" disabled={c.k === "joining"} onClick={() => step({ e: "dismiss" })}>not now</button>
        </>}
        {c.k === "said" && <span className="t"><b>{c.why}</b><small>{c.code}</small></span>}
        {c.k !== "ask" && c.k !== "joining" && <button className="gx" onClick={() => step({ e: "dismiss" })} aria-label="close">×</button>}
      </div></div></div>
    </div>
  );
}
