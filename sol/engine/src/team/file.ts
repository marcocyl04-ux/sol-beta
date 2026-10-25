// File it (#119): seeing a bug and filing it is one press, not a session. The press (the notch's card or the line over
// the composer) takes a shot of the window at once; a line of the person's words follows; then one issue goes on the
// team's tracker with the label of the mode they were in (life, work, cowork), the screen they were on (the page, the
// conversation id, this engine's health line and the commit it runs), the words, and the shot, signed "<login>'s
// agent". The number comes back as a receipt. Who it lands on is the label's lead (#118's routing), never decided here.
//
// The shot: the window's own pixels, by `screencapture -l <window id>` (the Sol window found by its owner and title
// through CoreGraphics, so a window behind another app is still itself), as a jpeg at most 2000 px wide. It is kept in
// one slot here for 10 minutes and deleted once filed. It goes to GitHub as a file on the person's `<login>/shots`
// branch (made from main the first time, like `<login>/plan`; nobody's claim, claims.ts), and the issue shows it.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sign } from "./note.js";
import { makeGithubRecord } from "./record.js";

export const MODES = ["life", "work", "cowork"] as const;
export type Mode = (typeof MODES)[number];
export type FileAsk = { mode: string; words: string; page?: string; conversation?: string; shot?: string };
export type Filed = { number: number; url: string; shot: boolean; note?: string };
export type FileDeps = {
  gh: (args: string[]) => Promise<string>;                  // the GitHub CLI (gh's own sign-in, never a token here)
  ghInput: (args: string[], body: object) => Promise<string>;   // gh with a JSON body on --input (a shot is too big for an argument)
  login: () => Promise<string>;
  mayGitHub: () => boolean;                                 // Settings, my agent: may it speak on GitHub
  repo: () => string;                                       // the team's tracker, "owner/name"
  health: () => string;                                     // this engine's health line
  build: () => Promise<string>;                             // "main 7d9b3a3": what this engine runs
  shot: (id: string) => Buffer | null;                      // the held shot, if it is this one and still fresh
  now?: () => Date;
};

export const WORDS_MAX = 280;
const TITLE_MAX = 90;
const MODE_NAME: Record<Mode, string> = { life: "Life", work: "Work", cowork: "Cowork" };

