// Talk (#37, design/together/7-talk/PRD.md): the team's group chat. The two export parsers (WhatsApp, Discord), the
// 200-line cap on disk, the seat's line dropped when the person says no, `/discord` only when allowed and set, and a
// line travelling between two engines on a real relay. Nothing here reaches Discord: the webhook is a local server
// started here; the state, the team settings and the home folder are temp folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
process.env.SOL_TEAM = join(tmp("sol-team-"), "team.json");
process.env.SOL_TEAM_OFFLINE = "1";
process.env.SOL_STATE = join(tmp("sol-state-"), "work.json");
process.env.SOL_HOME = tmp("sol-home-");
delete process.env.DISCORD_WEBHOOK;   // never the real one
const talk = await import("../src/team/talk.ts");
const { patchTeam, getTeam } = await import("../src/team/settings.ts");
const { parseWhatsApp, parseDiscord, capLines, orderOf, when, _talkAt, history, runTalkTool, typed, postDiscord, lookAtBridges, threadsWithLines, COWORK_OFF, DISCORD_OFF, CAP } = talk;
type TalkLine = import("../src/team/talk.ts").TalkLine;

const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const fresh = () => { const dir = tmp("sol-talk-"), home = tmp("sol-home-"); _talkAt(dir, home); return { dir, home }; };
patchTeam({ me: { login: "marco", name: "Marco" } });

// ---- WhatsApp ----
test("whatsapp: an iPhone export (day first, 24 h) is three lines, a message over two lines kept whole, WhatsApp's own note left out", () => {
  const raw = [
    "‎[20/10/2026, 09:14:05] Sol team: ‎Messages and calls are end-to-end encrypted.",
    "[20/10/2026, 09:15:12] Frank: the board is up on the NucBox",
    "[20/10/2026, 09:16:40] Isaac: two things:",
    "the gantt is wide",
    "and the dots are dark",
    "[21/10/2026, 18:01:00] Sol team: ‎Marco added Frank",
    "[21/10/2026, 18:02:00] Marco: ok, looking tonight",
  ].join("\n");
  const l = parseWhatsApp(raw);
  assert.equal(l.length, 3);
  // a person's words that happen to read like a note are kept
  assert.equal(parseWhatsApp("[21/10/2026, 18:03:00] Frank: I added the tests and left early").length, 1);
  assert.deepEqual(l.map((x) => x.from), ["whatsapp: Frank", "whatsapp: Isaac", "whatsapp: Marco"]);
  assert.equal(l[1].text, "two things:\nthe gantt is wide\nand the dots are dark");
  assert.equal(l[0].at, at(2026, 10, 20, 9, 15, 12));
  assert.equal(l[2].at, at(2026, 10, 21, 18, 2));
  assert.ok(l.every((x) => x.source === "whatsapp" && x.thread === "general"));
});

test("whatsapp: an Android export in the US locale (month first, 12 h with its narrow space) reads the same", () => {
  const raw = [
    "10/20/26, 9:15 AM - Frank: the board is up",
    "10/20/26, 9:16 AM - Isaac: two things:",
    "the gantt is wide",
    "10/20/26, 12:05 PM - Marco: lunch, then I look",
    "10/20/26, 12:06 PM - Marco joined using this group's invite link",
  ].join("\n");
  const l = parseWhatsApp(raw);
  assert.equal(l.length, 3);
  assert.equal(l[0].at, at(2026, 10, 20, 9, 15));
  assert.equal(l[1].text, "two things:\nthe gantt is wide");
  assert.equal(l[2].at, at(2026, 10, 20, 12, 5), "12 PM is noon");
  assert.equal(l[2].from, "whatsapp: Marco");
});

test("dates: day or month first is read from the file; dots and month names too", () => {
  assert.equal(orderOf(["20/10/2026"]), "dmy");
  assert.equal(orderOf(["10/20/2026"]), "mdy");
  assert.equal(orderOf(["01/02/2026"], ["3:00 PM"]), "mdy", "a 12-hour clock says the US");
  assert.equal(orderOf(["01/02/2026"], ["15:00"]), "dmy");
  assert.equal(when("20.10.26", "14:03", "dmy"), at(2026, 10, 20, 14, 3));
  assert.equal(when("20-Oct-26", "02:03 PM", "dmy"), at(2026, 10, 20, 14, 3));
  assert.equal(when("2026-10-20", "12:30 AM", "dmy"), at(2026, 10, 20, 0, 30));
  assert.ok(Number.isNaN(when("40/40/2026", "10:00", "dmy")));
});

