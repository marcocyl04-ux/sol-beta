import type { Item } from "./useWork";

// The pages a session wrote (#54): an HTML file it named in a Write or an Edit (or handed to the Artifact tool), and
// an artifact link it gave. Drawn from the talk's items, so a session's history and its live turn look alike. Also how
// a spot on such a page is named (describe, wordsOf, lineOf); the engine names a spot in a browser tab the same way.
export type Page = { key: string; path?: string; url?: string; name: string; at: number; n: number };
const PAGE = /\.(html?|svg)$/i;
const LINK = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/g;
const WRITES = new Set(["Write", "Edit", "MultiEdit", "Artifact"]);

// an artifact on claude.ai: the pane shows it through Sol's browser, where Marco's claude.ai sign-in is kept
export const throughBrowser = (p: Page) => !p.path && !!p.url && /^https:\/\/claude\.ai\//.test(p.url);

export function pagesOf(items: Item[]): Page[] {
  const by = new Map<string, Page>();
  let seq = 0;
  const add = (key: string, p: { path?: string; url?: string; name: string; at: number }) => {
    const o = by.get(key);
    if (o) { o.at = Math.max(o.at, p.at); o.n++; } else by.set(key, { key, n: 1, ...p });
  };
  for (const it of items) {
    seq++;
    if (it.kind === "tool" && WRITES.has(String(it.name)) && it.done && it.ok !== false) {
      const p = String(it.input?.file_path ?? "");
      const at = Number(it.end ?? it.at ?? 0) || seq;
      if (p.startsWith("/") && PAGE.test(p)) add(p, { path: p, name: p.split("/").pop() ?? p, at });
      for (const u of String(it.out ?? "").match(LINK) ?? []) add(u, { url: u, name: "artifact", at });
    } else if (it.kind === "you" && typeof it.text === "string" && it.text.includes("claude.ai/")) {
      for (const u of it.text.match(LINK) ?? []) add(u, { url: u, name: "artifact", at: Number(it.at ?? 0) || seq });
    }
  }
  return [...by.values()];
}

// the page as the pane renders it: its own relative assets come from beside it through the engine
export function withBase(html: string, base: string): string {
  const tag = `<base href="${base.replace(/"/g, "&quot;")}">`;
  html = html.replace(/<base\b[^>]*>/gi, "");   // a base of the page's own would win (the first one counts)
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const root = /<html[^>]*>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + `<head>${tag}</head>` + html.slice(root.index + root[0].length);
  return tag + html;
}

// ---- naming a spot on the page ----
const esc = (s: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));
const part = (el: Element) => {
  const t = esc(el.tagName.toLowerCase());   // a tag with a colon (svg's, a custom one) would read as a pseudo-class
  if (el.id) return `${t}#${esc(el.id)}`;
  const c = [...el.classList].find((x) => /^[a-z_][\w-]*$/i.test(x));
  if (c) return `${t}.${esc(c)}`;
  const p = el.parentElement;
  if (p) { const same = [...p.children].filter((x) => x.tagName === el.tagName); if (same.length > 1) return `${t}:nth-of-type(${same.indexOf(el) + 1})`; }
  return t;
};
// a selector that names the element: up to three parts, stopping at an id (`section.hero > h2.title`)
export function describe(el: Element): string {
  const parts: string[] = [];
  let e: Element | null = el;
  while (e && e.tagName !== "BODY" && e.tagName !== "HTML" && parts.length < 3) { parts.unshift(part(e)); if (e.id) break; e = e.parentElement; }
  return parts.join(" > ") || el.tagName.toLowerCase();
}
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
// the words at the spot: the element's text (an image: its alt or file), cut at 70
export function wordsOf(el: Element): string {
  const t = el.tagName.toLowerCase();
  let s = "";
  if (t === "img") s = (el as HTMLImageElement).alt || ((el as HTMLImageElement).getAttribute("src") ?? "").split("/").pop() || "";
  else if (t === "input" || t === "textarea") s = (el as HTMLInputElement).value || (el as HTMLInputElement).placeholder || "";
  else s = (el as HTMLElement).innerText ?? el.textContent ?? "";   // innerText keeps a space between blocks
  s = squash(s);
  return s.length > 70 ? s.slice(0, 69).trimEnd() + "…" : s;
}
// the element's own first words (its direct text), as they may stand in the source
const firstText = (el: Element) => {
  for (const n of el.childNodes) if (n.nodeType === 3 && squash(n.textContent ?? "")) return squash(n.textContent ?? "");
  return "";
};
// the first words inside the element, however deep (a card: its heading's)
const deepText = (el: Element) => {
  const walk = el.ownerDocument.createTreeWalker(el, 4);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { const s = squash(n.textContent ?? ""); if (s) return s; }
  return "";
};
// the line of the source where the element starts: its id, else its own first words, else the words at the spot,
// else the first words inside it, else its opening tag (the nth one alike, as the element is the nth alike in the
// page); undefined when none of them is found as it stands in the file
export function lineOf(html: string, el: Element, words: string): number | undefined {
  const at = (i: number) => (i < 0 ? undefined : html.slice(0, i).split("\n").length);
  if (el.id) { const i = html.search(new RegExp(`\\bid=["']${el.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`)); if (i >= 0) return at(i); }
  const own = firstText(el);
  if (own.length >= 4) { const i = html.indexOf(own.slice(0, 32)); if (i >= 0) return at(i); }
  const w = words.replace(/…$/, "");
  if (w.length >= 4) { const i = html.indexOf(w.slice(0, 24)); if (i >= 0) return at(i); }
  const deep = deepText(el);
  if (deep.length >= 4) { const i = html.indexOf(deep.slice(0, 32)); if (i >= 0) return at(i); }
  const open = el.outerHTML.slice(0, el.outerHTML.indexOf(">") + 1);
  const m = /^<([\w-]+)\s+([\w-]+="[^"]*")/.exec(open);
  if (m) {
    const tag = `<${m[1]} ${m[2]}`;
    const alike = Array.from(el.ownerDocument.querySelectorAll(m[1])).filter((e) => e.outerHTML.startsWith(tag));
    let nth = Math.max(0, alike.indexOf(el)), i = -1;
    do i = html.indexOf(tag, i + 1); while (i >= 0 && nth-- > 0);
    if (i < 0) i = html.indexOf(m[2]);
    if (i >= 0) return at(i);
  }
  return undefined;
}
