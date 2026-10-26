// The relay's spool (#102, docs/how-we-work/PRD.md section 9; PROTOCOL.md round 26). The relay carries the live word
// and keeps nothing, except here: on the hub (the engine whose relay.host is true, the NucBox in practice, and the cloud
// box), the `talk` and `ping` messages a person could not hear because none of their Sols was on the relay are kept for
// them, and handed over the next time one of their Sols says hello. At most 500 messages a person and 7 days, trimmed on
// every add. The spool holds only what the relay already carried: never a prompt, a file or home data. The logins the
// hub has ever heard say hello are kept beside them.
// Rooms on one hub (#157): a kept message carries the room it passed in (its share code, "" or none the common space)
// and is handed back only on a hello in that room; the rest stay for a later hello in theirs.
// One SQLite file since #208 (MASTER A4): `<dir>/spool.db`, one row a message, so a message kept is one insert, never
// the person's whole list read and written again. node:sqlite, Node's own (no native module to build on each machine;
// every Sol runs Node 26, CI 24). Opened on first use, so an engine that is not the hub makes no file. The files of
// before (`<dir>/<login>.json` and `<dir>/../seen.json`) are read in once and removed. A place it cannot write keeps the
// spool in memory for this run, as the files did.
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RelayMsg } from "./hub-types.js";

export const SPOOL_MAX = 500;
export const SPOOL_DAYS = 7;
const DAY = 86_400_000;
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

