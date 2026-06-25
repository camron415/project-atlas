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

## Phase 1 — Voice wow MVP ✅

- [x] Chief chat API (fast model + cached reports)
- [x] Persona rewrite step before TTS
- [x] xAI Grok Voice realtime output (native AVAudioEngine stream)
- [x] Expo app: chat transcript UI + push-to-talk + continuous mic
- [x] Deep code refresh when user asks for "latest" / context review
- [x] iPhone → Mac server via Tailscale (remote voice)

**Exit:** Voice conversation about VocalLearn, career-dashboard, **and Atlas itself** with honest context manifest.

## Phase 1.5 — Production voice ✅

See `docs/PHASE_1_5_CLOSEOUT.md` and `docs/VOICE_PHASE4.md`.

- [x] **Unified Realtime** (Path B) — default release build
- [x] **A/B** — Grok STT + speaker profiles (fallback paths retained)
- [x] **C** — phrase wake, shortcuts, background audio, Live Activity
- [x] **Chat sessions** — ☰ history, resume after app kill

**Build stamp:** `2026-06-10-chat-sessions`

## Phase 1.75 — Analyst + inbox ✅

See `docs/PHASE_1_75.md`. Analyst jobs, chief tools, inbox writes, chat sessions.

**Build stamp:** `2026-06-10-phase-175` (Realtime path) · economy stable: `2026-06-12-return-economy` (`docs/MILESTONE_2026-06-12-economy-stable.md`)

## FT3 Voice economy ✅

Cheap road mode: Grok STT → `/voice/plan-turn` → server TTS. See `docs/VOICE_ECONOMY.md`.

**Autonomy v0:** Morning brief scheduler (`ATLAS_MORNING_BRIEF=1`).

## Phase 2 — Managers + proactive Atlas (in progress)

**Kickoff:** `docs/PHASE_2_KICKOFF.md` (research + execution waves)

- [x] Wave 0 — cost ledger, provider interface, launchd 24/7
- [x] Wave 1 — VocalLearn manager + daily inbox
- [ ] Wave 2 — morning brief expansion + Mac notifications
- [ ] Wave 3 — broke alerts (tests / CI)
- [ ] Wave 4 — Career manager
- [ ] Wave 5 — scale, iPhone push, optional briefing Realtime
- [ ] Adaptive model router (multi-provider for text tasks)

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
