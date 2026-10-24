// The browser tool. One headless Chromium owned by the engine (nothing opens on Marco's screen), with a
// persistent profile in home/browser-profile/ so logins (learn.bu.edu and the like) stay. Launched on first
// use, reused after. Tabs belong to conversations (sessionId); the face watches them as CDP screencast
// frames and can click and type into them. Both seats get the same tools as an MCP server named "sol":
// Claude in-process, Codex through src/mcp-stdio.ts, which calls POST /browser on the engine.

import { chromium, type BrowserContext, type Page, type CDPSession, type Frame } from "playwright";
import { z } from "zod";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type ToolResult = {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError?: boolean;
};

const READ_CAP = 30_000;
const VIEW = { width: 1280, height: 900 }; // a new tab's size until the face says how big its stage is (resizeTab)
// Device pixels per CSS px, fixed at launch: the faces are Retina, so a page is rendered sharp. Both the context and
// the headless screen are told (the screencast captures the screen's surface: with the flag alone it would be 1x).
const SCALE = 2;
const QUALITY = 50; // the JPEG the face is shown
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

// One step of a seat's work as the face shows it (sol/PROTOCOL.md, round 3). The browser reports "browse" steps, the desk "desk" steps.
export type Step = { id: string; kind: "browse" | "desk"; text: string; done: boolean; ok?: boolean; detail?: string };
// Who is calling a tool: the conversation it belongs to, and where its "what I'm doing" steps go.
export type TurnCtx = { sessionId?: string; seat?: string; sink?: (step: Step) => void };   // seat: who pings (ping.ts)

// view: the page's size in CSS px, what the face maps its clicks through; a frame is view × SCALE pixels.
type Tab = { id: string; sessionId?: string; page: Page; title: string; url: string; cdp?: CDPSession; view: { width: number; height: number } };
export type Face = { send: (msg: object) => void };

let profileDir = "";
let ctx: BrowserContext | null = null;
let launching: Promise<BrowserContext> | null = null;
let queue: Promise<unknown> = Promise.resolve(); // one browser action at a time
let nextId = 1;
const tabs = new Map<string, Tab>();
const byPage = new Map<Page, Tab>();
const activeOf = new Map<string, string>(); // sessionId ("" = none) -> active tab id
const faces = new Set<Face>();
const watching = new Map<Face, string>(); // face -> tab id it watches
let pendingSession: string | undefined; // set while we create a page ourselves

export function setBrowserProfile(dir: string) {
  profileDir = dir;
}
export function addFace(f: Face) {
  faces.add(f);
  f.send(tabsMsg());
}
export function removeFace(f: Face) {
  faces.delete(f);
  void watch(f, null);
}

const key = (s?: string) => s ?? "";
function tabsMsg() {
  return {
    type: "tabs",
    tabs: [...tabs.values()].map((t) => ({
      id: t.id, sessionId: t.sessionId, title: t.title, url: t.url, active: activeOf.get(key(t.sessionId)) === t.id,
    })),
  };
}
function broadcast() {
  const m = tabsMsg();
  for (const f of faces) f.send(m);
}

function register(p: Page, sessionId?: string): Tab {
  const have = byPage.get(p);
  if (have) return have;
  const opener = byPage.get(p.opener() as any);
  const sid = sessionId ?? pendingSession ?? opener?.sessionId;
  const tab: Tab = { id: "t" + nextId++, sessionId: sid, page: p, title: "", url: p.url() === "about:blank" ? "" : p.url(), view: { ...VIEW } };
  tabs.set(tab.id, tab);
  byPage.set(p, tab);
  activeOf.set(key(sid), tab.id);
  const refresh = async () => {
    if (p.isClosed()) return;
    const title = await p.title().catch(() => tab.title);
    const url = p.url() === "about:blank" ? "" : p.url();
    if (title !== tab.title || url !== tab.url) {
      tab.title = title;
      tab.url = url;
      broadcast();
    }
  };
  p.on("framenavigated", (f) => f === p.mainFrame() && void refresh());
  p.on("domcontentloaded", () => void refresh());
  p.on("load", () => void refresh());
  p.on("close", () => {
    void stopScreencast(tab);
    tabs.delete(tab.id);
    wanted.delete(tab.id); sizing.delete(tab.id);
    byPage.delete(p);
    for (const [f, id] of watching) if (id === tab.id) watching.delete(f);
    if (activeOf.get(key(tab.sessionId)) === tab.id) {
      const rest = [...tabs.values()].filter((t) => t.sessionId === tab.sessionId);
      if (rest.length) activeOf.set(key(tab.sessionId), rest[rest.length - 1].id);
      else activeOf.delete(key(tab.sessionId));
    }
    broadcast();
  });
  broadcast();
  return tab;
}

