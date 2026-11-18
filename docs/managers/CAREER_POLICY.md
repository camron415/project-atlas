# Career dashboard — manager policy (Ellis)

**Registry slug:** `career-dashboard`  
**Status:** Daily apply pipeline (overnight ingest → morning report → packet → submit)

---

## Manager goals

1. **Every night / before standup:** run live ingest + write `inbox/YYYY-MM-DD-apply-report.md`.
2. Surface **new** and **top local/junior** roles for Camron to apply the same day.
3. On confirm, generate resume/cover packet under `public/resume-exports/applications/`.
4. Track applied roles so they drop off the priority list (`server/data/career/applied-roles.json`).
5. Track closed / not-accepting listings (`server/data/career/closed-listings.json`) and **live-check** top URLs before suggesting.
6. **Gmail job alerts:** pull LinkedIn/Indeed emails from label `JobAlerts` → parse → score with the rest.

---

## Supervision

| Task | S-level |
| --- | --- |
| Overnight ingest + apply report | S1 (auto when `ATLAS_CAREER_INGEST=1`) |
| Gmail IMAP job-alert pull | S1 (needs `JOB_ALERT_*` in career-dashboard `.env.local`) |
| Generate packet for chosen role | S2 (CLI / phone tool after Camron confirms) |
| Submit application / Easy Apply | S3 (Camron only) |
| Mark applied | S2 (CLI or phone tool) |
| Mark listing closed / not accepting | S2 (`npm run mark-applied -- "Company" --closed`) |
| Live-check top URLs before suggest | S1 (part of `apply:report`) |

---

## Daily loop

1. ~6:00 — Ellis runs `daily:apply` (alerts + boards + report) when ingest enabled  
2. Camron reads report (Mac) or hears board pulse (phone)  
3. Confirm 1–3 roles → `npm run generate-packet` / `POST /agent/generate_packet`  
4. Apply at the URL with `resume.pdf` + `cover-letter.pdf`  
5. `npm run mark-applied -- "Company" --role "Title"`

## LinkedIn / Gmail

See `career-dashboard/docs/JOB_ALERT_PIPELINE.md`.

1. Tighten LinkedIn/Indeed **job alerts** (daily, SLC junior/FE).  
2. Gmail filter → label **`JobAlerts`** (skip inbox).  
3. Google **App Password** → `career-dashboard/.env.local` as `JOB_ALERT_EMAIL` + `JOB_ALERT_APP_PASSWORD`.  
4. Overnight Mac with Atlas server up pulls unread mail, parses listings, dedupes vs Greenhouse, scores, morning report.

No LinkedIn login scrape — email alerts are the warm-lead lane.
