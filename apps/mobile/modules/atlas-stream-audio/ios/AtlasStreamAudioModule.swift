import AVFoundation
import ExpoModulesCore

/// Gapless PCM16 mono streaming via AVAudioEngine + AVAudioPlayerNode.
///
/// The engine OBJECT is created ONCE (ideally while foreground, via prewarm) and
/// kept alive for the whole voice session; the audio session is activated then and
/// never deactivated until shutdown(). Between turns the engine is *stopped* (not
/// destroyed) so it doesn't fight the capture module for the shared audio hardware
/// while listening. iOS denies *activating* a session in the background, so a new
/// turn while the screen is locked only needs engine.start() on the already-active
/// session — which is allowed — instead of a forbidden fresh activation. This is
/// what makes locked-screen replies actually play. Call shutdown() at session end.
public class AtlasStreamAudioModule: Module {
  private var engine: AVAudioEngine?
  private var playerNode: AVAudioPlayerNode?
  private var audioFormat: AVAudioFormat?
  private var byteRemainder = Data()
  /// Batch xAI deltas; first chunk plays sooner so "Yes sir" isn't swallowed.
  private var pendingBatch = Data()
  private let minScheduleBytes = 4800
  private let firstScheduleBytes = 2400

  private var scheduledBufferCount = 0
  private var completedBufferCount = 0
  private var isFinishedAppending = false
  private var finishContinuation: CheckedContinuation<Void, Error>?
  private var finishTimeoutWork: DispatchWorkItem?

  private let audioQueue = DispatchQueue(label: "com.atlas.streamaudio.queue")
  private var routeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("AtlasStreamAudio")

    AsyncFunction("prewarm") { (sampleRate: Double) in
      try await self.prewarm(sampleRate: sampleRate)
    }

    AsyncFunction("startStreaming") { (sampleRate: Double) in
      try await self.startStreaming(sampleRate: sampleRate)
    }

    AsyncFunction("appendPcmBase64") { (base64: String) in
      try await self.appendPcmBase64(base64)
    }

    AsyncFunction("finish") {
      try await self.finishPlayback()
    }

    AsyncFunction("stop") {
      self.audioQueue.sync {
        self.endPlaybackKeepEngine()
      }
    }

    AsyncFunction("shutdown") {
      await self.shutdown()
    }

