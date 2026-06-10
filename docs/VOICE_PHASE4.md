# Atlas Voice — Phase 4 (Path B: Unified Realtime)

Single xAI Realtime WebSocket with **server VAD** (Grok-app style). Replaces the split
Grok STT → silence timer → client-secret → Realtime reply pipeline when enabled.

## Latency baseline (2026-06-09)

Build stamp **`2026-06-09-unified-viable`** — first Path B build with sub‑2s speak→reply
feel in practice (unified Realtime + server VAD + `grok-transcribe` live captions).
Treat this as the Phase 1 voice milestone; regressions should be checked against
`[atlas:voice-v2]` / `[atlas:unified]` first_audio_delta_ms and end-to-end turn time.

## Voice v2 rewrite (2026-06-10)

Build stamp **`2026-06-10-voice-v2`** — clean rewrite on proven WS/PCM path:

- `VoiceSession.ts` — single owner state machine
- `RealtimeConnection.ts` — simplified WS client (PCM buffer until configured)
- `useVoiceV2.ts` — React hook; App.tsx no longer runs heal/watchdog loops
- Flag: `EXPO_PUBLIC_VOICE_V2=1` (default in release script); set `0` for legacy unified hook

## Architecture

### Legacy (Path A) — `EXPO_PUBLIC_REALTIME_UNIFIED=0`

```
iPhone mic → atlas-audio-capture → STT WS → Mac /stt/stream → xAI STT
  → client silence endpointing → sendToAtlas → client-secret → Realtime WS
  → atlas-stream-audio (per-turn)
```

### Path B — `EXPO_PUBLIC_REALTIME_UNIFIED=1` + `EXPO_PUBLIC_XAI_STT=1`

```
iPhone mic → atlas-audio-capture (PCM16 16 kHz)
  → input_audio_buffer.append → Mac /realtime/stream (proxy) → xAI Realtime
  → server_vad end-of-turn → response audio deltas
  → atlas-realtime-playback (gapless, first delta immediate)
```

One **persistent** Realtime session per voice conversation. One client-secret per
WebSocket (minted at session start, not per turn).

### Apple STT fallback — `EXPO_PUBLIC_XAI_STT=0`

Unchanged: on-device Apple STT + per-turn Realtime reply (`runRealtimeTurn`).
Set via `scripts/build-ios-release-apple-stt.sh`.

## Feature flags

| `EXPO_PUBLIC_VOICE_V2` | `EXPO_PUBLIC_REALTIME_UNIFIED` | `EXPO_PUBLIC_XAI_STT` | Path |
| --- | --- | --- | --- |
| `1` | `1` | `1` | **Voice v2 (Path B)** |
| `0` | `1` | `1` | Legacy unified hook |
| — | `0` | `1` | Grok STT + split Realtime reply |
| — | `0` | `0` | Apple STT + split Realtime reply |
| — | `1` | `0` | Apple STT (unified ignored) |

Release build (`build-ios-release.sh`): `REALTIME_UNIFIED=1`, `XAI_STT=1`, `VOICE_V2=1`.

## Server

| Endpoint | Role |
| --- | --- |
| `POST /realtime/client-secret` | Mint ephemeral token (unchanged) |
| `WS /realtime/stream` | Bidirectional proxy → xAI; injects `session.update` after configure |
| `GET /realtime/metrics` | Last-session latency snapshot for debugging |
| `GET /health` | Includes `realtimeProxy: true` when `XAI_API_KEY` set |

### Proxy configure (client → Mac, once per session)

```json
{
  "type": "proxy.configure",
  "instructions": "…Jarvis chief instructions…",
  "voice": "rex",
  "inputSampleRate": 16000,
  "outputSampleRate": 24000,
  "history": [{ "role": "user", "content": "…" }]
}
```

Mac responds with `proxy.configured`, seeds `conversation.item.create` for each history turn,
then forwards all xAI events. Injected session:

