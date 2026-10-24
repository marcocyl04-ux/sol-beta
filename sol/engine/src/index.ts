// The engine: Marco's agent engine, running on his machine, on his subscription.
// One WebSocket on 127.0.0.1:7777 (env PORT overrides, for tests). The face (and later the doors) talk to it.
// The full wire is in sol/PROTOCOL.md. In short:
//
// In:  { type: "say", text, seat?, sessionId?, model?, effort?, files?, door?, fresh?, cwd?, parent? }   seat: "codex" | "claude"
//        cwd: a new GPT talk's project folder (#182): Codex works there; none = Sol's home. parent: the talk it carries on
//        door: "notch" | "phone": a way in outside the main window; with no sessionId it continues the door's own last
//        conversation when it spoke less than 20 min ago, else starts one (src/doors.ts); fresh: true always starts one
//      { type: "stop", sessionId? }      this socket's turn; with sessionId (or a draft), the Life turn on it (the notch's Stop)
//      { type: "list" }                      -> threads
//      { type: "open", seat, sessionId }     -> thread
//      { type: "open", seat, sessionId? , draft?, resume: true }   the face's re-sync after its link came back (#17): a
//                                              Life turn still running there (src/relay.ts) is given back, -> thread, the
//                                              turn's steps and text so far, resumed { seat, sessionId, draft, running, ok }
//      { type: "ping", at }                  -> pong { at }   the face's heartbeat (mac/src/socket.ts); the engine also
//                                              sends a protocol ping every 20 s and closes a socket that missed one
//      { type: "models" }                    -> models (seats[] with models, efforts, can, cannot; plus compat codex/claude/efforts)
//      { type: "hear", audio, done }         -> heard   (base64 wav; local whisper.cpp). done: false = the clip so far while
//                                              dictation goes on -> heard { text, partial: true }, the newest clip wins
//      { type: "call", seat?, sessionId?, draft?, model?, effort?, door?, fresh? }  start a call (src/call.ts); { type: "call.audio", data } { type: "call.end" }
//      { type: "browser.watch", tab|null } { type: "browser.open", url, sessionId? } { type: "browser.close", tab }
//      { type: "browser.select", tab } { type: "browser.input", tab, event } { type: "browser.navigate", tab, action }
//      { type: "desk.act", sessionId, id, act, ... } Marco did something on a card (src/desk.ts); { type: "desk.get", sessionId }
//      { type: "notify.seen", id }          Marco saw a ping (src/ping.ts): counts only from the ping's destination
//      { type: "notify.ack", id }           the phone has a ping (else it moves to the notch after 20 s)
//      { type: "hello", face }              window | notch | phone: which face this socket is (pings are routed by it)
//      { type: "presence", focused, idleSeconds }   the main window: focus and system idle (src/creature.ts)
//      { type: "dictation", on }            dictation started / stopped on this face
//      { type: "arrange.get" } / { type: "arrange.set", patch }   the arrangement (src/arrange.ts) -> arrange.changed
//      { type: "arrange.used", counts: { <button id>: n } }   presses on the rails, batched a minute; no answer
//      { type: "arrange.undo" }   the agent's last change to the arrangement taken back, one step only
//      { type: "face.broken", site, error } / { type: "face.mended", site }   a part of the window threw when it drew, or
//                                            drew again (Site.tsx); after a recent face edit, src/changing.ts may take it back
// Out: { type: "start", seat, sessionId }
//      { type: "delta", text }               streamed assistant text
//      { type: "tool", seat, id, kind, text, detail?, ok?, done }   one step of the seat's work; the same id again when it completes
//      { type: "usage", context, window, parts }   tokens in the window, its size, and a rough split of it
//      { type: "done", seat, sessionId, ok?, stopped?, turns?, costEstimate? }
//      { type: "said", seat, sessionId, text, door? }   to everyone: a finished sentence of Sol's, and which door asked
//      { type: "error", message }
//      { type: "threads", threads: [{ seat, sessionId, title, updatedAt, door?, moved? }] }   moved: handed into Work
//      { type: "thread", seat, sessionId, msgs: [{ who, text, files? }] }
//      { type: "models", seats, codex, claude, efforts }
//      { type: "heard", text, why? }
//      { type: "tabs", tabs: [{ id, sessionId, title, url, active }] }   every browser tab change, to every face
//      { type: "frame", tab, data, w, h }    base64 JPEG of the tab being watched, <= 10/s
//      { type: "desk", sessionId, cards }    the desk of a conversation, to every face on every change
//      { type: "pin", card | null }          the card pinned to the notch, to every face
//      { type: "arrange.changed", arrangement, note?, refused?, undo? }   to every face on a change; refused: to the asker
//        only; undo { who, what }: an agent changed it, the rail's note
//      { type: "changing", seat, sessionId, kind, file?, files?, line, done, ok? }   Sol changing its own face (src/changing.ts), to every face
//      { type: "notify", id, seat, sessionId, line, at, dest } / { type: "notify.clear", id } / { type: "notify.mark", count }
//                                            / { type: "notify.dot", ... }   a ping, to its destination only (src/ping.ts)
//      { type: "engine", phase: "up" }      on connect; { type: "creature.state", state, asks } on every change, to every
//                                            face; { type: "creature.flash", kind: "done" | "wrong" } (src/creature.ts);
//                                            { type: "creature.ask", ask } and { type: "creature.turn", turn } likewise (#6)
//      { type: "health", health }            kept, build, face, reverted (src/health.ts), to every face when it changes;
//                                            also in settings' up object
// HTTP: GET /health, POST /letgo (a window going back to the NucBox, One Sol #62), GET /file?path= (only inside home/), GET /pane-image?path= (an image the file pane opened), GET /pane-asset/<folder>/<rel> (a page's own files, for the page pane, #54), POST /tool (used by src/mcp-stdio.ts; /browser is an alias).
// Both seats also get the browser and desk tools as an MCP server named "sol" (src/browser.ts, src/desk.ts,
// routed by src/tools.ts): one invisible Chromium, tabs per conversation; a desk of cards per conversation. What each seat may do is src/inventory.ts (Home: read anywhere, write in home/).

