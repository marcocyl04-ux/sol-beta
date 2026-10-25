import { useEffect, useRef, useState } from "react";
import { Drawer } from "../Settings";
import { Seg, OnOff, Field } from "../work/WorkSettings";
import { Xterm } from "../work/TermPane";
import { ENGINE, FAR_NAME, LIVE, NEXT, pickEngine, sameEngine, type Machine } from "../useEngine";
import { useControl, DEV, DIAL_DEFAULTS, type Team, type Room, type Accounts, type PingKind, type Dial } from "./useControl";
import { meets } from "../cowork/rooms";
import "./control.css";

// Control (#32): settings in plain words, the person's own. Six drawers at the top of Settings, in every mode: me, my
// machines, my accounts (and which helper answers in Life and in Work), my tools, my agent (where it may speak), what
// leaves this machine. Kept in the engine's team.json (team/settings.ts). The screen never says rig, seat, door,
// engine or relay: those words stay in the docs. PRD: sol/design/together/2-control/PRD.md.

export const CONTROL_DRAWERS = ["me", "my machines", "my accounts", "my tools", "my agent", "what leaves this machine"];
const ALL = DEV && new URLSearchParams(location.search).get("open") === "all";   // the tall shot: every drawer open
type What = "claude" | "codex" | "github";
const NAMES: Record<What, string> = { claude: "Claude Code", codex: "Codex", github: "GitHub" };
const base = (u: string) => u.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
// the five pings (#100), in the person's words: what it is, and what "when it matters" does with it
const PINGS: [PingKind, string, string][] = [
  ["clash", "a clash", "someone's change will collide with my branch; my agent keeps it and tells me at its next pause"],
  ["contract", "a contract changed", "something my work uses changed shape; my agent keeps it and tells me"],
  ["claim", "a claim", "someone holds work overlapping mine; my agent keeps it and tells me"],
  ["decision", "a decision", "a decision is closing on my issue; a card for me"],
  ["chat", "named in the chat", "a line in the team's chat names me; a card for me"],
];

