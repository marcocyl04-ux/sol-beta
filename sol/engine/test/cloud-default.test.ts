// S6b (#226, MASTER §8 step 4): everyone meets on the cloud by default. A Sol with no SOL_HUB uses the cloud; a room
// with a share code kept on the NucBox's hub follows it to the cloud by a built-in table (keyed by a hash, so no tailnet
// address is in the code or here); a cloud room and a self-hoster's hub are left as they are; an engine that hosts a hub
// (relay.host, the NucBox) keeps hosting its own rooms. And a cloud room an older Sol dropped from team.json comes back
// from team.cloud.json. Nothing here touches GitHub, the network or a real team.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = mkdtempSync(join(tmpdir(), "sol-s6b-"));
const FILE = join(DIR, "team.json"), SIDE = join(DIR, "team.cloud.json");
process.env.SOL_TEAM = FILE;
process.env.SOL_TEAM_OFFLINE = "1";
delete process.env.SOL_HUB;
delete process.env.SOL_HUB_MOVED;
// before the module reads it: a team.json an older Sol wrote (no cloud room, a hash the side file never saw), and the
// side file this Sol wrote before the older one ran
const CODE = "BKQ2CL";
writeFileSync(FILE, JSON.stringify({ me: { login: "frank" }, relay: { url: "", key: "k", host: false },
  rooms: [{ id: "gh", name: "gh", provider: "github", repos: ["o/r"], hub: "", code: "", gate: "key" }], room: "gh" }));
writeFileSync(SIDE, JSON.stringify({ of: "0".repeat(64), rooms: [{ id: "study", name: "Study", provider: "cloud", hub: "wss://cloud.matterfold.tech/relay", code: CODE }] }));
const S = await import("../src/team/settings.ts");

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
// a stand-in for the NucBox's hub: the same table shape, an example address
const OLD = ["wss://nucbox", "example", "ts", "net/relay"].join(".");
const TABLE = new Map([[sha(OLD), S.CLOUD_HUB]]);

test("no SOL_HUB (or a blank one) is the cloud; SOL_HUB names a self-hoster's hub; off is none", () => {
  const was = process.env.SOL_HUB;
  try {
    delete process.env.SOL_HUB;
    assert.equal(S.sharedHub(), "wss://cloud.matterfold.tech/relay");
    process.env.SOL_HUB = "  ";
    assert.equal(S.sharedHub(), S.CLOUD_HUB, ".env.example's SOL_HUB= is the cloud");
    process.env.SOL_HUB = "wss://hub.myschool.example/relay";
    assert.equal(S.sharedHub(), "wss://hub.myschool.example/relay", "a self-hoster's hub wins");
    process.env.SOL_HUB = "OFF";
    assert.equal(S.sharedHub(), "", "off: no shared hub, a new room meets on this engine's own relay");
  } finally { if (was === undefined) delete process.env.SOL_HUB; else process.env.SOL_HUB = was; }
});

test("the built-in table: one old hub, kept as a hash of its plain form, to the cloud; no address is written", () => {
  assert.deepEqual([...S.BUILT_IN_MOVED.values()], [S.CLOUD_HUB]);
  for (const k of S.BUILT_IN_MOVED.keys()) assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(S.hubKey("wss://NUCBOX.example.ts.net/relay/?key=x"), "wss://nucbox.example.ts.net/relay");
  assert.equal(S.hubKey("wss://nucbox.example.ts.net"), "wss://nucbox.example.ts.net/relay", "no path is /relay, as hubHttp reads it");
  assert.equal(readFileSync(new URL("../src/team/settings.ts", import.meta.url), "utf8").match(/[\w-]+\.[\w-]+\.ts\.net/g)?.filter((h) => !/example\.ts\.net$/.test(h)) ?? null, null);
});

test("a coded room on the old hub follows to the cloud, however its address is written", () => {
  for (const h of [OLD, OLD.toUpperCase().replace("WSS", "wss"), `${OLD}/`, OLD.replace(/\/relay$/, "")]) assert.equal(S.moved(h, true, TABLE), S.CLOUD_HUB, h);
  assert.equal(S.moved("wss://other.example.ts.net/relay", true, TABLE), "wss://other.example.ts.net/relay", "another hub stays");
  assert.equal(S.moved("", true, TABLE), "", "this engine's own hub never moves");
});

test("a room that moved keeps no key of its old hub and meets the new one as me (never a key in the cloud's query string)", () => {
  process.env.SOL_HUB_MOVED = `${OLD}=>${S.CLOUD_HUB}`;
  try {
    const r = S.cleanRoom({ name: "Sol", repos: ["o/r"], hub: OLD, code: CODE, key: "the-nucbox-key", gate: "key" })!;
    assert.deepEqual([r.hub, r.key, r.gate], [S.CLOUD_HUB, "", "github"]);
    const stay = S.cleanRoom({ name: "Sol", repos: ["o/r"], hub: "wss://other.example/relay", code: CODE, key: "k", gate: "key" })!;
    assert.deepEqual([stay.key, stay.gate], ["k", "key"], "a room that did not move keeps its key");
  } finally { delete process.env.SOL_HUB_MOVED; }
});

