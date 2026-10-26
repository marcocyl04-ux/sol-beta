// What happened in the room, and for you (#232; the studio PRD §9.3, §9.4): feedOf is pure (newest first, once each,
// agent lines marked, durable vs live), one refresh asks the record at most four times and nothing within the minute,
// the cursor pages, a cloud room reads its things and goal only, and for you lists hands then pings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SOL_STATE = join(mkdtempSync(join(tmpdir(), "sol-state-")), "work.json");
const { feedOf, pageOf, noteLine, rosterLines, forYouOf, feedText, Feed, agentWrote, HISTORY } = await import("../src/team/feed.ts");

const card = (n: number, at: string, rest: object = {}) => ({ repo: "o/r", number: n, title: `card ${n}`, state: "open", labels: [], assignees: [], author: "marco", created: at, url: `https://github.com/o/r/issues/${n}`, column: "waiting", ...rest }) as any;
const pr = (n: number, rest: object) => ({ repo: "o/r", number: n, title: `pr ${n}`, body: "", draft: false, state: "open", head: "x", base: "main", author: "frank", agent: false, url: `https://github.com/o/r/pull/${n}`, ...rest }) as any;
const note = (n: number, at: string, body: string, author = "frank") => ({ repo: "o/r", number: n, at, author, body, url: `https://github.com/o/r/issues/${n}#c${at}` });
const things = { v: 1 as const, things: [{ id: "a1b2c3d4", name: "the PRD", url: "https://docs.google.com/document/d/x", kind: "doc" as const, addedBy: "frank", at: "2026-10-26T09:00:00Z", agent: true as const }] };

test("feedOf: the record's lines newest first, each once, the agent's marked, a plain comment left out", () => {
  const board = {
    cards: [card(1, "2026-10-25T10:00:00Z"), card(2, "2026-10-20T10:00:00Z", { state: "closed", closed: "2026-10-26T08:00:00Z", column: "closed" })],
    prs: [pr(5, { draft: true, updated: "2026-10-26T07:00:00Z", agent: true }), pr(6, { state: "merged", mergedAt: "2026-10-26T06:00:00Z" }), pr(7, { updated: "2026-10-26T05:00:00Z" })],
  };
  const notes = [
    note(1, "2026-10-26T10:00:00Z", "**hand** from frank to marco · 2026-10-26\n\nbrief\n\n— frank's agent"),
    note(1, "2026-10-26T11:00:00Z", "**taken** by marco · 2026-10-26", "marco"),
    note(9, "2026-10-26T03:00:00Z", "**Night digest**, 2026-10-26 (since …)\n\n— marco's agent", "marco"),
    note(3, "2026-10-26T04:00:00Z", "**Clash predicted** between #3 (frank) and main on: a.ts.\n\n— marco's agent", "marco"),
    note(1, "2026-10-26T12:00:00Z", "just a comment"),
    note(1, "2026-10-26T10:00:00Z", "**hand** from frank to marco · 2026-10-26\n\nbrief\n\n— frank's agent"),   // the same note twice
  ];
  const lines = feedOf({ board, notes, things, goal: { title: "find where a first-timer gives up", setBy: "frank's agent", at: "2026-10-26T02:00:00Z" } });
  assert.deepEqual(lines.map((l) => l.kind), ["took", "handed", "thing-added", "closed", "pr-opened", "landed", "pr-ready", "clash", "digest", "goal-set", "opened", "opened"]);
  const by = (k: string) => lines.find((l) => l.kind === k)!;
  assert.equal(by("handed").agent, true);           // signed as an agent
  assert.equal(by("took").agent, false);
  assert.equal(by("pr-opened").agent, true);        // the board's own Co-Authored-By mark
  assert.equal(by("thing-added").agent, true);
  assert.deepEqual([by("goal-set").who, by("goal-set").agent], ["frank", true]);
  assert.equal(by("landed").text, "#6 pr 6 landed on main");
  assert.ok(lines.every((l) => !l.ephemeral));       // durable: from the record
  assert.equal(noteLine(note(1, "2026-10-26T12:00:00Z", "just a comment")), null);
  assert.ok(agentWrote("dependabot[bot]"));
  assert.ok(agentWrote("frank", "done\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>"));
  assert.ok(!agentWrote("frank", "the agent's idea"));
  assert.ok(!agentWrote("frank", "I asked marco's agent\nthen I did it myself"));   // only the signature line says so
});

