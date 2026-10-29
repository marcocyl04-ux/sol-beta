// The quota and the move to GitHub (#326, the groups PRD §9.5): how full a cloud group is (team.room.usage), and the
// maker's take (team.room.take) with a fake cloud, a fake gh whose tree is read from a real bare repository on disk, and
// a real git clone in a temp folder: every blob compared, a failed compare stops and thaws, a second run resumes with the
// same repository and ends idempotent; only the maker, only with GitHub. Then the members' half (moved.ts): the cloud's
// moved.json trusted only with the maker's `by`, a card that never switches on its own, and the no-GitHub path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "sol-take-"));
const FILE = join(TMP, "team.json");
const HUB = "wss://cloud.matterfold.tech/relay";
const CLOUD_ROOM = { id: "shuai", name: "帥", provider: "cloud", hub: HUB, code: "K7QX2M", mine: true };
writeFileSync(FILE, JSON.stringify({ me: { login: "frank-gh", name: "Frank" }, rooms: [CLOUD_ROOM], room: "shuai", relay: { key: "k", host: false } }));
process.env.SOL_TEAM = FILE;
process.env.SOL_TEAM_OFFLINE = "1";
const S = await import("../src/team/settings.ts");
const T = await import("../src/team/take.ts");
const M = await import("../src/team/moved.ts");
const { gitQuiet } = await import("../src/team/letin.ts");

// the test's own git (GitHub's side, the checks): never the hooks a test sets up for the take
const git = (args: string[], cwd: string) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const REC = "cloud:K7QX2M";

/** a cloud room in memory: files with their bytes and writer, a maker, a freeze, every freeze said */
function fakeCloud(maker = "frank") {
  const files = new Map<string, { bytes: Buffer; by: string }>();
  const c = {
    files, maker, frozen: false, freezes: [] as boolean[], puts: [] as string[], moved: undefined as undefined | { repo: string; by: string; at: number },
    put: (path: string, bytes: Buffer, by: string) => files.set(path, { bytes, by }),
    calls: {
      usage: async () => ({ used: [...files.values()].reduce((n, f) => n + f.bytes.length, 0), max: 20 * 1024 * 1024, mine: 0, mineMax: 50 * 1024 * 1024, frozen: c.frozen, ...(c.moved ? { moved: c.moved } : {}),
        files: [...files].map(([path, f]) => ({ path, sha: sha256(f.bytes), size: f.bytes.length, by: f.by, at: 1 })) }),
      freeze: async (_r: string, on: boolean) => { c.freezes.push(on); c.frozen = on; return on; },
      maker: async () => c.maker,
    },
    record: () => ({ files: {
      bytes: async (_r: string, p: string) => { const f = files.get(p); if (!f) throw Object.assign(new Error("Not Found (HTTP 404)"), { full: "Not Found (HTTP 404)" }); return f.bytes; },
      readSha: async (_r: string, p: string) => { const f = files.get(p); if (!f) throw Object.assign(new Error("Not Found (HTTP 404)"), { full: "Not Found (HTTP 404)" }); return JSON.stringify({ sha: sha256(f.bytes), content: f.bytes.toString("base64") }); },
      putBody: async (_r: string, p: string, b: { content: string; sha?: string }) => {
        const had = files.get(p);
        if ((had ? sha256(had.bytes) : undefined) !== b.sha) throw Object.assign(new Error("changed (HTTP 409)"), { status: 409 });
        c.puts.push(p); files.set(p, { bytes: Buffer.from(b.content, "base64"), by: c.maker });
        // the cloud saves the maker's move in the room's row (rooms.ts)
        if (p === ".sol/moved.json") { const v = JSON.parse(Buffer.from(b.content, "base64").toString("utf8")); if (v.to === "github") c.moved = { repo: v.repo, by: c.maker, at: 1 }; }
        return "x";
      },
    } }) as any,
  };
  return c;
}

