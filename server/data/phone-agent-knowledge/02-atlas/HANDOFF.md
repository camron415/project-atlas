# Atlas — Full Session Handoff

**Created:** 2026-06-07  
**Purpose:** Preserve the full planning conversation, decisions, and build instructions before switching to a fresh Cursor workspace with Claude Opus for Phase 1.

---

## Executive summary

Atlas is Camron's personal **voice-first chief assistant** — Jarvis-*inspired* in tone and behavior, **not** a voice clone. It sits above department managers and worker agents, giving voice/text access to all local projects from a Mac that runs 24/7.

**First wow moment:** Voice-to-voice conversation about real project status (VocalLearn, career dashboard, etc.) using cached reports — not autonomous bug-fixing yet.

**Budget target:** ~$50/month API usage (Cursor Pro $20 is separate for hands-on coding).

**Wake phrase:** "Hey, Atlas" (custom name — not "Jarvis" for legal/branding reasons).

---

## Vision (long-term)

```
Camron (voice/text)
    → Atlas Chief Assistant
    → Persona text filter (Jarvis-inspired tone)
    → xAI Grok Voice Fast + stock voice (Ara)
    → Cached project reports + live repo reads when needed
    → Department Managers (per project)
    → Worker Agents (code, research, test, visual QA)
    → Local Git repos
```

Atlas is the **interface layer**. Lower agents work autonomously on roadmaps. Cursor remains the IDE for hands-on work; the orchestrator runs separately 24/7 on the MacBook.

---

## Key decisions (from planning conversation)

| Topic | Decision |
| --- | --- |
| Repo | **New dedicated repo** at `~/Documents/Macbook-Documents/projects/atlas` |
| Old `jarvis-ai` | **Trash/scrap** — was empty VS Code extension scaffold only |
| Voice clone | **No** — legal reasons; use xAI stock voice + persona text filter |
| Voice dataset | **No** — do not use archived Jarvis audio |
| Chief name | **Atlas** — wake phrase "Hey, Atlas" |
| Interface | Voice-first; simple chat transcript UI (user message + Atlas reply), push-to-talk for now |
| GUI | No menu bar app — chatbot-style like GPT/Grok |
| Phone | Mac first; iPhone ASAP on same WiFi; Tailscale later for remote |
| Wake word | Desired later on Mac; **not Phase 1** |
| Proactive alerts | Yes — Atlas should notify without prompt ("Sir, there seems to be an issue…") — **Phase 2** |
| Project discovery | Auto-refresh on git changes + scheduled manager reports |
| Folder layout | Consolidate under `~/Documents/Macbook-Documents/projects/` over time |
| Approvals | **Auto-allow everything for now** (hands-on phase) |
| Financial advisor | Placeholder only — planning chat, no repo yet |
| xAI | Has API key; patterns exist in VocalLearn |
| Server | MacBook 24/7 as local server; cloud later when scaled |
| Cursor | Stays as IDE; orchestrator is separate background service |

---

## Registered projects

| Priority | Project | Status | Current path |
| ---: | --- | --- | --- |
| 1 | **VocalLearn** | Active | `~/Documents/Macbook-Documents/vocalLearn` |
| 2 | **Career dashboard** | Active | `~/Documents/career-planning-roadmap/career-dashboard` |
| 3 | **Financial advisor** | Placeholder | Not built |
| — | **Poly-bot** | Archived | `~/Documents/Macbook-Documents/poly-bot` |

**Target layout (gradual migration):**

```
~/Documents/Macbook-Documents/projects/
├── atlas/                          ← this repo
├── vocalLearn/                     ← migrate from parent folder
├── career-planning-roadmap/
│   └── career-dashboard/
└── ...
```

See also: `projects.registry.json` and `docs/PROJECT_REGISTRY.md`.

---

## VocalLearn special worker (Phase 3)

**Visual QA agent** — documented for future, disabled in registry for now:

1. Capture screenshots of key UI flows (simulator, Maestro, or E2E)
2. Store under `atlas/data/screenshots/vocallearn/{date}/`
3. Send to a **vision-capable model** with UX goals from ROADMAP
4. Output prioritized UI/UX improvements
5. Optional: code worker implements → re-screenshot to validate

