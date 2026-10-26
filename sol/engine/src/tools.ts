// Every tool on the MCP server "sol", both seats: the browser's, the desk's, the ping and the team chat's line (Talk
// #37, team/talk.ts) and the arrangement's (#133, arrange.ts), routed by name.

import { TOOLS, runBrowserTool, type ToolResult, type TurnCtx } from "./browser.js";
import { DESK_TOOLS, runDeskTool } from "./desk.js";
import { PING_TOOLS, runPingTool } from "./ping.js";
import { TALK_TOOLS, runTalkTool } from "./team/talk.js";   // Talk (#37): a line in the team's chat, both seats
import { ARRANGE_TOOLS, runArrangeTool } from "./arrange.js";
import { STICKY_TOOLS, runStickyTool } from "./sticky.js";   // the sticky note in Home's corner

export const SOL_TOOLS = [...TOOLS, ...DESK_TOOLS, ...PING_TOOLS, ...TALK_TOOLS, ...ARRANGE_TOOLS, ...STICKY_TOOLS];

export function runSolTool(name: string, args: unknown, turn: TurnCtx = {}): Promise<ToolResult> {
  if (name === "ping") return runPingTool(name, args, turn);
  if (name === "talk") return runTalkTool(name, args, turn);   // Talk (#37)
  if (name === "arrange") return runArrangeTool(name, args, turn);
  if (name === "sticky") return runStickyTool(name, args, turn);
  return name.startsWith("desk_") ? runDeskTool(name, args, turn) : runBrowserTool(name, args, turn);
}
