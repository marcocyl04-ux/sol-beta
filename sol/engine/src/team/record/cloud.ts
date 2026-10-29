// The second provider of a room's record (#216, S5 of #168): a room kept on the cloud it meets on (sol/cloud/src/rooms.ts).
// Only the `files` verb, since that is all a cloud room's record is: small files under `.sol/` (its things, its goal and
// the goal's files), read and written with my ticket for that cloud (relay.ts hubTicket, Google sign-in), compare-and-swap
// on a sha. It answers in GitHub's shapes, so things.ts and goal.ts read both providers with the same lines:
// - readSha: `{ sha, content }` (base64), as gh's --jq prints it; a file not there throws "Not Found (HTTP 404)";
// - put/putBody: a write with the sha it replaces; one that moved throws "(HTTP 409)", read as a conflict;
// - list: a folder as the contents API gives it, `[{ name, path, sha, size, type }]`;
// - branch: "main", a cloud room has one.
// A room I am not in (or not there) is "(HTTP 403)": never an empty room, which would invite a write over it.
// Every other verb (cards, notes, code) belongs to a GitHub room: it says so.
// Beside the record, three calls only a cloud room has (#326, cloudRoomCalls): the list with how full the room is and
// whether it is frozen, the maker's freeze, and who its maker is. A write the cloud answered with `warn` or 423 is told
// to `onWrite`, so the faces hear how full the group is at once.
import type { RoomRecord, FileWrite } from "../record.js";

export type CloudRecordDeps = {
  /** where a cloud room meets, by its code: its hub's http address (relay.ts hubHttp), "" when no room of mine has it */
  hubOf: (code: string) => string;
  /** my ticket for that hub (relay.ts hubTicket), "" when I am not signed in there */
  ticket: (hub: string) => Promise<string>;
  fetch?: typeof fetch;
  /** a write the cloud answered with a word on how full the room is (`warn`) or refused while it moves (423), by code */
  onWrite?: (code: string, said: { warn?: string; status?: number }) => void;
};

/** how full a cloud room is and whether it is moving, as its list says it (#326) */
export type CloudUsage = { used: number; max: number; files: { path: string; sha: string; size: number; by: string; at: number }[]; mine: number; mineMax: number; frozen: boolean; warn?: string;
  /** the group's move to GitHub as the cloud saved it when its maker said so (the one word a member's Sol trusts) */
  moved?: { repo: string; by: string; at: number } };

export const CLOUD_PREFIX = "cloud:";
const WAIT = 15_000;
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;

/** a gh-like failure: the first line is the message, `full` the whole word ending in `(HTTP nnn)` (things.ts reads it) */
const fail = (line: string, status: number) => Object.assign(new Error(`${line} (HTTP ${status})`), { full: `${line} (HTTP ${status})`, status });
const notHere = (verb: string) => () => Promise.reject(new Error(`${verb} is a GitHub room's; this room's record is on the cloud`));

/** one call to a cloud room's routes (`files`, `members`, `freeze`), with my ticket for its hub; the answer's JSON, or a
 *  gh-like throw. A room I am not in is "(HTTP 403)", never a 404 (that is a file not there) */
