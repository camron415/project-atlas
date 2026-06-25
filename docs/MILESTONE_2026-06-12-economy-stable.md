# Milestone — Economy voice stable (FT3 return-build)

**Saved:** 2026-06-25  
**Build stamp:** `2026-06-12-return-economy`  
**Git tag:** `backup/2026-06-12-return-economy`  
**Status:** Field-verified — mic, audio, chief tools, AirPods routing working. Slightly higher latency than full Realtime (expected for economy path).

---

## What this backup is

Stable **voice economy** release for road use: cheap long sessions (~$0.40/hr class vs ~$3/hr full Realtime), Grok STT, tool-calling chief, server TTS speak.

**Do not regress without explicit decision.** Roll back to full Realtime via `scripts/build-ios-release.sh` (stamp `2026-06-10-chat-sessions` era).

---

## Architecture (locked)

```
AirPods mic → Grok STT (monologue mode)
  → POST /voice/plan-turn (chief + tools)
      → search_context (FTS: reports + inbox + docs)
      → web_lookup (live facts, no permission ask)
      → dispatch_analyst, write_inbox
  → Speak: server /tts → single MP3 play (NO per-turn Realtime WS)
```

| Layer | Choice |
| --- | --- |
| STT | Grok only in economy (no Apple fallback) |
| Chief routing | tools_only — no client regex for research |
| Speak | `speak-economy-reply.ts` — one TTS MP3 per turn |
| Network | MagicDNS first; runtime LAN from `/health.lanIp`; server auto-detects WiFi IP |
| Autonomy v0 | Morning brief scheduler (`ATLAS_MORNING_BRIEF=1`) → `inbox/YYYY-MM-DD-morning.md` |

---

## Build & server

```bash
# Economy iPhone build (device UDID in script or pass as arg)
./scripts/build-ios-release-economy.sh

# Server (Node 22)
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd server && npm run dev
```

**Verify on device:** Settings/header → stamp `2026-06-12-return-economy`, mode **Voice economy**.

**Connectivity:** Tailscale MagicDNS works on any network; LAN IP learned at runtime after first successful connect. Mac server must be running.

---

## Economy flags (baked at build)

| Env | Value |
| --- | --- |
| `EXPO_PUBLIC_VOICE_ECONOMY` | `1` |
| `EXPO_PUBLIC_REALTIME_UNIFIED` | `0` |
| `EXPO_PUBLIC_VOICE_V2` | `0` |
| `EXPO_PUBLIC_XAI_STT` | `1` |

---

## Known tradeoffs

- **Latency:** Higher than Unified Realtime — extra hop (STT → plan-turn → TTS) vs single Realtime session. Acceptable for economy; tune endpointing/STT timeouts if needed.
- **Speak quality:** Rex via server TTS, not live Realtime PCM — fewer duplicates, lower cost.
- **LAN-only without Tailscale:** First connect needs MagicDNS or Tailscale IP; then app learns current LAN from `/health`.

---

## Related docs

- `docs/VOICE_ECONOMY.md` — build, flags, morning brief
- `docs/PHASE_1_75.md` — analyst + inbox workflow
- `docs/ROADMAP.md` — Phase 2 next
- `inbox/2026-06-12-economy-stable-milestone.md` — same summary for FTS / chief `search_context`

---

## Phase position

| Phase | Status at this milestone |
| --- | --- |
| 0–1.5 | ✅ Complete |
| 1.75 | ✅ Analyst, inbox, chief tools, chat sessions |
| FT3 economy | ✅ Stable (this backup) |
| Autonomy v0 | ✅ Morning brief scheduler |
| **Phase 2** | **Next** — managers, scheduled reports, proactive notifications |
