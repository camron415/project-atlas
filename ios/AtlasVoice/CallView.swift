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
    /// A bare phone is forced to the loudspeaker. Repeated calls stay quiet once the route is right.
    static func nudge() {
        let session = AVAudioSession.sharedInstance()
        let outs = session.currentRoute.outputs.map(\.portType)
        let external = outs.contains(where: { headphones.contains($0) })
        if external {
            if session.category != .playAndRecord || session.mode != .voiceChat {
                try? session.setCategory(.playAndRecord, mode: .voiceChat, options: options)
            }
            if outs.contains(.builtInReceiver) || outs.contains(.builtInSpeaker) {
                try? session.overrideOutputAudioPort(.none)
            }
            return
        }
        if session.category != .playAndRecord || session.mode != .voiceChat || outs.contains(.builtInReceiver) {
            try? session.setCategory(.playAndRecord, mode: .voiceChat, options: options)
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
    private static var attached = false
    private static var tapInstalled = false
    private static var starting = false
    private static var generation = 0
    private static var playing = false
    private static var ignoreUntil = Date.distantPast
    private static var bargeWork: DispatchWorkItem?
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
        ignoreUntil = started.addingTimeInterval(0.7)
        playing = true
        setInputMuted(true)
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

    static func haltPlayback() {
        bargeWork?.cancel()
        bargeWork = nil
        generation += 1
        playing = false
        if player.isPlaying { player.stop() }
    }

    static func shutdown() {
        duplex = false
        generation += 1
        playing = false
        if player.isPlaying { player.stop() }
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
                if event == .started {
                    guard bargeWork == nil else { return }
                    let work = DispatchWorkItem {
                        bargeWork = nil
                        barge()
                    }
                    bargeWork = work
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
                } else {
                    bargeWork?.cancel()
                    bargeWork = nil
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
                CallLoop.userBarged()
            case "text":
                CallLoop.typed(body["text"] as? String ?? "")
            case "mute":
                CallLoop.toggleMute()
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
