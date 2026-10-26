// The notch's skill (#253): everything Anticipate does is
// written in one file the person edits, home/skills/notch.md. Sol reads it at a talk's start; the person changes it in
// any editor; there is no settings page. Plain headings: Anticipate (the card seat's rules, "Never on:" lines),
// Buttons (`Name: prompt`, five at most), Mute (`App: keys`, the app's name as macOS shows it), After a talk.
//
// readSkill writes the file once when it is missing (sitting 1's SEAT_RULES as the Anticipate text) and never after.
// A missing heading means its defaults; a file with none of the headings, or one that cannot be read, is the defaults
// with one plain line in the log. It never throws. `<!-- -->` comments are the file's notes to its reader, not rules.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type SkillButton = { name: string; prompt: string };
export type MuteKey = { app: string; keys: string };
export type Skill = { rules: string; never: string[]; buttons: SkillButton[]; mute: MuteKey[]; after: string; languages: string[] };

/** three languages at most are heard at once (each is one speech engine per side) */
export const MAX_LANGUAGES = 3;

export const MAX_BUTTONS = 5;

/** the card seat's rules (sitting 1), the default Anticipate text of the skill file */
export const SEAT_RULES = [
  "You are helping Marco in a live conversation he is in right now. You see what was just said, as lines \"Marco: ...\" and \"them: ...\".",
  "Answer in exactly this shape and nothing else:",
  "a headline of at most six words, the gist in Marco's own voice;",
  "then at most two bullets, each starting with \"- \" and at most fifteen words: the exact words Marco could say;",
  "then one line starting with \"source:\" naming where it comes from (the talk, the screen, a file, an issue, memory).",
  "For example:\nFriday, end of day\n- I'll send Frank the relay key on Friday, by end of day.\nsource: the talk",
  "Never write about Marco in the third person, never give advice about what to say. No greeting, no preamble, no headings.",
  "You know only what is in the message: never invent a date, a number or a fact; when the talk does not say, give Marco the words to say he will check.",
  "If there is nothing worth saying, answer exactly: nothing",
].join("\n");

export const DEFAULT_BUTTONS: SkillButton[] = [
  { name: "Answer", prompt: "what Marco should say right now, in reply to the last thing said to him, from the last minute" },
  { name: "Say next", prompt: "what Marco should say next to move this conversation on" },
  { name: "Recap", prompt: "what has been said so far: the decisions, promises, names and numbers, from the whole talk" },
  { name: "Who", prompt: "who Marco is talking to and what they want, from the whole talk" },
];
export const DEFAULT_MUTE: MuteKey[] = [
  { app: "zoom.us", keys: "cmd shift a" },
  { app: "Microsoft Teams", keys: "cmd shift m" },
  { app: "FaceTime", keys: "cmd shift m" },
  { app: "WhatsApp", keys: "cmd shift m" },
  { app: "Google Chrome", keys: "cmd d" },
];
export const DEFAULT_AFTER = [
  "At most three questions after a talk, each about something said in it (a promise, a date, a name, a number), quoting its words; none is fine.",
  "To memory (home/memory/talks.md): the recap, what Marco promised, what they asked him, the decisions, and his answers to the questions.",
  "Never to memory: the transcript itself (it stays in home/voice/talks), anything said on a \"Never on\" subject, passwords, keys, numbers of cards or accounts.",
].join("\n");

export const DEFAULT_SKILL: Skill = { rules: SEAT_RULES, never: [], buttons: DEFAULT_BUTTONS, mute: DEFAULT_MUTE, after: DEFAULT_AFTER, languages: [] };

/** the file as it is written once when missing */
export function defaultSkillText(): string {
  return [
    "# The notch", "",
    "<!-- Sol reads this file at the start of every talk. Change anything; a missing heading means its defaults. -->", "",
    "## Anticipate", "",
    SEAT_RULES, "",
    "<!-- \"Never on:\" lines: subjects Sol never volunteers a card about, separated by commas (a press is always answered). -->",
    "Never on:", "",
    "## Buttons", "",
    "<!-- One line a button, `Name: what it asks`. Five at most; more are ignored. -->",
    ...DEFAULT_BUTTONS.map((b) => `${b.name}: ${b.prompt}`), "",
    "## Mute", "",
    "<!-- One line a call app, `App: keys`, the app's name as macOS shows it. Sent while you hold the globe key to talk to Sol. WeChat publishes no mute shortcut; add a line here when you find one. -->",
    ...DEFAULT_MUTE.map((m) => `${m.app}: ${m.keys}`), "",
    "## Languages", "",
    "<!-- The languages a talk may be in, as codes (en-US, zh-CN, it-IT), three at most, separated by commas. Every side is heard in all of them at once and each turn keeps the one it was said in. Empty: the languages of this Mac (System Settings > Language & Region). -->", "",
    "## After a talk", "",
    DEFAULT_AFTER, "",
  ].join("\n");
}

