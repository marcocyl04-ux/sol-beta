// File it (#119): one press files an issue with the mode's label, the screen, the words and the shot, signed. GitHub is
// a function that writes down its arguments; nothing here reaches the network or takes a screenshot.
import { test } from "node:test";
import assert from "node:assert/strict";

const { fileIt, issueOf, healthLine, oneLine, MODES, WORDS_MAX } = await import("../src/team/file.ts");
const { claimsOf } = await import("../src/team/claims.ts");
type Deps = import("../src/team/file.ts").FileDeps;

const IMG = Buffer.from("not really a jpeg");
function fake(o: { github?: boolean; branch?: boolean; shot?: Buffer | null; putFails?: boolean; created?: string; login?: string } = {}) {
  const calls: string[][] = [];
  const bodies: { args: string[]; body: any }[] = [];
  const d: Deps = {
    login: async () => o.login ?? "marcocyl04-ux",
    mayGitHub: () => o.github ?? true,
    repo: () => "acme/sol",
    health: () => "kept · build: watching, 0 errors · face hot · nothing put back",
    build: async () => "main 7d9b3a3",
    shot: (id) => (id === "s1" ? (o.shot === undefined ? IMG : o.shot) : null),
    now: () => new Date("2026-10-22T10:04:05.123Z"),
    gh: async (args) => {
      calls.push(args);
      const a = args.join(" ");
      if (a.includes("/branches/")) { if (o.branch === false) throw new Error("Not Found"); return "marcocyl04-ux/shots\n"; }
      if (a.includes("git/ref/heads/main")) return "abc123\n";
      if (args[0] === "issue" && args[1] === "create") return o.created ?? "https://github.com/acme/sol/issues/120\n";
      return "";
    },
    ghInput: async (args, body) => { if (o.putFails) throw new Error("HTTP 422: too big"); bodies.push({ args, body }); return "{}"; },
  };
  return { d, calls, bodies };
}
const flag = (c: string[], f: string) => c[c.indexOf(f) + 1];
const created = (calls: string[][]) => calls.find((c) => c[0] === "issue" && c[1] === "create")!;

test("the modes, and the words made one line", () => {
  assert.deepEqual([...MODES], ["life", "work", "cowork"]);
  assert.equal(oneLine("  the orb\n jumps   twice \n"), "the orb jumps twice");
  assert.equal(oneLine("x".repeat(500)).length, WORDS_MAX);
});

test("life: one issue with the life label, the screen, the words and the shot, signed", async () => {
  const { d, calls, bodies } = fake();
  const r = await fileIt(d, { mode: "life", words: "the orb jumps twice\nwhen I scroll", page: "Life · chat", conversation: "codex:019a-77", shot: "s1" });
  assert.deepEqual(r, { number: 120, url: "https://github.com/acme/sol/issues/120", shot: true });
  const c = created(calls);
  assert.equal(flag(c, "-R"), "acme/sol");
  assert.equal(flag(c, "--label"), "life");
  assert.equal(flag(c, "--title"), "Life: the orb jumps twice when I scroll");
  const body = flag(c, "--body");
  assert.match(body, /^the orb jumps twice when I scroll\n/);
  assert.match(body, /- page: Life · chat\n/);
  assert.match(body, /- conversation: `codex:019a-77`\n/);
  assert.match(body, /- engine: kept · build: watching, 0 errors · face hot · nothing put back\n/);
  assert.match(body, /- Sol: main 7d9b3a3\n/);
  assert.match(body, /!\[the window\]\(https:\/\/github\.com\/acme\/sol\/blob\/marcocyl04-ux\/shots\/shots\/20261022-100405-life\.jpg\?raw=true\)/);
  assert.ok(body.endsWith("\n\n— marcocyl04-ux's agent"), "signed as the person's agent");
  // the shot went up on <login>/shots, as a JSON body (never an argument: it is too big for one)
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].args, ["api", "-X", "PUT", "repos/acme/sol/contents/shots/20261022-100405-life.jpg"]);
  assert.equal(bodies[0].body.branch, "marcocyl04-ux/shots");
  assert.equal(Buffer.from(bodies[0].body.content, "base64").toString(), "not really a jpeg");
  assert.match(bodies[0].body.message, /— marcocyl04-ux's agent\)$/);
  assert.ok(!calls.some((c) => c.includes("POST")), "the shots branch was there: not made again");
});

