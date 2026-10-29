// node --test src/*.test.ts (npm test here): the connectors tab's one answer (#332). A repository row's one action for
// every state it can be in, the answer read (and an older engine's none), "N of M", and a pasted repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectorsOf, rowAction, inOf, repoOf, type RepoRow } from "./cowork/connectors.ts";

const row = (o: Partial<RepoRow> = {}): RepoRow => ({ repo: "frank/room", by: "frank", at: "2026-10-24T10:00:00Z", in: ["frank-gh"], members: 3, ...o });
const cloud = { name: "marco", record: "cloud" as const };
const gh = { in: true, who: "marcocyl04-ux" };

test("no GitHub here: connect it first, whoever connected the repository", () => {
  assert.equal(rowAction(row(), cloud, { in: false }), "connect GitHub");
  assert.equal(rowAction(row({ by: "marco" }), cloud, { in: false }), "connect GitHub");
});

test("a member not let in asks; while the ask is out it says asked; let in, nothing", () => {
  assert.equal(rowAction(row(), cloud, gh), "ask to be let in");
  assert.equal(rowAction(row({ asked: true }), cloud, gh), "asked");
  assert.equal(rowAction(row({ in: ["frank-gh", "MarcoCyl04-UX"] }), cloud, gh), "");   // GitHub's names are not case-kept
  assert.equal(rowAction(row({ checked: true }), cloud, gh), "");   // my own gh can push to it already
  assert.equal(rowAction(row({ in: ["marcocyl04-ux"], asked: true }), cloud, gh), "");
});

test("the maker, or an admin the engine names, adds the workflow; once on it says so", () => {
  assert.equal(rowAction(row({ by: "marco" }), cloud, gh), "add the workflow");
  assert.equal(rowAction(row({ by: "Marco" }), cloud, gh), "add the workflow");
  assert.equal(rowAction(row({ admin: true, checked: true }), cloud, gh), "add the workflow");
  assert.equal(rowAction(row({ by: "marco", events: true }), cloud, gh), "build updates on");
  assert.equal(rowAction(row({ by: "marco" }), cloud, gh, true), "build updates on");    // added in this session
  assert.equal(rowAction(row({ by: "marco", events: true }), cloud, gh, false), "add the workflow");   // removed in this session
});

test("a GitHub or Drive group's repository has no action: the group is it", () => {
  for (const record of ["github", "drive", ""] as const) {
    assert.equal(rowAction(row({ by: "" }), { name: "marco", record }, { in: false }), "");
    assert.equal(rowAction(row({ by: "" }), { name: "marco", record }, gh), "");
  }
});

test("the answer is read into one shape; an older engine's (no repos) or an error is none", () => {
  assert.equal(connectorsOf({ error: "unknown message" }), null);
  assert.equal(connectorsOf({ things: [] }), null);
  assert.equal(connectorsOf(null), null);
  const c = connectorsOf({ rid: "x", record: "cloud", members: 3,
    repos: [{ repo: "frank/room", by: "frank\u0007", at: "t", in: ["frank-gh", "not a login", 4], members: 3, checked: true, asked: "yes" }, { repo: "../etc", by: "x" }, { by: "nobody" }],
    tools: [{ id: "polls", line: "no open poll", read: true, open: [] }, { id: "other" }],
    me: { google: { in: true, email: "m@x.com" }, github: { in: true, who: "marcocyl04-ux", token: "never" } } });
  assert.ok(c);
  assert.equal(c.record, "cloud");
  assert.deepEqual(c.repos, [{ repo: "frank/room", by: "frank ", at: "t", in: ["frank-gh"], members: 3, checked: true }]);
  assert.deepEqual(c.tools.map((t) => t.id), ["polls"]);
  assert.deepEqual(c.me, { google: { in: true, email: "m@x.com" }, github: { in: true, who: "marcocyl04-ux" } });
  assert.equal(connectorsOf({ repos: [], record: "elsewhere" })!.record, "");
});

test("N of M is the logins let in of the group's members; none when they could not be counted", () => {
  assert.equal(inOf(row({ in: ["a", "b"] })), "2 of 3");
  assert.equal(inOf(row({ in: [] })), "0 of 3");
  assert.equal(inOf(row({ members: 0 })), "");
});

test("a pasted repository is its owner/name; anything else is none", () => {
  assert.equal(repoOf(" frank/room "), "frank/room");
  assert.equal(repoOf("https://github.com/frank/room.git"), "frank/room");
  assert.equal(repoOf("https://github.com/frank/room/"), "frank/room");
  assert.equal(repoOf("frank"), "");
  assert.equal(repoOf("frank/room/extra"), "");
  assert.equal(repoOf("../x"), "");
  assert.equal(repoOf("frank/.."), "");
});
