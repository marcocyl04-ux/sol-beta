// Sol accounts on a cloud, this engine's side (#214, S4 of #168; sol/cloud/src/login.ts is the other). A cloud's hub
// takes only its own `sol1.` tickets, and gives them to people who signed in with Google (Frank 2026-10-26: no GitHub
// on the cloud). The sign-in follows RFC 8252: the system browser, never a page inside Sol; a one-off listener on
// 127.0.0.1 and a port of its own (never the engine's, so the door is not in it), which Google sends the browser back
// to; PKCE, so a code caught on the way is worth nothing without this engine's verifier; a `state` checked in constant
// time. The code goes to the cloud, which alone holds the client secret, and comes back as an account:
// - signed in before: a ticket for an hour, and a renewal token for this machine;
// - new: the same browser tab asks for a Sol name and a birth month (the cloud checks both), then the same.
// Kept per hub in `<state>/cloud/accounts.json` (0600, its folder 0700): the name and the renewal token, never the
// ticket, which lives in memory and is renewed a minute before its hour ends.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { platform } from "node:os";
import type { AddressInfo } from "node:net";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const SIGN_IN_FOR = 10 * 60_000;
const WAIT = 10_000;
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** a cloud's address: https, or this machine's own (a cloud run here, the tests) */
const CLOUD = /^(https:\/\/|http:\/\/127\.0\.0\.1(:\d+)?\/)/;

export type CloudAccount = { login: string; refresh: string; at: number };
export type CloudDeps = {
  file: string;                                // the accounts file
  fetch?: typeof fetch;
  open?: (url: string) => void;                // the system browser (the tests catch the url)
  now?: () => number;
};

// ---- the accounts file ----

let cache: { file: string; all: Record<string, CloudAccount> } | null = null;

function readAll(file: string): Record<string, CloudAccount> {
  if (cache?.file === file) return cache.all;
  let all: Record<string, CloudAccount> = {};
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    if (v && typeof v === "object") for (const [hub, a] of Object.entries(v as Record<string, unknown>)) {
      const x = a as Partial<CloudAccount> | null;
      if (CLOUD.test(hub) && typeof x?.login === "string" && LOGIN.test(x.login) && typeof x.refresh === "string" && TOKEN.test(x.refresh))
        all[hub] = { login: x.login, refresh: x.refresh, at: typeof x.at === "number" ? x.at : 0 };
    }
  } catch { all = {}; }
  cache = { file, all };
  return all;
}

function writeAll(file: string, all: Record<string, CloudAccount>) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* written 0600 */ }
  cache = { file, all };
}

/** my account on a hub (its http address, relay.ts hubHttp), or null */
export const accountOn = (hub: string, file: string): CloudAccount | null => readAll(file)[hub] ?? null;

/** every hub I have an account on, with my name there (for the face and the settings) */
export const accounts = (file: string): { hub: string; login: string }[] => Object.entries(readAll(file)).map(([hub, a]) => ({ hub, login: a.login }));

function keep(file: string, hub: string, a: CloudAccount | null) {
  const all = { ...readAll(file) };
  if (a) all[hub] = a; else delete all[hub];
  writeAll(file, all);
}

/** for the tests: the file read again */
export const resetCloud = () => { cache = null; held.clear(); renewing.clear(); };

/** a hub refused my ticket (relay.ts, three connects in a row): the next knock renews instead of using it again */
export const dropTicket = (hub: string) => { held.delete(hub); };

// ---- tickets ----

const held = new Map<string, { ticket: string; until: number }>();
const renewing = new Map<string, Promise<string>>();

const post = (d: CloudDeps, url: string, body: object) => (d.fetch ?? fetch)(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(WAIT) }).catch(() => null);

/** my ticket for a hub I have an account on: the one held while it lasts another minute, else a renewal. "" when there
 *  is none (no account, the cloud did not answer). A renewal the cloud refuses (the token ran out, the account was
 *  disabled) forgets the account here: signing in again is the way back */
export function cloudTicket(hub: string, d: CloudDeps): Promise<string> {
  const now = (d.now ?? Date.now)(), h = held.get(hub);
  if (h && h.until - 60_000 > now) return Promise.resolve(h.ticket);
  const a = accountOn(hub, d.file);
  if (!a) return Promise.resolve("");
  const r = renewing.get(hub);
  if (r) return r;
  const p = (async () => {
    const res = await post(d, `${hub}/renew`, { refresh: a.refresh });
    if (!res) return "";
    // only the account this renewal was for: a sign-in that finished meanwhile wrote a new one, which stays
    if (res.status === 401) { held.delete(hub); if (accountOn(hub, d.file)?.refresh === a.refresh) keep(d.file, hub, null); console.log(`cloud: ${hub} would not renew my ticket; sign in again`); return ""; }
    const v = await res.json().catch(() => null) as { ticket?: unknown; until?: unknown } | null;
    if (!res.ok || typeof v?.ticket !== "string" || !v.ticket.startsWith("sol1.")) return "";
    held.set(hub, { ticket: v.ticket, until: typeof v.until === "number" ? v.until : now + 30 * 60_000 });
    return v.ticket;
  })().finally(() => renewing.delete(hub));
  renewing.set(hub, p);
  return p;
}

