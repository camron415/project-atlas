# Phase 1.5 closeout — Production voice

**Closed:** 2026-06-10  
**Build stamp:** `2026-06-10-chat-sessions`

## Shipped

| Item | Status |
| --- | --- |
| Path B — Unified Realtime (`grok-voice-think-fast` + server VAD) | ✅ |
| Mac `/realtime/stream` proxy | ✅ |
| `atlas-realtime-playback` native module | ✅ |
| Live captions (`grok-transcribe`) | ✅ |
| Apple STT fallback (`build-ios-release-apple-stt.sh`) | ✅ |
| Grok STT legacy path (flag) | ✅ |
| Speaker profiles + diarization | ✅ |
| Phrase wake "Hey Atlas" | ✅ |
| Shortcuts / Action Button (`atlas://listen`) | ✅ |
| Background audio session + Live Activity | ✅ |
| **Persistent chat sessions** (☰ menu, local + server) | ✅ |
| Latency baseline documented (`docs/VOICE_PHASE4.md`) | ✅ |

## Voice path (default release)

`EXPO_PUBLIC_REALTIME_UNIFIED=1` + `EXPO_PUBLIC_XAI_STT=1`

Mic → single Realtime WS → server VAD → Rex voice out. Sub-2s speak→reply feel in practice.

## Verify

1. Settings → build `2026-06-10-chat-sessions`
2. Mode → **Unified Realtime**
3. ☰ top-left → chat history
4. Kill app → reopen → same chat restores
5. Away from home: Tailscale + Mac `npm run dev`

## Deferred (not 1.5)

- Porcupine native wake (New Arch link)
- Mac 24/7 daemon + push (C5)
- Long PCM edge cases on legacy split path
- Phase 2 managers / proactive alerts

## Next

**Phase 1.75** — Analyst + inbox (`docs/PHASE_1_75.md`)
