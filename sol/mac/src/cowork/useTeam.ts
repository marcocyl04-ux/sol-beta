// Cowork's state (Together, See #31): the team (me, the settings without the key, the roster, the relay's link) and
// the board, on the page's one link to the engine (socket.ts), like useWork. PROTOCOL.md round 17.
// `?dev=team` (vite dev only) fakes all of it: me marco, a roster of marco / frank / isaac, eight cards across the
// columns, frank's page, one room (`&rooms=2`: two, so the room switch shows; the second carries a share code;
// `&groups=0`: none, the first-time page, signed in to Sol's cloud, #314; `&signedin=0`: a link's card peeks a group
// with no Sol account here, #342). It only replaces what the panes draw; nothing is sent.
import { useCallback, useEffect, useRef, useState } from "react";
import { link } from "../socket";
import { ENGINE } from "../useEngine";
import type { WorkSession } from "../work/useWork";

export type Presence = "here" | "elsewhere" | "away" | "working" | "yourcall";
export type Member = { who: string; agent: boolean; machine: string; state: Presence; session?: { title: string; repo?: string }; since: number;
  thing?: { id: string; name: string; source: "face" | "agent"; at: number }; sessions?: { id: string; title: string; thing?: string }[];   // what they are in, in this room (round 44)
  quiet?: true };   // they turned "show my room sessions" off in this room (#238): their sessions do not show here
export type Column = "waiting" | "branch" | "pr" | "main" | "stable" | "closed";
export type Sign = { login: string; agent: boolean };
export type Card = {
  repo: string; number: number; title: string; state: "open" | "closed"; labels: string[]; assignees: string[]; author: string;
  created: string; closed?: string; milestone?: string; url: string; column: Column; domain?: string; pr?: number; branch?: string; sign?: Sign;
};
export type PR = {
  repo: string; number: number; title: string; draft: boolean; state: "open" | "closed" | "merged"; head: string; base: string;
  author: string; agent: boolean; mergedAt?: string; review?: string; updated?: string; url: string;
  note?: string; mark?: Mark; flippedBy?: string;   // the test note (#100): what to try, felt or silent, who flipped it
  areas?: string[];   // the labels its files are in, by CODEOWNERS (#98)
};
export type Mark = "felt" | "silent" | "";
/** a ping that reached me as a card (#100): one card each, closed one at a time, never a gate */
export type PingKind = "clash" | "contract" | "claim" | "decision" | "chat" | "alert";   // alert: the cloud's on-call, its admins only (#225)
export const PING_WORD: Record<PingKind, string> = { clash: "a clash", contract: "a contract changed", claim: "a claim", decision: "a decision", chat: "named you", alert: "the cloud" };
/** a friend who typed a room's code and waits for my one press to be let into its repository (the review of #162) */
/** github (#325): a cloud group's ask, the GitHub name the asker gave; login is then their name in the group */
export type Waiting = { room: string; name: string; login: string; repos: string[]; at: number; github?: string };
export type Pinged = { id: string; kind: PingKind; from: Sign; line: string; at: number; issue?: number; repo?: string; spooled?: boolean; count?: number };   // spooled, count: kept by the hub while I was away (#102)
export type Board = {
  repos: string[]; cards: Card[]; prs: PR[]; stable: Record<string, string>; main: Record<string, string>; at: number; folders: Record<string, string>; error?: string;
  leads?: Record<string, Record<string, string[]>>;   // repo -> label -> who leads it, from CODEOWNERS (#117)
  owner?: Record<string, boolean>;                    // repo -> am I its owner, who sets the leads with one press
};
/** the six labels, in the order CODEOWNERS and the tile say them */
export const LABELS = ["life", "work", "cowork", "social", "base", "product"];
/** who leads a label in the board's first repo that says (#117) */
export const leadsOf = (b: Board | null, label: string, repo?: string): string[] => {
  const r = repo ?? b?.repos.find((x) => b?.leads?.[x]);
  return (r && b?.leads?.[r]?.[label]) || [];
};
// a room (#154): a group's record and its people. org, repos and relay above are always the active room's
export type Room = { id: string; name: string; provider: string; org: string; repos: string[]; hub: string; key?: string; code?: string; gate?: "key" | "github"; folder?: string; mine?: boolean; joined?: boolean; quiet?: true };   // key: "set" or "", never the key; code: its share code (#157), "" until shared; gate: how its hub knows me; folder: where Sol cloned its repository (#162), "" until it did; mine: its repos are my own words (#162); joined: a code I typed brought it (#162)
export type TeamSettings = {
  me: { login: string; name: string }; org: string; repos: string[]; relay: { url: string; key: string; host: boolean; open?: boolean };   // open (#157): the beta's hub, anyone signed in to GitHub
  speak: Record<string, unknown>; leaves: Record<string, unknown>; seats: Record<string, unknown>; machines: { name: string; url: string }[];
  rooms: Room[]; room: string;
};
// members (#102): the team, derived: the GitHub org's members when an org is set, else who has been seen on the relay
// hub (#157): the shared hub every beta room meets on, where a new room meets unless the person blanks it
export type TeamState = { me: { login: string; name: string }; settings: TeamSettings; roster: Member[]; members: string[]; relay: { url: string; up: boolean }; hub?: string; cloud?: Cloud };
/** my Sol account on the shared hub (S6b): its name, "" when not signed in; need: the room in use meets there and I am not
 *  let in; gone: the cloud has no room with the room's code */
