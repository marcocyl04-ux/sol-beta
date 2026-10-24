// Claims (#98, docs/how-we-work/PRD.md section 7): which labels a branch's paths belong to, what each open PR or
// branch holds, and which of them touch where mine does. Pure; the CODEOWNERS text is the repo's own shape.
import { test } from "node:test";
import assert from "node:assert/strict";

const { owners, areasOf, claimsOf, overlap, issueOf, pathsOfLabel, meet } = await import("../src/team/claims.ts");

const CODEOWNERS = `# Labels and leads, one file.
# label base: the engine.
/sol/engine/                 @marco
/sol/PROTOCOL.md             @marco
/sol/keep /sol/back /sol/setup.d/  @marco

# label life: the face.
/sol/mac/src/                @marco

# label work: Work mode.
/sol/mac/src/work/           @frank
/sol/engine/src/work/        @frank

# label cowork: the team.
/sol/mac/src/cowork/         @isaac
/sol/engine/src/team/        @isaac

# label social: no code yet.
# leads: @marco

# label product: not code.
/docs/                       @marco
/CONTRIBUTING.md /GLOSSARY.md  @marco
`;

test("CODEOWNERS reads into patterns per label; owners and comments are not patterns", () => {
  const o = owners(CODEOWNERS);
  assert.deepEqual(o.filter((x) => x.label === "base").map((x) => x.pattern), ["sol/engine/", "sol/PROTOCOL.md", "sol/keep", "sol/back", "sol/setup.d/"]);
  assert.ok(!o.some((x) => x.pattern.startsWith("@") || x.pattern.startsWith("#")));
  assert.ok(!o.some((x) => x.label === "social"));
  assert.deepEqual(pathsOfLabel("work", CODEOWNERS), ["sol/mac/src/work/", "sol/engine/src/work/"]);
});

test("areas: the longest match wins, as in CODEOWNERS", () => {
  assert.deepEqual(areasOf(["sol/mac/src/work/Pane.tsx"], CODEOWNERS), ["work"]);
  assert.deepEqual(areasOf(["sol/mac/src/App.tsx"], CODEOWNERS), ["life"]);
  assert.deepEqual(areasOf(["sol/engine/src/team/board.ts"], CODEOWNERS), ["cowork"]);
  assert.deepEqual(areasOf(["sol/engine/src/index.ts", "/sol/keep"], CODEOWNERS), ["base"]);
  assert.deepEqual(areasOf(["sol/keeper.ts"], CODEOWNERS), [], "sol/keep is a file or folder, not a prefix of a name");
  // in the six labels' order, each once
  assert.deepEqual(areasOf(["docs/x.md", "sol/engine/src/work/runs.ts", "sol/engine/src/a.ts", "sol/engine/src/b.ts"], CODEOWNERS), ["work", "base", "product"]);
  assert.deepEqual(areasOf(["README.md"], CODEOWNERS), [], "a path no section names has no area");
});

test("the issue a claim names: #N in the PR, else Take's -N at the end, else N- first", () => {
  assert.equal(issueOf({ branch: "frank/x", title: "Timer", body: "Part of #91" }), 91);
  assert.equal(issueOf({ branch: "marco/product-two-agents-never-98" }), 98);
  assert.equal(issueOf({ branch: "marco/31-see" }), 31);
  assert.equal(issueOf({ branch: "marco/notes" }), undefined);
});

test("claims: open PRs and the branches without one; shared branches are nobody's", () => {
  const prs = [{ number: 41, branch: "frank/work-timer-91", author: "frank", paths: ["sol/engine/src/work/runs.ts"] }];
  const branches = [
    { branch: "frank/work-timer-91", paths: [] },          // the PR's own branch: counted once
    { branch: "isaac/cowork-board-cards-77", paths: ["sol/mac/src/cowork/Dashboard.tsx"] },
    { branch: "main", paths: ["x"] }, { branch: "stable", paths: [] }, { branch: "marco/plan", paths: ["plan.md"] }, { branch: "isaac/mine", paths: [] },
  ];
  assert.deepEqual(claimsOf(prs, branches, CODEOWNERS), [
    { branch: "frank/work-timer-91", issue: 91, pr: 41, login: "frank", paths: ["sol/engine/src/work/runs.ts"], areas: ["work"] },
    { branch: "isaac/cowork-board-cards-77", issue: 77, login: "isaac", paths: ["sol/mac/src/cowork/Dashboard.tsx"], areas: ["cowork"] },
  ]);
  // a bot's PR is its person's
  assert.equal(claimsOf([{ number: 2, branch: "x", author: "app[bot]", paths: [] }], [], CODEOWNERS)[0].login, "app");
});