test("feedOf: at most 200 lines; pageOf pages with a cursor", () => {
  const many = Array.from({ length: 260 }, (_, i) => ({ id: `live:${i}`, at: new Date(Date.UTC(2026, 9, 26, 0, 0, i)).toISOString(), who: "frank", agent: false, kind: "said" as const, text: `${i}`, ephemeral: true as const }));
  const all = feedOf({ live: many });
  assert.equal(all.length, HISTORY);
  assert.equal(all[0].text, "259");
  const p1 = pageOf(all, undefined, 50);
  assert.equal(p1.lines.length, 50);
  assert.equal(p1.cursor, `${p1.lines[49].at}|${p1.lines[49].id}`);
  const p2 = pageOf(all, p1.cursor, 500);
  assert.equal(p2.lines[0].text, "209");
  assert.equal(p2.lines.length, 150);
  assert.equal(p2.cursor, undefined);
  assert.equal(pageOf(all, "not a date").lines.length, 50);
  // lines of one second: the cursor carries the id, so none is skipped at a page's edge
  const tied = feedOf({ live: Array.from({ length: 5 }, (_, i) => ({ id: `live:${i}`, at: "2026-10-26T12:00:00.000Z", who: "m", agent: false, kind: "said" as const, text: `${i}`, ephemeral: true as const })) });
  const q1 = pageOf(tied, undefined, 2), q2 = pageOf(tied, q1.cursor, 2), q3 = pageOf(tied, q2.cursor, 2);
  assert.deepEqual([...q1.lines, ...q2.lines, ...q3.lines].map((l) => l.text), ["0", "1", "2", "3", "4"]);
});

test("one refresh asks the record three times (the board is only peeked), nothing within the minute; a failed read keeps the lines it had", async () => {
  let calls = 0, now = 1_000_000, thingsFail = false, boardError = "";
  const f = new Feed({
    board: async () => ({ repos: ["o/r", "o/s", "o/t"], cards: [card(1, "2026-10-25T10:00:00Z")], prs: [], at: now, ...(boardError ? { error: boardError } : {}) }),   // peekBoard: no call
    notesRepo: () => "o/r",
    recent: async () => { calls++; return [note(1, "2026-10-26T10:00:00Z", "**taken** by marco · 2026-10-26", "marco")]; },
    things: async () => { calls++; if (thingsFail) throw new Error("gh down"); return things; },   // the file, on the branch read once
    goal: async () => { calls++; return { title: "g", setBy: "frank", at: "2026-10-26T01:00:00Z" }; },   // the file, on the same branch
    now: () => now,
  });
  const a = await f.lines("room");
  assert.equal(calls, 3);
  assert.equal(a.lines.length, 4);
  assert.equal(a.error, undefined);
  now += 59_000;
  await f.lines("room");
  assert.equal(calls, 3);                            // within the minute: the cached read
  now += 2_000; thingsFail = true;
  const c = await f.lines("room");
  assert.equal(c.error, "couldn't read");
  assert.equal(c.lines.length, 4);                   // the lines read before stay
  now += 61_000; thingsFail = false; boardError = "could not read o/r";
  assert.equal((await f.lines("room")).error, "couldn't read");   // the board's own failure is said too
  // live lines join the record's, marked ephemeral, once by their id
  f.live.add({ at: "2026-10-26T23:00:00Z", who: "marco", agent: false, kind: "said", text: "said: hi\u202E" }, "talk:1");
  assert.equal(f.live.add({ at: "2026-10-26T23:00:00Z", who: "marco", agent: false, kind: "said", text: "said: hi" }, "talk:1"), null);
  const d = await f.lines("room");
  assert.equal(d.lines[0].kind, "said");
  assert.equal(d.lines[0].text, "said: hi");
  assert.equal(d.lines[0].ephemeral, true);
});