test("a room with no code (the common space, met by a key) stays on the old hub: the cloud could not know it", () => {
  assert.equal(S.moved(OLD, false, TABLE), OLD);
  // through cleanRoom with the real table: a room with no code keeps whatever hub it had
  assert.equal(S.cleanRoom({ name: "team", repos: ["o/r"], hub: OLD })!.hub, OLD);
  assert.equal(S.cleanTeam({ relay: { url: OLD } }).rooms[0].hub, OLD, "the room made from relay.url has no code");
});

test("SOL_HUB_MOVED adds pairs, and `off` turns the built-in table off but keeps its own pairs", () => {
  try {
    process.env.SOL_HUB_MOVED = "off";
    assert.equal(S.moved(OLD, true, TABLE), OLD, "off: the built-in pair is not used");
    process.env.SOL_HUB_MOVED = `off, ${OLD}=>wss://mine.example/relay`;
    assert.equal(S.moved(OLD, true, TABLE), "wss://mine.example/relay", "a person's own pair still moves it");
    process.env.SOL_HUB_MOVED = `wss://a.example/relay=>wss://b.example/relay`;
    assert.equal(S.moved("wss://a.example/relay/", false), "wss://b.example/relay", "a person's pair moves any room, as in S5");
    assert.equal(S.moved(OLD, true, TABLE), S.CLOUD_HUB, "and the built-in one still works beside it");
  } finally { delete process.env.SOL_HUB_MOVED; }
});

test("a cloud room, and a room on a self-hoster's hub, are left as they are", () => {
  const c = S.cleanRoom({ id: "study", name: "Study", provider: "cloud", hub: S.CLOUD_HUB, code: CODE })!;
  assert.deepEqual([c.provider, c.hub, c.code], ["cloud", S.CLOUD_HUB, CODE]);
  const own = S.cleanRoom({ id: "x", name: "x", provider: "cloud", hub: "wss://hub.myschool.example/relay", code: CODE })!;
  assert.equal(own.hub, "wss://hub.myschool.example/relay");
  const gh = S.cleanRoom({ name: "Sol", repos: ["o/r"], hub: "wss://hub.myschool.example/relay", code: CODE })!;
  assert.equal(gh.hub, "wss://hub.myschool.example/relay");
});

test("an engine that hosts a hub (the NucBox's team.json) keeps hosting its own rooms, which never move", () => {
  // the NucBox's file may never have said host: it reads as a hub (HOST_BEFORE); its rooms meet on it (hub "")
  const s = S.readTeam({ me: { login: "marcocyl04-ux" }, relay: { url: "", key: "k" },
    rooms: [{ id: "sol", name: "Sol", repos: ["marcocyl04-ux/sol-dev"], hub: "", code: "SQLDEV", gate: "key" }], room: "sol" });
  assert.equal(s.relay.host, true);
  assert.equal(S.hostedRoom(s).hub, "", "its hub stays its own");
  assert.equal(S.activeRoom(s).hub, "");
  const said = S.readTeam({ relay: { url: "", key: "k", host: true }, rooms: [{ id: "a", name: "a", repos: ["o/a"], hub: "", code: "SQLDEV" }], room: "a" });
  assert.deepEqual([said.relay.host, said.rooms[0].hub], [true, ""]);
});

test("cloudBack (pure): an older Sol's write gets its dropped cloud rooms back; this Sol's own write, or one with a cloud room, does not", () => {
  const room = { id: "study", name: "Study", provider: "cloud", hub: S.CLOUD_HUB, code: CODE };
  const raw = { rooms: [{ id: "gh", name: "gh", repos: ["o/r"] }] }, text = JSON.stringify(raw);
  const back = S.cloudBack(text, raw, { of: "x", rooms: [room] });
  assert.deepEqual((back!.rooms as any[]).map((r) => r.id), ["gh", "study"]);
  assert.equal(S.cloudBack(text, raw, { of: sha(text), rooms: [room] }), null, "the hash is the one this Sol wrote: what it says stands (a room I forgot stays forgotten)");
  const withCloud = { rooms: [...raw.rooms, { ...room, id: "other", code: "QQQQQQ" }] };
  assert.equal(S.cloudBack(JSON.stringify(withCloud), withCloud, { of: "x", rooms: [room] }), null, "a Sol that keeps cloud rooms wrote it");
  const same = { rooms: [{ id: "x", name: "x", repos: ["o/r"], code: CODE.toLowerCase() }] };
  assert.equal(S.cloudBack(JSON.stringify(same), same, { of: "x", rooms: [room] }), null, "a room with that code is there already");
  assert.equal(S.cloudBack(text, raw, null), null);
  assert.equal(S.cloudBack(text, raw, { of: "x", rooms: [{ provider: "cloud" }] }), null, "nothing valid to put back");
});

