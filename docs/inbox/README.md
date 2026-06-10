# Atlas inbox

Markdown artifacts written at the **end** of planning sessions (Phase 1.75+).

## Purpose

When you're away from home, Atlas chief + analyst discuss projects in voice. At
session close, one file lands here (or in sibling repos) for Cursor to pick up later.

## Layout

```
inbox/
  atlas/
    2026-06-10-phase-175-kickoff.md
  vocallearn/
    2026-06-10-onboarding-flow-review.md
  career/
    2026-06-10-dashboard-priorities.md
```

## File format

See `docs/PHASE_1_75.md` — inbox markdown template.

## Rules

- **One file per closed topic** — not one per chat line
- Analyst findings included when a review ran that session
- Safe to commit; no secrets (API keys stay in `server/.env`)
