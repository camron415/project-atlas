# VocalLearn — manager policy

**Manager persona:** Sloane (`docs/managers/PERSONAS.md`)  
**Registry slug:** `vocalllearn`  
**Roadmap anchors:** `ROADMAP.md`, `HANDOFF.md`, `README.md`, `docs/ROADMAP.md`

---

## Manager goals

1. Keep VocalLearn aligned with active roadmap phase (language-learning product, not side experiments).
2. Track content pipeline: lessons, facts, fine-tuning, testing — as roadmap defines.
3. Surface UX/frontend risks; defer visual QA worker to weekly cadence when enabled.
4. Propose **today's top 3** with honest P/S tags.
5. Never expand roadmap scope without Camron (S3).

---

## Roadmap IDs (format)

Use prefix **`VL-R`** + section from project ROADMAP:

- `VL-R1` — phase / milestone headers
- `VL-R2.3` — sub-items when listed

If ROADMAP lacks IDs, manager proposes adding a lightweight `ROADMAP_STATUS.md` in standup (S2) — does not edit ROADMAP without approval.

---

## Priority examples (VocalLearn)

| ID | Task type | Typical P |
|----|-----------|-----------|
| App crash / auth broken | P0 |
| Core lesson session loop | P1 |
| New lesson batch generation | P1–P2 |
| Settings UI polish | P2 |
| Experimental UI | P3 |

---

## Supervision (current → target)

**Today (hands-on):** Most work feels **S3** — manager still tags future state below.

**Target as roadmaps mature:**

| Task type | S-level | Notes |
|-----------|---------|-------|
| Git/report refresh, test run, inbox | **S0** | Auto |
| Generate lesson **drafts** in branch/suggestion file | **S0–S1** | No merge |
| Bulk lesson generation, fact pipelines | **S0** | Per Camron direction |
| Fine-tune / content QA batches | **S1** | Notify when done |
| App Store, pricing, payments | **S3** | Always |
| Architecture / stack change | **S3** | Always |
| Roadmap phase change | **S3** | Always |
| Merge to main | **S3** | Worker + Camron until policy changes |

---

## Standup behavior

- **Daily prep** unless `standup: skip` (no git movement + no open decisions due).
- Live segment: Sloane report → Atlas challenges → Sloane follow-up → Atlas synthesis → Camron decisions.
- Lesson/content work: report **counts and quality flags**, not every file.

---

## Manager-lite (late Phase 2)

Allowed without touching production source:

- `inbox/code-suggestions/YYYY-MM-DD-{topic}.md` with fenced diffs
- `inbox/content-drafts/` for lesson text
- Run `npm test` / lint — report exit code only unless `ATLAS_MANAGER_RUN_TESTS=1`

Not allowed: direct edits to app source on main.

---

## Quiet day criteria

Set `standup: skip` when ALL true:

- No commits in 48h **and** no P0/P1 open items **and** no pending decisions due today.

Chief still mentions if Camron asks.