test("on disk: the cloud room an older Sol dropped is back on the first read, written down, and the side file follows", () => {
  const s = S.getTeam();
  assert.deepEqual(s.rooms.map((r) => [r.id, r.provider]), [["gh", "github"], ["study", "cloud"]]);
  const disk = JSON.parse(readFileSync(FILE, "utf8"));
  assert.ok(disk.rooms.some((r: any) => r.provider === "cloud" && r.code === CODE), "written back");
  const side = JSON.parse(readFileSync(SIDE, "utf8"));
  assert.equal(side.of, sha(readFileSync(FILE, "utf8")), "the side file names the team.json written with it");
  assert.deepEqual(side.rooms.map((r: any) => r.code), [CODE]);
  // forgetting the cloud room here: it leaves the side file too, so it never comes back
  S.patchTeam({ rooms: s.rooms.filter((r) => r.provider !== "cloud"), room: "gh" });
  assert.deepEqual(JSON.parse(readFileSync(SIDE, "utf8")).rooms, []);
  assert.ok(existsSync(SIDE));
});

test("a move is made on every read and never written: team.json keeps the old hub, key and gate (one stable back still meets there)", () => {
  process.env.SOL_HUB_MOVED = `${OLD}=>${S.CLOUD_HUB}`;
  try {
    const file = { me: { login: "frank" }, relay: { url: OLD, key: "engine-key", host: false },
      rooms: [{ id: "sol", name: "Sol", repos: ["o/r"], hub: OLD, code: CODE, key: "room-key", gate: "key" }], room: "sol" };
    const s = S.readTeam(file);
    assert.deepEqual([s.rooms[0].hub, s.rooms[0].key, s.rooms[0].gate, s.relay.url], [S.CLOUD_HUB, "", "github", S.CLOUD_HUB], "in use: the cloud, no key");
    const disk = S.onDisk(s);
    assert.deepEqual([disk.rooms[0].hub, disk.rooms[0].key, disk.rooms[0].gate, disk.relay.url], [OLD, "room-key", "key", OLD], "written: as it was");
    assert.equal("was" in disk.rooms[0], false);
    const again = S.readTeam(JSON.parse(JSON.stringify(disk)));
    assert.deepEqual(again.rooms[0], s.rooms[0], "read again: the same");
    assert.equal(JSON.stringify(S.forFace(s)).includes("room-key"), false, "a face never sees the old key");
    // a face sends the rooms back (no `was`): the old words stay
    const patched = S.cleanTeam(S.mergeTeam(s, { rooms: S.forFace(s).rooms.map((r: any) => ({ ...r, key: s.rooms[0].key, was: s.rooms[0].was })) }));
    assert.equal(S.onDisk(patched).rooms[0].key, "room-key");
    delete process.env.SOL_HUB_MOVED; process.env.SOL_HUB_MOVED = "off";
    assert.deepEqual([S.readTeam(disk).rooms[0].hub, S.readTeam(disk).rooms[0].key], [OLD, "room-key"], "off undoes it");
  } finally { delete process.env.SOL_HUB_MOVED; }
});

test("isCloud: Sol's cloud however written (:443, a slash); a self-hoster's hub is not", () => {
  assert.equal(S.isCloud("wss://CLOUD.matterfold.tech:443/relay/"), true);
  assert.equal(S.isCloud("wss://cloud.matterfold.tech"), true);
  assert.equal(S.isCloud("wss://hub.myschool.example/relay"), false);
  assert.equal(S.isCloud(""), false);
});

test("a move to a self-hoster's hub takes the key along (A10 as in S5); a hand edit of a moved room's address keeps its old key on disk", () => {
  process.env.SOL_HUB_MOVED = "wss://old.school.example/relay=>wss://new.school.example/relay";
  try {
    const r = S.cleanRoom({ name: "Club", repos: ["o/r"], hub: "wss://old.school.example/relay", key: "school-key", gate: "key" })!;
    assert.deepEqual([r.hub, r.key, r.gate], ["wss://new.school.example/relay", "school-key", "key"]);
  } finally { delete process.env.SOL_HUB_MOVED; }
  process.env.SOL_HUB_MOVED = `${OLD}=>${S.CLOUD_HUB}`;
  try {
    const file = { relay: { url: "wss://elsewhere.example/relay", key: "k" }, room: "sol",
      rooms: [{ id: "sol", name: "Sol", repos: ["o/r"], hub: OLD, code: CODE, key: "room-key", gate: "key" }] };
    const s = S.readTeam(file);   // the top level says another hub: the room goes there, with its own key
    assert.deepEqual([s.rooms[0].hub, s.rooms[0].key, s.rooms[0].gate], ["wss://elsewhere.example/relay", "room-key", "key"]);
  } finally { delete process.env.SOL_HUB_MOVED; }
});

test("a key never meets the cloud: a room written with the cloud's address and a key sends none, and keeps it on disk", () => {
  const s = S.cleanTeam({ rooms: [{ id: "x", name: "x", repos: ["o/r"], hub: S.CLOUD_HUB, code: CODE, key: "old-key", gate: "key" }], room: "x" });
  assert.deepEqual([s.rooms[0].key, s.rooms[0].gate], ["", "github"]);
  assert.equal(S.onDisk(s).rooms[0].key, "old-key");
});
