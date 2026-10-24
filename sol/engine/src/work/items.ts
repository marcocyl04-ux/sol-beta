// A Work session as the face draws it: a flat list of items, each with an id, upserted as they change. The same
// builder reads a transcript (getSessionMessages) and a live run (query's stream), so history and live look alike.
//
//   me       Marco's message                 { text, files? }
//   you      Claude's text                   { text, parent? }
//   think    a thinking block                { text, done }
//   tool     a tool call                     { name, input, out?, ok?, done, parent?, bg?, at, end? }
//   plan     the task list                   { steps: [{ content, status, session? }] }
//   wrap     the next-step box               { recap, ask?, actions?: [{ label, message?, action? }] }
//   perm     a question for Marco            { tool, input, title?, reason?, state, answer? }  state ask|allow|always|deny|answered
//   compact  the context was summarised      { text }
//   error    a turn failed                   { text }
//   note     a quiet line (stopped, cleared) { text }
//   suggest  a suggested next prompt         { text }

export type Item = { id: string; kind: string; [k: string]: unknown };

const OUT_CAP = 12000;
const cap = (s: string) => (s.length > OUT_CAP ? s.slice(0, OUT_CAP) + `\n… ${s.length - OUT_CAP} more characters` : s);

export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b: any) => (b?.type === "text" ? b.text : b?.type === "image" ? "[image]" : "")).filter(Boolean).join("\n");
}

// Marco's own words in a user message, or null when the message is the harness talking (reminders, tool results).
export function userText(content: unknown): { text: string; images: number } | null {
  let parts: string[] = [];
  let images = 0;
  if (typeof content === "string") parts = [content];
  else if (Array.isArray(content)) {
    for (const b of content as any[]) {
      if (b?.type === "text" && typeof b.text === "string") parts.push(b.text);
      else if (b?.type === "image") images++;
      else if (b?.type === "tool_result") return null;
    }
  }
  let text = parts.join("\n").trim();
  const cmd = /<command-name>([^<]*)<\/command-name>/.exec(text);
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
    return { text: [cmd[1].trim(), args].filter(Boolean).join(" "), images };
  }
  if (/^<local-command-stdout>/.test(text)) return null;
  // reminders and injected context come wrapped in tags; Marco's text after them is kept
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (!text && !images) return null;
  if (text.startsWith("<") && /^<[a-z-]+>[\s\S]*<\/[a-z-]+>$/.test(text)) return null;
  if (/^Caveat: The messages below were generated/.test(text)) return null;
  return { text, images };
}

const PLAN_TOOLS = new Set(["TodoWrite", "mcp__sol__update_plan", "mcp__ccd_turn__update_plan"]);

export class Items {
  list: Item[] = [];
  private at = new Map<string, Item>();
  private texts = new Map<string, number>(); // message id -> text blocks seen so far (stream and final agree on the order)
  private thinks = new Map<string, number>();
  private streamMsg = "";                    // the message the stream is in
  private streamBlock = new Map<number, string>(); // stream block index -> item id
  plan: Item | null = null;
  usage = { context: 0 };
  constructor(private emit: (it: Item) => void = () => {}, private delta: (id: string, text: string) => void = () => {}) {}

  get(id: string) { return this.at.get(id); }
  // a transcript read before the run started: its items, without telling anyone (the face asked for them already)
  adopt(o: Items) {
    for (const it of o.list) if (!this.at.has(it.id)) { this.list.push(it); this.at.set(it.id, it); }
    this.plan = o.plan ?? this.plan;
    this.usage.context = o.usage.context;
    for (const [k, v] of o.final) this.final.set(k, v);
  }
  put(it: Item): Item {
    const old = this.at.get(it.id);
    if (old) Object.assign(old, it);
    else { this.list.push(it); this.at.set(it.id, it); }
    const now = this.at.get(it.id)!;
    this.emit(now);
    return now;
  }

