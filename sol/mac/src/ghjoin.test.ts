// node --test src/*.test.ts (npm test here): no GitHub yet (ADDITIONS §4c, #252, cowork/ghJoin.ts). Sol watches the
// web view's address only; these drive the flow with a fake web view, a fake gh and a fake browser. The real sign-up is
// not tested here or anywhere by an agent: GitHub's terms forbid scripted sign-ups, and it would make a real account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardFor, seen, onLoad, onRefused, JoinFlow, SIGNUP, DEVICE, BLOCKED, type Step } from "./cowork/ghJoin.ts";

test("the card is for a GitHub room on a machine without gh signed in, never a cloud or Drive room", () => {
  assert.equal(cardFor("github", { in: false }), true);
  assert.equal(cardFor("github", { in: true }), false);
  assert.equal(cardFor("github", null), false, "still reading: no card yet");
  for (const k of ["cloud", "drive", "sol", ""]) {
    assert.equal(cardFor(k, { in: false }), false, k);
    assert.equal(cardFor(k, { in: true }), false, k);
  }
});

test("an address is the sign-up, a new account's way, back on GitHub, Google, a refusal, or nothing", () => {
  for (const a of ["https://github.com/signup", "https://github.com/signup/", "https://github.com/join", "https://github.com/login", "https://github.com/sessions/social/google/initiate",
    "https://www.github.com/signup"]) assert.equal(seen(a), "flow", a);
  for (const a of ["https://github.com/sessions/social/google/callback", "https://github.com/account_verifications"]) assert.equal(seen(a), "proof", a);
  for (const a of ["https://github.com/", "https://github.com/dashboard", "https://github.com/welcome", "https://github.com/alice",
    "https://github.com/signupx", "https://github.com/loginx"]) assert.equal(seen(a), "made", a);
  assert.equal(seen("https://accounts.google.com/o/oauth2/v2/auth"), "google");
  for (const a of ["https://accounts.google.com/v3/signin/rejected", "https://accounts.google.com/signin/oauth/error",
    "https://accounts.google.com/signin/oauth/disallowed"]) assert.equal(seen(a), "blocked", a);
  for (const a of ["https://octocaptcha.com/", "http://github.com/", "https://github.com.evil.com/", "https://evil.com/github.com/", "not a url", ""])
    assert.equal(seen(a), "other", a);
});

