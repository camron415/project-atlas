import AVFoundation
import ExpoModulesCore

/// Path B playback: schedule first delta immediately, drain tail with silence pad.
public class AtlasRealtimePlaybackModule: Module {
  private var engine: AVAudioEngine?
  private var playerNode: AVAudioPlayerNode?
  private var audioFormat: AVAudioFormat?

  private var byteRemainder = Data()
  private var scheduledBufferCount = 0
  private var completedBufferCount = 0
  private var isFinishedAppending = false
  private var finishContinuation: CheckedContinuation<Void, Error>?

  private let audioQueue = DispatchQueue(label: "com.atlas.realtimeplayback.queue")
  private let tailSilenceMs: Double = 120
  private let headSilenceMs: Double = 40
  /// Small batch so playback starts quickly without a quiet-then-loud ramp.
  private let firstScheduleBytes = 2400
  private var pendingFirstBatch = Data()
  private var flushedFirstBatch = false
  private var hasScheduledAudio = false

  public func definition() -> ModuleDefinition {
    Name("AtlasRealtimePlayback")

    AsyncFunction("start") { (sampleRate: Double) in
      try await self.start(sampleRate: sampleRate)
    }

    AsyncFunction("appendPcmBase64") { (base64: String) in
      try await self.appendPcmBase64(base64)
    }

    AsyncFunction("finish") {
      try await self.finishPlayback()
    }

    AsyncFunction("stop") {
      self.audioQueue.sync {
        self.endPlayback(immediate: true)
      }
    }

    Function("isAvailable") {
      return true
    }
  }

  private func start(sampleRate: Double) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      DispatchQueue.main.async {
        do {
          try self.createEngineIfNeeded(sampleRate: sampleRate)
          self.audioQueue.sync {
            self.byteRemainder = Data()
            self.scheduledBufferCount = 0
            self.completedBufferCount = 0
            self.isFinishedAppending = false
            self.finishContinuation = nil
            self.hasScheduledAudio = false
            self.pendingFirstBatch = Data()
            self.flushedFirstBatch = false
          }
          try self.applyPlaybackSession()
          try self.ensureRunning()
          continuation.resume()
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func createEngineIfNeeded(sampleRate: Double) throws {
    if engine != nil, playerNode != nil, let format = audioFormat,
       format.sampleRate == sampleRate {
      return
    }

    teardownEngine()

    guard let format = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: sampleRate,
      channels: 1,
      interleaved: true
    ) else {
      throw Exception(name: "AudioFormatError", description: "Could not create PCM16 format")
    }

    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: format)
    engine.mainMixerNode.outputVolume = 1.0
    engine.prepare()

    self.engine = engine
    self.playerNode = player
    self.audioFormat = format
  }

