// Ship (#33, design/together/3-ship/PRD.md): stamp stable, one stable back, the offer, update on yes. Every case runs
// real git in a temp repo whose origin is a bare temp repo (like test/back.test.ts); GitHub (gh) and the type-check
// are stand-ins, so nothing here reaches the network or builds anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// hermetic git: no global config (a signing rule or a hook there must not run here), a fixed name
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  SOL_NO_SHIP_CHECK: "1", SOL_TEAM_FILE: join(mkdtempSync(join(tmpdir(), "sol-team-")), "team.json"),
});
const { stamp, stampChecks, stables, update, heardStable, hear, startShip, tagName, typecheck, offerNow, askOrigin } = await import("../src/team/ship.ts");
const { handleTeam, addTeamFace } = await import("../src/team/wire.ts");
const { onBusy } = await import("../src/busy.ts");
const { cardOf, keyAction } = await import("../../mac/src/notch/answer.ts");
type Ship = import("../src/team/ship.ts").Ship;

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

function fixture() {
  const top = mkdtempSync(join(tmpdir(), "sol-ship-"));
  const origin = join(top, "origin.git");
  git(top, "init", "-q", "--bare", "-b", "main", origin);
  const repo = join(top, "marco");
  mkdirSync(join(repo, "sol", "engine", "src"), { recursive: true });
  mkdirSync(join(repo, "sol", "mac", "src"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "sol", "engine", "src", "index.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "sol", "mac", "src", "App.tsx"), "export const b = 1;\n");
  writeFileSync(join(repo, ".gitignore"), "sol/engine/dist.good/\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "start");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "-u", "origin", "main");
  return { top, origin, repo, sol: join(repo, "sol") };
}
const commit = (repo: string, file: string, text: string, push = true) => {
  writeFileSync(join(repo, file), text);
  git(repo, "add", "-A"); git(repo, "commit", "-qm", `change ${file}`);
  if (push) git(repo, "push", "-q");
  return git(repo, "rev-parse", "HEAD");
};
function deps(sol: string, over: Partial<Ship> = {}) {
  const sent: any[] = [], gh: string[][] = [], checked: string[] = [];
  let minute = 0;
  const d: Ship = {
    root: sol,
    gh: async (args) => { gh.push(args); return ""; },
    typecheck: async (_root, part) => { checked.push(part); return null; },
    send: (_kind, p) => { sent.push(p); },
    me: async () => "marco",
    now: () => new Date(2026, 9, 20, 22, 14 + minute++),
    ...over,
  };
  return { d, sent, gh, checked };
}

test("stamp refuses, with the reason: a dirty tree, off main, main not pushed, a red build", async () => {
  const f = fixture();
  const { d } = deps(f.sol);
  writeFileSync(join(f.repo, "sol", "mac", "src", "App.tsx"), "export const b = 2;\n");
  let r = await stamp(d);
  assert.match(String((r as any).error), /the tree has 1 uncommitted change; commit first/);
  git(f.repo, "checkout", "-q", "--", ".");

  git(f.repo, "checkout", "-q", "-b", "frank/desk-timer");
  r = await stamp(d);
  assert.match(String((r as any).error), /on frank\/desk-timer, not main/);
  git(f.repo, "checkout", "-q", "main");

  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 3;\n", false);
  r = await stamp(d);
  assert.match(String((r as any).error), /main has 1 commit not pushed; push first/);
  git(f.repo, "push", "-q");

  const red = deps(f.sol, { typecheck: async (_r, part) => (part === "face" ? "1 type error, the first: src/App.tsx(1,1): error TS2322" : null) });
  r = await stamp(red.d);
  assert.match(String((r as any).error), /the window's code does not build: 1 type error/);
  const redEngine = deps(f.sol, { typecheck: async (_r, part) => (part === "engine" ? "2 type errors" : null) });
  assert.match(String(((await stamp(redEngine.d)) as any).error), /Sol's code does not build: 2 type errors/);
  // none of the refusals moved anything
  assert.equal(git(f.origin, "branch", "--list", "stable"), "");
  assert.equal(git(f.repo, "tag", "--list"), "");
});

test("the build check: the keeper's record for this commit stands in for the engine's type-check; the face is always checked", async () => {
  const f = fixture();
  const head = git(f.repo, "rev-parse", "HEAD");
  let x = deps(f.sol);
  let c = await stampChecks(x.d);
  assert.equal(c.ok, true);
  assert.deepEqual(x.checked, ["engine", "face"], "no record: the engine is type-checked");
  assert.match((c as any).how, /fresh type-check \(no good build on record/);

  mkdirSync(join(f.sol, "engine", "dist.good"), { recursive: true });
  writeFileSync(join(f.sol, "engine", "dist.good", ".commit"), head + "\n");
  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 4;\n");   // a face change: the engine's record still holds
  x = deps(f.sol);
  c = await stampChecks(x.d);
  assert.deepEqual(x.checked, ["face"]);
  assert.match((c as any).how, new RegExp(`its last good build \\(${head.slice(0, 7)}, the same code\\)`));

  commit(f.repo, "sol/engine/src/index.ts", "export const a = 2;\n");   // the engine changed since: the record is stale
  x = deps(f.sol);
  await stampChecks(x.d);
  assert.deepEqual(x.checked, ["engine", "face"]);

  // the real check with no TypeScript installed says so, and a stamp is refused on it
  assert.match(String(await typecheck(f.sol, "engine")), /no TypeScript in engine\/node_modules/);
  const real = deps(f.sol, { typecheck });
  assert.match(String(((await stamp(real.d)) as any).error), /Sol's code does not build: cannot check it/);
});

test("stamp: an annotated stable-<date> tag, the branch moved, both pushed, the signed line, stable on the relay", async () => {
  const f = fixture();
  const head = git(f.repo, "rev-parse", "HEAD");
  const x = deps(f.sol);
  const kinds: string[] = [];
  const off = onBusy((jobs) => { for (const j of jobs) kinds.push(j.kind); });
  const r = await stamp(x.d) as any;
  off();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.tag, "stable-20261020-2214");
  assert.equal(r.sha, head);
  assert.equal(git(f.repo, "rev-parse", "stable"), head);
  assert.equal(git(f.origin, "rev-parse", "refs/heads/stable"), head, "stable is on GitHub");
  assert.equal(git(f.origin, "rev-parse", "refs/tags/stable-20261020-2214^{commit}"), head, "so is its tag");
  assert.equal(git(f.repo, "cat-file", "-t", "stable-20261020-2214"), "tag", "annotated");
  assert.match(git(f.repo, "tag", "-l", "--format=%(contents)", "stable-20261020-2214"), /stamped by marco/);
  assert.deepEqual(x.sent, [{ sha: head, tag: "stable-20261020-2214", by: "marco" }], "a human's hand: `marco`, never `marco's agent`");
  assert.match(r.note, /not written: origin is not on GitHub/, "a local origin has no tracker; the stamp still stands");
  assert.ok(kinds.includes("stamp"), "a stamp holds the busy counter: no renew lands mid-push");

  // a second stamp in the same minute gets its own name
  const y = deps(f.sol, { now: () => new Date(2026, 9, 20, 22, 14) });
  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 5;\n");
  assert.equal(((await stamp(y.d)) as any).tag, "stable-20261020-2214-2");
});

test("stamp from the live checkout (#66, #391): live at GitHub's main stamps that commit; live that drifted is refused with both named", async () => {
  const f = fixture();
  const { d, sent } = deps(f.sol);
  git(f.repo, "checkout", "-q", "-b", "live");   // the NucBox: promote put main's commit here
  git(f.repo, "push", "-q", "-u", "origin", "live");   // and live tracks origin/live (sol/live-setup), which the stamp must not measure by
  const r = await stamp(d);
  assert.equal((r as any).ok, true, String((r as any).error));
  assert.equal((r as any).sha, git(f.repo, "rev-parse", "HEAD"));
  assert.equal(git(f.repo, "rev-parse", "origin/stable"), git(f.repo, "rev-parse", "HEAD"));
  assert.equal(sent.length, 1);
  // a promote: main moved on GitHub, the NucBox took that commit as live (git checkout -B live <sha>, sol/promote) and
  // fetched nothing else, so its origin/live is stale: the stamp measures by GitHub's main, never by live's upstream
  const other = join(f.top, "other");
  git(f.top, "clone", "-q", f.origin, other);
  commit(other, "README.md", "promoted\n");
  git(f.repo, "fetch", "-q", "origin", "main");
  git(f.repo, "checkout", "-q", "-B", "live", git(f.repo, "rev-parse", "origin/main"));   // by sha, as promote does: the upstream stays origin/live
  const r1 = await stamp(d);
  assert.equal((r1 as any).ok, true, String((r1 as any).error));
  assert.equal((r1 as any).sha, git(f.repo, "rev-parse", "HEAD"));
  // main moved on GitHub since the last promote: live is behind, and says so
  const ahead = commit(other, "README.md", "moved\n");
  const r2 = await stamp(d);
  assert.match(String((r2 as any).error), new RegExp(`on live at [0-9a-f]{7}, not at GitHub's main \\(${ahead.slice(0, 7)}\\); promote first`));
  // a commit on live itself: ahead, refused the same way
  git(f.repo, "pull", "-q", "--ff-only", "origin", "main");
  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 3;\n", false);
  const r3 = await stamp(d);
  assert.match(String((r3 as any).error), /on live at [0-9a-f]{7}, not at GitHub's main/);
  // and `update` still leaves live alone (sol/promote moves it)
  git(f.repo, "reset", "-q", "--hard", "origin/main");
  assert.match(String((await update(d) as any).error), /you are on live; switch to main first/);
});

test("stamp from MY SOL (#140): off main it stamps GitHub's main from the checkout of main beside it, brought up first", async () => {
  const f = fixture();
  git(f.repo, "branch", "stable");
  const mine = join(f.top, "my-sol");
  git(f.repo, "worktree", "add", "-q", "-b", "marco/mine", mine, "stable");
  commit(mine, "sol/mac/src/App.tsx", "export const b = 9;\n", false);   // his own, never stamped
  // a merge lands on GitHub's main from elsewhere: the checkout of main is behind it
  const other = join(f.top, "frank");
  git(f.top, "clone", "-q", f.origin, other);
  const merged = commit(other, "sol/engine/src/index.ts", "export const a = 2;\n");
  assert.notEqual(git(f.repo, "rev-parse", "HEAD"), merged);

  const x = deps(join(mine, "sol"));
  const s = await stables(x.d);
  assert.equal(s.head?.sha, merged, "the confirm names what will be stamped: GitHub's main, not his branch");
  assert.equal(s.head?.branch, "main");
  const r = await stamp(x.d) as any;
  assert.equal(r.ok, true, r.error);
  assert.equal(r.sha, merged);
  assert.equal(git(f.origin, "rev-parse", "refs/heads/stable"), merged, "stable on GitHub is main, his own commit is not in it");
  assert.equal(git(f.repo, "rev-parse", "HEAD"), merged, "the checkout of main followed GitHub's main");
  assert.equal(git(mine, "branch", "--show-current"), "marco/mine", "his checkout is left as it was");

  // the checkout of main with a change nobody committed: refused, nothing moves
  writeFileSync(join(f.repo, "sol", "mac", "src", "App.tsx"), "export const b = 7;\n");
  commit(other, "sol/engine/src/index.ts", "export const a = 3;\n");
  const r2 = await stamp(deps(join(mine, "sol")).d) as any;
  assert.match(String(r2.error), /uncommitted change|cannot follow GitHub's main/);
  assert.equal(git(f.origin, "rev-parse", "refs/heads/stable"), merged);
});

test("stamp beside a Sol living on stable (#368): GitHub's stable and the tag move, the branch that Sol holds stays, that Sol is offered it; one stable back the same", async () => {
  const f = fixture();
  const first = git(f.repo, "rev-parse", "HEAD");
  const x = deps(f.sol);
  const r1 = await stamp(x.d) as any;
  assert.equal(r1.ok, true, r1.error);
  assert.equal(git(f.repo, "rev-parse", "refs/heads/stable"), first, "nobody holds stable: the local branch follows");
  // a Sol lives on `stable` beside the workshop (Frank's, 2026-10-29), and its own button presses the stamp: git will
  // not move that branch, the stamp runs from main's checkout beside it (onMain) and GitHub takes it all the same
  const live = join(f.top, "live");
  git(f.repo, "worktree", "add", "-q", live, "stable");
  const head = commit(f.repo, "sol/mac/src/App.tsx", "export const b = 2;\n");
  const told: any[] = [];
  const l = deps(join(live, "sol"));
  startShip(join(live, "sol"), (m) => told.push(m), l.d);
  const r2 = await stamp(l.d) as any;
  assert.equal(r2.ok, true, r2.error);
  assert.equal(r2.sha, head);
  assert.equal(git(f.origin, "rev-parse", "refs/heads/stable"), head, "stable moved on GitHub");
  assert.equal(git(f.origin, "rev-parse", `refs/tags/${r2.tag}^{commit}`), head, "with its tag");
  assert.equal(git(f.repo, "rev-parse", "refs/heads/stable"), first, "the branch that Sol lives on stays where it is: its checkout did not move under it");
  assert.deepEqual(l.sent.at(-1), { sha: head, tag: r2.tag, by: "marco" });
  // that Sol hears its own stamp like any other: behind, so offered; its own Update moves it
  for (let i = 0; i < 100 && !told.length; i++) await new Promise((ok) => setTimeout(ok, 20));
  assert.deepEqual(told[0], { type: "team.stable", sha: head, tag: r2.tag, by: "marco", mine: first, behind: true }, "offered to itself");
  assert.equal(offerNow()?.sha, head);
  const u = await update(l.d) as any;
  assert.equal(u.ok, true, u.error);
  assert.equal(git(live, "rev-parse", "HEAD"), head);
  assert.equal(await heardStable(l.d, { sha: head, tag: r2.tag, by: "marco" }), null, "on it now: nothing to offer");
  // one stable back, with the Sol still living on `stable`: GitHub's branch alone moves, the tags stay, the checkout stays
  const r3 = await stamp(l.d, r1.tag) as any;
  assert.equal(r3.ok, true, r3.error);
  assert.equal(git(f.origin, "rev-parse", "refs/heads/stable"), first, "back on GitHub");
  assert.equal(git(f.origin, "rev-parse", `refs/tags/${r2.tag}^{commit}`), head, "the tag stays");
  assert.equal(git(live, "rev-parse", "HEAD"), head, "that Sol is not moved under it");
  assert.equal(git(f.repo, "rev-parse", "refs/heads/stable"), head, "the held branch stays where that Sol is");
  // a step back is forced only over the stable last seen here: one stamped elsewhere in between is refused, not overwritten
  const other = join(f.top, "other");
  git(f.top, "clone", "-q", f.origin, other);
  const theirs = commit(other, "sol/engine/src/index.ts", "export const a = 5;\n");
  git(other, "push", "-q", "origin", `${theirs}:refs/heads/stable`);
  const r4 = await stamp(l.d, r2.tag) as any;
  assert.match(String(r4.error), /^GitHub did not take it/);
  assert.equal(git(f.origin, "rev-parse", "refs/heads/stable"), theirs, "their stamp stands");
  await stables(l.d);   // the picker opens again: origin's stable is fetched, the step back goes over what is seen
  const r5 = await stamp(l.d, r2.tag) as any;
  assert.equal(r5.ok, true, r5.error);
  assert.equal(git(f.origin, "rev-parse", "refs/heads/stable"), head);
});

test("the beta repo (#79): an export of what runs, on the previous export, never the house; a step back follows; no remote, no word", async () => {
  const f = fixture();
  // the house: things a tester must never see
  writeFileSync(join(f.repo, "now.md"), "where we are\n");
  mkdirSync(join(f.repo, "docs"), { recursive: true }); writeFileSync(join(f.repo, "docs", "PLAN.md"), "the plan\n");
  mkdirSync(join(f.repo, "sol", "design", "x"), { recursive: true });
  writeFileSync(join(f.repo, "sol", "design", "tempo.json"), "{}\n"); writeFileSync(join(f.repo, "sol", "design", "x", "PRD.md"), "a memo\n");
  writeFileSync(join(f.repo, "sol", "setup"), "#!/bin/bash\n");
  commit(f.repo, "sol/HELP.md", "help\n");
  // no beta remote: the stamp says nothing about one
  let r = await stamp(deps(f.sol).d) as any;
  assert.equal(r.ok, true, r.error);
  assert.equal(r.beta, undefined);

  const beta = join(f.top, "beta.git");
  git(f.top, "init", "-q", "--bare", "-b", "main", beta);
  git(f.repo, "remote", "add", "beta", beta);
  git(f.repo, "push", "-q", "beta", "HEAD:refs/heads/main");   // the first day's full mirror sits there
  // origin wears GitHub's name so the line goes on the record (every push still lands in the temp origin)
  git(f.repo, "remote", "set-url", "origin", "https://github.com/example/sol-test.git");
  git(f.repo, "config", `url.${f.origin}.insteadOf`, "https://github.com/example/sol-test.git");
  const first = r.sha;
  const head = commit(f.repo, "sol/mac/src/App.tsx", "export const b = 2;\n");
  const x = deps(f.sol, { gh: async (args) => { x.gh.push(args); return args[1] === "list" ? "33\n" : ""; } });
  r = await stamp(x.d);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.beta, "the beta repo runs it too");
  assert.match(x.gh.find((a) => a[1] === "comment")?.at(-1) ?? "", /the beta repo runs it too/, "the line on the record says so");
  const main1 = git(beta, "rev-parse", "refs/heads/main");
  assert.notEqual(main1, head, "an export, not the commit itself");
  assert.deepEqual(git(beta, "ls-tree", "-r", "--name-only", main1).split("\n").sort(),
    [".gitignore", "README.md", "sol/HELP.md", "sol/design/tempo.json", "sol/engine/src/index.ts", "sol/mac/src/App.tsx", "sol/setup"],
    "only what runs and the README: no now.md, no docs, no memo in design");
  assert.equal(git(beta, "rev-list", "--count", main1), "1", "the full mirror is replaced; no history of the house");
  assert.equal(git(beta, "log", "-1", "--format=%s", main1), `Sol ${r.tag}`);
  assert.match(git(beta, "show", `${main1}:README.md`), new RegExp(`beta testers run: ${r.tag}\\.`), "the README names the version");
  assert.equal(git(beta, "rev-parse", `refs/tags/${r.tag}`), main1, "the tag points at the export");
  assert.equal(git(beta, "rev-parse", "refs/heads/stable"), main1, "and beta's stable moves with it: a tester's hourly ask finds the new version");
  assert.equal(git(beta, "cat-file", "-p", `${main1}:sol/mac/src/App.tsx`), "export const b = 2;", "the file is the stamp's");

  // one stable back: a new export on top of the last one (a tester's pull moves), of the older commit
  r = await stamp(x.d, "stable-20261020-2214");
  assert.equal(r.ok, true, r.error);
  const main2 = git(beta, "rev-parse", "refs/heads/main");
  assert.equal(git(beta, "rev-parse", `${main2}^`), main1, "chained on the previous export");
  assert.equal(git(beta, "rev-list", "--count", main2), "2");
  assert.equal(git(beta, "cat-file", "-p", `${main2}:sol/mac/src/App.tsx`), "export const b = 1;");
  assert.equal(git(beta, "rev-parse", "refs/heads/stable"), main2, "beta's stable follows the step back too (a fast-forward for a tester)");
  assert.equal(git(f.origin, "rev-parse", "refs/heads/stable"), first, "and stable itself");

  // the beta repo refusing is a word on the line, never an undo: stable stood
  git(f.repo, "remote", "set-url", "beta", join(f.top, "gone.git"));
  const head3 = commit(f.repo, "sol/mac/src/App.tsx", "export const b = 3;\n");
  r = await stamp(x.d);
  assert.equal(r.ok, true, r.error);
  assert.equal(git(f.origin, "rev-parse", "refs/heads/stable"), head3);
  assert.match(r.beta, /^the beta repo did not take it: /);
});

test("stamp: the signed line goes on the issue wearing `now`, else a commit status", async () => {
  const f = fixture();
  // the record reads GitHub's name for the repo as written; every fetch and push is rewritten to the temp origin
  // (insteadOf), so nothing leaves this machine
  git(f.repo, "remote", "set-url", "origin", "https://github.com/example/sol-test.git");
  git(f.repo, "config", `url.${f.origin}.insteadOf`, "https://github.com/example/sol-test.git");
  assert.equal(git(f.repo, "remote", "get-url", "origin"), f.origin);
  const now = deps(f.sol, { gh: async (args) => { now.gh.push(args); return args[1] === "list" ? "33\n" : ""; } });
  let r = await stamp(now.d) as any;
  assert.equal(r.ok, true, r.error);
  assert.equal(r.recorded, "a comment on #33");
  assert.deepEqual(now.gh[0].slice(0, 6), ["issue", "list", "-R", "example/sol-test", "--label", "now"]);
  assert.deepEqual(now.gh[1].slice(0, 5), ["issue", "comment", "33", "-R", "example/sol-test"]);
  assert.match(now.gh[1].at(-1)!, /^stable stamped: stable-20261020-2214 at [0-9a-f]{7}, by marco$/);

  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 6;\n");
  const none = deps(f.sol, { now: () => new Date(2026, 9, 21, 9, 0) });
  r = await stamp(none.d) as any;
  assert.equal(r.recorded, `a status on ${r.sha.slice(0, 7)}`);
  assert.deepEqual(none.gh[1].slice(0, 3), ["api", "-X", "POST"]);
  assert.equal(none.gh[1][3], `repos/example/sol-test/statuses/${r.sha}`);
  assert.ok(none.gh[1].includes("context=sol/stable"));

  const down = deps(f.sol, { now: () => new Date(2026, 9, 21, 9, 30), gh: async () => { throw Object.assign(new Error("x"), { stderr: "gh: not logged in" }); } });
  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 7;\n");
  r = await stamp(down.d) as any;
  assert.equal(r.ok, true, "the stamp stands without the line");
  assert.match(r.note, /not written: gh: not logged in/);
});

test("stamp: GitHub refusing the push deletes the local tag; the local branch was never moved", async () => {
  const f = fixture();
  const x = deps(f.sol);
  const first = await stamp(x.d) as any;
  // someone moved stable on GitHub to a commit main does not have: a forward stamp is refused, nothing local moves
  const other = join(f.top, "other");
  git(f.top, "clone", "-q", f.origin, other);
  git(other, "checkout", "-q", "-b", "side");
  commit(other, "x.txt", "side\n", false);
  git(other, "push", "-q", "-f", "origin", "side:stable");
  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 8;\n");
  const r = await stamp(deps(f.sol, { now: () => new Date(2026, 9, 22, 8, 0) }).d) as any;
  assert.match(String(r.error), /^GitHub did not take it/);
  assert.equal(git(f.repo, "rev-parse", "stable"), first.sha, "the local stable is where it was");
  assert.equal(git(f.repo, "tag", "--list", "stable-20261022-0800"), "", "the tag is gone");
});

test("one stable back: the last five tags, newest first; picking one moves stable alone, the tags stay", async () => {
  const f = fixture();
  const shas: string[] = [];
  for (let i = 0; i < 6; i++) {
    if (i) commit(f.repo, "sol/mac/src/App.tsx", `export const b = ${10 + i};\n`);
    const r = await stamp(deps(f.sol, { now: () => new Date(2026, 9, 20 + i, 12, 0) }).d) as any;
    assert.equal(r.ok, true, r.error);
    shas.push(r.sha);
  }
  const x = deps(f.sol);
  const list = await stables(x.d);
  assert.equal(list.tags.length, 5);
  assert.deepEqual(list.tags.map((t) => t.tag), ["stable-20261025-1200", "stable-20261024-1200", "stable-20261023-1200", "stable-20261022-1200", "stable-20261021-1200"]);
  assert.equal(list.tags[0].sha, shas[5], "a tag's commit, not the tag object");
  assert.equal(list.stable, shas[5]);
  assert.equal(list.head?.branch, "main");
  assert.match(list.tags[0].at, /^\d{4}-\d\d-\d\dT/);

  const back = deps(f.sol);
  const r = await stamp(back.d, "stable-20261023-1200") as any;
  assert.equal(r.ok, true, r.error);
  assert.equal(git(f.origin, "rev-parse", "refs/heads/stable"), shas[3], "stable on GitHub is the picked one");
  assert.equal(git(f.origin, "rev-parse", "refs/tags/stable-20261025-1200^{commit}"), shas[5], "the newer tag stays");
  assert.deepEqual(back.sent, [{ sha: shas[3], tag: "stable-20261023-1200", by: "marco" }]);
  assert.equal((await stables(back.d)).stable, shas[3]);
  assert.match(String(((await stamp(back.d, "stable-nope")) as any).error), /there is no tag stable-nope here/);
  assert.match(String(((await stamp(back.d, "v1.0")) as any).error), /not a stable tag/);
});

test("every Sol learns: a stable heard on the relay is offered while this checkout is behind it; never on live", async () => {
  const f = fixture();
  const frank = join(f.top, "frank");
  git(f.top, "clone", "-q", f.origin, frank);
  const fd = deps(join(frank, "sol")).d;
  const old = git(frank, "rev-parse", "HEAD");
  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 20;\n");
  const s = await stamp(deps(f.sol).d) as any;

  const o = await heardStable(fd, { sha: s.sha, tag: s.tag, by: "marco" });
  assert.deepEqual(o, { type: "team.stable", sha: s.sha, tag: s.tag, by: "marco", mine: "", behind: true }, "frank never fetched stable: nothing is his yet");
  git(frank, "branch", "stable", old);
  assert.equal((await heardStable(fd, { sha: s.sha, tag: s.tag, by: "marco" }))?.mine, old);
  assert.equal(await heardStable(fd, { sha: old, tag: "x", by: "marco" }), null, "his own stable: nothing to say");
  assert.equal(await heardStable(fd, { sha: "nope" }), null);
  // Marco's own Sol hears its own stamp: his stable is that sha, nothing is offered
  assert.equal(await heardStable(deps(f.sol).d, { sha: s.sha, tag: s.tag, by: "marco" }), null);
  // a checkout already holding it (main ahead of an older stable) is told, not offered
  git(f.repo, "branch", "-f", "stable", old);
  assert.equal((await heardStable(deps(f.sol).d, { sha: s.sha, tag: s.tag, by: "marco" }))?.behind, false);
  // the live Sol moves by sol/promote only
  git(frank, "checkout", "-q", "-b", "live");
  assert.equal(await heardStable(fd, { sha: s.sha, tag: s.tag, by: "marco" }), null);
});

test("update on yes: ff-only on main or stable; refuses a dirty tree, another branch, a main that went its own way", async () => {
  const f = fixture();
  const frank = join(f.top, "frank");
  git(f.top, "clone", "-q", f.origin, frank);
  const fd = deps(join(frank, "sol")).d;
  commit(f.repo, "sol/engine/src/index.ts", "export const a = 30;\n");
  const s = await stamp(deps(f.sol).d) as any;

  writeFileSync(join(frank, "sol", "mac", "src", "App.tsx"), "his edit\n");
  assert.deepEqual(await update(fd), { error: "you have changes; commit or stash first" });
  git(frank, "checkout", "-q", "--", ".");
  git(frank, "checkout", "-q", "-b", "frank/plan");
  assert.deepEqual(await update(fd), { error: "you are on frank/plan; switch to main first" });
  git(frank, "checkout", "-q", "main");

  const r = await update(fd) as any;
  assert.equal(r.ok, true, r.error);
  assert.equal(r.sha, s.sha);
  assert.equal(r.renews, true, "the engine's code changed: Sol renews");
  assert.equal(git(frank, "rev-parse", "HEAD"), s.sha, "main moved forward to stable");
  assert.equal(git(frank, "rev-parse", "stable"), s.sha, "his stable is the team's now");
  assert.equal(git(frank, "status", "--porcelain"), "");
  assert.equal(await heardStable(fd, { sha: s.sha, tag: s.tag, by: "marco" }), null, "nothing left to offer");

  commit(frank, "sol/mac/src/App.tsx", "his own commit\n", false);
  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 31;\n");
  await stamp(deps(f.sol, { now: () => new Date(2026, 9, 23, 10, 0) }).d);
  const diverged = await update(fd) as any;
  assert.match(String(diverged.error), /^main has commits stable does not, so it cannot move forward to it/);
});

test("update on MY SOL (#116): a */mine branch runs sol/mine/rebase, his commits go onto stable; a conflict changes nothing", async () => {
  const f = fixture();
  const mine = join(f.top, "my-sol");
  git(f.top, "clone", "-q", f.origin, mine);
  git(mine, "checkout", "-q", "-b", "marco/mine");
  mkdirSync(join(mine, "sol", "mine"), { recursive: true });
  copyFileSync(join(import.meta.dirname, "..", "..", "mine", "rebase"), join(mine, "sol", "mine", "rebase"));
  chmodSync(join(mine, "sol", "mine", "rebase"), 0o755);
  commit(mine, "sol/mac/src/Mine.tsx", "mine: his own look\n", false);
  const md = deps(join(mine, "sol")).d;
  commit(f.repo, "sol/engine/src/index.ts", "export const a = 40;\n");
  const s = await stamp(deps(f.sol).d) as any;

  const r = await update(md) as any;
  assert.equal(r.ok, true, r.error);
  assert.equal(r.sha, s.sha);
  assert.equal(r.renews, true, "stable changed the engine: Sol renews");
  assert.equal(git(mine, "rev-parse", "HEAD~1"), s.sha, "his one commit sits on the new stable");
  assert.equal(git(mine, "log", "-1", "--format=%s"), "change sol/mac/src/Mine.tsx");
  assert.equal(git(mine, "rev-parse", "stable"), s.sha, "his stable is the team's now");

  commit(mine, "sol/engine/src/index.ts", "export const a = 41;\n", false);   // his, on the line stable changes next
  const was = git(mine, "rev-parse", "HEAD");
  commit(f.repo, "sol/engine/src/index.ts", "export const a = 50;\n");
  await stamp(deps(f.sol, { now: () => new Date(2026, 9, 24, 10, 0) }).d);
  const c = await update(md) as any;
  assert.match(String(c.error), /sol\/engine\/src\/index\.ts, lines/);
  assert.equal(git(mine, "rev-parse", "HEAD"), was, "nothing changed");
  assert.equal(git(mine, "status", "--porcelain", "--untracked-files=no"), "");
});

test("the wire: team.stamp, team.stables, team.update answer by rid; a heard stable reaches every face and team.stable.get", async () => {
  const f = fixture();
  const frank = join(f.top, "frank");
  git(f.top, "clone", "-q", f.origin, frank);
  const told: any[] = [];
  const x = deps(join(frank, "sol"));
  startShip(join(frank, "sol"), (m) => told.push(m), x.d);
  const got: any[] = [];
  const face = { send: (m: object) => got.push(m) };
  addTeamFace(face);
  await handleTeam(face, { type: "team.stable.get", rid: "r0" });
  assert.deepEqual(got.at(-1), { type: "team.stable", rid: "r0", sha: null });

  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 40;\n");
  const s = await stamp(deps(f.sol).d) as any;
  await hear({ sha: s.sha, tag: s.tag, by: "marco" });
  assert.equal(told.length, 1);
  assert.deepEqual({ ...told[0], mine: undefined }, { type: "team.stable", sha: s.sha, tag: s.tag, by: "marco", mine: undefined, behind: true });
  assert.equal(offerNow()?.sha, s.sha);
  await handleTeam(face, { type: "team.stable.get" });
  assert.equal(got.at(-1).sha, s.sha, "a face that connects later asks and is told");

  await handleTeam(face, { type: "team.stables", rid: 7 });
  assert.equal(got.at(-1).type, "team.stables"); assert.equal(got.at(-1).rid, 7);
  assert.equal(got.at(-1).tags[0].tag, s.tag);

  await handleTeam(face, { type: "team.update", rid: "r1" });
  assert.deepEqual({ ...got.at(-1), renews: undefined }, { type: "team.update", rid: "r1", ok: true, sha: s.sha, renews: undefined });
  assert.equal(told.at(-1).behind, false, "every face hears the offer is answered");

  await handleTeam(face, { type: "team.stamp", rid: "r2" });   // frank's main is clean and pushed: his own stamp works too
  assert.equal(got.at(-1).type, "team.stamp"); assert.equal(got.at(-1).rid, "r2"); assert.equal(got.at(-1).ok, true, got.at(-1).error);
});

test("the notch's stable card: Update and Later, Return does nothing, Escape closes; it waits behind an ask and a turn", () => {
  const base = { crew: false, ping: null, unplugged: false, starting: false, ask: null, call: false, turn: null };
  const stable = { sha: "a".repeat(40), tag: "stable-20261020-2214", by: "marco" };
  const card = cardOf({ ...base, stable });
  assert.equal(card.kind, "stable");
  assert.deepEqual(card.buttons, ["update", "later"]);
  assert.equal(card.line, "a new stable is out (stable-20261020-2214, by marco)");
  assert.equal(keyAction(card, "Return"), null, "Return is never Update");
  assert.equal(keyAction(card, "Enter"), null);
  assert.equal(keyAction(card, "Escape"), "close");
  assert.deepEqual(cardOf({ ...base, stable: { ...stable, updating: true, said: "updating… Sol renews in a moment" } }), { kind: "stable", buttons: [], meta: "", line: "updating… Sol renews in a moment", stable: { ...stable, updating: true, said: "updating… Sol renews in a moment" } });
  assert.deepEqual(cardOf({ ...base, stable: { ...stable, failed: true, said: "you are on frank/plan; switch to main first" } }).buttons, ["later"]);
  assert.deepEqual(cardOf({ ...base, stable: { ...stable, said: "updated; Sol renews in a moment" } }).buttons, []);   // done: nothing left to press
  const ask = { id: "perm:1", sessionId: "s", seat: "claude", tool: "Edit", title: "Claude wants to edit A.tsx", n: 1, of: 1 };
  assert.equal(cardOf({ ...base, stable, ask }).kind, "ask");
  assert.equal(cardOf({ ...base, stable, turn: { seat: "claude", sessionId: "s", title: "ecosystem", kind: "work" } }).kind, "turn");
  assert.equal(cardOf({ ...base, stable: null }).kind, "plain");
  assert.equal(tagName(new Date(2026, 0, 5, 7, 3)), "stable-20260105-0703");
});

test("the stamper's own MY SOL is offered its stamp (#166): the shared stable branch does not hide it, and it hears itself", async () => {
  const f = fixture();
  git(f.repo, "branch", "stable");
  const old = git(f.repo, "rev-parse", "stable");
  const mine = join(f.top, "my-sol");
  git(f.repo, "worktree", "add", "-q", "-b", "marco/mine", mine, "stable");
  commit(mine, "sol/mac/src/App.tsx", "export const b = 9;\n", false);   // his own, never stamped
  const other = join(f.top, "frank");
  git(f.top, "clone", "-q", f.origin, other);
  const merged = commit(other, "sol/engine/src/index.ts", "export const a = 2;\n");   // frank's work, merged to main

  const told: any[] = [];
  const x = deps(join(mine, "sol"));
  startShip(join(mine, "sol"), (m) => told.push(m), x.d);
  const r = await stamp(x.d) as any;
  assert.equal(r.ok, true, r.error);
  assert.equal(git(mine, "rev-parse", "stable"), merged, "the stamp moved the stable branch MY SOL shares with main's checkout");
  for (let i = 0; i < 100 && !told.length; i++) await new Promise((ok) => setTimeout(ok, 20));
  assert.deepEqual(told[0], { type: "team.stable", sha: merged, tag: r.tag, by: "marco", mine: merged, behind: true },
    "the relay never echoes to the sender: the stamping Sol tells itself, and his branch lacks frank's work");
  assert.equal(offerNow()?.sha, merged);

  assert.equal(await heardStable(x.d, { sha: old, tag: "x", by: "marco" }), null, "an older stable his branch holds: nothing to offer");
  git(mine, "rebase", "-q", "stable");   // what Update runs (sol/mine/rebase)
  assert.equal(await heardStable(x.d, { sha: merged, tag: r.tag, by: "marco" }), null, "his branch is on it now: nothing to offer");
  // the checkout of main that stamped is on it already: no card there
  assert.equal(await heardStable(deps(f.sol).d, { sha: merged, tag: r.tag, by: "marco" }), null);
});

test("a Sol on stable that stamps from the checkout of main beside it is offered its own stamp (#344): the moved stable branch does not hide it while HEAD is behind", async () => {
  const f = fixture();
  git(f.repo, "branch", "stable");
  const old = git(f.repo, "rev-parse", "stable");
  const sol = join(f.top, "frank-sol");
  git(f.repo, "worktree", "add", "-q", sol, "stable");   // the README's layout: this Sol runs on the stable branch, main's checkout beside it
  git(sol, "checkout", "-q", "--detach");                 // the #281 workaround: stable is not checked out while the stamp moves it
  const merged = commit(f.repo, "sol/engine/src/index.ts", "export const a = 2;\n");   // main moved on since

  const told: any[] = [];
  const x = deps(join(sol, "sol"));
  startShip(join(sol, "sol"), (m) => told.push(m), x.d);
  const r = await stamp(x.d) as any;
  assert.equal(r.ok, true, r.error);
  assert.equal(r.sha, merged);
  assert.equal(git(sol, "rev-parse", "stable"), merged, "the stamp moved the stable branch this Sol shares with main's checkout");
  assert.equal(git(sol, "rev-parse", "HEAD"), old, "this Sol did not move");
  for (let i = 0; i < 100 && !told.length; i++) await new Promise((ok) => setTimeout(ok, 20));
  assert.deepEqual(told[0], { type: "team.stable", sha: merged, tag: r.tag, by: "marco", mine: merged, behind: true },
    "the stamping Sol tells itself, and its branch being on the sha does not hide that HEAD is behind");
  assert.equal(offerNow()?.sha, merged);

  // back on the stable branch at the old sha (the workaround's last step): still offered, and Update takes it
  git(sol, "checkout", "-q", "-B", "stable", old);
  assert.equal((await heardStable(x.d, { sha: merged, tag: r.tag, by: "marco" }))?.behind, true);
  const u = await update(x.d) as any;
  assert.equal(u.ok, true, u.error);
  assert.equal(git(sol, "rev-parse", "HEAD"), merged, "stable moved forward to the stamp");
  assert.equal(await heardStable(x.d, { sha: merged, tag: r.tag, by: "marco" }), null, "on it now: nothing to offer");
});

test("#353: a stamp whose relay word this Sol missed is offered by the hourly ask of GitHub; the same offer again says nothing new", async () => {
  const f = fixture();
  const frank = join(f.top, "frank-353");
  git(f.top, "clone", "-q", f.origin, frank);
  const told: any[] = [];
  const x = deps(join(frank, "sol"));
  startShip(join(frank, "sol"), (m) => told.push(m), x.d);

  await askOrigin();
  assert.equal(told.length, 0, "no stable on GitHub yet: nothing to offer");

  // Marco stamps while Frank's engine is off the relay: no `hear` from the relay here
  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 353;\n");
  const s = await stamp(deps(f.sol).d) as any;
  assert.equal(s.ok, true, s.error);

  await askOrigin();
  assert.equal(told.length, 1, "the ask of GitHub found the stamp");
  assert.deepEqual(told[0], { type: "team.stable", sha: s.sha, tag: s.tag, by: "", mine: "", behind: true }, "cloned before any stable: no stable branch here, so mine is empty");
  assert.equal(offerNow()?.sha, s.sha);

  await askOrigin();
  assert.equal(told.length, 1, "the next hour's ask finds the same offer: the faces are not told again");

  // the relay word arrives late, with the stamper's name: that is new, and said once
  await hear({ sha: s.sha, tag: s.tag, by: "marco" });
  assert.equal(told.length, 2);
  assert.equal(told[1].by, "marco");
  await askOrigin();
  assert.equal(told.length, 2, "GitHub's answer names no stamper; the name heard stays said");
  assert.equal(offerNow()?.by, "marco");

  // the same relay word twice (a reconnect's spool): said once
  await hear({ sha: s.sha, tag: s.tag, by: "marco" });
  assert.equal(told.length, 2);

  // HEAD comes to hold the sha by hand (a pull in Terminal, not Update): the next ask stands the offer answered
  git(frank, "fetch", "-q", "origin", "+refs/heads/stable:refs/remotes/origin/stable");
  git(frank, "merge", "-q", "--ff-only", "refs/remotes/origin/stable");
  await askOrigin();
  assert.equal(told.length, 3, "the faces hear it is no longer behind");
  assert.equal(told[2].behind, false);
  assert.equal(offerNow()?.behind, false, "a face that connects later is not shown Update for a sha HEAD holds");
  await askOrigin();
  assert.equal(told.length, 3, "and once is enough");

  // two tags on one sha (the same commit stamped twice): the ask names the newest
  commit(f.repo, "sol/mac/src/App.tsx", "export const b = 354;\n");
  const s2 = await stamp(deps(f.sol).d) as any;
  const s3 = await stamp(deps(f.sol).d) as any;
  assert.equal(s3.sha, s2.sha); assert.notEqual(s3.tag, s2.tag);
  await askOrigin();
  assert.equal(told.at(-1).sha, s2.sha);
  assert.equal(told.at(-1).tag, s3.tag, "of two tags on the sha, the later stamp's name");
});
