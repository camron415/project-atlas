import AVFoundation
import SwiftUI
import WebKit

enum CallAudio {
    private static var watching = false
    private static let options: AVAudioSession.CategoryOptions = [.defaultToSpeaker, .allowBluetoothHFP]
    private static let headphones: Set<AVAudioSession.Port> = [
        .bluetoothHFP, .bluetoothA2DP, .bluetoothLE, .headphones, .headsetMic, .airPlay
    ]

    static func start() {
        nudge()
        guard !watching else { return }
        watching = true
        let session = AVAudioSession.sharedInstance()
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: session,
            queue: .main
        ) { _ in nudge() }
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: session,
            queue: .main
        ) { note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            if raw == AVAudioSession.InterruptionType.ended.rawValue {
                nudge()
            }
        }
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in nudge() }
    }

    /// playAndRecord alone comes out the earpiece. Headphones keep their route.
    /// A bare phone is forced to the loudspeaker. Video chat keeps echo
    /// cancellation without the narrow speakerphone tone of voice chat.
    static func nudge() {
        let session = AVAudioSession.sharedInstance()
        let outs = session.currentRoute.outputs.map(\.portType)
        let external = outs.contains(where: { headphones.contains($0) })
        if external {
            if session.category != .playAndRecord || session.mode != .videoChat {
                try? session.setCategory(.playAndRecord, mode: .videoChat, options: options)
            }
            if outs.contains(.builtInReceiver) || outs.contains(.builtInSpeaker) {
                try? session.overrideOutputAudioPort(.none)
            }
            return
        }
        if session.category != .playAndRecord || session.mode != .videoChat || outs.contains(.builtInReceiver) {
            try? session.setCategory(.playAndRecord, mode: .videoChat, options: options)
            try? session.setActive(true)
            try? session.overrideOutputAudioPort(.speaker)
        }
    }
}

enum CallLink {
    /// The full address, including the gate, lives in call-url.local and is not committed.
    static let page: URL = {
        if let file = Bundle.main.url(forResource: "call-url", withExtension: "local"),
           let text = try? String(contentsOf: file, encoding: .utf8) {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if let url = URL(string: trimmed), url.scheme == "https" {
                return url
            }
        }
        return URL(string: "https://camrons-mac-mini.tail5f7dec.ts.net/?call=1")!
    }()
}

enum CallEngine {
    private static let engine = AVAudioEngine()
    private static let player = AVAudioPlayerNode()
    private static let cue = AVAudioPlayerNode()
    private static let cueFormat = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
    static var cueUntil = Date.distantPast
    static var isAudible: Bool { playing }
    private static var attached = false
    private static var tapInstalled = false
    private static var starting = false
    private static var generation = 0
    private static var playing = false
    private static var ignoreUntil = Date.distantPast
    private static var clipSentence = ""
    private static var clipStarted = Date()
    private static var clipSeconds = 0.0
    private static var bargeWork: DispatchWorkItem?
    private static var bargeQuiet: DispatchWorkItem?
    static var duplex = false
    static var locked = false
    static weak var web: WKWebView?

