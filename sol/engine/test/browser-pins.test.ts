// Pins inside a page shown through the browser (#54): the selector made from the page's chain of elements, the words
// cut to one line, and inspect and locate on a real engine against a data: page with an iframe in it (an artifact on
// claude.ai draws in one). A real engine runs on its own port, home and profile, with a stand-in codex (SOL_CODEX), so
// nothing leaves the machine; the page is a data: url, so nothing is fetched either.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { describeChain, trimWords, type Link } from "../src/browser.ts";

const L = (tag: string, o: Partial<Link> = {}): Link => ({ tag, id: "", classes: [], nth: 0, ...o });

test("pins: the selector is up to three parts, stops at an id, and never reaches the body", () => {
  assert.equal(describeChain([L("h2", { classes: ["title"] }), L("section", { classes: ["hero"] }), L("body"), L("html")]), "section.hero > h2.title");
  assert.equal(describeChain([L("span"), L("p", { nth: 2 }), L("div", { id: "main" }), L("main"), L("body")]), "div#main > p:nth-of-type(2) > span");
  assert.equal(describeChain([L("b"), L("i"), L("em"), L("p", { id: "far" }), L("body")]), "em > i > b");   // three parts at most
  assert.equal(describeChain([L("li", { classes: ["2col", "item"] }), L("body")]), "li.item");             // a class a selector cannot start with is skipped
  assert.equal(describeChain([L("div", { id: "1st" }), L("body")]), "div#\\31 st");                         // an id starting with a digit is escaped
  assert.equal(describeChain([L("body"), L("html")]), "body");
});

test("pins: the words are one line, cut near 80 characters", () => {
  assert.equal(trimWords("  Hello\n\n   world \t"), "Hello world");
  const long = "word ".repeat(40);
  const w = trimWords(long);
  assert.ok(w.length <= 80 && w.endsWith("…"), w);
  assert.equal(trimWords("x".repeat(80)), "x".repeat(80));
});

// ---- on a real engine ----
const ENGINE = join(import.meta.dirname, "..");
const PORT = 7930 + Math.floor(Math.random() * 9);
const dir = mkdtempSync(join(tmpdir(), "sol-pins-"));
mkdirSync(join(dir, "home"));
writeFileSync(join(dir, "codex"), "#!/bin/sh\nexec sleep 600\n"); chmodSync(join(dir, "codex"), 0o755);
let engine: ChildProcess | null = null;
const sockets: WebSocket[] = [];
// the engine is waited out (its browser closes with it), and killed outright if it has not gone in five seconds
after(async () => {
  for (const s of sockets) s.terminate();
  const e = engine;
  if (e && e.exitCode === null && e.signalCode === null) {
    const gone = new Promise((r) => e.once("exit", r));
    e.kill();
    const t = setTimeout(() => e.kill("SIGKILL"), 5000);
    await gone;
    clearTimeout(t);
  }
  rmSync(dir, { recursive: true, force: true });
});

async function up() {
  engine = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: ENGINE, stdio: "ignore",
    env: {
      ...process.env, SOL_PORT: String(PORT), SOL_HOME: join(dir, "home"), SOL_PROFILE: join(dir, "profile"),
      SOL_STATE: join(dir, "work.json"), SOL_TEAM: join(dir, "team.json"), SOL_LOG: join(dir, "engine.log"),
      SOL_CODEX: join(dir, "codex"), SOL_NO_RENEW: "1", SOL_NO_SHIP_CHECK: "1", SOL_TEAM_OFFLINE: "1",
    },
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the test engine did not come up");
}

type Msg = { type: string; [k: string]: any };
async function face() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  sockets.push(ws);
  const got: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; ok: (m: Msg) => void }[] = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString()) as Msg;
    got.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.ok(m); }
  });
  await new Promise((r, no) => { ws.once("open", r); ws.once("error", no); });
  const next = (pred: (m: Msg) => boolean, ms = 30_000) => new Promise<Msg>((ok, no) => {
    const seen = got.find(pred);
    if (seen) return ok(seen);
    const t = setTimeout(() => no(new Error("timed out; got " + got.map((m) => m.type).join(" "))), ms);
    waiters.push({ pred, ok: (m) => { clearTimeout(t); ok(m); } });
  });
  return { ws, got, next, say: (m: object) => ws.send(JSON.stringify(m)) };
}

// a heading in the page, and a frame 100 px down and 20 px in (a 10 px border) holding a note
const INNER = `<body style="margin:0"><div class="card"><p class="note" style="margin:0">Pinned inside the frame</p></div></body>`;
const PAGE = `<!doctype html><title>pins</title><body style="margin:0">` +
  `<section class="hero"><h2 class="title" style="margin:0;height:40px">The   heading\nhere</h2></section>` +
  `<iframe style="position:absolute;left:10px;top:100px;width:400px;height:200px;border:10px solid #000;padding:0" srcdoc='${INNER}'></iframe></body>`;

test("pins: inspect names what is under a point, through a frame; locate finds it again", { timeout: 120_000 }, async () => {
  await up();
  const f = await face();
  const url = "data:text/html," + encodeURIComponent(PAGE);
  f.say({ type: "browser.open", url, sessionId: "pins" });
  const tab = (await f.next((m) => m.type === "tabs" && m.tabs.some((t: any) => t.sessionId === "pins" && t.url.startsWith("data:")))).tabs.find((t: any) => t.sessionId === "pins").id;
  f.say({ type: "browser.resize", tab, w: 800, h: 600 });

  f.say({ type: "browser.inspect", tab, x: 30, y: 20, rid: "a" });
  const a = await f.next((m) => m.type === "browser.inspected" && m.rid === "a");
  assert.equal(a.tab, tab);
  assert.equal(a.sel, "section.hero > h2.title");
  assert.equal(a.words, "The heading here");
  assert.equal(a.title, "pins");
  assert.ok(a.url.startsWith("data:text/html"));
  assert.deepEqual({ x: a.box.x, y: a.box.y, h: a.box.h }, { x: 0, y: 0, h: 40 });

  // inside the frame: its page starts at (20, 110) in the tab's view
  f.say({ type: "browser.inspect", tab, x: 40, y: 118, rid: "b" });
  const b = await f.next((m) => m.type === "browser.inspected" && m.rid === "b");
  assert.equal(b.sel, "div.card > p.note");
  assert.equal(b.words, "Pinned inside the frame");
  assert.ok(b.box.x >= 20 && b.box.x < 30 && b.box.y >= 110 && b.box.y < 140, JSON.stringify(b.box));

  f.say({ type: "browser.locate", tab, sels: [a.sel, b.sel, "p.gone"], rid: "c" });
  const c = await f.next((m) => m.type === "browser.located" && m.rid === "c");
  assert.equal(c.boxes.length, 3);
  assert.deepEqual(c.boxes[0], a.box);
  assert.deepEqual(c.boxes[1], b.box);
  assert.equal(c.boxes[2], null);

  // a closed tab answers nothing
  f.say({ type: "browser.close", tab });
  await f.next((m) => m.type === "tabs" && !m.tabs.some((t: any) => t.id === tab));
  f.say({ type: "browser.inspect", tab, x: 1, y: 1, rid: "d" });
  await assert.rejects(f.next((m) => m.rid === "d", 1500));
  f.ws.close();
});
