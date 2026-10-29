// Where Sol's code is, and which node runs it (#169). Until now the app knew one place, the checkout it was built
// from (CARGO_MANIFEST_DIR), and one node, whatever PATH gave; a downloaded Sol.app has neither. The root is the
// checkout, the folder that holds `sol/`: first the path in the root file (`<app config dir>/root`, one line, written
// by sol/install), then the build folder when it still holds sol/engine, so Marco's and the team's own builds keep
// working with no file. No root: the main window shows the face on its first run (/?firstrun=1, src/firstrun), which runs
// the bundled install and whose last button comes back here. node is the install's own (~/.sol/node/bin/node), else a login shell's
// (what a terminal would run; an app opened from Finder has no Homebrew PATH), else `node` and PATH's luck.
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// a root is a folder that holds sol/engine
pub fn valid(root: &Path) -> bool { root.join("sol").join("engine").is_dir() }

/// The root, from the root file (a path on its first line) or the build folder; None when neither holds Sol.
pub fn resolve_root(file: Option<&Path>, build: &Path) -> Option<PathBuf> {
    if let Some(f) = file {
        if let Ok(s) = std::fs::read_to_string(f) {
            let line = s.lines().next().unwrap_or("").trim();
            if !line.is_empty() {
                let p = PathBuf::from(line);
                if p.is_absolute() && valid(&p) { return Some(p); }
            }
        }
    }
    if valid(build) { return std::fs::canonicalize(build).ok().or_else(|| Some(build.to_path_buf())); }
    None
}

/// `<app config dir>/root`, beside notch-off and face-hot
pub fn root_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("root"))
}

/// The folder this app was built from: three up from src-tauri (sol/mac/src-tauri)
fn build_dir() -> PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("..") }

/// The root for this app, read every time it is asked (the welcome page writes the file, then asks again).
pub fn root(app: &AppHandle) -> Option<PathBuf> { resolve_root(root_file(app).as_deref(), &build_dir()) }

/// a file this user may run (a stale or half-written node is passed over, the next candidate wins)
fn runnable(p: &Path) -> bool {
    p.is_file() && std::fs::metadata(p).map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

/// node, in order: `<home>/.sol/node/bin/node`, what `shell` finds, `node`; each only when it can be run.
pub fn node_path(home: Option<&Path>, shell: impl FnOnce() -> Option<PathBuf>) -> PathBuf {
    if let Some(h) = home {
        let own = h.join(".sol").join("node").join("bin").join("node");
        if runnable(&own) { return own; }
    }
    if let Some(p) = shell() { if p.is_absolute() && runnable(&p) { return p; } }
    PathBuf::from("node")
}

/// what a login shell would run as node: `/bin/zsh -lc 'command -v node'` (the person's PATH, Homebrew and all)
fn shell_node() -> Option<PathBuf> {
    let out = Command::new("/bin/zsh").args(["-lc", "command -v node"]).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let line = s.lines().last()?.trim();
    if out.status.success() && line.starts_with('/') { Some(PathBuf::from(line)) } else { None }
}

/// The node this app runs the engine and Vite with, found once and kept; `node_again` forgets it.
static NODE: Mutex<Option<PathBuf>> = Mutex::new(None);
pub fn node() -> PathBuf {
    NODE.lock().unwrap().get_or_insert_with(|| node_path(std::env::var_os("HOME").map(PathBuf::from).as_deref(), shell_node)).clone()
}

/// Forget the node found before, so the next ask looks again: the first run asks for it at Set up, before the
/// install has put one in ~/.sol/node, and Open Sol would otherwise start the engine with PATH's luck (#375).
pub fn node_again() { *NODE.lock().unwrap() = None; }

/// A PATH for the engine and Vite: node's own folder first, then the usual places (an app opened from Finder has
/// only /usr/bin:/bin, and the engine starts git, claude and codex from PATH).
pub fn path_env() -> String {
    let base = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    let mut dirs: Vec<String> = Vec::new();
    let node = node();
    if let Some(d) = node.parent().filter(|d| d.is_absolute()) { dirs.push(d.to_string_lossy().into_owned()); }
    if let Some(h) = std::env::var_os("HOME") { dirs.push(format!("{}/.local/bin", h.to_string_lossy())); }
    dirs.push(base.to_string());
    dirs.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sol-root-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn checkout(at: &Path) { fs::create_dir_all(at.join("sol").join("engine")).unwrap(); }

    #[test]
    fn the_root_file_wins_when_it_names_a_checkout() {
        let d = tmp("file");
        let (a, b) = (d.join("a"), d.join("b"));
        checkout(&a); checkout(&b);
        let f = d.join("root");
        fs::write(&f, format!("{}\n", a.display())).unwrap();
        assert_eq!(resolve_root(Some(&f), &b), Some(a.clone()));
        // a file that names a folder with no Sol in it is ignored, and the build folder stands
        fs::write(&f, format!("{}\n", d.join("gone").display())).unwrap();
        assert_eq!(resolve_root(Some(&f), &b), Some(fs::canonicalize(&b).unwrap()));
        // an empty file, a missing file, a relative path: the same
        fs::write(&f, "\n").unwrap();
        assert_eq!(resolve_root(Some(&f), &b), Some(fs::canonicalize(&b).unwrap()));
        fs::write(&f, "a\n").unwrap();
        assert_eq!(resolve_root(Some(&f), &b), Some(fs::canonicalize(&b).unwrap()));
        assert_eq!(resolve_root(Some(&d.join("none")), &b), Some(fs::canonicalize(&b).unwrap()));
        assert_eq!(resolve_root(None, &b), Some(fs::canonicalize(&b).unwrap()));
    }

    #[test]
    fn no_root_when_neither_holds_sol() {
        let d = tmp("none");
        let f = d.join("root");
        fs::write(&f, format!("{}\n", d.join("x").display())).unwrap();
        assert_eq!(resolve_root(Some(&f), &d.join("build")), None);
        assert_eq!(resolve_root(None, &d.join("build")), None);
        // a folder with sol/ but no engine is not a root (a half clone)
        fs::create_dir_all(d.join("half").join("sol")).unwrap();
        assert_eq!(resolve_root(None, &d.join("half")), None);
    }

    #[test]
    fn node_is_the_installs_own_then_the_shells_then_path() {
        let d = tmp("node");
        let home = d.join("home");
        let own = home.join(".sol").join("node").join("bin").join("node");
        let brew = d.join("brew").join("node");
        fs::create_dir_all(brew.parent().unwrap()).unwrap();
        fs::write(&brew, "").unwrap();
        // a file nobody may run is passed over (a half-written node); runnable, the shell's node wins
        assert_eq!(node_path(Some(&home), || Some(brew.clone())), PathBuf::from("node"));
        fs::set_permissions(&brew, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(node_path(Some(&home), || Some(brew.clone())), brew);
        // the shell names nothing, or something that is not there: plain node
        assert_eq!(node_path(Some(&home), || None), PathBuf::from("node"));
        assert_eq!(node_path(Some(&home), || Some(d.join("missing"))), PathBuf::from("node"));
        assert_eq!(node_path(Some(&home), || Some(PathBuf::from("node"))), PathBuf::from("node"));
        assert_eq!(node_path(None, || None), PathBuf::from("node"));
        // the install's own node comes first, and the shell is not even asked
        fs::create_dir_all(own.parent().unwrap()).unwrap();
        fs::write(&own, "").unwrap();
        fs::set_permissions(&own, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(node_path(Some(&home), || panic!("the shell was asked")), own);
    }
}
