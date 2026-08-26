// Offline, deterministic-environment MIDI renderer for the Gate-A oracle.
//
// Usage:
//   render_midi_dls INPUT.mid OUTPUT.wav [maximum-seconds]
//
// The caller records the executable, source, MIDI, DLS-bank, and output hashes.
// Both sides of every listening pair must use this same binary and bank.

import AVFoundation
import AudioToolbox
import Foundation

enum RenderFailure: Error, CustomStringConvertible {
    case usage
    case audioUnit(OSStatus)
    case noTracks
    case invalidDuration
    case render(String)

    var description: String {
        switch self {
        case .usage:
            return "usage: render_midi_dls INPUT.mid OUTPUT.wav [maximum-seconds]"
        case .audioUnit(let status):
            return "AudioUnit error \(status)"
        case .noTracks:
            return "MIDI contains no tracks"
        case .invalidDuration:
            return "MIDI duration is not finite and positive"
        case .render(let message):
            return message
        }
    }
}

let soundBank = URL(fileURLWithPath:
    "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")

func render(input: URL, output: URL, maximumSeconds: Double?) throws -> [String: Any] {
    let engine = AVAudioEngine()
    let description = AudioComponentDescription(
        componentType: kAudioUnitType_MusicDevice,
        componentSubType: kAudioUnitSubType_DLSSynth,
        componentManufacturer: kAudioUnitManufacturer_Apple,
        componentFlags: 0,
        componentFlagsMask: 0)
    let synth = AVAudioUnitMIDIInstrument(audioComponentDescription: description)
    engine.attach(synth)
    engine.connect(synth, to: engine.mainMixerNode, format: nil)

    var bankReference = Unmanaged.passUnretained(soundBank as CFURL)
    let bankStatus = AudioUnitSetProperty(
        synth.audioUnit,
        kMusicDeviceProperty_SoundBankURL,
        kAudioUnitScope_Global,
        0,
        &bankReference,
        UInt32(MemoryLayout<Unmanaged<CFURL>>.size))
    guard bankStatus == noErr else { throw RenderFailure.audioUnit(bankStatus) }

    let sequencer = AVAudioSequencer(audioEngine: engine)
    try sequencer.load(from: input, options: .smf_ChannelsToTracks)
    guard !sequencer.tracks.isEmpty else { throw RenderFailure.noTracks }
    for track in sequencer.tracks {
        track.destinationAudioUnit = synth
    }
    let sourceSeconds = sequencer.tracks.map(\.lengthInSeconds).max() ?? 0
    guard sourceSeconds.isFinite && sourceSeconds > 0 else {
        throw RenderFailure.invalidDuration
    }
    let musicalSeconds = maximumSeconds.map { min(sourceSeconds, $0) } ?? sourceSeconds
    guard musicalSeconds.isFinite && musicalSeconds > 0 else {
        throw RenderFailure.invalidDuration
    }

    let sampleRate = 44_100.0
    guard let format = AVAudioFormat(
        standardFormatWithSampleRate: sampleRate, channels: 2) else {
        throw RenderFailure.render("cannot create output format")
    }
    let maximumFrames: AVAudioFrameCount = 4_096
    try engine.enableManualRenderingMode(
        .offline, format: format, maximumFrameCount: maximumFrames)
    let file = try AVAudioFile(
        forWriting: output, settings: format.settings,
        commonFormat: .pcmFormatFloat32, interleaved: false)
    guard let buffer = AVAudioPCMBuffer(
        pcmFormat: engine.manualRenderingFormat,
        frameCapacity: maximumFrames) else {
        throw RenderFailure.render("cannot allocate render buffer")
    }

    sequencer.prepareToPlay()
    try engine.start()
    try sequencer.start()
    let tailSeconds = 2.0
    let targetFrames = AVAudioFramePosition(
        ceil((musicalSeconds + tailSeconds) * sampleRate))
    while engine.manualRenderingSampleTime < targetFrames {
        let remaining = targetFrames - engine.manualRenderingSampleTime
        let count = AVAudioFrameCount(min(
            AVAudioFramePosition(maximumFrames), remaining))
        let status = try engine.renderOffline(count, to: buffer)
        switch status {
        case .success:
            try file.write(from: buffer)
        case .insufficientDataFromInputNode:
            continue
        case .cannotDoInCurrentContext:
            continue
        case .error:
            throw RenderFailure.render("offline audio engine returned error")
        @unknown default:
            throw RenderFailure.render("offline audio engine returned unknown status")
        }
    }
    sequencer.stop()
    engine.stop()
    return [
        "input": input.path,
        "output": output.path,
        "soundBank": soundBank.path,
        "sourceSeconds": sourceSeconds,
        "renderedMusicalSeconds": musicalSeconds,
        "tailSeconds": tailSeconds,
        "sampleRate": sampleRate,
        "channels": 2,
        "frames": targetFrames,
    ]
}

do {
    guard CommandLine.arguments.count == 3 || CommandLine.arguments.count == 4 else {
        throw RenderFailure.usage
    }
    let input = URL(fileURLWithPath: CommandLine.arguments[1])
    let output = URL(fileURLWithPath: CommandLine.arguments[2])
    let maximumSeconds: Double?
    if CommandLine.arguments.count == 4 {
        maximumSeconds = Double(CommandLine.arguments[3])
        guard maximumSeconds != nil && maximumSeconds! > 0 else {
            throw RenderFailure.usage
        }
    } else {
        maximumSeconds = nil
    }
    let result = try render(input: input, output: output,
                            maximumSeconds: maximumSeconds)
    let data = try JSONSerialization.data(
        withJSONObject: result, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} catch {
    FileHandle.standardError.write(Data("render_midi_dls: \(error)\n".utf8))
    exit(1)
}