    static func play(base64: String, web: WKWebView?) {
        self.web = web
        let start = {
            DispatchQueue.main.async { self.begin(base64) }
        }
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted:
                start()
            case .undetermined:
                AVAudioApplication.requestRecordPermission { allowed in
                    if allowed { start() } else { DispatchQueue.main.async { self.signal("fail") } }
                }
            default:
                signal("fail")
            }
        } else {
            start()
        }
    }

    private static func begin(_ base64: String) {
        guard let data = Data(base64Encoded: base64), !data.isEmpty else {
            signal("fail")
            return
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        do {
            try data.write(to: url)
        } catch {
            signal("fail")
            return
        }
        generation += 1
        let token = generation
        do {
            try boot()
            let file = try AVAudioFile(forReading: url)
            let seconds = Double(file.length) / file.processingFormat.sampleRate
            let started = Date()
            ignoreUntil = started.addingTimeInterval(0.7)
            playing = true
            player.scheduleFile(file, at: nil) {
                DispatchQueue.main.async {
                    let remain = seconds - Date().timeIntervalSince(started) - 0.05
                    let finish = {
                        try? FileManager.default.removeItem(at: url)
                        guard token == generation, playing else { return }
                        playing = false
                        signal("ended")
                    }
                    if remain > 0.15 {
                        DispatchQueue.main.asyncAfter(deadline: .now() + remain, execute: finish)
                    } else {
                        finish()
                    }
                }
            }
            if !player.isPlaying { player.play() }
        } catch {
            playing = false
            try? FileManager.default.removeItem(at: url)
            signal("fail")
        }
    }

    static func stop() {
        if CallLoop.isOn { return }
        generation += 1
        playing = false
        if player.isPlaying { player.stop() }
        if engine.isRunning { engine.stop() }
    }

    /// One engine for the whole call. The player is attached before voice processing.
    /// The tap goes on after voice processing and before start. The engine stays running between turns.
    static func armDuplex() throws {
        if starting { return }
        starting = true
        defer { starting = false }
        duplex = true
        if engine.isRunning { engine.stop() }
        try configure()
        let input = engine.inputNode
        if tapInstalled {
            input.removeTap(onBus: 0)
            tapInstalled = false
        }
        let format = input.outputFormat(forBus: 0)
        guard format.channelCount > 0, format.sampleRate > 8000 else {
            duplex = false
            throw NSError(domain: "Atlas", code: 1)
        }
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { buffer, _ in
            CallLoop.ingest(buffer)
        }
        tapInstalled = true
        engine.prepare()
        try engine.start()
        watchReset()
    }

    static func setInputMuted(_ muted: Bool) {
        engine.inputNode.isVoiceProcessingInputMuted = muted
        if !muted {
            bargeWork?.cancel()
            bargeWork = nil
            bargeQuiet?.cancel()
            bargeQuiet = nil
        }
    }

    /// Two short notes. Mute falls. Unmute rises. Quiet enough to miss the barge meter.
    static func playCue(_ kind: String) {
        guard engine.isRunning else { return }
        let rising = kind == "unmute"
        guard let buffer = tone(rising: rising) else { return }
        cueUntil = Date().addingTimeInterval(0.4)
        cue.scheduleBuffer(buffer, at: nil, options: .interrupts)
        if !cue.isPlaying { cue.play() }
    }

    private static func tone(rising: Bool) -> AVAudioPCMBuffer? {
        let format = cueFormat
        let rate = format.sampleRate
        guard rate > 8000, format.channelCount > 0 else { return nil }
        let freqs = rising ? [494.0, 740.0] : [370.0, 247.0]
        let note = 0.09
        let gap = 0.04
        let total = note * 2 + gap
        let frames = AVAudioFrameCount(rate * total)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buffer.frameLength = frames
        let channels = Int(format.channelCount)
        for channel in 0..<channels {
            guard let samples = buffer.floatChannelData?[channel] else { continue }
            for frame in 0..<Int(frames) {
                let t = Double(frame) / rate
                let which = t < note ? 0 : (t < note + gap ? -1 : 1)
                var amp = 0.0
                if which >= 0 {
                    let local = which == 0 ? t : t - note - gap
                    let edge = min(local, note - local, 0.012)
                    amp = 0.11 * max(0, edge / 0.012)
                    let wave = sin(2 * Double.pi * freqs[which] * t)
                    samples[frame] = Float(amp * wave)
                } else {
                    samples[frame] = 0
                }
            }
        }
        return buffer
    }

    /// Listening means the mic is actually open. A stuck voice-processing mute
    /// leaves the screen on Listening and feeds the turn nothing but silence.
    static func ensureInputOpen() {
        guard !CallLoop.micMuted else { return }
        if engine.inputNode.isVoiceProcessingInputMuted {
            engine.inputNode.isVoiceProcessingInputMuted = false
        }
    }

    static func playWav(_ data: Data, done: @escaping () -> Void) throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        try data.write(to: url)
        let file = try AVAudioFile(forReading: url)
        let seconds = Double(file.length) / file.processingFormat.sampleRate
        generation += 1
        let token = generation
        let started = Date()
        clipStarted = started
        clipSeconds = seconds
        ignoreUntil = started.addingTimeInterval(0.7)
        playing = true
        setInputMuted(CallLoop.micMuted)
        player.scheduleFile(file, at: nil) {
            DispatchQueue.main.async {
                let remain = seconds - Date().timeIntervalSince(started) - 0.05
                let finish = {
                    try? FileManager.default.removeItem(at: url)
                    guard token == generation, playing else { return }
                    playing = false
                    done()
                }
                if remain > 0.15 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + remain, execute: finish)
                } else {
                    finish()
                }
            }
        }
        if !player.isPlaying { player.play() }
    }

    static func armClip(_ sentence: String) {
        clipSentence = sentence
    }

    struct CutReport {
        var sentence = ""
        var heard = ""
        var playedMs = 0
        var fraction = 0.0
        var route = "speaker"
    }

    static func cutReport() -> CutReport {
        var report = CutReport()
        report.route = outputRoute()
        report.sentence = clipSentence
        guard playing, clipSeconds > 0 else { return report }
        let played = max(0, Date().timeIntervalSince(clipStarted))
        let fraction = min(1, played / clipSeconds)
        report.playedMs = Int(played * 1000)
        report.fraction = fraction
        report.heard = heardPrefix(clipSentence, fraction: fraction)
        return report
    }

    static func outputRoute() -> String {
        for port in AVAudioSession.sharedInstance().currentRoute.outputs {
            switch port.portType {
            case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE, .headphones, .headsetMic, .airPlay:
                return "headphones"
            default:
                break
            }
        }
        return "speaker"
    }

    private static func heardPrefix(_ sentence: String, fraction: Double) -> String {
        let words = sentence.split(separator: " ").map(String.init)
        if words.isEmpty || fraction < 0.08 { return "" }
        if fraction > 0.92 { return sentence }
        let count = max(1, Int((Double(words.count) * fraction).rounded()))
        return words.prefix(count).joined(separator: " ")
    }

    static var phoneAhead: Int {
        max(0, phoneSegs.count - (playing ? 1 : 0))
    }

    /// Phone clips share one running player. The next sentence is scheduled
    /// before the current one ends, so the join is a short breath, not a stop.
    /// scheduleFile converts into the player's format. scheduleBuffer does not,
    /// and a mismatch there aborts the app.
    @discardableResult
    static func queuePhone(sentence: String, wav: Data) throws -> Bool {
        guard let clip = try trimmedClip(wav) else { return false }
        try boot()
        let token = generation
        let opening = phoneSegs.isEmpty && !playing
        let seg = PhoneSeg(sentence: sentence, file: clip.file, url: clip.url, seconds: clip.seconds)
        phoneSegs.append(seg)
        if opening {
            armClip(sentence)
            clipStarted = Date()
            clipSeconds = seg.seconds
            ignoreUntil = Date().addingTimeInterval(0.7)
            playing = true
            setInputMuted(CallLoop.micMuted)
        }
        player.scheduleFile(seg.file, at: nil, completionCallbackType: .dataPlayedBack) { _ in
            DispatchQueue.main.async {
                guard token == generation else { return }
                if !phoneSegs.isEmpty {
                    let done = phoneSegs.removeFirst()
                    try? FileManager.default.removeItem(at: done.url)
                }
                if let next = phoneSegs.first {
                    armClip(next.sentence)
                    clipStarted = Date()
                    clipSeconds = next.seconds
                } else {
                    playing = false
                    CallLoop.phoneSpeechEnded()
                }
            }
        }
        if !player.isPlaying { player.play() }
        return true
    }

    private struct PhoneSeg {
        var sentence: String
        var file: AVAudioFile
        var url: URL
        var seconds: Double
    }

    private static var phoneSegs: [PhoneSeg] = []

    private static func clearPhoneSegs() {
        let urls = phoneSegs.map(\.url)
        phoneSegs.removeAll()
        for url in urls { try? FileManager.default.removeItem(at: url) }
    }

    /// Trim the quiet, write a normal wav, and let scheduleFile match the player.
    private static func trimmedClip(_ wav: Data) throws -> (file: AVAudioFile, url: URL, seconds: Double)? {
        let rawURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-raw.wav")
        try wav.write(to: rawURL)
        defer { try? FileManager.default.removeItem(at: rawURL) }
        let sourceFile = try AVAudioFile(forReading: rawURL)
        let rate = sourceFile.processingFormat.sampleRate
        guard rate > 8000, sourceFile.length > 0 else { return nil }
        guard let source = AVAudioPCMBuffer(pcmFormat: sourceFile.processingFormat, frameCapacity: AVAudioFrameCount(sourceFile.length)) else { return nil }
        try sourceFile.read(into: source)
        guard let mono = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false) else { return nil }
        let rendered = try renderFloat(source, as: mono)
        guard let channel = rendered.floatChannelData?[0] else { return nil }
        let tightened = tightenSpeech(Array(UnsafeBufferPointer(start: channel, count: Int(rendered.frameLength))), rate: rate)
        guard tightened.count > Int(rate * 0.02) else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        try writePcm16(tightened, rate: rate, to: url)
        let file = try AVAudioFile(forReading: url)
        let seconds = Double(file.length) / file.processingFormat.sampleRate
        guard seconds > 0.02 else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        return (file, url, seconds)
    }

    private static func writePcm16(_ samples: [Float], rate: Double, to url: URL) throws {
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
        try data.write(to: url)
    }

    private static func renderFloat(_ source: AVAudioPCMBuffer, as format: AVAudioFormat) throws -> AVAudioPCMBuffer {
        if source.format.sampleRate == format.sampleRate,
           source.format.channelCount == format.channelCount,
           source.format.commonFormat == .pcmFormatFloat32 {
            return source
        }
        guard let converter = AVAudioConverter(from: source.format, to: format) else {
            throw NSError(domain: "Atlas", code: 2)
        }
        let ratio = format.sampleRate / source.format.sampleRate
        let capacity = AVAudioFrameCount((Double(source.frameLength) * ratio).rounded(.up)) + 32
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            throw NSError(domain: "Atlas", code: 3)
        }
        var fed = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if fed {
                status.pointee = .endOfStream
                return nil
            }
            fed = true
            status.pointee = .haveData
            return source
        }
        if let error { throw error }
        return output
    }

    /// Drop the quiet the voice model leaves at the ends. Keep a comma-sized
    /// pause inside a sentence, then add a short breath before the next clip.
    /// 180ms inside, 300ms between clips. The old holes were the untrimmed
    /// edges plus the wait for the next clip.
    private static func tightenSpeech(_ samples: [Float], rate: Double) -> [Float] {
        guard !samples.isEmpty else { return [] }
        let floor: Float = 0.02
        let keep = max(1, Int(rate * 0.18))
        let breath = max(1, Int(rate * 0.30))
        var out: [Float] = []
        out.reserveCapacity(samples.count)
        var quiet = 0
        var heard = false
        for sample in samples {
            if abs(sample) < floor {
                quiet += 1
                if heard, quiet <= keep { out.append(sample) }
            } else {
                quiet = 0
                heard = true
                out.append(sample)
            }
        }
        while let last = out.last, abs(last) < floor { out.removeLast() }
        guard heard, out.count > Int(rate * 0.02) else { return [] }
        let fade = min(out.count / 4, max(1, Int(rate * 0.006)))
        if fade > 1 {
            for index in 0..<fade {
                let gain = Float(index) / Float(fade)
                out[index] *= gain
                out[out.count - 1 - index] *= gain
            }
        }
        out.append(contentsOf: Array(repeating: 0, count: breath))
        return out
    }

    static func haltPlayback() {
        bargeWork?.cancel()
        bargeWork = nil
        bargeQuiet?.cancel()
        bargeQuiet = nil
        generation += 1
        playing = false
        if player.isPlaying { player.stop() }
        clearPhoneSegs()
    }

    static func shutdown() {
        duplex = false
        generation += 1
        playing = false
        if player.isPlaying { player.stop() }
        clearPhoneSegs()
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        if engine.isRunning { engine.stop() }
    }

    static func resumeIfNeeded() {
        guard duplex, !starting, !engine.isRunning else { return }
        do {
            try armDuplex()
            CallLoop.engineCameBack()
        } catch {
            CallLoop.failToWeb()
        }
    }

    private static var watchingReset = false

    private static func watchReset() {
        guard !watchingReset else { return }
        watchingReset = true
        NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: .main
        ) { _ in
            guard duplex, !starting, !engine.isRunning else { return }
            tapInstalled = false
            resumeIfNeeded()
        }
    }

    private static func boot() throws {
        if engine.isRunning { return }
        try configure()
        engine.prepare()
        try engine.start()
    }

    private static func configure() throws {
        CallAudio.nudge()
        if !attached {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: nil)
            engine.attach(cue)
            engine.connect(cue, to: engine.mainMixerNode, format: cueFormat)
            attached = true
        }
        let input = engine.inputNode
        if !input.isVoiceProcessingEnabled {
            try input.setVoiceProcessingEnabled(true)
        }
        input.isVoiceProcessingAGCEnabled = false
        input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(
            enableAdvancedDucking: false,
            duckingLevel: .min
        )
        input.isVoiceProcessingInputMuted = true
        _ = input.setMutedSpeechActivityEventListener { event in
            DispatchQueue.main.async {
                if !engine.inputNode.isVoiceProcessingInputMuted {
                    bargeWork?.cancel()
                    bargeWork = nil
                    bargeQuiet?.cancel()
                    bargeQuiet = nil
                    return
                }
                if event == .started {
                    bargeQuiet?.cancel()
                    bargeQuiet = nil
                    guard bargeWork == nil else { return }
                    let work = DispatchWorkItem {
                        bargeWork = nil
                        barge()
                    }
                    bargeWork = work
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
                } else {
                    // A single flicker used to cancel the whole 0.6s. Wait briefly.
                    guard bargeQuiet == nil else { return }
                    let quiet = DispatchWorkItem {
                        bargeQuiet = nil
                        bargeWork?.cancel()
                        bargeWork = nil
                    }
                    bargeQuiet = quiet
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: quiet)
                }
            }
        }
    }

    private static func barge() {
        guard playing, Date() >= ignoreUntil, !CallLoop.micMuted else { return }
        if duplex {
            CallLoop.userBarged()
            return
        }
        guard !locked else { return }
        generation += 1
        playing = false
        if player.isPlaying { player.stop() }
        if engine.isRunning { engine.stop() }
        signal("barge")
    }

    private static func signal(_ why: String) {
        web?.evaluateJavaScript("window.atlasClipEnded && window.atlasClipEnded('\(why)')")
    }
}

