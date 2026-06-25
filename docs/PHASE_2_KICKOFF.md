# Phase 2 Kickoff — Research, Plan, and Execution Waves

**Created:** 2026-06-25  
**Prerequisite:** Economy voice stable (`backup/2026-06-12-return-economy`)  
**User priorities:** VocalLearn manager first → Career → Atlas · Morning brief → broke alerts → opportunities · Mac 24/7 · $50/mo now → $100/mo when optimized

---

## Executive summary

Phase 2 turns Atlas from **reactive voice** into **proactive project staff**: scheduled managers write inbox reports, Mac notifies you, chief reads them on demand. We build on morning-brief v0 and analyst — no changes to fragile economy voice/STT/session paths until each wave is tested.

**Deferred:** Per-turn Realtime speak optimization (FT3 hybrid) — revisit after manager + notification loop is stable.

---

## Part 1 — Research findings

### 1.1 Current Atlas AI stack (baseline)

| Layer | Today | Notes |
| --- | --- | --- |
| **Provider** | xAI only | `server/src/models/router.ts` |
| **Chief / voice economy** | `grok-4-fast-non-reasoning` | plan-turn + tools |
| **Deep / planning** | `grok-4-fast-reasoning` | user toggle or intent |
| **Analyst / morning brief** | `grok-4-fast-non-reasoning` | ~88k context slice, 1600 max tokens out |
| **Scan synthesis** | `grok-4-fast-non-reasoning` | deep inventory |
| **STT (economy build)** | Grok STT | no Apple fallback |
| **Speak (economy build)** | Server TTS (`/tts`) | **no Realtime WS** |
| **Context** | SQLite reports + FTS | `search_context` before web |
| **Cost tracking** | None | gap — Wave 0 |

### 1.2 Model market (June 2026 — verify before production)

Prices are per **million tokens** (input / output). Third-party aggregators; confirm on provider sites before switching.

| Tier | Model (examples) | Input | Output | Atlas fit |
| --- | --- | --- | --- | --- |
| **Floor** | DeepSeek V4 Flash | ~$0.14 | ~$0.28 | Analyst summaries, classification (trial) |
| **Budget** | Gemini 2.5 Flash-Lite | ~$0.10 | ~$0.40 | High-volume scheduled reports |
| **Budget** | Grok 4 mini / grok-4-1-fast | ~$0.20–0.30 | ~$0.50 | Stay in xAI ecosystem |
| **Current default** | grok-4-fast-non-reasoning | (xAI list) | (xAI list) | Chief, analyst — already cheap tier |
| **Reasoning** | grok-4-fast-reasoning | higher | higher | Deep toggle only |
| **Voice Realtime** | grok-voice-think-fast | session/min | — | **Avoid** in economy; optional briefing-only later |

**Recommendation for Phase 2:**

1. **Keep xAI** for chief voice, STT, TTS, and tool-calling (one vendor, fewer integration surprises).
2. **Add provider interface** (`server/src/models/provider.ts`) so **analyst + manager text** can A/B DeepSeek Flash or Gemini Flash-Lite on a schedule — not voice paths.
3. **Run a 1-week benchmark** after Wave 1: same VocalLearn morning brief via xAI vs trial provider; compare quality, latency, cost.

