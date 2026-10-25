// Rooms (#154): team.json's list of rooms, one active. A file from before rooms is one room, "team"; the top-level
// org, repos and relay.url are always the active room's; a patch in the old words writes into the active room, and
// `{ room }` switches. Then the review's findings: a hand edit of the top level, a room's own key, the hub this engine
// hosts, an emptied field, the seen list on another hub, and reads under way when the room changes. Nothing here
// touches GitHub (a gh that always fails stands in) or a real team.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// a team.json of its own, from before rooms, written before the module reads it
const FILE = join(mkdtempSync(join(tmpdir(), "sol-team-")), "team.json");
writeFileSync(FILE, JSON.stringify({ me: { login: "frank", name: "Frank" }, org: "kao-ai", repos: ["kao-ai/sol"], relay: { url: "wss://hub.example.net/relay", key: "k1", host: false } }));
process.env.SOL_TEAM = FILE;
process.env.SOL_TEAM_OFFLINE = "1";   // never `gh api user` from a test
const T = await import("../src/team/settings.ts");

const two = {
  rooms: [
    { id: "sol", name: "Sol", provider: "github", org: "", repos: ["marcocyl04-ux/sol-dev"], hub: "" },
    { id: "kao", name: "Kao", provider: "github", org: "kao-ai", repos: ["kao-ai/site", "kao-ai/site"], hub: "wss://kao.example.net/relay?key=oops#x" },
  ],
  room: "kao",
  org: "ignored", repos: ["ignored/too"], relay: { url: "ws://ignored", key: "k" },
};

test("a file from before rooms reads as one room, team, and the top level is unchanged", () => {
  const s = T.cleanTeam({ org: "kao-ai", repos: ["kao-ai/sol", "kao-ai/site"], relay: { url: "wss://hub.example.net/relay", key: "k" } });
  assert.deepEqual(s.rooms, [{ id: "team", name: "kao-ai", provider: "github", org: "kao-ai", repos: ["kao-ai/sol", "kao-ai/site"], hub: "wss://hub.example.net/relay", key: "", code: "", gate: "key", folder: "", mine: false, joined: false }]);
  assert.equal(s.room, "team");
  assert.equal(s.org, "kao-ai");
  assert.deepEqual(s.repos, ["kao-ai/sol", "kao-ai/site"]);
  assert.equal(s.relay.url, "wss://hub.example.net/relay");
  assert.equal(s.relay.key, "k");
  // no org: the room is named for its first repo
  const d = T.cleanTeam({});
  assert.deepEqual(d.rooms, [{ id: "team", name: "sol-dev", provider: "github", org: "", repos: ["marcocyl04-ux/sol-dev"], hub: "", key: "", code: "", gate: "key", folder: "", mine: false, joined: false }]);
  assert.deepEqual(T.activeRoom(d), d.rooms[0]);
});

test("with rooms, org, repos and relay.url come from the active room; the file's own top level is ignored", () => {
  const s = T.cleanTeam(two);
  assert.equal(s.room, "kao");
  assert.equal(s.org, "kao-ai");
  assert.deepEqual(s.repos, ["kao-ai/site"]);                       // deduped
  assert.equal(s.relay.url, "wss://kao.example.net/relay");         // never a key in the address
  assert.equal(s.relay.key, "k");                                   // one key per engine, as before
  assert.deepEqual(T.activeRoom(s), s.rooms[1]);
});

test("a room id that is not there falls back to the first room", () => {
  const s = T.cleanTeam({ ...two, room: "gone" });
  assert.equal(s.room, "sol");
  assert.deepEqual(s.repos, ["marcocyl04-ux/sol-dev"]);
  assert.equal(s.relay.url, "");
});

