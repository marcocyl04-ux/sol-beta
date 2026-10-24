// Run (2026-10-16, Marco approved): he presses "run" on a code block in a message and the command runs, its output
// printed under the block the way Claude Code prints a tool result. The engine runs only what it finds, verbatim, in a
// fenced block of a message of that conversation (it reads the transcript itself), so a page cannot make one up.
// /bin/zsh -lc (bash where there is no zsh: Linux and WSL, #22) in the conversation's folder (a Work session's cwd,
// else home/), two minutes at most, stopped by "run.stop". Out: { type: "ran", rid, out?, done?, code?, why? }
// streamed as the output arrives.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { forbidden } from "./inventory.js";
import { join as joinBusy } from "./busy.js";

const SHELL = existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";

type Send = (o: object) => void;
export type Finder = (seat: "codex" | "claude", sessionId: string, work?: boolean) => Promise<{ text: string; cwd?: string } | null>;

const LIMIT_MS = 120_000, MAX_OUT = 200_000;
const live = new Map<string, ChildProcess>();

/** the command is in the conversation when some fenced block of a message holds it exactly */
export function holds(text: string, cmd: string): boolean {
  const want = cmd.trim();
  if (!want) return false;
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (m[1].trim() === want) return true;
  return false;
}

export async function runBlock(m: any, find: Finder, home: string, send: Send) {
  const rid = String(m.rid ?? ""), cmd = String(m.cmd ?? "");
  if (!rid || live.has(rid)) return;
  const seat = m.seat === "claude" ? "claude" : "codex";
  const found = await find(seat, String(m.sessionId ?? "")).catch(() => null);
  if (!found || !holds(found.text, cmd)) return send({ type: "ran", rid, done: true, code: null, why: "not a command of this conversation" });
  // a steered seat may print a command; the one thing it never gets to run is a read of the secrets (safety pass #11)
  const secret = cmd.split(/\s+/).map((w) => w.replace(/['"\\]/g, "")).find((w) => w && !w.startsWith("-") && forbidden(home, w))
    ?? cmd.replace(/['"\\]/g, "").match(/(^|[\s/~$}{])\.(hermes|codex|ssh|claude|gnupg|aws)\b|\.env\b|\/Keychains\b/)?.[0]?.trim();   // a glob or a variable in the path hides nothing
  if (secret) return send({ type: "ran", rid, done: true, code: null, why: `${secret} holds secrets; Sol does not run that` });
  let child: ChildProcess;
  try {
    child = spawn(SHELL, ["-lc", cmd], { cwd: found.cwd ?? home, env: { ...process.env, TERM: "dumb", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    return send({ type: "ran", rid, done: true, code: null, why: err instanceof Error ? err.message : String(err) });
  }
  live.set(rid, child);
  const leave = joinBusy("run", rid, cmd.split(/\s+/)[0]);
  send({ type: "ran", rid });   // started: the face stops waiting for an answer
  let total = 0, cut = false;
  const out = (chunk: Buffer) => {
    if (cut) return;
    total += chunk.length;
    if (total > MAX_OUT) { cut = true; send({ type: "ran", rid, out: "\n… output cut at 200 kB\n" }); child.kill("SIGTERM"); return; }
    send({ type: "ran", rid, out: chunk.toString("utf8") });
  };
  child.stdout?.on("data", out);
  child.stderr?.on("data", out);
  const timer = setTimeout(() => { send({ type: "ran", rid, out: "\n… stopped after two minutes\n" }); child.kill("SIGTERM"); }, LIMIT_MS);
  child.on("error", (err) => { clearTimeout(timer); live.delete(rid); leave(); send({ type: "ran", rid, done: true, code: null, why: err.message }); });
  child.on("close", (code, signal) => { clearTimeout(timer); live.delete(rid); leave(); send({ type: "ran", rid, done: true, code: code ?? (signal ? 130 : null) }); });
}

export function stopBlock(rid: string) { live.get(String(rid))?.kill("SIGTERM"); }
