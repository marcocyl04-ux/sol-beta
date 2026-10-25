// The notch's wire: the page's one link to the engine (socket.ts), the call (same mic and speaker code as the main face),
// Sol's last sentence, and the shelf (Grab and Shelf, #200): its things as the engine lists them
// (shelf.list on every up, then every shelf.items it sends after a change), a dropped file put on it (shelf.add), and
// a Shot (grab.shot: macOS's own crosshair, landing on the shelf). Asks carry a rid; the answer has the same type and
// rid, or an error. Modelled on away/useDoor.ts.
// The notch is a door (engine/src/doors.ts): its calls go to conversations of its own, never to the chat
// open in the main window, and it continues its last one when that spoke less than 20 minutes ago. It shows only
// what Sol says through it (Marco, 2026-10-14: the notch must not reflect what happens in a chat).
import { useCallback, useEffect, useRef, useState } from "react";
import { ENGINE, NEXT, sameEngine, type Card, type CallState, type FileOut } from "../useEngine";
import { openMic, Player, base64ToInt16, int16ToBase64, type Capture } from "../voice";
import { link, type Link } from "../socket";

const sentence = (s: string) => s.replace(/\s+/g, " ").trim();
/** a thing on the shelf (sol/README.md "Grab and Shelf"); `url` is the engine's /file address of it */
export type ShelfItem = { id: string; kind: "shot" | "sol" | "page" | "file"; name: string; mime: string; at: number | string; kept: boolean; url: string; w?: number; h?: number };
const SHOT_MS = 5 * 60_000, ADD_MS = 60_000;   // macOS's crosshair waits for Marco as long as he likes; five minutes is plenty

const readFile = (f: File): Promise<FileOut> =>
  new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => ok({ name: f.name || "pasted", mime: f.type || "application/octet-stream", dataBase64: String(r.result).split(",")[1] ?? "" });
    r.readAsDataURL(f);
  });

