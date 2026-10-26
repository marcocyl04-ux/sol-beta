// listen: Sol's ears for Anticipate. A small command-line helper the engine starts on a press and
// stops on the next. It hears Marco on the mic ("you") and the other side of the call from the
// Mac's sound output ("them"), turns both into words on this Mac with Apple's speech engine, and
// prints one JSON line per turn on stdout:
//   {"who":"you"|"them","text":"...","final":true|false,"at":<unix seconds>,"seconds":<length>,"lang":"en-US"}
// A partial line (final:false) is replaced by the next line of the same side. Stderr carries plain
// sentences: "ready", the devices chosen, and any permission that is missing. Nothing is ever written
// to disk. It stops on SIGTERM, Ctrl-C or when stdin closes, sending the last turn first; exit 0.
// On a Mac older than macOS 26 it prints {"error":"needs macOS 26"} and exits 3, so the engine
// can fall back to whisper clips.
//
//   listen [--mic-only | --them-only] [--locale en-US,zh-CN] [--echo-cancel] [--exclude-pid N]...
//     --locale: the languages heard, one to three codes separated by commas; without it, the languages
//     of this Mac (System Settings > Language & Region), three at most. Every side is heard in all of
//     them at once; each turn keeps the one it was said in (Lane.swift).
//     --echo-cancel: Apple's voice processing on the mic (the speakers taken out of it). Off unless asked:
//     tried 2026-10-26 with a clip through the speakers, the mic heard the clip garbled and the output tap
//     heard nothing for the whole run; the echo rule in Output.swift does the work alone until it is
//     understood.
//   listen --wav file.wav [--wav-mic]   test without a call: the file plays as "them" (and, with
//                                       --wav-mic, also as "you" 300 ms later, to try the echo rule)
//   LISTEN_DEBUG=1 in the environment adds the steps of each turn's close to stderr.

import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

struct Options {
    var micOnly = false, themOnly = false, wavMic = false, echoCancel = false
    var locale: String?
    var wav: String?
    var exclude: [pid_t] = []
}

func usage() -> Never {
    say("usage: listen [--mic-only | --them-only] [--locale xx-XX[,yy-YY]] [--echo-cancel] [--exclude-pid N]... | --wav file.wav [--wav-mic]")
    exit(64)
}

var opts = Options()
var argv = CommandLine.arguments.dropFirst().makeIterator()
while let a = argv.next() {
    switch a {
    case "--mic-only": opts.micOnly = true
    case "--them-only": opts.themOnly = true
    case "--wav-mic": opts.wavMic = true
    case "--echo-cancel": opts.echoCancel = true
    case "--locale": guard let v = argv.next() else { usage() }; opts.locale = v
    case "--wav": guard let v = argv.next() else { usage() }; opts.wav = v
    case "--exclude-pid": guard let v = argv.next(), let p = pid_t(v) else { usage() }; opts.exclude.append(p)
    default: usage()
    }
}
if opts.micOnly && opts.themOnly { usage() }

// macOS asks permission of the process launchd started (bash, for the engine): answer for ourselves (Own.swift)
becomeOwn()

guard #available(macOS 26, *) else {
    emitLine("{\"error\":\"needs macOS 26\"}")
    say("listen needs macOS 26 for Apple's on-device speech engine; this Mac is older.")
    exit(3)
}

/// The languages to hear: the codes asked for (comma-separated), else this Mac's languages; each one the
/// speech engine supports, without doubles, three at most; en-US when none of them is supported.
@available(macOS 26, *)
func resolveLocales(_ asked: String?) async -> [Locale] {
    let wanted = asked.map { $0.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }
        ?? Locale.preferredLanguages
    var out: [Locale] = []
    for w in wanted {
        guard let l = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: w)) else {
            say("the speech engine has no \(w); skipped"); continue
        }
        if out.contains(where: { $0.identifier(.bcp47) == l.identifier(.bcp47) }) { continue }
        out.append(l)
        if out.count >= 3 { break }
    }
    if out.isEmpty, let en = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "en-US")) {
        say("none of the asked languages is supported; hearing en-US")
        out.append(en)
    }
    return out
}

/// Makes sure the speech model for the locale is on the Mac; downloads it once if not.
@available(macOS 26, *)
func ensureModel(_ locale: Locale) async throws {
    let probe = SpeechTranscriber(locale: locale, preset: .transcription)
    let status = await AssetInventory.status(forModules: [probe])
    if status == .installed { return }
    if status == .unsupported { throw NSError(domain: "listen", code: 4, userInfo: [NSLocalizedDescriptionKey: "no speech model for \(locale.identifier)"]) }
    if let req = try await AssetInventory.assetInstallationRequest(supporting: [probe]) {
        say("downloading the speech model for \(locale.identifier) (once)")
        try await req.downloadAndInstall()
        say("speech model installed")
    }
}

