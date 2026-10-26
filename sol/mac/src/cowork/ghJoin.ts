// No GitHub yet (ADDITIONS §4c, #252): a GitHub room needs a GitHub account to write; a person without one makes it
// with Google in Sol's own web view, and Sol signs gh in after. Cloud and Drive rooms need no GitHub (§4d): the card is
// only ever for a GitHub room on a machine whose gh is not signed in (cardFor).
//
// Sol only watches the address (the shell tells origin and path, never the query: thing.rs `shown`). github.com/signup
// opens in the web view; once a page has finished loading on github.com outside the sign-up's own pages, the account
// is there and signed in, so Sol starts gh's device flow by itself and takes the same web view to /login/device, where
// the person pastes the code (gh copied it) and presses Authorize. Nothing is scripted in the page; no password, no
// cookie passes Sol (PRD §9.8).
//
// The way out: when the web view cannot do it (it does not open, a page the sign-up needs is refused, or Google says
// this browser is not allowed), both steps go to the person's own browser, said in one sentence; there Sol cannot see
// the address, so the person says when the account is made.

/** the card, or none: only a GitHub room, only while gh is not signed in here; unknown (still reading) shows none. Pure */
export function cardFor(keeps: string, github: { in: boolean } | null | undefined): boolean {
  return keeps === "github" && !!github && !github.in;
}

export const SIGNUP = "https://github.com/signup";
export const DEVICE = "https://github.com/login/device";
/** the web view's tab (thing.rs JOIN) */
export const JOIN_TAB = "ghjoin";

// github.com pages that are still the sign-up (or a sign-in on the way to it): Google's way back, the email's code
const FLOW = ["/signup", "/join", "/sessions", "/session", "/login", "/account_verifications", "/password_reset", "/auth"];
// what only an account being made passes through: Google's way back to GitHub, the email's code
const PROOF = ["/sessions", "/account_verifications"];
const under = (path: string, p: string) => path === p || path.startsWith(`${p}/`);

export type Seen = "flow" | "proof" | "made" | "google" | "blocked" | "other";
/** what one address says: the sign-up, a step only a new account takes, back on GitHub, Google's sign-in, Google
 *  turning the web view away, or nothing. Pure */
export function seen(address: string): Seen {
  let u: URL;
  try { u = new URL(address); } catch { return "other"; }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const path = u.pathname.replace(/\/+$/, "") || "/";
  if (u.protocol !== "https:") return "other";
  // the way to Google (…/initiate) is not the way back: only coming back proves an account
  if (host === "github.com" || host === "www.github.com") return PROOF.some((p) => under(path, p)) && !/\/initiate$/.test(path) ? "proof" : FLOW.some((p) => under(path, p)) ? "flow" : "made";
  if (host === "accounts.google.com") {
    // Google turns an embedded browser away on pages of its own ("this browser or app may not be secure")
    return /\/(rejected|disallowed|error)(\/|$)|deniedsigninrejected/i.test(path) ? "blocked" : "google";
  }
  return "other";
}

export type Step =
  | { k: "ask" }                                  // the card's two choices
  | { k: "have" }                                 // I have GitHub: #176's card (the code, open github.com)
  // the web view on the sign-up. first: no page has finished loading yet; proof: the way only a new account takes
  // (Google's way back to GitHub, the email's code) was seen, even as a hop; a GitHub page clicked before it proves nothing
  | { k: "signup"; first: boolean; proof: boolean }
  | { k: "device"; code: string; url: string; inside: boolean }   // the code; inside: /login/device in the same web view
  | { k: "browser"; why: string }                 // the way out: the sign-up in the system browser, on a press; the code too
  | { k: "in"; login: string };                   // gh is signed in

export type Fx = { device?: true; close?: true };
/** the next step after the web view is at an address (finished: the page is loaded, not a hop on the way), and what
 *  to do. Back on github.com off the sign-up counts once the account's way was seen, or at once when /signup itself
 *  sent the view straight on (this browser is signed in to GitHub already). Pure */
export function onLoad(s: Step, address: string, finished = true): [Step, Fx] {
  if (s.k !== "signup") return [s, {}];
  const w = seen(address);
  if (w === "blocked") return [{ k: "browser", why: BLOCKED }, { close: true }];
  let n: Step = s;
  // GitHub's own steps only: a trip to Google's sign-in that was backed out of proves nothing
  if (w === "proof" && !s.proof) n = { ...s, proof: true };
  if (!finished) return [n, {}];
  // a way back that lands on the sign-in page (Google cancelled, an error): no account came of it. Not /signup: a new
  // account's way back may well finish there, to confirm its name
  if (w === "flow" && /^\/login(\/|$)/.test(new URL(address).pathname) && (n as typeof s).proof) n = { ...(n as typeof s), proof: false };
  const first = s.first;
  if (first) n = { ...(n as typeof s), first: false };
  if (w === "made" && (first || s.proof || (n as typeof s).proof)) return [n, { device: true }];
  return [n, {}];
}