/** GitHub on disk: `make` makes a bare repository with a README on main, `tree` lists a commit's blobs as GitHub would */
function fakeGithub(root: string, o: { login?: string; badTree?: number; crashAfterCreate?: boolean; taken?: string[]; public?: string[] } = {}) {
  const g = { made: [] as string[], views: [] as string[], trees: 0, bad: o.badTree ?? 0, crash: !!o.crashAfterCreate,
    bare: (repo: string) => join(root, "remotes", `${repo}.git`),
    login: async () => { if (o.login === "") throw new Error("gh: not logged in, run gh auth login"); return o.login ?? "frank-gh"; },
    view: async (repo: string) => { g.views.push(repo); return (o.taken ?? []).includes(repo) || existsSync(g.bare(repo)) ? { private: !(o.public ?? []).includes(repo) } : null; },
    create: async (repo: string, name: string) => {
      g.made.push(repo);
      const bare = g.bare(repo), seed = join(root, "seed", repo);
      mkdirSync(bare, { recursive: true }); mkdirSync(seed, { recursive: true });
      git(["init", "--quiet", "--bare", "-b", "main"], bare);
      git(["init", "--quiet", "-b", "main"], seed);
      writeFileSync(join(seed, "README.md"), `# ${name}\n`);
      git(["add", "."], seed);
      git(["-c", "user.name=gh", "-c", "user.email=gh@x", "commit", "--quiet", "-m", "Initial commit"], seed);
      git(["push", "--quiet", bare, "main"], seed);
      if (g.crash) { g.crash = false; throw new Error("the Mac slept as GitHub answered"); }   // made, but this Sol never heard
    },
    tree: async (repo: string, sha: string) => {
      g.trees++;
      const tree = git(["ls-tree", "-r", "--full-tree", sha], g.bare(repo)).split("\n").filter(Boolean).map((l) => {
        const [meta, path] = l.split("\t"); const [, type, s] = meta.split(" ");
        return { path, type, sha: g.bad-- > 0 && path.startsWith(".sol/") ? "0".repeat(40) : s };
      });
      return JSON.stringify({ sha, tree, truncated: false });
    },
  };
  return g;
}

function deps(name: string, cloud: ReturnType<typeof fakeCloud>, gh: ReturnType<typeof fakeGithub>, me = "frank") {
  const root = join(TMP, name);
  return {
    team: S.getTeam, patch: S.patchTeam, cloud: cloud.calls, files: cloud.record, me: () => me, github: gh,
    git: (args: string[], cwd: string) => gitQuiet(args, cwd), url: (repo: string) => gh.bare(repo),
    dir: join(root, "takes"), roomsDir: join(root, "rooms"),
  };
}

const fresh = () => { S.patchTeam({ rooms: [CLOUD_ROOM], room: "shuai" }); T.resetTake(); };

