// Talk (#37): the team's group chat in Cowork. One thread for everyone (general) and one per issue (#31), picked at the
// top. A line is signed the way the board signs: a person, or that person's agent, in amber. Lines brought in from a
// Discord or WhatsApp export carry a small tag of where they came from. The box sends on Enter; `/discord ` at the
// start also posts it to the team's Discord when this person's settings allow it, and the answer says so when not.
// The engine keeps the last 200 lines a thread and sends them to a face that opens late (PROTOCOL.md round 24).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { composing } from "../ime";
import { link } from "../socket";
import { ENGINE } from "../useEngine";
import { Mark } from "../Mark";
import { Orb } from "../Orb";
import { CFG, enter, follow, type Follow } from "../motion";
import { Menu, type MenuItem } from "../work/Menu";
import type { Team } from "./useTeam";
import { since } from "./bits";
import "./talk.css";

export type TalkLine = { id: string; thread: string; from: string; at: number; text: string; source: "relay" | "discord" | "whatsapp"; agent?: boolean; to?: "discord" };
type History = { thread?: string; lines?: TalkLine[]; threads?: string[]; discord?: boolean; error?: string };
type Answer = { ok?: boolean; id?: string; sent?: boolean; error?: string };

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
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const fresh = useRef(new Set<string>());     // ids that just arrived: they slide in
  const talk = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null), box = useRef<HTMLTextAreaElement>(null);
  const [flw, setFlw] = useState<Follow | null>(null);

  const ask = <T,>(type: string, body: object) => (DEV_TALK ? Promise.resolve(fake(type, body) as T) : team.ask<T>(type, body));
  const add = (l: TalkLine) => {
    setLines((all) => {
      const had = all[l.thread] ?? [];
      if (had.some((x) => x.id === l.id)) return all;
      fresh.current.add(l.id);
      return { ...all, [l.thread]: [...had, l].sort((a, b) => a.at - b.at).slice(-200) };
    });
    setThreads((t) => (t.includes(l.thread) ? t : [...t, l.thread]));
  };

  // the thread's lines, again on every link up (a face that opens late gets what was said)
  useEffect(() => {
    let on = true;
    void ask<History>("team.talk.history", { thread }).then((h) => {
      if (!on) return;
      if (h.error) { setSaid({ t: plain(h.error), bad: true }); return; }
      setLines((all) => ({ ...all, [thread]: h.lines ?? [] }));
      if (h.threads) setThreads(["general", ...h.threads.filter((t) => t !== "general")]);
      setDiscord(!!h.discord);
    });
    return () => { on = false; };
  }, [thread, team.up]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!t || busy) return;
    setBusy(true);
    const r = await ask<Answer>("team.talk", { thread, text: t });
    setBusy(false);
    if (r.ok) {
      setText("");
      setSaid(/^\/discord\s/i.test(t) ? { t: "posted to Discord too", bad: false } : !r.sent && team.state?.relay.url ? { t: "kept here; the team gets it when they are back on line", bad: false } : null);
    } else setSaid({ t: plain(r.error ?? "that did not go out"), bad: true });
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
            {here.length === 0 ? <Empty thread={thread} /> : groups.map((g) => (
              <section key={g[0].id} className="tk-group">
                <div className="tk-who">
                  <span className="csig">{g[0].from}</span>
                  {g[0].source !== "relay" && <span className="ctag tk-src">{g[0].source}</span>}
                  <time className="tk-at" title={new Date(g[0].at).toLocaleString()}>{since(g[0].at)}</time>
                </div>
                {g.map((l) => (
                  <div key={l.id} data-id={l.id} className="tk-line">
                    <p>{l.text}</p>
                    {l.to === "discord" && <span className="ctag tk-src">to Discord</span>}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
        <Orb f={flw} />
      </div>
      <div className="tk-foot">
        {said && <p className={`tk-said ${said.bad ? "tk-no" : ""}`} role="status">{said.t}</p>}
        <div className="tk-box">
          <textarea ref={box} rows={1} value={text} placeholder={`say something in ${title(thread)}`} spellCheck
            onChange={(ev) => { setText(ev.target.value); if (said) setSaid(null); }}
            onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey && !composing(ev)) { ev.preventDefault(); void send(); } }} />
          <button className="cbtn" disabled={!text.trim() || busy} onClick={() => void send()}>send</button>
        </div>
        {thread === "general" && discord && <p className="tk-hint">start with <code>/discord</code> to post it to the team's Discord as your agent</p>}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

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
    setTimeout(() => devAdd?.({ id, thread: body.thread, from: "marco", at: Date.now(), text: text.replace(/^\/discord\s+/i, ""), source: "relay", ...(/^\/discord\s/i.test(text) ? { to: "discord" as const } : {}) }), 0);
    return { ok: true, id, sent: true };
  }
  return { error: "not here" };
}
