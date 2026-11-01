import AVFoundation
import UIKit
import WebKit

/// The call itself. Capture, end-of-turn, and playback stay here so the
/// screen can lock without suspending the turn. The web page is the display.
enum CallLoop {
    static var isOn = false

    private static weak var web: WKWebView?
    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 300
        return URLSession(configuration: config)
    }()
    private static let gate = CallLink.gate
    private static let origin = CallLink.origin

    private enum Phase { case idle, listening, thinking, speaking }
    private enum Capture { case off, listen }

    private static var phase: Phase = .idle
    private static var capture: Capture = .off
    private static let audioLock = NSLock()
    private static var samples: [Float] = []
    private static var sampleRate: Double = 48000
    private static var heard = false
    private static var silence: Double = 0
    private static var nextProbe: Double = 0.42
    private static var armedForce = false
    private static var partials = 0
    private static var partialAt: Date?
    private static var partialBusy = false
    private static var probeBusy = false
    private static var turnSerial = 0
    private static var turnId = ""
    private static var era = 0
    private static var task: Task<Void, Never>?
    private static var clips: [Data] = []
    private static var clipPlaying = false
    private static var streamOpen = false
    private static var replyOpen = false
    private static var lastStatus = "Listening…"
    private static var watchedInterrupt = false
    static var micMuted = false
    private static var muteAt = Date.distantPast
    private static var noise = 0.0

    static func arm(web: WKWebView?) {
        self.web = web
        isOn = true
        watchInterruptions()
        let start = {
            do {
                try CallEngine.armDuplex()
                Task { await greetThenListen() }
            } catch {
                failToWeb()
            }
        }
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted:
                start()
            case .undetermined:
                AVAudioApplication.requestRecordPermission { allowed in
                    DispatchQueue.main.async { allowed ? start() : failToWeb() }
                }
            default:
                failToWeb()
            }
        } else {
            start()
        }
    }

    static func disarm() {
        isOn = false
        micMuted = false
        setCapture(.off)
        phase = .idle
        cancelWork()
        clips.removeAll()
        clipPlaying = false
        streamOpen = false
        CallEngine.shutdown()
    }

    static func userBarged() {
        guard isOn, phase == .speaking || phase == .thinking else { return }
        cancelWork()
        CallEngine.haltPlayback()
        clips.removeAll()
        clipPlaying = false
        streamOpen = false
        replyOpen = false
        beginListen()
    }

    static func typed(_ text: String) {
        let line = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isOn, !line.isEmpty else { return }
        cancelWork()
        CallEngine.haltPlayback()
        clips.removeAll()
        clipPlaying = false
        phase = .thinking
        setCapture(.off)
        showYou(line, live: false)
        note("Thinking…")
        notePhase("thinking")
        let id = nextTurn()
        let stamp = era
        task = Task { await postJSON(line, id: id, era: stamp) }
    }

    static func toggleMute() {
        guard isOn else { return }
        let now = Date()
        guard now.timeIntervalSince(muteAt) > 0.4 else { return }
        muteAt = now
        micMuted.toggle()
        if micMuted {
            if phase == .listening { cancelWork() }
            setCapture(.off)
            CallEngine.setInputMuted(true)
            heard = false
            silence = 0
            noise = 0
            note("Muted")
            notePhase("muted")
        } else if phase == .speaking || phase == .thinking {
            note(phase == .speaking ? "Speaking… talk to interrupt" : "Thinking…")
        } else {
            beginListen()
        }
        script("window.atlasMuted && window.atlasMuted(\(micMuted ? "true" : "false"))")
    }

    static func engineCameBack() {
        guard isOn else { return }
        switch phase {
        case .listening, .thinking:
            if micMuted {
                CallEngine.setInputMuted(true)
                setCapture(.off)
            } else {
                CallEngine.setInputMuted(false)
                setCapture(phase == .listening ? .listen : .off)
            }
        case .speaking:
            CallEngine.setInputMuted(true)
            setCapture(.off)
        case .idle:
            setCapture(.off)
        }
    }

    static func failToWeb() {
        disarm()
        script("window.atlasFail && window.atlasFail()")
    }

    static func refreshScreen() {
        guard isOn else { return }
        note(lastStatus)
    }

    static func ingest(_ buffer: AVAudioPCMBuffer) {
        audioLock.lock()
        let mode = capture
        audioLock.unlock()
        if mode == .off {
            DispatchQueue.main.async {
                guard isOn, phase == .listening, !micMuted else { return }
                audioLock.lock()
                let stillOff = capture == .off
                audioLock.unlock()
                guard stillOff else { return }
                setCapture(.listen)
                CallEngine.setInputMuted(false)
            }
            return
        }
        guard let channel = buffer.floatChannelData?[0] else { return }
        let count = Int(buffer.frameLength)
        guard count > 0 else { return }
        let rate = buffer.format.sampleRate
        guard rate > 8000 else { return }
        var sum = 0.0
        var chunk = [Float](repeating: 0, count: count)
        for index in 0..<count {
            let sample = channel[index]
            chunk[index] = sample
            sum += Double(sample * sample)
        }
        let rms = (sum / Double(count)).squareRoot()
        let dt = Double(count) / rate
        if mode == .listen {
            audioLock.lock()
            sampleRate = rate
            samples.append(contentsOf: chunk)
            let cap = Int(rate * 90)
            if samples.count > cap { samples.removeFirst(samples.count - cap) }
            audioLock.unlock()
        }
        DispatchQueue.main.async {
            guard isOn, phase == .listening, !micMuted else { return }
            vad(rms: rms, dt: dt)
        }
    }

    private static func setCapture(_ mode: Capture) {
        audioLock.lock()
        capture = mode
        audioLock.unlock()
    }

    private static func greetThenListen() async {
        phase = .speaking
        setCapture(.off)
        note("Speaking… talk to interrupt")
        notePhase("speaking")
        if let wav = await getWav("/greeting"), isOn {
            await MainActor.run { playGreeting(wav) }
        } else if isOn {
            await MainActor.run { beginListen() }
        }
    }

    private static func playGreeting(_ wav: Data) {
        do {
            try CallEngine.playWav(wav) {
                guard isOn, phase == .speaking, !streamOpen, clips.isEmpty else { return }
                beginListen()
            }
        } catch {
            beginListen()
        }
    }

    private static func beginListen() {
        guard isOn else { return }
        if micMuted {
            phase = .listening
            setCapture(.off)
            CallEngine.setInputMuted(true)
            heard = false
            silence = 0
            note("Muted")
            notePhase("muted")
            return
        }
        phase = .listening
        setCapture(.listen)
        CallEngine.setInputMuted(false)
        heard = false
        silence = 0
        nextProbe = 0.42
        armedForce = false
        partials = 0
        partialAt = nil
        probeBusy = false
        noise = 0
        replyOpen = false
        audioLock.lock()
        samples.removeAll()
        audioLock.unlock()
        note("Listening…")
        notePhase("listening")
    }

    private static func vad(rms: Double, dt: Double) {
        guard !micMuted else { return }
        let speaking = rms > (heard ? 0.018 : 0.026)
        if speaking {
            if !heard {
                audioLock.lock()
                let keep = Int(sampleRate * 0.3)
                if samples.count > keep { samples.removeFirst(samples.count - keep) }
                audioLock.unlock()
                note("Hearing you…")
                showYou("…", live: true)
                noise = 0
            }
            noise += dt
            // A short bump on the phone mic is not a new sentence. Let the pause finish.
            if silence > 0.2 && noise < 0.28 { return }
            heard = true
            silence = 0
            armedForce = false
            nextProbe = 0.42
            let now = Date()
            if partialAt == nil {
                partialAt = now
            } else if !partialBusy {
                let wait = partials == 0 ? 0.4 : 1.8
                if now.timeIntervalSince(partialAt!) >= wait {
                    partialAt = now
                    partials += 1
                    sendPartial()
                }
            }
        } else if heard {
            noise = 0
            if silence == 0, !partialBusy, partials == 0 || (partialAt != nil && Date().timeIntervalSince(partialAt!) > 0.5) {
                partialAt = Date()
                partials += 1
                sendPartial()
            }
            silence += dt
            if !armedForce, silence >= 1.35 {
                armedForce = true
                sendTurn(force: true)
            } else if !probeBusy, silence >= nextProbe, silence < 1.35 {
                nextProbe = silence + 0.45
                sendTurn(force: false)
            }
        }
    }

    private static func sendPartial() {
        guard phase == .listening, !partialBusy, let wav = snapshot(maxSeconds: 8), wav.count > 1200 else { return }
        partialBusy = true
        let stamp = era
        Task {
            let text = await postHear(wav)
            await MainActor.run {
                partialBusy = false
                guard stamp == era, phase == .listening, !text.isEmpty else { return }
                showYou(text, live: true)
            }
        }
    }

    private static func sendTurn(force: Bool) {
        guard let wav = snapshot(maxSeconds: nil), wav.count > 1200 else {
            if force { heard = false; silence = 0; armedForce = false }
            return
        }
        if !force, probeBusy { return }
        if force { cancelWork() }
        if force {
            phase = .thinking
            setCapture(.off)
            note("Thinking…")
            notePhase("thinking")
        } else {
            probeBusy = true
        }
        let id = nextTurn()
        let stamp = era
        task = Task { await postAudio(wav, probe: !force, id: id, era: stamp) }
    }

    private static func postAudio(_ wav: Data, probe: Bool, id: String, era stamp: Int) async {
        let bg = await MainActor.run { beginBackground() }
        defer { endBackground(bg) }
        var fields: [(String, String)] = []
        if probe { fields.append(("probe", "1")) }
        let (body, boundary) = multipart(fields: fields, file: wav, filename: "turn.wav")
        var request = authorized("/turn")
        request.httpMethod = "POST"
        request.setValue(id, forHTTPHeaderField: "X-Atlas-Turn")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard stamp == era else { return }
            guard let http = response as? HTTPURLResponse else { return }
            let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
            if type.contains("json") || http.statusCode >= 400 {
                var data = Data()
                for try await byte in bytes { data.append(byte) }
                await MainActor.run {
                    guard stamp == era else { return }
                    probeBusy = false
                    if !probe {
                        let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                        openReply(message ?? "I lost that. Say it once more.")
                        beginListen()
                    }
                }
                return
            }
            await MainActor.run {
                guard stamp == era else { return }
                probeBusy = false
                phase = .thinking
                setCapture(.off)
                streamOpen = true
                note("Thinking…")
                notePhase("thinking")
            }
            try await readEvents(bytes, era: stamp)
            await MainActor.run {
                guard stamp == era, isOn else { return }
                streamOpen = false
                if !clipPlaying, clips.isEmpty, phase != .listening { beginListen() }
            }
        } catch {
            await MainActor.run {
                guard stamp == era, isOn else { return }
                probeBusy = false
                streamOpen = false
                if phase != .listening { beginListen() }
            }
        }
    }

    private static func postJSON(_ text: String, id: String, era stamp: Int) async {
        let bg = await MainActor.run { beginBackground() }
        defer { endBackground(bg) }
        var request = authorized("/turn")
        request.httpMethod = "POST"
        request.setValue(id, forHTTPHeaderField: "X-Atlas-Turn")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["text": text])
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard stamp == era, let http = response as? HTTPURLResponse, http.statusCode < 400 else {
                await MainActor.run {
                    guard stamp == era else { return }
                    openReply("I lost that. Say it once more.")
                    beginListen()
                }
                return
            }
            await MainActor.run {
                guard stamp == era else { return }
                streamOpen = true
                phase = .thinking
                setCapture(.off)
            }
            try await readEvents(bytes, era: stamp)
            await MainActor.run {
                guard stamp == era, isOn else { return }
                streamOpen = false
                if !clipPlaying, clips.isEmpty { beginListen() }
            }
        } catch {
            await MainActor.run {
                guard stamp == era, isOn else { return }
                streamOpen = false
                beginListen()
            }
        }
    }

    private static func readEvents(_ bytes: URLSession.AsyncBytes, era stamp: Int) async throws {
        var event = "message"
        for try await line in bytes.lines {
            if Task.isCancelled || stamp != era { return }
            var row = line
            if row.hasSuffix("\r") { row.removeLast() }
            if row.isEmpty || row.hasPrefix(":") { continue }
            if row.hasPrefix("event:") {
                event = row.dropFirst(6).trimmingCharacters(in: .whitespaces)
            } else if row.hasPrefix("data:") {
                let payload = row.dropFirst(5).trimmingCharacters(in: .whitespaces)
                let name = event
                event = "message"
                await MainActor.run {
                    guard stamp == era else { return }
                    deliver("event: \(name)\ndata: \(payload)\n")
                }
            }
        }
    }

    private static func deliver(_ part: String) {
        var event = "message"
        var dataLines: [String] = []
        for line in part.split(separator: "\n", omittingEmptySubsequences: false) {
            let row = String(line)
            if row.hasPrefix("event:") {
                event = row.dropFirst(6).trimmingCharacters(in: .whitespaces)
            } else if row.hasPrefix("data:") {
                dataLines.append(row.dropFirst(5).trimmingCharacters(in: .whitespaces))
            }
        }
        guard let raw = dataLines.joined(separator: "\n").data(using: .utf8),
              let data = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else { return }
        switch event {
        case "status":
            note(data["detail"] as? String ?? "Working…")
        case "transcript":
            showYou(data["text"] as? String ?? "(silence)", live: false)
        case "delta":
            appendReply(data["text"] as? String ?? "")
        case "audio":
            if let b64 = data["wav_b64"] as? String, let wav = Data(base64Encoded: b64), !wav.isEmpty {
                clips.append(wav)
                if !clipPlaying { playHead() }
            }
        case "restart":
            CallEngine.haltPlayback()
            clips.removeAll()
            clipPlaying = false
            replyOpen = false
            script("window.atlasRestart && window.atlasRestart()")
        case "done":
            if let text = data["text"] as? String, !text.isEmpty { closeReply(text) }
            if let timing = data["timing"] as? [String: Any] {
                let heardMs = timing["stt_ms"] as? Int ?? 0
                let words = timing["first_token_ms"] as? Int ?? 0
                let audio = timing["first_audio_ms"] as? Int ?? 0
                script("window.atlasMeta && window.atlasMeta(\(jsQuote("Heard \(heardMs) ms · first words \(words) ms · first audio \(audio) ms")))")
            }
            streamOpen = false
            if !clipPlaying, clips.isEmpty { beginListen() }
        case "error":
            closeReply(data["message"] as? String ?? "Turn failed.")
            streamOpen = false
            if !clipPlaying, clips.isEmpty { beginListen() }
        default:
            break
        }
    }

    private static func playHead() {
        guard isOn else { return }
        guard !clips.isEmpty else {
            clipPlaying = false
            if !streamOpen { beginListen() }
            return
        }
        let wav = clips.removeFirst()
        clipPlaying = true
        phase = .speaking
        setCapture(.off)
        note("Speaking… talk to interrupt")
        notePhase("speaking")
        do {
            try CallEngine.playWav(wav) { playHead() }
        } catch {
            clipPlaying = false
            beginListen()
        }
    }

    private static func snapshot(maxSeconds: Double?) -> Data? {
        audioLock.lock()
        let rate = sampleRate
        var copy = samples
        audioLock.unlock()
        guard rate > 8000 else { return nil }
        let cap = min(maxSeconds ?? 22, 22)
        let need = Int(rate * cap)
        if copy.count > need { copy.removeFirst(copy.count - need) }
        guard copy.count >= Int(rate * 0.3) else { return nil }
        return wavFile(copy, rate: rate)
    }

    private static func wavFile(_ samples: [Float], rate: Double) -> Data {
        var data = Data(capacity: 44 + samples.count * 2)
        func text(_ value: String) { data.append(value.data(using: .utf8)!) }
        func u32(_ value: UInt32) { var endian = value.littleEndian; data.append(Data(bytes: &endian, count: 4)) }
        func u16(_ value: UInt16) { var endian = value.littleEndian; data.append(Data(bytes: &endian, count: 2)) }
        text("RIFF")
        u32(UInt32(36 + samples.count * 2))
        text("WAVE")
        text("fmt ")
        u32(16)
        u16(1)
        u16(1)
        u32(UInt32(rate))
        u32(UInt32(rate * 2))
        u16(2)
        u16(16)
        text("data")
        u32(UInt32(samples.count * 2))
        for sample in samples {
            let clipped = max(-1, min(1, sample))
            var endian = Int16(clipped < 0 ? clipped * 32768 : clipped * 32767).littleEndian
            data.append(Data(bytes: &endian, count: 2))
        }
        return data
    }

    private static func postHear(_ wav: Data) async -> String {
        let (body, boundary) = multipart(fields: [], file: wav, filename: "hear.wav")
        var request = authorized("/hear")
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode < 400,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  obj["busy"] as? Bool != true,
                  let text = obj["text"] as? String else { return "" }
            return text
        } catch {
            return ""
        }
    }

    private static func getWav(_ path: String) async -> Data? {
        var request = authorized(path)
        request.httpMethod = "GET"
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode < 400, data.count > 44 else { return nil }
            let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
            guard type.contains("wav") || type.contains("audio") else { return nil }
            return data
        } catch {
            return nil
        }
    }

    private static func postCancel(_ id: String) async {
        var request = authorized("/cancel")
        request.httpMethod = "POST"
        request.setValue(id, forHTTPHeaderField: "X-Atlas-Turn")
        _ = try? await session.data(for: request)
    }

    private static func cancelWork() {
        era += 1
        probeBusy = false
        task?.cancel()
        task = nil
        let id = turnId
        guard !id.isEmpty else { return }
        Task { await postCancel(id) }
    }

    private static func nextTurn() -> String {
        turnSerial += 1
        turnId = String(turnSerial)
        return turnId
    }

    private static func authorized(_ path: String) -> URLRequest {
        let url = origin.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path)
        var request = URLRequest(url: url)
        if !gate.isEmpty { request.setValue(gate, forHTTPHeaderField: "X-Atlas-Gate") }
        return request
    }

    private static func multipart(fields: [(String, String)], file: Data, filename: String) -> (Data, String) {
        let boundary = "atlas\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        var body = Data()
        func text(_ value: String) { body.append(value.data(using: .utf8)!) }
        for (name, value) in fields {
            text("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        text("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"\(filename)\"\r\nContent-Type: audio/wav\r\n\r\n")
        body.append(file)
        text("\r\n--\(boundary)--\r\n")
        return (body, boundary)
    }

    private static func beginBackground() -> UIBackgroundTaskIdentifier {
        UIApplication.shared.beginBackgroundTask(withName: "atlas-turn", expirationHandler: nil)
    }

    private static func endBackground(_ token: UIBackgroundTaskIdentifier) {
        guard token != .invalid else { return }
        DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(token) }
    }

    private static func watchInterruptions() {
        guard !watchedInterrupt else { return }
        watchedInterrupt = true
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard raw == AVAudioSession.InterruptionType.ended.rawValue else { return }
            CallEngine.resumeIfNeeded()
        }
    }

    private static func showYou(_ text: String, live: Bool) {
        script("window.atlasYou && window.atlasYou(\(jsQuote(text)), \(live ? "true" : "false"))")
    }

    private static func openReply(_ text: String) {
        replyOpen = true
        script("window.atlasReply && window.atlasReply(\(jsQuote(text)), 'open')")
    }

    private static func appendReply(_ text: String) {
        if !replyOpen { openReply("") }
        guard !text.isEmpty else { return }
        script("window.atlasReply && window.atlasReply(\(jsQuote(text)), 'add')")
    }

    private static func closeReply(_ text: String) {
        replyOpen = false
        script("window.atlasReply && window.atlasReply(\(jsQuote(text)), 'close')")
    }

    private static func note(_ text: String) {
        lastStatus = text
        script("window.atlasStatus && window.atlasStatus(\(jsQuote(text)))")
    }

    private static func notePhase(_ phase: String) {
        script("window.atlasPhase && window.atlasPhase(\(jsQuote(phase)))")
    }

    private static func script(_ source: String) {
        DispatchQueue.main.async { web?.evaluateJavaScript(source, completionHandler: nil) }
    }

    private static func jsQuote(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]),
              var text = String(data: data, encoding: .utf8), text.count >= 2 else { return "\"\"" }
        text.removeFirst()
        text.removeLast()
        return text
    }
}

extension CallLink {
    static var origin: URL {
        var parts = URLComponents(url: page, resolvingAgainstBaseURL: false)
        parts?.query = nil
        parts?.path = ""
        return parts?.url ?? page
    }

    static var gate: String {
        URLComponents(url: page, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first { $0.name == "k" }?
            .value ?? ""
    }
}
