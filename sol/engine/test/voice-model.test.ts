// Dictation on a tester's Mac: the speech model is not in the install (#169), so the engine fetches it once, the first
// time the mic is used, on its own; the clip that started it is told so at once. A failed fetch leaves no half file and
// says why in words a tester can act on; a page a network answers with (a captive portal) is never taken for the model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const top = mkdtempSync(join(tmpdir(), "sol-voice-"));
const bin = join(top, "bin"); const home = join(top, "home");
mkdirSync(bin, { recursive: true });
// a stand-in whisper-cli: prints the model's first bytes and a word, the way whisper prints its transcript
writeFileSync(join(bin, "whisper-cli"), `#!/bin/sh\nm=""; while [ $# -gt 0 ]; do [ "$1" = "-m" ] && m="$2"; shift; done\nhead -c 4 "$m"; echo " heard"\n`);
chmodSync(join(bin, "whisper-cli"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
const { transcribe } = await import("../src/voice.ts");
const wav = Buffer.from("RIFF....WAVEfmt ").toString("base64");
const voice = join(home, "voice");
const model = join(voice, "ggml-base.en.bin");
// voice.ts puts Homebrew's bin first on its PATH: with a real whisper there, it runs instead of the stand-in (and fails on
// the fake model), so the transcript is only checked where the stand-in is the one found
const realWhisper = ["/opt/homebrew/bin", "/usr/local/bin"].some((d) => existsSync(join(d, "whisper-cli")) || existsSync(join(d, "whisper-cpp")));
const parts = () => readdirSync(voice).filter((f) => f.endsWith(".part"));
const settled = async () => { for (let i = 0; i < 200 && parts().length; i++) await sleep(20); await sleep(80); };

test("the model is fetched once, on its own; a failed or false fetch leaves no half file and is said", async () => {
  const calls: string[] = [];
  const real = globalThis.fetch;
  const answer = (body: string | null, status: number) => { globalThis.fetch = (async (url: string | URL | Request) => { calls.push(String(url)); return new Response(body, { status }); }) as typeof fetch; };
  try {
    answer(null, 503);
    let r = await transcribe(home, wav);
    assert.equal(r.text, "");
    assert.match(r.why ?? "", /^fetching the speech model once \(148 MB\)/, "the first clip is told at once, not after 148 MB");
    await settled();
    assert.ok(!existsSync(model), "no model");
    assert.deepEqual(parts(), [], "and no half file");
    r = await transcribe(home, wav);
    assert.match(r.why ?? "", /the last try failed: could not fetch the speech model: 503 from huggingface\.co/, "the next clip says why the last try failed, and tries again");
    await settled();

    answer("<html>sign in to the hotel wifi</html>", 200);
    r = await transcribe(home, wav);
    await settled();
    assert.ok(!existsSync(model), "a page is not a model");
    assert.deepEqual(parts(), []);
    r = await transcribe(home, wav);
    assert.match(r.why ?? "", /not a whisper model \(a sign-in page on this network\?\)/);
    await settled();

    answer("lmgg MODEL bytes", 200);
    const before = calls.length;
    const two = await Promise.all([transcribe(home, wav), transcribe(home, wav)]);
    assert.ok(two.every((x) => /^fetching the speech model/.test(x.why ?? "")), "two clips at once: both told");
    await settled();
    assert.equal(calls.length - before, 1, "one fetch for the two");
    assert.equal(readFileSync(model, "utf8"), "lmgg MODEL bytes", "the model is fetched and in place");
    assert.deepEqual(parts(), [], "no half file after success");

    globalThis.fetch = (async (url: string | URL | Request) => { calls.push(String(url)); throw new Error("no fetch expected: the model is there"); }) as typeof fetch;
    const fetched = calls.length;
    r = await transcribe(home, wav);
    assert.equal(calls.length, fetched, "the next clip never fetches");
    if (!realWhisper) { assert.equal(r.why, undefined, r.why); assert.equal(r.text, "lmgg heard", "whisper ran on the fetched model"); }
    assert.match(calls[0], /huggingface\.co\/ggerganov\/whisper\.cpp.*ggml-base\.en\.bin/);
  } finally { globalThis.fetch = real; rmSync(top, { recursive: true, force: true }); }
});
