// The join link's page (#327; the groups PRD §9.2): `GET /relay/j/<code>`, what a friend opens from a link a group's
// maker sent. One small HTML page in the site's look (site/index.html: black, pearl ink, a goo body, a lit capsule),
// with the group's name, "open in Sol" (sol://join?code=<code>, which the app hears, mac/src-tauri link.rs), the code
// printed large for when the app cannot be opened from a link, and the download for someone with no Sol yet.
// It is the one hub page with no ticket: anyone with the link may read it, so it says only the name. The name comes
// from the registry's `peek`, which reads and never writes: opening the page never makes anyone a member, and it never
// passes a login. A code no room has is a guess, counted against the caller's address alone through the hub's own
// Guesses (registry.ts; an IPv6 address by its /48): past 50 misses in ten minutes the page says "wait ten minutes"
// without asking the registry, and past 2000 misses from everyone together every code reads as none for a while.
// `GET /relay/peek/<code>` is the same answer as JSON for a Sol (engine team/rooms.ts peekRoom), under the same count.
// Nothing here is kept: no-store, no referrer, no script, and a policy that lets the page load nothing but itself.
// Only a hub that serves this says so in its hello (`join: true`, HubOpts.joinPage); the face shows a link only then.
import type { IncomingMessage, ServerResponse } from "node:http";
import { CODE, oneLine } from "./hub-types.js";
import { ipBucket } from "./relay-hub.js";
import type { Guesses, RoomRegistry } from "./registry.js";

/** the site's download line (site/index.html, "Download Sol for Mac") */
export const DOWNLOAD = "https://github.com/marcocyl04-ux/sol-beta/releases/latest/download/Sol-mac.zip";
/** the site, which shows the one step macOS asks the first time an unsigned app opens */
export const SITE = "https://sol.matterfold.tech/#get";   // the site, on sol-beta's Pages with our own domain (#308)
/** the paths this file answers */
export const JOIN_PATHS = /^\/relay\/(j|peek)\/[^/]*$/;

/** what the page says: the room's name, none (no group has the code), or slowed (too many codes tried) */
export type JoinSaid = { code: string; name?: string; slowed?: boolean };

// a name as HTML text: the registry keeps whatever its maker typed (pure)
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** who a page's guess counts against (pure): the caller's address, an IPv6 one by its /48 (the block a site is given;
 *  the socket's count is by /64, relayHub's ipBucket), since the page asks for no account at all. A host that reads
 *  no addresses sees every caller as one, so they share one count */
export const pageGuesser = (ip: string) => {
  const b = ipBucket(ip);
  return `ip ${b.endsWith("::/64") ? `${b.split(":").slice(0, 3).join(":")}::/48` : b || "unknown"}`;
};
/** page misses across every caller in ten minutes (#327's review): past them the page says "no group has this code"
 *  to everyone, asking the registry nothing, until the oldest leaves the window. Many addresses together are slowed */
export const PAGE_MISSES_MAX = 2000;
const WINDOW = 10 * 60_000;

