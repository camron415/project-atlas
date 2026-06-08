# Atlas Roadmap

## Phase 0 — Foundation (mostly complete)

- [x] Create `projects/atlas` repo structure
- [x] Persona prompt preserved in `docs/PERSONA.md`
- [x] Project registry documented
- [x] SQLite schema + migrations
- [x] Project scanner (README/ROADMAP + **deep code inventory**)
- [x] Report cache + refresh on git change / force / deep scan
- [x] Central xAI env in `server/.env`
- [x] Atlas repo registered in `projects.registry.json`

**Exit:** Atlas server lists all projects, deep-scans repos, and serves cached context + manifest.

## Phase 1 — Voice wow MVP (in progress)

- [x] Chief chat API (fast model + cached reports)
- [x] Persona rewrite step before TTS
- [x] xAI Grok Voice realtime output (native AVAudioEngine stream)
- [x] Expo app: chat transcript UI + push-to-talk + continuous mic
- [x] Deep code refresh when user asks for "latest" / context review
- [ ] Mac client first; iPhone connects to Mac server (**Tailscale for remote**)

**Exit:** Voice conversation about VocalLearn, career-dashboard, **and Atlas itself** with honest context manifest.

## Phase 1.5 — Production voice (see `docs/PRODUCTION_VOICE.md`)

Build in order; each feature gets a release build + commit.

- [x] **A — xAI Streaming STT + Smart Turn** (server proxy → native capture → mobile client)
- [x] **B — Speaker diarization + profiles** (who is speaking → personalized chief context)
- [x] **C1 — Foreground wake word** (Porcupine; custom Hey Atlas via `docs/WAKE_WORD.md`)
- [ ] **C5+ — Mac 24/7 wake + iPhone push** (next)

**Build stamp:** `2026-06-08-speakers-wake` — Grok STT + diarization + speaker settings + wake scaffold.

## Phase 2 — Managers + proactive Atlas (days 6–7+)

- [ ] Per-project manager agents
- [ ] Scheduled reports
- [ ] Proactive Mac notifications + spoken briefings
- [ ] iPhone push notifications (tap to hear Atlas)
- [ ] Adaptive model router (fast vs deep)

## Phase 3 — Autonomous workers

- [ ] Task queue with scoped permissions
- [ ] Code worker (branch, fix, test, summarize)
- [ ] VocalLearn visual QA worker (screenshots → vision model → UX fixes)

## iPhone background voice — expectations

| Capability | Mac (24/7 server) | iPhone |
| --- | --- | --- |
| Push-to-talk chat | Yes | Yes (app open) |
| Proactive spoken alerts | Yes | Partial — push notification + audio on open |
| Always-on wake word | Feasible | Very limited on iOS |
| Works with screen off | Server always on | No continuous listening; notification-driven |

Closest to Grok on iPhone: **push alert → tap → Atlas speaks summary**. Full unprompted audio while phone is locked is not reliably achievable for third-party apps.

## Budget guardrails (~$50/mo)

- Chief uses cached reports first
- Fast models by default; vision/deep only for scheduled or approved tasks
- VocalLearn visual QA: weekly batch, not continuous
