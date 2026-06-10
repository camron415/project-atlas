import AVFoundation
import ExpoModulesCore
import Porcupine

/// Porcupine-iOS wake word — no React Native bridge; works with Expo New Architecture.
public class AtlasWakeWordModule: Module {
  private var porcupine: Porcupine?
  private var engine: AVAudioEngine?
  private var converter: AVAudioConverter?
  private var pcmRemainder = [Int16]()
  private var isListening = false
  private let workQueue = DispatchQueue(label: "com.atlas.wakeword.queue")

  public func definition() -> ModuleDefinition {
    Name("AtlasWakeWord")

    Events("onWake")

    AsyncFunction("start") { (accessKey: String, keyword: String, customPath: String?) in
      try await self.startListening(accessKey: accessKey, keyword: keyword, customPath: customPath)
    }

    AsyncFunction("stop") {
      self.stopListening()
    }

    Function("isAvailable") {
      return true
    }
  }

  private func startListening(accessKey: String, keyword: String, customPath: String?) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      DispatchQueue.main.async { [weak self] in
        guard let self else {
          continuation.resume(throwing: Exception(name: "WakeError", description: "Module deallocated"))
          return
        }
        do {
          try self.setupPorcupine(accessKey: accessKey, keyword: keyword, customPath: customPath)
          try self.setupAudioCapture()
          continuation.resume()
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func setupPorcupine(accessKey: String, keyword: String, customPath: String?) throws {
    teardownPorcupine()

    if let customPath = customPath?.trimmingCharacters(in: .whitespacesAndNewlines), !customPath.isEmpty {
      let path = customPath.hasPrefix("/")
        ? customPath
        : Bundle.main.path(forResource: (customPath as NSString).deletingPathExtension,
                           ofType: (customPath as NSString).pathExtension) ?? customPath
      porcupine = try Porcupine(accessKey: accessKey, keywordPaths: [path])
      return
    }

    let builtIn: Porcupine.BuiltInKeyword
    switch keyword.lowercased() {
    case "jarvis":
      builtIn = .jarvis
    case "porcupine":
      builtIn = .porcupine
    case "computer":
      builtIn = .computer
    default:
      builtIn = .jarvis
    }
    porcupine = try Porcupine(accessKey: accessKey, keyword: builtIn)
  }

  private func setupAudioCapture() throws {
    teardownAudio()

    guard porcupine != nil else {
      throw Exception(name: "WakeError", description: "Porcupine not initialized")
    }

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(
      .playAndRecord,
      mode: .voiceChat,
      options: [.defaultToSpeaker, .allowBluetoothHFP, .mixWithOthers]
    )
    try session.setActive(true, options: [])

    let targetRate = Double(Porcupine.sampleRate)
    guard let targetFormat = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: targetRate,
      channels: 1,
      interleaved: true
    ) else {
      throw Exception(name: "AudioFormatError", description: "Could not create PCM format")
    }

    let engine = AVAudioEngine()
    let inputNode = engine.inputNode
    let inputFormat = inputNode.outputFormat(forBus: 0)

    guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
      throw Exception(name: "ConverterError", description: "Could not create audio converter")
    }
    self.converter = converter

    let frameLength = Int(Porcupine.frameLength)

    inputNode.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      guard let self = self, self.isListening else { return }
      self.workQueue.async {
        self.processAudioBuffer(buffer: buffer, converter: converter, targetFormat: targetFormat, frameLength: frameLength)
      }
    }

    engine.prepare()
    try engine.start()
    self.engine = engine
    self.isListening = true
    pcmRemainder.removeAll()
  }

  private func processAudioBuffer(
    buffer: AVAudioPCMBuffer,
    converter: AVAudioConverter,
    targetFormat: AVAudioFormat,
    frameLength: Int
  ) {
    guard let porcupine = porcupine else { return }

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

    for i in 0..<frames {
      pcmRemainder.append(channelData[0][i])
    }

    while pcmRemainder.count >= frameLength {
      let frame = Array(pcmRemainder.prefix(frameLength))
      pcmRemainder.removeFirst(frameLength)
      do {
        let index = try porcupine.process(pcm: frame)
        if index >= 0 {
          DispatchQueue.main.async {
            self.sendEvent("onWake", ["keywordIndex": index])
          }
        }
      } catch {
        // ignore frame errors
      }
    }
  }

  private func stopListening() {
    DispatchQueue.main.async {
      self.isListening = false
      self.teardownAudio()
      self.teardownPorcupine()
    }
  }

  private func teardownAudio() {
    isListening = false
    pcmRemainder.removeAll()
    if let engine = engine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    engine = nil
    converter = nil
  }

  private func teardownPorcupine() {
    porcupine = nil
  }
}
