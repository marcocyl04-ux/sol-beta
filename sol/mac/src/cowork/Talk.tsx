// Talk (#37): the team's group chat in Cowork. One thread for everyone (general) and one per issue (#31), picked at the
// top. Talk is Home's bubbles (mine/look/COWORK.html, 2026-10-27): my own lines are Home's bubble on the right, everyone
// else's sit in a surface bubble beside their mark (an agent wears its person's). Lines brought in from a Discord or
// WhatsApp export carry a small tag of where they came from. The box sends on Enter; `/discord ` at the
// start also posts it to the team's Discord when this person's settings allow it, and the answer says so when not.
// The engine keeps the last 200 lines a thread and sends them to a face that opens late (PROTOCOL.md round 24); a group
// on the cloud keeps its talk there too, so "earlier lines" pages back past them (#315, round 54).
// Attachments (#315): two quiet icons inside the box (an image, a paperclip) open a file picker, and a file dropped on the
// box is taken too; the chosen file waits as a chip above the box with × until it is sent. A sent image draws as a
// 160×100 thumbnail, read by its path once and kept in memory; a file draws as its name · size · open. Pressing either
// opens a copy with the system (a document, never something that runs: that one is shown in Finder).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { composing } from "../ime";
import { link } from "../socket";
import { ENGINE } from "../useEngine";
import { Mark } from "../Mark";
import { Orb } from "../Orb";
import { CFG, enter, follow, type Follow } from "../motion";
import { Menu, type MenuItem } from "../work/Menu";
import type { Team } from "./useTeam";
import { StateMark, Who, personIn, since } from "./bits";
import { Cursors, IMAGE_TYPES, Lru, kindOfDrop, labelOf, readChip, sizeLine, type Chip, type TalkFile } from "./attach";
import "./talk.css";

export type TalkLine = { id: string; thread: string; from: string; at: number; text: string; source: "relay" | "discord" | "whatsapp"; agent?: boolean; to?: "discord"; file?: TalkFile; heard?: true };
type Cursor = { at: number; id: string };
type History = { thread?: string; lines?: TalkLine[]; threads?: string[]; discord?: boolean; older?: boolean; more?: boolean; next?: Cursor; error?: string };
type Answer = { ok?: boolean; id?: string; sent?: boolean; error?: string };
type Read = { path?: string; mime?: string; size?: number; bytes?: string; local?: string; open?: "open" | "reveal"; error?: string };

const Q = new URLSearchParams(location.search);
export const DEV_TALK = import.meta.env.DEV && Q.get("dev") === "talk";
const KEY = "sol.talk.thread";
const read = () => { try { return sessionStorage.getItem(KEY) || "general"; } catch { return "general"; } };
const keep = (t: string) => { try { sessionStorage.setItem(KEY, t); } catch { /* a private window */ } };
// the unsent words outlive a reload (One Sol moving the window between machines, #62)
const TEXT = "sol.talk.text";
const unsent = () => { try { return sessionStorage.getItem(TEXT) ?? ""; } catch { return ""; } };
const plain = (e: string) => (e === "not connected" || e === "no answer" ? "Sol is not answering on this machine right now" : e);

