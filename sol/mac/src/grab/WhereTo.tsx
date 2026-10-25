// Where to? The picture folds up to a 260 px card at the top centre (from wherever it was: the markup's picture, or a
// thumb in the tray; CFG.glide) and the list unfolds under it row by row (70 ms apart, CFG.slide): a new session, the
// last six sessions (from `threads`, newest first), the tracker. ↑↓ slide a pearl light (slidePill), Return or a click
// picks; a small field under the list takes optional words (the tracker needs them: one line).
//
// Sending is the protocol that exists (SPEC "The wire"): a session is a `say` with the file; `say` has no answer of its
// own, so "sent" means the socket took it. The tracker is grab.hold (the engine holds the picture and, for a shelf
// thing, keeps the annotated one) then team.file, which answers with the issue's number. Then the receipt: the card
// flies up out of the top edge toward the notch with the bead riding it, the line says where it went with a check that
// draws itself, and the sheet goes 1.2 s later. A failure says so in plain words, stays, and the list stays to try again.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CFG, Spring, enter, growTo, slidePill } from "../motion";
import { BEAD, type Bead } from "./Bead";
import type { Rect } from "./Room";
import { age, ask, b64, fileMode, send, type FileIn, type Item, type Thread } from "./wire";

export type Out = { dataUrl: string; name: string; mime: string; image: boolean; item: Item | null; w: number; h: number };
type Row = { k: "new" } | { k: "session"; t: Thread } | { k: "tracker" };
const CARD = 260, TOP = 104;

