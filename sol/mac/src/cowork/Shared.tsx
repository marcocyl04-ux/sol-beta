// Shared with me (Together, Share #36, PROTOCOL.md round 23): the team's things, read from the team's repositories
// and never from anyone's home. Per repository: product memory (README, now, GLOSSARY, docs/), designs (sol/design,
// its folders as groups, images as tiles) and the desk cards made for the team (sol/design/shared, from everyone's
// `<login>/shared` branch). Each row is signed by whoever moved it last, and says when.
// Opening one fills the pane at the right: a file of my own checkout in the file pane (editable, it is mine); a page
// from GitHub read-only; an image inline; an html page in the browser pane; a card on a desk of its own, read-only,
// with the signature of who shared it (what I do on it stays here and reaches no one).
// `?dev=share` (vite dev only) draws two repositories, six memory pages, four designs and three cards from frank and
// isaac; nothing is asked of the engine for them.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { link } from "../socket";
import { ENGINE, fileUrl, type Card as DeskCard, type useEngine } from "../useEngine";
import { html } from "../Message";
import { Fold } from "../MotionKit";
import { CFG, stagger } from "../motion";
import { PaneFrame, PaneBody, Empty } from "../work/Panes";
import { button } from "../buttons";
import { FilePane } from "../work/FilePane";
import { Desk } from "../Desk";
import { Browser } from "../Browser";
import type { Work } from "../work/useWork";
import type { Sign, Team } from "./useTeam";
import { Sig, since, readAgo } from "./bits";
import "./shared.css";

export type Kind = "md" | "image" | "html" | "json" | "other";
export type Entry = { path: string; title: string; kind: Kind; by?: Sign; at?: string; group?: string; local?: string; ref?: string; thumb?: string };
export type RepoShare = { repo: string; from: "checkout" | "github"; folder?: string; memory: Entry[]; designs: Entry[]; cards: Entry[]; error?: string };
type Opened = { text?: string; image?: string; url?: string; card?: DeskCard; local?: string; error?: string };
type Open = { repo: string; e: Entry; from: RepoShare["from"]; got?: Opened };

export const DEV_SHARE = import.meta.env.DEV && new URLSearchParams(location.search).getAll("dev").includes("share");
const BROWSER_SESSION = "cowork-shared";   // the browser pane's tabs for shared pages: their own, never a session's

// ---- one small store both halves read: the list (the stage) and what is open (the pane) ----
type St = { repos: RepoShare[]; at: number; reading: boolean; error?: string; open: Open | null };
let st: St = { repos: [], at: 0, reading: false, open: null };
const subs = new Set<() => void>();
const set = (p: Partial<St>) => { st = { ...st, ...p }; for (const f of subs) f(); };
const useSt = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);

let heard = false;
function hear() {
  if (heard || DEV_SHARE) return;
  heard = true;
  // the engine sends the list again whenever it reads it anew (a teammate pushed, the minute is up)
  link(ENGINE).on((m) => { if (m?.type === "team.shared" && !m.rid && Array.isArray(m.repos)) set({ repos: m.repos, at: m.at ?? Date.now(), error: m.error }); });
}
async function read(team: Team, refresh = false) {
  if (DEV_SHARE) { set({ repos: FAKE, at: Date.now() - (refresh ? 0 : 4 * 60_000) }); return; }
  set({ reading: true });
  const r = await team.ask<{ repos?: RepoShare[]; at?: number; error?: string }>("team.shared", refresh ? { refresh: true } : {}, 120_000);
  set({ reading: false, ...(Array.isArray(r.repos) ? { repos: r.repos, at: r.at ?? Date.now() } : {}), error: r.error });
}
async function open(team: Team, rs: RepoShare, e: Entry) {
  const o: Open = { repo: rs.repo, e, from: rs.from };
  set({ open: o });
  const got: Opened = DEV_SHARE ? fakeOpen(e) : await team.ask<Opened>("team.shared.open", { repo: rs.repo, path: e.path, ...(e.ref ? { ref: e.ref } : {}) }, 60_000);
  if (st.open === o) set({ open: { ...o, got } });
}
export const closeShared = () => set({ open: null });