import { doorOpen, tailnetOk as tailnetDoor } from "./door.js";
import { plan as goBackPlan, goBack } from "./goback.js";
import { join as joinBusy, idle as engineIdle, busyList, busyLine, onBusy, lockSession, relockSession, Held, letGo, refusedWhileLettingGo } from "./busy.js";
import { createServer } from "node:http";
import { resolve, dirname, relative, join, basename } from "node:path";
import { readFileSync, realpathSync, statSync, createReadStream, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { Relay, relayFor } from "./relay.js";
import { query, createSdkMcpServer, tool, type Options, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { Codex, type ModelReasoningEffort, type ThreadEvent, type UserInput } from "@openai/codex-sdk";
import { listThreads, openThread, codexLastUsage, threadExists, threadSettings, codexCwd, invalidateCodex, type Seat } from "./threads.js";
import { saveFiles, attachedLines, serveFile, servePaneImage, type FileIn } from "./files.js";
import { setBrowserProfile, browserProfileDir, addFace, removeFace, watch, openTab, closeTab, selectTab, navigateTab, resizeTab, inputTab, inspectTab, locateTab, adoptTabs, type TurnCtx } from "./browser.js";
import { setDeskHome, addFace as addDeskFace, removeFace as removeDeskFace, adoptDesk, actDesk, deskMsg, takeDeskLines } from "./desk.js";
import { SOL_TOOLS, runSolTool } from "./tools.js";
import { HOME_INVENTORY, solScript, type Inventory } from "./inventory.js";
import { transcribe, DICTATION_MODEL } from "./voice.js";
import { Call, haveVoiceKey } from "./call.js";
import { getSettings, patchSettings } from "./settings.js";
import { setArrangeHome, arrangeMsg, setArrangement, undoArrangement, addUsage, oneAsk } from "./arrange.js";
import { setTitle, nameConversation, namingModel } from "./titles.js";
import { Sample } from "./sample.js";
import { asDoor, continueDoor, doorOf, touchDoor, type Door } from "./doors.js";
import { runBlock, stopBlock, type Finder } from "./run.js";
import { sessionItems, sessionInfo, setWorkHome, workFolderIn, relocated } from "./work/sessions.js";
import { reviewThreads } from "./work/review.js";
import { servePaneAsset } from "./work/page.js";
import { getRun, allRuns } from "./work/runs.js";
import { renewOnBuild } from "./renew.js";
import { addWorkFace, removeWorkFace, handleWork, setWorkChanging, broadcastSessions } from "./work/wire.js";
import { addTeamFace, removeTeamFace, handleTeam, startTeam } from "./team/wire.js";
import { relayServer, RelayHub } from "./team/relay.js";
import { Spool } from "./team/spool.js";
import { teamMembers } from "./team/members.js";
import { startShip } from "./team/ship.js";
import { getTeam, speakParagraph } from "./team/settings.js";
import { guardSpeak } from "./team/control.js";
import { Changing } from "./changing.js";
import { addPingFace, removePingFace, seenPing, ackPing, pingFaceIs } from "./ping.js";
import { workState, STATE_DIR, mark } from "./work/state.js";
import { addCreatureFace, removeCreatureFace, setRole, setPresence, setDictation, sent as creatureSent, lifeTurn, type Role } from "./creature.js";
import { watchHealth, noteRevert, type Health } from "./health.js";

// Keys live in sol/engine/.env (gitignored): GEMINI_API_KEY for the call.
try { process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env")); } catch { /* no .env: no call */ }

const PORT = Number(process.env.SOL_PORT ?? process.env.PORT ?? 7777); // SOL_PORT: a second engine for tests
const STARTED = new Date().toISOString();
const HOST = "127.0.0.1";

type Say = { type: "say"; text: string; seat?: Seat; sessionId?: string; draft?: string; model?: string; effort?: string; files?: FileIn[]; door?: Door; fresh?: boolean; cwd?: string; parent?: string };
type Stop = { type: "stop"; sessionId?: string };
type List = { type: "list" };
type Open = { type: "open"; seat: Seat; sessionId: string; draft?: string; resume?: boolean };
type Models = { type: "models" };
type In = Say | Stop | List | Open | Models | { type: "hear"; audio: string; done?: boolean; tag?: number } | { type: "call" } | { type: string; [k: string]: any };

// One connected face. sessionId is its current conversation; chars counts the transcript so far.
// ws is anything that takes a JSON line: the real socket, or (during a call) a tap that also reads the answer.
type Wire = { readyState: number; send: (s: string) => void };
type Conn = { ws: Wire; sessionId?: string; chars: number };
// Home's inventory today; Work (sitting 4) will hand sayCodex/sayClaude its own.
const INV: Inventory = HOME_INVENTORY;

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = realpathSync(process.env.SOL_HOME ?? resolve(HERE, "..", "..", "home")); // SOL_HOME: the live engine runs from its own checkout but points at the synced home/
setBrowserProfile(process.env.SOL_PROFILE ?? browserProfileDir(HOME)); // SOL_PROFILE: tests use their own
setDeskHome(HOME);
setWorkHome(HOME, reviewThreads);   // Work's side lists GPT talks in folders, not Sol's own chats nor the review seat's (#182)
setArrangeHome(HOME, (m) => everyone(m));   // the arrangement (#133): its own file in the back room, told to every face
// every edit a seat makes to Sol's face, and every mutate and undo, goes out to every window (src/changing.ts)
const changing = new Changing(HOME, (m) => {
  const r = m as { type?: string; line?: string };
  if (r.type === "face.reverted") noteRevert("face", undefined, r.line);
  everyone(m);
});
setWorkChanging(changing);
// The keeper (engine/keep) put the last good build back after three failed starts: it leaves dist/.reverted, read once
// here, so every window that connects hears it and the log says when.
const REVERTED = (() => { try { const at = readFileSync(resolve(HERE, ".reverted"), "utf8").trim(); unlinkSync(resolve(HERE, ".reverted")); return at; } catch { return ""; } })();
if (REVERTED) { console.log(`keep: this engine is the last good build, put back at ${REVERTED}; the broken one is in dist.bad/`); noteRevert("engine", REVERTED); }
// kept, build, face, reverted: every five seconds, to every window when it changes (src/health.ts)
const health = watchHealth(resolve(HERE, ".."), (h: Health) => everyone({ type: "health", health: h }));
// Ship (#33): stamp stable from this checkout, and a new stable heard on the relay offered to every face (team/ship.ts)
startShip(resolve(HERE, "..", ".."), (m) => everyone(m));

const EFFORTS = ["low", "medium", "high", "max"];

function send(ws: Wire, msg: object) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
  if (ws instanceof WebSocket) creatureSent(ws, msg);   // the creature hears calls, voice and text out, turn ends (creature.ts)
}

const short = (s: string, n = 60) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};
// Paths inside home/ (or the folder a GPT talk works in, #182) read better short.
const nice = (p: string, base = HOME) => {
  const r = p.startsWith("/") ? relative(base, p) : p;
  return r.startsWith("..") ? p : r;
};

// ---- steps: what the face shows between messages (sol/PROTOCOL.md, round 3) ----

type Kind = "command" | "read" | "write" | "search" | "browse" | "desk" | "reasoning" | "note" | "error";
type Step = { id: string; kind: Kind; text: string; done: boolean; ok?: boolean; detail?: string };
const DETAIL_CAP = 4096;

// A command as Marco would type it: no shell wrapper, no absolute home/ prefix.
function niceCmd(c: string, base = HOME): string {
  let t = c.replace(/\s+/g, " ").trim();
  const m = /^(?:\/\S*\/)?(?:bash|zsh|sh)\s+-lc\s+(['"]?)([\s\S]*)\1$/.exec(t);
  if (m) t = m[2];
  return t.split(base + "/").join("").split(base).join(base === HOME ? "home" : basename(base));
}
// Output in the card: head and tail of anything longer than ~4 KB.
function trimDetail(t: string): string {
  const one = t.replace(/\r\n?/g, "\n").trimEnd();
  if (one.length <= DETAIL_CAP) return one;
  return one.slice(0, DETAIL_CAP - 1300) + "\n…\n" + one.slice(-1200);
}
// The step for a command: the short line, and the full command in the detail when the line cut it.
function commandStep(id: string, raw: string, base = HOME): { step: Step; prefix: string } {
  const cmd = niceCmd(raw, base);
  const shown = short(cmd, 72);
  return { step: { id, kind: "command", text: `running ${shown}`, done: false }, prefix: shown === cmd ? "" : `$ ${cmd}\n` };
}
const firstSentence = (t: string) => short(t.split(/(?<=[.!?])\s+|\n+/)[0] ?? t, 110);
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return short(u, 40); } };

// ---- models ----

// Codex: gpt-6.1-sol first, then whatever Codex itself lists as visible (its own cache, read only).
function codexModels(): string[] {
  const out = ["gpt-6.1-sol"];
  try {
    const cache = JSON.parse(readFileSync(join(homedir(), ".codex", "models_cache.json"), "utf8"));
    for (const m of cache.models ?? []) if (m.visibility === "list" && !out.includes(m.slug)) out.push(m.slug);
  } catch {}
  return out;
}
const CLAUDE_MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

// Window sizes: Codex says so in its model cache; Claude's result message says so (and we guess until then).
function codexWindow(model?: string): number {
  try {
    const cache = JSON.parse(readFileSync(join(homedir(), ".codex", "models_cache.json"), "utf8"));
    const m = (cache.models ?? []).find((x: any) => x.slug === (model ?? "gpt-6.1-sol"));
    if (m?.context_window) return Math.round(m.context_window * (m.effective_context_window_percent ?? 100) / 100);
  } catch {}
  return 258400;
}
const claudeWindowGuess = (model: string) => (model.includes("haiku") ? 200000 : 1000000);

function seatsMsg() {
  return [
    { seat: "codex", label: "Codex", via: "ChatGPT subscription", models: codexModels(), default: "gpt-6.1-sol", efforts: EFFORTS, can: INV.can, cannot: INV.cannot },
    { seat: "claude", label: "Claude", via: "Claude subscription", models: CLAUDE_MODELS, default: "claude-opus-5-5", efforts: EFFORTS, can: INV.can, cannot: INV.cannot },
  ];
}

// Rough split of the window: bytes/4 for the home files the seats read at start, chars/4 for the conversation.
function homeFilesTokens(): number {
  let bytes = 0;
  for (const f of ["CLAUDE.md", join("school", "CLAUDE.md")]) {
    try {
      bytes += statSync(join(HOME, f)).size;
    } catch {}
  }
  return Math.round(bytes / 4); // AGENTS.md is the same file as CLAUDE.md; not counted twice
}
function usageMsg(conn: Conn, context: number, window: number) {
  const home = homeFilesTokens();
  const convo = Math.round(conn.chars / 4);
  return {
    type: "usage",
    context,
    window,
    parts: [
      { name: "system and tools", tokens: Math.max(0, context - home - convo) },
      { name: "home files", tokens: home },
      { name: "this conversation", tokens: convo },
      { name: "free", tokens: Math.max(0, window - context) },
    ],
  };
}

// Codex's own scale: low, medium, high, xhigh. Ours tops out at "max".
const codexEffort = (e?: string): ModelReasoningEffort => (e === "max" ? "xhigh" : ((e ?? "medium") as ModelReasoningEffort));

// ---- the seats ----

// A door with no conversation named continues its own last one, if that spoke recently (src/doors.ts).
async function doorConversation(door: Door | undefined, seat: Seat, sessionId?: string, fresh?: boolean) {
  if (!door || sessionId || fresh) return sessionId;
  const id = continueDoor(door);
  return id && (await threadExists(HOME, seat, id)) ? id : undefined;
}

// Two seats, both on Marco's subscriptions. Codex is Home's seat; Claude is Work's.
async function handleSay(conn: Conn, say: Say, abort: AbortController) {
  const ws = conn.ws;
  const seat = say.seat ?? "codex";
  // The browser tools know which conversation and which face they belong to through this.
  const turn: TurnCtx = { sessionId: say.sessionId ?? say.draft, seat, sink: (step) => send(ws, { type: "tool", seat, ...step }) };
  conn.sessionId = say.sessionId;
  // one ending per turn: the seat ends it when its answer is complete; a refusal, a throw or a stop ends it in the
  // finally below, once (an error alone left the creature thinking the turn ran on)
  let ended = false;
  const end = (m: object) => { if (ended) return; ended = true; send(conn.ws, { type: "done", seat, ...m }); };
  try {
    if (say.sessionId && !(await threadExists(HOME, seat, say.sessionId))) {
      send(ws, { type: "error", message: `this conversation is not a ${seat} conversation; start a new one on this seat` });
      return;
    }
    if (say.sessionId && conn.chars === 0) {
      const old = await openThread(HOME, seat, say.sessionId).catch(() => []);
      conn.chars = old.reduce((n, m) => n + m.text.length, 0);
    }
    conn.chars += say.text.length;
    const saved = say.files?.length ? await saveFiles(HOME, say.files) : [];
    // what Marco did on the desk since the seat last spoke, and, once past 100 presses on the rails, the one ask (arrange.ts)
    const deskLines = [takeDeskLines(say.sessionId ?? say.draft), oneAsk()].filter(Boolean).join("\n\n");
    // A brand-new conversation gets a name after its first answer: watch the wire for the text and the done.
    const fresh = !say.sessionId;
    let answer = "";
    if (fresh) {
      conn.ws = {
        get readyState() { return ws.readyState; },
        send: (line: string) => {
          ws.send(line);
          const m = JSON.parse(line);
          if (m.type === "delta") answer += m.text;
          else if (m.type === "done" && m.ok && m.sessionId) void nameThread(seat, m.sessionId, say.text, answer);
        },
      };
    }
    try {
      return seat === "codex" ? await sayCodex(conn, say, abort, saved, turn, deskLines, end) : await sayClaude(conn, say, abort, saved, turn, deskLines, end);
    } finally {
      conn.ws = ws;
      if (say.door && conn.sessionId) touchDoor(say.door, conn.sessionId);
    }
  } catch (err) {
    // a turn that could not start (an attachment that would not save: disk full, #11 adverse run) still ends, so the
    // box does not stay thinking
    send(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    end({ sessionId: conn.sessionId, ...(abort.signal.aborted ? { stopped: true } : { ok: false }) });
  }
}
type End = (m: object) => void;

// ---- names, settings: shared by every connected face ----

// Which door a conversation belongs to, on the thread, so a face can label it.
// A conversation handed into Work carries moved: true (the mode mark in work.json, written by work.handover).
const withDoors = <T extends { sessionId: string }>(ts: T[]) => {
  const marks = workState().marks;
  return ts.map((t) => {
    const d = doorOf(t.sessionId), moved = marks[t.sessionId]?.mode === "work";
    return d || moved ? { ...t, ...(d ? { door: d } : {}), ...(moved ? { moved: true } : {}) } : t;
  });
};
function everyone(msg: object) {
  for (const c of wss.clients) send(c as unknown as Wire, msg);
}
async function broadcastThreads() {
  everyone({ type: "threads", threads: withDoors(await listThreads(HOME).catch(() => [])) });
}
// a new conversation is on the list as soon as its first turn starts, not when it ends (a long first turn kept it off
// the sidebar for its whole run); the short wait lets the seat write the first user line its title is cut from
const listSoon = () => { setTimeout(() => { void broadcastThreads(); }, 1500); };
const named = new Set<string>();
async function nameThread(seat: Seat, sessionId: string, first: string, answer: string) {
  if (named.has(sessionId)) return;
  named.add(sessionId);
  const t = await nameConversation(first, answer);
  if (!t) return; // the cut first message stays
  setTitle(sessionId, t);
  await broadcastThreads();
  broadcastSessions();   // a GPT talk in a folder is a row in Work's side (#182): it wears the name too
}
const settingsMsg = () => ({
  type: "settings",
  settings: getSettings(),
  haveVoiceKey: haveVoiceKey(),
  dictationModel: DICTATION_MODEL,
  up: { since: STARTED, port: PORT, health: health() },
});

// Codex reaches the browser through a small stdio MCP server that calls back into this engine. Each turn
// gets its own token, so the engine knows which conversation a browser call belongs to.
const turns = new Map<string, TurnCtx>();
function codexFor(token: string) {
  return new Codex({
    codexPathOverride: process.env.SOL_CODEX,   // SOL_CODEX: a stand-in codex binary, for tests
    config: {
      mcp_servers: {
        sol: {
          command: process.execPath,
          args: [join(HERE, "mcp-stdio.js")],
          env: { ENGINE_URL: `http://${HOST}:${PORT}`, SOL_TURN: token },
          // Codex asks approval for MCP tools by default; with approval_policy "never" that was a flat refusal
          // ("the browser tool is blocked"). Sol's tools are the inventory, so they are pre-approved.
          default_tools_approval_mode: "approve",
        },
      },
      // where my agent may speak, how it signs (Control, team.json): Codex's own developer instructions. The SDK has no
      // hook before a command runs (approvalPolicy "never"), so the wall for this seat is its sandbox: no network since
      // #11 (inventory.ts, networkAccessEnabled false), so its shell cannot reach GitHub, Discord or WhatsApp at all.
      developer_instructions: speakParagraph(getTeam()),
      // Home has one browser, Sol's. The bundled browser and computer-use plugins would open windows on
      // Marco's screen; off for this seat. (Marco's global skills still load; AGENTS.md tells Sol not to use them.)
      plugins: {
        "browser@openai-bundled": { enabled: false },
        "unified-computer-use@openai-bundled": { enabled: false },
        "computer-use@openai-bundled": { enabled: false },
      },
    },
  });
}

// A Codex item as a step, or null if it has nothing worth showing. `done` is whether the item completed.
function codexStep(item: any, done: boolean, base = HOME): Step | null {
  const id = String(item.id);
  if (item.type === "command_execution") {
    const { step, prefix } = commandStep(id, String(item.command ?? ""), base);
    if (!done) return step;
    return { ...step, done: true, ok: item.exit_code === 0, detail: trimDetail(prefix + String(item.aggregated_output ?? "")) };
  }
  if (item.type === "file_change") {
    const changes: { path: string; kind: string }[] = item.changes ?? [];
    const c = changes[0];
    const verb = c?.kind === "add" ? "writing" : c?.kind === "delete" ? "deleting" : "editing";
    const text = c ? `${verb} ${nice(c.path, base)}${changes.length > 1 ? ` (+${changes.length - 1})` : ""}` : "editing files";
    return { id, kind: "write", text, done, ok: done ? item.status !== "failed" : undefined };
  }
  if (item.type === "web_search") return { id, kind: "search", text: `searching: ${short(String(item.query ?? ""), 72)}`, done };
  if (item.type === "reasoning") {
    const t = String(item.text ?? "");
    return { id, kind: "reasoning", text: t ? firstSentence(t) : "thinking", done, detail: t || undefined };
  }
  if (item.type === "mcp_tool_call") return item.server === "sol" ? null : { id, kind: "note", text: `${item.server}: ${item.tool}`, done, ok: done ? item.status !== "failed" : undefined }; // sol's own steps come from the browser
  if (item.type === "error") return done ? { id, kind: "note", text: String(item.message ?? ""), done: true } : null;
  return null;
}

// ---- a GPT talk's folder (#182) ----
// The folder says where a talk works; the switch says who does it. A new GPT talk in a project folder runs Codex there:
// its sandbox (workspace-write, inventory.ts) writes inside that folder only, the network is off, nothing is asked. One
// with no folder, or with Marco's home or the root as its folder, works in Sol's home as before. A talk goes on where it
// started: the other machine's path is the same folder in this home, a folder that moved is where it went (#129, #181),
// and a talk whose folder is gone does not run.
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const realOr = (p: string) => { try { return realpathSync(p); } catch { return p; } };
function freshFolder(cwd?: string): string {
  if (typeof cwd !== "string" || !cwd.startsWith("/") || !isDir(cwd)) return HOME;
  const r = realOr(cwd);
  return r === realOr(homedir()) || r === "/" ? HOME : r;
}
/** where a Codex thread goes on: Sol's home for its own chats, its folder for a talk in one, null when that is gone */
async function codexFolderOf(sessionId: string): Promise<{ folder: string | null; recorded?: string }> {
  const rec = await codexCwd(sessionId);
  if (!rec) return { folder: HOME };
  const here = workFolderIn(rec, homedir(), isDir, relocated);
  if (!here) return { folder: null, recorded: rec };
  const r = realOr(here);
  return { folder: r === HOME ? HOME : r, recorded: rec };
}

async function sayCodex(conn: Conn, say: Say, abort: AbortController, saved: Awaited<ReturnType<typeof saveFiles>>, turn: TurnCtx, deskLines: string, end: End) {
  const ws = conn.ws;
  const where = say.sessionId ? await codexFolderOf(say.sessionId) : { folder: freshFolder(say.cwd) };
  if (!where.folder) { send(ws, { type: "error", message: `its folder is gone (${where.recorded}); start a new talk to go on` }); return; }
  const folder = where.folder, inFolder = folder !== HOME;
  const token = randomUUID();
  turns.set(token, turn);
  const opts = {
    model: say.model,
    modelReasoningEffort: codexEffort(say.effort),
    workingDirectory: folder,
    skipGitRepoCheck: true,
    sandboxMode: INV.codex.sandboxMode,
    approvalPolicy: "never" as const,
    networkAccessEnabled: INV.codex.networkAccessEnabled,
  };
  const codex = codexFor(token);
  // one writer per session (busy.ts): a Work run or another Life turn on this id is refused with the reason
  let unlock: () => void;
  try { unlock = lockSession(say.sessionId ?? say.draft ?? token, `life:${token}`, folder); }
  catch (err) { turns.delete(token); send(ws, { type: "error", message: (err as Held).message }); return; }
  // the busy entry says the folder (busy.ts busyIn): a rename (#181) or a side copy's removal waits for the turn
  let leave = joinBusy("life", say.sessionId ?? say.draft ?? token, "codex", folder);
  const thread = say.sessionId ? codex.resumeThread(say.sessionId, opts) : codex.startThread(opts);
  let sessionId = say.sessionId;
  const seen = new Map<string, string>(); // agent_message id -> text already sent
  const announced = new Set<string>(); // steps already started, so an update does not start them twice
  const step = (s: Step) => send(ws, { type: "tool", seat: "codex", ...s });
  const window = codexWindow(say.model);
  const push = (id: string, text: string) => {
    const prev = seen.get(id) ?? "";
    if (text.length > prev.length && text.startsWith(prev)) {
      conn.chars += text.length - prev.length;
      send(ws, { type: "delta", text: text.slice(prev.length) });
    } else if (text !== prev) {
      conn.chars += text.length;
      send(ws, { type: "delta", text: (prev ? "\n" : "") + text });
    }
    seen.set(id, text);
  };

  // Images go in as local_image; other files are named by path in the text.
  const text = [say.text, deskLines, attachedLines(saved)].filter(Boolean).join("\n\n");
  const input: string | UserInput[] = saved.some((f) => f.isImage)
    ? [{ type: "text", text }, ...saved.filter((f) => f.isImage).map((f) => ({ type: "local_image" as const, path: f.path }))]
    : text;

  try {
    const { events } = await thread.runStreamed(input, { signal: abort.signal });
    for await (const e of events as AsyncIterable<ThreadEvent>) {
      if (e.type === "thread.started") {
        sessionId = e.thread_id;
        if (!say.sessionId) {
          unlock = relockSession(say.draft ?? token, sessionId, `life:${token}`, folder);
          // the busy entry moves onto the thread's id (its row shows running); joined before the draft's leaves, so the
          // count never touches zero mid-turn (a renew waits on zero)
          const draftLeave = leave; leave = joinBusy("life", sessionId, "codex", folder); draftLeave();
        }
        turn.sessionId = sessionId;
        conn.sessionId = sessionId;
        if (!say.sessionId) {
          adoptTabs(say.draft, sessionId); adoptDesk(say.draft, sessionId);
          // a talk carried on from another (the switch, #182) nests under it in the side
          if (say.parent && /^[A-Za-z0-9_-]{8,80}$/.test(say.parent)) mark(sessionId, { parent: say.parent });
          if (!inFolder) listSoon();
        }
        if (inFolder) { invalidateCodex(); broadcastSessions(); }   // the row is in its folder at once
        send(ws, { type: "start", sessionId, seat: "codex", ...(inFolder ? { cwd: folder } : {}) });
      } else if (e.type === "item.started" || e.type === "item.updated" || e.type === "item.completed") {
        const done = e.type === "item.completed";
        if (e.item.type === "agent_message") {
          if (e.type !== "item.started") push(e.item.id, e.item.text);
        } else {
          // One step when it starts, one when it completes. Codex files notices as "error" items too
          // (e.g. "resumed with another model"): a note, not part of the answer. A turn that really fails says so on turn.failed.
          const s = codexStep(e.item, done, folder);
          if (s && (done || !announced.has(s.id))) {
            announced.add(s.id);
            step(s);
          }
        }
      }
      if (e.type === "turn.completed") {
        // e.usage is the thread's running total (every request of every turn, cached inside input): it only grows.
        // The rollout's last token_count says what is in the window now, and the window Codex really uses.
        const last = sessionId ? await codexLastUsage(sessionId) : null;
        send(ws, usageMsg(conn, last?.context ?? 0, last?.window || window));
        end({ sessionId, ok: true });   // a late abort (a new say while the child drains) is then no stop
        // every door hears what Sol just said (the notch and the island show it, whichever door asked)
        const said = [...seen.values()].join("\n").trim();
        if (said) everyone({ type: "said", seat: "codex", sessionId, text: said, ...(say.door ? { door: say.door } : {}) });
      } else if (e.type === "turn.failed") {
        send(ws, { type: "error", message: e.error.message });
        end({ sessionId, ok: false });
      }
    }
  } catch (err) {
    if (!abort.signal.aborted) send(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });   // handleSay ends it
  } finally {
    turns.delete(token);
    unlock(); leave();
    if (inFolder) { invalidateCodex(); broadcastSessions(); }   // the row's time, and it is not running any more
  }
}

// A Claude tool call as a step (not yet done), plus what to put before its result in the detail.
function claudeStep(id: string, name: string, input: any): { step: Step; prefix: string } | null {
  if (name.startsWith("mcp__sol__")) return null; // the browser and the desk report themselves
  const i = input ?? {};
  const path = typeof i.file_path === "string" ? nice(i.file_path) : typeof i.path === "string" ? nice(i.path) : "";
  const at = (k: Kind, text: string): { step: Step; prefix: string } => ({ step: { id, kind: k, text, done: false }, prefix: "" });
  switch (name) {
    case "Bash": {
      const cmd = String(i.command ?? "");
      // mutable mode: an edit to Sol's own face becoming a commit, or the last one undone, reads as what it is
      const which = solScript(HOME, cmd);
      if (which === "undo") return at("write", "undoing the last change to Sol");
      if (which === "mutate") return at("write", `changing Sol: ${short(cmd.trim().replace(/^\S+\s*/, "").replace(/^(['"])([\s\S]*)\1$/, "$2"), 72)}`);
      return commandStep(id, cmd);
    }
    case "Read": return at("read", `reading ${path}`);
    case "Glob": return at("read", `looking for ${short(String(i.pattern ?? ""), 60)}${path ? ` in ${path}` : ""}`);
    case "Grep": return at("read", `searching files for ${short(String(i.pattern ?? ""), 60)}`);
    case "Write": return at("write", `writing ${path}`);
    case "Edit": return at("write", `editing ${path}`);
    case "WebSearch": return at("search", `searching: ${short(String(i.query ?? ""), 72)}`);
    case "WebFetch": return at("search", `fetching ${hostOf(String(i.url ?? ""))}`);
  }
  const arg = i.description ?? i.command ?? i.pattern ?? i.url ?? i.query ?? Object.values(i).find((v) => typeof v === "string");
  return at("note", typeof arg === "string" && arg ? `${name}: ${short(arg.startsWith("/") ? nice(arg) : arg)}` : name);
}
// The text of a tool_result block (a string, or text blocks).
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: any) => (c?.type === "text" ? String(c.text ?? "") : c?.type === "image" ? "[image]" : "")).filter(Boolean).join("\n");
  return "";
}

