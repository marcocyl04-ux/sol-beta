// The relay's spool (#102, docs/how-we-work/PRD.md section 9; PROTOCOL.md round 26). The relay carries the live word
// and keeps nothing, except here: on the hub (the engine whose relay.host is true, the NucBox in practice), the `talk`
// and `ping` messages a person could not hear because none of their Sols was on the relay are kept for them, and handed
// over the next time one of their Sols says hello. One file a person, `<state dir>/relay/spool/<login>.json`, at most
// 500 messages and 7 days, trimmed on every write. The spool holds only what the relay already carried: never a
// prompt, a file or home data. The logins the hub has ever heard say hello are kept beside it, `relay/seen.json`.
// Rooms on one hub (#157): a kept message carries the room it passed in (its share code, "" or none the common space)
// and is handed back only on a hello in that room; the rest stay for a later hello in theirs.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RelayMsg } from "./relay.js";

export const SPOOL_MAX = 500;
export const SPOOL_DAYS = 7;
const DAY = 86_400_000;
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

/** the messages with one more at the end, the oldest dropped past the cap and the age (pure) */
export function trimSpool(msgs: RelayMsg[], now: number, max = SPOOL_MAX, days = SPOOL_DAYS): RelayMsg[] {
  const fresh = msgs.filter((m) => typeof m.at === "number" && now - m.at <= days * DAY);
  return fresh.length > max ? fresh.slice(fresh.length - max) : fresh;
}

export class Spool {
  private seenFile: string;
  private seenSet: Set<string> | null = null;

  /** dir: the folder of the per-person files; now: the clock (tests move it) */
  constructor(private dir: string, private now: () => number = Date.now) {
    this.seenFile = join(dirname(dir), "seen.json");
  }

  private file(login: string) { return join(this.dir, `${login.toLowerCase()}.json`); }

  private write(f: string, v: unknown) {
    try {
      mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
      writeFileSync(`${f}.tmp`, JSON.stringify(v) + "\n", { mode: 0o600 });
      renameSync(`${f}.tmp`, f);   // never a half-written file
    } catch { /* a read-only place: the word is live only */ }
  }

  /** what is kept for this person (nothing read is changed) */
  peek(login: string): RelayMsg[] {
    if (!LOGIN.test(login)) return [];
    try {
      const v = JSON.parse(readFileSync(this.file(login), "utf8"));
      return Array.isArray(v) ? trimSpool(v.filter((m) => !!m && typeof m === "object" && typeof m.kind === "string"), this.now()) : [];
    } catch { return []; }
  }

  /** keep one message for a person who was not on the relay when it passed */
  add(login: string, m: RelayMsg) {
    if (!LOGIN.test(login)) return;
    this.write(this.file(login), trimSpool([...this.peek(login), m], this.now()));
  }

  /** a Sol of theirs said hello: everything kept (in that room, when one is named), and the file gone or what is left */
  take(login: string, room?: string): RelayMsg[] {
    const all = this.peek(login);
    const inRoom = (m: RelayMsg) => (typeof m.room === "string" ? m.room : "") === room;
    const out = room === undefined ? all : all.filter(inRoom), left = room === undefined ? [] : all.filter((m) => !inRoom(m));
    if (!out.length && left.length) return out;   // nothing for this room: the file as it was
    if (left.length) this.write(this.file(login), left);
    else try { rmSync(this.file(login), { force: true }); } catch { /* gone already */ }
    return out;
  }

  /** every login the hub has heard say hello, ever (the people a talk line is kept for) */
  seen(): string[] {
    if (!this.seenSet) {
      try { const v = JSON.parse(readFileSync(this.seenFile, "utf8")); this.seenSet = new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string" && LOGIN.test(x)) : []); }
      catch { this.seenSet = new Set(); }
    }
    return [...this.seenSet].sort();
  }

  /** remember a login that said hello */
  saw(login: string) {
    if (!LOGIN.test(login) || this.seen().includes(login)) return;
    this.seenSet!.add(login);
    this.write(this.seenFile, [...this.seenSet!].sort());
  }
}
