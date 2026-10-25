import { useCallback, useEffect, useRef, useState } from "react";
import { ENGINE, NEXT, keepMachines, type Machine } from "../useEngine";
import { link } from "../socket";

// Control (#32): the person's own settings, on the page's one link to the engine (socket.ts shares it), so the
// drawers work in Life, Work and Cowork alike without a prop from the app. PROTOCOL.md rounds 17 and 18.
// ?dev=control replaces only the data these drawers draw (signed-in accounts, three machines); nothing is sent.

export type Speak = { github: boolean; cowork: boolean; discord: "never" | "builds" | "any"; whatsapp: boolean };
/** a room (#154): its record's provider, the org or repos, where it meets ("" = this Mac), its key as the engine shows
 *  it ("set" or ""; sent back as it came, the engine keeps the real one). org, repos and relay.url are the active room's */
export type Room = { id: string; name: string; provider: "github" | "drive"; org: string; repos: string[]; hub: string; key: string; code?: string; gate?: "key" | "github"; folder?: string; mine?: boolean; joined?: boolean };   // code: its share code (#157), "" until shared; gate: how its hub knows me; folder: where Sol cloned its repository (#162), "" until it did; mine: its repos are my own words (#162); joined: a code I typed brought it (#162)
export type Team = {
  me: { login: string; name: string }; org: string; repos: string[];
  relay: { url: string; key: string; host: boolean };
  rooms: Room[]; room: string;
  speak: Speak;
  leaves: { prompts: boolean; memory: boolean; transcripts: boolean; audit: "ask" | "never" };
  seats: { life: "codex" | "claude"; work: "codex" | "claude" };
  machines: Machine[];
  dials: Dials;   // per ping kind (#100): always bring to me, when it matters, never
};
export type PingKind = "clash" | "contract" | "claim" | "decision" | "chat";
export type Dial = "always" | "matters" | "never";
export type Dials = Record<PingKind, Dial>;
export const DIAL_DEFAULTS: Dials = { clash: "matters", contract: "matters", claim: "matters", decision: "matters", chat: "matters" };
export type Account = { in: boolean; who?: string; missing?: boolean };
export type Accounts = { claude: Account; codex: Account; github: Account };
export type Tools = { skills: string[]; plugins: string[]; mcp: { name: string; status: string }[]; agents: string[]; cwd?: string } | null;

export const DEV = typeof location !== "undefined" && new URLSearchParams(location.search).get("dev") === "control";

const FAKE_TEAM: Team = {
  me: { login: "marcocyl04-ux", name: "Marco" }, org: "", repos: ["marcocyl04-ux/sol-dev"],
  relay: { url: "", key: "", host: false },
  rooms: [
    { id: "team", name: "sol-dev", provider: "github", org: "", repos: ["marcocyl04-ux/sol-dev"], hub: "", key: "" },
    { id: "kao", name: "Kao", provider: "github", org: "kao-ai", repos: ["kao-ai/site"], hub: "wss://nucbox.example.ts.net/relay", key: "set" },
  ],
  room: "team",
  speak: { github: true, cowork: true, discord: "builds", whatsapp: false },
  leaves: { prompts: false, memory: false, transcripts: false, audit: "ask" },
  seats: { life: "codex", work: "claude" },
  machines: [
    { name: "this Mac", url: NEXT },
    { name: "the NucBox", url: "wss://nucbox.example.ts.net/" },
    { name: "the Legion", url: "wss://legion.example.ts.net/" },
  ],
  dials: { ...DIAL_DEFAULTS, chat: "always" },
};
const FAKE_ACCOUNTS: Accounts = { claude: { in: true, who: "marco@example.com, max" }, codex: { in: true, who: "ChatGPT" }, github: { in: true, who: "marcocyl04-ux" } };
const FAKE_TOOLS: Tools = {
  skills: ["apple-design", "impeccable", "superpowers", "gstack"], plugins: ["superpowers", "frontend-design"],
  mcp: [{ name: "sol", status: "connected" }, { name: "claude.ai Higgsfield", status: "connected" }, { name: "playwright", status: "failed" }],
  agents: ["general-purpose", "Explore", "Plan"],
};

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const merge = (a: any, b: any): any => {
  if (!isObj(a) || !isObj(b)) return b;
  const out: Record<string, any> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v;
  return out;
};

