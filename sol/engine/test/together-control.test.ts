// Control (#32): the team settings cleaned and merged, the paragraph every seat's prompt carries for two settings,
// what the engine refuses on its own, and the account readers. PROTOCOL.md round 18.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// a test file of its own, set before the module reads it
const dir = mkdtempSync(join(tmpdir(), "sol-team-"));
process.env.SOL_TEAM_FILE = join(dir, "team.json");
process.env.SOL_TEAM_OFFLINE = "1";   // never `gh api user` from a test
const T = await import("../src/team/settings.ts");
const C = await import("../src/team/control.ts");

test("clean: nothing on disk is the defaults of BUILD.md", () => {
  const s = T.cleanTeam(undefined);
  assert.deepEqual(s.speak, { github: true, cowork: true, discord: "builds", whatsapp: false });
  assert.deepEqual(s.leaves, { prompts: false, memory: false, transcripts: false, audit: "ask" });
  assert.deepEqual(s.seats, { life: "codex", work: "claude" });
  assert.deepEqual(s.repos, ["marcocyl04-ux/sol-dev"]);
  assert.deepEqual(s.machines.map((m) => m.name), ["this Mac"]);   // no relay: no far machine (#169)
  assert.equal(s.me.login, "");
});

test("clean: bad values fall back, unknown keys go, the three never rows cannot be switched on", () => {
  const s = T.cleanTeam({
    speak: { github: "yes", discord: "everywhere", whatsapp: true, extra: 1 },
    leaves: { prompts: true, memory: true, transcripts: true, audit: "never" },
    seats: { life: "claude", work: "gpt" },
    repos: ["ok/repo", "not a repo", "ok/repo"],
    surprise: { a: 1 },
  }) as any;
  assert.equal(s.speak.github, true);            // not a boolean: the default
  assert.equal(s.speak.discord, "builds");       // not one of the three: the default
  assert.equal(s.speak.whatsapp, true);
  assert.equal(s.speak.extra, undefined);
  assert.deepEqual(s.leaves, { prompts: false, memory: false, transcripts: false, audit: "never" });
  assert.deepEqual(s.seats, { life: "claude", work: "claude" });
  assert.deepEqual(s.repos, ["ok/repo"]);
  assert.equal(s.surprise, undefined);
});

test("clean: my machines keep ws addresses only, one row per address, an empty list stays empty", () => {
  assert.deepEqual(T.cleanMachines([]), []);
  const m = T.cleanMachines([
    { name: "home", url: "ws://127.0.0.1:7777" },
    { name: "again", url: "ws://127.0.0.1:7777" },
    { name: "web", url: "https://example.com" },
    { name: "", url: "wss://legion.example.ts.net/" },
    "junk",
  ]);
  assert.deepEqual(m, [{ name: "home", url: "ws://127.0.0.1:7777" }, { name: "legion.example.ts.net", url: "wss://legion.example.ts.net/" }]);
});

test("merge: a patch changes what it names, an array is replaced whole", () => {
  const base = T.cleanTeam({});
  const s = T.cleanTeam(T.mergeTeam(base, { speak: { discord: "never" }, machines: [{ name: "only", url: "ws://10.0.0.2:7777" }] }));
  assert.equal(s.speak.discord, "never");
  assert.equal(s.speak.github, true);   // untouched
  assert.deepEqual(s.machines, [{ name: "only", url: "ws://10.0.0.2:7777" }]);
});

test("patch: written whole to team.json (0600), the login is never the face's to set", async () => {
  // a face's edit comes through the wire (team.settings): its login is dropped there; fillMe's own patch is not
  const W = await import("../src/team/wire.ts");
  const got: any[] = [];
  const face = { send: (m: object) => got.push(m) };
  W.addTeamFace(face);
  await W.handleTeam(face, { type: "team.settings", rid: "r1", patch: { me: { login: "someone-else", name: "Marco" }, speak: { whatsapp: false, cowork: false } } });
  W.removeTeamFace(face);
  const s = T.getTeam();
  assert.equal(s.me.login, "");
  assert.equal(s.me.name, "Marco");
  assert.equal(got.at(-1)?.settings?.me?.name, "Marco");
  const disk = JSON.parse(readFileSync(process.env.SOL_TEAM_FILE!, "utf8"));
  assert.equal(disk.me.name, "Marco");
  assert.equal(disk.speak.cowork, false);
  assert.equal(statSync(process.env.SOL_TEAM_FILE!).mode & 0o777, 0o600);
  assert.equal(T.getTeam().speak.cowork, false);
});

