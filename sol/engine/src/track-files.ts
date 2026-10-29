// Tracking (#356, Frank 2026-10-29): what the other tools' own files on this Mac say, counted once a day. Sol, Claude
// Code and Codex share one Mac, so the before-and-after of the install, the true cost of a person's AI, Sol's share of
// their Claude Code use and the plan they pay for are all in local files already. This reads them and writes numbers
// through track(), into home/track/<day>-files.jsonl (its own file, its own cap, so a first scan's backlog never starves
// the day's real events), so the same rules hold: a number, a boolean, a word or a hash, never a sentence, a path or a
// token. The one card on the first window says it: Sol reads Claude Code's and Codex's files on this Mac to count, and
// sends numbers, not content.
//
//   files.claude.day  one line a (day, model, entrypoint, folder): prompts, answers, sessions and the four token counts
//                     from ~/.claude/projects/**/*.jsonl (a session's subagents and workflows sit in folders under it).
//                     Claude Code writes one line per content block of an answer, each with the same message id and the
//                     same usage, so an answer is counted once by its id. entrypoint tells Sol's own sessions (sdk-ts)
//                     from the terminal's (cli): Sol's share. The folder is its last name as a word (a topic, cheaply)
//                     and a salted hash of its path.
//   files.codex.day   the same a (day, model, folder) from ~/.codex/sessions/<y>/<m>/<d>/*.jsonl. A session's file holds
//                     a running total, and a session can run past midnight or be resumed days later, so what is counted
//                     is the growth of each session's total since the last scan, on the day the file last changed.
//   files.plan        once a day: the plan words in ~/.claude.json (oauthAccount) and the Codex sign-in's id token claim.
//   files.apps        once a day: which of a fixed list of AI apps is in /Applications or ~/Applications.
//
// A day is counted once it is over (the Mac's local day), from 90 days before the first scan, so the "before" of the
// install is in the same shape as the "after". home/track/others.json remembers the last day counted, written after each
// day, so an engine that dies mid-scan repeats at most one day. A file whose mtime is before the first day wanted is not
// opened. Everything here is best effort: a file that cannot be read is skipped, and nothing throws into the engine.
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { track, trackDir, hashOf, asWord } from "./track.js";

export type Roots = { claude: string; codex: string; claudeJson: string; codexAuth: string; apps: string[]; now?: () => Date; consent?: () => boolean };
export const BACK_DAYS = 90;
export const FIRST_AFTER_MS = 2 * 60_000;
export const EVERY_MS = 6 * 3_600_000;
const KIND = "files";
const CODEX_REMEMBERED = 4000;   // sessions whose counted total is kept in others.json; the oldest are let go past this
/** the AI apps looked for, by the word they are counted as */
export const APPS: [string, string][] = [["claude", "Claude.app"], ["chatgpt", "ChatGPT.app"], ["cursor", "Cursor.app"], ["raycast", "Raycast.app"], ["lmstudio", "LM Studio.app"], ["ollama", "Ollama.app"], ["windsurf", "Windsurf.app"], ["perplexity", "Perplexity.app"], ["gemini", "Gemini.app"], ["copilot", "GitHub Copilot.app"], ["warp", "Warp.app"], ["zed", "Zed.app"]];

export const defaultRoots = (): Roots => {
  const h = homedir();
  return { claude: join(h, ".claude", "projects"), codex: join(h, ".codex", "sessions"), claudeJson: join(h, ".claude.json"), codexAuth: join(h, ".codex", "auth.json"), apps: ["/Applications", join(h, "Applications")] };
};

