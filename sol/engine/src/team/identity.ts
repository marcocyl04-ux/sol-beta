// Who is on the relay, by GitHub (#102, docs/how-we-work/PRD.md sections 9 and 10; PROTOCOL.md round 26). While the
// team has no GitHub org (team.json `org` is ""), the relay's gate is the key, as before (relay.ts relayGate). Once
// `org` is set, the key is no longer needed: a Sol knocks with `Authorization: Bearer <token>`, the token read fresh
// from `gh auth token` on every connect and never kept, written or logged; the hub asks GitHub who that token is
// (`gh api user`, the token in GH_TOKEN of a child gh only) and whether that login is in the org
// (`gh api orgs/<org>/members/<login>`, 204 = yes). The login GitHub returns is the one the hub stamps on everything
// that connection says, never the one its hello claims. A yes is remembered for 10 minutes by the token's hash, so a
// reconnect does not ask GitHub again.
// The open gate (#157, round 35): on the beta's hub (team.json `relay.open`) and with no org, any real GitHub user is
// let in under GitHub's login, no member check: a room joined by a code is met as who you are on GitHub.
import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { makeGithubRecord, record, runGh, runners, type GhAs } from "./record.js";

/** GitHub's login for this token when it is a member of the org (org "": any GitHub user), else null */
export type Verify = (token: string, org: string) => Promise<string | null>;
export type { GhAs };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const TTL = 10 * 60_000;

/** the token in `Authorization: Bearer <token>`, or "" */
export function bearerOf(headers: IncomingMessage["headers"]): string {
  const m = /^Bearer\s+(\S{1,400})\s*$/i.exec(one(headers.authorization) ?? "");
  return m ? m[1] : "";
}

/** no browser page but Sol's own (the same rule as the key's gate) */
export function originOk(headers: IncomingMessage["headers"], port: number): boolean {
  const o = one(headers.origin);
  if (o === undefined) return true;   // a program: another engine
  return new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", `http://127.0.0.1:${port}`, `http://localhost:${port}`]).has(o);
}

/** the org gate: GitHub's login for this knock, or null (refused). verify is injected: the tests never reach GitHub */
export async function orgGate(headers: IncomingMessage["headers"], org: string, port: number, verify: Verify): Promise<string | null> {
  if (!org || !originOk(headers, port)) return null;
  const token = bearerOf(headers);
  if (!token) return null;
  const login = await verify(token, org).catch(() => null);
  return login && LOGIN.test(login) ? login : null;
}

/** the open gate (#157): GitHub's login for this knock's token, no org asked, or null (refused). A knock with no token
 *  never comes here: it goes to the key's gate */
export async function openGate(headers: IncomingMessage["headers"], port: number, verify: Verify): Promise<string | null> {
  if (!originOk(headers, port)) return null;
  const token = bearerOf(headers);
  if (!token) return null;
  const login = await verify(token, "").catch(() => null);
  return login && LOGIN.test(login) ? login : null;
}

/** the hub's verify: `gh api user` and the org's member check, as that token; a yes kept 10 minutes by the token's hash.
 *  org "" (the open gate): who the token is, and nothing more */
export function ghVerify(gh: GhAs = runners.as, now: () => number = Date.now): Verify {
  const rec = makeGithubRecord(runGh, { as: gh });
  const known = new Map<string, { login: string; org: string; until: number }>();
  return async (token, org) => {
    const key = createHash("sha256").update(token).digest("hex");
    const k = known.get(key);
    if (k && k.org === org && k.until > now()) return k.login;
    known.delete(key);
    let login = "";
    try { login = (await rec.who.loginAs(token)).trim(); } catch { return null; }
    if (!LOGIN.test(login) || (org && !LOGIN.test(org))) return null;
    if (org) try { await rec.members.inOrgAs(org, login, token); } catch { return null; }   // 204 = a member; 404 or 302 = not
    known.set(key, { login, org, until: now() + TTL });
    return login;
  };
}

/** the hub's verify, which also knows its own tickets (proof.ts): a `sol1.` Bearer is this hub's signed word, asked of
 *  nobody; anything else is a GitHub token, asked of GitHub as before (an older Sol, or a Sol on this machine) */
export function withTickets(verify: Verify, proofs?: { check: (ticket: string, org: string) => string | null }): Verify {
  return async (token, org) => (token.startsWith("sol1.") ? proofs?.check(token, org) ?? null : verify(token, org));
}

/** this person's GitHub token, read fresh from gh for one connect (never kept); "" when gh is not signed in */
export const ghToken = () => record().who.token();