/** the code's page refused in the web view: the code stays on the card, its page opens on its button. Pure */
export function onRefused(s: Step): [Step, Fx] {
  if (s.k === "device" && s.inside) return [{ ...s, inside: false }, { close: true }];
  return [s, {}];
}

export const BLOCKED = "GitHub's sign-up does not work inside Sol here, so make the account in your browser, then come back and press \"made it, sign me in\".";
export const said = (error: string) => (error === "cancelled" ? "the sign-in was cancelled" : error);

// ---- the flow, with what it touches passed in (the web view, gh's device flow, the browser), so a test can fake them ----
export type JoinDeps = {
  open: (url: string, site: string) => Promise<void>;   // the web view's tab, on its pane
  go: (url: string) => Promise<void>;                   // the same tab to another github.com page
  close: () => Promise<void>;
  connect: () => Promise<{ code?: string; url?: string; error?: string }>;   // team.github.connect
  cancel: () => void;                                   // team.github.connect.cancel
  browser: (url: string) => void;                       // the system browser, on a press
  set: (s: Step) => void;
  say: (line: string) => void;
};

export class JoinFlow {
  s: Step = { k: "ask" };
  private starting = false;
  private stopped = false;   // "not now" while gh was being asked for a code
  private d: JoinDeps;
  constructor(d: JoinDeps) { this.d = d; }
  private to(s: Step) { this.s = s; this.d.set(s); }
  private async fx(f: Fx) {
    if (f.close) await this.d.close().catch(() => {});
    if (f.device) await this.device(true);
  }

  /** "I have GitHub": gh's device flow, #176's card, the page in the system browser on its button */
  async have() {
    this.to({ k: "have" });
    const r = await this.d.connect();
    if (this.s.k !== "have") return;
    if (r.code && r.url) this.to({ k: "device", code: r.code, url: r.url, inside: false });
    else { this.to({ k: "ask" }); this.d.say(said(r.error ?? "GitHub did not answer")); }
  }

  /** "No, make one with Google": the sign-up in Sol's web view; it cannot open → the way out (the press opens it) */
  async signup() {
    this.to({ k: "signup", first: true, proof: false });
    try { await this.d.open(SIGNUP, SIGNUP); }
    catch {
      if (this.s.k !== "signup") return;
      this.to({ k: "browser", why: BLOCKED });
      this.d.browser(SIGNUP);   // this came from the press on "No": the shell never opens a browser on its own
    }
  }

  /** the web view is at this address (origin and path); finished: loaded, not a hop on the way */
  async loaded(address: string, finished = true) { const [s, f] = onLoad(this.s, address, finished); if (s !== this.s) this.to(s); await this.fx(f); }
  /** the way out: the web view gave up (nothing opens until a press), or the person pressed "use my browser
   *  instead" (press: the same page opens there now) */
  out(press = false) {
    const s0 = this.s;
    if (s0.k === "signup") { void this.d.close().catch(() => {}); this.to({ k: "browser", why: BLOCKED }); if (press) this.d.browser(SIGNUP); }
    else { const [s, f] = onRefused(s0); if (s !== s0) this.to(s); void this.fx(f); if (press && s0.k === "device") this.d.browser(s0.url); }
  }

  /** the account is made: gh's device flow. Inside: by itself, the code's page in the same web view; else a press
   *  ("made it, sign me in") opens it in the system browser. Stopped meanwhile: gh is cancelled, nothing opens */
  async device(inside: boolean) {
    if (this.starting) return;
    this.starting = true;
    const was = this.s.k;
    try {
      const r = await this.d.connect();
      if (this.s.k !== was || this.stopped) { this.stopped = false; if (r.code) this.d.cancel(); return; }
      if (r.code && r.url) {
        const stay = inside && this.s.k === "signup";
        this.to({ k: "device", code: r.code, url: r.url, inside: stay });
        if (stay) await this.d.go(r.url).catch(() => this.out());   // the code's page refused: its button opens it
        else this.d.browser(r.url);
      } else this.d.say(said(r.error ?? "GitHub did not answer"));
    } finally { this.starting = false; }
  }

  /** gh told every window it is in */
  connected(login: string) { void this.d.close().catch(() => {}); this.to({ k: "in", login }); }
  /** gh said no (a cancel, the code died) while its code was up: back to the two choices, said */
  failed(error: string) {
    if (this.s.k !== "device" && this.s.k !== "have") return;
    void this.d.close().catch(() => {});
    this.to({ k: "ask" });
    this.d.say(said(error));
  }

  /** "not now" / back: whatever runs stops */
  stop() {
    if (this.s.k === "device" || this.s.k === "have") this.d.cancel();
    if (this.starting) this.stopped = true;   // its code, when it comes, is cancelled
    void this.d.close().catch(() => {});
    this.to({ k: "ask" });
  }
}
