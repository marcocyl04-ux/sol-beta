// Usage and the one ask (#133, PRD section 8, done-when 12): the face sends its presses (arrange.used), and after the
// 100th the next chat's prompt carries the one line, once, with manage "asked" on disk. A real engine on its own port and
// back room, with a stand-in codex that writes each prompt it is given to a file and ends, so nothing leaves the machine.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const ENGINE = join(import.meta.dirname, "..");
const PORT = 8010 + Math.floor(Math.random() * 9);
const dir = mkdtempSync(join(tmpdir(), "sol-ask-"));
const home = join(dir, "home"), prompts = join(dir, "prompts.log");
mkdirSync(home);
writeFileSync(join(dir, "codex"), `#!/bin/sh\ncat >> "${prompts}"\nprintf '\\n<<end>>\\n' >> "${prompts}"\nexit 1\n`); chmodSync(join(dir, "codex"), 0o755);

let engine: ChildProcess | null = null;
after(() => { engine?.kill(); rmSync(dir, { recursive: true, force: true }); });

type Msg = { type: string; [k: string]: any };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const onDisk = () => (existsSync(join(home, "arrangement.json")) ? JSON.parse(readFileSync(join(home, "arrangement.json"), "utf8")) : null);
const said = () => (existsSync(prompts) ? readFileSync(prompts, "utf8").split("\n<<end>>\n").filter(Boolean) : []);
const ASK = /Sol's rail use so far: (.*)\. Ask once whether they want you to keep their rail tidy, or keep choosing themselves\./;

test("after the 100th press, the next chat's prompt carries the one ask, once, and manage is asked", { timeout: 90_000 }, async () => {
  engine = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: ENGINE, stdio: "ignore",
    env: {
      ...process.env, SOL_PORT: String(PORT), SOL_HOME: home, SOL_PROFILE: join(dir, "profile"),
      SOL_STATE: join(dir, "work.json"), SOL_TEAM: join(dir, "team.json"), SOL_LOG: join(dir, "engine.log"),
      SOL_CODEX: join(dir, "codex"), SOL_NO_RENEW: "1", SOL_NO_SHIP_CHECK: "1", SOL_TEAM_OFFLINE: "1",
    },
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {}
    await wait(200);
  }
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const got: Msg[] = [];
  ws.on("message", (raw) => got.push(JSON.parse(raw.toString())));
  await new Promise((r, no) => { ws.once("open", r); ws.once("error", no); });
  const send = (m: object) => ws.send(JSON.stringify(m));
  const total = () => Object.values((onDisk()?.usage ?? {}) as Record<string, { n: number }>).reduce((s, u) => s + u.n, 0);
  const until = async (ok: () => boolean, what: string) => { for (let i = 0; i < 100 && !ok(); i++) await wait(100); assert.ok(ok(), what); };
  // one chat turn; the stand-in ends it, so its prompt is on file when the done comes
  const chat = async (text: string) => {
    const n = got.filter((m) => m.type === "done").length, p = said().length;
    send({ type: "say", text, seat: "codex", door: "notch", fresh: true });
    await until(() => got.filter((m) => m.type === "done").length > n && said().length > p, `the turn "${text}" ended`);
    return said().at(-1)!;
  };

  send({ type: "arrange.used", counts: { changes: 60, terminal: 30, call: 9 } });
  await until(() => total() === 99, "99 presses kept");
  assert.equal(onDisk().usage.changes.n, 60);
  assert.match(onDisk().usage.changes.last, /^\d{4}-\d{2}-\d{2}$/);
  assert.doesNotMatch(await chat("first"), ASK, "99 presses: no ask yet");
  assert.equal(onDisk().manage, null);

  send({ type: "arrange.used", counts: { changes: 1 } });
  await until(() => total() === 100, "the 100th press kept");
  const second = await chat("second");
  const line = ASK.exec(second);
  assert.ok(line, `the ask is in the prompt:\n${second}`);
  assert.match(line[1], /^changes 61, terminal 30, call 9; never pressed: .*\bbrowser\b/, "top five, then the never-pressed");
  assert.equal(onDisk().manage, "asked");

  assert.doesNotMatch(await chat("third"), ASK, "asked once");
  assert.equal(said().filter((p) => ASK.test(p)).length, 1);
  ws.close();
});
