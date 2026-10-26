// Google Drive on this Sol (#152), for a Drive room's record (record/drive.ts): a separate, explicit step, "connect
// Google Drive", never part of signing in to Sol. The same way as that sign-in (cloud.ts, RFC 8252): the system browser,
// a one-off listener on 127.0.0.1 and a port of its own, PKCE, a `state` checked in constant time. Google's consent page
// asks for Drive alone (and who you are, so Sol can say which of a folder's people is you). The code goes to the cloud
// (sol/cloud/src/drive.ts), which alone holds the client secret, and comes back as a grant: an access token for an hour
// and a refresh token. Kept in `<state>/drive/account.json` (0600, its folder 0700): the cloud it came through, the
// refresh token, the scope and the email; never the access token, which lives in memory and is refreshed through the
// same cloud a minute before its hour ends. Disconnecting revokes the grant at Google and forgets it here. Nothing of it
// is ever said in a log, a chat or a face: a face hears `connected`, the email and the scope.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { AUTH_URL, openBrowser, page, failPage } from "./cloud.js";

export const CONNECT_FOR = 10 * 60_000;
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const WAIT = 10_000;
/** a cloud's address: https, or this machine's own (a cloud run here, the tests) */
const CLOUD = /^(https:\/\/|http:\/\/127\.0\.0\.1(:\d+)?\/)/;

export type DriveAccount = { hub: string; refresh: string; scope: string; email: string; at: number };
export type DriveDeps = {
  file: string;                                  // the account file
  ticket: (hub: string) => Promise<string>;      // my Sol ticket for that cloud (relay.ts hubTicket); "" when none
  fetch?: typeof fetch;
  open?: (url: string) => void;                  // the system browser (the tests catch the url)
  now?: () => number;
};

// ---- the account file ----

let cache: { file: string; a: DriveAccount | null } | null = null;
// the access token, held for the refresh token it came from: a disconnect, or another connect meanwhile, never gets it
const held = { access: "", until: 0, of: "" };
let refreshing: Promise<string> | null = null;

/** my Drive connection on this Sol, or null */
export function driveAccount(file: string): DriveAccount | null {
  if (cache?.file === file) return cache.a;
  let a: DriveAccount | null = null;
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as Partial<DriveAccount> | null;
    if (v && typeof v.hub === "string" && CLOUD.test(v.hub) && typeof v.refresh === "string" && v.refresh && v.refresh.length <= 1024 && typeof v.scope === "string")
      a = { hub: v.hub, refresh: v.refresh, scope: v.scope, email: typeof v.email === "string" ? v.email : "", at: typeof v.at === "number" ? v.at : 0 };
  } catch { a = null; }
  cache = { file, a };
  return a;
}

function keep(file: string, a: DriveAccount | null) {
  if (!a) { try { rmSync(file, { force: true }); } catch { /* gone */ } cache = { file, a: null }; held.access = ""; held.until = 0; held.of = ""; return; }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(a, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* written 0600 */ }
  cache = { file, a };
}

/** for the tests: the file read again, nothing held */
export const resetDrive = () => { cache = null; held.access = ""; held.until = 0; held.of = ""; refreshing = null; connecting = null; };
/** Drive refused the access token (401): the next ask refreshes */
export const staleDrive = () => { held.access = ""; held.until = 0; held.of = ""; };

/** what a face may know (pure): connected or not, the email and whether the scope reaches a pasted folder */
export const driveForFace = (a: DriveAccount | null) => a ? { connected: true, email: a.email, whole: a.scope.split(/\s+/).includes("https://www.googleapis.com/auth/drive") } : { connected: false, email: "", whole: false };

