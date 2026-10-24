// Home (#132): Life and Work became one mode. What the window kept from before is read once, on the first start after:
// `sol.mode` "work" or "life" (Life's id was "home" all along) becomes "home", and `sol.home.open` says which talk Home
// opens, seeded from Work's open session when Work was the last mode, else from Life's kept conversation. Pure over a
// store, so a test runs it on a Map (migrate.test.ts); App.tsx runs it on localStorage before the first draw.

export type Mode = "home" | "cowork";
export type Seat = "codex" | "claude";
// the talk Home's stage holds: a session in a folder (Work's), or a chat (a Life thread, its seat with it)
export type Open = { kind: "session" | "chat"; id: string | null; seat?: Seat };
export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

const json = (s: Store, k: string): unknown => { try { return JSON.parse(s.getItem(k) ?? "null"); } catch { return null; } };

/** the talk Home opens, as kept; a new chat when nothing is */
export function readOpen(s: Store): Open {
  const o = json(s, "sol.home.open") as Open | null;
  if (o && (o.kind === "session" || o.kind === "chat")) return { kind: o.kind, id: typeof o.id === "string" ? o.id : null, ...(o.seat === "codex" || o.seat === "claude" ? { seat: o.seat } : {}) };
  return { kind: "chat", id: null };
}

/** Home's session as kept, or none: the one place a reload reads it from (useWork, pings) */
export const homeSession = (s: Store = localStorage): string | null => { const o = readOpen(s); return o.kind === "session" ? o.id : null; };
/** Home's chat as kept, or none: the one chat useEngine reopens on a reload */
export const homeChat = (s: Store = localStorage): { seat: Seat; sessionId: string } | null => { const o = readOpen(s); return o.kind === "chat" && o.id ? { seat: o.seat ?? "codex", sessionId: o.id } : null; };

/** once: the old mode keys to Home's; returns the mode the window opens in. `life` is Life's kept conversation, if any */
export function migrate(s: Store, life: () => { seat: Seat; sessionId: string } | null): Mode {
  const was = s.getItem("sol.mode");
  if (s.getItem("sol.home.open") === null) {
    const cur = json(s, "sol.work.current");
    const l = was === "work" ? null : life();
    const open: Open = was === "work" ? { kind: "session", id: typeof cur === "string" ? cur : null }
      : l ? { kind: "chat", id: l.sessionId, seat: l.seat } : { kind: "chat", id: null };
    s.setItem("sol.home.open", JSON.stringify(open));
  }
  const mode: Mode = was === "cowork" ? "cowork" : "home";
  if (was !== mode) s.setItem("sol.mode", mode);
  return mode;
}
