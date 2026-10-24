// When a session last said something: the timestamp of its last user or assistant line, read from the tail of its
// transcript. The file's own time is not that: the Claude app writes bookkeeping lines (cost, last prompt, artifact
// monitors, a custom title) into the transcripts it holds open, so an idle session's file moves without a word said,
// and a list sorted by file time put five idle sessions above the live one (#45, 2026-10-20). Those lines carry no
// timestamp; a message does. The file time stays the fallback for a transcript with no message in it.
import { closeSync, openSync, readSync, statSync } from "node:fs";

const TAIL = 16 * 1024;            // the first look: a few messages, unless the last line is a huge tool result
const MOST = 4 * 1024 * 1024;      // and never more than this
const cache = new Map<string, { key: string; at: number }>();

/** the last message's time in the lines given (newest last), or 0 when none of them is a message */
export function lastSaidIn(text: string): number {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"timestamp"')) continue;
    try {
      const o = JSON.parse(line);
      if ((o?.type === "user" || o?.type === "assistant") && typeof o.timestamp === "string") {
        const t = Date.parse(o.timestamp);
        if (t) return t;
      }
    } catch { /* a cut line at the start of the tail, or not JSON */ }
  }
  return 0;
}

/** the time the session at `file` last said something; `fallback` (the file's own time) when it cannot be read or holds no message */
export function lastSaid(file: string, fallback: number): number {
  let st;
  try { st = statSync(file); } catch { return fallback; }
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.at;
  let at = 0;
  let fd: number | null = null;
  try {
    fd = openSync(file, "r");
    // read a tail, and a longer one while the tail holds no whole message line (a long line can be the last one)
    for (let want = TAIL; ; want *= 4) {
      const len = Math.min(want, st.size, MOST);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, st.size - len);
      at = lastSaidIn(buf.toString("utf8"));
      if (at || len >= st.size || len >= MOST) break;
    }
  } catch { at = 0; }
  finally { if (fd !== null) closeSync(fd); }
  const t = at || fallback;
  cache.set(file, { key, at: t });
  return t;
}

export const _resetSaid = () => cache.clear();
