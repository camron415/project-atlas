# Phase 1 latency probe — 6 November 2026

Ran from the Mac Mini. Live voice model was not changed. `grok-4.3` is still the brain in `projects/atlas/server/voice-local/app.py`.

## Result

**No TTFT.** Phase 1 does not pass and does not fail the one-second bar, because Virginia never returned a token.

| Check | Result |
| --- | --- |
| Key reaches US Virginia (`dashscope-us.aliyuncs.com`) | Yes. Model list returns 200. The same key is rejected by the Singapore host. |
| `qwen3.7-flash` stream, short prompt | HTTP 403 `AccessDenied.Unpurchased` (~350–480 ms to the error) |
| `qwen3.7-flash` stream, ~8k-token prompt | Same 403 |
| Other catalog ids tried (`qwen3.8-flash`, `qwen3.6-flash-us`, `qwen3.7-plus-us`, `deepseek-v4.1-flash`, `deepseek-v4-flash-0731-us`) | Same 403 |
| DeepSeek Search (`api.deepseek.com`) | Not run. `DEEPSEEK_API_KEY` is not in the Mini env. |

The key can see the catalog. The workspace has not turned on billing for those chat models, so there is nothing to time.

## Retest — 9 November 2026

The playground block is gone. The Virginia key is in gitignored `projects/atlas/server/.env` as `DASHSCOPE_API_KEY`. Live `grok-4.3` was not changed. Probed from this Mac Mini.

| Check | Result |
| --- | --- |
| Three short streams | TTFT **1.14s, 0.77s, 0.92s**. Median under the 1.0s bar. About 50–70 tokens/s after the first token. |
| Voice and review-sized prompts | TTFT **0.70–0.82s**. |
| ~12k-token prompt, twice | TTFT **1.92s and 1.95s**. A follow-up at ~11.6k was **1.75s**. That misses the 1.5s bar written for an 8k prompt. |
| Spoken sky answer | Correct, two sentences. |
| Review JSON, right gist and wrong gist | `{"ok":true}` and `{"ok":false}`. Same as Grok on these two. |
| Phone-bill arithmetic | Qwen answered **66**. The bill is **49.50**. Grok answered **49.5**. |
| Same prompts on `grok-4.3` | First token **2.5–3.9s** after a cold 9s hello. Faster than that cold start, slower than Qwen on this sample. |
| Built-in `enable_search` | Returned in **3.0s** and said the Rangers won the 2023 World Series when asked for the most recent. Not proven. |

Short phone and review turns clear the latency bar. A long prompt and a simple money question do not. Do not swap the live brain on this sample.

## Next step

Short turns are fast enough to keep testing. Do not wire `ATLAS_BRAIN_PROVIDER` until a replay catches the arithmetic miss and the search answer is current.

1. Phase 2 replay: real voice turns and a few Kept review grades, side by side with Grok.
2. Put `DEEPSEEK_API_KEY` in the same gitignored env if search stays on DeepSeek. Alibaba's own search is the other option, and this one call did not prove it.