test("blobSha is git hash-object, byte for byte", () => {
  const b = randomBytes(3000);
  const f = join(TMP, "blob.bin");
  writeFileSync(f, b);
  assert.equal(T.blobSha(b), git(["hash-object", f], TMP));
  assert.equal(T.blobSha(Buffer.from("")), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
});

test("usage: a cloud group's used / max, its files, the freeze, its maker and whether I am; my own 50 MB line past 80%", async () => {
  fresh();
  const cloud = fakeCloud();
  cloud.put(".sol/things.json", Buffer.alloc(18 * 1024 * 1024), "frank");
  const d = { team: S.getTeam, cloud: cloud.calls, me: () => "frank" };
  assert.deepEqual(await T.usageOf(d), { room: "shuai", used: 18 * 1024 * 1024, max: 20 * 1024 * 1024, files: 1, frozen: false, maker: "frank", mine: true });
  const theirs = await T.usageOf({ ...d, me: () => "marco", cloud: { ...cloud.calls, usage: async () => ({ ...(await cloud.calls.usage()), mine: 41 * 1024 * 1024 }) } });
  assert.deepEqual([(theirs as any).mine, (theirs as any).warn], [false, "your files in groups are 41 of 50 MB; remove some, or put big ones on Google Drive"]);
  assert.equal(T.mineLine(39 * 1024 * 1024, 50 * 1024 * 1024), "", "under 80%: nothing");
  assert.deepEqual(await T.usageOf(d, "nope"), { error: "which group?" });
  S.patchTeam({ rooms: [CLOUD_ROOM, { id: "gh", name: "gh", provider: "github", repos: ["o/r"] }] });
  assert.equal(await T.usageOf(d, "gh"), null, "a GitHub group has no quota");
  const down = await T.usageOf({ ...d, cloud: { ...cloud.calls, usage: async () => { throw new Error("the cloud did not answer (HTTP 503)"); } } });
  assert.deepEqual(down, { error: "couldn't read how full the group is: the cloud did not answer" });
});

test("the take: frozen, one private repository, one commit of every .sol/ file, each blob read back, moved.json, thawed, my group a GitHub one", async () => {
  fresh();
  const cloud = fakeCloud(), gh = fakeGithub(join(TMP, "a"));
  const big = randomBytes(2 * 1024 * 1024);   // above 1 MB: the contents API would say nothing, the blob API does
  cloud.put(".sol/things.json", Buffer.from('{"v":1,"things":[]}\n'), "marco");
  cloud.put(".sol/goal.md", Buffer.from("finding where a first-time user gives up\n"), "frank");
  cloud.put(".sol/talk/shot.png", big, "marco");
  cloud.put(".sol/moved.json", Buffer.from(JSON.stringify({ v: 1, code: "ABCDEF", hub: HUB })), "marco");   // a member's: never copied
  const d = deps("a", cloud, gh);
  const got = await T.takeRoom(d) as any;
  assert.ok(!("error" in got), got.error);
  assert.match(got.repo, /^frank-gh\/room-[a-z2-9]{4}$/, "named as #160's make names one: a name GitHub cannot take is room-<4 symbols>");
  assert.deepEqual(gh.made, [got.repo], "the repository is made once");
  assert.deepEqual(cloud.freezes, [true, false], "frozen first, thawed last");
  // one commit on top of the README, with every .sol/ file but the cloud's own moved.json, each blob as git has it
  const bare = gh.bare(got.repo);
  assert.equal(git(["rev-list", "--count", "main"], bare), "2");
  assert.equal(git(["log", "-1", "--format=%s", "main"], bare), T.TAKE_COMMIT);
  const blobs = Object.fromEntries(git(["ls-tree", "-r", "main"], bare).split("\n").map((l) => [l.split("\t")[1], l.split(" ")[2].split("\t")[0]]));
  assert.deepEqual(Object.keys(blobs).sort(), [".sol/goal.md", ".sol/talk/shot.png", ".sol/things.json", "README.md"]);
  assert.equal(blobs[".sol/talk/shot.png"], T.blobSha(big));
  // the cloud says where the files went, in the maker's name; nothing there is deleted
  const note = JSON.parse(cloud.files.get(".sol/moved.json")!.bytes.toString("utf8"));
  assert.deepEqual([note.to, note.repo, cloud.files.get(".sol/moved.json")!.by], ["github", got.repo, "frank"]);
  assert.deepEqual([cloud.moved?.repo, cloud.moved?.by], [got.repo, "frank"], "the cloud saved the move");
  assert.equal(cloud.files.size, 4);
  // my group: a GitHub room on the repository, its code and hub kept, its folder the clone, mine
  const r = S.getTeam().rooms.find((x) => x.id === "shuai")!;
  assert.deepEqual([r.provider, r.repos, r.code, r.hub, r.mine, r.folder], ["github", [got.repo], "K7QX2M", HUB, true, join(TMP, "a", "rooms", "shuai")]);
  assert.ok(existsSync(join(r.folder, ".sol", "talk", "shot.png")));
  // the manifest, private, at the last step
  const mf = join(d.dir, "shuai.json");
  assert.equal(statSync(mf).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(mf, "utf8")).step, T.STEP.switched);
  // a second press: done already, nothing made, nothing pushed, nothing frozen
  const again = await T.takeRoom(d) as any;
  assert.deepEqual([again.already, again.repo, gh.made.length, cloud.freezes.length, git(["rev-list", "--count", "main"], bare)], [true, got.repo, 1, 2, "2"]);
});