test("back on GitHub counts only after a new account's way was seen", () => {
  const start: Step = { k: "signup", first: true, proof: false };
  const [s1] = onLoad(start, "https://github.com/signup");
  assert.deepEqual(s1, { k: "signup", first: false, proof: false });
  // the GitHub logo, /pricing: clicked away from the sign-up, no account yet
  for (const a of ["https://github.com/", "https://github.com/pricing"]) assert.deepEqual(onLoad(s1, a)[1], {}, a);
  const [s2] = onLoad(s1, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.deepEqual(s2, s1, "Google's sign-in alone proves nothing: it may be backed out of");
  assert.deepEqual(onLoad(s2, "https://github.com/pricing")[1], {}, "backed out of Google, then a click away: nothing");
  const [s3, f3] = onLoad(s2, "https://github.com/sessions/social/google/callback", false);
  assert.deepEqual(s3, { k: "signup", first: false, proof: true }, "Google's way back, even as a hop, is the way");
  assert.deepEqual(f3, {});
  assert.deepEqual(onLoad(s3, "https://github.com/", false)[1], {}, "a hop on the way counts for nothing");
  assert.deepEqual(onLoad(s3, "https://github.com/")[1], { device: true });
  const [e1] = onLoad(s1, "https://github.com/account_verifications");
  assert.deepEqual(onLoad(e1, "https://github.com/welcome")[1], { device: true }, "the email's way");
  assert.deepEqual(onLoad({ k: "ask" }, "https://github.com/"), [{ k: "ask" }, {}], "only while signing up");
});

test("Google cancelled: the way back lands on the sign-in page, and proves nothing after", () => {
  let st: Step = { k: "signup", first: false, proof: false };
  st = onLoad(st, "https://github.com/sessions/social/google/initiate", false)[0];
  assert.deepEqual(st, { k: "signup", first: false, proof: false }, "the way to Google is not the way back");
  st = onLoad(st, "https://github.com/sessions/social/google/callback", false)[0];
  st = onLoad(st, "https://github.com/login")[0];
  assert.deepEqual(st, { k: "signup", first: false, proof: false });
  assert.deepEqual(onLoad(onLoad(st, "https://github.com/signup")[0], "https://github.com/pricing")[1], {});
});

test("/signup sending the view straight on: this browser is signed in to GitHub already", () => {
  assert.deepEqual(onLoad({ k: "signup", first: true, proof: false }, "https://github.com/")[1], { device: true });
});

test("Google turning the web view away is the way out, and nothing opens by itself", () => {
  const [s, f] = onLoad({ k: "signup", first: false, proof: true }, "https://accounts.google.com/v3/signin/rejected");
  assert.deepEqual(s, { k: "browser", why: BLOCKED });
  assert.deepEqual(f, { close: true });
  const [s2, f2] = onRefused({ k: "device", code: "ABCD-1234", url: DEVICE, inside: true });
  assert.deepEqual(s2, { k: "device", code: "ABCD-1234", url: DEVICE, inside: false }, "the code stays on the card");
  assert.deepEqual(f2, { close: true });
  assert.deepEqual(onRefused({ k: "ask" }), [{ k: "ask" }, {}]);
  assert.ok(!BLOCKED.includes(". "), "one sentence");
});

// a fake web view, gh and browser, writing down what was done; connect waits for answer() when asked to
function rig(o: { open?: "ok" | "fail"; connect?: { code?: string; url?: string; error?: string }; hold?: boolean } = {}) {
  const did: string[] = [], steps: Step[] = [], said: string[] = [];
  let answer: (r: any) => void = () => {};
  const f = new JoinFlow({
    open: async (url, site) => { did.push(`open ${url} on ${site}`); if (o.open === "fail") throw new Error("macOS 14"); },
    go: async (url) => { did.push(`go ${url}`); },
    close: async () => { did.push("close"); },
    connect: () => { did.push("connect"); return o.hold ? new Promise((ok) => { answer = ok; }) : Promise.resolve(o.connect ?? { code: "ABCD-1234", url: DEVICE }); },
    cancel: () => { did.push("cancel"); },
    browser: (url) => { did.push(`browser ${url}`); },
    set: (s) => steps.push(s),
    say: (l) => said.push(l),
  });
  return { f, did, steps, said, answer: (r: any) => answer(r) };
}

test("no account: the sign-up in the web view, then the device page in the same view, by itself", async () => {
  const { f, did } = rig();
  await f.signup();
  assert.deepEqual(did, [`open ${SIGNUP} on ${SIGNUP}`]);
  await f.loaded("https://github.com/signup");
  await f.loaded("https://accounts.google.com/o/oauth2/v2/auth");
  await f.loaded("https://github.com/sessions/social/google/callback", false);
  await f.loaded("https://github.com/signup");
  assert.deepEqual(did, [`open ${SIGNUP} on ${SIGNUP}`], "nothing while signing up");
  await f.loaded("https://github.com/");
  assert.deepEqual(did, [`open ${SIGNUP} on ${SIGNUP}`, "connect", `go ${DEVICE}`]);
  assert.deepEqual(f.s, { k: "device", code: "ABCD-1234", url: DEVICE, inside: true });
  await f.loaded("https://github.com/dashboard");
  assert.equal(did.filter((x) => x === "connect").length, 1, "one device flow");
  assert.ok(!did.some((x) => x.startsWith("browser")), "the system browser never opened");
  f.connected("alice");
  assert.deepEqual(f.s, { k: "in", login: "alice" });
  assert.equal(did.at(-1), "close");
});

test("two loads at once start one device flow", async () => {
  const { f, did } = rig();
  await f.signup();
  await f.loaded("https://github.com/signup");
  await f.loaded("https://github.com/account_verifications");
  await Promise.all([f.loaded("https://github.com/"), f.loaded("https://github.com/welcome")]);
  assert.equal(did.filter((x) => x === "connect").length, 1);
});

test("the web view cannot open: the system browser for both steps, each on a press, with the one sentence", async () => {
  const { f, did } = rig({ open: "fail" });
  await f.signup();   // the press on "No"
  assert.deepEqual(f.s, { k: "browser", why: BLOCKED });
  assert.deepEqual(did, [`open ${SIGNUP} on ${SIGNUP}`, `browser ${SIGNUP}`]);
  await f.device(false);   // the press on "made it, sign me in"
  assert.deepEqual(f.s, { k: "device", code: "ABCD-1234", url: DEVICE, inside: false });
  assert.deepEqual(did.slice(2), ["connect", `browser ${DEVICE}`]);
});

test("Google refusing the web view mid-sign-up: the way out, the browser only on a press", async () => {
  const { f, did } = rig();
  await f.signup();
  await f.loaded("https://github.com/signup");
  await f.loaded("https://accounts.google.com/v3/signin/rejected");
  assert.equal(f.s.k, "browser");
  assert.deepEqual(did.slice(1), ["close"], "nothing opened by itself");
});

test("use my browser instead: the same page opens there, on that press", async () => {
  const { f, did } = rig();
  await f.signup();
  f.out(true);
  assert.equal(f.s.k, "browser");
  assert.deepEqual(did.slice(1), ["close", `browser ${SIGNUP}`]);
  const g = rig();
  await g.f.signup(); await g.f.loaded("https://github.com/signup"); await g.f.loaded("https://github.com/sessions/social/google/callback", false); await g.f.loaded("https://github.com/");
  g.f.out(true);
  assert.deepEqual(g.f.s, { k: "device", code: "ABCD-1234", url: DEVICE, inside: false });
  assert.deepEqual(g.did.slice(-2), ["close", `browser ${DEVICE}`]);
});

test("not now while the device flow is starting: gh is cancelled when its code comes, nothing opens", async () => {
  const { f, did, answer } = rig({ hold: true });
  await f.signup(); await f.loaded("https://github.com/signup"); await f.loaded("https://github.com/sessions/social/google/callback", false);
  const p = f.loaded("https://github.com/");
  f.stop();
  answer({ code: "ABCD-1234", url: DEVICE }); await p;
  assert.deepEqual(f.s, { k: "ask" });
  assert.ok(did.includes("cancel"), "gh stopped");
  assert.ok(!did.some((x) => x.startsWith("browser") || x.startsWith("go")), "nothing opened");
});

test("I have GitHub: #176's card, its page on the button only", async () => {
  const { f, did } = rig();
  await f.have();
  assert.deepEqual(f.s, { k: "device", code: "ABCD-1234", url: DEVICE, inside: false });
  assert.deepEqual(did, ["connect"]);
  f.failed("the code was not entered in time: press sign in again");
  assert.deepEqual(f.s, { k: "ask" });
});

test("gh refusing (a token in the environment), or cancelled, is said in words", async () => {
  const { f, said } = rig({ connect: { error: "GH_TOKEN is set in Sol's environment; gh uses it instead of a sign-in" } });
  await f.have();
  assert.deepEqual(f.s, { k: "ask" });
  assert.match(said[0], /GH_TOKEN/);
  const c = rig({ hold: true });
  const p = c.f.have(); c.answer({ error: "cancelled" }); await p; c.f.failed("cancelled");
  assert.deepEqual(c.said, ["the sign-in was cancelled"]);
});

test("not now stops a sign-in that waits, and closes the web view", async () => {
  const { f, did } = rig();
  await f.signup();
  await f.loaded("https://github.com/signup");
  await f.loaded("https://github.com/sessions/social/google/callback", false);
  await f.loaded("https://github.com/");
  f.stop();
  assert.deepEqual(did.slice(-2), ["cancel", "close"]);
  assert.deepEqual(f.s, { k: "ask" });
});