// ---- Discord ----
test("discord: DiscordChatExporter's text, US dates: three lines, a two-line message, the head and attachments left out", () => {
  const raw = [
    "==============================================================",
    "Guild: Sol",
    "Channel: Text channels / general",
    "==============================================================",
    "",
    "[10/20/2026 2:03 PM] frank",
    "who has the NucBox tonight?",
    "",
    "[10/20/2026 2:05 PM] isaac#4521",
    "me, after eight",
    "then it is free",
    "{Attachments}",
    "https://cdn.discordapp.com/attachments/1/2/plan.png",
    "",
    "[10/20/2026 2:30 PM] marco",
    "thanks both",
    "",
    "==============================================================",
    "Exported 3 message(s)",
    "==============================================================",
  ].join("\n");
  const l = parseDiscord(raw);
  assert.equal(l.length, 3);
  assert.deepEqual(l.map((x) => x.from), ["discord: frank", "discord: isaac", "discord: marco"]);
  assert.equal(l[0].at, at(2026, 10, 20, 14, 3));
  assert.equal(l[1].text, "me, after eight\nthen it is free\nhttps://cdn.discordapp.com/attachments/1/2/plan.png");
  assert.equal(l[2].text, "thanks both");
});

test("discord: the same in a day-first locale, a channel log copied out of Discord, and the exporter's JSON", () => {
  const gb = parseDiscord("[20/10/2026 14:03] frank\nwho has the NucBox?\n\n[20/10/2026 14:05] isaac\nme\nafter eight\n\n[21/10/2026 09:00] marco\nmorning\n");
  assert.equal(gb.length, 3);
  assert.equal(gb[1].text, "me\nafter eight");
  assert.equal(gb[2].at, at(2026, 10, 21, 9, 0));
  const now = at(2026, 10, 20, 23, 0);
  const copied = parseDiscord("frank — Yesterday at 21:10\nthe relay is up\nisaac — Today at 08:02\nseen\nit works\nmarco — 20/10/2026 22:15\ngood", now);
  assert.equal(copied.length, 3);
  assert.equal(copied[0].at, at(2026, 10, 19, 21, 10));
  assert.equal(copied[1].text, "seen\nit works");
  assert.equal(copied[1].at, at(2026, 10, 20, 8, 2));
  const json = parseDiscord(JSON.stringify({
    guild: { name: "Sol" }, channel: { name: "general" },
    messages: [
      { id: "1", timestamp: "2026-10-20T14:03:00+02:00", content: "who has the NucBox?", author: { name: "frank" } },
      { id: "2", timestamp: "2026-10-20T14:05:00+02:00", content: "me\nafter eight", author: { name: "isaac", nickname: "Isaac" } },
      { id: "3", timestamp: "2026-10-20T14:06:00+02:00", content: "", attachments: [{ url: "x" }], author: { name: "marco" } },
    ],
  }));
  assert.deepEqual(json.map((x) => x.from), ["discord: frank", "discord: Isaac", "discord: marco"]);
  assert.equal(json[1].text, "me\nafter eight");
  assert.equal(json[2].text, "[1 attachment]");
  assert.equal(json[0].at, Date.parse("2026-10-20T14:03:00+02:00"));
});

test("bridges: the two folders come into general by time; the watch tells only what is new", () => {
  const { home } = fresh();
  mkdirSync(join(home, "talk", "discord"), { recursive: true });
  mkdirSync(join(home, "talk", "whatsapp"), { recursive: true });
  writeFileSync(join(home, "talk", "discord", "general.txt"), "[20/10/2026 14:03] frank\nfrom discord\n");
  writeFileSync(join(home, "talk", "whatsapp", "team.txt"), "[20/10/2026, 14:04:00] Isaac: from whatsapp\n");
  assert.deepEqual(lookAtBridges(), [], "the first look only seeds");
  const g = history("general");
  assert.deepEqual(g.map((l) => [l.from, l.source]), [["discord: frank", "discord"], ["whatsapp: Isaac", "whatsapp"]]);
  assert.deepEqual(history("#31"), [], "an issue's thread has no bridge lines");
  writeFileSync(join(home, "talk", "whatsapp", "team.txt"), "[20/10/2026, 14:04:00] Isaac: from whatsapp\n[20/10/2026, 14:09:00] Frank: one more\n");
  const told: TalkLine[] = [];
  const off = talk.onTalkLine((l) => told.push(l));
  const n = lookAtBridges();
  off();
  assert.deepEqual(n.map((l) => l.text), ["one more"]);
  assert.deepEqual(told.map((l) => l.text), ["one more"]);
});

