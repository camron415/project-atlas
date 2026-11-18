# Cheap brain wiring — voice Atlas + Halo Ask

**For:** Cursor / builder on MacBook via `camron415/vocallearn`  
**Updated:** 2026-11-05  
**Status:** Research done, not implemented. Grok 4.3 stays live until Camron approves a swap.

Camron wants the same system prompts and tool behavior, but a **much cheaper hosted model** for (1) Atlas voice on the Mac Mini and (2) Halo text Ask, so a ~$7/mo subscription could cover heavy voice + ask if inference lands near **~$0.03/hour** all-in.

Read first: [`COST-CHECK-2026-11-04.md`](./COST-CHECK-2026-11-04.md) (fact-check).  
Transcript source: [`TRANSCRIPT-DIGEST-2026-11-02-04.md`](./TRANSCRIPT-DIGEST-2026-11-02-04.md) (Nov 2–4 voice turns from Mac log).

---

## What Camron believes (and what to verify)

- **Belief:** Same quality if the system prompt and tools stay the same; only the model API changes.
- **Fact-check:** Token price can drop ~10×; **equal tutoring quality is not proven**. Run A/B on real Halo turns and Atlas planning calls before cutting over.
- **Belief:** Web search can be “included” in the cheap stack.
- **Fact-check:** Almost always a **separate per-call fee** (xAI $0.005/search; DeepSeek Search $0.00075/search). Budget both.

---

## Current stack (do not break without a flag)

| Surface | Repo | Brain today | Key files |
| --- | --- | --- | --- |
| Atlas voice | `projects/atlas` (separate git) | Grok 4.3 via xAI Responses API | `server/voice-local/app.py` — `MODEL = "grok-4.3"`, `grok_events()`, `web_search` + `look_at_code` |
| Halo Ask | `vocalLearn` | Grok via `web/src/lib/grok.ts`, `grok-stream.ts`, `/api/chat` | Env: `XAI_API_KEY`, model from `GROK_CHAT_MODEL` / route |

Voice path today: phone ears/mouth optional (`X-Atlas-Mouth: phone`); Smart Turn + Grok + Kokoro or phone TTS on Mini.  
Ask path: harvest harness, tools, reasoning tiers — **not** the same code as Atlas voice.

---

## Pricing targets (published list rates, Nov 2026)

| Provider | Model (API id) | Input / 1M | Output / 1M | Search (typical) |
| --- | --- | --- | --- | --- |
| xAI (today) | `grok-4.3` | $1.25 | $2.50 | **$5 / 1k calls** ($0.005 each) |
| xAI cached | same | $0.20 | — | — |
| Alibaba | `qwen3.7-flash` (prompt ≤32k) | $0.03 | $0.13 | separate product / host |
| DeepSeek | `deepseek-flash` off-peak | $0.15 | $0.60 | **$0.75 / 1k** Search API |

**Planning math (voice, ~1 turn/min, short replies, ≤32k prompt):** Qwen flash ≈ **$0.02–0.03/hour** tokens only; add search separately.  
**Today’s Atlas line:** Camron’s ~**$0.30/hour** test included Grok tokens + priority tier (2× when granted) + searches — not comparable to “tokens only.”

Subscription sketch from the call: 20 min/day ≈ 10 h/mo × $0.03 ≈ **$0.30/mo** inference; 1 h/day ≈ 30 h × $0.03 ≈ **$0.90/mo**. Room under $6.99 if churn and text ask are bounded.

---

## Recommended implementation order

