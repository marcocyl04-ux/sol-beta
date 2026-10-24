// Show to team (#101, docs/how-we-work/PRD.md section 9): a running Work session on a team issue shown read-only over
// the relay. The relay, the faces, GitHub, git and the clock are functions that write down what they are given;
// nothing here reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";

const { Shows, Throttle, lineOf, issueOfBranch, shownLine, duration, scrub, TAIL, TEXT_MAX } = await import("../src/team/show.ts");
const { KINDS } = await import("../src/team/relay.ts");
type Deps = import("../src/team/show.ts").ShowDeps;
type Msg = import("../src/team/show.ts").ShowMsg;

function fake(o: { commits?: string; github?: boolean } = {}) {
  const sent: Msg[] = [], told: any[] = [], calls: string[][] = [];
  let tick: (() => void) | null = null, stopped = 0, now = 1_000_000;
  const d: Deps = {
    send: (m) => { sent.push(JSON.parse(JSON.stringify(m))); return true; },
    tell: (m) => told.push(m),
    gh: async (args) => { calls.push(["gh", ...args]); return ""; },
    git: async (args) => { calls.push(["git", ...args]); return args[0] === "log" ? o.commits ?? "" : ""; },
    login: async () => "frank",
    mayGitHub: () => o.github ?? true,
    now: () => now,
    every: (_ms, fn) => { tick = fn; return () => { stopped++; tick = null; }; },
    home: "/Users/frank",
  };
  return { d, sent, told, calls, tick: () => tick?.(), stopped: () => stopped, later: (ms: number) => { now += ms; } };
}
const start = (s: InstanceType<typeof Shows>, existing: string[] = []) =>
  s.start("s-1234567890", { cwd: "/repo", issue: 101, repo: "acme/sol", title: "#101 show to team", existing });
const bodyOf = (c: string[]) => c[c.indexOf("--body") + 1];

test("the relay knows the kind show", () => {
  assert.ok((KINDS as readonly string[]).includes("show"));
});

test("a branch names an issue the way sol/take makes it", () => {
  assert.equal(issueOfBranch("marco/product-show-to-team-101"), 101);
  assert.equal(issueOfBranch("marcocyl04-ux/base-beta-a-second-79"), 79);
  assert.equal(issueOfBranch("main"), null);
  assert.equal(issueOfBranch("marco/plan"), null);
  assert.equal(issueOfBranch("marco/fix-thing-12"), null, "fix is not a label");
});

test("what never leaves: thinking, tool inputs and outputs, helpers, questions, plans, a reply still streaming", () => {
  const h = "/Users/frank";
  assert.deepEqual(lineOf({ id: "1", kind: "me", text: "make the timer ring" }, h), { role: "person", text: "make the timer ring" });
  assert.deepEqual(lineOf({ id: "2", kind: "you", text: "Done.", live: false }, h), { role: "agent", text: "Done." });
  assert.equal(lineOf({ id: "3", kind: "you", text: "Do", live: true }, h), null, "a reply goes once, whole");
  const tool = lineOf({ id: "4", kind: "tool", name: "Read", input: { file_path: "/Users/frank/.ssh/id_ed25519" }, out: "SECRET KEY" }, h);
  assert.deepEqual(tool, { role: "tool", text: "Read" }, "the name only");
  assert.ok(!JSON.stringify(tool).includes("SECRET") && !JSON.stringify(tool).includes(".ssh"));
  assert.deepEqual(lineOf({ id: "5", kind: "tool", name: "mcp__sol__team_note", input: { lines: "x" } }, h), { role: "tool", text: "team_note" });
  assert.equal(lineOf({ id: "6", kind: "think", text: "private reasoning" }, h), null);
  assert.equal(lineOf({ id: "7", kind: "tool", name: "Bash", parent: "a1" }, h), null, "a helper's steps stay");
  assert.equal(lineOf({ id: "8", kind: "you", text: "helper says", live: false, parent: "a1" }, h), null);
  assert.equal(lineOf({ id: "9", kind: "tool", name: "TodoWrite", quiet: true }, h), null);
  for (const kind of ["perm", "plan", "wrap", "note", "error", "compact", "suggest"]) assert.equal(lineOf({ id: kind, kind, text: "x" }, h), null, kind);
  assert.equal(scrub("open /Users/frank/computer/sol/home/memory.md", h), "open ~/computer/sol/home/memory.md", "the home folder is ~");
  assert.equal(scrub("x".repeat(1000), h).length, TEXT_MAX);
});

