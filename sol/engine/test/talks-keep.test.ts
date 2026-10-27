// engine/talks (#280): talks.keep takes only a talk's name, as every other talks.* ask does. A name with a slash or
// ".." is refused before anything is read; a talk's own name still keeps it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTalks, setTalks } from "../src/talks.ts";
import { setAnticipate } from "../src/anticipate.ts";

const home = mkdtempSync(join(tmpdir(), "sol-talks-keep-"));
const talks = join(home, "voice", "talks");
mkdirSync(talks, { recursive: true });
const NAME = "20261025-120000.jsonl";
const TALK = [
  JSON.stringify({ started: "2026-10-25T12:00:00Z" }),
  JSON.stringify({ who: "them", text: "Numbers by Friday?", at: Date.parse("2026-10-25T12:00:10Z") / 1000, seconds: 2 }),
  JSON.stringify({ type: "recap", lines: ["Numbers by Friday."] }),
].join("\n") + "\n";
writeFileSync(join(talks, NAME), TALK);
// a file outside the talks folder that parses as a talk: the old keep would have read it and written `kept` into it
const outside = join(home, "outside.jsonl");
writeFileSync(outside, TALK);

setTalks(home, () => {});
setAnticipate(home, home, () => {});
const said: string[] = [];
const say = async (text: string) => { said.push(text); return { text: "ok", sessionId: "s1" }; };

async function ask(file: string) {
  let got: any;
  await handleTalks({ send: (m: object) => { got = m; } } as any, { type: "talks.keep", rid: 1, file }, say);
  return got;
}

test("talks.keep refuses a name with a slash or .. and reads nothing", async () => {
  for (const file of [outside, "/etc/hosts", "../outside.jsonl", `../../${NAME}`, "x/" + NAME]) {
    assert.deepEqual(await ask(file), { type: "talks.keep", rid: 1, error: "no such talk" }, file);
  }
  assert.equal(readFileSync(outside, "utf8"), TALK);   // no `kept` line written outside
  assert.equal(existsSync(join(home, "memory", "talks.md")), false);
  assert.equal(said.length, 0);
});

test("talks.keep still keeps a talk by its name, once", async () => {
  assert.deepEqual(await ask(NAME), { type: "talks.keep", rid: 1, ok: true });
  assert.match(readFileSync(join(talks, NAME), "utf8"), /\{"type":"kept"\}\n$/);
  assert.match(readFileSync(join(home, "memory", "talks.md"), "utf8"), /Numbers by Friday\./);
  assert.equal(said.length, 1);
  assert.deepEqual(await ask(NAME), { type: "talks.keep", rid: 1, ok: true });
  assert.equal(said.length, 1);   // kept before: nothing said again
});
