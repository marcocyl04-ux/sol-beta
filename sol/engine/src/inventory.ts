// What a seat may do, per side. Home (Marco's own life: school, notes) is narrow on purpose: read anything,
// write only inside home/, a few read-only commands, the web, Sol's browser. Work (sitting 4) will pass a
// wider inventory of the same shape. Codex enforces its part with the sandbox; Claude's part is canUseTool.

import { resolve, sep, dirname, isAbsolute } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

export type Inventory = {
  can: string[];
  cannot: string[];
  codex: { sandboxMode: "read-only" | "workspace-write" | "danger-full-access"; networkAccessEnabled: boolean };
  claude: {
    permissionMode: "acceptEdits" | "default";
    // Only tools that need no check go in allowedTools: a tool listed there skips canUseTool.
    allowedTools: string[];
    // The tools the model is shown at all; the rest are checked by canUseTool.
    tools: string[];
    canUseTool: (home: string) => CanUseTool;
  };
};

// Resolve a path as the OS would (symlinks too), even if the file does not exist yet.
function real(p: string): string {
  let cur = resolve(p);
  const rest: string[] = [];
  while (!existsSync(cur) && dirname(cur) !== cur) {
    rest.unshift(cur.slice(dirname(cur).length + 1));
    cur = dirname(cur);
  }
  try {
    cur = realpathSync(cur);
  } catch {}
  return resolve(cur, ...rest);
}
export function insideHome(home: string, p: string): boolean {
  const h = real(home);
  const r = real(isAbsolute(p) ? p : resolve(h, p.startsWith("~/") ? p.replace("~", homedir()) : p));
  return r === h || r.startsWith(h + sep);
}

// Mutable mode (2026-10-15): Sol may change its own face. Next to home/ in the same checkout: the Mac app's pages
// (mac/src) and the look as data (design/). Writes there are allowed, and two commands: ../mutate "<one line>" commits
// an edit, ../undo reverts the last one. Only the Work seat (Claude, this canUseTool) can; Codex's sandbox stays in home/.
export const solRoots = (home: string) => [resolve(real(home), "..", "mac", "src"), resolve(real(home), "..", "design")];
const inside = (root: string, p: string) => { const r = real(p); return r === root || r.startsWith(root + sep); };
export function mutableWrite(home: string, p: string): boolean {
  const abs = isAbsolute(p) ? p : resolve(real(home), p);
  return solRoots(home).some((root) => inside(root, abs));
}
// The fence (issue #15): the files that keep the window alive while the seat changes it (the boundaries, the tape, the
// store, the HMR hooks, the two pages that mount them). The seat may read them, never write them.
// and (safety pass #11) the files that build the messages sent to the engine, so an edit cannot speak for Marco,
// and (#16 blocker 5) what the fence itself imports: the ring (the colours as data) and the frame loop, so no
// seat-editable file can break the boundaries that take a broken edit back
const FENCE = ["Site.tsx", "renovation.ts", "socket.ts", "engine.ts", "sites.ts", "hot.ts", "main.tsx", "notch/main.tsx", "useEngine.ts", "run.ts", "work/useWork.ts", "notch/useNotch.ts", "away/useDoor.ts",
  "creature/ring.ts", "creature/loop.ts", "creature/states.ts", "notch/devTauri.ts", "creature/palette.ts"]; // palette.ts: generated from design/palette.json
export function fenced(home: string, p: string): boolean {
  const abs = real(isAbsolute(p) ? p : resolve(real(home), p));
  const src = resolve(real(home), "..", "mac", "src");
  return FENCE.some((f) => abs === resolve(src, f));
}
// "../mutate msg" or "../undo", as the seat runs them from home/ (or by their full path).
export function solScript(home: string, cmd: string): "mutate" | "undo" | null {
  const first = cmd.trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  const abs = real(isAbsolute(first) ? first : resolve(real(home), first));
  for (const name of ["mutate", "undo"] as const) if (abs === resolve(real(home), "..", name)) return name;
  return null;
}

