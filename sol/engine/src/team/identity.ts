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
import { createHash } from "node:crypto";
import { makeGithubRecord, record, runGh, runners, type GhAs } from "./record.js";
import type { Verify } from "../hub/index.js";

// the pure gate (bearerOf, originOk, orgGate, openGate, withTickets, Verify) is the hub's own since #206, in the hub's
// folder src/hub since #208, built alone as the package sol/hub (hub/relay-hub.ts)
export { bearerOf, originOk, orgGate, openGate, withTickets, type Verify } from "../hub/index.js";
export type { GhAs };

const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const TTL = 10 * 60_000;

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

/** this person's GitHub token, read fresh from gh for one connect (never kept); "" when gh is not signed in */
export const ghToken = () => record().who.token();
