// The notch's Stop on a turn the notch started (F2 of the engine review, 2026-10-20). A door's say carries no session
// and no draft; the engine gives it a draft before anything keys on it, so a stop with that id, from any socket, finds
// the turn through its relay, and a stop with no id still stops the socket's own turn. A real engine runs on its own
// port, home and profile, with a stand-in codex (SOL_CODEX) that never answers, so nothing leaves the machine.
// And one ending per turn (F4): a seat that throws still ends its turn with one done, after the error; and an unknown
// work.* type gets an answer.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const ENGINE = join(import.meta.dirname, "..");
const PORT = 7990 + Math.floor(Math.random() * 9);
const dir = mkdtempSync(join(tmpdir(), "sol-wire-"));
mkdirSync(join(dir, "home"));
// the stand-in: a say with "fail" in it dies at once, any other one waits to be stopped
writeFileSync(join(dir, "codex"), "#!/bin/sh\ncase \"$(cat)\" in *fail*) echo boom >&2; exit 1;; esac\nexec sleep 600\n"); chmodSync(join(dir, "codex"), 0o755);

let engine: ChildProcess | null = null;
let first = "";   // the first test's turn, so the second does not take it for its own
after(() => { engine?.kill(); rmSync(dir, { recursive: true, force: true }); });

async function up() {
  if (engine) return;
  engine = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: ENGINE, stdio: "ignore",
    env: {
      ...process.env, SOL_PORT: String(PORT), SOL_HOME: join(dir, "home"), SOL_PROFILE: join(dir, "profile"),
      SOL_STATE: join(dir, "work.json"), SOL_TEAM: join(dir, "team.json"), SOL_LOG: join(dir, "engine.log"),
      SOL_CODEX: join(dir, "codex"), SOL_NO_RENEW: "1", SOL_NO_SHIP_CHECK: "1", SOL_TEAM_OFFLINE: "1", SOL_TRACK: "off",   // #356: nothing counted, no settings written, nothing sent
    },
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the test engine did not come up");
}

type Msg = { type: string; [k: string]: any };
async function face() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const got: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; ok: (m: Msg) => void }[] = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString()) as Msg;
    got.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.ok(m); }
  });
  await new Promise((r, no) => { ws.once("open", r); ws.once("error", no); });
  const next = (pred: (m: Msg) => boolean, ms = 10_000) => new Promise<Msg>((ok, no) => {
    const seen = got.find(pred);
    if (seen) return ok(seen);
    const t = setTimeout(() => no(new Error("timed out; got " + got.map((m) => m.type).join(" "))), ms);
    waiters.push({ pred, ok: (m) => { clearTimeout(t); ok(m); } });
  });
  return { ws, got, next, say: (m: object) => ws.send(JSON.stringify(m)) };
}

test("stop: a door's say with no ids is stopped by its own socket's stop", { timeout: 60_000 }, async () => {
  await up();
  const a = await face();
  a.say({ type: "say", text: "hi from the notch", seat: "codex", door: "notch", fresh: true });
  first = (await a.next((m) => m.type === "creature.turn" && !!m.turn)).turn.sessionId;
  a.say({ type: "stop" });
  const done = await a.next((m) => m.type === "done");
  assert.equal(done.stopped, true);
  assert.equal(a.got.filter((m) => m.type === "done").length, 1, "one ending");
  a.ws.close();
});

test("stop: the notch's Stop with the turn's id, from another socket, stops a door's say", { timeout: 60_000 }, async () => {
  await up();
  const a = await face(), notch = await face();
  a.say({ type: "say", text: "hi from the phone", seat: "codex", door: "phone", fresh: true });
  // the notch learns the turn from creature.turn, and stops it by that id
  const t = await notch.next((m) => m.type === "creature.turn" && !!m.turn && m.turn.sessionId !== first);
  assert.ok(t.turn.sessionId, "the door's turn has an id");
  notch.say({ type: "stop", sessionId: t.turn.sessionId });
  const done = await a.next((m) => m.type === "done");
  assert.equal(done.stopped, true);
  assert.equal(a.got.filter((m) => m.type === "done").length, 1, "one ending");
  a.ws.close(); notch.ws.close();
});

test("one ending: a seat that throws ends the turn with its error and one done, ok: false", { timeout: 60_000 }, async () => {
  await up();
  const a = await face();
  a.say({ type: "say", text: "please fail", seat: "codex", door: "notch", fresh: true });
  const done = await a.next((m) => m.type === "done");
  const types = a.got.map((m) => m.type).filter((t) => t === "error" || t === "done");
  assert.deepEqual(types, ["error", "done"]);
  assert.equal(done.ok, false);
  assert.equal(done.seat, "codex");
  a.ws.close();
});

test("an unknown work.* type is answered by its rid with an error, so the face's ask does not wait", { timeout: 60_000 }, async () => {
  await up();
  const a = await face();
  a.say({ type: "work.nope", rid: "r1" });
  const r = await a.next((m) => m.rid === "r1", 5000);
  assert.equal(r.type, "work.nope");
  assert.match(r.error, /work\.nope/);
  a.ws.close();
});

test("health: Sol's own page reads it across origins (One Sol, #62); a foreign page is refused", { timeout: 60_000 }, async () => {
  await up();
  const app = await fetch(`http://127.0.0.1:${PORT}/health`, { headers: { origin: "tauri://localhost" } });
  assert.equal(app.status, 200);
  assert.equal(app.headers.get("access-control-allow-origin"), "tauri://localhost");
  assert.deepEqual((await app.json()).busy, []);
  const bare = await fetch(`http://127.0.0.1:${PORT}/health`);
  assert.equal(bare.headers.get("access-control-allow-origin"), null, "no Origin, no header");
  const foreign = await fetch(`http://127.0.0.1:${PORT}/health`, { headers: { origin: "https://example.com" } });
  assert.equal(foreign.status, 403);
});

// last in this file: the engine then refuses new turns for LET_GO_MS
test("letgo: a quiet engine lets go, then refuses a new turn so none starts before the window's reload (One Sol, #62)", { timeout: 60_000 }, async () => {
  await up();
  const r = await fetch(`http://127.0.0.1:${PORT}/letgo`, { method: "POST", headers: { origin: "tauri://localhost" } });
  assert.equal(r.headers.get("access-control-allow-origin"), "tauri://localhost");
  assert.deepEqual(await r.json(), { ok: true });
  const a = await face();
  a.say({ type: "say", text: "hi", seat: "codex", door: "notch", fresh: true });
  assert.match((await a.next((m) => m.type === "error")).message, /moving to the NucBox/);
  a.say({ type: "work.say", sessionId: "s1", text: "hi" });
  assert.match((await a.next((m) => m.type === "work.error")).message, /moving to the NucBox/);
  a.ws.close();
});