export type Cloud = { hub: string; login: string; need: boolean; gone?: boolean };
export type LogLine = { at: string; kind: "issue" | "comment" | "pr" | "commit" | "hand"; repo: string; text: string; url?: string; number?: number; sign: Sign };
export type MemberPage = { plan?: string; log: LogLine[]; error?: string };
// --- Show (#101): a session someone is showing to the team, and its lines (the engine keeps the last 200 in memory)
export type ShownLine = { role: "person" | "agent" | "tool"; text: string; at: number };
export type Showing = { login: string; issue: number; repo: string; session: { id: string; title: string }; scope?: "room"; thing?: string };   // scope room: a room session (#238), issue 0
export type ShownMsg = Showing & { event: "start" | "line" | "end"; line?: ShownLine };

export const DEV_TEAM = import.meta.env.DEV && new URLSearchParams(location.search).get("dev") === "team";

/** a person's signature: amber words wherever something moved (BUILD.md) */
export const signOf = (s: Sign) => (s.agent ? `${s.login}'s agent` : s.login);

// the team and the board as last told, kept across mode switches: Cowork's tree is unmounted when another mode is
// picked, and came back with no cards until the engine answered again (up to ~1 s). A mount paints these at once.
const seen: { state: TeamState | null; board: Board | null } = { state: null, board: null };

