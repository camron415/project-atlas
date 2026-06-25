# Atlas milestone — economy voice stable backup

**Date:** 2026-06-25 · **Project:** atlas · **Stamp:** `2026-06-12-return-economy`

## Summary for chief / search_context

This is the **canonical stable backup** of Atlas voice economy mode after return from hiatus. User confirmed mic, audio, and chief conversation working on iPhone with AirPods. Latency is slightly higher than full Realtime — expected for economy architecture.

**Git tag:** `backup/2026-06-12-return-economy`  
**Full doc:** `docs/MILESTONE_2026-06-12-economy-stable.md`

## What works

- Grok STT + economy turn (`/voice/plan-turn`)
- Chief tools: `search_context`, `web_lookup`, `dispatch_analyst`, `write_inbox`
- Server TTS speak (single MP3 per reply — no duplicate Realtime audio)
- AirPods mic + playback routing
- Tailscale MagicDNS + runtime LAN discovery from `/health.lanIp`
- Morning inbox brief v0 (7 AM local when `ATLAS_MORNING_BRIEF=1`)

## Build command

`./scripts/build-ios-release-economy.sh`

## Roll back to expensive Realtime

`./scripts/build-ios-release.sh`

## Next roadmap phase

**Phase 2** — per-project manager agents, scheduled reports, proactive Mac/iPhone notifications, adaptive model router. See `docs/ROADMAP.md`.

## Action items

- [ ] User to confirm latency acceptable or request tuning (STT endpointing, plan-turn model)
- [ ] Phase 2 kickoff — pick first manager (Atlas vs VocalLearn vs Career)
- [ ] Optional: commit/tag already applied at save time
