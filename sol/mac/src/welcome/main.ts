// The welcome page (#169): what Sol.app shows when it has no code to run (a downloaded app, before its install;
// sol/mac/src-tauri/src/root.rs). One column: Sol, a name, an optional Gemini key, Set up. Set up runs the bundled
// sol/install through the app (welcome.rs) and shows four steps, each waiting, running or done: Getting Sol, Getting
// Node, Setting up the engine, Sign in to Claude. The install's own lines are a log behind "details", closed unless a
// step fails; a failed step says the last real error line, with Try again. Then Sign in to Claude (Terminal on
// `claude auth login`) and Open Sol (the root read again, the engine started, the face loaded). Plain TypeScript, no
// React: the face's packages are not needed to say hello.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./welcome.css";

const STEPS = [
  { id: "sol", what: "Getting Sol" },
  { id: "node", what: "Getting Node" },
  { id: "engine", what: "Setting up the engine (a minute or two)" },
  { id: "claude", what: "Sign in to Claude" },
] as const;
type Step = (typeof STEPS)[number]["id"];
type State = "waiting" | "running" | "done" | "failed";

const root = document.getElementById("root")!;
root.innerHTML = `
  <main class="welcome">
    <h1>Sol</h1>
    <p class="lead">One window for all your AI. A few minutes to set up, once.</p>
    <form id="form">
      <label>what should we call you?
        <input id="name" autocomplete="name" autofocus spellcheck="false" />
      </label>
      <label style="margin-top:12px">a Gemini API key, if you have one
        <input id="gemini" type="password" autocomplete="off" spellcheck="false" />
        <span class="hint">optional: calls and conversation names · <a id="aistudio" href="#">aistudio.google.com/apikey</a></span>
      </label>
      <div class="row" style="margin-top:16px"><button id="setup" type="submit" disabled>Set up</button></div>
    </form>
    <ol id="steps" class="steps hidden">${STEPS.map((s) => `<li id="step-${s.id}" class="waiting"><span class="mark"></span><span class="what">${s.what}<span class="sub"></span></span></li>`).join("")}</ol>
    <p id="failed" class="wnote failed hidden"></p>
    <div id="retry" class="row hidden"><button id="again" class="quiet" type="button">Try again</button></div>
    <div id="after" class="row hidden">
      <button id="claude" class="quiet" type="button">Sign in to Claude</button>
      <button id="open" type="button">Open Sol</button>
    </div>
    <p id="word" class="wnote hidden"></p>
    <details id="details" class="hidden"><summary>details</summary><pre id="log"></pre></details>
  </main>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("form"), name = $<HTMLInputElement>("name"), gemini = $<HTMLInputElement>("gemini");
const setup = $<HTMLButtonElement>("setup"), steps = $("steps"), failed = $("failed"), after = $("after");
const retry = $("retry"), word = $("word"), details = $<HTMLDetailsElement>("details"), log = $("log");

const show = (el: HTMLElement, on: boolean) => el.classList.toggle("hidden", !on);
const state: Record<Step, State> = { sol: "waiting", node: "waiting", engine: "waiting", claude: "waiting" };
let running: Step | null = null;   // the step the install is in now
let misses: string[] = [];
function set(id: Step, s: State, sub = "") {
  state[id] = s;
  const el = $(`step-${id}`);
  el.className = s;
  el.querySelector(".sub")!.textContent = sub ? ` ${sub}` : "";
}
function start(id: Step) {
  if (running && running !== id && state[running] === "running") set(running, "done");
  running = id;
  if (state[id] !== "done") set(id, "running");
}
// one line of the install, read for the step it belongs to; every line goes to the log
function line(l: string) {
  log.textContent += l + "\n";
  let m: RegExpExecArray | null;
  if ((m = /^ {2}MISS {2}(.*)$/.exec(l))) { misses.push(m[1]); return; }
  if (/^(install|setup): (fetching Node)/.test(l)) { start("node"); return; }
  if (/^(install|setup): cloning Sol/.test(l)) { start("sol"); return; }
  if (/^install: bash sol\/setup/.test(l)) { start("engine"); return; }
  if (/^install: Claude Code: sign in/.test(l)) { start("claude"); return; }
  if (/^install: .*developer tools.*waits/.test(l)) { set("sol", "running", "(click Install in the window Apple opened; this waits for it)"); return; }
  if ((m = /^ {2}ok {4}(.*)$/.exec(l))) {
    const t = m[1];
    if (/^Node v[\d.]+ in /.test(t)) set("node", "done");
    else if (/^Sol is in /.test(t)) set("sol", "done");
    else if (/^(sol\/setup done|the engine answers on )/.test(t)) set("engine", "done");
    else if (/^Claude Code, signed in/.test(t)) set("claude", "done");
  }
}
// the last line that says what went wrong: a MISS that is not the install's own wrapper around setup's exit
const WRAP = /^(sol\/setup ended with|the engine does not answer on)/;
const cause = () => [...misses].reverse().find((m) => !WRAP.test(m)) ?? misses[misses.length - 1];
function done(code: number) {
  setup.disabled = false;
  const stopped = code !== 0 && state.engine !== "done";
  if (!stopped) {
    for (const s of STEPS) if (state[s.id] === "running") set(s.id, "done");
    if (state.claude === "running") set("claude", "waiting");
    show(after, true);
    word.textContent = state.claude === "done" ? "Sol is set up. Open it." : "Sol is set up. Sign in to Claude (it opens Terminal and your browser), then open Sol.";
    show(word, true);
    return;
  }
  const at = running ?? "sol";
  set(at, "failed");
  failed.textContent = cause() ?? `the install ended with ${code} and said nothing`;
  show(failed, true);
  show(retry, true);
  details.open = true;
  log.scrollTop = log.scrollHeight;   // the log open on its end, where the error is
}
async function run() {
  setup.disabled = true; misses = []; running = null;
  for (const s of STEPS) set(s.id, "waiting");
  log.textContent = ""; details.open = false;
  show(steps, true); show(details, true); show(failed, false); show(retry, false); show(after, false); show(word, false);
  start("sol");
  try { await invoke("install_run", { name: name.value, gemini: gemini.value }); }
  catch (e) { setup.disabled = false; set("sol", "failed"); failed.textContent = String(e); show(failed, true); show(retry, true); }
}
name.addEventListener("input", () => { setup.disabled = name.value.trim() === ""; });
form.addEventListener("submit", (e) => { e.preventDefault(); if (name.value.trim()) void run(); });
$("again").addEventListener("click", () => void run());
$("claude").addEventListener("click", () => {
  invoke("claude_login").then(() => { word.textContent = "Terminal is open on the sign-in; come back here when it says you are in."; show(word, true); })
    .catch((e) => { word.textContent = String(e); show(word, true); });
});
$("open").addEventListener("click", () => {
  invoke("welcome_done").catch((e) => { word.textContent = String(e); show(word, true); });
});
$("aistudio").addEventListener("click", (e) => { e.preventDefault(); void import("@tauri-apps/plugin-opener").then((o) => o.openUrl("https://aistudio.google.com/apikey")).catch(() => {}); });
void listen<{ line: string }>("install-line", (e) => line(e.payload.line));
void listen<{ code: number }>("install-done", (e) => done(e.payload.code));

// a harness for the look (vite, ?demo=mid|failed): the steps as they stand mid-run and after a failed one, no app behind it
const demo = new URLSearchParams(location.search).get("demo");
if (demo) {
  name.value = "Ada"; setup.disabled = true;
  show(steps, true); show(details, true); start("sol");
  const feed = ["== Sol", "  ok    Sol goes to ~/Sol", "  ok    Apple's developer tools", "  ok    you are Ada; your branch will be ada/mine",
    "  skip  no Gemini key yet", "install: fetching Node v24.22.1 (nodejs.org, about 50 MB)", "  ok    Node v24.22.1 in ~/.sol/node, checksum verified",
    "install: cloning Sol into ~/Sol", "  ok    Sol is in ~/Sol, on ada/mine (yours: commits there get \"mine: \" in front)", "  ok    Sol.app will run this folder (the root file)",
    "  skip  Claude Code is not signed in yet: Sign in to Claude, or in Terminal: claude auth login",
    "install: bash sol/setup (a few minutes: packages, the engine built and tested, its job)", "== what this Mac needs", "  ok    Node v24.22.1", "  ok    Xcode command line tools",
    "  ok    Rust: optional, the face is not built here", "  ok    the GitHub CLI: optional, no GitHub account is needed", "== build", "setup: installing the engine's packages (a minute or two)"];
  for (const l of feed) line(l);
  if (demo === "failed") {
    for (const l of ["  ok    engine packages", "  ok    engine built", "== the engine (port 7777)", "  MISS  the engine did not answer in 30 s; read sol/engine/.setup-engine.log",
      "  MISS  sol/setup ended with 1 (its lines above say what is missing); run it again any time: cd ~/Sol && bash sol/setup",
      "  MISS  the engine does not answer on 7777; nothing more is installed until it does"]) line(l);
    done(1);
  }
}
