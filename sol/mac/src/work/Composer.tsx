import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { composing } from "../ime";
import type { FileOut, Seat } from "../useEngine";
import type { useEngine } from "../useEngine";
import { EngineBack } from "../EngineBack";
import { Picker } from "../Picker";
import { prettyModel } from "../models";
import { Aurora } from "../creature/indicators";
import { CFG, enter, reducedMotion, useSpring } from "../motion";
import { startRecording, type Recorder } from "../voice";
import { AsideCard } from "./Cards";
import { Menu, type MenuItem } from "./Menu";
import { LeashWheel } from "./LeashWheel";
import type { Mode, Work } from "./useWork";
import { HELD } from "./WorkSidebar";
import { StableLine } from "../cowork/StableLine";   // Ship (#33): a new stable is out, over the composer
import { FileLine } from "../FileLine";               // File it (#119): the field and the receipt, over the composer

// Work's box: the words, and around them what Claude Code's composer has. + opens attach / mention / command; @
// lists the folder's files as you type, / the session's commands and skills; under the box the model, effort, the
// mode (the permission pick; cmd+shift+M) and the folder a new session starts in. Which engine runs Work moved to the
// overview pane (2026-10-15). Dictation is Life's, the same recorder.
export type Att = FileOut & { thumb?: string };
const readFile = (f: File): Promise<Att> => new Promise((ok) => {
  const r = new FileReader();
  r.onload = () => {
    const url = String(r.result);
    ok({ name: f.name || "pasted", mime: f.type || "application/octet-stream", dataBase64: url.split(",")[1] ?? "", thumb: f.type.startsWith("image/") ? url : undefined });
  };
  r.readAsDataURL(f);
});

type Pop = { kind: "at" | "slash"; q: string; start: number; end: number };
type Hit = { key: string; label: string; dim?: string; put: string };

// the same five as Claude Code's app, in its order and words (Marco, 2026-10-15); 1–5 pick in the menu
export const MODES: { m: Mode; label: string; note: string; risky?: string }[] = [
  { m: "auto", label: "Auto", note: "Claude handles permission decisions" },
  { m: "default", label: "Manual", note: "Always ask before making changes" },
  { m: "acceptEdits", label: "Accept edits", note: "Automatically accept all file edits" },
  { m: "plan", label: "Plan", note: "Create a plan before making changes" },
  { m: "bypassPermissions", label: "Bypass permissions", note: "Accepts all permissions", risky: "everything runs unasked" },
];
const BUILTIN = ["compact", "context", "cost", "init", "review", "security-review"];
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || "~";
// commands Sol answers itself (the SDK's session runs none of these)
const LOCAL: Record<string, string> = { btw: "ask on the side", clear: "a fresh talk, same folder", resume: "an older session", fork: "a copy of this talk" };
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const knownCommands = (): string[] => { try { return JSON.parse(localStorage.getItem("sol.work.commands") ?? "null") ?? BUILTIN; } catch { return BUILTIN; } };

