// Hand (#34, design/together/4-hand/PRD.md, PROTOCOL.md round 21): hand an issue, a session or a PR; take, pass or
// later; the hands record. GitHub is a fake `gh` on PATH (a shell script that writes down its arguments and answers
// canned JSON), git is real in temp repos whose origin is a bare temp repo, and the relay is a function that writes
// down the word. Nothing here reaches GitHub or the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  SOL_NO_SHIP_CHECK: "1", SOL_TEAM_OFFLINE: "1", SOL_TEAM_FILE: join(mkdtempSync(join(tmpdir(), "sol-team-")), "team.json"),
  SOL_STATE: join(mkdtempSync(join(tmpdir(), "sol-state-")), "work.json"),
});

// the fake gh: every call is one JSON line in calls.log; `pr view` answers a PR, `api .../issues/comments` the record
// written in comments.json, an `edit` whose args name "nobody" fails like GitHub would
const bin = mkdtempSync(join(tmpdir(), "sol-fake-gh-"));
const LOG = join(bin, "calls.log"), COMMENTS = join(bin, "comments.json");
writeFileSync(join(bin, "gh"), `#!/bin/sh
node -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)) + "\\n")' "${LOG}" "$@"
case "$1 $2" in
  "pr view") echo '{"title":"the hands record","url":"https://github.com/acme/sol/pull/41","headRefName":"frank/34-hand"}' ;;
  "api "*) cat "${COMMENTS}" 2>/dev/null || echo '[]' ;;
  *) for a in "$@"; do [ "$a" = "nobody" ] && { echo "could not assign user: 'nobody' not found" >&2; exit 1; }; done ;;
esac
exit 0
`);
chmodSync(join(bin, "gh"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;
const calls = (): string[][] => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const clear = () => writeFileSync(LOG, "");

const H = await import("../src/team/hand.ts");
const { briefOf, handBody, takenBody, passedBody, parseRecord, pendingFor, handWord, heardWord, hand, answer, readRecord, ghCli, gitCli, WORD_FIELDS, day } = H;
type Hand = import("../src/team/hand.ts").Hand;
type Item = import("../src/work/items.ts").Item;
const { cardOf, keyAction, LABEL, TINT } = await import("../../mac/src/notch/answer.ts");

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const REPO = "acme/sol";
const SECRET = "SECRET-TRANSCRIPT-LINE";

// a session's items: what was said (never travels) and its plan and recap (the brief)
const ITEMS: Item[] = [
  { id: "u1", kind: "me", text: `please fix it, ${SECRET}` },
  { id: "a1", kind: "you", text: `on it, ${SECRET}` },
  { id: "plan", kind: "plan", steps: [{ content: "read the comments", status: "completed" }, { content: "draw the record", status: "in_progress" }, { content: "shots", status: "pending" }] },
  { id: "t1", kind: "tool", name: "Bash", input: { command: `cat ${SECRET}` }, output: SECRET },
  { id: "wrap:1", kind: "wrap", recap: "The record reads from the issue comments.\nThe notch card is not drawn yet." },
];

function fixture() {
  const top = mkdtempSync(join(tmpdir(), "sol-hand-"));
  const origin = join(top, "origin.git");
  git(top, "init", "-q", "--bare", "-b", "main", origin);
  const mine = join(top, "marco");
  mkdirSync(mine);
  git(mine, "init", "-q", "-b", "main");
  writeFileSync(join(mine, "a.txt"), "a\n");
  git(mine, "add", "-A"); git(mine, "commit", "-qm", "start");
  git(mine, "remote", "add", "origin", origin);
  git(mine, "push", "-q", "-u", "origin", "main");
  git(mine, "checkout", "-q", "-b", "marco/34-hand");
  writeFileSync(join(mine, "b.txt"), "b\n");
  git(mine, "add", "-A"); git(mine, "commit", "-qm", "hand work");
  const theirs = join(top, "frank");
  git(top, "clone", "-q", origin, theirs);
  return { top, origin, mine, theirs };
}

function deps(over: Partial<Hand> = {}) {
  const sent: Record<string, unknown>[] = [], started: any[] = [];
  const d: Hand = {
    gh: ghCli,
    git: gitCli,
    send: (w) => { sent.push(w as Record<string, unknown>); return true; },
    me: async () => "marco",
    now: () => new Date(2026, 9, 20, 22, 14),
    session: async () => null,
    folders: async () => ({}),
    repos: () => [REPO],
    cards: async () => [{ repo: REPO, number: 34, title: "the hands record" }],
    start: async (a) => { started.push(a); return "11111111-2222-3333-4444-555555555555"; },
    ...over,
  };
  return { d, sent, started };
}

test("the brief: the title, the last plan and the last recap; nothing said in the session; at most 60 lines", () => {
  const b = briefOf("#34 the hands record", ITEMS);
  assert.equal(b, [
    "#34 the hands record", "", "the plan:", "- [x] read the comments", "- [~] draw the record", "- [ ] shots",
    "", "where it stands:", "The record reads from the issue comments.", "The notch card is not drawn yet.",
  ].join("\n"));
  assert.ok(!b.includes(SECRET));
  const long: Item[] = [{ id: "plan", kind: "plan", steps: Array.from({ length: 90 }, (_, i) => ({ content: `step ${i}`, status: "pending" })) }];
  const lines = briefOf("big", long).split("\n");
  assert.equal(lines.length, 60);
  assert.match(lines[59], /^… \d+ more lines on the session$/);
  assert.equal(briefOf("", []), "untitled session");
});

test("the record: hand, taken and passed comments read back, newest first, with who to whom", () => {
  const c = (n: number, at: string, author: string, body: string) => ({ repo: REPO, number: n, at, author, body, url: `https://github.com/${REPO}/issues/${n}#c-${at}` });
  const rows = parseRecord([
    c(34, "2026-10-20T10:00:00Z", "marco", handBody({ from: "marco", to: "frank", date: "2026-10-20", brief: "the record under the board", branch: "marco/34-hand", session: "#34 the hands record" })),
    c(34, "2026-10-20T11:00:00Z", "frank", takenBody("frank", "2026-10-20")),
    c(29, "2026-10-20T12:00:00Z", "frank", handBody({ from: "frank", to: "marco", date: "2026-10-20", brief: "review asked", branch: "frank/29-x" })),
    c(31, "2026-10-20T09:00:00Z", "isaac", handBody({ from: "isaac", to: "frank", date: "2026-10-20", brief: "the board" })),
    c(31, "2026-10-20T13:00:00Z", "frank", passedBody("frank", "2026-10-20", "not this week, my exams")),
    c(31, "2026-10-20T13:30:00Z", "isaac", "just a comment, not a hand"),
  ]);
  assert.deepEqual(rows.map((r) => [r.number, r.how, r.from, r.to, r.line ?? ""]), [
    [31, "passed", "frank", "isaac", "not this week, my exams"],
    [29, "review", "frank", "marco", ""],
    [34, "taken", "marco", "frank", ""],
    [34, "hand", "marco", "frank", ""],
    [31, "hand", "isaac", "frank", ""],
  ]);
  assert.equal(rows[3].brief, "the record under the board");
  assert.equal(rows[3].branch, "marco/34-hand");
  assert.deepEqual(rows[0].sign, { login: "frank", agent: false });
  // what is handed to whom now: #31 passed back to isaac; #34 taken (nobody's to take); a review is not a take
  assert.deepEqual(pendingFor("isaac", rows).map((h) => [h.id, h.from, h.brief]), [[`${REPO}#31`, "frank", "not this week, my exams"]]);
  assert.deepEqual(pendingFor("frank", rows), []);
  assert.deepEqual(pendingFor("marco", rows), []);
});

test("hand an issue: the assignee, then the signed comment, then the word on the relay; the word has only its fields", async () => {
  clear();
  const { d, sent } = deps();
  const r = await hand(d, { repo: REPO, issue: 34, to: "frank", brief: "the record under the board, please" });
  assert.deepEqual(r, { ok: true, issue: 34, recorded: "#34", relayed: true });
  const g = calls();
  assert.deepEqual(g[0], ["issue", "edit", "34", "-R", REPO, "--add-assignee", "frank"]);
  assert.deepEqual(g[1].slice(0, 5), ["issue", "comment", "34", "-R", REPO]);
  assert.equal(g[1][6], "**hand** from marco to frank · 2026-10-20\n\nthe record under the board, please");
  assert.equal(g.length, 2);
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), ["branch", "brief", "by", "issue", "repo", "to"]);
  assert.deepEqual(sent[0], { issue: 34, repo: REPO, to: "frank", brief: "the record under the board, please", branch: "", by: "marco" });
  for (const k of Object.keys(sent[0])) assert.ok((WORD_FIELDS as readonly string[]).includes(k));
  // no line from the face: the card's title is the brief
  clear();
  await hand(d, { repo: REPO, issue: 34, to: "frank" });
  assert.match(calls()[1][6], /\n\nthe hands record$/);
});

