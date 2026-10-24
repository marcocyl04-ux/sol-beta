// The Overview pane at parity with Claude Code's session rail (#40, PROTOCOL.md round 20): the context split, Remote
// Control (the away page over `tailscale serve`), and the changes card's summary and draft PR. The pure parts are
// tested in test/together-overview.test.ts; nothing here invents a number: what cannot be known is null ("—" on the
// face) and what is estimated is named in `est` (a dim "≈").
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { changes, pullRequest } from "./panes.js";

const run = promisify(execFile);

// ---- the context split ----
export const PARTS = ["messages", "mcpTools", "systemTools", "systemPrompt", "skills", "memory", "mcpInstructions", "agents", "buffer", "free"] as const;
export type PartKey = (typeof PARTS)[number];
export type Usage = {
  total: number; window: number;
  parts: Record<PartKey, number | null>;                 // null: this one cannot be known from here
  deferred: { mcpTools: number | null; systemTools: number | null };   // out of the window, listed for awareness
  lists: { mcp: string[]; memory: string[]; agents: string[] };       // mcp as "server:tool"
  compactSoon: boolean;
  threshold?: number;                         // where auto-compact fires, when the CLI says
  how: "counted" | "summary" | "estimated";   // counted by the token-count API; the SDK's quick estimate; bytes/4 here
  est: PartKey[];                             // the parts that are estimates
  rest?: number;                              // estimated only: in the window, not split (system, tools, skills, agents)
  more?: { name: string; tokens: number }[];  // a category the SDK names that is none of the ten
};

// what the SDK's getContextUsage answers (the fields this file reads)
export type ContextAnswer = {
  categories: { name: string; tokens: number; kind?: "used" | "free" | "buffer" | "deferred"; isDeferred?: boolean }[];
  totalTokens: number; maxTokens?: number; rawMaxTokens?: number;
  memoryFiles?: { path: string }[]; mcpTools?: { name: string; serverName: string }[]; agents?: { agentType: string }[];
  autoCompactThreshold?: number; isAutoCompactEnabled?: boolean;
};

const tool = (wire: string, server: string) => `${server}:${wire.startsWith(`mcp__${server}__`) ? wire.slice(server.length + 7) : wire}`;
const none = (): Record<PartKey, number | null> => Object.fromEntries(PARTS.map((k) => [k, null])) as Record<PartKey, number | null>;

// a used category by its name (the CLI's names, as on ss3); the kind decides free, buffer and deferred
function keyOf(name: string): PartKey | null {
  const n = name.toLowerCase();
  if (n.startsWith("messages")) return "messages";
  if (n.includes("mcp server instruction")) return "mcpInstructions";
  if (n.startsWith("mcp tool")) return "mcpTools";
  if (n.startsWith("system tool")) return "systemTools";
  if (n.startsWith("system prompt")) return "systemPrompt";
  if (n.startsWith("skill")) return "skills";
  if (n.startsWith("memory")) return "memory";
  if (n.includes("agent")) return "agents";
  return null;
}

// "soon": auto-compact is on and the total is within a tenth of where it fires; without the threshold, 80% of the window
export const soon = (total: number, window: number, threshold?: number, auto?: boolean) =>
  auto === false ? false : threshold ? total >= threshold * 0.9 : window > 0 && total >= window * 0.8;

// getContextUsage's answer as the pane's ten parts. "full" is counted: a category the CLI leaves out is 0. "summary" is
// the SDK's own estimate from the last response's usage: the used parts wear ≈.
export function fromContext(r: ContextAnswer, how: "counted" | "summary"): Usage {
  const parts = Object.fromEntries(PARTS.map((k) => [k, 0])) as Record<PartKey, number | null>;
  const deferred = { mcpTools: 0 as number | null, systemTools: 0 as number | null };
  const more: { name: string; tokens: number }[] = [];
  for (const c of r.categories ?? []) {
    const kind = c.kind ?? (c.isDeferred ? "deferred" : /^free/i.test(c.name) ? "free" : /buffer/i.test(c.name) ? "buffer" : "used");
    const t = Math.max(0, Math.round(c.tokens || 0));
    if (kind === "free") parts.free = (parts.free ?? 0) + t;
    else if (kind === "buffer") parts.buffer = (parts.buffer ?? 0) + t;
    else if (kind === "deferred") { if (/mcp/i.test(c.name)) deferred.mcpTools! += t; else deferred.systemTools! += t; }
    else { const k = keyOf(c.name); if (k) parts[k] = (parts[k] ?? 0) + t; else more.push({ name: c.name, tokens: t }); }
  }
  const window = r.rawMaxTokens || r.maxTokens || 0;
  const total = Math.max(0, Math.round(r.totalTokens || 0));
  return {
    total, window, parts, deferred,
    lists: {
      mcp: (r.mcpTools ?? []).map((m) => tool(m.name, m.serverName)),
      memory: (r.memoryFiles ?? []).map((m) => m.path),
      agents: (r.agents ?? []).map((a) => a.agentType),
    },
    compactSoon: soon(total, window, r.autoCompactThreshold, r.isAutoCompactEnabled),
    ...(r.isAutoCompactEnabled !== false && r.autoCompactThreshold ? { threshold: r.autoCompactThreshold } : {}),
    how, est: how === "summary" ? PARTS.filter((k) => k !== "free" && k !== "buffer") : [],
    ...(more.length ? { more } : {}),
  };
}

