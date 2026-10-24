// The Work wire (PROTOCOL.md round 11): the face's work.* messages, and what goes back to every face.
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { renameSession, deleteSession, forkSession } from "@anthropic-ai/claude-agent-sdk";
import { workSessions, withRuns, sessionItems, sessionInfo, invalidate, watchSessions, topicsFor, relocated } from "./sessions.js";
import { pickTopic } from "../titles.js";
import { workSay, getRun, allRuns, lastInit, setChanging, workDefaults, type WorkSay } from "./runs.js";
export { setChanging as setWorkChanging };
import { workState, mark, forget, groupOp, folderOp, folderMoved, setOrder, prefs, setPrefs } from "./state.js";
import { renameFolder, ENGINE_ROOT, SOL_HOME, windowRoot } from "./rename.js";
import { listCopies, removeCopy, stale } from "./copies.js";
import { keepAwake, about, banner, styles } from "./machine.js";
import { setWorkHooks, type Start } from "./tools.js";
import { aside } from "./aside.js";
import { watchHolders, holders } from "./holders.js";
import { machineOf } from "../home.js";
import { threadView, forkHere, reconcile } from "./reconcile.js";
import { fileHits, folderOf, tree } from "./files.js";
import { review, stopReview, markReview, withReviews } from "./review.js";
import { changes, pathIn, readText, writeText, pullRequest, openTerm, getTerm, closeTerm, allTerms, termInfo } from "./panes.js";
import { remote, changesSummary, createPr } from "./overview.js";
import { withMine } from "./mine.js";
import { brief, teamNote, runGh, runGit } from "../team/note.js";
import { getTeam, myLogin, mayAgentSpeak } from "../team/settings.js";
import { sendRelay, relayUp } from "../team/relay.js";
import { takePings, pingsText } from "../team/pings.js";
import { shows, issueAt, repoOf } from "../team/show.js";   // Show to team (#101)

type Wire = { send: (m: object) => void };
const faces = new Map<Wire, { viewing?: string }>();
const everyone = (m: object) => { for (const f of faces.keys()) f.send(m); };

let pending: NodeJS.Timeout | undefined;
async function sessionsMsg() {
  const runs = allRuns().map((r) => r.info());
  const { sessions, projects } = withRuns(await workSessions(), runs);   // a run the list does not know yet shows at once (#111)
  const st = workState();
  return { type: "work.sessions", sessions, projects: await withMine(projects), groups: st.groups, order: st.order, runs };
}
// the list goes out at most every 300 ms, however many things changed
export function broadcastSessions() {
  clearTimeout(pending);
  pending = setTimeout(async () => { if (faces.size) everyone(await sessionsMsg().catch(() => ({ type: "work.sessions.error" }))); }, 300);
}

// a run's events go to every face; a turn that ends while nobody looks at it leaves the row unread
const bus = (m: any) => {
  everyone(m);
  if (m.type === "work.item") shows.item(m.sessionId, m.item);   // a shown session's new line (#101); the rest ignore it
  else if (m.type === "work.closed" && shows.showing(m.sessionId)) void shows.stop(m.sessionId).catch(() => {});
  if (m.type === "work.run") {
    if (m.ended) {
      const looking = [...faces.values()].some((f) => f.viewing === m.sessionId);
      if (!looking && !m.waiting) mark(m.sessionId, { unread: true });
      invalidate();
    }
    keepAwake(allRuns().some((r) => r.working));
    broadcastSessions();
  }
};

