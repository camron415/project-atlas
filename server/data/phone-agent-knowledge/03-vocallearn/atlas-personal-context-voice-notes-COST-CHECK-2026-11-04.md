# Cost check, 4 November 2026

Camron's builder checked the long voice call from this morning against published prices. Read this before answering anything about token cost, cheaper models, web search fees, or an unlimited plan. Say it in plain speech. Do not recite this file.

## What holds up

The shape of the idea holds. Once ears and mouth stay on the phone, the bill is tokens plus search. Grok 4.3 list price is $1.25 per million input tokens, $0.20 per million cached input tokens, and $2.50 per million output tokens. That part of the call was right.

A short-prompt flash model is in the neighborhood of a tenth the token price, and sometimes cheaper than that. Alibaba's published Qwen3.7-Flash rate, for a prompt under 32,000 tokens, is $0.03 per million input and $0.13 per million output. Cached input on that tier is about $0.006 per million. Against Grok's list price that is about 40 times cheaper on input and about 19 times cheaper on output.

For this morning's call shape, about one turn a minute with a standing prompt and short replies, those Qwen rates land near two to three cents an hour before search. Camron's "three cents an hour" is a fair planning number for that shape. It is not a measured invoice.

His subscription sketch also holds if that hour-cost holds. Thirty hours in a month at three cents is about ninety cents. Twenty minutes a day is about ten hours, about thirty cents. A $6.99 month can cover a heavy learner on voice alone.

The same token rates apply to a text ask. Unlimited text is a different risk, because a text ask is not capped the way a spoken reply is, and a long prompt can leave the cheap tier.

## What the call got wrong

xAI web search is a separate fee. The published price is $5 per 1,000 calls, which is half a cent per search. It is not included in the token price. The call said xAI search was only extra tokens. That is false.

This voice server also asks for priority service. When xAI grants that, token rates double. The call quoted list price only. A real hour on this line can sit above the thirty-cent planning figure once priority and search are both on the bill. Nine or so searches in an hour is about four or five cents by itself.

DeepSeek's flash model is not the "$0.10 to $0.30 in and out" quote. Official DeepSeek flash, off-peak, is about $0.15 per million input on a cache miss and $0.60 per million output. Peak hours are double. Cache hits are a fraction of a cent per million. Search is separate at $0.75 per 1,000 calls, about a thirteenth of a cent each. That search price on the call was right. "Included in the token price" was not.

Hermes 3 70B and Llama 3.3 70B at twelve and thirty cents per million are older models. Do not describe them as the same class as Grok 4.3.

Qwen3.7-Flash above 32,000 tokens in one request jumps to $0.10 input and $0.40 output, and above 256,000 tokens to $0.20 and $0.80. A fat Halo prompt can leave the three-cent math.

## Quality and latency

A tenth of the price is not the same sentence as equal answers. One small public comparison from July 2026 had Qwen3.7-Flash and Grok 4.3 close on a 22-item private set. That is not proof for Halo tutoring, tool use, or a long planning call. Treat the cheap model as a test, not a replacement, until Camron hears it on the real loop.

Published latency numbers vary by host. Do not promise that a cheaper host is faster than this line. This morning's first token was often under a second, and sometimes several seconds.

## Voice model notes from the same call

The phone mouth is Kokoro, 82 million parameters, running on the Apple Neural Engine in the current phone build. It is not a CPU-only model on this phone. Extra memory does not by itself fix long-sentence breaks.

StyleTTS 2, OpenVoice, and Chatterbox were named as later tests. None of that is wired in. Do not say a model swap is a one-day change.

## Product notes from the same call

Call quality, barge-in, and longer turns on his side felt good on the road. One long monologue still dropped. A longer wait, or a word that closes his turn, is still a later change.

The Halo checkout she can see stops at 29 October 2026. The phone build he is testing may be ahead of that. Do not plan harness details from the repo as if they were the phone build.

He wants the learning loop first: small settings leftovers, then harness hints and new fact sets, then Apple review. Voice cost work comes after that loop is solid. The moat he liked is the full loop and the practice data, not the voice pipe by itself.

Sources checked 4 November 2026: xAI pricing page, DeepSeek pricing page, Alibaba Model Studio pricing for Qwen3.7-Flash.
