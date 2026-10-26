// vibe-tap: hears what this Mac is playing and says how loud it is. A Core Audio process tap (macOS 14.2+) on every
// process's output, mixed to stereo, read through a private aggregate device clocked on the default output. Nothing is
// kept or written: thirty times a second it prints one line, two numbers 0..1 or so, the loudness of everything and
// the loudness of the low end (a one-pole low-pass at 120 Hz: the kick and the bass, where the beat lives).
// One permission, "system audio recording", asked by macOS the first time; no screen recording.
// Built by src-tauri/build.rs into the app (vibe.rs carries the binary and runs it). It ends when its stdin closes:
// the Sol that started it is gone.
import Foundation
import CoreAudio

func die(_ s: String) -> Never { FileHandle.standardError.write((s + "\n").data(using: .utf8)!); exit(1) }
func ok(_ e: OSStatus, _ what: String) { if e != noErr { die("\(what): \(e)") } }

// the tap: every process, stereo mixdown, private (no other app sees the device), the sound still goes to the speakers
let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])   // every process (an empty mixdown list would be no process at all)
desc.name = "sol vibe"
desc.isPrivate = true
desc.muteBehavior = .unmuted
var tap = AudioObjectID(kAudioObjectUnknown)
ok(AudioHardwareCreateProcessTap(desc, &tap), "tap")

// the default output device, by uid: the aggregate clocks on it
var out = AudioObjectID(kAudioObjectUnknown)
var size = UInt32(MemoryLayout<AudioObjectID>.size)
var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
ok(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &out), "default output")
var uidRef: Unmanaged<CFString>?
size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
addr.mSelector = kAudioDevicePropertyDeviceUID
ok(AudioObjectGetPropertyData(out, &addr, 0, nil, &size, &uidRef), "output uid")
guard let uid = uidRef?.takeRetainedValue() else { die("output uid: none") }

let agg: [String: Any] = [
  kAudioAggregateDeviceNameKey: "sol vibe",
  kAudioAggregateDeviceUIDKey: "com.marcol04.sol.vibe.\(getpid())",
  kAudioAggregateDeviceMainSubDeviceKey: uid,
  kAudioAggregateDeviceIsPrivateKey: true,
  kAudioAggregateDeviceIsStackedKey: false,
  kAudioAggregateDeviceTapAutoStartKey: true,
  kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: uid]],
  kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: desc.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]],
]
var dev = AudioObjectID(kAudioObjectUnknown)
ok(AudioHardwareCreateAggregateDevice(agg as CFDictionary, &dev), "aggregate")

var fmt = AudioStreamBasicDescription()
size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
addr.mSelector = kAudioTapPropertyFormat
ok(AudioObjectGetPropertyData(tap, &addr, 0, nil, &size, &fmt), "format")
let rate = fmt.mSampleRate > 0 ? fmt.mSampleRate : 48000
let chans = max(1, Int(fmt.mChannelsPerFrame))
let interleaved = (fmt.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0
let alpha = Float(1 - exp(-2 * Double.pi * 120 / rate))   // the low-pass, 120 Hz
let verbose = CommandLine.arguments.contains("-v")
if verbose { FileHandle.standardError.write("format: \(rate) Hz, \(chans) ch, interleaved \(interleaved), flags \(fmt.mFormatFlags), bits \(fmt.mBitsPerChannel)\n".data(using: .utf8)!) }
var calls = 0

// what the io thread adds up and the timer reads: sums of squares and counts, and the low-pass's state
let lock = NSLock()
var sumFull = 0.0, sumLow = 0.0
var nFull = 0, nLow = 0
var lp: Float = 0

var proc: AudioDeviceIOProcID?
ok(AudioDeviceCreateIOProcIDWithBlock(&proc, dev, nil) { _, inData, _, _, _ in
  let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
  var f = 0.0, l = 0.0, cf = 0, cl = 0
  lock.lock(); var lpl = lp; lock.unlock()
  var bi = 0
  for buf in abl {
    guard let p = buf.mData else { continue }
    let cnt = Int(buf.mDataByteSize) / MemoryLayout<Float>.size
    let s = p.bindMemory(to: Float.self, capacity: cnt)
    // the low end follows one channel: the first of an interleaved buffer, or the first buffer
    let stride = interleaved ? chans : 1
    let mono = interleaved || bi == 0
    var i = 0
    while i < cnt {
      let v = s[i]
      f += Double(v * v); cf += 1
      if mono && i % stride == 0 { lpl += alpha * (v - lpl); l += Double(lpl * lpl); cl += 1 }
      i += 1
    }
    bi += 1
  }
  lock.lock(); sumFull += f; sumLow += l; nFull += cf; nLow += cl; lp = lpl; calls += 1; lock.unlock()
}, "io proc")
ok(AudioDeviceStart(dev, proc), "start")

func stop() {
  if let p = proc { AudioDeviceStop(dev, p); AudioDeviceDestroyIOProcID(dev, p) }
  AudioHardwareDestroyAggregateDevice(dev)
  AudioHardwareDestroyProcessTap(tap)
}
atexit { stop() }
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }

// stdin closing is the parent going away
DispatchQueue.global().async {
  _ = FileHandle.standardInput.readDataToEndOfFile()
  exit(0)
}

let outHandle = FileHandle.standardOutput
var ticks = 0
let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { _ in
  lock.lock()
  let full = nFull > 0 ? (sumFull / Double(nFull)).squareRoot() : 0
  let low = nLow > 0 ? (sumLow / Double(nLow)).squareRoot() : 0
  sumFull = 0; sumLow = 0; nFull = 0; nLow = 0
  lock.unlock()
  outHandle.write(String(format: "%.4f %.4f\n", full, low).data(using: .utf8)!)
  if verbose { ticks += 1; if ticks % 30 == 0 { lock.lock(); let c = calls; lock.unlock(); FileHandle.standardError.write("io calls so far: \(c)\n".data(using: .utf8)!) } }
}
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