const post = async (d: DriveDeps, hub: string, path: string, body: object) => {
  const t = await d.ticket(hub).catch(() => "");
  if (!t) return { status: 403, v: { error: "sign in to Sol first: Drive is connected through your Sol account" } as Record<string, unknown> };
  const r = await (d.fetch ?? fetch)(`${hub}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(WAIT) }).catch(() => null);
  if (!r) return { status: 503, v: { error: "the cloud did not answer" } as Record<string, unknown> };
  return { status: r.status, v: await r.json().catch(() => ({})) as Record<string, unknown> };
};

/** my Drive access token: the one held while it lasts another minute, else a refresh through the cloud. "" when Drive
 *  is not connected or the refresh failed. A refresh Google refuses (revoked, ran out) forgets the connection here:
 *  connecting again is the way back */
export function driveToken(d: DriveDeps): Promise<string> {
  const now = (d.now ?? Date.now)();
  const a = driveAccount(d.file);
  if (!a) return Promise.resolve("");
  if (held.access && held.of === a.refresh && held.until - 60_000 > now) return Promise.resolve(held.access);
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const r = await post(d, a.hub, "/drive/refresh", { refresh: a.refresh });
    if (r.status === 401) {
      if (driveAccount(d.file)?.refresh === a.refresh) keep(d.file, null);
      console.log("drive: Google would not refresh my Drive access; connect Google Drive again");
      return "";
    }
    if (r.status !== 200 || typeof r.v.access !== "string" || !r.v.access) return "";
    // let go of, or connected anew, while the refresh was out: this answer is for a grant that is no longer mine here
    if (driveAccount(d.file)?.refresh !== a.refresh) return "";
    held.access = r.v.access;
    held.until = typeof r.v.until === "number" ? r.v.until : now + 30 * 60_000;
    held.of = a.refresh;
    return held.access;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** this Sol lets go of Drive: the grant revoked at Google (a refresh token revokes the whole grant), then forgotten
 *  here. Google not answering still forgets it here: the person asked, and the grant can be removed at
 *  myaccount.google.com too */
export async function disconnectDrive(d: DriveDeps): Promise<boolean> {
  const a = driveAccount(d.file);
  if (!a) return false;
  await (d.fetch ?? fetch)(REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: a.refresh }), signal: AbortSignal.timeout(WAIT) }).catch(() => null);
  keep(d.file, null);
  return true;
}

// ---- connecting ----

const b64 = (b: Buffer) => b.toString("base64url");
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Google's consent page for Drive (pure): offline, so a refresh token comes; consent, so it comes every time; the
 *  person's choice of account */
export function driveConsentUrl(client: string, scopes: string, redirect: string, state: string, challenge: string): string {
  const q = new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", scope: scopes, state, code_challenge: challenge,
    code_challenge_method: "S256", access_type: "offline", prompt: "consent select_account", include_granted_scopes: "false" });
  return `${AUTH_URL}?${q}`;
}

export const drivePage = (email: string) => page("Google Drive is connected", `<p>Sol can now read and write a Drive room's record${email ? ` as <b>${email.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</b>` : ""}. This tab can close.</p>`);

export type Connected = { ok: true; email: string; scope: string } | { ok: false; error: string };
let connecting: Promise<Connected> | null = null;

/** connect Google Drive through a cloud (its http address) I have a Sol account on: done when the person finished in
 *  the tab, or after ten minutes. One at a time */
export function connectDrive(hub: string, d: DriveDeps): Promise<Connected> {
  if (!CLOUD.test(hub)) return Promise.resolve({ ok: false, error: "Drive is connected through a cloud over https only" });
  if (connecting) return connecting;
  connecting = run(hub, d).finally(() => { connecting = null; });
  return connecting;
}

async function run(hub: string, d: DriveDeps): Promise<Connected> {
  const f = d.fetch ?? fetch;
  const res = await f(`${hub}/drive`, { signal: AbortSignal.timeout(WAIT) }).catch(() => null);
  const cfg = await res?.json().catch(() => null) as { client?: unknown; scopes?: unknown; error?: unknown } | null;
  if (!res?.ok || typeof cfg?.client !== "string" || typeof cfg.scopes !== "string") return { ok: false, error: typeof cfg?.error === "string" ? cfg.error : "that cloud has no Google Drive" };
  if (!(await d.ticket(hub).catch(() => ""))) return { ok: false, error: "sign in to Sol first: Settings › me › Sol" };
  const verifier = b64(randomBytes(32)), challenge = b64(createHash("sha256").update(verifier).digest());
  const state = b64(randomBytes(24));
  let redirect = "", came = false;

  return new Promise<Connected>((resolve) => {
    let finished = false;
    const finish = (v: Connected) => { if (finished) return; finished = true; clearTimeout(timer); setTimeout(() => { server.close(); server.closeAllConnections(); }, 500).unref(); resolve(v); };
    const send = (res: ServerResponse, status: number, html: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
      res.end(html);
    };
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      try {
        if (u.pathname !== "/done" || req.method !== "GET") { res.writeHead(404); res.end(); return; }
        const s = u.searchParams.get("state") ?? "", code = u.searchParams.get("code") ?? "";
        if (!s || !same(s, state)) { send(res, 400, failPage("This page was not the one Sol opened.")); return; }   // not ours: keep waiting
        if (came) { send(res, 409, failPage("This already came back; look at the first tab.")); return; }
        came = true;
        if (u.searchParams.get("error") || !code) { send(res, 200, failPage("Google Drive was not connected.")); finish({ ok: false, error: "Google Drive was not connected" }); return; }
        const r = await post(d, hub, "/drive/token", { code, verifier, redirect });
        const v = r.v;
        if (r.status !== 200 || typeof v.refresh !== "string" || !v.refresh || typeof v.access !== "string") {
          const why = typeof v.error === "string" ? v.error.slice(0, 200) : "the cloud did not answer";
          send(res, 200, failPage(`The cloud said: ${why}.`)); finish({ ok: false, error: why }); return;
        }
        const scope = typeof v.scope === "string" ? v.scope : "", email = typeof v.email === "string" ? v.email : "";
        keep(d.file, { hub, refresh: v.refresh, scope, email, at: (d.now ?? Date.now)() });
        held.access = v.access;
        held.until = typeof v.until === "number" ? v.until : (d.now ?? Date.now)() + 30 * 60_000;
        held.of = v.refresh;
        send(res, 200, drivePage(email));
        finish({ ok: true, email, scope });
      } catch {
        if (!res.headersSent) send(res, 500, failPage("Something went wrong in Sol."));
        finish({ ok: false, error: "the connect page failed" });
      }
    });
    const timer = setTimeout(() => finish({ ok: false, error: "Google Drive was not connected in ten minutes" }), CONNECT_FOR);
    timer.unref?.();
    server.on("error", () => finish({ ok: false, error: "Sol could not listen for Google's answer" }));
    server.listen(0, "127.0.0.1", () => {
      redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/done`;
      (d.open ?? openBrowser)(driveConsentUrl(cfg.client as string, cfg.scopes as string, redirect, state, challenge));
    });
  });
}

/** where this engine keeps its Drive connection (beside its other state) */
export const driveFile = (stateDir: string) => join(stateDir, "drive", "account.json");