async function sayClaude(conn: Conn, say: Say, abort: AbortController, saved: Awaited<ReturnType<typeof saveFiles>>, turn: TurnCtx, deskLines: string, end: End) {
  const ws = conn.ws;
  const model = say.model ?? "claude-opus-5-5";
  // The browser tools, in this process, as MCP server "sol".
  const sol = createSdkMcpServer({
    name: "sol",
    version: "1.0.0",
    tools: SOL_TOOLS.map((t) => tool(t.name, t.description, t.shape, async (args) => (await runSolTool(t.name, args, turn)) as any)),
  });
  const options: Options = {
    model,
    effort: (say.effort ?? "medium") as Options["effort"], // "max" is valid for Claude as is
    cwd: HOME,
    resume: say.sessionId,
    // "user" settings are left out on purpose: an allow rule there would skip the Home checks below.
    settingSources: ["project"],
    systemPrompt: { type: "preset", preset: "claude_code", append: speakParagraph(getTeam()) },   // where my agent may speak (Control)
    permissionMode: INV.claude.permissionMode,
    allowedTools: INV.claude.allowedTools,
    tools: INV.claude.tools.concat(SOL_TOOLS.map((t) => "mcp__sol__" + t.name)),
    canUseTool: guardSpeak(INV.claude.canUseTool(HOME)),
    includePartialMessages: true,
    maxTurns: 50,
    abortController: abort,
    mcpServers: { sol },
  };

  const text = [say.text, deskLines, attachedLines(saved)].filter(Boolean).join("\n\n");
  // Images go in as base64 image blocks, so the prompt becomes a one-message stream.
  const images = saved.filter((f) => f.isImage);
  const prompt: string | AsyncIterable<SDKUserMessage> = images.length
    ? (async function* () {
        yield {
          type: "user",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: [
              { type: "text", text },
              ...images.map((f) => ({
                type: "image" as const,
                source: { type: "base64" as const, media_type: f.mime as "image/png", data: f.dataBase64 },
              })),
            ],
          },
        } satisfies SDKUserMessage;
      })()
    : text;

  let sessionId = say.sessionId;
  const token = randomUUID();
  let unlock: () => void;
  try { unlock = lockSession(say.sessionId ?? say.draft ?? token, `life:${token}`); }
  catch (err) { send(ws, { type: "error", message: (err as Held).message }); return; }
  const leave = joinBusy("life", say.sessionId ?? say.draft ?? token, "claude");
  let context = 0;
  let window = claudeWindowGuess(model);
  const step = (s: Step) => send(ws, { type: "tool", seat: "claude", ...s });
  const pending = new Map<string, { step: Step; prefix: string }>(); // tool_use id -> its step, until the tool_result pairs it
  const thinking: string[] = []; // reasoning steps started while the stream was thinking, completed by the assistant message
  try {
    for await (const m of query({ prompt, options }) as AsyncIterable<SDKMessage>) {
      if (m.type === "system" && m.subtype === "init") {
        sessionId = m.session_id;
        if (!say.sessionId) unlock = relockSession(say.draft ?? token, sessionId, `life:${token}`);
        turn.sessionId = sessionId;
        conn.sessionId = sessionId;
        if (!say.sessionId) { adoptTabs(say.draft, sessionId); adoptDesk(say.draft, sessionId); listSoon(); }
        send(ws, { type: "start", sessionId, seat: "claude" });
      } else if (m.type === "stream_event") {
        const ev = m.event;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          conn.chars += ev.delta.text.length;
          send(ws, { type: "delta", text: ev.delta.text });
        } else if (ev.type === "content_block_start" && (ev as any).content_block?.type === "thinking") {
          const id = randomUUID();
          thinking.push(id);
          step({ id, kind: "reasoning", text: "thinking", done: false });
        }
      } else if (m.type === "assistant") {
        let said = "";   // the seat's words before a tool call: its one line about what it changes
        for (const b of m.message.content as any[]) {
          if (b.type === "text") said += String(b.text ?? "") + "\n";
          if (b.type === "tool_use") {
            changing.tool("claude", sessionId, String(b.id), b.name, b.input, HOME, said);
            const s = claudeStep(String(b.id), b.name, b.input);
            if (s) { pending.set(String(b.id), s); step(s.step); }
          } else if (b.type === "thinking") {
            const t = String(b.thinking ?? "");
            step({ id: thinking.shift() ?? randomUUID(), kind: "reasoning", text: t ? firstSentence(t) : "thinking", done: true, detail: t || undefined });
          }
        }
        const u = m.message.usage;
        if (u) {
          context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          send(ws, usageMsg(conn, context, window));
        }
      } else if (m.type === "user") {
        // Tool results come back as user messages; pair each with its step.
        const content = (m as any).message?.content;
        if (Array.isArray(content)) for (const b of content) {
          if (b?.type !== "tool_result") continue;
          void changing.result(String(b.tool_use_id), !b.is_error, b.content);
          const p = pending.get(String(b.tool_use_id));
          if (!p) continue;
          pending.delete(String(b.tool_use_id));
          const ok = !b.is_error;
          const k = p.step.kind;
          const detail = k === "command" || k === "search" || !ok ? trimDetail(p.prefix + resultText(b.content)) : undefined;
          step({ ...p.step, done: true, ok, detail: detail || undefined });
        }
      } else if (m.type === "result") {
        // The result knows the real window; prefer it.
        const real = (m.modelUsage?.[model] ?? Object.values(m.modelUsage ?? {})[0])?.contextWindow;
        if (real && real !== window) {
          window = real;
          send(ws, usageMsg(conn, context, window));
        }
        end({
          sessionId: m.session_id,
          turns: m.num_turns,
          costEstimate: m.total_cost_usd,
          ok: m.subtype === "success",
          subtype: m.subtype,
        });
      }
    }
  } catch (err) {
    if (!abort.signal.aborted) send(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    changing.turn("claude", sessionId);   // whatever is still taped on the face peels
    unlock(); leave();
  }
}