test("bad rooms are dropped, ids deduped, a missing id made from the name", () => {
  const s = T.cleanTeam({ rooms: [
    "junk", null, {},
    { provider: "github", repos: ["not a repo"] },                    // points at nothing
    { name: "Kao AI Site", repos: ["kao-ai/site"], hub: "http://no" },  // no id: a slug of the name; not a ws hub
    { id: "kao-ai-site", name: "again", repos: ["kao-ai/other"] },    // the same id: the first stays
    { id: "Has Spaces!", org: "kao-ai" },                             // an org and no repos: the default repo
    { id: "notes", provider: "drive", name: "Notes", repos: [" 1AbCdEfG ", "x".repeat(201)] },
    { id: "odd", provider: "dropbox", repos: ["a/b"], org: "bad org!" },
  ] });
  assert.deepEqual(s.rooms.map((r) => r.id), ["kao-ai-site", "has-spaces", "notes", "odd"]);
  assert.equal(s.rooms[0].hub, "");
  assert.equal(s.rooms[0].name, "Kao AI Site");
  assert.deepEqual(s.rooms[1].repos, ["marcocyl04-ux/sol-dev"]);
  assert.equal(s.rooms[1].name, "kao-ai");
  assert.deepEqual(s.rooms[2], { id: "notes", name: "Notes", provider: "drive", org: "", repos: ["1AbCdEfG"], hub: "", key: "", code: "", gate: "key", folder: "", mine: false, joined: false });
  assert.equal(s.rooms[3].provider, "github");
  assert.equal(s.rooms[3].org, "");
  assert.equal(s.room, "kao-ai-site");
  // every room bad: the legacy fields are the one room
  const l = T.cleanTeam({ rooms: [{}, 3], org: "kao-ai" });
  assert.deepEqual(l.rooms.map((r) => [r.id, r.org]), [["team", "kao-ai"]]);
});

test("patch: an org, repos or relay url with no rooms writes into the active room", () => {
  const s0 = T.getTeam();
  assert.equal(s0.room, "team");
  assert.equal(s0.org, "kao-ai");
  const s = T.patchTeam({ org: "kao-labs", repos: ["kao-labs/one"], relay: { url: "wss://new.example.net/relay", key: "k1" } });
  assert.deepEqual(s.rooms, [{ id: "team", name: "kao-ai", provider: "github", org: "kao-labs", repos: ["kao-labs/one"], hub: "wss://new.example.net/relay", key: "", code: "", gate: "key", folder: "", mine: false, joined: false }]);
  assert.equal(s.org, "kao-labs");
  assert.deepEqual(s.repos, ["kao-labs/one"]);
  assert.equal(s.relay.url, "wss://new.example.net/relay");
  assert.equal(s.relay.key, "k1");
  const disk = JSON.parse(readFileSync(FILE, "utf8"));
  assert.equal(disk.rooms[0].org, "kao-labs");
  assert.equal(disk.org, "kao-labs");   // the top level is written too: an engine from before rooms reads the active room
});

test("patch: { rooms } replaces the list, { room } switches and the derived fields follow", () => {
  T.patchTeam({ rooms: [T.getTeam().rooms[0], { id: "sol", name: "Sol", repos: ["marcocyl04-ux/sol-dev"], hub: "" }] });
  assert.equal(T.getTeam().room, "team");   // the active room is still there: it stays active
  const s = T.patchTeam({ room: "sol" });
  assert.equal(s.room, "sol");
  assert.equal(s.org, "");
  assert.deepEqual(s.repos, ["marcocyl04-ux/sol-dev"]);
  assert.equal(s.relay.url, "");
  assert.equal(s.relay.key, "k1");          // the key is the engine's, not the room's
  assert.equal(T.patchTeam({ room: "nowhere" }).room, "sol");   // not a room: no switch
  // an org edit now lands on Sol, not on the room left behind
  const t = T.patchTeam({ org: "sol-team" });
  assert.equal(t.rooms.find((r) => r.id === "sol")?.org, "sol-team");
  assert.equal(t.rooms.find((r) => r.id === "team")?.org, "kao-labs");
  assert.equal(T.patchTeam({ room: "team" }).org, "kao-labs");
});

