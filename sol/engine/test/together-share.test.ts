// Share (#36, design/together/6-share/PRD.md): shared with me. The pure part (which paths count, titles, the
// signature, the card's file) is tested as is; a card shared from the desk is committed in a temp repo whose origin is a
// bare temp repo; reading GitHub goes through a fake `gh` on PATH that answers canned JSON, so nothing reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  SOL_TEAM_FILE: join(mkdtempSync(join(tmpdir(), "sol-team-")), "team.json"),
});
const S = await import("../src/team/share.ts");
type Card = import("../src/desk.ts").Card;

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

test("placeOf: product memory, designs and cards; code, videos, home and dotfiles stay out", () => {
  const is = (p: string, k: string | null) => assert.equal(S.placeOf(p), k, p);
  is("README.md", "memory"); is("now.md", "memory"); is("GLOSSARY.md", "memory");
  is("docs/TOGETHER.md", "memory"); is("docs/onboarding/frank.md", "memory"); is("docs/plan-gantt.png", "memory");
  is("docs/tool.mjs", null); is("CONTRIBUTING.md", null); is("sol/README.md", null);
  is("sol/design/together/6-share/PRD.md", "designs"); is("sol/design/together/1-see/shots/01-side.png", "designs");
  is("sol/design/look/board.html", "designs"); is("sol/design/notch-buttons/shots/clip-01.mjs", null);
  is("sol/design/x/clip.mp4", null); is("sol/design/x/data.json", null);
  is("sol/design/shared/contracts-set.json", "cards"); is("sol/design/shared/notes.md", null); is("sol/design/shared/a/b.json", null);
  is("sol/home/memory/MEMORY.md", null); is("sol/home/school/x.png", null);
  is("docs/../sol/home/x.md", null); is("/etc/passwd", null); is("docs/.secret.md", null); is("", null);
});

test("kindOf and groupOf: a shots folder counts as its parent's group", () => {
  assert.equal(S.kindOf("a/b.PNG"), "image"); assert.equal(S.kindOf("a.svg"), "image"); assert.equal(S.kindOf("a.md"), "md");
  assert.equal(S.kindOf("a.html"), "html"); assert.equal(S.kindOf("a.json"), "json"); assert.equal(S.kindOf("a.pdf"), "other");
  assert.equal(S.groupOf("sol/design/together/1-see/shots/01.png"), "together/1-see");
  assert.equal(S.groupOf("sol/design/together/1-see/shots/sub/01.png"), "together/1-see");
  assert.equal(S.groupOf("sol/design/together/1-see/PRD.md"), "together/1-see");
  assert.equal(S.groupOf("sol/design/README.md"), "");
});

test("titleOf: the first heading, a card's title, else the file's name", () => {
  assert.equal(S.titleOf("docs/TOGETHER.md", "intro line\n\n# **Together**: the `memo`\n\n## later"), "Together: the memo");
  assert.equal(S.titleOf("docs/x.md", "no heading at all"), "x");
  assert.equal(S.titleOf("docs/x.md"), "x");
  assert.equal(S.titleOf("sol/design/look/shots/01-side.png"), "01-side");
  assert.equal(S.titleOf("sol/design/shared/c.json", JSON.stringify({ id: "c", kind: "note", text: "hi", title: "Contracts" })), "Contracts");
  assert.equal(S.titleOf("sol/design/look/a.html", "<html><title>The board</title>"), "The board");
});

test("sortPaths: the tree maps to entries by place, memory in its fixed order", () => {
  const p = S.sortPaths(["sol/design/b/x.png", "docs/A.md", "GLOSSARY.md", "README.md", "sol/engine/src/a.ts", "sol/design/a/PRD.md", "sol/design/shared/k.json", "now.md"]);
  assert.deepEqual(p.memory, ["README.md", "now.md", "GLOSSARY.md", "docs/A.md"]);
  assert.deepEqual(p.designs, ["sol/design/a/PRD.md", "sol/design/b/x.png"]);
  assert.deepEqual(p.cards, ["sol/design/shared/k.json"]);
});