// Secrets (safety pass #11): reading is allowed anywhere except these. Other agents' homes, keys, Claude's own state,
// the engine's keys and settings, any .env file. A search over many files (grep -r, rg, find, Glob, Grep) stays inside
// home/ and the face, so it can never walk into one of these from above.
const SECRET_DIRS = [".hermes", ".codex", ".ssh", ".claude", ".gnupg", ".aws", ".config/gh", "Library/Keychains"].map((d) => resolve(homedir(), d));
export function forbidden(home: string, p: string): boolean {
  const abs = real(isAbsolute(p) ? p : p.startsWith("~") ? p.replace(/^~/, homedir()) : resolve(real(home), p));
  if (SECRET_DIRS.some((d) => abs === d || abs.startsWith(d + sep))) return true;
  { const dot = resolve(real(home), ".claude"); if (abs === dot || abs.startsWith(dot + sep)) return true; }   // the seat's own settings under home
  if (abs.split(sep).some((part) => /^\.env($|\.)|\.env$/.test(part) || /\.sync-conflict-.*\.env/.test(part))) return true;
  const eng = resolve(real(home), "..", "engine");
  return [resolve(eng, "settings.json"), resolve(eng, ".env")].some((f) => abs === f);
}
const searchable = (home: string, p: string) => {
  const q = p.startsWith("~") ? p.replace(/^~/, homedir()) : p;
  return insideHome(home, q) || mutableWrite(home, q);
};

const SAFE_CMDS = new Set(["ls", "cat", "head", "tail", "wc", "date", "pwd", "find", "grep", "rg"]);
const BAD_WORDS = new Set(["sudo", "rm", "mv", "cp"]);
const FIND_WRITES = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);
const RG_RUNS = /^(--pre|--pre-glob|-z|--search-zip)(=|$)/;

// Returns a reason to refuse, or null if the command is fine.
export function badBash(cmd: string, home?: string): string | null {
  if (/[>|;&`\n\r<]|\$\(|\$\{/.test(cmd)) return "only a single plain command is allowed (no > | ; & < backticks or $())";
  // quotes and backslashes are read as the shell reads them, so they cannot hide a path (cat ~/.he"r"mes/.env)
  const words = cmd.trim().split(/\s+/).map((w) => w.replace(/['"\\]/g, ""));
  if (!words[0]) return "empty command";
  for (const w of words) if (BAD_WORDS.has(w)) return `"${w}" is not allowed in Home`;
  if (!SAFE_CMDS.has(words[0])) return `Bash in Home only runs: ${[...SAFE_CMDS].join(", ")}. Use Write/Edit to change files.`;
  if (words[0] === "find" && words.some((w) => FIND_WRITES.has(w))) return "find may not run or delete things";
  if (words[0] === "date" && words.some((w) => w === "-s" || w.startsWith("--set"))) return "date may not set the clock";
  if (words[0] === "rg" && words.some((w) => RG_RUNS.test(w))) return "rg may not run a preprocessor or open archives";
  if (home) {
    const args = words.slice(1).map((w) => w.replace(/^-[^=]*=/, "")).filter((w) => w && !w.startsWith("-"));
    const hit = args.find((w) => forbidden(home, w));
    if (hit) return `${hit} holds secrets; Sol does not read it`;
    const recursive = words[0] === "find" || words[0] === "rg" || (words[0] === "grep" && words.some((w) => /^-[a-zA-Z]*[rR]/.test(w) || w === "--recursive"))
      || (words[0] === "ls" && words.some((w) => /^-[a-zA-Z]*R/.test(w)));
    if (recursive) {
      const roots = args.filter((w) => w.includes("/") || w.startsWith("~") || w.startsWith("."));
      const out = (roots.length ? roots : ["."]).find((w) => !searchable(home, w));
      if (out) return `a search over many files stays inside ${home} and Sol's face; ${out} is outside them`;
    }
  }
  return null;
}