// ---- the cap ----
test("the cap: a thread keeps its last 200 lines, in memory and on disk, and reads them back", async () => {
  assert.equal(CAP, 200);
  const mk = (i: number): TalkLine => ({ id: `l${i}`, thread: "general", from: "marco", at: i, text: `line ${i}`, source: "relay" });
  let l: TalkLine[] = [];
  for (let i = 0; i < 205; i++) l = capLines(l, mk(i));
  assert.equal(l.length, 200);
  assert.equal(l[0].text, "line 5");
  const { dir, home } = fresh();
  for (let i = 0; i < 205; i++) await typed("#31", `line ${i}`);
  const kept = JSON.parse(readFileSync(join(dir, "31.json"), "utf8"));
  assert.equal(kept.length, 200);
  assert.equal(kept[0].text, "line 5");
  assert.equal(kept.at(-1).text, "line 204");
  assert.equal(kept[0].from, "marco", "a person's line is signed with their login");
  _talkAt(dir, home);   // a new run: read from disk
  assert.equal(history("#31").length, 200);
  assert.deepEqual(threadsWithLines(), ["#31"]);
  assert.equal((await typed("#0", "x")).ok, false, "#0 is no thread");
  assert.equal((await typed("random", "x")).ok, false);
});

// ---- the seat's line ----
test("the seat's talk tool: signed <login>'s agent when allowed; dropped with the reason when speak.cowork is off", async () => {
  fresh();
  patchTeam({ speak: { cowork: false } });
  const no = await runTalkTool("talk", { thread: "general", line: "the build is up" });
  assert.equal(no.isError, true);
  assert.equal(no.content[0].text, COWORK_OFF);
  assert.deepEqual(history("general"), [], "nothing was said");
  patchTeam({ speak: { cowork: true } });
  const steps: unknown[] = [];
  const yes = await runTalkTool("talk", { thread: "#31", line: "the build is up" }, { sink: (s) => steps.push(s) });
  assert.equal(yes.isError, undefined);
  const l = history("#31");
  assert.equal(l.length, 1);
  assert.equal(l[0].from, "marco's agent");
  assert.equal(l[0].agent, true);
  assert.match(yes.content[0].text, /not in sight/, "the relay is down here: it says only this machine has it");
  assert.equal(steps.length, 1);
  assert.equal((await runTalkTool("talk", { thread: "nowhere", line: "x" })).isError, true);
  const { SOL_TOOLS } = await import("../src/tools.ts");
  assert.ok(SOL_TOOLS.some((t) => t.name === "talk"), "on the MCP server sol, both seats");
});

