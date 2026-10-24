// The owner's press (#117): who leads each label, set from Cowork by the repo's owner and landed on main at once.
// GitHub is a function that writes down its arguments; nothing here reaches the network. The guard is run for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const { leadsOf, cleanLeads, setLeads, leadsMessage, leadsLine, pressLeads, CODEOWNERS } = await import("../src/team/press.ts");
const { owners } = await import("../src/team/claims.ts");
type Deps = import("../src/team/press.ts").PressDeps;

const REAL = readFileSync(resolve(import.meta.dirname, "../../../.github/CODEOWNERS"), "utf8");
const SMALL = [
  "# label base: the engine.",
  "/sol/engine/                 @marco",
  "/sol/keep /sol/back  @marco",
  "",
  "# label cowork: the team.",
  "/sol/mac/src/cowork/         @marco @frank",
  "/sol/engine/src/team/        @marco",
  "",
  "# label social: no code yet.",
  "# leads: @marco",
  "",
].join("\n");

test("leadsOf reads each label's leads off CODEOWNERS, the social leads line too", () => {
  const l = leadsOf(SMALL);
  assert.deepEqual(l.base, ["marco"]);
  assert.deepEqual(l.cowork, ["marco", "frank"]);
  assert.deepEqual(l.social, ["marco"]);
  assert.deepEqual(l.life, [], "a label with no line has no leads");
  const real = leadsOf(REAL);
  assert.deepEqual(Object.keys(real), ["life", "work", "cowork", "social", "base", "product"]);
  for (const k of Object.keys(real)) assert.ok(real[k].length >= 1 && real[k].length <= 2, `${k} has one or two leads in the repo's own file`);
});

test("cleanLeads: one or two people, each once, no bots", () => {
  assert.deepEqual(cleanLeads(["@frank", "isaac"]), ["frank", "isaac"]);
  assert.deepEqual(cleanLeads(["frank", "Frank"]), ["frank"]);
  assert.match(String(cleanLeads([])), /needs one lead/);
  assert.match(String(cleanLeads(["a", "b", "c"])), /at most two/);
  assert.match(String(cleanLeads(["dependabot[bot]"])), /not a person/);
  assert.match(String(cleanLeads(["bad login!"])), /not a person/);
  assert.match(String(cleanLeads("frank")), /a list/);
});

