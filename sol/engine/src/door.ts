// The door: who may open the engine's socket or fetch its routes. Pure on the request headers, so `npm test` can knock.
//
// Over the tailnet (`tailscale serve` proxies to this port and adds Tailscale-User-Login): the login must be SOL_OWNER,
// and a request with an Origin must come from a page of Sol's own: the away page this engine serves at its own tailnet
// name (https, the request's Host), or the Mac app and its hot face on an owner device, which dial a far engine when
// Marco moves Sol there (My machines, #32; #49). Any other page on an owner device, Sol's own Playwright browser on the
// NucBox included, carries its own Origin and is refused (#16, blocker 1). No Origin is a program on the tailnet (the
// phone app, curl as the owner).
//
// On loopback (safety pass #11, C1): a browser always sends its page's Origin, and any web page can open a socket to
// 127.0.0.1, so the request must come from Sol's own pages: the app's bundled pages, its hot pages on Vite, or the
// away page this engine serves. No Origin is a local program (it already runs as Marco). WebKit calls the hot face's
// socket (localhost:1420 to 127.0.0.1) "cross-site", so Sec-Fetch-Site only speaks when there is no Origin.
import type { IncomingHttpHeaders } from "node:http";

export type DoorOpts = { port: number; owner: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function tailnetOk(headers: IncomingHttpHeaders, opts: DoorOpts): boolean {
  const who = one(headers["tailscale-user-login"]);
  if (who === undefined) return true;
  const owner = opts.owner.trim().toLowerCase();
  return owner !== "" && who.trim().toLowerCase() === owner;
}

// The app's own pages, wherever the engine is: the bundled pages and the hot face on Vite. SOL_FACE names one more
// origin, a side copy's hot face on another port, so a worktree's engine and face can be tried together.
const APP = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420", "http://127.0.0.1:1420", ...(process.env.SOL_FACE ? [process.env.SOL_FACE] : [])]);

export function doorOpen(headers: IncomingHttpHeaders, opts: DoorOpts): boolean {
  if (!tailnetOk(headers, opts)) return false;
  const o = one(headers.origin);
  if (one(headers["tailscale-user-login"]) !== undefined) {
    if (o === undefined) return true;
    if (APP.has(o)) return true;
    const host = (one(headers["x-forwarded-host"]) ?? one(headers.host) ?? "").trim().toLowerCase();
    return host !== "" && o.toLowerCase() === `https://${host}`;
  }
  const own = (x: string) => APP.has(x) || x === `http://127.0.0.1:${opts.port}` || x === `http://localhost:${opts.port}`;
  if (typeof o === "string") return own(o);
  if (one(headers["sec-fetch-site"]) !== "cross-site") return true;
  // an image, font or style a page of Sol's own loads (the page pane's assets, #54) carries no Origin, only its page as
  // Referer and "cross-site" (the app's scheme is not the engine's): the Referer's origin must be a page of Sol's own
  return one(headers["sec-fetch-mode"]) === "no-cors" && own(originOf(one(headers.referer)));
}
// the origin of a URL; a custom scheme (tauri://localhost) has none in Node, so it is put together
const originOf = (u: string | undefined) => { try { if (!u) return ""; const x = new URL(u); return x.origin !== "null" ? x.origin : `${x.protocol}//${x.host}`; } catch { return ""; } };
