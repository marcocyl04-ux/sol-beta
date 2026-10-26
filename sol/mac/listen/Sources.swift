// Sources: where the two sides of the conversation come from.
//
// Mic is Marco: the default input, through AVAudioEngine. With --echo-cancel, Apple's voice processing
// is on (what the Mac plays through its speakers is taken out of the mic; the ducking of other apps'
// sound that comes with it is turned off, so the call stays as loud as it was); off by default, see
// main.swift. When voice processing cannot start on a device, the plain input is used and the echo
// rule in Output.swift does the work alone. Tap is the other side: what the Mac
// plays, caught with a Core Audio process tap (macOS 14.2+) on all processes except the listener
// itself and any process ids passed with --exclude-pid (Sol's own sounds). The tap is mono and
// sits in a private aggregate device that only this process can see; it disappears with us. When
// the default output changes (AirPods arriving mid-call) the tap is rebuilt on the new device and
// the mic carries on untouched. Permissions are checked here and, when one is missing, said in
// one plain sentence on stderr with the System Settings pane to open.

import AVFoundation
import CoreAudio
import Foundation

let micPane = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
let tapPane = "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture"

// MARK: the mic

@available(macOS 26, *)
final class Mic {
    private let engine = AVAudioEngine()

    /// Returns false (and says why) when the mic cannot be used.
    static func permitted() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined:
            say("asking for the microphone (a prompt from macOS)")
            if await AVCaptureDevice.requestAccess(for: .audio) { return true }
        default: break
        }
        say("permission: the microphone is not allowed for Sol listen. Allow it in System Settings > Privacy & Security > Microphone (\(micPane)), then start again. Listening to the other side only.")
        return false
    }

    func start(into lane: Lane, echoCancel: Bool = false) throws {
        let name = AVCaptureDevice.default(for: .audio)?.localizedName ?? "default input"
        if echoCancel {
            do {
                try tapAndStart(lane, voice: true)
                say("you: \(name), \(Int(fmt.sampleRate)) Hz, \(fmt.channelCount) ch, echo cancellation on")
                return
            } catch {
                say("you: no echo cancellation on this input (\(error.localizedDescription)); the echo rule alone")
                engine.inputNode.removeTap(onBus: 0)
                engine.stop()
                engine.reset()
            }
        }
        try tapAndStart(lane, voice: false)
        say("you: \(name), \(Int(fmt.sampleRate)) Hz, \(fmt.channelCount) ch")
    }

    private var fmt = AVAudioFormat()

    private func tapAndStart(_ lane: Lane, voice: Bool) throws {
        let input = engine.inputNode
        if input.isVoiceProcessingEnabled != voice { try input.setVoiceProcessingEnabled(voice) }
        if voice {
            // no ducking: the call must stay as loud as it was for Marco
            input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
        }
        fmt = input.outputFormat(forBus: 0)
        guard fmt.sampleRate > 0, fmt.channelCount > 0 else {
            throw NSError(domain: "listen", code: 2, userInfo: [NSLocalizedDescriptionKey: "no microphone found"])
        }
        input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { buf, _ in
            lane.queue.async { lane.feed(buf) }
        }
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

// MARK: the output tap

func prop<T: BitwiseCopyable>(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ initial: T,
             qualifier: [UInt32]? = nil) -> T? {
    var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal,
                                          mElement: kAudioObjectPropertyElementMain)
    var value = initial
    var size = UInt32(MemoryLayout<T>.size)
    let status: OSStatus
    if var q = qualifier {
        status = AudioObjectGetPropertyData(obj, &addr, UInt32(q.count * 4), &q, &size, &value)
    } else {
        status = AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &value)
    }
    return status == noErr ? value : nil
}

func deviceString(_ dev: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String? {
    var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal,
                                          mElement: kAudioObjectPropertyElementMain)
    var s: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &s) == noErr, let s else { return nil }
    return s.takeRetainedValue() as String
}

/// What macOS says about "System Audio Recording" for us, asked through TCC's preflight (a private
/// call, used only to choose the sentence on stderr): 0 allowed, 1 refused, anything else unknown.
func audioCapturePreflight() -> Int32? {
    guard let h = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW),
          let sym = dlsym(h, "TCCAccessPreflight") else { return nil }
    typealias Fn = @convention(c) (CFString, CFDictionary?) -> Int32
    return unsafeBitCast(sym, to: Fn.self)("kTCCServiceAudioCapture" as CFString, nil)
}

