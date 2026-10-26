// No GitHub yet (ADDITIONS §4c, #252): the card in a new GitHub room's form, and the pane its sign-up opens in. The
// flow and its rules are ghJoin.ts (tested there with a fake web view); this draws it. The card is only for a GitHub
// room on a machine whose gh is not signed in (cardFor): a cloud or Drive room's form never draws it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Team } from "./useTeam";
import { DEV_TEAM } from "./useTeam";
import { link } from "../socket";
import { ENGINE } from "../useEngine";
import { coveredBy, inShell, onShell, originOf, shell, useCover, useCoveredBy, type Box } from "./thingView";
import { cardFor, JoinFlow, JOIN_TAB, type Step } from "./ghJoin";
import "./ghjoin.css";

const openUrl = (url: string) => {
  if (DEV_TEAM) return;   // the dev view opens nothing
  import("@tauri-apps/plugin-opener").then((o) => o.openUrl(url)).catch(() => window.open(url, "_blank", "noopener"));
};
const rectOf = (el: HTMLElement): Box => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };

/** GitHub on this machine: signed in or not; null while it is read */
function useGithub(team: Team, on: boolean): [{ in: boolean; who?: string } | null, () => void] {
  const [gh, setGh] = useState<{ in: boolean; who?: string } | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    let live = true;
    void team.ask<{ github?: { in: boolean; who?: string } }>("team.accounts", {}, 30_000).then((a) => { if (live) setGh(a?.github ?? { in: false }); });
    return () => { live = false; };
  }, [team.ask, on, n]);
  return [gh, () => setN((x) => x + 1)];
}

