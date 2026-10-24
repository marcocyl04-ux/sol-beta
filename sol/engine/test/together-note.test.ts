// team_note (#83, docs/how-we-work/PRD.md section 10): the one way an agent writes to the team's memory. GitHub and
// git are functions that write down their arguments; nothing here reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";

const { teamNote, sign, KINDS } = await import("../src/team/note.ts");
type Deps = import("../src/team/note.ts").NoteDeps;

function fake(o: { branch?: string; prs?: string; plan?: { sha: string; body: string } | null; branchExists?: boolean; github?: boolean } = {}) {
  const calls: string[][] = [];
  const d: Deps = {
    cwd: "/repo",
    login: async () => "frank",
    mayGitHub: () => o.github ?? true,
    now: () => new Date("2026-10-22T10:00:00Z"),
    git: async (args) => { calls.push(["git", ...args]); return o.branch ?? "frank/work-timer-91"; },
    gh: async (args) => {
      calls.push(["gh", ...args]);
      const a = args.join(" ");
      if (a.startsWith("pr list")) return o.prs ?? "";
      if (a.startsWith("repo view")) return "acme/sol\n";
      if (a.includes("contents/plan.md?ref=")) {
        if (!o.plan) throw new Error("Not Found");
        return JSON.stringify({ sha: o.plan.sha, content: Buffer.from(o.plan.body).toString("base64") });
      }
      if (a.includes("/branches/")) { if (o.branchExists === false) throw new Error("Not Found"); return "frank/plan\n"; }
      if (a.includes("git/ref/heads/main")) return "abc123\n";
      return "";
    },
  };
  return { d, calls };
}
const bodyOf = (c: string[]) => c[c.indexOf("--body") + 1];

test("the signature and the kinds", () => {
  assert.equal(sign("frank"), "— frank's agent");
  assert.deepEqual(KINDS, ["change", "decision", "plan", "heads-up"]);
});

test("change: on the issue, and on the open PR of this branch, signed", async () => {
  const { d, calls } = fake({ prs: "41\n" });
  const r = await teamNote(d, { issue: 91, kind: "change", lines: "The timer card is drawn.\nThe sound is not." });
  assert.equal(r, "posted on #91 and PR #41");
  const issue = calls.find((c) => c[1] === "issue" && c[2] === "comment")!;
  assert.equal(issue[3], "91");
  assert.equal(bodyOf(issue), "The timer card is drawn.\nThe sound is not.\n\n— frank's agent");
  const pr = calls.find((c) => c[1] === "pr" && c[2] === "comment")!;
  assert.equal(pr[3], "41");
  assert.match(bodyOf(pr), /frank's agent$/);
});

test("change on main or with no PR: the issue only", async () => {
  const { d, calls } = fake({ branch: "main" });
  assert.equal(await teamNote(d, { issue: 91, kind: "change", lines: "x" }), "posted on #91");
  assert.ok(!calls.some((c) => c[1] === "pr"), "no PR lookup on main");
});

test("decision: a Decision line on the issue; the file line stays the author's", async () => {
  const { d, calls } = fake();
  const r = await teamNote(d, { issue: 91, kind: "decision", lines: "the timer rings once, never twice" });
  assert.match(r, /^posted on #91 as a decision/);
  assert.equal(bodyOf(calls.find((c) => c[2] === "comment")!), "**Decision.** the timer rings once, never twice\n\n— frank's agent");
});

test("heads-up: on the other issue, named from this one; needs `to`", async () => {
  const { d, calls } = fake();
  await assert.rejects(teamNote(d, { issue: 91, kind: "heads-up", lines: "x" }), /needs `to`/);
  await assert.rejects(teamNote(d, { issue: 91, kind: "heads-up", lines: "x", to: 91 }), /needs `to`/);
  const r = await teamNote(d, { issue: 91, kind: "heads-up", lines: "the wire gains a timer message", to: 17 });
  assert.equal(r, "posted on #17 as a heads-up from #91");
  const c = calls.find((x) => x[2] === "comment")!;
  assert.equal(c[3], "17");
  assert.equal(bodyOf(c), "**Heads-up** from #91: the wire gains a timer message\n\n— frank's agent");
});

test("plan: a dated entry at the end of plan.md on <login>/plan, with the file's sha", async () => {
  const { d, calls } = fake({ plan: { sha: "s1", body: "# frank's plan\n\nold\n" } });
  const r = await teamNote(d, { issue: 91, kind: "plan", lines: "next: the sound" });
  assert.equal(r, "written to frank's plan (plan.md on frank/plan); the board shows it");
  const put = calls.find((c) => c.includes("PUT"))!;
  assert.ok(put.includes("branch=frank/plan"));
  assert.ok(put.includes("sha=s1"));
  const content = Buffer.from(put[put.findIndex((x) => x.startsWith("content=")) ].slice("content=".length), "base64").toString("utf8");
  assert.equal(content, "# frank's plan\n\nold\n\n## 2026-10-22, #91\n\nnext: the sound\n");
  assert.ok(put.some((x) => x.startsWith("message=plan: #91, 2026-10-22 (— frank's agent)")));
});

test("plan: no plan yet makes the branch from main and the first page", async () => {
  const { d, calls } = fake({ plan: null, branchExists: false });
  await teamNote(d, { issue: 91, kind: "plan", lines: "first" });
  const mk = calls.find((c) => c.includes("POST"))!;
  assert.ok(mk.includes("ref=refs/heads/frank/plan") && mk.includes("sha=abc123"));
  const put = calls.find((c) => c.includes("PUT"))!;
  assert.ok(!put.some((x) => x.startsWith("sha=")), "a new file has no sha");
  const content = Buffer.from(put.find((x) => x.startsWith("content="))!.slice("content=".length), "base64").toString("utf8");
  assert.match(content, /^# frank's plan\n/);
  assert.match(content, /## 2026-10-22, #91\n\nfirst\n$/);
});

test("refused: no issue, a wrong kind, empty lines, GitHub off; nothing is posted", async () => {
  const { d, calls } = fake({ github: false });
  await assert.rejects(teamNote(d, { issue: 0, kind: "change", lines: "x" }), /which issue/);
  await assert.rejects(teamNote(d, { issue: 1, kind: "nope" as never, lines: "x" }), /kind is one of/);
  await assert.rejects(teamNote(d, { issue: 1, kind: "change", lines: "  \n" }), /nothing to note/);
  await assert.rejects(teamNote(d, { issue: 1, kind: "change", lines: "x" }), /may not speak on GitHub/);
  assert.equal(calls.filter((c) => c[0] === "gh").length, 0);
});