const KIND_WORD: Record<Kind, string> = { md: "page", image: "image", html: "html", json: "card", other: "file" };
const CARD_WORD: Record<string, string> = { note: "note", flashcards: "cards", question: "question", exam: "exam", timer: "timer", board: "board" };
const short = (repo: string) => repo.split("/")[1] ?? repo;
const dir = (p: string) => p.split("/").slice(0, -1).join("/");
const newest = (xs: Entry[]) => xs.reduce<string | undefined>((m, x) => (x.at && (!m || x.at > m) ? x.at : m), undefined);
const thumbOf = (e: Entry) => e.thumb ?? (e.local && e.kind === "image" ? fileUrl(`/pane-image?path=${encodeURIComponent(e.local)}`) : undefined);

// an image from the engine: crossOrigin so the page's Origin goes with it, the way Desk.tsx asks for a page's picture
const Img = ({ src, alt, lazy }: { src?: string; alt: string; lazy?: boolean }) => <img src={src} alt={alt} crossOrigin="anonymous" loading={lazy ? "lazy" : undefined} />;

// ---- the stage: the list ----
export function Shared({ team }: { team: Team }) {
  const s = useSt();
  useEffect(() => { hear(); if (!st.at || Date.now() - st.at > 60_000) void read(team); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (list.current) stagger(list.current.children, { y: 12, cfg: CFG.slide, gap: 40, max: 6 }); }, [s.repos.length]);
  const count = s.repos.reduce((n, r) => n + r.memory.length + r.designs.length + r.cards.length, 0);
  return (
    <div className="cpage cshared">
      <header className="chead1">
        <h2>shared with me</h2>
        <span className="cdim">{s.reading && !s.at ? "reading the team's repositories…" : s.at ? `${count} things in ${s.repos.length} ${s.repos.length === 1 ? "repository" : "repositories"} · ${readAgo(s.at)}` : ""}</span>
        <span className="cgrow1" />
        <button className="cbtn ghost" onClick={() => void read(team, true)} disabled={s.reading} title="read the team's repositories again">{s.reading ? "reading…" : "read again"}</button>
      </header>
      {s.error && <p className="shwrong">{s.error}</p>}
      {!s.repos.length && s.at > 0 && <p className="cnone">the team has no repositories yet (Settings, the team)</p>}
      <div ref={list} className="shrepos">
        {s.repos.map((r) => <RepoBlock key={r.repo} r={r} team={team} openPath={s.open?.repo === r.repo ? s.open.e.path + (s.open.e.ref ?? "") : ""} />)}
      </div>
    </div>
  );
}

