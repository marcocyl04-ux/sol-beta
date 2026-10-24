// A Life turn that outlives its socket (#17, sleep and wake 2026-10-20). Before this, a face's socket closing aborted
// the turn on it: the Mac slept, the socket died, the answer was thrown away. Now a say runs through a Relay: the turn
// writes to the relay, the relay writes to whichever socket is attached, and keeps what the turn said so far. The
// socket closing only detaches it; the turn runs on. When a face opens the conversation again (`open` with its
// sessionId, or with the draft while the seat has not named it yet), the relay replays what it kept onto the new
// socket and attaches there, and the rest of the turn streams in as if nothing happened. PROTOCOL.md, round 15.
//
// Kept: the events in order, consecutive deltas merged and a step's later version in place of its earlier one, so a
// replay is short; the last usage; the done (or error) that ended it. A finished relay with a socket attached has
// nothing left to give and goes at once; a detached one is kept KEEP_MS for a face that comes back late.

export type Wire = { readyState: number; send: (s: string) => void };

const OPEN = 1;
const KEEP_MS = 30 * 60_000;

export class Relay {
  readonly readyState = OPEN;           // the turn always writes; whether anyone reads is the relay's business
  target: Wire | null;
  sessionId?: string;
  finished = false;
  ok = true;
  private events: any[] = [];
  private usage: any = null;
  drop?: ReturnType<typeof setTimeout>;   // the timer that forgets a finished, detached relay

  constructor(
    target: Wire,
    readonly seat: string,
    readonly text: string,              // what Marco said, for the thread a late face is given
    readonly draft: string | undefined,
    sessionId: string | undefined,
    readonly abort: AbortController,
    private out: (to: Wire, m: any) => void,   // index.ts's send: the line, and the creature hearing it
  ) {
    this.target = target;
    this.sessionId = sessionId;
    keep(this);
  }

  send(line: string) {
    const m = JSON.parse(line);
    this.note(m);
    if (this.target && this.target.readyState === OPEN) this.out(this.target, m);
  }

  private note(m: any) {
    if (m.type === "start" && m.sessionId && !this.sessionId) { this.sessionId = String(m.sessionId); keep(this); }
    else if (m.type === "delta") {
      const last = this.events[this.events.length - 1];
      if (last?.type === "delta") last.text += String(m.text ?? "");
      else this.events.push({ ...m, text: String(m.text ?? "") });
    } else if (m.type === "tool") {
      const i = this.events.findIndex((e) => e.type === "tool" && e.id === m.id);
      if (i >= 0) this.events[i] = { ...this.events[i], ...m }; else this.events.push(m);
    } else if (m.type === "usage") this.usage = m;
    else if (m.type === "error") { this.ok = false; this.events.push(m); }
    else if (m.type === "done" && !m.stopped) {
      if (m.sessionId && !this.sessionId) { this.sessionId = String(m.sessionId); keep(this); }
      if (m.ok === false) this.ok = false;
    }
  }

  /** the turn returned (handleSay's promise settled): gone at once if a face saw the end, else kept a while */
  end() {
    this.finished = true;
    if (this.target) forget(this);
    else this.later();
  }

  private later() { this.drop = setTimeout(() => forget(this), KEEP_MS); this.drop.unref?.(); }

  /** the socket closed under a running turn */
  detach(ws: Wire) {
    if (this.target !== ws) return false;
    this.target = null;
    if (this.finished) this.later();
    return true;
  }

  /** a face opened the conversation again: what the turn said so far, in order, then the rest live */
  attach(ws: Wire) {
    if (this.drop) { clearTimeout(this.drop); this.drop = undefined; }
    if (!this.finished) {
      for (const e of this.events) this.out(ws, e);
      if (this.usage) this.out(ws, this.usage);
      this.target = ws;
    } else forget(this);   // the disk has it all now; the face gets the thread and a resumed { running: false }
  }

  /** the thread for a face that comes back mid-turn: the record on disk up to Marco's say, then the say itself */
  thread<T extends { who: string; text: string }>(disk: T[]): T[] {
    if (this.finished) return disk;
    const head = this.text.trim().slice(0, 40);
    let i = disk.length - 1;
    while (i >= 0 && disk[i].who !== "me") i--;
    const said = i >= 0 && head && disk[i].text.includes(head);
    const kept = said ? disk.slice(0, i + 1) : [...disk, { who: "me", text: this.text } as T];
    return kept;
  }
}

// the relays the engine holds, by the conversation's id and by the draft that named it before the seat did
const relays = new Map<string, Relay>();
function keep(r: Relay) {
  if (r.draft) relays.set(r.draft, r);
  if (r.sessionId) relays.set(r.sessionId, r);
}
function forget(r: Relay) {
  if (r.drop) clearTimeout(r.drop);
  for (const [k, v] of relays) if (v === r) relays.delete(k);
}
export const relayFor = (id: string | undefined) => (id ? relays.get(id) : undefined);
export const relayCount = () => new Set(relays.values()).size;