test("the throttle: one line a tick, the same role coalesced, never past 400 characters", () => {
  const out: { role: string; text: string }[] = [];
  const t = new Throttle((l) => out.push(l));
  for (const n of ["Read", "Grep", "Edit"]) t.push({ role: "tool", text: n, at: 1 });
  t.push({ role: "agent", text: "a".repeat(300), at: 2 });
  t.push({ role: "agent", text: "b".repeat(300), at: 3 });
  t.tick(); t.tick(); t.tick(); t.tick();
  assert.deepEqual(out.map((l) => l.text.slice(0, 20)), ["Read · Grep · Edit", "a".repeat(20), "b".repeat(20)]);
  assert.ok(out.every((l) => l.text.length <= TEXT_MAX));
});

test("a show: start, at most five lines a second however much is said, then the end and one line on the issue", async () => {
  const f = fake({ commits: "abc1234\x1fabc1234ffff\x1fthe switch\ndef5678\x1fdef5678eeee\x1fthe watch pane" });
  const s = new Shows(f.d);
  await start(s, ["old"]);
  assert.equal(f.sent[0].event, "start");
  assert.deepEqual(f.sent[0].session, { id: "s-1234567890", title: "#101 show to team" });
  assert.equal(s.showing("s-1234567890"), true);

  s.item("s-1234567890", { id: "old", kind: "me", text: "said before the switch" });
  for (let i = 0; i < 30; i++) {
    s.item("s-1234567890", { id: `p${i}`, kind: "me", text: `prompt ${i}` });
    s.item("s-1234567890", { id: `t${i}`, kind: "tool", name: "Read", input: { file_path: "/secret" } });
  }
  s.item("s-1234567890", { id: "p0", kind: "me", text: "prompt 0", queued: false });   // a re-put of a line already gone
  assert.equal(f.sent.length, 1, "nothing goes before a tick");
  for (let i = 0; i < 5; i++) f.tick();   // one second at five ticks a second
  const lines = f.sent.filter((m) => m.event === "line");
  assert.equal(lines.length, 5, "five a second");
  const all = JSON.stringify(f.sent);
  assert.ok(!all.includes("said before the switch"), "what was there before the switch stays");
  assert.ok(!all.includes("/secret"), "no tool input");
  assert.equal(all.split("prompt 0\"").length - 1, 1, "a line goes once");

  f.later(12 * 60_000);
  const r = await s.stop("s-1234567890");
  assert.equal(r, "no longer shown; one line on #101 says what was done");
  assert.equal(f.stopped(), 1, "the timer stops");
  assert.equal(f.sent.at(-1)!.event, "end");
  assert.equal(s.showing("s-1234567890"), false);
  assert.ok(f.calls.some((c) => c.join(" ") === "git log origin/main..HEAD --format=%h%x1f%H%x1f%s"));
  const c = f.calls.find((x) => x[1] === "issue" && x[2] === "comment")!;
  assert.equal(c[3], "101");
  assert.equal(bodyOf(c), "**Shown**: frank worked on this in a session (#101 show to team), 12 min; commits: " +
    "[`abc1234`](https://github.com/acme/sol/commit/abc1234ffff) the switch; [`def5678`](https://github.com/acme/sol/commit/def5678eeee) the watch pane — frank's agent");
  assert.equal(s.lines("frank", "s-1234567890"), null, "forgotten once it ends");
});

