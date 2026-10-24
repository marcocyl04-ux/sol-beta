// A session's thread map: its transcript as a tree (each entry points at its parent), read only. A straight
// conversation is one line; when two writers resumed the same file (the Claude app and Sol, say), or a message was
// rewritten, the line splits. Each end is a head, tagged with who wrote it (every entry names its entrypoint) and the
// model. Tiny side stubs (a reminder, a queue entry) are dropped; a branch that ended before its sibling began was
// left behind (a retry, an edit) and is a twig: drawn dim, never something to reconcile.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { userText } from "./items.js";

export type Writer = "desktop" | "sol" | "terminal" | "unknown";
export type Segment = {
  id: string;            // its first entry
  from?: string;         // the segment it splits off
  end: string;           // its last entry (a leaf or the entry the next split is at)
  at?: string;           // its last reply (an assistant entry): where a resume or fork starts (resumeSessionAt takes only those)
  n: number; turns: number; replies: number;
  writer: Writer; model?: string;
  first: number; last: number;
  prompts: string[];     // Marco's typed prompts in it, short (the fold-in note's fallback)
  said?: string;         // Claude's last words in it, short (for the note's summary)
  head?: boolean;        // an end that still counts
  twig?: boolean;        // left behind before its sibling began
};
export type ThreadMap = { sessionId: string; segments: Segment[]; heads: string[]; entries: number; last?: string };   // last: the file's last entry

const base = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

export function transcriptPath(id: string): string | null {
  const dir = join(base(), "projects");
  try {
    for (const d of readdirSync(dir)) {
      const p = join(dir, d, `${id}.jsonl`);
      try { if (statSync(p).isFile()) return p; } catch { /* not here */ }
    }
  } catch { /* no folder */ }
  return null;
}

type Node = {
  uuid: string; parent?: string; kids: string[]; t: number; writer?: Writer; model?: string;
  typed?: string; reply: boolean; said?: string;
  // the subtree's totals
  sn: number; sReplies: number; sTyped: number; sLast: number;
};

const writerOf = (e?: string): Writer | undefined =>
  e === "claude-desktop" ? "desktop" : e === "sdk-ts" || e === "sdk-py" ? "sol" : e === "cli" ? "terminal" : e ? "unknown" : undefined;

const saidOf = (content: any[]) => {
  const t = content.filter((b) => b?.type === "text").map((b) => String(b.text)).join(" ").replace(/\s+/g, " ").trim();
  return t ? { said: t.slice(0, 600) } : {};
};

const cache = new Map<string, { key: string; map: ThreadMap }>();

export function threadMap(id: string, path = transcriptPath(id)): ThreadMap | null {
  if (!path) return null;
  const st = statSync(path);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cache.get(path);
  if (hit?.key === key) return hit.map;
  const map = build(id, readFileSync(path, "utf8"));
  cache.set(path, { key, map });
  return map;
}

