// The hub's room registry (#157, docs/room-provider/FOUNDATION.md, the addendum; PROTOCOL.md round 35). A friend joins a
// room by typing a six-symbol code; the code lives on the hub the room meets on, here. One small file on the hub,
// `<state dir>/relay/rooms.json`, the way the spool keeps its own: what a room is (its provider, org and repos, a name),
// who registered it, and who has said hello in it. Never anything from anyone's home: no prompt, no file, no key.
// At most 300 rooms and 5 a maker (the stack's review: an open hub, any GitHub account, so throwaway accounts must not
// fill it for a month). On a full hub a room nobody but its maker ever said hello in, quiet for three days, makes way
// first, then one quiet for 30 days; else the hub is full. A maker may forget their own room. A file that is
// missing or broken reads as no rooms. Guesses counts codes tried that no room has: a code is 30 bits, typed by hand
// like a meeting code, so guessing is the only way at one, and it is made slow. A name is one a hub (#160): trimmed,
// spaces collapsed and case aside, another room's name is refused, so a room made from a name alone is told apart.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { CODE, REPO, LOGIN } from "./settings.js";

export { CODE };
export type Entry = { code: string; name: string; provider: "github" | "drive"; org: string; repos: string[]; by: string; at: number; people: string[]; seen: number };
export type RoomIn = { name?: unknown; provider?: unknown; org?: unknown; repos?: unknown };

export const REGISTRY_MAX = 300;
export const PEOPLE_MAX = 200;
export const PER_MAKER = 5;
export const KEY_ROOMS = 20;
const DAY = 86_400_000;
const QUIET = 30 * DAY;      // a room seen no later than this may make way for a new one on a full hub
export const LONELY = 3 * DAY;   // as may sooner a room only its maker ever came into: one a throwaway account made
const SAW_EVERY = 60_000;    // a hello writes the file only when someone new came in, or the room was not seen for a minute
// an error the http route says with its own status (409: the hub is full)
const withStatus = (line: string, status: number) => Object.assign(new Error(line), { status });
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 32: five bits a symbol, so every symbol is as likely
const SOMEONE = /^[A-Za-z0-9-]{1,39}$/;

/** six symbols from the code's alphabet, uniform: a byte's low five bits pick one of 32 */
export function makeCode(random: (n: number) => Uint8Array = randomBytes): string {
  return [...random(6)].map((b) => ALPHABET[b & 31]).join("");
}

/** a code as typed: trimmed and upper-cased (the alphabet has no 0, O, 1 or I to confuse), or "" when it is not one */
export const normalCode = (v: unknown) => { const c = typeof v === "string" ? v.trim().toUpperCase() : ""; return CODE.test(c) ? c : ""; };

/** a room as sent, made valid, or a plain Error saying what is wrong (pure) */
export function cleanEntryRoom(v: RoomIn): Pick<Entry, "name" | "provider" | "org" | "repos"> {
  const provider = v.provider === "drive" ? "drive" : "github";
  const org = typeof v.org === "string" ? v.org.trim() : "";
  if (!LOGIN.test(org)) throw new Error("a room's org is a GitHub login");
  if (v.repos !== undefined && !Array.isArray(v.repos)) throw new Error("a room's repositories are a list");
  const list = (Array.isArray(v.repos) ? v.repos : []).map((x) => (typeof x === "string" ? x.trim() : ""));
  if (list.length > 20) throw new Error("a room holds at most twenty repositories");
  if (provider === "github" && list.some((x) => !REPO.test(x))) throw new Error("a room's repository is owner/name");
  if (provider === "drive" && list.some((x) => !x || x.length > 200)) throw new Error("a room's folder is an id");
  const repos = [...new Set(list)].sort();
  if (!org && !repos.length) throw new Error("a room is an org or at least one repository");
  const name = (typeof v.name === "string" ? v.name.trim().replace(/\s+/g, " ") : "").slice(0, 60) || org || (repos[0] ?? "").split("/").pop()!.slice(0, 60) || "room";
  return { name, provider, org, repos };
}

/** a room only its maker ever came into */
const lonely = (e: Entry) => e.people.every((p) => p.toLowerCase() === e.by.toLowerCase());

/** a room's name as the hub compares it (#160): trimmed, runs of space as one, case aside */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const sameRoom = (e: Entry, r: Pick<Entry, "provider" | "org" | "repos">, by: string) =>
  e.provider === r.provider && e.org.toLowerCase() === r.org.toLowerCase() && e.by.toLowerCase() === by.toLowerCase()
  && e.repos.map((x) => x.toLowerCase()).join(",") === r.repos.map((x) => x.toLowerCase()).join(",");

/** an entry read from the file, or null when it is not one (a hand edit, an older shape) */
function readEntry(v: unknown): Entry | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  if (typeof e.code !== "string" || !CODE.test(e.code)) return null;
  let room: ReturnType<typeof cleanEntryRoom>;
  try { room = cleanEntryRoom(e); } catch { return null; }
  const by = typeof e.by === "string" && LOGIN.test(e.by) ? e.by : "";
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const people = Array.isArray(e.people) ? [...new Set(e.people.filter((x): x is string => typeof x === "string" && SOMEONE.test(x)))].slice(-PEOPLE_MAX) : [];
  return { code: e.code, ...room, by, at: num(e.at), people, seen: num(e.seen) };
}

export class Registry {
  private list: Entry[] | null = null;

  /** file: the registry's one file; now: the clock; random: a new code (both injected for the tests) */
  constructor(private file: string, private now: () => number = Date.now, private random: () => string = () => makeCode()) {}