/** the messages with one more at the end, the oldest dropped past the cap and the age (pure) */
export function trimSpool(msgs: RelayMsg[], now: number, max = SPOOL_MAX, days = SPOOL_DAYS): RelayMsg[] {
  const fresh = msgs.filter((m) => typeof m.at === "number" && now - m.at <= days * DAY);
  return fresh.length > max ? fresh.slice(fresh.length - max) : fresh;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS msg (id INTEGER PRIMARY KEY, login TEXT NOT NULL, room TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS msg_login ON msg (login, id);
  CREATE INDEX IF NOT EXISTS msg_at ON msg (at);
  CREATE TABLE IF NOT EXISTS seen (login TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY);`;

type Row = { id: number; room: string; body: string };
type Db = { db: DatabaseSync; add: StatementSync; trim: StatementSync; expire: StatementSync; rows: StatementSync; drop: StatementSync; seen: StatementSync; saw: StatementSync };

const atOf = (m: RelayMsg) => (typeof m.at === "number" && Number.isFinite(m.at) ? Math.floor(m.at) : 0);
const roomOf = (m: RelayMsg) => (typeof m.room === "string" ? m.room : "");
const isMsg = (m: unknown): m is RelayMsg => !!m && typeof m === "object" && typeof (m as RelayMsg).kind === "string";

export class Spool {
  private d: Db | null = null;

  /** dir: the spool's folder (its database, and the files of before); now: the clock (tests move it) */
  constructor(private dir: string, private now: () => number = Date.now) {}

  private open(): Db {
    if (this.d) return this.d;
    let db: DatabaseSync, file = true, opened: DatabaseSync | undefined;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      db = opened = new DatabaseSync(join(this.dir, "spool.db"));
      try { chmodSync(join(this.dir, "spool.db"), 0o600); } catch { /* its folder is private anyway */ }
      db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 2000;");
      db.exec(SCHEMA);
    } catch (e) {
      try { opened?.close(); } catch { /* closed */ }
      console.log(`relay: the spool cannot use ${join(this.dir, "spool.db")} (${String((e as Error)?.message ?? e).slice(0, 120)}); kept in memory for this run`);
      db = new DatabaseSync(":memory:");   // a read-only place, or a broken file: the word is kept for this run only
      db.exec(SCHEMA);
      file = false;
    }
    const d: Db = {
      db,
      add: db.prepare("INSERT INTO msg (login, room, at, body) VALUES (?, ?, ?, ?)"),
      // a person's oldest past the cap go; everyone's past the age go
      trim: db.prepare(`DELETE FROM msg WHERE login = ? AND id <= (SELECT id FROM msg WHERE login = ? ORDER BY id DESC LIMIT 1 OFFSET ${SPOOL_MAX})`),
      expire: db.prepare("DELETE FROM msg WHERE at < ?"),
      rows: db.prepare("SELECT id, room, body FROM msg WHERE login = ? AND at >= ? ORDER BY id"),
      drop: db.prepare("DELETE FROM msg WHERE id = ?"),
      seen: db.prepare("SELECT login FROM seen ORDER BY login"),
      saw: db.prepare("INSERT OR IGNORE INTO seen (login) VALUES (?)"),
    };
    this.d = d;
    if (file) this.readOld(d);
    return d;
  }

  /** the files of before #208, read in once and removed: `<login>.json` in the folder, and `seen.json` beside it */
  private readOld(d: Db) {
    const seenFile = join(dirname(this.dir), "seen.json");
    let names: string[] = [];
    try { names = readdirSync(this.dir).filter((f) => f.endsWith(".json") && LOGIN.test(f.slice(0, -5))); } catch { /* none */ }
    let seen: string[] = [];
    try { const v = JSON.parse(readFileSync(seenFile, "utf8")); seen = Array.isArray(v) ? v.filter((x) => typeof x === "string" && LOGIN.test(x)) : []; } catch { /* none */ }
    if (!names.length && !seen.length) return;
    const now = this.now();
    // each file read in once, marked by its name, size and time: a start that stopped between the commit and the
    // removal finds the marks and only removes; a file an older build wrote after a rollback is a new file, read in
    const mark = (f: string) => { try { const s = statSync(f); return `read ${f} ${s.size} ${Math.floor(s.mtimeMs)}`; } catch { return ""; } };
    const isRead = d.db.prepare("SELECT 1 FROM meta WHERE k = ?"), setRead = d.db.prepare("INSERT OR IGNORE INTO meta (k) VALUES (?)");
    const fresh = (f: string) => { const k = mark(f); return !!k && !isRead.get(k); };
    const toRead = names.filter((f) => fresh(join(this.dir, f))), seenFresh = fresh(seenFile);
    if (toRead.length || seenFresh) try {
      d.db.exec("BEGIN");
      for (const f of toRead) {
        let list: RelayMsg[] = [];
        try { const v = JSON.parse(readFileSync(join(this.dir, f), "utf8")); list = Array.isArray(v) ? trimSpool(v.filter(isMsg), now) : []; } catch { /* a broken file reads as nothing */ }
        for (const m of list) d.add.run(f.slice(0, -5).toLowerCase(), roomOf(m), atOf(m), JSON.stringify(m));
      }
      if (seenFresh) for (const l of seen) d.saw.run(l);
      for (const f of toRead) setRead.run(mark(join(this.dir, f)));
      if (seenFresh) setRead.run(mark(seenFile));
      d.db.exec("COMMIT");
    } catch { try { d.db.exec("ROLLBACK"); } catch { /* none open */ } return; }   // the files stay for the next start
    try { for (const f of names) rmSync(join(this.dir, f), { force: true }); rmSync(seenFile, { force: true }); } catch { /* the marks keep them from being read twice */ }
  }

  private kept(login: string): (Row & { m: RelayMsg })[] {
    const d = this.open(), out: (Row & { m: RelayMsg })[] = [];
    for (const r of d.rows.all(login.toLowerCase(), this.now() - SPOOL_DAYS * DAY) as Row[]) {
      try { const m = JSON.parse(r.body); if (isMsg(m)) out.push({ ...r, m }); } catch { /* not one */ }
    }
    return out;
  }

  /** what is kept for this person (nothing read is changed) */
  peek(login: string): RelayMsg[] {
    if (!LOGIN.test(login)) return [];
    try { return this.kept(login).map((r) => r.m); } catch { return []; }
  }

  /** keep one message for a person who was not on the relay when it passed: one row; that person's oldest past 500, and
   *  anyone's past 7 days, go. Never throws: a full disk loses the kept word, never the live one */
  add(login: string, m: RelayMsg) {
    if (!LOGIN.test(login)) return;
    try {
      const d = this.open(), who = login.toLowerCase();
      d.add.run(who, roomOf(m), atOf(m), JSON.stringify(m));
      d.trim.run(who, who);
      d.expire.run(this.now() - SPOOL_DAYS * DAY);
    } catch { /* the word is live only */ }
  }

  /** a Sol of theirs said hello: everything kept (in that room, when one is named), and what was handed over gone */
  take(login: string, room?: string): RelayMsg[] {
    if (!LOGIN.test(login)) return [];
    try {
      const d = this.open();
      const out = this.kept(login).filter((r) => room === undefined || r.room === room);
      if (!out.length) return [];
      d.db.exec("BEGIN");
      try { for (const r of out) d.drop.run(r.id); d.db.exec("COMMIT"); } catch (e) { d.db.exec("ROLLBACK"); throw e; }
      return out.map((r) => r.m);
    } catch { return []; }
  }

  /** every login the hub has heard say hello, ever (the people a talk line is kept for) */
  seen(): string[] {
    try { return (this.open().seen.all() as { login: string }[]).map((r) => r.login); } catch { return []; }
  }

  /** remember a login that said hello */
  saw(login: string) {
    if (!LOGIN.test(login)) return;
    try { this.open().saw.run(login); } catch { /* live only */ }
  }

  /** close the database (tests; a host that stops) */
  close() { try { this.d?.db.close(); } catch { /* closed */ } this.d = null; }
}
