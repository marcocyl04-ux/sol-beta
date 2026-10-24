// The review seat (Work): Codex reads a session's change and names what is actually wrong. One Codex thread per
// session (a second review resumes it, so it knows what it said before). Codex writes nothing: the sandbox is
// read-only, the network is off, nothing is approved (approval "never" refuses every MCP tool), and the notify hook
// and bundled plugins are off for this seat. The prompt asks for remarks; the engine, not the prompt, keeps it read-only.
//
// Its remarks are items of kind "review" in the session's thread, over the same bus as the run's items:
//   head    { round, head: true, scope, files, busy, step?, text, error? }   one per review: what Codex is doing, then what it found
//   remark  { round, file, line, text, state }                               state open | sent | dismissed
// They are kept beside the transcript (STATE_DIR/reviews/<session>.json), each with `after`: the thread item it
// followed when the review ran, so an opened session shows them where they happened.
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join as joinBusy } from "../busy.js";
import { join } from "node:path";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import { STATE_DIR } from "./state.js";
import { changes } from "./panes.js";
import type { Item } from "./items.js";

const MODEL = "gpt-5.6-luna";
const DIFF_CAP = 80_000;
const DIR = join(STATE_DIR, "reviews");
type Bus = (m: object) => void;
type Kept = { thread?: string; items: Item[] };

const kept = new Map<string, Kept>();
const busy = new Map<string, AbortController>();

