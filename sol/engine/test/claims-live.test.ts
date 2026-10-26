// Claims, live (#202): the exact-file match the harness asks on every edit, the line it says, and the ping the
// holder's agent gets through the engine's door. Pure; nothing here touches gh, git or the network.
import { test } from "node:test";
import assert from "node:assert/strict";

const { fileOverlap, claimLine } = await import("../src/team/claims.ts");
const { claimPing, pingOf } = await import("../src/team/pings.ts");

const claims = [
  { branch: "frank/cowork-things", pr: 195, issue: 194, login: "franktsai2008-eng", paths: ["sol/README.md", "sol/engine/src/team/things.ts"], areas: ["cowork"] },
  { branch: "marco/base-blocks-187", issue: 187, login: "marcocyl04-ux", paths: ["sol/README.md"], areas: ["base"] },
  { branch: "isaac/life-x-5", login: "isaac", paths: ["sol/mac/src/App.tsx"], areas: ["life"] },
];

test("fileOverlap: the exact file only, each hit with that one shared path", () => {
  const hits = fileOverlap("sol/README.md", claims);
  assert.deepEqual(hits.map((h) => h.branch), ["frank/cowork-things", "marco/base-blocks-187"]);
  assert.deepEqual(hits[0].shared, ["sol/README.md"]);
  assert.deepEqual(fileOverlap("sol/engine/src/team/things.ts", claims).map((h) => h.pr), [195]);
});

test("fileOverlap: a sibling in the same folder is not a hit, nor an empty path", () => {
  assert.deepEqual(fileOverlap("sol/engine/src/team/claims.ts", claims), []);
  assert.deepEqual(fileOverlap("sol/mac/src/", claims), []);
  assert.deepEqual(fileOverlap("", claims), []);
  assert.deepEqual(fileOverlap("/sol/README.md", claims).length, 2);   // a leading slash is dropped
});

test("claimLine: a PR says read it and build on it; a side copy says build on it or say so", () => {
  assert.equal(claimLine("sol/README.md", claims[0]), "claim: sol/README.md is also changed on #195 (franktsai2008-eng, frank/cowork-things): read it (gh pr diff 195 -- sol/README.md) and build on it, or say in your PR how yours differs.");
  assert.equal(claimLine("sol/README.md", claims[1]), "claim: sol/README.md is also being changed on marco/base-blocks-187 (marcocyl04-ux, a side copy on this machine): build on it or say so in your PR.");
});

test("claimPing: the door's body becomes a claim ping to the holder, on their issue, that pingOf accepts", () => {
  const m = claimPing({ path: "sol/README.md", issue: 194, pr: 195, branch: "frank/cowork-things", login: "franktsai2008-eng", from: { login: "marcocyl04-ux", branch: "marco/cowork-claims-live-an-202", issue: 202 }, repo: "marcocyl04-ux/sol-dev" }, "marcocyl04-ux");
  assert.ok(m);
  assert.equal(m.to, "franktsai2008-eng");
  assert.equal(m.pingKind, "claim");
  assert.equal(m.issue, 194);
  assert.equal(m.repo, "marcocyl04-ux/sol-dev");
  assert.equal(m.line, "claim: sol/README.md on your frank/cowork-things (#195) is also being changed on marco/cowork-claims-live-an-202 (marcocyl04-ux, #202): they build on yours or say in their PR how theirs differs.");
  const p = pingOf(m);
  assert.ok(p);
  assert.equal(p.kind, "claim");
  assert.deepEqual(p.from, { login: "marcocyl04-ux", agent: true });
});

test("claimPing: no holder, no path, a bad login or a path with control characters is nothing", () => {
  assert.equal(claimPing({ path: "a.ts", branch: "x/y", login: "", from: { login: "marcocyl04-ux" } }, "marcocyl04-ux"), null);
  assert.equal(claimPing({ path: "", branch: "x/y", login: "frank", from: { login: "marcocyl04-ux" } }, "marcocyl04-ux"), null);
  assert.equal(claimPing({ path: "a.ts", branch: "x/y", login: "fr ank", from: { login: "marcocyl04-ux" } }, "marcocyl04-ux"), null);
  assert.equal(claimPing({ path: "a\n.ts", branch: "x/y", login: "frank", from: { login: "marcocyl04-ux" } }, "marcocyl04-ux"), null);
  assert.equal(claimPing({ path: "a.ts", branch: "x/y", login: "frank", from: {} }, ""), null);   // no one to sign it
});
