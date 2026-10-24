// The app's own commands get permissions (an ACL manifest) so the pages may call them when they are served by Vite
// (mutable mode, http://localhost:1420): Tauri refuses custom commands from a non-bundled origin unless a capability
// with a `remote` URL allows them. Once a manifest exists the bundled pages need them listed too (capabilities/).
const COMMANDS: &[&str] = &["engine_port", "notch_expand", "notch_geometry", "face_log", "face_mode", "face_state"];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