- `turn_detection.type`: `server_vad`
- `turn_detection.create_response`: `false` (mobile fires `response.create` after intent checks)
- `turn_detection.interrupt_response`: `true`
- `turn_detection.threshold`: `0.5`, `prefix_padding_ms`: `300`
- `audio.input`: PCM 16 kHz · `audio.output`: PCM 24 kHz
- `tools`: `[{ "type": "web_search" }]`

## Mobile

| File | Role |
| --- | --- |
| `src/voice-flags.ts` | Flag matrix (`USE_VOICE_V2`) |
| `src/voice-v2/RealtimeConnection.ts` | WS client, metrics, serialized events |
| `src/voice-v2/VoiceSession.ts` | State machine: connect → listen → think → speak → listen |
| `src/voice-v2/useVoiceV2.ts` | React hook |
| `src/realtime-playback.ts` | Facade over `atlas-realtime-playback` native module |
| `src/useAdaptiveVoiceCapture.ts` | Routes v2 / unified / Grok STT / Apple |

### State machine (serialized — no parallel turns)

```
idle → connecting → listening ⇄ thinking → speaking → listening
```

- **connecting**: fetch secret, open proxy WS, send configure (includes last 10 chat turns), **start mic in parallel** (PCM buffers until `proxy.configured`)
- **listening**: stream mic PCM; server VAD detects speech (no client silence timer)

### Mic lifecycle invariants (do not regress)

1. **Initial open** — mic starts in parallel with WS configure; never stop capture before first start.
2. **After speak / hold** — restart mic only (stop then start).
3. **Single owner** — `VoiceSession` owns mic start/stop; App.tsx does not heal or watchdog.
4. **VAD** — server `threshold: 0.5`, `prefix_padding_ms: 300` (unified-viable baseline).
5. **Audio sharing** — AVAudioSession active for entire `connecting→listening→turn`; `releaseNativeAudioSession()` only on teardown; never deactivate during `connecting`.
6. **No mic watchdog** — manual tap to retry on failure.
- **thinking**: user transcript complete; optional moment/refresh/deep routing; `response.create`
- **speaking**: PCM deltas → native playback; `response.done` → listening

## Latency budget (dev logs)

| Metric | Target | Log tag |
| --- | --- | --- |
| `realtime_connect_ms` | &lt; 800 ms | `[atlas:voice-v2]` |
| `first_audio_delta_ms` | &lt; 1200 ms after speech end | `[atlas:voice-v2]` |
| `turn_complete_ms` | varies by reply length | `[atlas:voice-v2]` |

Server mirrors connect/configure/first-delta timestamps at `GET /realtime/metrics`.

## Audio playback (`atlas-realtime-playback`)

Fresh Swift module — **not** a patch on `atlas-stream-audio`:

- First PCM delta schedules immediately (no 150 ms batch gate)
- Tail flushed on `finish()`; awaits buffer drain before `stop`
- No aggressive `engine.stop()` mid-utterance

Requires iOS rebuild when the native module changes.

## Testing

### Mac-only (minimal credits)

```bash
cd server && npm run dev
node scripts/test-realtime-proxy.mjs   # health + metrics smoke
```

### Mobile

1. `EXPO_PUBLIC_REALTIME_UNIFIED=1 EXPO_PUBLIC_XAI_STT=1 EXPO_PUBLIC_VOICE_V2=1`
2. Rebuild iOS if native modules changed: `bash scripts/build-ios-release.sh`
3. Tap mic → speak → confirm single WS (no STT connect in logs), Jarvis reply, no start/end cutoff
4. Rollback unified hook: `EXPO_PUBLIC_VOICE_V2=0`
5. Revert to Apple STT: `bash scripts/build-ios-release-apple-stt.sh`

### Typecheck / tests

```bash
cd server && npm run typecheck
cd apps/mobile && npm run typecheck && npm run test:audio
```

## What Path B explicitly avoids

- Client silence timer / `speech_final` stitching on unified path
- Cached or reused client secrets across WebSockets
- Parallel prefetch of secrets
- Mixing Grok STT timers into unified capture
- App-level `healMicSession` / `waitForVoiceReady` loops
