// The team settings (Together, sol/design/together/BUILD.md): one JSON file beside the engine, sol/engine/team.json
// (gitignored; SOL_TEAM overrides the path, for tests and a second engine). The same clean/merge pattern as
// ../settings.ts: whatever is on disk or in a patch is made into a valid TeamSettings, anything unknown is dropped.
// See owns this file; the other slices read and write through its exports. The schema is complete: no slice changes it.
// Control (#32) adds: the machine rows, the login guard and the Life seat mirror in patchTeam, and where my agent may
// speak (mayAgentSpeak, speakParagraph, speakRefusal). The night job (#99) adds `night`: its hour and the days a claim
// may sit still (docs/how-we-work/PRD.md section 12, a team value). Pings (#100) add the dials: per ping kind, always,
// when it matters, or never (pings.ts).
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings, patchSettings } from "../settings.js";
import { cleanDials, DIAL_DEFAULTS, type Dials } from "./pings.js";

export type TeamSettings = {
  me: { login: string; name: string };                 // from `gh api user` on first run (no gh: name from SOL_OWNER); the person may edit name
  org: string;                                         // the GitHub org ("" until Marco makes it)
  repos: string[];                                     // "owner/name"; when org is "", this list is the org
  relay: { url: string; key: string; host: boolean };  // url "" = this engine's own relay; host = this engine runs one
  speak: { github: boolean; cowork: boolean; discord: "never" | "builds" | "any"; whatsapp: boolean };
  leaves: { prompts: boolean; memory: boolean; transcripts: boolean; audit: "ask" | "never" };
  seats: { life: "codex" | "claude"; work: "codex" | "claude" };
  machines: { name: string; url: string }[];           // my machines (the engines I can pick); Control owns the rows
  night: { hour: number; staleDays: number };          // the night job (#99): when it runs, and when a still claim is dropped
  dials: Dials;                                        // per ping kind: always, matters (default), never (#100)
};

export const TEAM_DEFAULTS: TeamSettings = {
  me: { login: "", name: "" },
  org: "",
  repos: ["marcocyl04-ux/sol-dev"],
  relay: { url: "", key: "", host: true },
  speak: { github: true, cowork: true, discord: "builds", whatsapp: false },
  leaves: { prompts: false, memory: false, transcripts: false, audit: "ask" },
  seats: { life: "codex", work: "claude" },
  machines: [],   // absent in a file: this Mac and the relay's machine (defaultMachines); present and empty: empty
  night: { hour: 3, staleDays: 7 },
  dials: { ...DIAL_DEFAULTS },
};

// The rows when a file names none (#169): this Mac, and the machine that runs the team's relay when team.json names
// one (`wss://HOST/relay` is also a Sol at `wss://HOST/`: the NucBox for Marco's team). Before this the NucBox's
// address was written here, and so went into every copy of Sol; a Sol with no relay now knows this machine alone.
export const THIS_MACHINE = { name: "this Mac", url: "ws://127.0.0.1:7777" };
export function defaultMachines(relayUrl: string): { name: string; url: string }[] {
  let u: URL;
  try { u = new URL(relayUrl.trim()); } catch { return [{ ...THIS_MACHINE }]; }
  if (!/^wss?:$/.test(u.protocol) || !u.hostname) return [{ ...THIS_MACHINE }];
  const host = u.hostname;                                   // an IPv6 host keeps its brackets, `[::1]`
  if (["127.0.0.1", "localhost", "[::1]"].includes(host)) return [{ ...THIS_MACHINE }];
  return [{ ...THIS_MACHINE }, { name: host.startsWith("[") ? host : host.split(".")[0], url: `${u.protocol}//${u.host}/` }];
}

const FILE = process.env.SOL_TEAM ?? process.env.SOL_TEAM_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "team.json");

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, d = "", max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const seat = (v: unknown, d: "codex" | "claude") => (v === "codex" || v === "claude" ? v : d);
const int = (v: unknown, d: number, lo: number, hi: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : d);
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const LOGIN = /^[A-Za-z0-9-]{0,39}$/;
const WS = /^wss?:\/\/\S+$/;
const URL_OK = /^wss?:\/\/[^\s/]+(\/\S*)?$/;