test("a read-back that differs stops with the manifest kept and the group thawed; the second run reuses the repository and ends idempotent", async () => {
  fresh();
  const cloud = fakeCloud(), gh = fakeGithub(join(TMP, "b"), { badTree: 1 });
  cloud.put(".sol/things.json", Buffer.from("{}\n"), "frank");
  cloud.put(".sol/goal/plan.md", Buffer.from("plan\n"), "marco");
  const d = deps("b", cloud, gh);
  const first = await T.takeRoom(d) as any;
  assert.match(first.error, /^the copy on GitHub does not match the group's files \(\.sol\/[^)]+\); press it again$/);
  assert.deepEqual(cloud.freezes, [true, false], "stopped: thawed, a stale freeze never left behind");
  const kept = T.readManifest(d.dir, "shuai")!;
  assert.deepEqual([kept.step, kept.repo === kept.want, /^frank-gh\/room-/.test(kept.repo)], [T.STEP.made, true, true], "the repository is remembered, the copy is to do again");
  assert.equal(cloud.files.has(".sol/moved.json"), false, "the cloud is not told before the read-back passes");
  assert.equal(S.getTeam().rooms.find((x) => x.id === "shuai")!.provider, "cloud", "my group is as it was");
  // meanwhile a teammate writes (the group was thawed): the next run copies it too
  cloud.put(".sol/goal.md", Buffer.from("new goal\n"), "marco");
  const second = await T.takeRoom(d) as any;
  assert.ok(!("error" in second), second.error);
  assert.deepEqual([gh.made.length, second.repo], [1, kept.repo], "resumed: the same repository, none made again");
  const bare = gh.bare(second.repo);
  assert.equal(git(["rev-list", "--count", "main"], bare), "2", "review P2-7: the first run's commit amended with the teammate's file, still one take commit");
  assert.equal(git(["log", "-1", "--format=%s", "main"], bare), T.TAKE_COMMIT);
  assert.ok(git(["ls-tree", "-r", "--name-only", "main"], bare).split("\n").includes(".sol/goal.md"));
  assert.deepEqual(cloud.freezes, [true, false, true, false]);
  assert.equal(T.readManifest(d.dir, "shuai")!.step, T.STEP.switched);
});

test("a file the cloud names outside .sol/, or that changed while read, stops the take; the group thaws", async () => {
  fresh();
  const cloud = fakeCloud(), gh = fakeGithub(join(TMP, "c"));
  cloud.put(".sol/../../etc/x", Buffer.from("x"), "marco");
  const d = deps("c", cloud, gh);
  const r = await T.takeRoom(d) as any;
  assert.match(r.error, /^the cloud named a file Sol does not write/);
  assert.equal(cloud.frozen, false);
  assert.equal(existsSync(join(TMP, "c", "etc")), false);
  cloud.files.clear();
  cloud.put(".sol/things.json", Buffer.from("{}"), "marco");
  const lying = { ...d, files: () => ({ files: { ...cloud.record().files, bytes: async () => Buffer.from("not what was listed") } }) as any };
  assert.match((await T.takeRoom(lying) as any).error, /^\.sol\/things\.json changed while it was read; press it again$/);
});

test("only the maker takes, only with GitHub: one line each, nothing frozen, nothing made", async () => {
  fresh();
  const cloud = fakeCloud(), gh = fakeGithub(join(TMP, "d"));
  assert.deepEqual(await T.takeRoom(deps("d", cloud, gh, "marco")), { error: "only frank moves the group; ask them to connect GitHub" });
  const noGh = fakeGithub(join(TMP, "d2"), { login: "" });
  assert.deepEqual(await T.takeRoom(deps("d2", cloud, noGh)), { error: "connect GitHub first", need: "github" });
  assert.deepEqual([cloud.freezes, gh.made, noGh.made], [[], [], []]);
  S.patchTeam({ rooms: [CLOUD_ROOM, { id: "gh", name: "gh", provider: "github", repos: ["o/r"] }] });
  assert.deepEqual(await T.takeRoom(deps("d", cloud, gh), "gh"), { error: "only a group on Sol's cloud moves to GitHub" });
});

// ---- the members' half (moved.ts) ----

const NOTE = JSON.stringify({ v: 1, to: "github", repo: "frank-gh/room-abcd", at: "2026-10-28T12:00:00.000Z" });

test("parseMovedAway: to github and an owner/name; anything else is no move", () => {
  assert.deepEqual(M.parseMovedAway(NOTE), { repo: "frank-gh/room-abcd", at: "2026-10-28T12:00:00.000Z" });
  for (const bad of ["", "{", JSON.stringify({ to: "cloud", repo: "a/b" }), JSON.stringify({ to: "github", repo: "../x" }), JSON.stringify({ to: "github", repo: "a b/c" }), JSON.stringify({ v: 1, code: "K7QX2M", hub: HUB })])
    assert.equal(M.parseMovedAway(bad), null, bad);
});

test("cloudMovedOf (review P1-3): the move the cloud saved in the group's row, never the file nor today's maker; a cloud record only", async () => {
  M.forgetAway();
  const cloud = fakeCloud();
  const d = { usage: cloud.calls.usage };
  assert.equal(await M.cloudMovedOf(d, REC, 1), null, "nothing saved: no move");
  cloud.put(".sol/moved.json", Buffer.from(NOTE), "frank");
  assert.equal(await M.cloudMovedOf(d, REC, 2, true), null, "a file in the maker's name the cloud did not save as a move: not a move");
  cloud.moved = { repo: "frank-gh/room-abcd", by: "frank", at: Date.parse("2026-10-28T12:00:00.000Z") };
  cloud.maker = "marco";   // the maker left and the room passed on (C11): the saved move still holds
  assert.deepEqual(await M.cloudMovedOf(d, REC, 3, true), { to: "github", repo: "frank-gh/room-abcd", at: "2026-10-28T12:00:00.000Z", by: "frank" });
  assert.equal(await M.cloudMovedOf(d, "o/r", 4, true), null, "a GitHub room's move is movedOf's");
  cloud.moved = { repo: "../evil", by: "frank", at: 1 };
  assert.equal(await M.cloudMovedOf(d, REC, 5, true), null, "a saved move that names no repository is none");
  // cached ten minutes; a failed read keeps what was read
  M.forgetAway();
  cloud.moved = { repo: "frank-gh/room-abcd", by: "frank", at: 1 };
  assert.ok(await M.cloudMovedOf(d, REC, 10));
  cloud.moved = undefined;
  assert.ok(await M.cloudMovedOf(d, REC, 11), "cached");
  const down = { usage: async () => { throw new Error("the cloud did not answer"); } };
  assert.ok(await M.cloudMovedOf(down, REC, 12, true), "a failed read keeps what was read");
  assert.equal(await M.cloudMovedOf(d, REC, 13, true), null, "none saved: no move at once");
});

test("the card never switches on its own; join it switches my copy on the press, joined, its code and hub kept; without GitHub it says so", async () => {
  M.forgetAway();
  fresh();
  S.patchTeam({ rooms: [{ ...CLOUD_ROOM, mine: false, joined: true }], room: "shuai" });
  const cloud = fakeCloud();
  cloud.moved = { repo: "frank-gh/room-abcd", by: "frank", at: 1 };
  const before = JSON.stringify(S.getTeam());
  const base = { usage: cloud.calls.usage, team: S.getTeam, patch: S.patchTeam };
  assert.ok(await M.cloudMovedOf(base, REC, Date.now(), true));
  assert.equal(JSON.stringify(S.getTeam()), before, "read, and nothing switched");
  assert.deepEqual(await M.followMove({ ...base, github: async () => { throw new Error("not logged in"); } }), { error: "connect GitHub to see the files", need: "github" });
  assert.equal(JSON.stringify(S.getTeam()), before, "no GitHub: nothing switched; talk and build updates go on");
  const got = await M.followMove({ ...base, github: async () => "marco-gh" }) as any;
  const r = got.room;
  assert.deepEqual([r.provider, r.repos, r.code, r.hub, r.mine, r.joined], ["github", ["frank-gh/room-abcd"], "K7QX2M", HUB, false, true]);
  assert.deepEqual(await M.followMove({ ...base, github: async () => "marco-gh" }), { error: "which group?" }, "a GitHub group has nothing to follow");
  fresh();
  M.forgetAway();
  cloud.moved = undefined;
  assert.deepEqual(await M.followMove({ ...base, github: async () => "marco-gh" }), { error: "the group has not moved" });
});

// ---- the review of #326 ----

test("review P1-1: two files a Mac's disk cannot tell apart stop the take before anything is written, naming both", async () => {
  fresh();
  assert.deepEqual(T.clashOf([".sol/a.md", ".sol/A.md"]), [".sol/a.md", ".sol/A.md"]);
  assert.deepEqual(T.clashOf([".sol/talk/x", ".sol/TALK/y"]), [".sol/talk/x", ".sol/TALK/y"]);
  assert.deepEqual(T.clashOf([".sol/goal", ".sol/goal/plan.md"]), [".sol/goal", ".sol/goal/plan.md"]);
  assert.equal(T.clashOf([".sol/goal.md", ".sol/goal/plan.md", ".sol/talk/a", ".sol/talk/b"]), null);
  const cloud = fakeCloud(), gh = fakeGithub(join(TMP, "e"));
  cloud.put(".sol/talk/Shot.png", Buffer.from("one"), "marco");
  cloud.put(".sol/talk/shot.png", Buffer.from("two"), "isaac");
  const d = deps("e", cloud, gh);
  const r = await T.takeRoom(d) as any;
  assert.equal(r.error, "two of the group's files are one on this Mac's disk (.sol/talk/Shot.png and .sol/talk/shot.png); rename one in the group and press it again");
  assert.equal(existsSync(join(TMP, "e", "rooms", "shuai", ".sol")), false, "nothing written");
  assert.equal(cloud.frozen, false);
});

test("review P1-2: moved.json is left as it is only when the cloud's saved move is this repository and me; else it is written again", async () => {
  fresh();
  S.patchTeam({ rooms: [{ ...CLOUD_ROOM, name: "Study group" }], room: "shuai" });
  const cloud = fakeCloud(), gh = fakeGithub(join(TMP, "f"));
  cloud.put(".sol/things.json", Buffer.from("{}"), "frank");
  // a maker before (C11) moved it to the same name: saved, but not by me
  cloud.moved = { repo: "frank-gh/study-group", by: "isaac", at: 1 };
  const r = await T.takeRoom(deps("f", cloud, gh)) as any;
  assert.equal(r.repo, "frank-gh/study-group");
  assert.deepEqual([cloud.puts.includes(".sol/moved.json"), cloud.moved?.by], [true, "frank"], "written again in my name");
});

test("review P2-4: a resume after the read-back passed copies again when the cloud's files changed since (a freeze that thawed itself)", async () => {
  fresh();
  const cloud = fakeCloud(), gh = fakeGithub(join(TMP, "g"));
  cloud.put(".sol/things.json", Buffer.from("{}"), "frank");
  const d = deps("g", cloud, gh);
  // a run that stopped between the read-back and the cloud's word: the cloud write fails once
  const failing = { ...d, files: () => ({ files: { ...cloud.record().files, putBody: async () => { throw new Error("the cloud did not answer (HTTP 503)"); } } }) as any };
  const first = await T.takeRoom(failing) as any;
  assert.match(first.error, /the cloud did not answer/);
  // as if this Sol stopped there: the manifest says read back, with each file's SHA-256
  const m = T.readManifest(d.dir, "shuai")!;
  writeFileSync(join(d.dir, "shuai.json"), JSON.stringify({ ...m, step: T.STEP.checked }));
  assert.equal(m.files[0].sha256, sha256(Buffer.from("{}")));
  cloud.put(".sol/goal.md", Buffer.from("written while this Sol was off\n"), "marco");
  const second = await T.takeRoom(d) as any;
  assert.ok(!("error" in second), second.error);
  assert.ok(git(["ls-tree", "-r", "--name-only", "main"], gh.bare(second.repo)).split("\n").includes(".sol/goal.md"), "the teammate's file is on GitHub");
  assert.equal(git(["rev-list", "--count", "main"], gh.bare(second.repo)), "2", "still one take commit");
});

test("review P2-5: the person's git config (autocrlf, attributes, hooks) never changes the blob or stops the commit", async () => {
  fresh();
  const cfg = join(TMP, "hostile"), hooks = join(cfg, "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(hooks, "pre-push"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(cfg, "attributes"), "* text eol=crlf\n");
  writeFileSync(join(cfg, "gitconfig"), `[core]\n\tautocrlf = true\n\thooksPath = ${hooks}\n\tattributesFile = ${join(cfg, "attributes")}\n[user]\n\tname = f\n\temail = f@x\n`);
  const was = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = join(cfg, "gitconfig");
  try {
    const cloud = fakeCloud(), gh = fakeGithub(join(TMP, "h"));
    const crlf = Buffer.from("one\r\ntwo\r\n"), lf = Buffer.from("one\ntwo\n");
    cloud.put(".sol/goal.md", lf, "frank");
    cloud.put(".sol/notes.txt", crlf, "frank");
    const r = await T.takeRoom(deps("h", cloud, gh)) as any;
    assert.ok(!("error" in r), r.error);
    const blobs = Object.fromEntries(git(["ls-tree", "-r", "main"], gh.bare(r.repo)).split("\n").map((l) => [l.split("\t")[1], l.split(" ")[2].split("\t")[0]]));
    assert.deepEqual([blobs[".sol/goal.md"], blobs[".sol/notes.txt"]], [T.blobSha(lf), T.blobSha(crlf)], "the cloud's bytes, as they were");
  } finally { if (was === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = was; }
});

test("review P2-6: the name is kept before GitHub is asked; a run that stopped right after the make finds it, and makes no second", async () => {
  fresh();
  S.patchTeam({ rooms: [{ ...CLOUD_ROOM, name: "Study group" }], room: "shuai" });
  const cloud = fakeCloud(), gh = fakeGithub(join(TMP, "i"), { crashAfterCreate: true, taken: ["frank-gh/study-group"] });
  cloud.put(".sol/things.json", Buffer.from("{}"), "frank");
  const d = deps("i", cloud, gh);
  const first = await T.takeRoom(d) as any;
  assert.match(first.error, /the Mac slept/);
  const m = T.readManifest(d.dir, "shuai")!;
  assert.deepEqual([m.want, m.repo], ["frank-gh/study-group-2", ""], "#160's rule: the name taken, so -2; kept before the make");
  const second = await T.takeRoom(d) as any;
  assert.ok(!("error" in second), second.error);
  assert.deepEqual([second.repo, gh.made], ["frank-gh/study-group-2", ["frank-gh/study-group-2"]], "found, not made again");
  // a repository of that name that is public is never taken as the group's
  fresh();
  S.patchTeam({ rooms: [{ ...CLOUD_ROOM, name: "Open" }], room: "shuai" });
  const pub = fakeGithub(join(TMP, "j"), { crashAfterCreate: true, public: ["frank-gh/open"] });
  const dj = deps("j", cloud, pub);
  await T.takeRoom(dj);
  assert.equal((await T.takeRoom(dj) as any).error, "frank-gh/open is not private; make it private on GitHub, or move it out of the way, and press it again");
});

test("the cloud's calls (record/cloud.ts): the list as usage, the freeze, the maker; a write's warn and a 423 told to onWrite", async () => {
  const { makeCloudRecord, cloudRoomCalls } = await import("../src/team/record/cloud.ts");
  const asked: string[] = [], told: unknown[] = [];
  let full = false;
  const f = (async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${url.replace("https://cloud.example.net/relay/rooms/K7QX2M/", "")} ${init?.body ?? ""}`.trim());
    const ok = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/files")) return ok({ files: [{ path: ".sol/a", sha: "s", size: 3, by: "frank", at: 1 }, { nope: 1 }], used: 3, max: 20, mine: 3, mineMax: 50, frozen: true });
    if (url.endsWith("/freeze")) return ok({ frozen: JSON.parse(String(init?.body)).on });
    if (url.endsWith("/members")) return ok({ members: [], maker: "frank" });
    if (init?.method === "PUT") return full ? ok({ error: "the group is moving; try again in a minute" }, 423) : ok({ file: { sha: "n" }, warn: "this room is nearly full (17 of 20 MB)" });
    return ok({}, 404);
  }) as typeof fetch;
  const d = { hubOf: () => "https://cloud.example.net/relay", ticket: async () => "sol1.frank", fetch: f, onWrite: (code: string, said: unknown) => told.push([code, said]) };
  const c = cloudRoomCalls(d);
  assert.deepEqual(await c.usage(REC), { used: 3, max: 20, mine: 3, mineMax: 50, frozen: true, files: [{ path: ".sol/a", sha: "s", size: 3, by: "frank", at: 1 }] });
  assert.equal(await c.freeze(REC, true), true);
  assert.equal(await c.maker(REC), "frank");
  assert.deepEqual(asked, ["GET files", 'POST freeze {"on":true}', "GET members"]);
  const rec = makeCloudRecord(d);
  await rec.files.putBody(REC, ".sol/a", { message: "", branch: "main", content: "eA==" });
  full = true;
  await assert.rejects(rec.files.putBody(REC, ".sol/a", { message: "", branch: "main", content: "eA==" }), /the group is moving; try again in a minute \(HTTP 423\)/);
  assert.deepEqual(told, [["K7QX2M", { warn: "this room is nearly full (17 of 20 MB)" }], ["K7QX2M", { status: 423 }]]);
  await assert.rejects(c.usage("cloud:nope"), /not a cloud room/);
});