**Cadence:** weekly (not per-commit) — vision models are expensive.

See `docs/AGENTS.md` for full spec.

---

## Persona filter (preserve verbatim)

Atlas style is applied at the **text layer** before TTS. Canonical prompt — do not paraphrase in code:

```text
Rewrite this response in Jarvis style. Use calm, polite, slightly formal wording. Include one short introductory phrase, one clear answer, and one optional question or next-action offer. Avoid slang, keep tone intelligent, and use "sir" when appropriate.
Original:
{raw_response}
```

**Example output:**

> Yes, sir. I have reviewed the data and your portfolio remains within the target risk range. I recommend holding the current position for now. Shall I prepare a more detailed update?

**Behavior rules:** calm, polite, confident, measured pacing, clear phrasing, short intro + concise answer + optional next step, avoid slang.

Full doc: `docs/PERSONA.md`

---

## Adaptive reasoning model strategy

| Mode | When | Model tier | User experience |
| --- | --- | --- | --- |
| **Fast** | Greetings, status, cached reports | xAI fast / Haiku-class | Instant voice reply |
| **Standard** | Planning chat, summarizing known context | Grok fast / Sonnet-class | Brief "one moment, sir…" |
| **Deep** | Code review, strategy, cross-project decisions | Best reasoning available | Async — notify when done |

**Cost rules (~$50/mo):**

- Chief reads **cached manager reports first**
- Workers use cheap models + good roadmaps
- Deep/vision models only when task requires it
- VocalLearn visual QA: weekly batch
- Financial analysis (future): 2×/week until repo exists

---

## iPhone background voice — honest expectations

| Capability | Mac (24/7 server) | iPhone |
| --- | --- | --- |
| Push-to-talk (app open) | Yes | Yes — Phase 1 |
| Chat transcript UI | Yes | Yes — Phase 1 |
| Proactive alert → tap → Atlas speaks | Yes — Phase 2 | Yes — Phase 2 (push notification) |
| Unprompted speech while phone locked | Yes (server) | **Partial** — notification-driven, not always-on speaker |
| "Hey Atlas" wake word, screen off | Feasible on Mac — later | **Very unlikely** for third-party iOS apps |

**Closest to Grok on iPhone:** push notification → user taps → Atlas plays briefing. Mac handles unprompted spoken alerts first.

---

## Network configuration

| Setting | Value |
| --- | --- |
| Mac LAN IP | `10.0.0.84` |
| Server port | `8787` |
| Public URL | `http://10.0.0.84:8787` |
| Health check | `http://10.0.0.84:8787/health` |
| Mac localhost | `http://127.0.0.1:8787` |
| iPhone (same WiFi) | `http://10.0.0.84:8787` |

**Config files:**

- `server/.env` — `ATLAS_LAN_IP`, `ATLAS_PUBLIC_URL` (key is here, gitignored)
- `config/network.json` — shared client config
- `apps/mobile/.env.example` — `EXPO_PUBLIC_ATLAS_SERVER_URL`

If Mac IP changes, update all three.

**Verify from iPhone Safari:** open `http://10.0.0.84:8787/health` — should return `{ "ok": true, "url": "http://10.0.0.84:8787" }`.

---

## Repo structure (current)

```
atlas/
├── README.md
├── docs/
│   ├── HANDOFF.md              ← this file
│   ├── PERSONA.md
│   ├── PROJECT_REGISTRY.md
│   ├── ROADMAP.md
│   └── AGENTS.md
├── config/
│   └── network.json
├── projects.registry.json
├── server/                     ← Node.js orchestrator
│   ├── .env                    ← secrets (gitignored, already configured)
│   ├── .env.example
│   ├── data/atlas.db           ← SQLite
│   └── src/
│       ├── index.ts            ← Express API
│       ├── db/schema.ts
│       ├── chief/respond.ts
│       ├── persona/filter.ts
│       ├── projects/registry.ts
│       ├── projects/scanner.ts
│       ├── reports/store.ts
│       ├── xai/client.ts
│       └── cli/
├── apps/
│   └── mobile/.env.example     ← Phase 1 Expo app goes here
└── .gitignore
```

---

## Phase 0 status — COMPLETE (~100%)