const HEADINGS = ["anticipate", "buttons", "mute", "languages", "after a talk"] as const;
type Heading = (typeof HEADINGS)[number];
const bulletless = (l: string) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, "").trim();

/** the skill file's text as a skill; `say` gets the plain lines for the log (pure) */
export function parseSkill(text: string, say: (line: string) => void = () => {}): Skill {
  const body = String(text ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const sections = new Map<Heading, string[]>();
  let into: string[] | null = null;
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const name = h[1].toLowerCase().replace(/[^\p{L} ]+/gu, "").trim() as Heading;
      if ((HEADINGS as readonly string[]).includes(name)) { into = []; sections.set(name, into); }
      else { into = null; say(`skill: the heading "${h[1]}" in home/skills/notch.md is not one Sol knows (Anticipate, Buttons, Mute, After a talk); ignored`); }
      continue;
    }
    if (/^#\s/.test(line)) { into = null; continue; }
    into?.push(line);
  }
  if (!sections.size) {
    say("skill: home/skills/notch.md has none of its headings (## Anticipate, ## Buttons, ## Mute, ## After a talk); the defaults are used");
    return { ...DEFAULT_SKILL };
  }
  const out: Skill = { ...DEFAULT_SKILL };

  const ant = sections.get("anticipate");
  if (ant) {
    const never: string[] = [], keep: string[] = [];
    for (const l of ant) {
      const n = /^\W*never on\W*:\s*(.*)$/i.exec(l.trim());
      if (n) never.push(...n[1].split(/[,;]/).map((s) => s.trim().replace(/\.$/, "")).filter(Boolean));
      else keep.push(l);
    }
    const rules = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    out.rules = rules || SEAT_RULES;
    out.never = never;
  }

  const btn = sections.get("buttons");
  if (btn) {
    const buttons: SkillButton[] = [];
    for (const l of btn.map(bulletless).filter(Boolean)) {
      const m = /^([^:]{1,24}):\s*(.+)$/.exec(l);
      if (!m) { say(`skill: a Buttons line without "Name: prompt" is ignored: ${l.slice(0, 80)}`); continue; }
      const name = m[1].trim(), prompt = m[2].trim();
      if (buttons.some((b) => b.name.toLowerCase() === name.toLowerCase())) continue;
      if (buttons.length >= MAX_BUTTONS) { say(`skill: five buttons at most; "${name}" is ignored`); continue; }
      buttons.push({ name, prompt });
    }
    if (buttons.length) out.buttons = buttons;
    else say("skill: the Buttons heading has no buttons; the four defaults are used");
  }

  const mute = sections.get("mute");
  if (mute) {
    const keys: MuteKey[] = [];
    for (const l of mute.map(bulletless).filter(Boolean)) {
      const i = l.lastIndexOf(":");
      const app = i > 0 ? l.slice(0, i).trim() : "", k = i > 0 ? l.slice(i + 1).trim().toLowerCase().replace(/[+\-]/g, " ").replace(/\s+/g, " ") : "";
      if (!app || !k) { say(`skill: a Mute line without "App: keys" is ignored: ${l.slice(0, 80)}`); continue; }
      keys.push({ app, keys: k.replace(/\bcommand\b|⌘/g, "cmd").replace(/⇧/g, "shift").trim() });
    }
    if (keys.length) out.mute = keys;
  }

  const after = sections.get("after a talk");
  if (after) out.after = after.join("\n").trim() || DEFAULT_AFTER;

  const langs = sections.get("languages");
  if (langs) {
    const codes: string[] = [];
    for (const raw of langs.map(bulletless).join(",").split(/[,;\s]+/)) {
      const c = raw.trim().replace(/_/g, "-");
      if (!c) continue;
      if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,4}){0,2}$/i.test(c)) { say(`skill: a Languages entry that is not a code like en-US or zh-CN is ignored: ${c.slice(0, 40)}`); continue; }
      if (codes.some((x) => x.toLowerCase() === c.toLowerCase())) continue;
      if (codes.length >= MAX_LANGUAGES) { say(`skill: three languages at most; "${c}" is ignored`); continue; }
      codes.push(c);
    }
    out.languages = codes;
  }
  return out;
}

export const skillPath = (home: string) => join(home, "skills", "notch.md");

/** home/skills/notch.md as the skill: written once when missing, the defaults on any failure (never throws) */
export function readSkill(home: string): Skill {
  const path = skillPath(home);
  const say = (l: string) => console.log(l);
  try {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      try {
        writeFileSync(path, defaultSkillText(), { flag: "wx" });   // wx: never over a file that appeared meanwhile
        console.log(`skill: wrote ${path}, the notch's skill (yours to edit)`);
      } catch (err) { if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err; }
    }
    return parseSkill(readFileSync(path, "utf8"), say);
  } catch (err) {
    say(`skill: home/skills/notch.md could not be read (${err instanceof Error ? err.message.split("\n")[0] : err}); the defaults are used`);
    return { ...DEFAULT_SKILL };
  }
}
