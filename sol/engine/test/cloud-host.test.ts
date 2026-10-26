// relay.host (#210, S3 of #168): an engine is no hub unless its team.json says so, since the hub moves to the cloud.
// A team.json on disk that never said keeps what it had, a hub, until S6 (the NucBox's may be such a file); a Sol with
// no team.json yet writes host false on its first run. The cloud is the default hub since S6b; SOL_HUB in a Sol's own .env names another.
// Nothing here touches GitHub or a real team.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// no team.json yet: the module makes one on the first read
const FILE = join(mkdtempSync(join(tmpdir(), "sol-host-")), "team.json");
process.env.SOL_TEAM = FILE;
process.env.SOL_TEAM_OFFLINE = "1";   // never `gh api user` from a test
delete process.env.SOL_HUB;
const T = await import("../src/team/settings.ts");

test("the default is no hub: TEAM_DEFAULTS and a cleaned nothing say host false", () => {
  assert.equal(T.TEAM_DEFAULTS.relay.host, false);
  assert.equal(T.cleanTeam({}).relay.host, false);
  assert.equal(T.cleanTeam({ relay: { url: "wss://hub.example/relay" } }).relay.host, false);
});

test("a team.json on disk that never said host keeps a hub, as before (until S6); one that said keeps its word", () => {
  assert.equal(T.HOST_BEFORE, true);
  assert.equal(T.readTeam({ me: { login: "marco", name: "Marco" } }).relay.host, true, "no relay at all: the NucBox's file may be this");
  assert.equal(T.readTeam({ relay: { url: "", key: "k" } }).relay.host, true, "a relay with no host");
  assert.equal(T.readTeam({ relay: { url: "", key: "k", host: "yes" } }).relay.host, true, "a host that is not a boolean said nothing");
  assert.equal(T.readTeam({ relay: { url: "wss://nucbox.example.ts.net/relay", key: "k", host: false } }).relay.host, false, "setup's file (every install since #169)");
  assert.equal(T.readTeam({ relay: { host: true } }).relay.host, true);
  // with rooms too (readTeam's second path)
  const rooms = [{ id: "a", name: "a", repos: ["o/a"], hub: "" }];
  assert.equal(T.readTeam({ rooms, room: "a", relay: { key: "k" } }).relay.host, true);
  assert.equal(T.readTeam({ rooms, room: "a", relay: { key: "k", host: false } }).relay.host, false);
});

test("a Sol's first run, no team.json: it writes host false, and a patch keeps it", () => {
  const s = T.getTeam();
  assert.equal(s.relay.host, false);
  assert.equal(JSON.parse(readFileSync(FILE, "utf8")).relay.host, false, "written down, so the next read says the same");
  assert.equal(T.patchTeam({ me: { name: "Tester" } }).relay.host, false);
});

test("the cloud is the default (S6b): no SOL_HUB, the cloud; SOL_HUB names another, its path kept, a query dropped", () => {
  assert.equal(T.sharedHub(), T.CLOUD_HUB);
  process.env.SOL_HUB = "wss://143.244.223.85/relay?key=x";
  try { assert.equal(T.sharedHub(), "wss://143.244.223.85/relay"); } finally { delete process.env.SOL_HUB; }
  process.env.SOL_HUB_HOST = "143.244.223.85, nucbox.example.ts.net";
  try { assert.deepEqual(T.hubHosts(), ["143.244.223.85", "nucbox.example.ts.net"]); } finally { delete process.env.SOL_HUB_HOST; }
});
