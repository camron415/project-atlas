import Foundation
import os
import FluidAudio

/// On-device ears and mouth. The Mac path stays in charge until `enabled` is on.
final class PhoneVoice {
    static let shared = PhoneVoice()

    static var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: "atlas.phoneInference") }
        set { UserDefaults.standard.set(newValue, forKey: "atlas.phoneInference") }
    }

    private let serial = SerialAsync()
    private let readyFlag = OSAllocatedUnfairLock(initialState: false)
    private let warmFlag = OSAllocatedUnfairLock(initialState: false)
    private let notice = OSAllocatedUnfairLock(initialState: "")
    private var ears: AsrManager?
    private var mouth: KokoroAneManager?
    /// PocketTtsSmallManager, stored untyped so this class still builds for iOS 17.
    private var phonon: AnyObject?
    private var phononVoice = "default"
    private var toldPhononFallback = false
    private var layers = 2
    private var ticket = 0

    var isReady: Bool { readyFlag.withLock { $0 } }
    var phononIsWarm: Bool { warmFlag.withLock { $0 } }

    func takeNotice() -> String {
        notice.withLock { value in
            let current = value
            value = ""
            return current
        }
    }

    private init() {}

    func prepare() async throws {
        try await serial.run { try await self.prepareUnlocked() }
    }

    private func prepareUnlocked() async throws {
        if self.ears != nil, self.mouth != nil { return }
        let mine = self.ticket
        let models = try await AsrModels.downloadAndLoad(version: .v3)
        if mine != self.ticket { return }
        let manager = AsrManager()
        try await manager.loadModels(models)
        let speaker = KokoroAneManager(defaultVoice: "af_heart")
        try await speaker.initialize()
        if mine != self.ticket {
            await manager.cleanup()
            await speaker.cleanup()
            return
        }
        self.layers = models.version.decoderLayers
        self.ears = manager
        self.mouth = speaker
        self.readyFlag.withLock { $0 = true }
    }

    func unload() async {
        try? await serial.run {
            self.ticket += 1
            self.readyFlag.withLock { $0 = false }
            await self.ears?.cleanup()
            self.ears = nil
            if let mouth = self.mouth {
                await mouth.cleanup()
            }
            self.mouth = nil
        }
    }

    /// Seconds of work inside Parakeet, even when that overlapped the pause upload.
    func hear(wav: Data) async throws -> (String, Int) {
        let started = Date()
        let text = try await serial.run { () -> String in
            try Task.checkCancellation()
            try await self.prepareUnlocked()
            guard let ears = self.ears else { return "" }
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("atlas-phone-\(UUID().uuidString).wav")
            try wav.write(to: url)
            defer { try? FileManager.default.removeItem(at: url) }
            var state = TdtDecoderState.make(decoderLayers: self.layers)
            let result = try await ears.transcribe(url, decoderState: &state)
            return result.text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let ms = Int(Date().timeIntervalSince(started) * 1000)
        return (text, ms)
    }

    func speak(_ text: String) async throws -> Data {
        let line = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !line.isEmpty else { return Data() }
        return try await serial.run {
            try Task.checkCancellation()
            try await self.prepareUnlocked()
            if CallPrefs.mouth == "phonon" {
                do {
                    return try await self.phononWav(line)
                } catch {
                    if !self.toldPhononFallback {
                        self.toldPhononFallback = true
                        self.leaveNotice("Phonon didn't load. This line is Kokoro.")
                    }
                }
            }
            guard let mouth = self.mouth else { throw PhoneVoiceError.notReady }
            return try await mouth.synthesize(text: line, voice: "af_heart", speed: 1.05)
        }
    }

    private func leaveNotice(_ text: String) {
        notice.withLock { $0 = text }
    }

    /// Gradium Phonon 31M. Neural Engine for the language steps, one wav per
    /// sentence so the existing clip join stays put. iOS 18 and later.
    private func phononWav(_ line: String) async throws -> Data {
        guard #available(iOS 18.0, *) else {
            throw PhoneVoiceError.notReady
        }
        let speaker = try await loadPhonon()
        return try await speaker.synthesize(text: line, voice: phononVoice)
    }

    @available(iOS 18.0, *)
    private func loadPhonon() async throws -> PocketTtsSmallManager {
        if let ready = phonon as? PocketTtsSmallManager {
            return ready
        }
        let speaker = PocketTtsSmallManager(model: .phonon31m)
        try await speaker.initialize()
        let names = (try? await speaker.availableVoices()) ?? []
        let picked = ["en_us_Zoey", "en_us_Easton", "default"].first { names.contains($0) } ?? names.first ?? "default"
        await speaker.setDefaultVoice(picked)
        phononVoice = picked
        phonon = speaker
        warmFlag.withLock { $0 = true }
        return speaker
    }
}

private enum PhoneVoiceError: LocalizedError {
    case notReady

    var errorDescription: String? {
        switch self {
        case .notReady: return "Phone voice is not loaded."
        }
    }
}

/// One model call at a time. Core ML is not re-entrant.
private final class SerialAsync {
    private let state = OSAllocatedUnfairLock(initialState: Task<Void, Never> {})

    func run<T>(_ body: @escaping () async throws -> T) async throws -> T {
        let box: Task<T, Error> = state.withLock { tail in
            let previous = tail
            let box = Task<T, Error> {
                await previous.value
                return try await body()
            }
            tail = Task { _ = try? await box.value }
            return box
        }
        return try await box.value
    }
}