export function WhereTo({ out, from, bead, threads, say, onSent, auto }: {
  out: Out; from: Rect | null; bead: Bead | null; threads: Thread[]; say: (t: string, check?: boolean) => void;
  onSent: () => void; auto?: number;
}) {
  const rows: Row[] = [{ k: "new" }, ...threads.slice(0, 6).map((t) => ({ k: "session" as const, t })), { k: "tracker" }];
  const [lit, setLit] = useState(0);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const ch = Math.round(CARD * (out.h / out.w || 0.7));
  const card = { x: Math.round(innerWidth / 2 - CARD / 2), y: TOP, w: CARD, h: Math.min(ch, 220) };
  const cardEl = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null), pill = useRef<HTMLDivElement>(null), field = useRef<HTMLInputElement>(null);
  const fold = useRef<Spring | null>(null), fly = useRef<Spring | null>(null), light = useRef<ReturnType<typeof slidePill> | null>(null);

  // the card: fold (from → card) and fly (card → up out of the top edge), composed on one transform
  const put = () => {
    const el = cardEl.current; if (!el) return;
    const p = fold.current?.v ?? 1, q = fly.current?.v ?? 0, f = from ?? { x: card.x, y: card.y + 30, w: card.w, h: card.h };
    const k0 = f.w / card.w, k = (k0 + (1 - k0) * p) * (1 - 0.7 * q);
    const tx = (f.x - card.x) * (1 - p) + q * (card.w * 0.35);
    const ty = (f.y - card.y) * (1 - p) - q * (card.y + card.h + 40) - 30 * Math.sin(Math.PI * q);
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${k}) rotate(${-3 * Math.sin(Math.PI * q)}deg)`;
  };
  useLayoutEffect(() => {
    say("Where to?");
    fold.current = new Spring(0, CFG.glide, put);
    fly.current = new Spring(0, { k: 150, z: 0.9 }, put);
    put(); fold.current.to(1);
    void bead?.hop(card.x - BEAD / 2 - 2, card.y - BEAD / 2 - 2, { lift: 18, ms: 620 }).then(() => bead?.look(0, 3));
    const l = list.current!;
    growTo(l, 0, CFG.fold);
    l.querySelectorAll<HTMLElement>(".where-row, .where-field").forEach((r, i) => enter(r, { y: 10, delay: 180 + i * 70, cfg: CFG.slide }));
    light.current = slidePill(l, pill.current!, { cfg: CFG.snap });
    window.setTimeout(() => field.current?.focus(), 60);
    return () => { fold.current?.stop(); fly.current?.stop(); light.current?.destroy(); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const r = list.current?.querySelectorAll<HTMLElement>(".where-row")[lit] ?? null;
    window.setTimeout(() => light.current?.to(r), 0);
  }, [lit, rows.length]);

  const pick = async (i: number) => {
    if (busy || sent) return;
    const row = rows[i]; setLit(i);
    const w = words.replace(/\s+/g, " ").trim();
    const file: FileIn = { name: out.name, mime: out.mime, dataBase64: b64(out.dataUrl) };
    const text = "Here is a picture of Sol." + (w ? " " + w : "");
    setBusy(true);
    let line = "";
    if (row.k === "tracker") {
      if (!w) { setBusy(false); say("The tracker needs a line of words: type it below."); field.current?.focus(); return; }
      if (!out.image) { setBusy(false); say("The tracker takes pictures only."); return; }
      say("Filing…");
      const h = await ask<{ shot?: string }>("grab.hold", { image: file, ...(out.item ? { id: out.item.id } : {}) }, 20_000);
      if (h.error || !h.shot) { setBusy(false); say(`Could not hold the picture: ${h.error ?? "no answer"}`); return; }
      const r = await ask<{ number?: number }>("team.file", { mode: fileMode(), words: w, page: "grab", conversation: "", shot: h.shot }, 60_000);
      if (r.error || !r.number) { setBusy(false); say(`Could not file it: ${r.error ?? "GitHub did not say the number"}`); return; }
      line = `Filed #${r.number}.`;
    } else {
      const ok = row.k === "new"
        ? send({ type: "say", text, files: [file], door: "notch", fresh: true })
        : send({ type: "say", text, files: [file], seat: row.t.seat, sessionId: row.t.sessionId });
      if (!ok) { setBusy(false); say("Sol is not connected, so nothing went."); return; }
      line = row.k === "new" ? "Sent to a new session." : `Sent to ${row.t.title || "untitled"}.`;
    }
    // the receipt
    setSent(true);
    say(line, true);
    fly.current?.to(1);
    // the list slides down off the screen (no fade) while the card flies up
    const l = list.current; if (l) new Spring(0, CFG.away, (v) => { l.style.translate = `-50% ${v}px`; }).to(innerHeight - l.offsetTop + 40);
    void bead?.hop(innerWidth / 2 - BEAD / 2, -BEAD - 30, { lift: 50, ms: 640 });
    window.setTimeout(onSent, 1200);
  };
  const pickRef = useRef(pick); pickRef.current = pick;
  useEffect(() => {
    if (auto == null) return;
    const t = window.setTimeout(() => void pickRef.current(auto), 1100);
    return () => window.clearTimeout(t);
  }, [auto]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setLit((i) => Math.min(rows.length - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setLit((i) => Math.max(0, i - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); void pickRef.current(lit); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [lit, rows.length]);

  const tracker = rows[lit]?.k === "tracker";
  return (
    <div className="where">
      <div className={`card${sent ? " sent" : ""}`} ref={cardEl} style={{ left: card.x, top: card.y, width: card.w, height: card.h }}>
        {out.image ? <img src={out.dataUrl} alt="" draggable={false} /> : <div className="card-file"><span>{out.name}</span></div>}
      </div>
      <div className="where-list" ref={list} style={{ top: card.y + card.h + 18 }}>
        <div className="where-head">where to?</div>
        <div className="where-light" ref={pill} />
        {rows.map((r, i) => (
          <div key={r.k === "session" ? r.t.sessionId : r.k} className={`where-row${i === lit ? " on" : ""}`} data-press
            onPointerEnter={() => !sent && setLit(i)} onClick={() => void pick(i)}>
            {r.k === "new" ? <><span className="glyph">▸</span><span className="name">New session</span><span className="age">starts with the picture</span></>
              : r.k === "tracker" ? <><span className="glyph">■</span><span className="name">The tracker</span><span className="age">files an issue</span></>
              : <><span className="glyph dot" /><span className="name">{r.t.title || "untitled"}</span><span className="age">{age(r.t.updatedAt ?? r.t.at)}</span></>}
          </div>
        ))}
        <div className="where-field">
          <input ref={field} value={words} onChange={(e) => setWords(e.target.value)} disabled={busy || sent} spellCheck={false}
            placeholder={tracker ? "one line for the issue (needed)" : "a few words to go with it (optional)"} />
        </div>
      </div>
    </div>
  );
}
