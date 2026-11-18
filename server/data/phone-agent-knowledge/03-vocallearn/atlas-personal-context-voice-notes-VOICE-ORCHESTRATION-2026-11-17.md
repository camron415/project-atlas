# Atlas voice orchestration — 2026-11-17 handoff

**Status:** Shipped in `projects/atlas` (voice-local + iOS). Read this before debating “one moment” or Flash vs Plus.

## Product rules (locked for field test)

1. **Flash** answers ordinary chat from a short standing brief (SLC, Camila, Halo, Atlas — no invented job bio).
2. **Plus** runs only when a **real tool** fires: `web_search` or `look_at_code`.
3. **No keyword router** on normal calls (story words like rain, orchestration, market must not force lookup).
4. **`spoken_ack`** plays only **after** Flash actually calls a tool — one short clause from the model (e.g. “I’ll check the weather”), not a fixed repo line.
5. **~0.7s beat** before the ack plays (does not delay starting the lookup).
6. **Plus’s answer is spoken as-is** — Flash does not rewrite the result.
7. **Practice / Sunday mode:** no tools unless the user clearly asks.

## Phone (iOS)

- Smart Turn end-of-turn (not fixed 0.85s quiet); 8s cap fallback; longer hear window (~90s).
- Transcript merge for screen + model; **`cut`** flag when cap ends a turn.
- **Phonon** default quality mouth; **Kokoro** in Call settings.
- Speaker session: **`videoChat`** audio mode (tunnel reduction); headphones often cleaner.

## Where the code lives

| Piece | Path |
| --- | --- |
| Orchestration, Flash choice, tools, ack beat | `projects/atlas/server/voice-local/app.py` |
| Call UI, turn logic, audio | `projects/atlas/ios/AtlasVoice/CallLoop.swift`, `CallView.swift` |
| On-device TTS | `projects/atlas/ios/AtlasVoice/PhoneVoice.swift` |

## Mini / git

- **`look_at_code`** reads committed files under `vocallearn` and `projects/atlas`. Push both repos; restart voice-local after pull on Mini.
- Cost / cheap-brain plan (older): `COST-CHECK-2026-11-04.md`, `CHEAP-BRAIN-WIRING.md`.
- Call transcript digest: `TRANSCRIPT-DIGEST-2026-11-02-04.md`.

## Good regression tests

- Story with rain / orchestration → Flash only, no “looking” line.
- “What happened in the market today?” → ack + Plus summary.
- “Where is model routing in Atlas?” → file search, not folder spam.
- Long mid-sentence pause → should not cut at 0.85s (new iOS build).