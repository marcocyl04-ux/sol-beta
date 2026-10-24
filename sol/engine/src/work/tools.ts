// Sol's own tools for Work sessions, on the MCP server "sol" next to the browser and the desk: the task list, the
// next-step box, and the doors between sessions (list, read, message, start, hand off, rename, archive). The face draws the first two
// from the tool call itself (items.ts); the session tools act through hooks the engine sets (index.ts).
import { z } from "zod";
import { PING_KINDS, type PingKind } from "../team/pings.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): Result => ({ content: [{ type: "text", text }] });
const no = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });

export type WorkHooks = {
  list: (q?: string) => Promise<string>;
  read: (id: string, last?: number) => Promise<string>;
  message: (from: string, to: string, text: string) => Promise<string>;
  start: (from: string, a: Start) => Promise<string>;
  handoff: (from: string, title: string, plan: string) => Promise<string>;
  rename: (id: string, title: string) => Promise<string>;
  done: (id: string, done: boolean) => Promise<string>;
  archive: (id: string, archived: boolean) => Promise<string>;
  brief: (from: string, issue: number) => Promise<string>;
  note: (from: string, n: { issue: number; kind: "change" | "decision" | "plan" | "heads-up"; lines: string; to?: number; ping?: PingKind }) => Promise<string>;
  pings: (from: string, issue?: number) => Promise<string>;
  show: (from: string, on: boolean) => Promise<string>;
};
export type Start = { title: string; prompt: string; cwd?: string; fork?: boolean; worktree?: boolean; initiation?: "now" | "offer" | "proposal" };
let hooks: WorkHooks | null = null;
export const setWorkHooks = (h: WorkHooks) => { hooks = h; };

const step = z.object({ content: z.string(), status: z.enum(["pending", "in_progress", "completed"]), session: z.string().optional() });
const action = z.object({ label: z.string(), message: z.string().optional(), action: z.string().optional() });

