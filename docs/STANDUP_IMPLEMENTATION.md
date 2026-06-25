# Standup implementation (v1)

**Build stamp:** `2026-06-26-standup-v1` (mobile)

## Chief memory (unified Atlas)

Atlas chief is **one agent** — moderator in standup and assistant in normal chat.

- `buildStandupMemoryBlock()` injected into `/chief/session` instructions and `/chat`
- Economy voice (`/voice/plan-turn`) always includes standup memory + optional moderator mode
- FTS auto-refreshes when inbox files are written (`writeInboxArtifact` + `db`)

## API

| Route | Purpose |
|-------|---------|
| `GET /standup/status` | Prep ready? standup active? |
| `POST /standup/begin` | Start standup window; writes agenda; refreshes FTS |
| `POST /standup/end` | Close standup; write decisions file |

## Mobile

☰ drawer → **Start standup** (when prep exists) → **End standup**

Economy voice sends `standupMode: true` while standup active.

## Manager prep

`./scripts/manager.sh vocallearn` → `vocalLearn/inbox/YYYY-MM-DD-standup-prep.md`

## Decision default

**1 day** approval window; re-ask if expired.

## Future

- Mac notification at prep ready (Wave 2)
- Distinct TTS voices per manager (v2)
- Multi-model managers (v3)
