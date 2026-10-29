// Let in on a cloud group (#325, PROTOCOL round 57; the Cowork PRD §9.4, second half): a member's press asks whoever
// connected a repository, with their GitHub login; the maker's Sol puts it on the card and never answers it alone; the
// maker's yes invites that login, writes it into connectors.json's `in` and answers the asker only; the asker's Sol, on
// the answer from the person it asked, accepts, takes the repository as a target and clones it into its group's folder.
// GitHub, git, the cloud and connectors.json are fakes; team.json and the rooms folder are temp files.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const ROOMS = tmp("sol-rooms-");
Object.assign(process.env, {
  SOL_TEAM: join(tmp("sol-team-"), "team.json"), SOL_TEAM_OFFLINE: "1",
  SOL_STATE: join(tmp("sol-state-"), "work.json"), SOL_HOME: tmp("sol-home-"),
  SOL_HUB: "wss://cloud.example.net/relay", SOL_ROOMS: ROOMS, HOME: tmp("sol-home-dir-"), GIT_CONFIG_NOSYSTEM: "1",
});

const T = await import("../src/team/settings.ts");
const L = await import("../src/team/letin.ts");
const C = await import("../src/team/connectors.ts");
type RelayMsg = import("../src/team/relay.ts").RelayMsg;
type LetInDeps = import("../src/team/letin.ts").LetInDeps;
type ConnectorsFile = import("../src/team/connectors.ts").ConnectorsFile;
beforeEach(() => { L.resetLetIn(); });
// the GitHub room's test below presses with no card, as a face from before did

const HUB = "wss://cloud.example.net/relay";
const group = (more: Record<string, unknown> = {}) => ({ id: "study", name: "Study", provider: "cloud", hub: HUB, code: "BKQ2CL", ...more });
const as = (login: string, rooms: Record<string, unknown>[] = [group()], inUse = rooms[0].id as string) =>
  T.patchTeam({ me: { login, name: login }, rooms, room: inUse, speak: { github: true } });
const file = (rows: { repo: string; by: string; in?: string[] }[]): ConnectorsFile => ({ v: 1, repos: rows.map((r) => ({ at: "2026-10-28T10:00:00.000Z", in: [], ...r })) });

type Fake = { me?: string; github?: { in: boolean; who?: string }; file?: ConnectorsFile | (() => ConnectorsFile); canWrite?: (r: string) => boolean;
  members?: { logins: string[]; maker: string } | null; during?: () => Promise<void>;
  admin?: (r: string) => string | Promise<string>; people?: (r: string) => string; invite?: (r: string, l: string) => Promise<"invited" | "already">;
  invitations?: { id: number; repo: string; private?: boolean }[]; facts?: { private: boolean } | null; take?: string; up?: boolean;
  git?: (args: string[], cwd: string) => Promise<string>; changeFails?: string; store?: { text: string }; owner?: string };