// the last day counted; the day files.plan and files.apps last went; each Codex session's counted total (input+output+cached) and when it was last seen
type State = { through: string; said: string; codex: Record<string, [number, number]> };
const stateFile = () => join(trackDir(), "others.json");
function readState(): State {
  try {
    const v = JSON.parse(readFileSync(stateFile(), "utf8"));
    const codex: Record<string, [number, number]> = {};
    if (v.codex && typeof v.codex === "object") for (const [k, x] of Object.entries(v.codex)) if (Array.isArray(x) && typeof x[0] === "number" && typeof x[1] === "number") codex[k] = [x[0], x[1]];
    return { through: typeof v.through === "string" ? v.through : "", said: typeof v.said === "string" ? v.said : "", codex };
  } catch { return { through: "", said: "", codex: {} }; }
}
function writeState(s: State) {
  const ids = Object.keys(s.codex);
  if (ids.length > CODEX_REMEMBERED) for (const id of ids.sort((a, b) => s.codex[a]![1] - s.codex[b]![1]).slice(0, ids.length - CODEX_REMEMBERED)) delete s.codex[id];
  try { mkdirSync(trackDir(), { recursive: true }); writeFileSync(stateFile(), JSON.stringify(s) + "\n"); } catch { /* said by track's write */ }
}

const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayOfIso = (iso: unknown): string => { const d = new Date(typeof iso === "string" ? iso : NaN); return isNaN(d.getTime()) ? "" : dayOf(d); };
const startOfDay = (day: string): number => { const [y, m, d] = day.split("-").map(Number); return new Date(y!, m! - 1, d!).getTime(); };
const plusDays = (day: string, n: number) => dayOf(new Date(startOfDay(day) + n * 86_400_000 + 3_600_000 * 12));   // noon, so a DST change cannot move the day
const n = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : 0);
const folderWords = (cwd: unknown) => { const p = typeof cwd === "string" ? cwd : ""; return { folder: asWord(basename(p)) || "none", dir: p ? hashOf(p) : "none" }; };

type Sum = { prompts: number; answers: number; sessions: Set<string>; input: number; output: number; cache_read: number; cache_write: number };
const sum = (): Sum => ({ prompts: 0, answers: 0, sessions: new Set(), input: 0, output: 0, cache_read: 0, cache_write: 0 });

/** every .jsonl under root, folders within folders (a session's subagents and workflows), modified at or after `since` */
function jsonlFiles(root: string, since: number): { path: string; mtime: number }[] {
  const out: { path: string; mtime: number }[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const p = join(dir, name);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (depth < 8) walk(p, depth + 1); continue; }
      if (name.endsWith(".jsonl") && st.mtimeMs >= since) out.push({ path: p, mtime: st.mtimeMs });
    }
  };
  walk(root, 0);
  return out;
}