async function context(): Promise<BrowserContext> {
  if (ctx) return ctx;
  launching ??= chromium
    .launchPersistentContext(profileDir, { headless: true, viewport: VIEW, deviceScaleFactor: SCALE, args: ["--no-first-run", `--force-device-scale-factor=${SCALE}`] })
    .then((c) => {
      ctx = c;
      c.on("page", (p) => register(p)); // popups join their opener's conversation
      c.on("close", () => {
        ctx = null;
        launching = null;
        tabs.clear();
        byPage.clear();
        activeOf.clear();
        watching.clear();
        broadcast();
      });
      return c;
    });
  return launching;
}

async function newTab(sessionId?: string): Promise<Tab> {
  const c = await context();
  pendingSession = sessionId;
  try {
    const p = await c.newPage();
    return register(p, sessionId);
  } finally {
    pendingSession = undefined;
  }
}

function activeTab(sessionId?: string): Tab | undefined {
  const t = tabs.get(activeOf.get(key(sessionId)) ?? "");
  return t && !t.page.isClosed() ? t : undefined;
}

// ---- frames and input, for the face ----

async function stopScreencast(tab: Tab) {
  const cdp = tab.cdp;
  tab.cdp = undefined;
  if (!cdp) return;
  await cdp.send("Page.stopScreencast").catch(() => {});
  await cdp.detach().catch(() => {});
}