struct CallView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        CallAudio.start()
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "atlas")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let web = WKWebView(frame: .zero, configuration: config)
        let paper = UIColor(red: 18 / 255, green: 20 / 255, blue: 16 / 255, alpha: 1)
        web.isOpaque = false
        web.backgroundColor = paper
        web.scrollView.backgroundColor = paper
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.uiDelegate = context.coordinator
        web.navigationDelegate = context.coordinator
        context.coordinator.web = web
        web.load(URLRequest(url: CallLink.page))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
        weak var web: WKWebView?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
            switch op {
            case "arm":
                CallLoop.arm(web: web)
            case "disarm":
                CallLoop.disarm()
            case "barge":
                CallLoop.userBarged(manual: true)
            case "text":
                CallLoop.typed(body["text"] as? String ?? "")
            case "mute":
                CallLoop.toggleMute()
            case "phone":
                CallLoop.togglePhone()
            case "brain":
                CallLoop.toggleBrain(body["name"] as? String ?? "grok")
            case "mouth":
                CallLoop.toggleMouth(body["name"] as? String ?? "phonon")
            case "end":
                if let mode = body["mode"] as? String {
                    CallLoop.toggleEnd(mode: mode)
                } else {
                    let phone = (body["phone"] as? Bool) ?? ((body["phone"] as? NSNumber)?.boolValue ?? false)
                    CallLoop.toggleEnd(mode: phone ? "phone" : "mac")
                }
            case "manual":
                let start = (body["start"] as? Bool) ?? ((body["start"] as? NSNumber)?.boolValue ?? false)
                CallLoop.manualTurn(start: start)
            case "play":
                CallEngine.play(base64: body["wav"] as? String ?? "", web: web)
            case "stop", "release":
                CallEngine.stop()
            case "lock":
                CallEngine.locked = (body["on"] as? Bool) ?? false
            default:
                break
            }
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.grant)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            let on = PhoneVoice.enabled ? "true" : "false"
            let brain = CallPrefs.brain
            let endMode = CallPrefs.endMode
            let mouth = CallPrefs.mouth
            webView.evaluateJavaScript(
                "window.atlasPhone && window.atlasPhone(\(on)); window.atlasBrain && window.atlasBrain('\(brain)'); window.atlasEnd && window.atlasEnd('\(endMode)'); window.atlasMouth && window.atlasMouth('\(mouth)')"
            )
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let page = """
            <body style="background:#121410;color:#f4f1e8;font-family:Georgia,serif;padding:28px">
            <h1>Atlas</h1>
            <p>This Mac is not answering. Tailscale has to be on, on both this phone and the Mac.</p>
            </body>
            """
            webView.loadHTMLString(page, baseURL: nil)
        }
    }
}