/** the clock every fake reads; a test moves it */
let clock = 1_000_000_000;
beforeEach(() => { clock = 1_000_000_000; });
/** the secret gists on the fake GitHub, by id: what an asker's prove wrote, or what a test put there */
const gists = new Map<string, { owner: string; text: string }>();
let gistN = 0;
const gist = (owner: string, text: string) => { const id = (0xa000 + ++gistN).toString(16); gists.set(id, { owner, text }); return id; };
function deps(f: Fake = {}) {
  const c = { sent: [] as [string, Record<string, any>, boolean | undefined][], said: [] as string[][], ops: [] as object[], invited: [] as [string, string][],
    accepted: [] as number[], took: [] as string[], git: [] as [string[], string][], changed: 0, waits: [] as unknown[], proved: [] as string[], unproved: [] as string[], logs: [] as string[] };
  const fileNow = () => (typeof f.file === "function" ? f.file() : f.file ?? file([{ repo: "marco/app", by: "marco" }]));
  const store = f.store ?? { text: "" };
  const d: LetInDeps = {
    team: T.getTeam, patch: T.patchTeam, exists: existsSync, now: () => clock,
    send: (kind, payload, agent) => { if (f.up === false) return false; c.sent.push([kind, payload, agent]); return true; },
    git: async (args, cwd) => { c.git.push([args, cwd]); return f.git ? f.git(args, cwd) : ""; },
    say: (lines) => { c.said.push(lines); },
    reread: () => {},
    wait: (asks) => { c.waits.push(asks); },
    record: () => ({ members: {
      canWrite: async (repo: string) => f.canWrite?.(repo) ?? false,
      admin: async (repo: string) => (await f.admin?.(repo)) ?? "true",
      people: async (repo: string) => f.people?.(repo) ?? "marco",
      invite: async (repo: string, login: string) => { c.invited.push([repo, login]); return f.invite ? f.invite(repo, login) : "invited"; },
      invitations: async () => f.invitations ?? [],
      accept: async (id: number) => { c.accepted.push(id); return ""; },
    } }) as any,
    cloud: {
      me: () => f.me ?? "isaac",
      file: async () => fileNow(),
      change: async (_room, op) => { c.ops.push(op); if (f.changeFails) return { error: f.changeFails }; return C.applyConnectors(fileNow(), op); },
      github: async () => f.github ?? { in: true, who: "isaac-gh" },
      members: async () => { await f.during?.(); return f.members === undefined ? { logins: ["marco", "isaac", "frank"], maker: "marco" } : f.members; },
      take: async (_room, repo) => { c.took.push(repo); return f.take ?? ""; },
      facts: async () => (f.facts === undefined ? { private: true } : f.facts),
      prove: async (text) => { c.proved.push(text); return gist(f.owner ?? "isaac-gh", text); },
      unprove: async (id) => { c.unproved.push(id); gists.delete(id); },
      proofOf: async (id) => { const g = gists.get(id); if (!g) throw new Error("gh: Not Found (HTTP 404)"); return JSON.stringify(g); },
      store: { load: () => store.text, save: (t) => { store.text = t; } },
      changed: () => { c.changed++; },
      log: (line) => { c.logs.push(line); },
    },
  };
  return { d, c, store };
}
/** an ask heard by the maker, with a gist that proves it unless `proof` is given */
const ask = (from: string, more: Record<string, unknown> = {}): RelayMsg => {
  const m = { kind: "room", from: { login: from, agent: false }, at: clock, to: "marco", want: "in", repo: "marco/app", github: "isaac-gh", ...more } as RelayMsg;
  return { ...m, proof: "proof" in more ? more.proof : gist(String(m.github), L.letinProof("BKQ2CL", from, String(m.repo), String(m.github))) };
};
const answer = (said: string, more: object = {}): RelayMsg => ({ kind: "room", from: { login: "marco", agent: true }, at: clock, to: "isaac", repo: "marco/app", in: said, ...more });
/** the card as the face shows it */
const card = (repos: string[], github = "isaac-gh") => ({ github, repos });

// ---- connectors.json's `in` ----
test("connectors: `in` puts a GitHub login on one row once; a row not there, a name not GitHub's, past fifty: refused", () => {
  const f = file([{ repo: "marco/app", by: "marco" }, { repo: "marco/web", by: "marco", in: ["frank"] }]);
  const a = C.applyConnectors(f, { in: { repo: "Marco/App", login: "isaac-gh" } });
  assert.equal(a.changed, true);
  assert.deepEqual(a.file.repos.map((r) => r.in), [["isaac-gh"], ["frank"]], "the other rows as they are");
  assert.equal(C.applyConnectors(a.file, { in: { repo: "marco/app", login: "ISAAC-GH" } }).changed, false, "once, whatever the case");
  assert.equal(C.applyConnectors(f, { in: { repo: "marco/gone", login: "isaac" } }).error, C.SAY.notHere);
  assert.equal(C.applyConnectors(f, { in: { repo: "marco/app", login: "isaac gh" } }).error, C.SAY.login);
  const full = file([{ repo: "marco/app", by: "marco", in: Array.from({ length: C.IN_MAX }, (_, i) => `p${i}`) }]);
  assert.equal(C.applyConnectors(full, { in: { repo: "marco/app", login: "isaac" } }).error, C.SAY.many);
  assert.match(C.serializeConnectors(a.file), /"in": \[\n\s+"isaac-gh"\n\s+\]/);
});

