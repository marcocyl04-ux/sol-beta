// Overview parity (#40, PROTOCOL.md round 20): the context split, Remote Control's command and status, the changes
// card's summary. Pure functions only: nothing here runs tailscale, git or the SDK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PARTS, fromContext, estimateUsage, catchUp, soon, serveArgs, parseServe, summarize, prRefusal } from "../src/work/overview.ts";

// the shape getContextUsage answered on this Mac (2026-10-20, haiku, one turn), trimmed, with the numbers of ss3
const counted = {
  categories: [
    { name: "System prompt", tokens: 12800, kind: "used" as const },
    { name: "System tools", tokens: 20200, kind: "used" as const },
    { name: "MCP tools", tokens: 21100, kind: "used" as const },
    { name: "MCP server instructions", tokens: 1700, kind: "used" as const },
    { name: "MCP tools (deferred)", tokens: 314000, kind: "deferred" as const, isDeferred: true },
    { name: "System tools (deferred)", tokens: 20200, kind: "deferred" as const, isDeferred: true },
    { name: "Custom agents", tokens: 755, kind: "used" as const },
    { name: "Memory files", tokens: 4300, kind: "used" as const },
    { name: "Skills", tokens: 8200, kind: "used" as const },
    { name: "Messages", tokens: 130000, kind: "used" as const },
    { name: "Autocompact buffer", tokens: 33000, kind: "buffer" as const },
    { name: "Free space", tokens: 17800, kind: "free" as const },
  ],
  totalTokens: 199055, maxTokens: 250000, rawMaxTokens: 250000, autoCompactThreshold: 217000, isAutoCompactEnabled: true,
  memoryFiles: [{ path: "/Users/m/.claude/CLAUDE.md" }, { path: "/Users/m/computer/CLAUDE.md" }],
  mcpTools: [{ name: "mcp__claude_ai_Asana__search", serverName: "claude_ai_Asana" }, { name: "mcp__linear__create_issue", serverName: "linear" }],
  agents: [{ agentType: "coder" }, { agentType: "reviewer" }],
};

test("overview: a counted split has the ten parts, the deferred two out of the window, the lists, nothing estimated", () => {
  const u = fromContext(counted, "counted");
  assert.deepEqual(Object.keys(u.parts), [...PARTS]);
  assert.equal(u.parts.messages, 130000);
  assert.equal(u.parts.mcpTools, 21100);
  assert.equal(u.parts.mcpInstructions, 1700);   // not swallowed by "MCP tools"
  assert.equal(u.parts.systemTools, 20200);
  assert.equal(u.parts.agents, 755);
  assert.equal(u.parts.buffer, 33000);
  assert.equal(u.parts.free, 17800);
  assert.deepEqual(u.deferred, { mcpTools: 314000, systemTools: 20200 });
  assert.equal(u.total, 199055);
  assert.equal(u.window, 250000);
  assert.deepEqual(u.lists.mcp, ["claude_ai_Asana:search", "linear:create_issue"]);
  assert.deepEqual(u.lists.agents, ["coder", "reviewer"]);
  assert.equal(u.lists.memory.length, 2);
  assert.deepEqual(u.est, []);
  assert.equal(u.how, "counted");
  assert.equal(u.compactSoon, true);   // 199k is past 90% of the 217k where auto-compact fires
  assert.equal(u.more, undefined);
});

test("overview: a category the CLI leaves out is 0 when counted; one it names that is none of the ten is kept, not dropped", () => {
  const u = fromContext({ ...counted, categories: [...counted.categories.filter((c) => c.name !== "Skills"), { name: "Plugins", tokens: 90, kind: "used" }] }, "counted");
  assert.equal(u.parts.skills, 0);
  assert.deepEqual(u.more, [{ name: "Plugins", tokens: 90 }]);
});

test("overview: the SDK's quick summary wears ≈ on every used part, never on free or the buffer", () => {
  const u = fromContext(counted, "summary");
  assert.equal(u.how, "summary");
  assert.ok(u.est.includes("messages") && u.est.includes("skills"));
  assert.ok(!u.est.includes("free") && !u.est.includes("buffer"));
});

test("overview: from a fake init and the API's usage alone, bytes/4 where it can, null where it cannot, the rest named", () => {
  const init = { tools: ["Read", "Bash", "mcp__linear__create_issue", "mcp__claude_ai_Asana__search"], agents: ["general-purpose", "Explore", "Plan", "coder", "statusline-setup"] };
  const u = estimateUsage({ init, context: 60000, window: 1_000_000, chars: 80000, memory: [{ path: "/a/CLAUDE.md", bytes: 4000 }, { path: "/b/CLAUDE.md", bytes: 2000 }] });
  assert.equal(u.how, "estimated");
  assert.equal(u.total, 60000);                   // the API's own count: measured
  assert.equal(u.parts.messages, 20000);          // 80000 chars / 4
  assert.equal(u.parts.memory, 1500);             // 6000 bytes / 4
  assert.deepEqual(u.est.sort(), ["memory", "messages"]);
  for (const k of ["mcpTools", "systemTools", "systemPrompt", "skills", "mcpInstructions", "agents", "buffer"] as const) assert.equal(u.parts[k], null, k);
  assert.equal(u.parts.free, 940000);             // the window less the total, not an estimate
  assert.equal(u.rest, 60000 - 20000 - 1500);     // in the window, not split
  assert.deepEqual(u.deferred, { mcpTools: null, systemTools: null });
  assert.deepEqual(u.lists.mcp, ["linear:create_issue", "claude_ai_Asana:search"]);
  assert.deepEqual(u.lists.agents, ["coder"]);    // Claude Code's own agents are not "custom"
  assert.equal(u.compactSoon, false);
});