export function ControlDrawers({ open, toggle, onSet, flash }: {
  open: string; toggle: (n: string) => void;
  onSet: (patch: object) => void;             // the shared settings (a new chat starts on defaults.seat)
  flash?: (s: string) => void;
}) {
  const c = useControl();
  const t = c.team;
  const is = (n: string) => ALL || open === n;
  // the slow ones ask when their drawer opens
  useEffect(() => { if (is("my accounts") || is("me")) void c.loadAccounts(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (is("my tools") && c.tools === undefined) void c.loadTools(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // a sign-in: the line typed into a terminal under the row; the person presses Return and finishes in the browser
  const [term, setTerm] = useState<{ tid: string; what: What; command: string } | null>(null);
  const [note, setNote] = useState("");
  const signIn = async (what: What) => {
    setNote("");
    const r = await c.ask<{ command?: string; error?: string }>("team.signin", { seat: what });
    const command = r.command ?? (DEV ? { claude: "claude auth login", codex: "codex login", github: "gh auth login --web" }[what] : "");
    if (!command) return setNote(r.error ?? "Sol could not say how to sign in");
    if (term) c.link?.send({ type: "work.term.close", tid: term.tid });
    const o = await c.ask<{ tid?: string; error?: string }>("work.term.open", { cwd: "~", cols: 92, rows: 12 });
    if (!o.tid) return setNote(o.error ?? "the terminal did not open");
    const tid = o.tid;
    setTerm({ tid, what, command });
    // typed once the shell has gone quiet after drawing its prompt, or after two and a half seconds; never run
    let typed = false, off = () => {}, quiet = 0;
    const type = () => { if (typed) return; typed = true; off(); c.link?.send({ type: "work.term.in", tid, data: command }); };
    off = c.link?.on((m) => { if (m?.type === "work.term.out" && m.tid === tid) { window.clearTimeout(quiet); quiet = window.setTimeout(type, 500); } }) ?? off;
    window.setTimeout(type, 2500);
  };
  const closeTerm = () => { if (term) c.link?.send({ type: "work.term.close", tid: term.tid }); setTerm(null); void c.loadAccounts(); };
  const termWire = {
    ask: c.ask,
    term: (type: "in" | "size" | "close" | "list", a: object = {}) => { c.link?.send({ type: `work.term.${type}`, ...a }); },
  };
  const termBox = (what: What) => term?.what === what && c.link ? (
    <div className="ctl-term">
      <div className="ctl-term-h">
        <span>press Return to run <code>{term.command}</code>, then finish in the browser</span>
        <button className="wlink" onClick={closeTerm}>done</button>
      </div>
      <div className="ctl-term-in"><Xterm key={term.tid} tid={term.tid} w={termWire as never} sub={c.link.on} /></div>
    </div>
  ) : null;

  const off = !t;
  const login = t?.me.login || c.accounts?.github.who || "";
  return (<>
    <Drawer name="me" open={is("me")} onToggle={() => toggle("me")}>
      <div className="field-r">
        <div className="lab"><span>my name</span><small>what the team sees beside what I do</small></div>
        <span className="ctl-namefield"><Field value={t?.me.name ?? ""} placeholder={login || "your name"} onSave={(v) => void c.set({ me: { name: v } })} /></span>
      </div>
      <div className="field-r">
        <div className="lab"><span>GitHub</span><small>{login ? "read from GitHub on this machine" : "sign in with gh auth login in a terminal"}</small></div>
        {login ? <span className="ctl-val mono">{login}</span>
          : <button className="wbtn" disabled={off && !DEV} onClick={() => void signIn("github")}>sign in</button>}
      </div>
      {termBox("github")}
      <div className="field-r">
        <div className="lab"><span>GitHub org</span><small>when set, the team knows people by their GitHub sign-in; the key is no longer needed</small></div>
        <span className="ctl-namefield"><Field value={t?.org ?? ""} placeholder="none yet" onSave={(v) => void c.set({ org: v.trim() })} /></span>
      </div>
      {/* --- Rooms (#154): the rooms I am in, the one I am in now, and a new one */}
      <Rooms team={t} onSwitch={(id) => void c.set({ room: id })} onSave={(rooms) => void c.set({ rooms })} />
      {/* --- end Rooms */}
      {c.err && <p className="hint-line stale">{c.err}</p>}
    </Drawer>

    <Drawer name="my machines" open={is("my machines")} onToggle={() => toggle("my machines")}>
      <Machines team={t} onSave={(m) => void c.setMachines(m)} />
    </Drawer>

    <Drawer name="my accounts" open={is("my accounts")} onToggle={() => toggle("my accounts")}>
      <p className="hint-line top">signed in on this machine, with your own subscription</p>
      {(["claude", "codex"] as What[]).map((k) => <AccountRow key={k} what={k} a={c.accounts} onSignIn={() => void signIn(k)}>{termBox(k)}</AccountRow>)}
      {note && <p className="hint-line stale">{note}</p>}
      <div className="ctl-again"><button className="wlink" onClick={() => void c.loadAccounts()}>check again</button></div>
      <div className="ctl-sub">who answers</div>
      <div className="field-r">
        <div className="lab"><span>a new chat</span><small>starts with it; switch under the box before the first word</small></div>
        <Seg value={t?.seats.life ?? "codex"} disabled={off} options={[["codex", "Codex"], ["claude", "Claude"]]}
          onChange={(v) => { void c.set({ seats: { life: v } }); onSet({ defaults: { seat: v } }); flash?.(`new chats start with ${v === "codex" ? "Codex" : "Claude"}`); }} />
      </div>
      <div className="field-r">
        <div className="lab"><span>a session</span><small>Claude only for now</small></div>
        <Seg value="claude" disabled options={[["codex", "Codex"], ["claude", "Claude"]]} onChange={() => {}} />
      </div>
    </Drawer>

    <Drawer name="my tools" open={is("my tools")} onToggle={() => toggle("my tools")}>
      <Tools tools={c.tools} />
    </Drawer>

    <Drawer name="my agent" open={is("my agent")} onToggle={() => toggle("my agent")}>
      <p className="hint-line top">where my agent may speak; it always signs as <span className="ctl-sig">{login ? `${login}'s agent` : "my agent"}</span>, never as me</p>
      <div className="field-r">
        <div className="lab"><span>GitHub</span><small>issues, pull requests, comments, reviews</small></div>
        <OnOff on={t?.speak.github ?? true} disabled={off} set={(v) => void c.set({ speak: { github: v } })} />
      </div>
      <div className="field-r">
        <div className="lab"><span>Cowork</span><small>the team's view in Sol, always signed</small></div>
        <OnOff on={t?.speak.cowork ?? true} disabled={off} set={(v) => void c.set({ speak: { cowork: v } })} />
      </div>
      <div className="field-r">
        <div className="lab"><span>Discord</span><small>{t?.speak.discord === "any" ? "any channel it can reach" : t?.speak.discord === "never" ? "not a word" : "only #builds, where GitHub posts too"}</small></div>
        <Seg value={t?.speak.discord ?? "builds"} disabled={off} options={[["never", "never"], ["builds", "#builds"], ["any", "any"]]} onChange={(v) => void c.set({ speak: { discord: v } })} />
      </div>
      <div className="field-r">
        <div className="lab"><span>WhatsApp</span><small>{t?.speak.whatsapp ? "it may write there" : "never"}</small></div>
        <OnOff on={t?.speak.whatsapp ?? false} disabled={off} set={(v) => void c.set({ speak: { whatsapp: v } })} />
      </div>
      <p className="hint-line">Sol refuses a post where this says no, and tells every new turn these lines</p>
      {/* --- Pings and dials (#100): five rows, each a three-way pick; a flip is said once, as what my agent learned */}
      <div className="ctl-sub">what reaches me</div>
      <p className="hint-line top">every ping lands on my agent first; this says which ones it brings to me as a card. A card never stops anything</p>
      {PINGS.map(([k, name, line]) => (
        <div className="field-r" key={k}>
          <div className="lab"><span>{name}</span><small>{line}</small></div>
          <Seg value={t?.dials?.[k] ?? DIAL_DEFAULTS[k]} disabled={off} options={[["always", "always"], ["matters", "when it matters"], ["never", "never"]] as [Dial, string][]}
            onChange={(v) => void c.set({ dials: { [k]: v } }).then((r) => { for (const l of r.learned ?? []) flash?.(l); })} />
        </div>
      ))}
      <p className="hint-line">when my agent keeps one from me, it says so in one line on the issue, so a wrong call shows</p>
      {/* --- end Pings */}
    </Drawer>

    <Drawer name="what leaves this machine" open={is("what leaves this machine")} onToggle={() => toggle("what leaves this machine")}>
      {([["my prompts", "what I type to Sol stays here"], ["my memory", "what Sol keeps about me stays here"], ["my transcripts", "every conversation stays here"]] as [string, string][]).map(([k, line]) => (
        <div className="field-r" key={k}>
          <div className="lab"><span>{k}</span><small>{line}</small></div>
          <span className="ctl-never" title="a fixed rule, not a switch">never</span>
        </div>
      ))}
      <div className="field-r">
        <div className="lab"><span>an audit</span><small>{t?.leaves.audit === "never" ? "a teammate's request is turned down" : "a teammate asks; I see what would go and say yes or no"}</small></div>
        <Seg value={t?.leaves.audit ?? "ask"} disabled={off} options={[["ask", "asks me first"], ["never", "never"]]} onChange={(v) => void c.set({ leaves: { audit: v } })} />
      </div>
      <p className="hint-line">GitHub always has what I commit and push; nothing else goes on its own</p>
    </Drawer>
  </>);
}

function AccountRow({ what, a, onSignIn, children }: { what: What; a: Accounts | null; onSignIn: () => void; children: React.ReactNode }) {
  const x = a?.[what];
  const state = !a ? "reading…" : x?.missing ? `${NAMES[what]} is not on this machine` : x?.in ? `signed in${x.who ? `, ${x.who}` : ""}` : "not signed in";
  return (<>
    <div className="field-r">
      <div className="lab"><span><i className={`ctl-dot ${!a ? "" : x?.in ? "in" : "out"}`} />{NAMES[what]}</span><small>{state}</small></div>
      <button className={x?.in ? "wlink" : "wbtn"} disabled={!a || x?.missing} onClick={onSignIn}>{x?.in ? "sign in again" : "sign in"}</button>
    </div>
    {children}
  </>);
}

function Tools({ tools }: { tools: ReturnType<typeof useControl>["tools"] }) {
  if (tools === undefined) return <p className="hint-line top">reading…</p>;
  if (!tools) return <p className="hint-line top">a session that has run since Sol started shows what Claude Code loaded. Change them in Claude Code.</p>;
  return (
    <div className="wtools">
      {([["skills", tools.skills], ["plugins", tools.plugins], ["agents", tools.agents]] as [string, string[]][]).map(([k, xs]) => (
        <div key={k} className="wtrow"><span className="k">{k}</span><span className="v">{xs.length ? xs.join(" · ") : "none"}</span></div>
      ))}
      <div className="wtrow"><span className="k">MCP servers</span><span className="v">{tools.mcp.length ? tools.mcp.map((m) => <span key={m.name} className={`mcp ${m.status}`}>{m.name}<i /></span>) : "none"}</span></div>
      <p className="hint-line">what Claude Code has, as the newest session loaded it. Change them in Claude Code; Sol adds no screen for it.</p>
    </div>
  );
}

// Rooms (#154): one line each, its name, what keeps its record, the org or the repos, where it meets; the one I am in
// marked, a click on another goes there. Forget any room but the last. A new room is made from Cowork's side, not here
// (Frank, 2026-10-23); no key is ever on screen.
function Rooms({ team, onSwitch, onSave }: { team: Team | null; onSwitch: (id: string) => void; onSave: (rooms: Room[]) => void }) {
  const list = team?.rooms ?? [];
  const [sure, setSure] = useState<string | null>(null);
  return (<>
    <div className="ctl-sub">rooms</div>
    <p className="hint-line top">each room is one group's work and the people in it; Cowork shows the one you are in</p>
    <div className="ctl-machines">
      {list.map((r) => {
        const here = r.id === team?.room;
        return (
          <div key={r.id} className={`ctl-machine ${here ? "here" : ""}`}>
            <span className="ctl-mname">{r.name}{r.code && <small className="ctl-code"> {r.code}</small>}</span>
            <span className="ctl-addr" title={`${r.provider} · ${r.org || r.repos.join(", ")} · meets on ${meets(r.hub)}`}>
              {r.provider === "drive" ? "drive" : "github"} · {r.org || r.repos.join(", ") || "nothing yet"} · {meets(r.hub)}
            </span>
            {here ? <span className="ctl-here">this one</span> : <button className="wlink" onClick={() => onSwitch(r.id)}>go there</button>}
            {list.length > 1 && (sure === r.id
              ? <span className="wsure"><button className="wlink danger" onClick={() => { setSure(null); onSave(list.filter((x) => x.id !== r.id)); }}>forget</button><button className="wlink" onClick={() => setSure(null)}>keep</button></span>
              : <button className="wlink" aria-label={`forget ${r.name}`} onClick={() => setSure(r.id)}>forget</button>)}
          </div>
        );
      })}
    </div>
    <p className="hint-line">a new room is made from Cowork's side</p>
  </>);
}

// my machines: the Sols this window can pick. A row: its name (renamed in place), its address, use it, remove it.
function Machines({ team, onSave }: { team: Team | null; onSave: (m: Machine[]) => void }) {
  const list = team?.machines ?? [];
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [bad, setBad] = useState("");
  const [sure, setSure] = useState<string | null>(null);
  const nameIn = useRef<HTMLInputElement>(null);
  const add = () => {
    const u = url.trim();
    if (!/^wss?:\/\/[^\s/]+(\/\S*)?$/.test(u)) return setBad("an address starts with ws:// or wss://");
    if (list.some((m) => sameEngine(m.url, u))) return setBad("that one is already in the list");
    onSave([...list, { name: name.trim() || base(u), url: u }]);
    setName(""); setUrl(""); setBad(""); nameIn.current?.focus();
  };
  // an empty list still has this Mac, and the far Sol when the window knows one
  const rows = list.length ? list : [{ name: "this Mac", url: NEXT }, ...(sameEngine(LIVE, NEXT) ? [] : [{ name: FAR_NAME, url: LIVE }])];
  return (<>
    <p className="hint-line top">the Sols this window can use; switching reloads the window</p>
    <div className="ctl-machines">
      {rows.map((m, i) => {
        const here = sameEngine(m.url, ENGINE);
        return (
          <div key={m.url} className={`ctl-machine ${here ? "here" : ""}`}>
            {list.length ? <Field value={m.name} onSave={(v) => onSave(list.map((x, j) => (j === i ? { ...x, name: v || base(x.url) } : x)))} /> : <span className="ctl-mname">{m.name}</span>}
            <span className="ctl-addr mono" title={m.url}>{base(m.url)}</span>
            {here ? <span className="ctl-here">in use</span> : <button className="wlink" onClick={() => pickEngine(m.url)}>use</button>}
            {list.length > 0 && (sure === m.url
              ? <span className="wsure"><button className="wlink danger" onClick={() => { setSure(null); onSave(list.filter((x) => x.url !== m.url)); }}>remove</button><button className="wlink" onClick={() => setSure(null)}>keep</button></span>
              : <button className="wlink" aria-label={`remove ${m.name}`} disabled={here} title={here ? "in use: switch first" : undefined} onClick={() => setSure(m.url)}>×</button>)}
          </div>
        );
      })}
    </div>
    <div className="ctl-add">
      <input ref={nameIn} className="wfield ctl-add-name" value={name} placeholder="name" spellCheck={false} onChange={(e) => setName(e.target.value)} />
      <input className="wfield" value={url} placeholder="wss://machine.example.ts.net/" spellCheck={false} onChange={(e) => { setUrl(e.target.value); setBad(""); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
      <button className="wbtn" disabled={!team || !url.trim()} onClick={add}>add</button>
    </div>
    {bad && <p className="hint-line stale">{bad}</p>}
    {!list.length && team && <p className="hint-line">your list is empty; this Mac stays offered</p>}
  </>);
}