// A count is made at a turn's end; the API's own total moves on with every step of the next turn. What came since the
// count is the talk (messages), so it is added there, wearing ≈, and taken from the free space.
export function catchUp(u: Usage, context: number): Usage {
  const d = Math.round(context - u.total);
  if (!(d > 0) || u.how === "estimated") return u;
  const total = context;
  const parts = { ...u.parts, messages: (u.parts.messages ?? 0) + d, free: u.parts.free === null ? null : Math.max(0, u.parts.free - d) };
  return { ...u, total, parts, est: u.est.includes("messages") ? u.est : [...u.est, "messages"], compactSoon: soon(total, u.window, u.threshold) };
}

// Claude Code's own agents (init lists them with the user's); the rail's "Custom agents" are the others
const BUILT_IN = new Set(["general-purpose", "explore", "plan", "statusline-setup", "output-style-setup", "claude"]);

// When getContextUsage cannot answer (an older CLI, the run gone): the way Life does it (index.ts usageMsg), bytes/4.
// The total is the API's own count of the last turn (measured); messages are the talk's characters/4 and memory the
// CLAUDE.md files' bytes/4 (both ≈); the system prompt, tools, skills and agents cannot be split from here (null), and
// what they hold together is `rest` (≈). Free is the window less the total; the buffer is not known.
export function estimateUsage(a: {
  init: { tools?: string[]; agents?: string[]; mcp_servers?: { name: string }[] } | null;
  context: number; window: number; chars: number; memory: { path: string; bytes: number }[];
}): Usage {
  const parts = none();
  const total = Math.max(0, a.context);
  const mem = a.memory.length ? Math.round(a.memory.reduce((n, m) => n + m.bytes, 0) / 4) : null;
  const msgs = a.chars > 0 ? Math.min(total, Math.round(a.chars / 4)) : total ? null : 0;
  parts.messages = msgs;
  parts.memory = mem === null ? null : Math.min(mem, Math.max(0, total - (msgs ?? 0)));
  parts.free = a.window > 0 ? Math.max(0, a.window - total) : null;
  const est: PartKey[] = [];
  if (msgs !== null && a.chars > 0) est.push("messages");
  if (parts.memory !== null) est.push("memory");
  const tools = a.init?.tools ?? [];
  return {
    total, window: a.window, parts, deferred: { mcpTools: null, systemTools: null },
    lists: {
      mcp: tools.filter((t) => t.startsWith("mcp__")).map((t) => { const [, server = "", ...rest] = t.split("__"); return `${server}:${rest.join("__")}`; }),
      memory: a.memory.map((m) => m.path),
      agents: (a.init?.agents ?? []).filter((x) => !BUILT_IN.has(x.toLowerCase())),
    },
    compactSoon: soon(total, a.window),
    how: "estimated", est,
    rest: Math.max(0, total - (msgs ?? 0) - (parts.memory ?? 0)),
  };
}

// the CLAUDE.md files Claude Code loads for a folder: the user's, then each folder from the root down to cwd
export function memoryFiles(cwd: string): { path: string; bytes: number }[] {
  const out: { path: string; bytes: number }[] = [];
  const add = (p: string) => { try { if (existsSync(p)) out.push({ path: p, bytes: statSync(p).size }); } catch { /* unreadable */ } };
  add(join(homedir(), ".claude", "CLAUDE.md"));
  const dirs: string[] = [];
  for (let d = cwd; d && d !== dirname(d); d = dirname(d)) dirs.unshift(d);
  for (const d of dirs) { add(join(d, "CLAUDE.md")); add(join(d, "CLAUDE.local.md")); add(join(d, ".claude", "CLAUDE.md")); }
  return out;
}