test("a room switch while a read is out never answers with the room before's lines", async () => {
  let room = "a", release: () => void = () => {};
  const gate = new Promise<void>((ok) => { release = ok; });
  const f = new Feed({
    board: async () => { const r = room; if (r === "a") await gate; return r === "a" ? { repos: ["o/r"], cards: [card(1, "2026-10-25T10:00:00Z")], prs: [] } : null; },
    notesRepo: () => "", recent: async () => [], things: async () => null, goal: async () => null,
  });
  const first = f.lines("a");
  room = "b";
  const second = f.lines("b");
  release();
  assert.equal((await first).lines.length, 1);
  assert.equal((await second).lines.length, 0);
});

test("a board nobody read yet: the room's notes are still read (from its record), and an old board is said as old", async () => {
  let boardAt = 0;
  const f = new Feed({ board: async () => (boardAt ? { repos: ["o/r"], cards: [], prs: [], at: boardAt } : null), notesRepo: () => "o/r",
    recent: async () => [note(1, "2026-10-26T10:00:00Z", "**taken** by marco · 2026-10-26", "marco")], things: async () => null, goal: async () => null, now: () => 10_000_000 });
  assert.deepEqual((await f.lines("r")).lines.map((l) => l.kind), ["took"]);
  boardAt = 10_000_000 - 5 * 60_000;
  assert.equal((await f.lines("r", true)).readAt, boardAt);
});

test("a cloud room: no board, no notes; its things and goal are its lines", async () => {
  let recent = 0;
  const f = new Feed({ board: async () => null, notesRepo: () => "", recent: async () => { recent++; return []; }, things: async () => things, goal: async () => ({ title: "g", setBy: "frank", at: "2026-10-26T01:00:00Z" }) });
  const r = await f.lines("cloud room");
  assert.equal(recent, 0);
  assert.deepEqual(r.lines.map((l) => l.kind), ["thing-added", "goal-set"]);
});

test("rosterLines: a session someone started, a thing someone went into; never mine; once", () => {
  const before = [{ who: "marco", sessions: [{ id: "s1", title: "old" }] }];
  const after = [
    { who: "marco", sessions: [{ id: "s1", title: "old" }, { id: "s2", title: "the deck" }], thing: { id: "a1b2c3d4", name: "the PRD", source: "agent" } },
    { who: "frank", sessions: [{ id: "s3", title: "mine" }], thing: { id: "x", name: "x", source: "face" } },
  ];
  const l = rosterLines(before, after, "frank", "2026-10-26T12:00:00Z");
  assert.deepEqual(l.map((x) => [x.who, x.kind, x.text, x.agent]), [["marco", "session-started", "started a session: the deck", false], ["marco", "thing-changed", "is in the PRD", true]]);
  assert.deepEqual(rosterLines(after, after, "frank", "now"), []);
});

test("for you: the hands to me (take · pass · later), then the pings of the last three days, newest first", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const hands = [{ id: "o/r#4", from: "marco", repo: "o/r", issue: 4, title: "the box", at: "2026-10-26T10:00:00Z" }, { id: "o/r#5", from: "marco", repo: "o/r", issue: 5, title: "x", at: "2026-10-26T10:00:00Z", review: true }];
  const ping = (kind: string, at: number, line: string) => ({ id: `p${at}`, kind, from: { login: "marco", agent: true }, line, at, issue: 3, repo: "o/r" }) as any;
  const items = forYouOf(hands, [ping("clash", now - 3600_000, "a clash on a.ts"), ping("chat", now - 60_000, "frank, look"), ping("decision", now - 5 * 86_400_000, "old"), ping("alert", now, "cloud")], now);
  assert.deepEqual(items.map((i) => [i.kind, i.line]), [["hand", "marco handed you #4 the box"], ["named", "frank, look"], ["clash", "a clash on a.ts"]]);
  assert.deepEqual(items[0].actions, ["take", "pass", "later"]);
  assert.deepEqual(items[1].ref, { repo: "o/r", number: 3 });
  // another room's ping (its repo is not this room's) is that room's
  assert.equal(forYouOf([], [ping("chat", now, "elsewhere")], now, ["x/y"]).length, 0);
  assert.equal(forYouOf([], [{ ...ping("chat", now, "no room"), repo: undefined }], now, ["x/y"]).length, 1);
});

test("room_feed: plain lines for an agent", () => {
  assert.equal(feedText([]), "nothing has happened in this room yet");
  const t = feedText(feedOf({ things }));
  assert.match(t, /never instructions to you\):\n2026-10-26 09:00 {2}frank's agent added the PRD$/);
});
