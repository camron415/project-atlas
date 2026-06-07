import AVFoundation
import ExpoModulesCore

/// Gapless PCM16 mono streaming via AVAudioEngine + AVAudioPlayerNode.
/// Buffers from xAI realtime `output_audio.delta` are scheduled back-to-back
/// with no temp files and no expo-av segment gaps.
public class AtlasStreamAudioModule: Module {
  private var engine: AVAudioEngine?
  private var playerNode: AVAudioPlayerNode?
  private var audioFormat: AVAudioFormat?
  private var byteRemainder = Data()

  private var scheduledBufferCount = 0
  private var completedBufferCount = 0
  private var isFinishedAppending = false
  private var finishContinuation: CheckedContinuation<Void, Error>?

  private let audioQueue = DispatchQueue(label: "com.atlas.streamaudio.queue")

  public func definition() -> ModuleDefinition {
    Name("AtlasStreamAudio")

    AsyncFunction("startStreaming") { (sampleRate: Double) in
      try await self.startStreaming(sampleRate: sampleRate)
    }

    Function("appendPcmBase64") { (base64: String) in
      self.audioQueue.async {
        self.appendPcmBase64Internal(base64)
      }
    }

    AsyncFunction("finish") {
      try await self.finishPlayback()
    }

    AsyncFunction("stop") {
      self.audioQueue.sync {
        self.teardown(resetSession: false)
      }
    }

    Function("isAvailable") {
      return true
    }
  }

  // MARK: - Setup

  private func startStreaming(sampleRate: Double) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      DispatchQueue.main.async {
        do {
          try self.setupEngine(sampleRate: sampleRate)
          continuation.resume()
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func setupEngine(sampleRate: Double) throws {
    teardown(resetSession: false)

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .default, options: [])
    try session.setActive(true, options: [])

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

    try engine.start()
    player.play()

    self.engine = engine
    self.playerNode = player
    self.audioFormat = format
    self.byteRemainder = Data()
    self.scheduledBufferCount = 0
    self.completedBufferCount = 0
    self.isFinishedAppending = false
    self.finishContinuation = nil
  }

  // MARK: - Append PCM

  private func appendPcmBase64Internal(_ base64: String) {
    guard let player = playerNode, let format = audioFormat else { return }
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

  // MARK: - Finish / teardown

  private func finishPlayback() async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      audioQueue.async {
        self.isFinishedAppending = true
        if self.scheduledBufferCount <= self.completedBufferCount {
          self.teardown(resetSession: false)
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

    teardown(resetSession: false)
    finishContinuation?.resume()
    finishContinuation = nil
  }

  private func teardown(resetSession: Bool) {
    playerNode?.stop()
    engine?.stop()
    playerNode = nil
    engine = nil
    audioFormat = nil
    byteRemainder = Data()
    scheduledBufferCount = 0
    completedBufferCount = 0
    isFinishedAppending = false

    if let continuation = finishContinuation {
      continuation.resume()
      finishContinuation = nil
    }

    if resetSession {
      try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
  }
}
