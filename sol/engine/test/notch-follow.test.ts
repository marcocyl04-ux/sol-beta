// The follow's release rules (notch buttons #6, step 4) on a fake scroller: no browser, no test runner in mac/.
// Moved here from design/notch-buttons/shots/ (polish two) so `npm test` runs it with the rest.
import { test } from "node:test";
import assert from "node:assert/strict";

type H = (e: any) => void;
const ros: { cb: () => void; el: unknown }[] = [];
(globalThis as any).ResizeObserver = class { constructor(public cb: () => void) {} observe(el: unknown) { ros.push({ cb: this.cb, el }); } disconnect() {} };
(globalThis as any).requestAnimationFrame = (f: (t: number) => void) => setTimeout(() => f(performance.now()), 16) as unknown as number;
const docH: Record<string, H[]> = {};
(globalThis as any).document = { body: {}, documentElement: {}, addEventListener: (t: string, f: H) => { (docH[t] ??= []).push(f); }, removeEventListener() {} };

function fakeScroller(view = 400) {
  const h: Record<string, H[]> = {};
  let top = 0, content = view;
  const queued: number[] = [];
  const el = {
    clientHeight: view,
    get scrollHeight() { return content; },
    get scrollTop() { return top; },
    set scrollTop(v: number) { const n = Math.max(0, Math.min(content - view, Math.round(v))); if (n !== top) { top = n; queued.push(n); } },
    addEventListener: (t: string, f: H) => { (h[t] ??= []).push(f); },
    removeEventListener() {},
    contains: (n: unknown) => n === el,
    fire(t: string, e: any = {}) { for (const f of h[t] ?? []) f({ target: el, ...e }); },
    /** the browser delivers the scroll events of what moved since the last frame */
    flush() { if (queued.length) { queued.length = 0; el.fire("scroll"); } },
    grow(px: number) { content += px; if (top > content - view) top = Math.max(0, content - view), queued.push(top); for (const r of ros) if (r.el !== el) r.cb(); },
    hand(to: number) { el.scrollTop = to; el.flush(); },
  };
  return el;
}
const frames = (n: number, s: ReturnType<typeof fakeScroller>) => new Promise<void>((ok) => {
  let i = 0; const t = setInterval(() => { s.flush(); if (++i >= n) { clearInterval(t); ok(); } }, 16);
});

const { follow } = await import("../../mac/src/motion.ts");

test("stuck: the spring follows the growth down, its own scroll events do not release it", async () => {
  ros.length = 0; const s = fakeScroller(); const f = follow(s as any, {} as any);
  s.grow(2000); await frames(80, s);
  assert.equal(f.isStuck(), true);
  assert.ok(s.scrollHeight - s.clientHeight - s.scrollTop <= 1, `at the end, ${s.scrollTop}`);
  f.destroy();
});

test("an upward scroll of a few pixels while it streams releases at once and is never pulled back", async () => {
  ros.length = 0; const s = fakeScroller(); const f = follow(s as any, {} as any);
  s.grow(2000); await frames(80, s);
  const end = s.scrollTop;
  s.hand(end - 5);                              // 5 px: the old rule (within 60 px) pulled this back
  assert.equal(f.isStuck(), false);
  s.grow(600); await frames(60, s);              // the answer keeps growing
  assert.equal(s.scrollTop, end - 5, "nothing pulled him back");
  assert.deepEqual(f.state(), { stuck: false, away: true, fresh: true });
  f.destroy();
});

test("his scroll landing in the same tick as a spring frame still releases (by value, no flag)", async () => {
  ros.length = 0; const s = fakeScroller(); const f = follow(s as any, {} as any);
  s.grow(2000); await frames(80, s);
  s.grow(300);                                   // the spring starts down
  await frames(3, s);
  const was = s.scrollTop;
  s.scrollTop = was - 40;                        // his move and a spring write queued before one scroll event
  s.flush();
  assert.equal(f.isStuck(), false);
  const at = s.scrollTop; await frames(40, s);
  assert.equal(s.scrollTop, at, "the spring stopped dead");
  f.destroy();
});

test("the browser clamping at the end (content shrank) is not his: it stays stuck", async () => {
  ros.length = 0; const s = fakeScroller(); const f = follow(s as any, {} as any);
  s.grow(2000); await frames(80, s);
  s.grow(-200); s.flush();
  assert.equal(f.isStuck(), true);
  f.destroy();
});

test("wheel, touch, a press on the bar and a scroll key release; back at the end it sticks again, the dot goes", async () => {
  for (const how of ["wheel", "touchstart", "pointerdown", "key"]) {
    ros.length = 0; const s = fakeScroller(); const f = follow(s as any, {} as any);
    s.grow(2000); await frames(80, s);
    if (how === "key") for (const k of docH.keydown ?? []) k({ key: "PageUp", target: (globalThis as any).document.body });
    else s.fire(how);
    assert.equal(f.isStuck(), false, how);
    s.hand(s.scrollTop - 300); s.grow(100);
    assert.equal(f.state().fresh, true, how);
    s.hand(s.scrollHeight - s.clientHeight);       // he scrolls back down to the end
    assert.equal(f.isStuck(), true, how);
    assert.equal(f.state().fresh, false, how);
    f.destroy();
  }
});

test("a key typed in the box does not release", async () => {
  ros.length = 0; const s = fakeScroller(); const f = follow(s as any, {} as any);
  s.grow(2000); await frames(80, s);
  for (const k of docH.keydown ?? []) k({ key: "ArrowUp", target: { tagName: "TEXTAREA" } });
  assert.equal(f.isStuck(), true);
  f.destroy();
});

test("glide (the orb, a send) goes back to the end and sticks", async () => {
  ros.length = 0; const s = fakeScroller(); const f = follow(s as any, {} as any);
  s.grow(2000); await frames(80, s);
  s.hand(200);
  assert.equal(f.isStuck(), false);
  f.glide(); await frames(90, s);
  assert.equal(f.isStuck(), true);
  assert.ok(s.scrollHeight - s.clientHeight - s.scrollTop <= 1);
  f.destroy();
});