test("connectors: a row says `asked: true` while my ask for it is out, in a cloud group only", () => {
  const f = file([{ repo: "marco/app", by: "marco" }, { repo: "marco/web", by: "marco" }]);
  const rows = C.repoRows({ provider: "cloud", repos: [], code: "BKQ2CL" }, f, 3, ["MARCO/APP"]);
  assert.deepEqual(rows.map((r) => [r.repo, r.asked ?? false]), [["marco/app", true], ["marco/web", false]]);
  assert.equal(C.repoRows({ provider: "github", repos: ["marco/app"], code: "" }, null, 3, ["marco/app"])[0].asked, undefined);
});

// ---- the asker's press ----
test("ask: my press asks whoever connected the repository, once, with my GitHub login and a gist that proves it, as me", async () => {
  as("isaac-gh");
  const { d, c } = deps({ file: file([{ repo: "Marco/App", by: "marco" }]) });
  assert.deepEqual(await L.askCloud(d, "marco/app"), { asked: true, repo: "Marco/App", to: "marco" });
  assert.deepEqual(c.proved, ["sol letin BKQ2CL isaac Marco/App isaac-gh"], "the group's code, my Sol name, the repository, my GitHub login");
  const proof = c.sent[0][1].proof;
  assert.deepEqual(c.sent, [["room", { to: "marco", want: "in", repo: "Marco/App", github: "isaac-gh", proof }, false]], "as me, never my agent");
  assert.deepEqual(L.askedNow(d, "study"), ["marco/app"]);
  assert.equal(c.changed, 1, "the connectors tab is told");
  assert.deepEqual(await L.askCloud(d, "marco/app"), { asked: true, repo: "Marco/App", to: "marco" }, "a second press says asked");
  assert.equal(c.sent.length, 1, "and sends nothing again");
  clock += 24 * 3_600_000 + 1;
  assert.deepEqual(L.askedNow(d, "study"), [], "a day on it is no longer out");
  assert.deepEqual(c.unproved, [proof], "and its gist is deleted");
});

test("ask: a row whose `by` is nobody, or no longer a member, goes to the group's maker as the cloud says (review P2-7)", async () => {
  as("isaac-gh");
  const gone = deps({ file: file([{ repo: "marco/app", by: "eve" }]), members: { logins: ["marco", "isaac"], maker: "marco" } });
  assert.deepEqual(await L.askCloud(gone.d, "marco/app"), { asked: true, repo: "marco/app", to: "marco" });
  L.resetLetIn();
  const none = deps({ file: file([{ repo: "marco/app", by: "" }]), members: { logins: ["isaac"], maker: "" } });
  assert.deepEqual(await L.askCloud(none.d, "marco/app"), { error: "couldn't tell who connected marco/app; try again in a moment" });
  assert.deepEqual(none.c.sent, []);
  L.resetLetIn();
  const unread = deps({ file: file([{ repo: "marco/app", by: "frank" }]), members: null });
  assert.deepEqual(await L.askCloud(unread.d, "marco/app"), { asked: true, repo: "marco/app", to: "frank" }, "a members route that says nothing: the row's word");
});

test("ask: an invitation waiting already, or a repository I can push to, is taken in at once and nobody is asked (review P2-4)", async () => {
  as("isaac-gh");
  const inv = deps({ invitations: [{ id: 7, repo: "marco/app", private: true }] });
  assert.deepEqual(await L.askCloud(inv.d, "marco/app"), { in: true, repo: "marco/app" });
  assert.deepEqual([inv.c.sent, inv.c.accepted, inv.c.took, inv.c.git.length], [[], [7], ["marco/app"], 1]);
  L.resetLetIn();
  const push = deps({ canWrite: () => true });
  assert.deepEqual(await L.askCloud(push.d, "marco/app"), { in: true, repo: "marco/app" });
  assert.deepEqual([push.c.sent, push.c.took], [[], ["marco/app"]]);
});