function RepoBlock({ r, team, openPath }: { r: RepoShare; team: Team; openPath: string }) {
  const groups = new Map<string, Entry[]>();
  for (const e of r.designs) { const g = e.group ?? ""; groups.set(g, [...(groups.get(g) ?? []), e]); }
  const go = (e: Entry) => void open(team, r, e);
  return (
    <section className="shrepo">
      <header className="shrhead">
        <h3>{short(r.repo)}</h3>
        <span className="cdim">{r.repo}</span>
        <span className="shfrom" title={r.folder ?? ""}>{r.from === "checkout" ? "from your checkout" : "from GitHub"}</span>
      </header>
      {r.error && <p className="shwrong">{r.error}</p>}
      <div className="shcols">
        <div className="shcol">
          <h4 className="csub">product memory</h4>
          {!r.memory.length ? <p className="cnone">no memory pages</p> : <ul className="shrows">{r.memory.map((e) => <Row key={e.path} e={e} on={openPath === e.path} onOpen={() => go(e)} />)}</ul>}
          <h4 className="csub">from the desk</h4>
          {!r.cards.length ? <p className="cnone">no cards shared yet</p> : (
            <ul className="shrows">{r.cards.map((e) => <Row key={e.path + (e.ref ?? "")} e={e} on={openPath === e.path + (e.ref ?? "")} onOpen={() => go(e)} card />)}</ul>
          )}
        </div>
        <div className="shcol">
          <h4 className="csub">designs <small>{r.designs.length}</small></h4>
          {!r.designs.length ? <p className="cnone">no designs</p> : (
            <ul className="shgroups">{[...groups].map(([g, xs], i) => <Group key={g} name={g} xs={xs} first={i === 0 && groups.size < 4} openPath={openPath} onOpen={go} />)}</ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ e, on, onOpen, card }: { e: Entry; on: boolean; onOpen: () => void; card?: boolean }) {
  const sub = card ? `${e.ref ? `on ${e.ref}` : "on main"}` : e.path;
  return (
    <li className={`shrow ${on ? "on" : ""}`} onClick={onOpen} title={e.path}>
      <span className={`shk ${e.kind}`}>{card ? "card" : KIND_WORD[e.kind]}</span>
      <span className="sht"><b>{e.title}</b><small>{sub}</small></span>
      <Sig s={e.by} />
      {e.at && <small className="cwhen">{since(e.at)}</small>}
    </li>
  );
}

function Group({ name, xs, first, openPath, onOpen }: { name: string; xs: Entry[]; first: boolean; openPath: string; onOpen: (e: Entry) => void }) {
  const [unfolded, setUnfolded] = useState(first || xs.some((x) => x.path === openPath));
  const imgs = xs.filter((x) => x.kind === "image"), rest = xs.filter((x) => x.kind !== "image");
  const by = [...xs].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))[0]?.by;
  const at = newest(xs);
  return (
    <li className={`shgroup ${unfolded ? "open" : ""}`}>
      <div className="shghead" onClick={() => setUnfolded((o) => !o)}>
        <span className="shcaret" aria-hidden>{unfolded ? "–" : "+"}</span>
        <span className="sht"><b>{name || "design"}</b><small>{[rest.length && `${rest.length} ${rest.length === 1 ? "page" : "pages"}`, imgs.length && `${imgs.length} ${imgs.length === 1 ? "image" : "images"}`].filter(Boolean).join(" · ")}</small></span>
        <Sig s={by} />
        {at && <small className="cwhen">{since(at)}</small>}
      </div>
      <Fold open={unfolded} lazy>
        <div className="shgbody">
          {rest.length > 0 && <ul className="shrows">{rest.map((e) => <Row key={e.path} e={e} on={openPath === e.path} onOpen={() => onOpen(e)} />)}</ul>}
          {imgs.length > 0 && (
            <div className="shtiles">
              {imgs.slice(0, 60).map((e) => {
                const t = thumbOf(e);
                return (
                  <button key={e.path} className={`shtile ${openPath === e.path ? "on" : ""}`} onClick={() => onOpen(e)} title={`${e.path}${e.by ? ` · ${e.by.login}${e.by.agent ? "'s agent" : ""}` : ""}`}>
                    {t ? <Img src={t} alt={e.path} lazy /> : <span className="shnothumb">{e.path.split(".").pop()}</span>}
                    <small>{e.title}</small>
                  </button>
                );
              })}
              {imgs.length > 60 && <p className="cnone">and {imgs.length - 60} more in {dir(imgs[60].path)}</p>}
            </div>
          )}
        </div>
      </Fold>
    </li>
  );
}

// ---- the pane at the right: what is open ----
type Eng = ReturnType<typeof useEngine>;
export function SharedPane({ e, w, folders }: { e: Eng; w: Work; folders: Record<string, string> }) {
  const s = useSt();
  const o = s.open, got = o?.got;
  const [frac, setFrac] = useState(0.44);
  if (!o) return <PaneFrame open={false} frac={frac} onFrac={setFrac} tabs={[]} active={null} onPick={() => {}} onClose={() => {}}>{null}</PaneFrame>;
  const body = <Opened o={o} e={e} w={w} folders={folders} frac={frac} onFrac={setFrac} />;
  if (got?.card) return <div className="shwrap shdesk" style={{ width: `${frac * 100}%` }}>{body}</div>;
  if (got?.url && !DEV_SHARE) return <div className="shwrap shbrowser" style={{ width: `${frac * 100}%` }}>{body}</div>;
  return (
    <PaneFrame open frac={frac} onFrac={setFrac} tabs={[button("files")!]} active="files" onPick={() => {}} onClose={closeShared}>
      <PaneBody k={o.e.path + (o.e.ref ?? "")} className="shpanebody">{body}</PaneBody>
    </PaneFrame>
  );
}

// the list, and what is opened from it in its place, its × going back: Shared with me as one pane beside a talk in Home
// (buttons/shared.tsx)
export function SharedHere({ team, e, w, folders }: { team: Team; e: Eng; w?: Work; folders: Record<string, string> }) {
  const o = useSt().open;
  return o ? <div className="shpanebody"><Opened o={o} e={e} w={w} folders={folders} frac={1} onFrac={() => {}} /></div> : <Shared team={team} />;
}