export function useControl() {
  const L = useRef(link(ENGINE)).current;   // also under ?dev=control: a sign-in terminal is real
  const asks = useRef(new Map<string, (r: any) => void>());
  const [team, setTeam] = useState<Team | null>(DEV ? FAKE_TEAM : null);
  const [accounts, setAccounts] = useState<Accounts | null>(DEV ? FAKE_ACCOUNTS : null);
  const [tools, setTools] = useState<Tools | undefined>(DEV ? FAKE_TOOLS : undefined);
  const [err, setErr] = useState("");

  useEffect(() => L?.on((m) => {
    const f = typeof m?.rid === "string" ? asks.current.get(m.rid) : undefined;
    if (f) { asks.current.delete(m.rid); f(m); }
    // a room switched from Cowork's side (#154) comes as team.state: these drawers take its rooms and room only, so a
    // team.state that lands between an edit and the engine's answer never undoes the edit on screen (review of #154)
    else if (m?.type === "team.state" && Array.isArray(m.settings?.rooms) && !DEV)
      setTeam((t) => (t ? { ...t, rooms: m.settings.rooms, room: m.settings.room } : t));
  }), [L]);

  const ask = useCallback(<T = any,>(type: string, body: object = {}, wait = 20_000) => new Promise<T>((ok) => {
    if (!L) return ok({ error: "dev" } as T);
    const rid = crypto.randomUUID();
    asks.current.set(rid, ok);
    if (!L.send({ type, rid, ...body })) { asks.current.delete(rid); return ok({ error: "not connected" } as T); }
    window.setTimeout(() => { if (asks.current.delete(rid)) ok({ error: "no answer" } as T); }, wait);
  }), [L]);

  const take = (s?: Team) => { if (!s) return; setTeam(s); keepMachines(s.machines); };
  const load = useCallback(async () => {
    if (DEV) return;
    const r = await ask<{ settings?: Team; error?: string }>("team.settings", {});
    take(r.settings); setErr(r.settings ? "" : r.error ?? "");
  }, [ask]);
  const loadAccounts = useCallback(async () => {
    if (DEV) return setAccounts({ ...FAKE_ACCOUNTS });
    setAccounts(null);
    const r = await ask<Accounts & { error?: string }>("team.accounts", {}, 30_000);
    setAccounts(r.claude ? r : null);
  }, [ask]);
  const loadTools = useCallback(async () => {
    if (DEV) return;
    const r = await ask<{ tools?: Tools }>("work.about", {}, 15_000);
    setTools(r.tools ?? null);
  }, [ask]);
  useEffect(() => L?.onLink((up) => { if (up) void load(); }), [L, load]);

  // a change shows at once and is kept by the engine, which answers what it kept
  // a flipped dial comes back with what the agent learned from it, said once (#100)
  const set = useCallback(async (patch: object): Promise<{ learned?: string[] }> => {
    setTeam((t) => (t ? merge(t, patch) : t));
    if (DEV) return {};
    const r = await ask<{ settings?: Team; error?: string; learned?: string[] }>("team.settings", { patch });
    take(r.settings); setErr(r.error ?? "");
    return { ...(r.learned ? { learned: r.learned } : {}) };
  }, [ask]);
  // machines are replaced whole (the engine replaces an array)
  const setMachines = useCallback((machines: Machine[]) => set({ machines }), [set]);

  return { team, accounts, tools, err, ask, set, setMachines, load, loadAccounts, loadTools, link: L };
}
export type Control = ReturnType<typeof useControl>;
