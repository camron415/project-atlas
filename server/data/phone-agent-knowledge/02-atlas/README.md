# Atlas

Voice-first personal assistant for my own projects. Talk (or type) to Atlas about what’s going on in repos like VocalLearn and the career dashboard; it answers with project context instead of generic chat.

## Stack

- **Expo / React Native** client (chat + push-to-talk)
- **Node / TypeScript** server (REST + realtime)
- **SQLite** for local state and cached project reports
- **xAI** for voice and reasoning turns

## What I built

- Mobile client that talks to a local Mac server over the LAN
- Project registry + cached README/handoff reports so answers stay cheap and grounded
- Voice mode with transcript, interrupt, and optional deeper reasoning
- Clear split between “chief” assistant and later agent workers (roadmap in `docs/`)

## Repo map

```text
apps/mobile/   Expo client
server/        Orchestrator API + SQLite
docs/          Persona, roadmap, voice architecture
config/        Local network config (not for public secrets)
```

## For recruiters

Shows client/server TypeScript, mobile UI, API design, and real-time voice UX — complementary to VocalLearn.

## For developers continuing the project

Setup, voice test checklist, and engineering notes:

- [`docs/HANDOFF.md`](./docs/HANDOFF.md)
- [`docs/DEV_SETUP.md`](./docs/DEV_SETUP.md)
- [`docs/VOICE_TEST.md`](./docs/VOICE_TEST.md)