// auto-archive (the work drawer): sessions untouched N days, and a side copy's sessions once its PR is merged or
// closed. Pinned sessions and running ones stay. Every half hour while a face is connected, and soon after one is.
let sweeping: NodeJS.Timeout | undefined;
async function sweep() {
  const p = prefs();
  if (!p.archiveDays && !p.archivePr) return;
  const { sessions } = await workSessions();
  const now = Date.now();
  // asked again at each mark: a PR lookup is slow, and a session may have started or been pinned meanwhile
  const keep = (s: (typeof sessions)[number]) => {
    const mk = workState().marks[s.id] ?? {};
    return !!(mk.archived || mk.pinned) || allRuns().some((r) => r.id === s.id && (r.working || r.perms.size));
  };
  let n = 0;
  if (p.archiveDays) for (const s of sessions) if (!keep(s) && now - s.updatedAt > p.archiveDays * 86_400_000) { mark(s.id, { archived: true }); n++; }
  if (p.archivePr) {
    const byCopy = new Map<string, typeof sessions>();
    for (const s of sessions) if (s.worktree && !s.gone && !keep(s) && now - s.updatedAt < 30 * 86_400_000) byCopy.set(s.cwd, [...(byCopy.get(s.cwd) ?? []), s]);
    for (const [cwd, list] of byCopy) {
      const r = await pullRequest(cwd).catch(() => null);
      const st = (r as any)?.pr?.state;
      if ((st === "MERGED" || st === "CLOSED") && prefs().archivePr) for (const s of list) if (!keep(s)) { mark(s.id, { archived: true }); n++; }
    }
  }
  if (n) broadcastSessions();
}
function startSweep() {
  if (sweeping) return;
  setTimeout(() => void sweep().catch(() => {}), 10_000);
  sweeping = setInterval(() => { if (faces.size) void sweep().catch(() => {}); }, 30 * 60_000);
}

const inPath = (p: string, dir: string) => p === dir || p.startsWith(dir + "/");
const liveIn = (path: string) => allRuns().some((r) => inPath(r.cwd, path));

// a folder renamed on the disk from the side (#181, rename.ts): what runs where, what the side lists, where Sol runs from
const MACHINE = { mac: "the Mac", nucbox: "the NucBox" } as const;
async function renameNow(path: string, name: string) {
  const { sessions, projects } = await workSessions();
  const titled = (id: string) => `"${sessions.find((s) => s.id === id)?.title ?? id.slice(0, 8)}"`;
  const liveIn = (p: string) => {
    const r = allRuns().find((r) => inPath(r.cwd, p));
    if (r) return titled(r.id);
    if (allTerms().some((t) => t.alive && inPath(t.cwd, p))) return "a terminal in Sol";
    for (const [id, hs] of holders()) for (const h of hs) if (h.cwd && inPath(h.cwd, p)) return h.name ? `"${h.name}"` : titled(id);
  };
  const here = machineOf(homedir());
  const elsewhere = (p: string) => { const m = sessions.find((s) => s.project === p && s.machine && s.machine !== here)?.machine; return m ? MACHINE[m] : undefined; };
  const r = await renameFolder(path, name, {
    home: homedir(), solRoots: [ENGINE_ROOT, SOL_HOME, process.cwd(), windowRoot() ?? ""].filter(Boolean),
    known: [...projects.map((x) => x.path), ...workState().folders], liveIn, elsewhere, moved: folderMoved, at: relocated,
  });
  return "ok" in r ? { ...r, sessions: projects.find((x) => x.path === path)?.count ?? 0 } : r;
}

// the side copies as the drawer lists them (git and du in each, so only when asked)
async function copiesNow() {
  const { sessions, projects } = await workSessions();
  return listCopies(projects.map((x) => x.path), sessions, allRuns().map((r) => r.cwd));
}

export function addWorkFace(w: Wire) {
  faces.set(w, {});
  watchSessions(broadcastSessions);
  watchHolders(broadcastSessions);
  startSweep();
}
export function removeWorkFace(w: Wire) { faces.delete(w); }

const ID = /^[A-Za-z0-9_-]{8,80}$/;
const sid = (v: unknown) => { const s = String(v ?? ""); if (!ID.test(s)) throw new Error("bad session id"); return s; };

