# Project Registry

Atlas discovers and monitors registered projects from this manifest. Paths will consolidate under `~/Documents/Macbook-Documents/projects/` over time.

## Active projects

### VocalLearn (priority 1)

- **Slug:** `vocalllearn`
- **Current path:** `/Users/camrontrost/Documents/Macbook-Documents/vocalLearn`
- **Target path:** `/Users/camrontrost/Documents/Macbook-Documents/projects/vocalLearn`
- **Roadmap files:** `ROADMAP.md`, `HANDOFF.md`, `README.md`
- **Manager cadence:** daily report
- **Special worker tasks:**
  - **Visual QA agent** — capture frontend screenshots (simulator/device), feed to a vision-capable model, propose UI/UX improvements, and validate changes where possible (Maestro/detox or manual snapshot diff). Uses a heavier model tier only for this task.

### Career dashboard (priority 2)

- **Slug:** `career-dashboard`
- **Current path:** `/Users/camrontrost/Documents/career-planning-roadmap/career-dashboard`
- **Target path:** `/Users/camrontrost/Documents/Macbook-Documents/projects/career-planning-roadmap/career-dashboard`
- **Roadmap files:** `README.md`
- **Manager cadence:** daily report

### Financial advisor (priority 3 — placeholder)

- **Slug:** `financial-advisor`
- **Status:** not built — planning chat only
- **Manager cadence:** none until repo exists

## Archived

### Poly-bot

- **Slug:** `poly-bot`
- **Path:** `/Users/camrontrost/Documents/Macbook-Documents/poly-bot`
- **Status:** inactive / archived

## Refresh triggers

1. Scheduled manager reports (daily / weekly per project)
2. Git change detection (local commit or push webhook later)
3. Manual refresh via Atlas API
