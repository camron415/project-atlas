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
  private let processQueue = DispatchQueue(label: "com.atlas.audiocapture.queue")

  public func definition() -> ModuleDefinition {
    Name("AtlasAudioCapture")

    Events("onPcmChunk")

    AsyncFunction("startCapture") {
      try await self.startCapture()
    }

    AsyncFunction("stopCapture") {
      self.stopCapture()
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
    teardown()

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(
      .playAndRecord,
      mode: .voiceChat,
      options: [.defaultToSpeaker, .allowBluetoothHFP]
    )
    try session.setActive(true, options: [])

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
}
