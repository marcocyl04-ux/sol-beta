// node --test src/*.test.ts (npm test here): Cowork's groups (#314). The room the engine makes up when team.json names
// none is not a group, so a new install opens on the first-time page; a room anyone made, joined or shared is one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupsOf, madeUp, linkFor, joinLink } from "./cowork/rooms.ts";

const fresh = { id: "team", name: "sol-dev", provider: "github", repos: ["marcocyl04-ux/sol-dev"], hub: "", code: "", mine: false, joined: false };

test("the made-up room of a new install is no group", () => {
  assert.equal(madeUp(fresh), true);
  assert.deepEqual(groupsOf([fresh]), []);
});

test("a room someone made, joined, shared, or that meets somewhere is a group", () => {
  for (const r of [{ ...fresh, mine: true }, { ...fresh, joined: true }, { ...fresh, code: "K7QX2M" }, { ...fresh, hub: "wss://nucbox.example.ts.net/relay" },
    { ...fresh, id: "shuai" }, { ...fresh, repos: ["frank/room"] }, { ...fresh, repos: ["marcocyl04-ux/sol-dev", "a/b"] }])
    assert.equal(madeUp(r), false, JSON.stringify(r));
  const made = { ...fresh, id: "shuai", provider: "cloud", repos: [], code: "2QKTYA" };
  assert.deepEqual(groupsOf([fresh, made]).map((r) => r.id), ["shuai"]);
});

test("a group's link only once its hub said it serves the join page, and only for a cloud group with a code (#327)", () => {
  const cloud = { code: "2QKTYA", provider: "cloud", hub: "wss://cloud.matterfold.tech/relay" };
  assert.equal(linkFor(cloud, true), "https://cloud.matterfold.tech/relay/j/2QKTYA");
  assert.equal(linkFor(cloud, false), "", "the hub's hello said nothing of a page: the code alone");
  assert.equal(linkFor(cloud, undefined), "");
  assert.equal(linkFor({ ...cloud, provider: "github" }, true), "", "a GitHub group is joined by its code");
  assert.equal(linkFor({ ...cloud, code: "" }, true), "");
  assert.equal(linkFor({ ...cloud, hub: "" }, true), "https://cloud.matterfold.tech/relay/j/2QKTYA", "no hub named: Sol's cloud");
  assert.equal(linkFor({ ...cloud, hub: "WSS://cloud.matterfold.tech:443/relay/" }, true), "https://cloud.matterfold.tech/relay/j/2QKTYA", "the same cloud, written otherwise");
  assert.equal(linkFor({ ...cloud, hub: "wss://hub.self-host.example/relay" }, true), "", "a cloud room on another hub: no page the link could name");
  assert.equal(joinLink("2QKTYA", "ws://127.0.0.1:8787/relay/"), "http://127.0.0.1:8787/relay/j/2QKTYA");
  assert.equal(joinLink("2QKTYA", "https://x.example/relay"), "", "not a hub's address");
});
