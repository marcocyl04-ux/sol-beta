// The app's own commands get permissions (an ACL manifest) so the pages may call them when they are served by Vite
// (mutable mode, http://localhost:1420): Tauri refuses custom commands from a non-bundled origin unless a capability
// with a `remote` URL allows them. Once a manifest exists the bundled pages need them listed too (capabilities/).
const COMMANDS: &[&str] = &["engine_port", "notch_expand", "notch_geometry", "notch_regions", "face_log", "face_mode", "face_state", "type_text", "grab_sheet", "page_scroll", "permit_state", "permit_open", "permit_back", "eye_set", "eye_get", "clean_open", "clean_set", "clean_close", "clean_get", "call_mute", "vibe_start", "vibe_stop", "vibe_glow",
    "thing_open", "thing_show", "thing_bounds", "thing_close", "thing_nav", "thing_outside", "sites_sign_out", "sites_clear", "sol_url_take",
    // the first run (welcome.rs) and the engine's plug (lib.rs): missing here, the bundled app refused them all ("not allowed by ACL", the first run of 29 Oct)
    "install_run", "claude_login", "claude_status", "codex_login", "codex_status", "claude_install", "welcome_done", "engine_start", "engine_phase", "idle_seconds"];

// The vibe tap (vibe/tap.swift, src/vibe.rs): a Swift helper that hears what the Mac plays, compiled here with the
// command line tools' swiftc into OUT_DIR, where vibe.rs includes it. Not a Mac: an empty file, and vibe_start says so.
fn vibe_tap() {
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("vibe-tap");
    println!("cargo:rerun-if-changed=vibe/tap.swift");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        std::fs::write(&out, []).unwrap();
        return;
    }
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() { Ok("aarch64") => "arm64", _ => "x86_64" };
    let st = std::process::Command::new("swiftc")
        .args(["-O", "-swift-version", "5", "-target", &format!("{arch}-apple-macosx14.2"), "-framework", "CoreAudio", "-o"])
        .arg(&out)
        .arg("vibe/tap.swift")
        .status()
        .expect("swiftc is needed to build the vibe tap (xcode-select --install)");
    assert!(st.success(), "vibe/tap.swift does not build");
}

fn main() {
    vibe_tap();
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
