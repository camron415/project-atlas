import AVFoundation
import ExpoModulesCore

/// Microphone capture → PCM16 mono @ 16 kHz chunks for xAI streaming STT.
public class AtlasAudioCaptureModule: Module {
  private var engine: AVAudioEngine?
  private var converter: AVAudioConverter?
  private var targetFormat: AVAudioFormat?
  private var byteRemainder = Data()
  private let chunkBytes = 3200
  private let targetSampleRate: Double = 16000
  private var isCapturing = false
  private var holdEngine: AVAudioEngine?
  private let processQueue = DispatchQueue(label: "com.atlas.audiocapture.queue")

  /// Single recording session profile for mic capture + background hold.
  /// JS also configures via expo, but native must be self-sufficient — Phase 2
  /// removed this and mic input silently stopped working.
  private func applyRecordingSession() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(
      .playAndRecord,
      mode: .spokenAudio,
      options: [.defaultToSpeaker, .allowBluetoothHFP, .mixWithOthers]
    )
    try session.setActive(true, options: [])
    try session.overrideOutputAudioPort(.speaker)
  }

  public func definition() -> ModuleDefinition {
    Name("AtlasAudioCapture")

    Events("onPcmChunk")

    AsyncFunction("startCapture") {
      try await self.startCapture()
    }

    AsyncFunction("stopCapture") {
      try await self.stopCaptureAsync()
    }

    AsyncFunction("startBackgroundHold") {
      try await self.startBackgroundHold()
    }

    AsyncFunction("stopBackgroundHold") {
      self.stopBackgroundHold()
    }

    AsyncFunction("releaseAudioSession") {
      try await self.releaseAudioSession()
    }

    Function("isAvailable") {
      return true
    }
  }

  private func startCapture() async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      DispatchQueue.main.async {
        do {
          try self.setupCapture()
          continuation.resume()
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func setupCapture() throws {
    stopBackgroundHold()
    teardown()

    try applyRecordingSession()

    guard let targetFormat = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: targetSampleRate,
      channels: 1,
      interleaved: true
    ) else {
      throw Exception(name: "AudioFormatError", description: "Could not create 16kHz PCM format")
    }
    self.targetFormat = targetFormat

    let engine = AVAudioEngine()
    let inputNode = engine.inputNode
    let inputFormat = inputNode.outputFormat(forBus: 0)

    guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
      throw Exception(name: "ConverterError", description: "Could not create audio converter")
    }
    self.converter = converter

    inputNode.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      guard let self = self else { return }
      self.processQueue.async {
        self.processInput(buffer: buffer, converter: converter, targetFormat: targetFormat)
      }
    }

    engine.prepare()
    try engine.start()
    self.engine = engine
    self.isCapturing = true
  }

  private func processInput(
    buffer: AVAudioPCMBuffer,
    converter: AVAudioConverter,
    targetFormat: AVAudioFormat
  ) {
    guard isCapturing else { return }

    let ratio = targetFormat.sampleRate / buffer.format.sampleRate
    let frameCapacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32

    guard let converted = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: frameCapacity) else {
      return
    }

    var error: NSError?
    var consumed = false
    let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
      if consumed {
        outStatus.pointee = .noDataNow
        return nil
      }
      consumed = true
      outStatus.pointee = .haveData
      return buffer
    }

    converter.convert(to: converted, error: &error, withInputFrom: inputBlock)
    if error != nil { return }

    guard let channelData = converted.int16ChannelData else { return }
    let frames = Int(converted.frameLength)
    if frames == 0 { return }

    let byteCount = frames * MemoryLayout<Int16>.size
    let chunk = Data(bytes: channelData[0], count: byteCount)

    byteRemainder.append(chunk)
    while byteRemainder.count >= chunkBytes {
      let slice = byteRemainder.prefix(chunkBytes)
      byteRemainder.removeFirst(chunkBytes)
      let base64 = Data(slice).base64EncodedString()
      sendEvent("onPcmChunk", ["base64": base64, "bytes": chunkBytes])
    }
  }

  private func stopCaptureAsync() async throws {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      DispatchQueue.main.async {
        self.teardown()
        continuation.resume()
      }
    }
  }

  private func stopCapture() {
    DispatchQueue.main.async {
      self.teardown()
    }
  }

  private func teardown() {
    isCapturing = false
    byteRemainder.removeAll()

    if let engine = engine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    engine = nil
    converter = nil
    targetFormat = nil
  }

  /// Silent input tap — keeps playAndRecord alive while screen is off during thinking/speaking.
  private func startBackgroundHold() async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      DispatchQueue.main.async {
        do {
          try self.setupBackgroundHold()
          continuation.resume()
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func setupBackgroundHold() throws {
    if isCapturing || holdEngine != nil { return }

    try applyRecordingSession()

    let engine = AVAudioEngine()
    let inputNode = engine.inputNode
    let format = inputNode.outputFormat(forBus: 0)
    inputNode.installTap(onBus: 0, bufferSize: 512, format: format) { _, _ in }

    engine.prepare()
    try engine.start()
    holdEngine = engine
  }

  private func stopBackgroundHold() {
    if Thread.isMainThread {
      self.teardownBackgroundHold()
    } else {
      DispatchQueue.main.sync {
        self.teardownBackgroundHold()
      }
    }
  }

  private func teardownBackgroundHold() {
    if let engine = holdEngine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    holdEngine = nil
  }

  /// Return audio focus to other apps (YouTube, Music, etc.) when voice session ends.
  private func releaseAudioSession() async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      DispatchQueue.main.async {
        self.teardown()
        self.teardownBackgroundHold()
        do {
          try AVAudioSession.sharedInstance().setActive(
            false,
            options: [.notifyOthersOnDeactivation]
          )
          continuation.resume()
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }
}
