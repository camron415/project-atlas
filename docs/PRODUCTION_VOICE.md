# Atlas Production Voice — Feature Roadmap

Path from Phase 1 push-to-talk MVP to a Jarvis-grade, 24/7, personalized chief
assistant. Three major upgrades, built **in this order** (each unlocks the next).

| # | Feature | Why this order | Exit criteria |
| --- | --- | --- | --- |
| **A** | xAI Streaming STT + Smart Turn | Fixes transcription quality *and* thinking-pause cutoffs in one pipe; same API powers diarization | Phone uses Grok STT by default; Apple STT is fallback |
| **B** | Speaker profiles + diarization | `diarize=true` on the STT stream you already have | Atlas knows *who* is speaking and adjusts tone/context |
| **C** | Background audio + "Hey Atlas" | Hardest iOS constraint; needs stable foreground voice loop first | Wake word opens a session; background audio mode keeps pipeline alive |

**Mac server stays the hub:** API keys, STT proxy, project cache, proactive briefings.
iPhone is the voice surface; it streams audio to the Mac (Tailscale), which proxies
to xAI. ~$0.20/hr streaming STT when the mic is open — negligible at personal use.

---

## Feature A — xAI Streaming STT (replace Apple STT)

### What ChatGPT / Grok actually do

- Stream mic audio to a **cloud ASR** tuned for accents and noise (not basic
  `SFSpeechRecognizer` alone).
- Use **Smart Turn** / endpointing ML so a 1s thinking pause ≠ end of turn.
- Show **interim** text while you speak; lock text only on chunk/utterance finals.
- Keep the **voice reply path separate** (your Grok realtime PCM — already working).

### Atlas architecture

```
iPhone mic
  │  PCM16 @ 16 kHz (native capture module)
  ▼
WebSocket → Atlas Mac server `/stt/stream`  (API key never on device)
  │  proxy
  ▼
xAI STT WebSocket  (smart_turn=0.7, smart_turn_timeout=4000, interim_results=true)
  │  transcript.partial / speech_final
  ▼
Mobile UI partial + auto-submit on speech_final
  ▼
Existing fast path → Grok Voice realtime (text in, PCM out)
```

### Step-by-step (build order)

| Step | Work | Test |
| --- | --- | --- |
| **A1** | Server: `GET /stt/config`, WebSocket proxy `/stt/stream` → xAI | `bash scripts/test-voice-pipeline.sh` includes `/stt/config` |
| **A2** | Native: `atlas-audio-capture` module — AVAudioEngine tap, 16 kHz PCM chunks | ✅ Shipped — rebuild required (`2026-06-08-xai-stt`) |
| **A3** | Mobile: `useXaiSttCapture` — WS client, interim UI, submit on `speech_final` | ✅ Shipped — subtitle shows `Grok STT` |
| **A4** | Keyterms + formatting: `Atlas`, `VocalLearn`, `Grok`, project names via `/stt/config` | Say "VocalLearn" / dollar amounts — verify ITN |
| **A5** | Fallback: if proxy unreachable, auto-fallback to Apple STT (current path) | ✅ `useAdaptiveVoiceCapture` falls back on start error |
| **A6** | Tune Smart Turn: `smart_turn` 0.5–0.9, `smart_turn_timeout` 3–5s for your pause style | Long monologue with 2s pauses — no cutoffs |

### Config (server `.env`)

```bash
ATLAS_STT_ENABLED=1
ATLAS_STT_SMART_TURN=0.7          # conservative — good for thinking pauses
ATLAS_STT_SMART_TURN_TIMEOUT=4000 # ms safety net
ATLAS_STT_KEYTERMS=Atlas,VocalLearn,Grok
```

### Cost / latency

- **~$0.20/hr** while mic is streaming (not while Atlas speaks).
- Tailscale hop adds ~20–80 ms — acceptable vs direct xAI.
- Grok Voice reply path unchanged (still sub-second first audio when native PCM works).

---

## Feature B — Speaker diarization + personalization

### Realistic scope for Atlas

xAI STT `diarize=true` returns a `speaker` integer per word. That is **session-relative**
(not a global user ID). For 1–4 known people:

1. **Primary user (Camron):** default profile — full project context, Jarvis tone.
2. **Guests:** lighter profile — polite, less personal data, no financial details.

Optional later: Picovoice Eagle on-device to map xAI speaker IDs → enrolled names
(zero cloud latency). Skip until xAI diarization is validated in your home.