export function useNotch() {
  const [up, setUp] = useState(false);
  const [callState, setCallState] = useState<CallState>("off");
  const [said, setSaid] = useState("");
  const [working, setWorking] = useState(false);
  const [pin, setPin] = useState<Card | null>(null); // a card the desk pinned here (a timer, a flashcard, a score)
  const ws = useRef<Link | null>(null);
  const mic = useRef<Capture | null>(null);
  const player = useRef<Player | null>(null);
  const micCtx = useRef<AudioContext | null>(null);
  const callRef = useRef<CallState>("off");
  const sessionRef = useRef<string | undefined>(undefined);
  const upRef = useRef(false);
  const raw = useRef("");
  const texting = useRef(false);
  const setCall = (s: CallState) => { callRef.current = s; setCallState(s); };

  const send = useCallback((o: object) => { ws.current?.send(o); }, []);
  // ---- the shelf: its things, and the asks that wait for their answer by rid ----
  const [shelf, setShelf] = useState<ShelfItem[]>([]);
  const waits = useRef(new Map<string, (m: any) => void>());
  // grab.* and shelf.* are this Mac's (the screen, home/shelf), so they go to this Mac's engine even when the pick is
  // the NucBox; when the pick is this Mac it is the same socket (link() keeps one per address)
  const here = useRef<Link | null>(null);
  const ask = useCallback(<T extends object>(type: string, body: object, ms: number) => new Promise<Partial<T> & { error?: string }>((ok) => {
    const rid = `${type}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const t = window.setTimeout(() => { waits.current.delete(rid); ok({ error: "timeout" } as Partial<T> & { error?: string }); }, ms);
    waits.current.set(rid, (m) => { window.clearTimeout(t); ok(m); });
    if (!(here.current ?? ws.current)?.send({ type, rid, ...body })) { window.clearTimeout(t); waits.current.delete(rid); ok({ error: "offline" } as Partial<T> & { error?: string }); }
  }), []);

  const hangUpLocal = useCallback(() => {
    void mic.current?.stop(); mic.current = null;
    void player.current?.close(); player.current = null;
    void micCtx.current?.close().catch(() => {}); micCtx.current = null;
    setCall("off");
  }, []);

  const callLive = useCallback(async () => {
    if (mic.current) return;
    let buf: Int16Array[] = [];
    let have = 0;
    try {
      mic.current = await openMic((pcm) => {
        buf.push(pcm); have += pcm.length;
        if (have < 1600) return; // ~100 ms per message
        const all = new Int16Array(have);
        let at = 0;
        for (const p of buf) { all.set(p, at); at += p.length; }
        buf = []; have = 0;
        send({ type: "call.audio", data: int16ToBase64(all) });
      }, undefined, micCtx.current ?? undefined);
      micCtx.current = null; // the mic owns it now
      setCall("live");
    } catch (err) {
      setSaid((err as Error).message || "The microphone is not available.");
      send({ type: "call.end" });
      hangUpLocal();
    }
  }, [send, hangUpLocal]);

  useEffect(() => {
    const L = link(ENGINE);
    ws.current = L;
    const same = sameEngine(ENGINE, NEXT);
    const Hl = same ? L : link(NEXT);
    here.current = Hl;
    const shelfList = () => Hl.send({ type: "shelf.list", rid: `shelf.list:${Date.now().toString(36)}` });
    const offHere = same ? () => {} : Hl.onLink((isUp) => { if (isUp) shelfList(); });
    const offHereMsg = same ? () => {} : Hl.on((m) => {
      if (m.rid && waits.current.has(m.rid)) { const f = waits.current.get(m.rid)!; waits.current.delete(m.rid); f(m); }
      if ((m.type === "shelf.items" || m.type === "shelf.list") && Array.isArray(m.items)) setShelf(m.items as ShelfItem[]);
    });
    const offLink = L.onLink((isUp) => {
      upRef.current = isUp; setUp(isUp);
      if (isUp) { send({ type: "list" }); if (same) shelfList(); return; }   // every up: the door's last conversation and the shelf again
      setWorking(false); texting.current = false; hangUpLocal();
      for (const [rid, f] of [...waits.current]) { waits.current.delete(rid); f({ error: "offline" }); }   // nothing will answer them now
    });
    const offMsg = L.on((m) => {
      if (m.rid && waits.current.has(m.rid)) { const f = waits.current.get(m.rid)!; waits.current.delete(m.rid); f(m); }
      if ((m.type === "shelf.items" || m.type === "shelf.list") && Array.isArray(m.items)) { setShelf(m.items as ShelfItem[]); return; }
      if (m.type === "threads") {
        // the door's own newest conversation, for the last thing Sol said through it
        const t = (m.threads ?? []).find((x: any) => x.seat === "codex" && x.door === "notch");
        if (t && callRef.current === "off" && !texting.current) sessionRef.current = t.sessionId;
        if (t && !raw.current) send({ type: "open", seat: "codex", sessionId: t.sessionId });
      } else if (m.type === "thread") {
        if (m.seat === "codex" && m.sessionId === sessionRef.current && !raw.current) {
          const last = [...(m.msgs ?? [])].reverse().find((x: any) => x.who === "you" && x.text);
          if (last) setSaid(sentence(String(last.text)));
        }
      } else if (m.type === "call") {
        if (m.sessionId) sessionRef.current = String(m.sessionId);
        if (m.ok === false) { setSaid(String(m.why ?? "The call did not start.")); hangUpLocal(); }
        else if (m.state === "live") void callLive();
        else if (m.state === "ended") hangUpLocal();
      } else if (m.type === "call.audio") player.current?.play(base64ToInt16(m.data));
      else if (m.type === "call.clear") player.current?.clear();
      else if (m.type === "call.text") {
        if (m.who !== "me" && m.text) setSaid(sentence(String(m.text)));
      } else if (m.type === "start") {
        if ((texting.current || callRef.current !== "off") && m.sessionId) sessionRef.current = String(m.sessionId);
      } else if (m.type === "delta") {
        if (texting.current && m.text) { raw.current += String(m.text); setSaid(sentence(raw.current)); }
      } else if (m.type === "said") {
        // a finished sentence through this door only (the island and the notch are the same door); while this page
        // is texting, its own deltas already carry it
        if (m.seat === "codex" && m.text && !texting.current && (m.door === "notch" || (m.sessionId && m.sessionId === sessionRef.current))) {
          if (m.sessionId) sessionRef.current = String(m.sessionId);
          setSaid(sentence(String(m.text)));
        }
      } else if (m.type === "pin") setPin((m.card as Card) ?? null);
      else if (m.type === "done") {
        texting.current = false; setWorking(false); send({ type: "list" });
      } else if (m.type === "error") {
        texting.current = false; setWorking(false); setSaid(String(m.message ?? "Something went wrong."));
      }
    });
    return () => { offLink(); offMsg(); offHere(); offHereMsg(); ws.current = null; here.current = null; };
  }, [send, hangUpLocal, callLive]);

  // Start or hang up. Audio contexts are made inside the click or shortcut that asks for them.
  const toggle = useCallback(() => {
    if (callRef.current !== "off") { send({ type: "call.end" }); hangUpLocal(); return; }
    if (!upRef.current) { setSaid("The desk is not answering."); return; }
    try {
      const p = new Player(24000);
      void p.resume();
      player.current = p;
      const c = new AudioContext();
      void c.resume().catch(() => {});
      micCtx.current = c;
    } catch { /* no audio: the call will say so */ }
    raw.current = "";
    setCall("ringing");
    send({ type: "call", seat: "codex", door: "notch" });   // the engine continues the door's last conversation, or starts one
  }, [send, hangUpLocal]);

  // ---- Grab and Shelf: a Shot lands on the shelf; a dropped file goes on the shelf (no longer a say to Sol) ----
  /** macOS's crosshair (a region or a window); the item once it landed, or error "cancelled" when Esc was pressed */
  const grabShot = useCallback(async (): Promise<{ item?: ShelfItem; error?: string }> => {
    if (!upRef.current) return { error: "offline" };
    const r = await ask<{ item: ShelfItem }>("grab.shot", {}, SHOT_MS);
    // the shelf.items that follows carries it too; this puts it in at once
    if (r.item) { const it = r.item; setShelf((s) => (s.some((x) => x.id === it.id) ? s : [it, ...s])); }
    return r;
  }, [ask]);
  /** put dropped files on the shelf; true once the engine kept them */
  const shelfAdd = useCallback(async (files: File[]): Promise<boolean> => {
    if (!files.length) return false;
    if (!upRef.current) { setSaid("The desk is not answering."); return false; }
    const got = await Promise.all(files.map(readFile));
    const r = await ask<{ items: ShelfItem[] }>("shelf.add", { files: got }, ADD_MS);
    return !r.error;
  }, [ask]);

  return { up, callState, sentence: said, working, pin, toggle, shelf, grabShot, shelfAdd };
}
