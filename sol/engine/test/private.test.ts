// engine/private (#253, the clean screen): the private list in home/private.json. A first read seeds the four chat
// apps, all on, and writes them; a tick is kept and survives a fresh read (a relaunch reads the same file); an add
// lands once; a broken file reads as the seed again; the asks answer under their type and rid. Each test uses its own
// temporary home; nothing here opens a window or takes a picture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEED, add, handlePrivate, isBundle, parseList, readList, setPrivateHome, tick } from "../src/private.ts";

const home = () => { const h = mkdtempSync(join(tmpdir(), "sol-private-")); setPrivateHome(h); return h; };
const face = () => { const got: any[] = []; return { got, send: (m: object) => got.push(m) }; };

test("the first read seeds WeChat, WhatsApp, Claude and ChatGPT, all on, and writes the file", () => {
  const h = home();
  const apps = readList();
  assert.deepEqual(apps.map((a) => a.bundle), ["com.tencent.xinWeChat", "net.whatsapp.WhatsApp", "com.anthropic.claudefordesktop", "com.openai.chat"]);
  assert.ok(apps.every((a) => a.on));
  assert.deepEqual(JSON.parse(readFileSync(join(h, "private.json"), "utf8")), { apps });
  assert.equal(SEED[0].name, "WeChat");
});

test("a tick is kept and survives a fresh read", async () => {
  home();
  const w = face();
  await handlePrivate(w, { type: "eye.tick", rid: "t1", bundle: "net.whatsapp.WhatsApp", on: false });
  assert.equal(w.got[0].type, "eye.tick");
  assert.equal(w.got[0].rid, "t1");
  assert.equal(w.got[0].apps.find((a: any) => a.bundle === "net.whatsapp.WhatsApp").on, false);
  assert.equal(readList().find((a) => a.bundle === "net.whatsapp.WhatsApp")!.on, false);
  assert.equal(readList().find((a) => a.bundle === "com.tencent.xinWeChat")!.on, true);
});

test("eye.add puts a new app on the end, on; the same app twice is ticked on, not doubled", async () => {
  home();
  const w = face();
  await handlePrivate(w, { type: "eye.add", rid: "a1", name: "Slack", bundle: "com.tinyspeck.slackmacgap" });
  await handlePrivate(w, { type: "eye.tick", rid: "a2", bundle: "com.tinyspeck.slackmacgap", on: false });
  await handlePrivate(w, { type: "eye.add", rid: "a3", name: "Slack", bundle: "com.tinyspeck.slackmacgap" });
  const apps = readList();
  assert.equal(apps.length, 5);
  assert.deepEqual(apps[4], { name: "Slack", bundle: "com.tinyspeck.slackmacgap", on: true });
});

test("the asks refuse what is not on the list or not a bundle id, under their type and rid", async () => {
  home();
  const w = face();
  await handlePrivate(w, { type: "eye.tick", rid: "x1", bundle: "com.nobody.here", on: true });
  await handlePrivate(w, { type: "eye.add", rid: "x2", name: "rm", bundle: "../../etc" });
  assert.deepEqual(w.got, [
    { type: "eye.tick", rid: "x1", error: "com.nobody.here is not on the private list" },
    { type: "eye.add", rid: "x2", error: "\"../../etc\" is not an app's bundle id" },
  ]);
  assert.equal(readList().length, 4);
});

test("eye.list answers the whole list", async () => {
  home();
  const w = face();
  await handlePrivate(w, { type: "eye.list", rid: "l1" });
  assert.equal(w.got[0].type, "eye.list");
  assert.equal(w.got[0].apps.length, 4);
});

test("a broken file reads as the seed again; a good one keeps its own order and drops bad rows", () => {
  const h = home();
  writeFileSync(join(h, "private.json"), "{ not json");
  assert.equal(readList().length, 4);
  assert.equal(parseList("[]"), null);
  assert.deepEqual(parseList(JSON.stringify({ apps: [
    { name: "B", bundle: "b.app" }, { bundle: "nope" }, { name: "B again", bundle: "b.app" }, { name: " ", bundle: "a.app", on: false },
  ] })), [{ name: "B", bundle: "b.app", on: true }, { name: "a.app", bundle: "a.app", on: false }]);
});

test("the pure parts: bundle ids, tick and add leave the old list alone", () => {
  assert.ok(isBundle("com.openai.chat"));
  assert.ok(!isBundle("chat"));
  assert.ok(!isBundle("com.openai.chat; rm"));
  const before = SEED.map((a) => ({ ...a }));
  const after = tick(before, "com.openai.chat", false);
  assert.equal(before[3].on, true);
  assert.equal(after[3].on, false);
  assert.equal(add(before, "", "org.example.app")[4].name, "org.example.app");
  assert.throws(() => tick(before, "org.example.app", true));
});
