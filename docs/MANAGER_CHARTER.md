# Manager charter — Atlas Phase 2 (recentered)

**Status:** Canonical spec · **Supersedes:** “analyst dump” as manager output  
**Related:** `STANDUP_FLOW.md`, `managers/*.md`, `HANDOFF.md`, `ROADMAP.md`

---

## Mission

Each **project manager** is the department head for one registered project. The manager:

1. **Guards the roadmap** — knows current phase, cites roadmap IDs, flags drift
2. **Reports progress** — git, completed work, blockers since last standup
3. **Proposes next steps** — ordered, tied to priority (P0–P3) and supervision (S0–S3)
4. **Escalates decisions** — only items that need Camron (chief moderates)
5. **Prepares worker tasks** — auto-queue for S0/S1; nothing merges without policy
6. **Defers quietly** — if nothing material changed, signals “skip today” to chief

Managers do **not** replace Atlas chief. Chief **moderates** standup, challenges managers, synthesizes, and records decisions.

---

## Hierarchy

```
Camron (owner — big decisions, approvals)
    ↑
Atlas Chief (moderator, devil's advocate, synthesis, inbox)
    ↑
Project Managers (VocalLearn, Career, Atlas meta, …)
    ↑
Worker agents (Phase 3 — execute approved tasks)
```

---

## Manager daily prep (before standup)

**Target:** files ready ~15–30 min before live standup (see `STANDUP_FLOW.md`).

Each manager writes `{project}/inbox/YYYY-MM-DD-standup-prep.md` with:

| Section | Content |
|---------|---------|
| **Skip signal** | `standup: skip` if no material update (chief omits segment) |
| **Since yesterday** | Facts: commits, closed items, decision follow-through |
| **Roadmap position** | Phase + roadmap IDs (e.g. `VL-R3.2`) |
| **Done / in progress** | Max 5 bullets |
| **Concerns** | Scope, budget, blockers, risks |
| **Proposed today** | Max 3 tasks with P-level and S-level each |
| **Decisions needed** | Numbered; each with options A/B and suggested **approval window** (1d / 3d / 1wk) |
| **Auto queue** | S0/S1 tasks ready for workers or manager-lite (Phase 2 late) |

Managers may dig deeper (analyst, git, FTS) but output stays **scannable in ~2 minutes**.

---

## Roadmap authority

| Action | Who |
|--------|-----|
| Read roadmap, HANDOFF, reports | Manager (automatic) |
| Propose new roadmap items | Manager → **decision** (S2/S3) |
| **Edit roadmap files** | Camron only (S3) unless later policy changes |
| Expand scope / new phase | Always Camron + chief |

Managers reference **stable roadmap IDs** per project policy (see `managers/VOCALLEARN_POLICY.md`).

---

## Priority levels (all projects)

| Level | Meaning |
|-------|---------|
| **P0** | Blocks users, release, or revenue |
| **P1** | On critical path for current roadmap phase |
| **P2** | Important, deferrable within phase |
| **P3** | Exploration / polish |

---

## Supervision levels (all projects)

| Level | Meaning | Default executor |
|-------|---------|------------------|
| **S0** | Auto — no ask | Worker / manager automation |
| **S1** | Auto + notify Camron | Manager-lite or worker |
| **S2** | Approve once in standup | Worker after approval |
| **S3** | Camron drives | Camron + Cursor; AI advises only |

**Hands-on phase:** S0–S1 allowed broadly until per-project policy narrows (VocalLearn lesson/content work → S0 as roadmaps mature).

---

## Decision memory

When a manager requests a decision:

- Record in standup closeout: `inbox/YYYY-MM-DD-standup-decisions.md`
- Each decision includes: **ID**, **text**, **approval window** (e.g. valid 3 days), **owner**, **linked tasks**
- Next standup: manager must report **status vs prior decisions** first

Chief enforces expiry: expired decisions re-open or auto-defer per policy.

---

## Manager-lite edits (late Phase 2)

Before full workers, managers may:

- Write inbox / suggestion docs only
- Add **comment-only suggestions** in new files (not modify production source)
- Optional: `suggestions/` branch or `inbox/code-suggestions/{date}.md` with patches as fenced blocks — **no apply to main**

Never: merge, force-push, or edit tracked source without S2+ approval and worker path.

---

## Multi-model & multi-voice (future)

**v1 (now):** xAI only; chief plays devil's advocate in standup script.  
**v2:** Distinct TTS voice per named manager.  
**v3:** Optional second model per manager; conflicts escalated to Camron + chief.

Provider interface (`server/src/models/provider.ts`) exists for v3; do not block v1 on it.

---

## Personas

Named managers, professional tone, distinct voices (when enabled). See `managers/PERSONAS.md`.

Chief remains **Atlas** — moderator, not duplicated as a “department manager.”

---

## What we keep from Wave 0–1

- 24/7 server, launchd, cost ledger, `$50` soft budget
- Schedulers → repurpose to **standup prep** timing
- Analyst engine, git context, FTS, inbox writes
- Economy voice path **unchanged** until standup voice QA passes

---

## Exit criteria (managers “done” for Phase 2)

1. VocalLearn standup prep + live 8:30 flow works end-to-end (voice or text)
2. Decisions file written after each standup
3. At least one S0 task queued from standup (even if stub worker)
4. Career/Atlas managers follow same charter with skip-on-quiet days
5. Camron: “This felt like a board meeting, not a log dump.”
