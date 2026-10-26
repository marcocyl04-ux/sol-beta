// Control (#32): my accounts. Is Claude Code signed in on this machine, is Codex, and the line that signs in.
// Both sign-ins want a browser and a terminal, so Sol never signs in itself: it hands the face the line to type into a
// terminal pane (work.term.open), and the person presses Return. PROTOCOL.md round 18. GitHub signs in from a card
// instead, gh's device flow run by the engine (team/gh.ts, round 42).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { getTeam, speakRefusal } from "./settings.js";
import { ghPlaces, ownGhOnPath } from "./gh.js";

const run = promisify(execFile);
export type Account = { in: boolean; who?: string; missing?: boolean };
export type Accounts = { claude: Account; codex: Account; github: Account };

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "..", "..");   // sol/engine, from src/team or dist/team
// launchd's PATH is short: look where the installers put them too
const where = (name: string, extra: string[]) => [name, ...extra.filter((p) => existsSync(p))];
const CLAUDE = () => where("claude", [join(homedir(), ".local", "bin", "claude"), join(homedir(), ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]);
const CODEX = () => where("codex", [join(homedir(), ".local", "bin", "codex"), "/opt/homebrew/bin/codex", "/usr/local/bin/codex", join(ENGINE, "node_modules", ".bin", "codex")]);
const GH = ghPlaces;   // PATH's, Sol's own (~/.sol/gh), Homebrew's

type Out = { code: number; out: string };
async function first(bins: string[], args: string[]): Promise<Out | null> {
  for (const b of bins) {
    try {
      const r = await run(b, args, { timeout: 8000 });
      return { code: 0, out: `${r.stdout}\n${r.stderr}` };
    } catch (err: any) {
      if (err?.code === "ENOENT") continue;                        // not here: the next place
      return { code: typeof err?.code === "number" ? err.code : 1, out: `${err?.stdout ?? ""}\n${err?.stderr ?? ""}` };
    }
  }
  return null;   // in none of the places
}

// `claude auth status` prints JSON: { loggedIn, authMethod, email, subscriptionType, ... }
export function readClaude(r: Out | null): Account {
  if (!r) return { in: false, missing: true };
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf("{"), r.out.lastIndexOf("}") + 1));
    if (!j.loggedIn) return { in: false };
    const plan = typeof j.subscriptionType === "string" ? `, ${j.subscriptionType}` : "";
    return { in: true, who: (j.email ? String(j.email) : String(j.authMethod ?? "signed in")) + plan };
  } catch { return { in: r.code === 0 && /logged in/i.test(r.out) && !/not logged in/i.test(r.out) }; }
}
// `codex login status`: "Logged in using ChatGPT" (exit 0) or "Not logged in" (exit 1)
export function readCodex(r: Out | null): Account {
  if (!r) return { in: false, missing: true };
  const line = r.out.split("\n").map((l) => l.trim()).find((l) => /logged in/i.test(l)) ?? "";
  if (r.code !== 0 || /not logged in/i.test(line) || !line) return { in: false };
  const m = /using\s+(.+)$/i.exec(line);
  return { in: true, who: m ? m[1] : undefined };
}
// `gh api user --jq .login`: the login, or nothing
export function readGithub(r: Out | null): Account {
  if (!r) return { in: false, missing: true };
  const login = r.out.trim().split("\n")[0]?.trim();
  return r.code === 0 && login ? { in: true, who: login } : { in: false };
}

export async function accounts(): Promise<Accounts> {
  ownGhOnPath();   // a gh sol/setup fetched since the engine started is on PATH for this read and every gh after it
  const [claude, codex, github] = await Promise.all([
    first(CLAUDE(), ["auth", "status"]).then(readClaude),
    first(CODEX(), ["login", "status"]).then(readCodex),
    first(GH(), ["api", "user", "--jq", ".login"]).then(readGithub),
  ]);
  return { claude, codex, github };
}

// The line the face types into a terminal; the person presses Return and finishes in the browser. Not GitHub: its card
// (team.github.connect, round 42).
export const SIGNIN: Record<"claude" | "codex", string> = {
  claude: "claude auth login",
  codex: "codex login",
};
export const signinCommand = (seat: unknown): string | null => (seat === "claude" || seat === "codex" ? SIGNIN[seat] : null);

// A seat's permission check with my agent's rule in front: a shell command that posts where the setting says no is
// refused with the reason before anything else is asked (speakRefusal, team/settings.ts).
export function guardSpeak(check: CanUseTool): CanUseTool {
  return async (name, input, o) => {
    const no = speakRefusal(getTeam(), name, input);
    return no ? { behavior: "deny", message: no } : check(name, input, o);
  };
}
