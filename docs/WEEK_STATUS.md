# Atlas — Week Status

**Phase 1.5 closed** (2026-06-10). **Phase 1.75** starting.

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
