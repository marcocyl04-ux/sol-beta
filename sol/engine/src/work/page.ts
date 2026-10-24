// A page the session wrote, shown in Work's page pane (#54). The pane reads the file over the wire (work.read) and
// renders it with <base href="http://<engine>/pane-asset/<its folder, encoded>/">, so the page's own relative
// assets (images, styles, scripts, fonts) come from beside it. Only files below that folder are served, and only
// of these kinds; a path that resolves outside it (a link, "..") is refused.
import { realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const ASSET: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

// "/pane-asset/<folder>/<rel>" → the folder (one encoded segment, an absolute path) and the relative path under it
export function assetOf(url: string): { dir: string; rel: string } | null {
  const m = /^\/pane-asset\/([^/?#]+)\/([^?#]*)/.exec(url);
  if (!m) return null;
  let dir: string, rel: string;
  try { dir = decodeURIComponent(m[1]); rel = decodeURIComponent(m[2]); } catch { return null; }
  if (!dir.startsWith("/") || !rel || rel.includes("\0") || dir.includes("\0")) return null;
  return { dir, rel };
}

// the real file for an asset, or null: it must stay below the page's folder and be a kind a page uses
export async function assetPath(dir: string, rel: string): Promise<{ real: string; mime: string } | null> {
  try {
    const root = await realpath(dir);
    const real = await realpath(join(root, rel));
    if (!real.startsWith(root + sep)) return null;
    const mime = ASSET[extname(real).toLowerCase()];
    if (!mime || !(await stat(real)).isFile()) return null;
    return { real, mime };
  } catch { return null; }
}

export async function servePaneAsset(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const fail = (code: number) => { res.writeHead(code); res.end(); };
  const at = assetOf(req.url ?? "");
  if (!at) return fail(400);
  const f = await assetPath(at.dir, at.rel);
  if (!f) return fail(404);
  res.writeHead(200, { "content-type": f.mime, "cache-control": "no-cache",
    ...(typeof req.headers.origin === "string" ? { "access-control-allow-origin": req.headers.origin, vary: "origin" } : {}) });
  createReadStream(f.real).pipe(res);
}
