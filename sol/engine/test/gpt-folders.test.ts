// GPT works in any folder (#182): a real engine on its own port, home and back room, with its own HOME (so ~/.codex is
// a fixture, never Marco's) and a stand-in codex that records how it was started, writes a rollout the way Codex does
// (session_meta first, with the folder it was given) and answers "done". Nothing leaves the machine.
//   - a new GPT talk with a folder runs Codex in it (workspace-write, network off, approvals never); without one, in
//     Sol's home; a talk that goes on keeps its folder
//   - the busy entry carries the folder while the turn runs, and its row in Work's side says running
//   - the row files under its folder with seat codex; Sol's own chat stays in Life's threads only
//   - the switch: the gist of the talk and its folder, nothing on the talk changed; the new talk's parent mark
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const ENGINE = join(import.meta.dirname, "..");
const PORT = 8030 + Math.floor(Math.random() * 9);
const dir = realpathSync(mkdtempSync(join(tmpdir(), "sol-gpt-")));
const fakeHome = join(dir, "me"), home = join(dir, "solhome"), folder = join(fakeHome, "kaat");
const rollouts = join(fakeHome, ".codex", "sessions", "2026", "10", "24"), started = join(dir, "codex.log");
for (const d of [fakeHome, home, folder, rollouts]) mkdirSync(d, { recursive: true });
// the stand-in: one line per start in codex.log (its args, the prompt, the env's HOME), a rollout per thread
writeFileSync(join(dir, "codex"), `#!${process.execPath}
const fs = require("fs"), path = require("path");
const a = process.argv.slice(2);
const cd = a[a.indexOf("--cd") + 1], r = a.indexOf("resume");
const id = r >= 0 ? a[r + 1] : require("crypto").randomUUID();
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  fs.appendFileSync(${JSON.stringify(started)}, JSON.stringify({ args: a, input }) + "\\n");
  const f = path.join(${JSON.stringify(rollouts)}, "rollout-2026-10-24T00-00-00-" + id + ".jsonl");
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ type: "session_meta", payload: { id, cwd: cd, originator: "codex_sdk_ts", source: "exec" } }) + "\\n");
  fs.appendFileSync(f, JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: input } }) + "\\n");
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  out({ type: "thread.started", thread_id: id });
  out({ type: "turn.started" });
  setTimeout(() => {
    fs.appendFileSync(f, JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "done" } }) + "\\n");
    out({ type: "item.completed", item: { id: "m1", type: "agent_message", text: "done" } });
    out({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } });
  }, 1500);
});
`);
chmodSync(join(dir, "codex"), 0o755);

let engine: ChildProcess | null = null;
after(() => { engine?.kill(); rmSync(dir, { recursive: true, force: true }); });

type Msg = { type: string; [k: string]: any };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const starts = () => (existsSync(started) ? readFileSync(started, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const after1 = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

async function up() {
  engine = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: ENGINE, stdio: "ignore",
    env: {
      ...process.env, HOME: fakeHome, SOL_PORT: String(PORT), SOL_HOME: home, SOL_PROFILE: join(dir, "profile"),
      SOL_STATE: join(dir, "work.json"), SOL_TEAM: join(dir, "team.json"), SOL_LOG: join(dir, "engine.log"),
      SOL_CODEX: join(dir, "codex"), SOL_NO_RENEW: "1", SOL_NO_SHIP_CHECK: "1", SOL_TEAM_OFFLINE: "1",
    },
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {}
    await wait(200);
  }
  throw new Error("the test engine did not come up");
}

async function face() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const got: Msg[] = [];
  ws.on("message", (raw) => got.push(JSON.parse(raw.toString())));
  await new Promise((r, no) => { ws.once("open", r); ws.once("error", no); });
  const next = async (pred: (m: Msg) => boolean, what: string, from = 0) => {
    for (let i = 0; i < 150; i++) { const m = got.slice(from).find(pred); if (m) return m; await wait(100); }
    throw new Error(`${what}: timed out; got ${got.map((m) => m.type).join(" ")}`);
  };
  return { got, next, send: (m: object) => ws.send(JSON.stringify(m)) };
}

