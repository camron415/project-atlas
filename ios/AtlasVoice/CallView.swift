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

struct CallView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        CallAudio.start()
        let config = WKWebViewConfiguration()
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
        web.load(URLRequest(url: CallLink.page))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate {
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