export const WORK_TOOLS = [
  {
    name: "update_plan",
    description: "Show the task list under your latest message. Send the whole list every time: short imperative steps, " +
      "exactly one in_progress while working. Marco follows your progress by it.",
    shape: { items: z.array(step) },
  },
  {
    name: "wrap_up",
    description: "End a turn that changed files or ran commands with the next-step box: a two or three sentence recap of " +
      "what is now true and what is not done. Add `ask` (one short question) and `actions` (one or two buttons; " +
      "label 1-3 words, message is what the click sends back; action may be commit, create_pr, merge, verify, archive, " +
      "new_session) only when Marco has a decision to make. For new_session the message is not sent here: it opens a fresh " +
      "session with the message in its box, so write it as that session's first prompt (what is done, the next step, the files), " +
      "the way you would a HANDOFF.",
    shape: { recap: z.string(), ask: z.string().optional(), actions: z.array(action).max(2).optional() },
  },
  { name: "list_sessions", description: "List Claude Code sessions on this machine (newest first), optionally filtered by words in the title or folder.", shape: { query: z.string().optional() } },
  { name: "read_session", description: "Read the last messages of another session.", shape: { sessionId: z.string(), last: z.number().int().min(1).max(200).optional() } },
  { name: "send_message", description: "Send a message to another session; it runs as a turn there. Never for progress reports.", shape: { sessionId: z.string(), message: z.string() } },
  {
    name: "start_session",
    description: "Start a separate session for a self-contained piece of work. It is nested under this one in Marco's side. " +
      "`fork: true` gives it this conversation's history; otherwise `prompt` must carry everything it needs. " +
      "`worktree: true` runs it in a side copy of the repo (its own branch), so it never touches Marco's folder. " +
      "`initiation`: \"now\" (default) starts it once Marco allows it; \"offer\" asks Marco New session or Do it here " +
      "(if he picks here, do it in this session); \"proposal\" starts nothing: a card waits in the talk and Marco starts " +
      "it when he wants (for a follow-up you only suggest).",
    shape: {
      title: z.string(), prompt: z.string(), cwd: z.string().optional(), fork: z.boolean().optional(), worktree: z.boolean().optional(),
      initiation: z.enum(["now", "offer", "proposal"]).optional(),
    },
  },
  {
    name: "hand_off",
    description: "Move the task you are in the middle of into a new session (a fork of this conversation plus `remaining_plan`), " +
      "so you can answer Marco's new message here. After it, stop that task here and answer the new message.",
    shape: { title: z.string(), remaining_plan: z.string() },
  },
  { name: "rename_session", description: "Rename a session (this one if no sessionId).", shape: { title: z.string(), sessionId: z.string().optional() } },
  { name: "archive_session", description: "Archive a session (or bring it back) in Marco's side; this one if no sessionId.", shape: { archived: z.boolean(), sessionId: z.string().optional() } },
  { name: "mark_done", description: "Mark a session completed (or not) in Marco's side.", shape: { done: z.boolean(), sessionId: z.string().optional() } },
  {
    name: "brief",
    description: "Read the brief for an issue before building on it: its thread, who claims what nearby (held issues, open PRs " +
      "and the paths they touch), the plans that mention it, what landed on main since the last stable. Read-only; " +
      "nothing is saved. Call it once at the start of work on a team issue.",
    shape: { issue: z.number().int().positive() },
  },
  {
    name: "team_note",
    description: "The one way to write to the team's memory. A few plain lines, posted signed as your human's agent; the kind " +
      "routes them: `change` to the issue and the open PR of this branch; `decision` to the issue as a Decision line; " +
      "`plan` to your human's plan page; `heads-up` to another issue (`to`). Call it at wrap-up and whenever you learn " +
      "something another agent will need. Never for progress reports. A decision pings the issue's other holders; a " +
      "heads-up pings the other issue's holders, of the kind `ping` names (clash, contract, claim, decision, chat; default chat).",
    shape: {
      issue: z.number().int().positive(), kind: z.enum(["change", "decision", "plan", "heads-up"]), lines: z.string(), to: z.number().int().positive().optional(),
      ping: z.enum(PING_KINDS as [PingKind, ...PingKind[]]).optional(),
    },
  },
  {
    name: "pings",
    description: "Read the pings that reached your human since you last looked (a clash on the branch, a contract you use " +
      "changed, a claim overlapping yours, a decision on the issue, a chat line naming them), one line each; reading marks " +
      "them seen. Look at each pause in work on a team issue (give `issue` to see that issue's only) and tell your human " +
      "the clash, contract and claim ones in a line each. A ping never stops your work.",
    shape: { issue: z.number().int().positive().optional() },
  },
  {
    name: "show_to_team",
    description: "Show this session to the team, read-only, while it runs (on: true), or stop showing it (on: false). Only " +
      "when your human asks. Teammates see the prompts, your replies and the names of the tools you use, never their " +
      "inputs, files or diffs. It works on a branch that names a team issue, with the team relay up; when it stops, one " +
      "signed line on the issue lists this branch's commits.",
    shape: { on: z.boolean() },
  },
] as const;

export async function runWorkTool(name: string, args: any, self: string): Promise<Result> {
  if (name === "update_plan") return ok("shown");
  if (name === "wrap_up") return ok("shown; end your turn now");
  if (!hooks) return no("session tools are not ready");
  try {
    if (name === "list_sessions") return ok(await hooks.list(args.query));
    if (name === "read_session") return ok(await hooks.read(String(args.sessionId), args.last));
    if (name === "send_message") return ok(await hooks.message(self, String(args.sessionId), String(args.message)));
    if (name === "start_session") return ok(await hooks.start(self, args));
    if (name === "hand_off") return ok(await hooks.handoff(self, String(args.title), String(args.remaining_plan)));
    if (name === "archive_session") return ok(await hooks.archive(String(args.sessionId ?? self), !!args.archived));
    if (name === "rename_session") return ok(await hooks.rename(String(args.sessionId ?? self), String(args.title)));
    if (name === "mark_done") return ok(await hooks.done(String(args.sessionId ?? self), !!args.done));
    if (name === "brief") return ok(await hooks.brief(self, Number(args.issue)));
    if (name === "show_to_team") return ok(await hooks.show(self, !!args.on));
    if (name === "team_note") return ok(await hooks.note(self, { issue: Number(args.issue), kind: args.kind, lines: String(args.lines), to: args.to === undefined ? undefined : Number(args.to), ...(args.ping ? { ping: args.ping } : {}) }));
    if (name === "pings") return ok(await hooks.pings(self, args.issue === undefined ? undefined : Number(args.issue)));
  } catch (err) {
    return no(err instanceof Error ? err.message : String(err));
  }
  return no(`unknown tool ${name}`);
}
