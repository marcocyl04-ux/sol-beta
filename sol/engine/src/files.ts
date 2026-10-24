// Attachments: files Marco pastes or drops are saved in home/attachments/ and handed to the seat.
// Also the check behind GET /file, which serves a file only if it lives inside home/.

import { mkdir, writeFile, realpath, stat, access } from "node:fs/promises";
import { createReadStream, realpathSync } from "node:fs";
import { join, extname, sep, basename } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export type FileIn = { name: string; mime: string; dataBase64: string };
export type Saved = { name: string; path: string; mime: string; dataBase64: string; isImage: boolean };

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".json": "application/json", ".csv": "text/csv; charset=utf-8", ".html": "text/html; charset=utf-8",
};
// Image types both seats accept as real images.
const IMAGE_OK = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function safeName(name: string): string {
  const base = basename(String(name || "file")).replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").trim();
  return (base || "file").slice(-100);
}

// Save each file to <home>/attachments/<YYYY-MM-DD>-<safe name>. Never overwrites: a clash gets -2, -3, ...
export async function saveFiles(home: string, files: FileIn[]): Promise<Saved[]> {
  const dir = join(home, "attachments");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const day = new Date().toISOString().slice(0, 10);
  const out: Saved[] = [];
  for (const f of files) {
    const name = safeName(f.name);
    let path = join(dir, `${day}-${name}`);
    for (let n = 2; await access(path).then(() => true, () => false); n++) {
      const ext = extname(name);
      path = join(dir, `${day}-${name.slice(0, name.length - ext.length)}-${n}${ext}`);
    }
    await writeFile(path, Buffer.from(f.dataBase64, "base64"));
    const mime = f.mime || MIME[extname(name).toLowerCase()] || "application/octet-stream";
    out.push({ name, path, mime, dataBase64: f.dataBase64, isImage: IMAGE_OK.has(mime) });
  }
  return out;
}

// The "Attached: <path>" lines that go in the prompt (the thread reader turns them back into files).
export function attachedLines(saved: Saved[]): string {
  return saved.map((s) => `Attached: ${s.path}`).join("\n");
}

// GET /file?path=...  Serves only what resolves inside home/ (symlinks and ".." cannot escape).
// GET /pane-image?path=: the bytes of an image the file pane opened (work/panes.ts readText says `image`). Any absolute
// path the pane may read, image types only, over the loopback socket the faces already use.
export async function servePaneImage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const fail = (code: number) => { res.writeHead(code); res.end(); };
  try {
    const want = new URL(req.url ?? "", "http://x").searchParams.get("path");
    if (!want || !want.startsWith("/")) return fail(400);
    const real = await realpath(want);
    const mime = MIME[extname(real).toLowerCase()];
    if (!mime || !mime.startsWith("image/")) return fail(415);
    if (!(await stat(real)).isFile()) return fail(404);
    res.writeHead(200, { "content-type": mime, "cache-control": "no-cache",
      ...(typeof req.headers.origin === "string" ? { "access-control-allow-origin": req.headers.origin, vary: "origin" } : {}) });
    createReadStream(real).pipe(res);
  } catch { fail(404); }
}

export async function serveFile(home: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const fail = (code: number) => {
    res.writeHead(code);
    res.end();
  };
  try {
    const want = new URL(req.url ?? "", "http://x").searchParams.get("path");
    if (!want) return fail(400);
    const root = realpathSync(home);
    const real = await realpath(want.startsWith("/") ? want : join(root, want));
    if (real !== root && !real.startsWith(root + sep)) return fail(403);
    if (!(await stat(real)).isFile()) return fail(404);
    res.writeHead(200, {
      "content-type": MIME[extname(real).toLowerCase()] ?? "application/octet-stream",
      // only Sol's own pages reach this route (index.ts, solPage), so the answer is for the page that asked
      ...(typeof req.headers.origin === "string" ? { "access-control-allow-origin": req.headers.origin, vary: "origin" } : {}),
    });
    createReadStream(real).pipe(res);
  } catch {
    fail(404);
  }
}
