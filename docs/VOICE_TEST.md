# Atlas Voice — 5-Minute Test Checklist

Run this on a **physical iPhone** (same WiFi as the Mac) before each session.
The iOS Simulator does not do real speech recognition, so the voice loop must be
tested on-device.

## 0. Start everything (2 terminals on the Mac)

```bash
# Terminal 1 — server
cd ~/Documents/Macbook-Documents/projects/atlas/server
npm run dev

# Terminal 2 — mobile (requires native rebuild after AVAudioEngine module)
cd ~/Documents/Macbook-Documents/projects/atlas/apps/mobile
npm install
npx expo run:ios --device    # rebuild dev client (required once)
npx expo start --dev-client    # subsequent sessions
```

Verify native audio linked — in Metro on a voice turn, grep for:
`[atlas:audio] using native AVAudioEngine stream`
If you see `expo-av segmented fallback`, rebuild with `npx expo run:ios --device`.

Tip: set `ATLAS_DEBUG=1` in `server/.env` and keep `EXPO_PUBLIC_ATLAS_DEBUG=1`
(default) so both consoles print `[atlas]` / `[atlas:*]` trace lines.

## 1. Connectivity (30s)

- [ ] `curl http://10.0.0.84:8787/health` → `{"ok":true,...}`
- [ ] iPhone Safari → `http://10.0.0.84:8787/health` → ok
- [ ] App header shows **Connected** (green dot). If red, tap the pill to retry.
- [ ] Subtitle shows build stamp `2026-06-08-xai-stt` and **Grok STT** (not Apple STT).
- [ ] `bash scripts/test-voice-pipeline.sh http://127.0.0.1:8787` passes on the Mac.

## 2. Core voice loop (2 min)

- [ ] Tap mic once → status shows **Listening…**
- [ ] Say "What's the status of VocalLearn?" → words appear live in a user bubble
- [ ] **Pause when done** → Smart Turn auto-sends (Grok STT) or ~3s pause (Apple fallback)
- [ ] Atlas reply text streams in; audio is **smooth and low-latency** (native AVAudioEngine)
- [ ] After Atlas finishes, **mic stays on** (Listening) — no need to tap again for follow-up
- [ ] Tap mic while listening (empty) → mic turns off
- [ ] Voice sounds **Rex** (male, composed) with Jarvis-style phrasing ("Yes, sir.", concise)
- [ ] Metro shows `[atlas:audio] using native AVAudioEngine stream` (not expo-av fallback)
- [ ] No "Mic error: aborted" / spurious error toast

## 3. Multi-turn + interrupt (1 min)

- [ ] Do **10 back-and-forth turns** without re-tapping mic; mic + audio keep working every time
- [ ] Mid-reply, **tap the mic while Atlas is speaking** → audio stops instantly,
      goes to Listening, your new utterance is captured and answered
- [ ] Ask "Can you hear me?" → Atlas confirms it can hear you (never claims to be
      text-only)

## 4. Project intelligence (1 min)

- [ ] "What should I work on next for the career dashboard?" → sensible answer
      from the roadmap
- [ ] "What's the latest on VocalLearn?" → triggers a refresh first (watch server
      log for `force=true`), then answers from fresh files
- [ ] "Read the VocalLearn roadmap and give me the top 3 priorities" → grounded in
      cached report content (no invented details)

## 5. Deep reasoning (30s)

- [ ] Turn on the **Deep reasoning** toggle (bottom-right), OR say "think deeply…"
- [ ] You hear "One moment, sir…" immediately, then a more thorough spoken answer
- [ ] Server log shows `model=grok-4-fast-reasoning deep=true`
- [ ] Turn the toggle off → next turn is fast realtime voice again

## 6. Text fallback (15s)

- [ ] Type a message + Send → works without using the mic

## If something fails

Capture the **Metro console** (and Xcode device log if a crash) and grep for
`[atlas:`. The tags trace the turn:
`[atlas:stt]` capture/submit · `[atlas:rt]` websocket + audio timing ·
`[atlas:audio]` playback · `[atlas:turn]` routing · `[atlas:ui]` interrupt.
Paste the relevant lines back and we iterate.

### Known: `OSStatus error -50` in an Atlas bubble

This was caused by an invalid iOS audio session combo: `category: "playback"`
with `categoryOptions: ["defaultToSpeaker"]`. Apple only allows
`defaultToSpeaker` with `playAndRecord`. The fix uses empty `categoryOptions: []`
for playback (same as VocalLearn). If you still see -50 after pulling, reload
the JS bundle (`r` in Metro) — no native rebuild required for that fix.

### Red "Offline" / "Network request failed"

The app probes your Mac Atlas server on launch. If the server is not running,
every URL fails and the header shows **Offline**. Fix:

```bash
cd server && npm run dev
```

Then tap the **Offline** pill in the app (or force-quit and reopen). Tailscale
must be on for remote use; MagicDNS URL is baked into release builds.