async function startScreencast(tab: Tab) {
  if (tab.cdp || tab.page.isClosed()) return;
  const cdp = await (await context()).newCDPSession(tab.page);
  tab.cdp = cdp;
  cdp.on("Page.screencastFrame", (ev: any) => {
    emitFrame(tab, ev.data);
    // Chromium holds the next frame until this ack, which is all the backpressure we need: nothing is dropped,
    // so the last state after a scroll or click always reaches the face.
    void cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", screencastArgs(tab));
  await still(tab);
}

const screencastArgs = (tab: Tab) => ({ format: "jpeg" as const, quality: QUALITY, maxWidth: tab.view.width * SCALE, maxHeight: tab.view.height * SCALE, everyNthFrame: 1 });

// A still page sends no frames; give the face one right away.
async function still(tab: Tab) {
  const shot = await tab.page.screenshot({ type: "jpeg", quality: QUALITY }).catch(() => null);
  if (shot) emitFrame(tab, shot.toString("base64"));
}

// The face says how big its stage is; the tab takes that size, so the page fills the pane edge to edge instead of
// being letterboxed. Coordinates stay in CSS px (view). The screencast restarts: a running one keeps its old bounds.
// One resize at a time per tab: a second one arriving mid-way waits, then takes the size wanted last (two in flight
// could land in either order, leaving Chromium at one size and `view` at the other).
const wanted = new Map<string, { width: number; height: number }>();
const sizing = new Map<string, Promise<void>>();
export function resizeTab(id: string, w: number, h: number) {
  wanted.set(id, { width: Math.max(200, Math.round(w)), height: Math.max(150, Math.round(h)) });
  const next = (sizing.get(id) ?? Promise.resolve()).then(() => takeSize(id)).catch(() => {});
  sizing.set(id, next);
  return next;
}
async function takeSize(id: string) {
  const tab = tabs.get(id), size = wanted.get(id);
  if (!tab || !size || tab.page.isClosed()) return;
  if (tab.view.width === size.width && tab.view.height === size.height) return;
  tab.view = size;
  await tab.page.setViewportSize(size);
  const cdp = tab.cdp;
  if (!cdp) return;
  await cdp.send("Page.stopScreencast").catch(() => {});
  await cdp.send("Page.startScreencast", screencastArgs(tab)).catch(() => {});
  await still(tab);
}

function emitFrame(tab: Tab, data: string) {
  for (const [f, id] of watching) if (id === tab.id) f.send({ type: "frame", tab: tab.id, data, w: tab.view.width, h: tab.view.height });
}

export async function watch(face: Face, tabId: string | null) {
  const prev = watching.get(face);
  if (tabId && tabs.has(tabId)) watching.set(face, tabId);
  else watching.delete(face);
  const now = watching.get(face);
  if (prev && prev !== now && ![...watching.values()].includes(prev)) {
    const t = tabs.get(prev);
    if (t) await stopScreencast(t);
  }
  if (now) await startScreencast(tabs.get(now)!);
}

// A new conversation opens tabs under the face's draft id; once the seat names the session, they are its.
export function adoptTabs(from: string | undefined, to: string) {
  if (!from || from === to) return;
  let moved = false;
  for (const t of tabs.values()) if (t.sessionId === from) { t.sessionId = to; moved = true; }
  if (!moved) return;
  const act = activeOf.get(from);
  if (act) { activeOf.set(to, act); activeOf.delete(from); }
  broadcast();
}

export async function openTab(url: string, sessionId?: string) {
  const tab = await newTab(sessionId);
  if (url) await tab.page.goto(normUrl(url), { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
}
export async function closeTab(id: string) {
  await tabs.get(id)?.page.close().catch(() => {});
}
export function selectTab(id: string) {
  const t = tabs.get(id);
  if (!t) return;
  activeOf.set(key(t.sessionId), id);
  broadcast();
}
export async function navigateTab(id: string, action: "back" | "forward" | "reload" | { url: string }) {
  const p = tabs.get(id)?.page;
  if (!p) return;
  const o = { waitUntil: "domcontentloaded" as const, timeout: 30000 };
  if (action === "back") await p.goBack(o).catch(() => {});
  else if (action === "forward") await p.goForward(o).catch(() => {});
  else if (action === "reload") await p.reload(o).catch(() => {});
  else if (action && typeof action.url === "string") await p.goto(normUrl(action.url), o).catch(() => {});
}

// a page written in its address (data:, about:) is kept as it is too; the face's own field only ever adds https://
const normUrl = (u: string) => (/^([a-z]+:\/\/|data:|about:)/i.test(u) ? u : "https://" + u);

const VK: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, " ": 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
};

export async function inputTab(id: string, ev: any) {
  const tab = tabs.get(id);
  if (!tab || !ev) return;
  const cdp = tab.cdp ?? (await (await context()).newCDPSession(tab.page));
  const own = !tab.cdp;
  try {
    if (ev.kind === "mouse") {
      const type = ev.type as string;
      const pressing = type === "mousePressed" || type === "mouseReleased";
      const p: any = { type, x: Number(ev.x) || 0, y: Number(ev.y) || 0, button: ev.button ?? (pressing ? "left" : "none"), modifiers: ev.modifiers ?? 0 };
      if (pressing) p.clickCount = ev.clickCount ?? 1;
      if (type === "mouseWheel") Object.assign(p, { deltaX: Number(ev.deltaX) || 0, deltaY: Number(ev.deltaY) || 0 });
      await cdp.send("Input.dispatchMouseEvent", p);
    } else if (ev.kind === "key") {
      const k = String(ev.key ?? "");
      const vk = VK[k] ?? (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
      const p: any = { type: ev.type, key: k, code: ev.code, modifiers: ev.modifiers ?? 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      const t = ev.text ?? (k === "Enter" ? "\r" : undefined);
      if (t && ev.type !== "keyUp") p.text = t;
      await cdp.send("Input.dispatchKeyEvent", p);
    }
  } finally {
    if (own) await cdp.detach().catch(() => {});
  }
}

// Give a page a moment to settle after a click or navigation.
async function settle(p: Page) {
  await p.waitForLoadState("load", { timeout: 1500 }).catch(() => {});
  await p.waitForTimeout(100);
}

// ---- pointing inside a page, for Work's page pane (#54) ----
// An artifact on claude.ai is shown through the browser, and Marco pins comments inside it as he does on a page the
// session wrote: the face asks what is under a point (browser.inspect) and, after the page scrolls or changes, where
// the pinned elements are now (browser.locate). An artifact draws inside an iframe, so both look through frames.
// Both fail soft: a closed tab or a page mid-navigation answers nothing, a selector that finds nothing answers null.

export type PinBox = { x: number; y: number; w: number; h: number };
// One element on the way up from the one pointed at: its tag, id, classes, and its place among the siblings of its
// tag (0 when it is the only one). The page sends these; the selector is made here, where it can be tested.
export type Link = { tag: string; id: string; classes: string[]; nth: number };

export const cssEsc = (s: string) => s.replace(/[^\w-]/g, "\\$&").replace(/^(-?)(\d)/, "$1\\3$2 ");
// The selector the page pane gives a pin (mac/src/work/pages.ts, describe): up to three parts, stopping at an id,
// `section.hero > h2.title`; the body itself when the point is on nothing inside it.
export function describeChain(chain: Link[]): string {
  const parts: string[] = [];
  for (const l of chain) {
    if (l.tag === "body" || l.tag === "html" || parts.length >= 3) break;
    const t = cssEsc(l.tag);   // a tag with a colon (svg's, a custom one) would read as a pseudo-class
    const c = l.classes.find((x) => /^[a-z_][\w-]*$/i.test(x));
    parts.unshift(l.id ? `${t}#${cssEsc(l.id)}` : c ? `${t}.${cssEsc(c)}` : l.nth ? `${t}:nth-of-type(${l.nth})` : t);
    if (l.id) break;
  }
  return parts.join(" > ") || chain[0]?.tag || "body";
}
// The words at the spot, on one line, cut near 80 characters.
export function trimWords(s: string, max = 80): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

// Where an iframe's page starts in its parent's view: its box, past its border and padding.
const contentOrigin = (e: Element) => {
  const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  return { x: r.left + e.clientLeft + (parseFloat(s.paddingLeft) || 0), y: r.top + e.clientTop + (parseFloat(s.paddingTop) || 0) };
};

type Hit = { chain: Link[]; text: string; box: PinBox };
async function hitAt(frame: Frame, x: number, y: number, depth = 0): Promise<Hit | null> {
  const h = await frame.evaluateHandle(([x, y]) => document.elementFromPoint(x, y) ?? document.body, [x, y] as const);
  const el = h.asElement();
  try {
    if (!el) return null;
    const inner = depth < 3 ? await el.contentFrame() : null;
    if (inner) {   // the point is on a frame: what is under it in there, its box moved into this view
      const o = await el.evaluate(contentOrigin);
      const got = await hitAt(inner, x - o.x, y - o.y, depth + 1);
      if (got) return { ...got, box: { ...got.box, x: got.box.x + o.x, y: got.box.y + o.y } };
    }
    // the page runs this: plain loops and unnamed callbacks only (a named inner function would not survive the trip)
    return await el.evaluate((e) => {
      const chain: Link[] = [];
      for (let c: Element | null = e; c && chain.length < 8; c = c.parentElement) {
        const at = c, p = c.parentElement;
        const same = p ? Array.from(p.children).filter((x) => x.tagName === at.tagName) : [];
        chain.push({ tag: c.tagName.toLowerCase(), id: c.id, classes: Array.from(c.classList).slice(0, 8), nth: same.length > 1 ? same.indexOf(c) + 1 : 0 });
      }
      const tag = e.tagName.toLowerCase();
      const text = tag === "img" ? (e as HTMLImageElement).alt || (e.getAttribute("src") ?? "").split("/").pop() || ""
        : tag === "input" || tag === "textarea" ? (e as HTMLInputElement).value || (e as HTMLInputElement).placeholder || ""
        : (e as HTMLElement).innerText ?? e.textContent ?? "";
      const r = e.getBoundingClientRect();
      return { chain, text: text.slice(0, 400), box: { x: r.left, y: r.top, w: r.width, h: r.height } };
    });
  } finally {
    await h.dispose().catch(() => {});
  }
}

// Each selector's box in this frame's view, looking in the frames inside it first: an artifact's page is in one,
// and a short selector could also match something in claude.ai's own page around it.
async function boxesIn(frame: Frame, sels: string[], depth = 0): Promise<(PinBox | null)[]> {
  const out: (PinBox | null)[] = sels.map(() => null);
  if (depth < 3) {
    for (const h of await frame.$$("iframe, frame")) {
      try {
        const inner = await h.contentFrame();
        if (!inner) continue;
        const o = await h.evaluate(contentOrigin);
        const sub = await boxesIn(inner, sels, depth + 1);
        sub.forEach((b, i) => { if (!out[i] && b) out[i] = { ...b, x: b.x + o.x, y: b.y + o.y }; });
      } catch { /* a frame that went away */ } finally { await h.dispose().catch(() => {}); }
      if (out.every(Boolean)) return out;
    }
  }
  const own = await frame.evaluate((ss) => ss.map((s) => {
    try {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    } catch { return null; }
  }), sels);
  return out.map((b, i) => b ?? own[i]);
}

// browser.inspect { tab, x, y } (CSS px in the tab's view) -> browser.inspected { tab, x, y, sel, words, title, url, box }
export async function inspectTab(face: Face, m: any) {
  const tab = tabs.get(String(m.tab)), x = Number(m.x), y = Number(m.y);
  if (!tab || tab.page.isClosed() || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const hit = await hitAt(tab.page.mainFrame(), x, y).catch(() => null);
  if (!hit) return;
  // the page can go away or navigate between the hit and the answer: then there is no answer, as with a closed tab
  let title = tab.title, url = "";
  try { title = await tab.page.title(); url = tab.page.url(); } catch { return; }
  face.send({ type: "browser.inspected", ...(m.rid ? { rid: m.rid } : {}), tab: tab.id, x, y, sel: describeChain(hit.chain), words: trimWords(hit.text), title, url, box: hit.box });
}
// browser.locate { tab, sels } -> browser.located { tab, boxes }, null for a selector that finds nothing now
export async function locateTab(face: Face, m: any) {
  const tab = tabs.get(String(m.tab));
  const sels: string[] = Array.isArray(m.sels) ? m.sels.slice(0, 60).map(String) : [];
  if (!tab || tab.page.isClosed()) return;
  const boxes = await boxesIn(tab.page.mainFrame(), sels).catch(() => null);
  if (boxes) face.send({ type: "browser.located", ...(m.rid ? { rid: m.rid } : {}), tab: tab.id, boxes });
}

// Number the interactive things on the page. Marks each with data-sol-ref so browser_click can find it.
async function find(p: Page, query: string): Promise<string> {
  const items: { ref: number; role: string; name: string }[] = await p.evaluate((q: string) => {
    document.querySelectorAll("[data-sol-ref]").forEach((e) => e.removeAttribute("data-sol-ref"));
    const sel = 'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"],[role="option"],[onclick],[contenteditable="true"]';
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out: { ref: number; role: string; name: string }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === "hidden" || cs.display === "none") continue;
      const tag = el.tagName.toLowerCase();
      const type = (el as HTMLInputElement).type;
      const role = el.getAttribute("role") ?? (tag === "a" ? "link" : tag === "input" ? (type || "text") + " input" : tag);
      const name = (
        el.getAttribute("aria-label") || el.innerText || (el as HTMLInputElement).placeholder ||
        (el as HTMLInputElement).value || el.getAttribute("title") || el.getAttribute("alt") ||
        el.getAttribute("name") || ""
      ).replace(/\s+/g, " ").trim().slice(0, 80);
      const hay = (role + " " + name).toLowerCase();
      if (words.length && !words.every((w) => hay.includes(w))) continue;
      const ref = out.length + 1;
      el.setAttribute("data-sol-ref", String(ref));
      out.push({ ref, role, name });
      if (out.length >= 80) break;
    }
    return out;
  }, query);
  if (!items.length) return query ? `Nothing interactive matches "${query}". Try browser_read, or a shorter query.` : "No interactive elements found.";
  return items.map((i) => `${i.ref}. ${i.role}: ${i.name || "(no name)"}`).join("\n");
}

async function click(p: Page, args: { ref?: number; text?: string }): Promise<string> {
  if (args.ref != null) {
    const loc = p.locator(`[data-sol-ref="${args.ref}"]`).first();
    if (!(await loc.count())) return `Ref ${args.ref} is not on the page any more. Run browser_find again.`;
    await loc.click({ timeout: 8000 });
  } else if (args.text) {
    const byText = p.getByText(args.text, { exact: false }).first();
    if (await byText.count()) await byText.click({ timeout: 8000 });
    else await p.getByRole("button", { name: args.text }).or(p.getByRole("link", { name: args.text })).first().click({ timeout: 8000 });
  } else return "Give a ref (from browser_find) or the visible text to click.";
  await settle(p);
  return `Clicked. Now at ${p.url()}`;
}

// ---- the tools, defined once; Claude's in-process server and the stdio server both use this list ----

export type Tool = {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  line: (a: any) => string; // the dim line for the face
  run: (p: Page, a: any) => Promise<ToolResult>;
};

function host(u: string): string {
  try {
    return new URL(u.includes("://") ? u : "https://" + u).host;
  } catch {
    return u.slice(0, 40);
  }
}

export const TOOLS: Tool[] = [
  {
    name: "browser_open",
    description: "Open a web page in this conversation's browser tab (Marco sees it inside Sol; his logins are kept). Returns the title and address.",
    shape: { url: z.string().describe("Address, e.g. https://learn.bu.edu") },
    line: (a) => `opening ${host(a.url)}`,
    run: async (p, a) => {
      const url = /^[a-z]+:\/\//i.test(a.url) ? a.url : "https://" + a.url;
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(p);
      return text(`Opened ${p.url()}\nTitle: ${await p.title()}`);
    },
  },
  {
    name: "browser_read",
    description: "Read the visible text of the current page (capped at about 30,000 characters).",
    shape: {},
    line: () => "reading the page",
    run: async (p) => {
      const body = await p.evaluate(() => document.body?.innerText ?? "");
      const clipped = body.length > READ_CAP ? body.slice(0, READ_CAP) + "\n[cut: page is longer]" : body;
      return text(`${p.url()}\n${await p.title()}\n\n${clipped}`);
    },
  },
  {
    name: "browser_find",
    description: "List numbered interactive elements (links, buttons, fields) on the page, optionally filtered by words. Use the number with browser_click or browser_type.",
    shape: { query: z.string().optional().describe("Words that must appear in the role or name; empty lists everything") },
    line: (a) => (a.query ? `looking for ${String(a.query).slice(0, 40)}` : "looking at the page controls"),
    run: async (p, a) => text(await find(p, a.query ?? "")),
  },
  {
    name: "browser_click",
    description: "Click something: a ref number from the last browser_find, or its visible text.",
    shape: { ref: z.number().optional(), text: z.string().optional() },
    line: (a) => (a.text ? `clicking "${String(a.text).slice(0, 40)}"` : `clicking #${a.ref}`),
    run: async (p, a) => text(await click(p, a)),
  },
  {
    name: "browser_type",
    description: "Type text into the focused field (or into the element with the given ref); submit presses Enter after.",
    shape: { text: z.string(), ref: z.number().optional(), submit: z.boolean().optional() },
    line: () => "typing",
    run: async (p, a) => {
      if (a.ref != null) {
        const loc = p.locator(`[data-sol-ref="${a.ref}"]`).first();
        if (!(await loc.count())) return text(`Ref ${a.ref} is not on the page any more. Run browser_find again.`);
        await loc.fill(a.text, { timeout: 8000 });
      } else await p.keyboard.type(a.text);
      if (a.submit) {
        await p.keyboard.press("Enter");
        await settle(p);
      }
      return text(`Typed${a.submit ? " and pressed Enter" : ""}. Now at ${p.url()}`);
    },
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the current page and return it as an image.",
    shape: {},
    line: () => "taking a screenshot",
    run: async (p) => {
      const jpg = await p.screenshot({ type: "jpeg", quality: 70 });
      return { content: [{ type: "image", data: jpg.toString("base64"), mimeType: "image/jpeg" }] };
    },
  },
  {
    name: "browser_back",
    description: "Go back one page.",
    shape: {},
    line: () => "going back",
    run: async (p) => {
      await p.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      await settle(p);
      return text(`Back at ${p.url()}`);
    },
  },
];

// Run one tool by name, for one conversation. Serialized, tells the face what is happening, never throws.
// browser_open uses the conversation's active tab, or opens one if it has none; the others need a tab.
export function runBrowserTool(name: string, args: unknown, turn: TurnCtx = {}): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return Promise.resolve({ ...text(`Unknown browser tool: ${name}`), isError: true });
  const job = queue.then(async (): Promise<ToolResult> => {
    const a = (args ?? {}) as any;
    const id = randomUUID();
    const line = tool.line(a);
    turn.sink?.({ id, kind: "browse", text: line, done: false });
    let r: ToolResult;
    try {
      let tab = activeTab(turn.sessionId);
      if (!tab && name !== "browser_open") r = { ...text("No page is open in this conversation. Use browser_open first."), isError: true };
      else r = await tool.run((tab ?? (await newTab(turn.sessionId))).page, a);
    } catch (err) {
      r = { ...text(`Browser error: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`), isError: true };
    }
    const first = r.content.find((c) => c.type === "text") as { text: string } | undefined;
    turn.sink?.({ id, kind: "browse", text: line, done: true, ok: !r.isError, detail: r.isError ? first?.text : undefined });
    return r;
  });
  queue = job.catch(() => {});
  return job;
}

export async function closeBrowser() {
  await ctx?.close().catch(() => {});
}

export const browserProfileDir = (home: string) => join(home, "browser-profile");