1. **Env + feature flag** — `ATLAS_BRAIN_PROVIDER=xai|qwen|deepseek` on Mini; `HALO_BRAIN_PROVIDER` or extend existing Grok env in web. Default `xai`.
2. **Atlas voice** — In `app.py`, factor `open_grok()` into a small adapter: same streaming SSE shape to the phone, swap base URL + model id + tool schema (Responses-compatible hosts first: DeepSeek Anthropic/OpenAI format, DashScope/Qwen).
3. **Keep tools** — `look_at_code` stays local on Mini. `web_search`: either provider native search or DeepSeek Search API + inject snippets (match current “no URLs read aloud” behavior).
4. **Prompt budget** — Trim standing system prompt or aggressive cache so Ask/voice stay under **32k** on Qwen tier; log token counts per turn in `calls.jsonl` / Halo metrics.
5. **Halo Ask** — Second track in `grok.ts` / `callGrokChat`: same messages, different endpoint when flag on. Re-run `test:harvest` and study harness checks that assert `provider === "grok"`.
6. **Quality gate** — Side-by-side: 20 real Ask harvests + 10 voice planning turns; Camron blind listen/read before default flip.

Do **not** promise unlimited Ask until max output tokens and prompt size are capped in product.

---

## Candidate models (from Nov 4 call + fact-check)

| Name on call | Use | Notes |
| --- | --- | --- |
| Qwen3.7-Flash | Primary cheap candidate | Best $/token for short context; tier jumps at 32k/256k |
| DeepSeek flash (`deepseek-flash`) | Alternate | ~5× cheaper than Grok, not 40×; own Search API |
| Hermes 3 70B / Llama 3.3 70B | **Drop** | Not same class as 4.3 for product voice |
| Grok 4.3 | Baseline / fallback | Keep for hard reasoning regex (`HARD` in app.py) optional |

Voice **TTS** (Kokoro on phone) is unrelated to brain cost; StyleTTS2/OpenVoice is a separate experiment.

---

## Where transcripts live

| What | Location | In GitHub? |
| --- | --- | --- |
| Full turn log (heard/said/timing) | `~/Library/Application Support/Atlas/calls.jsonl` on Mac Mini | **No** — local only |
| Digest for agents | `atlas-personal-context/voice-notes/TRANSCRIPT-DIGEST-2026-11-02-04.md` | **Yes** after push |
| Chat archive summaries | `archive/chats/INDEX.md` | Yes |

To refresh digest from Mini: export Nov 4 (or date range) from `calls.jsonl` into `TRANSCRIPT-DIGEST-*.md`, commit, push.

---

## Atlas voice agent knowledge (phone)

She reads each turn:

- `atlas-personal-context/` clips via `system_prompt()` in `app.py` (NOW.md, MY_STORY, chat INDEX lines).
- **`look_at_code`** on `vocallearn` + `atlas` repos when asked about code.
- **`atlas-personal-context/voice-notes/COST-CHECK-2026-11-04.md`** — indexed in `archive/chats/INDEX.md` row `cost1104`.

Paths must be **inside vocalLearn checkout** or full Mac path under vocalLearn/atlas roots (fixed 2026-11-04). After server reload, **end call and start again** so she picks up new files.

---

## Open product threads (same calls, not blocking wiring)

- Long user monologue: Smart Turn + caption commit; optional end-of-turn phrase later.
- Move Smart Turn + Grok HTTP to phone (latency); repo tool already on Mini.
- Write notes tool for voice → agent handoff (discussed, not built).
- Halo: harness + review before Apple review; phone build may be ahead of `halo-ui-streamline` on GitHub.

---

## Cursor task paste (for MacBook)

```
Read vocalLearn/atlas-personal-context/voice-notes/CHEAP-BRAIN-WIRING.md and COST-CHECK-2026-11-04.md.
Do not change production Grok default without a feature flag and Camron sign-off.
Phase 1: Atlas voice-local adapter behind ATLAS_BRAIN_PROVIDER (test qwen or deepseek-flash on lab calls only).
Phase 2: Halo web grok.ts parallel endpoint for Ask; update harness tests that hardcode provider grok.
Log $/turn estimates. No promote, no KEPT-BOARD unless Halo ticket says so.
Atlas repo path: .../projects/atlas (voice-local/app.py).
```