test("the comment: no commits yet, durations, and GitHub off posts nothing", async () => {
  assert.equal(shownLine({ login: "isaac", title: "t", ms: 20_000, repo: "acme/sol", commits: [] }),
    "**Shown**: isaac worked on this in a session (t), under a minute; commits: no commits yet — isaac's agent");
  assert.equal(duration(65 * 60_000), "1 h 5 min");
  assert.equal(duration(120 * 60_000), "2 h");
  const f = fake({ github: false });
  const s = new Shows(f.d);
  await start(s);
  assert.match(await s.stop("s-1234567890"), /not posted/);
  assert.ok(!f.calls.some((c) => c[0] === "gh"));
  assert.equal(f.sent.at(-1)!.event, "end", "the end still goes");
});

test("a teammate's show heard: kept to the last 200 lines in memory, told to the faces, gone at its end or when they leave", () => {
  const f = fake();
  const s = new Shows(f.d);
  const base = { from: { login: "isaac", agent: false }, issue: 35, repo: "acme/sol", session: { id: "abcdefgh12", title: "#35 try" } };
  s.hear({ ...base, event: "start" });
  for (let i = 0; i < 250; i++) s.hear({ ...base, event: "line", line: { role: "agent", text: `line ${i}`, at: i } });
  s.hear({ ...base, event: "line", line: { role: "root", text: "bad role" } });
  s.hear({ ...base, from: { login: "x y" }, event: "line", line: { role: "agent", text: "bad login" } });
  const tail = s.lines("isaac", "abcdefgh12")!;
  assert.equal(tail.length, TAIL);
  assert.equal(tail[0].text, "line 50");
  assert.deepEqual(s.list().map((x) => [x.login, x.issue, x.session.title]), [["isaac", 35, "#35 try"]]);
  assert.equal(f.told.at(-1).type, "team.shown");
  assert.equal(f.told.at(-1).login, "isaac");
  assert.ok(!JSON.stringify(f.told).includes("bad "));
  s.prune(["frank"]);
  assert.equal(s.lines("isaac", "abcdefgh12"), null, "left the relay: no longer showing");
  assert.equal(f.told.at(-1).event, "end");
  s.hear({ ...base, event: "line", line: { role: "person", text: "a late line starts it" } });
  assert.equal(s.lines("isaac", "abcdefgh12")!.length, 1, "a face that joined late still sees it");
  s.hear({ ...base, event: "end" });
  assert.deepEqual(s.list(), []);
  assert.equal(f.sent.length, 0, "hearing sends nothing back");
});

test("the hub carries show to everyone else, stamped, and drops it to a connection that is behind", async () => {
  const { RelayHub } = await import("../src/team/relay.ts");
  const hub = new RelayHub();
  const got: Record<string, string[]> = { a: [], b: [], c: [] };
  const conn = (k: string, behind = false) => ({ send: (l: string) => got[k].push(l), behind: () => behind });
  const a = conn("a"), b = conn("b"), c = conn("c", true);
  for (const [x, who] of [[a, "frank"], [b, "isaac"], [c, "marco"]] as const) {
    hub.join(x);
    hub.message(x, JSON.stringify({ kind: "hello", from: { login: who, agent: false }, at: 1, machine: "m" }));
  }
  for (const k in got) got[k] = [];
  hub.message(a, JSON.stringify({ kind: "show", from: { login: "someone-else", agent: false }, at: 1, issue: 101, event: "line", session: { id: "s1", title: "t" }, line: { role: "agent", text: "hi", at: 1 } }));
  assert.equal(got.a.length, 0, "not back to its sender");
  assert.equal(JSON.parse(got.b[0]).from.login, "frank", "the hub stamps who said it");
  assert.equal(got.c.length, 0, "a reader that is behind misses it");
});