test("a GPT talk in a folder works there, carries its folder while it runs, files under it, and the switch carries its gist", { timeout: 90_000 }, async () => {
  await up();
  const f = await face();
  // /var/folders is scratch to the side; a folder added by hand is listed all the same (the felt test uses a real one)
  f.send({ type: "work.folder", op: "add", path: folder });

  // 1. a new talk in the folder
  let n = f.got.length;
  f.send({ type: "say", text: "make notes.md", seat: "codex", draft: "draft-kaat-0001", cwd: folder });
  const start = await f.next((m) => m.type === "start", "the talk started", n);
  const id = start.sessionId as string;
  assert.equal(start.cwd, folder, "start says the folder");
  const s1 = starts().at(-1)!;
  assert.equal(after1(s1.args, "--cd"), folder, "Codex works in the folder");
  assert.equal(after1(s1.args, "--sandbox"), "workspace-write", "it writes inside that folder only");
  assert.ok(s1.args.includes("sandbox_workspace_write.network_access=false"), "network off");
  assert.ok(s1.args.includes('approval_policy="never"'), "nothing asked");

  // while it runs: the busy entry says the folder (a rename, #181, waits on it), and its row says running
  const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  const job = health.busy.find((j: any) => j.kind === "life");
  assert.equal(job?.cwd, folder, "the busy entry carries the cwd");
  assert.equal(job?.id, id, "under the thread's id once it has one");
  f.send({ type: "work.list" });
  const live = await f.next((m) => m.type === "work.sessions" && m.sessions.some((s: any) => s.id === id), "the row while it runs", n);
  assert.equal(live.sessions.find((s: any) => s.id === id).running, true);
  // a rename of the folder is refused while the talk runs (#181 asks the busy counter through liveIn)
  n = f.got.length;
  f.send({ type: "work.folder", op: "rename", rid: "r1", path: folder, name: "kaat2" });
  const refused = await f.next((m) => m.type === "work.folder" && m.rid === "r1", "the rename answered", n);
  assert.match(String(refused.error), /is running in kaat; rename when it stops/);
  assert.ok(existsSync(folder), "the folder is where it was");

  await f.next((m) => m.type === "done" && m.sessionId === id, "the turn ended", n);
  const after = (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()).busy;
  assert.equal(after.length, 0, "nothing left on the counter");

  // 2. the row: under the folder, seat codex, not running; Life's threads do not hold it
  n = f.got.length;
  f.send({ type: "work.list" });
  const list = await f.next((m) => m.type === "work.sessions", "the list", n);
  const row = list.sessions.find((s: any) => s.id === id);
  assert.ok(row, "the talk is a row");
  assert.equal(row.seat, "codex");
  assert.equal(row.project, folder);
  assert.equal(row.running, undefined);
  assert.ok(list.projects.some((p: any) => p.path === folder && p.count === 1));
  f.send({ type: "list" });
  const threads = await f.next((m) => m.type === "threads", "Life's threads", n);
  assert.ok(!threads.threads.some((t: any) => t.sessionId === id), "not one of Sol's own chats");

  // 3. it goes on in its folder; opening it says where
  n = f.got.length;
  f.send({ type: "open", seat: "codex", sessionId: id });
  const opened = await f.next((m) => m.type === "thread" && m.sessionId === id, "opened", n);
  assert.equal(opened.cwd, folder);
  f.send({ type: "say", text: "and a second line", seat: "codex", sessionId: id });
  await f.next((m) => m.type === "done" && m.sessionId === id, "the second turn ended", n);
  const s2 = starts().at(-1)!;
  assert.equal(after1(s2.args, "resume"), id);
  assert.equal(after1(s2.args, "--cd"), folder, "the same folder on resume");

  // 4. a chat with no folder (and one that names the home folder) is Sol's home, as before, and stays Life's
  n = f.got.length;
  f.send({ type: "say", text: "dinner ideas", seat: "codex", draft: "draft-home-0001", cwd: fakeHome });
  const chat = (await f.next((m) => m.type === "start", "the chat started", n)).sessionId;
  await f.next((m) => m.type === "done" && m.sessionId === chat, "the chat ended", n);
  assert.equal(after1(starts().at(-1)!.args, "--cd"), realpathSync(home), "Marco's home folder is not a project: Sol's home");
  f.send({ type: "list" });
  const th = await f.next((m) => m.type === "threads" && m.threads.some((t: any) => t.sessionId === chat), "the chat is Life's", n);
  assert.ok(th);
  f.send({ type: "work.list" });
  const l2 = await f.next((m) => m.type === "work.sessions" && m.sessions.some((s: any) => s.id === id), "the list again", n);
  assert.ok(!l2.sessions.some((s: any) => s.id === chat), "Sol's own chat is not a Work row");

  // 5. the switch, mid-talk: the gist and the folder; nothing on the first talk changes
  n = f.got.length;
  f.send({ type: "work.switch", rid: "s1", sessionId: id, seat: "codex", title: "kaat notes" });
  const sw = await f.next((m) => m.type === "work.switch" && m.rid === "s1", "the switch answered", n);
  assert.equal(sw.cwd, folder);
  assert.equal(sw.parent, id);
  assert.equal(sw.seat, "claude");
  assert.match(sw.brief, /^Carried over from a talk with GPT \("kaat notes"\)\. Where it stood:/);
  assert.match(sw.brief, /Marco: make notes\.md/);
  assert.match(sw.brief, /GPT: done/);
  assert.match(sw.brief, /Carry on from here with Claude\.$/);
  const marks = existsSync(join(dir, "work.json")) ? JSON.parse(readFileSync(join(dir, "work.json"), "utf8")).marks ?? {} : {};
  assert.equal(marks[id], undefined, "the first talk is untouched");

  // the other way: a new GPT talk carrying on from a Claude one nests under it (parent), in the same folder
  n = f.got.length;
  f.send({ type: "say", text: "carry on", seat: "codex", draft: "draft-kaat-0002", cwd: folder, parent: "claude-session-0001" });
  const child = (await f.next((m) => m.type === "start", "the carried talk started", n)).sessionId;
  await f.next((m) => m.type === "done" && m.sessionId === child, "it ended", n);
  const marks2 = JSON.parse(readFileSync(join(dir, "work.json"), "utf8")).marks;
  assert.equal(marks2[child]?.parent, "claude-session-0001", "the parent mark");
  f.send({ type: "work.list" });
  const l3 = await f.next((m) => m.type === "work.sessions" && m.sessions.some((s: any) => s.id === child), "the carried row", n);
  assert.equal(l3.sessions.find((s: any) => s.id === child).parent, "claude-session-0001");
});