test("ask: refused in one line, nothing sent: a GitHub room, no repository, no Sol name, no GitHub, no GitHub name, not listed, my own, no gist, the cloud down", async () => {
  as("isaac-gh", [{ id: "sol", name: "Sol", repos: ["marco/app"] }]);
  assert.deepEqual(await L.askCloud(deps().d, "marco/app"), { error: L.ASK_SAY.cloud });
  as("isaac-gh");
  const cases: [Fake, string, string][] = [
    [{}, "marco app", L.ASK_SAY.which],
    [{ me: "" }, "marco/app", L.ASK_SAY.sol],
    [{ github: { in: false } }, "marco/app", L.ASK_SAY.github],
    [{ github: { in: true } }, "marco/app", L.ASK_SAY.who],
    [{ github: { in: true, who: "not a login" } }, "marco/app", L.ASK_SAY.who],
    [{}, "marco/other", L.ASK_SAY.notHere],
    [{ me: "marco" }, "marco/app", "you connected marco/app with another GitHub; sign in with that one"],
    [{ up: false }, "marco/app", L.ASK_SAY.down],
  ];
  for (const [f, repo, why] of cases) {
    L.resetLetIn();
    const { d, c } = deps(f);
    assert.deepEqual(await L.askCloud(d, repo), { error: why }, why);
    assert.deepEqual(c.sent, [], why);
    assert.deepEqual(L.askedNow(d, "study"), [], `${why}: never out`);
  }
  const down = deps({ up: false });
  await L.askCloud(down.d, "marco/app");
  assert.equal(down.c.unproved.length, 1, "a gist for an ask that never went is deleted");
  const noGist = deps();
  noGist.d.cloud!.prove = async () => { throw new Error("gh: Resource not accessible (HTTP 403)"); };
  assert.deepEqual(await L.askCloud(noGist.d, "marco/app"), { error: "couldn't prove your GitHub name: gh: Resource not accessible (HTTP 403)" });
});

// ---- the maker's card ----
test("the maker: an ask to me waits on the card, never answered alone; the same login twice is one card", async () => {
  as("marco-gh");
  const { d, c } = deps({ me: "marco", file: file([{ repo: "marco/app", by: "marco" }, { repo: "marco/web", by: "marco" }]) });
  await L.hearCloud(d, ask("isaac"));
  clock += 60_000;
  await L.hearCloud(d, ask("isaac"));
  await L.hearCloud(d, ask("isaac", { repo: "marco/web" }));
  assert.deepEqual(c.sent, [], "nothing said: the maker presses");
  assert.deepEqual(c.invited, [], "nobody invited");
  const w = L.waitingNow(clock);
  assert.deepEqual(w.map((x) => [x.room, x.name, x.login, x.github, x.repos]), [["study", "Study", "isaac", "isaac-gh", ["marco/app", "marco/web"]]]);
  clock += 60_000;
  await L.hearCloud(d, ask("isaac", { github: "someone-else" }));
  assert.deepEqual(L.waitingNow(clock).map((x) => [x.github, x.repos]), [["someone-else", ["marco/app"]]], "another login from them is a new card");
});

test("the maker: an ask whose gist is not the login's, holds other words, or is missing is dropped with one log line (review P1-2)", async () => {
  as("marco-gh");
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ proof: gist("mallory", L.letinProof("BKQ2CL", "isaac", "marco/app", "isaac-gh")) }, /does not prove isaac-gh/],
    [{ proof: gist("isaac-gh", L.letinProof("BKQ2CL", "isaac", "marco/web", "isaac-gh")) }, /does not prove isaac-gh/],
    [{ proof: gist("isaac-gh", L.letinProof("OTHER2", "isaac", "marco/app", "isaac-gh")) }, /does not prove isaac-gh/],
    [{ proof: gist("isaac-gh", L.letinProof("BKQ2CL", "eve", "marco/app", "isaac-gh")) }, /does not prove isaac-gh/],
    [{ proof: "beef" }, /does not prove isaac-gh/],
    [{ proof: undefined }, /carries no proof/],
  ];
  for (const [more, line] of cases) {
    L.resetLetIn();
    const { d, c } = deps({ me: "marco" });
    await L.hearCloud(d, ask("isaac", more));
    assert.equal(L.waitingNow(clock).length, 0, String(line));
    assert.deepEqual(c.sent, []);
    assert.equal(c.logs.length, 1);
    assert.match(c.logs[0], line);
  }
});

