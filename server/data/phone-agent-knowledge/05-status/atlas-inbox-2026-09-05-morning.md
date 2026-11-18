# Morning
**Date:** 2026-09-05T11:50:35.757Z · **Project:** atlas
**Analyst job:** aj-1788609025216-kdeaoq

## Summary
Automated morning scan for **atlas** (9/5/2026, 5:50:35 AM).

## Analyst findings
## Headline
Atlas Phase 1.75 (analyst + inbox) is complete and active per `docs/PHASE_1_75.md`; recent git activity centers on recruiter README, network sanitization, and Phase 2 manager scaffolding.

## Key findings
- **Git activity**: HEAD `28b80f1` ("Publish a recruiter-friendly README; move setup detail to docs") and `fe1ad7f` ("Sanitize network defaults and keep machine-specific config local") are the two most recent commits; `c744ec3` added study mode learning tutor.
- **Canonical docs**: `docs/PHASE_1_75.md` shows all six implementation steps checked off (inbox storage, analyst job runner, status API, chief tools, mobile UX, session-close template); `docs/PHASE_1_5_CLOSEOUT.md` confirms Phase 1.5 voice production closed 2026-06-10.
- **Priority implementation files**: `server/src/inbox/store.ts` (write + overwrite logic for `standup-prep`/`latest`), `server/src/analyst/run.ts` (enqueue + `runAnalystJob`), and `server/src/analyst/execute-tool.ts` (tool wiring for `request_analyst_review`/`write_inbox_summary`).
- **Working tree**: 12 modified files under `server/src/` (cli, inbox, managers, morning-brief) plus new untracked paths (`server/src/agent/`, `server/src/career/`, `docs/PHONE_*`) indicate Phase 2 manager scaffolding is live.
- **Recent inbox artifacts**: `inbox/2026-09-03-LATEST.md` and `inbox/2026-09-03-manager-run.md` record overnight VocalLearn + Career runs; `inbox/2026-09-03-morning.md` shows the analyst brief template in use.

## Risks or gaps
- **Network drift**: `config/network.json` and `server/.env.example` are modified; IP changes will break Tailscale/Funnel client reachability (`apps/mobile/src/api.ts` `rewriteProxyWsUrl`).
- **LaunchAgent permissions**: `scripts/launchd/com.atlas.server.plist` and `scripts/install-launchd.sh` updated; Node Full Disk Access on `~/Documents` is required or `server/src/inbox/store.ts` writes will hang.
- **Mobile drawer incomplete**: `docs/PHASE_1_75.md` Step 5 still lists "Optional: inbox list in ☰ drawer (read-only)" unchecked; `apps/mobile/src/ChatHistoryDrawer.tsx` does not yet surface inbox artifacts.
- **Native rebuild tax**: Any change to `apps/mobile/modules/atlas-realtime-playback/` or `atlas-audio-capture/` forces full iOS rebuild (`scripts/build-ios-release.sh`); current working tree shows no native diffs but untracked `server/src/ph` suggests partial phone-agent work.
- **Cost guardrail drift**: Analyst jobs default to cheap model (`grok-4-fast-non-reasoning`) but deep scans (`ANALYST_INVENTORY_OPTIONS`) can exceed budget if `request_analyst_review` is called without `confirmed: true`.

## Suggested next steps
1. Verify LaunchAgent health: inspect `scripts/launchd/com.atlas.server.plist` and confirm Node has Full Disk Access on `~/Documents` before next overnight run.
2. Wire inbox list into mobile drawer: next file to inspect is `apps/mobile/src/ChatHistoryDrawer.tsx` against the `listInboxArtifacts` API in `server/src/inbox/store.ts`.
3. Close Wave 2 morning-brief Mac notifications gap listed in `docs/ROADMAP.md`; confirm current status in `server/src/morning-brief/schedule.ts`.
4. Audit `config/network.json` vs `config/network.example.json` to ensure Tailscale IP is the only non-example value before any remote voice test.
5. Schedule planning session to review `inbox/2026-09-03-LATEST.md` as source-of-truth before any HANDOFF/ROADMAP reference.

## Agreed next steps
- [ ] Review this brief in a morning voice session