    Function("isAvailable") {
      return true
    }
  }

  /// Build the engine ahead of time (call while foreground) so its object and
  /// audio route exist before the screen can lock. Leaves the engine STOPPED so
  /// it doesn't fight the capture module's engine for the shared audio hardware.
  private func prewarm(sampleRate: Double) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      DispatchQueue.main.async {
        do {
          try self.createEngineIfNeeded(sampleRate: sampleRate)
          continuation.resume()
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func startStreaming(sampleRate: Double) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      DispatchQueue.main.async {
        do {
          try self.createEngineIfNeeded(sampleRate: sampleRate)
          self.audioQueue.sync {
            self.playerNode?.stop()
            self.byteRemainder = Data()
            self.pendingBatch = Data()
            self.scheduledBufferCount = 0
            self.completedBufferCount = 0
            self.isFinishedAppending = false
            self.finishContinuation = nil
          }
          try self.ensureRunning()
          continuation.resume()
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  /// Create the engine + player once. Reused across turns. Only rebuilt if the
  /// sample rate changed. Does NOT touch the audio session — the capture module
  /// and activateVoiceSessionAudio() own that. We just create the engine object.
  private func createEngineIfNeeded(sampleRate: Double) throws {
    if engine != nil, playerNode != nil, let format = audioFormat,
       format.sampleRate == sampleRate {
      return
    }

    fullTeardown(resetSession: false)

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
    self.byteRemainder = Data()
    self.pendingBatch = Data()
    self.scheduledBufferCount = 0
    self.completedBufferCount = 0
    self.isFinishedAppending = false
    self.finishContinuation = nil
    ensureRouteObserver()
  }

  /// Match capture module: force speaker only when no Bluetooth headset is active.
  private func bluetoothRouteActive() -> Bool {
    let session = AVAudioSession.sharedInstance()
    let route = session.currentRoute
    let btOutput: Set<AVAudioSession.Port> = [.bluetoothHFP, .bluetoothLE, .bluetoothA2DP]
    if route.outputs.contains(where: { btOutput.contains($0.portType) }) {
      return true
    }
    return route.inputs.contains { input in
      input.portType == .bluetoothHFP || input.portType == .bluetoothLE
    }
  }

  private func applyPlaybackOutputRoute() {
    let session = AVAudioSession.sharedInstance()
    if bluetoothRouteActive() {
      try? session.overrideOutputAudioPort(.none)
    } else {
      try? session.overrideOutputAudioPort(.speaker)
    }
  }

  private func ensureRouteObserver() {
    guard routeObserver == nil else { return }
    routeObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification,
      object: AVAudioSession.sharedInstance(),
      queue: .main
    ) { [weak self] _ in
      self?.audioQueue.async {
        guard let self = self, self.engine?.isRunning == true else { return }
        self.applyPlaybackOutputRoute()
      }
    }
  }

  private func removeRouteObserver() {
    if let observer = routeObserver {
      NotificationCenter.default.removeObserver(observer)
      routeObserver = nil
    }
  }

  /// Resume the existing engine for a new turn. This only START()s an engine on
  /// an already-active session — never re-activates the session — so it works
  /// even while the screen is locked. Re-applies output route each turn.
  private func ensureRunning() throws {
    guard let engine = engine, let player = playerNode else { return }
    // Don't force speaker when AirPods/Bluetooth are active — capture module owns category.
    applyPlaybackOutputRoute()
    if !engine.isRunning {
      engine.prepare()
      try engine.start()
    }
    if !player.isPlaying {
      player.play()
    }
  }

  /// Awaitable append — JS must await each chunk before calling finish().
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

    pendingBatch.append(data)
    let threshold = scheduledBufferCount == 0 ? firstScheduleBytes : minScheduleBytes
    while pendingBatch.count >= threshold {
      let take = min(threshold, pendingBatch.count)
      let slice = pendingBatch.prefix(take)
      pendingBatch.removeFirst(take)
      schedulePcmData(Data(slice))
    }
  }

  /// Flush batched PCM when the API signals audio done (plays tail that was < minScheduleBytes).
  private func flushPendingPcm() {
    var tail = pendingBatch
    pendingBatch = Data()
    if !byteRemainder.isEmpty {
      tail.append(byteRemainder)
      byteRemainder = Data()
    }
    if tail.count % 2 != 0 {
      tail = Data(tail.dropLast())
    }
    if !tail.isEmpty {
      schedulePcmData(tail)
    }
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
      let timeout = DispatchWorkItem { [weak self] in
        guard let self = self else { return }
        self.audioQueue.async {
          guard self.finishContinuation != nil else { return }
          let c = self.finishContinuation
          self.finishContinuation = nil
          self.finishTimeoutWork = nil
          self.resetPlaybackState()
          self.haltEngineKeepObject()
          c?.resume()
        }
      }
      finishTimeoutWork = timeout
      // Safety net only — a normal reply resolves when its buffers drain. Long
      // (multi-minute) replies must not be cut off, so keep this generous.
      DispatchQueue.global().asyncAfter(deadline: .now() + 180, execute: timeout)

      audioQueue.async {
        self.isFinishedAppending = true
        self.flushPendingPcm()
        if self.scheduledBufferCount <= self.completedBufferCount {
          self.finishTimeoutWork?.cancel()
          self.finishTimeoutWork = nil
          self.resetPlaybackState()
          self.haltEngineKeepObject()
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

    finishTimeoutWork?.cancel()
    finishTimeoutWork = nil
    resetPlaybackState()
    haltEngineKeepObject()
    finishContinuation?.resume()
    finishContinuation = nil
  }

  /// End the current utterance. Stops the engine to free the shared audio
  /// hardware for the capture module during listening, but KEEPS the engine
  /// object and the active session so the next turn only needs engine.start()
  /// (allowed in the background) — never a forbidden background session activation.
  private func endPlaybackKeepEngine() {
    resetPlaybackState()
    finishTimeoutWork?.cancel()
    finishTimeoutWork = nil
    haltEngineKeepObject()
    if let continuation = finishContinuation {
      continuation.resume()
      finishContinuation = nil
    }
  }

  /// Stop the player + engine on the main thread (AVAudioEngine control must run
  /// there) without releasing the engine object or deactivating the session.
  private func haltEngineKeepObject() {
    DispatchQueue.main.async {
      self.playerNode?.stop()
      // Brief tail so the last buffer clears the mixer — avoids a sharp cutoff.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
        self.engine?.stop()
      }
    }
  }

  private func resetPlaybackState() {
    byteRemainder = Data()
    pendingBatch = Data()
    scheduledBufferCount = 0
    completedBufferCount = 0
    isFinishedAppending = false
  }

  /// Full release — call when the voice session ends.
  private func shutdown() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      DispatchQueue.main.async {
        self.fullTeardown(resetSession: true)
        continuation.resume()
      }
    }
  }

  private func fullTeardown(resetSession: Bool) {
    removeRouteObserver()
    playerNode?.stop()
    engine?.stop()
    playerNode = nil
    engine = nil
    audioFormat = nil
    resetPlaybackState()

    finishTimeoutWork?.cancel()
    finishTimeoutWork = nil

    if let continuation = finishContinuation {
      continuation.resume()
      finishContinuation = nil
    }

    if resetSession {
      try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
  }
}