test("the maker: a card waits a day, a GitHub room's half an hour; one the hub kept past a day is nobody's card", async () => {
  as("marco-gh");
  const { d } = deps({ me: "marco" });
  await L.hearCloud(d, ask("isaac"));
  assert.equal(L.waitingNow(clock + 23 * 3_600_000).length, 1);
  assert.equal(L.waitingNow(clock + 24 * 3_600_000 + 1).length, 0);
  L.resetLetIn();
  await L.hearCloud(d, ask("isaac", { at: clock - 24 * 3_600_000 - 1, spooled: true }));
  assert.equal(L.waitingNow(clock).length, 0);
});

test("the maker: not to me, from me, no GitHub login, a repository the group does not list, a GitHub room: no card; not its admin: no, and why", async () => {
  as("marco-gh");
  const cases: [Fake, RelayMsg, string][] = [
    [{ me: "marco" }, ask("isaac", { to: "frank" }), "to someone else"],
    [{ me: "marco" }, ask("isaac", { to: undefined }), "to nobody"],
    [{ me: "marco" }, ask("marco"), "my own"],
    [{ me: "marco" }, ask("isaac", { github: undefined }), "no login"],
    [{ me: "marco" }, ask("isaac", { github: "a b" }), "not GitHub's shape"],
    [{ me: "marco" }, ask("isaac", { repo: "marco/other" }), "not listed"],
    [{ me: "" }, ask("isaac"), "not on the cloud"],
  ];
  for (const [f, m, why] of cases) {
    L.resetLetIn();
    const { d, c } = deps(f);
    await L.hearCloud(d, m);
    assert.equal(L.waitingNow(clock).length, 0, why);
    assert.deepEqual(c.sent, [], why);
  }
  const notAdmin = deps({ me: "marco", admin: () => "false" });
  await L.hearCloud(notAdmin.d, ask("isaac"));
  assert.equal(L.waitingNow(clock).length, 0);
  assert.deepEqual(notAdmin.c.sent, [["room", { to: "isaac", repo: "marco/app", in: "no", why: "marco isn't an admin of marco/app" }, true]], "review P2-7: never silence");
  as("marco-gh", [{ id: "sol", name: "Sol", repos: ["marco/app"], hub: HUB, code: "BKQ2CL", gate: "github", mine: true }]);
  await L.hearCloud(deps({ me: "marco" }).d, ask("isaac"));
  assert.equal(L.waitingNow(clock).length, 0, "a GitHub room keeps its own path (hearRoom)");
});

test("the maker: let in invites the login they gave from my gh, writes it into `in`, and answers them only; already the same", async () => {
  as("marco-gh");
  const { d, c } = deps({ me: "marco", file: file([{ repo: "marco/app", by: "marco" }, { repo: "marco/web", by: "marco" }]), people: (r) => (r === "marco/web" ? "marco\nisaac-gh" : "marco") });
  await L.hearCloud(d, ask("isaac"));
  await L.hearCloud(d, ask("isaac", { repo: "marco/web" }));
  assert.deepEqual(await L.letIn(d, "study", "isaac", true, card(["marco/web", "marco/app"])), { said: ["invited", "already"] });
  assert.deepEqual(c.invited, [["marco/app", "isaac-gh"]], "the GitHub login, never the Sol name");
  assert.deepEqual(c.ops, [{ in: { repo: "marco/app", login: "isaac-gh" } }, { in: { repo: "marco/web", login: "isaac-gh" } }]);
  assert.deepEqual(c.sent, [["room", { to: "isaac", repo: "marco/app", in: "invited" }, true], ["room", { to: "isaac", repo: "marco/web", in: "already" }, true]]);
  assert.equal(L.waitingNow(clock).length, 0, "the card is gone");
  assert.deepEqual(await L.letIn(d, "study", "isaac", true, card(["marco/app"])), { error: "nobody waits for that room now" });
});

