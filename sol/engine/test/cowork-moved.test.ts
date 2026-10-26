// Where a room went (#246): a GitHub room moved to the cloud says so in `.sol/moved.json` (move.ts writes it); a
// teammate's Sol reads it beside the things and the room page offers to join the new room by its code. The pure parse,
// the read (a GitHub room only, ten minutes cached, a missing file no move), and what the face is told.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILE = join(mkdtempSync(join(tmpdir(), "sol-team-")), "team.json");
writeFileSync(FILE, JSON.stringify({ me: { login: "frank", name: "Frank" }, repos: ["marcocyl04-ux/ecosystem"] }));
process.env.SOL_TEAM = FILE;
process.env.SOL_TEAM_OFFLINE = "1";
const M = await import("../src/team/moved.ts");

const NOTE = { v: 1, code: "K7QX2M", hub: "wss://cloud.matterfold.tech/relay", name: "ecosystem", at: "2026-10-27T15:00:00.000Z" };
const rec = (text: string | null, calls: string[] = [], author = "marcocyl04-ux") => ({ files: {
  branch: async () => "main",
  lastCommits: async () => [{ author: { user: { login: author } } }],
  readSha: async (repo: string, path: string) => { calls.push(`${repo} ${path}`); if (text === null) throw Object.assign(new Error("gh: Not Found (HTTP 404)"), { full: "gh: Not Found (HTTP 404)" }); return JSON.stringify({ sha: "s", content: Buffer.from(text).toString("base64") }); },
} } as any);

test("parseMoved: a code of six, a ws(s) hub and a name; anything else is no move", () => {
  assert.deepEqual(M.parseMoved(JSON.stringify(NOTE)), { code: "K7QX2M", hub: NOTE.hub, name: "ecosystem", at: NOTE.at, by: "" });
  assert.equal(M.parseMoved(JSON.stringify({ ...NOTE, code: "k7qx2m" }))?.code, "K7QX2M");
  assert.equal(M.parseMoved(JSON.stringify({ ...NOTE, name: "a‮b\nc" }))?.name, "a b c");
  assert.equal(M.parseMoved(JSON.stringify({ ...NOTE, name: "" }))?.name, "the room");
  for (const bad of ["", "{", "[]", JSON.stringify({ ...NOTE, code: "ABC" }), JSON.stringify({ ...NOTE, code: "ABCDE1" }), JSON.stringify({ ...NOTE, hub: "https://x" }), JSON.stringify({ ...NOTE, hub: "javascript:alert(1)" })])
    assert.equal(M.parseMoved(bad), null, bad);   // 1 and 0 are never in a code (settings.ts CODE)
});

test("movedOf: a GitHub room's record only, read once in ten minutes; a missing file or a failed read is no move", async () => {
  M.forgetMoved();
  const calls: string[] = [];
  const d = { record: () => rec(JSON.stringify(NOTE), calls), trusted: () => true };
  assert.equal(await M.movedOf(d, "cloud:ABCDEF"), null);
  assert.equal(await M.movedOf(d, "drive:xyz"), null);
  assert.equal(await M.movedOf(d, ""), null);
  assert.equal(calls.length, 0);
  const t = 1_000_000;
  assert.deepEqual(await M.movedOf(d, "marcocyl04-ux/ecosystem", t), { ...M.parseMoved(JSON.stringify(NOTE))!, by: "marcocyl04-ux" });
  await M.movedOf(d, "marcocyl04-ux/ecosystem", t + 60_000);
  assert.deepEqual(calls, ["marcocyl04-ux/ecosystem .sol/moved.json"]);
  await M.movedOf(d, "marcocyl04-ux/ecosystem", t + M.MOVED_TTL + 1);
  assert.equal(calls.length, 2);
  M.forgetMoved();
  assert.equal(await M.movedOf({ record: () => rec(null), trusted: () => true }, "o/r"), null);
});

test("movedOf, the review of #246: only the repository's owner's move on a hub this Sol trusts; a deleted file takes the line away at once; refresh reads anew", async () => {
  M.forgetMoved();
  const repo = "marcocyl04-ux/ecosystem";
  // a collaborator with push wrote it: not a move (only an admin moves a room); an admin of the repository: a move
  assert.equal(await M.movedOf({ record: () => rec(JSON.stringify(NOTE), [], "someone-else"), trusted: () => true, admin: async () => false }, repo, 1), null);
  M.forgetMoved();
  assert.equal((await M.movedOf({ record: () => rec(JSON.stringify(NOTE), [], "an-admin"), trusted: () => true, admin: async (_r, l) => l === "an-admin" }, "some-org/space", 1))?.by, "an-admin");
  // who wrote it could not be read (a rate limit): what was read before stays
  M.forgetMoved();
  assert.ok(await M.movedOf({ record: () => rec(JSON.stringify(NOTE)), trusted: () => true }, repo, 1));
  const noWho = { record: () => ({ ...rec(JSON.stringify(NOTE)), files: { ...rec(JSON.stringify(NOTE)).files, lastCommits: async () => null } }) as any, trusted: () => true };
  assert.ok(await M.movedOf(noWho, repo, 2, true));
  M.forgetMoved();
  // a hub this Sol does not meet on: not a move
  M.forgetMoved();
  assert.equal(await M.movedOf({ record: () => rec(JSON.stringify(NOTE)), trusted: (h) => h === "wss://other/relay" }, repo, 1), null);
  // seen, then deleted: gone at the next read, not kept
  M.forgetMoved();
  let text: string | null = JSON.stringify(NOTE);
  const d = { record: () => rec(text), trusted: () => true };
  assert.ok(await M.movedOf(d, repo, 1));
  text = null;
  assert.ok(await M.movedOf(d, repo, 2));                     // cached
  assert.equal(await M.movedOf(d, repo, 3, true), null);       // refresh: the file is gone
  // a read that fails for another reason keeps what was read
  M.forgetMoved();
  text = JSON.stringify(NOTE);
  assert.ok(await M.movedOf(d, repo, 1));
  const down = { record: () => ({ files: { branch: async () => { throw new Error("gh: could not connect"); } } }) as any, trusted: () => true };
  assert.ok(await M.movedOf(down, repo, 1 + M.MOVED_TTL + 1));
});

test("movedForFace: the new room, and my room of that code when I joined it already", () => {
  const m = M.parseMoved(JSON.stringify(NOTE));
  assert.equal(M.movedForFace(null, []), undefined);
  assert.deepEqual(M.movedForFace(m, [{ id: "team", code: "" }]), { ...m });
  assert.deepEqual(M.movedForFace(m, [{ id: "team", code: "" }, { id: "ecosystem", code: "K7QX2M" }]), { ...m, have: "ecosystem" });
});

test("what move.ts writes is what movedOf reads", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/team/move.ts", import.meta.url), "utf8");
  assert.match(src, /"\.sol\/moved\.json"/);
  assert.match(src, /JSON\.stringify\(\{ v: 1, code: room\.code, hub: d\.hub, name: room\.name, at:/);
  assert.equal(M.MOVED_PATH, ".sol/moved.json");
});