test("setLeads moves people on one label's lines, never a path, and keeps the columns", () => {
  const next = setLeads(SMALL, "cowork", ["frank", "isaac"]);
  assert.match(next, /^\/sol\/mac\/src\/cowork\/         @frank @isaac$/m, "the gap before the owners is kept");
  assert.match(next, /^\/sol\/engine\/src\/team\/        @frank @isaac$/m);
  assert.match(next, /^\/sol\/engine\/                 @marco$/m, "another label is untouched");
  assert.deepEqual(owners(next), owners(SMALL), "what each label holds reads exactly as before");
  assert.deepEqual(leadsOf(next).cowork, ["frank", "isaac"]);
  assert.match(setLeads(SMALL, "social", ["isaac"]), /^# leads: @isaac$/m, "a label with no code: its leads line");
  assert.match(setLeads(SMALL, "base", ["frank"]), /^\/sol\/keep \/sol\/back  @frank$/m, "a line of several paths");
  assert.throws(() => setLeads(SMALL, "life", ["frank"]), /no line for life/);
  // on the repo's own file: every label can be set, and only the owners change
  for (const label of ["life", "work", "cowork", "social", "base", "product"]) {
    const n = setLeads(REAL, label, ["frank"]);
    assert.deepEqual(owners(n), owners(REAL), `${label}: the paths are the same`);
    assert.deepEqual(leadsOf(n)[label], ["frank"]);
    assert.equal(n.split("\n").length, REAL.split("\n").length);
  }
});

test("the commit says what changed, who pressed and why there is no PR; the ping says it in one line", () => {
  const m = leadsMessage("cowork", ["frank", "isaac"], ["marco"], "marco");
  assert.match(m.split("\n")[0], /^settings: cowork leads → @frank @isaac$/);
  assert.match(m, /Set by marco in Cowork, the owner's press \(#117\)/);
  assert.match(m, /Was: @marco\./);
  assert.match(m, /Sol-Setting: leads$/);
  assert.equal(leadsLine("cowork", ["frank"], ["marco"], "marco"), "cowork is now led by frank (was marco), set by marco");
});

function fake(o: { admin?: boolean; people?: string[]; file?: string; conflict?: boolean; team?: string[]; inSight?: string[] } = {}) {
  const calls: string[][] = [];
  const pings: { to: string; line: string; repo: string }[] = [];
  const d: Deps = {
    login: async () => "marco",
    team: () => o.team ?? ["frank", "isaac", "marco"],
    ping: (to, line, repo) => { pings.push({ to, line, repo }); return (o.inSight ?? [to]).includes(to); },
    gh: async (args) => {
      calls.push(args);
      const a = args.join(" ");
      if (a.includes(".permissions.admin")) return o.admin === false ? "false\n" : "true\n";
      if (a.includes("/collaborators")) return (o.people ?? ["frank", "isaac", "marco", "Wong-Tap"]).join("\n") + "\n";
      if (a.startsWith(`api repos/acme/sol/contents/${CODEOWNERS}?ref=main`)) return JSON.stringify({ sha: "blob1", content: Buffer.from(o.file ?? SMALL).toString("base64") });
      if (a.startsWith("api -X PUT")) { if (o.conflict) throw new Error("gh: .github/CODEOWNERS does not match blob1 (HTTP 409)"); return "c0ffee\n"; }
      return "";
    },
  };
  return { d, calls, pings };
}

test("the press: owner checked, people checked, one commit on main over the file just read, the team pinged", async () => {
  const { d, calls, pings } = fake();
  const r = await pressLeads(d, { repo: "acme/sol", label: "cowork", leads: ["frank", "wong-tap"] });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.deepEqual(r.leads, ["frank", "Wong-Tap"], "GitHub's own spelling of a login");
  assert.deepEqual(r.was, ["marco", "frank"]);
  assert.equal(r.commit, "c0ffee");
  const put = calls.find((c) => c[0] === "api" && c[1] === "-X")!;
  assert.deepEqual(put.slice(0, 4), ["api", "-X", "PUT", `repos/acme/sol/contents/${CODEOWNERS}`]);
  const f = (k: string) => put[put.findIndex((x) => x.startsWith(`${k}=`))].slice(k.length + 1);
  assert.equal(f("branch"), "main");
  assert.equal(f("sha"), "blob1", "written only over the version just read");
  assert.match(f("message"), /^settings: cowork leads → @frank @Wong-Tap/);
  assert.deepEqual(leadsOf(Buffer.from(f("content"), "base64").toString("utf8")).cowork, ["frank", "Wong-Tap"]);
  assert.deepEqual(pings.map((p) => p.to).sort(), ["Wong-Tap", "frank", "isaac"], "everyone but the one who pressed, once each");
  assert.ok(pings.every((p) => p.repo === "acme/sol" && /cowork is now led by frank and Wong-Tap \(was marco and frank\), set by marco/.test(p.line)));
  assert.deepEqual(r.pinged.sort(), ["Wong-Tap", "frank", "isaac"]);
});

test("the press refuses: not the owner, not a person on the repo, a bad label, too many; a moved file says so", async () => {
  const no = fake({ admin: false });
  const r1 = await pressLeads(no.d, { repo: "acme/sol", label: "cowork", leads: ["frank"] });
  assert.match(String((r1 as { error: string }).error), /only the owner of acme\/sol sets who leads; GitHub says marco is not/);
  assert.ok(!no.calls.some((c) => c.includes("PUT")), "nothing written");
  const r2 = await pressLeads(fake().d, { repo: "acme/sol", label: "cowork", leads: ["stranger"] });
  assert.match(String((r2 as { error: string }).error), /stranger has no access to acme\/sol; invite them on GitHub first/);
  assert.match(String((await pressLeads(fake().d, { repo: "acme/sol", label: "music", leads: ["frank"] }) as { error: string }).error), /the labels are/);
  assert.match(String((await pressLeads(fake().d, { repo: "acme/sol", label: "base", leads: ["a", "b", "c"] }) as { error: string }).error), /at most two/);
  const moved = await pressLeads(fake({ conflict: true }).d, { repo: "acme/sol", label: "base", leads: ["frank"] });
  assert.match(String((moved as { error: string }).error), /changed on main a moment ago; read the board again and press once more/);
});

test("the same leads again: nothing written, nobody pinged", async () => {
  const { d, calls, pings } = fake();
  const r = await pressLeads(d, { repo: "acme/sol", label: "base", leads: ["marco"] });
  assert.ok("ok" in r && r.unchanged);
  assert.ok(!calls.some((c) => c.includes("PUT")));
  assert.equal(pings.length, 0);
});

test("the guard refuses an agent the same write by hand (main-by-api), and lets the rest through", () => {
  const guard = resolve(import.meta.dirname, "../../harness/guard");
  const dir = mkdtempSync(join(tmpdir(), "press-guard-"));
  execFileSync("git", ["init", "-q", "-b", "marco/cowork-leads-117"], { cwd: dir });
  execFileSync("git", ["config", "sol.login", "marcocyl04-ux"], { cwd: dir });
  const run = (command: string) => execFileSync("node", [guard], { cwd: dir, encoding: "utf8", input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: dir }) });
  const put = "gh api -X PUT repos/acme/sol/contents/.github/CODEOWNERS -f message=x -f content=eA== -f sha=1";
  assert.match(run(put), /main-by-api/, "a contents write with no branch lands on main");
  assert.match(run(`${put} -f branch=main`), /main-by-api/);
  assert.match(run("gh api --method PATCH repos/acme/sol/git/refs/heads/main -f sha=abc"), /main-by-api/);
  assert.equal(run(`${put.replace("-f sha=1", "")} -f branch=frank/plan`), "", "a write on a person's own branch (their plan page) goes through");
  assert.equal(run("gh api repos/acme/sol/contents/.github/CODEOWNERS?ref=main --jq .sha"), "", "reading is never refused");
});
