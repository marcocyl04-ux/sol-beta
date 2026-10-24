// A tiny MCP server over stdio, started by the Codex CLI. It owns no browser and no desk: every tool call
// (browser_* and desk_*) is passed to the engine (POST /tool), so there is one Chromium and one desk, owned
// by the engine process. The engine routes by tool name; /browser stays as an alias for one round.
// Needs ENGINE_URL, e.g. http://127.0.0.1:7777

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SOL_TOOLS } from "./tools.js";

const engine = process.env.ENGINE_URL ?? "http://127.0.0.1:7777";
const server = new McpServer({ name: "sol", version: "1.0.0" });

for (const t of SOL_TOOLS) {
  server.tool(t.name, t.description, t.shape, async (args: any) => {
    try {
      const r = await fetch(`${engine}/tool`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: t.name, args, turn: process.env.SOL_TURN }),
      });
      return (await r.json()) as any;
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Engine not reachable: ${String(err)}` }], isError: true };
    }
  });
}

await server.connect(new StdioServerTransport());