/** this machine signs out of a hub: its renewal token is dropped there, then here. A cloud that does not answer keeps
 *  it here too, so the sign-out can be tried again rather than leaving a token live on the cloud for 90 days */
export async function signOut(hub: string, d: CloudDeps): Promise<boolean> {
  const a = accountOn(hub, d.file);
  if (!a) return false;
  const r = await post(d, `${hub}/logout`, { refresh: a.refresh });
  if (!r?.ok) return false;
  held.delete(hub);
  keep(d.file, hub, null);
  return true;
}

// ---- signing in ----

const b64 = (b: Buffer) => b.toString("base64url");
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** the system browser at a url (macOS `open`, else xdg-open); never a shell */
export const openBrowser = (url: string) => { execFile(platform() === "darwin" ? "open" : "xdg-open", [url], () => {}); };

/** Google's consent page for this client, this redirect, this state and this PKCE challenge (pure) */
export function consentUrl(client: string, scopes: string, redirect: string, state: string, challenge: string): string {
  const q = new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", scope: scopes, state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" });
  return `${AUTH_URL}?${q}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** the small pages the listener shows in the browser tab (pure) */
export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:28rem;margin:12vh auto;padding:0 1.25rem;color:#1d1d1f;background:#fbfbfd}
h1{font-size:1.4rem;margin:0 0 .75rem}label{display:block;margin:1rem 0 .3rem;font-weight:600}input,select{font:inherit;padding:.5rem .6rem;border:1px solid #b7b7bf;border-radius:8px;width:100%;box-sizing:border-box}
.row{display:flex;gap:.6rem}button{margin-top:1.4rem;font:inherit;font-weight:600;padding:.6rem 1.1rem;border:0;border-radius:8px;background:#1d1d1f;color:#fff;cursor:pointer}
.err{color:#b3261e;margin-top:1rem}.small{color:#5e5e66;font-size:.9rem}
@media (prefers-color-scheme:dark){body{background:#151517;color:#f2f2f4}input,select{background:#232326;color:#f2f2f4;border-color:#4a4a50}button{background:#f2f2f4;color:#151517}.small{color:#a5a5ad}.err{color:#ff8a80}}</style>
<h1>${esc(title)}</h1>${body}</html>`;
}

export function namePage(form: string, suggest: string, email: string, error = ""): string {
  const y = new Date().getUTCFullYear();
  return page("Pick your name in Sol", `<p class="small">Signed in as ${esc(email)}. Your teammates see this name. It is yours across Sol, and nobody else can take one that looks like it.</p>
<form method="post" action="/name"><input type="hidden" name="form" value="${esc(form)}">
<label for="n">Name</label><input id="n" name="name" value="${esc(suggest)}" required minlength="3" maxlength="24" pattern="[a-z][a-z0-9-]{2,23}" autocapitalize="off" spellcheck="false" autofocus>
<p class="small">3 to 24 small letters, digits or hyphens, starting with a letter.</p>
<label for="m">When were you born?</label><div class="row"><select id="m" name="month" required><option value="">Month</option>${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select>
<input name="year" type="number" inputmode="numeric" placeholder="Year" min="1900" max="${y}" required></div>
<p class="small">Sol does not keep your birth date.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}<button type="submit">Join Sol</button></form>`);
}

export const donePage = (login: string) => page("You can go back to Sol", `<p>You are signed in as <b>${esc(login)}</b>. This tab can close.</p>`);
export const failPage = (why: string) => page("Sign-in did not finish", `<p>${esc(why)}</p><p class="small">Start it again from Sol.</p>`);

export type SignedIn = { ok: true; login: string } | { ok: false; error: string };

const signingIn = new Map<string, Promise<SignedIn>>();

/** sign in to a hub (its http address) with Google, in the system browser: done when the person finished in the tab,
 *  or after ten minutes. One at a time a hub */
export function signIn(hub: string, d: CloudDeps): Promise<SignedIn> {
  if (!CLOUD.test(hub)) return Promise.resolve({ ok: false, error: "a cloud is signed in to over https only" });
  const r = signingIn.get(hub);
  if (r) return r;
  const p = run(hub, d).finally(() => signingIn.delete(hub));
  signingIn.set(hub, p);
  return p;
}