test("signOfCommit: a login, a noreply email, my own email, and an agent's signature", () => {
  assert.deepEqual(S.signOfCommit({ login: "frank", message: "fix" }), { login: "frank", agent: false });
  assert.deepEqual(S.signOfCommit({ name: "F", email: "123+frank-b@users.noreply.github.com", message: "x" }), { login: "frank-b", agent: false });
  assert.deepEqual(S.signOfCommit({ name: "Marco", email: "m@x.y", message: "x" }, "marco", "M@x.y"), { login: "marco", agent: false });
  assert.deepEqual(S.signOfCommit({ login: "isaac", message: "desk: share X\n\nSigned-by: isaac's agent\n" }), { login: "isaac", agent: true });
  assert.deepEqual(S.signOfCommit({ login: "marco", message: "x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" }), { login: "marco", agent: true });
  assert.equal(S.signOfCommit({}), undefined);
});

test("the shared card's file: only the card's own fields, and it reads back as the desk's card", () => {
  const played: Card = {
    id: "contracts-set", kind: "flashcards", title: "Contracts", at: 3,
    cards: [{ front: "What is consideration?", back: "Something of value.", got: true }], seen: [1, 2], startedAt: 9, path: "school/x.pdf",
  };
  const file = S.shareFile(played);
  const back = JSON.parse(file);
  assert.deepEqual(back, { id: "contracts-set", kind: "flashcards", title: "Contracts", at: 0, cards: [{ front: "What is consideration?", back: "Something of value." }] });
  assert.deepEqual(S.cardOfFile(file), back);
  const exam: Card = { id: "e1", kind: "exam", at: 5, minutes: 20, questions: [{ prompt: "2+2?", choices: ["3", "4"], answer: "4" }], given: ["4"], results: [true], startedAt: 1, doneAt: 2 };
  assert.deepEqual(JSON.parse(S.shareFile(exam)), { id: "e1", kind: "exam", at: 5, minutes: 20, questions: [{ prompt: "2+2?", choices: ["3", "4"], answer: "4" }], given: [], results: [] });
  const q: Card = { id: "q1", kind: "question", at: 1, prompt: "Why?", given: "because", result: true, open: true };
  assert.deepEqual(JSON.parse(S.shareFile(q)), { id: "q1", kind: "question", at: 1, prompt: "Why?" });
  const timer: Card = { id: "t", kind: "timer", at: 1, seconds: 600, startedAt: 4, left: 300 };
  assert.deepEqual(JSON.parse(S.shareFile(timer)), { id: "t", kind: "timer", at: 1, seconds: 600 });
  assert.throws(() => S.shareFile({ id: "p", kind: "page", at: 1, path: "school/x.pdf", image: "/pane-image?path=/home" } as Card));
  assert.throws(() => S.shareFile({ id: "../x", kind: "note", at: 1, text: "a" } as Card));
  assert.equal(S.cardOfFile("not json"), null);
  assert.equal(S.cardOfFile(JSON.stringify({ id: "p", kind: "page", path: "x" })), null);
});