let tapSentence = "permission: to hear the other side, allow Sol listen in System Settings > Privacy & Security > Screen & System Audio Recording, under \"System Audio Recording Only\" (\(tapPane)). Screen Recording itself is not needed. Without it the other side is heard as silence."

@available(macOS 26, *)
final class Tap {
    private let lane: Lane
    private let exclude: [pid_t]
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private var listener: AudioObjectPropertyListenerBlock?
    private var listenAddr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                                                        mScope: kAudioObjectPropertyScopeGlobal,
                                                        mElement: kAudioObjectPropertyElementMain)
    private var stopped = false

    init(lane: Lane, exclude: [pid_t]) {
        self.lane = lane
        self.exclude = exclude
    }

    func start() throws {
        switch audioCapturePreflight() {
        case 0: break
        case 1: say(tapSentence)
        default: say("them: macOS may ask once to allow \"System Audio Recording\" for the app that started listen.")
        }
        try lane.queue.sync { try build() }
        let l: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            guard let self else { return }
            say("them: the sound output changed, moving the tap")
            self.teardown()
            do { try self.build() } catch { say("them: could not move the tap: \(error.localizedDescription)") }
        }
        listener = l
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &listenAddr, lane.queue, l)
        // A tap without permission plays silence rather than failing; say so if nothing ever arrives.
        lane.queue.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self, !self.stopped, !self.lane.heardSomething else { return }
            say("them: only silence so far; if something is playing, this permission is missing. " + tapSentence)
        }
    }

    /// Builds tap + aggregate device on the current default output. Call on lane.queue.
    private func build() throws {
        func fail(_ what: String, _ st: OSStatus) -> NSError {
            NSError(domain: "listen", code: Int(st), userInfo: [NSLocalizedDescriptionKey: "\(what) failed (OSStatus \(st))"])
        }
        let system = AudioObjectID(kAudioObjectSystemObject)
        var pids = exclude
        pids.append(getpid())
        let objects: [AudioObjectID] = pids.compactMap {
            let o = prop(system, kAudioHardwarePropertyTranslatePIDToProcessObject, AudioObjectID(0),
                         qualifier: [UInt32(bitPattern: $0)])
            return (o ?? 0) == 0 ? nil : o
        }
        guard let out = prop(system, kAudioHardwarePropertyDefaultOutputDevice, AudioObjectID(0)), out != 0,
              let outUID = deviceString(out, kAudioDevicePropertyDeviceUID) else {
            throw fail("finding the sound output", -1)
        }
        let desc = CATapDescription(monoGlobalTapButExcludeProcesses: objects)
        desc.name = "Sol listen"
        desc.isPrivate = true
        desc.muteBehavior = .unmuted
        var st = AudioHardwareCreateProcessTap(desc, &tapID)
        guard st == noErr else { throw fail("creating the output tap", st) }

        let agg: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Sol listen",
            kAudioAggregateDeviceUIDKey: "sol.listen.\(UUID().uuidString)",
            kAudioAggregateDeviceMainSubDeviceKey: outUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outUID]],
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true,
                                               kAudioSubTapUIDKey: desc.uuid.uuidString]],
        ]
        st = AudioHardwareCreateAggregateDevice(agg as CFDictionary, &aggID)
        guard st == noErr else { throw fail("creating the tap's device", st) }

        guard var asbd = prop(tapID, kAudioTapPropertyFormat, AudioStreamBasicDescription()),
              let fmt = AVAudioFormat(streamDescription: &asbd) else { throw fail("reading the tap format", -1) }
        let lane = self.lane
        st = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, lane.queue) { _, input, _, _, _ in
            guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, bufferListNoCopy: input, deallocator: nil) else { return }
            lane.feed(buf)
        }
        guard st == noErr, let procID else { throw fail("listening to the tap", st) }
        st = AudioDeviceStart(aggID, procID)
        guard st == noErr else { throw fail("starting the tap", st) }
        let name = deviceString(out, kAudioObjectPropertyName) ?? outUID
        say("them: output tap on \(name), \(Int(fmt.sampleRate)) Hz mono, leaving out \(objects.count) process(es)")
    }

    private func teardown() {
        if let procID, aggID != 0 {
            AudioDeviceStop(aggID, procID)
            AudioDeviceDestroyIOProcID(aggID, procID)
        }
        procID = nil
        if aggID != 0 { AudioHardwareDestroyAggregateDevice(aggID); aggID = 0 }
        if tapID != 0 { AudioHardwareDestroyProcessTap(tapID); tapID = 0 }
    }

    func stop() {
        if let l = listener {
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &listenAddr, lane.queue, l)
        }
        lane.queue.sync { stopped = true; teardown() }
    }
}