test("patch: only a patch that names Life's helper moves it; a fresh team starts on the person's pick", async () => {
  const S = await import("../src/settings.ts");
  const before = S.getSettings().defaults.seat;
  T.patchTeam({ me: { name: "Marco" }, seats: { work: "claude" } });   // never touches settings.json
  assert.equal(S.getSettings().defaults.seat, before);
  // the team file was made by the first patch above; its Life helper came from settings.defaults.seat, not "codex"
  assert.equal(T.getTeam().seats.life, before);
});

test("the system-prompt paragraph, for two settings", () => {
  const open = T.cleanTeam({ me: { login: "marcocyl04-ux", name: "Marco" } });
  const a = T.speakParagraph(open);
  assert.match(a, /signed "marcocyl04-ux's agent", never as marcocyl04-ux and never unsigned/);
  assert.match(a, /GitHub \(issues, pull requests, comments, reviews\): yes\./);
  assert.match(a, /Cowork\): yes, signed\./);
  assert.match(a, /Discord: only the #builds channel\./);
  assert.match(a, /WhatsApp: never\./);
  assert.match(a, /an audit asks marcocyl04-ux first/);

  const shut = T.cleanTeam({ me: { login: "fktsai", name: "Frank" }, speak: { github: false, cowork: false, discord: "never", whatsapp: true }, leaves: { audit: "never" } });
  const b = T.speakParagraph(shut);
  assert.match(b, /signed "fktsai's agent"/);
  assert.match(b, /GitHub \(issues, pull requests, comments, reviews\): no\./);
  assert.match(b, /Cowork\): no\./);
  assert.match(b, /Discord: never\./);
  assert.match(b, /WhatsApp: yes\./);
  assert.match(b, /audits are refused/);
  assert.notEqual(a, b);
  // no login yet (gh not signed in): it still says how to sign, never as the person
  assert.match(T.speakParagraph(T.cleanTeam({})), /"<their GitHub login>'s agent"/);
});

test("signature: the human, or the human's agent", () => {
  const s = T.cleanTeam({ me: { login: "isaacw", name: "Isaac" } });
  assert.equal(T.signature(s, false), "isaacw");
  assert.equal(T.signature(s, true), "isaacw's agent");
});

test("may my agent speak: Discord's channel counts only for #builds", () => {
  const s = T.cleanTeam({});
  assert.equal(T.mayAgentSpeak(s, "discord", "#builds"), true);
  assert.equal(T.mayAgentSpeak(s, "discord", "general"), false);
  assert.equal(T.mayAgentSpeak(s, "whatsapp"), false);
  assert.equal(T.mayAgentSpeak(T.cleanTeam({ speak: { discord: "any" } }), "discord", "general"), true);
  assert.equal(T.mayAgentSpeak(T.cleanTeam({ speak: { discord: "never" } }), "discord", "builds"), false);
});

