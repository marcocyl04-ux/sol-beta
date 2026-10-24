// Who is on the relay, by GitHub (#102, docs/how-we-work/PRD.md sections 9 and 10; PROTOCOL.md round 26). While the
// team has no GitHub org (team.json `org` is ""), the relay's gate is the key, as before (relay.ts relayGate). Once
// `org` is set, the key is no longer needed: a Sol knocks with `Authorization: Bearer <token>`, the token read fresh
// from `gh auth token` on every connect and never kept, written or logged; the hub asks GitHub who that token is
// (`gh api user`, the token in GH_TOKEN of a child gh only) and whether that login is in the org
// (`gh api orgs/<org>/members/<login>`, 204 = yes). The login GitHub returns is the one the hub stamps on everything
// that connection says, never the one its hello claims. A yes is remembered for 10 minutes by the token's hash, so a
// reconnect does not ask GitHub again.
import type { IncomingMessage } from "node:http";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

/** GitHub's login for this token when it is a member of the org, else null */
export type Verify = (token: string, org: string) => Promise<string | null>;
/** gh with a token in its env (never on its command line): its output, or a throw on a non-zero exit */
export type GhAs = (args: string[], token: string) => Promise<string>;

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

const ghAsCli: GhAs = (args, token) => new Promise((ok, no) => {
  const env: NodeJS.ProcessEnv = { ...process.env, GH_TOKEN: token };
  delete env.GITHUB_TOKEN;   // only this token, nothing else the shell had
  execFile("gh", args, { env, timeout: 15_000 }, (err, out) => (err ? no(new Error("gh refused")) : ok(String(out))));
});

/** the hub's verify: `gh api user` and the org's member check, as that token; a yes kept 10 minutes by the token's hash */
export function ghVerify(gh: GhAs = ghAsCli, now: () => number = Date.now): Verify {
  const known = new Map<string, { login: string; org: string; until: number }>();
  return async (token, org) => {
    const key = createHash("sha256").update(token).digest("hex");
    const k = known.get(key);
    if (k && k.org === org && k.until > now()) return k.login;
    known.delete(key);
    let login = "";
    try { login = (await gh(["api", "user", "--jq", ".login"], token)).trim(); } catch { return null; }
    if (!LOGIN.test(login) || !LOGIN.test(org)) return null;
    try { await gh(["api", `orgs/${org}/members/${login}`, "--silent"], token); } catch { return null; }   // 204 = a member; 404 or 302 = not
    known.set(key, { login, org, until: now() + TTL });
    return login;
  };
}

/** this person's GitHub token, read fresh from gh for one connect (never kept); "" when gh is not signed in */
export const ghToken = () => new Promise<string>((ok) =>
  execFile("gh", ["auth", "token"], { timeout: 10_000 }, (err, out) => ok(err ? "" : String(out).trim())));
