// The door (engine/src/door.ts): who may open the engine's socket or fetch its routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { doorOpen } from "../src/door.ts";

const opts = { port: 7777, owner: "marco@example.com" };
const AWAY = "https://nucbox.example.ts.net";
const owner = { "tailscale-user-login": "marco@example.com", host: "nucbox.example.ts.net" };

test("tailnet: the owner from a foreign page is refused", () => {
  assert.equal(doorOpen({ ...owner, origin: "https://evil.example" }, opts), false);
  assert.equal(doorOpen({ ...owner, origin: "http://nucbox.example.ts.net" }, opts), false);   // not https
  assert.equal(doorOpen({ ...owner, origin: "null" }, opts), false);
});

test("tailnet: the owner from Sol's own away page passes", () => {
  assert.equal(doorOpen({ ...owner, origin: AWAY }, opts), true);
});

test("tailnet: the owner from the Mac app or its hot face passes, the app's pages on the engine's own port do not (#49)", () => {
  assert.equal(doorOpen({ ...owner, origin: "tauri://localhost" }, opts), true);
  assert.equal(doorOpen({ ...owner, origin: "http://tauri.localhost" }, opts), true);
  assert.equal(doorOpen({ ...owner, origin: "https://tauri.localhost" }, opts), true);
  assert.equal(doorOpen({ ...owner, origin: "http://localhost:1420" }, opts), true);
  assert.equal(doorOpen({ ...owner, origin: "http://127.0.0.1:1420" }, opts), true);
  assert.equal(doorOpen({ ...owner, origin: "http://127.0.0.1:7777" }, opts), false);   // that is the NucBox's own loopback page, not an owner device's
  assert.equal(doorOpen({ ...owner, "tailscale-user-login": "other@example.com", origin: "tauri://localhost" }, opts), false);
});

test("tailnet: the owner with no Origin (a program, the phone app) passes", () => {
  assert.equal(doorOpen({ ...owner }, opts), true);
});

test("tailnet: not the owner is refused whatever the Origin", () => {
  assert.equal(doorOpen({ ...owner, "tailscale-user-login": "other@example.com", origin: AWAY }, opts), false);
  assert.equal(doorOpen({ ...owner, "tailscale-user-login": "other@example.com" }, opts), false);
  assert.equal(doorOpen({ ...owner, origin: AWAY }, { ...opts, owner: "" }), false);   // no owner set: nobody over the tailnet
});

test("loopback: Sol's pages pass, a foreign page is refused, no Origin passes unless cross-site", () => {
  assert.equal(doorOpen({ origin: "tauri://localhost" }, opts), true);
  assert.equal(doorOpen({ origin: "http://localhost:1420" }, opts), true);
  assert.equal(doorOpen({ origin: "http://127.0.0.1:7777" }, opts), true);
  assert.equal(doorOpen({ origin: "https://evil.example" }, opts), false);
  assert.equal(doorOpen({}, opts), true);
  assert.equal(doorOpen({ "sec-fetch-site": "cross-site" }, opts), false);
});