test("a face gets the rooms and the active one, never the key", () => {
  const f = T.forFace(T.cleanTeam({ ...two, relay: { key: "secret-key" } }));
  assert.equal(f.room, "kao");
  assert.deepEqual(f.rooms.map((r) => r.id), ["sol", "kao"]);
  assert.equal(f.relay.key, "set");
  assert.equal(JSON.stringify(f).includes("secret-key"), false);
});

// ---- the review of #154 ----

test("a hand edit of the top level, once rooms are saved, is written into the active room on a read", () => {
  const saved = { ...T.cleanTeam(two) };   // what is on disk: the top level is the active room's
  assert.deepEqual(T.readTeam(saved), T.cleanTeam(two));   // nothing edited: the same
  const s = T.readTeam({ ...saved, org: "kao-labs", repos: ["kao-labs/web"], relay: { ...saved.relay, url: "wss://elsewhere.example.net/relay" } });
  assert.equal(s.room, "kao");
  assert.deepEqual(T.activeRoom(s), { ...T.cleanTeam(two).rooms[1], org: "kao-labs", repos: ["kao-labs/web"], hub: "wss://elsewhere.example.net/relay" });
  assert.equal(s.org, "kao-labs");
  assert.deepEqual(s.rooms[0], T.cleanTeam(two).rooms[0]);   // the other room untouched
  // a patch still goes by the rooms: a switch never carries the old room's top level into the new one
  assert.equal(T.cleanTeam(T.mergeTeam(saved, { room: "sol" })).org, "");
});

test("a room may carry its own key: never shown, kept when a face sends \"set\", used only for a hub elsewhere", () => {
  const s = T.cleanTeam({ ...two, rooms: [two.rooms[0], { ...two.rooms[1], key: "room-key" }], relay: { key: "engine-key" } });
  assert.equal(s.rooms[1].key, "room-key");
  assert.equal(T.roomKey(s), "room-key");                      // kao meets elsewhere and has a key
  assert.equal(T.roomKey({ ...s, room: "sol" }), "engine-key");   // sol meets here: the engine's own
  assert.equal(T.roomKey({ ...s, rooms: [s.rooms[0], { ...s.rooms[1], key: "" }] }), "engine-key");
  const f = T.forFace(s);
  assert.deepEqual(f.rooms.map((r) => r.key), ["", "set"]);
  assert.equal(JSON.stringify(f).includes("room-key"), false);
  assert.equal(JSON.stringify(f).includes("engine-key"), false);
});

test("patch: a room's key survives a face's list ('set' or none), a new one replaces it, '' takes it away", () => {
  T.patchTeam({ rooms: [{ id: "here", repos: ["a/here"], hub: "" }, { id: "away", repos: ["a/away"], hub: "wss://away.example.net/relay", key: "k-away" }], room: "away" });
  const face = T.forFace(T.getTeam());
  assert.equal(face.rooms[1].key, "set");
  T.patchTeam({ rooms: face.rooms });                         // the face's list sent back whole
  assert.equal(T.getTeam().rooms[1].key, "k-away");
  T.patchTeam({ rooms: face.rooms.map(({ key: _k, ...r }) => r) });   // no key at all: kept too
  assert.equal(T.getTeam().rooms[1].key, "k-away");
  T.patchTeam({ rooms: [face.rooms[0], { ...face.rooms[1], key: "k-new" }] });
  assert.equal(T.getTeam().rooms[1].key, "k-new");
  assert.equal(T.roomKey(T.getTeam()), "k-new");
  T.patchTeam({ rooms: [face.rooms[0], { ...face.rooms[1], key: "" }] });
  assert.equal(T.getTeam().rooms[1].key, "");
});

test("the hub this engine hosts goes by the room that meets here, not the one I am in", () => {
  const s = T.cleanTeam({ rooms: [
    { id: "away", org: "kao-ai", repos: ["kao-ai/site"], hub: "wss://away.example.net/relay" },
    { id: "here", org: "", repos: ["a/here"], hub: "" },
  ], room: "away" });
  assert.equal(s.org, "kao-ai");
  assert.equal(T.hostedRoom(s).id, "here");
  assert.equal(T.hostedRoom(s).org, "");              // so the hub here stays in key mode
  const none = T.cleanTeam({ rooms: [{ id: "a", repos: ["a/a"], hub: "wss://a.example.net/" }, { id: "b", repos: ["b/b"], hub: "wss://b.example.net/" }], room: "b" });
  assert.equal(T.hostedRoom(none).id, "b");           // none meets here: the active one
});

