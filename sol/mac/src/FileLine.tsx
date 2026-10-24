// File it (#119): the window's half. The press is the button file-it (buttons/file-it.tsx); FileLine is the line over the composer, in the new-stable line's look (cowork/StableLine.tsx)
// with the Pass field's input (cowork/Hands.tsx): while the shot is taken it says so, then one line of words, Return
// files it, Escape keeps it; the receipt "filed #120" stays a while with Open. The store is fileit.ts.
import { useEffect, useRef, useState } from "react";
import { composing } from "./ime";
import { begin, cancel, clear, file, takeAsk, useFile, type FileMode } from "./fileit";
import "./cowork/ship.css";
import "./cowork/hands.css";
import "./fileit.css";

const openUrl = (url: string) => { import("@tauri-apps/plugin-opener").then((o) => o.openUrl(url)).catch(() => window.open(url, "_blank")); };
const NAME: Record<FileMode, string> = { life: "Home", work: "Home", cowork: "Cowork" };
const RECEIPT_MS = 12_000;

/** over the composer: the field while open, the receipt after. mode: the tracker label, from the talk showing (a chat is
 * `life`, a session `work`, Cowork's `cowork`), never from a kept key */
export function FileLine({ page, conversation, mode: m }: { page: string; conversation?: string | null; mode: FileMode }) {
  const f = useFile();
  const [words, setWords] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { takeAsk(); }, []);   // the notch's File it, pressed while this page was not showing
  useEffect(() => { if (f.open && !f.shooting) requestAnimationFrame(() => field.current?.focus()); if (!f.open) setWords(""); }, [f.open, f.shooting, f.at]);
  useEffect(() => { if (!f.said?.number) return; const t = window.setTimeout(clear, RECEIPT_MS); return () => window.clearTimeout(t); }, [f.said?.number]);
  if (!f.open && !f.said && !f.filing) return null;
  const send = () => void file(words, { page, conversation }, m);
  if (f.open && !f.filing) return (
    <div className={`sline fileit ${f.shooting ? "busy" : ""}`} role="group" aria-label="file it">
      {f.shooting ? <span className="what"><i />taking the window's picture…</span> : (
        <span className="hpass">
          <input ref={field} value={words} maxLength={280}
            placeholder={`${f.said?.failed ? `${f.said.text}; ` : ""}what is wrong, in one line · ${NAME[m]}`}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !composing(e)) { e.preventDefault(); send(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } }} />
        </span>
      )}
      <span className="moves">
        <button className="first" disabled={f.shooting || !words.trim()} onClick={send} title={`an issue labelled ${m}, signed as your agent`}>file it</button>
        <button onClick={cancel}>keep it</button>
      </span>
    </div>
  );
  const s = f.said;
  const cls = f.filing ? "busy" : s?.failed ? "failed" : "done";
  return (
    <div className={`sline fileit ${cls}`} role="status">
      <span className="what"><i />{f.filing || !s?.number ? (s?.text ?? "filing…") : <>filed <b>#{s.number}</b> · {m}</>}</span>
      {!f.filing && (
        <span className="moves">
          {s?.url && <button className="first" onClick={() => { openUrl(s.url!); clear(); }} title="the issue on GitHub">Open</button>}
          {s?.failed && <button className="first" onClick={() => void begin()}>again</button>}
          <button onClick={clear}>ok</button>
        </span>
      )}
    </div>
  );
}
