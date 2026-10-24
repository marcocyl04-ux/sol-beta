// "rename…" on a folder over the wire (#181): work.folder { op: rename } is answered by its rid, with the reason when
// refused and where the folder went when not. A real engine on its own port, with its own HOME (a temp folder, so its
// ~/.claude, ~/.claude.json and the folder renamed are all fixtures), its own state and home.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const ENGINE = join(import.meta.dirname, "..");
const PORT = 7980 + Math.floor(Math.random() * 9);
const dir = realpathSync(mkdtempSync(join(tmpdir(), "sol-rename-wire-")));
const HOME = join(dir, "person"), A = join(HOME, "projects", "a");
mkdirSync(join(dir, "home")); mkdirSync(A, { recursive: true }); mkdirSync(join(HOME, ".claude", "projects"), { recursive: true });
writeFileSync(join(HOME, ".claude.json"), JSON.stringify({ projects: { [A]: { x: 1 } } }));

let engine: ChildProcess | null = null;
after(() => { engine?.kill(); rmSync(dir, { recursive: true, force: true }); });

async function up() {
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME, SOL_PORT: String(PORT), SOL_HOME: join(dir, "home"), SOL_PROFILE: join(dir, "profile"),
    SOL_STATE: join(dir, "work.json"), SOL_TEAM: join(dir, "team.json"), SOL_LOG: join(dir, "engine.log"),
    SOL_SESSIONS_DIR: join(dir, "sessions"), SOL_NO_RENEW: "1", SOL_NO_SHIP_CHECK: "1", SOL_TEAM_OFFLINE: "1",
  };
  delete env.CLAUDE_CONFIG_DIR;
  engine = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: ENGINE, stdio: "ignore", env });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the test engine did not come up");
}

test("work.folder rename: refused with a reason, else the folder moves and the answer says where", { timeout: 60_000 }, async () => {
  await up();
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((r, no) => { ws.once("open", r); ws.once("error", no); });
  let n = 0;
  const ask = (a: object) => new Promise<any>((ok, no) => {
    const rid = `r${++n}`;
    const t = setTimeout(() => no(new Error("no answer")), 20_000);
    const on = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.rid === rid) { clearTimeout(t); ws.off("message", on); ok(m); } };
    ws.on("message", on);
    ws.send(JSON.stringify({ type: "work.folder", op: "rename", rid, ...a }));
  });
  assert.deepEqual(await ask({ path: A, name: "" }), { type: "work.folder", rid: "r1", error: "the name is empty" });
  assert.equal((await ask({ path: join(HOME, "projects", "nowhere"), name: "b" })).error, "nowhere is not on this disk");
  assert.equal((await ask({ path: HOME, name: "b" })).error, "person is your home folder; rename it from Terminal");
  assert.equal((await ask({ path: ENGINE, name: "b" })).error, "Sol runs from engine; rename it from Terminal");
  const r = await ask({ path: A, name: "b" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.to, join(HOME, "projects", "b"));
  assert.ok(!existsSync(A) && existsSync(r.to));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(HOME, ".claude.json"), "utf8")).projects), [r.to]);
  ws.close();
});