Sources: [swfte.com/api-pricing](https://www.swfte.com/api-pricing), [developersdigest](https://www.developersdigest.tech/blog/frontier-model-api-pricing-june-2026) — treat as planning estimates only.

### 1.3 Token efficiency — what we do vs what to add

| Strategy | Status | Phase 2 action |
| --- | --- | --- |
| Cached reports before LLM | ✅ | Managers read cache first |
| FTS `search_context` before web | ✅ | Managers use same index |
| History cap (12 turns) | ✅ | Unchanged for chief |
| `skipPersona` on economy | ✅ | Unchanged |
| Reply length cap (~400 tokens voice) | ✅ | Manager reports can be longer but structured |
| Prompt caching (provider-side) | ❌ | Evaluate when multi-provider lands |
| Context compression (summarize before inject) | ❌ | Wave 1: cap manager context like analyst (88k) |
| Per-task cost ledger | ❌ | **Wave 0** |
| Monthly budget guard ($50) | ❌ | **Wave 0** — soft cap + log warning |
| Structured output (JSON sections) | partial | Manager templates reduce rambling |

### 1.4 Voice path decision (Phase 2)

| Mode | When | Path |
| --- | --- | --- |
| **Road / economy** | Default iPhone build | Grok STT → plan-turn → server TTS (**frozen**) |
| **Proactive Mac briefing** | Notification tapped | Text from inbox → server TTS or optional short Realtime speak (Wave 3+) |
| **Per-turn Realtime** | Later | Revisit FT3 hybrid after managers stable |

**Regression rule:** Phase 2 server work must not change `EXPO_PUBLIC_VOICE_ECONOMY` build flags or `useXaiSttCapture` / `speak-economy-reply.ts` without a dedicated voice regression pass.

---

## Part 2 — Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Mac 24/7 (launchd)                                         │
│  Atlas server :8787                                         │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Scheduler    │  │ Cost ledger  │  │ Notify (Mac)     │  │
│  │ morning/mgr  │  │ $50 soft cap │  │ osascript/APNs   │  │
│  └──────┬───────┘  └──────────────┘  └────────┬─────────┘  │
│         │                                        │           │
│         ▼                                        ▼           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ VocalLearn Manager (Wave 1)                          │  │
│  │  git · roadmap · tests stub · analyst · inbox write   │  │
│  └──────────────────────────────────────────────────────┘  │
│         │                                                    │
│         ▼                                                    │
│  vocallearn/inbox/YYYY-MM-DD-manager.md                     │
│  + FTS index rebuild                                         │
└─────────────────────────────────────────────────────────────┘
         ▲                              │
         │ Tailscale / LAN              │ tap notification
         │                              ▼
┌────────┴────────┐            ┌─────────────────┐
│ iPhone Atlas    │            │ "Read morning   │
│ economy voice   │            │  brief" (chief) │
└─────────────────┘            └─────────────────┘
```

### VocalLearn manager scope (v0)

**Inputs:** `projects.registry.json` → `vocalllearn` path, ROADMAP/HANDOFF, git log, cached report, optional `npm test` / `xcodebuild` exit code (read-only first).

**Outputs:** `vocalLearn/inbox/YYYY-MM-DD-manager.md` (or registry path) with sections:

- Headline / overnight git
- Roadmap position vs HANDOFF
- Test/build status (when hooks exist)
- Top 3 priorities
- Risks / blockers

**Tools (progressive):**

| Wave | Tool | Risk |
| --- | --- | --- |
| 1a | Analyst deep scan + manager template | Low — reuses analyst |
| 1b | `git log` / `git status` subprocess | Low — read-only |
| 1c | `npm test` / lint (read exit code) | Medium — sandbox |
| 1d | Simulator screenshot stub → vision (weekly) | Higher cost — Wave 4+ |

**Registry note:** slug is `vocalllearn` (three L's) in `projects.registry.json` — normalize in manager code.

---

## Part 3 — Execution waves

Each wave: implement → test → brief Camron → tag if stable. **No wave ships without passing regression checklist (Part 4).**

### Wave 0 — Foundation (no voice changes)

**Goal:** 24/7 ops + cost visibility.

| Step | Deliverable |
| --- | --- |
| 0.1 | `server/src/cost/ledger.ts` — log model, task, in/out tokens, estimated USD per call |
| 0.2 | `GET /metrics/cost` — month-to-date summary |
| 0.3 | `ATLAS_MONTHLY_BUDGET_USD=50` soft warning in logs + metrics |
| 0.4 | `server/src/models/provider.ts` — interface + xAI adapter (no behavior change) |
| 0.5 | `scripts/launchd/com.atlas.server.plist` + install doc |
| 0.6 | Extend `/health` — scheduler status, last manager run, cost MTD |

**Exit:** Server survives reboot; you see cost MTD on `/metrics/cost`.

### Wave 1 — VocalLearn Manager

| Step | Deliverable |
| --- | --- |
| 1.1 | `server/src/managers/types.ts` — ManagerRunDeps, ManagerResult |
| 1.2 | `server/src/managers/vocalllearn/run.ts` — daily manager report |
| 1.3 | `server/src/managers/schedule.ts` — cron hook (default 7:15 AM after morning brief) |
| 1.4 | CLI `npm run manager -- vocalllearn` |
| 1.5 | Chief `search_context` picks up new inbox files (existing FTS) |
| 1.6 | Tests for manager run + schedule dedup |

**Exit:** `vocalLearn/inbox/YYYY-MM-DD-manager.md` appears daily when Mac is up.

### Wave 2 — Morning brief + Mac notify

| Step | Deliverable |
| --- | --- |
| 2.1 | Morning brief includes VocalLearn (`ATLAS_MORNING_BRIEF_PROJECTS=atlas,vocalllearn`) |
| 2.2 | `server/src/notify/mac.ts` — `osascript` notification on brief/manager complete |
| 2.3 | Deep link `atlas://brief/today` (optional) |
| 2.4 | Chief prompt: can summarize today's brief on voice request |

**Exit:** You get a Mac notification when morning brief is ready.

### Wave 3 — Something broke

| Step | Deliverable |
| --- | --- |
| 3.1 | `server/src/watch/git-poll.ts` — detect new commits / failed CI file marker |
| 3.2 | VocalLearn test runner hook — on failure → inbox `YYYY-MM-DD-alert.md` + notify |
| 3.3 | Chief honesty: "alert" vs "brief" distinction in tools |

**Exit:** Test failure or marked CI failure generates notification.

### Wave 4 — Career manager (lighter)

| Step | Deliverable |
| --- | --- |
| 4.1 | Career manager v0 — ingest status + top roles from repo |
| 4.2 | Opportunity-style inbox (not push-heavy yet) |
| 4.3 | Multi-provider trial on career summaries only |

### Wave 5 — Scale toward $100/mo

| Step | Deliverable |
| --- | --- |
| 5.1 | Model benchmark doc with real Atlas task samples |
| 5.2 | Atlas self-manager (meta) |
| 5.3 | iPhone push (APNs) — if Mac notify proven |
| 5.4 | Optional briefing Realtime speak (metered) |

---

## Part 4 — Regression contract

**Frozen without explicit voice QA:**

- `apps/mobile/src/useXaiSttCapture.ts` — monologue, `speech_final`, `pauseForPlayback`
- `apps/mobile/src/speak-economy-reply.ts` — single TTS play
- `apps/mobile/src/voice-endpoint.ts` — endpoint timing
- Economy build flags in `scripts/build-ios-release-economy.sh`
- Chat session persistence (`apps/mobile/src/chat-sessions*`)

**Before each wave:**

1. `cd server && npm test` (existing + new tests)
2. Smoke: `curl /health`, `./scripts/morning-brief.sh -- --force` (if schedulers touched)
3. Optional device: economy stamp + one voice turn (after waves touching chief prompts only)

**Git:** Tag `phase2-wave-N` after each stable wave.

---

## Part 5 — Budget envelope ($50/mo)

Rough planning estimates (not yet metered):

| Workload | Frequency | Est. monthly |
| --- | --- | --- |
| Morning brief (deep analyst) × 2 projects | daily | $8–15 |
| VocalLearn manager daily | daily | $5–10 |
| Voice economy road use (~1 hr/day) | daily | $12–20 |
| Chief ad-hoc + web_lookup | variable | $5–10 |
| **Buffer** | | $5 |

**Guards (Wave 0):** ledger + soft cap at $50; deep scans skip if MTD > 80% unless forced.

At $100/mo scaled: add weekly vision QA, career ingest, Atlas self-manager, optional briefing Realtime.

---

## Part 6 — Immediate next steps

**We are here:** Planning recenter complete (`MANAGER_CHARTER.md`, `STANDUP_FLOW.md`). **Next:** Reshape Wave 1 manager output → standup prep; implement standup session (v1 xAI); then Wave 2 notify at 8:30.

---

## Related docs

- `docs/ROADMAP.md` — Phase 2 checklist
- `docs/MILESTONE_2026-06-12-economy-stable.md` — voice baseline
- `docs/AGENTS.md` — manager specs (update as waves land)
- `inbox/2026-06-25-phase-2-kickoff.md` — FTS summary for chief
