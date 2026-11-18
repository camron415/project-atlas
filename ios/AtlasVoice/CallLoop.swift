import AVFoundation
import UIKit
import WebKit

/// Road-test switches. Plus and the Mac are default; tap Grok, Flash, or Phone to compare.
enum CallPrefs {
    private static let roadPlusKey = "atlas.brain.plusDefault2026-11-11"

    /// One-time reset so a stale Grok default from the first toggle build does not stick.
    static func applyPlusDefaultForRoadTest() {
        guard !UserDefaults.standard.bool(forKey: roadPlusKey) else { return }
        UserDefaults.standard.set("plus", forKey: "atlas.brain")
        UserDefaults.standard.set(true, forKey: roadPlusKey)
    }

    static var brain: String {
        get {
            let stored = UserDefaults.standard.string(forKey: "atlas.brain") ?? "plus"
            return ["grok", "plus", "flash"].contains(stored) ? stored : "plus"
        }
        set {
            let name = ["grok", "plus", "flash"].contains(newValue) ? newValue : "plus"
            UserDefaults.standard.set(name, forKey: "atlas.brain")
        }
    }

    static var phoneEndsTurn: Bool {
        get { endMode == "phone" }
        set { endMode = newValue ? "phone" : "mac" }
    }

    static var endMode: String {
        get {
            let stored = UserDefaults.standard.string(forKey: "atlas.endMode") ?? ""
            if ["mac", "phone", "manual"].contains(stored) { return stored }
            return UserDefaults.standard.bool(forKey: "atlas.phoneEndsTurn") ? "phone" : "mac"
        }
        set {
            let mode = ["mac", "phone", "manual"].contains(newValue) ? newValue : "mac"
            UserDefaults.standard.set(mode, forKey: "atlas.endMode")
        }
    }