// The seat's own rules (#11 item 2, 2026-10-17): the Life seat runs with settingSources ["project"], so a
// home/.claude/settings.json it wrote would load as its own allow rules next turn, and home/CLAUDE.md is the rulebook
// it is read. Neither is ever written by a seat; .claude under home is not read either.
export function selfRule(home: string, p: string): boolean {
  const abs = real(isAbsolute(p) ? p : p.startsWith("~") ? p.replace(/^~/, homedir()) : resolve(real(home), p));
  const h = real(home);
  const dot = resolve(h, ".claude");
  return abs === dot || abs.startsWith(dot + sep) || abs === resolve(h, "CLAUDE.md") || abs === resolve(h, "AGENTS.md");
}

export function homeCanUseTool(home: string): CanUseTool {
  const allow = (input: Record<string, unknown>): PermissionResult => ({ behavior: "allow", updatedInput: input });
  const deny = (message: string): PermissionResult => ({ behavior: "deny", message });
  return async (tool, input) => {
    const s = (v: unknown) => (typeof v === "string" ? v : undefined);
    if (tool === "Read") { // reading is allowed anywhere but the secrets
      const p = s(input.file_path) ?? "";
      return forbidden(home, p) ? deny(`${p} holds secrets; Sol does not read it.`) : allow(input);
    }
    if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
      const p = s(input.file_path) ?? s(input.notebook_path);
      if (!p) return deny("No file path given.");
      if (fenced(home, p)) return deny(`${p} is part of the fence that keeps Sol's window alive while it changes; it is never edited by a seat.`);
      if (selfRule(home, p)) return deny(`${p} holds the seat's own rules; a seat never writes them.`);
      if (insideHome(home, p) || mutableWrite(home, p)) return allow(input);
      return deny(`Sol may only write inside ${home}, or its own face (${solRoots(home).join(", ")}); ${p} is outside them.`);
    }
    if (tool === "Glob" || tool === "Grep") {
      const paths = [s(input.path), tool === "Glob" ? s(input.pattern) : undefined].filter((x): x is string => !!x && (isAbsolute(x) || x.includes("..") || x.startsWith("~")));
      const out = paths.find((p) => !searchable(home, p.replace(/[*?{[].*$/, "")));
      return out ? deny(`Home may only search inside ${home} and Sol's face (${solRoots(home).join(", ")}); ${out} is outside them.`) : allow(input);
    }
    if (tool === "Bash") {
      const cmd = s(input.command) ?? "";
      // the two scripts that make an edit to the face a commit, and undo it: one plain command, nothing chained
      if (solScript(home, cmd)) return /[>|;&`\n\r<]|\$\(|\$\{/.test(cmd) ? deny("../mutate and ../undo run alone: no > | ; & < backticks or $() in the message") : allow(input);
      const why = badBash(cmd, home);
      return why ? deny(why) : allow(input);
    }
    // the sol skill (sol/setup links it into home/.claude/skills): the map for changing Sol for this person. It only
    // reads; what it leads to goes through these checks. Any other skill is not Home's.
    if (tool === "Skill") return s(input.skill) === "sol" ? allow(input) : deny("Home's one skill is sol.");
    return deny(`${tool} is not part of Home's tools.`);
  };
}

export const HOME_INVENTORY: Inventory = {
  can: ["read any file", "write inside home/", "run commands sandboxed to home/", "the web", "Sol's browser"],
  cannot: ["write outside home/", "change the Mac", "install things"],
  codex: { sandboxMode: "workspace-write", networkAccessEnabled: false },   // off since 2026-10-17 (#11): its shell read any file and had the web; the browser, the desk and web_search go through the engine or Codex itself
  claude: {
    permissionMode: "acceptEdits",
    allowedTools: ["WebSearch", "WebFetch", "mcp__sol__*"],
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Bash", "Skill"],   // Skill: the sol skill only (below)
    canUseTool: homeCanUseTool,
  },
};
