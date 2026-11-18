# Atlas personal context pack

**Synced:** 2026-10-29 (America/Denver)  
**Purpose:** Private knowledge bundle for Project Atlas / VocalLearn phone agent wiring. Kept **outside** app source (`src/`, `app/`) so it does not interfere with builds or releases.

**GitHub:** `camron415/vocallearn` → directory `atlas-personal-context/`  
**Canonical sources on disk:**

| Bundle folder | Local source repo |
|---------------|-------------------|
| `career-planning-roadmap/` | `/Users/camrontrost/Documents/career-planning-roadmap` |
| `our-story-journey/` | `/Users/camrontrost/Documents/our-story-journey` |

## Start here (for agents)

1. **Who Camron is (interviews / pitch):** `career-planning-roadmap/career-dashboard-docs/MY_STORY.md`
2. **Long-form background & build history:** `career-planning-roadmap/project-foundation.md`, `conversation-log.md`, `back-from-cloud-handoff.md`
3. **Resume truth (structured):** `career-planning-roadmap/career-dashboard-lib/resume-data.ts`, `resume-packets.ts`
4. **Job search ops & notes:** `career-planning-roadmap/career-dashboard-docs/`, `inbox-md/`, `ellis-board.json`
5. **Marriage / life narrative (Camron + Camila):** `our-story-journey/CONTENT.md` (full dump), curated stops in `our-story-journey/src-data/journey.ts`
6. **Site copy / events:** `our-story-journey/EVENTS.md`, `HANDOFF.md`
7. **Atlas voice — cost & wiring (Nov 2026):** `voice-notes/README.md` → `COST-CHECK-2026-11-04.md`, `CHEAP-BRAIN-WIRING.md`, `TRANSCRIPT-DIGEST-2026-11-02-04.md`

## What is intentionally omitted

- **Career repo:** `.eml` job alerts, SQLite DBs, `node_modules`, generated apply DOCX/HTML (markdown briefs kept under `career-dashboard-docs/apply-materials/`)
- **Immigration:** `intake.json`, filled PDFs, and `.venv` (PII / local tooling); markdown guides and helper scripts are included
- **VocalLearn app code:** unchanged — this folder is additive only

## Re-sync

Re-copy from the two source paths above into `atlas-personal-context/`, commit, and push to `main` on `vocallearn`. Update `MANIFEST.json` file count and date.
