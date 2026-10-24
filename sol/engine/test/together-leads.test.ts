// The leads' two rules (#118, src/team/leads.ts): who leads a label by CODEOWNERS, which leads an issue is missing,
// and when a merged PR lacks its lead's word. Pure, and routeIssues with a GitHub that writes down its arguments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const L = await import("../src/team/leads.ts");
const C = await import("../src/team/claims.ts");
type MergedPr = import("../src/team/leads.ts").MergedPr;

test("leads: the owners in each label's section, a `# leads:` line, two at most, never a team", () => {
  const l = L.leads([
    "# label base: x", "/sol/engine/ @a", "/sol/phone/ @a @b", "/sol/keep @c",
    "# label life: x", "/sol/mac/src/ @org/face-team @d",
    "# label social: no code", "# leads: @e @f",
    "# label nope: not one of the six", "/x/ @z",
    "/docs/ @y",
  ].join("\n"));
  assert.deepEqual(l, { life: ["d"], work: [], cowork: [], social: ["e", "f"], base: ["a", "b"], product: [] });
});

test("leads: the repo's own CODEOWNERS names Marco on all six, social by its leads line", () => {
  const l = L.leads(readFileSync(new URL("../../../.github/CODEOWNERS", import.meta.url), "utf8"));
  for (const label of C.LABELS) assert.deepEqual(l[label], ["marcocyl04-ux"], label);
});

test("missingLeads: each label's leads not assigned, never one who let go, nothing for a label with no lead", () => {
  const l = { life: ["isaacw"], work: [], cowork: ["fktsai", "marcocyl04-ux"], social: [], base: ["marcocyl04-ux"], product: [] };
  const i = (labels: string[], assignees: string[] = []) => ({ number: 1, title: "t", labels, assignees });
  assert.deepEqual(L.missingLeads(i(["life", "bug"]), l), [{ login: "isaacw", label: "life" }]);
  assert.deepEqual(L.missingLeads(i(["cowork"], ["MarcoCyl04-UX"]), l), [{ login: "fktsai", label: "cowork" }]);
  assert.deepEqual(L.missingLeads(i(["cowork"]), l, ["fktsai"]), [{ login: "marcocyl04-ux", label: "cowork" }]);
  assert.deepEqual(L.missingLeads(i(["work", "social"]), l), []);
  assert.deepEqual(L.missingLeads(i(["cowork", "base"]), l).map((x) => x.login), ["fktsai", "marcocyl04-ux"]);   // once each
  assert.deepEqual(L.missingLeads(i(["now", "bug"]), l), []);
});

test("routeIssues: a board read's seen issues are not asked again; a failed assignment pings nobody", async () => {
  const l = { life: ["isaacw"], work: [], cowork: [], social: [], base: [], product: [] };
  const calls: string[] = [], said: string[] = [], pings: string[] = [];
  const seen = new Set<number>();
  const d = {
    repo: "acme/sol", dryRun: false, seen, say: (x: string) => said.push(x), ping: (p: { to: string }) => { pings.push(p.to); return true; },
    gh: async (args: string[]) => { calls.push(args.join(" ")); if (args.join(" ").includes("issues/2/assignees")) throw new Error("not a collaborator"); return ""; },
  };
  const issues = [{ number: 1, title: "a", labels: ["life"], assignees: [] }, { number: 2, title: "b", labels: ["life"], assignees: [] }];
  const done = await L.routeIssues(d, issues, l);
  assert.deepEqual(done, [{ issue: 1, leads: ["isaacw"] }]);
  assert.deepEqual(pings, ["isaacw"]);
  assert.ok(said.includes("could not assign isaacw to #2: not a collaborator"));
  assert.ok(calls.includes("api -X POST repos/acme/sol/issues/1/assignees -f assignees[]=isaacw"));
  const before = calls.length;
  await L.routeIssues(d, issues, l);
  assert.equal(calls.length, before);   // both settled: no read, no write
});

const OWN = C.owners("# label base: x\n/sol/engine/ @marcocyl04-ux\n# label life: x\n/sol/mac/src/ @isaacw\n# label cowork: x\n/sol/engine/src/team/ @fktsai @isaacw\n# label product: x\n/docs/ @marcocyl04-ux");
const LEADS = { life: ["isaacw"], work: [], cowork: ["fktsai", "isaacw"], social: [], base: ["marcocyl04-ux"], product: ["marcocyl04-ux"] };
const pr = (o: Partial<MergedPr>): MergedPr => ({ number: 1, title: "t", author: "fktsai", mergedBy: "fktsai", files: [], reviews: [], ...o });

test("mergeFlag: who counts as the lead's word", () => {
  // no approval, self-merged, on base: flagged as its own author's press
  assert.deepEqual(L.mergeFlag(pr({ files: ["sol/engine/src/index.ts"] }), OWN, LEADS)?.unmet, [{ label: "base", leads: ["marcocyl04-ux"] }]);
  assert.equal(L.mergeFlag(pr({ files: ["sol/engine/src/index.ts"] }), OWN, LEADS)?.self, true);
  // the lead approved
  assert.equal(L.mergeFlag(pr({ files: ["sol/engine/src/index.ts"], reviews: [{ login: "marcocyl04-ux", state: "APPROVED" }] }), OWN, LEADS), null);
  // the lead pressed merge on someone else's PR
  assert.equal(L.mergeFlag(pr({ files: ["sol/engine/src/index.ts"], mergedBy: "marcocyl04-ux" }), OWN, LEADS), null);
  // the author is the label's only lead: their own press is still flagged (strict); someone else's press passes
  const only = L.mergeFlag(pr({ author: "marcocyl04-ux", mergedBy: "marcocyl04-ux", files: ["docs/x.md"] }), OWN, LEADS);
  assert.deepEqual(only?.unmet, [{ label: "product", leads: ["marcocyl04-ux"] }]);
  assert.equal(only?.self, true);
  assert.equal(L.mergeFlag(pr({ author: "marcocyl04-ux", mergedBy: "fktsai", files: ["docs/x.md"] }), OWN, LEADS), null);
  // the author is one of two leads: the other one's word is wanted
  const f = L.mergeFlag(pr({ files: ["sol/engine/src/team/night.ts"] }), OWN, LEADS);
  assert.deepEqual(f?.unmet, [{ label: "cowork", leads: ["isaacw"] }]);
  // a path no label holds, or a label with no lead: no rule
  assert.equal(L.mergeFlag(pr({ files: ["sol/README.md", "sol/mac/src-tauri/x.rs"] }), OWN, LEADS), null);
  // two labels, one met, one not: only the unmet is named
  assert.deepEqual(L.mergeFlag(pr({ files: ["sol/mac/src/a.ts", "docs/b.md"], reviews: [{ login: "isaacw", state: "APPROVED" }] }), OWN, LEADS)?.unmet.map((u) => u.label), ["product"]);
});

test("approvers: the last word counts; a comment is no word; a change request takes an approval back", () => {
  const r = (login: string, state: string, at: string) => ({ login, state, at });
  assert.deepEqual([...L.approvers([r("a", "APPROVED", "1"), r("a", "COMMENTED", "2"), r("b", "APPROVED", "1"), r("b", "CHANGES_REQUESTED", "2")])], ["a"]);
  assert.deepEqual([...L.approvers([r("A", "CHANGES_REQUESTED", "1"), r("a", "APPROVED", "2")])], ["a"]);
});