test("the maker: a press on a card that is not the ask waiting, or that changed while the press read, lets nobody in (review P1-1)", async () => {
  as("marco-gh");
  const { d, c } = deps({ me: "marco", file: file([{ repo: "marco/app", by: "marco" }, { repo: "marco/web", by: "marco" }]) });
  await L.hearCloud(d, ask("isaac"));
  assert.deepEqual(await L.letIn(d, "study", "isaac", true), { error: "the ask changed; look again" }, "a cloud card is pressed as it was shown");
  assert.deepEqual(await L.letIn(d, "study", "isaac", true, card(["marco/app"], "someone-else")), { error: "the ask changed; look again" });
  assert.deepEqual(await L.letIn(d, "study", "isaac", true, card(["marco/app", "marco/web"])), { error: "the ask changed; look again" });
  assert.equal(L.waitingNow(clock).length, 1, "the card stays");
  // a second ask lands while the press reads the group's members: the press is for the card as it was
  const late = deps({ me: "marco", file: file([{ repo: "marco/app", by: "marco" }, { repo: "marco/web", by: "marco" }]),
    during: async () => { await L.hearCloud(late.d, ask("isaac", { repo: "marco/web" })); } });
  assert.deepEqual(await L.letIn(late.d, "study", "isaac", true, card(["marco/app"])), { error: "the ask changed; look again" });
  assert.deepEqual([c.invited, late.c.invited, late.c.sent], [[], [], []]);
  assert.deepEqual(L.waitingNow(clock).map((w) => w.repos), [["marco/app", "marco/web"]], "the card as it is now waits for a press");
});

test("the maker: an asker no longer in the group is answered no and invited nowhere; members that cannot be read keep the card (review P2-6)", async () => {
  as("marco-gh");
  const left = deps({ me: "marco", members: { logins: ["marco", "frank"], maker: "marco" } });
  await L.hearCloud(left.d, ask("isaac"));
  assert.deepEqual(await L.letIn(left.d, "study", "isaac", true, card(["marco/app"])), { said: ["no"] });
  assert.deepEqual(left.c.sent, [["room", { to: "isaac", repo: "marco/app", in: "no", why: "isaac is not in the group any more" }, true]]);
  assert.deepEqual([left.c.invited, left.c.ops], [[], []]);
  L.resetLetIn();
  const unread = deps({ me: "marco", members: null });
  await L.hearCloud(unread.d, ask("isaac"));
  assert.deepEqual(await L.letIn(unread.d, "study", "isaac", true, card(["marco/app"])), { error: L.ASK_SAY.members });
  assert.equal(L.waitingNow(clock).length, 1);
  assert.deepEqual(unread.c.invited, []);
});

test("the maker: not now answers no and lets nobody in; a list that could not be written is said, the answer still goes", async () => {
  as("marco-gh");
  const no = deps({ me: "marco" });
  await L.hearCloud(no.d, ask("isaac"));
  assert.deepEqual(await L.letIn(no.d, "study", "isaac", false, card(["marco/app"])), { said: ["no"] });
  assert.deepEqual(no.c.sent, [["room", { to: "isaac", repo: "marco/app", in: "no", why: "marco said not now" }, true]]);
  assert.deepEqual([no.c.invited, no.c.ops], [[], []]);
  L.resetLetIn();
  const busy = deps({ me: "marco", changeFails: "the group's connectors changed meanwhile" });
  await L.hearCloud(busy.d, ask("isaac"));
  assert.deepEqual(await L.letIn(busy.d, "study", "isaac", true, card(["marco/app"])), { said: ["invited"] });
  assert.match(busy.c.said.flat().join(" "), /couldn't write it in the group's list/);
  L.resetLetIn();
  const gone = deps({ me: "marco", file: file([{ repo: "marco/app", by: "marco" }]) });
  await L.hearCloud(gone.d, ask("isaac"));
  const later = deps({ me: "marco", file: file([]) });
  assert.deepEqual(await L.letIn(later.d, "study", "isaac", true, card(["marco/app"])), { said: ["no"] });
  assert.equal(later.c.sent[0][1].why, "that repository is no longer connected to the group");
  assert.deepEqual(later.c.invited, []);
  L.resetLetIn();
  const shy = deps({ me: "marco", invite: async () => { throw new Error("gh: Validation Failed (HTTP 422)"); } });
  await L.hearCloud(shy.d, ask("isaac"));
  assert.deepEqual(await L.letIn(shy.d, "study", "isaac", true, card(["marco/app"])), { said: ["no"] });
  assert.equal(shy.c.sent[0][1].why, "gh: Validation Failed (HTTP 422)");
  assert.deepEqual(shy.c.ops, [], "nobody written in who is not in");
});

