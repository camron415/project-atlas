# Agent Specifications

## Chief — Atlas

- Voice-first interface triggered by "Hey, Atlas" (wake word on Mac later)
- Reads cached manager reports before calling expensive models
- Applies persona filter before TTS
- Escalates to deep reasoning only when conversation requires it

## VocalLearn Manager

Generates daily summaries from:

- `ROADMAP.md`, `HANDOFF.md`, git log (via `getGitRecentContext`)
- Analyst deep scan with manager-specific focus
- Optional `npm test` when `ATLAS_MANAGER_RUN_TESTS=1`
- Writes `vocalLearn/inbox/YYYY-MM-DD-manager.md`

**CLI:** `npm run manager -- vocallearn` or `./scripts/manager.sh vocallearn`

**Schedule:** `ATLAS_MANAGER=1`, default 7:15 AM local (after morning brief).

### VocalLearn Visual QA Worker (future)

**Goal:** Improve frontend UX with evidence, not guesswork.

**Pipeline:**

1. Capture screenshots of key flows (home, session, subjects, settings)
   - iOS Simulator via `xcrun simctl io booted screenshot`
   - Or Maestro/Detox capture during E2E runs
2. Store snapshots under `atlas/data/screenshots/vocallearn/{date}/`
3. Send images + current ROADMAP UX goals to a **vision-capable model**
4. Output: prioritized UI issues, suggested component changes, accessibility notes
5. Optional: implement via code worker + re-screenshot diff for validation

**Cost tier:** heavy / vision — run **weekly**, not per commit.

**Approval:** auto-allow during hands-on phase; later gate large UI refactors.

## Career Manager

- Daily inbox summary (top roles, prep gaps, resume packet status)
- Trigger ingestion worker on schedule

## Financial Manager

- Placeholder until repo exists