  // one live stream_event (includePartialMessages)
  stream(ev: any, parent: string | null) {
    if (ev.type === "message_start") { this.streamMsg = String(ev.message?.id ?? ""); this.streamBlock.clear(); }
    else if (ev.type === "content_block_start") {
      const b = ev.content_block;
      if (b?.type === "text") {
        const n = this.texts.get(this.streamMsg) ?? 0;
        this.texts.set(this.streamMsg, n + 1);
        const id = `${this.streamMsg}:t${n}`;
        this.streamBlock.set(ev.index, id);
        this.put({ id, kind: "you", text: "", live: true, ...(parent ? { parent } : {}) });
      } else if (b?.type === "thinking") {
        const n = this.thinks.get(this.streamMsg) ?? 0;
        this.thinks.set(this.streamMsg, n + 1);
        const id = `${this.streamMsg}:k${n}`;
        this.streamBlock.set(ev.index, id);
        this.put({ id, kind: "think", text: "", done: false, at: Date.now(), ...(parent ? { parent } : {}) });
      }
    } else if (ev.type === "content_block_delta") {
      const id = this.streamBlock.get(ev.index);
      const it = id ? this.at.get(id) : undefined;
      if (!it) return;
      const d = ev.delta?.type === "text_delta" ? ev.delta.text : ev.delta?.type === "thinking_delta" ? ev.delta.thinking : "";
      if (!d) return;
      it.text = String(it.text ?? "") + d;
      this.delta(it.id, d);
    }
  }

  // one whole message: from a transcript, or the final form of a live one
  feed(m: any) {
    const parent: string | null = m.parent_tool_use_id ?? null;
    const p = parent ? { parent } : {};
    if (m.type === "assistant") {
      const msg = m.message ?? {};
      const mid = String(msg.id ?? m.uuid);
      if (m.isApiErrorMessage || m.error) {
        this.put({ id: `${mid}:err`, kind: "error", text: resultText(msg.content) || String(m.error) });
        return;
      }
      for (const b of (msg.content ?? []) as any[]) {
        if (b.type === "text") {
          // the stream already made this block's item: settle it; a transcript has no stream, so count afresh
          const id = this.finalId(mid, "t");
          this.put({ id, kind: "you", text: b.text, live: false, ...(m.uuid && !parent ? { uuid: String(m.uuid) } : {}), ...p });
        } else if (b.type === "thinking" || b.type === "redacted_thinking") {
          const id = this.finalId(mid, "k");
          this.put({ id, kind: "think", text: String(b.thinking ?? ""), done: true, ...p });
        } else if (b.type === "tool_use") this.toolUse(b, parent);
      }
      const u = msg.usage;
      if (u && !parent) this.usage.context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    } else if (m.type === "user") {
      const content = m.message?.content;
      if (Array.isArray(content)) for (const b of content) if (b?.type === "tool_result") this.toolResult(b);
      if (parent || m.isMeta || m.isSynthetic) return;
      if (m.isCompactSummary) { this.put({ id: String(m.uuid), kind: "compact", text: "the talk so far was summarised" }); return; }
      const u = userText(content);
      const at = Date.parse(m.timestamp ?? "") || undefined;   // when it was said, for the row under it (#51)
      if (u) this.put({ id: String(m.uuid ?? Math.random()), kind: "me", text: u.text, ...(at ? { at } : {}), ...(u.images ? { images: u.images } : {}) });
    } else if (m.type === "system") {
      if (m.subtype === "compact_boundary") {
        const c = m.compact_metadata ?? {};
        const pre = c.pre_tokens ? `${Math.round(c.pre_tokens / 1000)}k` : "";
        this.put({ id: String(m.uuid), kind: "compact", text: `the talk so far was summarised${pre ? ` (${pre} tokens)` : ""}${c.trigger === "manual" ? "" : ", by itself"}` });
      } else if (m.subtype === "task_started" && m.tool_use_id) {
        const t = this.at.get(m.tool_use_id);
        if (t) this.put({ ...t, task: m.task_id, about: m.description });
      } else if (m.subtype === "task_progress" && m.tool_use_id) {
        const t = this.at.get(m.tool_use_id);
        if (t) this.put({ ...t, progress: m.description, uses: m.usage?.tool_uses });
      } else if (m.subtype === "task_notification") {
        const t = m.tool_use_id ? this.at.get(m.tool_use_id) : [...this.list].reverse().find((x) => x.task === m.task_id);
        if (t) this.put({ ...t, bgDone: true, ok: m.status === "completed", summary: m.summary });
        else this.put({ id: `task:${m.task_id}`, kind: "note", text: `background task ${m.status}: ${m.summary ?? ""}`.trim() });
      }
    } else if (m.type === "prompt_suggestion") {
      this.put({ id: `suggest:${this.list.length}`, kind: "suggest", text: m.suggestion });   // one per turn, after it
    } else if (m.type === "tool_use_summary") {
      for (const id of m.preceding_tool_use_ids ?? []) { const t = this.at.get(id); if (t) { t.summary = m.summary; this.emit(t); } }
    }
  }