### Step-by-step

| Step | Work | Test |
| --- | --- | --- |
| **B1** | Enable `diarize=true` on STT proxy; forward `speaker` in transcript events | ✅ Default on (`ATLAS_STT_DIARIZE=0` to disable) |
| **B2** | SQLite `speaker_profiles` + API `GET/POST /speakers` | ✅ Seeded Camron + Guest |
| **B3** | Session mapping: speaker 0 → owner, 1 → guest per voice session | ✅ `/speakers/resolve` + reset in settings |
| **B4** | Per-speaker memory summaries in chief instructions | ✅ Owner vs guest addons |
| **B5** | UI: Settings → Speakers (rename, reset maps) | ✅ Gear icon in header |

### Personalization injection (low token cost)

```
[Speaker: Camron (owner)] User said: "…"
```

or for guests:

```
[Speaker: Guest — limited personal context] User said: "…"
```

No second LLM call; no bloated history — just a prefix + per-user 200-token summary.

---

## Feature C — Background listening + "Hey Atlas"

### Honest iOS expectations (from `docs/ROADMAP.md`)

| Goal | Realistic? | Notes |
| --- | --- | --- |
| Listen/respond **app in foreground** | ✅ Done | Phase 1 |
| **Background audio** mode (screen off, app recent) | ⚠️ Partial | `UIBackgroundModes: audio` already in `app.config.ts`; iOS may suspend after ~minutes |
| **"Hey Atlas" wake word, screen off, 24/7** | ⚠️ Limited | Not Siri-grade; battery + App Review scrutiny |
| **Mac always-on wake word** | ✅ Feasible | Phase 2+ — Mac server + Porcupine; iPhone gets push |

**Closest to Grok on iPhone today:** notification → tap → Atlas speaks. Full
unprompted speaker while locked is a **stretch goal**, not v1 of this feature.

### Recommended path (iPhone)

```
Phase C1 — Foreground wake word (Porcupine)
  "Hey Atlas" while app is open → start listen session (no tap)

Phase C2 — Background audio session
  After wake or tap, keep audio session alive briefly with screen off
  → finish one turn, then release

Phase C3 — Mac wake word (24/7)
  Mac server runs Porcupine + Grok → push notification to iPhone
  → tap to hear briefing (reliable production path)

Phase C4 — iOS Shortcuts / Action Button
  Backup: "Ask Atlas" shortcut when wake word fails
```

### Step-by-step (iPhone)

| Step | Work | Test |
| --- | --- | --- |
| **C1** | Picovoice Porcupine + custom "Hey Atlas" model | ✅ Scaffold — see `docs/WAKE_WORD.md` for `.ppn` + AccessKey |
| **C2** | Low-power idle: Porcupine only until wake; then full STT + realtime | CPU/battery acceptable for 30 min foreground session |
| **C3** | Background audio: extend session through one full turn after screen lock | Lock phone mid-reply — audio finishes |
| **C4** | Opt-in UI + privacy copy; Settings → "Always listen for Hey Atlas" | App Review–safe consent flow |
| **C5** | Mac daemon: Porcupine + STT + TTS → APNs to phone | Mac hears wake word → phone gets push |

### Step-by-step (Mac — true 24/7 Jarvis)

| Step | Work | Test |
| --- | --- | --- |
| **C6** | `server/daemon/` — always-on mic on Mac (USB or built-in) | Wake word triggers chief turn |
| **C7** | Spoken response on Mac speakers + transcript log | Full loop without phone |
| **C8** | Proactive briefings (Phase 2 managers) → push + optional Mac TTS | Scheduled morning briefing |

---

## Cross-cutting: long Atlas replies cutting off

Separate from STT — playback/stream finish timeout on very long PCM responses.
Track as **A7** after STT lands: extend `finish()` timeout or chunk-boundary
detection in `AtlasStreamAudioModule.swift`.

---

## Git + release rhythm (per feature)

1. Complete feature steps + tests on Mac (`npm run typecheck`, feature test script).
2. Bump `APP_BUILD_STAMP` in `App.tsx`.
3. `./scripts/build-ios-release.sh` → test on iPhone 15 Pro.
4. **Commit** with message focused on *why* (user asked to commit per feature).
5. Baseline: commit existing Phase 1 voice MVP **before** Feature A if not already done.

---

## Open questions (need your input)

See chat — these gate tuning and scope for B/C.
