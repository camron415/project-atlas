# Atlas

Personal command center and voice-first chief assistant for Camron's project portfolio.

Atlas is the interface layer ("Hey, Atlas") that sits above department managers and worker agents. It uses xAI Grok for fast voice conversation, a text persona filter for Jarvis-inspired tone, and cached project reports so most replies stay cheap and fast.

## Start Here

- **Continuing work?** Read `docs/HANDOFF.md` first — full conversation summary, decisions, and Phase 1 Opus prompt.
- Persona prompt: `docs/PERSONA.md`
- Agent specs: `docs/AGENTS.md`
- Full roadmap: `docs/ROADMAP.md`

## Architecture

```
You (voice/text) → Atlas Chief → Persona Filter → xAI Voice
                      ↓
              Project Registry + Report Cache
                      ↓
         Department Managers → Worker Agents → Local Git Repos
```

## Projects (initial registry)

| Project | Priority | Path |
| --- | ---: | --- |
| VocalLearn | 1 | `../vocalLearn` (migrate to `projects/vocalLearn`) |
| Career dashboard | 2 | `../../career-planning-roadmap/career-dashboard` |
| Financial advisor | 3 | placeholder — not built yet |
| Poly-bot (archived) | — | `../poly-bot` |

## Repo layout

- `docs/` — persona prompt, registry, roadmap, agent specs
- `server/` — 24/7 orchestrator (SQLite, reports, chief API)
- `apps/mobile/` — Expo chat + push-to-talk client (Phase 1)
- `config/network.json` — LAN server URL for Mac + iPhone clients

## Network

Atlas server URL (Mac LAN): **http://YOUR_MAC_LAN_IP:8787**

- Mac local: `http://127.0.0.1:8787`
- iPhone (same WiFi): `http://YOUR_MAC_LAN_IP:8787`
- Health check: `http://YOUR_MAC_LAN_IP:8787/health`

If your Mac's IP changes, update `server/.env` (`ATLAS_LAN_IP`, `ATLAS_PUBLIC_URL`) and `config/network.json`.

## Run Atlas (Phase 1 — voice MVP)

Two pieces run together: the **server** (on your Mac, 24/7) and the **mobile app**
(`apps/mobile/`, an Expo app you open on the Mac simulator or a physical iPhone).

### 1. Start the server (Mac)

```bash
cd server
npm install            # first time only
cp .env.example .env   # then paste your XAI_API_KEY into .env
npm run dev            # listens on 0.0.0.0:8787
```

Verify it is up:

```bash
curl http://127.0.0.1:8787/health
# -> {"ok":true,"service":"atlas",...}
```

Useful server commands (from `server/`):

```bash
npm run scan             # rescan registered projects
npm run refresh-reports  # rebuild cached project reports from README/HANDOFF/ROADMAP
npm run typecheck
```

### 2. Start the mobile app (dev client — not Expo Go)

The voice loop uses native modules (`expo-speech-recognition`, PCM audio), so it
needs a **development build**, not Expo Go.

```bash
cd apps/mobile
npm install            # first time only
cp .env.example .env   # sets EXPO_PUBLIC_ATLAS_SERVER_URL

# First time on the iPhone (connect via USB):
npx expo run:ios --device

# After that, just start the bundler:
npx expo start --dev-client
```

> You can still type questions in the text box (works anywhere) to test the
> chat + voice-reply path without the mic.

### 3. Connect your iPhone (same WiFi)

1. iPhone on the **same WiFi** as the Mac.
2. Find your Mac's LAN IP: `ipconfig getifaddr en0` (currently `YOUR_MAC_LAN_IP`).
3. `apps/mobile/.env` → `EXPO_PUBLIC_ATLAS_SERVER_URL=http://YOUR_MAC_LAN_IP:8787`
   (this is the default). Changing it requires `npx expo start -c`.
4. Sanity check from iPhone Safari: `http://YOUR_MAC_LAN_IP:8787/health` → `{ "ok": true }`.

If your Mac's IP changes, update `apps/mobile/.env`, `server/.env`
(`ATLAS_LAN_IP`, `ATLAS_PUBLIC_URL`), and `config/network.json`.

### Try it (Grok-style voice mode)

**Tap the mic once**, ask **"What's the status of VocalLearn?"**, then **pause** —
Atlas auto-sends, replies in the transcript, and speaks in the Ara persona voice.
Tap the mic again **while Atlas is talking** to interrupt and ask a follow-up.
Toggle **Deep reasoning** (or say "think deeply") for a slower, more capable turn.

- Full run + debug checklist: **`docs/VOICE_TEST.md`** (run before each session)
- How the pipeline works: **`docs/VOICE_ARCHITECTURE.md`**

### How it fits together

```
iPhone app  ──tap-once, auto-send──▶  on-device STT (text)
     │                                      │
     │   POST /realtime/client-secret + WebSocket → xAI realtime (grok-voice-think-fast, "ara")
     ▼                                      │
 transcript  ◀── streamed text + PCM audio ─┘   (fast path)
     │
     └── "think deeply" / Deep toggle → POST /chat {deep} → grok-4-fast-reasoning → /tts MP3
                                              │
                          cached reports + persona + history (server/data/atlas.db)
```

## Phase status

- **Phase 0** — foundation (registry, SQLite, docs, report scanner)
- **Phase 1** — voice chat MVP with real project context
- **Phase 2** — managers, proactive alerts, approval inbox
- **Phase 3** — autonomous coding workers

See `docs/ROADMAP.md` for the full plan.
