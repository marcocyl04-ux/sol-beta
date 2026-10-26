// Lane: one side of the conversation ("you" from the mic, or "them" from the Mac's sound output),
// from raw sound to finished turns. Sound comes in as buffers in whatever shape the device gives;
// the lane mixes it to one channel, converts it to the shape Apple's on-device speech engine wants
// (SpeechAnalyzer with a SpeechTranscriber, macOS 26), hands it over, and reads the words back.
//
// Several languages at once: a lane runs one engine per locale it was given (three at most), all fed
// the same sound. Every engine hears every turn; at the close of a turn the words of the engine that
// was surest of them (the mean of the per-word confidence the transcriber reports) are the turn's,
// the others' are dropped, and that engine's language is the one the partial lines follow until the
// next turn says otherwise. So a talk that moves between English and Chinese needs no switch.
//
// Where a turn ends is decided here, by a small loudness check, because the transcriber cuts its
// results by sentence, not by who stopped talking: a turn opens on the first loud 20 ms, and closes
// after 1 s under the line (or at 180 s). On close the engines are asked to finish their words up to
// that moment, and they leave as one final line. Words seen before the close go out as partial
// lines (final:false), each replacing the one before. Nothing is written to disk; the sound only
// ever lives in memory for the moment it takes to pass through.
//
// Why the mix to one channel is done by hand (2026-10-26): the MacBook's microphone array arrives as
// three channels, and AVAudioConverter's downmix of three channels gave exact silence, so the mic side
// of every talk was empty. The average of the channels is taken here, then only the sample rate is
// converted, the path the output tap always took.

import AVFoundation
import CoreMedia
import Foundation
import Speech

let debugOn = ProcessInfo.processInfo.environment["LISTEN_DEBUG"] != nil
func debug(_ s: @autoclosure () -> String) { if debugOn { say("debug: " + s()) } }

typealias Words = (start: Double, end: Double, text: String, confidence: Double)

/// One speech engine for one language: its transcriber, its analyzer, the stream that feeds it and
/// the words it has found so far. Touched only on the lane's queue (except the feed, which is a
/// continuation and thread-safe).
@available(macOS 26, *)
final class Engine: @unchecked Sendable {
    let locale: Locale
    let transcriber: SpeechTranscriber
    let analyzer: SpeechAnalyzer
    let feedC: AsyncStream<AnalyzerInput>.Continuation
    var resultsTask: Task<Void, Never>?
    var finals: [Words] = []
    var volatile: Words?

    init(locale: Locale, transcriber: SpeechTranscriber, analyzer: SpeechAnalyzer, feedC: AsyncStream<AnalyzerInput>.Continuation) {
        self.locale = locale; self.transcriber = transcriber; self.analyzer = analyzer; self.feedC = feedC
    }

    static func make(locale: Locale) -> (Engine, AsyncStream<AnalyzerInput>) {
        let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [],
                                            reportingOptions: [.volatileResults, .fastResults],
                                            attributeOptions: [.audioTimeRange, .transcriptionConfidence])
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
        return (Engine(locale: locale, transcriber: transcriber, analyzer: analyzer, feedC: cont), stream)
    }

    var name: String { locale.identifier(.bcp47) }
}

@available(macOS 26, *)
final class Lane: @unchecked Sendable {
    let who: String
    let queue: DispatchQueue
    private let out: Output
    private let engines: [Engine]
    private var current = 0                 // the engine whose language the last turn was in
    private let format: AVAudioFormat
    private let rate: Double
    private var converter: AVAudioConverter?
    private var converterFrom: AVAudioFormat?
    private var mono: AVAudioPCMBuffer?
    private var closeChain: Task<Void, Never>?
    private var watchdog: DispatchSourceTimer?
    private var finished = false

    // time
    private var samples: Int64 = 0          // frames handed to the engines so far
    var wallStart: Double?                  // unix seconds at frame 0
    private var lastFeedWall = 0.0
    // loudness check
    private var floorDB = -60.0
    private var turnOpen = false
    private var turnStart: Int64 = 0
    private var lastVoice: Int64 = 0
    private(set) var heardSomething = false  // any sample that is not exactly zero
    // words
    private var boundary = 0.0              // seconds; words before it belong to closed turns
    private var lastPartial = ""
    // diagnostics (LISTEN_DEBUG)
    private var dbgFrames = 0, dbgMax = -120.0, dbgVoiced = 0

