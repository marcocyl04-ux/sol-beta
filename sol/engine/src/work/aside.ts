// The aside (Cmd ;, /btw): a side question about a session that does not touch its task. It runs as a fork of the
// session that is never written down (persistSession: false), with no tools and one turn, and streams back to the
// face that asked. The session itself, live or not, never sees it.
import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";

export async function aside(a: { sessionId: string; text: string; cwd?: string; model?: string }, send: (m: object) => void) {
  const id = randomUUID();
  const out = (m: object) => send({ type: "work.aside", sessionId: a.sessionId, id, ...m });
  out({ q: a.text, text: "", done: false });
  const ac = new AbortController();
  const stop = setTimeout(() => ac.abort(), 120_000);
  let text = "";
  try {
    const q = query({
      prompt: a.text,
      options: {
        resume: a.sessionId, forkSession: true, persistSession: false, abortController: ac,
        ...(a.cwd ? { cwd: a.cwd } : {}), model: a.model ?? "claude-opus-5-5",
        tools: [], maxTurns: 1, includePartialMessages: true, settingSources: [],
        systemPrompt: { type: "preset", preset: "claude_code", append: "This message is an aside: Marco asks on the side while the session's task goes on. Answer briefly from what you know of this session. You have no tools here; the task itself is not changed by this answer." },
      },
    });
    for await (const m of q as AsyncIterable<any>) {
      if (m.type === "stream_event" && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta") {
        text += m.event.delta.text;
        out({ delta: m.event.delta.text });
      } else if (m.type === "assistant" && !text) {
        text = (m.message?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      } else if (m.type === "result") break;
    }
    out({ q: a.text, text, done: true });
  } catch (err) {
    out({ q: a.text, text, done: true, error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
  } finally { clearTimeout(stop); }
}