| Item | Status |
| --- | --- |
| Repo created | Done |
| Persona prompt preserved | Done — `docs/PERSONA.md` |
| Project registry | Done — VocalLearn, career, financial placeholder, poly-bot archived |
| VocalLearn visual QA spec | Done — `docs/AGENTS.md` |
| SQLite schema | Done — projects, reports, tasks, conversation_log |
| Project scanner | Done — reads README/ROADMAP, git HEAD |
| Report cache | Done — both active projects seeded |
| Persona filter module | Done — `server/src/persona/filter.ts` |
| Chief chat API | Done — `POST /chat`, `POST /chat/voice` |
| xAI client | Done — chat + TTS via `/tts` endpoint (Ara voice) |
| CORS for mobile | Done |
| `.env` with xAI key | Done (not committed) |
| LAN IP configured | Done — `10.0.0.84` |
| Server verified | Done — `/health` returns ok |

**CLI commands (from `server/`):**

```bash
npm install
npm run dev              # start server on 0.0.0.0:8787
npm run scan             # scan registered projects
npm run refresh-reports  # rebuild cached reports
npm run typecheck
```

**API endpoints:**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Server status + public URL |
| GET | `/projects` | Registered active projects |
| GET | `/reports` | Latest cached project reports |
| POST | `/reports/refresh` | Rescan + refresh reports |
| POST | `/chat` | Text chat → `{ raw, filtered }` |
| POST | `/chat/voice` | Text chat + base64 MP3 TTS audio |

---

## Phase 1 scope — NEXT (Opus session)

**Goal:** Voice-first Atlas MVP — chat transcript + push-to-talk → persona-filtered voice replies about real projects.

**In scope:**

1. Expo app in `apps/mobile/` — Grok/GPT-style transcript, hold-to-talk mic, play TTS audio
2. `EXPO_PUBLIC_ATLAS_SERVER_URL=http://10.0.0.84:8787`
3. Server polish if needed (CORS, errors, audio response)
4. README run instructions for Mac + iPhone on same WiFi
5. Reuse xAI patterns from VocalLearn where useful:
   - `~/Documents/Macbook-Documents/vocalLearn/src/lib/voice.ts`
   - `~/Documents/Macbook-Documents/vocalLearn/src/lib/grok.ts`

**Out of scope (do not build yet):**

- Proactive notifications
- Wake word ("Hey Atlas")
- Department managers / worker agents
- Autonomous bug fixing
- Visual QA screenshot pipeline
- Approval inbox
- Tailscale / remote access
- Folder migration (repos stay at current paths for now)

**Acceptance criteria:**

- [x] Hold button → ask "What's the status of VocalLearn?" → see transcript → hear Atlas reply in persona voice
- [x] Answers use cached reports from `server/data/atlas.db`
- [x] Works on Mac; iPhone on same WiFi hits `10.0.0.84:8787`
- [x] `npm run dev` + `expo start` documented in README

**Phase 1 build notes (Opus session):**

- Expo app in `apps/mobile/` (SDK 54). Entry `index.ts` → `App.tsx`; modules in `src/` (`config.ts`, `api.ts`, `audio.ts`, `speech.ts`).
- Push-to-talk uses **on-device STT** (`expo-speech-recognition`) since the server only does text→audio. Requires a dev build (`npx expo run:ios`), not Expo Go. A text-input fallback is included for Expo Go / simulator testing.
- TTS playback decodes the base64 MP3 from `/chat/voice` and plays via `expo-av` (pattern borrowed from VocalLearn `voice.ts`).
- `EXPO_PUBLIC_ATLAS_SERVER_URL` configures the server URL (default `localhost:8787`; `.env` ships with the LAN IP for iPhone).
- Server polish: TTS failure is now non-fatal (returns text + `audioError`); chief context cap raised 3500→6000 chars; VocalLearn `roadmapFiles` reordered so the current README/HANDOFF lead the context (ROADMAP self-describes as historical).
- Verified: `/health`, `/chat`, `/chat/voice` all return correctly; VocalLearn status answer is persona-styled with a ~400 KB MP3.

---

## Phase 2+ (future — do not start in Opus session)

**Phase 2:** Managers, scheduled reports, proactive Mac/iPhone alerts, adaptive model router, approval inbox.