// My machines (Control): a name and a ws(s) address each, at most twelve, one row per address. Absent: the defaults
// (this Mac, and the relay's machine when there is one); present and empty: empty (the face then offers this Mac).
export function cleanMachines(v: unknown, relayUrl = ""): { name: string; url: string }[] {
  if (!Array.isArray(v)) return defaultMachines(relayUrl);
  const out: { name: string; url: string }[] = [];
  for (const r of v) {
    if (!isObj(r)) continue;
    const url = str(r.url, "", 300), name = str(r.name, "", 60);
    if (!URL_OK.test(url) || out.some((m) => m.url === url)) continue;
    out.push({ name: name || url.replace(/^wss?:\/\//, "").replace(/[:/].*$/, ""), url });
    if (out.length === 12) break;
  }
  return out;
}

/** whatever came in, made into a valid TeamSettings (pure; exported for the tests) */
export function cleanTeam(raw: unknown): TeamSettings {
  const r = isObj(raw) ? raw : {};
  const me = isObj(r.me) ? r.me : {}, relay = isObj(r.relay) ? r.relay : {}, speak = isObj(r.speak) ? r.speak : {};
  const leaves = isObj(r.leaves) ? r.leaves : {}, seats = isObj(r.seats) ? r.seats : {}, night = isObj(r.night) ? r.night : {};
  const login = str(me.login);
  const repos = Array.isArray(r.repos)
    ? [...new Set(r.repos.filter((x): x is string => typeof x === "string" && REPO.test(x.trim())).map((x) => x.trim()))]
    : TEAM_DEFAULTS.repos;
  const url = str(relay.url, "", 300).replace(/[?#].*$/, "");   // never a key pasted into the address: the key has its own field
  const org = str(r.org);
  return {
    me: { login: LOGIN.test(login) ? login : "", name: str(me.name, "", 80) },
    org: LOGIN.test(org) ? org : "",
    repos: repos.length ? repos : [...TEAM_DEFAULTS.repos],
    relay: { url: url === "" || WS.test(url) ? url : "", key: str(relay.key, "", 200), host: bool(relay.host, true) },
    speak: {
      github: bool(speak.github, true), cowork: bool(speak.cowork, true),
      discord: speak.discord === "never" || speak.discord === "any" ? speak.discord : "builds",
      whatsapp: bool(speak.whatsapp, false),
    },
    leaves: {
      // prompts, memory and transcripts never leave this machine (Marco's rule): fixed rows, not switches
      prompts: false, memory: false, transcripts: false,
      audit: leaves.audit === "never" ? "never" : "ask",
    },
    seats: { life: seat(seats.life, "codex"), work: seat(seats.work, "claude") },
    machines: cleanMachines(r.machines, url === "" || WS.test(url) ? url : ""),
    night: { hour: int(night.hour, 3, 0, 23), staleDays: int(night.staleDays, 7, 1, 90) },
    dials: cleanDials(r.dials),
  };
}

/** a deep merge of b over a: objects merge, everything else (arrays included) replaces */
export function mergeTeam(a: unknown, b: unknown): unknown {
  if (!isObj(a) || !isObj(b)) return b;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(a[k]) ? mergeTeam(a[k], v) : v;
  return out;
}

/** the signature of anything done in the team view: a human, or that human's agent (never unsigned). A Sol with no
 * GitHub (a tester's, #169) signs with the name the install asked for. */
export const signature = (s: TeamSettings, agent: boolean) => { const who = s.me.login || s.me.name; return agent ? `${who}'s agent` : who; };

/** what a face may see: everything but the relay key ("set" says one exists) */
export const forFace = (s: TeamSettings) => ({ ...s, relay: { url: s.relay.url, host: s.relay.host, key: s.relay.key ? "set" : "" } });

let current: TeamSettings | null = null;
const subs = new Set<(s: TeamSettings) => void>();

function write(s: TeamSettings) {
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, FILE);   // never a half-written file
}

export function getTeam(): TeamSettings {
  if (current) return current;
  let raw: unknown = null;
  try { raw = JSON.parse(readFileSync(FILE, "utf8")); } catch { /* first run */ }
  // no team.json yet: Life's helper starts as the one the person already picked (settings.defaults.seat), not Codex
  current = cleanTeam(raw ?? { seats: { life: getSettings().defaults.seat } });
  // no GitHub login and no name yet: the name is the one the install asked for (SOL_OWNER, in .env), so a Sol that
  // never meets gh still knows what to call its person (#169). Written back only with the key below or a later patch.
  if (!current.me.login && !current.me.name && process.env.SOL_OWNER) current.me.name = str(process.env.SOL_OWNER, "", 80);
  // the relay key: made once, here, kept in team.json (a teammate is given it by hand; it never goes to a face)
  if (!current.relay.key) {
    current.relay.key = randomBytes(18).toString("base64url");
    try { write(current); } catch { /* a read-only checkout: the key lives for this run */ }
  }
  if (!current.me.login && !process.env.SOL_TEAM_OFFLINE) void fillMe();
  return current;
}

export function patchTeam(patch: unknown): TeamSettings {
  const p = isObj(patch) ? { ...patch } : {};
  const before = getTeam();
  current = cleanTeam(mergeTeam(before, p));
  if (!current.relay.key) current.relay.key = before.relay.key;
  try { write(current); } catch { /* read-only: kept for this run */ }
  // which helper serves Life is one fact: Life's new conversations start on settings.defaults.seat, so it follows,
  // and only when the patch names it (a name edit never moves the person's Life helper)
  if (isObj(p.seats) && "life" in p.seats && current.seats.life !== getSettings().defaults.seat) patchSettings({ defaults: { seat: current.seats.life } });
  for (const f of subs) f(current);
  return current;
}

export function onTeam(fn: (s: TeamSettings) => void) { subs.add(fn); return () => { subs.delete(fn); }; }

// who I am, from GitHub: `gh api user` once, on the first read with no login (gh's own sign-in; no token in Sol)
let filling: Promise<void> | null = null;
export function fillMe(): Promise<void> {
  if (filling) return filling;
  filling = new Promise<void>((done) => {
    execFile("gh", ["api", "user", "--jq", "{login: .login, name: .name}"], { timeout: 15_000 }, (err, out) => {
      if (!err) {
        try {
          const u = JSON.parse(String(out)) as { login?: unknown; name?: unknown };
          const s = getTeam();
          if (typeof u.login === "string" && u.login && !s.me.login)
            patchTeam({ me: { login: u.login, name: s.me.name || (typeof u.name === "string" && u.name ? u.name : u.login) } });
        } catch { /* gh said something else */ }
      }
      done();
    });
  });
  return filling;
}

// ---- where my agent may speak (Control, #32) ----

export type Where = "github" | "cowork" | "discord" | "whatsapp";
/** may the agent post here? Discord's channel matters only when the setting is "builds" */
export function mayAgentSpeak(s: TeamSettings, where: Where, channel?: string): boolean {
  if (where === "discord") return s.speak.discord === "any" || (s.speak.discord === "builds" && (channel === undefined || channel.replace(/^#/, "") === "builds"));
  return s.speak[where];
}

/** the paragraph every seat's system prompt carries: where it may speak, how it signs, what never leaves */
export function speakParagraph(s: TeamSettings): string {
  const who = s.me.login || s.me.name;
  const sig = who ? `"${who}'s agent"` : `"<their GitHub login>'s agent"`;
  const person = who || "the person at this machine";
  const yn = (b: boolean) => (b ? "yes" : "no");
  const discord = s.speak.discord === "never" ? "never" : s.speak.discord === "builds" ? "only the #builds channel" : "any channel";
  return [
    `Where you may speak (${person}'s own setting in Sol): you act for ${person}, and anything you write where other people read it is signed ${sig}, never as ${person} and never unsigned.`,
    `GitHub (issues, pull requests, comments, reviews): ${yn(s.speak.github)}. Sol's team view (Cowork): ${s.speak.cowork ? "yes, signed" : "no"}. Discord: ${discord}. WhatsApp: ${s.speak.whatsapp ? "yes" : "never"}.`,
    `Prompts, memory and transcripts never leave this machine${s.leaves.audit === "ask" ? `; an audit asks ${person} first` : "; audits are refused"}.`,
    `When a task needs a place you may not speak, say so and stop there; do not find a way around it.`,
  ].join(" ");
}

// What the engine can refuse on its own: a shell command that posts where the setting says no. A Bash call an allow
// rule lets through never reaches this check; the paragraph above covers that case. Returns the reason, or null.
const DISCORD = /discord(?:app)?\.com\/api\//i;
const WHATSAPP = /\b(?:wa\.me|api\.whatsapp\.com|graph\.facebook\.com\/\S*\/messages)\b/i;
const GH_POST = /\bgh\s+(?:(?:pr|issue)\s+(?:create|comment|edit|close|reopen|review|merge|ready|lock)\b|release\s+create\b|gist\s+create\b|api\b[^|;&]*(?:-X\s*|--method[\s=]+)(?:POST|PATCH|PUT|DELETE)\b|api\s+graphql\b[^|;&]*\bmutation\b|api\b(?!\s+graphql\b)[^|;&]*\s(?:-f|-F|--field|--raw-field|--input)\s)/i;
export function speakRefusal(s: TeamSettings, tool: string, input: unknown): string | null {
  if (tool !== "Bash" || !isObj(input) || typeof input.command !== "string") return null;
  const cmd = input.command;
  if (DISCORD.test(cmd) && s.speak.discord === "never") return "My agent may not speak on Discord (Settings, my agent).";
  if (WHATSAPP.test(cmd) && !s.speak.whatsapp) return "My agent may not speak on WhatsApp (Settings, my agent).";
  if (GH_POST.test(cmd) && !s.speak.github) return "My agent may not speak on GitHub (Settings, my agent).";
  return null;
}

/** my GitHub login, asked of gh once when team.json has none yet (Ship signs the stamp with it) */
export async function myLogin(): Promise<string> {
  const s = getTeam();
  if (s.me.login) return s.me.login;
  await fillMe();
  return getTeam().me.login;
}
