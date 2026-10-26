// Output: the only place that writes to stdout. Every turn of the conversation leaves here as one
// JSON line, {"who","text","final","at","seconds"}, and diagnostics go to stderr as plain sentences.
//
// It also does the cheap echo rule. On a call two things leak: the far side can send Marco's own
// voice back (so "them" repeats "you"), and the speakers can reach the mic (so "you" repeats "them").
// When a "you" turn and a "them" turn carry the same words and started within 2 s of each other, one
// is dropped: "you" is kept (the mic is the one source of Marco's own voice, and the far side can only
// send it back later, by the network's delay) unless "them" began a clear 0.3 s earlier, which is the
// speakers reaching the mic (the tap hears the sound at once, the room a moment later). If the other
// side still has a turn open that began just before, a finished turn waits (at most 3 s) for it. The
// speakers' leak is also caught when a turn lies inside the other side's turn with half its words.
// Every line also carries `lang`, the language the turn was heard in (Lane.swift).

import Foundation

struct Turn {
    let who: String
    let text: String
    let at: Double       // unix seconds when the turn started
    let seconds: Double  // how long it lasted
    let lang: String     // the language it was heard in, as a code (en-US)
}

func say(_ line: String) {
    FileHandle.standardError.write((line + "\n").data(using: .utf8)!)
}

func jsonString(_ s: String) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [s], options: [.withoutEscapingSlashes])
    let arr = String(data: data, encoding: .utf8)!
    return String(arr.dropFirst().dropLast())
}

func emitLine(_ s: String) {
    FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
}

final class Output: @unchecked Sendable {
    let queue = DispatchQueue(label: "listen.out")
    /// Asks a lane for the start of its open turn (unix seconds), nil when it is quiet.
    var openTurnStart: [String: () -> Double?] = [:]
    private var printed: [Turn] = []       // recent finals, for the echo rule
    private var held: [(turn: Turn, id: Int)] = []
    private var nextId = 0

    func partial(_ t: Turn) {
        queue.async {
            if self.held.contains(where: { $0.turn.who == t.who }) { return }
            self.write(t, final: false)
        }
    }

    func final(_ t: Turn) {
        queue.async { self.arrive(t) }
    }

    /// Prints whatever is still held. Call before exit.
    func flush() {
        queue.sync {
            for h in held.sorted(by: { $0.turn.at < $1.turn.at }) { write(h.turn, final: true) }
            held.removeAll()
        }
    }

    // MARK: the echo rule (on queue)

    private func arrive(_ t: Turn) {
        let other = t.who == "you" ? "them" : "you"
        let now = Date().timeIntervalSince1970
        printed.removeAll { now - $0.at - $0.seconds > 30 }

        // 1. A held turn of the other side that this one echoes, or that echoes this one.
        if let i = held.firstIndex(where: { $0.turn.who == other && Output.echo($0.turn, t) }) {
            let h = held.remove(at: i).turn
            let (keep, drop) = Output.pick(h, t)
            say("echo: dropped a \(drop.who) turn that repeated \(keep.who) (\(drop.text.prefix(40)))")
            write(keep, final: true)
            printed.append(keep)
            return
        }
        // 2. Already printed from the other side: this one came second to the page.
        if let p = printed.first(where: { $0.who == other && Output.echo($0, t) }) {
            say("echo: dropped a \(t.who) turn that repeated \(p.who) (\(t.text.prefix(40)))")
            return
        }
        // 3. The other side has a turn open that began a little earlier: wait for it.
        if let start = openTurnStart[other]?(), start <= t.at, t.at - start <= 2 {
            let id = nextId; nextId += 1
            held.append((t, id))
            queue.asyncAfter(deadline: .now() + 3) {
                if let i = self.held.firstIndex(where: { $0.id == id }) {
                    let h = self.held.remove(at: i).turn
                    self.write(h, final: true)
                    self.printed.append(h)
                }
            }
            return
        }
        // 4. Print, then release held turns of the other side that are not echoes of it.
        let release = held.filter { $0.turn.who == other && $0.turn.at <= t.at }
        held.removeAll { r in release.contains { $0.id == r.id } }
        for r in release { write(r.turn, final: true); printed.append(r.turn) }
        write(t, final: true)
        printed.append(t)
    }

    /// Of an echo pair, the one that is kept: "you" unless "them" began a clear 0.3 s earlier (the speakers in the mic).
    static func pick(_ a: Turn, _ b: Turn) -> (keep: Turn, drop: Turn) {
        let you = a.who == "you" ? a : b, them = a.who == "you" ? b : a
        return them.at + 0.3 < you.at ? (them, you) : (you, them)
    }

    static let numbers = ["zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10"]
    /// the words of a turn, lowercased, small numbers as digits (one engine writes "three", the other "3")
    static func words(_ s: String) -> [String] {
        s.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map { numbers[String($0)] ?? String($0) }
    }

    /// Same words, started within 2 s. Short turns must match exactly; longer ones may differ a
    /// little, since the two engines hear slightly different sound. A turn that lies almost wholly
    /// inside the other side's turn (the speakers in the mic, heard faint and half garbled) is an
    /// echo at half the words: two people do not say the same half of their words at the same moment.
    static func echo(_ a: Turn, _ b: Turn) -> Bool {
        let wa = words(a.text), wb = words(b.text)
        if wa.isEmpty || wb.isEmpty { return false }
        let inside = min(a.at + a.seconds, b.at + b.seconds) - max(a.at, b.at)
        let covered = inside / max(0.5, min(a.seconds, b.seconds))
        let sa = Set(wa), sb = Set(wb)
        let shared = Double(sa.intersection(sb).count) / Double(min(sa.count, sb.count))
        if covered >= 0.7 && min(wa.count, wb.count) >= 4 && shared >= 0.5 { return true }
        guard abs(a.at - b.at) <= 2 else { return false }
        if min(wa.count, wb.count) < 3 { return wa == wb }
        return shared >= 0.8
            && Double(min(wa.count, wb.count)) / Double(max(wa.count, wb.count)) >= 0.5
    }

    private func write(_ t: Turn, final: Bool) {
        let at = String(format: "%.3f", t.at)
        let secs = String(format: "%.1f", t.seconds)
        emitLine("{\"who\":\"\(t.who)\",\"text\":\(jsonString(t.text)),\"final\":\(final),\"at\":\(at),\"seconds\":\(secs),\"lang\":\(jsonString(t.lang))}")
    }
}
