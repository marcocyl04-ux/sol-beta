// Felt or silent, pings and dials (#100, docs/how-we-work/PRD.md sections 5, 6 and 8): the test note read from a PR
// body, the flip read from its comments, the dial table, the chat line naming a teammate, the spool. Nothing here
// reaches the network; the spool is a file in a temporary folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { testNote, flipOf, flipBody } = await import("../src/team/mark.ts");
const P = await import("../src/team/pings.ts");
const { cleanTeam } = await import("../src/team/settings.ts");
const { teamNote } = await import("../src/team/note.ts");

test("the test note: a 'What to try:' paragraph and a 'Felt or silent:' line", () => {
  const body = "Part of #100 (step 7 of #83)\n\nThe card shows a word.\n\nWhat to try: open Cowork, the action board, and look at a PR card.\nYou should notice felt or silent beside its number.\n\nFelt or silent: felt (you can see it)\n\n🤖 Generated";
  const n = testNote(body);
  assert.equal(n.whatToTry, "open Cowork, the action board, and look at a PR card.\nYou should notice felt or silent beside its number.");
  assert.equal(n.mark, "felt");
  assert.equal(n.flippedBy, undefined);
});

test("the test note: the PR template's bold heads, its hints left out", () => {
  const body = "**What changed** a word\n\n**What to try** (for the person who will try it: what to do)\nPress the button; a card comes.\n\n**Felt or silent** (felt: a person can notice the change; silent: nobody can)\nsilent\n\n**What I ran** npm test";
  const n = testNote(body);
  assert.equal(n.whatToTry, "Press the button; a card comes.");
  assert.equal(n.mark, "silent");
});

test("the test note: an empty template says nothing", () => {
  const n = testNote("**What to try** (for the person who will try it: ...)\n\n**Felt or silent** (felt: a person can notice; silent: nobody can)\n\n**What I ran**");
  assert.equal(n.whatToTry, "");
  assert.equal(n.mark, "");
  assert.deepEqual(testNote(""), { whatToTry: "", mark: "" });
});

test("a flip: the latest comment whose first word is **felt** or **silent** wins, and says who", () => {
  assert.equal(flipOf("**silent**: nobody can notice it"), "silent");
  assert.equal(flipOf("  **Felt** yes"), "felt");
  assert.equal(flipOf("I think this is **felt**"), "", "only the first word counts");
  const body = "What to try: x\n\nFelt or silent: silent";
  const comments = [
    { author: "frank", body: "**felt**: a person runs it first.\n\n— frank" },
    { author: "isaac", body: "looks fine" },
    { author: "marco", body: "**silent**: nobody can notice it.\n\n— marco's agent" },
  ];
  assert.deepEqual(testNote(body, comments.slice(0, 2)), { whatToTry: "x", mark: "felt", flippedBy: "frank" });
  assert.deepEqual(testNote(body, comments), { whatToTry: "x", mark: "silent", flippedBy: "marco's agent" });
});

test("the flip's comment starts with the word, so the board reads it back", () => {
  const b = flipBody("felt", "marco");
  assert.match(b, /^\*\*felt\*\*: a person runs it/);
  assert.match(b, /— marco$/);
  assert.equal(flipOf(b), "felt");
  assert.equal(testNote("", [{ author: "marco", body: flipBody("silent", "marco") }]).mark, "silent");
});

test("the dial table: kind × dial → a card, or absorbed by the agent (and written only on a 'matters' call)", () => {
  const card = { card: true, absorbed: false, written: false };
  const kept = { card: false, absorbed: true, written: true };
  const never = { card: false, absorbed: true, written: false };
  const want: Record<string, Record<string, object>> = {
    clash: { always: card, matters: kept, never },
    contract: { always: card, matters: kept, never },
    claim: { always: card, matters: kept, never },
    decision: { always: card, matters: card, never },
    chat: { always: card, matters: card, never },
    alert: { always: card, matters: card, never },   // #225: the cloud's on-call, its admins only
  };
  for (const k of P.PING_KINDS) for (const d of P.DIALS) assert.deepEqual(P.route(k, d), want[k][d], `${k} × ${d}`);
});

test("the dials in team.json: 'when it matters' for every kind unless set, anything wrong dropped", () => {
  assert.deepEqual(cleanTeam({}).dials, P.DIAL_DEFAULTS);
  const t = cleanTeam({ dials: { clash: "always", chat: "never", claim: "loud", other: "always" } });
  assert.deepEqual(t.dials, { clash: "always", contract: "matters", claim: "matters", decision: "matters", chat: "never", alert: "matters" });
});

test("a relay ping: its kind from pingKind, chat for an old sender, junk refused", () => {
  const p = P.pingOf({ kind: "ping", pingKind: "claim", from: { login: "frank", agent: true }, line: "  I hold sol/engine/src/team  ", at: 5, issue: 91, repo: "acme/sol" })!;
  assert.equal(p.kind, "claim");
  assert.equal(p.line, "I hold sol/engine/src/team");
  assert.deepEqual([p.issue, p.repo, p.from.agent], [91, "acme/sol", true]);
  assert.equal(P.pingOf({ kind: "ping", from: { login: "frank", agent: false }, line: "audit please", at: 1 })!.kind, "chat");
  assert.equal(P.pingOf({ kind: "ping", pingKind: "loud", from: { login: "frank" }, line: "x" })!.kind, "chat");
  assert.equal(P.pingOf({ kind: "ping", pingKind: "alert", from: { login: "frank" }, line: "the cloud is down" })!.kind, "chat", "an alert never comes from a teammate (#225)");
  assert.equal(P.pingOf({ kind: "ping", from: { login: "" }, line: "x" }), null);
  assert.equal(P.pingOf({ kind: "ping", from: { login: "frank" }, line: "" }), null);
  assert.equal(P.pingOf({ kind: "ping", from: { login: "frank" }, line: "x", repo: "not a repo" })!.repo, undefined);
});

