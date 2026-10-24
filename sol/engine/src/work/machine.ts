// The engine's machine, for Work's machine drawer: keep it awake while a session works, what is running (versions),
// where its log is and the log's last lines, and a banner when Marco asked for one (macOS only: Notification Center).
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { join } from "node:path";
import { prefs } from "./state.js";

const run = promisify(execFile);
const mac = platform() === "darwin";

// ---- keep awake: caffeinate (macOS) or systemd-inhibit (Linux) held while any run is busy ----
let hold: ChildProcess | null = null;
let ac: { at: number; on: boolean } | null = null;
function onPower() {
  if (ac && Date.now() - ac.at < 60_000) return ac.on;
  let on = true;
  try {
    if (mac) on = execFileSync("pmset", ["-g", "batt"], { timeout: 3000 }).toString().includes("AC Power");
    else {
      const ps = "/sys/class/power_supply";
      const kinds = readdirSync(ps).map((d) => ({ d, t: readFileSync(join(ps, d, "type"), "utf8").trim() }));
      if (kinds.some((k) => k.t === "Battery")) on = kinds.some((k) => k.t === "Mains" && readFileSync(join(ps, k.d, "online"), "utf8").trim() === "1");
    }
  } catch { /* no battery to read: a desktop */ }
  ac = { at: Date.now(), on };
  return on;
}
// while busy, the power source is read again every minute: unplugged mid-run, the hold lets go (and comes back on power)
let busyNow = false, recheck: NodeJS.Timeout | undefined;
export function keepAwake(busy: boolean) {
  busyNow = busy;
  if (busy && !recheck) { recheck = setInterval(() => keepAwake(busyNow), 61_000); recheck.unref(); }
  else if (!busy && recheck) { clearInterval(recheck); recheck = undefined; }
  const p = prefs();
  const want = p.awake && busy && (p.battery || onPower());
  if (want && !hold) {
    // -w: caffeinate lets go by itself if the engine dies
    hold = mac ? spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" })
      : spawn("systemd-inhibit", ["--what=idle:sleep", "--who=Sol", "--why=a Work session is running", "sleep", "infinity"], { stdio: "ignore" });
    const h = hold;
    h.on("error", () => { if (hold === h) hold = null; });
    h.on("exit", () => { if (hold === h) hold = null; });
  } else if (!want && hold) { hold.kill(); hold = null; }
}
export const awake = () => !!hold;
process.on("exit", () => hold?.kill());

// ---- about: versions, the log ----
const LOG = process.env.SOL_LOG ?? (mac ? join(homedir(), "Library", "Logs", "sol-engine.log") : "");
function tail(file: string, lines = 14) {
  try {
    const size = statSync(file).size, n = Math.min(size, 16_384), buf = Buffer.alloc(n), fd = openSync(file, "r");
    readSync(fd, buf, 0, n, size - n); closeSync(fd);
    return buf.toString("utf8").split("\n").filter(Boolean).slice(-lines).map((l) => l.slice(0, 240));
  } catch { return []; }
}
const pkg = (u: URL) => { try { return JSON.parse(readFileSync(u, "utf8")).version as string; } catch { return undefined; } };
export async function about() {
  const here = new URL(".", import.meta.url);   // dist/work/
  const commit = await run("git", ["log", "-1", "--format=%h %cs"], { cwd: here.pathname, timeout: 5000 }).then((r) => r.stdout.trim()).catch(() => "");
  return {
    machine: hostname().replace(/\.local$/, ""), os: platform(), node: process.version,
    engine: commit || pkg(new URL("../../package.json", here)),
    sdk: pkg(new URL("../../node_modules/@anthropic-ai/claude-agent-sdk/package.json", here)),
    claude: await run("claude", ["--version"], { timeout: 5000 }).then((r) => r.stdout.trim().split(" ")[0]).catch(() => undefined),
    log: LOG && existsSync(LOG) ? LOG : undefined, lines: LOG ? tail(LOG) : [],
    awake: !!hold, power: onPower() ? "on power" : "on battery",
  };
}

// ---- a banner: Notification Center through osascript; the words go as arguments, never into the script ----
export async function banner(title: string, body: string) {
  if (!mac) return false;
  const script = "on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run";
  return run("osascript", ["-e", script, title.slice(0, 120), body.slice(0, 240)], { timeout: 5000 }).then(() => true, () => false);
}

// ---- output styles: Claude Code's two, and Marco's own in ~/.claude/output-styles (read, never written) ----
export function styles() {
  const dir = join(homedir(), ".claude", "output-styles");
  let custom: string[] = [];
  try {
    custom = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
      const name = /^---[\s\S]*?^name:\s*(.+)$/m.exec(readFileSync(join(dir, f), "utf8").slice(0, 2000))?.[1]?.trim();
      return name || f.replace(/\.md$/, "");
    });
  } catch { /* none yet */ }
  return { builtIn: ["Explanatory", "Learning"], custom, dir };
}