export function Talk({ team, flash }: { team: Team; flash: (s: string) => void }) {
  const [thread, setThread] = useState(read);
  const [lines, setLines] = useState<Record<string, TalkLine[]>>({});
  const [threads, setThreads] = useState<string[]>(["general"]);
  const [discord, setDiscord] = useState(false);
  const [text, setText] = useState(unsent);
  useEffect(() => { try { sessionStorage.setItem(TEXT, text); } catch { /* a private window */ } }, [text]);
  const [said, setSaid] = useState<{ t: string; bad: boolean } | null>(null);   // the answer to the last send, under the box
  // S6b: the room meets on the cloud and this Sol has no account there; Google in the system browser, up to ten minutes
  const [signing, setSigning] = useState(false);
  const signInSol = async () => {
    setSigning(true);
    const r = await team.ask<{ ok?: boolean; login?: string; error?: string }>("team.cloud.signin", {}, 11 * 60_000);
    setSigning(false);
    setSaid(r.ok ? { t: `signed in to Sol as ${r.login}`, bad: false } : { t: plain(r.error ?? "the sign-in did not finish"), bad: true });
  };
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  // #315: the file waiting to go with the line, a file dragged over the box, threads with earlier lines on the cloud
  const [chip, setChip] = useState<Chip | null>(null);
  const [drop, setDrop] = useState(false);
  const [older, setOlder] = useState<Record<string, boolean>>({});
  const [paging, setPaging] = useState(false);
  const cursors = useRef(new Cursors());   // where each thread's next earlier page starts (the cloud's word)
  // another group: every cursor and every line of the one before goes, and its threads are read anew below
  const room = team.state?.settings?.room ?? "";
  useEffect(() => { cursors.current.inRoom(room); setLines({}); setOlder({}); }, [room]);
  const pickImage = useRef<HTMLInputElement>(null), pickFile = useRef<HTMLInputElement>(null);
  const fresh = useRef(new Set<string>());     // ids that just arrived: they slide in
  const talk = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null), box = useRef<HTMLTextAreaElement>(null);
  const [flw, setFlw] = useState<Follow | null>(null);

  const ask = <T,>(type: string, body: object, wait?: number) => (DEV_TALK ? Promise.resolve(fake(type, body) as T) : team.ask<T>(type, body, wait));
  const add = (l: TalkLine) => {
    setLines((all) => {
      const had = all[l.thread] ?? [];
      if (had.some((x) => x.id === l.id)) return all;
      fresh.current.add(l.id);
      return { ...all, [l.thread]: [...had, l].sort((a, b) => a.at - b.at) };   // never cut: earlier lines paged in stay
    });
    setThreads((t) => (t.includes(l.thread) ? t : [...t, l.thread]));
  };

  // the thread's lines, again on every link up (a face that opens late gets what was said)
  useEffect(() => {
    let on = true;
    void ask<History>("team.talk.history", { thread }).then((h) => {
      if (!on) return;
      if (h.error) { setSaid({ t: plain(h.error), bad: true }); return; }
      cursors.current.drop(thread);   // read anew: a cursor from before would start in the wrong place
      setLines((all) => ({ ...all, [thread]: h.lines ?? [] }));
      if (h.threads) setThreads(["general", ...h.threads.filter((t) => t !== "general")]);
      setDiscord(!!h.discord);
      setOlder((o) => ({ ...o, [thread]: !!h.older }));
    });
    return () => { on = false; };
  }, [thread, team.up, room]); // eslint-disable-line react-hooks/exhaustive-deps

  // the hub's word (#223): a line it asked to wait, my place in its queue, a Sol too old for it; said under the box
  useEffect(() => team.onHub((w) => {
    if (w.say === "retry" && w.what === "talk") setSaid({ t: `the cloud asked to slow down: sending again in ${w.after ?? 1} s`, bad: false });
    else if (w.say === "queue") setSaid({ t: `the cloud is busy: you are in line${w.ahead ? `, ${w.ahead} ahead` : ""}; in again in about ${w.wait ?? 10} s, by itself`, bad: false });
    else if (w.say === "update") setSaid({ t: "this Sol is older than the cloud takes: please update Sol", bad: true });
  }), [team]); // eslint-disable-line react-hooks/exhaustive-deps
  // a line said anywhere on the team, or brought in from an export, arrives here
  useEffect(() => {
    if (DEV_TALK) { devAdd = add; return () => { devAdd = null; }; }
    return link(ENGINE).on((m) => { if (m?.type === "team.talk.line" && typeof m.id === "string") add(m as TalkLine); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the follow and the orb, the way every talk in Sol scrolls
  useEffect(() => {
    if (!talk.current || !inner.current) return;
    const f = follow(talk.current, inner.current);
    setFlw(f); f.jump();
    return () => { f.destroy(); setFlw(null); };
  }, []);
  useEffect(() => { flw?.jump(); }, [thread, flw]);

  const here = lines[thread] ?? [];
  const groups = useMemo(() => group(here), [here]);
  useLayoutEffect(() => {
    inner.current?.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
      if (fresh.current.delete(el.dataset.id!)) enter(el, { y: 10, cfg: CFG.slide });
    });
  }, [here]);

  const pick = (t: string) => { setThread(t); keep(t); setSaid(null); box.current?.focus(); };
  const send = async () => {
    const t = text.trim();
    if ((!t && !chip) || busy) return;
    setBusy(true);
    // a file goes into the group's record first, which can take a while on GitHub: two minutes before "no answer"
    const r = await ask<Answer>("team.talk", { thread, text: t, ...(chip ? { file: { name: chip.name, bytes: chip.bytes, kind: chip.kind } } : {}) }, chip ? 120_000 : undefined);
    setBusy(false);
    if (r.ok) {
      setText(""); setChip(null);
      setSaid(/^\/discord\s/i.test(t) ? { t: "posted to Discord too", bad: false } : !r.sent && team.state?.relay.url ? { t: "kept here; the team gets it when they are back on line", bad: false } : null);
    } else setSaid({ t: plain(r.error ?? "that did not go out"), bad: true });
  };
  // a file picked or dropped: read here, then it waits as the chip until the line is sent
  const take = async (f: File | undefined, kind: "image" | "file") => {
    if (!f) return;
    const c = await readChip(f, kind);
    if ("error" in c) { setSaid({ t: c.error, bad: true }); return; }
    setChip(c); setSaid(null); box.current?.focus();
  };
  // the cloud's earlier lines of this thread, before the oldest one here; put in front, once each
  const earlier = async () => {
    // the cursor: the cloud's own after a page, else the oldest line here the hub stamped (a line said here has this Mac's clock)
    const c = cursors.current.of(thread, lines[thread] ?? []);
    if (!c || paging) return;
    setPaging(true);
    const h = await ask<History>("team.talk.history", { thread, before: c.at, id: c.id });
    setPaging(false);
    if (h.error) { setSaid({ t: plain(h.error), bad: true }); return; }
    setLines((all) => { const had = all[thread] ?? [], ids = new Set(had.map((l) => l.id)); return { ...all, [thread]: [...(h.lines ?? []).filter((l) => !ids.has(l.id)), ...had] }; });
    cursors.current.set(thread, h.next);
    setOlder((o) => ({ ...o, [thread]: !!h.more && !!h.next }));
  };
  const issues = (ev: React.MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const open = (team.board?.cards ?? []).filter((c) => c.state === "open" && !threads.includes(`#${c.number}`)).slice(0, 9);
    setMenu({ x: r.left, y: r.bottom + 6, items: [
      ...(open.length ? [{ head: "an issue on the board" } as MenuItem] : []),
      ...open.map((c) => ({ label: `#${c.number}`, note: c.title, run: () => pick(`#${c.number}`) })),
      ...(open.length ? [{ sep: true } as MenuItem] : []),
      { label: "another issue…", ask: "the issue's number", hint: "31", run: (v?: string) => { const n = (v ?? "").replace(/^#/, "").trim(); if (/^[1-9]\d{0,5}$/.test(n)) pick(`#${n}`); else flash("an issue's number, like 31"); } },
    ] });
  };

  const title = (t: string) => (t === "general" ? "general" : t);
  const card = thread !== "general" ? (team.board?.cards ?? []).find((c) => `#${c.number}` === thread) : undefined;
  return (
    <div className="tk">
      <header className="tk-head">
        <div className="tk-threads" role="tablist" aria-label="threads">
          {threads.map((t) => (
            <button key={t} role="tab" aria-selected={t === thread} className={`tk-thread ${t === thread ? "on" : ""}`} onClick={() => pick(t)}>{title(t)}</button>
          ))}
          <button className="tk-thread ghost" onClick={issues} title="talk about one issue">+ issue</button>
        </div>
        {card && <span className="tk-about" title={card.url}>{card.title}</span>}
      </header>
      <div className="talk-wrap">
        <div className="talk tk-talk" ref={talk}>
          <div className="talk-inner" ref={inner}>
            {here.length > 0 && older[thread] && <p className="tk-earlier"><button className="wlink" disabled={paging} onClick={() => void earlier()}>{paging ? "reading…" : "earlier lines"}</button></p>}
            {here.length === 0 ? <Empty thread={thread} /> : groups.map((g) => mineOf(g[0], team.me) ? (
              <section key={g[0].id} className="tk-group mine">
                {g.map((l) => (
                  <div key={l.id} data-id={l.id} className="me-row tk-me">
                    {l.to === "discord" && <span className="ctag tk-src">to Discord</span>}
                    {l.file && <Attached file={l.file} ask={ask} flash={flash} />}
                    {l.text && <p className="msg me">{l.text}</p>}
                  </div>
                ))}
                <time className="tk-at" title={new Date(g[g.length - 1].at).toLocaleString()}>{since(g[g.length - 1].at)}</time>
              </section>
            ) : (
              <section key={g[0].id} className="tk-group them">
                <Who login={personIn(g[0].from)} size={22} className="tk-bud" />
                <div className="tk-col">
                  <div className="tk-who">
                    <span className="tk-name">{g[0].from}</span>
                    {g[0].source !== "relay" && <span className="ctag tk-src">{g[0].source}</span>}
                    <time className="tk-at" title={new Date(g[0].at).toLocaleString()}>{since(g[0].at)}</time>
                  </div>
                  {g.map((l) => (
                    <div key={l.id} data-id={l.id} className="tk-line">
                      {l.text && <p>{l.text}</p>}
                      {l.file && <Attached file={l.file} ask={ask} flash={flash} />}
                      {l.to === "discord" && <span className="ctag tk-src">to Discord</span>}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
        <Orb f={flw} />
      </div>
      <div className="tk-foot">
        {said && <p className={`tk-said ${said.bad ? "tk-no" : ""}`} role="status"><StateMark kind={said.bad ? "failed" : "done"} />{said.t}</p>}
        {team.state?.cloud?.need && <p className="tk-said tk-no" role="status"><StateMark kind="needs" />this room meets on the cloud: sign in to Sol to talk here{" "}
          <button className="wlink" disabled={signing} onClick={() => void signInSol()}>{signing ? "finish in the browser…" : "sign in with Google"}</button></p>}
        {team.state?.cloud?.gone && <p className="tk-said tk-no" role="status"><StateMark kind="failed" />the cloud does not know this room's code yet: its maker can move it there (bash sol/cloud/move), or ask Frank or Marco to bring the NucBox's rooms over</p>}
        {chip && (
          <div className="tk-chip" role="status">
            <span className="tk-chip-name" title={chip.name}>{chip.name}</span>
            <span className="tk-chip-size">{sizeLine(chip.size)}</span>
            <button className="tk-chip-x" aria-label="take the file off" title="take the file off" onClick={() => setChip(null)}>×</button>
          </div>
        )}
        <div className={`tk-box ${drop ? "drop" : ""}`}
          onDragOver={(ev) => { if (ev.dataTransfer.types.includes("Files")) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; if (!drop) setDrop(true); } }}
          onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDrop(false); }}
          onDrop={(ev) => { ev.preventDefault(); setDrop(false); const f = ev.dataTransfer.files[0]; if (f) void take(f, kindOfDrop(f.type)); }}>
          <button className="tk-att" aria-label="attach an image" title="attach an image" onClick={() => pickImage.current?.click()}><ImageGlyph /></button>
          <button className="tk-att" aria-label="attach a file" title="attach a file" onClick={() => pickFile.current?.click()}><ClipGlyph /></button>
          <input ref={pickImage} type="file" accept={IMAGE_TYPES} hidden onChange={(ev) => { void take(ev.target.files?.[0], "image"); ev.target.value = ""; }} />
          <input ref={pickFile} type="file" hidden onChange={(ev) => { void take(ev.target.files?.[0], "file"); ev.target.value = ""; }} />
          <textarea ref={box} rows={1} value={text} placeholder={`say something in ${title(thread)}`} spellCheck
            onChange={(ev) => { setText(ev.target.value); if (said) setSaid(null); }}
            onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey && !composing(ev)) { ev.preventDefault(); void send(); } }} />
          <button className="wbtn" disabled={(!text.trim() && !chip) || busy} onClick={() => void send()}>{busy && chip ? "sending…" : "send"}</button>
        </div>
        {thread === "general" && discord && <p className="tk-hint">start with <code>/discord</code> to post it to the team's Discord as your agent</p>}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

// ---- attachments (#315) ----
const G = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
function ImageGlyph() { return <svg {...G}><rect x="2" y="3" width="12" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.2" /><path d="M2.5 12l3.8-3.6 2.7 2.4 1.9-1.6 2.6 2.3" /></svg>; }
function ClipGlyph() { return <svg {...G}><path d="M13.2 7.6l-5 5a3.2 3.2 0 0 1-4.5-4.5l5.4-5.4a2.1 2.1 0 0 1 3 3L6.8 11a1 1 0 0 1-1.5-1.5l4.8-4.8" /></svg>; }

// a thumbnail's picture, by its path: asked once, kept in memory only (never on disk), the last 20 used; one let go
// gives its blob back
const thumbs = new Lru<Promise<string>>(20, (p) => { void p.then((u) => URL.revokeObjectURL(u), () => {}); });
type Ask = <T>(type: string, body: object, wait?: number) => Promise<T>;
const thumbOf = (path: string, ask: Ask) => {
  let p = thumbs.get(path);
  if (!p) {
    p = ask<Read>("team.talk.file", { path }, 60_000).then((r) => {
      if (!r.bytes || !r.mime?.startsWith("image/")) throw new Error(r.error ?? "not a picture");
      return URL.createObjectURL(new Blob([Uint8Array.from(atob(r.bytes), (c) => c.charCodeAt(0))], { type: r.mime }));
    });
    p.catch(() => thumbs.delete(path));   // a failed read is asked again next time
    thumbs.set(path, p);
  }
  return p;
};
/** an attachment opened with the system: the engine keeps a copy, the Mac opens a document and shows anything else in Finder */
async function openAttached(file: TalkFile, ask: Ask, flash: (s: string) => void) {
  const r = await ask<Read>("team.talk.file", { path: file.path, name: file.name, open: true }, 60_000);
  if (!r.local) { flash(plain(r.error ?? "Sol could not open it")); return; }
  try {
    const o = await import("@tauri-apps/plugin-opener");
    if (r.open === "open") await o.openPath(r.local); else { await o.revealItemInDir(r.local); flash("shown in Finder: Sol does not open a file that could run"); }
  } catch { flash("Sol could not open it"); }
}
/** an attachment in a line: an image as a 160×100 thumbnail, a file as its name · size · open */
function Attached({ file, ask, flash }: { file: TalkFile; ask: Ask; flash: (s: string) => void }) {
  const [src, setSrc] = useState("");
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (file.kind !== "image") return;
    let on = true;
    thumbOf(file.path, ask).then((u) => { if (on) setSrc(u); }, () => { if (on) setBad(true); });
    return () => { on = false; };
  }, [file.path, file.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  if (file.kind === "image" && !bad) return (
    <button className="tk-thumb" title={labelOf(file)} aria-label={`open ${labelOf(file)}`} onClick={() => void openAttached(file, ask, flash)}>
      {src ? <img src={src} alt={labelOf(file)} /> : <span className="tk-thumb-wait" aria-hidden />}
    </button>
  );
  return (
    <p className="tk-file">
      <span className="tk-file-name" title={labelOf(file)}>{labelOf(file)}</span>
      <span className="tk-file-size">{sizeLine(file.size)}</span>
      <button className="wlink" onClick={() => void openAttached(file, ask, flash)}>open</button>
    </p>
  );
}

/** my own line, said here (not my agent's, not one brought in from an export): Home's bubble on the right */
const mineOf = (l: TalkLine, me: string) => !!me && l.source === "relay" && !l.agent && l.from.toLowerCase() === me.toLowerCase();

/** lines in a row from the same voice, close in time, sit under one signature */
function group(lines: TalkLine[]): TalkLine[][] {
  const out: TalkLine[][] = [];
  for (const l of lines) {
    const g = out[out.length - 1], last = g?.[g.length - 1];
    if (last && last.from === l.from && last.source === l.source && l.at - last.at < 5 * 60_000) g.push(l); else out.push([l]);
  }
  return out;
}

function Empty({ thread }: { thread: string }) {
  return (
    <div className="tk-empty">
      <Mark size={44} />
      <p className="cnone">{thread === "general" ? "nobody has said anything here yet" : `nothing said about ${thread} yet`}</p>
      {thread === "general" && (
        <div className="tk-drop">
          <p>to bring the team's Discord or WhatsApp in, drop an export here:</p>
          <p><code>sol/home/talk/discord/</code> a channel export, <b>.txt</b> or <b>.json</b> (DiscordChatExporter), or a log copied out of Discord</p>
          <p><code>sol/home/talk/whatsapp/</code> the group's <b>Export chat</b>, without media: the <b>.txt</b></p>
          <p className="cnone">they show up here within a quarter of a minute, tagged with where they came from</p>
        </div>
      )}
    </div>
  );
}

// ---- ?dev=talk: the pane with a made-up team, no engine (the shots). &empty=1 has no lines ----
let devAdd: ((l: TalkLine) => void) | null = null;
const devFiles = new Map<string, string>();   // ?dev=talk: what was attached here, by its made-up path
const T0 = Date.now();
const L = (id: string, thread: string, from: string, min: number, text: string, source: TalkLine["source"] = "relay", agent = false): TalkLine => ({ id, thread, from, at: T0 - min * 60_000, text, source, agent });
const DEV: TalkLine[] = Q.get("empty") ? [] : [
  L("d1", "general", "discord: isaac", 190, "is the board up yet? I want to see where the gantt ended up", "discord"),
  L("d2", "general", "frank", 150, "the board is up on the NucBox, read again if you see the old one"),
  L("d3", "general", "frank's agent", 148, "Frank's branch frank/board-dots is on main since 14:02. Two cards moved to done.", "relay", true),
  L("d4", "general", "whatsapp: Isaac", 96, "two things:\nthe gantt is wide on the laptop\nand the dots are dark at night", "whatsapp"),
  L("d5", "general", "marco", 40, "ok, looking tonight. Isaac, can you put the two things on #31?"),
  L("d6", "general", "marco", 39, "and thanks Frank"),
  L("i1", "#31", "isaac", 30, "the gantt is wider than the laptop: it cuts off after week 6"),
  L("i2", "#31", "marco's agent", 12, "The gantt's columns are fixed at 96px. I can make them fit the width, down to 48px, and scroll past that. Shall I?", "relay", true),
  L("i3", "#31", "marco", 8, "yes, do it on marco/gantt-fit"),
];
function fake(type: string, body: any): History | Answer {
  if (type === "team.talk.history") {
    const threads = [...new Set(DEV.map((l) => l.thread))];
    return { thread: body.thread, lines: DEV.filter((l) => l.thread === body.thread), threads, discord: Q.get("discord") !== "off" };
  }
  if (type === "team.talk") {
    const text = String(body.text);
    if (/^\/discord\s/i.test(text) && Q.get("discord") === "off") return { ok: false, error: "Discord is off in my agent's settings" };
    const id = `n${Date.now()}`;
    const f = body.file as { name: string; bytes: string; kind: "image" | "file" } | undefined;
    const file = f ? { path: `.sol/talk/${id}.${f.kind === "image" ? "png" : "bin"}`, name: f.name, size: Math.floor(f.bytes.length * 3 / 4), kind: f.kind } : undefined;
    if (f && file) devFiles.set(file.path, f.bytes);
    setTimeout(() => devAdd?.({ id, thread: body.thread, from: "marco", at: Date.now(), text: text.replace(/^\/discord\s+/i, ""), source: "relay", ...(/^\/discord\s/i.test(text) ? { to: "discord" as const } : {}), ...(file ? { file } : {}) }), 0);
    return { ok: true, id, sent: true };
  }
  if (type === "team.talk.file") {
    const bytes = devFiles.get(String(body.path));
    return (bytes ? { path: body.path, mime: "image/png", size: bytes.length, bytes } : { error: "not here" }) as Answer;
  }
  return { error: "not here" };
}