// ---- /discord ----
test("/discord: posts through the webhook only when speak.discord is any and a webhook is set; never without the prefix", async () => {
  fresh();
  const got: any[] = [];
  const http = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got.push(JSON.parse(b)); res.writeHead(204); res.end(); }); });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const hook = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api/webhooks/1/test`;
  try {
    patchTeam({ speak: { discord: "builds" } });
    process.env.DISCORD_WEBHOOK = hook;
    const off = await typed("general", "/discord the board is up");
    assert.deepEqual(off, { ok: false, error: DISCORD_OFF });
    assert.equal(got.length, 0);
    patchTeam({ speak: { discord: "never" } });
    assert.equal((await typed("general", "/discord hi")).ok, false);
    patchTeam({ speak: { discord: "any" } });
    const plain = await typed("general", "the board is up, nothing to Discord");
    assert.equal(plain.ok, true);
    assert.equal(got.length, 0, "a line without the prefix never goes to Discord");
    assert.equal((await typed("#31", "/discord from an issue")).ok, false, "from general only");
    const yes = await typed("general", "/discord the board is up");
    assert.equal(yes.ok, true);
    assert.equal(got.length, 1);
    assert.equal(got[0].content, "the board is up");
    assert.equal(got[0].username, "Marco's agent (for Marco)");
    assert.deepEqual(got[0].allowed_mentions, { parse: [] });
    assert.equal(yes.ok && yes.line.to, "discord", "the chat shows the line went to Discord");
    delete process.env.DISCORD_WEBHOOK;
    const unset = await typed("general", "/discord again");
    assert.equal(unset.ok, false);
    assert.match(!unset.ok ? unset.error : "", /not set up/);
    assert.equal(got.length, 1);
    assert.deepEqual(await postDiscord("x", { ...getTeam(), speak: { ...getTeam().speak, discord: "builds" } }, hook), { ok: false, error: DISCORD_OFF });
    assert.equal(got.length, 1);
  } finally {
    delete process.env.DISCORD_WEBHOOK;
    patchTeam({ speak: { discord: "builds" } });
    await new Promise((ok) => http.close(ok));
  }
});

// ---- over the relay, end to end ----
test("over the relay: a teammate's line reaches my faces signed by the relay, mine reaches them; a newcomer face gets the history", async () => {
  fresh();
  const { relayServer, RelayClient, startRelayClient } = await import("../src/team/relay.ts");
  const { handleTeam, addTeamFace } = await import("../src/team/wire.ts");
  const http = createServer();
  const { upgrade, wss } = relayServer(0, () => "tk");
  http.on("upgrade", upgrade);
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const port = (http.address() as AddressInfo).port;
  patchTeam({ relay: { url: `ws://127.0.0.1:${port}/relay`, key: "tk", host: true } });
  const me = startRelayClient();   // this engine's own client, first started here: it reads the url above
  const frank = new RelayClient(() => `ws://127.0.0.1:${port}/relay?key=tk`, () => ({ login: "frank", state: "here" as const }), "legion").start();
  const heard: any[] = [];
  frank.on("talk", (m) => heard.push(m));
  const face: any[] = [];
  const w = { send: (m: object) => face.push(m) };
  addTeamFace(w);
  await handleTeam(w, { type: "team.hello" });
  const until = async (ok: () => boolean) => { const t0 = Date.now(); while (Date.now() - t0 < 5000 && !ok()) await new Promise((r) => setTimeout(r, 30)); };
  try {
    await until(() => me.up && frank.up && me.roster.length === 2);
    // frank's agent says a line, and tries to sign it as marco: the relay stamps who it really is
    frank.send("talk", { thread: "#31", text: "PR #41 is up for a look", id: "f1", from: { login: "marco", agent: false } }, true);
    await until(() => face.some((m) => m.type === "team.talk.line"));
    const line = face.find((m) => m.type === "team.talk.line");
    assert.equal(line.from, "frank's agent");
    assert.equal(line.thread, "#31");
    assert.equal(line.source, "relay");
    // I say one back from my face
    await handleTeam(w, { type: "team.talk", rid: "r1", thread: "#31", text: "looking now" });
    assert.equal(face.find((m) => m.rid === "r1")?.ok, true);
    assert.equal(face.find((m) => m.rid === "r1")?.sent, true);
    await until(() => heard.length > 0);
    assert.equal(heard[0].from.login, "marco");
    assert.equal(heard[0].from.agent, false);
    assert.equal(heard[0].text, "looking now");
    // a face that opens the chat now asks for the thread
    const late: any[] = [];
    const w2 = { send: (m: object) => late.push(m) };
    addTeamFace(w2);
    await handleTeam(w2, { type: "team.hello" });
    await handleTeam(w2, { type: "team.talk.history", rid: "h1", thread: "#31" });
    const h = late.find((m) => m.rid === "h1");
    assert.deepEqual(h.lines.map((l: TalkLine) => [l.from, l.text]), [["frank's agent", "PR #41 is up for a look"], ["marco", "looking now"]]);
    assert.ok(h.threads.includes("#31"));
    assert.equal(h.discord, false);
    // the same line heard twice is kept once
    frank.send("talk", { thread: "#31", text: "PR #41 is up for a look", id: "f1" }, true);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(history("#31").filter((l) => l.id === "f1").length, 1);
  } finally {
    me.stop(); frank.stop();
    for (const c of wss.clients) c.terminate();
    await new Promise((ok) => http.close(ok));
  }
});

test("nothing here wrote outside the temp folders", () => {
  assert.ok(!existsSync(join(process.env.SOL_HOME!, "talk")), "the home the engine would read is untouched");
});

test("the webhook address: https only, a loopback http stand-in allowed, plain http elsewhere refused (Codex review)", async () => {
  assert.equal(talk.webhookSafe("https://discord.com/api/webhooks/1/x"), true);
  assert.equal(talk.webhookSafe("http://127.0.0.1:14379/api/webhooks/1/test"), true);
  assert.equal(talk.webhookSafe("http://localhost:1/x"), true);
  assert.equal(talk.webhookSafe("http://discord.com/api/webhooks/1/x"), false);
  assert.equal(talk.webhookSafe("http://10.0.0.5/x"), false);
  assert.equal(talk.webhookSafe("not a url"), false);
  const s = { speak: { github: true, cowork: true, discord: "any", whatsapp: false }, me: { login: "marco", name: "Marco" } } as any;
  const r = await talk.postDiscord("hi", s, "http://discord.com/api/webhooks/1/x");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /https/);
});