export function build(id: string, text: string): ThreadMap {
  const nodes = new Map<string, Node>();
  const order: Node[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e?.uuid || e.isSidechain || nodes.has(e.uuid)) continue;
    const t = Date.parse(e.timestamp ?? "") || 0;
    const typed = e.type === "user" && !e.isMeta && !e.isCompactSummary ? userText(e.message?.content)?.text : undefined;
    const n: Node = {
      uuid: e.uuid, parent: e.parentUuid || e.logicalParentUuid || undefined, kids: [], t,
      writer: writerOf(e.entrypoint), model: e.type === "assistant" && e.message?.model !== "<synthetic>" ? e.message?.model : undefined,
      ...(typed ? { typed: typed.replace(/\s+/g, " ").slice(0, 160) } : {}),
      ...(e.type === "assistant" && Array.isArray(e.message?.content) ? saidOf(e.message.content) : {}),
      reply: e.type === "assistant" && !e.isApiErrorMessage,
      sn: 0, sReplies: 0, sTyped: 0, sLast: 0,
    };
    nodes.set(n.uuid, n);
    order.push(n);
  }
  // a parent written after its child can be a link a fork remapped into a loop: such a link is followed up first,
  // and an entry it would lead back to starts the tree instead
  const index = new Map(order.map((n, i) => [n.uuid, i]));
  const loops = (n: Node) => {
    for (let u = n.parent, steps = 0; u && steps <= order.length; steps++) { if (u === n.uuid) return true; u = nodes.get(u)?.parent; }
    return false;
  };
  for (const n of order) if (n.parent && (index.get(n.parent) ?? -1) > index.get(n.uuid)! && loops(n)) n.parent = undefined;
  const roots: Node[] = [];
  for (const n of order) {
    const p = n.parent ? nodes.get(n.parent) : undefined;
    if (p) p.kids.push(n.uuid); else roots.push(n);
  }
  // totals bottom-up, without recursion (a long talk is thousands deep): children before parents
  const post: Node[] = [];
  const stack = [...roots];
  while (stack.length) { const n = stack.pop()!; post.push(n); for (const k of n.kids) stack.push(nodes.get(k)!); }
  for (let i = post.length - 1; i >= 0; i--) {
    const n = post[i];
    n.sn = 1; n.sReplies = n.reply ? 1 : 0; n.sTyped = n.typed ? 1 : 0; n.sLast = n.t;
    for (const k of n.kids) { const c = nodes.get(k)!; n.sn += c.sn; n.sReplies += c.sReplies; n.sTyped += c.sTyped; n.sLast = Math.max(n.sLast, c.sLast); }
  }
  // a side stub: no reply at all, or (with no prompt of Marco's in it) a reply or two
  const noise = (c: Node) => c.sReplies < 1 || (!c.sTyped && (c.sReplies < 2 || c.sn < 6));
  // a split's branches that count; with none, the newest one carries on
  const kept = (n: Node): Node[] => {
    const kids = n.kids.map((k) => nodes.get(k)!);
    if (kids.length <= 1) return kids;
    const real = kids.filter((c) => !noise(c));
    return real.length ? real : [kids.reduce((a, b) => (b.sLast > a.sLast ? b : a))];
  };

  const segments: Segment[] = [];
  const todo: { start: Node; from?: string; twig: boolean }[] = [];
  // the main root is the biggest (a file can start with a stray entry or two)
  const main = roots.reduce<Node | undefined>((a, b) => (!a || b.sn > a.sn ? b : a), undefined);
  if (main) todo.push({ start: main, twig: false });
  while (todo.length) {
    const { start, from, twig } = todo.pop()!;
    const s: Segment = { id: start.uuid, ...(from ? { from } : {}), end: start.uuid, n: 0, turns: 0, replies: 0, writer: "unknown", first: start.t, last: start.t, prompts: [] };
    const votes = new Map<Writer, number>();
    let n: Node = start;
    for (;;) {
      s.n++; s.end = n.uuid;
      if (n.reply) s.at = n.uuid;
      if (n.said) s.said = n.said;
      if (n.reply) s.replies++;
      if (n.typed) { s.turns++; if (s.prompts.length < 12) s.prompts.push(n.typed); }
      if (n.model) s.model = n.model;
      if (n.writer) votes.set(n.writer, (votes.get(n.writer) ?? 0) + 1);
      if (n.t) { s.first = s.first || n.t; s.last = Math.max(s.last, n.t); }
      const ks = twig ? n.kids.map((k) => nodes.get(k)!).sort((a, b) => b.sn - a.sn).slice(0, 1) : kept(n);
      if (ks.length === 1) { n = ks[0]; continue; }
      if (ks.length > 1) {
        // a branch that ended before a sibling began was left behind
        for (const c of ks) {
          const behind = ks.some((o) => o !== c && o.t > c.sLast);
          todo.push({ start: c, from: s.id, twig: behind });
        }
      }
      break;
    }
    s.writer = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
    if (twig) s.twig = true;
    segments.push(s);
  }
  // a segment's model and writer come from above when it has none of its own (a branch of a single reminder)
  const byId = new Map(segments.map((s) => [s.id, s]));
  for (const s of segments) {
    let up = s.from ? byId.get(s.from) : undefined;
    while (!s.model && up) { s.model = up.model; up = up.from ? byId.get(up.from) : undefined; }
  }
  const parents = new Set(segments.map((s) => s.from).filter(Boolean));
  for (const s of segments) if (!parents.has(s.id) && !s.twig) s.head = true;
  segments.sort((a, b) => a.first - b.first);
  return { sessionId: id, segments, heads: segments.filter((s) => s.head).map((s) => s.id), entries: order.length, ...(order.length ? { last: order[order.length - 1].uuid } : {}) };
}