function load(id: string): Kept {
  let k = kept.get(id);
  if (k) return k;
  try { k = JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8")) as Kept; } catch { k = { items: [] }; }
  kept.set(id, k);
  return k;
}
function save(id: string) {
  // written whole or not at all (#11): a reader never sees half a file
  try { mkdirSync(DIR, { recursive: true }); const f = join(DIR, `${id}.json`); writeFileSync(f + ".tmp", JSON.stringify(load(id))); renameSync(f + ".tmp", f); } catch { /* the remarks stay live */ }
}
function put(id: string, it: Item, bus: Bus) {
  const k = load(id);
  const old = k.items.find((x) => x.id === it.id);
  if (old) Object.assign(old, it); else k.items.push(it);
  bus({ type: "work.item", sessionId: id, item: old ?? it });
  save(id);
}

// a thread's items with the session's review items in their places (after the item each one followed)
export function withReviews(id: string, items: Item[]): Item[] {
  const r = load(id).items;
  if (!r.length) return items;
  const out = items.filter((i) => i.kind !== "review");
  const at = new Map(out.map((x, i) => [x.id, i]));
  const tail: Item[] = [];
  const by = new Map<number, Item[]>();
  for (const it of r) {
    const i = at.get(String(it.after ?? ""));
    if (i === undefined) tail.push(it); else by.set(i, [...(by.get(i) ?? []), it]);
  }
  return [...out.flatMap((x, i) => [x, ...(by.get(i) ?? [])]), ...tail];
}

const SCHEMA = {
  type: "object",
  properties: {
    remarks: {
      type: "array",
      items: {
        type: "object",
        properties: { file: { type: "string" }, line: { type: "integer" }, what: { type: "string" } },
        required: ["file", "line", "what"],
        additionalProperties: false,
      },
    },
  },
  required: ["remarks"],
  additionalProperties: false,
};

const BRIEF = "You are the review seat of Marco's Work window. You can read this repository and nothing else: you change nothing. " +
  "Review this change for real defects, security and stability, in the house style of this repository (its CLAUDE.md and " +
  "AGENTS.md, and the code around the change, are yours to read when they help). Name only what is actually wrong, with " +
  "file and line (the file's path as in the diff, the line in its new version), no praise, no style remarks. Each remark is one " +
  "or two plain sentences: what is wrong and why it bites. If nothing is wrong, return no remarks.";

const SCOPE_SAYS: Record<string, string> = { all: "this branch against its base", uncommitted: "what is not committed yet", last: "the last commit" };

// a review of the session's change in `cwd` (the scope the diff pane shows); its items go to every face on `bus`
export async function review(a: { sessionId: string; cwd: string; scope: string; after?: string }, bus: Bus): Promise<{ round?: string; error?: string }> {
  const id = a.sessionId;
  if (busy.has(id)) return { error: "Codex is already reading this change" };
  const d = await changes(a.cwd, a.scope);
  if ((d as any).notGit) return { error: "this folder is not a git repository" };
  const files = d.files.filter((f) => !f.binary && f.patch);
  if (!files.length) return { error: "no change to review in this scope" };
  const root = (d as any).root as string ?? a.cwd;
  let diff = files.map((f) => `--- ${f.old ? `${f.old} → ` : ""}${f.path} (${f.status})\n${f.patch}`).join("\n\n");
  if (diff.length > DIFF_CAP) diff = diff.slice(0, DIFF_CAP) + `\n… the diff goes on for ${diff.length - DIFF_CAP} more characters: read those files yourself`;

  const round = `review:${Date.now().toString(36)}`;
  const k = load(id);
  const head = { id: round, kind: "review", head: true, round, scope: a.scope, files: files.length, busy: true, text: "Codex is reading the change", after: a.after };
  put(id, head, bus);
  const ab = new AbortController();
  busy.set(id, ab);
  const leave = joinBusy("review", id, round);
  void (async () => {
    const opts = {
      model: MODEL, modelReasoningEffort: "low" as const, workingDirectory: root, skipGitRepoCheck: true,
      sandboxMode: "read-only" as const, networkAccessEnabled: false, webSearchMode: "disabled" as const, approvalPolicy: "never" as const,
    };
    const codex = new Codex({
      config: {
        notify: [],
        plugins: {
          "browser@openai-bundled": { enabled: false },
          "unified-computer-use@openai-bundled": { enabled: false },
          "computer-use@openai-bundled": { enabled: false },
        },
      },
    });
    const thread = k.thread ? codex.resumeThread(k.thread, opts) : codex.startThread(opts);
    const text = `${k.thread ? "The change as it stands now; review it again (what you said before may no longer apply)." : BRIEF}\n\n` +
      `The change: ${SCOPE_SAYS[a.scope] ?? a.scope}, ${files.length} file${files.length > 1 ? "s" : ""}, in ${root}.\n\n${diff}`;
    let said = "";
    try {
      const { events } = await thread.runStreamed(text, { signal: ab.signal, outputSchema: SCHEMA });
      for await (const e of events as AsyncIterable<ThreadEvent>) {
        if (e.type === "thread.started") { k.thread = e.thread_id; save(id); }
        else if (e.type === "item.started" && e.item.type === "command_execution") put(id, { ...head, step: String(e.item.command ?? "").replace(/^\/bin\/\w+ -lc /, "").slice(0, 120) }, bus);
        else if (e.type === "item.completed" && e.item.type === "agent_message") said = e.item.text;
        else if (e.type === "turn.failed") throw new Error(e.error.message);
      }
      let remarks: { file: string; line: number; what: string }[];
      try { remarks = JSON.parse(said).remarks ?? []; } catch { remarks = said.trim() ? [{ file: "", line: 0, what: said.trim() }] : []; }
      remarks.forEach((r, n) => put(id, { id: `${round}:${n}`, kind: "review", round, file: r.file, line: r.line, text: r.what, state: "open", after: a.after }, bus));
      put(id, { ...head, busy: false, step: "", text: remarks.length ? `Codex: ${remarks.length} thing${remarks.length > 1 ? "s" : ""} wrong` : "Codex: nothing wrong found", count: remarks.length }, bus);
    } catch (err) {
      const stopped = ab.signal.aborted;
      put(id, { ...head, busy: false, step: "", text: stopped ? "review stopped" : "the review failed", ...(stopped ? {} : { error: err instanceof Error ? err.message.split("\n")[0] : String(err) }) }, bus);
    } finally { busy.delete(id); leave(); }
  })();
  return { round };
}

export const stopReview = (id: string) => busy.get(id)?.abort();

// a remark sent to Claude (put in the box) or dismissed
export function markReview(id: string, item: string, state: "sent" | "dismissed" | "open", bus: Bus) {
  const it = load(id).items.find((x) => x.id === item && !x.head);
  if (it) put(id, { ...it, state }, bus);
}