  private read(): Entry[] {
    if (this.list) return this.list;
    try {
      const v = JSON.parse(readFileSync(this.file, "utf8"));
      const out: Entry[] = [];
      for (const x of Array.isArray(v) ? v : []) { const e = readEntry(x); if (e && !out.some((y) => y.code === e.code)) out.push(e); }
      this.list = out;
    } catch { this.list = []; }
    return this.list;
  }

  private write() {
    const all = this.read();
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(all) + "\n", { mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file);   // never a half-written file
    } catch { /* a read-only place: the codes live for this run */ }
  }

  /** a room's code: the same one again for the same provider, org, repos and maker; else a new one. Throws on a bad room */
  register(room: RoomIn, by: string): Entry {
    const r = cleanEntryRoom(room);
    const who = typeof by === "string" && LOGIN.test(by) ? by : "";
    if (by && !who) throw new Error("who registers a room is a GitHub login");
    const all = this.read();
    const had = all.find((e) => sameRoom(e, r, who));
    // names are one a hub (#160): another room's name is refused, the same room under its own name is the same code
    if (all.some((e) => e !== had && nameKey(e.name) === nameKey(r.name))) throw withStatus("that name is taken", 409);
    if (had) {
      if (had.name !== r.name) { had.name = r.name; this.write(); }
      return structuredClone(had);
    }
    // a register by the key alone is by nobody (""): every key holder together may share KEY_ROOMS, never the hub's all
    if (all.filter((e) => e.by.toLowerCase() === who.toLowerCase()).length >= (who ? PER_MAKER : KEY_ROOMS)) throw new Error(who ? `one person may share at most ${PER_MAKER} rooms on a hub; forget one first` : `the key's holders may share at most ${KEY_ROOMS} rooms on a hub`);
    if (all.length >= REGISTRY_MAX) {
      // full: the room seen least lately goes, but only one nobody else came into, quiet for three days, or one quiet for
      // 30 days; a room in use is never dropped for a new one
      const quiet = all.filter((e) => this.now() - e.seen > (lonely(e) ? LONELY : QUIET)).sort((a, b) => Number(lonely(b)) - Number(lonely(a)) || a.seen - b.seen)[0];
      if (!quiet) throw withStatus("the hub is full", 409);
      all.splice(all.indexOf(quiet), 1);
    }
    let code = "";
    for (let i = 0; i < 100 && (!CODE.test(code) || all.some((e) => e.code === code)); i++) code = this.random();
    if (!CODE.test(code) || all.some((e) => e.code === code)) throw new Error("no free code; try again");
    const at = this.now();
    const e: Entry = { code, ...r, by: who, at, people: who ? [who] : [], seen: at };
    all.push(e);
    this.write();
    return structuredClone(e);
  }

  /** a maker forgets their own room: its code and name are free again. Anyone else's word, or no login, changes
   *  nothing (false, the same as no such room) */
  forget(code: string, by: string): boolean {
    const all = this.read(), e = all.find((x) => x.code === normalCode(code));
    if (!e || !e.by || !LOGIN.test(by) || e.by.toLowerCase() !== by.toLowerCase()) return false;
    all.splice(all.indexOf(e), 1);
    this.write();
    return true;
  }

  /** is a room on this hub called this already (#160): trimmed, spaces collapsed, case aside */
  taken(name: string): boolean {
    const k = typeof name === "string" ? nameKey(name) : "";
    return !!k && this.read().some((e) => nameKey(e.name) === k);
  }

  /** the room a code names, or null; nothing is changed */
  lookup(code: string): Entry | null {
    const c = normalCode(code);
    const e = c ? this.read().find((x) => x.code === c) : undefined;
    return e ? structuredClone(e) : null;
  }

  /** someone said hello in that room: they are one of its people (200 at most, the first to come dropped first), and
   *  the room was seen now. The file is written only when someone new came in or the last write is a minute old */
  saw(code: string, login: string, at: number) {
    const e = this.read().find((x) => x.code === normalCode(code));
    if (!e || !SOMEONE.test(login)) return;
    const fresh = !e.people.some((p) => p.toLowerCase() === login.toLowerCase());
    if (!fresh && at - e.seen <= SAW_EVERY) return;
    if (fresh) e.people = [...e.people, login].slice(-PEOPLE_MAX);
    e.seen = at;
    this.write();
  }

  /** every room on this hub, the most lately seen first (the back view, later) */
  all(): Entry[] {
    return structuredClone(this.read()).sort((a, b) => b.seen - a.seen);
  }
}

export const GUESS_MAX = 20;
export const KEY_GUESS_MAX = 200;   // every key holder together (relay.ts guessers): a dead room's loop never reaches it
const GUESS_WINDOW = 10 * 60_000;

/** codes tried that no room has, per caller (a GitHub login, or "key" for a key holder), over the last ten minutes.
 *  After 20, the caller is over: the routes answer 429 without asking the registry. One line is logged per limit hit,
 *  never the code. In memory only: a restart forgets, which costs a guesser the restart */
export class Guesses {
  private tries = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}
  private recent(who: string) {
    const t = this.now(), list = (this.tries.get(who.toLowerCase()) ?? []).filter((x) => t - x < GUESS_WINDOW);
    if (list.length) this.tries.set(who.toLowerCase(), list); else this.tries.delete(who.toLowerCase());
    return list;
  }
  /** one more miss for this caller */
  miss(who: string) {
    const list = this.recent(who);
    list.push(this.now());
    this.tries.set(who.toLowerCase(), list);
    if (list.length === (who === "key" ? KEY_GUESS_MAX : GUESS_MAX)) console.log(`relay: ${who} tried ${GUESS_MAX} codes no room has in ten minutes; slowed`);
  }
  /** has this caller missed 20 times in ten minutes (every key holder together, `key`, 200): the next is not looked up */
  over(who: string) { return this.recent(who).length >= (who === "key" ? KEY_GUESS_MAX : GUESS_MAX); }
}
