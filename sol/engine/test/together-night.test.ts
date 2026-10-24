// The night job (#99, docs/how-we-work/PRD.md section 7): clashes, still claims, the digest. GitHub and git are
// functions that answer from a small made-up repo and write down their arguments; nothing here reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";

const N = await import("../src/team/night.ts");
const T = await import("../src/team/settings.ts");
type Deps = import("../src/team/night.ts").NightDeps;
type Pr = import("../src/team/night.ts").Pr;

const NOW = new Date("2026-10-22T03:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const pr = (number: number, branch: string, login: string, body = ""): Pr => ({ number, branch, login, title: `pr ${number}`, body, isDraft: false });

type World = {
  prs?: Pr[];
  conflicts?: Record<string, string[]>;            // "x y" (the two refs merge-tree is given) -> conflicted files
  comments?: Record<number, { body: string; at: string; login?: string }[]>;
  claims?: { number: number; title: string; assignees: { login: string }[] }[];
  refs?: string[];                                 // "origin/<branch> <date>"
  events?: Record<number, string[]>;
  digest?: number;
  merged?: { number: number; title: string; author: { login: string }; mergedBy?: { login: string }; reviews?: { author: { login: string }; state: string; submittedAt?: string }[]; files?: { path: string }[] }[];
  dryRun?: boolean;
  git?: string;
  codeowners?: string;                             // origin/main:.github/CODEOWNERS
  open?: { number: number; title: string; labels: { name: string }[]; assignees: { login: string }[] }[];
  unassigned?: Record<number, string[]>;           // issue -> logins once taken off it
  relay?: boolean;                                 // false: the relay is not in sight
};
function fake(w: World = {}) {
  const calls: string[][] = [];
  const said: string[] = [];
  const pinged: { to: string; kind: string; line: string; issue: number }[] = [];
  const d: Deps = {
    ping: (p) => { if (w.relay === false) return false; pinged.push(p); return true; },
    login: "marcocyl04-ux",
    now: () => NOW,
    dryRun: w.dryRun ?? false,
    say: (l) => said.push(l),
    git: async (args) => {
      calls.push(["git", ...args]);
      if (args[0] === "--version") return { code: 0, out: w.git ?? "git version 2.54.0\n" };
      if (args[0] === "rev-parse") return { code: 0, out: "abc\n" };
      if (args[0] === "fetch") return { code: 0, out: "" };
      if (args[0] === "show") return w.codeowners === undefined ? { code: 128, out: "fatal: path not in origin/main" } : { code: 0, out: w.codeowners };
      if (args[0] === "for-each-ref") return { code: 0, out: (w.refs ?? []).join("\n") };
      if (args[0] === "merge-tree") {
        const files = w.conflicts?.[args.slice(-2).join(" ")] ?? [];
        return files.length ? { code: 1, out: `0123abcd\n${files.join("\n")}\n` } : { code: 0, out: "0123abcd\n" };
      }
      return { code: 0, out: "" };
    },
    gh: async (args) => {
      calls.push(["gh", ...args]);
      const a = args.join(" ");
      if (a.startsWith("pr list --state open")) return JSON.stringify((w.prs ?? []).map((p) => ({ number: p.number, headRefName: p.branch, author: { login: p.login }, title: p.title, body: p.body, isDraft: p.isDraft })));
      if (a.startsWith("pr list --state merged")) return JSON.stringify(w.merged ?? []);
      if (a.startsWith("pr list --state all")) return "[]";
      if (a.startsWith("issue list --state open --label now")) return JSON.stringify(w.claims ?? []);
      if (a.startsWith("issue list --state open --limit")) return JSON.stringify(w.open ?? []);
      if (a.includes("/assignees")) return "{}";
      if (a.startsWith("issue list --state open --search")) return JSON.stringify(w.digest ? [{ number: w.digest, title: "Night digest" }] : []);
      if (a.startsWith("issue create")) return "https://github.com/acme/sol/issues/120\n";
      const c = /issues\/(\d+)\/comments\?/.exec(a);
      if (args[0] === "api" && !a.includes("POST") && c) return (w.comments?.[Number(c[1])] ?? []).map((x) => JSON.stringify({ login: "x", ...x })).join("\n");
      const e = /issues\/(\d+)\/events/.exec(a);
      if (e && a.includes('"unassigned"')) return (w.unassigned?.[Number(e[1])] ?? []).join("\n");
      if (e) return (w.events?.[Number(e[1])] ?? []).join("\n");
      return "";
    },
  };
  const posts = () => calls.filter((x) => x.includes("POST")).map((x) => ({ issue: Number(/issues\/(\d+)\//.exec(x.join(" "))![1]), body: x.find((y) => y.startsWith("body="))!.slice(5) }));
  return { d, calls, said, posts, pinged };
}

test("the settings: night has clean defaults, bad values fall back", () => {
  assert.deepEqual(T.cleanTeam({}).night, { hour: 3, staleDays: 7 });
  assert.deepEqual(T.cleanTeam({ night: { hour: 22, staleDays: 3 } }).night, { hour: 22, staleDays: 3 });
  assert.deepEqual(T.cleanTeam({ night: { hour: 24, staleDays: 0 } }).night, { hour: 3, staleDays: 7 });
  assert.deepEqual(T.cleanTeam({ night: { hour: "3", staleDays: 2.5 } }).night, { hour: 3, staleDays: 7 });
});

test("pairs: every pair once, lower number first", () => {
  const p = N.pairs([{ number: 9 }, { number: 3 }, { number: 5 }]).map(([a, b]) => `${a.number}-${b.number}`);
  assert.deepEqual(p, ["3-5", "3-9", "5-9"]);
  assert.deepEqual(N.pairs([{ number: 1 }]), []);
});

test("merge-tree: 0 is clean, 1 lists the files, anything else is an error", () => {
  assert.deepEqual(N.parseMergeTree({ code: 0, out: "abc\n" }), []);
  assert.deepEqual(N.parseMergeTree({ code: 1, out: "abc\nsol/b.ts\nsol/a.ts\nsol/a.ts\n\nAuto-merging x\n" }), ["sol/a.ts", "sol/b.ts"]);
  assert.throws(() => N.parseMergeTree({ code: 128, out: "fatal: bad ref\n" }), /merge-tree failed: fatal: bad ref/);
});

test("git's version: 2.38 or newer", () => {
  assert.equal(N.gitOk("git version 2.38.0"), true);
  assert.equal(N.gitOk("git version 2.54.0 (Apple Git-157)"), true);
  assert.equal(N.gitOk("git version 3.0.1"), true);
  assert.equal(N.gitOk("git version 2.37.9"), false);
  assert.equal(N.gitOk(""), false);
});

test("the issue a PR names, else the PR itself", () => {
  assert.equal(N.issueOf(pr(41, "b", "x", "Part of #99 (step 6 of #83)")), 99);
  assert.equal(N.issueOf(pr(41, "b", "x", "Fixes #12")), 12);
  assert.equal(N.issueOf(pr(41, "b", "x", "no number here")), 41);
});

test("clashes: a pair conflicts, posted once on each issue, signed", async () => {
  const prs = [pr(41, "marco/base-night-99", "marcocyl04-ux", "Part of #99"), pr(42, "frank/work-timer-91", "fktsai", "Fixes #91"), pr(43, "isaac/life-x-77", "isaacw", "Part of #99")];
  const w = fake({ prs, conflicts: { "origin/marco/base-night-99 origin/frank/work-timer-91": ["sol/README.md"] } });
  const clashes = await N.findClashes(w.d, prs);
  assert.equal(clashes.length, 1);
  assert.deepEqual([clashes[0].a.number, clashes[0].b?.number, clashes[0].files], [41, 42, ["sol/README.md"]]);
  assert.equal(await N.postClashes(w.d, clashes), 2);
  const p = w.posts();
  assert.deepEqual(p.map((x) => x.issue), [99, 91]);
  assert.equal(p[0].body, "**Clash predicted** between #41 (marcocyl04-ux, marco/base-night-99) and #42 (fktsai, frank/work-timer-91) on: sol/README.md. One of you builds on the other's branch or waits.\n\n— marcocyl04-ux's agent (night job)");
  // merge-tree is told the two refs, never a checkout
  assert.ok(w.calls.some((c) => c.join(" ") === "git merge-tree --write-tree --name-only --no-messages origin/marco/base-night-99 origin/frank/work-timer-91"));
  assert.ok(!w.calls.some((c) => c[1] === "checkout" || c[1] === "switch"));
});

test("clashes: never the same one twice; a different file list is new", async () => {
  const prs = [pr(41, "a/x-1", "a", "Part of #1"), pr(42, "b/y-2", "b", "Part of #2")];
  const old = "**Clash predicted** between #41 (a, a/x-1) and #42 (b, b/y-2) on: f.ts. One of you ...";
  const w = fake({ prs, conflicts: { "origin/a/x-1 origin/b/y-2": ["f.ts"] }, comments: { 1: [{ body: old, at: ago(1) }] } });
  await N.postClashes(w.d, await N.findClashes(w.d, prs));
  assert.deepEqual(w.posts().map((x) => x.issue), [2]);
  assert.ok(w.said.some((l) => l.startsWith("already said on #1")));
  const w2 = fake({ prs, conflicts: { "origin/a/x-1 origin/b/y-2": ["f.ts", "g.ts"] }, comments: { 1: [{ body: old, at: ago(1) }] } });
  await N.postClashes(w2.d, await N.findClashes(w2.d, prs));
  assert.deepEqual(w2.posts().map((x) => x.issue), [1, 2]);
});

test("clashes against main: said once on the one issue; the same file is not said again for the pair", async () => {
  const prs = [pr(41, "a/x-1", "a", "Part of #1"), pr(42, "b/y-2", "b", "Part of #2")];
  const w = fake({ prs, conflicts: { "origin/main origin/a/x-1": ["f.ts"], "origin/a/x-1 origin/b/y-2": ["f.ts"] } });
  const clashes = await N.findClashes(w.d, prs);
  assert.deepEqual(clashes.map((c) => [c.a.number, c.b?.number ?? "main"]), [[41, "main"]]);
  await N.postClashes(w.d, clashes);
  assert.deepEqual(w.posts().map((x) => x.issue), [1]);
  assert.match(w.posts()[0].body, /^\*\*Clash predicted\*\* between #41 \(a, a\/x-1\) and main on: f\.ts\. Bring main into your branch/);
});

test("claims: still for 7 days loses `now` with one comment; a commit, a word or a fresh Take keeps it", async () => {
  const claims = [
    { number: 91, title: "the timer", assignees: [{ login: "fktsai" }] },    // still
    { number: 92, title: "the sound", assignees: [{ login: "isaacw" }] },    // a commit 2 days ago
    { number: 93, title: "the card", assignees: [{ login: "fktsai" }] },     // a word 1 day ago
    { number: 94, title: "the page", assignees: [{ login: "isaacw" }] },     // taken 1 day ago, on an old branch
    { number: 95, title: "nobody's", assignees: [] },                        // not a claim
  ];
  const w = fake({
    claims,
    refs: [`origin/frank/work-timer-91 ${ago(10)}`, `origin/isaac/work-sound-92 ${ago(2)}`, `origin/frank/work-card-93 ${ago(20)}`, `origin/isaac/life-page-94 ${ago(30)}`, `origin/main ${ago(0)}`],
    comments: { 91: [{ body: "**Clash predicted** ... (night job)", at: ago(0) }, { body: "started", at: ago(9) }], 93: [{ body: "still on it", at: ago(1) }] },
    events: { 91: [ago(12)], 94: [ago(1)] },
  });
  const r = await N.staleClaims(w.d, 7);
  assert.deepEqual(r.dropped.map((c) => c.issue), [91]);
  assert.deepEqual(r.holds.map((c) => c.issue), [92, 93, 94]);
  assert.ok(w.calls.some((c) => c.join(" ") === "gh issue edit 91 --remove-label now"));
  assert.deepEqual(w.posts(), [{ issue: 91, body: "**Claim dropped**: no commit or word in 7 days; Take it again when you pick it up.\n\n— marcocyl04-ux's agent (night job)" }]);
});

test("isStale and branchOf", () => {
  assert.equal(N.isStale([], NOW, 7), true);
  assert.equal(N.isStale([undefined, ago(8)], NOW, 7), true);
  assert.equal(N.isStale([ago(8), ago(6)], NOW, 7), false);
  const refs = [{ ref: "origin/a/x-9", at: ago(5) }, { ref: "origin/a/x-99", at: ago(1) }, { ref: "origin/b/y-9", at: ago(2) }];
  assert.equal(N.branchOf(9, refs)?.ref, "origin/b/y-9");
  assert.equal(N.branchOf(7, refs), undefined);
});

test("the digest: one comment on the digest issue, since the last one", async () => {
  const w = fake({ digest: 120, comments: { 120: [{ body: "**Night digest** ...\n\n— m's agent (night job)", at: "2026-10-21T03:00:05Z" }] }, merged: [{ number: 97, title: "the brief", author: { login: "marcocyl04-ux" } }] });
  const prs = [pr(41, "a/x-1", "a"), { ...pr(42, "b/y-2", "b"), isDraft: true }];
  const body = await N.digest(w.d, { prs, clashes: [{ a: prs[0], b: prs[1], files: ["f.ts"] }], dropped: [{ issue: 91, title: "t", login: "fktsai" }], holds: [{ issue: 92, title: "the sound", login: "isaacw" }] });
  assert.ok(w.calls.some((c) => c.join(" ").includes("merged:>=2026-10-21T03:00:05Z")));
  assert.equal(body, [
    "**Night digest**, 2026-10-22 (since 2026-10-21 03:00 UTC)",
    "",
    "Merged into main: #97 the brief (marcocyl04-ux)",
    "Opened, still open: none",
    "Waiting for review: #41 (a)",
    "Clashes found: #41 and #42 on f.ts",
    "Claims dropped: #91 (fktsai)",
    "Who holds what: ",
    "- #92 the sound: isaacw",
    "",
    "— marcocyl04-ux's agent (night job)",
  ].join("\n"));
  assert.deepEqual(w.posts().map((p) => p.issue), [120]);
  assert.ok(!w.calls.some((c) => c[1] === "issue" && c[2] === "create"));
});

test("the digest: long lists stop at twelve; what opened and merged is said once", () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ number: i + 1, title: `t${i + 1}`, login: "a" }));
  const t = N.digestText({ login: "m", now: NOW, since: new Date(ago(1)), merged: many, opened: [...many, { number: 30, title: "new", login: "b" }], waiting: [], clashes: [], dropped: [], holds: [] });
  assert.match(t, /Merged into main: #1 t1 \(a\);.*#12 t12 \(a\); and 3 more\n/);
  assert.match(t, /\nOpened, still open: #30 new \(b\)\n/);
});

test("the digest: no issue yet opens \"Night digest\" with the label cowork", async () => {
  const w = fake();
  await N.digest(w.d, { prs: [], clashes: [], dropped: [], holds: [] });
  const mk = w.calls.find((c) => c[1] === "issue" && c[2] === "create")!;
  assert.ok(mk.includes("Night digest") && mk.includes("cowork"));
  assert.deepEqual(w.posts().map((p) => p.issue), [120]);
  assert.match(w.posts()[0].body, /Who holds what: nobody/);
});

test("dry run: the whole night prints and posts nothing, creates nothing, drops nothing", async () => {
  const prs = [pr(41, "a/x-1", "a", "Part of #1"), pr(42, "b/y-2", "b", "Part of #2")];
  const w = fake({ dryRun: true, prs, conflicts: { "origin/a/x-1 origin/b/y-2": ["f.ts"] }, claims: [{ number: 91, title: "t", assignees: [{ login: "f" }] }] });
  await N.night(w.d, { staleDays: 7 });
  assert.equal(w.posts().length, 0);
  assert.ok(!w.calls.some((c) => c[0] === "gh" && (c[2] === "create" || c[2] === "edit")));
  assert.ok(w.said.some((l) => l.startsWith("would post on #1:")));
  assert.ok(w.said.some((l) => l === "would take `now` off #91"));
  assert.ok(w.said.some((l) => l.startsWith('would open the issue "Night digest"')));
});

test("too old a git is said plainly, before anything else", async () => {
  const w = fake({ git: "git version 2.34.1" });
  await assert.rejects(N.night(w.d, { staleDays: 7 }), /too old for the night job \(git version 2\.34\.1\); it needs git 2\.38/);
  assert.equal(w.calls.length, 1);
});

// ---- the leads' two rules in the night (#118) ----
const OWNERS = [
  "# label base: the engine",
  "/sol/engine/                 @marcocyl04-ux",
  "# label life: the face",
  "/sol/mac/src/                @isaacw",
  "# label cowork: the board",
  "/sol/engine/src/team/        @fktsai @marcocyl04-ux",
  "# label social: no code yet",
  "# leads: @isaacw",
  "# label product: not code",
  "/docs/                       @marcocyl04-ux",
].join("\n");

test("routing: an open issue's missing leads are assigned and pinged; one who let it go is not put back", async () => {
  const w = fake({
    codeowners: OWNERS,
    open: [
      { number: 7, title: "the face flickers", labels: [{ name: "life" }, { name: "bug" }], assignees: [] },
      { number: 8, title: "the board", labels: [{ name: "cowork" }], assignees: [{ login: "marcocyl04-ux" }] },
      { number: 9, title: "a talk", labels: [{ name: "social" }], assignees: [] },
      { number: 10, title: "no label", labels: [{ name: "bug" }], assignees: [] },
      { number: 11, title: "work thing", labels: [{ name: "work" }], assignees: [] },   // work names no lead
    ],
    unassigned: { 9: ["isaacw"] },
  });
  await N.night(w.d, { staleDays: 7 });
  const asg = w.calls.filter((c) => c.join(" ").includes("/assignees")).map((c) => c.join(" "));
  assert.deepEqual(asg, [
    "gh api -X POST repos/{owner}/{repo}/issues/7/assignees -f assignees[]=isaacw",
    "gh api -X POST repos/{owner}/{repo}/issues/8/assignees -f assignees[]=fktsai",
  ]);
  assert.deepEqual(w.pinged.map((p) => [p.to, p.kind, p.issue]), [["isaacw", "claim", 7], ["fktsai", "claim", 8]]);
  assert.equal(w.pinged[0].line, "#7 the face flickers wears life, which you lead: it is assigned to you");
  assert.ok(w.said.includes("2 issues routed to their leads"));
  // only the issues missing a lead ask GitHub who let go
  assert.deepEqual(w.calls.filter((c) => c.join(" ").includes('"unassigned"')).map((c) => /issues\/(\d+)/.exec(c.join(" "))![1]), ["7", "8", "9"]);
});

test("no CODEOWNERS on main: nothing is routed or flagged, and the night says so", async () => {
  const w = fake({ open: [{ number: 7, title: "x", labels: [{ name: "life" }], assignees: [] }],
    merged: [{ number: 50, title: "m", author: { login: "fktsai" }, mergedBy: { login: "fktsai" }, reviews: [], files: [{ path: "sol/engine/src/x.ts" }] }] });
  await N.night(w.d, { staleDays: 7 });
  assert.ok(w.said.includes("CODEOWNERS on main names no lead: nothing routed, nothing flagged"));
  assert.ok(!w.calls.some((c) => c.join(" ").includes("/assignees")));
  assert.deepEqual(w.posts().map((p) => p.issue), [120]);   // the digest only
  assert.equal(w.pinged.length, 0);
});

test("flags: a merge without its lead's word gets one signed line on the PR and a ping to the lead and the author", async () => {
  const w = fake({
    codeowners: OWNERS, digest: 120,
    comments: { 120: [{ body: "**Night digest** ... (night job)", at: "2026-10-21T03:00:05Z" }], 52: [{ body: "**Merged without the lead's approval**: ... (night job)", at: ago(0) }] },
    merged: [
      // Frank merged his own PR on base (Marco leads it) with no approval: flagged, his own press
      { number: 50, title: "engine tweak", author: { login: "fktsai" }, mergedBy: { login: "fktsai" }, reviews: [], files: [{ path: "sol/engine/src/index.ts" }] },
      // a life PR approved and merged by Marco, who does not lead life: flagged
      { number: 51, title: "face", author: { login: "fktsai" }, mergedBy: { login: "marcocyl04-ux" }, reviews: [{ author: { login: "marcocyl04-ux" }, state: "APPROVED" }], files: [{ path: "sol/mac/src/app.ts" }] },
      // already flagged on an earlier night: not again
      { number: 52, title: "old", author: { login: "fktsai" }, mergedBy: { login: "fktsai" }, reviews: [], files: [{ path: "docs/x.md" }] },
      // the lead approved: fine
      { number: 53, title: "ok", author: { login: "fktsai" }, mergedBy: { login: "fktsai" }, reviews: [{ author: { login: "isaacw" }, state: "APPROVED" }], files: [{ path: "sol/mac/src/a.ts" }] },
      // Marco's own PR on a label only he leads, his own press: flagged too (strict, his call 2026-10-22)
      { number: 54, title: "mine", author: { login: "marcocyl04-ux" }, mergedBy: { login: "marcocyl04-ux" }, reviews: [], files: [{ path: "docs/y.md" }] },
    ],
  });
  await N.night(w.d, { staleDays: 7 });
  assert.ok(w.calls.some((c) => c.join(" ").includes("merged:>=2026-10-21T03:00:05Z") && c.join(" ").includes("mergedBy,reviews,files")));
  const flags = w.posts().filter((p) => p.issue !== 120);
  assert.deepEqual(flags.map((p) => p.issue), [50, 51, 54]);
  assert.match(flags[2].body, /it touches product \(lead marcocyl04-ux\) and was merged by marcocyl04-ux, its own author, with no approval/);
  assert.equal(flags[0].body, "**Merged without the lead's approval**: it touches base (lead marcocyl04-ux) and was merged by fktsai, its own author, with no approval from a lead. GitHub cannot refuse it here; the lead looks now and says yes, or opens the fix.\n\n— marcocyl04-ux's agent (night job)");
  assert.match(flags[1].body, /it touches life \(lead isaacw\) and was merged by marcocyl04-ux with no approval/);
  assert.deepEqual(w.pinged.map((p) => [p.to, p.kind, p.issue]), [["marcocyl04-ux", "decision", 50], ["fktsai", "decision", 50], ["isaacw", "decision", 51], ["fktsai", "decision", 51], ["marcocyl04-ux", "decision", 54]]);
  assert.ok(w.said.includes("already flagged #52"));
  assert.ok(w.said.includes("5 merged since the last run, 3 flagged for no lead's approval"));
  // the digest still lists every merge, from the same one read
  assert.equal(w.calls.filter((c) => c.join(" ").startsWith("gh pr list --state merged")).length, 1);
  assert.match(w.posts().find((p) => p.issue === 120)!.body, /Merged into main: #50 engine tweak \(fktsai\); #51 face/);
});

test("dry run: routing and flags print what they would do; nothing assigned, posted or pinged", async () => {
  const w = fake({
    dryRun: true, codeowners: OWNERS,
    open: [{ number: 7, title: "the face flickers", labels: [{ name: "life" }], assignees: [] }],
    merged: [{ number: 50, title: "engine tweak", author: { login: "fktsai" }, mergedBy: { login: "fktsai" }, reviews: [], files: [{ path: "sol/engine/src/index.ts" }] }],
  });
  await N.night(w.d, { staleDays: 7 });
  assert.equal(w.posts().length, 0);
  assert.equal(w.pinged.length, 0);
  assert.ok(!w.calls.some((c) => c.join(" ").includes("/assignees")));
  assert.ok(w.said.includes("would assign isaacw to #7 (lead of life)"));
  assert.ok(w.said.includes("would ping isaacw (claim): #7 the face flickers wears life, which you lead: it is assigned to you"));
  assert.ok(w.said.some((l) => l.startsWith("would post on #50:\n    **Merged without the lead's approval**")));
  assert.ok(w.said.includes("would ping marcocyl04-ux (decision): #50 engine tweak was merged without the lead's approval (base)"));
  assert.ok(w.said.includes("1 issues would be routed to their leads"));
  assert.ok(w.said.includes("1 merged since the last run, 1 would be flagged for no lead's approval"));
});

test("the relay out of sight: assigned and flagged all the same, the missing ping said", async () => {
  const w = fake({ codeowners: OWNERS, relay: false, open: [{ number: 7, title: "x", labels: [{ name: "life" }], assignees: [] }] });
  await N.night(w.d, { staleDays: 7 });
  assert.ok(w.calls.some((c) => c.join(" ").includes("issues/7/assignees")));
  assert.ok(w.said.includes("isaacw not pinged: the relay is not in sight"));
});