export function useTeam() {
  const [state, setState] = useState<TeamState | null>(DEV_TEAM ? FAKE.state : seen.state);
  const [board, setBoard] = useState<Board | null>(DEV_TEAM ? FAKE.board : seen.board);
  useEffect(() => { if (!DEV_TEAM) Object.assign(seen, { state, board }); }, [state, board]);
  const [up, setUp] = useState(DEV_TEAM);
  const [pings, setPings] = useState<Pinged[]>(DEV_TEAM ? FAKE.pings : []);
  const [showing, setShowing] = useState<Showing[]>(DEV_TEAM ? FAKE.showing : []);   // Show (#101): who shows what now
  const [waiting, setWaiting] = useState<Waiting[]>(DEV_TEAM ? FAKE.waiting : []);   // who waits for my press to come in
  const shownSubs = useRef(new Set<(m: ShownMsg) => void>());
  // the hub's word (#223): its light, my place in its queue, "please update"; and every word as it comes (retry, watch)
  const [hub, setHub] = useState<HubNow>({ light: "green", old: false, ...(DEV_TEAM ? { join: true } : {}) });   // ?dev=team: the cloud's page, so S2's link shows
  const hubSubs = useRef(new Set<(m: HubWord) => void>());
  const asks = useRef(new Map<string, (m: any) => void>());
  // ?dev=team: frank's room session says a line every few seconds, as a watched one does
  useEffect(() => {
    if (!DEV_TEAM) return;
    let n = 0;
    const t = window.setInterval(() => {
      const line = DEV_LIVE[n++ % DEV_LIVE.length];
      for (const f of shownSubs.current) f({ login: "frank", issue: 0, repo: "", session: { id: "dev-frank-room", title: "the goal page" }, scope: "room", event: "line", line: { ...line, at: Date.now() } });
    }, 3500);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (DEV_TEAM) return;
    const L = link(ENGINE);
    const offM = L.on((m) => {
      if (typeof m?.type !== "string" || !m.type.startsWith("team.")) return;
      if (m.type === "team.state") setState({ me: m.me, settings: m.settings, roster: m.roster ?? [], members: Array.isArray(m.members) ? m.members : [], relay: m.relay ?? { url: "", up: false }, ...(typeof m.hub === "string" ? { hub: m.hub } : {}), ...(m.cloud && typeof m.cloud.login === "string" ? { cloud: m.cloud } : {}) });
      else if (m.type === "team.board" && Array.isArray(m.cards)) setBoard(m as Board);
      else if (m.type === "team.pinged") {
        const p: Pinged = { id: String(m.id ?? crypto.randomUUID()), kind: m.kind ?? "chat", from: m.from, line: m.line, at: m.at, ...(m.issue ? { issue: m.issue } : {}), ...(m.repo ? { repo: m.repo } : {}), ...(m.spooled ? { spooled: true } : {}), ...(m.count ? { count: Number(m.count) } : {}) };
        setPings((all) => (all.some((x) => x.id === p.id) ? all : [...all, p].slice(-6)));
      }
      else if (m.type === "team.shown") {   // Show (#101): a start or an end changes who is showing; every line goes to the watchers
        const x = m as ShownMsg, same = (s: Showing) => s.login === x.login && s.session.id === x.session.id;
        setShowing((l) => x.event === "end" ? l.filter((s) => !same(s)) : l.some(same) && x.event === "line" ? l
          : [...l.filter((s) => !same(s)), { login: x.login, issue: x.issue, repo: x.repo, session: x.session, ...(x.scope ? { scope: x.scope } : {}), ...(x.thing ? { thing: x.thing } : {}) }]);
        for (const f of shownSubs.current) f(x);
      } else if (m.type === "team.shown.get" && Array.isArray(m.shows) && !m.rid) setShowing(m.shows);
      else if (m.type === "team.letin" && Array.isArray(m.asks)) setWaiting(m.asks);
      else if (m.type === "team.hub") {
        const w = m as HubWord;
        // join (#327): the hub said in its hello that it serves the join page; a hello from one that does not takes it away
        setHub((h) => w.say === "state" ? { light: w.light ?? "green", old: !!w.old, ...(w.join === true ? { join: true } : {}), ...(w.ahead !== undefined ? { queue: { ahead: w.ahead, wait: w.wait ?? 0 } } : {}) }
          : w.say === "hello" ? { ...h, light: w.light ?? h.light, queue: undefined, join: w.join === true }
          : w.say === "light" ? { ...h, light: w.light ?? h.light, queue: undefined }
          : w.say === "queue" ? { ...h, queue: { ahead: w.ahead ?? 0, wait: w.wait ?? 0 } }
          : w.say === "update" ? { ...h, old: true } : h);
        for (const f of hubSubs.current) f(w);
      }
      if (m.rid && asks.current.has(m.rid)) { const f = asks.current.get(m.rid)!; asks.current.delete(m.rid); f(m); }
    });
    // a Cowork face says hello on every link up, and asks for the board
    const offL = L.onLink((u) => { setUp(u); if (u) { L.send({ type: "team.hello" }); L.send({ type: "team.board" }); L.send({ type: "team.shown.get" }); L.send({ type: "team.letin.get" }); } });
    return () => { offM(); offL(); };
  }, []);
  // one question, answered by rid; a silent engine answers { error } after the wait
  const ask = useCallback(<T = any,>(type: string, body: object = {}, wait = 30_000) => new Promise<T>((ok) => {
    if (DEV_TEAM) { ok(fakeAnswer(type, body) as T); return; }
    const rid = crypto.randomUUID();
    asks.current.set(rid, ok);
    if (!link(ENGINE).send({ type, rid, ...body })) { asks.current.delete(rid); ok({ error: "not connected" } as T); return; }
    window.setTimeout(() => { if (asks.current.delete(rid)) ok({ error: "no answer" } as T); }, wait);
  }), []);
  const refresh = useCallback(() => ask("team.board", { refresh: true }, 60_000), [ask]);
  const closePing = useCallback((id: string) => setPings((all) => all.filter((p) => p.id !== id)), []);
  // Show (#101): a watcher hears every line as it comes
  const onShown = useCallback((f: (m: ShownMsg) => void) => { shownSubs.current.add(f); return () => { shownSubs.current.delete(f); }; }, []);
  const onHub = useCallback((f: (m: HubWord) => void) => { hubSubs.current.add(f); return () => { hubSubs.current.delete(f); }; }, []);
  // my press on a card: yes lets that person into the room's repository, no says not now; the card goes either way
  const letIn = useCallback(async (a: Waiting, yes: boolean) => {
    setWaiting((l) => l.filter((x) => !(x.room === a.room && x.login === a.login)));
    // the card as I saw it (#325): the engine refuses a press on an ask that changed under it
    return ask<{ said?: string[]; error?: string }>("team.letin.answer", { room: a.room, login: a.login, github: a.github ?? "", repos: a.repos, yes }, 60_000);
  }, [ask]);
  return { state, board, up, ask, refresh, pings, closePing, me: state?.me.login ?? "", showing, onShown, waiting, letIn, hub, onHub };
}
export type Team = ReturnType<typeof useTeam>;
/** the hub's word to this Sol (#223, PROTOCOL round 41): the light, a queue, a retry, a watch refused, "please update" */
export type HubWord = { say: string; light?: string; old?: boolean; ahead?: number; wait?: number; after?: number; what?: string; ok?: boolean; why?: string; login?: string; session?: string; on?: boolean; join?: boolean };
/** join (#327): the hub in use serves the join page, so a cloud group shows its link */
export type HubNow = { light: string; old: boolean; queue?: { ahead: number; wait: number }; join?: boolean };