test("chat naming: @login or the login as a word, never me, never part of another word", () => {
  const logins = ["frank", "isaac", "marco", "al-x"];
  assert.deepEqual(P.namedIn("@frank can you look", logins, "marco"), ["frank"]);
  assert.deepEqual(P.namedIn("Frank and isaac, the build is up", logins, "marco"), ["frank", "isaac"]);
  assert.deepEqual(P.namedIn("frankly, marco says no", logins, "marco"), []);
  assert.deepEqual(P.namedIn("ask al-x", logins), ["al-x"]);
  assert.deepEqual(P.namedIn("ask al-xy", logins), []);
});

test("the lines the agent writes: an absorbed call on the issue, a flipped dial on the plan", () => {
  assert.equal(P.absorbedLine("marco", { kind: "claim", line: "frank holds the wire" }), "**absorbed** by marco's agent: claim ping, frank holds the wire");
  assert.deepEqual(P.flipped(P.DIAL_DEFAULTS, { ...P.DIAL_DEFAULTS, clash: "always" }), [{ kind: "clash", was: "matters", now: "always" }]);
  assert.match(P.learnedLine("clash", "matters", "always"), /^dial clash → always bring to me \(was when it matters\): learned that /);
  assert.match(P.learnedLine("chat", "matters", "never"), /learned that you want no chat ping to reach you/);
});

test("the spool: kept once, the last 100, read once by the seat", () => {
  const dir = mkdtempSync(join(tmpdir(), "sol-pings-"));
  try {
    P._pingsAt(join(dir, "pings.json"));
    const mk = (i: number, issue?: number) => ({ id: `p${i}`, kind: "chat" as const, from: { login: "frank", agent: false }, line: `line ${i}`, at: i, ...(issue ? { issue } : {}) });
    P.keepPing(mk(1, 91)); P.keepPing(mk(1, 91)); P.keepPing(mk(2, 17));
    assert.equal(P.readPings().length, 2, "the same id twice is one");
    assert.deepEqual(P.takePings(91).map((p) => p.id), ["p1"]);
    assert.deepEqual(P.takePings(91).map((p) => p.id), [], "seen once");
    assert.match(P.pingsText(P.takePings()), /^chat on #17 from frank: line 2/);
    assert.equal(P.pingsText([]), "no pings since you last looked");
    for (let i = 3; i < 130; i++) P.keepPing(mk(i));
    assert.equal(P.readPings().length, P.SPOOL_CAP);
    assert.equal(P.lastPing("chat")?.id, "p129");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("team_note: a decision pings the issue's other holders; a heads-up the other issue's, of the kind named", async () => {
  const sent: object[] = [];
  const calls: string[][] = [];
  const d = {
    cwd: "/repo", login: async () => "marco", mayGitHub: () => true,
    git: async () => "marco/x-91",
    gh: async (args: string[]) => {
      calls.push(args);
      const a = args.join(" ");
      if (a.startsWith("issue view 91")) return "marco\nfrank\n";
      if (a.startsWith("issue view 17")) return "isaac\n";
      if (a.startsWith("repo view")) return "acme/sol\n";
      return "";
    },
    ping: (p: object) => { sent.push(p); return true; },
  };
  const r = await teamNote(d, { issue: 91, kind: "decision", lines: "the timer rings once" });
  assert.match(r, /pinged frank \(decision\)$/);
  assert.deepEqual(sent[0], { to: "frank", kind: "decision", line: "a decision on #91: the timer rings once", issue: 91, repo: "acme/sol" });
  const h = await teamNote(d, { issue: 91, kind: "heads-up", lines: "the wire changes", to: 17, ping: "contract" });
  assert.match(h, /^posted on #17 as a heads-up from #91; pinged isaac \(contract\)$/);
  assert.deepEqual(sent[1], { to: "isaac", kind: "contract", line: "heads-up from #91: the wire changes", issue: 17, repo: "acme/sol" });
  const down = { ...d, ping: () => false };
  assert.match(await teamNote(down, { issue: 17, kind: "heads-up", lines: "x", to: 91 }), /frank not in sight, no ping$/);
});

test("an audit asked when my setting says never: turned down at once by my agent, otherwise nothing", () => {
  const ask = { kind: "chat" as const, line: "frank asks for an audit", from: { login: "frank", agent: false } };
  assert.equal(P.auditTurnedDown(ask, "never", "marco"), "turned the audit down: audits are off in marco's settings (what leaves this machine)");
  assert.equal(P.auditTurnedDown(ask, "ask", "marco"), null);                                  // may be asked: a card for me
  assert.equal(P.auditTurnedDown({ ...ask, line: "frank: the audit is done" }, "never", "marco"), null);   // another line
  assert.equal(P.auditTurnedDown({ ...ask, kind: "clash" }, "never", "marco"), null);           // another kind
  assert.equal(P.auditTurnedDown({ ...ask, from: { login: "frank", agent: true } }, "never", "marco"), null);   // not from a person
  assert.equal(P.auditTurnedDown(ask, "never", ""), "turned the audit down: audits are off in their settings (what leaves this machine)");
});