/** the person's words as one line: whitespace folded, at most WORDS_MAX characters (pure) */
export const oneLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, WORDS_MAX);
const cut = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…");
const safe = (s: unknown, max = 120) => String(s ?? "").replace(/[\r\n`]+/g, " ").trim().slice(0, max);

/** the health line, as the window's four cells say it (Picker.tsx Dots) (pure) */
export function healthLine(h: { kept: boolean; build: { alive: boolean; errors: number | null } | null; face: boolean; reverted: { what: string; at: string } | null } | null): string {
  if (!h) return "not read yet";
  const b = h.build;
  return [
    h.kept ? "kept" : "not kept",
    !b ? "no build watcher" : !b.alive ? "build watcher stopped" : (b.errors ?? 0) > 0 ? `build: ${b.errors} error${b.errors === 1 ? "" : "s"}` : "build: watching, 0 errors",
    h.face ? "face hot" : "face cold",
    h.reverted ? `put back (${h.reverted.what}) at ${h.reverted.at}` : "nothing put back",
  ].join(" · ");
}

/** the issue's title and body (pure) */
export function issueOf(a: { mode: Mode; words: string; page: string; conversation: string; health: string; build: string; login: string; shotUrl?: string; shotNote?: string }) {
  const title = cut(`${MODE_NAME[a.mode]}: ${a.words}`, TITLE_MAX);
  const screen = [
    `- page: ${a.page || MODE_NAME[a.mode]}`,
    `- conversation: ${a.conversation ? `\`${a.conversation}\`` : "none open"}`,
    `- engine: ${a.health}`,
    ...(a.build ? [`- Sol: ${a.build}`] : []),
  ];
  const shot = a.shotUrl ? `![the window](${a.shotUrl})` : `_${a.shotNote || "no screenshot"}_`;
  const body = `${a.words}\n\n**The screen**\n${screen.join("\n")}\n\n${shot}\n\n${sign(a.login)}`;
  return { title, body };
}

/** file it: one issue, labelled with the mode, the screen and the shot on it; returns its number */
export async function fileIt(d: FileDeps, f: FileAsk): Promise<Filed> {
  const mode = String(f.mode ?? "") as Mode;
  if (!MODES.includes(mode)) throw new Error(`which mode? one of ${MODES.join(", ")}`);
  const words = oneLine(f.words);
  if (!words) throw new Error("a line of your words first: what is wrong");
  if (!d.mayGitHub()) throw new Error("my agent may not speak on GitHub (Settings, my agent); nothing was filed");
  const repo = d.repo();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("no team tracker is set (Settings, team repos)");
  const login = await d.login();
  if (!login) throw new Error("who am I on GitHub? gh is not signed in");
  const now = d.now?.() ?? new Date();

  // the shot first: a failure there costs the picture, never the issue
  let shotUrl: string | undefined, shotNote: string | undefined;
  const img = f.shot ? d.shot(String(f.shot)) : null;
  if (f.shot && !img) shotNote = "the screenshot was too old or gone; none attached";
  if (img) {
    try { shotUrl = await putShot(d, repo, login, img, now, mode); }
    catch (e) { shotNote = `the screenshot did not upload (${safe((e as Error)?.message ?? e, 160)})`; }
  }
  const build = await d.build().catch(() => "");
  const { title, body } = issueOf({ mode, words, page: safe(f.page), conversation: safe(f.conversation, 200), health: d.health(), build, login, shotUrl, shotNote });
  const out = await makeGithubRecord(d.gh).cards.open(title, mode, body, repo);
  const m = /\/issues\/(\d+)/.exec(out);
  if (!m) throw new Error(`GitHub did not say the number (${safe(out, 120) || "no answer"})`);
  return { number: Number(m[1]), url: out.trim().split(/\s+/).pop() ?? "", shot: !!shotUrl, ...(shotNote ? { note: shotNote } : {}) };
}

/** the shot as a file on <login>/shots (the branch made from main the first time); its URL as an issue shows it */
async function putShot(d: FileDeps, repo: string, login: string, img: Buffer, now: Date, mode: Mode): Promise<string> {
  const ref = `${login}/shots`;
  const rec = makeGithubRecord(d.gh, { input: d.ghInput });
  const exists = await rec.code.branch(repo, ref).catch(() => "");
  if (!exists.trim()) {
    const main = (await rec.code.mainSha(repo)).trim();
    await rec.code.makeBranch(repo, ref, main);
  }
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
  const path = `shots/${stamp}-${mode}.${isPng(img) ? "png" : "jpg"}`;   // a held grab is a png (holdShot)
  await rec.files.putBody(repo, path, {
    message: `shot: ${mode}, ${stamp} (${sign(login)})`, branch: ref, content: img.toString("base64"),
  });
  return `https://github.com/${repo}/blob/${ref.split("/").map(encodeURIComponent).join("/")}/${path}?raw=true`;
}

// ---- the shot slot: one at a time, 10 minutes, deleted once filed ----
const DIR = join(tmpdir(), "sol-file");
export const SHOT_MS = 10 * 60_000;
let held: { id: string; path: string; at: number } | null = null;
const run = (cmd: string, args: string[], ms = 10_000) => new Promise<string>((ok, no) =>
  execFile(cmd, args, { timeout: ms, maxBuffer: 4 * 1024 * 1024 }, (err, out, errOut) => (err ? no(new Error(String(errOut || err.message).trim().split("\n")[0])) : ok(String(out)))));

// CoreGraphics through JXA: the window of `owner` titled `title` at layer 0, else its largest layer-0 window
const FIND = (owner: string, title: string) => `ObjC.import('CoreGraphics');
const a = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0)); let best = null;
for (let i = 0; i < a.count; i++) { const w = a.objectAtIndex(i); const u = (k) => ObjC.unwrap(w.objectForKey(k));
  if (u('kCGWindowOwnerName') !== ${JSON.stringify(owner)} || u('kCGWindowLayer') !== 0) continue;
  const b = w.objectForKey('kCGWindowBounds'); const area = ObjC.unwrap(b.objectForKey('Width')) * ObjC.unwrap(b.objectForKey('Height'));
  const score = (u('kCGWindowName') === ${JSON.stringify(title)} ? 1e9 : 0) + area;
  if (!best || score > best.score) best = { id: u('kCGWindowNumber'), score }; }
best ? String(best.id) : '';`;

/** take the window's shot now and hold it; its id, for the file that follows */
export async function takeShot(owner = "Sol", title = "Sol"): Promise<string> {
  if (process.platform !== "darwin") throw new Error("a screenshot needs the Mac");
  const id = (await run("osascript", ["-l", "JavaScript", "-e", FIND(owner, title)])).trim();
  if (!/^\d+$/.test(id)) throw new Error("the Sol window was not found");
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  drop();
  const shot = randomBytes(6).toString("hex"), path = join(DIR, `${shot}.jpg`);
  await run("screencapture", ["-x", "-o", "-t", "jpg", "-l", id, path]);
  await run("sips", ["-Z", "2000", path]).catch(() => "");   // a retina window is 3400 px wide; half is plenty
  held = { id: shot, path, at: Date.now() };
  return shot;
}
/** hold these bytes as the shot (a grab, marked up in the sheet: Grab and Shelf); its id, for the file that follows */
export function holdShot(buf: Buffer): string {
  if (!buf?.length) throw new Error("no picture to hold");
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  drop();
  const shot = randomBytes(6).toString("hex"), path = join(DIR, `${shot}.${isPng(buf) ? "png" : "jpg"}`);
  writeFileSync(path, buf, { mode: 0o600 });
  held = { id: shot, path, at: Date.now() };
  return shot;
}
const isPng = (b: Buffer) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
/** the held shot, if it is this one and fresh */
export function heldShot(id: string): Buffer | null {
  if (!held || held.id !== id || Date.now() - held.at > SHOT_MS) return null;
  try { return readFileSync(held.path); } catch { return null; }
}
/** forget the held shot (filed, or a new one taken) */
export function drop() { if (held) { rmSync(held.path, { force: true }); held = null; } }