async function run(hub: string, d: CloudDeps): Promise<SignedIn> {
  const f = d.fetch ?? fetch;
  const cfg = await f(`${hub}/login`, { signal: AbortSignal.timeout(WAIT) }).then((r) => r.ok ? r.json() : null).catch(() => null) as { client?: unknown; scopes?: unknown } | null;
  if (typeof cfg?.client !== "string" || !cfg.client) return { ok: false, error: "that cloud has no Google sign-in" };
  const scopes = typeof cfg.scopes === "string" ? cfg.scopes : "openid email profile";
  const verifier = b64(randomBytes(32)), challenge = b64(createHash("sha256").update(verifier).digest());
  const state = b64(randomBytes(24));
  let form = "", email = "", origin = "", redirect = "", came = false;

  return new Promise<SignedIn>((resolve) => {
    let finished = false;
    const finish = (v: SignedIn) => { if (finished) return; finished = true; clearTimeout(timer); setTimeout(() => { server.close(); server.closeAllConnections(); }, 500).unref(); resolve(v); };
    const send = (res: ServerResponse, status: number, html: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "same-origin",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" });
      res.end(html);
    };
    const signed = (res: ServerResponse, v: { login?: unknown; refresh?: unknown; ticket?: unknown; until?: unknown }) => {
      if (typeof v.login !== "string" || !LOGIN.test(v.login) || typeof v.refresh !== "string" || !TOKEN.test(v.refresh)) { send(res, 502, failPage("The cloud's answer was not one Sol knows.")); finish({ ok: false, error: "the cloud's answer was not an account" }); return; }
      keep(d.file, hub, { login: v.login, refresh: v.refresh, at: (d.now ?? Date.now)() });
      if (typeof v.ticket === "string" && v.ticket.startsWith("sol1.") && typeof v.until === "number") held.set(hub, { ticket: v.ticket, until: v.until });
      send(res, 200, donePage(v.login));
      finish({ ok: true, login: v.login });
    };

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      try {
        if (u.pathname === "/done" && req.method === "GET") {
          const s = u.searchParams.get("state") ?? "", code = u.searchParams.get("code") ?? "";
          if (!s || !same(s, state)) { send(res, 400, failPage("This page was not the one Sol opened.")); return; }   // not ours: keep waiting
          // once: a reload or a prefetch of this page must not trade the code a second time (Google refuses a used one)
          if (came) { send(res, 409, failPage("This sign-in already came back; look at the first tab.")); return; }
          came = true;
          if (u.searchParams.get("error") || !code) { send(res, 200, failPage("Google did not sign you in.")); finish({ ok: false, error: "Google did not sign in" }); return; }
          const r = await post(d, `${hub}/login`, { code, verifier, redirect });
          const v = await r?.json().catch(() => null) as Record<string, unknown> | null;
          if (!r?.ok || !v) { const why = typeof v?.error === "string" ? v.error : "the cloud did not answer"; send(res, 200, failPage(`The cloud said: ${why}.`)); finish({ ok: false, error: why }); return; }
          if (typeof v.signup === "string") {
            form = v.signup;
            email = typeof v.email === "string" ? v.email : "";
            send(res, 200, namePage(form, typeof v.suggest === "string" ? v.suggest : "", email));
            return;
          }
          signed(res, v);
          return;
        }
        if (u.pathname === "/name" && req.method === "POST") {
          // the form above, posted from this listener's own page: its Origin (or none a browser will say: "null"), and
          // the cloud's pending sign-in in it, 43 random characters no other page can know
          if (!form || (req.headers.origin !== origin && req.headers.origin !== "null")) { send(res, 403, failPage("This form was not the one Sol showed.")); return; }
          let body = "";
          for await (const chunk of req) { body += chunk; if (body.length > 4000) break; }
          const q = new URLSearchParams(body);
          if (!same(q.get("form") ?? "", form)) { send(res, 403, failPage("This form was not the one Sol showed.")); return; }
          const name = (q.get("name") ?? "").trim().toLowerCase(), born = { year: Number(q.get("year")), month: Number(q.get("month")) };
          const r = await post(d, `${hub}/signup`, { signup: form, name, born });
          const v = await r?.json().catch(() => null) as Record<string, unknown> | null;
          if (r?.ok && v) { signed(res, v); return; }
          const why = typeof v?.error === "string" ? v.error : "the cloud did not answer";
          // under 13, or a sign-in that ran out: the end. A taken or wrong name: the form again, with a free one offered
          if (!r || r.status === 403 || (r.status === 400 && /sign in/.test(why))) { send(res, 200, failPage(why[0].toUpperCase() + why.slice(1) + ".")); finish({ ok: false, error: why }); return; }
          send(res, 200, namePage(form, typeof v?.suggest === "string" && v.suggest ? v.suggest : name, email, why[0].toUpperCase() + why.slice(1) + "."));
          return;
        }
        res.writeHead(404); res.end();
      } catch {
        if (!res.headersSent) send(res, 500, failPage("Something went wrong in Sol."));
        finish({ ok: false, error: "the sign-in page failed" });
      }
    });
    const timer = setTimeout(() => finish({ ok: false, error: "the sign-in was not finished in ten minutes" }), SIGN_IN_FOR);
    timer.unref?.();
    server.on("error", () => finish({ ok: false, error: "Sol could not listen for the sign-in" }));
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      origin = `http://127.0.0.1:${port}`;
      redirect = `${origin}/done`;
      (d.open ?? openBrowser)(consentUrl(cfg.client as string, scopes, redirect, state, challenge));
    });
  });
}

/** where this engine keeps its accounts (beside its other state) */
export const accountsFile = (stateDir: string) => join(stateDir, "cloud", "accounts.json");
