import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

// The Settings shell (2026-10-27, Marco's "hyper intuitive, everything easy to find, icons and visuals"): a rail on the
// left, grouped, one icon per section, each with a peek at what it is set to now, and a search over every row; the
// pane on the right shows one section. The drawers (Settings, Control, Work) stay as they were written: a Drawer
// inside the shell registers its name and draws only when it is the one picked. Map: sol/design/maps/settings.html.

export type IconName = "me" | "key" | "screens" | "agent" | "shield" | "chip" | "wave" | "mic" | "music" | "palette"
  | "branch" | "copies" | "session" | "bell" | "power" | "pulse" | "tools" | "search" | "dot";

const P: Record<IconName, ReactNode> = {
  me: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16.5 6.5l3 3M14 9l2 2" /></>,
  screens: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  agent: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" /><path d="M12 7.5l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z" /></>,
  shield: <><path d="M12 3l7.5 3v5.5c0 4.6-3.2 7.9-7.5 9.5-4.3-1.6-7.5-4.9-7.5-9.5V6z" /><path d="M9 12l2.2 2.2L15.5 10" /></>,
  chip: <><rect x="6.5" y="6.5" width="11" height="11" rx="2" /><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21" /></>,
  wave: <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  music: <><path d="M9 18V5.5l11-2.5v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.9-.8 1.9-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1 .8-1.8 1.9-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7" r="1" /></>,
  branch: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 7v10M18 8v1.5a4 4 0 0 1-4 4H9a3 3 0 0 0-3 3" /></>,
  copies: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  session: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7 10l3 2.5L7 15M12.5 15H17" /></>,
  bell: <><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  power: <><path d="M12 3v8" /><path d="M7 6.3a7.5 7.5 0 1 0 10 0" /></>,
  pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  tools: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.6-4.6" /></>,
  dot: <circle cx="12" cy="12" r="3" />,
};
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <svg className="sicon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>;
}

// every section the page knows: its rail group, icon, title, one line of what it is for, and the words a search finds
// it by (the row labels inside, and the words a person would type). A drawer missing here still shows, under "more".
type Sec = { group: string; icon: IconName; title: string; line: string; words: string };
export const SECTIONS: Record<string, Sec> = {
  "me": { group: "you", icon: "me", title: "me", line: "your name, your sign-ins and the rooms you are in", words: "name github org sol google sign in rooms room forget profile login" },
  "my accounts": { group: "you", icon: "key", title: "accounts", line: "Claude and Codex on this machine, and which one answers a new chat", words: "claude code codex sign in subscription who answers new chat session seat login" },
  "my machines": { group: "you", icon: "screens", title: "machines", line: "the Sols this window can use; switching reloads the window", words: "machine nucbox mac address wss add remove use switch engine computer" },
  "my agent": { group: "your agent", icon: "agent", title: "my agent", line: "where it may speak for you, and which pings it brings to you", words: "github cowork discord whatsapp speak post sign signed pings dials clash contract claim decision named chat card" },
  "what leaves this machine": { group: "your agent", icon: "shield", title: "what leaves", line: "what stays on this Mac, and the few things that may go", words: "privacy prompts memory transcripts audit share room sessions show quiet sign-ins logins browser cookies data" },
  "defaults": { group: "chats", icon: "chip", title: "models", line: "the model and effort a new conversation starts with", words: "model effort codex claude opus sonnet gpt default work may permission mode plan bypass accept edits auto" },
  "voice": { group: "chats", icon: "wave", title: "voice", line: "how Sol sounds when it talks, and when it answers", words: "voice speak sound patience pause language english dutch cantonese hear sample gemini" },
  "microphone": { group: "chats", icon: "mic", title: "microphone", line: "which input Sol hears", words: "mic microphone input audio device allow record dictation" },
  "look": { group: "look", icon: "palette", title: "look", line: "the window's colour, the glass, and your bubble", words: "colour color base opacity transparency blur glass bubble text size font theme appearance dark" },
  "music": { group: "look", icon: "music", title: "music", line: "vibe mode: Sol's colours moving with what this Mac plays", words: "vibe music sound screen frame ring glow colours size brightness beat" },
  "work": { group: "work", icon: "branch", title: "folders & branches", line: "where side copies live, where new sessions start, branch names and tidying up", words: "side copies folder worktree new sessions start branch prefix archive pull request untouched" },
  "sessions": { group: "work", icon: "session", title: "sessions", line: "what a Claude session may do, and how it writes", words: "suggested prompts box tab browser drive pages output style writing" },
  "side copies": { group: "work", icon: "copies", title: "side copies", line: "the scratch copies sessions work in, and what they hold", words: "worktree copies stale remove clean disk size transcripts" },
  "pings": { group: "work", icon: "bell", title: "pings", line: "how a session gets your attention when Sol is not in front", words: "notification badge banner bounce dock sound permission question turn done" },
  "machine": { group: "system", icon: "power", title: "awake & log", line: "keep the machine awake while a session works; versions and the log", words: "awake caffeinate battery sleep versions node sdk claude code log machine" },
  "engine": { group: "system", icon: "pulse", title: "engine", line: "is Sol running, which one this window uses, and the way back", words: "engine status up down which address face hot bundled go back gemini key dictation error" },
  "my tools": { group: "system", icon: "tools", title: "tools", line: "the skills, plugins and servers Claude Code loads", words: "skills plugins agents mcp servers tools" },
};
const ORDER = Object.keys(SECTIONS);