export async function handleWork(w: Wire, m: any) {
  const me = faces.get(w) ?? {};
  switch (m.type) {
    case "work.list":
      return w.send(await sessionsMsg());
    case "work.open": {
      const id = sid(m.sessionId);
      me.viewing = id;
      mark(id, { unread: null, seen: Date.now() });
      const run = getRun(id);
      const items = withReviews(id, run ? run.items.list : (await sessionItems(id).catch(() => null))?.list ?? []);
      const info = await sessionInfo(id);
      w.send({ type: "work.thread", sessionId: id, items, run: run?.info() ?? null, cwd: run?.cwd ?? info?.cwd, branch: info?.gitBranch, title: info?.customTitle || info?.summary });
      return broadcastSessions();
    }
    case "work.view":   // the face shows this session (or none: a fresh one, settings)
      me.viewing = m.sessionId ? sid(m.sessionId) : undefined;
      if (me.viewing) { mark(me.viewing, { unread: null, seen: Date.now() }); broadcastSessions(); }
      return;
    case "work.say": {
      const s = m as WorkSay;
      s.sessionId = sid(s.sessionId);
      me.viewing = s.sessionId;
      await workSay(s, bus);
      if (s.fresh) invalidate();
      if (s.fresh) void fileByTopic(s.sessionId, getRun(s.sessionId)?.cwd ?? s.cwd ?? "", String(s.text ?? ""));
      return broadcastSessions();
    }
    case "work.stop":
      return getRun(sid(m.sessionId))?.stop();
    case "work.show": {   // the switch "show to team" (#101): on or off, answered with where it stands
      const id = sid(m.sessionId);
      try { return w.send({ type: "work.show", rid: m.rid, sessionId: id, ...(await showSession(id, !!m.on)) }); }
      catch (e) { return w.send({ type: "work.show", rid: m.rid, sessionId: id, shown: shows.showing(id), error: e instanceof Error ? e.message : String(e) }); }
    }
    case "work.readnow":   // a queued message joins the running turn now (#51)
      return getRun(sid(m.sessionId))?.readNow(String(m.id));
    case "work.drop":      // a queued message is forgotten before it is read (#51)
      return getRun(sid(m.sessionId))?.drop(String(m.id));
    case "work.perm":
      return getRun(sid(m.sessionId))?.answer(String(m.id), m);
    case "work.aside": {   // a side question: answered to this face only, the session untouched
      const id = sid(m.sessionId);
      const run = getRun(id);
      const cwd = run?.cwd ?? (await sessionInfo(id))?.cwd;
      void aside({ sessionId: id, text: String(m.text ?? "").slice(0, 8000), cwd, model: run?.model }, (x) => w.send(x));
      return;
    }
    case "work.files": {   // the box's @ list (or a folder check, with q ""): to this face only
      const cwd = folderOf(m.cwd);
      if (!cwd) return w.send({ type: "work.files", rid: m.rid, missing: true, files: [] });
      return w.send({ type: "work.files", rid: m.rid, cwd, files: await fileHits(cwd, String(m.q ?? "").slice(0, 200)) });
    }
    case "work.map": {   // the thread map: the transcript's tree, its ends and who wrote them
      const id = sid(m.sessionId);
      return w.send({ type: "work.map", rid: m.rid, sessionId: id, map: threadView(id) });
    }
    case "work.forkhere": {   // a session open elsewhere goes on in a new one here
      const id = sid(m.sessionId);
      const to = await forkHere(id, m.end ? sid(m.end) : undefined);
      mark(to, { parent: id });
      w.send({ type: "work.forked", sessionId: to, from: id, ...(m.rid ? { rid: m.rid } : {}), here: true });
      return broadcastSessions();
    }
    case "work.reconcile": {   // a split thread: one end kept, the other folded in or forked out
      const id = sid(m.sessionId);
      const r = await reconcile(id, sid(m.keep), sid(m.other), m.how === "fork" ? "fork" : "fold");
      everyone({ type: "work.reconciled", sessionId: id, ...r });
      w.send({ type: "work.map", sessionId: id, map: threadView(id) });
      return broadcastSessions();
    }
    case "work.tree": {   // the show's map: every file of the folder
      const cwd = folderOf(m.cwd);
      if (!cwd) return w.send({ type: "work.tree", rid: m.rid, missing: true, files: [] });
      return w.send({ type: "work.tree", rid: m.rid, cwd, files: await tree(cwd) });
    }
    case "work.peek": {   // a second session beside the open one: its thread, without moving what this face views
      const id = sid(m.sessionId);
      const run = getRun(id);
      const items = withReviews(id, run ? run.items.list : (await sessionItems(id).catch(() => null))?.list ?? []);
      const info = await sessionInfo(id);
      return w.send({ type: "work.thread", sessionId: id, items, run: run?.info() ?? null, cwd: run?.cwd ?? info?.cwd, branch: info?.gitBranch, title: info?.customTitle || info?.summary, peek: true });
    }
    // the panes' questions: each answered to this face, by rid
    case "work.diff": case "work.read": case "work.write": case "work.pr": {
      const cwd = folderOf(m.cwd);
      const reply = (o: object) => w.send({ type: m.type, rid: m.rid, ...o });
      if (!cwd) return reply({ error: "that folder is not there" });
      try {
        if (m.type === "work.diff") return reply(await changes(cwd, String(m.scope ?? "all")));
        if (m.type === "work.pr") return reply(await pullRequest(cwd));
        const abs = pathIn(cwd, m.path);
        if (m.type === "work.read") return reply({ path: abs, ...readText(abs) });
        return reply({ path: abs, ...writeText(abs, String(m.text ?? ""), typeof m.hash === "string" ? m.hash : undefined) });
      } catch (err) { return reply({ error: err instanceof Error ? err.message.split("\n")[0] : String(err) }); }
    }
    case "work.review": {   // Codex reads the session's change (the diff pane's scope) and names what is wrong (review.ts)
      const id = sid(m.sessionId);
      const reply = (o: object) => w.send({ type: "work.review", rid: m.rid, sessionId: id, ...o });
      if (m.stop) { stopReview(id); return reply({ ok: true }); }
      const cwd = folderOf(m.cwd);
      if (!cwd) return reply({ error: "that folder is not there" });
      // the remarks sit after what the thread showed when the review began
      const run = getRun(id);
      const list = run ? run.items.list : (await sessionItems(id).catch(() => null))?.list ?? [];
      const after = [...list].reverse().find((i) => !i.parent && i.kind !== "review")?.id;
      try { return reply(await review({ sessionId: id, cwd, scope: ["all", "uncommitted", "last"].includes(m.scope) ? m.scope : "all", after }, everyone)); }
      catch (err) { return reply({ error: err instanceof Error ? err.message.split("\n")[0] : String(err) }); }
    }
    case "work.review.mark":   // a remark sent to Claude, or dismissed
      return markReview(sid(m.sessionId), String(m.id), m.state === "sent" || m.state === "dismissed" ? m.state : "open", everyone);
    case "work.term.open": {   // a new terminal in a folder; its output goes to every face
      const cwd = folderOf(m.cwd);
      if (!cwd) return w.send({ type: "work.term.opened", rid: m.rid, error: "that folder is not there" });
      let t;
      try { t = openTerm(cwd, Number(m.cols), Number(m.rows), everyone); }
      catch (err) { return w.send({ type: "work.term.opened", rid: m.rid, error: `the terminal did not open: ${err instanceof Error ? err.message : err}` }); }
      everyone({ type: "work.terms", terms: allTerms() });
      return w.send({ type: "work.term.opened", rid: m.rid, ...termInfo(t), buf: "" });
    }
    case "work.term.attach": {   // a pane showing a terminal that runs: what it said so far
      const t = getTerm(m.tid);
      return w.send(t ? { type: "work.term.opened", rid: m.rid, ...termInfo(t), buf: t.buf, seq: t.seq } : { type: "work.term.opened", rid: m.rid, tid: m.tid, gone: true });
    }
    case "work.term.in":
      return getTerm(m.tid)?.pty.write(String(m.data ?? ""));
    case "work.term.size": {
      const t = getTerm(m.tid);
      if (t?.alive) t.pty.resize(Math.max(20, Number(m.cols) | 0), Math.max(5, Number(m.rows) | 0));
      return;
    }
    case "work.term.close":
      closeTerm(m.tid);
      return everyone({ type: "work.terms", terms: allTerms() });
    case "work.term.list":
      return w.send({ type: "work.terms", terms: allTerms() });
    case "work.handover": {   // a Life conversation becomes a Work one (PROTOCOL round 11). Unused by the face since Home
      // (#132); kept for one release, it goes with #25's clean-up
      const reply = (o: object) => w.send({ type: "work.handover", rid: m.rid, ...o });
      if (m.seat === "claude") {   // the same Claude session, now marked as Work's: it opens in Work as it is
        const id = sid(m.sessionId);
        if (!(await sessionInfo(id))) return reply({ error: "that conversation is not there" });
        mark(id, { mode: "work" });
        invalidate(); broadcastSessions();
        return reply({ sessionId: id });
      }
      // Codex: Work cannot resume it, so its words come along as the first message of a new Work session, for Marco to send.
      // The Codex conversation is marked too (by its own id), so Life shows it as moved.
      const said: { who: string; text: string }[] = Array.isArray(m.said) ? m.said : [];
      if (!said.length) return reply({ error: "that conversation is empty or not there" });
      mark(sid(m.sessionId), { mode: "work" });
      let brief = said.slice(-14).map((x) => `${x.who === "me" ? "Marco" : "Sol"}: ${String(x.text).trim().slice(0, 1400)}`).join("\n\n");
      if (brief.length > 9000) brief = "…" + brief.slice(-9000);
      return reply({ brief: `Carried over from a Life conversation${m.title ? ` ("${String(m.title).slice(0, 120)}")` : ""}. Where it stood:\n\n${brief}\n\nCarry on from here in Work.` });
    }
    case "work.adjust":
      return getRun(sid(m.sessionId))?.adjust(m);
    case "work.mark": {
      const ids: string[] = Array.isArray(m.sessionIds) ? m.sessionIds.map(sid) : [sid(m.sessionId)];
      for (const id of ids) mark(id, m.patch ?? {});
      return broadcastSessions();
    }
    case "work.rename":
      await renameSession(sid(m.sessionId), String(m.title ?? "").slice(0, 200));
      invalidate();
      return broadcastSessions();
    case "work.group":
      groupOp(String(m.op), m);
      return broadcastSessions();
    case "work.order":
      setOrder(m.keys);
      return broadcastSessions();
    case "work.folder":
      if (m.op === "rename") {   // the real folder, on the disk (#181): answered by rid, the reason when refused
        const reply = (o: object) => w.send({ type: "work.folder", rid: m.rid, ...o });
        let r;
        try { r = await renameNow(String(m.path ?? ""), String(m.name ?? "")); }
        catch (err) { return reply({ error: err instanceof Error ? err.message.split("\n")[0] : String(err) }); }
        if ("ok" in r) { invalidate(); broadcastSessions(); }
        return reply(r);
      }
      folderOp(String(m.op), String(m.path ?? ""));
      invalidate();
      return broadcastSessions();
    case "work.delete": {
      const id = sid(m.sessionId);
      if (getRun(id)?.working) throw new Error("stop the session before deleting it");
      getRun(id)?.end();
      await deleteSession(id);
      forget(id);
      invalidate();
      everyone({ type: "work.deleted", sessionId: id });
      return broadcastSessions();
    }
    case "work.start": {   // a proposal card's start: the session it proposed, nested under the one that proposed it
      const reply = (o: object) => w.send({ type: "work.start", rid: m.rid, ...o });
      try {
        const a = { title: String(m.title ?? "").slice(0, 200), prompt: String(m.prompt ?? ""), cwd: m.cwd ? String(m.cwd) : undefined, fork: !!m.fork, worktree: !!m.worktree, card: m.card ? String(m.card).slice(0, 120) : undefined };
        if (!a.prompt.trim()) return reply({ error: "the card has no task in it" });
        const from = sid(m.from);
        // a card starts once: a second click (or a second window) gets the session the first one made
        const made = a.card && Object.entries(workState().marks).find(([, k]) => k.card === a.card && k.parent === from)?.[0];
        if (made) return reply({ sessionId: made });
        const key = `${from}:${a.card ?? randomUUID()}`;
        let p = carding.get(key);
        if (!p) { p = startFrom(from, a); carding.set(key, p); void p.catch(() => {}).finally(() => carding.delete(key)); }
        reply({ sessionId: await p });
      } catch (err) { reply({ error: err instanceof Error ? err.message : String(err) }); }
      return broadcastSessions();
    }
    case "work.prefs": {   // the drawers the engine acts on: read, or changed (patch)
      const reply = (o: object) => w.send({ type: "work.prefs", rid: m.rid, ...o });
      try {
        const p = m.patch && typeof m.patch === "object" ? setPrefs(m.patch) : prefs();
        if (m.patch) { keepAwake(allRuns().some((r) => r.working)); if ("archiveDays" in m.patch || "archivePr" in m.patch) void sweep().catch(() => {}); }
        // every face learns the change (the side's stale folders, the folder new sessions start in)
        if (m.patch) { everyone({ type: "work.prefs", prefs: p }); if ("stale" in m.patch) broadcastSessions(); }
        return reply({ prefs: p });
      } catch (err) { return reply({ error: err instanceof Error ? err.message : String(err), prefs: prefs() }); }
    }
    case "work.copies": case "work.copies.remove": case "work.copies.clean": {
      const reply = (o: object) => w.send({ type: m.type, rid: m.rid, ...o });
      try {
        const list = await copiesNow();
        if (m.type === "work.copies") return reply(list);
        if (m.type === "work.copies.remove") {
          const c = list.copies.find((x) => x.path === String(m.path));
          if (!c) return reply({ error: "that side copy is not there any more" });
          const said = await removeCopy(c, liveIn, !!m.force);
          invalidate(); broadcastSessions();
          return reply({ ok: true, said });
        }
        let removed = 0; const errors: string[] = [];
        for (const c of list.copies.filter(stale)) await removeCopy(c, liveIn).then(() => removed++, (err) => errors.push(`${c.path}: ${err.message}`));
        invalidate(); broadcastSessions();
        return reply({ removed, errors });
      } catch (err) { return reply({ error: err instanceof Error ? err.message.split("\n")[0] : String(err) }); }
    }
    case "work.about": {   // the machine and tools drawers: versions, the log, output styles, what the newest run loaded
      const i = lastInit;
      return w.send({ type: "work.about", rid: m.rid, ...(await about()), styles: styles(),
        tools: i ? { skills: i.skills ?? [], plugins: (i.plugins ?? []).map((x: any) => x.name ?? String(x)), mcp: i.mcp_servers ?? [], agents: i.agents ?? [], style: i.output_style, cwd: i.cwd } : null });
    }
    case "work.notify":   // a banner on the engine's machine (macOS), for a face that was asked to ping
      void banner(String(m.title ?? "Sol"), String(m.body ?? ""));
      return;
    case "work.fork": {
      const id = sid(m.sessionId);
      const r = await forkSession(id, { ...(m.upTo ? { upToMessageId: String(m.upTo) } : {}), ...(m.title ? { title: String(m.title) } : {}) });
      mark(r.sessionId, { parent: id });
      invalidate();
      w.send({ type: "work.forked", from: id, sessionId: r.sessionId });
      return broadcastSessions();
    }
    // --- overview (PROTOCOL.md round 20, #40)
    case "work.compact": {   // the Context card's "Compact session": /compact into the session, as the box would send it
      const id = sid(m.sessionId);
      const r = getRun(id);
      await workSay({ sessionId: id, text: "/compact", model: r?.model ?? m.model, effort: r?.effort ?? m.effort, mode: r?.mode ?? m.mode, fast: r?.fast ?? m.fast }, bus);
      return broadcastSessions();
    }
    case "work.remote":   // Remote Control: the away page over `tailscale serve`; on undefined reads the state only
      return w.send({ type: "work.remote", rid: m.rid, ...(await remote(typeof m.on === "boolean" ? m.on : undefined)) });
    case "work.changes.summary": case "work.pr.create": {   // the Changes card: +n −m, and a draft PR from the branch
      const cwd = folderOf(m.cwd);
      const reply = (o: object) => w.send({ type: m.type, rid: m.rid, ...o });
      if (!cwd) return reply({ error: "that folder is not there" });
      try { return reply(m.type === "work.pr.create" ? await createPr(cwd) : await changesSummary(cwd)); }
      catch (err) { return reply({ error: err instanceof Error ? err.message.split("\n")[0] : String(err) }); }
    }
    default:   // a type this engine does not know (a newer face): answered by its rid, so the face's ask does not wait 20 s
      return w.send({ type: m.type, rid: m.rid, error: `this engine does not know ${String(m.type)}` });
  }
}