/** where a cloud room's routes are and my ticket for them, asked of nobody but my own rooms and tickets */
async function locate(d: CloudRecordDeps, repo: string) {
  const code = repo.startsWith(CLOUD_PREFIX) ? repo.slice(CLOUD_PREFIX.length) : "";
  if (!CODE.test(code)) throw fail("not a cloud room", 400);
  const hub = d.hubOf(code);
  if (!/^https:\/\/|^http:\/\/127\.0\.0\.1(:\d+)?\//.test(hub)) throw fail("no room of mine on a cloud has that code", 400);
  const t = await d.ticket(hub).catch(() => "");
  if (!t) throw fail("sign in to the cloud first (bash sol/signin)", 401);
  return { base: `${hub.replace(/\/+$/, "")}/rooms/${code}`, auth: { authorization: `Bearer ${t}` } };
}

function caller(d: CloudRecordDeps) {
  const f = d.fetch ?? globalThis.fetch;
  return async (repo: string, route: string, method: string, qs: string, body?: unknown) => {
    const w = await locate(d, repo);
    let r: Response;
    try {
      r = await f(`${w.base}/${route}${qs}`, { method, headers: { ...w.auth, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(WAIT) });
    } catch { throw fail("the cloud did not answer", 503); }
    const v = await r.json().catch(() => null) as Record<string, any> | null;
    if (r.status === 404) throw fail("you are not in this room on the cloud (or it is gone)", 403);   // never "not found": that is an empty file
    if (!r.ok) throw fail(typeof v?.error === "string" ? v.error.slice(0, 200) : `the cloud said ${r.status}`, r.status);
    return v ?? {};
  };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** the calls only a cloud room has (#326): its list as how full it is, the maker's freeze, and who its maker is.
 *  `repo` is the record's name, `cloud:<code>` */
export function cloudRoomCalls(d: CloudRecordDeps) {
  const call = caller(d);
  return {
    usage: async (repo: string): Promise<CloudUsage> => {
      const v = await call(repo, "files", "GET", "");
      const files = (Array.isArray(v.files) ? v.files : []).filter((x: any) => x && typeof x.path === "string" && typeof x.sha === "string")
        .map((x: any) => ({ path: x.path, sha: x.sha, size: num(x.size), by: typeof x.by === "string" ? x.by : "", at: num(x.at) }));
      const mv = v.moved && typeof v.moved === "object" && typeof v.moved.repo === "string" && typeof v.moved.by === "string" ? { repo: v.moved.repo.slice(0, 200), by: v.moved.by.slice(0, 40), at: num(v.moved.at) } : null;
      return { used: num(v.used), max: num(v.max), files, mine: num(v.mine), mineMax: num(v.mineMax), frozen: v.frozen === true, ...(mv ? { moved: mv } : {}), ...(typeof v.warn === "string" ? { warn: v.warn.slice(0, 200) } : {}) };
    },
    freeze: async (repo: string, on: boolean): Promise<boolean> => (await call(repo, "freeze", "POST", "", { on })).frozen === true,
    maker: async (repo: string): Promise<string> => { const v = await call(repo, "members", "GET", ""); return typeof v.maker === "string" ? v.maker : ""; },
  };
}

export function makeCloudRecord(d: CloudRecordDeps): RoomRecord {
  const route = caller(d);
  const call = (repo: string, method: string, qs: string, body?: unknown) => route(repo, "files", method, qs, body);
  const where = (repo: string) => locate(d, repo);
  const q = (path: string) => `?path=${encodeURIComponent(path)}`;
  const read = async (repo: string, path: string) => {
    const v = await call(repo, "GET", q(path));
    if (!v.file) throw fail("Not Found", 404);
    return v.file as { sha: string; content: string; size: number; by: string; at: number };
  };
  const put = async (repo: string, path: string, w: { content: string; sha?: string }) => {
    const code = repo.slice(CLOUD_PREFIX.length);
    let v: Record<string, any>;
    try { v = await call(repo, "PUT", q(path), { content: w.content, ...(w.sha ? { sha: w.sha } : {}) }); }
    catch (e) { if ((e as { status?: number }).status === 423) d.onWrite?.(code, { status: 423 }); throw e; }   // the group is moving (#326)
    if (typeof v.warn === "string") { console.log(`cloud: ${v.warn.slice(0, 200)}`); d.onWrite?.(code, { warn: v.warn.slice(0, 200) }); }   // near full (#223, B6): said before a write is refused
    return String(v.file?.sha ?? "");
  };
  return {
    who: { login: notHere("who"), me: notHere("who"), loginAs: notHere("who"), token: notHere("who"), prove: notHere("who"), unprove: notHere("who"), proofOf: notHere("who") },
    members: { ofOrg: notHere("members"), inOrgAs: notHere("members"), inOrg: notHere("members"), admin: notHere("members"), people: notHere("members"), room: notHere("members"),
      canWrite: () => Promise.resolve(false), invitations: () => Promise.resolve([]), accept: notHere("members"), invite: notHere("members") },
    cards: { list: () => Promise.resolve([]), prs: () => Promise.resolve([]), open: notHere("cards"), openIssues: notHere("cards"), held: notHere("cards"), nowIn: notHere("cards"),
      find: notHere("cards"), pr: notHere("cards"), assignees: notHere("cards"), assign: notHere("cards"), give: notHere("cards"), passBack: notHere("cards"),
      addReviewer: notHere("cards"), unlabel: notHere("cards"), letGo: notHere("cards"), takenAt: notHere("cards") },
    notes: { add: notHere("notes"), addOnPr: notHere("notes"), post: notHere("notes"), lines: notHere("notes"), of: () => Promise.resolve([]), recent: () => Promise.resolve([]) },
    files: {
      read: async (repo, path) => Buffer.from((await read(repo, path)).content, "base64").toString("utf8"),
      bytes: async (repo, path) => Buffer.from((await read(repo, path)).content, "base64"),
      // `by` rides along (#316): the group's memory checks who wrote a file on the very read it appends to
      readSha: async (repo, path) => { const x = await read(repo, path); return JSON.stringify({ sha: x.sha, content: x.content, by: x.by }); },
      put: (repo, path, w: FileWrite) => put(repo, path, w),
      putBody: (repo, path, body: { content: string; sha?: string }) => put(repo, path, body),
      remove: async (repo, path, w) => { await call(repo, "DELETE", `${q(path)}&sha=${encodeURIComponent(w.sha)}`); return ""; },   // talk.ts (#315)
      branch: async (repo) => { await where(repo); return "main"; },
      tree: async (repo) => JSON.stringify({ tree: ((await call(repo, "GET", "")).files ?? []).map((x: { path: string; sha: string; size: number }) => ({ path: x.path, type: "blob", sha: x.sha, size: x.size })) }),
      list: async (repo, dir) => {
        const pre = dir.replace(/\/+$/, "") + "/";
        const all = ((await call(repo, "GET", "")).files ?? []) as { path: string; sha: string; size: number; by: string; at: number }[];
        const here = all.filter((x) => x.path.startsWith(pre) && !x.path.slice(pre.length).includes("/"));
        if (!here.length) throw fail("Not Found", 404);
        return JSON.stringify(here.map((x) => ({ name: x.path.slice(pre.length), path: x.path, sha: x.sha, size: x.size, type: "file", by: x.by, at: x.at })));
      },
      lastCommits: () => Promise.resolve(null),
    },
    changes: { commitsBy: () => Promise.resolve([]) },
    room: { make: notHere("making a repository") },
    code: { branches: () => Promise.resolve([]), branch: notHere("code"), mainSha: notHere("code"), makeBranch: notHere("code"), heads: notHere("code"), compare: notHere("code"),
      status: notHere("code"), prsOfBranch: notHere("code"), openPrs: notHere("code"), prSearch: notHere("code"), prHead: notHere("code"), ready: notHere("code"),
      prComment: notHere("code"), lineComment: notHere("code") },
  };
}
