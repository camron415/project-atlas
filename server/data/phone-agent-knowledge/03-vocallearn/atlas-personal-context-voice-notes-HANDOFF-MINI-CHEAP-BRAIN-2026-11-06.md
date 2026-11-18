# Mini handoff — cheap brain test (2026-11-06)

**For:** Cursor / builder on Mac Mini (Atlas + optional Halo harness tests)  
**Camron status:** Alibaba (Model Studio US Virginia) and DeepSeek API keys are **on the Mini in env** (not in git, not in chat). Ready for latency + quality probes before any production swap.

**Do not** change live `MODEL = "grok-4.3"` in `projects/atlas/server/voice-local/app.py` without `ATLAS_BRAIN_PROVIDER` flag and Camron sign-off.

---

## What we decided (Air / GitHub)

### Goal

Replace xAI Grok 4.3 (tokens + $5/1k web search) with:

1. **Brain:** `qwen3.7-flash` via **Alibaba Model Studio, US (Virginia)** — list **$0.03 / $0.13 per 1M** (input/output) for prompts **≤ 32k tokens**.
2. **Search:** **DeepSeek Search** — **$0.75 / 1,000** successful calls (`POST https://api.deepseek.com/v1/tools/search`). Same DeepSeek API key as their chat API.

Sub‑$7/mo unlimited voice/ask only works if latency and quality hold. **Cost is proven on paper; quality and TTFT are not.**

### Repo canon (vocallearn `halo-ui-streamline`, commit with voice-notes)

| File | Purpose |
| --- | --- |
| `atlas-personal-context/voice-notes/COST-CHECK-2026-11-04.md` | Fact-check (search fees, priority 2×, Qwen tiers, quality caveats) |
| `atlas-personal-context/voice-notes/CHEAP-BRAIN-WIRING.md` | Wiring plan: flags, `app.py`, Halo `grok.ts`, quality gate |
| `atlas-personal-context/voice-notes/TRANSCRIPT-DIGEST-2026-11-02-04.md` | Atlas `calls.jsonl` digest |
| `archive/chats/INDEX.md` row `cost1104` | Pointer for phone agent |

### Product names (for logs / forms)

- **In-app UI:** **Cove** (`web/src/lib/constants.ts` → `APP_NAME`)
- **Product/docs:** **Halo** (Ask, Keep, harness)
- **Repo:** vocalLearn — App Store name **not chosen**

### Atlas code path (not inside vocallearn)

- `projects/atlas/server/voice-local/app.py` — `MODEL = "grok-4.3"`, `web_search` + `look_at_code`
- Full call log: `~/Library/Application Support/Atlas/calls.jsonl`

---

## Latency bar (measured from digest)

Atlas **first_token** ms (218 turns, Nov 2–4):

| Bucket | Median | Notes |
| --- | --- | --- |
| No search | **~864 ms** | **75%** under 1s (excluding rare 5s+ stalls) |
| With search | **~2.2 s** | Tool + results before speak |

Cheap stack must be **comparable on plain turns** (~sub‑second to first token). OpenRouter charts show **Qwen3.7-Flash US ~0.76s** p50 (optimistic); other monitors ~1.8s — **measure from Utah/Mini, don’t trust charts alone**.

Halo Ask: chat route **awaits classify** (cap **1.2s**) before answer stream — faster brain alone won’t fix Ask; parallel classify is a separate ticket.

---

## Camron’s spend yesterday (context)

~**$2** for **1M+ tokens** on xAI in a long voice session. Target after swap: same usage **~10× cheaper** on tokens if prompts stay **≤32k** and search is DeepSeek not xAI.

---

## Next instructions (Mini agent)

### Phase 0 — Env (Camron already did keys)

Set on Mini only (example names — match `CHEAP-BRAIN-WIRING.md`):

- `DASHSCOPE_API_KEY` or Alibaba Model Studio key (Virginia region key)
- `DEEPSEEK_API_KEY`
- Optional: `ATLAS_BRAIN_PROVIDER=qwen` (lab only, default stays `xai`)

Virginia base URL: see https://www.alibabacloud.com/help/en/model-studio/regions — **US `us-east-1`**, OpenAI-compatible `/compatible-mode/v1`. Model id: **`qwen3.7-flash`**.

### Phase 1 — $0.01 latency probe (before wiring)

From Mini (network path similar to Atlas voice):

1. **Short prompt:** one user line, stream=true, log **TTFT**.
2. **~8k prompt:** padded system + short user, stream=true, log **TTFT** (halo-like size, still under 32k).

**Pass:** TTFT **≤ ~1.0s** typical on (1), **≤ ~1.5s** on (2). **Fail:** median **≥ 2s** on (1) — stop, try different host (OpenRouter US route) or stay on Grok.

3. One **DeepSeek Search** call with a factual query; confirm **&lt;500ms** acceptable added on top when tool runs.

Do **not** paste keys in Cursor chat. Use `server/.env` or voice-local env.

### Phase 2 — Replay (still lab)

Replay **10 turns** from `calls.jsonl` (mix search / no-search) through Qwen + DeepSeek search injection (same shape as today: tool result in context, short spoken replies). Compare to Grok outputs in a side-by-side md on disk.

Replay **5 Halo harness strings** from `web/scripts/slice-live.ts` or `test:ask:harness` dry prompts — JSON classify shape is separate; this is answer quality only.

### Phase 3 — Wire (only if Phase 1–2 pass)

Per `CHEAP-BRAIN-WIRING.md`:

- `ATLAS_BRAIN_PROVIDER` adapter in `voice-local/app.py` (SSE shape unchanged)
- Log `prompt_tokens`, `completion_tokens`, est. $/turn to `calls.jsonl`
- Halo Phase 2 on Air unless Mini has vocallearn checkout

### Explicit non-goals

- No `vercel --prod`, no promote
- No KEPT-BOARD unless Halo ticket
- Learning loop / harness ship order unchanged (settings → harness → review → store)

---

## If stuck

- Read `CHEAP-BRAIN-WIRING.md` + `COST-CHECK-2026-11-04.md` first
- Atlas server down: start per `projects/atlas` README / `atlas-server.sh`
- After git pull vocallearn: `git pull origin halo-ui-streamline`

**Camron:** paste this file path or “read HANDOFF-MINI-CHEAP-BRAIN-2026-11-06.md” in the Mini Cursor chat and say **keys are in env — run Phase 1**.