// ---- the dev fakes (?dev=team) ----
/** ?dev=team: my sessions in the fake group (#314), so the side's rows under it show */
export const DEV_SESSIONS: WorkSession[] = DEV_TEAM ? [
  { id: "dev-room-1", title: "PRD 改版", cwd: "/Users/marco/Sol/rooms/team", project: "/Users/marco/Sol/rooms/team", updatedAt: Date.now() - 2 * 3_600_000, mode: "cowork", roomId: "team" },
  { id: "dev-room-2", title: "give-up points sheet", cwd: "/Users/marco/Sol/rooms/team", project: "/Users/marco/Sol/rooms/team", updatedAt: Date.now() - 26 * 3_600_000, mode: "cowork", roomId: "team" },
] : [];
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const R = "marcocyl04-ux/sol-dev";
const card = (number: number, title: string, column: Column, o: Partial<Card> = {}): Card => ({
  repo: R, number, title, state: column === "main" || column === "stable" ? "closed" : "open", labels: [], assignees: [], author: "marco",
  created: day(20), url: `https://github.com/${R}/issues/${number}`, column, ...o,
});
const FAKE = {
  state: {
    me: { login: "marco", name: "Marco" },
    settings: { me: { login: "marco", name: "Marco" }, org: "", repos: [R], relay: { url: "", key: "set", host: true }, speak: {}, leaves: {}, seats: {}, machines: [],
      rooms: DEV_TEAM && new URLSearchParams(location.search).get("groups") === "0" ? [] : [{ id: "team", name: "sol-dev", provider: "github", org: "", repos: [R], hub: "", code: "2QKTYA", mine: true, gate: "key" as const },
        ...(DEV_TEAM && new URLSearchParams(location.search).get("rooms") === "2" ? [{ id: "notes", name: "class notes", provider: "drive", org: "", repos: ["1AbCdEfG"], hub: "wss://nucbox.example.ts.net/relay", code: "K7QX2M", gate: "github" as const }] : [])],
      room: "team" },
    roster: [
      { who: "frank", agent: false, machine: "legion", state: "working", session: { title: "the goal page", repo: "ecosystem" }, since: Date.now() - 22 * 60_000,
        thing: { id: "d1b2c3d4", name: "marcocyl04-ux/sol-dev", source: "agent", at: Date.now() - 60_000 }, sessions: [{ id: "dev-frank-room", title: "the goal page", thing: "d1b2c3d4" }] },
      { who: "isaac", agent: false, machine: "thinkpad", state: "here", since: Date.now() - 95 * 60_000, quiet: true },
      { who: "marco", agent: false, machine: "macbook", state: "here", since: Date.now() - 4 * 60_000 },
    ],
    members: ["frank", "isaac", "marco"],
    relay: { url: "", up: true },
    hub: "wss://nucbox.example.ts.net/relay",
    ...(DEV_TEAM && new URLSearchParams(location.search).get("groups") === "0" ? { cloud: { hub: "wss://cloud.matterfold.tech/relay", login: "marco", need: false } } : {}),
  } as TeamState,
  showing: [{ login: "frank", issue: 34, repo: R, session: { id: "dev-frank-34", title: "#34 hand a session" } },
    { login: "frank", issue: 0, repo: "", session: { id: "dev-frank-room", title: "the goal page" }, scope: "room", thing: "d1b2c3d4" }] as Showing[],
  waiting: [{ room: "book-club", name: "Book Club", login: "isaac", repos: ["marco/book-club"], at: Date.now() - 60_000 }] as Waiting[],
  board: {
    repos: [R], stable: { [R]: "7def65e" }, main: { [R]: "7a53b17" }, at: Date.now(), folders: { [R]: "~/computer/personal/projects/ecosystem" },
    leads: { [R]: { life: ["marco"], work: ["frank"], cowork: ["frank", "marco"], social: ["isaac"], base: ["frank"], product: ["isaac", "marco"] } },
    owner: { [R]: true },
    cards: [
      card(36, "Share: product memory, designs and decisions", "waiting", { domain: "product", assignees: ["isaac"], created: day(3) }),
      card(37, "Talk: human to human in Sol", "waiting", { domain: "product", created: day(3) }),
      card(35, "Try and review: run a teammate's branch", "branch", { domain: "product", assignees: ["isaac"], branch: "isaac/35-try", created: day(6), sign: { login: "isaac", agent: false } }),
      card(31, "See: the board and presence", "pr", { domain: "product", assignees: ["marco"], labels: ["now"], pr: 42, branch: "marco/together-see", created: day(2), sign: { login: "marco", agent: true } }),
      card(34, "Hand: give a session, issue or PR to a teammate", "pr", { domain: "product", assignees: ["frank"], pr: 41, branch: "frank/34-hand", created: day(9), sign: { login: "frank", agent: true } }),
      card(26, "Life hands a conversation to Work by a button", "main", { domain: "life", assignees: ["marco"], created: day(14), closed: day(1), pr: 29, sign: { login: "marco", agent: true } }),
      card(17, "One wire: typed messages, one handler table", "stable", { domain: "base", assignees: ["frank"], created: day(26), closed: day(8), pr: 30, sign: { login: "frank", agent: false } }),
      card(27, "The plug scene leaves on its own", "stable", { domain: "base", assignees: ["marco"], created: day(17), closed: day(4), pr: 28, sign: { login: "marco", agent: true } }),
    ],
    prs: [
      { repo: R, number: 41, title: "Hand: give a session to a teammate", draft: false, state: "open", head: "frank/34-hand", base: "main", author: "frank", agent: true, updated: day(0.2), url: "", areas: ["cowork"],
        note: "Hand #34 to me from the card's menu. A card with Take, Pass and Later should come on my side within a second.", mark: "felt" },
      { repo: R, number: 42, title: "See: Cowork, the board and presence", draft: true, state: "open", head: "marco/together-see", base: "main", author: "marco", agent: true, updated: day(0.1), url: "", areas: ["base", "cowork"],
        note: "Nothing to see: the board reads one more field. The tests say it.", mark: "silent", flippedBy: "frank" },
    ],
  } as Board,
  pings: [
    { id: "p1", kind: "decision", from: { login: "frank", agent: true }, line: "a decision on #34: the brief travels, the transcript never", at: Date.now() - 5 * 60_000, issue: 34, repo: R },
    { id: "p2", kind: "chat", from: { login: "isaac", agent: false }, line: "in #35: marco, can you try my branch tonight?", at: Date.now() - 60_000, issue: 35, repo: R },
  ] as Pinged[],
  frank: {
    plan: "# frank's plan\n\n## this week\n\n- **Hand** (#34): the hands record under the board, then the notch card\n- review isaac's Try branch before Thursday\n\n## next\n\n- the council (#38): a first draft of how we decide\n- one evening on the phone's away mode\n\n> I keep this on `frank/plan`. Ask before you take #34.\n",
    log: [
      { at: day(0.05), kind: "pr", repo: R, number: 41, text: "opened PR #41 Hand: give a session to a teammate", sign: { login: "frank", agent: true } },
      { at: day(0.1), kind: "commit", repo: R, text: "hand: the record under the columns", sign: { login: "frank", agent: true } },
      { at: day(0.4), kind: "hand", repo: R, number: 34, text: "**taken** #34 from marco, with the brief", sign: { login: "frank", agent: false } },
      { at: day(1.2), kind: "comment", repo: R, number: 35, text: "ran isaac/35-try on the legion, two remarks inline", sign: { login: "frank", agent: false } },
      { at: day(2), kind: "commit", repo: R, text: "wire: one handler table for team.*", sign: { login: "frank", agent: false } },
      { at: day(8), kind: "pr", repo: R, number: 30, text: "merged PR #30 One wire: typed messages", sign: { login: "frank", agent: false } },
      { at: day(9), kind: "issue", repo: R, number: 34, text: "opened #34 Hand: give a session, issue or PR to a teammate", sign: { login: "frank", agent: false } },
    ],
  } as MemberPage,
};
/** ?dev=team: the engine's answer to one question, faked (the join card asks here too) */
export function fakeAnswer(type: string, body: any): any {
  if (type === "team.member") return body.login === "frank" ? FAKE.frank : { log: [] };
  if (type === "team.board") return FAKE.board;
  if (type === "team.ping") return { ok: true };
  if (type === "team.pr.mark") return { ok: true, mark: body.mark, by: "marco" };
  if (type === "team.session.start") return { error: "the dev view starts nothing" };
  if (type === "team.room.share") return { code: "H4PZ9R" };   // #157: the shape only; nothing is kept
  if (type === "team.room.make" && typeof body.drive === "string") return { room: { id: "dev-drive", name: body.name, provider: "drive", org: "", repos: ["1AbCdEfG"], hub: body.hub ?? "", code: "D7RVQ2", gate: "github" } };   // #152
  if (type === "team.room.make" && !body.code) return { room: { id: "dev-cloud", name: body.name, provider: "cloud", org: "", repos: [], hub: "wss://cloud.matterfold.tech/relay", code: "2QKTYA", gate: "github" } };   // #314: a cloud group
  if (type === "team.room.make") return { room: { id: "dev-made", name: body.name, provider: "github", org: "", repos: [`marco/${String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`], hub: body.hub ?? "", code: "M4DEQ2", gate: "github" } };   // #160
  if (type === "team.room.join") return { error: "the dev view joins nothing" };
  // #342: a link's card; `&signedin=0` is a Sol with no account on the cloud
  if (type === "team.room.peek") return { code: String(body.code ?? ""), name: "smoke group", hub: "wss://cloud.matterfold.tech/relay", signedIn: new URLSearchParams(location.search).get("signedin") !== "0" };
  if (type === "team.accounts") return { github: { in: new URLSearchParams(location.search).get("gh") !== "out" } };   // #252: ?gh=out, no GitHub here
  if (type === "team.github.connect") return { code: "ABCD-1234", url: "https://github.com/login/device" };   // the shape only
  if (type === "team.github.connect.cancel") return { ok: true };
  if (type === "team.drive") return { connected: false, email: "", whole: false };   // #152: the shape only
  if (type === "team.drive.connect") return { ok: false, error: "the dev view connects nothing" };
  if (type === "team.letin.answer") return { said: [body.yes ? "invited" : "no"] };   // the shape only: nobody is added
  if (type === "team.leads.who") return { people: ["frank", "isaac", "marco"] };
  if (type === "team.leads.set") {   // the dev view lands nothing: the fake board moves, as if the press had landed
    const was = FAKE.board.leads![R][body.label] ?? [];
    FAKE.board.leads![R][body.label] = body.leads;
    return { ok: true, repo: R, label: body.label, leads: body.leads, was, commit: "c0ffee1", pinged: ["frank", "isaac"].filter((p) => p !== "marco") };
  }
  if (type === "team.shown.get" && body.id === "dev-frank-room") return { lines: [
    { role: "person", text: "take #4 and make the goal page: the files beside it open in a pane, no code for the agent side yet", at: Date.now() - 6 * 60_000 },
    { role: "agent", text: "Took #4. I'll draw the goal as its own page first, then the files and the add row.", at: Date.now() - 5 * 60_000 },
    { role: "tool", text: "Read · Grep · Read · Edit", at: Date.now() - 4 * 60_000 },
    { role: "agent", text: "The goal page is in Room.tsx's centre now; the right column stays. Opening a draft for a try.", at: Date.now() - 2 * 60_000 },
  ] };
  if (type === "team.room.show") return { id: body.id, on: body.on !== false };
  if (type === "team.goal.file") return { name: body.name, text: `# ${body.name}\n\nYou are grilling a first-time user's path through Sol.\nAsk one question at a time; write down where they stop.\n` };
  if (type === "team.goal.add_file") return { error: "the dev view keeps nothing" };
  if (type === "team.shown.get") return body.id ? { lines: [
    { role: "person", text: "draw the hands record under the board", at: Date.now() - 90_000 },
    { role: "tool", text: "Read · Grep · Read", at: Date.now() - 80_000 },
    { role: "agent", text: "The record sits under the columns now; each hand line is signed and links its issue.", at: Date.now() - 40_000 },
    { role: "tool", text: "Edit · Bash", at: Date.now() - 20_000 },
  ] } : { shows: FAKE.showing };
  return {};
}

/** ?dev=team: what frank's room session says while it is watched */
const DEV_LIVE: ShownLine[] = [
  { role: "tool", text: "Edit · Bash", at: 0 },
  { role: "agent", text: "The add row takes a pasted prompt or a text file of 64 KB at most; it goes under .sol/goal/.", at: 0 },
  { role: "tool", text: "Bash", at: 0 },
  { role: "agent", text: "Tests green. Pushing frank/cowork-goal-page-4 and opening the draft.", at: 0 },
];