test("a relay that is down still leaves the record; a refused assignee writes nothing more and sends nothing", async () => {
  clear();
  const down = deps({ send: () => false });
  const r = await hand(down.d, { repo: REPO, issue: 34, to: "frank", brief: "x" });
  assert.equal((r as any).ok, true);
  assert.equal((r as any).relayed, false);
  assert.match(String((r as any).note), /written on #34; frank sees it/);
  assert.deepEqual(calls().map((c) => c[1]), ["edit", "comment"]);

  clear();
  const { d, sent } = deps();
  const no = await hand(d, { repo: REPO, issue: 34, to: "nobody" });
  assert.match(String((no as any).error), /GitHub did not take the assignee: could not assign user/);
  assert.equal(calls().length, 1);
  assert.equal(sent.length, 0);

  // refused before GitHub: not a team repo, not a login, myself
  clear();
  assert.match(String((await hand(d, { repo: "evil/repo", issue: 1, to: "frank" }) as any).error), /not one of the team's/);
  assert.match(String((await hand(d, { repo: REPO, issue: 1, to: "fr ank;rm" }) as any).error), /hand to whom/);
  assert.match(String((await hand(d, { repo: REPO, issue: 1, to: "Marco" }) as any).error), /that is you/);
  assert.equal(calls().length, 0);
});

test("hand a session: Sol writes the brief from its items, pushes its branch, and no transcript line travels", async () => {
  const f = fixture();
  clear();
  const { d, sent } = deps({
    session: async (id) => (id === "s-1" ? { title: "#34 the hands record", items: ITEMS, cwd: f.mine, branch: "marco/34-hand" } : null),
  });
  assert.equal(git(f.mine, "ls-remote", "--heads", "origin", "marco/34-hand"), "");
  const r = await hand(d, { repo: REPO, sessionId: "s-1", to: "frank" });
  assert.equal((r as any).ok, true);
  assert.match(git(f.mine, "ls-remote", "--heads", "origin", "marco/34-hand"), /refs\/heads\/marco\/34-hand/);
  const g = calls();
  assert.deepEqual(g[0], ["issue", "edit", "34", "-R", REPO, "--add-assignee", "frank"]);
  const body = g[1][6];
  assert.ok(body.startsWith("**hand** from marco to frank · 2026-10-20\n\n#34 the hands record\n\nthe plan:"));
  assert.ok(body.endsWith("\n\nbranch: `marco/34-hand` · session: #34 the hands record (the brief travels, the transcript never)"));
  for (const x of [body, JSON.stringify(sent)]) { assert.ok(!x.includes(SECRET)); assert.ok(!x.includes(f.mine)); assert.ok(!x.includes("s-1")); }
  assert.deepEqual(Object.keys(sent[0]).sort(), ["branch", "brief", "by", "issue", "repo", "to"]);
  assert.equal(sent[0].branch, "marco/34-hand");
  // the record reads back the hand with its branch
  const row = parseRecord([{ repo: REPO, number: 34, at: "2026-10-20T10:00:00Z", author: "marco", body }])[0];
  assert.equal(row.branch, "marco/34-hand");
  assert.ok(String(row.brief).includes("where it stands:"));
  // a session that names no issue is not handed
  const none = deps({ session: async () => ({ title: "tidy up", items: [], cwd: f.mine }) });
  assert.match(String((await hand(none.d, { repo: REPO, sessionId: "s-2", to: "frank" }) as any).error), /names no issue/);
});

test("take: the taken line, the branch fetched, a cowork session with the brief; pass: the line, reassigned, told back", async () => {
  const f = fixture();
  git(f.mine, "push", "-q", "origin", "marco/34-hand");
  clear();
  const { d, sent, started } = deps({ me: async () => "frank", folders: async () => ({ [REPO]: f.theirs }) });
  const h = { id: `${REPO}#34`, from: "marco", repo: REPO, issue: 34, title: "the hands record", brief: "the record under the board", branch: "marco/34-hand", at: "2026-10-20T10:00:00Z" };
  const r = await answer(d, h, "take");
  assert.deepEqual(r, { ok: true, sessionId: "11111111-2222-3333-4444-555555555555" });
  assert.deepEqual(calls(), [["issue", "comment", "34", "-R", REPO, "--body", "**taken** by frank · 2026-10-20"]]);
  assert.equal(git(f.theirs, "rev-parse", "origin/marco/34-hand"), git(f.mine, "rev-parse", "marco/34-hand"));
  assert.equal(started.length, 1);
  assert.equal(started[0].cwd, f.theirs);
  assert.equal(started[0].text, "#34 the hands record, handed to me by marco.\n\nthe record under the board\n\nbranch: `marco/34-hand` (fetched: origin/marco/34-hand)");
  assert.equal(sent.length, 0);

  // a branch that is not there: the take stands, with a note
  clear();
  const gone = await answer(d, { ...h, branch: "marco/not-pushed" }, "take");
  assert.equal((gone as any).ok, true);
  assert.match(String((gone as any).note), /taken; the branch marco\/not-pushed was not fetched/);
  // no folder for the repo: nothing written
  clear();
  const nowhere = deps({ me: async () => "frank" });
  assert.match(String((await answer(nowhere.d, h, "take") as any).error), /no folder on this machine holds acme\/sol/);
  assert.equal(calls().length, 0);

  // pass: one line asked, the passed line, the issue back to the sender, the word back to them
  clear();
  assert.match(String((await answer(d, h, "pass", "  ") as any).error), /say why/);
  const p = await answer(d, h, "pass", "not this week, my exams");
  assert.deepEqual(p, { ok: true });
  assert.deepEqual(calls(), [
    ["issue", "comment", "34", "-R", REPO, "--body", "**passed** by frank · 2026-10-20: not this week, my exams"],
    ["issue", "edit", "34", "-R", REPO, "--remove-assignee", "frank", "--add-assignee", "marco"],
  ]);
  assert.deepEqual(sent.at(-1), { issue: 34, repo: REPO, to: "marco", brief: "not this week, my exams", branch: "marco/34-hand", by: "frank" });

  // later writes nothing
  clear();
  assert.deepEqual(await answer(d, h, "later"), { ok: true });
  assert.equal(calls().length, 0);
});

test("ask for a review: the reviewer added on the PR, a signed comment, the word with review; a PR handed is its title", async () => {
  clear();
  const { d, sent } = deps();
  const r = await hand(d, { repo: REPO, pr: 41, to: "frank", review: true });
  assert.equal((r as any).ok, true);
  const g = calls();
  assert.deepEqual(g[0], ["pr", "view", "41", "-R", REPO, "--json", "title,url,headRefName"]);
  assert.deepEqual(g[1], ["pr", "edit", "41", "-R", REPO, "--add-reviewer", "frank"]);
  assert.equal(g[2][6], "**hand** from marco to frank · 2026-10-20\n\nreview asked\n\nbranch: `frank/34-hand`");
  assert.deepEqual(sent[0], { issue: 41, repo: REPO, to: "frank", brief: "review asked", branch: "frank/34-hand", by: "marco", review: true });
  assert.equal(parseRecord([{ repo: REPO, number: 41, at: "x", author: "marco", body: g[2][6] }])[0].how, "review");

  clear();
  await hand(d, { repo: REPO, pr: 41, to: "frank" });
  const h = calls();
  assert.deepEqual(h[1], ["pr", "edit", "41", "-R", REPO, "--add-assignee", "frank"]);
  assert.match(h[2][6], /\n\nthe hands record\nhttps:\/\/github\.com\/acme\/sol\/pull\/41\n\nbranch: `frank\/34-hand`$/);
});

test("a word heard is kept only when it is to me, from a login, on a team repo; the record reads from the comments", async () => {
  const from = { login: "marco", agent: false };
  const m = { kind: "hand", from, at: 1, issue: 34, repo: REPO, to: "frank", brief: "b", branch: "marco/34-hand", by: "marco" };
  assert.deepEqual(heardWord(m, "frank", [REPO]), { issue: 34, repo: REPO, to: "frank", brief: "b", branch: "marco/34-hand", by: "marco", from: "marco" });
  assert.equal(heardWord(m, "isaac", [REPO]), null);
  assert.equal(heardWord({ ...m, repo: "evil/repo" }, "frank", [REPO]), null);
  assert.equal(heardWord({ ...m, issue: 0 }, "frank", [REPO]), null);
  assert.equal(heardWord({ ...m, branch: "--upload-pack=x" }, "frank", [REPO])?.branch, "");
  assert.equal(heardWord({ ...m, review: true }, "frank", [REPO])?.review, true);
  assert.deepEqual(Object.keys(handWord({ ...m, cwd: "/Users/x", sessionId: "s", items: [] } as any)).sort(), ["branch", "brief", "by", "issue", "repo", "to"]);

  writeFileSync(COMMENTS, JSON.stringify([
    { issue_url: `https://api.github.com/repos/${REPO}/issues/34`, created_at: "2026-10-20T11:00:00Z", user: { login: "frank" }, body: "**taken** by frank · 2026-10-20", html_url: "u2" },
    { issue_url: `https://api.github.com/repos/${REPO}/issues/34`, created_at: "2026-10-20T10:00:00Z", user: { login: "marco" }, body: "**hand** from marco to frank · 2026-10-20\n\nb", html_url: "u1" },
    { issue_url: `https://api.github.com/repos/${REPO}/issues/34`, created_at: "2026-10-20T10:30:00Z", user: { login: "isaac" }, body: "looks good", html_url: "u3" },
  ]));
  clear();
  const c = await readRecord(ghCli, REPO);
  assert.deepEqual(calls(), [["api", `repos/${REPO}/issues/comments?sort=created&direction=desc&per_page=100`]]);
  assert.deepEqual(c.map((x) => x.url), ["u2", "u1"]);
  assert.deepEqual(parseRecord(c).map((r) => r.how), ["taken", "hand"]);
  assert.equal(day(new Date(2026, 0, 5)), "2026-01-05");
});

test("the notch: a hand is Take · Pass · Later, a review Open · Later; Return does nothing, Escape only closes", () => {
  const none = { crew: false, ping: null, unplugged: false, starting: false, ask: null, call: false, turn: null };
  const hd = { id: `${REPO}#34`, from: "frank", issue: 34, title: "the hands record" };
  const card = cardOf({ ...none, hand: hd, stable: { sha: "a".repeat(40), tag: "stable-x", by: "isaac" } });
  assert.equal(card.kind, "handed");
  assert.deepEqual(card.buttons, ["take", "pass", "later"]);
  assert.equal(card.line, "frank hands you #34", "the title is left out when it does not fit beside three buttons");
  assert.equal(cardOf({ ...none, hand: { ...hd, title: "notch" } }).line, "frank hands you #34 · notch");
  assert.equal(keyAction(card, "Return"), null);
  assert.equal(keyAction(card, "Escape"), "close", "Escape only closes (polish two); Later stays a button");
  assert.equal(LABEL.take, "Take");
  assert.equal(TINT.take, "green");
  const rv = cardOf({ ...none, hand: { ...hd, issue: 29, review: true } });
  assert.deepEqual(rv.buttons, ["open", "later"]);
  assert.equal(rv.line, "frank asks you to review #29");
  assert.equal(cardOf({ ...none, hand: { ...hd, taking: true, said: "taking #34…" } }).buttons.length, 0);
  // a running turn still comes first; a stable card alone is unchanged, and its Escape still closes
  assert.equal(cardOf({ ...none, hand: hd, turn: { seat: "claude", sessionId: "s", title: "x", kind: "work" } }).kind, "turn");
  const st = cardOf({ ...none, stable: { sha: "a".repeat(40), tag: "stable-x", by: "isaac" } });
  assert.equal(st.kind, "stable");
  assert.equal(keyAction(st, "Escape"), "close");
});

test("the engine's side: a word to me tells every face, stays pending until answered, and the record wins after", async () => {
  writeFileSync(COMMENTS, JSON.stringify([
    { issue_url: `https://api.github.com/repos/${REPO}/issues/34`, created_at: "2026-10-20T10:00:00Z", user: { login: "marco" }, body: "**hand** from marco to frank · 2026-10-20\n\nthe record under the board\n\nbranch: `marco/34-hand`", html_url: "u1" },
  ]));
  const told: any[] = [];
  const { d, started } = deps({ me: async () => "frank", folders: async () => ({ [REPO]: mkdtempSync(join(tmpdir(), "sol-hand-folder-")) }) });
  H.startHand(d, (m) => told.push(m));
  H.heard({ kind: "hand", from: { login: "isaac", agent: false }, at: "2099-01-01T00:00:00Z", issue: 31, repo: REPO, to: "frank", brief: "the board", branch: "", by: "isaac" });
  H.heard({ kind: "hand", from: { login: "isaac", agent: false }, at: 1, issue: 32, repo: REPO, to: "marco", brief: "not mine", branch: "", by: "isaac" });
  await new Promise((r) => setTimeout(r, 400));
  const handed = told.filter((m) => m.type === "team.handed");
  assert.deepEqual(handed, [{ type: "team.handed", id: `${REPO}#31`, from: "isaac", repo: REPO, issue: 31, title: "", brief: "the board", branch: "" }]);
  const now = await H.handsNow(true);
  assert.deepEqual(now.pending.map((p) => p.id).sort(), [`${REPO}#31`, `${REPO}#34`]);
  assert.equal(now.pending.find((p) => p.issue === 34)?.title, "the hands record");
  assert.equal(now.hands.length, 1);
  clear();
  const t = await H.answerNow(`${REPO}#31`, "take");
  assert.equal((t as any).ok, true);
  assert.equal(started.at(-1).issue, 31);
  assert.deepEqual(calls().filter((c) => c[0] !== "api")[0], ["issue", "comment", "31", "-R", REPO, "--body", "**taken** by frank · 2026-10-20"]);
  assert.ok(calls().some((c) => c[0] === "api"), "the record is read again right before the answer is written");
  assert.match(String((await H.answerNow(`${REPO}#99`, "take") as any).error), /not yours now/);
  assert.deepEqual(await H.answerNow(`${REPO}#99`, "later"), { ok: true });
  assert.ok(!(await H.handsNow()).pending.some((p) => p.issue === 31));
});

test("Codex review: a session that does not start after the take is said, not thrown, and nothing more is written", async () => {
  clear();
  const folder = mkdtempSync(join(tmpdir(), "sol-hand-folder-"));
  const { d, sent } = deps({ me: async () => "frank", folders: async () => ({ [REPO]: folder }), start: async () => { throw new Error("no Claude here\nstack"); } });
  const h = { id: `${REPO}#34`, from: "marco", repo: REPO, issue: 34, title: "the hands record", brief: "the record", branch: "", at: "2026-10-20T10:00:00Z" };
  const r = await answer(d, h, "take");
  assert.equal((r as any).ok, undefined);
  assert.equal((r as any).taken, true);
  assert.equal((r as any).error, "taken on #34, but the session did not start: no Claude here; open #34 in Work by hand");
  assert.deepEqual(calls().filter((c) => c[0] !== "api"), [["issue", "comment", "34", "-R", REPO, "--body", "**taken** by frank · 2026-10-20"]], "one taken line, no second comment");
  assert.equal(sent.length, 0);
  // through the engine's side: answered with the error (the wire adds its rid), and the hand is not offered again
  writeFileSync(COMMENTS, JSON.stringify([
    { issue_url: `https://api.github.com/repos/${REPO}/issues/34`, created_at: "2026-10-20T10:00:00Z", user: { login: "marco" }, body: "**hand** from marco to frank · 2026-10-20\n\nthe record", html_url: "u1" },
  ]));
  H.startHand(d, () => {});
  clear();
  const live = await H.answerNow(`${REPO}#34`, "take");
  assert.match(String((live as any).error), /taken on #34, but the session did not start/);
  assert.equal(calls().filter((c) => c[0] === "issue").length, 1);
  assert.ok(!(await H.handsNow()).pending.some((p) => p.issue === 34), "taken on the issue: no longer pending here");
});

test("Codex review: two answers to one hand at once: one is written, the other is refused; answered, it is not offered again", async () => {
  writeFileSync(COMMENTS, JSON.stringify([
    { issue_url: `https://api.github.com/repos/${REPO}/issues/34`, created_at: "2026-10-20T10:00:00Z", user: { login: "marco" }, body: "**hand** from marco to frank · 2026-10-20\n\nthe record", html_url: "u1" },
  ]));
  const folder = mkdtempSync(join(tmpdir(), "sol-hand-folder-"));
  const { d, started, sent } = deps({ me: async () => "frank", folders: async () => ({ [REPO]: folder }) });
  H.startHand(d, () => {});
  clear();
  const [a, b, c] = await Promise.all([H.answerNow(`${REPO}#34`, "take"), H.answerNow(`${REPO}#34`, "take"), H.answerNow(`${REPO}#34`, "pass", "not mine")]);
  assert.equal((a as any).ok, true);
  assert.deepEqual(b, { error: "already being answered" });
  assert.deepEqual(c, { error: "already being answered" });
  const comments = calls().filter((x) => x[0] === "issue" && x[1] === "comment");
  assert.deepEqual(comments, [["issue", "comment", "34", "-R", REPO, "--body", "**taken** by frank · 2026-10-20"]]);
  assert.equal(started.length, 1);
  assert.equal(sent.length, 0);
  // after: the record (not yet showing the take) is checked again with what was answered here; nothing more is written
  clear();
  assert.match(String((await H.answerNow(`${REPO}#34`, "pass", "not mine") as any).error), /not yours now/);
  assert.match(String((await H.answerNow(`${REPO}#34`, "take") as any).error), /not yours now/);
  assert.equal(calls().filter((x) => x[0] === "issue").length, 0);
  assert.ok(!(await H.handsNow()).pending.some((p) => p.issue === 34));
  // a newer hand on the same issue is offered again
  writeFileSync(COMMENTS, JSON.stringify([
    { issue_url: `https://api.github.com/repos/${REPO}/issues/34`, created_at: "2026-10-21T09:00:00Z", user: { login: "isaac" }, body: "**hand** from isaac to frank · 2026-10-21\n\nagain", html_url: "u2" },
  ]));
  assert.ok((await H.handsNow(true)).pending.some((p) => p.issue === 34));
});