// ---- http and websocket ----

// The door (engine/src/door.ts, tested by `npm test`): Sol's own pages on loopback, the owner over the tailnet, and
// over the tailnet only the away page this engine serves or a program with no Origin. The value of SOL_OWNER is never logged.
const DOOR = { port: PORT, owner: process.env.SOL_OWNER ?? "" };
const tailnetOk = (headers: import("node:http").IncomingHttpHeaders) => tailnetDoor(headers, DOOR);
const solPage = (req: import("node:http").IncomingMessage) => doorOpen(req.headers, DOOR);

// The built away page and its assets (sol/mac/dist, or SOL_DIST), read only, nothing outside that folder.
const DIST = resolve(process.env.SOL_DIST ?? resolve(HERE, "..", "..", "mac", "dist"));
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".html": "text/html; charset=utf-8",
};
function serveDist(rel: string, res: import("node:http").ServerResponse) {
  const full = resolve(DIST, rel);
  const ext = full.slice(full.lastIndexOf("."));
  try {
    if (!full.startsWith(DIST + "/") || !TYPES[ext]) throw new Error("no");
    const real = realpathSync(full);
    if (!real.startsWith(DIST + "/") || !statSync(real).isFile()) throw new Error("no");
    res.writeHead(200, { "content-type": TYPES[ext], "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600" });
    createReadStream(real).pipe(res);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

const http = createServer(async (req, res) => {
  if (!tailnetOk(req.headers) || !solPage(req)) { res.writeHead(403); res.end(); return; }
  const path = (req.url ?? "").split("?")[0];
  if ((path === "/away" || path === "/away/") && req.method === "GET") return serveDist("away.html", res);
  if (path.startsWith("/assets/") && req.method === "GET") {
    let rel = "";
    try { rel = decodeURIComponent(path.slice(1)); } catch { res.writeHead(404); res.end(); return; }
    if (rel.includes("\0")) { res.writeHead(404); res.end(); return; }
    return serveDist(rel, res);
  }
  if (path === "/health") {
    // a page of Sol's own (the door let it in) may read it across origins: the face asks this Mac's engine whether it is
    // quiet before it goes back to the NucBox (One Sol, #62)
    const origin = req.headers.origin;
    res.writeHead(200, { "content-type": "application/json", ...(typeof origin === "string" ? { "access-control-allow-origin": origin, vary: "origin" } : {}) });
    res.end(JSON.stringify({ ok: true, engine: "sol", pid: process.pid, port: PORT, since: STARTED, busy: busyList() }));
    return;
  }
  if (path === "/letgo" && req.method === "POST") {
    // the same page, going back: granted only while quiet, and then no new turn starts here for a moment (busy.ts)
    const origin = req.headers.origin;
    res.writeHead(200, { "content-type": "application/json", ...(typeof origin === "string" ? { "access-control-allow-origin": origin, vary: "origin" } : {}) });
    res.end(JSON.stringify(letGo() ? { ok: true } : { ok: false, busy: busyList() }));
    return;
  }
  if (path === "/file" && req.method === "GET") return serveFile(HOME, req, res);
  if (path === "/pane-image" && req.method === "GET") return servePaneImage(req, res);
  if (path.startsWith("/pane-asset/") && req.method === "GET") return servePaneAsset(req, res);   // a page's own files, the page pane (#54)
  if ((path === "/tool" || path === "/browser") && req.method === "POST") { // /browser: alias for one round
    // Only the stdio MCP script uses this. Requires JSON, which a web page cannot send without a preflight.
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
      res.writeHead(415);
      res.end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    let r;
    try {
      const { name, args, turn } = JSON.parse(body);
      const t = turns.get(String(turn));
      if (!t) { res.writeHead(403); res.end("no such turn"); return; } // a stale token must not open tabs nobody owns
      r = await runSolTool(String(name), args, t);
    } catch {
      r = { content: [{ type: "text", text: "bad request" }], isError: true };
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(r));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });
// Two sockets share this port (Together, #31): the team relay at /relay (team/relay.ts, its own gate: the relay key),
// and everything else, the faces' socket, through the door as before.
// #102: the hub keeps talk and pings for whoever is away (its spool, under the state dir), and with an org in team.json
// it knows people by their GitHub sign-in instead of the key
const relayHub = relayServer(PORT, () => (getTeam().relay.host ? getTeam().relay.key : ""),
  new RelayHub({ spool: new Spool(join(STATE_DIR, "relay", "spool")), people: () => (getTeam().org ? teamMembers() : []) }),
  { org: () => getTeam().org });
http.on("upgrade", (req, socket, head) => {
  if ((req.url ?? "").split("?")[0] === "/relay") return relayHub.upgrade(req, socket, head);
  if (tailnetOk(req.headers) && solPage(req)) return wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  const h = req.headers;   // a refused window says who it was, so a wrong gate shows in the log instead of as a silent "engine is starting"
  console.log(`door: refused a socket, origin=${h.origin ?? "none"} site=${h["sec-fetch-site"] ?? "none"} ua=${String(h["user-agent"] ?? "").slice(0, 60)}`);
  socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  socket.destroy();
});

// The heartbeat (#17): a protocol ping to every socket every 20 s; one that has not answered the one before is closed
// (after a Mac sleeps, its socket stays open here for good otherwise, and a turn keeps writing into it). A beat far
// later than asked means this engine was stopped itself (the machine slept, SIGSTOP): the answers queued behind the
// pause are not read yet, so that round ends nobody.
const BEAT_MS = 20_000;
const answered = new WeakMap<WebSocket, boolean>();
let lastBeat = Date.now();
setInterval(() => {
  const now = Date.now(), gap = now - lastBeat, late = gap > BEAT_MS * 1.5;
  lastBeat = now;
  if (late) console.log(`heartbeat: ${Math.round(gap / 1000)} s since the last beat, so this engine was paused; nobody is closed this round`);
  for (const c of wss.clients) {
    if (!late && answered.get(c) === false) { console.log("heartbeat: a face stopped answering; its socket is closed"); c.terminate(); continue; }
    answered.set(c, false);
    try { c.ping(); } catch { /* closing already */ }
  }
}, BEAT_MS).unref();

// the text of a conversation's messages and its folder, for run.ts to find the command in
const findRun: Finder = async (seat, sessionId, work?: boolean) => {
  if (work) {
    const items = (await sessionItems(sessionId).catch(() => null))?.list ?? getRun(sessionId)?.items.list ?? [];
    const live = getRun(sessionId)?.items.list ?? items;
    const text = live.filter((i: any) => i.kind === "you").map((i: any) => String(i.text ?? "")).join("\n\n");
    return { text, cwd: getRun(sessionId)?.cwd ?? (await sessionInfo(sessionId))?.cwd };
  }
  const msgs = await openThread(HOME, seat, sessionId);
  return { text: msgs.filter((x) => x.who === "you").map((x) => x.text).join("\n\n") };
};

wss.on("connection", (ws, req) => {
  const fromSol = solPage(req);
  let current: AbortController | null = null;
  let call: Call | null = null;
  let dialing: { hung: boolean } | null = null;   // a call whose conversation is still being read, before its Call exists
  let sample: Sample | null = null;
  let turn: Relay | null = null;   // the Life turn this socket started or took back (src/relay.ts)
  const conn: Conn = { ws, chars: 0 };
  answered.set(ws, true);
  ws.on("pong", () => answered.set(ws, true));
  const hearing = { busy: false, next: null as { audio: string; tag?: number } | null, gen: 0 };   // dictation previews in flight
  // A seat turn run for the call: the face sees it like any turn; the answer text also comes back here.
  const askSeat = (say: Say, abort: AbortSignal) => new Promise<string>((ok, no) => {
    let text = "";
    let error = "";
    const tap: Wire = {
      readyState: WebSocket.OPEN,
      send: (line) => {
        send(ws, JSON.parse(line));
        const m = JSON.parse(line);
        if (m.type === "delta") text += m.text;
        else if (m.type === "error") error = m.message;
        else if (m.type === "done") { if (m.sessionId) conn.sessionId = m.sessionId; if (text || !error) ok(text); else no(new Error(error)); }
      },
    };
    const ac = new AbortController();
    abort.addEventListener("abort", () => ac.abort(), { once: true });
    void handleSay({ ...conn, ws: tap }, say, ac).then(() => { if (!text && error) no(new Error(error)); ok(text); }, no);
  });
  const face = { send: (m: object) => send(ws, m) };
  addFace(face);
  if (REVERTED) send(ws, { type: "engine.reverted", at: REVERTED });
  addDeskFace(face);
  addWorkFace(face);
  addTeamFace(face);
  addPingFace(face);
  addCreatureFace(ws, face);
  send(ws, settingsMsg());
  ws.on("message", async (raw) => {
    let msg: In;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "error", message: "bad json" });
    }
    answered.set(ws, true);
    if ((msg as any).type === "ping") return send(ws, { type: "pong", at: (msg as any).at });   // the face's heartbeat (#17)
    if (refusedWhileLettingGo(msg.type)) {
      // a window just went back to the NucBox (One Sol, #62): nothing new starts on this Mac meanwhile
      const message = "Sol is moving to the NucBox; say it again there in a moment";
      const m = msg as any;
      return send(ws, msg.type.startsWith("work.") ? { type: "work.error", sessionId: m.sessionId, message } : msg.type.startsWith("team.") ? { type: "team.error", rid: m.rid, message } : { type: "error", message });
    }
    if (typeof msg.type === "string" && msg.type.startsWith("work.")) {
      // work.handover: no face sends it since Home (#132) holds chats and sessions in one window; kept unused for one
      // release, it goes with #25's clean-up. A Codex one is carried as its words (Work runs Claude), read here
      if (msg.type === "work.handover" && (msg as any).seat === "codex") (msg as any).said = await openThread(HOME, "codex", String((msg as any).sessionId)).catch(() => []);
      const handover = msg.type === "work.handover" ? String((msg as any).sessionId ?? "") : "";
      try {
        await handleWork(face, msg);
        // once it went (the mode mark is written), the threads show it moved
        if (handover && workState().marks[handover]?.mode === "work") void broadcastThreads();
      } catch (err) {
        send(ws, { type: "work.error", sessionId: (msg as any).sessionId, message: err instanceof Error ? err.message.split("\n")[0] : String(err) });
      }
    } else if (typeof msg.type === "string" && msg.type.startsWith("team.")) {
      try { await handleTeam(face, msg); }
      catch (err) { send(ws, { type: "team.error", rid: (msg as any).rid, message: err instanceof Error ? err.message.split("\n")[0] : String(err) }); }
    } else if (msg.type === "face.broken" || msg.type === "face.mended") {
      const m = msg as any;   // only Sol's own windows: a page elsewhere must not make the engine take edits back
      if (fromSol && typeof m.site === "string") m.type === "face.broken" ? changing.broke(m.site, String(m.error ?? "")) : changing.mended(m.site);
    } else if (msg.type === "notify.seen") {
      seenPing(String((msg as any).id ?? ""), face);
    } else if (msg.type === "notify.ack") {
      ackPing(String((msg as any).id ?? ""), face);
    } else if (msg.type === "hello") {
      const role = (msg as any).face as Role;
      if (role === "window" || role === "notch" || role === "phone") { setRole(ws, role); pingFaceIs(face, role); }
    } else if (msg.type === "presence") {
      const m = msg as any;
      setPresence(ws, !!m.focused, typeof m.idleSeconds === "number" ? m.idleSeconds : null);
    } else if (msg.type === "dictation") {
      setDictation(ws, !!(msg as any).on);
    } else if (msg.type === "goback.plan" || msg.type === "goback") {
      // the Go back row (#18): only Sol's own windows; `goback` runs sol/back and ends this engine at once, not at a
      // quiet moment (it is for a broken Sol), so its keeper brings the good build up
      if (!fromSol) send(ws, { type: "goback.plan", line: "only Sol's own windows can go back" });
      else if (msg.type === "goback.plan") send(ws, { type: "goback.plan", ...(await goBackPlan(resolve(HERE, "..", ".."))) });
      else {
        console.log("goback: Marco pressed go back");
        const r = await goBack(resolve(HERE, "..", ".."));
        for (const l of r.lines) console.log(`goback: ${l}`);
        everyone({ type: "goback.done", ok: r.ok, lines: r.lines });
        if (r.ok) setTimeout(() => process.exit(0), 300);   // the word gets out, then the keeper starts the good build
      }
    } else if (msg.type === "stop") {
      // { type: "stop", sessionId } (Notch buttons #6): the Life turn on that conversation, whichever face runs it
      // (the notch's Stop; the window's turn runs on the window's socket). Without one: this socket's own turn.
      // The relay holds the turn's abort by its draft and, once the seat names it, by its session id.
      const sid = (msg as any).sessionId;
      if (typeof sid === "string" && sid) relayFor(sid)?.abort.abort();
      else current?.abort();
    } else if (msg.type === "say") {
      current?.abort();
      const mine = (current = new AbortController());
      const say = msg as Say;
      say.seat ??= getTeam().seats.life;   // a door, the phone: Life's helper is the person's pick (Control, team.json)
      // every say has an id before anything keys on it (lock, busy, creature, relay): a door's say carries none, so
      // its Stop had nothing to find. The door's own last conversation, else the face's draft, else a new draft.
      say.sessionId = await doorConversation(say.door, say.seat, say.sessionId, say.fresh);
      if (!say.sessionId) say.draft ??= randomUUID();
      const sid = (say.sessionId ?? say.draft)!;
      lifeTurn(ws, sid, say.seat);   // the notch follows the conversation that spoke last (creature.turn)
      // the turn writes to a relay, not to this socket: if the socket goes (a sleep), the turn runs on and a face that
      // opens the conversation again takes it back (src/relay.ts). Its own copy of conn, so the socket a fresh
      // conversation's naming wraps is the relay's.
      const relay = (turn = new Relay(ws, say.seat ?? "codex", String(say.text ?? ""), say.draft, say.sessionId, mine, send));
      const own: Conn = { ws: relay, sessionId: conn.sessionId, chars: conn.chars };
      conn.sessionId = say.sessionId;
      void handleSay(own, say, mine).finally(() => {
        relay.end();
        if (relay.target === ws) { conn.sessionId = own.sessionId; conn.chars = own.chars; }
        if (turn === relay) turn = null;
        if (current === mine) current = null;
      });
    } else if (msg.type === "list") {
      send(ws, { type: "threads", threads: withDoors(await listThreads(HOME).catch(() => [])) });
    } else if (msg.type === "open") {
      const o = msg as Open;
      // the face's re-sync after its link came back (resume): a Life turn still out on this conversation, or on the
      // draft the seat has not named yet, is given back (src/relay.ts). A plain open (another face, the thread list)
      // takes a turn back only when no socket holds it.
      const holder = () => { const r = relayFor(o.sessionId) ?? relayFor(o.draft); return r && (o.resume || !r.target || r.target.readyState !== WebSocket.OPEN) ? r : undefined; };
      const sessionId = o.sessionId ?? holder()?.sessionId;
      const seat = o.seat ?? holder()?.seat ?? "codex";
      let msgs = sessionId ? await openThread(HOME, seat, sessionId).catch(() => []) : [];
      // file urls in a transcript are relative to this engine; make them whole
      for (const m of msgs) for (const f of m.files ?? []) f.url = `http://${HOST}:${PORT}${f.url}`;
      const settings = sessionId ? await threadSettings(HOME, seat, sessionId).catch(() => ({})) : {};
      const u = seat === "codex" && sessionId ? await codexLastUsage(String(sessionId)).catch(() => null) : null;
      // a GPT talk in a project folder says which (#182): the face shows "in <folder>" and its next say goes on there
      const at = seat === "codex" && sessionId ? await codexFolderOf(String(sessionId)).catch(() => ({ folder: HOME })) : { folder: HOME };
      const where = at.folder === null ? { cwd: (at as { recorded?: string }).recorded, gone: true } : at.folder !== HOME ? { cwd: at.folder } : {};
      // from here on nothing waits: the relay's events cannot slip in between the record and the replay
      const r = holder();
      if (r) msgs = r.thread(msgs);
      send(ws, { type: "thread", seat, sessionId: sessionId ?? r?.sessionId, msgs, ...settings, ...where });
      if (seat === "codex") {
        // the ring should be right the moment a conversation opens, not after its next turn
        conn.chars = msgs.reduce((n, m) => n + m.text.length, 0);
        if (u) send(ws, usageMsg(conn, u.context, u.window));
      }
      if (r) {
        const running = !r.finished;
        if (running && r.target && r.target !== ws) console.log("relay: a turn moved to the face that came back");
        r.attach(ws);
        if (running) { turn = r; current = r.abort; lifeTurn(ws, r.sessionId ?? r.draft, r.seat); }
        send(ws, { type: "resumed", seat: r.seat, sessionId: r.sessionId, draft: r.draft, running, ok: r.ok });
        console.log(`relay: a face came back to a ${r.seat} turn, ${running ? "still running" : "finished while it was away"}`);
      }
    } else if (msg.type === "models") {
      send(ws, { type: "models", seats: seatsMsg(), codex: codexModels(), claude: CLAUDE_MODELS, efforts: EFFORTS });
    } else if (msg.type === "hear") {
      const m = msg as any;
      if (m.done === false) {
        // a preview while dictation goes on: the clip so far; while one is being read the newest waiting clip wins
        hearing.next = { audio: String(m.audio ?? ""), tag: m.tag };
        if (hearing.busy) return;
        hearing.busy = true;
        const gen = hearing.gen;
        while (hearing.next !== null && hearing.gen === gen) {
          const clip = hearing.next; hearing.next = null;
          const r = await transcribe(HOME, clip.audio);
          if (!r.why && hearing.gen === gen) send(ws, { type: "heard", text: r.text, partial: true, tag: clip.tag }); // the tag says which clip these words are
        }
        hearing.busy = false;
        return;
      }
      hearing.gen++; hearing.next = null;   // the final reading: no preview after it
      const r = await transcribe(HOME, String(m.audio ?? ""));
      send(ws, r.why ? { type: "heard", text: "", why: r.why } : { type: "heard", text: r.text });
    } else if (msg.type === "settings.get") {
      send(ws, settingsMsg());
    } else if (msg.type === "settings.set") {
      patchSettings((msg as any).patch);
      everyone(settingsMsg());
    } else if (msg.type === "arrange.get") {
      send(ws, arrangeMsg());
    } else if (msg.type === "arrange.set") {
      // a change is told to every face; a refusal only to the one that asked, with its line
      const r = setArrangement((msg as any).patch);
      if (!r.ok) send(ws, { ...arrangeMsg(), refused: r.why });
    } else if (msg.type === "arrange.undo") {
      undoArrangement();   // the undo note's press: the agent's last change taken back, every face told
    } else if (msg.type === "arrange.used") {
      addUsage((msg as any).counts);   // a minute's presses, added in; no face is told
    } else if (msg.type === "thread.rename") {
      const m = msg as any;
      if (typeof m.sessionId === "string" && /^[A-Za-z0-9_-]+$/.test(m.sessionId)) {
        setTitle(m.sessionId, String(m.title ?? ""));
        await broadcastThreads();
        broadcastSessions();   // a GPT talk in a folder is named in Work's side too (#182)
      }
    } else if (msg.type === "voice.sample") {
      sample?.cancel();
      const mine = (sample = new Sample(String((msg as any).voice ?? getSettings().voice), (o) => send(ws, o)));
      void mine.start().finally(() => { if (sample === mine) sample = null; });
    } else if (msg.type === "call") {
      if (!haveVoiceKey()) return send(ws, { type: "call", ok: false, why: "no voice key: put GEMINI_API_KEY in sol/engine/.env" });
      if ((call && !call.done) || dialing) return;
      const m = msg as any;
      const seat: Seat = m.seat ?? getTeam().seats.life;
      const door = asDoor(m.door);
      const dial = (dialing = { hung: false });
      let sessionId: string | undefined, history: Awaited<ReturnType<typeof openThread>> = [];
      try {
        sessionId = await doorConversation(door, seat, m.sessionId, m.fresh);
        history = sessionId ? await openThread(HOME, seat, sessionId).catch(() => []) : [];
      } finally { dialing = null; }
      if (dial.hung) return send(ws, { type: "call", ok: true, state: "ended" });   // hung up before it was up
      conn.sessionId = sessionId;
      const mine = (call = new Call({
        home: HOME,
        history,
        send: (o) => {
          const t = o as any;
          // the call's state carries the conversation, so a door learns which one it is in (a fresh one is named by the seat)
          send(ws, t.type === "call" && t.state ? { ...t, sessionId: sessionId ?? conn.sessionId } : o);
          if (t.type === "call.text" && t.who === "you" && t.final && t.text) everyone({ type: "said", seat, sessionId: sessionId ?? conn.sessionId, text: t.text, ...(door ? { door } : {}) });
          if (t.type === "call" && t.state === "ended" && door && (sessionId ?? conn.sessionId)) touchDoor(door, (sessionId ?? conn.sessionId)!);
        },
        step: (s) => send(ws, { type: "tool", seat, ...s }),
        ask: async (text, abort) => {
          const answer = await askSeat({ type: "say", text, seat, sessionId: sessionId ?? conn.sessionId, draft: sessionId ? undefined : m.draft, model: m.model, effort: m.effort, ...(door ? { door } : {}) }, abort);
          sessionId = conn.sessionId ?? sessionId;
          return answer;
        },
      }));
      try { await mine.start(); } catch (err) {
        send(ws, { type: "call", ok: false, why: "voice: " + (err instanceof Error ? err.message.split("\n")[0] : String(err)) });
        if (call === mine) call = null;
      }
    } else if (msg.type === "call.audio") {
      call?.audio(String((msg as any).data ?? ""));
    } else if (msg.type === "call.end") {
      if (dialing) dialing.hung = true;   // an end before the call exists still ends it
      const c = call; call = null;
      await c?.end();
    } else if (msg.type === "run" || msg.type === "run.stop") {
      const m = msg as any;
      if (!fromSol) send(ws, { type: "ran", rid: String(m.rid ?? ""), done: true, code: null, why: "only Sol's own windows can run" });
      else if (m.type === "run.stop") stopBlock(String(m.rid));
      else void runBlock(m, (seat, id) => findRun(seat, id, !!m.work), HOME, (o) => send(ws, o));
    } else if (msg.type === "desk.act" || msg.type === "desk.get") {
      const m = msg as any;
      try {
        if (m.type === "desk.get") send(ws, deskMsg(m.sessionId));
        else await actDesk(m.sessionId, String(m.id), String(m.act), m);
      } catch (err) {
        send(ws, { type: "error", message: "desk: " + (err instanceof Error ? err.message.split("\n")[0] : String(err)) });
      }
    } else if (typeof msg.type === "string" && msg.type.startsWith("browser.")) {
      const m = msg as any;
      try {
        if (m.type === "browser.watch") await watch(face, m.tab ?? null);
        else if (m.type === "browser.open") await openTab(String(m.url ?? ""), m.sessionId);
        else if (m.type === "browser.close") await closeTab(String(m.tab));
        else if (m.type === "browser.select") selectTab(String(m.tab));
        else if (m.type === "browser.input") await inputTab(String(m.tab), m.event);
        else if (m.type === "browser.navigate") await navigateTab(String(m.tab), m.action);
        else if (m.type === "browser.resize") await resizeTab(String(m.tab), Number(m.w), Number(m.h));
        else if (m.type === "browser.inspect") await inspectTab(face, m);
        else if (m.type === "browser.locate") await locateTab(face, m);
      } catch (err) {
        send(ws, { type: "error", message: "browser: " + (err instanceof Error ? err.message.split("\n")[0] : String(err)) });
      }
    }
  });
  ws.on("close", () => {
    // a Life turn out on this socket runs on (src/relay.ts): the face that comes back takes it; anything else stops
    if (turn && !turn.finished) { if (turn.detach(ws)) console.log(`relay: a face went away mid-turn; the ${turn.seat} turn runs on`); }
    else current?.abort();
    void call?.end(); call = null;
    if (dialing) dialing.hung = true;
    sample?.cancel(); sample = null;
    removeFace(face);
    removeDeskFace(face);
    removeWorkFace(face);
    removeTeamFace(face);
    removePingFace(face);
    removeCreatureFace(ws);
  });
});

http.listen(PORT, HOST, () => {
  console.log(`engine up on ws://${HOST}:${PORT}`);
  startTeam();   // the team relay's client and presence (team/wire.ts)
  // a new build of this engine goes live by itself, at a quiet moment (renew.ts); launchd brings it back
  renewOnBuild(resolve(HERE), engineIdle, everyone, busyLine);
  onBusy((jobs) => everyone({ type: "engine.busy", jobs }));
  void namingModel().then((m) => console.log("naming model:", m ?? "none (titles stay the cut first message)"));
});