// Sol himself, as the site draws him (site/index.html), standing still: the page runs no script
const SOL = `<svg class="sol" viewBox="0 0 100 100" aria-hidden="true">  <defs>  <clipPath id="b"><path id="outline" d="M89.1 53.4C89.1 54.3 89.0 55.4 88.7 56.3C88.4 57.3 88.0 58.3 87.5 59.2C86.9 60.1 86.1 60.9 85.2 61.7C84.3 62.4 83.2 63.1 82.1 63.7C81.0 64.3 79.6 64.7 78.6 65.2C77.6 65.7 76.5 66.0 75.9 66.6C75.3 67.2 75.0 67.8 75.0 68.7C74.9 69.6 75.4 70.7 75.8 71.9C76.1 73.1 76.9 74.6 77.2 76.0C77.6 77.3 77.9 78.8 77.9 80.1C77.9 81.3 77.7 82.5 77.3 83.5C76.9 84.5 76.4 85.4 75.7 86.2C75.1 87.1 74.3 87.8 73.4 88.4C72.6 88.9 71.7 89.4 70.7 89.8C69.7 90.2 68.6 90.4 67.5 90.5C66.4 90.5 65.2 90.5 64.1 90.2C62.9 89.9 61.6 89.5 60.4 88.9C59.2 88.3 58.0 87.4 56.9 86.7C55.8 85.9 54.8 85.0 53.8 84.3C52.9 83.7 52.1 83.1 51.3 82.8C50.5 82.4 49.8 82.2 49.1 82.2C48.4 82.1 47.8 82.2 47.1 82.4C46.4 82.7 45.8 83.0 45.0 83.6C44.3 84.1 43.5 84.9 42.7 85.7C41.8 86.6 40.9 87.7 39.9 88.7C38.8 89.7 37.7 90.9 36.5 91.8C35.3 92.7 34.1 93.5 32.9 94.0C31.7 94.6 30.4 94.9 29.2 95.1C28.0 95.3 26.8 95.3 25.7 95.1C24.6 95.0 23.5 94.6 22.5 94.2C21.5 93.7 20.6 93.1 19.8 92.3C19.0 91.6 18.3 90.7 17.7 89.7C17.2 88.6 16.8 87.4 16.6 86.1C16.4 84.8 16.5 83.3 16.5 81.9C16.5 80.6 16.7 79.2 16.5 78.2C16.2 77.2 15.6 76.6 14.8 76.1C13.9 75.6 12.6 75.4 11.3 75.1C10.1 74.7 8.5 74.5 7.3 74.0C6.1 73.5 4.8 72.9 3.9 72.1C3.0 71.4 2.2 70.5 1.7 69.5C1.1 68.6 0.8 67.5 0.7 66.4C0.6 65.3 0.7 64.1 1.0 62.9C1.3 61.8 1.8 60.6 2.5 59.5C3.2 58.4 4.2 57.2 5.1 56.2C6.1 55.2 7.3 54.2 8.3 53.4C9.4 52.5 10.6 51.7 11.4 50.9C12.3 50.2 13.1 49.5 13.3 48.7C13.6 48.0 13.3 47.2 13.0 46.3C12.6 45.4 11.8 44.4 11.3 43.4C10.8 42.4 10.3 41.3 10.0 40.2C9.7 39.1 9.5 38.1 9.5 37.1C9.5 36.0 9.6 35.0 9.9 34.1C10.2 33.2 10.6 32.3 11.1 31.5C11.6 30.7 12.2 29.9 13.0 29.3C13.7 28.6 14.5 28.0 15.4 27.6C16.3 27.1 17.3 26.8 18.4 26.6C19.4 26.4 20.6 26.3 21.8 26.4C23.0 26.5 24.4 26.8 25.6 27.1C26.8 27.4 28.1 27.9 29.1 28.2C30.2 28.5 31.1 28.8 32.0 28.9C32.8 29.0 33.5 29.0 34.1 28.9C34.8 28.8 35.4 28.5 35.9 28.2C36.5 28.0 37.0 27.6 37.6 27.1C38.1 26.6 38.6 26.1 39.1 25.4C39.7 24.8 40.2 24.0 40.8 23.2C41.4 22.4 42.0 21.6 42.6 20.6C43.3 19.7 44.0 18.7 44.8 17.6C45.6 16.5 46.5 15.3 47.5 14.1C48.4 13.0 49.5 11.8 50.6 10.7C51.7 9.7 52.9 8.7 54.1 7.9C55.3 7.2 56.6 6.5 57.9 6.1C59.2 5.6 60.5 5.3 61.7 5.2C63.0 5.0 64.3 5.0 65.6 5.2C66.8 5.3 68.1 5.5 69.2 6.0C70.3 6.4 71.5 7.0 72.4 7.8C73.3 8.7 74.1 9.8 74.7 11.0C75.2 12.3 75.6 13.8 75.8 15.4C75.9 17.0 75.8 18.9 75.4 20.8C75.0 22.7 74.2 24.9 73.5 26.9C72.8 28.8 71.8 30.8 71.2 32.3C70.7 33.8 70.2 34.9 70.1 35.9C70.0 36.9 70.2 37.5 70.5 38.1C70.8 38.7 71.4 39.1 72.0 39.6C72.7 40.0 73.6 40.3 74.6 40.7C75.6 41.0 76.9 41.3 78.1 41.7C79.3 42.1 80.8 42.5 82.0 43.1C83.2 43.6 84.4 44.3 85.4 45.0C86.3 45.7 87.1 46.6 87.7 47.5C88.2 48.4 88.6 49.4 88.8 50.4C89.0 51.3 89.1 52.4 89.1 53.4Z"/></clipPath>  <filter id="f" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>  </defs>  <g class="hop"><g class="body">  <g clip-path="url(#b)"><rect width="100" height="100" fill="#fb3a98"/><g filter="url(#f)"><path d="M46.1 53.4L115.4 13.4A80 80 0 0 1 117.7 89.1Z" fill="#fcd50a"/><path d="M46.1 53.4L117.7 89.1A80 80 0 0 1 50.3 133.2Z" fill="#9ed40a"/><path d="M46.1 53.4L50.3 133.2A80 80 0 0 1 -16.5 103.2Z" fill="#fb7111"/><path d="M46.1 53.4L-16.5 103.2A80 80 0 0 1 -33.5 45.7Z" fill="#ef3a2a"/><path d="M46.1 53.4L-33.5 45.7A80 80 0 0 1 24.7 -23.7Z" fill="#b8ee3a"/><path d="M46.1 53.4L24.7 -23.7A80 80 0 0 1 115.4 13.4Z" fill="#fb5ad0"/><circle cx="46.1" cy="53.4" r="27" fill="#fb3a98"/></g></g>  <g><rect x="29.8" y="44.2" width="6" height="6.6" fill="#000"/><rect x="35.8" y="44.2" width="6" height="6.6" fill="#fff"/><rect x="47.4" y="44.2" width="6.3" height="6.6" fill="#000"/><rect x="53.7" y="44.2" width="6" height="6.6" fill="#fff"/></g>  </g></g></svg>`;