    private init(who: String, out: Output, engines: [Engine], format: AVAudioFormat) {
        self.who = who
        self.out = out
        self.engines = engines
        self.format = format
        self.rate = format.sampleRate
        self.queue = DispatchQueue(label: "listen.\(who)")
    }

    static func make(who: String, locales: [Locale], out: Output) async throws -> Lane {
        var engines: [Engine] = []
        var streams: [AsyncStream<AnalyzerInput>] = []
        for l in locales {
            let (e, s) = Engine.make(locale: l)
            engines.append(e); streams.append(s)
        }
        guard let first = engines.first,
              let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [first.transcriber]) else {
            throw NSError(domain: "listen", code: 1, userInfo: [NSLocalizedDescriptionKey: "the speech engine offered no audio format"])
        }
        let lane = Lane(who: who, out: out, engines: engines, format: format)
        for (e, s) in zip(engines, streams) {
            try await e.analyzer.prepareToAnalyze(in: format)
            e.resultsTask = Task { await lane.readResults(e) }
            try await e.analyzer.start(inputSequence: s)
        }
        out.openTurnStart[who] = { [weak lane] in lane?.openStart() }
        return lane
    }

    /// Closes a turn when the sound stops arriving at all (a device that goes quiet by stopping).
    func startWatchdog() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 0.25, repeating: 0.25)
        t.setEventHandler { [weak self] in
            guard let self, self.turnOpen, !self.finished else { return }
            if Date().timeIntervalSince1970 - self.lastFeedWall > 1.0 { self.closeTurn(end: self.lastVoice, through: self.samples) }
        }
        t.resume()
        watchdog = t
    }

    private func openStart() -> Double? {
        queue.sync { turnOpen ? (wallStart ?? 0) + Double(turnStart) / rate : nil }
    }

    // MARK: sound in (call on queue)

    /// Several channels averaged into one, float, same rate (a buffer reused between calls).
    private func toMono(_ src: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        let ch = Int(src.format.channelCount), n = Int(src.frameLength)
        guard ch > 1, let monoFmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: src.format.sampleRate, channels: 1, interleaved: false) else { return src }
        if mono == nil || mono!.frameCapacity < src.frameLength || mono!.format.sampleRate != src.format.sampleRate {
            mono = AVAudioPCMBuffer(pcmFormat: monoFmt, frameCapacity: max(src.frameLength, 4096))
        }
        guard let m = mono, let dst = m.floatChannelData?[0] else { return nil }
        m.frameLength = src.frameLength
        let scale = 1 / Float(ch)
        if let f = src.floatChannelData {
            if src.format.isInterleaved {
                for k in 0..<n { var s: Float = 0; for c in 0..<ch { s += f[0][k * ch + c] }; dst[k] = s * scale }
            } else {
                for k in 0..<n { var s: Float = 0; for c in 0..<ch { s += f[c][k] }; dst[k] = s * scale }
            }
        } else if let i = src.int16ChannelData {
            let q = scale / 32768
            if src.format.isInterleaved {
                for k in 0..<n { var s: Float = 0; for c in 0..<ch { s += Float(i[0][k * ch + c]) }; dst[k] = s * q }
            } else {
                for k in 0..<n { var s: Float = 0; for c in 0..<ch { s += Float(i[c][k]) }; dst[k] = s * q }
            }
        } else { return nil }
        return m
    }

    func feed(_ src: AVAudioPCMBuffer) {
        guard !finished, src.frameLength > 0 else { return }
        guard var buf: AVAudioPCMBuffer = toMono(src) else { return }
        if buf.format != format {
            if converterFrom != buf.format {
                converter = AVAudioConverter(from: buf.format, to: format)
                converterFrom = buf.format
            }
            guard let converter else { return }
            let cap = AVAudioFrameCount(Double(buf.frameLength) * rate / buf.format.sampleRate) + 64
            guard let o = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: cap) else { return }
            var given = false
            var err: NSError?
            let input = buf
            converter.convert(to: o, error: &err) { _, status in
                if given { status.pointee = .noDataNow; return nil }
                given = true
                status.pointee = .haveData
                return input
            }
            if err != nil || o.frameLength == 0 {
                debug("\(who) converter: \(err?.localizedDescription ?? "no frames") from \(input.format)")
                return
            }
            buf = o
        }
        let now = Date().timeIntervalSince1970
        if wallStart == nil { wallStart = now }
        lastFeedWall = now
        let at = CMTime(value: samples, timescale: CMTimeScale(rate))
        for e in engines { e.feedC.yield(AnalyzerInput(buffer: buf, bufferStartTime: at)) }
        check(buf, from: samples)
        samples += Int64(buf.frameLength)
    }

    private func check(_ buf: AVAudioPCMBuffer, from start: Int64) {
        let n = Int(buf.frameLength)
        if debugOn {
            dbgFrames += n
            if dbgFrames >= Int(rate) {
                say("debug: \(who) level max \(Int(dbgMax)) dB floor \(Int(floorDB)) voiced \(dbgVoiced)/50 fed \(samples)")
                dbgFrames = 0; dbgMax = -120; dbgVoiced = 0
            }
        }
        let frame = max(1, Int(rate * 0.02))
        var i = 0
        while i < n {
            let m = min(frame, n - i)
            var sum = 0.0
            if let f = buf.floatChannelData?[0] {
                for k in i..<(i + m) { let v = Double(f[k]); sum += v * v }
            } else if let s = buf.int16ChannelData?[0] {
                for k in i..<(i + m) { let v = Double(s[k]) / 32768; sum += v * v }
            }
            if sum > 0 { heardSomething = true }
            let db = 10 * log10(sum / Double(m) + 1e-12)
            let voiced = db > max(floorDB + 12, -52)
            if debugOn { dbgMax = max(dbgMax, db); if voiced { dbgVoiced += 1 } }
            // The noise floor drops at once and rises slowly (about 5 s), so the quiet gaps
            // between words do not lift it over the speech.
            floorDB = min(-35, floorDB + (db < floorDB ? 1.0 : 0.004) * (db - floorDB))
            let pos = start + Int64(i)
            if voiced {
                lastVoice = pos + Int64(m)
                if !turnOpen { turnOpen = true; turnStart = max(0, pos - Int64(rate * 0.2)) }
            } else if turnOpen && Double(pos - lastVoice) >= rate {
                closeTurn(end: lastVoice, through: pos)
            }
            if turnOpen && Double(pos - turnStart) >= rate * 180 { closeTurn(end: pos, through: pos) }
            i += m
        }
    }

    // MARK: words out

    /// The mean confidence of a result's words (0...1); 0.5 when the engine gave none.
    private static func confidence(_ s: AttributedString) -> Double {
        var sum = 0.0, n = 0.0
        for run in s.runs {
            guard let c = run.transcriptionConfidence else { continue }
            let w = Double(max(1, s[run.range].characters.count))
            sum += c * w; n += w
        }
        return n > 0 ? sum / n : 0.5
    }

    private func readResults(_ e: Engine) async {
        do {
            for try await r in e.transcriber.results {
                let s = r.range.start.seconds, end = r.range.end.seconds
                // The engine writes ",..." for a stretch of silence; a turn never starts with that.
                let text = String(String(r.text.characters).drop(while: { $0.isPunctuation || $0.isWhitespace }))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                let conf = Lane.confidence(r.text)
                let fin = r.isFinal
                queue.async {
                    if fin {
                        if let v = e.volatile, v.start < end { e.volatile = nil }
                        if s < self.boundary - 0.05 { return }  // began in a turn already sent
                        if !text.isEmpty { e.finals.append((s, end, text, conf)) }
                    } else {
                        e.volatile = text.isEmpty ? nil : (s, end, text, conf)
                    }
                    if e === self.engines[self.current] { self.sendPartial() }
                }
            }
        } catch {
            say("\(who) (\(e.name)): the speech engine stopped: \(error.localizedDescription)")
        }
    }

    private func sendPartial() {
        let e = engines[current]
        var parts = e.finals.map(\.text)
        if let v = e.volatile { parts.append(v.text) }
        let text = parts.joined(separator: " ")
        guard !text.isEmpty, text != lastPartial else { return }
        lastPartial = text
        // The partial starts where its first words start (or where the open turn began).
        var start = e.finals.first?.start ?? e.volatile?.start ?? Double(turnStart) / rate
        if turnOpen { start = min(start, Double(turnStart) / rate) }
        let end = max(e.volatile?.end ?? 0, e.finals.last?.end ?? 0, start)
        out.partial(Turn(who: who, text: text, at: (wallStart ?? 0) + start, seconds: end - start, lang: e.name))
    }

    /// Ends the open turn: it lasted until frame `end` (the last loud moment); the engines finish
    /// their words through frame `cut` (where the pause was noticed, so words the loudness check
    /// missed are kept), and they leave as one final line. Closes run one after another, in order.
    private func closeTurn(end: Int64, through cut: Int64) {
        guard turnOpen else { return }
        turnOpen = false
        let through = Double(min(cut, samples)) / rate
        let startSec = Double(turnStart) / rate
        let seconds = Double(end - turnStart) / rate
        let prev = closeChain
        closeChain = Task {
            await prev?.value
            debug("\(self.who) close through \(through)")
            // Ask the engines to finish their words through the pause. One sometimes never answers
            // (seen with fast-fed test files), so wait at most 2.5 s and take the words as they are.
            let done = Flag(count: self.engines.count)
            for e in self.engines {
                let analyzer = e.analyzer
                Task { try? await analyzer.finalize(through: CMTime(seconds: through, preferredTimescale: 16000)); done.add() }
            }
            for _ in 0..<125 where !done.value { try? await Task.sleep(nanoseconds: 20_000_000) }
            debug("\(self.who) finalized: \(done.value)")
            await self.settle(through)
            debug("\(self.who) settled")
            self.queue.sync { self.collect(through: through, startSec: startSec, seconds: seconds) }
        }
    }

    /// Waits (up to half a second) until no engine has unfinished words before `t`.
    private func settle(_ t: Double) async {
        for _ in 0..<25 {
            let done = queue.sync { engines.allSatisfy { e in e.volatile.map { $0.start >= t - 0.05 } ?? true } }
            if done { return }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    /// The words before `t` of every engine; the surest engine's are the turn's, the rest are dropped.
    private func collect(through t: Double, startSec: Double, seconds: Double) {
        var best: (i: Int, text: String, score: Double)?
        for (i, e) in engines.enumerated() {
            var parts: [String] = [], sum = 0.0, n = 0.0
            e.finals.sort { $0.start < $1.start }
            while let f = e.finals.first, f.start < t {
                parts.append(f.text); sum += f.confidence * Double(f.text.count); n += Double(f.text.count)
                e.finals.removeFirst()
            }
            if let v = e.volatile, v.start < t { parts.append(v.text); sum += v.confidence * Double(v.text.count); n += Double(v.text.count); e.volatile = nil }
            let text = parts.joined(separator: " ")
            guard !text.isEmpty else { continue }
            // the mean confidence of the words; the language of the last turn wins a near tie
            let score = (n > 0 ? sum / n : 0.5) + (i == current ? 0.05 : 0)
            debug("\(who) \(e.name): \(String(format: "%.2f", score)) \(text.prefix(60))")
            if best == nil || score > best!.score { best = (i, text, score) }
        }
        boundary = max(boundary, t)
        lastPartial = ""
        guard let b = best else { return }
        // words no engine was sure of (a cough, the speakers' leak after the echo canceller) are not a turn
        if b.score < 0.25 { debug("\(who) dropped at \(String(format: "%.2f", b.score)): \(b.text.prefix(60))"); return }
        if b.i != current { debug("\(who) now in \(engines[b.i].name)"); current = b.i }
        out.final(Turn(who: who, text: b.text, at: (wallStart ?? Date().timeIntervalSince1970) + startSec, seconds: seconds, lang: engines[b.i].name))
    }

    /// The stop: lets the engines finish every word they were given (however far behind they are),
    /// then sends the open turn whole, and any words heard outside a turn with it.
    func finish() async {
        let (prev, open): (Task<Void, Never>?, (start: Double, seconds: Double)?) = queue.sync {
            watchdog?.cancel()
            finished = true
            let open = turnOpen ? (Double(turnStart) / rate, Double(max(lastVoice, turnStart) - turnStart) / rate) : nil
            turnOpen = false
            return (closeChain, open)
        }
        await prev?.value
        debug("\(who) finishing")
        for e in engines { e.feedC.finish() }
        await withTaskGroup(of: Void.self) { g in
            for e in engines { g.addTask { try? await e.analyzer.finalizeAndFinishThroughEndOfInput(); await e.resultsTask?.value } }
        }
        debug("\(who) engines finished")
        queue.sync {
            let firsts = engines.flatMap { $0.finals.map(\.start) }
            let ends = engines.flatMap { $0.finals.map(\.end) }
            let start = open?.start ?? firsts.min() ?? boundary
            let seconds = open?.seconds ?? ((ends.max() ?? start) - start)
            collect(through: .infinity, startSec: start, seconds: seconds)
        }
    }
}

/// A count several tasks can add to; `value` is true once it has reached its target.
final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var n = 0
    private let target: Int
    init(count: Int = 1) { target = count }
    var value: Bool { lock.withLock { n >= target } }
    func add() { lock.withLock { n += 1 } }
    func set() { add() }
}