  private func applyPlaybackSession() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(
      .playAndRecord,
      mode: .spokenAudio,
      options: [.defaultToSpeaker, .allowBluetoothHFP, .mixWithOthers]
    )
    try session.setActive(true, options: [])
    let route = session.currentRoute
    let btOutput: Set<AVAudioSession.Port> = [.bluetoothHFP, .bluetoothLE, .bluetoothA2DP]
    let hasBluetooth =
      route.outputs.contains(where: { btOutput.contains($0.portType) })
      || route.inputs.contains { $0.portType == .bluetoothHFP || $0.portType == .bluetoothLE }
    if hasBluetooth {
      try session.overrideOutputAudioPort(.none)
    } else {
      try session.overrideOutputAudioPort(.speaker)
    }
  }

  private func ensureRunning() throws {
    guard let engine = engine, let player = playerNode else { return }
    try? applyPlaybackSession()
    if !engine.isRunning {
      engine.prepare()
      try engine.start()
    }
    if !player.isPlaying {
      player.play()
    }
  }

  private func appendPcmBase64(_ base64: String) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      audioQueue.async {
        self.appendPcmBase64Internal(base64)
        continuation.resume()
      }
    }
  }

  private func appendPcmBase64Internal(_ base64: String) {
    guard playerNode != nil, audioFormat != nil else { return }
    guard var data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else { return }
    if data.isEmpty { return }

    if !byteRemainder.isEmpty {
      data = byteRemainder + data
      byteRemainder = Data()
    }

    if data.count % 2 != 0 {
      byteRemainder = data.suffix(1)
      data = data.dropLast()
    }

    if data.isEmpty { return }

    if !flushedFirstBatch {
      pendingFirstBatch.append(data)
      if pendingFirstBatch.count >= firstScheduleBytes {
        flushFirstBatch()
      }
      return
    }

    schedulePcmData(Data(data))
  }

  private func flushFirstBatch() {
    guard !flushedFirstBatch else { return }
    flushedFirstBatch = true
    var data = pendingFirstBatch
    pendingFirstBatch = Data()
    if data.isEmpty { return }
    if !hasScheduledAudio {
      scheduleLeadingSilence()
      hasScheduledAudio = true
    }
    schedulePcmData(data)
  }

  /// Warm the player node before speech — avoids clipping "Yes" / "sir" on cold start.
  private func scheduleLeadingSilence() {
    guard let format = audioFormat else { return }
    let frames = AVAudioFrameCount(format.sampleRate * headSilenceMs / 1000.0)
    guard frames > 0,
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)
    else { return }
    buffer.frameLength = frames
    if let channel = buffer.int16ChannelData?[0] {
      memset(channel, 0, Int(frames) * MemoryLayout<Int16>.size)
    }
    schedulePcmDataBuffer(buffer)
  }

  private func flushRemainder() {
    var tail = byteRemainder
    byteRemainder = Data()
    if tail.count % 2 != 0 {
      tail = Data(tail.dropLast())
    }
    if !tail.isEmpty {
      schedulePcmData(tail)
    }
  }

  /// Pad the tail so the DAC finishes the last syllable without a hard cut.
  private func scheduleTrailingSilence() {
    guard let format = audioFormat else { return }
    let frames = AVAudioFrameCount(format.sampleRate * tailSilenceMs / 1000.0)
    guard frames > 0,
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)
    else { return }

    buffer.frameLength = frames
    if let channel = buffer.int16ChannelData?[0] {
      memset(channel, 0, Int(frames) * MemoryLayout<Int16>.size)
    }
    schedulePcmDataBuffer(buffer)
  }

  private func schedulePcmData(_ data: Data) {
    guard let player = playerNode, let format = audioFormat else { return }
    if data.isEmpty { return }

    let frameCount = AVAudioFrameCount(data.count / MemoryLayout<Int16>.size)
    guard frameCount > 0,
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)
    else { return }

    buffer.frameLength = frameCount
    data.withUnsafeBytes { raw in
      guard let src = raw.baseAddress,
            let dst = buffer.int16ChannelData?[0]
      else { return }
      memcpy(dst, src, data.count)
    }

    schedulePcmDataBuffer(buffer)
  }

  private func schedulePcmDataBuffer(_ buffer: AVAudioPCMBuffer) {
    guard let player = playerNode else { return }
    scheduledBufferCount += 1
    player.scheduleBuffer(buffer, completionHandler: { [weak self] in
      self?.audioQueue.async {
        self?.onBufferCompleted()
      }
    })
  }

  private func onBufferCompleted() {
    completedBufferCount += 1
    tryResolveFinish()
  }

  private func finishPlayback() async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      audioQueue.async {
        self.isFinishedAppending = true
        self.flushFirstBatch()
        self.flushRemainder()
        self.scheduleTrailingSilence()
        if self.scheduledBufferCount <= self.completedBufferCount {
          self.endPlayback(immediate: false)
          continuation.resume()
          return
        }
        self.finishContinuation = continuation
      }
    }
  }

  private func tryResolveFinish() {
    guard isFinishedAppending else { return }
    guard scheduledBufferCount <= completedBufferCount else { return }
    endPlayback(immediate: false)
    finishContinuation?.resume()
    finishContinuation = nil
  }

  private func endPlayback(immediate: Bool) {
    byteRemainder = Data()
    scheduledBufferCount = 0
    completedBufferCount = 0
    isFinishedAppending = false

    let tailDelay = immediate ? 0.0 : 0.25
    DispatchQueue.main.async {
      DispatchQueue.main.asyncAfter(deadline: .now() + tailDelay) {
        self.playerNode?.stop()
        // Keep engine warm between turns — cold engine.start() was clipping word onsets.
      }
    }

    if let continuation = finishContinuation {
      continuation.resume()
      finishContinuation = nil
    }
  }

  private func teardownEngine() {
    playerNode?.stop()
    engine?.stop()
    playerNode = nil
    engine = nil
    audioFormat = nil
    byteRemainder = Data()
    scheduledBufferCount = 0
    completedBufferCount = 0
    isFinishedAppending = false
    finishContinuation?.resume()
    finishContinuation = nil
  }
}
