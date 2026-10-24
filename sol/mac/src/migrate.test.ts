// node --test src/*.test.ts (npm test here): the one-time move from Life and Work to Home (#132, migrate.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { homeChat, homeSession, migrate, readOpen, type Store } from "./migrate.ts";

const store = (init: Record<string, string>): Store & { m: Map<string, string> } => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const LIFE = { seat: "codex" as const, sessionId: "life-1" };
const kept = () => LIFE, none = () => null;

test("Work last, with its session: Home, that session open", () => {
  const s = store({ "sol.mode": "work", "sol.work.current": JSON.stringify("w-1") });
  assert.equal(migrate(s, kept), "home");
  assert.equal(s.m.get("sol.mode"), "home");
  assert.deepEqual(readOpen(s), { kind: "session", id: "w-1" });
});

test("Work last, no session: Home, a new session", () => {
  const s = store({ "sol.mode": "work" });
  assert.equal(migrate(s, kept), "home");
  assert.deepEqual(readOpen(s), { kind: "session", id: null });
});

test("Life last (its id was home), with a kept conversation: Home, that chat open on its seat", () => {
  const s = store({ "sol.mode": "home", "sol.work.current": JSON.stringify("w-1") });
  assert.equal(migrate(s, kept), "home");
  assert.deepEqual(readOpen(s), { kind: "chat", id: "life-1", seat: "codex" });
});

test("Life last, nothing kept: Home, a new chat; the old word life too", () => {
  for (const mode of ["home", "life"]) {
    const s = store({ "sol.mode": mode });
    assert.equal(migrate(s, none), "home");
    assert.equal(s.m.get("sol.mode"), "home");
    assert.deepEqual(readOpen(s), { kind: "chat", id: null });
  }
});

test("Cowork last stays Cowork; Home behind it opens Life's kept chat, with or without Work's session", () => {
  for (const extra of [{}, { "sol.work.current": JSON.stringify("w-1") }]) {
    const s = store({ "sol.mode": "cowork", ...extra });
    assert.equal(migrate(s, kept), "cowork");
    assert.equal(s.m.get("sol.mode"), "cowork");
    assert.deepEqual(readOpen(s), { kind: "chat", id: "life-1", seat: "codex" });
  }
});

test("a first start ever: Home, a new chat", () => {
  const s = store({});
  assert.equal(migrate(s, none), "home");
  assert.deepEqual(readOpen(s), { kind: "chat", id: null });
});

test("once: a second start keeps what Home wrote since", () => {
  const s = store({ "sol.mode": "work", "sol.work.current": JSON.stringify("w-1") });
  migrate(s, kept);
  s.setItem("sol.home.open", JSON.stringify({ kind: "chat", id: "life-2", seat: "claude" }));
  assert.equal(migrate(s, kept), "home");
  assert.deepEqual(readOpen(s), { kind: "chat", id: "life-2", seat: "claude" });
});

test("a broken kept talk reads as a new chat", () => {
  assert.deepEqual(readOpen(store({ "sol.home.open": "{nope" })), { kind: "chat", id: null });
  assert.deepEqual(readOpen(store({ "sol.home.open": JSON.stringify({ kind: "folder", id: 3 }) })), { kind: "chat", id: null });
});

test("a reload reads sol.home.open only: its session for useWork, its chat for useEngine", () => {
  const s = store({ "sol.mode": "work", "sol.work.current": JSON.stringify("w-1") });
  migrate(s, kept);
  assert.equal(homeSession(s), "w-1");
  assert.equal(homeChat(s), null);
  s.setItem("sol.work.current", JSON.stringify("w-stale"));
  s.setItem("sol.home.open", JSON.stringify({ kind: "chat", id: "life-2", seat: "claude" }));
  assert.equal(homeSession(s), null);
  assert.deepEqual(homeChat(s), { seat: "claude", sessionId: "life-2" });
  s.setItem("sol.home.open", JSON.stringify({ kind: "chat", id: null }));
  assert.equal(homeChat(s), null);
});
