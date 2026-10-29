// engine/track-files (#356): the other tools' own files on this Mac, counted once a day as numbers. Fake roots in a
// temp folder: a Claude Code transcript with words in it, a Codex session, a sign-in file each, an Applications folder.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTrackHome, dayFile } from "../src/track.ts";
import { scanOthers, claudeDays, codexDays, planWords, appsInstalled, APPS, type Roots } from "../src/track-files.ts";

let home = "", roots: Roots;
let now = new Date(2026, 9, 29, 9, 0, 0);   // the 29th, local; yesterday is the 28th
const j = (o: object) => JSON.stringify(o) + "\n";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sol-track-files-"));
  now = new Date(2026, 9, 29, 9, 0, 0);
  setTrackHome(home, { version: "abc1234", consent: () => ({ usage: true }), now: () => now });
  const r = mkdtempSync(join(tmpdir(), "sol-others-"));
  roots = { claude: join(r, "projects"), codex: join(r, "sessions"), claudeJson: join(r, "claude.json"), codexAuth: join(r, "auth.json"), apps: [join(r, "Applications")], now: () => now };
  // a Claude Code transcript: two days, a prompt with words, two answers with usage, a tool result handed back (not a prompt)
  const proj = join(roots.claude, "-Users-frank-projects-sol");
  mkdirSync(proj, { recursive: true });
  const at = (h: number, day = 28) => new Date(2026, 9, day, h, 0, 0).toISOString();
  writeFileSync(join(proj, "s1.jsonl"),
    j({ type: "user", timestamp: at(10), sessionId: "s1", cwd: "/Users/frank/projects/sol", entrypoint: "cli", message: { role: "user", content: "remind sarah about the rent, secret plan" } }) +
    j({ type: "assistant", timestamp: at(10), sessionId: "s1", cwd: "/Users/frank/projects/sol", entrypoint: "cli", message: { id: "msg_1", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 4 } } }) +
    j({ type: "assistant", timestamp: at(10), sessionId: "s1", cwd: "/Users/frank/projects/sol", entrypoint: "cli", message: { id: "msg_1", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 4 } } }) +   // the same answer's second content block: the same id, the same usage
    j({ type: "user", timestamp: at(10), sessionId: "s1", cwd: "/Users/frank/projects/sol", entrypoint: "cli", isMeta: true, message: { role: "user", content: "<command-name>/clear</command-name>" } }) +
    j({ type: "user", timestamp: at(10), sessionId: "s1", cwd: "/Users/frank/projects/sol", entrypoint: "cli", message: { role: "user", content: "[Request interrupted by user]" } }) +
    j({ type: "user", timestamp: at(10), sessionId: "s1", cwd: "/Users/frank/projects/sol", entrypoint: "cli", message: { role: "user", content: [{ type: "tool_result", content: "a file's words" }] } }) +
    j({ type: "assistant", timestamp: at(11), sessionId: "s1", cwd: "/Users/frank/projects/sol", entrypoint: "cli", message: { id: "msg_2", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 } } }) +
    j({ type: "assistant", timestamp: at(12, 29), sessionId: "s1", cwd: "/Users/frank/projects/sol", entrypoint: "cli", message: { model: "claude-opus-5-5", usage: { input_tokens: 999, output_tokens: 999 } } }) +   // today: not yet
    j({ type: "progress", timestamp: at(10), sessionId: "s1" }) + "not json\n");
  // a workflow's subagent, folders deep under the session
  mkdirSync(join(proj, "s1", "subagents", "workflows", "wf_1"), { recursive: true });
  writeFileSync(join(proj, "s1", "subagents", "workflows", "wf_1", "a.jsonl"),
    j({ type: "assistant", timestamp: at(10), sessionId: "s1", cwd: "/Users/frank/projects/sol", entrypoint: "cli", message: { id: "msg_3", model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 200 } } }));
  // Sol's own session, the SDK, another folder with a space in its name
  writeFileSync(join(proj, "s2.jsonl"),
    j({ type: "assistant", timestamp: at(15), sessionId: "s2", cwd: "/Users/frank/mission market", entrypoint: "sdk-ts", message: { model: "claude-fable-5-1", usage: { input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 7, cache_creation_input_tokens: 8 } } }));
  // a Codex session on the 28th
  const cx = join(roots.codex, "2026", "10", "28");
  mkdirSync(cx, { recursive: true });
  writeFileSync(join(cx, "rollout-2026-10-28T10-00-00-abc.jsonl"),
    j({ type: "session_meta", payload: { id: "c1", cwd: "/Users/frank/projects/sol", timestamp: "2026-10-28T10:00:00Z" } }) +
    j({ type: "turn_context", payload: { model: "gpt-5.6-sol", cwd: "/Users/frank/projects/sol" } }) +
    j({ type: "response_item", payload: { type: "message", content: "the words of the answer" } }) +
    j({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 9 } } } }) +
    j({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 200, cached_input_tokens: 120, output_tokens: 19 } } } }));
  writeFileSync(roots.claudeJson, j({ oauthAccount: { emailAddress: "frank@example.com", billingType: "stripe_subscription", organizationType: "claude_max", organizationRateLimitTier: "default_claude_max_20x" }, other: 1 }));
  const claim = Buffer.from(JSON.stringify({ email: "frank@example.com", "https://api.openai.com/auth": { chatgpt_plan_type: "plus", chatgpt_account_id: "acc-secret" } })).toString("base64url");
  writeFileSync(roots.codexAuth, j({ auth_mode: "chatgpt", tokens: { id_token: `eyJhbGciOiJSUzI1NiJ9.${claim}.signature-secret`, access_token: "at-secret", refresh_token: "rt-secret" } }));
  mkdirSync(join(roots.apps[0]!, "ChatGPT.app"), { recursive: true });
  mkdirSync(join(roots.apps[0]!, "Claude.app"), { recursive: true });
  // the files' mtime on the test's clock (a file modified before the first day wanted is not opened)
  for (const f of [join(proj, "s1.jsonl"), join(proj, "s2.jsonl"), join(proj, "s1", "subagents", "workflows", "wf_1", "a.jsonl")]) utimesSync(f, new Date(2026, 9, 29, 12), new Date(2026, 9, 29, 12));
  utimesSync(join(cx, "rollout-2026-10-28T10-00-00-abc.jsonl"), new Date(2026, 9, 28, 11), new Date(2026, 9, 28, 11));   // the Codex file last changed on the 28th
});
const lines = (d = now) => (existsSync(dayFile(d, "files")) ? readFileSync(dayFile(d, "files"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

test("Claude Code's transcripts become one line a (day, model, entrypoint, folder) with the counts, an answer once by its id, and no word of them", async () => {
  const c = await claudeDays(roots.claude, "2026-08-01", "2026-10-28");
  const keys = [...c.keys()].sort();
  assert.equal(keys.length, 2);
  const sol = c.get(keys.find((k) => k.includes("|cli|"))!)!;
  assert.deepEqual({ prompts: sol.prompts, answers: sol.answers, sessions: sol.sessions.size, input: sol.input, output: sol.output, cache_read: sol.cache_read, cache_write: sol.cache_write },
    { prompts: 1, answers: 3, sessions: 1, input: 111, output: 222, cache_read: 303, cache_write: 4 },
    "an answer's second content block is not a second answer; a tool result, a slash command and an interruption are not prompts; the workflow's subagent deep under the session counts; today's answer is not yet counted");
  const mm = keys.find((k) => k.includes("|sdk-ts|"))!;
  assert.match(mm, /^2026-10-28\|claude-fable-5-1\|sdk-ts\|mission-market\|[0-9a-f]{12}$/, "a folder is its last name as a word and a hash, never the path");
});

test("Codex's sessions become one line a (day, model, folder) from each session's growth since the last scan, on the day the file last changed", async () => {
  const counted: Record<string, [number, number]> = {};
  const x = await codexDays(roots.codex, "2026-08-01", "2026-10-28", counted);
  assert.equal(x.size, 1);
  const [key, s] = [...x][0]!;
  assert.match(key, /^2026-10-28\|gpt-5.6-sol\|sol\|[0-9a-f]{12}$/);
  assert.deepEqual({ sessions: s.sessions.size, input: s.input, output: s.output, cache_read: s.cache_read }, { sessions: 1, input: 200, output: 19, cache_read: 120 });
  assert.deepEqual(counted.c1![0], 339);
  // the same file again: nothing new
  assert.equal((await codexDays(roots.codex, "2026-08-01", "2026-10-28", counted)).size, 0);
  // resumed on the 29th: the file grows to 400+40+240 and is touched; only the growth counts, on the 29th
  const f = join(roots.codex, "2026", "10", "28", "rollout-2026-10-28T10-00-00-abc.jsonl");
  writeFileSync(f, readFileSync(f, "utf8") + j({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 400, cached_input_tokens: 240, output_tokens: 40 } } } }));
  utimesSync(f, new Date(2026, 9, 29, 15), new Date(2026, 9, 29, 15));
  const again = await codexDays(roots.codex, "2026-10-29", "2026-10-29", counted);
  const [k2, s2] = [...again][0]!;
  assert.match(k2, /^2026-10-29\|/);
  assert.deepEqual({ input: s2.input, output: s2.output, cache_read: s2.cache_read }, { input: 201, output: 20, cache_read: 120 }, "about half of each, as the total grew by about half (341 of 680)");
});