// what is open, under its head: a card on a desk of its own, an html page in the browser in its own tabs, a file of my
// own checkout in the file pane (editable), else a page read from GitHub or the image itself
function Opened({ o, e, w, folders, frac, onFrac }: { o: Open; e: Eng; w?: Work; folders: Record<string, string>; frac: number; onFrac: (f: number) => void }) {
  const got = o.got;
  const asked = useRef("");
  useEffect(() => {
    if (!got?.url || DEV_SHARE || asked.current === got.url) return;
    asked.current = got.url;
    // the same page opened again goes back to its tab rather than a second one
    const had = e.tabs.find((t) => t.sessionId === BROWSER_SESSION && t.url.replace(/^file:\/\//, "") === got.url!.replace(/^file:\/\//, ""));
    e.send(had ? { type: "browser.select", tab: had.id } : { type: "browser.open", url: got.url, sessionId: BROWSER_SESSION });
  }, [got?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const head = <Head o={o} />;
  const max = frac === 1 ? 1 : 0.72;
  if (got?.card) return <>{head}<Desk cards={[got.card]} busy={false} frac={frac} maxFrac={max} onFrac={onFrac} onMark={() => {}} act={(_id, act) => { if (act === "close") closeShared(); }} /></>;
  if (got?.url && !DEV_SHARE) return <>{head}<Browser tabs={e.tabs} sessionId={BROWSER_SESSION} send={e.send} subscribe={e.subscribeFrames} onMark={() => {}} frac={frac} onFrac={onFrac} maxFrac={max} /></>;
  const mine = !!got?.local && o.from === "checkout" && o.e.kind !== "html";
  return (<>
    {head}
    {!got ? <Empty>opening {o.e.title}…</Empty>
      : got.error ? <p className="shwrong">{got.error}</p>
      : mine && w ? <FilePane w={w} cwd={folders[o.repo]} at={{ path: got.local!, n: 1 }} onAttach={() => {}} flash={e.flash} />
      : got.image ? <div className="shimage"><Img src={fileUrl(got.image)} alt={o.e.title} /></div>
      : got.url ? <Empty>this page opens in the browser pane outside the dev view</Empty>
      : got.text !== undefined ? (o.e.kind === "md" ? <div className="md shmd" dangerouslySetInnerHTML={{ __html: html(got.text) }} /> : <pre className="shpre">{got.text}</pre>)
      : <Empty>nothing to show</Empty>}
  </>);
}

function Head({ o }: { o: Open }) {
  const mine = o.from === "checkout" && !!o.got?.local && o.e.kind !== "html";
  const what = o.got?.card ? `${CARD_WORD[o.got.card.kind] ?? "card"} from` : "shared by";
  return (
    <div className="shhead">
      <span className="sht"><b>{o.e.title}</b><small>{short(o.repo)} · {o.e.path}{o.e.ref ? ` · ${o.e.ref}` : ""}</small></span>
      {o.e.by && <span className="shby">{what} <Sig s={o.e.by} /></span>}
      <span className={`shmode ${mine ? "mine" : ""}`}>{mine ? "your checkout" : "read-only"}</span>
      <button className="wlink" onClick={closeShared} aria-label="close">×</button>
    </div>
  );
}

// ---- ?dev=share: two repositories, six memory pages, four designs (two images), three cards from frank and isaac ----
const svg = (fg: string, label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900"><rect width="1440" height="900" fill="#f4f2ee"/><rect x="0" y="0" width="272" height="900" fill="#ebe8e2"/><g fill="none" stroke="#1a1a1a" stroke-width="2"><rect x="340" y="120" width="420" height="260" rx="10"/><rect x="800" y="120" width="420" height="260" rx="10"/><rect x="340" y="420" width="880" height="340" rx="10"/></g><g fill="#1a1a1a" font-family="Helvetica" font-size="28"><text x="40" y="70">${label}</text><text x="370" y="170" font-size="20" fill="${fg}">frank</text><text x="830" y="170" font-size="20">isaac</text></g><g fill="#1a1a1a">${Array.from({ length: 9 }, (_, i) => `<rect x="${370 + (i % 3) * 120}" y="${470 + Math.floor(i / 3) * 90}" width="90" height="60" opacity="${0.15 + (i % 4) * 0.2}"/>`).join("")}</g></svg>`)}`;
const T = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const F = (login: string, agent = false): Sign => ({ login, agent });
const FAKE: RepoShare[] = [
  {
    repo: "marcocyl04-ux/sol-dev", from: "checkout", folder: "~/computer/personal/projects/ecosystem",
    memory: [
      { path: "README.md", title: "Ecosystem", kind: "md", by: F("marco"), at: T(20) },
      { path: "now.md", title: "now", kind: "md", by: F("marco", true), at: T(3) },
      { path: "GLOSSARY.md", title: "Glossary", kind: "md", by: F("frank"), at: T(30) },
      { path: "docs/TOGETHER.md", title: "Together: Sol for a team", kind: "md", by: F("isaac", true), at: T(52) },
    ],
    designs: [
      { path: "sol/design/together/6-share/PRD.md", title: "Share (#36): shared with me. PRD", kind: "md", group: "together/6-share", by: F("marco", true), at: T(5) },
      { path: "sol/design/together/6-share/shots/01-shared-side.png", title: "01-shared-side", kind: "image", group: "together/6-share", by: F("frank"), at: T(2), thumb: svg("#b07a1f", "shared with me") },
      { path: "sol/design/together/1-see/shots/02-board.png", title: "02-board", kind: "image", group: "together/1-see", by: F("isaac", true), at: T(26), thumb: svg("#1a1a1a", "the action board") },
      { path: "sol/design/look/board.html", title: "The board, drawn", kind: "html", group: "look", by: F("frank", true), at: T(70) },
    ],
    cards: [
      { path: "sol/design/shared/contracts-set.json", title: "Contracts", kind: "json", ref: "frank/shared", by: F("frank", true), at: T(1) },
      { path: "sol/design/shared/team-line.json", title: "How the team's line works", kind: "json", ref: "frank/shared", by: F("frank", true), at: T(9) },
      { path: "sol/design/shared/why-stable.json", title: "Why stable?", kind: "json", ref: "isaac/shared", by: F("isaac", true), at: T(28) },
    ],
  },
  {
    repo: "marcocyl04-ux/council", from: "github",
    memory: [
      { path: "README.md", title: "Council", kind: "md", by: F("isaac"), at: T(40) },
      { path: "docs/how-we-decide.md", title: "How we decide", kind: "md", by: F("frank", true), at: T(100) },
    ],
    designs: [],
    cards: [],
  },
];
const MD: Record<string, string> = {
  "README.md": "# Ecosystem\n\nMarco's productivity system, worked on by a team since 2026-10-19.\n\n- **Sol**: the companion, on every machine\n- **Cowork**: work with others\n- **Shared with me**: the team's memory, designs and cards in one place\n",
  "now.md": "# now\n\nWave 2 of Together is being built: Hand, Try, Share, Talk.\n",
  "GLOSSARY.md": "# Glossary\n\n**stable**: the version everyone runs.\n\n**shared with me**: the team's things, read from the repositories.\n",
  "docs/TOGETHER.md": "# Together: Sol for a team\n\nEach person keeps their own home. What the team shares lives in the repositories: product memory, designs, and cards made on the desk for the others.\n",
  "sol/design/together/6-share/PRD.md": "# Share (#36): shared with me. PRD\n\n\"like google drive, easy to remember\" (Marco).\n\n## What it is\n\n1. **product memory**\n2. **designs**\n3. **desk cards made for the team**\n",
  "docs/how-we-decide.md": "# How we decide\n\nOne issue, one owner. A decision is a line where its subject lives.\n",
};
const CARDS: Record<string, DeskCard> = {
  "sol/design/shared/contracts-set.json": { id: "contracts-set", kind: "flashcards", title: "Contracts", at: 0, cards: [
    { front: "What is consideration?", back: "Something of value bargained for by each side." },
    { front: "Offer and acceptance must…", back: "…match: the mirror image rule." },
    { front: "Is a promise to make a gift binding?", back: "No: there is no consideration." },
  ] },
  "sol/design/shared/team-line.json": { id: "team-line", kind: "note", title: "How the team's line works", at: 0, text: "## How the team's line works\n\nEvery machine keeps one line open to the team. A push says **changed**; every face reads the board again.\n\n- presence: who is here\n- a ping: someone asks for you\n" },
  "sol/design/shared/why-stable.json": { id: "why-stable", kind: "question", title: "Why stable?", at: 0, prompt: "Why does everyone run stable rather than main?", choices: ["main is slower", "stable is the version someone checked end to end", "stable has more features"], answer: "stable is the version someone checked end to end", explain: "main moves with every merge; stable moves when it is stamped." },
};
function fakeOpen(e: Entry): Opened {
  if (e.kind === "json") return CARDS[e.path] ? { card: CARDS[e.path] } : { error: "that is not a desk card" };
  if (e.kind === "image") return { image: e.thumb };
  if (e.kind === "html") return { url: "file:///fake/board.html" };
  return { text: MD[e.path] ?? `# ${e.title}\n` };   // the dev list is drawn, never read from disk
}
