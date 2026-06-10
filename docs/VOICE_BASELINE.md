# Atlas Voice Baseline — June 2026

**Status:** Voice v2 rewrite — Path B with simplified lifecycle (Phase 1.5 closeout).

**Build stamp:** `2026-06-10-voice-v2`

Prior references: `2026-06-09-unified-viable` (latency peak), `2026-06-10-voice-stable2` (pre-v2 patches)

## What works

- **Voice v2** — single `VoiceSession` owner, parallel WS + mic, no heal/watchdog loops
- Unified Realtime (Path B) with server VAD
- Chat context on resume — last 10 turns seeded into Realtime on mic connect
- Persistent chat sessions (☰ history)
- Audio sharing — `releaseNativeAudioSession()` on teardown when idle; session stays active during `connecting`
- Shortcut `atlas://listen` cold-start voice

## Architecture (Voice v2)

| File | Role |
| --- | --- |
| `apps/mobile/src/voice-v2/VoiceSession.ts` | State machine: idle → connecting → listening ⇄ thinking → speaking |
| `apps/mobile/src/voice-v2/RealtimeConnection.ts` | Thin WS client, PCM buffer until `proxy.configured` |
| `apps/mobile/src/voice-v2/useVoiceV2.ts` | React hook — minimal surface for App.tsx |
| `apps/mobile/src/useAdaptiveVoiceCapture.ts` | Routes v2 vs legacy unified vs Grok STT vs Apple |
| `apps/mobile/src/voice-flags.ts` | `USE_VOICE_V2` (`EXPO_PUBLIC_VOICE_V2=1` default) |

Rollback: `EXPO_PUBLIC_VOICE_V2=0` restores legacy `useUnifiedRealtimeVoice.ts`.

## Invariants (do not regress)

See `docs/VOICE_PHASE4.md` — mic lifecycle, audio sharing, VAD baseline (`threshold: 0.5`).

Key files:

| Area | File |
| --- | --- |
| Mic orchestration | `apps/mobile/src/voice-v2/VoiceSession.ts` |
| Listen UI | `apps/mobile/App.tsx` (`beginVoiceListen` — no watchdog/heal) |
| Realtime WS + history | `voice-v2/RealtimeConnection.ts`, `server/src/realtime-proxy.ts` |
| Proxy WS URL (iOS 17+) | `apps/mobile/src/api.ts` → `rewriteProxyWsUrl()` |
| Native capture / playback | `atlas-audio-capture`, `atlas-realtime-playback` |

## Removed (regression sources)

- `healMicSession` aggressive reconnect loops in App.tsx
- `waitForVoiceReady` polling + false "Mic did not start" errors
- App-level audio session juggling during Path B `connecting`
- Duplicate `activateVoiceSessionAudio` on unified mic start

## Test checklist (5 min)

1. Settings → stamp `2026-06-10-voice-v2`, mode label "Voice v2"
2. New chat → mic → normal volume → Atlas replies (sub-2s feel target)
3. ☰ → old chat → mic → ask for conversation summary → uses prior context
4. Stop mic → YouTube plays → Atlas does not fight audio
5. Shortcut `atlas://listen` from cold start → voice works
6. Switch chat → mic again without reboot

## Server

```bash
cd server && npm run dev
# Requires XAI_API_KEY, realtime proxy on :8787
```
