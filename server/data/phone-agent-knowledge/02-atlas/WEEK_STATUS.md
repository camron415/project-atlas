# Atlas — Week Status

**Updated:** 2026-08-14. Historical Phase 1.5/1.75 checklist below is archived context.

## Current (Aug 14)

- **Interface:** phone-callable Grok agent (Collection + Mac tools). iOS app is secondary (7-day free signing).
- **Mac:** LaunchAgent `com.atlas.server` on 8787; Funnel live. Do not also run `npm run dev`.
- **Overnight:** 5:50 Atlas brief · 6:00 Sloane + Ellis · 6:20 phone brief → Collection.
- **Career speak queue:** WGU → staffing (ConsultNet / TEKsystems / Robert Half) → iFIT (Logan stretch).
- **Sync:** Cursor / phone / managers dump through `POST /agent/session_close` (hooks + phone tools + 6:00 manager closeout). `GET /agent/where_we_left_off` + `/health.loop` show freshness.

## Phase 1.5 closed

**Phase 1.5 closed** (2026-06-10). **Phase 1.75** complete in docs; Phase 2 managers in progress (see `docs/ROADMAP.md`).

## Current build

`2026-06-10-chat-sessions` — Unified Realtime + ☰ chat history + server `/sessions`

## Phase 1.5 ✅ (closed)

| Item | Status |
| --- | --- |
| Unified Realtime voice (Path B) | ✅ |
| Live captions + single-bubble turns | ✅ |
| Persistent chat sessions | ✅ |
| Speaker profiles + phrase wake | ✅ |
| Shortcuts / Action Button | ✅ |
| Tailscale remote | ✅ |

Details: `docs/PHASE_1_5_CLOSEOUT.md`

## Phase 1.75 🟡 (in progress)

Analyst + inbox for away-from-home planning. **No phone-side coding.**

Roadmap: `docs/PHASE_1_75.md`

| Step | Status |
| --- | --- |
| 1 Inbox format + `POST /inbox` | ⬜ |
| 2 Analyst job runner | ⬜ |
| 3 Job status API | ⬜ |
| 4 Chief tools wiring | ⬜ |
| 5 Mobile status UX | ⬜ |
| 6 Session close template | ⬜ |

## Quick verify

1. Mac: `cd server && npm run dev`
2. iPhone: build `2026-06-10-chat-sessions`
3. ☰ top-left → chats list
4. Voice turn → kill app → reopen → same chat

## Deferred → Phase 2

Mac daemon + push, proactive managers, Porcupine native wake.
