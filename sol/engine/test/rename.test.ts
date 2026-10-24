import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Renaming a folder from the side renames the real one (#181). Everything happens in a temp home: its own
// ~/.claude/projects, ~/.claude.json, LaunchAgents, a git repo with side copies, and Sol's work.json; nothing real is touched
const top = realpathSync(mkdtempSync(join(tmpdir(), "sol-rename-")));
const HOME = join(top, "home"), P = join(HOME, "computer", "personal", "projects");
const OLD = join(P, "rename-test"), NEW = join(P, "rename-test-2"), SIB = join(P, "rename-test-x"), ECO = join(P, "eco");
const CP = join(HOME, ".claude", "projects");
const slugOf = (p: string) => p.replace(/[^A-Za-z0-9]/g, "-");

// work.json as an older Sol left it: a label on the folder, and paths under it everywhere
process.env.SOL_STATE = join(top, "work.json");
process.env.SOL_SESSIONS_DIR = join(top, "sessions");
writeFileSync(process.env.SOL_STATE, JSON.stringify({
  marks: { s1: { folder: OLD + "/sub" }, s2: { pinned: true } },
  groups: [{ id: "g1", name: "archive", at: 1, folders: [OLD, "/elsewhere"] }, { id: "g2", name: "topic", at: 2, in: OLD }],
  folders: [OLD], hidden: [OLD + "/sub"], names: { [OLD]: "LABEL" }, order: ["g:g1", OLD, "/elsewhere"],
  prefs: { newIn: OLD, stale: false }, copies: { [OLD + "/.claude/worktrees/w"]: OLD },
  moved: { [ECO]: OLD, [NEW + "/inner"]: "/zzz" },
}));
const { workState, folderMoved } = await import("../src/work/state.ts");
const { fileSessions, relocated } = await import("../src/work/sessions.ts");
const { renameFolder, refusal, badName } = await import("../src/work/rename.ts");

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const transcript = (dir: string, cwd: string) => { mkdirSync(join(CP, dir), { recursive: true }); writeFileSync(join(CP, dir, "abc.jsonl"), JSON.stringify({ type: "user", cwd, sessionId: "abc" }) + "\n"); };

// the fixture
mkdirSync(join(OLD, "sub"), { recursive: true });
mkdirSync(join(OLD, "node_modules", "x"), { recursive: true });
mkdirSync(SIB, { recursive: true });
mkdirSync(join(P, "rename-test-y"), { recursive: true });
mkdirSync(join(HOME, "Library", "LaunchAgents"), { recursive: true });
writeFileSync(join(OLD, "CLAUDE.md"), `# test\nThe folder is ${OLD}, its notes in ${OLD}/sub.\n`);
writeFileSync(join(OLD, "notes.md"), "see ~/computer/personal/projects/rename-test/sub\n");
writeFileSync(join(OLD, "other.md"), `the sibling ${SIB} is not this one\n`);
writeFileSync(join(OLD, "node_modules", "x", "a.txt"), OLD);
writeFileSync(join(HOME, "Library", "LaunchAgents", "com.test.job.plist"), `<string>${OLD}/run.sh</string>`);
git(OLD, "init", "-q"); git(OLD, "add", "-A"); git(OLD, "commit", "-qm", "one");
git(OLD, "worktree", "add", "-q", join(OLD, ".claude", "worktrees", "w"), "-b", "w");
git(OLD, "worktree", "add", "-q", join(P, "outside"), "-b", "o");
git(OLD, "worktree", "add", "-q", "--relative-paths", join(P, "rel"), "-b", "r");   // git keeps this one's place relative
transcript(slugOf(OLD), OLD);                                  // the folder's own sessions
transcript(slugOf(OLD + "/sub"), OLD + "/sub");                 // a folder under it
transcript(slugOf(SIB), SIB);                                   // a sibling whose key starts the same: not ours
mkdirSync(join(CP, slugOf(OLD + "/memo")), { recursive: true });              // memory only, no sibling of that name: ours
mkdirSync(join(CP, slugOf(join(P, "rename-test-y"))), { recursive: true });   // memory only, a sibling of that name: not ours
writeFileSync(join(HOME, ".claude.json"), JSON.stringify({ numStartups: 3, projects: { [OLD]: { a: 1 }, [OLD + "/sub"]: { b: 2 }, [SIB]: { c: 3 }, "/other": {} } }, null, 2), { mode: 0o600 });

const deps = (over: object = {}) => ({ home: HOME, solRoots: [] as string[], known: [OLD], liveIn: () => undefined, moved: folderMoved, at: relocated, scanMs: 3000, ...over });
const N3 = join(P, "rename-test-3");

test("the old labels are dropped on load, and a folder shows its own name", () => {
  assert.equal("names" in workState(), false);
  assert.equal(fileSessions([{ sessionId: "s9", cwd: OLD, summary: "x", lastModified: 1, fileSize: 1 } as any]).projects.find((p) => p.path === OLD)?.name, "rename-test");
});

test("a name that can't be a folder's, or is taken, is refused", () => {
  for (const n of ["", ".", "..", "a/b"]) assert.ok(badName(n), `"${n}" refused`);
  assert.equal(badName("rename-test-2"), undefined);
  assert.equal(refusal(OLD, "rename-test-x", deps()), "a folder named rename-test-x is already there");
  assert.equal(refusal(OLD, "rename-test", deps()), "rename-test already has that name");
  assert.match(refusal(OLD, "a/b", deps())!, /\//);
});

test("refused: the other machine's folder, a live one, Sol's own, the home folder, one holding projects", () => {
  assert.equal(refusal(join(P, "only-on-nucbox"), "n", deps({ elsewhere: () => "the NucBox" })), "only-on-nucbox is on the NucBox; rename it there");
  assert.equal(refusal(join(P, "nowhere"), "n", deps()), "nowhere is not on this disk");
  assert.equal(refusal(OLD, "n", deps({ liveIn: (p: string) => (p === OLD ? '"fix the build"' : undefined) })), '"fix the build" is running in rename-test; rename when it stops');
  assert.equal(refusal(OLD, "n", deps({ solRoots: [join(OLD, "sub")] })), "Sol runs from rename-test; rename it from Terminal", "Sol's home is under it");
  assert.equal(refusal(join(OLD, "sub"), "n", deps({ solRoots: [OLD] })), "Sol runs from sub; rename it from Terminal", "inside Sol's checkout");
  assert.equal(refusal(HOME, "n", deps()), "home is your home folder; rename it from Terminal");
  assert.equal(refusal("/", "n", deps()), "/ holds your home folder; rename it from Terminal");
  assert.equal(refusal(P, "n", deps({ known: [OLD, SIB, P] })), "projects holds 2 projects; rename it from Terminal");
  assert.equal(refusal(OLD, "rename-test-2", deps()), undefined, "and the real one goes through");
});

test("the move: the folder, Claude's folders, ~/.claude.json, git, work.json, and what still says the old place", async () => {
  const r = await renameFolder(OLD, " rename-test-2 ", deps());
  assert.ok("ok" in r, JSON.stringify(r));
  if (!("ok" in r)) return;
  assert.equal(r.from, OLD); assert.equal(r.to, NEW);
  // 1. the folder
  assert.ok(!existsSync(OLD) && statSync(NEW).isDirectory());
  // 2. links at the new keys, pointing at the old folders, which stay
  const link = (p: string) => join(CP, slugOf(p));
  for (const [n, o] of [[NEW, OLD], [NEW + "/sub", OLD + "/sub"], [NEW + "/memo", OLD + "/memo"]]) {
    assert.ok(lstatSync(link(n)).isSymbolicLink(), `${n} linked`);
    assert.equal(readlinkSync(link(n)), link(o));
    assert.ok(lstatSync(link(o)).isDirectory(), "the old one stays a folder");
  }
  assert.ok(existsSync(join(link(NEW), "abc.jsonl")), "the transcript is found under the new key");
  assert.ok(!readdirSync(CP).some((n) => n === slugOf(NEW + "-x") || n === slugOf(NEW + "-y")), "siblings' keys are left alone");
  // 3. ~/.claude.json: only those keys, the rest as it was, still private
  const j = JSON.parse(readFileSync(join(HOME, ".claude.json"), "utf8"));
  assert.deepEqual(Object.keys(j.projects).sort(), [NEW, NEW + "/sub", SIB, "/other"].sort());
  assert.deepEqual(j.projects[NEW], { a: 1 }); assert.equal(j.numStartups, 3);
  assert.equal(statSync(join(HOME, ".claude.json")).mode & 0o777, 0o600);
  // 4. git: the side copy inside it and the two outside (one kept relative) know the new place
  assert.equal(git(join(NEW, ".claude", "worktrees", "w"), "rev-parse", "--abbrev-ref", "HEAD"), "w");
  assert.equal(realpathSync(git(join(P, "outside"), "rev-parse", "--git-common-dir")), realpathSync(join(NEW, ".git")));
  assert.equal(realpathSync(git(join(P, "rel"), "rev-parse", "--git-common-dir")), realpathSync(join(NEW, ".git")));
  const list = git(NEW, "worktree", "list", "--porcelain");
  assert.ok(list.includes(join(NEW, ".claude", "worktrees", "w")) && !list.includes(OLD + "/"), list);
  // 5. work.json, every path under the folder, through state.ts
  const s = workState();
  assert.equal(s.marks.s1.folder, NEW + "/sub"); assert.equal(s.marks.s2.pinned, true);
  assert.deepEqual(s.groups[0].folders, [NEW, "/elsewhere"]); assert.equal(s.groups[1].in, NEW);
  assert.deepEqual(s.folders, [NEW]); assert.deepEqual(s.hidden, [NEW + "/sub"]);
  assert.deepEqual(s.order, ["g:g1", NEW, "/elsewhere"]);
  assert.equal(s.prefs?.newIn, NEW);
  assert.deepEqual(s.copies, { [NEW + "/.claude/worktrees/w"]: NEW });
  // the moved line, chains collapsed: eco ended in OLD and now ends in NEW; one that started at NEW is gone
  assert.deepEqual(s.moved, { [ECO]: NEW, [OLD]: NEW });
  await new Promise((ok) => setTimeout(ok, 300));   // state.ts writes 150 ms after a change
  const file = JSON.parse(readFileSync(process.env.SOL_STATE!, "utf8"));
  assert.deepEqual(file.moved, { [ECO]: NEW, [OLD]: NEW }); assert.equal("names" in file, false);
  // the old transcripts file under the new folder, under its own name
  const filed = fileSessions([{ sessionId: "s9", cwd: OLD, summary: "x", lastModified: 1, fileSize: 1 } as any, { sessionId: "s8", cwd: ECO, summary: "y", lastModified: 2, fileSize: 1 } as any]);
  assert.deepEqual(filed.sessions.map((x) => x.project), [NEW, NEW]);
  assert.equal(filed.projects.find((p) => p.path === NEW)?.name, "rename-test-2");
  // 6. what still says the old place: listed, not changed
  const said = r.mentions.map((p) => p.slice(top.length)).sort();
  assert.deepEqual(said, ["/home/Library/LaunchAgents/com.test.job.plist", "/home/computer/personal/projects/rename-test-2/CLAUDE.md", "/home/computer/personal/projects/rename-test-2/notes.md"]);
  assert.equal(r.mentioned, 3);
  assert.ok(readFileSync(join(NEW, "CLAUDE.md"), "utf8").includes(OLD), "unchanged");
  assert.ok(r.notes.some((n) => /3 Claude folders/.test(n)), r.notes.join(" | "));
  assert.ok(r.notes.some((n) => /2 entries in ~\/\.claude\.json/.test(n)), r.notes.join(" | "));
  assert.ok(r.notes.some((n) => /3 side copies/.test(n)), r.notes.join(" | "));
});

test("renamed again: a folder under it still gets its link, pointing at the real folder; the chain collapses", async () => {
  const r = await renameFolder(NEW, "rename-test-3", deps({ known: [NEW] }));
  assert.ok("ok" in r, JSON.stringify(r));
  const link = (p: string) => join(CP, slugOf(p));
  for (const [n, o] of [[N3, OLD], [N3 + "/sub", OLD + "/sub"], [N3 + "/memo", OLD + "/memo"]]) assert.equal(readlinkSync(link(n)), link(o), `${n} links to the folder, not to a link`);
  assert.deepEqual(workState().moved, { [ECO]: N3, [OLD]: N3, [NEW]: N3 });
  assert.equal(relocated(OLD + "/sub"), N3 + "/sub");
});

test("renamed back: the chain does not loop", async () => {
  const r = await renameFolder(N3, "rename-test", deps({ known: [N3] }));
  assert.ok("ok" in r, JSON.stringify(r));
  assert.deepEqual(workState().moved, { [ECO]: OLD, [NEW]: OLD, [N3]: OLD });
  assert.equal(relocated(OLD), OLD);
  assert.equal(git(join(OLD, ".claude", "worktrees", "w"), "rev-parse", "--abbrev-ref", "HEAD"), "w");
  assert.equal(realpathSync(git(join(P, "outside"), "rev-parse", "--git-common-dir")), realpathSync(join(OLD, ".git")));
});

test("only the case changes: allowed, through a temp name", async () => {
  const a = join(P, "casey");
  mkdirSync(a);
  assert.equal(refusal(a, "Casey", deps({ known: [a] })), undefined);
  const r = await renameFolder(a, "Casey", deps({ known: [a] }));
  assert.ok("ok" in r, JSON.stringify(r));
  assert.ok(readdirSync(P).includes("Casey") && !readdirSync(P).includes("casey"));
  assert.ok(!readdirSync(P).some((n) => n.includes("sol-rename")), "no temp name left");
});

test("a move that fails on the disk says so and changes nothing else", async () => {
  const a = join(P, "stuck");
  mkdirSync(a);
  const before = JSON.stringify(workState());
  const r = await renameFolder(a, "unstuck", deps({ known: [a], rename: () => { throw new Error("EPERM: not allowed"); } }));
  assert.deepEqual(r, { error: "the folder could not be renamed: EPERM: not allowed" });
  assert.equal(JSON.stringify(workState()), before);
  assert.ok(existsSync(a));
});