// ---- the asker hears ----
test("the asker: invited from the person I asked accepts, takes the repository as mine, clones it into the group's folder; its gist goes", async () => {
  as("isaac-gh");
  const { d, c } = deps({ invitations: [{ id: 7, repo: "Marco/App", private: true }, { id: 8, repo: "marco/web", private: true }] });
  const first = deps();
  await L.askCloud(first.d, "marco/app");
  await L.hearCloud(d, answer("invited"));
  assert.deepEqual(c.accepted, [7]);
  assert.deepEqual(c.took, ["marco/app"]);
  const dir = join(ROOMS, "study", "app");
  assert.deepEqual(c.git.at(-1), [["clone", ...L.cloneAuth(), "--quiet", "https://github.com/marco/app.git", dir], join(ROOMS, "study")]);
  assert.deepEqual(c.said.at(-1), ["in marco/app", "Study"]);
  assert.equal(T.getTeam().rooms[0].folder, "", "a cloud room keeps no folder: roomFolders finds it");
  assert.deepEqual(L.askedNow(d, "study"), [], "taken: no longer out");
  assert.deepEqual(c.unproved, [first.c.sent[0][1].proof], "the gist is deleted once the answer came");
});

test("the asker: an ask out survives a restart, and is over only once the take worked (review P2-4)", async () => {
  as("isaac-gh");
  const store = { text: "" };
  const one = deps({ store });
  await L.askCloud(one.d, "marco/app");
  assert.match(store.text, /"to": "marco"/, "kept on disk");
  L.resetLetIn();   // the engine started again
  const two = deps({ store, take: "you can't push to that repository yet; ask its admin to let you in" });
  await L.hearCloud(two.d, answer("already"));
  assert.deepEqual([two.c.took, two.c.git], [["marco/app"], []], "heard after the restart; the take failed, nothing cloned");
  assert.deepEqual(L.askedNow(two.d, "study"), ["marco/app"], "still out: a later answer still counts");
  L.resetLetIn();
  const three = deps({ store });
  await L.hearCloud(three.d, answer("already"));
  assert.deepEqual([three.c.took, three.c.git.length], [["marco/app"], 1]);
  assert.deepEqual(JSON.parse(store.text), [], "over once taken");
});

test("the asker: a no keeps the ask out for the day, so that person's later yes still counts (review P2-5)", async () => {
  as("isaac-gh");
  const { d, c } = deps();
  await L.askCloud(d, "marco/app");
  await L.hearCloud(d, answer("no", { why: "marco said not now" }));
  await L.hearCloud(d, answer("no", { why: "marco said not now" }));
  assert.deepEqual(c.said, [["not let into marco/app", "marco: marco said not now"]], "said once");
  assert.deepEqual(L.askedNow(d, "study"), [], "not shown as asked");
  assert.deepEqual([c.took, c.git], [[], []]);
  clock += 3_600_000;
  await L.hearCloud(d, answer("already"));
  assert.deepEqual([c.took, c.git.length], [["marco/app"], 1]);
});

test("the asker: an answer from anyone but the person I asked, or with no ask of mine out, takes nothing", async () => {
  as("isaac-gh");
  const { d, c } = deps({ invitations: [{ id: 7, repo: "marco/app", private: true }] });
  await L.hearCloud(d, answer("invited"));
  assert.deepEqual([c.accepted, c.took, c.git], [[], [], []], "no ask out");
  const asker = deps();
  await L.askCloud(asker.d, "marco/app");
  await L.hearCloud(d, answer("invited", { from: { login: "eve", agent: false } }));
  await L.hearCloud(d, answer("invited", { to: "frank" }));
  await L.hearCloud(d, answer("invited", { repo: "marco/web" }));
  assert.deepEqual([c.accepted, c.took, c.git], [[], [], []]);
  assert.deepEqual(L.askedNow(d, "study"), ["marco/app"], "still out");
});