test("work: the same path, with the work label", async () => {
  const { d, calls } = fake();
  await fileIt(d, { mode: "work", words: "the side loses its fold", page: "Work · session", conversation: "6c1f", shot: "s1" });
  assert.equal(flag(created(calls), "--label"), "work");
  assert.match(flag(created(calls), "--title"), /^Work: the side loses its fold$/);
});

test("the first shot makes <login>/shots from main", async () => {
  const { d, calls } = fake({ branch: false });
  await fileIt(d, { mode: "life", words: "x", shot: "s1" });
  const mk = calls.find((c) => c.includes("POST"))!;
  assert.ok(mk.includes("ref=refs/heads/marcocyl04-ux/shots") && mk.includes("sha=abc123"));
});

test("no shot, an old shot, a failed upload: the issue is still filed and says so", async () => {
  {
    const { d, calls, bodies } = fake();
    const r = await fileIt(d, { mode: "life", words: "x" });
    assert.equal(r.shot, false);
    assert.equal(bodies.length, 0);
    assert.match(flag(created(calls), "--body"), /\n_no screenshot_\n/);
  }
  {
    const { d, calls } = fake({ shot: null });
    const r = await fileIt(d, { mode: "life", words: "x", shot: "s1" });
    assert.equal(r.shot, false);
    assert.match(r.note!, /too old or gone/);
    assert.match(flag(created(calls), "--body"), /_the screenshot was too old or gone; none attached_/);
  }
  {
    const { d, calls } = fake({ putFails: true });
    const r = await fileIt(d, { mode: "life", words: "x", shot: "s1" });
    assert.equal(r.number, 120);
    assert.match(flag(created(calls), "--body"), /_the screenshot did not upload \(HTTP 422: too big\)_/);
  }
});

test("refused: a wrong mode, no words, GitHub off; nothing is posted", async () => {
  const { d, calls, bodies } = fake({ github: false });
  await assert.rejects(fileIt(d, { mode: "social", words: "x" }), /which mode/);
  await assert.rejects(fileIt(d, { mode: "life", words: "  \n " }), /a line of your words/);
  await assert.rejects(fileIt(d, { mode: "life", words: "x", shot: "s1" }), /may not speak on GitHub/);
  assert.equal(calls.length + bodies.length, 0);
});

test("GitHub's answer without a number is an error, not a receipt", async () => {
  const { d } = fake({ created: "something went sideways" });
  await assert.rejects(fileIt(d, { mode: "life", words: "x" }), /did not say the number/);
});

test("the title is cut, the page and conversation cannot break the body", () => {
  const { title, body } = issueOf({ mode: "life", words: "w".repeat(200), page: "", conversation: "", health: "h", build: "", login: "frank" });
  assert.equal(title.length, 90);
  assert.ok(title.endsWith("…"));
  assert.match(body, /- page: Life\n- conversation: none open\n- engine: h\n\n_no screenshot_\n\n— frank's agent$/);
});

test("the health line says the four cells", () => {
  assert.equal(healthLine(null), "not read yet");
  assert.equal(healthLine({ kept: true, build: { alive: true, errors: 0 }, face: true, reverted: null }), "kept · build: watching, 0 errors · face hot · nothing put back");
  assert.equal(healthLine({ kept: false, build: { alive: true, errors: 2 }, face: false, reverted: { what: "engine", at: "2026-10-22T09:00:00Z" } }),
    "not kept · build: 2 errors · face cold · put back (engine) at 2026-10-22T09:00:00Z");
  assert.equal(healthLine({ kept: true, build: null, face: true, reverted: null }), "kept · no build watcher · face hot · nothing put back");
});

test("a <login>/shots branch is nobody's claim", () => {
  const got = claimsOf([], [{ branch: "marcocyl04-ux/shots", paths: ["shots/x.jpg"] }, { branch: "marcocyl04-ux/life-file-it-119", paths: ["sol/mac/src/App.tsx"] }], "");
  assert.deepEqual(got.map((c) => c.branch), ["marcocyl04-ux/life-file-it-119"]);
});