/** a user line that is a person's prompt: not a tool's result handed back, not a slash command's expansion, not an interruption, not a compact summary */
function isPrompt(d: any): boolean {
  const m = d?.message;
  if (m?.role !== "user" || d.isMeta === true || d.isCompactSummary === true) return false;
  const c = m.content;
  const text = typeof c === "string" ? c : Array.isArray(c) && c.length > 0 && c[0]?.type === "text" ? String(c[0].text ?? "") : null;
  if (text === null) return false;
  return !/^\s*(<command-|<local-command-|\[Request interrupted)/.test(text);
}

/** Claude Code's transcripts: one Sum a (day, model, entrypoint, folder) for the days in [from, to]; an answer once by its message id */
export async function claudeDays(root: string, from: string, to: string): Promise<Map<string, Sum>> {
  const out = new Map<string, Sum>();
  for (const { path } of jsonlFiles(root, startOfDay(from))) {
    try {
      const seen = new Set<string>();   // message ids counted in this file
      const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        const isA = line.includes('"type":"assistant"'), isU = !isA && line.includes('"type":"user"');
        if (!isA && !isU) continue;
        let d: any; try { d = JSON.parse(line); } catch { continue; }
        if (d?.type !== (isA ? "assistant" : "user")) continue;
        const day = dayOfIso(d.timestamp);
        if (!day || day < from || day > to) continue;
        const m = d.message;
        if (isU && !isPrompt(d)) continue;
        if (isA) {
          const id = typeof m?.id === "string" ? m.id : typeof d.requestId === "string" ? d.requestId : "";
          if (id) { if (seen.has(id)) continue; seen.add(id); }
        }
        const model = isA ? asWord(m?.model) || "unknown" : "";
        const via = asWord(d.entrypoint) || "unknown", f = folderWords(d.cwd);
        // a prompt is counted under the model of the session's answers: until one is seen it sits under "" and is joined below
        const key = `${day}|${model}|${via}|${f.folder}|${f.dir}`;
        let s = out.get(key); if (!s) { s = sum(); out.set(key, s); }
        if (isU) { s.prompts++; continue; }
        s.answers++;
        if (typeof d.sessionId === "string") s.sessions.add(d.sessionId);
        const u = m?.usage ?? {};
        s.input += n(u.input_tokens); s.output += n(u.output_tokens); s.cache_read += n(u.cache_read_input_tokens); s.cache_write += n(u.cache_creation_input_tokens);
      }
    } catch { /* a file that cannot be read: skipped */ }
  }
  // the prompts counted under no model join the day's answers of the same (via, folder), the model with the most answers
  for (const [key, s] of [...out]) {
    const [day, model, via, folder, dir] = key.split("|");
    if (model !== "") continue;
    out.delete(key);
    let best: [string, Sum] | null = null;
    for (const [k2, s2] of out) if (k2.startsWith(`${day}|`) && k2.endsWith(`|${via}|${folder}|${dir}`) && (!best || s2.answers > best[1].answers)) best = [k2, s2];
    if (best) best[1].prompts += s.prompts;
    else out.set(`${day}|none|${via}|${folder}|${dir}`, s);
  }
  return out;
}

/**
 * Codex's sessions: one Sum a (day, model, folder) for the files last changed in [from, to], the day being the one the
 * file last changed. Each session's file holds a running total; `counted` is what was counted of it before, and only
 * the growth is counted now, so a session that runs past midnight or is resumed later is never counted twice.
 */
export async function codexDays(root: string, from: string, to: string, counted: Record<string, [number, number]> = {}, nowMs = Date.now()): Promise<Map<string, Sum>> {
  const out = new Map<string, Sum>();
  for (const { path, mtime } of jsonlFiles(root, startOfDay(from))) {
    const day = dayOf(new Date(mtime));
    if (day < from || day > to) continue;
    try {
      let cwd: unknown = "", model = "", total: any = null, id = basename(path);
      const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!(line.includes('"session_meta"') || line.includes('"turn_context"') || line.includes('"token_count"'))) continue;
        let d: any; try { d = JSON.parse(line); } catch { continue; }
        const p = d?.payload;
        if (d?.type === "session_meta") { cwd = p?.cwd; if (typeof p?.id === "string") id = p.id; }
        else if (d?.type === "turn_context" && typeof p?.model === "string") model = p.model;
        else if (d?.type === "event_msg" && p?.type === "token_count" && p.info?.total_token_usage) total = p.info.total_token_usage;
      }
      if (!total) continue;
      const input = n(total.input_tokens), output = n(total.output_tokens), cached = n(total.cached_input_tokens);
      const before = counted[id]?.[0] ?? 0, all = input + output + cached;
      if (all <= before) { counted[id] = [before, nowMs]; continue; }   // nothing new in this file since it was counted
      const share = before ? (all - before) / all : 1;   // the growth, split as the totals are
      const f = folderWords(cwd), key = `${day}|${asWord(model) || "unknown"}|${f.folder}|${f.dir}`;
      let s = out.get(key); if (!s) { s = sum(); out.set(key, s); }
      s.sessions.add(id);
      s.input += Math.round(input * share); s.output += Math.round(output * share); s.cache_read += Math.round(cached * share);
      counted[id] = [all, nowMs];
    } catch { /* skipped */ }
  }
  return out;
}