export type Draft = { text: string; atts: Att[] };
export function Composer({ w, e, busy, working, cwd, asideOn, setAsideOn, box, onSent, onRec, d, setD, cowork, toChat, switchTo }: {
  w: Work; e: ReturnType<typeof useEngine>; busy: boolean; working?: boolean; cwd?: string; asideOn: boolean; setAsideOn: (v: boolean) => void;
  box: React.RefObject<HTMLTextAreaElement | null>; onSent: () => void; onRec: (on: boolean) => void;
  d: Draft; setD: React.Dispatch<React.SetStateAction<Draft>>;   // kept by WorkApp: the words outlive a trip to Settings
  cowork?: boolean;   // Cowork's session: file it labels it cowork
  toChat?: (s: Seat, m?: string) => void;   // Home: a session runs on Claude Code; picking Codex in a new one opens a GPT talk (#141, #182)
  switchTo?: (s: Seat, m?: string) => void; // the same pick in a running session: a GPT talk carries it on in its folder (#182)
}) {
  const draft = d.text, atts = d.atts;
  const held = w.live ? w.sessions.find((s) => s.id === w.live)?.held : undefined;
  const [forking, setForking] = useState(false);
  const forkFrom = useRef<string | null>(null);
  // the words stay in the box until the fork opens (they went with it); a failed fork leaves them there
  useEffect(() => {
    if (forkFrom.current && w.live !== forkFrom.current) { setDraft(""); setAtts([]); requestAnimationFrame(grow); }
    forkFrom.current = null; setForking(false);
  }, [w.live, w.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const copyOut = async () => {
    try { await navigator.clipboard.writeText(draft); e.flash("copied: paste it in " + HELD[held!.who]); } catch { e.flash("could not copy"); }
  };
  const forkHere = () => {
    if (!w.live) return;
    setForking(true);
    forkFrom.current = w.live;
    w.forkHere(w.live, draft, atts);
  };
  const setDraft = (v: string | ((s: string) => string)) => setD((x) => ({ ...x, text: typeof v === "function" ? v(x.text) : v }));
  const setAtts = (v: Att[] | ((a: Att[]) => Att[])) => setD((x) => ({ ...x, atts: typeof v === "function" ? v(x.atts) : v }));
  const [, setBoxFocus] = useState(false);   // the box knows its focus (the engine asks); its look is CSS :focus-within since sitting 2
  const [pop, setPop] = useState<Pop | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitsFor, setHitsFor] = useState("");   // the query the hits answer: older ones show, but Enter waits
  const [sel, setSel] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [drop, setDrop] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // the box grows on a spring; sending presses it down and lets it come back past rest
  const boxH = useSpring(0, CFG.grow, (v) => { if (box.current) box.current.style.height = `${v}px`; });
  const grow = () => {
    const t = box.current;
    if (!t) return;
    const prev = boxH.v || t.offsetHeight;
    t.style.height = "auto";
    const nat = Math.min(240, t.scrollHeight);
    t.style.overflowY = nat >= 240 ? "auto" : "hidden";
    t.style.height = `${prev}px`;
    if (!boxH.v || reducedMotion()) boxH.set(nat); else boxH.to(nat);
  };
  // words put in from outside (a brief from Life, a review remark) grow the box too; typing grows it in onChange
  useEffect(() => { if (document.activeElement !== box.current) requestAnimationFrame(grow); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const askBox = useRef<HTMLDivElement>(null);
  const sendP = useSpring(0, CFG.pop, (v) => { const el = askBox.current; if (el) el.style.scale = v === 0 ? "" : `${1 - 0.012 * v} ${1 - 0.075 * v}`; });
  const attach = async (fs: File[]) => { const got = await Promise.all(fs.map(readFile)); setAtts((a) => [...a, ...got]); };
  const attachRef = useRef(attach);
  attachRef.current = attach;

  const send = () => {
    // an aside (cmd+; or /btw): asked on the side, the session's task untouched
    const btw = /^\/btw\s+/i.exec(draft);
    if (asideOn || btw) {
      if (!w.live) { e.flash("an aside needs an open session"); return; }
      if (w.aside(btw ? draft.slice(btw[0].length) : draft.trim())) { setDraft(""); setAsideOn(false); setPop(null); requestAnimationFrame(grow); }
      return;
    }
    // a session open elsewhere is read-only here: never two writers on one transcript
    if (held) { e.flash(`it is open in ${HELD[held.who]}: fork here, or copy it there`); return; }
    // /clear, /new, /resume, /fork: Sol's own, never sent
    const cmd = /^\/(clear|new|resume|fork)(?:\s+(.*))?$/i.exec(draft.trim());
    if (cmd && !atts.length) {
      const k = cmd[1].toLowerCase();
      setDraft(""); setPop(null); requestAnimationFrame(grow);
      if (k === "clear" || k === "new") w.fresh(cwd);
      else if (k === "fork") { if (w.live) w.fork(w.live); else e.flash("a new session has nothing to fork yet"); }
      else resume(cmd[2] ?? "");
      return;
    }
    if (w.say(draft.trim(), atts.map(({ name, mime, dataBase64 }) => ({ name, mime, dataBase64 })))) {
      setDraft(""); setAtts([]); setPop(null); requestAnimationFrame(grow);
      sendP.set(1); sendP.to(0, { cfg: CFG.pop, delay: 60 });
      onSent();
    }
  };
  useEffect(() => { if (!busy) box.current?.focus(); }, [busy, w.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- @ and /: what the caret sits after opens a list over the box ----
  const scan = (t: HTMLTextAreaElement) => {
    const caret = t.selectionStart ?? t.value.length;
    if (caret !== t.selectionEnd) { setPop(null); return; }
    const upto = t.value.slice(0, caret), after = t.value.slice(caret);
    const qt = /(?:^|\s)@"([^"@]*)$/.exec(upto);
    const at = qt ? null : /(?:^|\s)@([^\s@"]*)$/.exec(upto);
    const sl = /^\/([\w:.-]*)$/.exec(upto);
    // the rest of the token after the caret goes too when a hit replaces it
    const tail = (re: RegExp) => caret + (re.exec(after)?.[0].length ?? 0);
    setPop(qt ? { kind: "at", q: qt[1], start: caret - qt[1].length - 2, end: tail(/^[^"\n]*"?/) }
      : at ? { kind: "at", q: at[1], start: caret - at[1].length - 1, end: tail(/^[^\s@"]*/) }
      : sl ? { kind: "slash", q: sl[1], start: 0, end: tail(/^[\w:.-]*/) } : null);
  };
  const cmds = w.run?.commands;
  useEffect(() => { if (cmds?.length) try { localStorage.setItem("sol.work.commands", JSON.stringify(cmds)); } catch { /* private window */ } }, [cmds]);
  useEffect(() => {
    if (!pop) { setHits([]); return; }
    if (pop.kind === "slash") {
      const q = pop.q.toLowerCase(), skills = new Set(w.run?.skills ?? []);
      const all = [...new Set([...Object.keys(LOCAL), ...(cmds?.length ? cmds : knownCommands()), ...skills])];
      const fit = all.filter((c) => c.toLowerCase().includes(q)).sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)));
      setHits(fit.slice(0, 12).map((c) => ({ key: c, label: "/" + c, dim: LOCAL[c] ?? (skills.has(c) ? "skill" : ""), put: `/${c} ` })));
      setHitsFor("/" + pop.q); setSel(0);
      return;
    }
    let gone = false;
    const q = pop.q;
    const t = window.setTimeout(async () => {
      const r = await w.files(cwd || "~", q);
      if (gone) return;
      setHits(r.files.map((p) => {
        const dir = p.endsWith("/"), name = p.replace(/\/$/, "").split("/").pop()!;
        // a path with a space is quoted; a folder stays open (no closing quote, no space) so the list goes on inside it
        const quote = /\s/.test(p);
        return { key: p, label: name + (dir ? "/" : ""), dim: p.slice(0, p.length - name.length - (dir ? 1 : 0)).replace(/\/$/, ""),
          put: quote ? (dir ? `@"${p}` : `@"${p}" `) : dir ? `@${p}` : `@${p} ` };
      }));
      setHitsFor("@" + q); setSel(0);
    }, 70);
    return () => { gone = true; window.clearTimeout(t); };
  }, [pop?.kind, pop?.q, cwd]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (h: Hit) => {
    if (!pop) return;
    const caret = pop.start + h.put.length;
    setDraft((d) => d.slice(0, pop.start) + h.put + d.slice(pop.end));
    requestAnimationFrame(() => { const t = box.current; if (t) { t.focus(); t.setSelectionRange(caret, caret); scan(t); } grow(); });
  };
  const insert = (s: string, at?: number) => {
    const t = box.current;
    const p = at ?? t?.selectionStart ?? draft.length;
    const pad = s === "@" && p > 0 && !/\s/.test(draft[p - 1]) ? " " : "";
    setDraft((d) => d.slice(0, p) + pad + s + d.slice(p));
    requestAnimationFrame(() => { if (t) { t.focus(); t.setSelectionRange(p + pad.length + s.length, p + pad.length + s.length); scan(t); } grow(); });
  };
  const popRef = useRef<HTMLDivElement>(null);
  const shown = !!pop && hits.length > 0;
  const current = !!pop && hitsFor === (pop.kind === "at" ? "@" : "/") + pop.q;
  useLayoutEffect(() => { if (shown && popRef.current) enter(popRef.current, { y: 8, cfg: CFG.snap }); }, [shown, pop?.kind]);

  // ---- dictation: Life's recorder, the words landing at the caret ----
  const [rec, setRec] = useState<"off" | "on" | "ending">("off");
  const [heard, setHeard] = useState({ kept: "", open: "" });
  const settledWords = useRef("");
  const recorder = useRef<Recorder | null>(null);
  const recStart = useRef(0);
  useEffect(() => () => { const r = recorder.current; recorder.current = null; void r?.stop().catch(() => {}); }, []);
  useEffect(() => { onRec(rec === "on"); }, [rec]); // eslint-disable-line react-hooks/exhaustive-deps
  const micStop = async () => {
    const r = recorder.current;
    recorder.current = null;
    if (!r) return;
    setRec("ending");
    settledWords.current = r.settled();
    try { const audio = await r.stop(); if (audio) e.hear(audio); else e.heardCb.current(""); }
    catch (err) { setRec("off"); e.flash("could not read that recording: " + ((err as Error).message ?? err)); }
  };
  const micDown = async () => {
    if (recorder.current) { await micStop(); recStart.current = -1; return; }
    if (rec === "ending") return;
    try {
      recorder.current = await startRecording(e.settings?.mic, (clip, tag) => e.hear(clip, false, tag));
      recStart.current = Date.now();
      setHeard({ kept: "", open: "" }); setRec("on");
    } catch (err) { e.flash((err as Error).message || "the microphone is not available"); }
  };
  const micUp = () => { if (recStart.current > 0 && Date.now() - recStart.current > 500) void micStop(); };
  e.partialCb.current = (text, tag) => { const r = recorder.current; if (r) setHeard(r.heard(tag, text)); };
  e.heardCb.current = (last) => {
    const text = [settledWords.current, last].filter(Boolean).join(" ");
    settledWords.current = "";
    setRec("off"); setHeard({ kept: "", open: "" });
    if (text) {
      const t = box.current, at = t?.selectionStart ?? draft.length, end = t?.selectionEnd ?? at;
      setDraft((d) => d.slice(0, at) + (at > 0 && d[at - 1] && !/\s/.test(d[at - 1]) ? " " : "") + text + d.slice(end));
    }
    requestAnimationFrame(() => { grow(); box.current?.focus(); });
  };

  // files dropped anywhere on the window become chips
  useEffect(() => {
    let depth = 0;
    const over = (ev: DragEvent) => ev.preventDefault();
    const into = (ev: DragEvent) => { ev.preventDefault(); depth++; setDrop(true); };
    const leave = () => { if (--depth <= 0) { depth = 0; setDrop(false); } };
    const dropped = (ev: DragEvent) => {
      ev.preventDefault(); depth = 0; setDrop(false);
      const fs = Array.from(ev.dataTransfer?.files ?? []);
      if (fs.length) void attachRef.current(fs);
    };
    window.addEventListener("dragover", over); window.addEventListener("dragenter", into);
    window.addEventListener("dragleave", leave); window.addEventListener("drop", dropped);
    return () => {
      window.removeEventListener("dragover", over); window.removeEventListener("dragenter", into);
      window.removeEventListener("dragleave", leave); window.removeEventListener("drop", dropped);
    };
  }, []);

  // ---- the leash: cmd+shift+M steps through it ----
  const info = e.models.seats.find((s) => s.seat === "claude");
  const mode = MODES.find((x) => x.m === w.mode) ?? MODES[0];
  const cycle = useRef(() => {});
  cycle.current = () => {   // the key steps through the modes; bypass only from the menu
    const safe = MODES.filter((x) => !x.risky);
    w.adjust({ mode: safe[(safe.findIndex((x) => x.m === w.mode) + 1) % safe.length].m });
  };
  // cmd+shift+I and cmd+shift+E: the model and the effort as a menu over the box (1–9 pick)
  const pickMenu = useRef((_k: "model" | "effort") => {});
  pickMenu.current = (k) => {
    const r = askBox.current?.getBoundingClientRect();
    const items: MenuItem[] = k === "model"
      ? [{ head: "the model" }, ...(info?.models ?? []).map((m) => ({ label: prettyModel(m, "claude"), on: m === w.model, run: () => w.adjust({ model: m }) }))]
      : [{ head: "the effort" }, ...(info?.efforts ?? e.efforts).map((x) => ({ label: String(x), on: x === w.effort, run: () => w.adjust({ effort: String(x) }) }))];
    setMenu({ x: (r?.left ?? 40) + 10, y: (r?.top ?? 400) - 6, items });
  };
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (!ev.metaKey || !ev.shiftKey) return;
      const k = ev.key.toLowerCase();
      if (k === "m") { ev.preventDefault(); cycle.current(); }
      else if (k === "i" || k === "e") { ev.preventDefault(); pickMenu.current(k === "i" ? "model" : "effort"); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const at = (ev: React.MouseEvent, items: MenuItem[]) => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.top - 6, items }); };
  const plus = (ev: React.MouseEvent) => {
    const skills = w.run?.skills ?? [];
    at(ev, [
      { label: "attach files", run: () => fileInput.current?.click() },
      { label: "mention a file", key: "@", run: () => insert("@") },
      { label: "a command", key: "/", run: () => { setDraft((d) => (d.startsWith("/") ? d : "/" + d)); requestAnimationFrame(() => { const t = box.current; if (t) { t.focus(); t.setSelectionRange(1, 1); scan(t); } }); } },
      ...(skills.length ? [{ label: "a skill", sub: skills.slice(0, 14).map((s) => ({ label: s, run: () => { setDraft((d) => `/${s} ${d}`); requestAnimationFrame(() => box.current?.focus()); } })) }] : []),
      { sep: true },
      { label: "ask on the side", key: "⌘;", disabled: !w.live, run: () => { setAsideOn(true); box.current?.focus(); } },
    ]);
  };
  // the mode chip: a click opens the wheel and it stays; a hold (350 ms) or a right-click opens it for a release-pick (LeashWheel.tsx)
  const leashBtn = useRef<HTMLButtonElement>(null);
  const [wheel, setWheel] = useState<null | { kind: "hold" | "stick"; r: DOMRect }>(null);
  const leashHeld = useRef(false), leashTimer = useRef<number | undefined>(undefined);
  const leashOpen = (kind: "hold" | "stick") => { const r = leashBtn.current?.getBoundingClientRect(); if (r) setWheel({ kind, r }); };
  const leashStop = () => { window.clearTimeout(leashTimer.current); leashTimer.current = undefined; };
  const leashDown = (ev: React.PointerEvent) => { if (ev.button !== 0) return; leashHeld.current = false; leashStop(); leashTimer.current = window.setTimeout(() => { leashHeld.current = true; leashOpen("hold"); }, 350); };
  const leash = () => { if (leashHeld.current) { leashHeld.current = false; return; } if (wheel) setWheel(null); else leashOpen("stick"); };
  const folder = (ev: React.MouseEvent) => at(ev, [
    { head: "a new session starts in" },
    ...[...w.projects].sort((a, b) => b.count - a.count).slice(0, 8).map((p) => ({ label: p.name || base(p.path), on: p.path === w.freshCwd, run: () => w.fresh(p.path) })),
    { label: "home folder", on: !w.freshCwd, run: () => w.fresh("~") },
    { sep: true },
    { label: "in a side copy", on: w.copy, run: () => w.setCopy(!w.copy) },
    { label: "another folder…", ask: "", hint: "~/path/to/folder", run: async (v?: string) => {
      const r = await w.files(v ?? "", "");
      if (r.missing || !r.cwd) e.flash(`no folder at ${v}`); else w.fresh(r.cwd);
    } },
  ]);
  // /resume: the folder's older sessions (words search every folder), newest first; a pick opens it where it was
  const resume = (q: string) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const project = w.sessions.find((s) => s.id === w.live)?.project ?? w.projects.find((p) => cwd && (cwd === p.path || cwd.startsWith(p.path + "/")))?.path;
    const list = w.sessions.filter((s) => !s.archived && s.id !== w.live && (words.length ? words.every((x) => `${s.title} ${s.cwd}`.toLowerCase().includes(x)) : !project || s.project === project))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 9);
    const r = askBox.current?.getBoundingClientRect();
    setMenu({ x: (r?.left ?? 40) + 10, y: (r?.top ?? 400) - 6, items: list.length
      ? [{ head: words.length ? `sessions with “${q.trim()}”` : "pick up where it was" }, ...list.map((s) => ({ label: s.title, key: ago(s.updatedAt), run: () => w.open(s.id) }))]
      : [{ head: "no older session here" }] });
  };
  // the next prompt Claude Code suggests after a turn: shown in the empty box, Tab or → takes it
  const its = w.thread?.items ?? [];
  let sugAt = -1, meAt = -1;
  its.forEach((i, n) => { if (i.kind === "suggest") sugAt = n; else if (i.kind === "me") meAt = n; });
  const ghost = !busy && !asideOn && !draft && sugAt > meAt && its[sugAt]?.text && localStorage.getItem("sol.work.suggest") !== "0" ? String(its[sugAt].text) : "";
  const atLabel = w.freshCwd && w.freshCwd !== "~" ? base(w.freshCwd) : "~";
  return (
    <div className="ask">
      <div className="ask-col">
        <StableLine />
        <FileLine mode={cowork ? "cowork" : "work"} page={`${cowork ? "Cowork" : "Home"} · ${w.live ? "session" : "new session"} · ${cwd ? base(cwd) : "~"}`} conversation={w.live} />
        {held && !asideOn && (
          <div className="wheld">
            <span className="who"><i className={held.status} />open in <b>{HELD[held.who]}</b> · {held.status}{held.waitingFor ? ` (${held.waitingFor})` : ""} · read-only here</span>
            <span className="moves">
              <button onClick={forkHere} disabled={forking || !e.up} title="go on in a new session here, from where it is now; your words go with it">{forking ? "forking…" : "fork here"}</button>
              <button onClick={() => void copyOut()} disabled={!draft.trim()} title="Sol can't deliver into another app's session: copy, then paste it there">copy</button>
            </span>
          </div>
        )}
        {w.sideAnswer && <AsideCard key={w.sideAnswer.id} a={w.sideAnswer} onClose={() => w.dropAside()} />}
        <EngineBack up={e.up} />
        <div className={`ask-inner ${asideOn ? "aside" : ""} ${drop ? "drop" : ""} ${(busy || working) && !held ? "running" : ""}`} ref={askBox} onFocus={() => setBoxFocus(true)} onBlur={() => setBoxFocus(false)}>
          {shown && (
            <div ref={popRef} className={`wpop ${pop!.kind}`} role="listbox">
              {hits.map((h, i) => (
                <button key={h.key} role="option" aria-selected={i === sel} className={i === sel ? "on" : ""}
                  onMouseDown={(ev) => ev.preventDefault()} onMouseEnter={() => setSel(i)} onClick={() => pick(h)}>
                  <b>{h.label}</b>{h.dim && <span>{h.dim}</span>}
                </button>
              ))}
            </div>
          )}
        {atts.length > 0 && (
            <div className="chips">
              {atts.map((a, i) => (
                <div className="chip" key={i}>{a.thumb && <img src={a.thumb} alt="" />}<span>{a.name}</span>
                  <button onClick={() => setAtts((x) => x.filter((_, j) => j !== i))} title="remove">×</button></div>
              ))}
            </div>
          )}
          <div className="ask-line">
          <button className="wplus" onClick={plus} title="attach, mention, a command">+</button>
          {rec !== "off" && (
            <p className="live" aria-live="polite">
              {draft.trim() || heard.kept || heard.open ? <>{[draft.trim(), heard.kept].filter(Boolean).join(" ")}{heard.open && <span className="said">{(draft.trim() || heard.kept) ? " " : ""}{heard.open}</span>}{rec === "ending" && <span className="said">…</span>}</>
                : <span className="said">{rec === "ending" ? "…" : "listening…"}</span>}
            </p>
          )}
          <textarea ref={box} rows={1} value={draft} disabled={!e.up}
            className={ghost ? "ghost" : undefined}
            placeholder={!e.up ? "engine is starting" : held && !asideOn ? `words for it: fork here takes them along; copy puts them on the clipboard` : ghost ? `${ghost}   ⇥` : asideOn ? "ask on the side: the task goes on (esc to leave)" : busy ? "say more: it waits for the next step" : "tell Claude what to do  ·  @ a file  ·  / a command"}
            onChange={(ev) => { setDraft(ev.target.value); grow(); scan(ev.target); }}
            onSelect={(ev) => scan(ev.currentTarget)}
            onBlur={() => setPop(null)}
            onPaste={async (ev) => { const fs = Array.from(ev.clipboardData.files); if (fs.length) { ev.preventDefault(); await attach(fs); } }}
            onKeyDown={(ev) => {
              if (shown && !composing(ev)) {
                if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); setSel((s) => (s + (ev.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length); return; }
                if ((ev.key === "Enter" && !ev.shiftKey) || ev.key === "Tab") { ev.preventDefault(); if (current) pick(hits[sel]); return; }
                if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setPop(null); return; }
              }
              if (ghost && (ev.key === "Tab" || ev.key === "ArrowRight") && !ev.shiftKey) { ev.preventDefault(); setDraft(ghost); requestAnimationFrame(grow); return; }
              if (ev.key === "Enter" && !ev.shiftKey && !composing(ev)) { ev.preventDefault(); send(); }
            }} />
          {(busy || working) && !held && <button className="stop" onClick={() => w.stop()}>stop</button>}
          <input ref={fileInput} type="file" multiple hidden onChange={(ev) => { const fs = Array.from(ev.target.files ?? []); ev.target.value = ""; if (fs.length) void attach(fs); }} />
          </div>
        <Picker noSeat={!toChat} seat="claude" info={info} seats={e.models.seats} model={w.model} effort={w.effort as never} efforts={info?.efforts ?? e.efforts}
          up={e.up} health={e.health} context={w.run?.context ?? 0} win={w.run?.window || 200000} rec={rec !== "off"} notice={w.error}
          onSeat={(s) => { if (s !== "claude") (w.live ? switchTo : toChat)?.(s); }} onModel={(m) => w.adjust({ model: m })} onEffort={(v) => w.adjust({ effort: v })}
          onSeatModel={toChat ? (w.live ? switchTo : toChat) : undefined}
          onMicDown={micDown} onMicUp={micUp}>
          <button ref={leashBtn} className={`wchip leash ${w.mode}${wheel ? " lifted" : ""}`} onClick={leash} onPointerDown={leashDown} onPointerUp={leashStop} onPointerLeave={leashStop}
            onContextMenu={(ev) => { ev.preventDefault(); leashStop(); leashOpen("stick"); }} title="mode: what Claude may do without asking (hold it for the wheel; cmd+shift+M steps)">
            {w.mode === "bypassPermissions" && <Aurora />}<span className="leash-w">{mode.label}</span>
          </button>
          {wheel && createPortal(<LeashWheel r={wheel.r} kind={wheel.kind} items={MODES} mode={w.mode} onPick={(m) => w.adjust({ mode: m as Mode })} onClose={() => setWheel(null)} chip={leashBtn.current} />, document.body)}
          {!w.live && <button className="wchip" onClick={folder} title={(w.freshCwd ? tilde(w.freshCwd) : "your home folder") + (w.copy ? "\nin a side copy of its repo (its own branch)" : "")}>in {atLabel}{w.copy ? " · side copy" : ""}</button>}
        </Picker>
        </div>
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
