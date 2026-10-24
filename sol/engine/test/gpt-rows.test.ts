// GPT rows in Work's side (#182): which Codex threads are talks in a folder, and how they file. Its own HOME, so the
// Codex folder read is a fixture (threads.ts reads ~/.codex/sessions), never Marco's; Work's marks in a file of their own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const top = realpathSync(mkdtempSync(join(tmpdir(), "sol-gptrows-")));
const me = join(top, "Users", "marco");   // the fixture's home
process.env.HOME = me;
process.env.SOL_STATE = join(top, "work.json");
const home = join(me, "sol", "home"), proj = join(me, "kaat"), oldSol = join(me, "ecosystem");
const day = join(me, ".codex", "sessions", "2026", "10", "24");
for (const d of [home, proj, day]) mkdirSync(d, { recursive: true });

const { codexTalks, listThreads } = await import("../src/threads.ts");
const { fileSessions } = await import("../src/work/sessions.ts");
const { workState } = await import("../src/work/state.ts");

let n = 0;
const rollout = (cwd: string, said: string, originator = "codex_sdk_ts") => {
  const id = `0000000${++n}-aaaa-bbbb-cccc-${String(n).padStart(12, "0")}`;
  writeFileSync(join(day, `rollout-2026-10-24T00-00-0${n}-${id}.jsonl`), [
    { type: "session_meta", payload: { id, cwd, originator, source: originator === "codex_cli_rs" ? "cli" : "exec" } },
    { type: "event_msg", payload: { type: "user_message", message: "<environment_context>injected</environment_context>" } },
    { type: "event_msg", payload: { type: "user_message", message: said } },
  ].map((o) => JSON.stringify(o)).join("\n") + "\n");
  return id;
};
const chat = rollout(home, "dinner ideas");                                    // Sol's own chat: Life's
const talk = rollout(proj, "fix the build");                                   // a GPT talk in a folder
const term = rollout(proj, "from a Terminal", "codex_cli_rs");                 // started in a Terminal there
const exec = rollout(proj, "review this diff", "codex_exec");                  // a one-shot `codex exec`: not a talk
const rev = rollout(proj, "Review the change");                                // the review seat's thread
const app = rollout(join(me, ".codex", ".chatgpt-projects", "g-p-1"), "app");  // the ChatGPT app's own folder
const twin = rollout("/home/marco/kaat", "on the NucBox");                     // the other machine's path of the same folder
const moved = rollout(join(oldSol, "home"), "an old chat");                    // Sol's home before it moved (#129)
const scratch = rollout("/tmp/sol-fixture", "scratch");                        // a scratch folder
workState().moved = { [oldSol]: join(me, "sol") };

test("the talks in folders: not Sol's own chats (also from before its folder moved), not exec runs, reviews or the app's folders", async () => {
  const ids = (await codexTalks(home, new Set([rev]))).map((t) => t.id).sort();
  assert.deepEqual(ids, [talk, term, twin, scratch].sort());
  const t = (await codexTalks(home)).find((x) => x.id === talk)!;
  assert.equal(t.title, "fix the build", "the first thing Marco said, past what the CLI injects");
  assert.equal((await codexTalks(home)).find((x) => x.id === twin)!.real, proj, "the other machine's path is the folder here");
  // Life's threads: Sol's home only, the moved one with it
  const life = (await listThreads(home)).filter((x) => x.seat === "codex").map((x) => x.sessionId).sort();
  assert.deepEqual(life, [chat, moved].sort());
  void exec; void app;
});

test("GPT rows file like Claude's: under the folder, seat codex; scratch out; a moved folder's talks under the new place; the twin's too", () => {
  const OLD = join(me, "gone", "kaat-old"), NEW = proj;
  workState().moved = { [OLD]: NEW };
  workState().folders = [proj];   // the fixture lives in the system's temp folder, scratch to the side: added by hand
  const g = (sessionId: string, cwd: string) => ({ sessionId, cwd, summary: `talk in ${cwd}`, lastModified: 5000 + ++n });
  const claude = { sessionId: "claude-1", cwd: proj, summary: "a Claude session", lastModified: 1000, fileSize: 10 } as any;
  const r = fileSessions([claude], [g("g-folder", proj), g("g-scratch", "/tmp/sol-fixture"), g("g-moved", OLD), g("g-twin", "/home/marco/kaat")]);
  const by = (id: string) => r.sessions.find((s) => s.id === id);
  assert.equal(by("claude-1")?.seat, undefined, "a Claude row stays plain");
  assert.equal(by("g-folder")?.seat, "codex");
  assert.equal(by("g-folder")?.project, proj);
  assert.equal(by("g-folder")?.updatedAt, 5000 + n - 3, "its time is the rollout's");
  assert.equal(by("g-scratch"), undefined, "scratch stays out");
  assert.equal(by("g-moved")?.cwd, NEW, "a folder that moved: the talk is in the new place");
  assert.equal(by("g-moved")?.gone, undefined, "not gone");
  assert.equal(by("g-twin")?.project, proj, "the other machine's talk files under the same folder here");
  assert.equal(by("g-twin")?.machine, "nucbox");
  assert.deepEqual(r.projects.find((p) => p.path === proj)?.count, 4, "the folder counts Claude's and GPT's rows (the twin's too)");
  // hidden folders hide GPT rows too
  workState().hidden = [proj];
  assert.equal(fileSessions([], [g("g-hidden", proj)]).sessions.length, 0);
  workState().hidden = [];
  workState().moved = {};
});