// --- Show (#101): a running session on a team issue shown to the team over the relay, read-only, or no longer
export async function showSession(id: string, on: boolean): Promise<{ shown: boolean; note?: string }> {
  const run = getRun(id);
  if (!on) {
    if (!shows.showing(id)) return { shown: false };
    const note = await shows.stop(id);
    if (run) { run.shown = false; run.tell(); }
    return { shown: false, note };
  }
  if (!run) throw new Error("this session is not running: send it a message, then show it");
  if (shows.showing(id)) return { shown: true };
  const issue = await issueAt(runGit, run.cwd);
  if (!issue) throw new Error("this session's branch does not name a team issue (start the work with sol/take <issue>)");
  if (!relayUp()) throw new Error("the team relay is not connected (Cowork, settings)");
  const info = await sessionInfo(id).catch(() => undefined);
  const title = String(info?.customTitle || info?.summary || `#${issue}`);
  await shows.start(id, { cwd: run.cwd, issue, repo: await repoOf(runGit, run.cwd), title, existing: run.items.list.map((i) => i.id) });
  run.shown = true; run.issue = issue; run.tell();
  return { shown: true };
}
// --- end Show

// the doors between sessions, for the model (tools.ts)
const line = (s: { id: string; title: string; cwd: string; updatedAt: number }) => `${s.id}  ${new Date(s.updatedAt).toISOString().slice(0, 16)}  ${s.title}  (${s.cwd})`;
setWorkHooks({
  async list(q) {
    const { sessions } = await workSessions();
    const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const hit = sessions.filter((s) => !s.archived && words.every((w) => (s.title + " " + s.cwd).toLowerCase().includes(w)))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
    return hit.map(line).join("\n") || "no sessions";
  },
  async read(id, last = 20) {
    const run = getRun(id);
    const list = run ? run.items.list : (await sessionItems(id)).list;
    return list.filter((i) => i.kind === "me" || i.kind === "you").slice(-last)
      .map((i) => `${i.kind === "me" ? "Marco" : "Claude"}: ${String(i.text).slice(0, 4000)}`).join("\n\n") || "nothing said yet";
  },
  async message(from, to, text) {
    if (!(await sessionInfo(to)) && !getRun(to)) throw new Error("no such session");
    await workSay({ sessionId: to, text: `<message from session ${from}>\n${text}` }, bus);
    return "sent; it runs as a turn there";
  },
  async start(from, a) {
    if (a.initiation === "proposal") return "proposed: a card waits in the talk and Marco starts it when he wants. Carry on.";
    const id = await startFrom(from, a);
    return `started ${id}; it reports in its own row under this session`;
  },
  async handoff(from, title, plan) {
    const id = await startFrom(from, {
      title, fork: true,
      prompt: `This task was handed off to you from the session you were forked from; it stops there. What is left:\n\n${plan}`,
    });
    return `handed off: started ${id} with the task. Stop it here, say in one line that it moved, and answer Marco's newest message.`;
  },
  async archive(id, archived) {
    mark(id, { archived });
    broadcastSessions();
    return archived ? "archived" : "back in the side";
  },
  async rename(id, title) {
    await renameSession(id, title);
    invalidate(); broadcastSessions();
    return "renamed";
  },
  async done(id, done) {
    mark(id, { done });
    broadcastSessions();
    return done ? "marked completed" : "unmarked";
  },
  // the brief and team_note (#83): the session's folder is the repo; the login and the GitHub switch from team settings
  async brief(from, issue) {
    const cwd = getRun(from)?.cwd ?? (await sessionInfo(from))?.cwd;
    if (!cwd) throw new Error("no folder for this session");
    return brief(cwd, issue);
  },
  async note(from, n) {
    const cwd = getRun(from)?.cwd ?? (await sessionInfo(from))?.cwd;
    if (!cwd) throw new Error("no folder for this session");
    return teamNote({ cwd, gh: runGh, git: runGit, login: myLogin, mayGitHub: () => mayAgentSpeak(getTeam(), "github"),
      ping: ({ kind, ...p }) => sendRelay("ping", { ...p, pingKind: kind }, true) }, n);
  },
  // the pings to my human (#100), kept by team/wire.ts as they arrive: the unseen ones, marked seen
  async pings(_from, issue) {
    return pingsText(takePings(issue));
  },
  async show(from, on) {   // show_to_team (#101)
    const r = await showSession(from, on);
    return r.note ?? (r.shown ? "shown: the team sees this session's new lines, read-only, until it ends or is switched off" : "it was not shown");
  },
});