test("meet: same file, same folder, or a folder pattern holding it; the repo's top is not a shared folder", () => {
  assert.ok(meet("sol/engine/src/team/board.ts", "sol/engine/src/team/board.ts"));
  assert.ok(meet("sol/engine/src/team/board.ts", "sol/engine/src/team/note.ts"));
  assert.ok(meet("sol/engine/", "sol/engine/src/index.ts"));
  assert.ok(meet("sol/engine/src/index.ts", "sol/engine/"));
  assert.ok(!meet("sol/engine/src/team/board.ts", "sol/engine/src/work/runs.ts"));
  assert.ok(!meet("README.md", "CONTRIBUTING.md"), "two files at the top do not overlap");
});

test("overlap: the claims that touch where mine does, with their shared paths named", () => {
  const others = claimsOf([
    { number: 41, branch: "frank/work-timer-91", author: "frank", paths: ["sol/engine/src/work/runs.ts", "docs/timer.md"] },
    { number: 42, branch: "isaac/cowork-see-31", author: "isaac", paths: ["sol/mac/src/cowork/Dashboard.tsx"] },
  ], [], CODEOWNERS);
  const mine = ["sol/engine/src/work/tools.ts", "CONTRIBUTING.md"];
  const o = overlap(mine, others);
  assert.equal(o.length, 1);
  assert.equal(o[0].pr, 41);
  assert.deepEqual(o[0].shared, ["sol/engine/src/work/runs.ts"]);
  assert.deepEqual(overlap(["now.md"], others), [], "nothing nearby");
  // a branch with no commits yet stands for its label's paths
  const fresh = overlap(pathsOfLabel("cowork", CODEOWNERS), others);
  assert.deepEqual(fresh.map((x) => x.pr), [42]);
});

// The harness rule base-second-branch, run as Claude Code runs it: a call on stdin, in a throwaway repo on a base
// branch, with a fake gh on PATH that answers the open PRs (and counts how often it is asked).
test("the harness: a push from a base branch stops while another person's base branch is open; mine go through", async () => {
  const { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { join, resolve } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const guard = resolve(import.meta.dirname, "../../harness/guard");
  const run = (o: { prs: unknown[]; cmd: string; branch?: string }) => {
    const dir = mkdtempSync(join(tmpdir(), "claims-guard-"));
    const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    g("init", "-q", "-b", o.branch ?? "marco/base-wire-17"); g("config", "sol.login", "marcocyl04-ux");
    const bin = join(dir, ".bin"); execFileSync("mkdir", [bin]);
    writeFileSync(join(bin, "gh"), `#!/bin/sh\necho x >> "${join(dir, ".asked")}"\ncat <<'J'\n${JSON.stringify(o.prs)}\nJ\n`); chmodSync(join(bin, "gh"), 0o755);
    const once = () => execFileSync("node", [guard], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: o.cmd }, cwd: dir }) });
    const out = once(); once();
    const asked = existsSync(join(dir, ".asked")) ? readFileSync(join(dir, ".asked"), "utf8").split("\n").filter(Boolean).length : 0;
    return { out, asked };
  };
  const frank = { number: 12, headRefName: "frank/base-relay-12", author: { login: "frank" } };
  const r = run({ prs: [frank], cmd: "git push -u origin HEAD" });
  assert.match(r.out, /base-second-branch/);
  assert.match(r.out, /base allows one open branch at a time; #12 \(frank\) is open: build on that branch or wait/);
  assert.equal(r.asked, 1, "the gh answer is kept for a minute: asked once for two calls");
  assert.match(run({ prs: [frank], cmd: "gh pr create --draft --body 'what to try'" }).out, /#12 \(frank\)/);
  assert.equal(run({ prs: [{ ...frank, headRefName: "marco/base-keep-9", author: { login: "marcocyl04-ux" } }], cmd: "git push" }).out, "", "my own second base branch goes through");
  assert.equal(run({ prs: [{ ...frank, headRefName: "frank/work-timer-91" }], cmd: "git push" }).out, "", "an open work branch is not base");
  assert.equal(run({ prs: [frank], cmd: "git push", branch: "marco/product-docs-3" }).out, "", "from a branch that is not base");
  assert.equal(run({ prs: [frank], cmd: "git status" }).out, "", "only a push or a PR is judged");
});
