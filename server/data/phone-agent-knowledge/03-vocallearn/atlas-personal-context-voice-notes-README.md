# Atlas voice notes (in GitHub)

These files are for the **Atlas phone voice agent** and for **Cursor on MacBook** when planning cheaper inference.

| File | Purpose |
| --- | --- |
| [`COST-CHECK-2026-11-04.md`](./COST-CHECK-2026-11-04.md) | Fact-check of Nov 4 cost call ($0.03/hr, search fees, quality caveats) |
| [`CHEAP-BRAIN-WIRING.md`](./CHEAP-BRAIN-WIRING.md) | How to wire cheap models into Atlas voice + Halo Ask (not built yet) |
| [`TRANSCRIPT-DIGEST-2026-11-02-04.md`](./TRANSCRIPT-DIGEST-2026-11-02-04.md) | You/Atlas lines from `calls.jsonl` (Nov 2 evening + Nov 4) |
| [`VOICE-ORCHESTRATION-2026-11-17.md`](./VOICE-ORCHESTRATION-2026-11-17.md) | Flash/Plus, tool-only acks, phone turn/audio — field-test canon |

**Full transcript (not in git):** on the Mac Mini, `~/Library/Application Support/Atlas/calls.jsonl`.

**Atlas server** reads vocalLearn paths under `atlas-personal-context/` when the voice service loads prompts and when `look_at_code` opens a file. After pushing, reload voice on the Mini if she still cannot see a new file.