test("patch: emptying an org-less room's repos keeps the room and its repos; nobody is moved", () => {
  T.patchTeam({ rooms: [{ id: "bare", repos: ["a/b"] }, { id: "other", repos: ["c/d"] }], room: "bare" });
  let s = T.patchTeam({ repos: [] });
  assert.equal(s.room, "bare");
  assert.deepEqual(s.rooms.map((r) => r.id), ["bare", "other"]);
  assert.deepEqual(s.repos, ["a/b"]);
  s = T.patchTeam({ repos: ["not a repo"] });
  assert.equal(s.room, "bare");
  assert.deepEqual(s.repos, ["a/b"]);
  s = T.patchTeam({ repos: ["e/f"] });                  // a good edit still lands
  assert.deepEqual(s.repos, ["e/f"]);
});

test("another hub forgets who was seen on the old one; the same hub with a new key does not", async () => {
  const R = await import("../src/team/relay.ts");
  let url = "ws://127.0.0.1:9/relay?key=a";
  const c = new R.RelayClient(() => url, () => ({ login: "frank", state: "here" }) as never, "mac", async () => null);
  c.start();
  (c as any).seenSet.add("marco");
  url = "ws://127.0.0.1:9/relay?key=b";
  c.restart();
  assert.deepEqual(c.seen(), ["marco"]);
  url = "wss://elsewhere.example.net/relay?key=b";
  c.restart();
  assert.deepEqual(c.seen(), []);
  c.stop();
});

// a gh that fails after a moment: the reads are still under way when the room changes
function slowNoGh(): () => void {
  const bin = mkdtempSync(join(tmpdir(), "sol-nogh-"));
  writeFileSync(join(bin, "gh"), "#!/bin/sh\nsleep 0.2\nexit 1\n"); chmodSync(join(bin, "gh"), 0o755);
  const PATH = process.env.PATH;
  process.env.PATH = `${bin}:${PATH}`;
  return () => { process.env.PATH = PATH; };
}

test("a switch while the board is read starts the new room's read; the old one is never kept", async () => {
  const back = slowNoGh();
  try {
    const B = await import("../src/team/board.ts");
    T.patchTeam({ rooms: [{ id: "one", repos: ["o/one"] }, { id: "two", repos: ["o/two"] }], room: "one" });
    const old = B.getBoard(true);
    T.patchTeam({ room: "two" });
    const now = B.getBoard(true);
    assert.notEqual(now, old);
    assert.deepEqual((await now).repos, ["o/two"]);
    assert.deepEqual((await old).repos, ["o/one"]);          // its asker gets it
    assert.deepEqual((await B.getBoard()).repos, ["o/two"]); // the cache is the new room's
  } finally { back(); }
});

test("a switch while the shared list is read starts the new room's read; the old one is never kept or told", async () => {
  const back = slowNoGh();
  try {
    const S = await import("../src/team/share.ts");
    let repos = ["o/one"];
    const d = { repos: () => repos, folders: async () => ({}), me: async () => "frank", local: false };
    const told: string[][] = [];
    const off = S.onShared((sh) => told.push(sh.repos.map((r) => r.repo)));
    S.forgetShared();
    const old = S.getShared(true, d);
    repos = ["o/two"];
    const now = S.getShared(true, d);
    assert.notEqual(now, old);
    assert.deepEqual((await now).repos.map((r) => r.repo), ["o/two"]);
    assert.deepEqual((await old).repos.map((r) => r.repo), ["o/one"]);
    assert.deepEqual(told, [["o/two"]]);
    assert.deepEqual((await S.getShared(false, d)).repos.map((r) => r.repo), ["o/two"]);
    off(); S.forgetShared();
  } finally { back(); }
});