/** the plan words: Claude Code's oauthAccount and the Codex sign-in's id token claim; never a token, never an email */
export function planWords(claudeJson: string, codexAuth: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const oa = JSON.parse(readFileSync(claudeJson, "utf8"))?.oauthAccount ?? {};
    out.claude = asWord(oa.subscriptionType || oa.organizationType || oa.billingType) || "none";
    const rate = asWord(oa.organizationRateLimitTier || oa.userRateLimitTier); if (rate) out.claude_rate = rate;
  } catch { out.claude = "none"; }
  try {
    const a = JSON.parse(readFileSync(codexAuth, "utf8"));
    out.codex_mode = asWord(a?.auth_mode) || "none";
    const tok = a?.tokens?.id_token;
    if (typeof tok === "string" && tok.split(".").length === 3) {
      const claims = JSON.parse(Buffer.from(tok.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      out.codex = asWord(claims?.["https://api.openai.com/auth"]?.chatgpt_plan_type) || "none";
    } else out.codex = "none";
  } catch { out.codex = "none"; }
  return out;
}

/** which of APPS is installed, by its word */
export function appsInstalled(dirs: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [word, app] of APPS) out[word] = dirs.some((d) => existsSync(join(d, app)));
  return out;
}

const props = (s: Sum) => ({ prompts: s.prompts, answers: s.answers, sessions: s.sessions.size, input: s.input, output: s.output, cache_read: s.cache_read, cache_write: s.cache_write });
const ctx = { kind: KIND };

/**
 * One scan: the days not yet counted (from 90 days back on the first, then from the day after the last) up to
 * yesterday become files.claude.day and files.codex.day lines, a day at a time with the state written after each;
 * files.plan and files.apps go once a day. Usage off: nothing is read. What it wrote.
 */
export async function scanOthers(r: Roots = defaultRoots()): Promise<{ days: number; claude: number; codex: number; said: boolean }> {
  const got = { days: 0, claude: 0, codex: 0, said: false };
  try {
    if (r.consent && !r.consent()) return got;
    const now = (r.now ?? (() => new Date()))(), today = dayOf(now), yesterday = plusDays(today, -1);
    const st = readState();
    const from = st.through ? plusDays(st.through, 1) : plusDays(today, -BACK_DAYS);
    if (from <= yesterday) {
      const c = await claudeDays(r.claude, from, yesterday);
      const x = await codexDays(r.codex, from, yesterday, st.codex, now.getTime());
      for (let day = from; day <= yesterday; day = plusDays(day, 1)) {
        for (const [key, s] of c) {
          const [d, model, via, folder, dir] = key.split("|");
          if (d === day && track("files.claude.day", { day, model: model!, via: via!, folder: folder!, dir: dir!, ...props(s) }, ctx)) got.claude++;
        }
        for (const [key, s] of x) {
          const [d, model, folder, dir] = key.split("|");
          if (d === day && track("files.codex.day", { day, model: model!, folder: folder!, dir: dir!, sessions: s.sessions.size, input: s.input, output: s.output, cache_read: s.cache_read }, ctx)) got.codex++;
        }
        got.days++;
        st.through = day;
        writeState(st);   // an engine that dies mid-scan repeats at most this day
      }
    }
    if (st.said !== today) {
      track("files.plan", planWords(r.claudeJson, r.codexAuth), ctx);
      track("files.apps", appsInstalled(r.apps), ctx);
      st.said = today; got.said = true;
    }
    writeState(st);
  } catch (err) { console.log(`track: the other tools' files not counted: ${err instanceof Error ? err.message : err}`); }
  return got;
}

let timer: NodeJS.Timeout | null = null;
/** Two minutes after start, then every six hours (a scan that has nothing new to count writes nothing). */
export function startOthers(r: Roots = defaultRoots()) {
  if (timer) clearInterval(timer);
  const tick = () => { void scanOthers(r); };
  setTimeout(tick, FIRST_AFTER_MS).unref();
  timer = setInterval(tick, EVERY_MS);
  timer.unref();
}
