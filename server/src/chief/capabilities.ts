/** Live server capabilities — injected into chief instructions so voice knows what exists. */

export function buildServerCapabilities(): string {
  const stamp = process.env.ATLAS_BUILD_STAMP ?? "2026-06-10-phase-175";
  return `## Live Atlas server capabilities (authoritative)
Build stamp: ${stamp}
Phase 1.75 is IMPLEMENTED on this server unless a report explicitly predates it.

Available now:
- Chat sessions: GET/POST/DELETE /sessions (SQLite persistence)
- Inbox writer: POST /inbox, POST /inbox/from-session → {repo}/inbox/*.md
- Analyst jobs: POST /analyst/run, GET /analyst/jobs/:id (read-only repo review)
- Voice tools on realtime proxy: request_analyst_review, get_analyst_status, write_inbox_summary
- Project reports: POST /reports/refresh (force/deep)
- Analyst always receives fresh deep scan + git recent changes + canonical phase docs

Registered voice projects: atlas, vocallearn (registry: vocalllearn), career (registry: career-dashboard)

If an analyst brief says a feature is "missing" but it appears in this list or you just used the tool successfully, tell Camron the report cache was stale — cite live capabilities and the tool result, not the outdated brief.`;
}
