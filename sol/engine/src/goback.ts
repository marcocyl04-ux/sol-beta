// Go back (#18, 2026-10-17): the button in Settings → engine. One step back for the face and the engine, through the
// same script Marco runs from Terminal when the engine is down (sol/back). `plan` reads what a click would do, in
// words the row shows live; `goBack` runs it with --no-restart and the engine then ends itself, on purpose and at
// once (not at a quiet moment: this is for when Sol is broken), so its keeper brings the good build up and every
// window reconnects. Only Sol's own windows may ask.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const run = promisify(execFile);
export type GoBackPlan = { engine: string | null; face: string | null; line: string };

function words(out: string): GoBackPlan {
  let engine: string | null = null, face: string | null = null;
  for (const l of out.split("\n")) {
    const [k, ...rest] = l.trim().split(" ");
    if (k === "engine") engine = rest[0] === "none" ? null : rest[0];
    else if (k === "face") {
      if (rest[0] === "dirty") face = `its ${rest[1]} unsaved edit${rest[1] === "1" ? "" : "s"}, set aside`;
      else if (rest[0] === "mutate") face = `its last change: ${rest.slice(2).join(" ")}`;
    }
  }
  const parts: string[] = [];
  if (engine) parts.push(`the engine to its good build of ${new Date(engine).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  if (face) parts.push(`the face: ${face}`);
  const line = parts.length ? parts.join("; ") + ". It ends what is running." : "nothing to go back to: no good build is kept and the face has no change of Sol's";
  return { engine, face, line };
}

export async function plan(sol: string): Promise<GoBackPlan> {
  try {
    const { stdout } = await run("bash", [resolve(sol, "back"), "--plan"], { timeout: 10_000 });
    return words(stdout);
  } catch (err) {
    return { engine: null, face: null, line: `could not read the plan: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
  }
}

// runs sol/back --no-restart; resolves with its lines (the window shows them); the caller ends the engine after
export async function goBack(sol: string): Promise<{ ok: boolean; lines: string[] }> {
  try {
    const { stdout } = await run("bash", [resolve(sol, "back"), "--no-restart"], { timeout: 30_000 });
    return { ok: true, lines: stdout.split("\n").filter(Boolean).map((l) => l.replace(/^back: /, "")) };
  } catch (err: any) {
    const out = String(err?.stdout ?? "") + String(err?.stderr ?? "");
    return { ok: false, lines: out.split("\n").filter(Boolean).map((l) => l.replace(/^back: /, "")) };
  }
}