type Shell = { sel: string; add: (n: string) => () => void };
const ShellCtx = createContext<Shell | null>(null);
export const useShell = () => useContext(ShellCtx);

// a drawer in the shell: registers, and draws as the pane when it is the one picked
export function ShellSection({ name, children }: { name: string; children: ReactNode }) {
  const sh = useShell()!;
  useLayoutEffect(() => sh.add(name), [sh.add, name]); // eslint-disable-line react-hooks/exhaustive-deps
  if (sh.sel !== name) return null;
  const m = SECTIONS[name];
  return (
    <section className="spane" data-name={name}>
      <header className="sp-head">
        <span className="sp-ic"><Icon name={m?.icon ?? "dot"} size={22} /></span>
        <div><h2>{m?.title ?? name}</h2>{m?.line && <p>{m.line}</p>}</div>
      </header>
      <div className="sp-body">{children}</div>
    </section>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function SettingsShell({ open, setOpen, peek, top, children }: {
  open: string; setOpen: (n: string) => void;
  peek?: Record<string, ReactNode>;   // a small sign of what a section is set to now, beside its name in the rail
  top?: ReactNode;                    // a line over the pane (the engine is down, or older than this window)
  children: ReactNode;
}) {
  const [names, setNames] = useState<string[]>([]);
  const add = useCallback((n: string) => {
    setNames((ns) => (ns.includes(n) ? ns : [...ns, n]));
    return () => setNames((ns) => ns.filter((x) => x !== n));
  }, []);
  const [q, setQ] = useState("");
  const terms = norm(q).split(" ").filter(Boolean);
  const ordered = useMemo(() => [...names].sort((a, b) => (ORDER.indexOf(a) + 1 || 999) - (ORDER.indexOf(b) + 1 || 999)), [names]);
  const finds = (n: string) => { const m = SECTIONS[n]; const hay = norm(`${n} ${m?.title ?? ""} ${m?.group ?? ""} ${m?.words ?? ""} ${m?.line ?? ""}`); return terms.every((t) => hay.includes(t)); };
  const shown = ordered.filter(finds);
  const sel = names.includes(open) ? open : ordered[0] ?? open;
  const shell = useMemo(() => ({ sel, add }), [sel, add]);

  // a search moves the pane to the first section it finds, unless the one open is a find
  useEffect(() => { if (terms.length && shown.length && !shown.includes(sel)) setOpen(shown[0]); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  // and lights the rows in the pane that say the words
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pane.current; if (!el) return;
    const rows = el.querySelectorAll<HTMLElement>(".field-r, .vcard, .ctl-sub, .ctl-machine, .wcopy");
    let first: HTMLElement | null = null;
    rows.forEach((r) => {
      const hit = terms.length > 0 && terms.some((t) => norm(r.textContent ?? "").includes(t));
      r.classList.toggle("hit", hit);
      if (hit && !first) first = r;
    });
    if (first) (first as HTMLElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [q, sel, names.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "f") { ev.preventDefault(); search.current?.focus(); search.current?.select(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const step = (d: number) => { const i = shown.indexOf(sel); const n = shown[(i + d + shown.length) % shown.length]; if (n) setOpen(n); };

  let last = "";
  return (
    <ShellCtx.Provider value={shell}>
      <div className="settings-shell">
        <nav className="srail" aria-label="settings sections" onKeyDown={(ev) => {
          if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); step(ev.key === "ArrowDown" ? 1 : -1); }
        }}>
          <label className="ssearch">
            <Icon name="search" size={14} />
            <input ref={search} value={q} placeholder="search settings" spellCheck={false} aria-label="search settings"
              onChange={(ev) => setQ(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && shown[0]) setOpen(shown[0]);
                if (ev.key === "Escape" && q) { ev.stopPropagation(); ev.nativeEvent.stopImmediatePropagation(); setQ(""); }
              }} />
            <kbd>⌘F</kbd>
          </label>
          <div className="sitems">
            {shown.map((n) => {
              const m = SECTIONS[n], g = m?.group ?? "more";
              const head = g !== last ? <div className="sgroup" key={`g-${g}`}>{g}</div> : null;
              last = g;
              return [head,
                <button key={n} className={`sitem ${n === sel ? "on" : ""}`} data-name={n} aria-current={n === sel ? "page" : undefined} onClick={() => setOpen(n)}>
                  <Icon name={m?.icon ?? "dot"} />
                  <span className="st">{m?.title ?? n}</span>
                  {peek?.[n] !== undefined && <span className="speek">{peek[n]}</span>}
                </button>];
            })}
            {!shown.length && <p className="snone">nothing called “{q}”</p>}
          </div>
        </nav>
        <div className="spane-wrap" ref={pane}>
          {top}
          {children}
        </div>
      </div>
    </ShellCtx.Provider>
  );
}

// on or off, as a switch you flick (role="switch", so a screen reader says it the same way)
export function Switch({ on, set, disabled, label }: { on: boolean; set: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => set(!on)}>
      <i />
    </button>
  );
}