**Phase 3:** Task queue, autonomous code workers, VocalLearn visual QA pipeline, financial advisor repo.

See `docs/ROADMAP.md`.

---

## Opus Phase 1 prompt (copy-paste as first message)

```text
Workspace: ~/Documents/Macbook-Documents/projects/atlas

Read docs/HANDOFF.md first for full context.

Complete Phase 1 MVP only. Do not start Phase 2/3.

Goal: voice-first Atlas assistant — chat transcript UI + push-to-talk that talks to the existing server and returns persona-filtered voice replies about my real projects.

Existing context:
- Server already at server/ with SQLite reports, project scanner, persona filter, POST /chat and POST /chat/voice
- Persona prompt is canonical in docs/PERSONA.md — preserve verbatim
- projects.registry.json registers VocalLearn + career-dashboard
- Reuse xAI patterns from ~/Documents/Macbook-Documents/vocalLearn/src/lib/voice.ts and grok.ts where useful
- LAN server URL: http://10.0.0.84:8787 (see config/network.json)
- Budget ~$50/mo — prefer cached reports, fast models by default
- Approval: auto-allow everything for now

Build:
1. Expo app in apps/mobile/ — simple Grok/GPT-style transcript (user message, Atlas reply), hold-to-talk mic button, play returned TTS audio
2. EXPO_PUBLIC_ATLAS_SERVER_URL=http://10.0.0.84:8787
3. Polish server if needed (CORS, audio response headers, error handling)
4. README section: how to run server + app on Mac and connect iPhone on same WiFi
5. Keep changes focused; no proactive notifications, no wake word, no workers yet

Acceptance criteria:
- I can hold button, ask "What's the status of VocalLearn?", see transcript, hear Atlas reply in persona voice
- Answers use cached project reports from server/data/atlas.db
- npm run dev in server/ + expo start in apps/mobile/ is documented

Move agent to atlas root first, then implement. Run typecheck and verify endpoints work.
```

---

## Reusable code references

**VocalLearn xAI integration (patterns to borrow):**

- TTS: `POST https://api.x.ai/v1/tts` with `{ text, voice_id: "ara", language: "en" }`
- Chat: `POST https://api.x.ai/v1/chat/completions`
- Files: `vocalLearn/src/lib/voice.ts`, `vocalLearn/src/lib/grok.ts`

**Atlas server persona + chief:**

- `server/src/persona/filter.ts` — canonical prompt string
- `server/src/chief/respond.ts` — loads cached reports, calls xAI, applies persona
- `server/src/xai/client.ts` — chat + TTS wrappers

---

## Security notes

- xAI API key is in `server/.env` (gitignored) — **never commit**
- Key was shared in a Cursor chat — **consider rotating** in xAI dashboard
- No custom voice training data stored or used

---

## Troubleshooting (from this session)

**Agent tool interruptions:** Long-running MCP calls (especially `move_agent_to_root`) timed out repeatedly. Workaround:

1. Open folder manually: `File → Open Folder` → `~/Documents/Macbook-Documents/projects/atlas`
2. Start fresh agent chat
3. Avoid relying on MCP workspace move

**Report refresh bug (fixed):** First run of `refresh-reports` could skip seeding if git HEAD was already synced. CLI now seeds when no report exists.

---

## Timeline

| Phase | Target | Status |
| --- | --- | --- |
| Phase 0 — Foundation | Week 1, days 1–2 | **Done** |
| Phase 1 — Voice wow MVP | Week 1, days 3–5 | **Next (Opus)** |
| Phase 2 — Managers + alerts | Week 1–2 | Planned |
| Phase 3 — Autonomous workers | Week 2–3 | Planned |

---

## Quick start (before Opus session)

```bash
# Terminal 1 — server
cd ~/Documents/Macbook-Documents/projects/atlas/server
npm run dev

# Verify
curl http://127.0.0.1:8787/health
# iPhone Safari: http://10.0.0.84:8787/health

# Terminal 2 — after Phase 1 built
cd ~/Documents/Macbook-Documents/projects/atlas/apps/mobile
cp .env.example .env
npx expo start
```

---

*End of handoff. Open this repo in Cursor, start fresh Opus chat, paste the Phase 1 prompt above.*
