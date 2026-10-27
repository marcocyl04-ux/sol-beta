// The install behind the first run (#134, #169): the bundled sol/install run by the app (src-tauri/src/welcome.rs
// install_run), its lines read for where it is. The page shows it as one thin colour line and a phrase, never a
// list: the person is meeting the creature while this runs. What the old welcome page parsed (the four steps: Sol,
// Node, the engine, Claude) is kept here, as a fraction of the line and the phrase under it; the raw lines are kept
// for the day a step fails, when the page opens them.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Install = { frac: number; phrase: string; failed: string | null; done: boolean; lines: string[]; signedIn: boolean };
type Step = "sol" | "node" | "engine" | "claude";
// where each step starts on the line and what the page says while it runs
const AT: Record<Step, [number, string]> = {
  sol: [0.04, "getting Sol"], node: [0.22, "getting Node"], engine: [0.42, "setting up the engine, a minute or two"], claude: [0.94, "nearly there"],
};
const ORDER: Step[] = ["sol", "node", "engine", "claude"];
const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function startInstall(name: string, onChange: (s: Install) => void): () => void {
  const st: Install = { frac: 0.02, phrase: "setting myself up", failed: null, done: false, lines: [], signedIn: false };
  let running: Step | null = null;
  const misses: string[] = [];
  const doneSteps = new Set<Step>();
  let creep: number | undefined;
  const tell = () => onChange({ ...st, lines: [...st.lines] });
  const start = (s: Step) => { if (running && running !== s) doneSteps.add(running); running = s; st.frac = Math.max(st.frac, AT[s][0]); st.phrase = AT[s][1]; tell(); };
  const end = (s: Step) => { doneSteps.add(s); const i = ORDER.indexOf(s); st.frac = Math.max(st.frac, i + 1 < ORDER.length ? AT[ORDER[i + 1]][0] : 1); tell(); };
  const line = (l: string) => {
    st.lines.push(l);
    let m: RegExpExecArray | null;
    if ((m = /^ {2}MISS {2}(.*)$/.exec(l))) { misses.push(m[1]); return; }
    if (/^(install|setup): cloning Sol/.test(l)) return start("sol");
    if (/^(install|setup): (fetching Node)/.test(l)) return start("node");
    if (/^install: bash sol\/setup/.test(l)) return start("engine");
    if (/^install: Claude Code: sign in/.test(l)) return start("claude");
    if (/^install: .*developer tools.*waits/.test(l)) { st.phrase = "click Install in the window Apple opened; I wait for it"; tell(); return; }
    if ((m = /^ {2}ok {4}(.*)$/.exec(l))) {
      const t = m[1];
      if (/^Node v[\d.]+ in /.test(t)) end("node");
      else if (/^Sol is in /.test(t)) end("sol");
      else if (/^(sol\/setup done|the engine answers on )/.test(t)) end("engine");
      else if (/^Claude Code, signed in/.test(t)) { st.signedIn = true; end("claude"); }
    }
  };
  const WRAP = /^(sol\/setup ended with|the engine does not answer on)/;
  const finish = (code: number) => {
    window.clearInterval(creep);
    const stopped = code !== 0 && !doneSteps.has("engine");
    if (stopped) { st.failed = [...misses].reverse().find((x) => !WRAP.test(x)) ?? misses[misses.length - 1] ?? `the install ended with ${code} and said nothing`; st.phrase = "something stopped"; tell(); return; }
    st.frac = 1; st.done = true; st.phrase = "I'm all set"; tell();
  };
  // the line creeps toward the next step's mark while a step runs, so a long engine build still visibly moves
  creep = window.setInterval(() => {
    if (st.done || st.failed) return;
    const i = running ? ORDER.indexOf(running) : -1;
    const cap = i >= 0 && i + 1 < ORDER.length ? AT[ORDER[i + 1]][0] - 0.02 : 0.98;
    if (st.frac < cap) { st.frac = Math.min(cap, st.frac + (cap - st.frac) * 0.04); tell(); }
  }, 1000);
  tell();
  if (!inApp) {
    // a browser harness: the four steps pass on a clock, so the line can be seen moving
    const feed: [number, string][] = [[400, "install: cloning Sol into ~/Sol"], [2200, "  ok    Sol is in ~/Sol, on ada/mine"], [2600, "install: fetching Node v24.22.1"],
      [4800, "  ok    Node v24.22.1 in ~/.sol/node, checksum verified"], [5200, "install: bash sol/setup"], [14000, "  ok    the engine answers on 7777"], [14200, "install: Claude Code: sign in"]];
    const ts = feed.map(([ms, l]) => window.setTimeout(() => line(l), ms));
    const t = window.setTimeout(() => finish(0), 15000);
    return () => { ts.forEach(window.clearTimeout); window.clearTimeout(t); window.clearInterval(creep); };
  }
  const offs = [listen<{ line: string }>("install-line", (e) => line(e.payload.line)), listen<{ code: number }>("install-done", (e) => finish(e.payload.code))];
  invoke("install_run", { name, gemini: "" }).catch((e) => { st.failed = String(e); st.phrase = "something stopped"; tell(); });
  return () => { offs.forEach((p) => void p.then((f) => f())); window.clearInterval(creep); };
}

// the app with no code to run yet (lib.rs shows /?firstrun=1 then): the first run installs; elsewhere it only shows
export const installWanted = () => inApp && new URLSearchParams(location.search).get("firstrun") === "1";
