# Atlas Voice Architecture (Phase 1)

How a spoken turn flows through Atlas, and why each piece is built the way it is.
Scope is the **chief voice assistant only** — no managers, workers, wake word, or
proactive alerts.

## Pipeline (fast path — default)

```
Tap mic
  │
  ▼
On-device STT  (expo-speech-recognition, src/speech.ts + src/useVoiceCapture.ts)
  │  live partial transcript → user bubble
  │  auto-submits ~0.9s after you stop talking (no second tap)
  ▼
POST /chief/instructions   → persona + voice rules + cached project context
POST /realtime/client-secret → ephemeral xAI token + wsUrl
  │
  ▼
WebSocket → xAI realtime  (grok-voice-think-fast-1.0, voice "rex", src/realtime.ts)
  │  session.update sets BOTH input + output audio = pcm/24000
  │  sends last 10 turns of history + the new user message
  │  response.create { modalities: ["text","audio"] }
  ▼
Streaming events:
  response.text.delta / output_audio_transcript.delta  → live Atlas bubble
  response.output_audio.delta                          → streamed to speaker
  response.done                                        → finish playback, resolve
  │
  ▼
### Fast path (default — native AVAudioEngine on iOS)

```
Tap mic → on-device STT → auto-send
  │
  ▼
WebSocket → xAI realtime (grok-voice-think-fast-1.0, modalities text+audio)
  │  text → live bubble
  │  output_audio.delta → base64 PCM16 @ 24kHz
  ▼
AtlasStreamAudioModule (Swift AVAudioEngine + AVAudioPlayerNode)
  scheduleBuffer per delta — gapless, no temp files, low latency
  │
  ▼
Speaker
```

**Requires a native rebuild** after adding the module (`npx expo run:ios --device`).
Metro reload alone is not enough.

Fallback: if native module unavailable, `src/pcm-audio.ts` (expo-av segments).
Last-resort: `/tts` MP3 if realtime returns text but no audio.
```

### Why streaming playback

The previous build buffered the entire audio response and played it only after
`response.done`, so first-audio latency equalled full generation time. We now use
VocalLearn's proven `startStreamingPcmPlayback`: incoming PCM16 is sliced into
~0.4s WAV segments played back-to-back as they arrive. First audio is heard
~immediately (Grok-like).

**Tuning knob:** `SEGMENT_SECONDS` in `src/pcm-audio.ts`. Larger = smoother but
higher first-audio latency; smaller = snappier but more gaps. If playback sounds
choppy on your device, raise it (e.g. 0.6–0.8s) and report back.

### Fallbacks (user should never notice)

1. Realtime returns text but **no** audio → client calls `POST /tts` (Rex MP3) and
   plays it (`src/audio.ts`).
2. Streaming playback throws → same TTS MP3 fallback.
3. Mic unavailable → the text input + Send button always works.

## Deep path (permission-gated)

Triggered by the **Deep toggle** or phrases like "think deeply", "deep dive",
"take your time" (`DEEP_INTENT` in `App.tsx`).

```
Tap mic / type → detect deep
  │  instant spoken filler: "One moment, sir. Let me think this through." (expo-speech)
  ▼
POST /chat { deep: true }  → server routes to XAI_DEEP_MODEL (grok-4-fast-reasoning)
  │  persona filter applied, larger token budget
  ▼
POST /tts → Rex MP3 → playback
```

Deep turns do not use the realtime voice socket (the reasoning model is not the
voice model). After a deep turn, fast turns resume normally.

## Refresh-on-demand

Phrases like "what's the latest on VocalLearn", "refresh", "current status"
(`REFRESH_INTENT` in `App.tsx`) trigger `POST /reports/refresh { force: true }`
before the turn, so the chief context reflects current repo files (even
uncommitted edits). `force` re-reads files regardless of git HEAD.

## Interrupt (tap while Atlas speaks)

Tapping the mic during `thinking`/`speaking`:
1. aborts the in-flight request (AbortController),
2. stops realtime/streaming/MP3 playback and the expo-speech filler,
3. immediately starts a new listening session,
4. flags the next turn as `interrupted` so the chief continues naturally.

## Audio session handling (iOS)

The recurring iOS pitfall is the `playAndRecord` (mic) ↔ `playback` (speaker)
handoff routing audio to the earpiece. Mitigations:
- STT sets `playAndRecord` + `defaultToSpeaker` (`src/speech.ts`).
- Every playback path calls `resetAudioForPlayback()` first to force the
  `playback` category + speaker (`pcm-audio.ts`, `audio.ts`).

## Debug logging

- **Mobile:** on by default (`EXPO_PUBLIC_ATLAS_DEBUG`, default 1). All voice
  events log to the Metro/device console tagged `[atlas:stt|rt|audio|turn|ui]`
  with timestamps. Grep `[atlas:` to trace a turn end-to-end.
- **Server:** set `ATLAS_DEBUG=1` in `server/.env` for `[atlas]` request lines.

## Key files

| File | Responsibility |
|------|----------------|
| `apps/mobile/App.tsx` | UI, turn orchestration, fast/deep routing, interrupt |
| `apps/mobile/src/useVoiceCapture.ts` | STT lifecycle, auto-submit on pause, iOS event suppression |
| `apps/mobile/src/speech.ts` | expo-speech-recognition wrapper + audio session |
| `apps/mobile/src/realtime.ts` | xAI realtime WebSocket turn, streams audio deltas |
| `apps/mobile/src/pcm-audio.ts` | streaming + buffered PCM16 playback |
| `apps/mobile/src/audio.ts` | base64 MP3 (TTS) playback |
| `server/src/chief/instructions.ts` | persona + voice-mode + context for realtime |
| `server/src/chief/respond.ts` | fast/deep model router for `/chat` |
| `server/src/xai/realtime.ts` | ephemeral client-secret minting |
```