// ---- Remote Control: the away page over `tailscale serve` ----
export const servePort = () => Number(process.env.SOL_PORT ?? process.env.PORT ?? 7777);
// on: the engine's port behind HTTPS on the tailnet (as live-setup does); off: only that HTTPS port's config goes,
// never `serve reset`, which would drop anything else Marco serves from the machine
export function serveArgs(on: boolean, port: number, https = 443): string[] {
  return on ? ["serve", "--bg", `--https=${https}`, String(port)] : ["serve", `--https=${https}`, "off"];
}
export type Serve = { on: boolean; url?: string; https?: number };
// `tailscale serve status --json`: on when a web handler proxies to this engine's port on loopback
export function parseServe(raw: string | object | null | undefined, port: number): Serve {
  let j: any = raw;
  if (typeof raw === "string") { try { j = JSON.parse(raw); } catch { return { on: false }; } }
  for (const [hostPort, site] of Object.entries<any>(j?.Web ?? {})) {
    for (const [path, h] of Object.entries<any>(site?.Handlers ?? {})) {
      const m = /^(?:https?:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\])?:?(\d+)\/?$/.exec(String(h?.Proxy ?? ""));
      if (!m || Number(m[1]) !== port) continue;
      const [host, p = "443"] = hostPort.split(/:(?=\d+$)/);
      const https = Number(p);
      const at = `https://${host}${https === 443 ? "" : `:${https}`}${path === "/" ? "" : path.replace(/\/$/, "")}`;
      return { on: true, url: `${at}/away`, https };
    }
  }
  return { on: false };
}
const TS = ["tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
async function ts(args: string[]) {
  let last: any;
  for (const bin of TS) {
    try { return (await run(bin, args, { timeout: 15_000 })).stdout; }
    catch (e: any) { if (e?.code === "ENOENT") { last = e; continue; } throw e; }
  }
  throw Object.assign(new Error("Tailscale is not on this machine"), { code: "ENOENT", cause: last });
}
const said = (e: any) => String(e?.stderr || e?.message || e).trim().split("\n")[0].slice(0, 240);
// on undefined: the status only. The face asks Marco once before it sends on: true.
export async function remote(on?: boolean): Promise<Serve & { error?: string }> {
  const port = servePort();
  try {
    const now = parseServe(await ts(["serve", "status", "--json"]), port);
    if (on === undefined || on === now.on) return now;
    await ts(serveArgs(on, port, now.https ?? 443));
    return parseServe(await ts(["serve", "status", "--json"]), port);
  } catch (e: any) {
    return { on: false, error: e?.code === "ENOENT" ? "Tailscale is not on this machine" : `tailscale said: ${said(e)}` };
  }
}

// ---- the changes card ----
export type PrShort = { number: number; url: string; draft: boolean; state: string };
export type Summary = { add: number; del: number; files: number; branch: string; pr?: PrShort } | { notGit: true };
export function summarize(c: { notGit?: boolean; files?: unknown[]; add?: number; del?: number; branch?: string }, p?: { pr?: any } | null): Summary {
  if (c.notGit) return { notGit: true };
  const pr = p?.pr;
  return {
    add: c.add ?? 0, del: c.del ?? 0, files: c.files?.length ?? 0, branch: c.branch ?? "",
    ...(pr && typeof pr.number === "number" ? { pr: { number: pr.number, url: String(pr.url ?? ""), draft: !!pr.isDraft, state: String(pr.state ?? "").toLowerCase() } } : {}),
  };
}
export async function changesSummary(cwd: string): Promise<Summary> {
  const c = await changes(cwd, "all");
  if ((c as any).notGit) return { notGit: true };
  return summarize(c, await pullRequest(cwd).catch(() => null));
}

// Create PR, when the pane has no form (PrPane shows a PR, it does not make one): the branch goes up, then a draft
// filled from its commits. Never from the main line or a detached head.
export function prRefusal(branch: string): string | null {
  if (!branch) return "no branch here (a detached head): a pull request needs a branch";
  if (["main", "master", "trunk", "live", "stable"].includes(branch)) return `you are on ${branch}: a pull request needs its own branch`;
  return null;
}
export async function createPr(cwd: string): Promise<{ pr?: PrShort; error?: string }> {
  const branch = (await run("git", ["branch", "--show-current"], { cwd, timeout: 10_000 }).then((r) => r.stdout, () => "")).trim();
  const no = prRefusal(branch);
  if (no) return { error: no };
  try {
    await run("git", ["push", "-u", "origin", "HEAD"], { cwd, timeout: 60_000 });
    await run("gh", ["pr", "create", "--draft", "--fill"], { cwd, timeout: 60_000 });
  } catch (e: any) { return { error: e?.code === "ENOENT" ? "gh is not installed on the engine's machine" : said(e) }; }
  const s = summarize({}, await pullRequest(cwd).catch(() => null));
  return "pr" in s && s.pr ? { pr: s.pr } : { error: "GitHub did not show the new pull request yet: ask again" };
}