/** the page (pure): the group's name, the button, the code, the download; or the same page saying no group has it */
export function joinPage(s: JoinSaid, download = DOWNLOAD): string {
  const code = CODE.test(s.code) ? s.code : "";
  const name = oneLine(s.name, 60);   // the hub's line rule: no control or format characters, one line
  const found = !!name && !!code && !s.slowed;
  const title = s.slowed ? "too many codes tried" : found ? `join ${esc(name)}` : "no group has this code";
  const head = s.slowed ? "too many codes tried; wait ten minutes" : found ? esc(name) : "no group has this code";
  const sub = s.slowed ? "then open the link again" : found ? "a group on Sol: you, your friends, and each one's agent" : "check the code with whoever sent you the link";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${title} · sol</title>
<style>
  :root { color-scheme: dark; --page: #0c0c0c; --ink: #ebebe8; --dim: #9a9a97; --mute: #5c5c5a; --line: #262626;
    --mono: ui-monospace, "SF Mono", Menlo, monospace;
    --goo: radial-gradient(120% 80% at 18% 0%, rgb(255 255 255 / .07), transparent 60%), linear-gradient(180deg, rgb(235 235 232 / .12), rgb(235 235 232 / .05)); }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: var(--page); color: var(--ink); font: 17px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--mute); }
  a:hover { border-color: var(--ink); }
  p { margin: 0; }
  main { max-width: 560px; margin: 0 auto; padding: 72px 24px 56px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 28px; }
  .sol { width: 88px; height: 88px; overflow: visible; }
  .sol .body { transform-origin: 50% 90%; transform-box: view-box; animation: breathe 4.2s ease-out infinite alternate; }
  @keyframes breathe { to { transform: scale(1.025, 1.035); } }
  .card { width: 100%; padding: 34px 28px 30px; border-radius: 28px; background: var(--goo); box-shadow: 0 18px 40px -18px rgb(0 0 0 / .8); display: flex; flex-direction: column; align-items: center; gap: 20px; }
  h1 { margin: 0; font-size: 34px; font-weight: 600; letter-spacing: -.02em; line-height: 1.15; overflow-wrap: anywhere; }
  .dim { color: var(--dim); font-size: 15px; }
  .cap { display: inline-flex; align-items: center; padding: 14px 30px; border: 0; border-radius: 999px; font-size: 18px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgb(0 0 0 / .45); transition: transform 160ms ease-out;
    background: radial-gradient(120% 140% at 25% 0%, rgb(255 255 255 / .35), transparent 50%), linear-gradient(100deg, #fcd50a, #fb7111 30%, #fb3a98 65%, #fb5ad0);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / .35), inset 0 -3px 4px rgb(0 0 0 / .18), 0 10px 24px -10px rgb(251 58 152 / .6); }
  .cap:hover { transform: translateY(-1px); border: 0; }
  .cap:active { transform: scale(.97); }
  .code { font: 600 44px/1 var(--mono); letter-spacing: .18em; padding-left: .18em; user-select: all; }
  .foot { color: var(--dim); font-size: 15px; }
  @media (prefers-reduced-motion: reduce) { .sol .body { animation: none; } .cap { transition: none; } .cap:hover, .cap:active { transform: none; } }
</style>
</head>
<body>
<main>
  ${SOL}
  <div class="card">
    <h1>${head}</h1>
    <p class="dim">${sub}</p>
    ${found ? `<a class="cap" href="sol://join?code=${code}">open in Sol</a>` : ""}
    ${code && !s.slowed ? `<p class="code" aria-label="the code: ${code.split("").join(" ")}">${code}</p>` : ""}
    ${found ? `<p class="dim">or type this code in Sol › join a group</p>` : ""}
  </div>
  <p class="foot">don't have Sol? <a href="${esc(download)}">download</a> · <a href="${SITE}">the first time, macOS asks you to allow it</a></p>
</main>
</body>
</html>
`;
}

// the page's headers: never kept anywhere, nothing loaded but itself, never framed, no referrer to the link it opens
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

/** `GET /relay/j/<code>` (the page) and `GET /relay/peek/<code>` (its JSON) on a hub's http server, with no gate.
 *  `ip` says where a request came from (clientIp, on a host that reads addresses); `guesses` is the hub's own, so the
 *  page and the socket's hellos share one count. true when the request was this route's */
export function joinRoutes(registry: Pick<RoomRegistry, "peek">, opts: { guesses?: Guesses; ip?: (req: IncomingMessage) => string; download?: string; now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const misses: number[] = [];   // every caller's page misses in the window, oldest first: PAGE_MISSES_MAX at most
  const full = () => { const t = now(); while (misses.length && t - misses[0] >= WINDOW) misses.shift(); return misses.length >= PAGE_MISSES_MAX; };
  let saidUnknown = false;
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = (req.url ?? "").split("?")[0];
    const m = JOIN_PATHS.exec(path);
    if (!m) return false;
    const page = m[1] === "j";
    const send = (status: number, s: JoinSaid & { error?: string }) => {
      if (page) { res.writeHead(status, PAGE_HEADERS); res.end(req.method === "HEAD" ? undefined : joinPage(s, opts.download)); return; }
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(s.name && !s.slowed ? { code: s.code, name: s.name } : { error: s.error }));
    };
    if (req.method !== "GET" && !(page && req.method === "HEAD")) { res.writeHead(405, { allow: "GET", "content-type": "application/json" }); res.end(JSON.stringify({ error: "GET" })); return true; }
    let given = "";
    try { given = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)); } catch { /* not a code */ }
    const code = given.trim().toUpperCase();
    // a code that is not one is no guess at one: said plainly, not counted
    if (!CODE.test(code)) { send(page ? 404 : 400, { code: "", error: "a code is six letters and digits" }); return true; }
    const who = pageGuesser(opts.ip?.(req) ?? "");
    if (opts.guesses?.over(who)) { send(429, { code, slowed: true, error: "too many codes tried; wait ten minutes" }); return true; }
    // too many misses from everyone together: every code reads as none until the window passes, the registry unasked
    if (full()) { send(404, { code, error: "no group has this code" }); return true; }
    const p = registry.peek(code);
    if (!p) {
      if (who === "ip unknown" && !saidUnknown) { saidUnknown = true; console.log("relay: the join page counts a guess from no address; every such caller shares one count"); }
      opts.guesses?.miss(who);
      misses.push(now());
      send(404, { code, error: "no group has this code" });
      return true;
    }
    send(200, { code: p.code, name: oneLine(p.name, 60) });
    return true;
  };
}
