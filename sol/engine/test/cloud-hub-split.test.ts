// The hub on its own (#206, S1 of #168; the folder src/hub since #208): relay.ts is the engine's wiring, the client is
// relay-client.ts, and the hub with its format rules, registry, spool and proof is src/hub, which the engine builds as
// part of itself and sol/hub builds alone for the box (its src a link here). A fresh node that loads the hub and the
// client loads nothing else of the engine and exits by itself; the engine's settings and identity re-export the hub's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..");
process.env.SOL_TEAM = join(mkdtempSync(join(tmpdir(), "sol-team-")), "team.json");
process.env.SOL_TEAM_OFFLINE = "1";

// a fresh node that imports the given files and prints every engine module it loaded (a load hook sees each one)
const PROBE = join(mkdtempSync(join(tmpdir(), "sol-probe-")), "probe.mjs");
writeFileSync(PROBE, `import { registerHooks } from "node:module";
const seen = [];
registerHooks({ load(url, ctx, next) { seen.push(url); return next(url, ctx); } });
for (const f of process.argv.slice(2)) await import(new URL(f, "file://" + process.cwd() + "/").href);
console.log(JSON.stringify(seen.filter((u) => u.includes("/src/")).map((u) => u.replace(/^.*\\/src\\//, ""))));
`);
function loads(...files: string[]): string[] {
  const r = spawnSync(process.execPath, ["--import", "tsx", PROBE, ...files], { cwd: ENGINE, encoding: "utf8", timeout: 20_000,
    env: { ...process.env, SOL_TEAM: process.env.SOL_TEAM, SOL_TEAM_OFFLINE: "1" } });
  assert.equal(r.status, 0, `the probe ran and exited by itself: ${r.stderr}`);   // nothing left running holds it open
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

const ENGINE_ONLY = ["team/settings.ts", "settings.ts", "team/pings.ts", "team/record.ts", "team/identity.ts", "team/members.ts", "team/relay.ts"];

test("the hub loads alone (#206, #208): src/hub and relay-client pull in nothing else of the engine", () => {
  const got = loads("src/hub/index.ts", "src/team/relay-client.ts");
  for (const f of ENGINE_ONLY) assert.ok(!got.includes(f), `${f} was loaded: ${got.join(", ")}`);
  assert.deepEqual([...got].sort(), [...["hub/github.ts", "hub/hub-types.ts", "hub/index.ts", "hub/load.ts", "hub/proof.ts", "hub/registry.ts", "hub/relay-hub.ts", "hub/spool.ts"], "team/relay-client.ts"]);
});

test("the hub alone makes no client (#206, #208): src/hub loads only its own files, and the probe sees the engine when it loads relay.ts", () => {
  assert.deepEqual([...loads("src/hub/index.ts")].sort(), ["hub/github.ts", "hub/hub-types.ts", "hub/index.ts", "hub/load.ts", "hub/proof.ts", "hub/registry.ts", "hub/relay-hub.ts", "hub/spool.ts"]);
  // the same probe on the wiring sees the engine and the hub: the check above can fail
  const wiring = loads("src/team/relay.ts");
  for (const f of ["team/settings.ts", "team/record.ts", "team/identity.ts", "team/members.ts", "team/relay-client.ts", "hub/relay-hub.ts"]) assert.ok(wiring.includes(f), f);
});

test("sol/hub is the same source (#208): its src is a link to src/hub, so the box builds what the engine runs", async () => {
  const { lstatSync, readlinkSync, realpathSync } = await import("node:fs");
  const link = join(ENGINE, "../hub/src");
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.equal(readlinkSync(link), "../engine/src/hub");
  assert.equal(realpathSync(link), realpathSync(join(ENGINE, "src/hub")));
});

test("the format rules are the hub's (#206, #208): src/hub keeps CODE, REPO and LOGIN; settings re-exports the same ones; the registry reads hub-types", async () => {
  const H = await import("../src/hub/index.ts");
  const S = await import("../src/team/settings.ts");
  const R = H;   // the registry is the package's
  assert.equal(S.CODE, H.CODE); assert.equal(S.REPO, H.REPO); assert.equal(S.LOGIN, H.LOGIN);   // one copy, not two alike
  const src = readFileSync(join(ENGINE, "src/hub/registry.ts"), "utf8");
  assert.match(src, /from "\.\/hub-types\.js"/);
  assert.doesNotMatch(src, /from "[^"]*settings/);
  // and none of the engine's files is left behind under the old names
  for (const f of ["hub-types", "relay-hub", "registry", "spool", "proof"]) assert.throws(() => readFileSync(join(ENGINE, `src/team/${f}.ts`)), /ENOENT/, f);
  // and the registry's checks are those rules
  assert.equal(R.normalCode(" abcdef "), "ABCDEF"); assert.equal(R.normalCode("ABCDE0"), "");
  assert.throws(() => R.cleanEntryRoom({ repos: ["not a repo"] }), /owner\/name/);
  assert.throws(() => R.cleanEntryRoom({ org: "bad org!" }), /GitHub login/);
  assert.deepEqual(R.cleanEntryRoom({ repos: ["a/b"] }).repos, ["a/b"]);
});

test("the hub refuses every token when nobody handed it a way to ask GitHub (#206); identity re-exports the same gate",async () => {
  const hub = await import("../src/hub/index.ts");
  const { createServer } = await import("node:http");
  const { Registry } = hub;
  const reg = new Registry(join(mkdtempSync(join(tmpdir(), "sol-reg-")), "rooms.json"));
  const ask = async (opts: Parameters<typeof hub.relayRoutes>[3]) => {
    const routes = hub.relayRoutes(0, () => "k", reg, opts);
    const srv = createServer((req, res) => { void routes(req, res); });
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    const port = (srv.address() as { port: number }).port;
    const r = await fetch(`http://127.0.0.1:${port}/relay/rooms/ABCDEF`, { headers: { authorization: "Bearer gho_anything" } });
    srv.close();
    return r.status;
  };
  assert.equal(await ask({ open: () => true, verify: async () => "alice" }), 404);   // a verify that says yes: let in, no such room
  assert.equal(await ask({ open: () => true }), 403);   // none handed in: the same token is nobody, never a fall-through to the key
  const identity = await import("../src/team/identity.ts");
  assert.equal(identity.originOk, hub.originOk); assert.equal(identity.bearerOf, hub.bearerOf);   // moved, not copied
});
