// The one socket a page keeps to an engine (#17, sleep and wake 2026-10-20). Before this, every hook of a page opened
// its own (useEngine, renovation, useNotch, useDoor) and noticed trouble only when the browser fired `close`; after the
// Mac slept, a socket could look open for minutes while nothing came through it, and four of them reconnected at once.
//
// One link per engine url per page, shared by whoever asks: messages are parsed once and handed to every listener;
// `onLink` says up or down, at once when asked and on every change, and a listener does its own hello on every up.
// Kept alive three ways:
//   the heartbeat: { type: "ping", at } after 15 s with nothing heard; the engine answers { type: "pong", at }. Anything
//     heard counts. Once this engine has answered a ping, a ping unanswered for 25 s is a dead socket: it is dropped
//     and a new one opened.
//     (An engine from before the pong never answers: then only the browser's own close counts, as it always did.)
//   the wake: the page waking (visibilitychange, focus, online), or the page's clock jumping (a sleep stops timers),
//     sends a ping at once; no word within 4 s and the socket is replaced, no backoff.
//   the connect timeout: a socket still opening after 8 s is given up (a stopped engine accepts the connection and
//     never answers it).
// A dropped socket is replaced after 1, 1.5, 2.5, 4, then every 5 s; a wake skips the wait. PROTOCOL.md, round 15.
// Part of the fence: the seat never edits this file (home/CLAUDE.md).

export type Link = {
  send: (o: object) => boolean;                          // false when the socket is not open (nothing is queued)
  on: (f: (m: any) => void) => () => void;               // every message from the engine
  onLink: (f: (up: boolean) => void) => () => void;      // called at once with the state, then on every up and down
  up: () => boolean;
  wake: (why: string) => void;                           // check now: a word back within PROBE_MS, or a new socket
};

const BEAT_MS = 15_000, DEAD_MS = 40_000, PROBE_MS = 4_000, CONNECT_MS = 8_000, TICK_MS = 5_000, JUMP_MS = 15_000;
const BACKOFF = [1000, 1500, 2500, 4000, 5000];

const links = new Map<string, Link & { close: () => void }>();

export function link(url: string): Link {
  const had = links.get(url);
  if (had) return had;
  const msgSubs = new Set<(m: any) => void>();
  const linkSubs = new Set<(up: boolean) => void>();
  let ws: WebSocket | null = null;
  let isUp = false, alive = true, tries = 0, heard = 0, pinged = 0, answers = false;
  let retry: number | undefined, opening: number | undefined, probe: number | undefined;
  const log = (s: string) => console.info(`[sol link] ${s}`);
  const tell = (up: boolean) => { if (up === isUp) return; isUp = up; for (const f of [...linkSubs]) f(up); };
  const raw = (o: object) => { if (ws?.readyState !== 1) return false; ws.send(JSON.stringify(o)); return true; };

  // let go of a socket for good: no handler of it fires again, whatever it does next
  const drop = (why: string) => {
    const s = ws; ws = null;
    window.clearTimeout(opening); window.clearTimeout(probe);
    if (s) { s.onopen = s.onclose = s.onmessage = s.onerror = null; try { s.close(); } catch { /* already */ } }
    if (why) log(`dropped (${why})`);
    tell(false);
  };
  const later = () => {
    window.clearTimeout(retry);
    if (!alive) return;
    retry = window.setTimeout(connect, BACKOFF[Math.min(tries, BACKOFF.length - 1)]);
    tries++;
  };
  function connect() {
    window.clearTimeout(retry);
    if (!alive || ws) return;
    let s: WebSocket;
    try { s = new WebSocket(url); } catch { later(); return; }
    ws = s; answers = false;
    opening = window.setTimeout(() => { if (ws === s && s.readyState === 0) { drop("no answer while opening"); later(); } }, CONNECT_MS);
    s.onopen = () => {
      window.clearTimeout(opening);
      heard = Date.now(); tries = 0;
      tell(true);
      raw({ type: "ping", at: heard });   // learns at once whether this engine answers pings
    };
    s.onclose = () => { if (ws !== s) return; ws = null; window.clearTimeout(opening); window.clearTimeout(probe); tell(false); later(); };
    s.onmessage = (ev) => {
      if (ws !== s || typeof ev.data !== "string") return;
      heard = Date.now();
      window.clearTimeout(probe);
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m?.type === "pong") { answers = true; return; }
      for (const f of [...msgSubs]) { try { f(m); } catch (err) { console.error(err); } }
    };
  }

  const wake = (why: string) => {
    if (!alive) return;
    if (!ws) { log(`wake (${why}): opening now`); tries = 0; connect(); return; }
    if (ws.readyState !== 1 || !answers) return;   // still opening (its own timeout), or an engine that never pongs
    const asked = Date.now();
    pinged = asked;
    raw({ type: "ping", at: asked });
    window.clearTimeout(probe);
    probe = window.setTimeout(() => { if (heard < asked) { drop(`wake (${why}): no word in ${PROBE_MS / 1000} s`); tries = 0; connect(); } }, PROBE_MS);
  };

  // the heartbeat, and the clock: a tick that comes far later than asked means the machine slept in between
  let lastTick = Date.now();
  const tick = window.setInterval(() => {
    const now = Date.now(), gap = now - lastTick;
    lastTick = now;
    if (gap > JUMP_MS) { wake(`clock jumped ${Math.round(gap / 1000)} s`); return; }
    if (ws?.readyState !== 1) return;
    // dead: a ping went out after the last word heard and has had its time (a hidden page's timers run late, so the
    // silence alone is not enough: the question must have been asked)
    if (answers && pinged > heard && now - pinged > DEAD_MS - BEAT_MS) { drop(`silent ${Math.round((now - heard) / 1000)} s`); tries = 0; connect(); return; }
    if (now - heard > BEAT_MS && pinged <= heard) { pinged = now; raw({ type: "ping", at: now }); }
  }, TICK_MS);
  let lastWake = 0;
  const woke = (why: string) => () => {
    if (why === "visible" && document.visibilityState !== "visible") return;
    if (Date.now() - lastWake < 2000) return;   // focus and visible arrive together
    lastWake = Date.now();
    wake(why);
  };
  const onVisible = woke("visible"), onFocus = woke("focus"), onOnline = woke("online");
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);

  const l = {
    send: raw,
    on: (f: (m: any) => void) => { msgSubs.add(f); return () => { msgSubs.delete(f); }; },
    onLink: (f: (up: boolean) => void) => { linkSubs.add(f); f(isUp); return () => { linkSubs.delete(f); }; },
    up: () => isUp,
    wake,
    close: () => {
      alive = false;
      window.clearTimeout(retry); window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      drop("");
      links.delete(url);
    },
  };
  links.set(url, l);
  connect();
  return l;
}

// read-only, for a look from outside (the tests, the devtools): which links this page holds and whether they are up
if (typeof window !== "undefined") (window as unknown as { __solLinks?: () => Record<string, boolean> }).__solLinks = () => Object.fromEntries([...links].map(([u, l]) => [u, l.up()]));
// this module hot-reloaded (it is in the fence, so only by hand): the old sockets go before the new module opens its own
if (import.meta.hot) import.meta.hot.dispose(() => { for (const l of [...links.values()]) l.close(); });