test("overview: an estimate never passes the total; no init and no talk is unknown, not zero", () => {
  const big = estimateUsage({ init: null, context: 1000, window: 200000, chars: 40000, memory: [{ path: "/x", bytes: 40000 }] });
  assert.equal(big.parts.messages, 1000);
  assert.equal(big.parts.memory, 0);
  assert.equal(big.rest, 0);
  const blank = estimateUsage({ init: null, context: 5000, window: 200000, chars: 0, memory: [] });
  assert.equal(blank.parts.messages, null);
  assert.equal(blank.parts.memory, null);
  assert.equal(blank.rest, 5000);
});

test("overview: what came since the count goes to messages, wearing ≈, out of the free space", () => {
  const u = catchUp(fromContext(counted, "counted"), 201055);
  assert.equal(u.total, 201055);
  assert.equal(u.parts.messages, 132000);
  assert.equal(u.parts.free, 15800);
  assert.deepEqual(u.est, ["messages"]);
  assert.equal(catchUp(fromContext(counted, "counted"), 100).total, 199055);   // a smaller live total (a compact) waits for the next count
});

test("overview: auto-compacts soon", () => {
  assert.equal(soon(196000, 250000, 217000, true), true);
  assert.equal(soon(150000, 250000, 217000, true), false);
  assert.equal(soon(240000, 250000, 217000, false), false);   // auto-compact off: it never compacts by itself
  assert.equal(soon(800000, 1_000_000), true);                // no threshold known: 80% of the window
});

test("overview: tailscale serve, the commands (never reset)", () => {
  assert.deepEqual(serveArgs(true, 7777), ["serve", "--bg", "--https=443", "7777"]);
  assert.deepEqual(serveArgs(false, 7777), ["serve", "--https=443", "off"]);
  assert.deepEqual(serveArgs(false, 7777, 8443), ["serve", "--https=8443", "off"]);
  assert.ok(!serveArgs(false, 7777).includes("reset"));
});

test("overview: tailscale serve status, parsed for this engine's port", () => {
  // what `tailscale serve status --json` printed on this Mac, 2026-10-20
  const mac = { TCP: { "443": { HTTPS: true } }, Web: { "marcos-macbook-air.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:7777" } } } } };
  assert.deepEqual(parseServe(mac, 7777), { on: true, url: "https://marcos-macbook-air.example.ts.net/away", https: 443 });
  assert.deepEqual(parseServe(JSON.stringify(mac), 7777).on, true);
  assert.deepEqual(parseServe(mac, 7790), { on: false });   // another port is not this engine
  const other = { Web: { "nucbox.example.ts.net:8443": { Handlers: { "/sol": { Proxy: "localhost:7777" } } } } };
  assert.deepEqual(parseServe(other, 7777), { on: true, url: "https://nucbox.example.ts.net:8443/sol/away", https: 8443 });
  assert.deepEqual(parseServe({}, 7777), { on: false });
  assert.deepEqual(parseServe("No serve config", 7777), { on: false });
  assert.deepEqual(parseServe(null, 7777), { on: false });
});

test("overview: the changes summary's shape, with and without a pull request", () => {
  const c = { files: [{ path: "a" }, { path: "b" }, { path: "c" }], add: 625, del: 0, branch: "marco/together-overview" };
  assert.deepEqual(summarize(c, { none: true } as any), { add: 625, del: 0, files: 3, branch: "marco/together-overview" });
  assert.deepEqual(summarize(c, { pr: { number: 41, url: "https://github.com/x/y/pull/41", isDraft: true, state: "OPEN" } }),
    { add: 625, del: 0, files: 3, branch: "marco/together-overview", pr: { number: 41, url: "https://github.com/x/y/pull/41", draft: true, state: "open" } });
  assert.deepEqual(summarize({ notGit: true }, null), { notGit: true });
  assert.deepEqual(summarize({}, { error: "gh is not installed" } as any), { add: 0, del: 0, files: 0, branch: "" });
});

test("overview: Create PR refuses the main line and a detached head, takes a branch", () => {
  assert.match(prRefusal("main")!, /own branch/);
  assert.match(prRefusal("stable")!, /own branch/);
  assert.match(prRefusal("")!, /detached/);
  assert.equal(prRefusal("marco/together-overview"), null);
});