function fixture() {
  const top = mkdtempSync(join(tmpdir(), "sol-share-"));
  const origin = join(top, "origin.git");
  git(top, "init", "-q", "--bare", "-b", "main", origin);
  const repo = join(top, "marco");
  mkdirSync(join(repo, "docs"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# Ecosystem\n");
  writeFileSync(join(repo, "docs", "TOGETHER.md"), "# Together\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "start");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "-u", "origin", "main");
  return { top, origin, repo };
}

test("commitCard: the card's file on <login>/shared, a signed commit, pushed; the checkout is not touched", async () => {
  const { origin, repo } = fixture();
  writeFileSync(join(repo, "README.md"), "# Ecosystem\n\nhalf-written\n");   // work in progress must stay exactly as it is
  writeFileSync(join(repo, "scratch.txt"), "untracked\n");
  git(repo, "add", "scratch.txt");
  const head = git(repo, "rev-parse", "HEAD"), status = git(repo, "status", "--porcelain");
  const card: Card = { id: "contracts-set", kind: "flashcards", title: "Contracts", at: 2, cards: [{ front: "a", back: "b", got: false }], seen: [0] };
  const r = await S.commitCard(repo, card, { login: "marco", sig: "marco's agent" });
  assert.equal(r.ok, true); assert.equal(r.pushed, true); assert.equal(r.branch, "marco/shared"); assert.equal(r.path, "sol/design/shared/contracts-set.json");
  // the checkout: same branch, same HEAD, same index and files, and no card file in the working tree
  assert.equal(git(repo, "branch", "--show-current"), "main");
  assert.equal(git(repo, "rev-parse", "HEAD"), head);
  assert.equal(git(repo, "status", "--porcelain"), status);
  assert.equal(readFileSync(join(repo, "README.md"), "utf8"), "# Ecosystem\n\nhalf-written\n");
  assert.equal(existsSync(join(repo, "sol/design/shared/contracts-set.json")), false);
  // the pushed branch: main plus exactly the one file, holding only the card
  assert.equal(git(origin, "rev-parse", "refs/heads/marco/shared"), r.sha);
  assert.equal(git(origin, "rev-parse", "marco/shared^"), head);
  assert.equal(git(origin, "diff", "--name-only", "main", "marco/shared"), "sol/design/shared/contracts-set.json");
  const file = JSON.parse(git(origin, "show", "marco/shared:sol/design/shared/contracts-set.json"));
  assert.deepEqual(file, { id: "contracts-set", kind: "flashcards", title: "Contracts", at: 0, cards: [{ front: "a", back: "b" }] });
  const msg = git(origin, "log", "-1", "--format=%B", "marco/shared");
  assert.match(msg, /^desk: share Contracts/); assert.match(msg, /^Signed-by: marco's agent$/m);
  assert.deepEqual(S.signOfCommit({ login: "marco", message: msg }), { login: "marco", agent: true });
  // a second card stacks on the first; the same id again replaces its file
  const r2 = await S.commitCard(repo, { id: "why", kind: "question", at: 1, prompt: "Why?", given: "x" }, { login: "marco", sig: "marco's agent" });
  assert.equal(git(origin, "rev-parse", "marco/shared^"), r.sha);
  assert.equal(git(origin, "ls-tree", "--name-only", "marco/shared", "sol/design/shared/"), "sol/design/shared/contracts-set.json\nsol/design/shared/why.json");
  await S.commitCard(repo, { ...card, title: "Contracts 2" }, { login: "marco", sig: "marco's agent" });
  assert.equal(git(origin, "rev-parse", "marco/shared^"), r2.sha);
  assert.equal(JSON.parse(git(origin, "show", "marco/shared:sol/design/shared/contracts-set.json")).title, "Contracts 2");
  assert.equal(git(repo, "status", "--porcelain"), status);
});

test("commitCard: a push that fails keeps the commit here and says so", async () => {
  const { repo } = fixture();
  git(repo, "remote", "set-url", "origin", join(tmpdir(), "no-such-origin-" + Date.now()));
  const r = await S.commitCard(repo, { id: "n", kind: "note", at: 1, text: "hi" }, { login: "marco", sig: "marco's agent" });
  assert.equal(r.pushed, false); assert.match(r.note ?? "", /^committed here, not pushed/);
  assert.equal(git(repo, "rev-parse", "refs/heads/marco/shared"), r.sha);
});

test("readRepoDisk: my checkout from disk, signed by git; uncommitted files are mine; my shared branch's cards", async () => {
  const { repo } = fixture();
  mkdirSync(join(repo, "sol/design/look/shots"), { recursive: true });
  writeFileSync(join(repo, "sol/design/look/shots/01.png"), "png");
  writeFileSync(join(repo, "sol/design/look/run.mjs"), "code");
  git(repo, "add", "-A");
  execFileSync("git", ["commit", "-qm", "look\n\nSigned-by: frank's agent"], { cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: "frank", GIT_AUTHOR_EMAIL: "9+frank@users.noreply.github.com" } });
  writeFileSync(join(repo, "docs/new.md"), "# Fresh page\n");
  await S.commitCard(repo, { id: "n", kind: "note", title: "A note", at: 1, text: "hi" }, { login: "marco", sig: "marco's agent", push: false });
  const r = await S.readRepoDisk("o/eco", repo, "marco");
  assert.equal(r.from, "checkout");
  assert.deepEqual(r.memory.map((e) => [e.path, e.title]), [["README.md", "Ecosystem"], ["docs/new.md", "Fresh page"], ["docs/TOGETHER.md", "Together"]]);
  assert.deepEqual(r.memory[1].by, { login: "marco", agent: false });
  assert.deepEqual(r.designs.map((e) => [e.path, e.group, e.kind]), [["sol/design/look/shots/01.png", "look", "image"]]);
  assert.deepEqual(r.designs[0].by, { login: "frank", agent: true });
  assert.equal(r.designs[0].local, join(repo, "sol/design/look/shots/01.png"));
  assert.deepEqual(r.cards.map((e) => [e.path, e.title, e.ref]), [["sol/design/shared/n.json", "A note", "marco/shared"]]);
  assert.deepEqual(r.cards[0].by, { login: "marco", agent: true });
});

test("readRepoGh: one recursive tree, text by blob, last commits over GraphQL, people's shared branches (fake gh)", async () => {
  const bin = mkdtempSync(join(tmpdir(), "sol-gh-"));
  const log = join(bin, "log");
  const card = JSON.stringify({ id: "set", kind: "flashcards", title: "Frank's set", at: 0, cards: [{ front: "a", back: "b" }] });
  const answers: Record<string, string> = {
    "trees/HEAD": JSON.stringify({ tree: [
      { path: "README.md", type: "blob", sha: "r1" }, { path: "docs", type: "tree", sha: "d" }, { path: "docs/TOGETHER.md", type: "blob", sha: "t1" },
      { path: "sol/design/a/shots/1.png", type: "blob", sha: "p1" }, { path: "sol/engine/src/x.ts", type: "blob", sha: "x1" },
    ] }),
    "contents/README.md": "# Eco\n", "contents/docs/TOGETHER.md": "# Together memo\n",
    "matching-refs": JSON.stringify([{ ref: "refs/heads/main", object: { sha: "m" } }, { ref: "refs/heads/frank/shared", object: { sha: "f" } }]),
    "contents/sol/design/shared?ref=frank%2Fshared": JSON.stringify([{ type: "file", path: "sol/design/shared/set.json", sha: "c1" }]),
    "contents/sol/design/shared/set.json?ref=frank%2Fshared": card,
    graphql: JSON.stringify({ data: { repository: { r0: {
      h0: { nodes: [{ committedDate: "2026-10-19T10:00:00Z", message: "x", author: { name: "M", user: { login: "marco" } } }] },
      h1: { nodes: [{ committedDate: "2026-10-18T10:00:00Z", message: "y\n\nSigned-by: isaac's agent", author: { name: "I", user: { login: "isaac" } } }] },
      h2: { nodes: [] },
    } } } }),
  };
  writeFileSync(join(bin, "answers.json"), JSON.stringify(answers));
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env node
const fs = require("fs"); const a = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + "\\n");
const ans = JSON.parse(fs.readFileSync(${JSON.stringify(join(bin, "answers.json"))}, "utf8"));
const url = a[1] || ""; let k;
if (url === "graphql") { const q = a.find((x) => x.startsWith("query=")) || ""; k = "graphql";
  if (q.includes("frank/shared")) { process.stdout.write(JSON.stringify({ data: { repository: { r0: { h0: { nodes: [{ committedDate: "2026-10-20T09:00:00Z", message: "desk: share\\n\\nSigned-by: frank's agent", author: { name: "F", user: { login: "frank" } } }] } } } } })); process.exit(0); } }
else if (url.includes("/git/trees/HEAD")) k = "trees/HEAD";
else if (url.includes("matching-refs")) k = "matching-refs";
else k = url.replace(/^repos\\/[^/]+\\/[^/]+\\//, "");
if (!(k in ans)) { process.stderr.write("no answer for " + url); process.exit(1); }
process.stdout.write(ans[k]);
`);
  chmodSync(join(bin, "gh"), 0o755);
  const PATH = process.env.PATH;
  process.env.PATH = `${bin}:${PATH}`;
  try {
    const r = await S.readRepoGh("o/eco");
    assert.equal(r.from, "github");
    assert.deepEqual(r.memory.map((e) => [e.title, e.by?.login, e.at]), [["Eco", "marco", "2026-10-19T10:00:00Z"], ["Together memo", "isaac", "2026-10-18T10:00:00Z"]]);
    assert.equal(r.memory[1].by?.agent, true);
    assert.deepEqual(r.designs.map((e) => [e.path, e.group, e.by]), [["sol/design/a/shots/1.png", "a", undefined]]);
    assert.deepEqual(r.cards.map((e) => [e.title, e.ref, e.by?.login, e.by?.agent]), [["Frank's set", "frank/shared", "frank", true]]);
    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(calls.filter((c) => String(c[1]).includes("/git/trees/")).length, 1, "the tree once");
    assert.ok(calls.every((c) => !String(c[1]).includes("sol/engine")), "code is never read");
    // read again: the texts and last commits are kept by blob sha, so only the tree and the branch list are asked
    const before = calls.length;
    await S.readRepoGh("o/eco");
    const again = readFileSync(log, "utf8").trim().split("\n").slice(before).map((l) => JSON.parse(l));
    assert.deepEqual(again.map((c) => String(c[1]).replace(/^repos\/o\/eco\//, "")).sort(), ["contents/sol/design/shared?ref=frank%2Fshared", "git/matching-refs/heads/", "git/trees/HEAD?recursive=1"]);
  } finally { process.env.PATH = PATH; }
});

// a gh that always fails: GitHub is not there, so a test that reads my checkout never reaches the network
async function noGh<T>(f: () => Promise<T>): Promise<T> {
  const bin = mkdtempSync(join(tmpdir(), "sol-nogh-"));
  writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n"); chmodSync(join(bin, "gh"), 0o755);
  const PATH = process.env.PATH;
  process.env.PATH = `${bin}:${PATH}`;
  try { return await f(); } finally { process.env.PATH = PATH; }
}

test("openShared: only a team repo, only a shared path, only a person's shared branch", () => noGh(async () => {
  const d = { repos: () => ["o/eco"], folders: async () => ({}), me: async () => "marco", local: true };
  assert.match((await S.openShared("x/y", "README.md", undefined, d)).error ?? "", /not one of the team's/);
  assert.match((await S.openShared("o/eco", "sol/home/memory/MEMORY.md", undefined, d)).error ?? "", /not shared/);
  assert.match((await S.openShared("o/eco", "docs/../sol/home/x.md", undefined, d)).error ?? "", /not shared/);
  assert.match((await S.openShared("o/eco", "sol/design/shared/a.json", "main", d)).error ?? "", /no shared cards/);
  const { repo } = fixture();
  mkdirSync(join(repo, "sol/design/a"), { recursive: true }); writeFileSync(join(repo, "sol/design/a/b.html"), "<p>"); writeFileSync(join(repo, "sol/design/a/c.png"), "png");
  const local = { ...d, folders: async () => ({ "o/eco": repo }) };
  S.forgetShared();
  assert.deepEqual(await S.openShared("o/eco", "docs/TOGETHER.md", undefined, local), { text: "# Together\n", local: join(repo, "docs/TOGETHER.md") });
  assert.deepEqual(await S.openShared("o/eco", "sol/design/a/b.html", undefined, local), { url: `file://${join(repo, "sol/design/a/b.html")}`, local: join(repo, "sol/design/a/b.html") });
  assert.match((await S.openShared("o/eco", "sol/design/a/c.png", undefined, local)).image ?? "", /^\/pane-image\?path=/);
  S.forgetShared();
}));

test("Codex review 1: a symlink in my checkout is never listed or read, wherever it points", () => noGh(async () => {
  const { top, repo } = fixture();
  mkdirSync(join(top, "home/memory"), { recursive: true }); writeFileSync(join(top, "home/memory/MEMORY.md"), "# private\n");
  mkdirSync(join(repo, "sol/home/memory"), { recursive: true }); writeFileSync(join(repo, "sol/home/memory/MEMORY.md"), "# home\n");
  symlinkSync("../sol/home/memory/MEMORY.md", join(repo, "docs/leak.md"));          // inside the repo, but the home
  symlinkSync(join(top, "home/memory/MEMORY.md"), join(repo, "docs/out.md"));         // outside the repo
  symlinkSync(join(top, "home"), join(repo, "docs/away"));                            // a folder that leads out
  symlinkSync("../sol/home", join(repo, "docs/inside"));                              // a folder that stays in, but is the home (Codex, second pass)
  mkdirSync(join(repo, "sol/design/x"), { recursive: true }); symlinkSync(join(top, "home/memory/MEMORY.md"), join(repo, "sol/design/x/p.md"));
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "links");
  assert.equal(await S.within(repo, "docs/leak.md"), null);
  assert.equal(await S.within(repo, "docs/out.md"), null);
  assert.equal(await S.within(repo, "docs/away/memory/MEMORY.md"), null);
  assert.equal(await S.within(repo, "docs/inside/memory/MEMORY.md"), null);
  assert.equal(await S.within(repo, "docs/../sol/home/memory/MEMORY.md"), null);
  assert.equal(await S.within(repo, "docs/TOGETHER.md"), join(repo, "docs/TOGETHER.md"));
  const r = await S.readRepoDisk("o/eco", repo, "marco");
  assert.deepEqual([...r.memory, ...r.designs].map((e) => e.path), ["README.md", "docs/TOGETHER.md"]);
  const d = { repos: () => ["o/eco"], folders: async () => ({ "o/eco": repo }), me: async () => "marco", local: true };
  S.forgetShared();
  for (const p of ["docs/leak.md", "docs/out.md", "docs/away/memory/MEMORY.md", "docs/inside/memory/MEMORY.md", "sol/design/x/p.md"]) {
    const o = await S.openShared("o/eco", p, undefined, d);
    assert.ok(o.error && !o.text, `${p} must not open`);
  }
  S.forgetShared();
}));

test("Codex review 2: a checkout sitting on <login>/shared keeps its staged change, its files and its HEAD", async () => {
  const { origin, repo } = fixture();
  git(repo, "switch", "-q", "-c", "marco/shared");
  git(repo, "push", "-q", "-u", "origin", "marco/shared");
  mkdirSync(join(repo, "sol/design/shared"), { recursive: true });
  writeFileSync(join(repo, "sol/design/shared/n.json"), "my own draft, not a card\n");   // the same path, in progress here
  writeFileSync(join(repo, "README.md"), "# Ecosystem\n\nstaged\n"); git(repo, "add", "README.md");
  writeFileSync(join(repo, "docs/TOGETHER.md"), "# Together\n\nnot staged\n");
  const head = git(repo, "rev-parse", "HEAD"), status = git(repo, "status", "--porcelain"), staged = git(repo, "diff", "--cached");
  const r = await S.commitCard(repo, { id: "n", kind: "note", title: "A note", at: 1, text: "hi" }, { login: "marco", sig: "marco's agent" });
  assert.equal(r.pushed, true);
  assert.equal(git(repo, "branch", "--show-current"), "marco/shared");
  assert.equal(git(repo, "rev-parse", "HEAD"), head);
  assert.equal(git(repo, "status", "--porcelain"), status);
  assert.equal(git(repo, "diff", "--cached"), staged);
  assert.equal(readFileSync(join(repo, "sol/design/shared/n.json"), "utf8"), "my own draft, not a card\n");
  assert.equal(readFileSync(join(repo, "docs/TOGETHER.md"), "utf8"), "# Together\n\nnot staged\n");
  // GitHub has it, on top of the branch as it was; the copy from origin here knows it, so my reader lists it
  assert.equal(git(origin, "rev-parse", "refs/heads/marco/shared"), r.sha);
  assert.equal(git(origin, "rev-parse", "marco/shared^"), head);
  assert.equal(git(origin, "diff", "--name-only", head, "marco/shared"), "sol/design/shared/n.json");
  assert.equal(git(repo, "rev-parse", "refs/remotes/origin/marco/shared"), r.sha);
  const listed = await noGh(() => S.readRepoDisk("o/eco", repo, "marco"));
  assert.deepEqual(listed.cards.filter((c) => c.ref === "marco/shared").map((c) => c.title), ["A note"]);
  // with nowhere to push, nothing is made at all
  git(repo, "remote", "set-url", "origin", join(tmpdir(), "no-such-origin-" + Date.now()));
  await assert.rejects(S.commitCard(repo, { id: "m", kind: "note", at: 1, text: "x" }, { login: "marco", sig: "marco's agent" }), /nothing changed here/);
  assert.equal(git(repo, "rev-parse", "HEAD"), head);
  assert.equal(git(repo, "status", "--porcelain"), status);
});

test("Codex review 3: only what the list shows opens, and a branch only for a card the list puts there", () => noGh(async () => {
  const { repo } = fixture();
  await S.commitCard(repo, { id: "n", kind: "note", title: "A note", at: 1, text: "hi" }, { login: "marco", sig: "marco's agent", push: false });
  const d = { repos: () => ["o/eco"], folders: async () => ({ "o/eco": repo }), me: async () => "marco", local: true };
  S.forgetShared();
  await S.getShared(true, d);
  writeFileSync(join(repo, "docs/secret.md"), "# not listed yet\n");            // after the list was read: not on it
  assert.match((await S.openShared("o/eco", "docs/secret.md", undefined, d)).error ?? "", /not on the list/);
  assert.match((await S.openShared("o/eco", "docs/nothere.md", undefined, d)).error ?? "", /not on the list/);
  assert.match((await S.openShared("o/eco", "docs/TOGETHER.md", "someone/shared", d)).error ?? "", /only a desk card/);
  assert.match((await S.openShared("o/eco", "sol/design/shared/n.json", "someone/shared", d)).error ?? "", /not on the list from that branch/);
  assert.deepEqual((await S.openShared("o/eco", "sol/design/shared/n.json", "marco/shared", d)).card?.text, "hi");
  assert.deepEqual((await S.openShared("o/eco", "sol/design/shared/n.json", undefined, d)).card?.text, "hi");   // the branch comes from the list
  S.forgetShared();
}));