test("the plan words and the apps: a word each, never an email, a token or an account id", () => {
  assert.deepEqual(planWords(roots.claudeJson, roots.codexAuth), { claude: "claude_max", claude_rate: "default_claude_max_20x", codex_mode: "chatgpt", codex: "plus" });
  assert.deepEqual(planWords("/nowhere/claude.json", "/nowhere/auth.json"), { claude: "none", codex: "none" });
  const apps = appsInstalled(roots.apps);
  assert.equal(apps.chatgpt, true); assert.equal(apps.claude, true); assert.equal(apps.cursor, false);
  assert.equal(Object.keys(apps).length, APPS.length);
});

test("a scan writes the days up to yesterday once, the plan and the apps once a day, and remembers where it stopped", async () => {
  const got = await scanOthers(roots);
  assert.equal(got.claude, 2); assert.equal(got.codex, 1); assert.equal(got.said, true); assert.equal(got.days, 90);
  const raw = readFileSync(dayFile(now, "files"), "utf8");
  assert.doesNotMatch(raw, /sarah|rent|secret|frank@|acc-secret|at-secret|signature|\/Users\//, "no word of any file, no address, no token, no path");
  const names = lines().map((l) => l.name);
  assert.deepEqual(names, ["tester.who", "files.claude.day", "files.claude.day", "files.codex.day", "files.plan", "files.apps"]);
  assert.ok(!existsSync(dayFile(now)), "the day's own file is untouched: the other tools' lines have their own");
  const day = lines().find((l) => l.name === "files.claude.day" && l.props.via === "sdk-ts")!;
  assert.deepEqual(day.props, { day: "2026-10-28", model: "claude-fable-5-1", via: "sdk-ts", folder: "mission-market", dir: day.props.dir, prompts: 0, answers: 1, sessions: 1, input: 5, output: 6, cache_read: 7, cache_write: 8 });
  assert.deepEqual(lines().find((l) => l.name === "files.plan")!.props, { claude: "claude_max", claude_rate: "default_claude_max_20x", codex_mode: "chatgpt", codex: "plus" });
  // the same day again: nothing new
  const again = await scanOthers(roots);
  assert.deepEqual(again, { days: 0, claude: 0, codex: 0, said: false });
  assert.equal(lines().length, 6);
  // the next day: the 29th is counted (the 999 answer), the plan and apps go again
  now = new Date(2026, 9, 30, 9, 0, 0);
  const next = await scanOthers(roots);
  assert.deepEqual(next, { days: 1, claude: 1, codex: 0, said: true });
  assert.equal(lines().find((l) => l.name === "files.claude.day")!.props.input, 999);
  const st = JSON.parse(readFileSync(join(home, "track", "others.json"), "utf8"));
  assert.equal(st.through, "2026-10-29"); assert.equal(st.said, "2026-10-30"); assert.equal(st.codex.c1[0], 339);
});

test("roots that do not exist: nothing counted but the plan and apps words, and nothing thrown; usage off: nothing read at all", async () => {
  const got = await scanOthers({ claude: "/nowhere/a", codex: "/nowhere/b", claudeJson: "/nowhere/c", codexAuth: "/nowhere/d", apps: ["/nowhere/e"], now: () => now });
  assert.deepEqual(got, { days: 90, claude: 0, codex: 0, said: true });
  assert.deepEqual(lines().map((l) => l.name), ["tester.who", "files.plan", "files.apps"]);
  const off = await scanOthers({ ...roots, consent: () => false });
  assert.deepEqual(off, { days: 0, claude: 0, codex: 0, said: false });
});