/// Fills a buffer with true silence (a fresh buffer is not promised to be zero).
func silence(_ b: AVAudioPCMBuffer) {
    b.frameLength = b.frameCapacity
    let abl = UnsafeMutableAudioBufferListPointer(b.mutableAudioBufferList)
    for buf in abl { if let d = buf.mData { memset(d, 0, Int(buf.mDataByteSize)) } }
}

@available(macOS 26, *)
func runWav(_ path: String, locales: [Locale], out: Output) async throws {
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    let them = try await Lane.make(who: "them", locales: locales, out: out)
    let you = opts.wavMic ? try await Lane.make(who: "you", locales: locales, out: out) : nil
    let t0 = Date().timeIntervalSince1970
    them.queue.sync { them.wallStart = t0 }
    you?.queue.sync { you!.wallStart = t0 }
    say("ready (wav: \(path), \(Int(file.processingFormat.sampleRate)) Hz\(you != nil ? ", also as you +300 ms" : ""))")
    let fmt = file.processingFormat
    let chunk = AVAudioFrameCount(fmt.sampleRate / 10)
    // The mic copy starts with 300 ms of silence, then the same sound, fed side by side in time order.
    if let you, let pad = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(fmt.sampleRate * 0.3)) {
        silence(pad)
        you.queue.sync { you.feed(pad) }
    }
    while file.framePosition < file.length {
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: chunk) else { break }
        try file.read(into: buf, frameCount: AVAudioFrameCount(min(Int64(chunk), file.length - file.framePosition)))
        if buf.frameLength == 0 { break }
        them.queue.sync { them.feed(buf) }
        if let you { you.queue.sync { you.feed(buf) } }
        try? await Task.sleep(nanoseconds: 2_000_000)  // let the engine keep pace, faster than real time
    }
    // A little trailing silence so the last turn closes the ordinary way.
    if let tail = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(fmt.sampleRate * 1.5)) {
        silence(tail)
        them.queue.sync { them.feed(tail) }
        if let you { you.queue.sync { you.feed(tail) } }
    }
    async let a: Void = them.finish()
    async let b: Void = { if let you { await you.finish() } }()
    _ = await (a, b)
}

@available(macOS 26, *)
func runLive(locales: [Locale], out: Output) async throws {
    var lanes: [Lane] = []
    var mic: Mic?
    var tap: Tap?
    if !opts.themOnly, await Mic.permitted() {
        let lane = try await Lane.make(who: "you", locales: locales, out: out)
        let m = Mic()
        do { try m.start(into: lane, echoCancel: opts.echoCancel); mic = m; lanes.append(lane); lane.startWatchdog() }
        catch { say("you: \(error.localizedDescription); listening to the other side only") }
    }
    if !opts.micOnly {
        let lane = try await Lane.make(who: "them", locales: locales, out: out)
        let t = Tap(lane: lane, exclude: opts.exclude)
        do { try t.start(); tap = t; lanes.append(lane); lane.startWatchdog() }
        catch { say("them: \(error.localizedDescription)") }
    }
    if lanes.isEmpty {
        say("nothing to listen to: neither the microphone nor the sound output could be opened")
        exit(2)
    }

    // Stop on SIGTERM, Ctrl-C, or stdin closing; whichever comes first.
    let (stops, stopC) = AsyncStream<String>.makeStream()
    var sources: [DispatchSourceSignal] = []
    for sig in [SIGTERM, SIGINT] {
        signal(sig, SIG_IGN)
        let s = DispatchSource.makeSignalSource(signal: sig, queue: .main)
        s.setEventHandler { stopC.yield(sig == SIGTERM ? "SIGTERM" : "interrupt") }
        s.resume()
        sources.append(s)
    }
    Thread.detachNewThread {
        while !FileHandle.standardInput.availableData.isEmpty {}
        stopC.yield("stdin closed")
    }
    say("ready")
    for await why in stops { say("stopping (\(why))"); break }
    mic?.stop()
    tap?.stop()
    await withTaskGroup(of: Void.self) { g in for l in lanes { g.addTask { await l.finish() } } }
    _ = sources
}

Task {
    guard #available(macOS 26, *) else { exit(3) }
    guard SpeechTranscriber.isAvailable else {
        emitLine("{\"error\":\"speech engine unavailable on this Mac\"}")
        say("Apple's on-device speech engine is not available on this Mac.")
        exit(3)
    }
    let out = Output()
    do {
        let locales = await resolveLocales(opts.locale)
        guard !locales.isEmpty else { say("the speech engine supports neither the asked languages nor en-US"); exit(4) }
        say("languages: \(locales.map { $0.identifier(.bcp47) }.joined(separator: ", "))")
        for l in locales { try await ensureModel(l) }
        if let wav = opts.wav { try await runWav(wav, locales: locales, out: out) }
        else { try await runLive(locales: locales, out: out) }
    } catch {
        say("listen: \(error.localizedDescription)")
        out.flush()
        exit(1)
    }
    out.flush()
    exit(0)
}
dispatchMain()
