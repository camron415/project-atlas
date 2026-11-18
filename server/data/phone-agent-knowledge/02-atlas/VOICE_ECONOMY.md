# Voice economy mode (FT3)

Long road sessions with **Grok STT** + **tool-calling chief** (`POST /voice/plan-turn`) + **server TTS speak** (single MP3 per reply).

**Stable milestone:** `docs/MILESTONE_2026-06-12-economy-stable.md` · tag `backup/2026-06-12-return-economy`

## Build & install (iPhone)

```bash
chmod +x scripts/build-ios-release-economy.sh
./scripts/build-ios-release-economy.sh
```

Confirm header stamp: **`2026-06-12-return-economy`** and mode label **Voice economy**.

## Roll back to Realtime (Path B / Voice v2)

```bash
./scripts/build-ios-release.sh
```

## Server

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd server && npm run dev
```

**Network:** App probes Tailscale MagicDNS first, then Tailscale IP, then LAN. After any successful connect, `/health.lanIp` registers the Mac's current WiFi IP for local fallback. Server auto-detects LAN IP at boot (`server/src/network/lan-ip.ts`).

## Morning inbox brief (v0)

Atlas-only by default at **7:00 AM local** when `ATLAS_MORNING_BRIEF=1` in `server/.env` (server must stay running).

```bash
./scripts/morning-brief.sh
# or: cd server && npm run morning-brief -- --force
```

Writes `inbox/YYYY-MM-DD-morning.md`. Set `ATLAS_MORNING_BRIEF_PROJECTS=atlas,vocallearn` for both.

## FT3 architecture

| Layer | FT3 behavior |
|-------|----------------|
| **STT** | Grok only (no Apple fallback in economy) |
| **Chief** | Tool loop: `search_context`, `web_lookup`, `dispatch_analyst`, `write_inbox`, stubs |
| **Retrieval** | SQLite FTS over reports + inbox/*.md + key docs |
| **Speak** | Server `/tts` → one MP3 play (`speak-economy-reply.ts`) — no per-turn Realtime WS |
| **Length** | ~4-6 sentences / 400 tokens; Deep toggle → 800 |

## Flags

| Env | Economy FT3 |
|-----|-------------|
| `EXPO_PUBLIC_VOICE_ECONOMY` | `1` |
| `EXPO_PUBLIC_REALTIME_UNIFIED` | `0` |
| `EXPO_PUBLIC_VOICE_V2` | `0` |
| `EXPO_PUBLIC_XAI_STT` | `1` |

## Cost profile

- **Listen:** Grok STT per audio minute
- **Think:** Fast chat + tools (no persistent Realtime session)
- **Speak:** Server TTS per reply (no Realtime session billing)

Field test reference: ~$0.39 / ~34 min (FT2 baseline); economy speak path reduces Realtime cost further.
