// Own: the helper answers for itself to macOS's permission system.
//
// macOS asks permission (microphone, system audio) of the "responsible process": the first process in the
// chain that launchd started. The engine's chain is launchd > bash (keep) > node > listen, so the question
// went to /bin/bash, which can never be allowed: the ask was refused silently, whatever the person had ticked in
// System Settings. The fix is the one Chrome and Zoom use for their helpers: the helper starts itself once
// more with the "disclaim" flag, which makes the new copy responsible for itself. From then on macOS knows
// the asker as "Sol listen" (the identifier in the code signature, sol.listen), shows that name in the
// prompt and in System Settings, and the row stays valid across rebuilds as long as the signature's identity
// is the same (build-listen.sh signs with this Mac's Apple Development certificate when the keychain has one).
//
// The first copy only waits: it passes stdin/stdout/stderr through, forwards SIGTERM and SIGINT, and exits
// with the child's status. SOL_LISTEN_OWN=1 in the environment marks the copy that is already its own.

import Foundation

@_silgen_name("responsibility_spawnattrs_setdisclaim")
private func responsibility_spawnattrs_setdisclaim(_ attrs: UnsafeMutablePointer<posix_spawnattr_t?>, _ disclaim: Int32) -> Int32

private var ownChild: pid_t = 0

/// Starts this helper again as its own responsible process and waits for it; returns only when this copy
/// already is (or when the restart failed, saying so, and the helper goes on as it is).
func becomeOwn() {
    let env = ProcessInfo.processInfo.environment
    if env["SOL_LISTEN_OWN"] == "1" { return }
    guard let exe = Bundle.main.executablePath ?? CommandLine.arguments.first else { return }

    var attr: posix_spawnattr_t? = nil
    guard posix_spawnattr_init(&attr) == 0 else { return }
    defer { posix_spawnattr_destroy(&attr) }
    if responsibility_spawnattrs_setdisclaim(&attr, 1) != 0 {
        say("could not disclaim responsibility; macOS may ask the wrong process for permission")
    }

    let args = CommandLine.arguments
    var cArgs: [UnsafeMutablePointer<CChar>?] = args.map { strdup($0) } + [nil]
    var cEnv: [UnsafeMutablePointer<CChar>?] = env.filter { $0.key != "SOL_LISTEN_OWN" }.map { strdup("\($0.key)=\($0.value)") }
        + [strdup("SOL_LISTEN_OWN=1"), nil]
    defer { cArgs.forEach { free($0) }; cEnv.forEach { free($0) } }

    var pid: pid_t = 0
    let rc = posix_spawn(&pid, exe, nil, &attr, &cArgs, &cEnv)
    if rc != 0 {
        say("could not start as its own process (\(String(cString: strerror(rc)))); going on as it is")
        return
    }
    ownChild = pid
    // the engine ends the talk with SIGTERM (after closing stdin, which the child shares): hand it on
    for s in [SIGTERM, SIGINT, SIGHUP] {
        signal(s) { sig in if ownChild > 0 { kill(ownChild, sig) } }
    }
    var status: Int32 = 0
    while waitpid(pid, &status, 0) == -1 && errno == EINTR {}
    let exited = (status & 0x7f) == 0
    exit(exited ? (status >> 8) & 0xff : 1)
}