test("the asker: an invitation to a repository that is not private is never accepted (review P2-9)", async () => {
  as("isaac-gh");
  const cases: [Fake, boolean][] = [
    [{ invitations: [{ id: 7, repo: "marco/app", private: true }], facts: { private: false } }, false],
    [{ invitations: [{ id: 7, repo: "marco/app", private: false }], facts: null }, false],
    [{ invitations: [{ id: 7, repo: "marco/app" }], facts: null }, false],
    [{ invitations: [{ id: 7, repo: "marco/app", private: true }], facts: null }, true],
  ];
  for (const [f, accepted] of cases) {
    L.resetLetIn();
    const asker = deps();
    await L.askCloud(asker.d, "marco/app");
    const { d, c } = deps(f);
    await L.hearCloud(d, answer("invited"));
    assert.deepEqual(c.accepted, accepted ? [7] : [], JSON.stringify(f));
    if (!accepted) assert.deepEqual([c.took, c.git, c.said.at(-1)], [[], [], [`not taking marco/app in: ${L.ASK_SAY.private}`]]);
  }
});

test("the asker: a repository my own gh does not find private and mine to push to is never cloned, whoever answered", async () => {
  as("isaac-gh");
  const { d, c } = deps({ take: "build updates need a private repository" });
  await L.askCloud(d, "marco/app");
  await L.hearCloud(d, answer("already"));
  assert.deepEqual(c.took, ["marco/app"]);
  assert.deepEqual(c.git, [], "nothing cloned");
  assert.deepEqual(c.said.at(-1), ["couldn't take marco/app as yours: build updates need a private repository"]);
});

// ---- the group's folder ----
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
function cloneOf(dir: string, repo: string) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", `https://github.com/${repo}.git`);
  return dir;
}

test("roomFolders: a cloud group's repository in its group's folder is its folder; another origin there is not", async () => {
  const id = "folders";
  cloneOf(join(ROOMS, id, "app"), "someone/app");
  cloneOf(join(ROOMS, id, "app-2"), "marco/app");
  const rooms = [{ ...T.activeRoom(as("isaac-gh", [group({ id, repos: ["marco/app", "marco/web"] })])) }];
  const found = await L.roomFolders(rooms, ["marco/app", "marco/web"], { exists: existsSync, remote: L.remoteOf });
  assert.deepEqual(found, { "marco/app": join(ROOMS, id, "app-2") });
});

test("groupDir: a group whose id's folder is a GitHub room's clone gets -group, so no clone sits inside another", () => {
  cloneOf(join(ROOMS, "moved"), "marco/old");
  assert.equal(L.groupDir("moved", existsSync), join(ROOMS, "moved-group"));
  assert.equal(L.groupDir("fresh", existsSync), join(ROOMS, "fresh"));
});

test("a GitHub room's let-in is as it was: its ask waits on the card with no GitHub login of its own, and a yes answers as before", async () => {
  as("marco", [{ id: "book", name: "Book", repos: ["marco/book"], hub: HUB, code: "BKQ2CL", gate: "github", mine: true }]);
  const { d, c } = deps({ people: () => "marco" });
  await L.hearRoom(d, { kind: "room", from: { login: "isaac", agent: true }, at: 1, want: "in", repo: "marco/book", github: "ignored" });
  assert.deepEqual(L.waitingNow(clock).map((w) => [w.login, w.repos, "github" in w]), [["isaac", ["marco/book"], false]]);
  await L.hearCloud(d, ask("isaac", { repo: "marco/book" }));
  assert.equal(L.waitingNow(clock).length, 1, "the cloud path holds nothing in a GitHub room");
  assert.deepEqual(await L.letIn(d, "book", "isaac", true), { said: ["invited"] });
  assert.deepEqual(c.invited, [["marco/book", "isaac"]], "the hub login, a GitHub login there");
  assert.deepEqual(c.ops, [], "connectors.json is a cloud group's");
});