  // the stream counts a message's blocks as they start, the final form counts them again: same order, same ids
  final = new Map<string, number>();
  private finalId(mid: string, k: string) {
    const key = `${mid}#${k}`;
    const n = this.final.get(key) ?? 0;
    this.final.set(key, n + 1);
    return `${mid}:${k}${n}`;
  }

  private toolUse(b: any, parent: string | null) {
    const id = String(b.id);
    const input = b.input ?? {};
    if (PLAN_TOOLS.has(b.name)) {
      const steps = (input.todos ?? input.items ?? []).map((t: any) => ({ content: String(t.content ?? ""), status: String(t.status ?? "pending"), active: t.activeForm, session: t.session }));
      if (parent) return;
      this.plan = this.put({ id: "plan", kind: "plan", steps, at: id });
      this.put({ id, kind: "tool", name: b.name, input, done: false, quiet: true, ...(parent ? { parent } : {}) });
      return;
    }
    if (b.name === "mcp__sol__wrap_up" || b.name === "mcp__ccd_turn__wrap_up") {
      this.put({ id: `wrap:${id}`, kind: "wrap", recap: String(input.recap ?? ""), ask: input.ask, actions: input.actions ?? [] });
      this.put({ id, kind: "tool", name: b.name, input, done: false, quiet: true });
      return;
    }
    const old = this.at.get(id);
    // a question or a plan for Marco is drawn as its card (the perm item), not as a step
    const card = b.name === "AskUserQuestion" || b.name === "ExitPlanMode";
    this.put({ id, kind: "tool", name: b.name, input, done: old?.done ?? false, at: old?.at ?? Date.now(), ...(input.run_in_background ? { bg: true } : {}), ...(parent ? { parent } : {}), ...(card ? { quiet: true } : {}) });
  }

  private toolResult(b: any) {
    const t = this.at.get(String(b.tool_use_id));
    if (!t) return;
    const out = cap(resultText(b.content));
    // a helper the SDK sent off on its own answers at once ("Async agent launched"): it works on in the background
    const async = (t.name === "Agent" || t.name === "Task") && !b.is_error && /^Async agent launched/.test(out);
    this.put({ ...t, done: true, ok: !b.is_error, out, end: Date.now(), ...(async ? { bg: true } : {}) });
  }

  // every tool still open is closed (a stopped or failed turn)
  settle(ok = false) {
    for (const it of this.list) {
      if (it.kind === "tool" && !it.done) this.put({ ...it, done: true, ok, out: it.out ?? (ok ? "" : "stopped") });
      if ((it.kind === "think" && !it.done) || (it.kind === "you" && it.live)) this.put({ ...it, done: true, live: false });
    }
  }
}
