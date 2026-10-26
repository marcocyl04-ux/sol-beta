// The hub's own GitHub (#208, MASTER A13). A ticket (proof.ts) needs the hub to read one gist, and with an org to ask
// whether a login is a member. In an engine that is the host's own `gh` login (engine relay.ts, the record). On the box
// it is a dedicated bot account's token, from the host's config (SOL_HUB_GITHUB_TOKEN in /etc/sol/cloud.env), never a
// person's login: GitHub's REST API over fetch, read-only, no program run. No token: nothing is read and every proof is
// refused, which is how the tests and a box with no bot yet run. The bot's budget is its own 5000 an hour, which the
// hub's own (proof.ts, 600 in ten minutes) stays under. Replaced by Google sign-in at step 2 (MASTER section 8).
import { PROOF_FILE, type ProofReads } from "./proof.js";

const LOGIN = /^[A-Za-z0-9-]{1,39}$/, GIST = /^[0-9a-f]{1,64}$/i;
const WAIT = 8000;
let toldRefused = false;   // a bad bot token is said once a run, never the token

export type GithubDeps = { token: string; fetch?: typeof fetch; api?: string };

/** the reads a hub's proofs need, as the bot whose token this is; a throw is a no (proof.ts) */
export function githubReads({ token, fetch: get = globalThis.fetch, api = "https://api.github.com" }: GithubDeps): ProofReads {
  const ask = (path: string) => {
    if (!token) return Promise.reject(new Error("this hub has no GitHub token (SOL_HUB_GITHUB_TOKEN)"));
    return get(`${api}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "sol-hub" },
      redirect: "manual", signal: AbortSignal.timeout(WAIT) });
  };
  return {
    // a gist's owner and its proof file's text, as JSON {owner, text}: what the engine's gh read gives (record/github.ts)
    proofOf: async (id) => {
      if (!GIST.test(id)) throw new Error("a gist is its id");
      const r = await ask(`/gists/${id}`);
      if (r.status === 401 && !toldRefused) { toldRefused = true; console.log("relay: GitHub refused the hub's token (SOL_HUB_GITHUB_TOKEN): every proof fails until it is fixed"); }
      if (r.status !== 200) throw new Error(`GitHub said ${r.status}`);
      const g = await r.json() as { owner?: { login?: unknown }; files?: Record<string, { content?: unknown }> };
      return JSON.stringify({ owner: g?.owner?.login ?? null, text: g?.files?.[PROOF_FILE]?.content ?? null });
    },
    // 204 = a member. 404 is not one; 302 means the bot is not in the org and sees public members only: also a no
    inOrg: async (org, login) => {
      if (!LOGIN.test(org) || !LOGIN.test(login)) throw new Error("an org and a login are GitHub logins");
      const r = await ask(`/orgs/${org}/members/${login}`);
      if (r.status !== 204) throw new Error(`GitHub said ${r.status}`);
      return "";
    },
  };
}

/** the hub's reads from its config: the bot's token in SOL_HUB_GITHUB_TOKEN, or none (every proof refused) */
export const githubReadsFromEnv = (env: NodeJS.ProcessEnv = process.env, get?: typeof fetch) => githubReads({ token: (env.SOL_HUB_GITHUB_TOKEN ?? "").trim(), ...(get ? { fetch: get } : {}) });
