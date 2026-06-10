# Atlas Voice — 5-Minute Test Checklist

Run this on a **physical iPhone** (same WiFi as the Mac) before each session.
The iOS Simulator does not do real speech recognition, so the voice loop must be
tested on-device.

## 0. Start everything (2 terminals on the Mac)

```bash
# Terminal 1 — server
cd ~/Documents/Macbook-Documents/projects/atlas/server
npm run dev
# expect: "Atlas server listening on http://10.0.0.84:8787"

# Terminal 2 — mobile dev client
cd ~/Documents/Macbook-Documents/projects/atlas/apps/mobile
npx expo start --dev-client
# first install on the phone (USB): npx expo run:ios --device
```

Tip: set `ATLAS_DEBUG=1` in `server/.env` and keep `EXPO_PUBLIC_ATLAS_DEBUG=1`
(default) so both consoles print `[atlas]` / `[atlas:*]` trace lines.

## 1. Connectivity (30s)

- [ ] `curl http://10.0.0.84:8787/health` → `{"ok":true,...}`
- [ ] iPhone Safari → `http://10.0.0.84:8787/health` → ok
- [ ] App header shows **Connected** (green dot). If red, tap it to retry.

## 2. Core voice loop (2 min)

- [ ] Tap mic once → status shows **Listening…**
- [ ] Say "What's the status of VocalLearn?" → words appear live in a user bubble
- [ ] **Pause ~1s → it auto-sends** (no second tap)
- [ ] Atlas reply appears as text AND is **spoken in voice** (Ara)
- [ ] First audio within ~1–3s of sending (Grok-comparable)
- [ ] Audio is **smooth** (no choppy skipping). If choppy, note it — raise
  ```
  `SEGMENT_SECONDS` in `src/pcm-audio.ts`.
  ```
- [ ] No "Mic error: aborted" / spurious error toast

## 3. Multi-turn + interrupt (1 min)

- [ ] Do **10 back-and-forth turns**; mic + audio keep working every time
- [ ] Mid-reply, **tap the mic while Atlas is speaking** → audio stops instantly,
  ```
  goes to Listening, your new utterance is captured and answered
  ```
- [ ] Ask "Can you hear me?" → Atlas confirms it can hear you (never claims to be
  ```
  text-only)
  ```

## 4. Project intelligence (1 min)

- [ ] "What should I work on next for the career dashboard?" → sensible answer
  ```
  from the roadmap
  ```
- [ ] "What's the latest on VocalLearn?" → triggers a refresh first (watch server
  ```
  log for `force=true`), then answers from fresh files
  ```
- [ ] "Read the VocalLearn roadmap and give me the top 3 priorities" → grounded in
  ```
  cached report content (no invented details)
  ```

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

```

```