test("the engine refuses a shell post where the setting says no, and nothing else", () => {
  const no = T.cleanTeam({ speak: { github: false, discord: "never", whatsapp: false } });
  const yes = T.cleanTeam({ speak: { github: true, discord: "any", whatsapp: true } });
  const bash = (command: string) => ({ command });
  const hook = bash(`curl -X POST -H 'Content-Type: application/json' -d '{"content":"hi"}' https://discord.com/api/webhooks/1/abc`);
  assert.match(T.speakRefusal(no, "Bash", hook)!, /Discord/);
  assert.equal(T.speakRefusal(yes, "Bash", hook), null);
  assert.match(T.speakRefusal(no, "Bash", bash("gh pr create --draft --title x --body y"))!, /GitHub/);
  assert.match(T.speakRefusal(no, "Bash", bash("gh issue comment 32 --body 'done'"))!, /GitHub/);
  assert.match(T.speakRefusal(no, "Bash", bash("gh api repos/a/b/issues/3/comments -f body=hi"))!, /GitHub/);
  assert.match(T.speakRefusal(no, "Bash", bash("gh api -X PATCH repos/a/b/issues/3"))!, /GitHub/);
  assert.match(T.speakRefusal(no, "Bash", bash("curl https://graph.facebook.com/v19.0/123/messages -d x"))!, /WhatsApp/);
  // reading is never speaking
  for (const c of ["gh pr view 12", "gh issue list --label now", "gh api user --jq .login", "gh api graphql -f query='{ viewer { login } }'", "git push -u origin marco/x"]) {
    assert.equal(T.speakRefusal(no, "Bash", bash(c)), null, c);
  }
  assert.equal(T.speakRefusal(no, "Edit", { file_path: "/x", command: "gh pr create" }), null);
});

test("guardSpeak: a refused post never reaches the seat's own check", async () => {
  T.patchTeam({ speak: { github: false } });
  let asked = 0;
  const check = C.guardSpeak(async () => { asked++; return { behavior: "allow", updatedInput: {} }; });
  const o = { signal: new AbortController().signal, suggestions: [] } as any;
  const r = await check("Bash", { command: "gh pr create --fill" }, o);
  assert.equal(r.behavior, "deny");
  assert.equal(asked, 0);
  assert.equal((await check("Bash", { command: "ls" }, o)).behavior, "allow");
  assert.equal(asked, 1);
  T.patchTeam({ speak: { github: true } });
});

test("my accounts: what claude, codex and gh print, read", () => {
  assert.deepEqual(C.readClaude({ code: 0, out: '{\n "loggedIn": true, "authMethod": "claude.ai", "email": "a@b.c", "subscriptionType": "max"\n}' }), { in: true, who: "a@b.c, max" });
  assert.deepEqual(C.readClaude({ code: 1, out: '{ "loggedIn": false }' }), { in: false });
  assert.deepEqual(C.readClaude(null), { in: false, missing: true });
  assert.deepEqual(C.readCodex({ code: 0, out: "Logged in using ChatGPT\n" }), { in: true, who: "ChatGPT" });
  assert.deepEqual(C.readCodex({ code: 1, out: "Not logged in\n" }), { in: false });
  assert.deepEqual(C.readGithub({ code: 0, out: "marcocyl04-ux\n" }), { in: true, who: "marcocyl04-ux" });
  assert.deepEqual(C.readGithub({ code: 1, out: "" }), { in: false });
  assert.equal(C.signinCommand("claude"), "claude auth login");
  assert.equal(C.signinCommand("codex"), "codex login");
  assert.equal(C.signinCommand("rm -rf /"), null);
  assert.equal(C.signinCommand("github"), null);   // GitHub signs in from its card (#174, round 42), not a terminal line
});

test("the wire: GitHub's terminal line is gone (its card instead, round 42); a cancel with nothing waiting is still ok", async () => {
  const W = await import("../src/team/wire.ts");
  const got: any[] = [];
  const face = { send: (m: object) => got.push(m) };
  W.addTeamFace(face);
  await W.handleTeam(face, { type: "team.signin", rid: "s1", seat: "github" });
  await W.handleTeam(face, { type: "team.signin", rid: "s2", seat: "claude" });
  await W.handleTeam(face, { type: "team.github.connect.cancel", rid: "s3" });
  W.removeTeamFace(face);
  assert.deepEqual(got[0], { type: "team.signin", rid: "s1", error: "GitHub signs in from the card (team.github.connect)" });
  assert.deepEqual(got[1], { type: "team.signin", rid: "s2", command: "claude auth login" });
  assert.deepEqual(got[2], { type: "team.github.connect.cancel", rid: "s3", ok: true });
});