    /// On-device mouth. Phonon is the quality voice. Kokoro stays one tap away.
    static var mouth: String {
        get {
            let stored = UserDefaults.standard.string(forKey: "atlas.mouth") ?? "phonon"
            return stored == "kokoro" ? "kokoro" : "phonon"
        }
        set {
            UserDefaults.standard.set(newValue == "kokoro" ? "kokoro" : "phonon", forKey: "atlas.mouth")
        }
    }
}

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
    /// One end wins. The audio thread and a probe reply can both decide he stopped.
    private static var turnClaimed = false

    private static func claimTurnEnd() -> Bool {
        audioLock.lock()
        let open = !turnClaimed
        if open { turnClaimed = true }
        audioLock.unlock()
        return open
    }

    private static func releaseTurnEnd() {
        audioLock.lock()
        turnClaimed = false
        audioLock.unlock()
    }

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
    /// Set when a caption pass was still running at the moment he stopped.
    private static var captionDue = false
    /// One full transcription, started once the pause is real. Probes must not
    /// each start their own, or the live line stays on the first word.
    private static var finalHear: Task<(String, Int), Error>?
    private static var probeBusy = false
    private static var turnSerial = 0
    private static var turnId = ""
    private static var era = 0
    private static var task: Task<Void, Never>?
    private struct Clip {
        var sentence: String
        var wav: Data
    }

    private static var clips: [Clip] = []
    private static var heardReply = ""
    private static var replyAudio = false
    private static var lastCaption = ""
    /// Words already spoken that have slid out of the latest short hearing slice.
    private static var captionCarry = ""
    /// The last raw slice, before the carried words are put back in front.
    private static var captionWindow = ""
    private static var speechStart: Date?
    private static var speakerLoud = 0.0
    private static var speakerQuiet = 0.0
    private static var speakerWindow = 0.0
    private static var speakerPeak = 0.0
    private static var speakerReported = Date.distantPast
    private static var overlap: [Float] = []
    private static var keepOverlap = false
    /// While Smart Turn says he is not done, wait this long. A confident ending still sends at the first probe.
    private static var quietCap = 8.0
    private static var replyStarted: Date?
    /// "cap" when the quiet cap ended his turn, "model" when Smart Turn did.
    private static var lastUserEnd = ""
    private static var clipPlaying = false
    private static var streamOpen = false
    private static var replyOpen = false
    private static var lastStatus = "Listening…"
    private static var watchedInterrupt = false
    static var micMuted = false
    /// Spoken "hold on" keeps the mic open for the one word "unmute". The button still goes fully quiet.
    private static var commandEar = false
    private static var sayTail: Task<Void, Never>?
    private static var saysLeft = 0
    private static var saySerial = 0
    private static var phoneSttMs = 0
    private static var phoneSynthMs = 0
    private static var muteAt = Date.distantPast
    private static var noise = 0.0

    static func arm(web: WKWebView?) {
        self.web = web
        isOn = true
        watchInterruptions()
        warmPhone()
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
        commandEar = false
        setCapture(.off)
        phase = .idle
        cancelWork()
        clips.removeAll()
        clipPlaying = false
        streamOpen = false
        CallEngine.shutdown()
    }

    static func userBarged(manual: Bool = false) {
        guard isOn else { return }
        let sheIsPlaying = CallEngine.isAudible || clipPlaying || !clips.isEmpty
        guard manual || phase == .speaking || (phase == .thinking && sheIsPlaying) else { return }
        publishCut()
        cancelWork()
        CallEngine.haltPlayback()
        clips.removeAll()
        clipPlaying = false
        streamOpen = false
        replyOpen = false
        keepOverlap = true
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
        task = Task { await postJSON(line, id: id, era: stamp, phone: PhoneVoice.enabled) }
    }

    static func toggleMute() {
        guard isOn else { return }
        let now = Date()
        guard now.timeIntervalSince(muteAt) > 0.4 else { return }
        muteAt = now
        commandEar = false
        micMuted.toggle()
        Task { await postCommand(micMuted ? "mute" : "unmute") }
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
        CallEngine.playCue(micMuted ? "mute" : "unmute")
    }

    static func toggleBrain(_ name: String) {
        CallPrefs.brain = name
        script("window.atlasBrain && window.atlasBrain('\(CallPrefs.brain)')")
    }

    static func toggleMouth(_ name: String) {
        CallPrefs.mouth = name
        script("window.atlasMouth && window.atlasMouth('\(CallPrefs.mouth)')")
    }

    static func toggleEnd(mode: String) {
        let picked = ["mac", "phone", "manual"].contains(mode) ? mode : "mac"
        CallPrefs.endMode = picked
        script("window.atlasEnd && window.atlasEnd('\(picked)')")
        if picked == "manual", isOn, phase == .listening, !manualSegment {
            beginManualIdle()
        }
    }

    private static var manualSegment = false
    private static var manualCommit = false

    static func manualTurn(start: Bool) {
        guard isOn, CallPrefs.endMode == "manual" else { return }
        if start {
            manualSegment = true
            captionCarry = ""
            captionWindow = ""
            lastCaption = ""
            beginListen()
            script("window.atlasManual && window.atlasManual(true)")
            note("Listening… tap Send turn when you finish.")
            return
        }
        guard manualSegment, phase == .listening else { return }
        manualCommit = true
        if sendTurn(force: true) {
            manualSegment = false
            script("window.atlasManual && window.atlasManual(false)")
        } else {
            manualCommit = false
            note("I didn't hear anything yet. Keep going, then tap Send turn.")
        }
    }

    private static func beginManualIdle() {
        guard isOn else { return }
        manualSegment = false
        phase = .listening
        setCapture(.off)
        CallEngine.setInputMuted(false)
        heard = false
        silence = 0
        nextProbe = 0.42
        armedForce = false
        partials = 0
        partialAt = nil
        finalHear?.cancel()
        finalHear = nil
        releaseTurnEnd()
        probeBusy = false
        captionCarry = ""
        captionWindow = ""
        lastCaption = ""
        note("Tap Start turn when ready.")
        notePhase("listening")
        script("window.atlasManual && window.atlasManual(false)")
    }

    static func togglePhone() {
        let next = !PhoneVoice.enabled
        PhoneVoice.enabled = next
        script("window.atlasPhone && window.atlasPhone(\(next ? "true" : "false"))")
        if next {
            note("Loading phone voice…")
            let bg = beginBackground()
            Task {
                do {
                    try await PhoneVoice.shared.prepare()
                    await MainActor.run {
                        endBackground(bg)
                        guard PhoneVoice.enabled else { return }
                        if isOn, phase == .listening { note("Listening…") }
                        script("window.atlasMeta && window.atlasMeta('Phone voice ready')")
                    }
                } catch {
                    await MainActor.run {
                        endBackground(bg)
                        PhoneVoice.enabled = false
                        script("window.atlasPhone && window.atlasPhone(false)")
                        note("Phone voice didn't load. Still on the Mac.")
                    }
                }
            }
        } else {
            Task { await PhoneVoice.shared.unload() }
            if isOn, phase == .listening { note("Listening…") }
            script("window.atlasMeta && window.atlasMeta('Mac voice')")
        }
    }

    static func engineCameBack() {
        guard isOn else { return }
        switch phase {
        case .listening, .thinking:
            if commandEar {
                CallEngine.setInputMuted(false)
                setCapture(phase == .listening ? .listen : .off)
            } else if micMuted {
                CallEngine.setInputMuted(true)
                setCapture(.off)
            } else {
                CallEngine.setInputMuted(false)
                setCapture(phase == .listening ? .listen : .off)
            }
        case .speaking:
            CallEngine.setInputMuted(micMuted && !commandEar)
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
            let liveWhileSheTalks = phase == .speaking && !micMuted
            if !liveWhileSheTalks {
                DispatchQueue.main.async {
                    guard isOn, phase == .listening, !micMuted || commandEar else { return }
                    audioLock.lock()
                    let stillOff = capture == .off
                    audioLock.unlock()
                    guard stillOff else { return }
                    setCapture(.listen)
                    CallEngine.setInputMuted(false)
                }
                return
            }
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
        if mode == .off {
            audioLock.lock()
            sampleRate = rate
            overlap.append(contentsOf: chunk)
            let cap = Int(rate * 8)
            if overlap.count > cap { overlap.removeFirst(overlap.count - cap) }
            audioLock.unlock()
            DispatchQueue.main.async { playbackPush(rms, dt: dt) }
            return
        }
        if mode == .listen {
            audioLock.lock()
            sampleRate = rate
            samples.append(contentsOf: chunk)
            let seconds = (CallPrefs.endMode == "manual" && manualSegment) ? 300.0 : 90.0
            let cap = Int(rate * seconds)
            if samples.count > cap { samples.removeFirst(samples.count - cap) }
            audioLock.unlock()
        }
        DispatchQueue.main.async {
            guard isOn, phase == .listening, !micMuted || commandEar else { return }
            vad(rms: rms, dt: dt)
        }
    }

    /// Mic stays open on every route while she talks, unless he muted.
    /// The tap is echo-cancelled, so his voice sits near the normal listen level.
    /// A syllable gap pauses the 0.6s count. Only a real quiet stretch clears it.
    private static func resetBargeMeter() {
        speakerLoud = 0
        speakerQuiet = 0
        speakerWindow = 0
    }

    private static func playbackPush(_ rms: Double, dt: Double) {
        guard isOn, phase == .speaking, !micMuted else {
            resetBargeMeter()
            return
        }
        if Date() < CallEngine.cueUntil { return }
        if rms > speakerPeak { speakerPeak = rms }
        let speaker = CallEngine.outputRoute() == "speaker"
        // Speaker echo cancelling sits on the mic while she talks. His voice
        // lands quieter there than on headphones. 0.6s is unchanged.
        let floor = speaker ? 0.022 : 0.032
        let resetAt = floor * 0.5
        if rms >= floor {
            speakerLoud += dt
            speakerQuiet = 0
            speakerWindow += dt
        } else if rms < resetAt {
            speakerQuiet += dt
            speakerWindow += dt
            if speakerQuiet >= 0.25 {
                resetBargeMeter()
            }
        } else {
            speakerWindow += dt
        }
        if speakerWindow >= 1.0, speakerLoud < 0.6 {
            resetBargeMeter()
        }
        let now = Date()
        if now.timeIntervalSince(speakerReported) >= 1.0 {
            speakerReported = now
            let peak = speakerPeak
            speakerPeak = 0
            let route = speaker ? "speaker" : "headphones"
            let loudMs = Int(speakerLoud * 1000)
            Task { await postBleed(peak: peak, route: route, loudMs: loudMs) }
        }
        if speakerLoud >= 0.6 { userBarged() }
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
        CallEngine.armClip("Hey, what's up?")
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
        if commandEar {
            beginCommandListen()
            return
        }
        if CallPrefs.endMode == "manual", !manualSegment {
            beginManualIdle()
            return
        }
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
        captionDue = false
        finalHear?.cancel()
        finalHear = nil
        releaseTurnEnd()
        probeBusy = false
        noise = 0
        replyOpen = false
        heardReply = ""
        replyAudio = false
        speechStart = nil
        resetBargeMeter()
        replyStarted = nil
        lastCaption = ""
        captionCarry = ""
        captionWindow = ""
        audioLock.lock()
        if keepOverlap, !overlap.isEmpty {
            samples = overlap
            let seeded = overlap.count
            overlap.removeAll()
            keepOverlap = false
            audioLock.unlock()
            heard = true
            let seconds = Double(seeded) / max(sampleRate, 1)
            speechStart = Date().addingTimeInterval(-seconds)
            silence = 0
        } else {
            samples.removeAll()
            overlap.removeAll()
            keepOverlap = false
            audioLock.unlock()
        }
        note(PhoneVoice.enabled && !PhoneVoice.shared.isReady ? "Loading phone voice…" : "Listening…")
        notePhase("listening")
    }

    /// The models live in memory. A crash or a fresh open has to load them again,
    /// and the first thing he says waits on that. Start during the greeting.
    private static func warmPhone() {
        guard PhoneVoice.enabled else { return }
        if !PhoneVoice.shared.isReady { note("Loading phone voice…") }
        Task {
            try? await PhoneVoice.shared.prepare()
            await MainActor.run {
                guard PhoneVoice.enabled, isOn, phase == .listening, !micMuted, !commandEar else { return }
                note("Listening…")
            }
        }
    }

    /// Whole turn only. "Hold on, I was saying…" must still go to her.
    private static func spokenCommand(_ text: String) -> String? {
        let cleaned = text.lowercased()
            .components(separatedBy: CharacterSet.letters.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if [
            "hold on",
            "hold on one second",
            "hold on a second",
            "hold on one sec",
            "hold on a sec",
        ].contains(cleaned) {
            return "mute"
        }
        if cleaned == "unmute" || cleaned == "un mute" {
            return "unmute"
        }
        return nil
    }

    /// Mic shows muted, but a lone "unmute" can still get through.
    private static func beginCommandListen() {
        guard isOn else { return }
        phase = .listening
        setCapture(.listen)
        CallEngine.setInputMuted(false)
        heard = false
        silence = 0
        nextProbe = 0.42
        armedForce = false
        partials = 0
        partialAt = nil
        captionDue = false
        finalHear?.cancel()
        finalHear = nil
        releaseTurnEnd()
        probeBusy = false
        noise = 0
        replyOpen = false
        heardReply = ""
        replyAudio = false
        speechStart = nil
        resetBargeMeter()
        replyStarted = nil
        audioLock.lock()
        samples.removeAll()
        overlap.removeAll()
        keepOverlap = false
        audioLock.unlock()
        note("Muted")
        notePhase("muted")
    }

    private static func vad(rms: Double, dt: Double) {
        guard !micMuted || commandEar else { return }
        let speaking = rms > (heard ? 0.018 : 0.026)
        if speaking {
            if !heard {
                audioLock.lock()
                let keep = Int(sampleRate * 0.3)
                if samples.count > keep { samples.removeFirst(samples.count - keep) }
                audioLock.unlock()
                if !commandEar {
                    note("Hearing you…")
                    showYou("…", live: true)
                }
                noise = 0
            }
            noise += dt
            // A short bump on the phone mic is not a new sentence. Let the pause finish.
            if silence > 0.2 && noise < 0.28 { return }
            let pausedMs = Int(silence * 1000)
            if pausedMs >= 280, !commandEar {
                let speechMs = speechStart.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
                let route = CallEngine.outputRoute()
                Task { await postPause(silenceMs: pausedMs, speechMs: speechMs, route: route) }
            }
            if speechStart == nil { speechStart = Date().addingTimeInterval(-noise) }
            heard = true
            silence = 0
            armedForce = false
            nextProbe = 0.42
            if finalHear != nil {
                finalHear?.cancel()
                finalHear = nil
            }
            let now = Date()
            if commandEar {
                // Stay quiet on screen. The full turn still goes up so "unmute" can land.
            } else if partialAt == nil {
                partialAt = now
            } else if !partialBusy {
                let wait = partials == 0 ? 0.4 : (CallPrefs.endMode == "manual" && manualSegment ? 1.05 : 0.7)
                if now.timeIntervalSince(partialAt!) >= wait {
                    partialAt = now
                    partials += 1
                    sendPartial()
                }
            }
        } else if heard {
            noise = 0
            let wantsPartial = !commandEar && silence == 0 && finalHear == nil && (partials == 0 || (partialAt != nil && Date().timeIntervalSince(partialAt!) > 0.5))
            if wantsPartial, !partialBusy {
                partialAt = Date()
                partials += 1
                sendPartial()
            } else if wantsPartial, partialBusy {
                captionDue = true
            }
            silence += dt
            if PhoneVoice.enabled, CallPrefs.endMode != "manual", finalHear == nil, silence >= 0.35 {
                armFinalHear()
            }
            if CallPrefs.endMode == "manual" {
            } else if CallPrefs.endMode == "phone" {
                // Smart Turn decides. The 8s cap is only the fallback.
                if !armedForce, silence >= quietCap {
                    armedForce = true
                    sendTurn(force: true)
                } else if !probeBusy, silence >= nextProbe {
                    nextProbe = silence + 0.45
                    sendTurn(force: false)
                }
            } else if !armedForce, silence >= quietCap {
                armedForce = true
                sendTurn(force: true)
            } else if !armedForce, !probeBusy, silence >= 0.85 {
                armedForce = true
                sendTurn(force: true)
            } else if !probeBusy, silence >= nextProbe, silence < 0.85 {
                nextProbe = silence + 0.45
                sendTurn(force: false)
            }
        }
    }

    /// The words for the model. Started once per pause so caption updates are
    /// not stuck behind a cancelled full-turn transcription.
    private static func armFinalHear() {
        guard PhoneVoice.enabled, finalHear == nil, phase == .listening else { return }
        let cap = (CallPrefs.endMode == "manual" && manualSegment) ? 300.0 : 90.0
        guard let wav = snapshot(maxSeconds: cap), wav.count > 1200 else { return }
        finalHear = Task { try await PhoneVoice.shared.hear(wav: wav) }
    }

    /// Switches the screen to Thinking and hands off the one transcription
    /// already running for this pause. False when this turn was cancelled.
    private static func takeFinalHear(era stamp: Int, end: String) -> (Task<(String, Int), Error>?, Bool) {
        guard stamp == era, claimTurnEnd() else { return (nil, false) }
        probeBusy = false
        phase = .thinking
        setCapture(.off)
        note("Thinking…")
        notePhase("thinking")
        lastUserEnd = end
        let pending = finalHear
        finalHear = nil
        return (pending, true)
    }

    private static func sendPartial() {
        // A short slice returns while he is still talking. The full sentence is
        // a separate pass, started once, so this line is not stuck on the first word.
        guard finalHear == nil else { return }
        let window = (CallPrefs.endMode == "manual" && manualSegment) ? 14.0 : 3.5
        guard !commandEar, phase == .listening, !partialBusy, let wav = snapshot(maxSeconds: window), wav.count > 1200 else { return }
        partialBusy = true
        let stamp = era
        if PhoneVoice.enabled {
            if !PhoneVoice.shared.isReady { note("Loading phone voice…") }
            Task {
                let text = (try? await PhoneVoice.shared.hear(wav: wav))?.0 ?? ""
                await MainActor.run { applyWindow(text, era: stamp) }
            }
            return
        }
        Task {
            let text = await postHear(wav)
            await MainActor.run { applyWindow(text, era: stamp) }
        }
    }

    private static func applyWindow(_ text: String, era stamp: Int) {
        partialBusy = false
        let follow = captionDue
        captionDue = false
        defer {
            if follow, finalHear == nil, stamp == era, phase == .listening, heard, silence > 0 {
                sendPartial()
            }
        }
        guard stamp == era, phase == .listening else { return }
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        if CallPrefs.endMode == "manual", manualSegment {
            let prior = captionJoin([captionCarry, captionWindow])
            let display = expandCaption(prior: prior, piece: clean)
            captionCarry = ""
            captionWindow = display
            showYou(display, live: true)
            return
        }
        let rolled = rollCaption(carry: captionCarry, previous: captionWindow, next: clean)
        captionCarry = rolled.carry
        captionWindow = rolled.window
        guard !rolled.display.isEmpty else { return }
        showYou(rolled.display, live: true)
    }

    @discardableResult
    private static func sendTurn(force: Bool, retry: Bool = false) -> Bool {
        if CallPrefs.endMode == "manual", !manualCommit {
            return false
        }
        let hearCap: Double? = {
            if !PhoneVoice.enabled { return nil }
            if force { return (CallPrefs.endMode == "manual" && manualSegment) ? 300 : 90 }
            return 8
        }()
        guard let wav = snapshot(maxSeconds: hearCap), wav.count > 1200 else {
            if force { heard = false; silence = 0; armedForce = false }
            return false
        }
        if !force, probeBusy { return false }
        if force {
            guard claimTurnEnd() else { return false }
            if !retry { cancelWork() }
        }
        let committing = manualCommit
        manualCommit = false
        if PhoneVoice.enabled, force {
            phase = .thinking
            setCapture(.off)
            note("Thinking…")
            notePhase("thinking")
            let pauseName = CallPrefs.endMode == "phone" ? "cap" : "force"
            lastUserEnd = pauseName
            let pending = finalHear
            finalHear = nil
            let stamp = era
            let silenceMs = Int(silence * 1000)
            let speechMs = speechStart.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
            let route = CallEngine.outputRoute()
            task = Task {
                await commitOnPhone(
                    wav: wav,
                    era: stamp,
                    end: "force",
                    early: pending,
                    commit: committing,
                    pause: pauseName,
                    silenceMs: silenceMs,
                    speechMs: speechMs,
                    route: route,
                    cut: pauseName == "cap"
                )
            }
            return true
        }
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
        let silenceMs = Int(silence * 1000)
        let speechMs = speechStart.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
        let route = CallEngine.outputRoute()
        task = Task {
            await postAudio(wav, probe: !force, id: id, era: stamp, silenceMs: silenceMs, speechMs: speechMs, route: route, retry: retry, commit: committing)
        }
        return true
    }

    private static func postAudio(_ wav: Data, probe: Bool, id: String, era stamp: Int, silenceMs: Int, speechMs: Int, route: String, retry: Bool = false, commit: Bool = false) async {
        let bg = await MainActor.run { beginBackground() }
        defer { endBackground(bg) }
        var fields: [(String, String)] = []
        if probe { fields.append(("probe", "1")) }
        else { fields.append(("force", "1")) }
        fields.append(("silence_ms", String(silenceMs)))
        fields.append(("speech_ms", String(speechMs)))
        fields.append(("route", route))
        if !probe, !lastCaption.isEmpty { fields.append(("caption", lastCaption)) }
        if commit { fields.append(("commit", "1")) }
        let upload = (PhoneVoice.enabled && probe) ? probeClip(wav) : wav
        let (body, boundary) = multipart(fields: fields, file: upload, filename: "turn.wav")
        var request = authorized("/turn")
        request.httpMethod = "POST"
        request.setValue(id, forHTTPHeaderField: "X-Atlas-Turn")
        if commit { request.setValue("1", forHTTPHeaderField: "X-Atlas-Commit") }
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        if PhoneVoice.enabled, probe {
            request.setValue("phone", forHTTPHeaderField: "X-Atlas-Mouth")
        }
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard stamp == era else { return }
            guard let http = response as? HTTPURLResponse else { return }
            let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
            if type.contains("json") || http.statusCode >= 400 {
                var data = Data()
                for try await byte in bytes { data.append(byte) }
                let payload = data
                let obj = try? JSONSerialization.jsonObject(with: payload) as? [String: Any]
                if PhoneVoice.enabled, probe, obj?["complete"] as? Bool == true {
                    let decision = obj?["decision"] as? String ?? "model"
                    let score = obj?["probability"] as? Double
                    let started: (Task<(String, Int), Error>?, Bool) = await MainActor.run {
                        takeFinalHear(era: stamp, end: "model")
                    }
                    guard started.1 else { return }
                    await commitOnPhone(
                        wav: wav,
                        era: stamp,
                        end: "model",
                        early: started.0,
                        pause: decision,
                        silenceMs: silenceMs,
                        speechMs: speechMs,
                        route: route,
                        pauseP: score,
                        cut: decision == "timer" || decision == "cap"
                    )
                    return
                }
                let started: (Task<(String, Int), Error>?, Bool) = await MainActor.run {
                    guard stamp == era else { return (nil, false) }
                    // Mac mode still ends at 0.85s of quiet. Phone mode waits
                    // for Smart Turn, or the 8 second cap when the model is down.
                    if CallPrefs.endMode != "manual", CallPrefs.endMode != "phone", PhoneVoice.enabled, probe, silence >= 0.85, phase == .listening {
                        return takeFinalHear(era: stamp, end: "model")
                    }
                    probeBusy = false
                    if obj?["dropped"] as? Bool == true, !retry, CallPrefs.endMode != "manual" {
                        sendTurn(force: true, retry: true)
                        return (nil, false)
                    }
                    if !probe {
                        let message = obj?["error"] as? String
                        openReply(message ?? "I lost that. Say it once more.")
                        beginListen()
                    }
                    return (nil, false)
                }
                guard started.1 else { return }
                await commitOnPhone(wav: wav, era: stamp, end: "model", early: started.0)
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
                lastUserEnd = probe ? "model" : "force"
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

    private static func commitOnPhone(
        wav: Data,
        era stamp: Int,
        end: String,
        early: Task<(String, Int), Error>? = nil,
        commit: Bool = false,
        pause: String = "",
        silenceMs: Int = 0,
        speechMs: Int = 0,
        route: String = "",
        pauseP: Double? = nil,
        cut: Bool = false
    ) async {
        let bg = await MainActor.run { beginBackground() }
        defer { endBackground(bg) }
        var text = ""
        var stt = 0
        var heard = early == nil
        if let early {
            do {
                (text, stt) = try await early.value
                heard = true
            } catch is CancellationError {
                await MainActor.run {
                    guard stamp == era, isOn, phase == .thinking else { return }
                    beginListen()
                }
                return
            } catch {
                heard = false
            }
        }
        if !heard {
            do {
                (text, stt) = try await PhoneVoice.shared.hear(wav: wav)
            } catch is CancellationError {
                return
            } catch {
                await MainActor.run {
                    guard stamp == era, isOn else { return }
                    PhoneVoice.enabled = false
                    script("window.atlasPhone && window.atlasPhone(false)")
                    note("Phone hearing failed. Back on the Mac.")
                    beginListen()
                }
                return
            }
        }
        let line = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let cmd = spokenCommand(line) {
            let applied: Bool = await MainActor.run {
                guard stamp == era, isOn else { return false }
                showYou(line, live: false)
                applyCommand(cmd)
                return true
            }
            if applied { await postCommand(cmd) }
            return
        }
        let heardMs = stt
        let ready: (id: String, text: String) = await MainActor.run {
            guard stamp == era, isOn else { return ("", "") }
            let fallback = lastCaption.trimmingCharacters(in: .whitespacesAndNewlines)
            let spoken = fullerTranscript(heard: line, caption: fallback == "…" ? "" : fallback)
            if spoken.isEmpty {
                note("I didn't catch that.")
                beginListen()
                return ("", "")
            }
            showYou(spoken, live: false)
            lastUserEnd = end
            phoneSttMs = heardMs
            phoneSynthMs = 0
            phase = .thinking
            setCapture(.off)
            note("Thinking…")
            notePhase("thinking")
            return (nextTurn(), spoken)
        }
        guard !ready.id.isEmpty else { return }
        await postJSON(
            ready.text,
            id: ready.id,
            era: stamp,
            sttMs: heardMs,
            phone: true,
            commit: commit,
            pause: pause,
            silenceMs: silenceMs,
            speechMs: speechMs,
            route: route,
            pauseP: pauseP,
            cut: cut
        )
    }

    private static func postJSON(
        _ text: String,
        id: String,
        era stamp: Int,
        sttMs: Int = 0,
        phone: Bool = false,
        retry: Bool = false,
        commit: Bool = false,
        pause: String = "",
        silenceMs: Int = 0,
        speechMs: Int = 0,
        route: String = "",
        pauseP: Double? = nil,
        cut: Bool = false
    ) async {
        let bg = await MainActor.run { beginBackground() }
        defer { endBackground(bg) }
        var request = authorized("/turn")
        request.httpMethod = "POST"
        request.setValue(id, forHTTPHeaderField: "X-Atlas-Turn")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if phone { request.setValue("phone", forHTTPHeaderField: "X-Atlas-Mouth") }
        if commit { request.setValue("1", forHTTPHeaderField: "X-Atlas-Commit") }
        var body: [String: Any] = ["text": text]
        if phone { body["stt_ms"] = sttMs }
        if commit { body["commit"] = "1" }
        if !pause.isEmpty { body["pause"] = pause }
        if silenceMs > 0 { body["silence_ms"] = silenceMs }
        if speechMs > 0 { body["speech_ms"] = speechMs }
        if !route.isEmpty { body["route"] = route }
        if let pauseP { body["pause_p"] = pauseP }
        if cut { body["cut"] = "1" }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
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
            let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
            if type.contains("json") {
                var data = Data()
                for try await byte in bytes { data.append(byte) }
                let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                if obj?["dropped"] as? Bool == true, !retry {
                    let newId = await MainActor.run { nextTurn() }
                    await postJSON(text, id: newId, era: stamp, sttMs: sttMs, phone: phone, retry: true, commit: commit, pause: pause, silenceMs: silenceMs, speechMs: speechMs, route: route, pauseP: pauseP, cut: cut)
                    return
                }
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
                if saysLeft == 0, !clipPlaying, clips.isEmpty { beginListen() }
            }
        } catch is CancellationError {
            return
        } catch let error as URLError where error.code == .cancelled {
            return
        } catch {
            if !retry, stamp == era {
                await postJSON(text, id: id, era: stamp, sttMs: sttMs, phone: phone, retry: true, commit: commit, pause: pause, silenceMs: silenceMs, speechMs: speechMs, route: route, pauseP: pauseP, cut: cut)
                return
            }
            await MainActor.run {
                guard stamp == era, isOn else { return }
                streamOpen = false
                openReply("I lost the line to the Mac. Say it once more.")
                if saysLeft == 0 { beginListen() }
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
        case "say":
            let sentence = data["sentence"] as? String ?? ""
            if !sentence.isEmpty { enqueueSay(sentence, era: era) }
        case "audio":
            if let b64 = data["wav_b64"] as? String, let wav = Data(base64Encoded: b64), !wav.isEmpty {
                let sentence = data["sentence"] as? String ?? ""
                replyAudio = true
                clips.append(Clip(sentence: sentence, wav: wav))
                if !clipPlaying { playHead() }
            }
        case "command":
            applyCommand(data["name"] as? String ?? "")
        case "restart":
            saySerial += 1
            sayTail?.cancel()
            sayTail = nil
            CallEngine.haltPlayback()
            clips.removeAll()
            clipPlaying = false
            heardReply = ""
            replyAudio = false
            replyOpen = false
            script("window.atlasRestart && window.atlasRestart()")
        case "done":
            if let text = data["text"] as? String, !text.isEmpty { closeReply(text) }
            if let timing = data["timing"] as? [String: Any] {
                let words = timing["first_token_ms"] as? Int ?? 0
                if PhoneVoice.enabled {
                    let worker = timing["worker"] as? String ?? ""
                    let handoff = worker == "plus" ? " · plus" : ""
                    script("window.atlasMeta && window.atlasMeta(\(jsQuote("Heard \(phoneSttMs) ms on phone · first words \(words) ms · voice \(phoneSynthMs) ms · \(CallPrefs.mouth)\(handoff)")))")
                } else {
                    let heardMs = timing["stt_ms"] as? Int ?? 0
                    let audio = timing["first_audio_ms"] as? Int ?? 0
                    script("window.atlasMeta && window.atlasMeta(\(jsQuote("Heard \(heardMs) ms · first words \(words) ms · first audio \(audio) ms")))")
                }
            }
            streamOpen = false
            if saysLeft == 0, !clipPlaying, clips.isEmpty { beginListen() }
        case "error":
            closeReply(data["message"] as? String ?? "Turn failed.")
            streamOpen = false
            if !clipPlaying, clips.isEmpty { beginListen() }
        default:
            break
        }
    }

    static func phoneSpeechEnded() {
        guard isOn else { return }
        clipPlaying = false
        if saysLeft > 0 { return }
        if !clips.isEmpty {
            playHead()
            return
        }
        if !streamOpen { beginListen() }
    }

    private static func playHead() {
        guard isOn else { return }
        guard !clips.isEmpty else {
            clipPlaying = false
            if saysLeft > 0 { return }
            if !streamOpen { beginListen() }
            return
        }
        let clip = clips.removeFirst()
        clipPlaying = true
        phase = .speaking
        setCapture(.off)
        note("Speaking… talk to interrupt")
        notePhase("speaking")
        CallEngine.armClip(clip.sentence)
        if replyStarted == nil { replyStarted = Date() }
        do {
            let sentence = clip.sentence
            try CallEngine.playWav(clip.wav) {
                heardReply = joinHeard(heardReply, sentence)
                playHead()
            }
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
        // No number keeps the Mac upload at 22 seconds. A caller that asks
        // for more, such as the whole prompt, gets that much.
        let cap = maxSeconds ?? 22
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

    private static func enqueueSay(_ sentence: String, era stamp: Int) {
        let serial = saySerial
        let previous = sayTail
        saysLeft += 1
        let job = Task {
            await previous?.value
            let stale = Task.isCancelled || stamp != era || serial != saySerial
            var wav: Data?
            var synth = 0
            if !stale {
                if CallPrefs.mouth == "phonon", !PhoneVoice.shared.phononIsWarm {
                    await MainActor.run {
                        guard stamp == era, serial == saySerial, isOn else { return }
                        note("Loading Phonon… the first time downloads the voice.")
                    }
                }
                let started = Date()
                wav = try? await PhoneVoice.shared.speak(sentence)
                synth = Int(Date().timeIntervalSince(started) * 1000)
            }
            let spoken = wav
            let voiceMs = synth
            await MainActor.run {
                saysLeft = max(0, saysLeft - 1)
                let usable = !stale && stamp == era && serial == saySerial && isOn && (spoken?.count ?? 0) > 44
                guard usable, let spoken else {
                    if saysLeft == 0, !clipPlaying, clips.isEmpty, !streamOpen, phase != .listening {
                        beginListen()
                    }
                    return
                }
                if phoneSynthMs == 0 { phoneSynthMs = voiceMs }
                let notice = PhoneVoice.shared.takeNotice()
                if !notice.isEmpty { note(notice) }
                script("window.atlasMeta && window.atlasMeta(\(jsQuote("Heard \(phoneSttMs) ms on phone · voice \(phoneSynthMs) ms · \(CallPrefs.mouth)")))")
                do {
                    let queued = try CallEngine.queuePhone(sentence: sentence, wav: spoken)
                    guard queued else {
                        if saysLeft == 0, !CallEngine.isAudible, !streamOpen, phase != .listening { beginListen() }
                        return
                    }
                    replyAudio = true
                    guard !clipPlaying else { return }
                    clipPlaying = true
                    phase = .speaking
                    setCapture(.off)
                    note("Speaking… talk to interrupt")
                    notePhase("speaking")
                    if replyStarted == nil { replyStarted = Date() }
                } catch {
                    clipPlaying = false
                    beginListen()
                }
            }
        }
        sayTail = job
    }

    private static func cancelWork() {
        era += 1
        saySerial += 1
        sayTail?.cancel()
        sayTail = nil
        probeBusy = false
        task?.cancel()
        task = nil
        let id = turnId
        guard !id.isEmpty else { return }
        Task { await postCancel(id) }
    }

    private static func nextTurn() -> String {
        turnSerial += 1
        // A fresh open of the app used to count 1, 2, 3 again. The Mac still
        // remembered those numbers as cancelled, so the first tries came back
        // as "I lost that" even though the phone had reached it.
        turnId = "\(turnSerial)-\(UUID().uuidString)"
        return turnId
    }

    /// The pause model only listens to the last 8 seconds, and it resamples
    /// itself. Trim here. Do not resample on the phone. A phone resample was
    /// scoring his finished sentences as still going.
    private static func probeClip(_ wav: Data) -> Data {
        guard wav.count > 44 else { return wav }
        let bytes = [UInt8](wav)
        func u16(_ at: Int) -> Int { Int(bytes[at]) | (Int(bytes[at + 1]) << 8) }
        func u32(_ at: Int) -> Int { u16(at) | (u16(at + 2) << 16) }
        let channels = u16(22)
        let rate = u32(24)
        let bits = u16(34)
        guard channels == 1, bits == 16, rate > 8000 else { return wav }
        let count = (bytes.count - 44) / 2
        let cap = rate * 8
        guard count > cap else { return wav }
        let start = 44 + (count - cap) * 2
        var clipped = Data(bytes[0..<44])
        let size = cap * 2
        var riff = UInt32(36 + size).littleEndian
        var dataSize = UInt32(size).littleEndian
        clipped.replaceSubrange(4..<8, with: Data(bytes: &riff, count: 4))
        clipped.replaceSubrange(40..<44, with: Data(bytes: &dataSize, count: 4))
        clipped.append(contentsOf: bytes[start...])
        return clipped
    }

    private static func authorized(_ path: String) -> URLRequest {
        let url = origin.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path)
        var request = URLRequest(url: url)
        if !gate.isEmpty { request.setValue(gate, forHTTPHeaderField: "X-Atlas-Gate") }
        request.setValue(CallPrefs.brain, forHTTPHeaderField: "X-Atlas-Brain")
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

    /// One string for the screen and the model. The final pass wins when it
    /// still has the opening. A longer rolling caption keeps the words that
    /// pass dropped.
    private static func fullerTranscript(heard: String, caption: String) -> String {
        let heard = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        let caption = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        if heard.isEmpty { return caption }
        if caption.isEmpty { return heard }
        if captionWords(heard).count + 2 >= captionWords(caption).count { return heard }
        return expandCaption(prior: caption, piece: heard)
    }

    private static func expandCaption(prior: String, piece: String) -> String {
        let prior = prior.trimmingCharacters(in: .whitespacesAndNewlines)
        let piece = piece.trimmingCharacters(in: .whitespacesAndNewlines)
        if prior.isEmpty { return piece }
        if piece.isEmpty { return prior }
        let rolled = rollCaption(carry: "", previous: prior, next: piece)
        if captionWords(rolled.display).count > captionWords(prior).count {
            return rolled.display
        }
        let priorWords = captionWords(prior)
        let pieceWords = captionWords(piece)
        let priorKeys = priorWords.map(captionKey)
        let pieceKeys = pieceWords.map(captionKey)
        var overlap = 0
        for n in stride(from: min(priorKeys.count, pieceKeys.count), through: 1, by: -1) {
            if Array(priorKeys.suffix(n)) == Array(pieceKeys.prefix(n)) {
                overlap = n
                break
            }
        }
        let tail = pieceWords.dropFirst(overlap)
        guard !tail.isEmpty else { return prior }
        return captionJoin([prior, captionJoin(tail.map { String($0) })])
    }

    private static func captionWords(_ text: String) -> [String] {
        text.split { $0.isWhitespace || $0.isNewline }.map(String.init)
    }

    private static func captionKey(_ word: String) -> String {
        String(word.lowercased().filter { $0.isLetter || $0.isNumber })
    }

    private static func captionJoin(_ parts: [String]) -> String {
        parts.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// The new slice overlaps the previous one. Words that fell off the left
    /// stay in front, and the new slice replaces the shared ending.
    private static func rollCaption(carry: String, previous: String, next: String) -> (carry: String, window: String, display: String) {
        let nextWords = captionWords(next)
        let prevWords = captionWords(previous)
        if prevWords.isEmpty {
            return (carry, next, captionJoin([carry, next]))
        }
        if nextWords.isEmpty {
            return (carry, previous, captionJoin([carry, previous]))
        }
        let prevKeys = prevWords.map(captionKey)
        let nextKeys = nextWords.map(captionKey)
        var bestI = -1
        var bestScore = 0
        var bestAlign = 0
        for i in 0..<prevKeys.count {
            let align = min(prevKeys.count - i, nextKeys.count)
            guard align > 0 else { continue }
            var score = 0
            for j in 0..<align where prevKeys[i + j] == nextKeys[j] {
                score += 1
            }
            let grew = i == 0 && score == align
            let overlapped = align >= 3 && (align - score) <= 2 && score * 100 >= align * 60
            guard grew || overlapped else { continue }
            if score > bestScore || (score == bestScore && align > bestAlign) {
                bestScore = score
                bestAlign = align
                bestI = i
            }
        }
        guard bestI >= 0 else {
            // A longer new hearing is the line. Keeping the old one here is
            // what left a single word on screen after he had finished.
            if nextWords.count > prevWords.count {
                return (carry, next, captionJoin([carry, next]))
            }
            return (carry, previous, captionJoin([carry, previous]))
        }
        let kept = captionJoin([carry, captionJoin(Array(prevWords[..<bestI]))])
        return (kept, next, captionJoin([kept, next]))
    }

    private static func showYou(_ text: String, live: Bool) {
        if live { lastCaption = text }
        script("window.atlasYou && window.atlasYou(\(jsQuote(text)), \(live ? "true" : "false"))")
    }

    private static func joinHeard(_ earlier: String, _ next: String) -> String {
        let left = earlier.trimmingCharacters(in: .whitespacesAndNewlines)
        let right = next.trimmingCharacters(in: .whitespacesAndNewlines)
        if left.isEmpty { return right }
        if right.isEmpty { return left }
        return left + " " + right
    }

    private static func publishCut() {
        guard replyAudio else {
            heardReply = ""
            return
        }
        replyAudio = false
        let report = CallEngine.cutReport()
        let heard = joinHeard(heardReply, report.heard)
        heardReply = ""
        let queued = clips.count + CallEngine.phoneAhead
        let replyMs = replyStarted.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
        let afterForce = lastUserEnd == "force"
        replyStarted = nil
        Task {
            await postCut(
                heard: heard,
                sentence: report.sentence,
                playedMs: report.playedMs,
                fraction: report.fraction,
                queued: queued,
                route: report.route,
                replyMs: replyMs,
                afterForce: afterForce
            )
        }
    }

    private static func applyCommand(_ name: String) {
        guard isOn else { return }
        if name == "mute" {
            publishCut()
            cancelWork()
            CallEngine.haltPlayback()
            clips.removeAll()
            clipPlaying = false
            streamOpen = false
            commandEar = true
            micMuted = true
            beginCommandListen()
            CallEngine.playCue("mute")
        } else if name == "unmute" {
            commandEar = false
            micMuted = false
            beginListen()
            CallEngine.playCue("unmute")
        } else if name == "hold" {
            commandEar = true
            micMuted = true
            if phase != .speaking { beginCommandListen() }
        }
        script("window.atlasMuted && window.atlasMuted(\(micMuted ? "true" : "false"))")
    }

    private static func postBleed(peak: Double, route: String, loudMs: Int) async {
        var request = authorized("/pause")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "peak": (peak * 1000).rounded() / 1000,
            "route": route,
            "loud_ms": loudMs,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await session.data(for: request)
    }

    private static func postPause(silenceMs: Int, speechMs: Int, route: String) async {
        var request = authorized("/pause")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["silence_ms": silenceMs, "speech_ms": speechMs, "route": route]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await session.data(for: request)
    }

    private static func postCommand(_ name: String) async {
        var request = authorized("/command")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["name": name])
        _ = try? await session.data(for: request)
    }

    private static func postCut(heard: String, sentence: String, playedMs: Int, fraction: Double, queued: Int, route: String, replyMs: Int, afterForce: Bool) async {
        var request = authorized("/cut")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "heard": heard,
            "sentence": sentence,
            "played_ms": playedMs,
            "fraction": fraction,
            "queued": queued,
            "route": route,
            "reply_ms": replyMs,
            "after_force": afterForce,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await session.data(for: request)
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