const carding = new Map<string, Promise<string>>();   // proposal cards being started, by proposer and card

// a session started from another (a tool, a hand-off, a proposal card): nested under it, on the Work defaults from the
// settings file, never its parent's picks (#94: a sub-session in manual mode once set the face to manual)
async function startFrom(from: string, a: Start & { card?: string }): Promise<string> {
  const parent = getRun(from);
  const like = { parent: from, ...workDefaults() };
  if (a.fork) {
    if (a.worktree) throw new Error("a fork stays in its own folder; start it fresh to put it in a side copy");
    const id = (await forkSession(from, { title: a.title })).sessionId;
    mark(id, { parent: from, card: a.card ?? null });
    await workSay({ sessionId: id, text: a.prompt, ...like }, bus);
    return id;
  }
  const id = randomUUID();
  const cwd = a.cwd ?? parent?.cwd ?? (await sessionInfo(from))?.cwd;
  await workSay({ sessionId: id, fresh: true, cwd, worktree: !!a.worktree, text: a.prompt, ...like }, bus);
  if (a.card) mark(id, { card: a.card });
  void nameWhenWritten(id, a.title);
  return id;
}

// a fresh session in a folder with topic groups that say what they are for: the model files it in one, or none (#71)
async function fileByTopic(id: string, cwd: string, first: string) {
  const topics = cwd && first.trim() ? topicsFor(id, cwd) : [];
  if (!topics.length || workState().marks[id]?.group) return;
  const k = await pickTopic(first, topics.map((t) => t.about));
  if (k === null || workState().marks[id]?.group) return;   // Marco may have put it somewhere meanwhile
  mark(id, { group: topics[k].id });
  broadcastSessions();
}

// a fresh session's file appears with its first message; the title is written once it is there
export async function nameWhenWritten(id: string, title: string) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    invalidate();
    if (await sessionInfo(id)) { await renameSession(id, title).catch(() => {}); invalidate(); broadcastSessions(); return; }
  }
}