export function GithubJoin({ team, keeps, onPane }: { team: Team; keeps: string; onPane?: (up: boolean) => void }) {
  const [gh, again] = useGithub(team, keeps === "github");
  const [step, setStep] = useState<Step>({ k: "ask" });
  const [said, setSaid] = useState("");
  const [copied, setCopied] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState<{ line: string; id?: number } | null>(null);   // what the pane kept out, said in its bar
  const pane = useRef<HTMLDivElement | null>(null);
  const flow = useRef<JoinFlow | null>(null);
  if (!flow.current) flow.current = new JoinFlow({
    open: async (url, site) => {
      if (!inShell()) throw new Error("no web view outside the app");
      // the pane is drawn by the render this step causes: wait for it, a few frames at most
      for (let i = 0; i < 30 && !pane.current; i++) await new Promise((ok) => requestAnimationFrame(() => ok(null)));
      const el = pane.current;
      if (!el) throw new Error("no pane");
      await shell.open(JOIN_TAB, url, site, rectOf(el), !coveredBy(["join", "side"]));   // a menu already over it: opened hidden
    },
    go: (url) => shell.home(JOIN_TAB, url),
    close: () => (inShell() ? shell.close(JOIN_TAB) : Promise.resolve()),
    connect: () => team.ask<{ code?: string; url?: string; error?: string }>("team.github.connect", {}, 30_000)
      .then((r) => (DEV_TEAM && !r?.code ? { code: "ABCD-1234", url: "https://github.com/login/device" } : r)),
    cancel: () => { void team.ask("team.github.connect.cancel", {}, 5_000); },
    browser: openUrl,
    set: (s) => { setStep(s); if (s.k !== "ask") setSaid(""); if (s.k !== "signup" && !(s.k === "device" && s.inside)) setNote(null); },
    say: setSaid,
  });
  const f = flow.current;

  // gh says it is in, or why not, to every window (#176's two messages)
  useEffect(() => link(ENGINE)?.on((m) => {
    if (m?.type === "team.github.connected") { f.connected(String(m.login ?? "")); again(); }
    else if (m?.type === "team.github.connect.failed") f.failed(String(m.error ?? "GitHub did not let it in"));
  }), [f]); // eslint-disable-line react-hooks/exhaustive-deps
  // the web view: its finished loads and its refusals, nothing else (origin and path only)
  useEffect(() => {
    let off = () => {}, gone = false;
    void onShell((n) => {
      if (n.cleared) { if (f.s.k === "signup" || (f.s.k === "device" && f.s.inside)) f.stop(); return; }
      if (n.tab !== JOIN_TAB) return;
      if (n.url) { setAddress(n.url); void f.loaded(n.url, n.load === "finished"); }
      // kept out of the pane: said in its bar, with the browser on a press; the sign-up goes on as it can
      else if (n.refused) setNote({ line: `kept out of this pane: ${originOf(n.refused)}`, id: n.id });
      else if (n.outside || n.open) setNote({ line: `a link to ${originOf((n.outside || n.open)!)}`, id: n.id });
      else if (n.download) setNote({ line: "a download was refused here", id: n.id });
    }).then((x) => { if (gone) x(); else off = x; });
    return () => { gone = true; off(); };
  }, [f]);
  // leaving the form: whatever runs stops
  useEffect(() => () => { if (f.s.k !== "ask" && f.s.k !== "in") f.stop(); }, [f]);
  useEffect(() => { if (keeps !== "github" && f.s.k !== "ask" && f.s.k !== "in") f.stop(); }, [keeps, f]);
  useEffect(() => { if (!copied) return; const t = window.setTimeout(() => setCopied(""), 2500); return () => window.clearTimeout(t); }, [copied]);

  const inPane = step.k === "signup" || (step.k === "device" && step.inside);
  useEffect(() => { onPane?.(inPane); return () => onPane?.(false); }, [inPane]); // eslint-disable-line react-hooks/exhaustive-deps
  if (step.k === "in") return <p className="cgh-in">GitHub: <b>{step.login || "signed in"}</b></p>;
  if (!cardFor(keeps, gh)) return null;
  const copy = (code: string) => void navigator.clipboard?.writeText(code).then(() => setCopied("copied"), () => setCopied("select it and copy"));

  return (
    <div className="cgh" role="group" aria-label="GitHub for this room">
      {step.k === "ask" && <>
        <p className="cgh-lead">Cowork keeps your things in GitHub.</p>
        <div className="cgh-picks">
          <button className="wbtn" onClick={() => void f.have()}>I have GitHub</button>
          <button className="wbtn cgh-make" onClick={() => void f.signup()}>No, make one with Google <small>(about 1 minute)</small></button>
        </div>
        <p className="cgh-note">Your GitHub name is the name your teammates see.</p>
      </>}
      {step.k === "have" && <p className="cgh-note">asking GitHub for a code…</p>}
      {step.k === "signup" && <>
        <p className="cgh-lead">Make your account in the page beside →</p>
        <p className="cgh-note">Sol signs you in by itself once GitHub shows your account.</p>
        <div className="cgh-acts">
          <button className="wlink" onClick={() => void f.device(true)}>made it, sign me in</button>
          <button className="wlink" onClick={() => f.stop()}>not now</button>
        </div>
      </>}
      {step.k === "browser" && <>
        <p className="cgh-out" role="status">{step.why}</p>
        <div className="cgh-acts">
          <button className="wbtn" onClick={() => void f.device(false)}>made it, sign me in</button>
          <button className="wlink" onClick={() => openUrl("https://github.com/signup")}>open GitHub's sign-up ↗</button>
          <button className="wlink" onClick={() => f.stop()}>not now</button>
        </div>
      </>}
      {step.k === "device" && <>
        <div className="cgh-row"><span className="cgh-n">1</span><div className="cgh-step"><span>copy this code</span>
          <span className="cgh-codeline"><span className="cgh-code">{step.code}</span>
          <button className="wlink" onClick={() => copy(step.code)}>{copied || "copy"}</button></span></div></div>
        <div className="cgh-row"><span className="cgh-n">2</span><div className="cgh-step">
          {step.inside ? <span>paste it in the page beside, then press Authorize</span>
            : <><span>paste it on GitHub's page</span><button className="wbtn" onClick={() => openUrl(step.url)}>open github.com</button></>}</div></div>
        <div className="cgh-acts"><span className="cgh-note">waiting for GitHub…</span><button className="wlink" onClick={() => f.stop()}>cancel</button></div>
      </>}
      {said && <p className="cgh-said" role="status">{said}</p>}
      {inPane && <JoinPane paneRef={pane} address={address} note={note} onNote={setNote} onOut={() => f.out(true)} onClose={() => f.stop()} device={step.k === "device"} code={step.k === "device" ? step.code : ""} />}
    </div>
  );
}

// The sign-up's own pane, over the room's centre (the form sits in the narrow side): a bar with where the page is and
// the way out, and the body the shell lays the web view over. While it is up, a thing's page steps aside (useCover).
function JoinPane({ paneRef, address, note, onNote, device, code, onOut, onClose }: {
  paneRef: React.MutableRefObject<HTMLDivElement | null>; address: string; note: { line: string; id?: number } | null; onNote: (n: null) => void;
  device: boolean; code: string; onOut: () => void; onClose: () => void;
}) {
  useCover(true, "join");
  // anything else of the face drawn over the centre (a menu, the mode wheel): the page steps aside for it too
  const under = useCoveredBy(["join", "side"]);
  useEffect(() => { if (inShell()) void shell.only(JOIN_TAB, !under).catch(() => {}); }, [under]);
  const [left, setLeft] = useState(0);
  const anchor = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const side = anchor.current?.closest("aside");
    const place = () => setLeft(Math.round(side?.getBoundingClientRect().right ?? 0));
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);
  // the page follows its pane
  useEffect(() => {
    if (!inShell()) return;
    let last = "";
    const follow = () => { const el = paneRef.current; if (!el) return; const b = rectOf(el); const k = `${b.x},${b.y},${b.w},${b.h}`; if (k !== last) { last = k; void shell.bounds(b, JOIN_TAB).catch(() => {}); } };
    const t = window.setInterval(follow, 300);
    window.addEventListener("resize", follow);
    return () => { window.clearInterval(t); window.removeEventListener("resize", follow); };
  }, [paneRef]);
  return (<>
    <span ref={anchor} hidden />
    {createPortal(
      <section className="cgh-pane" style={{ left: left + 12 }} aria-label="make a GitHub account">
        <div className="cgh-pane-h">
          <b>{device ? "sign Sol in to GitHub" : "make your GitHub account"}</b>
          {code && <span className="cgh-code" title="paste it in the page">{code}</span>}
          <span className="cgh-origin">{originOf(address) || "github.com"}</span>
          {note && <span className="cgh-origin" role="status">{note.line}{note.id && <button className="wlink" onClick={() => { void shell.outside({ id: note.id! }).catch(() => {}); onNote(null); }}>open in browser ↗</button>}</span>}
          <span className="cgh-sp" />
          <button className="wlink" onClick={onOut} title="the same page in your own browser">use my browser instead ↗</button>
          <button className="wlink" onClick={onClose}>close</button>
        </div>
        <div className="cgh-pane-b" ref={paneRef}>
          {!inShell() && <p className="cgh-stand">GitHub's sign-up opens here, in Sol's own browser on this Mac. Outside the app there is no page to show.</p>}
        </div>
      </section>, document.body)}
  </>);
}
